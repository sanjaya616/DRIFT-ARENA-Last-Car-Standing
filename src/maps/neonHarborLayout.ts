import type {
  DistrictId,
  DrawbridgePhase,
  TrainPhase,
} from '../types/game.ts';

export interface SpawnPoint {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  district: DistrictId;
  label: string;
}

export interface PickupCandidateZone {
  id: number;
  x: number;
  y: number;
  z: number;
  district: DistrictId;
}

export interface RoadRect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export const DISTRICT_LABELS: Record<DistrictId, string> = {
  downtown: 'Downtown Core',
  mountain: 'Summit Ridge',
  harbor: 'River & Harbor',
  railway: 'Industrial Railway',
  stunt: 'Stunt Playground',
};

export const DISTRICT_BOUNDS: Array<{
  id: DistrictId;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  color: string;
}> = [
  { id: 'downtown', minX: -90, maxX: 90, minZ: -90, maxZ: 90, color: '#38bdf8' },
  { id: 'mountain', minX: -280, maxX: 160, minZ: -295, maxZ: -90, color: '#a3e635' },
  { id: 'harbor', minX: 90, maxX: 295, minZ: -295, maxZ: 95, color: '#22d3ee' },
  { id: 'railway', minX: 70, maxX: 295, minZ: 95, maxZ: 295, color: '#f59e0b' },
  { id: 'stunt', minX: -295, maxX: 70, minZ: -90, maxZ: 295, color: '#f43f5e' },
];

export function getDistrictAt(x: number, z: number): DistrictId {
  if (x >= -90 && x <= 90 && z >= -90 && z <= 90) return 'downtown';
  if (z < -90 && x < 140) return 'mountain';
  if (x > 90 && z <= 95) return 'harbor';
  if (x >= 70 && z > 95) return 'railway';
  return 'stunt';
}

// Primary connected road rectangles (used for surface grip check + minimap rendering)
export const CONNECTED_ROADS: RoadRect[] = [
  // District 1: Downtown N-S & E-W Boulevards (14m wide) + Downtown Ring (12m wide)
  { x: 0, z: 0, w: 14, d: 180 },
  { x: 0, z: 0, w: 180, d: 14 },
  { x: 0, z: -76, w: 164, d: 12 },
  { x: 0, z: 76, w: 164, d: 12 },
  { x: -76, z: 0, w: 12, d: 164 },
  { x: 76, z: 0, w: 12, d: 164 },
  // Downtown narrow shortcuts
  { x: -38, z: 0, w: 8, d: 152 },
  { x: 38, z: 0, w: 8, d: 152 },

  // District 2: Mountain northern access & outer switchback loop
  { x: 0, z: -155, w: 10, d: 130 },
  { x: -75, z: -220, w: 160, d: 10 },
  { x: -155, z: -155, w: 10, d: 130 },
  { x: -110, z: -140, w: 100, d: 9 },

  // District 3: Harbor & Drawbridge Boulevard (Z = 0 Eastward across river X=135..195)
  { x: 180, z: 0, w: 200, d: 16 },
  { x: 245, z: 5, w: 14, d: 220 },
  { x: 118, z: -45, w: 12, d: 210 },
  { x: 185, z: -145, w: 140, d: 12 },

  // District 4: Industrial Railway Loop & Crossings
  { x: 160, z: 135, w: 180, d: 14 },
  { x: 160, z: 235, w: 180, d: 14 },
  { x: 115, z: 165, w: 14, d: 175 },
  { x: 245, z: 175, w: 14, d: 150 },
  { x: 0, z: 165, w: 14, d: 160 },
  { x: 60, z: 235, w: 130, d: 12 },

  // District 5: Stunt Playground Roads & Connectors
  { x: -185, z: 0, w: 200, d: 14 },
  { x: -185, z: 145, w: 200, d: 14 },
  { x: -245, z: 75, w: 14, d: 280 },
  { x: -120, z: 120, w: 12, d: 220 },
  { x: -125, z: 235, w: 250, d: 14 },
];

export function isOnAsphaltRoad(x: number, z: number): boolean {
  for (const r of CONNECTED_ROADS) {
    if (
      Math.abs(x - r.x) <= r.w * 0.5 + 1.0 &&
      Math.abs(z - r.z) <= r.d * 0.5 + 1.0
    ) {
      return true;
    }
  }
  return false;
}

export interface StaticObstacleAABB {
  id: string;
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  maxY: number;
}

