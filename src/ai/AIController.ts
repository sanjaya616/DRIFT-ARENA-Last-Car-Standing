import * as THREE from 'three';
import type { CarController } from '../cars/CarController';
import type { ActivePowerUp } from '../powerups/PowerUpSystem';
import type { DifficultyLevel, InputState, TrainPhase } from '../types/game';

export type AIPolicy = 'drifter' | 'rammer' | 'flanker';

export type AIStateName =
  | 'explore'
  | 'pickup'
  | 'pursue'
  | 'attack'
  | 'escape'
  | 'avoid_hazard'
  | 'use_ability'
  | 'recover';

interface AIProfile {
  policy: AIPolicy;
  state: AIStateName;
  waypointIndex: number;
  stuckTimer: number;
  reverseTimer: number;
  lastPos: THREE.Vector3;
  attackTimer: number;
  reactionMistakeTimer: number;
  mistakeSteerOffset: number;
}

const NEON_HARBOR_WAYPOINTS = [
  { x: 0, z: -76 },
  { x: 76, z: -76 },
  { x: 118, z: -45 },
  { x: 118, z: 0 },
  { x: 235, z: 0 },
  { x: 235, z: 135 },
  { x: 115, z: 135 },
  { x: 115, z: 225 },
  { x: 0, z: 225 },
  { x: -120, z: 225 },
  { x: -120, z: 145 },
  { x: -120, z: 0 },
  { x: -76, z: 0 },
  { x: -76, z: -76 },
];

const _quat = new THREE.Quaternion();
const _forward = new THREE.Vector3();
const _toTarget = new THREE.Vector3();

function pickupPriority(kind: ActivePowerUp['kind'], hp: number): number {
  if (hp < 45 && (kind === 'shield' || kind === 'armor')) return 2.4;
  switch (kind) {
    case 'rocket':
    case 'shield':
      return 2.0;
    case 'nitro':
    case 'bomb':
    case 'armor':
      return 1.65;
    case 'lightning_dash':
    case 'punch':
      return 1.45;
    default:
      return 1.0;
  }
}

export class AIController {
  private profiles = new Map<string, AIProfile>();

  public registerCar(car: CarController, policy: AIPolicy, startWp: number): void {
    const p = car.body.translation();
    this.profiles.set(car.id, {
      policy,
      state: 'explore',
      waypointIndex: startWp % NEON_HARBOR_WAYPOINTS.length,
      stuckTimer: 0,
      reverseTimer: 0,
      lastPos: new THREE.Vector3(p.x, p.y, p.z),
      attackTimer: 1.5 + Math.random() * 2.5,
      reactionMistakeTimer: 0,
      mistakeSteerOffset: 0,
    });
  }

  public clear(): void {
    this.profiles.clear();
  }

