import { VEHICLE_CONFIGS } from '../cars/vehicleConfigs.ts';
import type { VehicleId } from '../types/game.ts';

export const MPS_TO_KMH = 3.6;
export const MIN_DRIFT_SPEED_KMH = 35;
export const MIN_DRIFT_SPEED_MPS = MIN_DRIFT_SPEED_KMH / MPS_TO_KMH;
export const DRIFT_CHARGE_RATE_PER_SEC = 20;
export const MAX_DRIFT_BOOST_SECONDS = 3.0;
export const MAX_DRIFT_SPEED_BONUS = 0.2;
export const COLLISION_PAIR_COOLDOWN_SEC = 1.5;

export interface VehicleKinematicsInput {
  forwardSpeed: number; // m/s signed along car forward
  lateralSpeed: number; // m/s signed along car right
  throttle: number; // 0..1
  brake: number; // 0..1
  steerInput: number; // -1 (right) .. +1 (left)
  isDrifting: boolean;
  isNitroActive: boolean;
  driftBoostActive: boolean;
  abilityNitroActive?: boolean;
  dashActive?: boolean;
  slowActive?: boolean;
  isGrounded: boolean;
  isOffroad: boolean;
  vehicleId: VehicleId;
  dt: number;
}

export interface VehicleKinematicsOutput {
  forwardAccel: number;
  lateralGripDecel: number;
  yawRate: number;
  wheelSteerAngle: number;
  slipRatio: number;
  effectiveMaxSpeedMps: number;
}

export interface DriftState {
  isDrifting: boolean;
  driftCharge: number; // 0..100
  driftBoostRemaining: number; // seconds 0..3.0
  driftMultiplier: number; // 1..4
  driftScore: number;
  wasDriftHeld: boolean;
}

export function clampDt(rawDt: number): number {
  if (!Number.isFinite(rawDt) || rawDt < 0) return 0;
  return Math.min(rawDt, 0.05);
}

export function mpsToKmh(speedMps: number): number {
  return Math.round(Math.abs(speedMps) * MPS_TO_KMH);
}

