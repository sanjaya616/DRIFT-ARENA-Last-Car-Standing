import type {
  AbilityKind,
  CarCustomization,
  DrawbridgePhase,
  EquippedAbility,
  EquippedWeapon,
  PickupKind,
  SafeZoneState,
  TrainPhase,
  VehicleId,
  WeaponKind,
  WinnerInfo,
} from '../types/game.ts';
import { VEHICLE_CONFIGS } from '../cars/vehicleConfigs.ts';

export const SERVER_SIM_HZ = 20;
export const SERVER_TICK_DT = 1 / SERVER_SIM_HZ;
export const MAX_ROOM_PLAYERS = 8;
export const MIN_READY_PLAYERS_TO_START = 2;
export const RECONNECT_GRACE_SECONDS = 15;

export interface NetInputPayload {
  throttle: number;
  brake: number;
  steer: number;
  drift: boolean;
  nitro: boolean;
  jump: boolean;
  useWeapon: boolean;
  useAbility: boolean;
  recover: boolean;
}

export interface LobbyPlayerInfo {
  id: string;
  name: string;
  vehicleId: VehicleId;
  bodyColor: string;
  accentColor: string;
  rimColor: string;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  isAi: boolean;
  verifiedUid: string | null;
}

export interface RoomLobbySnapshot {
  roomId: string;
  roomCode: string;
  isPrivate: boolean;
  hostId: string;
  status: 'lobby' | 'playing' | 'finished';
  aiFill: boolean;
  maxPlayers: number;
  humanCount: number;
  readyHumanCount: number;
  canStart: boolean;
  players: LobbyPlayerInfo[];
}

export interface MatchParticipantMeta {
  id: string;
  name: string;
  isAi: boolean;
  customization: CarCustomization;
}

export interface NetCarState {
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
  speedKmh: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  nitro: number;
  nitroActive: boolean;
  isDrifting: boolean;
  driftCharge: number;
  driftBoostRemaining: number;
  driftMultiplier: number;
  driftScore: number;
  slipRatio: number;
  wheelSteerAngle: number;
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
}

export interface NetPickupState {
  id: string;
  kind: PickupKind;
  x: number;
  y: number;
  z: number;
  ttl: number;
}

export interface NetRocketState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface NetHazardState {
  id: string;
  kind: 'bomb' | 'spike_trap' | 'proximity_mine';
  ownerId: string;
  x: number;
  y: number;
  z: number;
  ttl: number;
}

export interface WorldSnapshotPayload {
  tick: number;
  serverTime: number;
  lastProcessedSeq: Record<string, number>;
  startingCountdown: number;
  matchElapsedSeconds: number;
  countdownRemaining: number;
  drawbridgePhase: DrawbridgePhase;
  drawbridgeOpenAmount: number;
  trainPhase: TrainPhase;
  trainZ: number;
  safeZone: SafeZoneState;
  cars: NetCarState[];
  pickups: NetPickupState[];
  rockets: NetRocketState[];
  hazards: NetHazardState[];
}

export interface CombatEventPayload {
  eventId: string;
  kind:
    | 'weapon_fired'
    | 'ability_used'
    | 'pickup_collected'
    | 'explosion'
    | 'damage'
    | 'elimination'
    | 'jump'
    | 'boost'
    | 'collision';
  x: number;
  y: number;
  z: number;
  color?: string;
  sourceId?: string;
  targetId?: string;
  amount?: number;
  weaponKind?: WeaponKind;
  abilityKind?: AbilityKind;
  pickupKind?: PickupKind;
}

export interface MatchStanding {
  id: string;
  name: string;
  vehicleId: VehicleId;
  vehicleName: string;
  placement: number;
  alive: boolean;
  hpRemaining: number;
  eliminations: number;
  score: number;
  isAi: boolean;
}

