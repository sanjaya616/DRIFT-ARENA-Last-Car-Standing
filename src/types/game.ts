export type ScreenId =
  | 'menu'
  | 'singleplayer'
  | 'multiplayer'
  | 'garage'
  | 'settings'
  | 'gameplay';

export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type MatchMode = 'survival' | 'freedrive';

export type DifficultyLevel = 'easy' | 'normal' | 'hard';

export type VehicleId =
  | 'street_rs'
  | 'drift_x'
  | 'muscle_gt'
  | 'speedster'
  | 'rally_beast'
  | 'titan_4x';

export type DistrictId =
  | 'downtown'
  | 'mountain'
  | 'harbor'
  | 'railway'
  | 'stunt';

export type DrawbridgePhase =
  | 'closed'
  | 'warning'
  | 'opening'
  | 'open'
  | 'closing';

export type TrainPhase =
  | 'idle'
  | 'warning'
  | 'closing'
  | 'passing'
  | 'clearing';

export type WeaponKind =
  | 'rocket'
  | 'punch'
  | 'bomb'
  | 'spike_trap'
  | 'proximity_mine';

export type AbilityKind =
  | 'shield'
  | 'armor'
  | 'nitro'
  | 'super_jump'
  | 'triple_jump'
  | 'lightning_dash';

export type PickupKind = WeaponKind | AbilityKind;

export interface EquippedWeapon {
  kind: WeaponKind;
  name: string;
  usesRemaining: number;
  maxUses: number;
  cooldown: number;
  maxCooldown: number;
}

export interface EquippedAbility {
  kind: AbilityKind;
  name: string;
  usesRemaining: number;
  maxUses: number;
  cooldown: number;
  activeRemaining: number;
  maxActive: number;
}

export interface SafeZoneState {
  phaseIndex: number;
  phaseLabel: string;
  radiusMeters: number;
  targetRadiusMeters: number;
  areaPercent: number;
  warningText: string | null;
  damagePerTick: number;
  tickIntervalSec: number;
  isSuddenDeath: boolean;
  outsideWarning: boolean;
}

export interface WinnerInfo {
  id: string;
  name: string;
  vehicleName: string;
  isPlayer: boolean;
  hpRemaining: number;
}

export interface VehicleConfig {
  id: VehicleId;
  name: string;
  category: string;
  tagline: string;
  maxSpeedKmh: number;
  accelForce: number;
  brakeForce: number;
  reverseMaxKmh: number;
  massKg: number;
  lateralGrip: number;
  driftGripFactor: number;
  driftTurnRate: number;
  steerResponsiveness: number;
  offroadGripMultiplier: number;
  jumpImpulse: number;
  ramMultiplier: number;
  collisionResistance: number;
  maxHp: number;
  defaultBodyColor: string;
  defaultAccentColor: string;
  defaultRimColor: string;
}

export interface CarCustomization {
  vehicleId: VehicleId;
  bodyColor: string;
  accentColor: string;
  rimColor: string;
}

export interface MatchConfig {
  mode: MatchMode;
  rivalCount: number;
  durationSeconds: number;
  spawnIndex: number;
  difficulty: DifficultyLevel;
}

export type TouchControlsMode = 'auto' | 'always' | 'off';

export interface GameSettings {
  masterVolume: number;
  muted: boolean;
  musicEnabled: boolean;
  touchControlsMode: TouchControlsMode;
  cameraDistance: number;
  steerSensitivity: number;
  highQuality: boolean;
  targetFps: 30 | 60;
}

export interface InputState {
  throttle: number;
  brake: number;
  steer: number;
  drift: boolean;
  nitro: boolean;
  jumpBuffered: boolean;
  weaponTriggered: boolean;
  abilityTriggered: boolean;
  recoverTriggered: boolean;
  pauseTriggered: boolean;
}

export interface MinimapActor {
  id: string;
  x: number;
  z: number;
  yaw: number;
  kind: 'player' | 'rival' | 'pickup' | 'train' | 'hazard';
  alive: boolean;
  color: string;
}

export interface MinimapObstacle {
  x: number;
  z: number;
  w: number;
  d: number;
  kind: 'building' | 'barrier' | 'ramp' | 'stunt';
}

export interface HudSnapshot {
  hp: number;
  maxHp: number;
  speedKmh: number;
  nitro: number;
  nitroActive: boolean;
  driftScore: number;
  driftCharge: number;
  driftBoostRemaining: number;
  driftMultiplier: number;
  isDrifting: boolean;
  startingCountdown: number;
  matchElapsedSeconds: number;
  countdownSeconds: number;
  spawnProtectionRemaining: number;
  equippedWeapon: EquippedWeapon | null;
  equippedAbility: EquippedAbility | null;
  weaponCooldown: number;
  weaponMaxCooldown: number;
  abilityCooldown: number;
  abilityMaxCooldown: number;
  abilityActiveRemaining: number;
  activeArmorRemaining: number;
  activeNitroBoostRemaining: number;
  activeDashRemaining: number;
  activeSlowRemaining: number;
  rivalsAlive: number;
  rivalsTotal: number;
  eliminations: number;
  score: number;
  bestScore: number;
  damageTaken: number;
  playerX: number;
  playerY: number;
  playerZ: number;
  playerYaw: number;
  vehicleId: VehicleId;
  vehicleName: string;
  currentDistrict: DistrictId;
  drawbridgePhase: DrawbridgePhase;
  drawbridgeOpenAmount: number;
  trainPhase: TrainPhase;
  trainZ: number;
  safeZone: SafeZoneState;
  spectating: boolean;
  spectatingName: string | null;
  spectatingVehicle: string | null;
  spectatingHp: number;
  winner: WinnerInfo | null;
  actors: MinimapActor[];
  outcome: 'none' | 'victory' | 'timeup' | 'wrecked';
  isOnline?: boolean;
  roomCode?: string | null;
  pingMs?: number;
  connectionBanner?: string | null;
}

export const WORLD_SIZE_METERS = 600;
export const WORLD_HALF_METERS = 300;
export const ARENA_SIZE_METERS = 600;

export const CAR_DIMENSIONS = {
  length: 4.2,
  width: 1.9,
  height: 1.4,
  wheelRadius: 0.36,
  wheelWidth: 0.28,
} as const;

export const PAINT_SWATCHES = [
  { name: 'Solar Orange', hex: '#f97316', accent: '#0f172a' },
  { name: 'Cobalt Volt', hex: '#2563eb', accent: '#facc15' },
  { name: 'Crimson Apex', hex: '#dc2626', accent: '#f8fafc' },
  { name: 'Emerald Track', hex: '#10b981', accent: '#0f172a' },
  { name: 'Graphite Gold', hex: '#334155', accent: '#f59e0b' },
  { name: 'Pearl Cyan', hex: '#e2e8f0', accent: '#06b6d4' },
];

export const RIM_SWATCHES = [
  { name: 'Alloy Silver', hex: '#cbd5e1' },
  { name: 'Matte Obsidian', hex: '#1e293b' },
  { name: 'Champagne Gold', hex: '#eab308' },
  { name: 'Turbo Bronze', hex: '#b45309' },
];