export function computeVehicleKinematics(
  input: VehicleKinematicsInput,
): VehicleKinematicsOutput {
  const spec = VEHICLE_CONFIGS[input.vehicleId];
  const offroadScale = input.isOffroad ? spec.offroadGripMultiplier : 1.0;

  let speedBonusMultiplier = 1.0;
  if (input.driftBoostActive) {
    speedBonusMultiplier += MAX_DRIFT_SPEED_BONUS; // +20% max speed bonus
  }
  if (input.isNitroActive) {
    speedBonusMultiplier += 0.22;
  }
  if (input.abilityNitroActive) {
    speedBonusMultiplier += 0.5; // +50% max speed bonus from Nitro ability
  }
  if (input.dashActive) {
    speedBonusMultiplier += 0.72; // rapid forward surge during 1.2s Lightning Dash
  }
  if (input.slowActive) {
    speedBonusMultiplier *= 0.52; // Spike Trap 2s speed reduction
  }

  const effectiveMaxSpeedMps =
    (spec.maxSpeedKmh / MPS_TO_KMH) * speedBonusMultiplier * (input.isOffroad ? 0.88 : 1.0);
  const reverseMaxMps = spec.reverseMaxKmh / MPS_TO_KMH;

  const steerMaxRad = 0.52;
  const wheelSteerAngle = input.steerInput * steerMaxRad;

  // Airborne directional control (smooth yaw + gentle air thrust trim)
  if (!input.isGrounded) {
    return {
      forwardAccel: input.throttle * 3.5 - input.brake * 3.0 + (input.dashActive ? 14 : 0),
      lateralGripDecel: -input.lateralSpeed * 0.4,
      yawRate: input.steerInput * 1.45 * spec.steerResponsiveness,
      wheelSteerAngle,
      slipRatio: 0,
      effectiveMaxSpeedMps,
    };
  }

  let forwardAccel = 0;

  if (input.dashActive) {
    const speedRatio = Math.max(0, input.forwardSpeed / effectiveMaxSpeedMps);
    const dashCurve = Math.max(0.15, 1 - speedRatio * 0.8);
    forwardAccel += spec.accelForce * 2.35 * dashCurve;
    if (input.forwardSpeed > effectiveMaxSpeedMps) {
      forwardAccel = -(input.forwardSpeed - effectiveMaxSpeedMps) * 5.0;
    }
  } else if (input.throttle > 0) {
    const speedRatio = Math.max(0, input.forwardSpeed / effectiveMaxSpeedMps);
    const torqueCurve = Math.max(0.08, 1 - speedRatio * 0.88);
    const boostAccel =
      (input.isNitroActive ? 1.45 : 1.0) *
      (input.driftBoostActive ? 1.35 : 1.0) *
      (input.abilityNitroActive ? 1.65 : 1.0) *
      (input.slowActive ? 0.55 : 1.0);
    forwardAccel +=
      input.throttle * spec.accelForce * torqueCurve * boostAccel * offroadScale;
    // Soft speed limiter if above max speed
    if (input.forwardSpeed > effectiveMaxSpeedMps) {
      forwardAccel = -(input.forwardSpeed - effectiveMaxSpeedMps) * 5.0;
    }
  } else if (input.driftBoostActive || input.abilityNitroActive) {
    // Drift / Nitro ability gently propels forward even on release
    forwardAccel += spec.accelForce * (input.abilityNitroActive ? 0.95 : 0.65);
  }

  if (input.brake > 0) {
    if (input.forwardSpeed > 1.2) {
      forwardAccel -= input.brake * spec.brakeForce;
    } else if (input.forwardSpeed > -reverseMaxMps) {
      forwardAccel -= input.brake * (spec.accelForce * 0.72);
    }
  }

  // Natural rolling resistance when coasting
  if (input.throttle === 0 && input.brake === 0 && !input.driftBoostActive) {
    const drag = input.isOffroad ? 1.45 : 0.85;
    forwardAccel -= input.forwardSpeed * drag;
  }

  // Slight speed scrub on handbrake unless boosting
  const activeControlledDrift =
    input.isDrifting && Math.abs(input.steerInput) > 0.12 && Math.abs(input.forwardSpeed) > 4;
  if (activeControlledDrift && !input.driftBoostActive) {
    forwardAccel -= Math.sign(input.forwardSpeed) * 1.6;
  }

  // Speed-sensitive steering (prevents uncontrollable twitching at 190 km/h while feeling responsive at low/mid speed)
  const absSpeed = Math.abs(input.forwardSpeed);
  const speedFactor =
    absSpeed < 0.7 ? 0 : Math.min(1, (absSpeed - 0.7) / 6.5);
  const reverseSign = input.forwardSpeed >= -0.3 ? 1 : -1;
  const highSpeedDamp = Math.max(0.46, 1 - absSpeed / 78);
  const driftTurnBonus = activeControlledDrift ? spec.driftTurnRate : 1.0;

  const yawRate =
    input.steerInput *
    2.45 *
    spec.steerResponsiveness *
    speedFactor *
    reverseSign *
    driftTurnBonus *
    highSpeedDamp;

  // Lateral grip: rear grip loosens smoothly during handbrake drift, stays planted otherwise
  const gripStiffness = activeControlledDrift
    ? spec.lateralGrip * spec.driftGripFactor * offroadScale
    : spec.lateralGrip * offroadScale;
  const lateralGripDecel = -input.lateralSpeed * gripStiffness;

  const slipRatio = Math.min(
    1,
    Math.abs(input.lateralSpeed) / Math.max(5.5, absSpeed * 0.55),
  );

  return {
    forwardAccel,
    lateralGripDecel,
    yawRate,
    wheelSteerAngle,
    slipRatio,
    effectiveMaxSpeedMps,
  };
}