// Shared solid obstacles across Downtown, Mountain, Harbor & Railway so server physics matches 3D geometry
export const STATIC_ARENA_OBSTACLES: StaticObstacleAABB[] = [
  // Downtown Spire
  { id: 'downtown_spire', x: 0, z: 0, halfW: 5.2, halfD: 5.2, maxY: 22 },
  // Downtown Buildings
  { id: 'dt_bldg_0', x: -22, z: -24, halfW: 8, halfD: 9, maxY: 24 },
  { id: 'dt_bldg_1', x: 22, z: -24, halfW: 8, halfD: 9, maxY: 30 },
  { id: 'dt_bldg_2', x: -22, z: 24, halfW: 8, halfD: 9, maxY: 20 },
  { id: 'dt_bldg_3', x: 22, z: 24, halfW: 8, halfD: 9, maxY: 26 },
  { id: 'dt_bldg_4', x: -56, z: -56, halfW: 10, halfD: 10, maxY: 32 },
  { id: 'dt_bldg_5', x: 56, z: -56, halfW: 10, halfD: 10, maxY: 28 },
  { id: 'dt_bldg_6', x: -56, z: 56, halfW: 10, halfD: 10, maxY: 22 },
  { id: 'dt_bldg_7', x: 56, z: 56, halfW: 10, halfD: 10, maxY: 26 },
  { id: 'dt_bldg_8', x: -56, z: -22, halfW: 9, halfD: 7, maxY: 14 },
  { id: 'dt_bldg_9', x: 56, z: 22, halfW: 9, halfD: 7, maxY: 16 },
  // Harbor Warehouses
  { id: 'harbor_wh_1', x: 218, z: -55, halfW: 11, halfD: 16, maxY: 12 },
  { id: 'harbor_wh_2', x: 272, z: 48, halfW: 11, halfD: 14, maxY: 14 },
  // Railway Factories & Warehouses
  { id: 'rail_factory_1', x: 152, z: 185, halfW: 13, halfD: 15, maxY: 16 },
  { id: 'rail_factory_2', x: 225, z: 185, halfW: 10, halfD: 13, maxY: 14 },
  { id: 'rail_wh_3', x: 272, z: 160, halfW: 9, halfD: 16, maxY: 12 },
  // Shipping Containers
  { id: 'container_0', x: 145, z: 108, halfW: 1.6, halfD: 3.75, maxY: 3 },
  { id: 'container_1', x: 150, z: 108, halfW: 1.6, halfD: 3.75, maxY: 3 },
  { id: 'container_3', x: 222, z: 108, halfW: 1.6, halfD: 3.75, maxY: 3 },
  { id: 'container_4', x: 227, z: 108, halfW: 1.6, halfD: 3.75, maxY: 3 },
  { id: 'container_5', x: 145, z: 262, halfW: 1.6, halfD: 3.75, maxY: 3 },
  { id: 'container_6', x: 150, z: 262, halfW: 1.6, halfD: 3.75, maxY: 3 },
  { id: 'container_7', x: 222, z: 262, halfW: 1.6, halfD: 3.75, maxY: 3 },
  // Mountain Rocks
  { id: 'rock_0', x: -42, z: -115, halfW: 2.4, halfD: 2.4, maxY: 3.6 },
  { id: 'rock_1', x: 42, z: -125, halfW: 2.4, halfD: 2.4, maxY: 3.6 },
  { id: 'rock_2', x: -85, z: -175, halfW: 2.4, halfD: 2.4, maxY: 3.6 },
  { id: 'rock_3', x: -45, z: -265, halfW: 2.4, halfD: 2.4, maxY: 3.6 },
  { id: 'rock_4', x: -125, z: -265, halfW: 2.4, halfD: 2.4, maxY: 3.6 },
  { id: 'rock_5', x: -195, z: -215, halfW: 2.4, halfD: 2.4, maxY: 3.6 },
  { id: 'rock_6', x: -215, z: -145, halfW: 2.4, halfD: 2.4, maxY: 3.6 },
  { id: 'rock_7', x: 45, z: -185, halfW: 2.4, halfD: 2.4, maxY: 3.6 },
  { id: 'rock_8', x: 75, z: -245, halfW: 2.4, halfD: 2.4, maxY: 3.6 },
  { id: 'rock_9', x: -255, z: -245, halfW: 2.4, halfD: 2.4, maxY: 3.6 },
  { id: 'rock_10', x: -265, z: -115, halfW: 2.4, halfD: 2.4, maxY: 3.6 },
  { id: 'rock_11', x: -195, z: -55, halfW: 2.4, halfD: 2.4, maxY: 3.6 },
];

