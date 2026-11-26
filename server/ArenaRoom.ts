import type {
  AbilityKind,
  CarCustomization,
  EquippedAbility,
  EquippedWeapon,
  PickupKind,
  WeaponKind,
  WinnerInfo,
} from '../src/types/game.ts';
import { VEHICLE_CONFIGS, VEHICLE_ORDER } from '../src/cars/vehicleConfigs.ts';
import {
  ABILITY_SPECS,
  applyHealthChange,
  calculateEffectiveDamage,
  createEquippedAbility,
  createEquippedWeapon,
  isPickupSpawnValid,
  isWeaponPickup,
  jumpVelocityForHeight,
  MAX_PLAYER_HP,
  PICKUP_SPAWN_CONFIG,
  pickWeightedPickupKind,
  WEAPON_SPECS,
} from '../src/combat/combatRules.ts';
import {
  evaluateSafeZone,
  isOutsideSafeZone,
  PICKUP_START_DELAY_SEC,
  SPAWN_PROTECTION_SEC,
  START_COUNTDOWN_SEC,
  SURVIVAL_TARGET_DURATION_SEC,
} from '../src/combat/survivalRules.ts';
import {
  COLLISION_PAIR_COOLDOWN_SEC,
  computeCollisionDamage,
  computeVehicleKinematics,
  mpsToKmh,
  updateDriftState,
  type DriftState,
} from '../src/physics/vehicleDynamics.ts';
import {
  createInitialTrainSchedule,
  evaluateDrawbridgeState,
  isOnAsphaltRoad,
  PICKUP_CANDIDATE_ZONES,
  PLAYER_SPAWN_POINTS,
  STATIC_ARENA_OBSTACLES,
  stepTrainSchedule,
  type TrainScheduleState,
} from '../src/maps/neonHarborLayout.ts';
import {
  MAX_ROOM_PLAYERS,
  MIN_READY_PLAYERS_TO_START,
  RECONNECT_GRACE_SECONDS,
  sanitizeCustomization,
  sanitizeDriverName,
  sanitizeNetInput,
  SERVER_TICK_DT,
  type CombatEventPayload,
  type LobbyPlayerInfo,
  type MatchStanding,
  type NetCarState,
  type NetHazardState,
  type NetInputPayload,
  type NetPickupState,
  type NetRocketState,
  type RoomLobbySnapshot,
  type ServerToClientMessage,
  type WorldSnapshotPayload,
} from '../src/multiplayer/protocol.ts';

export interface RoomParticipant {
  id: string;
  name: string;
  verifiedUid: string | null;
  reconnectToken: string;
  customization: CarCustomization;
  ready: boolean;
  connected: boolean;
  disconnectedAtMs: number | null;
  isAi: boolean;
  lastSeq: number;
  pendingInput: NetInputPayload;
  jumpBuffered: boolean;
  weaponTriggered: boolean;
  abilityTriggered: boolean;
  recoverTriggered: boolean;
  send: ((msg: ServerToClientMessage) => void) | null;
}

interface SimCar {
  id: string;
  name: string;
  isAi: boolean;
  connected: boolean;
  customization: CarCustomization;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  forwardSpeed: number;
  lateralSpeed: number;
  speedKmh: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  nitro: number;
  nitroActive: boolean;
  driftState: DriftState;
  slipRatio: number;
  wheelSteerAngle: number;
  isGrounded: boolean;
  coyoteTimer: number;
  jumpCooldown: number;
  tripleJumpAirUsed: number;
  tripleJumpCooldown: number;
  equippedWeapon: EquippedWeapon | null;
  equippedAbility: EquippedAbility | null;
  weaponCooldown: number;
  abilityCooldown: number;
  shieldTimer: number;
  armorTimer: number;
  nitroAbilityTimer: number;
  dashTimer: number;
  slowTimer: number;
  spawnProtectionTimer: number;
  eliminations: number;
  damageTaken: number;
  score: number;
  lastAttackerId: string | null;
  lastSafePos: { x: number; y: number; z: number; yaw: number };
  aiWaypointIdx: number;
  aiThinkTimer: number;
}

interface SimPickup {
  id: string;
  kind: PickupKind;
  x: number;
  y: number;
  z: number;
  ttl: number;
}

interface SimRocket {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  distanceTraveled: number;
  maxRange: number;
  damage: number;
  blastRadius: number;
}

interface SimHazard {
  id: string;
  kind: 'bomb' | 'spike_trap' | 'proximity_mine';
  ownerId: string;
  x: number;
  y: number;
  z: number;
  ttl: number;
  armTimer: number;
  radius: number;
  damage: number;
}

const DEFAULT_INPUT: NetInputPayload = {
  throttle: 0,
  brake: 0,
  steer: 0,
  drift: false,
  nitro: false,
  jump: false,
  useWeapon: false,
  useAbility: false,
  recover: false,
};

const AI_ROSTER: Array<{ name: string; vehicleId: CarCustomization['vehicleId']; color: string; accent: string }> = [
  { name: 'Bot Viper', vehicleId: 'muscle_gt', color: '#dc2626', accent: '#f8fafc' },
  { name: 'Bot Blaze', vehicleId: 'drift_x', color: '#8b5cf6', accent: '#38bdf8' },
  { name: 'Bot Phantom', vehicleId: 'speedster', color: '#10b981', accent: '#f8fafc' },
  { name: 'Bot Crusher', vehicleId: 'titan_4x', color: '#eab308', accent: '#0f172a' },
  { name: 'Bot Ranger', vehicleId: 'rally_beast', color: '#f43f5e', accent: '#fef08a' },
  { name: 'Bot Nova', vehicleId: 'street_rs', color: '#06b6d4', accent: '#0f172a' },
];

const AI_PATROL_LOOP = [
  { x: 0, z: 76 },
  { x: 76, z: 76 },
  { x: 76, z: -76 },
  { x: 0, z: -76 },
  { x: -76, z: -76 },
  { x: -76, z: 76 },
];

function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

function getTerrainFloorHeight(x: number, z: number): number {
  // Summit ridge plateau X in [-125..-35], Z in [-235..-205] -> Y = 8m
  if (x >= -125 && x <= -35 && z >= -236 && z <= -204) {
    return 8.15;
  }
  // East mountain ascent ramp X in [-35..0], Z in [-226..-214]
  if (x > -35 && x <= 1 && Math.abs(z + 220) <= 6) {
    const t = Math.max(0, Math.min(1, (1 - x) / 36));
    return 0.15 + t * 8.0;
  }
  // West mountain descent ramp X in [-156..-125], Z in [-226..-214]
  if (x >= -156 && x < -125 && Math.abs(z + 220) <= 6) {
    const t = Math.max(0, Math.min(1, (x + 156) / 31));
    return 0.15 + t * 8.0;
  }
  return 0.15;
}

export class ArenaRoom {
  public readonly roomId: string;
  public readonly roomCode: string;
  public readonly isPrivate: boolean;
  public hostId: string;
  public status: 'lobby' | 'playing' | 'finished' = 'lobby';
  public aiFill: boolean;
  public readonly maxPlayers: number = MAX_ROOM_PLAYERS;

  public participants = new Map<string, RoomParticipant>();
  private cars = new Map<string, SimCar>();
  private pickups: SimPickup[] = [];
  private rockets: SimRocket[] = [];
  private hazards: SimHazard[] = [];
  private impactCooldowns = new Map<string, number>();
  private boundaryTimers = new Map<string, number>();

  private tickCounter = 0;
  private matchId = '';
  private startingCountdown = 0;
  private matchElapsedSeconds = 0;
  private countdownRemaining = SURVIVAL_TARGET_DURATION_SEC;
  private pickupSpawnCooldown = 0;
  private initialPickupsSpawned = false;
  private trainSchedule: TrainScheduleState = createInitialTrainSchedule();
  private drawbridgePhase: WorldSnapshotPayload['drawbridgePhase'] = 'closed';
  private drawbridgeOpenAmount = 0;
  private drawbridgeBlocked = false;

