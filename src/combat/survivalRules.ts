import type { SafeZoneState } from '../types/game.ts';

export const SURVIVAL_TARGET_DURATION_SEC = 420; // 7 minutes
export const START_COUNTDOWN_SEC = 5;
export const SPAWN_PROTECTION_SEC = 15;
export const PICKUP_START_DELAY_SEC = 8;

// Phase timestamps in seconds of active match time
const PHASE_1_END = 150; // 2:30
const PHASE_2_END = 240; // 4:00
const PHASE_3_END = 330; // 5:30
const PHASE_4_END = 390; // 6:30
const PHASE_5_END = 420; // 7:00

const FULL_RADIUS = 425; // Covers all corners of 600x600 arena
const BOUNDARY_START_RADIUS = 338; // Inscribed/circumscribed start edge
const AREA_50_RADIUS = 239; // pi * 239^2 ~= 179,450 m^2 (~50% of 360,000 m^2)
const AREA_25_RADIUS = 169; // pi * 169^2 ~= 89,727 m^2 (~25% of 360,000 m^2)
const FINAL_SMALL_RADIUS = 68;
const SUDDEN_DEATH_MIN_RADIUS = 28;

function lerp(a: number, b: number, t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return a + (b - a) * u;
}

export function evaluateSafeZone(matchElapsedSec: number): SafeZoneState {
  const t = Math.max(0, matchElapsedSec);

  // 0:00 – 2:30: Full Arena (with 10-second warning at 2:20 – 2:30)
  if (t < PHASE_1_END) {
    const secsUntilClose = Math.ceil(PHASE_1_END - t);
    const warningText =
      secsUntilClose <= 10
        ? `BOUNDARY CLOSING IN ${secsUntilClose}s`
        : null;
    return {
      phaseIndex: 1,
      phaseLabel: 'Phase 1 · Full Arena',
      radiusMeters: FULL_RADIUS,
      targetRadiusMeters: AREA_50_RADIUS,
      areaPercent: 100,
      warningText,
      damagePerTick: 0,
      tickIntervalSec: 2,
      isSuddenDeath: false,
      outsideWarning: false,
    };
  }

  // 2:30 – 4:00: Closing outer boundary -> 50% safe area (5 HP every 2s outside)
  if (t < PHASE_2_END) {
    const p = (t - PHASE_1_END) / (PHASE_2_END - PHASE_1_END);
    const r = lerp(BOUNDARY_START_RADIUS, AREA_50_RADIUS, p);
    return {
      phaseIndex: 2,
      phaseLabel: 'Phase 2 · Outer Closing',
      radiusMeters: Number(r.toFixed(1)),
      targetRadiusMeters: AREA_50_RADIUS,
      areaPercent: Math.round(lerp(100, 50, p)),
      warningText: null,
      damagePerTick: 5,
      tickIntervalSec: 2,
      isSuddenDeath: false,
      outsideWarning: false,
    };
  }

  // 4:00 – 5:30: 50% -> 25% safe area (5 HP every 2s outside)
  if (t < PHASE_3_END) {
    const p = (t - PHASE_2_END) / (PHASE_3_END - PHASE_2_END);
    const r = lerp(AREA_50_RADIUS, AREA_25_RADIUS, p);
    return {
      phaseIndex: 3,
      phaseLabel: 'Phase 3 · 50% Sector',
      radiusMeters: Number(r.toFixed(1)),
      targetRadiusMeters: AREA_25_RADIUS,
      areaPercent: Math.round(lerp(50, 25, p)),
      warningText: null,
      damagePerTick: 5,
      tickIntervalSec: 2,
      isSuddenDeath: false,
      outsideWarning: false,
    };
  }

  // 5:30 – 6:30: 25% -> Final Small Arena (5 HP every 2s outside)
  if (t < PHASE_4_END) {
    const p = (t - PHASE_3_END) / (PHASE_4_END - PHASE_3_END);
    const r = lerp(AREA_25_RADIUS, FINAL_SMALL_RADIUS, p);
    const secsUntilFinal = Math.ceil(PHASE_4_END - t);
    return {
      phaseIndex: 4,
      phaseLabel: 'Phase 4 · 25% Sector',
      radiusMeters: Number(r.toFixed(1)),
      targetRadiusMeters: FINAL_SMALL_RADIUS,
      areaPercent: Math.round(lerp(25, 10, p)),
      warningText:
        secsUntilFinal <= 10
          ? `FINAL ARENA DAMAGE (10 HP/s) IN ${secsUntilFinal}s`
          : null,
      damagePerTick: 5,
      tickIntervalSec: 2,
      isSuddenDeath: false,
      outsideWarning: false,
    };
  }

  // 6:30 – 7:00: Final Small Arena (10 HP per second outside)
  if (t < PHASE_5_END) {
    const p = (t - PHASE_4_END) / (PHASE_5_END - PHASE_4_END);
    const r = lerp(FINAL_SMALL_RADIUS, 48, p);
    return {
      phaseIndex: 5,
      phaseLabel: 'Phase 5 · Final Arena',
      radiusMeters: Number(r.toFixed(1)),
      targetRadiusMeters: 48,
      areaPercent: Math.round(lerp(10, 5, p)),
      warningText: 'FINAL ARENA — 10 HP/s OUTSIDE SAFE ZONE',
      damagePerTick: 10,
      tickIntervalSec: 1,
      isSuddenDeath: false,
      outsideWarning: false,
    };
  }

  // 7:00+: Sudden Death until 1 survivor remains
  const sdElapsed = t - PHASE_5_END;
  const r = lerp(48, SUDDEN_DEATH_MIN_RADIUS, Math.min(1, sdElapsed / 45));
  return {
    phaseIndex: 6,
    phaseLabel: 'SUDDEN DEATH',
    radiusMeters: Number(r.toFixed(1)),
    targetRadiusMeters: SUDDEN_DEATH_MIN_RADIUS,
    areaPercent: 3,
    warningText: 'SUDDEN DEATH — LAST CAR STANDING',
    damagePerTick: 10,
    tickIntervalSec: 1,
    isSuddenDeath: true,
    outsideWarning: false,
  };
}

export function isOutsideSafeZone(
  x: number,
  z: number,
  radiusMeters: number,
): boolean {
  return Math.hypot(x, z) > radiusMeters;
}

export function evaluateSurvivalMatchResult(params: {
  mode: 'survival' | 'freedrive';
  aliveCarsCount: number;
  playerAlive: boolean;
  spectating: boolean;
  matchElapsedSec: number;
}): 'none' | 'victory' | 'wrecked' | 'timeup' {
  if (params.mode === 'freedrive') {
    if (!params.playerAlive) return 'wrecked';
    if (params.matchElapsedSec >= SURVIVAL_TARGET_DURATION_SEC) return 'timeup';
    return 'none';
  }

  // Survival mode: last living car wins (sudden death continues past 7:00 if >1 alive!)
  if (params.aliveCarsCount <= 1) {
    return params.playerAlive ? 'victory' : 'wrecked';
  }

  // If player died while >= 2 cars remain, stay in spectator unless player exits or AI finishes!
  if (!params.playerAlive && !params.spectating) {
    return 'wrecked';
  }

  return 'none';
}