// 8 Spaced Player Starting Positions (>= 40m apart, obstacle-free)
export const PLAYER_SPAWN_POINTS: SpawnPoint[] = [
  { id: 0, x: -48, y: 0.15, z: 76, yaw: -Math.PI / 2, district: 'downtown', label: 'Downtown South Ave' },
  { id: 1, x: -76, y: 0.15, z: -20, yaw: 0, district: 'downtown', label: 'Downtown West Plaza' },
  { id: 2, x: 0, y: 0.15, z: -112, yaw: 0, district: 'mountain', label: 'Mountain Base Gate' },
  { id: 3, x: -155, y: 0.15, z: -185, yaw: Math.PI, district: 'mountain', label: 'Mountain Downhill Entry' },
  { id: 4, x: 118, y: 0.15, z: 0, yaw: -Math.PI / 2, district: 'harbor', label: 'Harbor Drawbridge Approach' },
  { id: 5, x: 245, y: 0.15, z: -65, yaw: Math.PI, district: 'harbor', label: 'East Pier Dock' },
  { id: 6, x: 140, y: 0.15, z: 135, yaw: -Math.PI / 2, district: 'railway', label: 'Railway North Crossing' },
  { id: 7, x: -165, y: 0.15, z: 0, yaw: Math.PI / 2, district: 'stunt', label: 'Stunt Park East Gate' },
];

// 32 Hidden Candidate Pickup Spawn Zones distributed across all 5 districts
export const PICKUP_CANDIDATE_ZONES: PickupCandidateZone[] = [
  // Downtown (8)
  { id: 0, x: 0, y: 0.1, z: -24, district: 'downtown' },
  { id: 1, x: 0, y: 0.1, z: 24, district: 'downtown' },
  { id: 2, x: -24, y: 0.1, z: 0, district: 'downtown' },
  { id: 3, x: 24, y: 0.1, z: 0, district: 'downtown' },
  { id: 4, x: -76, y: 0.1, z: -76, district: 'downtown' },
  { id: 5, x: 76, y: 0.1, z: -76, district: 'downtown' },
  { id: 6, x: -76, y: 0.1, z: 76, district: 'downtown' },
  { id: 7, x: 76, y: 0.1, z: 76, district: 'downtown' },
  // Mountain (6)
  { id: 8, x: 0, y: 0.1, z: -155, district: 'mountain' },
  { id: 9, x: -35, y: 5.5, z: -220, district: 'mountain' },
  { id: 10, x: -105, y: 9.5, z: -220, district: 'mountain' },
  { id: 11, x: -155, y: 6.5, z: -185, district: 'mountain' },
  { id: 12, x: -110, y: 0.1, z: -140, district: 'mountain' },
  { id: 13, x: -55, y: 0.1, z: -140, district: 'mountain' },
  // River & Harbor (6)
  { id: 14, x: 118, y: 0.1, z: -45, district: 'harbor' },
  { id: 15, x: 165, y: 0.4, z: 0, district: 'harbor' },
  { id: 16, x: 245, y: 0.1, z: 0, district: 'harbor' },
  { id: 17, x: 245, y: 0.1, z: -110, district: 'harbor' },
  { id: 18, x: 195, y: 0.1, z: -145, district: 'harbor' },
  { id: 19, x: 245, y: 0.1, z: 65, district: 'harbor' },
  // Industrial Railway (6)
  { id: 20, x: 115, y: 0.1, z: 135, district: 'railway' },
  { id: 21, x: 185, y: 0.1, z: 135, district: 'railway' },
  { id: 22, x: 245, y: 0.1, z: 185, district: 'railway' },
  { id: 23, x: 185, y: 0.1, z: 235, district: 'railway' },
  { id: 24, x: 115, y: 0.1, z: 235, district: 'railway' },
  { id: 25, x: 45, y: 0.1, z: 235, district: 'railway' },
  // Stunt Playground (6)
  { id: 26, x: -120, y: 0.1, z: 45, district: 'stunt' },
  { id: 27, x: -185, y: 0.1, z: 0, district: 'stunt' },
  { id: 28, x: -245, y: 0.1, z: 75, district: 'stunt' },
  { id: 29, x: -185, y: 0.1, z: 145, district: 'stunt' },
  { id: 30, x: -245, y: 0.1, z: 235, district: 'stunt' },
  { id: 31, x: -120, y: 0.1, z: 235, district: 'stunt' },
];

// Drawbridge timing cycle:
// 75s closed -> 5s warning -> 5s opening -> 10s open -> 5s closing (total = 100s)
export const DRAWBRIDGE_TIMINGS = {
  closed: 75,
  warning: 5,
  opening: 5,
  open: 10,
  closing: 5,
} as const;

export const DRAWBRIDGE_TOTAL_CYCLE =
  DRAWBRIDGE_TIMINGS.closed +
  DRAWBRIDGE_TIMINGS.warning +
  DRAWBRIDGE_TIMINGS.opening +
  DRAWBRIDGE_TIMINGS.open +
  DRAWBRIDGE_TIMINGS.closing;

