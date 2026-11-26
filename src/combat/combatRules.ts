import type {
  AbilityKind,
  EquippedAbility,
  EquippedWeapon,
  PickupKind,
  WeaponKind,
} from '../types/game.ts';

export const MAX_PLAYER_HP = 100;

export interface WeaponSpec {
  kind: WeaponKind;
  name: string;
  uses: number;
  damage: number;
  cooldown: number;
  radius: number;
  range: number;
  speed: number;
  lifetime: number;
  detonationDelay: number;
  color: string;
}

export interface AbilitySpec {
  kind: AbilityKind;
  name: string;
  uses: number;
  duration: number;
  cooldown: number;
  jumpMeters: number;
  color: string;
}

export const WEAPON_SPECS: Record<WeaponKind, WeaponSpec> = {
  rocket: {
    kind: 'rocket',
    name: 'Rocket',
    uses: 2,
    damage: 30,
    cooldown: 2.5,
    radius: 5,
    range: 45,
    speed: 45,
    lifetime: 1.0, // 45m / 45m/s = 1.0s
    detonationDelay: 0,
    color: '#ef4444',
  },
  punch: {
    kind: 'punch',
    name: 'Punch Fist',
    uses: 3,
    damage: 20,
    cooldown: 1.0,
    radius: 3,
    range: 3,
    speed: 0,
    lifetime: 0.25,
    detonationDelay: 0,
    color: '#f97316',
  },
  bomb: {
    kind: 'bomb',
    name: 'Bomb',
    uses: 2,
    damage: 35,
    cooldown: 0.6,
    radius: 6,
    range: 0,
    speed: 0,
    lifetime: 3.0,
    detonationDelay: 3.0,
    color: '#facc15',
  },
  spike_trap: {
    kind: 'spike_trap',
    name: 'Spike Trap',
    uses: 2,
    damage: 15,
    cooldown: 0.6,
    radius: 2.6,
    range: 0,
    speed: 0,
    lifetime: 20,
    detonationDelay: 0,
    color: '#a855f7',
  },
  proximity_mine: {
    kind: 'proximity_mine',
    name: 'Prox Mine',
    uses: 2,
    damage: 25,
    cooldown: 0.6,
    radius: 4, // 4m detection & 4m explosion radius
    range: 4,
    speed: 0,
    lifetime: 25,
    detonationDelay: 0,
    color: '#ec4899',
  },
};

export const ABILITY_SPECS: Record<AbilityKind, AbilitySpec> = {
  shield: {
    kind: 'shield',
    name: 'Shield',
    uses: 1,
    duration: 8.0,
    cooldown: 0,
    jumpMeters: 0,
    color: '#38bdf8',
  },
  armor: {
    kind: 'armor',
    name: 'Armor',
    uses: 1,
    duration: 15.0,
    cooldown: 0,
    jumpMeters: 0,
    color: '#94a3b8',
  },
  nitro: {
    kind: 'nitro',
    name: 'Nitro Boost',
    uses: 1,
    duration: 5.0,
    cooldown: 0,
    jumpMeters: 0,
    color: '#06b6d4',
  },
  super_jump: {
    kind: 'super_jump',
    name: 'Super Jump',
    uses: 1,
    duration: 0,
    cooldown: 0.5,
    jumpMeters: 8,
    color: '#22c55e',
  },
  triple_jump: {
    kind: 'triple_jump',
    name: 'Triple Jump',
    uses: 3,
    duration: 0,
    cooldown: 0.7, // minimum 0.7s interval between jumps
    jumpMeters: 5,
    color: '#84cc16',
  },
  lightning_dash: {
    kind: 'lightning_dash',
    name: 'Lightning Dash',
    uses: 1,
    duration: 1.2,
    cooldown: 0,
    jumpMeters: 0,
    color: '#fde047',
  },
};

export const PICKUP_SPAWN_CONFIG = {
  minActive: 8,
  maxActive: 12,
  minSpawnIntervalSec: 5,
  maxSpawnIntervalSec: 8,
  pickupLifetimeSec: 15,
  collectDistanceMeters: 2.5,
  minPickupSpacingMeters: 15,
  minPlayerDistanceMeters: 12,
} as const;

export const PICKUP_WEIGHTS: ReadonlyArray<{ kind: PickupKind; weight: number }> = [
  { kind: 'nitro', weight: 18 },
  { kind: 'shield', weight: 12 },
  { kind: 'rocket', weight: 12 },
  { kind: 'punch', weight: 10 },
  { kind: 'bomb', weight: 10 },
  { kind: 'armor', weight: 10 },
  { kind: 'super_jump', weight: 10 },
  { kind: 'triple_jump', weight: 7 },
  { kind: 'lightning_dash', weight: 5 },
  { kind: 'spike_trap', weight: 4 },
  { kind: 'proximity_mine', weight: 2 },
];