  private nextPickupSeq = 1;
  private nextRocketSeq = 1;
  private nextHazardSeq = 1;
  private nextEventSeq = 1;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private onRoomEmpty?: (roomId: string) => void;
  private lastActivityMs: number = Date.now();

  constructor(options: {
    roomId: string;
    roomCode: string;
    isPrivate: boolean;
    hostId: string;
    aiFill: boolean;
    onRoomEmpty?: (roomId: string) => void;
  }) {
    this.roomId = options.roomId;
    this.roomCode = options.roomCode;
    this.isPrivate = options.isPrivate;
    this.hostId = options.hostId;
    this.aiFill = options.aiFill;
    this.onRoomEmpty = options.onRoomEmpty;
  }

  public get humanCount(): number {
    let count = 0;
    for (const p of this.participants.values()) {
      if (!p.isAi) count++;
    }
    return count;
  }

  public get readyHumanCount(): number {
    let count = 0;
    for (const p of this.participants.values()) {
      if (!p.isAi && p.ready && p.connected) count++;
    }
    return count;
  }

  public get canStart(): boolean {
    return this.status === 'lobby' && this.readyHumanCount >= MIN_READY_PLAYERS_TO_START;
  }

  public isStale(nowMs = Date.now()): boolean {
    if (this.humanCount === 0) return true;
    const anyConnected = Array.from(this.participants.values()).some(
      (p) => !p.isAi && p.connected,
    );
    if (!anyConnected && nowMs - this.lastActivityMs > (RECONNECT_GRACE_SECONDS + 10) * 1000) {
      return true;
    }
    return false;
  }

  public addHumanPlayer(params: {
    id: string;
    name: string;
    verifiedUid: string | null;
    reconnectToken: string;
    customization: CarCustomization;
    send: (msg: ServerToClientMessage) => void;
  }): { ok: true } | { ok: false; code: string; message: string } {
    if (this.status === 'playing') {
      return { ok: false, code: 'MATCH_IN_PROGRESS', message: 'Match already in progress in this room.' };
    }
    if (this.humanCount >= this.maxPlayers) {
      return { ok: false, code: 'ROOM_FULL', message: 'Room is full (8/8 players).' };
    }
    if (!this.hostId || !this.participants.has(this.hostId)) {
      this.hostId = params.id;
    }
    this.lastActivityMs = Date.now();
    this.participants.set(params.id, {
      id: params.id,
      name: sanitizeDriverName(params.name),
      verifiedUid: params.verifiedUid,
      reconnectToken: params.reconnectToken,
      customization: sanitizeCustomization(params.customization),
      ready: false,
      connected: true,
      disconnectedAtMs: null,
      isAi: false,
      lastSeq: 0,
      pendingInput: { ...DEFAULT_INPUT },
      jumpBuffered: false,
      weaponTriggered: false,
      abilityTriggered: false,
      recoverTriggered: false,
      send: params.send,
    });
    this.broadcastRoomState();
    return { ok: true };
  }

  public removeHumanPlayer(playerId: string, nowMs = Date.now()): void {
    const p = this.participants.get(playerId);
    if (!p) return;

    if (this.status === 'playing') {
      p.connected = false;
      p.disconnectedAtMs = nowMs;
      p.send = null;
      p.pendingInput = { ...DEFAULT_INPUT, brake: 0.6 };
      const car = this.cars.get(playerId);
      if (car) {
        car.connected = false;
      }
      this.broadcast({
        type: 'player_connection',
        playerId: p.id,
        name: p.name,
        status: 'disconnected',
        graceSeconds: RECONNECT_GRACE_SECONDS,
      });
      return;
    }

    this.participants.delete(playerId);
    if (this.hostId === playerId) {
      const nextHost = Array.from(this.participants.values()).find((x) => !x.isAi);
      this.hostId = nextHost ? nextHost.id : '';
    }
    if (this.humanCount === 0) {
      this.stopLoop();
      this.onRoomEmpty?.(this.roomId);
      return;
    }
    this.broadcastRoomState();
  }

  public reconnectHumanPlayer(params: {
    playerId: string;
    reconnectToken: string;
    send: (msg: ServerToClientMessage) => void;
    nowMs?: number;
  }): boolean {
    const now = params.nowMs ?? Date.now();
    const p = this.participants.get(params.playerId);
    if (!p || p.isAi) return false;
    if (p.reconnectToken !== params.reconnectToken) return false;
    if (
      p.disconnectedAtMs !== null &&
      now - p.disconnectedAtMs > RECONNECT_GRACE_SECONDS * 1000
    ) {
      return false;
    }

    p.connected = true;
    p.disconnectedAtMs = null;
    p.send = params.send;
    this.lastActivityMs = now;

    const car = this.cars.get(p.id);
    if (car) {
      car.connected = true;
    }

    if (this.status === 'playing') {
      p.send({
        type: 'match_start',
        roomCode: this.roomCode,
        matchId: this.matchId,
        durationSeconds: SURVIVAL_TARGET_DURATION_SEC,
        startingCountdown: Math.ceil(this.startingCountdown),
        players: Array.from(this.cars.values()).map((c) => ({
          id: c.id,
          name: c.name,
          isAi: c.isAi,
          customization: c.customization,
        })),
      });
      p.send({
        type: 'world_snapshot',
        snapshot: this.buildWorldSnapshot(),
      });
    } else {
      this.broadcastRoomState();
    }

    this.broadcast({
      type: 'player_connection',
      playerId: p.id,
      name: p.name,
      status: 'reconnected',
    });
    return true;
  }

  public setReady(playerId: string, ready: boolean): void {
    if (this.status !== 'lobby') return;
    const p = this.participants.get(playerId);
    if (!p || p.isAi) return;
    p.ready = ready;
    this.lastActivityMs = Date.now();
    this.broadcastRoomState();
  }

  public setAiFill(playerId: string, aiFill: boolean): void {
    if (this.status !== 'lobby' || playerId !== this.hostId) return;
    this.aiFill = aiFill;
    this.lastActivityMs = Date.now();
    this.broadcastRoomState();
  }

  public updateLoadout(playerId: string, customization: CarCustomization): void {
    if (this.status !== 'lobby') return;
    const p = this.participants.get(playerId);
    if (!p || p.isAi) return;
    p.customization = sanitizeCustomization(customization);
    this.lastActivityMs = Date.now();
    this.broadcastRoomState();
  }

  public handlePlayerInput(
    playerId: string,
    seq: number,
    rawInput: unknown,
  ): void {
    if (this.status !== 'playing') return;
    const p = this.participants.get(playerId);
    if (!p || p.isAi || !p.connected) return;
    if (!Number.isFinite(seq) || seq <= p.lastSeq) return;

    const clean = sanitizeNetInput(rawInput);
    p.lastSeq = seq;
    p.pendingInput = clean;
    if (clean.jump) p.jumpBuffered = true;
    if (clean.useWeapon) p.weaponTriggered = true;
    if (clean.useAbility) p.abilityTriggered = true;
    if (clean.recover) p.recoverTriggered = true;
    this.lastActivityMs = Date.now();
  }