export function evaluateDrawbridgeState(cycleTimeSec: number): {
  phase: DrawbridgePhase;
  openAmount: number; // 0 = flat closed, 1 = fully raised
  roadBlocked: boolean;
} {
  const t = ((cycleTimeSec % DRAWBRIDGE_TOTAL_CYCLE) + DRAWBRIDGE_TOTAL_CYCLE) % DRAWBRIDGE_TOTAL_CYCLE;

  if (t < DRAWBRIDGE_TIMINGS.closed) {
    return { phase: 'closed', openAmount: 0, roadBlocked: false };
  }
  const t1 = t - DRAWBRIDGE_TIMINGS.closed;
  if (t1 < DRAWBRIDGE_TIMINGS.warning) {
    return { phase: 'warning', openAmount: 0, roadBlocked: false };
  }
  const t2 = t1 - DRAWBRIDGE_TIMINGS.warning;
  if (t2 < DRAWBRIDGE_TIMINGS.opening) {
    return {
      phase: 'opening',
      openAmount: t2 / DRAWBRIDGE_TIMINGS.opening,
      roadBlocked: true,
    };
  }
  const t3 = t2 - DRAWBRIDGE_TIMINGS.opening;
  if (t3 < DRAWBRIDGE_TIMINGS.open) {
    return { phase: 'open', openAmount: 1, roadBlocked: true };
  }
  const t4 = t3 - DRAWBRIDGE_TIMINGS.open;
  return {
    phase: 'closing',
    openAmount: Math.max(0, 1 - t4 / DRAWBRIDGE_TIMINGS.closing),
    roadBlocked: true,
  };
}

// Train timing state machine:
// Repeats every ~55s (±5s randomized) -> 5s warning -> 3s barrier closing -> 6s passing -> 2s clearing
export const TRAIN_TIMINGS = {
  warning: 5,
  closing: 3,
  passing: 6,
  clearing: 2,
} as const;

export interface TrainScheduleState {
  phase: TrainPhase;
  timer: number;
  idleInterval: number;
  barrierClosedAmount: number; // 0 = raised, 1 = lowered
  trainZ: number; // moves across crossings (from +290 down to +70)
  trainActive: boolean;
}

export function createInitialTrainSchedule(): TrainScheduleState {
  return {
    phase: 'idle',
    timer: 18, // First train arrives after 18s so players can observe it without waiting a full minute
    idleInterval: 55,
    barrierClosedAmount: 0,
    trainZ: 340,
    trainActive: false,
  };
}

export function stepTrainSchedule(
  state: TrainScheduleState,
  dt: number,
  randomFn: () => number = Math.random,
): TrainScheduleState {
  let { phase, timer, idleInterval, barrierClosedAmount, trainZ, trainActive } = state;
  timer -= dt;

  if (phase === 'idle') {
    barrierClosedAmount = 0;
    trainActive = false;
    trainZ = 340;
    if (timer <= 0) {
      phase = 'warning';
      timer = TRAIN_TIMINGS.warning;
    }
  } else if (phase === 'warning') {
    barrierClosedAmount = 0;
    trainActive = false;
    if (timer <= 0) {
      phase = 'closing';
      timer = TRAIN_TIMINGS.closing;
    }
  } else if (phase === 'closing') {
    const progress = 1 - Math.max(0, timer) / TRAIN_TIMINGS.closing;
    barrierClosedAmount = progress;
    trainActive = false;
    if (timer <= 0) {
      phase = 'passing';
      timer = TRAIN_TIMINGS.passing;
      trainActive = true;
      trainZ = 310;
    }
  } else if (phase === 'passing') {
    barrierClosedAmount = 1;
    trainActive = true;
    const progress = 1 - Math.max(0, timer) / TRAIN_TIMINGS.passing;
    // Train travels along X = 195 from Z = 310 across both crossings (Z=235 and Z=135) to Z = 65
    trainZ = 310 - progress * 245;
    if (timer <= 0) {
      phase = 'clearing';
      timer = TRAIN_TIMINGS.clearing;
      trainActive = false;
    }
  } else if (phase === 'clearing') {
    barrierClosedAmount = Math.max(0, timer) / TRAIN_TIMINGS.clearing;
    trainActive = false;
    if (timer <= 0) {
      phase = 'idle';
      // 55 seconds ± 5 seconds
      idleInterval = 50 + randomFn() * 10;
      timer = idleInterval;
    }
  }

  return {
    phase,
    timer,
    idleInterval,
    barrierClosedAmount,
    trainZ,
    trainActive,
  };
}
