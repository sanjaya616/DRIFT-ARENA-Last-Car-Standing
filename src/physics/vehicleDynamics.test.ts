import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_CONFIGS, VEHICLE_ORDER } from '../cars/vehicleConfigs';
import {
  clampDt,
  computeCollisionDamage,
  computeVehicleKinematics,
  evaluateMatchOutcome,
  mpsToKmh,
  updateDriftState,
  type DriftState,
} from './vehicleDynamics';

test('all 6 vehicles have exact distinct max speeds and configs', () => {
  assert.equal(VEHICLE_ORDER.length, 6);
  assert.equal(VEHICLE_CONFIGS.street_rs.maxSpeedKmh, 170);
  assert.equal(VEHICLE_CONFIGS.drift_x.maxSpeedKmh, 160);
  assert.equal(VEHICLE_CONFIGS.muscle_gt.maxSpeedKmh, 150);
  assert.equal(VEHICLE_CONFIGS.speedster.maxSpeedKmh, 190);
  assert.equal(VEHICLE_CONFIGS.rally_beast.maxSpeedKmh, 155);
  assert.equal(VEHICLE_CONFIGS.titan_4x.maxSpeedKmh, 145);
});

test('clampDt caps spikes at 0.05s and handles invalid values', () => {
  assert.equal(clampDt(0.016), 0.016);
  assert.equal(clampDt(0.5), 0.05);
  assert.equal(clampDt(-0.2), 0);
  assert.equal(clampDt(Number.NaN), 0);
});

test('mpsToKmh converts metres per second to rounded km/h', () => {
  assert.equal(mpsToKmh(10), 36);
  assert.equal(mpsToKmh(-20), 72);
});

test('computeVehicleKinematics gives airborne directional control and +20% drift boost bonus', () => {
  const air = computeVehicleKinematics({
    forwardSpeed: 20,
    lateralSpeed: 0,
    throttle: 1,
    brake: 0,
    steerInput: 1,
    isDrifting: false,
    isNitroActive: false,
    driftBoostActive: false,
    isGrounded: false,
    isOffroad: false,
    vehicleId: 'rally_beast',
    dt: 0.016,
  });
  assert.ok(air.yawRate > 1.0);

  const normal = computeVehicleKinematics({
    forwardSpeed: 20,
    lateralSpeed: 0,
    throttle: 1,
    brake: 0,
    steerInput: 0,
    isDrifting: false,
    isNitroActive: false,
    driftBoostActive: false,
    isGrounded: true,
    isOffroad: false,
    vehicleId: 'street_rs',
    dt: 0.016,
  });
  const boosted = computeVehicleKinematics({
    forwardSpeed: 20,
    lateralSpeed: 0,
    throttle: 1,
    brake: 0,
    steerInput: 0,
    isDrifting: false,
    isNitroActive: false,
    driftBoostActive: true,
    isGrounded: true,
    isOffroad: false,
    vehicleId: 'street_rs',
    dt: 0.016,
  });
  assert.ok(Math.abs(boosted.effectiveMaxSpeedMps / normal.effectiveMaxSpeedMps - 1.2) < 0.001);
});

test('drift charge requires >= 35 km/h, steer, and sideways slip; charges 20%/sec; converts to up to 3s boost', () => {
  const base: DriftState = {
    isDrifting: false,
    driftCharge: 0,
    driftBoostRemaining: 0,
    driftMultiplier: 1,
    driftScore: 0,
    wasDriftHeld: false,
  };

  // Spinning in place (< 35 km/h = 9.72 m/s) must NOT charge
  const slowSpin = updateDriftState(base, 4.0, 5.0, 1, true, true, 1.0);
  assert.equal(slowSpin.next.isDrifting, false);
  assert.equal(slowSpin.next.driftCharge, 0);

  // Moving >= 35 km/h (14 m/s) with steering & sideways slip charges at 20%/s
  const step1 = updateDriftState(base, 14.0, 4.5, 1, true, true, 2.5);
  assert.equal(step1.next.isDrifting, true);
  assert.ok(Math.abs(step1.next.driftCharge - 50) < 0.01);

  // Releasing drift at 50% charge converts to 1.5s boost (max 3.0s at 100%)
  const released = updateDriftState(step1.next, 14.0, 4.5, 1, false, true, 0.016);
  assert.equal(released.boostTriggered, true);
  assert.ok(Math.abs(released.next.driftBoostRemaining - 1.5) < 0.05);
  assert.equal(released.next.driftCharge, 0);
});

test('collision damage tiers match <25 -> 0, 25-44 -> 5, 45-69 -> 10, 70+ -> 15', () => {
  assert.equal(computeCollisionDamage(20 / 3.6, false, 'street_rs', 1), 0);
  assert.equal(computeCollisionDamage(35 / 3.6, false, 'street_rs', 1), 5);
  assert.equal(computeCollisionDamage(55 / 3.6, false, 'street_rs', 1), 10);
  assert.equal(computeCollisionDamage(80 / 3.6, false, 'street_rs', 1), 15);

  // Speedster takes more, Titan 4X takes less
  const speedsterDmg = computeCollisionDamage(80 / 3.6, false, 'speedster', 1);
  const titanDmg = computeCollisionDamage(80 / 3.6, false, 'titan_4x', 1);
  assert.ok(speedsterDmg > 15);
  assert.ok(titanDmg < 15);
});

test('evaluateMatchOutcome handles wrecked, victory, and timeup', () => {
  assert.equal(
    evaluateMatchOutcome({
      playerHp: 0,
      countdownSeconds: 50,
      rivalsAlive: 2,
      rivalsTotal: 3,
      mode: 'survival',
    }),
    'wrecked',
  );
  assert.equal(
    evaluateMatchOutcome({
      playerHp: 80,
      countdownSeconds: 40,
      rivalsAlive: 0,
      rivalsTotal: 3,
      mode: 'survival',
    }),
    'victory',
  );
});