  public startMatch(
    requesterId?: string,
    options?: { skipLoop?: boolean },
  ): { ok: true } | { ok: false; code: string; message: string } {
    if (this.status !== 'lobby') {
      return { ok: false, code: 'INVALID_STATE', message: 'Room is not in lobby state.' };
    }
    if (requesterId && requesterId !== this.hostId) {
      return { ok: false, code: 'NOT_HOST', message: 'Only the room host can start the match.' };
    }
    if (this.readyHumanCount < MIN_READY_PLAYERS_TO_START) {
      return {
        ok: false,
        code: 'NOT_ENOUGH_READY',
        message: 'At least 2 human players must mark Ready to start.',
      };
    }

    this.cars.clear();
    this.pickups = [];
    this.rockets = [];
    this.hazards = [];
    this.impactCooldowns.clear();
    this.boundaryTimers.clear();
    this.tickCounter = 0;
    this.matchId = `match_${Date.now().toString(36)}_${this.roomCode}`;
    this.startingCountdown = START_COUNTDOWN_SEC;
    this.matchElapsedSeconds = 0;
    this.countdownRemaining = SURVIVAL_TARGET_DURATION_SEC;
    this.pickupSpawnCooldown = 0;
    this.initialPickupsSpawned = false;
    this.trainSchedule = createInitialTrainSchedule();
    this.drawbridgePhase = 'closed';
    this.drawbridgeOpenAmount = 0;
    this.drawbridgeBlocked = false;

    const humanList = Array.from(this.participants.values()).filter((p) => !p.isAi);
    let spawnIdx = 0;

    for (const h of humanList) {
      const sp = PLAYER_SPAWN_POINTS[spawnIdx % PLAYER_SPAWN_POINTS.length];
      spawnIdx++;
      h.lastSeq = 0;
      h.pendingInput = { ...DEFAULT_INPUT };
      h.jumpBuffered = false;
      h.weaponTriggered = false;
      h.abilityTriggered = false;
      h.recoverTriggered = false;
      this.cars.set(
        h.id,
        this.createSimCar(h.id, h.name, false, h.connected, h.customization, sp, spawnIdx),
      );
    }

    if (this.aiFill) {
      const targetTotal = Math.min(MAX_ROOM_PLAYERS, Math.max(4, humanList.length + 2));
      let aiIdx = 0;
      while (this.cars.size < targetTotal && aiIdx < AI_ROSTER.length) {
        const bot = AI_ROSTER[aiIdx];
        const botId = `ai_${aiIdx}`;
        const sp = PLAYER_SPAWN_POINTS[spawnIdx % PLAYER_SPAWN_POINTS.length];
        spawnIdx++;
        aiIdx++;
        const spec = VEHICLE_CONFIGS[bot.vehicleId];
        this.cars.set(
          botId,
          this.createSimCar(
            botId,
            bot.name,
            true,
            true,
            {
              vehicleId: bot.vehicleId,
              bodyColor: bot.color,
              accentColor: bot.accent,
              rimColor: spec.defaultRimColor,
            },
            sp,
            aiIdx,
          ),
        );
      }
    }

    this.status = 'playing';
    this.broadcast({
      type: 'match_start',
      roomCode: this.roomCode,
      matchId: this.matchId,
      durationSeconds: SURVIVAL_TARGET_DURATION_SEC,
      startingCountdown: START_COUNTDOWN_SEC,
      players: Array.from(this.cars.values()).map((c) => ({
        id: c.id,
        name: c.name,
        isAi: c.isAi,
        customization: c.customization,
      })),
    });

    this.broadcast({
      type: 'world_snapshot',
      snapshot: this.buildWorldSnapshot(),
    });

    if (!options?.skipLoop) {
      this.startLoop();
    }
    return { ok: true };
  }

  private createSimCar(
    id: string,
    name: string,
    isAi: boolean,
    connected: boolean,
    customization: CarCustomization,
    sp: (typeof PLAYER_SPAWN_POINTS)[number],
    aiSeed: number,
  ): SimCar {
    return {
      id,
      name,
      isAi,
      connected,
      customization: { ...customization },
      x: sp.x,
      y: sp.y,
      z: sp.z,
      yaw: sp.yaw,
      vx: 0,
      vy: 0,
      vz: 0,
      forwardSpeed: 0,
      lateralSpeed: 0,
      speedKmh: 0,
      hp: MAX_PLAYER_HP,
      maxHp: MAX_PLAYER_HP,
      alive: true,
      nitro: 100,
      nitroActive: false,
      driftState: {
        isDrifting: false,
        driftCharge: 0,
        driftBoostRemaining: 0,
        driftMultiplier: 1,
        driftScore: 0,
        wasDriftHeld: false,
      },
      slipRatio: 0,
      wheelSteerAngle: 0,
      isGrounded: true,
      coyoteTimer: 0.1,
      jumpCooldown: 0,
      tripleJumpAirUsed: 0,
      tripleJumpCooldown: 0,
      equippedWeapon: null,
      equippedAbility: null,
      weaponCooldown: 0,
      abilityCooldown: 0,
      shieldTimer: 0,
      armorTimer: 0,
      nitroAbilityTimer: 0,
      dashTimer: 0,
      slowTimer: 0,
      spawnProtectionTimer: SPAWN_PROTECTION_SEC,
      eliminations: 0,
      damageTaken: 0,
      score: 0,
      lastAttackerId: null,
      lastSafePos: { x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw },
      aiWaypointIdx: aiSeed % AI_PATROL_LOOP.length,
      aiThinkTimer: 0,
    };
  }

  public startLoop(): void {
    if (this.timerHandle) return;
    this.timerHandle = setInterval(() => {
      this.stepTick(SERVER_TICK_DT, Date.now());
    }, Math.round(SERVER_TICK_DT * 1000));
  }

