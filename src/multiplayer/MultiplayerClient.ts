import type { CarCustomization } from '../types/game';
import type {
  ClientToServerMessage,
  CombatEventPayload,
  MatchParticipantMeta,
  MatchStanding,
  NetInputPayload,
  RoomLobbySnapshot,
  ServerToClientMessage,
  WorldSnapshotPayload,
} from './protocol';

interface SavedReconnectSession {
  roomCode: string;
  playerId: string;
  reconnectToken: string;
}

const RECONNECT_STORAGE_KEY = 'drift_arena_reconnect_session';

export interface MultiplayerClientEvents {
  onConnectionChange?: (connected: boolean, reconnecting: boolean) => void;
  onWelcome?: (playerId: string, verifiedUid: string | null) => void;
  onRoomState?: (room: RoomLobbySnapshot | null) => void;
  onMatchStart?: (payload: {
    roomCode: string;
    matchId: string;
    durationSeconds: number;
    startingCountdown: number;
    players: MatchParticipantMeta[];
  }) => void;
  onWorldSnapshot?: (snapshot: WorldSnapshotPayload) => void;
  onCombatEvent?: (event: CombatEventPayload) => void;
  onPlayerConnection?: (payload: {
    playerId: string;
    name: string;
    status: 'disconnected' | 'reconnected' | 'eliminated';
    graceSeconds?: number;
  }) => void;
  onMatchOver?: (payload: {
    roomCode: string;
    matchId: string;
    mode: 'online_public' | 'online_private';
    durationSec: number;
    winner: {
      id: string;
      name: string;
      vehicleName: string;
      isPlayer: boolean;
      hpRemaining: number;
    };
    standings: MatchStanding[];
  }) => void;
  onPingUpdate?: (pingMs: number) => void;
  onError?: (code: string, message: string) => void;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<MultiplayerClientEvents>();
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private manualClose = false;
  private inputSeq = 0;

  public connected = false;
  public reconnecting = false;
  public playerId: string | null = null;
  public reconnectToken: string | null = null;
  public verifiedUid: string | null = null;
  public room: RoomLobbySnapshot | null = null;
  public pingMs = 0;

  private pendingHello: {
    displayName: string;
    customization: CarCustomization;
    firebaseIdToken?: string;
  } | null = null;

  public subscribe(events: MultiplayerClientEvents): () => void {
    this.listeners.add(events);
    return () => {
      this.listeners.delete(events);
    };
  }

  public connect(params: {
    displayName: string;
    customization: CarCustomization;
    firebaseIdToken?: string;
  }): void {
    this.pendingHello = params;
    this.manualClose = false;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.send({
          type: 'hello',
          displayName: params.displayName,
          customization: params.customization,
          firebaseIdToken: params.firebaseIdToken,
        });
      }
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.connected = true;
      this.reconnecting = false;
      this.notify((l) => l.onConnectionChange?.(true, false));

      const saved = this.loadSavedSession();
      if (saved && this.room?.status === 'playing') {
        this.send({
          type: 'reconnect',
          roomCode: saved.roomCode,
          playerId: saved.playerId,
          reconnectToken: saved.reconnectToken,
        });
      } else if (this.pendingHello) {
        this.send({
          type: 'hello',
          displayName: this.pendingHello.displayName,
          customization: this.pendingHello.customization,
          firebaseIdToken: this.pendingHello.firebaseIdToken,
        });
      }

