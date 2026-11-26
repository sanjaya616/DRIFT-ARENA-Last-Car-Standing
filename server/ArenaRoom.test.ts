import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArenaRoom } from './ArenaRoom.ts';
import { sanitizeCustomization } from '../src/multiplayer/protocol.ts';
import type { ServerToClientMessage } from '../src/multiplayer/protocol.ts';

function makeParticipant(id: string, name: string, out: ServerToClientMessage[]) {
  return {
    id,
    name,
    verifiedUid: null,
    reconnectToken: `tok_${id}`,
    customization: sanitizeCustomization({ vehicleId: 'street_rs' }),
    send: (msg: ServerToClientMessage) => {
      out.push(msg);
    },
  };
}

describe('ArenaRoom Authoritative Multiplayer Rules', () => {
  it('enforces >=2 ready humans to start and 8-player maximum', () => {
    const msgs: ServerToClientMessage[] = [];
    const room = new ArenaRoom({
      roomId: 'room_1',
      roomCode: 'TEST01',
      isPrivate: true,
      hostId: 'p1',
      aiFill: false,
    });

    assert.equal(room.addHumanPlayer(makeParticipant('p1', 'Alice', msgs)).ok, true);
    room.setReady('p1', true);
    const tooFew = room.startMatch('p1', { skipLoop: true });
    assert.equal(tooFew.ok, false);
    if (!tooFew.ok) {
      assert.equal(tooFew.code, 'NOT_ENOUGH_READY');
    }

    for (let i = 2; i <= 8; i++) {
      assert.equal(room.addHumanPlayer(makeParticipant(`p${i}`, `Player${i}`, msgs)).ok, true);
    }

    const overflow = room.addHumanPlayer(makeParticipant('p9', 'Overflow', msgs));
    assert.equal(overflow.ok, false);
    if (!overflow.ok) {
      assert.equal(overflow.code, 'ROOM_FULL');
    }

    room.setReady('p2', true);
    const started = room.startMatch('p1', { skipLoop: true });
    assert.equal(started.ok, true);
    assert.equal(room.status, 'playing');
  });

  it('prevents duplicate pickup collection when two cars overlap the same item in one tick', () => {
    const msgs1: ServerToClientMessage[] = [];
    const msgs2: ServerToClientMessage[] = [];
    const room = new ArenaRoom({
      roomId: 'room_2',
      roomCode: 'PICK02',
      isPrivate: true,
      hostId: 'p1',
      aiFill: false,
    });

    room.addHumanPlayer(makeParticipant('p1', 'Alice', msgs1));
    room.addHumanPlayer(makeParticipant('p2', 'Bob', msgs2));
    room.setReady('p1', true);
    room.setReady('p2', true);
    assert.equal(room.startMatch('p1', { skipLoop: true }).ok, true);

    // Clear 5s starting countdown + 4s pickup start delay
    for (let i = 0; i < 200; i++) {
      room.stepTick(0.05, 10_000 + i * 50);
    }

    const c1 = room.getCarState('p1')!;
    const c2 = room.getCarState('p2')!;
    c1.equippedWeapon = null;
    c2.equippedWeapon = null;
    c1.x = 10;
    c1.z = 10;
    c2.x = 10.2;
    c2.z = 10.1;

    room.spawnPickupForTest('rocket', 10.1, 10.05);
    const beforeCount = room.getActivePickups().length;
    assert.ok(beforeCount >= 1);

    room.stepTick(0.05, 25_000);

    const collectors = [c1, c2].filter((c) => c.equippedWeapon?.kind === 'rocket');
    assert.equal(collectors.length, 1, 'Exactly one player should claim the pickup');

    const pickupEvents = msgs1.filter(
      (m) => m.type === 'combat_event' && m.event.kind === 'pickup_collected' && m.event.pickupKind === 'rocket',
    );
    assert.equal(pickupEvents.length, 1);
  });

  it('applies authoritative server rocket damage and determines match winner when opponent reaches 0 HP', () => {
    const msgs: ServerToClientMessage[] = [];
    const room = new ArenaRoom({
      roomId: 'room_3',
      roomCode: 'COMB03',
      isPrivate: true,
      hostId: 'p1',
      aiFill: false,
    });

    room.addHumanPlayer(makeParticipant('p1', 'Shooter', msgs));
    room.addHumanPlayer(makeParticipant('p2', 'Target', msgs));
    room.setReady('p1', true);
    room.setReady('p2', true);
    assert.equal(room.startMatch('p1', { skipLoop: true }).ok, true);

    // Advance past 5s start countdown & 3s spawn protection
    for (let i = 0; i < 180; i++) {
      room.stepTick(0.05, 30_000 + i * 50);
    }

    const shooter = room.getCarState('p1')!;
    const target = room.getCarState('p2')!;
    shooter.x = 0;
    shooter.z = 12;
    shooter.yaw = 0; // facing -Z toward target
    shooter.vx = 0;
    shooter.vz = 0;
    target.x = 0;
    target.z = 0;
    target.vx = 0;
    target.vz = 0;
    target.hp = 30;
    target.shieldTimer = 0;
    target.armorTimer = 0;
    target.spawnProtectionTimer = 0;

    shooter.equippedWeapon = {
      kind: 'rocket',
      name: 'Rocket',
      usesRemaining: 2,
      maxUses: 2,
      cooldown: 0,
      maxCooldown: 2.5,
    };

    const fired = room.activateWeapon(shooter, [shooter, target]);
    assert.equal(fired, true);
    assert.equal(shooter.equippedWeapon?.usesRemaining, 1);

    // Step ticks until rocket travels 12m at 45m/s (~0.27s = ~6 ticks)
    for (let i = 0; i < 15; i++) {
      room.stepTick(0.05, 45_000 + i * 50);
    }

    assert.equal(target.alive, false);
    assert.equal(target.hp, 0);
    assert.equal(room.status, 'finished');
    const gameOver = msgs.find((m) => m.type === 'match_over');
    assert.ok(gameOver && gameOver.type === 'match_over');
    assert.equal(gameOver.winner.id, 'p1');
    assert.equal(gameOver.winner.name, 'Shooter');
  });

  it('preserves car state during 15s reconnect grace window and eliminates after expiry', () => {
    const msgs: ServerToClientMessage[] = [];
    const room = new ArenaRoom({
      roomId: 'room_4',
      roomCode: 'RECO04',
      isPrivate: true,
      hostId: 'p1',
      aiFill: false,
    });

    room.addHumanPlayer(makeParticipant('p1', 'Alice', msgs));
    room.addHumanPlayer(makeParticipant('p2', 'Bob', msgs));
    room.setReady('p1', true);
    room.setReady('p2', true);
    assert.equal(room.startMatch('p1', { skipLoop: true }).ok, true);

    for (let i = 0; i < 120; i++) {
      room.stepTick(0.05, 10_000 + i * 50);
    }

    const bobCar = room.getCarState('p2')!;
    bobCar.x = 42;
    bobCar.z = -18;
    bobCar.hp = 77;

    // Disconnect at t = 20_000
    room.removeHumanPlayer('p2', 20_000);
    assert.equal(bobCar.connected, false);
    assert.equal(bobCar.alive, true);

    // Reconnect within 15s (t = 28_000) restores position & HP
    const restored = room.reconnectHumanPlayer({
      playerId: 'p2',
      reconnectToken: 'tok_p2',
      send: (m) => msgs.push(m),
      nowMs: 28_000,
    });
    assert.equal(restored, true);
    assert.equal(bobCar.connected, true);
    assert.equal(bobCar.hp, 77);

    // Disconnect again at t = 30_000 and let 16s pass without reconnect -> eliminated
    room.removeHumanPlayer('p2', 30_000);
    room.stepTick(0.05, 46_000);
    assert.equal(bobCar.alive, false);
    assert.equal(bobCar.hp, 0);
    assert.equal(room.status, 'finished');
  });
});