  public stopLoop(): void {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  public getRoomLobbySnapshot(): RoomLobbySnapshot {
    const players: LobbyPlayerInfo[] = Array.from(this.participants.values()).map((p) => ({
      id: p.id,
      name: p.name,
      vehicleId: p.customization.vehicleId,
      bodyColor: p.customization.bodyColor,
      accentColor: p.customization.accentColor,
      rimColor: p.customization.rimColor,
      ready: p.ready,
      connected: p.connected,
      isHost: p.id === this.hostId,
      isAi: p.isAi,
      verifiedUid: p.verifiedUid,
    }));

    return {
      roomId: this.roomId,
      roomCode: this.roomCode,
      isPrivate: this.isPrivate,
      hostId: this.hostId,
      status: this.status,
      aiFill: this.aiFill,
      maxPlayers: this.maxPlayers,
      humanCount: this.humanCount,
      readyHumanCount: this.readyHumanCount,
      canStart: this.canStart,
      players,
    };
  }

  public getCarState(carId: string): SimCar | undefined {
    return this.cars.get(carId);
  }

  public getActivePickups(): readonly SimPickup[] {
    return this.pickups;
  }

  public spawnPickupForTest(kind: PickupKind, x: number, z: number): string {
    const id = `pickup_${this.nextPickupSeq++}`;
    this.pickups.push({ id, kind, x, y: 0.15, z, ttl: PICKUP_SPAWN_CONFIG.pickupLifetimeSec });
    return id;
  }

  public stepTick(dt = SERVER_TICK_DT, nowMs = Date.now()): void {
    if (this.status !== 'playing') return;

    this.tickCounter++;

    // 1. Check 15-second disconnect timeouts
    for (const p of this.participants.values()) {
      if (
        !p.isAi &&
        !p.connected &&
        p.disconnectedAtMs !== null &&
        nowMs - p.disconnectedAtMs >= RECONNECT_GRACE_SECONDS * 1000
      ) {
        p.disconnectedAtMs = null;
        const car = this.cars.get(p.id);
        if (car && car.alive) {
          car.hp = 0;
          car.alive = false;
          this.emitEvent({
            eventId: `evt_${this.nextEventSeq++}`,
            kind: 'elimination',
            x: car.x,
            y: car.y,
            z: car.z,
            targetId: car.id,
          });
          this.broadcast({
            type: 'player_connection',
            playerId: p.id,
            name: p.name,
            status: 'eliminated',
          });
        }
      }
    }

    // 2. Starting 5-second countdown
    if (this.startingCountdown > 0) {
      this.startingCountdown = Math.max(0, this.startingCountdown - dt);
      for (const car of this.cars.values()) {
        car.spawnProtectionTimer = SPAWN_PROTECTION_SEC;
      }
      this.broadcast({
        type: 'world_snapshot',
        snapshot: this.buildWorldSnapshot(),
      });
      return;
    }

    this.matchElapsedSeconds += dt;
    this.countdownRemaining = Math.max(0, this.countdownRemaining - dt);

    for (const [k, t] of this.impactCooldowns) {
      if (t - dt <= 0) this.impactCooldowns.delete(k);
      else this.impactCooldowns.set(k, t - dt);
    }

    // 3. Drawbridge, train, safe zone
    const bridge = evaluateDrawbridgeState(this.matchElapsedSeconds);
    this.drawbridgePhase = bridge.phase;
    this.drawbridgeOpenAmount = bridge.openAmount;
    this.drawbridgeBlocked = bridge.roadBlocked;
    this.trainSchedule = stepTrainSchedule(this.trainSchedule, dt);
    const safeZone = evaluateSafeZone(this.matchElapsedSeconds);

    // 4. Step each vehicle
    const carList = Array.from(this.cars.values());
    for (const car of carList) {
      const p = this.participants.get(car.id);
      let input: NetInputPayload = DEFAULT_INPUT;
      let jumpReq = false;
      let weaponReq = false;
      let abilityReq = false;
      let recoverReq = false;

      if (car.isAi) {
        const aiOut = this.computeAiInput(car, carList, safeZone.radiusMeters, dt);
        input = aiOut.input;
        jumpReq = aiOut.input.jump;
        weaponReq = aiOut.input.useWeapon;
        abilityReq = aiOut.input.useAbility;
      } else if (p && p.connected) {
        input = p.pendingInput;
        jumpReq = p.jumpBuffered;
        weaponReq = p.weaponTriggered;
        abilityReq = p.abilityTriggered;
        recoverReq = p.recoverTriggered;
        p.jumpBuffered = false;
        p.weaponTriggered = false;
        p.abilityTriggered = false;
        p.recoverTriggered = false;
      } else {
        input = { ...DEFAULT_INPUT, brake: 0.7 };
      }

      this.stepCarPhysics(car, input, jumpReq, recoverReq, dt);

      if (weaponReq) {
        this.activateWeapon(car, carList);
      }
      if (abilityReq) {
        this.activateAbility(car);
      }
    }

    // 5. Car-to-car collisions & train collisions
    this.resolveCarCollisions(carList);
    this.resolveTrainCollisions(carList);

    // 6. Pickups (weighted spawning & atomic single-collector pickup)
    this.stepPickups(dt, carList, safeZone.radiusMeters);

    // 7. Rockets & deployed hazards
    this.stepRockets(dt, carList);
    this.stepHazards(dt, carList);

    // 8. Safe Zone boundary damage ticks
    if (safeZone.damagePerTick > 0) {
      for (const car of carList) {
        if (!car.alive) continue;
        if (isOutsideSafeZone(car.x, car.z, safeZone.radiusMeters)) {
          const prev = this.boundaryTimers.get(car.id) ?? 0;
          const next = prev + dt;
          if (next >= safeZone.tickIntervalSec) {
            this.boundaryTimers.set(car.id, next - safeZone.tickIntervalSec);
            this.applyCarDamage(car, safeZone.damagePerTick, 'boundary');
          } else {
            this.boundaryTimers.set(car.id, next);
          }
        } else {
          this.boundaryTimers.set(car.id, 0);
        }
      }
    }

    // 9. Broadcast snapshot
    this.broadcast({
      type: 'world_snapshot',
      snapshot: this.buildWorldSnapshot(),
    });

    // 10. Check authoritative win / match-over condition
    const aliveCars = carList.filter((c) => c.alive);
    const connectedHumansAlive = carList.some((c) => !c.isAi && c.alive);
    const anyHumanConnected = Array.from(this.participants.values()).some(
      (p) => !p.isAi && p.connected,
    );

    if (
      aliveCars.length <= 1 ||
      (!anyHumanConnected && this.matchElapsedSeconds > 2) ||
      (this.countdownRemaining <= 0 && !connectedHumansAlive)
    ) {
      this.finalizeMatch(carList);
    }
  }

  private stepCarPhysics(
    car: SimCar,
    input: NetInputPayload,
    jumpReq: boolean,
    recoverReq: boolean,
    dt: number,
  ): void {
    car.weaponCooldown = Math.max(0, car.weaponCooldown - dt);
    car.abilityCooldown = Math.max(0, car.abilityCooldown - dt);
    car.shieldTimer = Math.max(0, car.shieldTimer - dt);
    car.armorTimer = Math.max(0, car.armorTimer - dt);
    car.nitroAbilityTimer = Math.max(0, car.nitroAbilityTimer - dt);
    car.dashTimer = Math.max(0, car.dashTimer - dt);
    car.slowTimer = Math.max(0, car.slowTimer - dt);
    car.spawnProtectionTimer = Math.max(0, car.spawnProtectionTimer - dt);
    car.jumpCooldown = Math.max(0, car.jumpCooldown - dt);
    car.tripleJumpCooldown = Math.max(0, car.tripleJumpCooldown - dt);

    if (car.equippedWeapon) {
      car.equippedWeapon.cooldown = Math.max(0, car.equippedWeapon.cooldown - dt);
    }
    if (car.equippedAbility) {
      car.equippedAbility.cooldown = Math.max(0, car.equippedAbility.cooldown - dt);
      if (car.equippedAbility.activeRemaining > 0) {
        car.equippedAbility.activeRemaining = Math.max(
          0,
          car.equippedAbility.activeRemaining - dt,
        );
        if (car.equippedAbility.activeRemaining <= 0 && car.equippedAbility.usesRemaining <= 0) {
          car.equippedAbility = null;
        }
      }
    }

    if (!car.alive) {
      car.vx *= Math.max(0, 1 - 4 * dt);
      car.vz *= Math.max(0, 1 - 4 * dt);
      car.speedKmh = mpsToKmh(Math.hypot(car.vx, car.vz));
      return;
    }

    if (recoverReq) {
      car.x = car.lastSafePos.x;
      car.y = car.lastSafePos.y + 0.3;
      car.z = car.lastSafePos.z;
      car.yaw = car.lastSafePos.yaw;
      car.vx = 0;
      car.vy = 0;
      car.vz = 0;
    }

    const spec = VEHICLE_CONFIGS[car.customization.vehicleId];
    const floorY = getTerrainFloorHeight(car.x, car.z);
    car.isGrounded = car.y <= floorY + 0.08 && car.vy <= 0.6;
    if (car.isGrounded) {
      car.coyoteTimer = 0.1;
      car.tripleJumpAirUsed = 0;
    } else {
      car.coyoteTimer = Math.max(0, car.coyoteTimer - dt);
    }

    const fx = -Math.sin(car.yaw);
    const fz = -Math.cos(car.yaw);
    const rx = Math.cos(car.yaw);
    const rz = -Math.sin(car.yaw);

    car.forwardSpeed = car.vx * fx + car.vz * fz;
    car.lateralSpeed = car.vx * rx + car.vz * rz;
    const isOffroad = car.isGrounded && car.y < 0.45 && !isOnAsphaltRoad(car.x, car.z);

    if (car.isGrounded && !isOffroad && car.y >= -0.2) {
      car.lastSafePos = { x: car.x, y: car.y, z: car.z, yaw: car.yaw };
    }

    const wantsNitro = input.nitro && car.nitro > 1 && input.throttle > 0;
    if (wantsNitro) {
      car.nitroActive = true;
      car.nitro = Math.max(0, car.nitro - 25 * dt);
    } else {
      car.nitroActive = false;
      car.nitro = Math.min(100, car.nitro + 5 * dt);
    }

    if (jumpReq && car.coyoteTimer > 0 && car.jumpCooldown <= 0) {
      car.vy = spec.jumpImpulse;
      car.coyoteTimer = 0;
      car.jumpCooldown = 0.65;
      car.isGrounded = false;
      this.emitEvent({
        eventId: `evt_${this.nextEventSeq++}`,
        kind: 'jump',
        x: car.x,
        y: car.y,
        z: car.z,
        sourceId: car.id,
      });
    }

    const kin = computeVehicleKinematics({
      forwardSpeed: car.forwardSpeed,
      lateralSpeed: car.lateralSpeed,
      throttle: input.throttle,
      brake: input.brake,
      steerInput: input.steer,
      isDrifting: input.drift,
      isNitroActive: car.nitroActive,
      driftBoostActive: car.driftState.driftBoostRemaining > 0,
      abilityNitroActive: car.nitroAbilityTimer > 0,
      dashActive: car.dashTimer > 0,
      slowActive: car.slowTimer > 0,
      isGrounded: car.isGrounded,
      isOffroad,
      vehicleId: car.customization.vehicleId,
      dt,
    });

    car.slipRatio = kin.slipRatio;
    car.wheelSteerAngle = kin.wheelSteerAngle;

    const nextForward = car.forwardSpeed + kin.forwardAccel * dt;
    const nextLateral = car.lateralSpeed + kin.lateralGripDecel * dt;
    car.vx = fx * nextForward + rx * nextLateral;
    car.vz = fz * nextForward + rz * nextLateral;
    car.yaw = wrapAngle(car.yaw + kin.yawRate * dt);

    if (!car.isGrounded || car.vy > 0) {
      car.vy -= 18 * dt;
    }

    car.x += car.vx * dt;
    car.y += car.vy * dt;
    car.z += car.vz * dt;

    const newFloorY = getTerrainFloorHeight(car.x, car.z);
    if (car.y <= newFloorY) {
      car.y = newFloorY;
      car.vy = 0;
      car.isGrounded = true;
    }

    // Drift charge & boost
    const driftRes = updateDriftState(
      car.driftState,
      nextForward,
      nextLateral,
      input.steer,
      input.drift,
      car.isGrounded,
      dt,
    );
    car.driftState = driftRes.next;
    if (driftRes.nitroEarned > 0) {
      car.nitro = Math.min(100, car.nitro + driftRes.nitroEarned);
    }
    if (driftRes.boostTriggered) {
      this.emitEvent({
        eventId: `evt_${this.nextEventSeq++}`,
        kind: 'boost',
        x: car.x,
        y: car.y,
        z: car.z,
        sourceId: car.id,
      });
    }

    // World arena bounds ±296
    const maxBound = 295.5;
    if (Math.abs(car.x) > maxBound) {
      const impact = Math.abs(car.vx);
      car.x = Math.sign(car.x) * maxBound;
      car.vx *= -0.4;
      this.applyWallDamage(car, 'world_bound_ew', impact);
    }
    if (Math.abs(car.z) > maxBound) {
      const impact = Math.abs(car.vz);
      car.z = Math.sign(car.z) * maxBound;
      car.vz *= -0.4;
      this.applyWallDamage(car, 'world_bound_ns', impact);
    }

    // Drawbridge open road blockers
    if (this.drawbridgeBlocked && Math.abs(car.z) <= 10 && car.y < 3) {
      if (car.x > 130.5 && car.x < 165) {
        car.x = 130.5;
        car.vx = Math.min(0, car.vx * -0.35);
      } else if (car.x >= 165 && car.x < 199.5) {
        car.x = 199.5;
        car.vx = Math.max(0, car.vx * -0.35);
      }
    }

    // Static building/rock AABB collisions
    const carRadius = 1.6;
    for (const obs of STATIC_ARENA_OBSTACLES) {
      if (car.y > obs.maxY + 0.5) continue;
      const ex = obs.halfW + carRadius;
      const ez = obs.halfD + carRadius;
      const dx = car.x - obs.x;
      const dz = car.z - obs.z;
      if (Math.abs(dx) < ex && Math.abs(dz) < ez) {
        const penX = ex - Math.abs(dx);
        const penZ = ez - Math.abs(dz);
        const speed = Math.hypot(car.vx, car.vz);
        if (penX < penZ) {
          car.x += dx >= 0 ? penX : -penX;
          car.vx *= -0.35;
        } else {
          car.z += dz >= 0 ? penZ : -penZ;
          car.vz *= -0.35;
        }
        this.applyWallDamage(car, obs.id, speed);
      }
    }

    car.speedKmh = mpsToKmh(Math.hypot(car.vx, car.vz));
  }

  private applyWallDamage(car: SimCar, wallId: string, speedMps: number): void {
    const key = `${car.id}:${wallId}`;
    if (this.impactCooldowns.has(key)) return;
    const raw = computeCollisionDamage(speedMps * 0.72, false, car.customization.vehicleId);
    if (raw > 0) {
      this.impactCooldowns.set(key, 0.75);
      this.applyCarDamage(car, raw, 'collision');
    }
  }

  private resolveCarCollisions(carList: SimCar[]): void {
    const minDist = 2.85;
    for (let i = 0; i < carList.length; i++) {
      const a = carList[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < carList.length; j++) {
        const b = carList[j];
        if (!b.alive) continue;
        if (Math.abs(a.y - b.y) > 2.2) continue;

        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        if (dist >= minDist) continue;

        const nx = dist > 0.01 ? dx / dist : 1;
        const nz = dist > 0.01 ? dz / dist : 0;
        const overlap = (minDist - dist) * 0.5 + 0.02;

        a.x -= nx * overlap;
        a.z -= nz * overlap;
        b.x += nx * overlap;
        b.z += nz * overlap;

        const relSpeed = Math.hypot(a.vx - b.vx, a.vz - b.vz);
        const pairKey = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
        if (!this.impactCooldowns.has(pairKey)) {
          const ramA = VEHICLE_CONFIGS[a.customization.vehicleId].ramMultiplier;
          const ramB = VEHICLE_CONFIGS[b.customization.vehicleId].ramMultiplier;
          const rawA = computeCollisionDamage(relSpeed, false, a.customization.vehicleId, ramB);
          const rawB = computeCollisionDamage(relSpeed, false, b.customization.vehicleId, ramA);
          if (rawA > 0 || rawB > 0) {
            this.impactCooldowns.set(pairKey, COLLISION_PAIR_COOLDOWN_SEC);
            const dealtA = this.applyCarDamage(a, rawA, 'collision', b.id);
            const dealtB = this.applyCarDamage(b, rawB, 'collision', a.id);
            if (dealtB > 0) a.score += dealtB * 5;
            if (dealtA > 0) b.score += dealtA * 5;
            this.emitEvent({
              eventId: `evt_${this.nextEventSeq++}`,
              kind: 'collision',
              x: (a.x + b.x) * 0.5,
              y: Math.max(a.y, b.y) + 0.8,
              z: (a.z + b.z) * 0.5,
              color: '#facc15',
            });
          }
        }

        // Elastic velocity impulse exchange
        const rvx = b.vx - a.vx;
        const rvz = b.vz - a.vz;
        const velAlongNormal = rvx * nx + rvz * nz;
        if (velAlongNormal < 0) {
          const impulse = -0.65 * velAlongNormal;
          a.vx -= impulse * nx;
          a.vz -= impulse * nz;
          b.vx += impulse * nx;
          b.vz += impulse * nz;
        }
      }
    }
  }

  private resolveTrainCollisions(carList: SimCar[]): void {
    if (!this.trainSchedule.trainActive) return;
    for (const car of carList) {
      if (!car.alive) continue;
      if (
        Math.abs(car.x - 195) <= 3.3 &&
        Math.abs(car.z - this.trainSchedule.trainZ) <= 26 &&
        car.y < 4.5
      ) {
        const key = `${car.id}:freight_train`;
        if (this.impactCooldowns.has(key)) continue;
        this.impactCooldowns.set(key, COLLISION_PAIR_COOLDOWN_SEC);
        const pushDir = car.x >= 195 ? 1 : -1;
        car.vx = pushDir * 24;
        car.vy = 6.5;
        car.vz = -12;
        this.applyCarDamage(car, 35, 'train');
        this.emitEvent({
          eventId: `evt_${this.nextEventSeq++}`,
          kind: 'explosion',
          x: car.x,
          y: car.y + 1,
          z: car.z,
          color: '#fb923c',
        });
      }
    }
  }

  private stepPickups(dt: number, carList: SimCar[], safeZoneRadiusMeters: number): void {
    const canSpawn = this.matchElapsedSeconds >= PICKUP_START_DELAY_SEC;
    if (canSpawn) {
      if (!this.initialPickupsSpawned) {
        this.initialPickupsSpawned = true;
        for (let i = 0; i < PICKUP_SPAWN_CONFIG.minActive; i++) {
          this.trySpawnPickup(carList, safeZoneRadiusMeters);
        }
        this.pickupSpawnCooldown =
          PICKUP_SPAWN_CONFIG.minSpawnIntervalSec +
          Math.random() *
            (PICKUP_SPAWN_CONFIG.maxSpawnIntervalSec -
              PICKUP_SPAWN_CONFIG.minSpawnIntervalSec);
      } else {
        this.pickupSpawnCooldown -= dt;
        if (this.pickups.length < PICKUP_SPAWN_CONFIG.minActive) {
          this.trySpawnPickup(carList, safeZoneRadiusMeters);
        } else if (
          this.pickupSpawnCooldown <= 0 &&
          this.pickups.length < PICKUP_SPAWN_CONFIG.maxActive
        ) {
          this.trySpawnPickup(carList, safeZoneRadiusMeters);
          this.pickupSpawnCooldown =
            PICKUP_SPAWN_CONFIG.minSpawnIntervalSec +
            Math.random() *
              (PICKUP_SPAWN_CONFIG.maxSpawnIntervalSec -
                PICKUP_SPAWN_CONFIG.minSpawnIntervalSec);
        }
      }
    }

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pu = this.pickups[i];
      pu.ttl -= dt;
      if (pu.ttl <= 0) {
        this.pickups.splice(i, 1);
        continue;
      }

      // Atomic first-collector claim prevents double collection
      for (const car of carList) {
        if (!car.alive) continue;
        const dx = car.x - pu.x;
        const dy = car.y - pu.y;
        const dz = car.z - pu.z;
        if (
          dx * dx + dz * dz <=
            PICKUP_SPAWN_CONFIG.collectDistanceMeters *
              PICKUP_SPAWN_CONFIG.collectDistanceMeters &&
          Math.abs(dy) < 2.8
        ) {
          if (isWeaponPickup(pu.kind)) {
            car.equippedWeapon = createEquippedWeapon(pu.kind);
          } else {
            car.equippedAbility = createEquippedAbility(pu.kind);
          }
          car.score += 100;
          this.emitEvent({
            eventId: `evt_${this.nextEventSeq++}`,
            kind: 'pickup_collected',
            x: pu.x,
            y: pu.y,
            z: pu.z,
            sourceId: car.id,
            pickupKind: pu.kind,
          });
          this.pickups.splice(i, 1);
          break;
        }
      }
    }
  }