export const TOTAL_PICKUP_WEIGHT = PICKUP_WEIGHTS.reduce(
  (sum, item) => sum + item.weight,
  0,
);

export function isWeaponPickup(kind: PickupKind): kind is WeaponKind {
  return kind in WEAPON_SPECS;
}

export function isAbilityPickup(kind: PickupKind): kind is AbilityKind {
  return kind in ABILITY_SPECS;
}

export function pickWeightedPickupKind(randomFn: () => number = Math.random): PickupKind {
  let roll = Math.max(0, Math.min(0.999999, randomFn())) * TOTAL_PICKUP_WEIGHT;
  for (const entry of PICKUP_WEIGHTS) {
    roll -= entry.weight;
    if (roll <= 0) {
      return entry.kind;
    }
  }
  return 'nitro';
}

export function createEquippedWeapon(kind: WeaponKind): EquippedWeapon {
  const spec = WEAPON_SPECS[kind];
  return {
    kind,
    name: spec.name,
    usesRemaining: spec.uses,
    maxUses: spec.uses,
    cooldown: 0,
    maxCooldown: spec.cooldown,
  };
}

export function createEquippedAbility(kind: AbilityKind): EquippedAbility {
  const spec = ABILITY_SPECS[kind];
  return {
    kind,
    name: spec.name,
    usesRemaining: spec.uses,
    maxUses: spec.uses,
    cooldown: 0,
    activeRemaining: 0,
    maxActive: spec.duration,
  };
}

export type DamageSourceKind = 'weapon' | 'collision' | 'train' | 'boundary';

export interface DamageMitigationContext {
  rawDamage: number;
  source: DamageSourceKind;
  spawnProtected: boolean;
  shieldActive: boolean;
  armorActive: boolean;
  dashActive: boolean;
}

/**
 * Authoritative combat damage calculation:
 * - Spawn protection (15s) blocks all weapon/collision damage (not boundary).
 * - Shield (8s) blocks weapon and collision damage completely.
 * - Lightning Dash (1.2s) protects against ordinary collision damage.
 * - Armor (15s) reduces incoming weapon/collision damage by 50%.
 */
export function calculateEffectiveDamage(ctx: DamageMitigationContext): number {
  if (ctx.rawDamage <= 0) return 0;
  if (ctx.source !== 'boundary' && ctx.spawnProtected) {
    return 0;
  }
  if (ctx.source === 'weapon' || ctx.source === 'collision') {
    if (ctx.shieldActive) return 0;
  }
  if (ctx.source === 'collision' && ctx.dashActive) {
    return 0;
  }
  let dmg = ctx.rawDamage;
  if (ctx.source !== 'boundary' && ctx.armorActive) {
    dmg *= 0.5;
  }
  return Math.max(1, Math.round(dmg));
}

export function applyHealthChange(
  currentHp: number,
  deltaHp: number,
  maxHp: number = MAX_PLAYER_HP,
): { nextHp: number; eliminated: boolean } {
  const clamped = Math.max(0, Math.min(maxHp, Math.round(currentHp + deltaHp)));
  return {
    nextHp: clamped,
    eliminated: clamped <= 0,
  };
}

export function jumpVelocityForHeight(
  heightMeters: number,
  gravityMag: number = 18,
): number {
  return Math.sqrt(2 * gravityMag * Math.max(0, heightMeters));
}

export function isPickupSpawnValid(params: {
  x: number;
  z: number;
  existingPickups: Array<{ x: number; z: number }>;
  playerPositions: Array<{ x: number; z: number }>;
  safeZoneRadiusMeters: number;
  isAccessible: boolean;
}): boolean {
  if (!params.isAccessible) return false;
  if (Math.hypot(params.x, params.z) > params.safeZoneRadiusMeters - 6) {
    return false;
  }
  for (const p of params.existingPickups) {
    if (
      Math.hypot(params.x - p.x, params.z - p.z) <
      PICKUP_SPAWN_CONFIG.minPickupSpacingMeters
    ) {
      return false;
    }
  }
  for (const pl of params.playerPositions) {
    if (
      Math.hypot(params.x - pl.x, params.z - pl.z) <
      PICKUP_SPAWN_CONFIG.minPlayerDistanceMeters
    ) {
      return false;
    }
  }
  return true;
}
