import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSafeZone,
  evaluateSurvivalMatchResult,
  isOutsideSafeZone,
  SURVIVAL_TARGET_DURATION_SEC,
} from './survivalRules';

test('survival match phases shrink boundary from full -> 50% -> 25% -> final -> sudden death', () => {
  const p1 = evaluateSafeZone(60); // 1:00
  assert.equal(p1.phaseIndex, 1);
  assert.equal(p1.damagePerTick, 0);
  assert.equal(p1.warningText, null);

  // 10s warning before 2:30 (150s)
  const warn = evaluateSafeZone(143);
  assert.equal(warn.phaseIndex, 1);
  assert.ok(warn.warningText?.includes('BOUNDARY CLOSING'));

  // 2:30–4:00: 5 HP every 2s outside
  const p2 = evaluateSafeZone(200);
  assert.equal(p2.phaseIndex, 2);
  assert.equal(p2.damagePerTick, 5);
  assert.equal(p2.tickIntervalSec, 2);

  // 4:00–5:30: 50% -> 25%
  const p3 = evaluateSafeZone(245);
  assert.equal(p3.phaseIndex, 3);
  assert.ok(p3.areaPercent <= 50 && p3.areaPercent >= 25);

  // 5:30–6:30: 25% -> final small
  const p4 = evaluateSafeZone(340);
  assert.equal(p4.phaseIndex, 4);
  assert.ok(p4.areaPercent <= 25);

  // 6:30–7:00: final small arena, 10 HP/s outside
  const p5 = evaluateSafeZone(405);
  assert.equal(p5.phaseIndex, 5);
  assert.equal(p5.damagePerTick, 10);
  assert.equal(p5.tickIntervalSec, 1);

  // >7:00: sudden death until one car remains
  const sd = evaluateSafeZone(SURVIVAL_TARGET_DURATION_SEC + 15);
  assert.equal(sd.phaseIndex, 6);
  assert.equal(sd.isSuddenDeath, true);
  assert.equal(sd.damagePerTick, 10);
});

test('safe zone containment and survival outcome rules', () => {
  assert.equal(isOutsideSafeZone(100, 0, 120), false);
  assert.equal(isOutsideSafeZone(130, 0, 120), true);

  // Sudden death continues past 7 min if > 1 car alive
  assert.equal(
    evaluateSurvivalMatchResult({
      mode: 'survival',
      aliveCarsCount: 2,
      playerAlive: true,
      spectating: false,
      matchElapsedSec: 440,
    }),
    'none',
  );

  // Last car standing wins
  assert.equal(
    evaluateSurvivalMatchResult({
      mode: 'survival',
      aliveCarsCount: 1,
      playerAlive: true,
      spectating: false,
      matchElapsedSec: 300,
    }),
    'victory',
  );

  // Eliminated player watching in spectator stays running until 1 car remains
  assert.equal(
    evaluateSurvivalMatchResult({
      mode: 'survival',
      aliveCarsCount: 3,
      playerAlive: false,
      spectating: true,
      matchElapsedSec: 210,
    }),
    'none',
  );
});
