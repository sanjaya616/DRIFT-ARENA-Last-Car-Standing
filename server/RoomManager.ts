import { randomBytes } from 'node:crypto';
import type { CarCustomization } from '../src/types/game.ts';
import {
  sanitizeCustomization,
  sanitizeDriverName,
  type ClientToServerMessage,
  type ServerToClientMessage,
} from '../src/multiplayer/protocol.ts';
import { ArenaRoom } from './ArenaRoom.ts';

export interface ClientSession {
  playerId: string;
  reconnectToken: string;
  displayName: string;
  verifiedUid: string | null;
  roomId: string | null;
  customization: CarCustomization;
  send: (msg: ServerToClientMessage) => void;
  msgCountWindow: number;
  msgWindowStartMs: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(): string {
  let code = '';
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

export class RoomManager {
  public rooms = new Map<string, ArenaRoom>();
  public roomByCode = new Map<string, ArenaRoom>();
  public sessions = new Map<string, ClientSession>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(startCleanup = true) {
    if (startCleanup) {
      this.cleanupTimer = setInterval(() => this.pruneStaleRooms(), 10000);
    }
  }

  public createSession(send: (msg: ServerToClientMessage) => void): ClientSession {
    const playerId = `p_${randomBytes(6).toString('hex')}`;
    const reconnectToken = randomBytes(16).toString('hex');
    const session: ClientSession = {
      playerId,
      reconnectToken,
      displayName: `Driver_${playerId.slice(2, 6).toUpperCase()}`,
      verifiedUid: null,
      roomId: null,
      customization: sanitizeCustomization(null),
      send,
      msgCountWindow: 0,
      msgWindowStartMs: Date.now(),
    };
    this.sessions.set(playerId, session);
    return session;
  }

  public handleDisconnect(playerId: string): void {
    const session = this.sessions.get(playerId);
    if (!session) return;
    if (session.roomId) {
      const room = this.rooms.get(session.roomId);
      if (room) {
        room.removeHumanPlayer(playerId);
      }
    }
    this.sessions.delete(playerId);
  }

  public async handleMessage(
    session: ClientSession,
    raw: unknown,
    verifyTokenFn?: (token: string) => Promise<string | null>,
  ): Promise<void> {
    const now = Date.now();
    if (now - session.msgWindowStartMs > 1000) {
      session.msgWindowStartMs = now;
      session.msgCountWindow = 0;
    }
    session.msgCountWindow += 1;
    if (session.msgCountWindow > 90) {
      session.send({ type: 'error', code: 'RATE_LIMIT', message: 'Input rate limit exceeded.' });
      return;
    }

    if (!raw || typeof raw !== 'object') return;
    const msg = raw as ClientToServerMessage;

    if (msg.type === 'ping') {
      session.send({
        type: 'pong',
        t: typeof msg.t === 'number' ? msg.t : now,
        serverTime: now,
      });
      return;
    }

    if (msg.type === 'hello') {
      session.displayName = sanitizeDriverName(msg.displayName);
      session.customization = sanitizeCustomization(msg.customization);
      if (msg.firebaseIdToken && verifyTokenFn) {
        session.verifiedUid = await verifyTokenFn(msg.firebaseIdToken).catch(() => null);
      }
      session.send({
        type: 'welcome',
        playerId: session.playerId,
        reconnectToken: session.reconnectToken,
        displayName: session.displayName,
        verifiedUid: session.verifiedUid,
      });
      return;
    }

    if (msg.type === 'reconnect') {
      const code = typeof msg.roomCode === 'string' ? msg.roomCode.trim().toUpperCase() : '';
      const room = this.roomByCode.get(code);
      if (!room) {
        session.send({ type: 'error', code: 'ROOM_NOT_FOUND', message: 'Match room no longer exists.' });
        return;
      }
      const restored = room.reconnectHumanPlayer({
        playerId: msg.playerId,
        reconnectToken: msg.reconnectToken,
        send: session.send,
      });
      if (!restored) {
        session.send({ type: 'error', code: 'RECONNECT_EXPIRED', message: 'Reconnect grace window expired.' });
        return;
      }
      // Bind this socket session to the restored playerId & token
      this.sessions.delete(session.playerId);
      session.playerId = msg.playerId;
      session.reconnectToken = msg.reconnectToken;
      session.roomId = room.roomId;
      this.sessions.set(session.playerId, session);
      session.send({
        type: 'welcome',
        playerId: session.playerId,
        reconnectToken: session.reconnectToken,
        displayName: session.displayName,
        verifiedUid: session.verifiedUid,
      });
      return;
    }

    if (msg.type === 'join_public') {
      this.leaveCurrentRoom(session);
      session.displayName = sanitizeDriverName(msg.displayName);
      session.customization = sanitizeCustomization(msg.customization);
      const openPublic = Array.from(this.rooms.values()).find(
        (r) => !r.isPrivate && r.status === 'lobby' && r.humanCount < r.maxPlayers,
      );
      const room =
        openPublic ??
        this.createRoomInternal({
          isPrivate: false,
          hostId: session.playerId,
          aiFill: true,
        });
      const res = room.addHumanPlayer({
        id: session.playerId,
        name: session.displayName,
        verifiedUid: session.verifiedUid,
        reconnectToken: session.reconnectToken,
        customization: session.customization,
        send: session.send,
      });
      if (!res.ok) {
        session.send({ type: 'error', code: res.code, message: res.message });
        return;
      }
      session.roomId = room.roomId;
      return;
    }

    if (msg.type === 'create_room') {
      this.leaveCurrentRoom(session);
      session.displayName = sanitizeDriverName(msg.displayName);
      session.customization = sanitizeCustomization(msg.customization);
      const room = this.createRoomInternal({
        isPrivate: Boolean(msg.isPrivate),
        hostId: session.playerId,
        aiFill: Boolean(msg.aiFill),
      });
      const res = room.addHumanPlayer({
        id: session.playerId,
        name: session.displayName,
        verifiedUid: session.verifiedUid,
        reconnectToken: session.reconnectToken,
        customization: session.customization,
        send: session.send,
      });
      if (!res.ok) {
        session.send({ type: 'error', code: res.code, message: res.message });
        return;
      }
      session.roomId = room.roomId;
      return;
    }

    if (msg.type === 'join_room') {
      const code = typeof msg.roomCode === 'string' ? msg.roomCode.trim().toUpperCase() : '';
      const room = this.roomByCode.get(code);
      if (!room) {
        session.send({ type: 'error', code: 'ROOM_NOT_FOUND', message: `Room ${code || '(empty)'} not found.` });
        return;
      }
      this.leaveCurrentRoom(session);
      session.displayName = sanitizeDriverName(msg.displayName);
      session.customization = sanitizeCustomization(msg.customization);
      const res = room.addHumanPlayer({
        id: session.playerId,
        name: session.displayName,
        verifiedUid: session.verifiedUid,
        reconnectToken: session.reconnectToken,
        customization: session.customization,
        send: session.send,
      });
      if (!res.ok) {
        session.send({ type: 'error', code: res.code, message: res.message });
        return;
      }
      session.roomId = room.roomId;
      return;
    }

    if (msg.type === 'leave_room') {
      this.leaveCurrentRoom(session);
      return;
    }

    const room = session.roomId ? this.rooms.get(session.roomId) : undefined;
    if (!room) return;

    if (msg.type === 'set_ready') {
      room.setReady(session.playerId, Boolean(msg.ready));
    } else if (msg.type === 'update_room_options') {
      room.setAiFill(session.playerId, Boolean(msg.aiFill));
    } else if (msg.type === 'update_loadout') {
      session.customization = sanitizeCustomization(msg.customization);
      room.updateLoadout(session.playerId, session.customization);
    } else if (msg.type === 'start_match') {
      const res = room.startMatch(session.playerId);
      if (!res.ok) {
        session.send({ type: 'error', code: res.code, message: res.message });
      }
    } else if (msg.type === 'player_input') {
      room.handlePlayerInput(session.playerId, msg.seq, msg.input);
    }
  }

  private leaveCurrentRoom(session: ClientSession): void {
    if (!session.roomId) return;
    const prev = this.rooms.get(session.roomId);
    if (prev) {
      prev.removeHumanPlayer(session.playerId);
    }
    session.roomId = null;
  }

  private createRoomInternal(opts: {
    isPrivate: boolean;
    hostId: string;
    aiFill: boolean;
  }): ArenaRoom {
    let roomCode = generateRoomCode();
    while (this.roomByCode.has(roomCode)) {
      roomCode = generateRoomCode();
    }
    const roomId = `room_${randomBytes(4).toString('hex')}`;
    const room = new ArenaRoom({
      roomId,
      roomCode,
      isPrivate: opts.isPrivate,
      hostId: opts.hostId,
      aiFill: opts.aiFill,
      onRoomEmpty: (id) => {
        const r = this.rooms.get(id);
        if (r) {
          r.stopLoop();
          this.roomByCode.delete(r.roomCode);
          this.rooms.delete(id);
        }
      },
    });
    this.rooms.set(roomId, room);
    this.roomByCode.set(roomCode, room);
    return room;
  }

  public listPublicLobbySummaries() {
    return Array.from(this.rooms.values())
      .filter((r) => !r.isPrivate && r.status === 'lobby')
      .map((r) => ({
        roomCode: r.roomCode,
        players: r.humanCount,
        maxPlayers: r.maxPlayers,
        readyCount: r.readyHumanCount,
        aiFill: r.aiFill,
      }));
  }

  private pruneStaleRooms(): void {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (room.isStale(now)) {
        room.stopLoop();
        this.roomByCode.delete(room.roomCode);
        this.rooms.delete(id);
      }
    }
  }

  public dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const room of this.rooms.values()) {
      room.stopLoop();
    }
    this.rooms.clear();
    this.roomByCode.clear();
    this.sessions.clear();
  }
}