export type ClientToServerMessage =
  | {
      type: 'hello';
      displayName: string;
      customization: CarCustomization;
      firebaseIdToken?: string;
      reconnectToken?: string;
    }
  | {
      type: 'join_public';
      displayName: string;
      customization: CarCustomization;
    }
  | {
      type: 'create_room';
      isPrivate: boolean;
      aiFill: boolean;
      displayName: string;
      customization: CarCustomization;
    }
  | {
      type: 'join_room';
      roomCode: string;
      displayName: string;
      customization: CarCustomization;
    }
  | { type: 'leave_room' }
  | { type: 'set_ready'; ready: boolean }
  | { type: 'update_room_options'; aiFill: boolean }
  | { type: 'update_loadout'; customization: CarCustomization }
  | { type: 'start_match' }
  | {
      type: 'player_input';
      seq: number;
      timestamp: number;
      input: NetInputPayload;
    }
  | {
      type: 'reconnect';
      roomCode: string;
      playerId: string;
      reconnectToken: string;
    }
  | { type: 'ping'; t: number };

export type ServerToClientMessage =
  | {
      type: 'welcome';
      playerId: string;
      reconnectToken: string;
      displayName: string;
      verifiedUid: string | null;
    }
  | { type: 'room_state'; room: RoomLobbySnapshot }
  | {
      type: 'match_start';
      roomCode: string;
      matchId: string;
      durationSeconds: number;
      startingCountdown: number;
      players: MatchParticipantMeta[];
    }
  | { type: 'world_snapshot'; snapshot: WorldSnapshotPayload }
  | { type: 'combat_event'; event: CombatEventPayload }
  | {
      type: 'player_connection';
      playerId: string;
      name: string;
      status: 'disconnected' | 'reconnected' | 'eliminated';
      graceSeconds?: number;
    }
  | {
      type: 'match_over';
      roomCode: string;
      matchId: string;
      mode: 'online_public' | 'online_private';
      durationSec: number;
      winner: WinnerInfo;
      standings: MatchStanding[];
    }
  | { type: 'pong'; t: number; serverTime: number }
  | { type: 'error'; code: string; message: string };

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function sanitizeDriverName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Driver';
  const cleaned = raw.replace(/[^a-zA-Z0-9 _\-.]/g, '').trim().slice(0, 24);
  return cleaned.length > 0 ? cleaned : 'Driver';
}

export function sanitizeCustomization(raw: unknown): CarCustomization {
  const fallbackVehicle: VehicleId = 'street_rs';
  if (!raw || typeof raw !== 'object') {
    const spec = VEHICLE_CONFIGS[fallbackVehicle];
    return {
      vehicleId: fallbackVehicle,
      bodyColor: spec.defaultBodyColor,
      accentColor: spec.defaultAccentColor,
      rimColor: spec.defaultRimColor,
    };
  }
  const obj = raw as Record<string, unknown>;
  const vehicleId: VehicleId =
    typeof obj.vehicleId === 'string' && obj.vehicleId in VEHICLE_CONFIGS
      ? (obj.vehicleId as VehicleId)
      : fallbackVehicle;
  const spec = VEHICLE_CONFIGS[vehicleId];
  return {
    vehicleId,
    bodyColor:
      typeof obj.bodyColor === 'string' && HEX_COLOR_RE.test(obj.bodyColor)
        ? obj.bodyColor
        : spec.defaultBodyColor,
    accentColor:
      typeof obj.accentColor === 'string' && HEX_COLOR_RE.test(obj.accentColor)
        ? obj.accentColor
        : spec.defaultAccentColor,
    rimColor:
      typeof obj.rimColor === 'string' && HEX_COLOR_RE.test(obj.rimColor)
        ? obj.rimColor
        : spec.defaultRimColor,
  };
}

export function sanitizeNetInput(raw: unknown): NetInputPayload {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : 0;
  return {
    throttle: num(obj.throttle, 0, 1),
    brake: num(obj.brake, 0, 1),
    steer: num(obj.steer, -1, 1),
    drift: Boolean(obj.drift),
    nitro: Boolean(obj.nitro),
    jump: Boolean(obj.jump),
    useWeapon: Boolean(obj.useWeapon),
    useAbility: Boolean(obj.useAbility),
    recover: Boolean(obj.recover),
  };
}