  public computeInput(
    car: CarController,
    allCars: CarController[],
    pickups: ActivePowerUp[],
    hazards: Array<{ kind: string; x: number; z: number }>,
    worldContext: {
      difficulty: DifficultyLevel;
      safeZoneRadiusMeters: number;
      drawbridgeOpenAmount: number;
      trainPhase: TrainPhase;
      trainZ: number;
    },
    dt: number,
  ): InputState {
    const prof = this.profiles.get(car.id);
    if (!prof || !car.alive) {
      return {
        throttle: 0,
        brake: 0,
        steer: 0,
        drift: false,
        nitro: false,
        jumpBuffered: false,
        weaponTriggered: false,
        abilityTriggered: false,
        recoverTriggered: false,
        pauseTriggered: false,
      };
    }

    const diff = worldContext.difficulty;
    const pos = car.body.translation();
    const rot = car.body.rotation();
    _quat.set(rot.x, rot.y, rot.z, rot.w);
    _forward.set(0, 0, -1).applyQuaternion(_quat).normalize();

    // 1. Stuck -> Recover state
    const movedDistSq =
      (pos.x - prof.lastPos.x) ** 2 + (pos.z - prof.lastPos.z) ** 2;
    prof.lastPos.set(pos.x, pos.y, pos.z);
    if (movedDistSq < 0.002) {
      prof.stuckTimer += dt;
      if (prof.stuckTimer > 1.1) {
        prof.reverseTimer = 0.85;
        prof.stuckTimer = 0;
        prof.state = 'recover';
      }
    } else {
      prof.stuckTimer = Math.max(0, prof.stuckTimer - dt * 2);
    }

    if (prof.reverseTimer > 0) {
      prof.reverseTimer -= dt;
      return {
        throttle: 0,
        brake: 1,
        steer: prof.policy === 'flanker' ? -1 : 1,
        drift: false,
        nitro: false,
        jumpBuffered: false,
        weaponTriggered: false,
        abilityTriggered: false,
        recoverTriggered: false,
        pauseTriggered: false,
      };
    }

    // Occasional mild steering inaccuracy on Easy mode
    if (diff === 'easy') {
      prof.reactionMistakeTimer -= dt;
      if (prof.reactionMistakeTimer <= 0) {
        prof.reactionMistakeTimer = 1.8 + Math.random() * 1.5;
        prof.mistakeSteerOffset = (Math.random() - 0.5) * 0.45;
      }
    } else {
      prof.mistakeSteerOffset = 0;
    }

    // Find nearest living opponent (treat player & other AIs fairly!)
    let nearestEnemy: CarController | null = null;
    let nearestEnemyDist = Infinity;
    for (const other of allCars) {
      if (!other.alive || other.id === car.id) continue;
      const op = other.body.translation();
      const d = Math.hypot(op.x - pos.x, op.z - pos.z);
      if (d < nearestEnemyDist) {
        nearestEnemyDist = d;
        nearestEnemy = other;
      }
    }

    // Find nearby danger hazard (mines/bombs/spikes, train, safe zone edge, river)
    const distFromOrigin = Math.hypot(pos.x, pos.z);
    const outsideSafeZone = distFromOrigin > worldContext.safeZoneRadiusMeters - 10;
    let nearHazard: { x: number; z: number } | null = null;
    for (const haz of hazards) {
      if (Math.hypot(haz.x - pos.x, haz.z - pos.z) < 16) {
        nearHazard = haz;
        break;
      }
    }
    const nearTrainTrack =
      (worldContext.trainPhase === 'closing' || worldContext.trainPhase === 'passing') &&
      Math.abs(pos.x - 195) < 12 &&
      Math.abs(pos.z - worldContext.trainZ) < 42;

    // 2. State Decision (8-state FSM)
    let targetX = 0;
    let targetZ = 0;

    if (outsideSafeZone || nearHazard || nearTrainTrack) {
      prof.state = 'avoid_hazard';
      if (outsideSafeZone) {
        // Steer inward toward safe zone center
        targetX = 0;
        targetZ = 0;
      } else if (nearTrainTrack) {
        targetX = pos.x < 195 ? 160 : 230;
        targetZ = pos.z;
      } else if (nearHazard) {
        // Steer away from hazard
        targetX = pos.x + (pos.x - nearHazard.x) * 2.5;
        targetZ = pos.z + (pos.z - nearHazard.z) * 2.5;
      }
    } else if (car.hp <= 28 && nearestEnemy && nearestEnemyDist < 60) {
      prof.state = 'escape';
      const ep = nearestEnemy.body.translation();
      targetX = THREE.MathUtils.clamp(pos.x + (pos.x - ep.x) * 2, -250, 250);
      targetZ = THREE.MathUtils.clamp(pos.z + (pos.z - ep.z) * 2, -250, 250);
    } else {
      // Check attractive nearby pickup
      let bestPickup: ActivePowerUp | null = null;
      let bestPickupScore = -Infinity;
      for (const pu of pickups) {
        if (Math.hypot(pu.x, pu.z) > worldContext.safeZoneRadiusMeters - 8) continue;
        const d = Math.hypot(pu.x - pos.x, pu.z - pos.z);
        if (d > (diff === 'hard' ? 115 : 85)) continue;
        const weight = diff === 'hard' ? pickupPriority(pu.kind, car.hp) : 1.0;
        const needsWeapon = !car.equippedWeapon;
        const score = (weight * (needsWeapon ? 1.35 : 1.0)) / Math.max(10, d);
        if (score > bestPickupScore) {
          bestPickupScore = score;
          bestPickup = pu;
        }
      }

      if (bestPickup && (!car.equippedWeapon || !car.equippedAbility || Math.hypot(bestPickup.x - pos.x, bestPickup.z - pos.z) < 42)) {
        prof.state = 'pickup';
        targetX = bestPickup.x;
        targetZ = bestPickup.z;
      } else if (nearestEnemy && nearestEnemyDist < (prof.policy === 'rammer' ? 140 : 105)) {
        const ep = nearestEnemy.body.translation();
        if (nearestEnemyDist < 42 && car.equippedWeapon) {
          prof.state = 'attack';
        } else {
          prof.state = 'pursue';
        }
        if (prof.policy === 'flanker') {
          const angle = Math.atan2(pos.z - ep.z, pos.x - ep.x) + 0.75;
          targetX = THREE.MathUtils.clamp(ep.x + Math.cos(angle) * 18, -260, 260);
          targetZ = THREE.MathUtils.clamp(ep.z + Math.sin(angle) * 18, -260, 260);
        } else {
          targetX = ep.x;
          targetZ = ep.z;
        }
      } else {
        prof.state = 'explore';
        // Choose waypoint inside current safe zone
        let wp = NEON_HARBOR_WAYPOINTS[prof.waypointIndex];
        if (Math.hypot(wp.x, wp.z) > worldContext.safeZoneRadiusMeters - 12) {
          targetX = 0;
          targetZ = 0;
        } else {
          targetX = wp.x;
          targetZ = wp.z;
          const distSq = (pos.x - wp.x) ** 2 + (pos.z - wp.z) ** 2;
          if (distSq < 22 * 22) {
            prof.waypointIndex =
              (prof.waypointIndex + 1) % NEON_HARBOR_WAYPOINTS.length;
          }
        }
      }
    }

    _toTarget.set(targetX - pos.x, 0, targetZ - pos.z);
    const dist = _toTarget.length();
    if (dist > 0.01) _toTarget.divideScalar(dist);

    const crossY = _forward.z * _toTarget.x - _forward.x * _toTarget.z;
    const dot = _forward.x * _toTarget.x + _forward.z * _toTarget.z;
    let steer = THREE.MathUtils.clamp(-crossY * 2.25 + prof.mistakeSteerOffset, -1, 1);
    if (dot < -0.25 && Math.abs(steer) < 0.5) {
      steer = steer >= 0 ? 1 : -1;
    }

    // Center spire monument avoidance (radius ~12m)
    if (pos.x * pos.x + pos.z * pos.z < 12 * 12) {
      steer = crossY >= 0 ? -1 : 1;
    }

    // River / open drawbridge hazard avoidance
    const nearOpenBridge =
      worldContext.drawbridgeOpenAmount > 0.1 &&
      pos.x > 130 &&
      pos.x < 198 &&
      Math.abs(pos.z) < 18;
    const nearWater =
      pos.x > 135 &&
      pos.x < 195 &&
      pos.z < 90 &&
      Math.abs(pos.z) > 12 &&
      Math.abs(pos.z - 55) > 10;
    if (nearOpenBridge || nearWater) {
      steer = pos.x < 165 ? 1 : -1;
    }

    // 3. Weapon trigger
    prof.attackTimer -= dt;
    let weaponTriggered = false;
    if (
      prof.attackTimer <= 0 &&
      car.equippedWeapon &&
      car.equippedWeapon.cooldown <= 0 &&
      nearestEnemy
    ) {
      const ep = nearestEnemy.body.translation();
      _toTarget.set(ep.x - pos.x, 0, ep.z - pos.z);
      const eDist = _toTarget.length();
      if (eDist > 0.01) _toTarget.divideScalar(eDist);
      const aimDot = _forward.dot(_toTarget);
      const kind = car.equippedWeapon.kind;
      const fireDelay = diff === 'easy' ? 3.5 : diff === 'normal' ? 1.8 : 0.85;

      if (kind === 'rocket' && eDist <= 44 && aimDot > (diff === 'hard' ? 0.84 : 0.9)) {
        weaponTriggered = true;
        prof.attackTimer = fireDelay;
      } else if (kind === 'punch' && eDist <= 5.0 && aimDot > 0.65) {
        weaponTriggered = true;
        prof.attackTimer = fireDelay;
      } else if (
        (kind === 'bomb' || kind === 'spike_trap' || kind === 'proximity_mine') &&
        eDist <= 14 &&
        aimDot < 0.1
      ) {
        weaponTriggered = true;
        prof.attackTimer = fireDelay + 1.0;
      }
    }

    // 4. Ability trigger ('use_ability' tactical checks)
    let abilityTriggered = false;
    if (car.equippedAbility && car.equippedAbility.cooldown <= 0) {
      const ak = car.equippedAbility.kind;
      if ((ak === 'shield' || ak === 'armor') && ((nearestEnemy && nearestEnemyDist < 26) || car.hp < 55)) {
        abilityTriggered = true;
      } else if (ak === 'nitro' && dot > 0.85 && dist > 18) {
        abilityTriggered = true;
      } else if (ak === 'lightning_dash' && dot > 0.9 && nearestEnemyDist > 12 && nearestEnemyDist < 40) {
        abilityTriggered = true;
      } else if ((ak === 'super_jump' || ak === 'triple_jump') && (nearHazard || prof.state === 'escape')) {
        abilityTriggered = true;
      }
      if (abilityTriggered) {
        prof.state = 'use_ability';
      }
    }

    const driftThreshold = diff === 'hard' ? 0.62 : 0.72;
    const sharpTurn = Math.abs(steer) > driftThreshold && car.speedKmh > 42;
    const drift = (prof.policy === 'drifter' || diff === 'hard') && sharpTurn;
    const nitro =
      dot > 0.86 &&
      dist > 20 &&
      car.nitro > (diff === 'hard' ? 28 : 45) &&
      diff !== 'easy';

    const baseThrottle =
      diff === 'easy' ? 0.72 : diff === 'normal' ? 0.88 : 0.98;

    return {
      throttle: dot < -0.5 && car.speedKmh > 30 ? 0.32 : baseThrottle,
      brake: 0,
      steer,
      drift,
      nitro,
      jumpBuffered: false,
      weaponTriggered,
      abilityTriggered,
      recoverTriggered: false,
      pauseTriggered: false,
    };
  }
}