      if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.send({ type: 'ping', t: performance.now() });
        }
      }, 2000);
    };

    ws.onmessage = (evt) => {
      if (typeof evt.data !== 'string') return;
      try {
        const msg = JSON.parse(evt.data) as ServerToClientMessage;
        this.handleServerMessage(msg);
      } catch {
        // Ignore malformed frame
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.connected = false;
      if (this.pingTimer !== null) {
        window.clearInterval(this.pingTimer);
        this.pingTimer = null;
      }

      const canReconnect = !this.manualClose && this.room?.status === 'playing' && Boolean(this.loadSavedSession());
      this.reconnecting = canReconnect;
      this.notify((l) => l.onConnectionChange?.(false, canReconnect));

      if (canReconnect && this.reconnectTimer === null) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          if (!this.manualClose && this.pendingHello) {
            this.connect(this.pendingHello);
          }
        }, 1800);
      }
    };

    ws.onerror = () => {
      // Close handler manages reconnect cleanly
    };
  }

  public disconnect(): void {
    this.manualClose = true;
    this.reconnecting = false;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.connected = false;
    this.room = null;
    this.clearSavedSession();
    this.notify((l) => {
      l.onRoomState?.(null);
      l.onConnectionChange?.(false, false);
    });
  }

  public joinPublic(displayName: string, customization: CarCustomization): void {
    this.send({ type: 'join_public', displayName, customization });
  }

  public createRoom(opts: {
    isPrivate: boolean;
    aiFill: boolean;
    displayName: string;
    customization: CarCustomization;
  }): void {
    this.send({
      type: 'create_room',
      isPrivate: opts.isPrivate,
      aiFill: opts.aiFill,
      displayName: opts.displayName,
      customization: opts.customization,
    });
  }

  public joinRoom(roomCode: string, displayName: string, customization: CarCustomization): void {
    this.send({
      type: 'join_room',
      roomCode: roomCode.trim().toUpperCase(),
      displayName,
      customization,
    });
  }

  public leaveRoom(): void {
    this.send({ type: 'leave_room' });
    this.room = null;
    this.clearSavedSession();
    this.notify((l) => l.onRoomState?.(null));
  }

  public setReady(ready: boolean): void {
    this.send({ type: 'set_ready', ready });
  }

  public setAiFill(aiFill: boolean): void {
    this.send({ type: 'update_room_options', aiFill });
  }

  public updateLoadout(customization: CarCustomization): void {
    this.send({ type: 'update_loadout', customization });
  }

  public startMatch(): void {
    this.send({ type: 'start_match' });
  }

  public sendInput(input: NetInputPayload): number {
    this.inputSeq += 1;
    this.send({
      type: 'player_input',
      seq: this.inputSeq,
      timestamp: Date.now(),
      input,
    });
    return this.inputSeq;
  }

  public tryResumeSavedSession(): boolean {
    const saved = this.loadSavedSession();
    if (!saved || this.ws?.readyState !== WebSocket.OPEN) return false;
    this.send({
      type: 'reconnect',
      roomCode: saved.roomCode,
      playerId: saved.playerId,
      reconnectToken: saved.reconnectToken,
    });
    return true;
  }

  private send(msg: ClientToServerMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleServerMessage(msg: ServerToClientMessage): void {
    switch (msg.type) {
      case 'welcome': {
        this.playerId = msg.playerId;
        this.reconnectToken = msg.reconnectToken;
        this.verifiedUid = msg.verifiedUid;
        this.notify((l) => l.onWelcome?.(msg.playerId, msg.verifiedUid));
        break;
      }
      case 'room_state': {
        this.room = msg.room;
        this.notify((l) => l.onRoomState?.(msg.room));
        break;
      }
      case 'match_start': {
        this.inputSeq = 0;
        if (this.room) {
          this.room = { ...this.room, status: 'playing' };
          this.notify((l) => l.onRoomState?.(this.room));
        }
        if (this.playerId && this.reconnectToken) {
          this.saveSession({
            roomCode: msg.roomCode,
            playerId: this.playerId,
            reconnectToken: this.reconnectToken,
          });
        }
        this.notify((l) => l.onMatchStart?.(msg));
        break;
      }
      case 'world_snapshot': {
        this.notify((l) => l.onWorldSnapshot?.(msg.snapshot));
        break;
      }
      case 'combat_event': {
        this.notify((l) => l.onCombatEvent?.(msg.event));
        break;
      }
      case 'player_connection': {
        this.notify((l) => l.onPlayerConnection?.(msg));
        break;
      }
      case 'match_over': {
        this.clearSavedSession();
        if (this.room) {
          this.room = { ...this.room, status: 'finished' };
          this.notify((l) => l.onRoomState?.(this.room));
        }
        this.notify((l) => l.onMatchOver?.(msg));
        break;
      }
      case 'pong': {
        this.pingMs = Math.max(1, Math.round(performance.now() - msg.t));
        this.notify((l) => l.onPingUpdate?.(this.pingMs));
        break;
      }
      case 'error': {
        if (msg.code === 'ROOM_NOT_FOUND' || msg.code === 'RECONNECT_EXPIRED') {
          this.clearSavedSession();
        }
        this.notify((l) => l.onError?.(msg.code, msg.message));
        break;
      }
    }
  }

  private notify(fn: (listener: MultiplayerClientEvents) => void): void {
    for (const l of this.listeners) {
      fn(l);
    }
  }

  private saveSession(session: SavedReconnectSession): void {
    try {
      sessionStorage.setItem(RECONNECT_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // ignore storage errors
    }
  }

  private loadSavedSession(): SavedReconnectSession | null {
    try {
      const raw = sessionStorage.getItem(RECONNECT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<SavedReconnectSession>;
      if (parsed.roomCode && parsed.playerId && parsed.reconnectToken) {
        return parsed as SavedReconnectSession;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private clearSavedSession(): void {
    try {
      sessionStorage.removeItem(RECONNECT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