  private trySpawnPickup(carList: SimCar[], safeZoneRadiusMeters: number): boolean {
    if (this.pickups.length >= PICKUP_SPAWN_CONFIG.maxActive) return false;
    const playerPositions = carList
      .filter((c) => c.alive)
      .map((c) => ({ x: c.x, z: c.z }));
    const indices = PICKUP_CANDIDATE_ZONES.map((_, idx) => idx);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = indices[i];
      indices[i] = indices[j];
      indices[j] = t;
    }

    for (const idx of indices) {
      const z = PICKUP_CANDIDATE_ZONES[idx];
      const onOpenBridge =
        this.drawbridgeOpenAmount > 0.1 &&
        z.x >= 130 &&
        z.x <= 200 &&
        Math.abs(z.z) <= 18;
      if (
        !isPickupSpawnValid({
          x: z.x,
          z: z.z,
          existingPickups: this.pickups,
          playerPositions,
          safeZoneRadiusMeters,
          isAccessible: !onOpenBridge,
        })
      ) {
        continue;
      }
      const kind = pickWeightedPickupKind();
      this.pickups.push({
        id: `pickup_${this.nextPickupSeq++}`,
        kind,
        x: z.x,
        y: z.y,
        z: z.z,
        ttl: PICKUP_SPAWN_CONFIG.pickupLifetimeSec,
      });
      return true;
    }
    return false;
  }

  public activateWeapon(car: SimCar, allCars: SimCar[]): boolean {
    const weapon = car.equippedWeapon;
    if (!car.alive || !weapon || weapon.usesRemaining <= 0 || weapon.cooldown > 0) {
      return false;
    }

    const spec = WEAPON_SPECS[weapon.kind];
    weapon.usesRemaining -= 1;
    weapon.cooldown = spec.cooldown;
    car.weaponCooldown = spec.cooldown;

    const fx = -Math.sin(car.yaw);
    const fz = -Math.cos(car.yaw);

    if (weapon.kind === 'rocket') {
      let dirX = fx;
      let dirZ = fz;
      let bestDot = 0.65;
      for (const other of allCars) {
        if (!other.alive || other.id === car.id) continue;
        const dx = other.x - car.x;
        const dz = other.z - car.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 2 && dist <= spec.range) {
          const nx = dx / dist;
          const nz = dz / dist;
          const dot = nx * fx + nz * fz;
          if (dot > bestDot) {
            bestDot = dot;
            dirX = nx;
            dirZ = nz;
          }
        }
      }
      this.rockets.push({
        id: `rk_${this.nextRocketSeq++}`,
        ownerId: car.id,
        x: car.x + dirX * 2.8,
        y: car.y + 0.85,
        z: car.z + dirZ * 2.8,
        vx: dirX * spec.speed,
        vz: dirZ * spec.speed,
        yaw: Math.atan2(-dirX, -dirZ),
        distanceTraveled: 0,
        maxRange: spec.range,
        damage: spec.damage,
        blastRadius: spec.radius,
      });
    } else if (weapon.kind === 'punch') {
      const hitX = car.x + fx * 2.7;
      const hitZ = car.z + fz * 2.7;
      for (const other of allCars) {
        if (!other.alive || other.id === car.id) continue;
        const d = Math.hypot(other.x - hitX, other.z - hitZ);
        if (d <= spec.range + 1.6 && Math.abs(other.y - car.y) < 3.5) {
          const dealt = this.applyCarDamage(other, spec.damage, 'weapon', car.id);
          other.vx += fx * 20;
          other.vy += 4.8;
          other.vz += fz * 20;
          if (dealt > 0) car.score += dealt * 5;
        }
      }
    } else {
      this.hazards.push({
        id: `haz_${this.nextHazardSeq++}`,
        kind: weapon.kind,
        ownerId: car.id,
        x: car.x - fx * 3.1,
        y: Math.max(0.05, car.y),
        z: car.z - fz * 3.1,
        ttl: weapon.kind === 'bomb' ? spec.detonationDelay : spec.lifetime,
        armTimer: weapon.kind === 'bomb' ? spec.detonationDelay : 0.75,
        radius: spec.radius,
        damage: spec.damage,
      });
    }

    this.emitEvent({
      eventId: `evt_${this.nextEventSeq++}`,
      kind: 'weapon_fired',
      x: car.x,
      y: car.y + 0.8,
      z: car.z,
      color: spec.color,
      sourceId: car.id,
      weaponKind: weapon.kind,
    });

    if (weapon.usesRemaining <= 0) {
      car.equippedWeapon = null;
    }
    return true;
  }

  public activateAbility(car: SimCar): boolean {
    const ability = car.equippedAbility;
    if (!car.alive || !ability || ability.usesRemaining <= 0 || ability.cooldown > 0) {
      return false;
    }
    const spec = ABILITY_SPECS[ability.kind];
    let ok = false;

    if (ability.kind === 'shield') {
      car.shieldTimer = spec.duration;
      ability.activeRemaining = spec.duration;
      ok = true;
    } else if (ability.kind === 'armor') {
      car.armorTimer = spec.duration;
      ability.activeRemaining = spec.duration;
      ok = true;
    } else if (ability.kind === 'nitro') {
      car.nitroAbilityTimer = spec.duration;
      car.nitro = 100;
      ability.activeRemaining = spec.duration;
      ok = true;
    } else if (ability.kind === 'super_jump') {
      car.vy = jumpVelocityForHeight(8, 18);
      car.coyoteTimer = 0;
      car.isGrounded = false;
      ok = true;
    } else if (ability.kind === 'triple_jump') {
      const canUse = car.isGrounded || car.coyoteTimer > 0 || car.tripleJumpAirUsed < 1;
      if (canUse && car.tripleJumpCooldown <= 0) {
        car.vy = jumpVelocityForHeight(5, 18);
        if (!car.isGrounded && car.coyoteTimer <= 0) car.tripleJumpAirUsed += 1;
        else car.tripleJumpAirUsed = 0;
        car.coyoteTimer = 0;
        car.isGrounded = false;
        car.tripleJumpCooldown = 0.7;
        ability.cooldown = spec.cooldown;
        car.abilityCooldown = spec.cooldown;
        ok = true;
      }
    } else if (ability.kind === 'lightning_dash') {
      car.dashTimer = spec.duration;
      ability.activeRemaining = spec.duration;
      const fx = -Math.sin(car.yaw);
      const fz = -Math.cos(car.yaw);
      const dashSpeed = Math.max(
        car.forwardSpeed + 18,
        (VEHICLE_CONFIGS[car.customization.vehicleId].maxSpeedKmh / 3.6) * 1.45,
      );
      car.vx = fx * dashSpeed;
      car.vz = fz * dashSpeed;
      car.vy = Math.max(car.vy, 0.8);
      ok = true;
    }

    if (!ok) return false;
    ability.usesRemaining -= 1;
    this.emitEvent({
      eventId: `evt_${this.nextEventSeq++}`,
      kind: 'ability_used',
      x: car.x,
      y: car.y + 0.8,
      z: car.z,
      color: spec.color,
      sourceId: car.id,
      abilityKind: ability.kind,
    });
    if (ability.usesRemaining <= 0 && ability.activeRemaining <= 0) {
      car.equippedAbility = null;
    }
    return true;
  }

  private stepRockets(dt: number, carList: SimCar[]): void {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const rk = this.rockets[i];
      const stepX = rk.vx * dt;
      const stepZ = rk.vz * dt;
      rk.x += stepX;
      rk.z += stepZ;
      rk.distanceTraveled += Math.hypot(stepX, stepZ);

      let detonate =
        rk.distanceTraveled >= rk.maxRange ||
        Math.abs(rk.x) > 298 ||
        Math.abs(rk.z) > 298;

      if (!detonate) {
        for (const car of carList) {
          if (!car.alive || car.id === rk.ownerId) continue;
          const dx = car.x - rk.x;
          const dz = car.z - rk.z;
          if (dx * dx + dz * dz < 2.35 * 2.35 && Math.abs(car.y - rk.y) < 2.8) {
            detonate = true;
            break;
          }
        }
      }

      if (detonate) {
        this.rockets.splice(i, 1);
        this.detonateAoE(
          rk.x,
          rk.y,
          rk.z,
          rk.blastRadius,
          rk.damage,
          rk.ownerId,
          carList.filter((c) => c.id !== rk.ownerId),
          15,
        );
      }
    }
  }

  private stepHazards(dt: number, carList: SimCar[]): void {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const haz = this.hazards[i];
      haz.ttl -= dt;
      haz.armTimer = Math.max(0, haz.armTimer - dt);

      if (haz.kind === 'bomb') {
        if (haz.ttl <= 0) {
          this.hazards.splice(i, 1);
          this.detonateAoE(
            haz.x,
            haz.y,
            haz.z,
            haz.radius,
            haz.damage,
            haz.ownerId,
            carList,
            17,
          );
        }
      } else if (haz.kind === 'proximity_mine') {
        if (haz.ttl <= 0) {
          this.hazards.splice(i, 1);
          continue;
        }
        if (haz.armTimer <= 0) {
          const hit = carList.some(
            (c) =>
              c.alive &&
              c.id !== haz.ownerId &&
              Math.hypot(c.x - haz.x, c.z - haz.z) <= haz.radius &&
              Math.abs(c.y - haz.y) < 3.0,
          );
          if (hit) {
            this.hazards.splice(i, 1);
            this.detonateAoE(
              haz.x,
              haz.y,
              haz.z,
              haz.radius,
              haz.damage,
              haz.ownerId,
              carList.filter((c) => c.id !== haz.ownerId),
              14,
            );
          }
        }
      } else if (haz.kind === 'spike_trap') {
        if (haz.ttl <= 0) {
          this.hazards.splice(i, 1);
          continue;
        }
        if (haz.armTimer <= 0) {
          for (const c of carList) {
            if (!c.alive || c.id === haz.ownerId) continue;
            if (Math.hypot(c.x - haz.x, c.z - haz.z) <= haz.radius && Math.abs(c.y - haz.y) < 2.2) {
              const dealt = this.applyCarDamage(c, haz.damage, 'weapon', haz.ownerId);
              if (dealt > 0 || c.shieldTimer > 0) {
                c.slowTimer = 2.0;
                const owner = this.cars.get(haz.ownerId);
                if (owner && dealt > 0) owner.score += dealt * 5;
              }
              this.hazards.splice(i, 1);
              break;
            }
          }
        }
      }
    }
  }

  private detonateAoE(
    x: number,
    y: number,
    z: number,
    radius: number,
    rawDamage: number,
    ownerId: string,
    targets: SimCar[],
    knockbackSpeed: number,
  ): void {
    this.emitEvent({
      eventId: `evt_${this.nextEventSeq++}`,
      kind: 'explosion',
      x,
      y,
      z,
      color: '#fb923c',
      sourceId: ownerId,
    });
    const owner = this.cars.get(ownerId);
    for (const target of targets) {
      if (!target.alive) continue;
      const dx = target.x - x;
      const dy = target.y - y;
      const dz = target.z - z;
      const dist = Math.hypot(dx, dz);
      if (dist <= radius && Math.abs(dy) < 4.5) {
        const dealt = this.applyCarDamage(target, rawDamage, 'weapon', ownerId);
        if (dealt > 0 || target.shieldTimer > 0) {
          const inv = 1 / Math.max(0.2, dist);
          target.vx += (dist > 0.1 ? dx * inv : 0) * knockbackSpeed;
          target.vy += 4.5;
          target.vz += (dist > 0.1 ? dz * inv : 1) * knockbackSpeed;
          if (owner && dealt > 0) owner.score += dealt * 5;
        }
      }
    }
  }

  private applyCarDamage(
    target: SimCar,
    rawDamage: number,
    source: 'weapon' | 'collision' | 'train' | 'boundary',
    attackerId?: string,
  ): number {
    if (!target.alive || rawDamage <= 0) return 0;
    const effective = calculateEffectiveDamage({
      rawDamage,
      source,
      spawnProtected: target.spawnProtectionTimer > 0,
      shieldActive: target.shieldTimer > 0,
      armorActive: target.armorTimer > 0,
      dashActive: target.dashTimer > 0,
    });
    if (effective <= 0) return 0;

    const res = applyHealthChange(target.hp, -effective, target.maxHp);
    target.hp = res.nextHp;
    target.damageTaken += effective;
    if (attackerId && attackerId !== target.id) {
      target.lastAttackerId = attackerId;
    }

    this.emitEvent({
      eventId: `evt_${this.nextEventSeq++}`,
      kind: 'damage',
      x: target.x,
      y: target.y + 0.8,
      z: target.z,
      sourceId: attackerId,
      targetId: target.id,
      amount: effective,
    });

    if (res.eliminated) {
      target.alive = false;
      if (target.lastAttackerId) {
        const attacker = this.cars.get(target.lastAttackerId);
        if (attacker) {
          attacker.eliminations += 1;
          attacker.score += 650;
        }
      }
      this.emitEvent({
        eventId: `evt_${this.nextEventSeq++}`,
        kind: 'elimination',
        x: target.x,
        y: target.y + 0.8,
        z: target.z,
        sourceId: target.lastAttackerId ?? undefined,
        targetId: target.id,
      });
    }
    return effective;
  }

  private computeAiInput(
    car: SimCar,
    allCars: SimCar[],
    safeZoneRadius: number,
    dt: number,
  ): { input: NetInputPayload } {
    car.aiThinkTimer -= dt;
    const distFromCenter = Math.hypot(car.x, car.z);
    let targetX = AI_PATROL_LOOP[car.aiWaypointIdx].x;
    let targetZ = AI_PATROL_LOOP[car.aiWaypointIdx].z;

    if (distFromCenter > safeZoneRadius - 18) {
      targetX = 0;
      targetZ = 0;
    } else if (car.hp < 50 && this.pickups.length > 0) {
      const pu = this.pickups[0];
      targetX = pu.x;
      targetZ = pu.z;
    } else {
      const nearestEnemy = allCars
        .filter((o) => o.alive && o.id !== car.id)
        .sort(
          (a, b) =>
            Math.hypot(a.x - car.x, a.z - car.z) - Math.hypot(b.x - car.x, b.z - car.z),
        )[0];
      if (nearestEnemy) {
        targetX = nearestEnemy.x;
        targetZ = nearestEnemy.z;
      }
      if (Math.hypot(targetX - car.x, targetZ - car.z) < 16) {
        car.aiWaypointIdx = (car.aiWaypointIdx + 1) % AI_PATROL_LOOP.length;
      }
    }

    const fx = -Math.sin(car.yaw);
    const fz = -Math.cos(car.yaw);
    const dx = targetX - car.x;
    const dz = targetZ - car.z;
    const dist = Math.hypot(dx, dz) || 1;
    const desiredYaw = Math.atan2(-dx, -dz);
    const yawDiff = wrapAngle(desiredYaw - car.yaw);
    const steer = Math.max(-1, Math.min(1, yawDiff * 1.4));
    const useWeapon = Boolean(
      car.equippedWeapon &&
        car.equippedWeapon.cooldown <= 0 &&
        dist < 32 &&
        (dx * fx + dz * fz) / dist > 0.72,
    );
    const useAbility = Boolean(
      car.equippedAbility &&
        car.equippedAbility.cooldown <= 0 &&
        (car.hp < 65 || dist < 16),
    );

    return {
      input: {
        throttle: 0.85,
        brake: Math.abs(yawDiff) > 2.2 ? 0.4 : 0,
        steer,
        drift: Math.abs(yawDiff) > 0.7 && car.speedKmh > 45,
        nitro: Math.abs(yawDiff) < 0.25 && car.nitro > 35,
        jump: false,
        useWeapon,
        useAbility,
        recover: false,
      },
    };
  }

  private finalizeMatch(carList: SimCar[]): void {
    this.status = 'finished';
    this.stopLoop();

    const sorted = [...carList].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (b.hp !== a.hp) return b.hp - a.hp;
      if (b.eliminations !== a.eliminations) return b.eliminations - a.eliminations;
      return b.score - a.score;
    });

    const winnerCar = sorted[0];
    const winnerSpec = VEHICLE_CONFIGS[winnerCar.customization.vehicleId];
    const winner: WinnerInfo = {
      id: winnerCar.id,
      name: winnerCar.name,
      vehicleName: winnerSpec.name,
      isPlayer: false,
      hpRemaining: Math.round(winnerCar.hp),
    };

    const standings: MatchStanding[] = sorted.map((c, idx) => ({
      id: c.id,
      name: c.name,
      vehicleId: c.customization.vehicleId,
      vehicleName: VEHICLE_CONFIGS[c.customization.vehicleId].name,
      placement: idx + 1,
      alive: c.alive,
      hpRemaining: Math.round(c.hp),
      eliminations: c.eliminations,
      score: c.score + c.driftState.driftScore,
      isAi: c.isAi,
    }));

    this.broadcast({
      type: 'match_over',
      roomCode: this.roomCode,
      matchId: this.matchId,
      mode: this.isPrivate ? 'online_private' : 'online_public',
      durationSec: Math.round(this.matchElapsedSeconds),
      winner,
      standings,
    });
  }

  public buildWorldSnapshot(): WorldSnapshotPayload {
    const safeZone = evaluateSafeZone(this.matchElapsedSeconds);
    const lastProcessedSeq: Record<string, number> = {};
    for (const p of this.participants.values()) {
      if (!p.isAi) lastProcessedSeq[p.id] = p.lastSeq;
    }

    const cars: NetCarState[] = Array.from(this.cars.values()).map((c) => ({
      id: c.id,
      name: c.name,
      isAi: c.isAi,
      connected: c.connected,
      customization: c.customization,
      x: Number(c.x.toFixed(2)),
      y: Number(c.y.toFixed(2)),
      z: Number(c.z.toFixed(2)),
      yaw: Number(c.yaw.toFixed(4)),
      vx: Number(c.vx.toFixed(2)),
      vy: Number(c.vy.toFixed(2)),
      vz: Number(c.vz.toFixed(2)),
      speedKmh: c.speedKmh,
      hp: Math.round(c.hp),
      maxHp: c.maxHp,
      alive: c.alive,
      nitro: Math.round(c.nitro),
      nitroActive: c.nitroActive,
      isDrifting: c.driftState.isDrifting,
      driftCharge: Math.round(c.driftState.driftCharge),
      driftBoostRemaining: Number(c.driftState.driftBoostRemaining.toFixed(1)),
      driftMultiplier: c.driftState.driftMultiplier,
      driftScore: c.driftState.driftScore,
      slipRatio: Number(c.slipRatio.toFixed(2)),
      wheelSteerAngle: Number(c.wheelSteerAngle.toFixed(3)),
      equippedWeapon: c.equippedWeapon ? { ...c.equippedWeapon } : null,
      equippedAbility: c.equippedAbility ? { ...c.equippedAbility } : null,
      weaponCooldown: Number(c.weaponCooldown.toFixed(1)),
      abilityCooldown: Number(c.abilityCooldown.toFixed(1)),
      shieldTimer: Number(c.shieldTimer.toFixed(1)),
      armorTimer: Number(c.armorTimer.toFixed(1)),
      nitroAbilityTimer: Number(c.nitroAbilityTimer.toFixed(1)),
      dashTimer: Number(c.dashTimer.toFixed(1)),
      slowTimer: Number(c.slowTimer.toFixed(1)),
      spawnProtectionTimer: Number(c.spawnProtectionTimer.toFixed(1)),
      eliminations: c.eliminations,
      damageTaken: Math.round(c.damageTaken),
      score: c.score + c.driftState.driftScore,
    }));

    const pickups: NetPickupState[] = this.pickups.map((pu) => ({
      id: pu.id,
      kind: pu.kind,
      x: pu.x,
      y: pu.y,
      z: pu.z,
      ttl: Number(pu.ttl.toFixed(1)),
    }));

    const rockets: NetRocketState[] = this.rockets.map((r) => ({
      id: r.id,
      ownerId: r.ownerId,
      x: Number(r.x.toFixed(2)),
      y: Number(r.y.toFixed(2)),
      z: Number(r.z.toFixed(2)),
      yaw: Number(r.yaw.toFixed(3)),
    }));

    const hazards: NetHazardState[] = this.hazards.map((h) => ({
      id: h.id,
      kind: h.kind,
      ownerId: h.ownerId,
      x: Number(h.x.toFixed(2)),
      y: Number(h.y.toFixed(2)),
      z: Number(h.z.toFixed(2)),
      ttl: Number(h.ttl.toFixed(1)),
    }));

    return {
      tick: this.tickCounter,
      serverTime: Date.now(),
      lastProcessedSeq,
      startingCountdown: Math.ceil(this.startingCountdown),
      matchElapsedSeconds: Math.floor(this.matchElapsedSeconds),
      countdownRemaining: Math.ceil(this.countdownRemaining),
      drawbridgePhase: this.drawbridgePhase,
      drawbridgeOpenAmount: Number(this.drawbridgeOpenAmount.toFixed(2)),
      trainPhase: this.trainSchedule.phase,
      trainZ: Number(this.trainSchedule.trainZ.toFixed(1)),
      safeZone,
      cars,
      pickups,
      rockets,
      hazards,
    };
  }

  private emitEvent(event: CombatEventPayload): void {
    this.broadcast({ type: 'combat_event', event });
  }

  private broadcastRoomState(): void {
    this.broadcast({ type: 'room_state', room: this.getRoomLobbySnapshot() });
  }

  private broadcast(msg: ServerToClientMessage): void {
    for (const p of this.participants.values()) {
      if (!p.isAi && p.connected && p.send) {
        p.send(msg);
      }
    }
  }
}

export function isValidVehicleOption(id: string): boolean {
  return (VEHICLE_ORDER as string[]).includes(id);
}