export function updateDriftState(
  prev: DriftState,
  forwardSpeedMps: number,
  lateralSpeedMps: number,
  steerInput: number,
  driftHeld: boolean,
  isGrounded: boolean,
  dt: number,
): { next: DriftState; nitroEarned: number; boostTriggered: boolean } {
  const absForward = Math.abs(forwardSpeedMps);
  const absLateral = Math.abs(lateralSpeedMps);
  const hasSteer = Math.abs(steerInput) >= 0.15;

  // Require >= 35 km/h forward speed, active steering angle, and real sideways slip (prevents donut spin charging in place)
  const isMeaningfulDrift =
    isGrounded &&
    driftHeld &&
    hasSteer &&
    absForward >= MIN_DRIFT_SPEED_MPS &&
    absLateral >= 2.0;

  let nextCharge = prev.driftCharge;
  let nextBoost = Math.max(0, prev.driftBoostRemaining - dt);
  let nextScore = prev.driftScore;
  let nitroEarned = 0;
  let boostTriggered = false;

  if (isMeaningfulDrift) {
    const chargeGain = DRIFT_CHARGE_RATE_PER_SEC * dt; // 20% per second
    nextCharge = Math.min(100, prev.driftCharge + chargeGain);
    const mult = nextCharge >= 75 ? 4 : nextCharge >= 50 ? 3 : nextCharge >= 25 ? 2 : 1;
    nextScore += Math.round(absLateral * 10 * mult * dt);
    nitroEarned = chargeGain * 0.3;
    return {
      next: {
        isDrifting: true,
        driftCharge: nextCharge,
        driftBoostRemaining: nextBoost,
        driftMultiplier: mult,
        driftScore: nextScore,
        wasDriftHeld: true,
      },
      nitroEarned,
      boostTriggered: false,
    };
  }

  // On drift release: convert sufficient charge (>= 15%) into boost (up to 3.0 seconds)
  if (!driftHeld && prev.wasDriftHeld && prev.driftCharge >= 15) {
    const duration = (prev.driftCharge / 100) * MAX_DRIFT_BOOST_SECONDS;
    nextBoost = Math.max(nextBoost, duration);
    nextCharge = 0;
    boostTriggered = true;
  } else if (!driftHeld) {
    nextCharge = Math.max(0, prev.driftCharge - 35 * dt);
  }

  const mult = nextCharge >= 75 ? 4 : nextCharge >= 50 ? 3 : nextCharge >= 25 ? 2 : 1;

  return {
    next: {
      isDrifting: false,
      driftCharge: nextCharge,
      driftBoostRemaining: nextBoost,
      driftMultiplier: mult,
      driftScore: nextScore,
      wasDriftHeld: driftHeld,
    },
    nitroEarned: 0,
    boostTriggered,
  };
}

/**
 * Exact collision damage curve from relative impact speed (km/h):
 * - Below 25 km/h: 0 HP
 * - 25-44 km/h: 5 HP
 * - 45-69 km/h: 10 HP
 * - 70+ km/h: 15 HP
 * Scaled by vehicle collisionResistance, attacker ramMultiplier, and active shield.
 */
export function computeCollisionDamage(
  relativeImpactSpeedMps: number,
  shieldActive: boolean,
  defenderVehicleId: VehicleId = 'street_rs',
  attackerRamMultiplier = 1.0,
): number {
  const impactKmh = Math.abs(relativeImpactSpeedMps) * MPS_TO_KMH;
  let baseDmg = 0;
  if (impactKmh < 25) {
    return 0;
  } else if (impactKmh < 45) {
    baseDmg = 5;
  } else if (impactKmh < 70) {
    baseDmg = 10;
  } else {
    baseDmg = 15;
  }

  const resistance = VEHICLE_CONFIGS[defenderVehicleId].collisionResistance;
  const scaled = (baseDmg * attackerRamMultiplier) / resistance;
  const finalDmg = shieldActive ? scaled * 0.25 : scaled;
  return Math.max(1, Math.round(finalDmg));
}

export function evaluateMatchOutcome(params: {
  playerHp: number;
  countdownSeconds: number;
  rivalsAlive: number;
  rivalsTotal: number;
  mode: 'survival' | 'freedrive';
}): 'none' | 'victory' | 'timeup' | 'wrecked' {
  if (params.playerHp <= 0) return 'wrecked';
  if (
    params.mode === 'survival' &&
    params.rivalsTotal > 0 &&
    params.rivalsAlive <= 0
  ) {
    return 'victory';
  }
  if (params.countdownSeconds <= 0) {
    return params.mode === 'survival' && params.rivalsAlive === 0
      ? 'victory'
      : 'timeup';
  }
  return 'none';
}
