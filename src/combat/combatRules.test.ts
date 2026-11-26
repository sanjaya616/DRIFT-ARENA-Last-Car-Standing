import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ABILITY_SPECS,
  applyHealthChange,
  calculateEffectiveDamage,
  createEquippedAbility,
  createEquippedWeapon,
  isAbilityPickup,
  isPickupSpawnValid,
  isWeaponPickup,
  MAX_PLAYER_HP,
  PICKUP_WEIGHTS,
  pickWeightedPickupKind,
  TOTAL_PICKUP_WEIGHT,
  WEAPON_SPECS,
} from './combatRules';

test('pickup weights sum to 100 and match specified frequencies', () => {
  assert.equal(TOTAL_PICKUP_WEIGHT, 100);
  const counts = new Map<string, number>();
  for (let i = 0; i < 100; i++) {
    const kind = pickWeightedPickupKind(() => (i + 0.5) / 100);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  for (const entry of PICKUP_WEIGHTS) {
    assert.equal(counts.get(entry.kind), entry.weight);
  }
});

test('weapon and ability specs match exact prompt numbers', () => {
  assert.equal(WEAPON_SPECS.rocket.uses, 2);
  assert.equal(WEAPON_SPECS.rocket.damage, 30);
  assert.equal(WEAPON_SPECS.rocket.radius, 5);
  assert.equal(WEAPON_SPECS.rocket.speed, 45);
  assert.equal(WEAPON_SPECS.rocket.range, 45);
  assert.equal(WEAPON_SPECS.rocket.cooldown, 2.5);

  assert.equal(WEAPON_SPECS.punch.uses, 3);
  assert.equal(WEAPON_SPECS.punch.damage, 20);
  assert.equal(WEAPON_SPECS.punch.range, 3);
  assert.equal(WEAPON_SPECS.punch.cooldown, 1.0);

  assert.equal(WEAPON_SPECS.bomb.uses, 2);
  assert.equal(WEAPON_SPECS.bomb.damage, 35);
  assert.equal(WEAPON_SPECS.bomb.radius, 6);
  assert.equal(WEAPON_SPECS.bomb.detonationDelay, 3.0);

  assert.equal(WEAPON_SPECS.spike_trap.uses, 2);
  assert.equal(WEAPON_SPECS.spike_trap.lifetime, 20);
  assert.equal(WEAPON_SPECS.spike_trap.damage, 15);

  assert.equal(WEAPON_SPECS.proximity_mine.uses, 2);
  assert.equal(WEAPON_SPECS.proximity_mine.lifetime, 25);
  assert.equal(WEAPON_SPECS.proximity_mine.damage, 25);
  assert.equal(WEAPON_SPECS.proximity_mine.radius, 4);

  assert.equal(ABILITY_SPECS.shield.duration, 8);
  assert.equal(ABILITY_SPECS.armor.duration, 15);
  assert.equal(ABILITY_SPECS.nitro.duration, 5);
  assert.equal(ABILITY_SPECS.super_jump.jumpMeters, 8);
  assert.equal(ABILITY_SPECS.triple_jump.uses, 3);
  assert.equal(ABILITY_SPECS.triple_jump.jumpMeters, 5);
  assert.equal(ABILITY_SPECS.triple_jump.cooldown, 0.7);
  assert.equal(ABILITY_SPECS.lightning_dash.duration, 1.2);
});

test('two independent slots classify weapons vs abilities cleanly', () => {
  assert.equal(isWeaponPickup('rocket'), true);
  assert.equal(isAbilityPickup('rocket'), false);
  assert.equal(isAbilityPickup('shield'), true);
  assert.equal(isWeaponPickup('shield'), false);

  const w = createEquippedWeapon('bomb');
  assert.equal(w.usesRemaining, 2);
  const a = createEquippedAbility('triple_jump');
  assert.equal(a.usesRemaining, 3);
});

test('damage mitigation respects spawn protection, shield, armor, dash, and 100 HP clamp', () => {
  assert.equal(
    calculateEffectiveDamage({
      rawDamage: 35,
      source: 'weapon',
      spawnProtected: true,
      shieldActive: false,
      armorActive: false,
      dashActive: false,
    }),
    0,
  );
  assert.equal(
    calculateEffectiveDamage({
      rawDamage: 30,
      source: 'weapon',
      spawnProtected: false,
      shieldActive: true,
      armorActive: false,
      dashActive: false,
    }),
    0,
  );
  assert.equal(
    calculateEffectiveDamage({
      rawDamage: 30,
      source: 'weapon',
      spawnProtected: false,
      shieldActive: false,
      armorActive: true,
      dashActive: false,
    }),
    15,
  );
  assert.equal(
    calculateEffectiveDamage({
      rawDamage: 15,
      source: 'collision',
      spawnProtected: false,
      shieldActive: false,
      armorActive: false,
      dashActive: true,
    }),
    0,
  );
  // Boundary damage bypasses spawn protection
  assert.equal(
    calculateEffectiveDamage({
      rawDamage: 10,
      source: 'boundary',
      spawnProtected: true,
      shieldActive: true,
      armorActive: true,
      dashActive: true,
    }),
    10,
  );

  const healClamped = applyHealthChange(90, 25);
  assert.equal(healClamped.nextHp, MAX_PLAYER_HP);
  assert.equal(healClamped.eliminated, false);

  const fatal = applyHealthChange(20, -30);
  assert.equal(fatal.nextHp, 0);
  assert.equal(fatal.eliminated, true);
});

test('pickup spawn validation enforces 15m pickup spacing, 12m player spacing, and safe zone', () => {
  assert.equal(
    isPickupSpawnValid({
      x: 50,
      z: 50,
      existingPickups: [{ x: 45, z: 50 }],
      playerPositions: [{ x: 0, z: 0 }],
      safeZoneRadiusMeters: 300,
      isAccessible: true,
    }),
    false,
  );
  assert.equal(
    isPickupSpawnValid({
      x: 8,
      z: 0,
      existingPickups: [],
      playerPositions: [{ x: 0, z: 0 }],
      safeZoneRadiusMeters: 300,
      isAccessible: true,
    }),
    false,
  );
  assert.equal(
    isPickupSpawnValid({
      x: 80,
      z: 80,
      existingPickups: [{ x: 0, z: 0 }],
      playerPositions: [{ x: 10, z: 10 }],
      safeZoneRadiusMeters: 300,
      isAccessible: true,
    }),
    true,
  );
});
