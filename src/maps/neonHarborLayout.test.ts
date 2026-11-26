import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialTrainSchedule,
  DRAWBRIDGE_TOTAL_CYCLE,
  evaluateDrawbridgeState,
  getDistrictAt,
  PICKUP_CANDIDATE_ZONES,
  PLAYER_SPAWN_POINTS,
  stepTrainSchedule,
} from './neonHarborLayout';

test('all 8 player spawn points are within 600x600 world and at least 40m apart', () => {
  assert.equal(PLAYER_SPAWN_POINTS.length, 8);
  for (let i = 0; i < PLAYER_SPAWN_POINTS.length; i++) {
    const a = PLAYER_SPAWN_POINTS[i];
    assert.ok(Math.abs(a.x) < 295 && Math.abs(a.z) < 295);
    for (let j = i + 1; j < PLAYER_SPAWN_POINTS.length; j++) {
      const b = PLAYER_SPAWN_POINTS[j];
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      assert.ok(dist >= 40, `Spawns ${i} and ${j} too close: ${dist}m`);
    }
  }
});

test('25-40 hidden pickup candidate zones exist and cover all 5 districts', () => {
  assert.ok(PICKUP_CANDIDATE_ZONES.length >= 25 && PICKUP_CANDIDATE_ZONES.length <= 40);
  const covered = new Set(PICKUP_CANDIDATE_ZONES.map((z) => z.district));
  assert.equal(covered.size, 5);
});

test('getDistrictAt maps coordinates to all 5 Neon Harbor districts', () => {
  assert.equal(getDistrictAt(0, 0), 'downtown');
  assert.equal(getDistrictAt(-50, -180), 'mountain');
  assert.equal(getDistrictAt(165, 0), 'harbor');
  assert.equal(getDistrictAt(195, 190), 'railway');
  assert.equal(getDistrictAt(-200, 120), 'stunt');
});

test('drawbridge follows 75s closed -> 5s warning -> 5s opening -> 10s open -> 5s closing cycle', () => {
  assert.equal(DRAWBRIDGE_TOTAL_CYCLE, 100);
  assert.equal(evaluateDrawbridgeState(10).phase, 'closed');
  assert.equal(evaluateDrawbridgeState(10).roadBlocked, false);
  assert.equal(evaluateDrawbridgeState(76).phase, 'warning');
  assert.equal(evaluateDrawbridgeState(82).phase, 'opening');
  assert.equal(evaluateDrawbridgeState(82).roadBlocked, true);
  assert.equal(evaluateDrawbridgeState(90).phase, 'open');
  assert.equal(evaluateDrawbridgeState(90).openAmount, 1);
  assert.equal(evaluateDrawbridgeState(97).phase, 'closing');
});

test('freight train schedule cycles warning (5s) -> closing (3s) -> passing (6s) -> clearing (2s)', () => {
  let state = createInitialTrainSchedule();
  // Fast-forward past initial idle
  state = stepTrainSchedule(state, 19, () => 0.5);
  assert.equal(state.phase, 'warning');
  state = stepTrainSchedule(state, 5.1, () => 0.5);
  assert.equal(state.phase, 'closing');
  state = stepTrainSchedule(state, 3.1, () => 0.5);
  assert.equal(state.phase, 'passing');
  assert.equal(state.trainActive, true);
  state = stepTrainSchedule(state, 6.1, () => 0.5);
  assert.equal(state.phase, 'clearing');
  state = stepTrainSchedule(state, 2.1, () => 0.5);
  assert.equal(state.phase, 'idle');
  assert.ok(state.idleInterval >= 50 && state.idleInterval <= 60);
});
