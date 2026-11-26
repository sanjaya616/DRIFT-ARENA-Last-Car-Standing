import * as THREE from 'three';
import type { CarController } from '../cars/CarController';
import {
  ABILITY_SPECS,
  WEAPON_SPECS,
} from './combatRules';
import type { WeaponKind } from '../types/game';

interface ParticleSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  scale: number;
  color: THREE.Color;
}

interface RocketProjectile {
  active: boolean;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  distanceTraveled: number;
  maxRange: number;
  damage: number;
  blastRadius: number;
  mesh: THREE.Group;
}

export interface ActiveHazard {
  id: string;
  kind: 'bomb' | 'spike_trap' | 'proximity_mine';
  ownerId: string;
  x: number;
  y: number;
  z: number;
  ttl: number;
  armTimer: number;
  radius: number;
  damage: number;
  mesh: THREE.Group;
}

export interface CombatEventCallbacks {
  onWeaponFired?: (car: CarController, kind: WeaponKind) => void;
  onAbilityUsed?: (car: CarController) => void;
  onDamageDealt?: (
    target: CarController,
    attackerId: string,
    damage: number,
    eliminated: boolean,
    x: number,
    z: number,
  ) => void;
  onExplosion?: (x: number, y: number, z: number, radius: number) => void;
}

const MAX_PARTICLES = 280;
const MAX_ROCKETS = 16;
const MAX_SHOCKWAVES = 8;

interface ShockwaveSlot {
  active: boolean;
  life: number;
  maxLife: number;
  maxRadius: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

const _dummy = new THREE.Object3D();
const _quat = new THREE.Quaternion();
const _forward = new THREE.Vector3();

export class CombatSystem {
  private scene: THREE.Scene;
  private particles: ParticleSlot[] = [];
  private particleCursor = 0;
  private instancedParticles: THREE.InstancedMesh;
  private particleGeo: THREE.BufferGeometry;
  private particleMat: THREE.MeshBasicMaterial;

  private rockets: RocketProjectile[] = [];
  private rocketBodyGeo: THREE.CylinderGeometry;
  private rocketTipGeo: THREE.ConeGeometry;
  private rocketMat: THREE.MeshBasicMaterial;

  private shockwaves: ShockwaveSlot[] = [];
  private shockwaveGeo: THREE.RingGeometry;

  private hazards: ActiveHazard[] = [];
  private netRocketMeshes = new Map<string, THREE.Group>();
  private netHazardMeshes = new Map<string, THREE.Group>();
  private nextHazardId = 0;

  // Shared hazard geometries & materials
  private bombSphereGeo: THREE.SphereGeometry;
  private spikeBaseGeo: THREE.BoxGeometry;
  private spikeConeGeo: THREE.ConeGeometry;
  private mineDiscGeo: THREE.CylinderGeometry;

  private bombMat: THREE.MeshStandardMaterial;
  private spikeMat: THREE.MeshStandardMaterial;
  private mineMat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.particleGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    this.particleMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    this.instancedParticles = new THREE.InstancedMesh(
      this.particleGeo,
      this.particleMat,
      MAX_PARTICLES,
    );
    this.instancedParticles.frustumCulled = false;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: -100,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        scale: 0,
        color: new THREE.Color('#ffffff'),
      });
      _dummy.position.set(0, -100, 0);
      _dummy.scale.setScalar(0.001);
      _dummy.updateMatrix();
      this.instancedParticles.setMatrixAt(i, _dummy.matrix);
      this.instancedParticles.setColorAt(i, new THREE.Color('#ffffff'));
    }
    this.instancedParticles.instanceMatrix.needsUpdate = true;
    if (this.instancedParticles.instanceColor) {
      this.instancedParticles.instanceColor.needsUpdate = true;
    }
    scene.add(this.instancedParticles);

    // Pooled Rocket meshes
    this.rocketBodyGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.9, 8);
    this.rocketBodyGeo.rotateX(Math.PI / 2);
    this.rocketTipGeo = new THREE.ConeGeometry(0.22, 0.45, 8);
    this.rocketTipGeo.rotateX(-Math.PI / 2);
    this.rocketMat = new THREE.MeshBasicMaterial({ color: '#ef4444' });

    for (let i = 0; i < MAX_ROCKETS; i++) {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(this.rocketBodyGeo, this.rocketMat);
      const tip = new THREE.Mesh(this.rocketTipGeo, this.rocketMat);
      tip.position.z = -0.65;
      grp.add(body, tip);
      grp.visible = false;
      scene.add(grp);
      this.rockets.push({
        active: false,
        ownerId: '',
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vz: 0,
        distanceTraveled: 0,
        maxRange: 45,
        damage: 30,
        blastRadius: 5,
        mesh: grp,
      });
    }

    this.bombSphereGeo = new THREE.SphereGeometry(0.55, 12, 10);
    this.spikeBaseGeo = new THREE.BoxGeometry(2.8, 0.14, 1.3);
    this.spikeConeGeo = new THREE.ConeGeometry(0.14, 0.46, 6);
    this.mineDiscGeo = new THREE.CylinderGeometry(0.62, 0.7, 0.2, 14);

    this.bombMat = new THREE.MeshStandardMaterial({
      color: '#facc15',
      emissive: '#ef4444',
      emissiveIntensity: 0.9,
      roughness: 0.3,
    });
    this.spikeMat = new THREE.MeshStandardMaterial({
      color: '#a855f7',
      emissive: '#7e22ce',
      emissiveIntensity: 0.85,
      roughness: 0.3,
    });
    this.mineMat = new THREE.MeshStandardMaterial({
      color: '#ec4899',
      emissive: '#db2777',
      emissiveIntensity: 1.0,
      roughness: 0.25,
    });

    this.shockwaveGeo = new THREE.RingGeometry(0.65, 1.0, 28);
    this.shockwaveGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: '#fb923c',
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.shockwaveGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.shockwaves.push({
        active: false,
        life: 0,
        maxLife: 0.45,
        maxRadius: 6,
        mesh,
        mat,
      });
    }
  }

  public spawnBurst(
    x: number,
    y: number,
    z: number,
    count: number,
    hexColor: string,
    speed = 9,
    scale = 1,
  ): void {
    for (let i = 0; i < count; i++) {
      const slot = this.particles[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;
      const angle = Math.random() * Math.PI * 2;
      const up = 2 + Math.random() * speed * 0.7;
      const horiz = (0.35 + Math.random() * 0.65) * speed;
      slot.active = true;
      slot.x = x;
      slot.y = y;
      slot.z = z;
      slot.vx = Math.cos(angle) * horiz;
      slot.vy = up;
      slot.vz = Math.sin(angle) * horiz;
      slot.maxLife = 0.28 + Math.random() * 0.35;
      slot.life = slot.maxLife;
      slot.scale = scale * (0.7 + Math.random() * 0.7);
      slot.color.set(hexColor);
    }
  }

  public spawnShockwave(
    x: number,
    y: number,
    z: number,
    hexColor = '#fb923c',
    maxRadius = 6,
  ): void {
    const slot = this.shockwaves.find((s) => !s.active) ?? this.shockwaves[0];
    slot.active = true;
    slot.maxLife = 0.42;
    slot.life = slot.maxLife;
    slot.maxRadius = maxRadius;
    slot.mat.color.set(hexColor);
    slot.mat.opacity = 0.85;
    slot.mesh.position.set(x, Math.max(0.18, y + 0.15), z);
    slot.mesh.scale.setScalar(0.5);
    slot.mesh.visible = true;
  }

  public spawnWaterSplash(x: number, y: number, z: number): void {
    this.spawnBurst(x, Math.max(0.2, y), z, 6, '#7dd3fc', 7.5, 0.9);
  }

  public spawnSmokePuff(x: number, y: number, z: number): void {
    this.spawnBurst(x, y + 0.65, z, 2, '#64748b', 3.2, 0.95);
  }

  public spawnEliminationExplosion(x: number, y: number, z: number): void {
    this.spawnBurst(x, y + 0.8, z, 20, '#f97316', 16, 1.5);
    this.spawnBurst(x, y + 1.1, z, 14, '#facc15', 13, 1.3);
    this.spawnBurst(x, y + 1.2, z, 10, '#ef4444', 10, 1.2);
    this.spawnShockwave(x, y, z, '#f97316', 7.5);
  }

  private detonateAoE(
    x: number,
    y: number,
    z: number,
    radius: number,
    rawDamage: number,
    ownerId: string,
    cars: CarController[],
    knockbackSpeed: number,
    callbacks?: CombatEventCallbacks,
  ): void {
    this.spawnBurst(x, y + 0.5, z, 22, '#fb923c', 15, 1.4);
    this.spawnBurst(x, y + 0.8, z, 12, '#facc15', 11, 1.1);
    this.spawnShockwave(x, y, z, '#fb923c', radius);
    callbacks?.onExplosion?.(x, y, z, radius);

    for (const car of cars) {
      if (!car.alive) continue;
      // Avoid blasting owner on their own rocket right at muzzle, allow self-splash on own bomb if inside
      const cp = car.body.translation();
      const dx = cp.x - x;
      const dy = cp.y - y;
      const dz = cp.z - z;
      const dist = Math.hypot(dx, dz);
      if (dist <= radius && Math.abs(dy) < 4.5) {
        const res = car.applyCombatDamage(rawDamage, 'weapon', ownerId);
        if (res.damageDealt > 0 || car.shieldTimer > 0) {
          const inv = 1 / Math.max(0.2, dist);
          const lv = car.body.linvel();
          car.body.setLinvel(
            {
              x: lv.x + (dist > 0.1 ? dx * inv : 0) * knockbackSpeed,
              y: lv.y + 4.5,
              z: lv.z + (dist > 0.1 ? dz * inv : 1) * knockbackSpeed,
            },
            true,
          );
          callbacks?.onDamageDealt?.(
            car,
            ownerId,
            res.damageDealt,
            res.eliminated,
            cp.x,
            cp.z,
          );
        }
      }
    }
  }

  public useWeapon(
    car: CarController,
    allCars: CarController[],
    callbacks?: CombatEventCallbacks,
  ): boolean {
    const weapon = car.equippedWeapon;
    if (!car.alive || !weapon || weapon.usesRemaining <= 0 || weapon.cooldown > 0) {
      return false;
    }

    const spec = WEAPON_SPECS[weapon.kind];
    weapon.usesRemaining -= 1;
    weapon.cooldown = spec.cooldown;
    car.weaponCooldown = spec.cooldown;

    const p = car.body.translation();
    const r = car.body.rotation();
    _quat.set(r.x, r.y, r.z, r.w);
    _forward.set(0, 0, -1).applyQuaternion(_quat).normalize();

    if (weapon.kind === 'rocket') {
      const slot = this.rockets.find((rk) => !rk.active);
      if (slot) {
        // Check subtle target lock inside 45m forward cone
        let dirX = _forward.x;
        let dirZ = _forward.z;
        let bestScore = 0.65;
        for (const other of allCars) {
          if (!other.alive || other.id === car.id) continue;
          const op = other.body.translation();
          const dx = op.x - p.x;
          const dz = op.z - p.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 2 && dist <= spec.range) {
            const nx = dx / dist;
            const nz = dz / dist;
            const dot = nx * _forward.x + nz * _forward.z;
            if (dot > bestScore) {
              bestScore = dot;
              dirX = nx;
              dirZ = nz;
            }
          }
        }
        slot.active = true;
        slot.ownerId = car.id;
        slot.x = p.x + dirX * 2.8;
        slot.y = p.y + 0.85;
        slot.z = p.z + dirZ * 2.8;
        slot.vx = dirX * spec.speed;
        slot.vz = dirZ * spec.speed;
        slot.distanceTraveled = 0;
        slot.maxRange = spec.range;
        slot.damage = spec.damage;
        slot.blastRadius = spec.radius;
        slot.mesh.position.set(slot.x, slot.y, slot.z);
        slot.mesh.rotation.y = Math.atan2(-dirX, -dirZ);
        slot.mesh.visible = true;
      }
      this.spawnBurst(
        p.x + _forward.x * 2.5,
        p.y + 0.8,
        p.z + _forward.z * 2.5,
        8,
        spec.color,
        9,
        0.9,
      );
    } else if (weapon.kind === 'punch') {
      // 3m attack range in front of car (center-to-center ~4.8m accounts for chassis lengths)
      const hitCenterX = p.x + _forward.x * 2.7;
      const hitCenterZ = p.z + _forward.z * 2.7;
      this.spawnBurst(hitCenterX, p.y + 0.9, hitCenterZ, 16, '#f97316', 12, 1.3);

      for (const other of allCars) {
        if (!other.alive || other.id === car.id) continue;
        const op = other.body.translation();
        const dist = Math.hypot(op.x - hitCenterX, op.z - hitCenterZ);
        if (dist <= spec.range + 1.6 && Math.abs(op.y - p.y) < 3.5) {
          const res = other.applyCombatDamage(spec.damage, 'weapon', car.id);
          const lv = other.body.linvel();
          other.body.setLinvel(
            {
              x: lv.x + _forward.x * 20,
              y: lv.y + 4.8,
              z: lv.z + _forward.z * 20,
            },
            true,
          );
          callbacks?.onDamageDealt?.(
            other,
            car.id,
            res.damageDealt,
            res.eliminated,
            op.x,
            op.z,
          );
        }
      }
    } else {
      // Deploy Bomb, Spike Trap, or Proximity Mine behind car
      const dropX = p.x - _forward.x * 3.1;
      const dropY = Math.max(0.05, p.y);
      const dropZ = p.z - _forward.z * 3.1;
      const mesh = this.createHazardMesh(weapon.kind);
      mesh.position.set(dropX, dropY, dropZ);
      mesh.rotation.y = car.getYaw();
      this.scene.add(mesh);

      this.hazards.push({
        id: `haz_${this.nextHazardId++}`,
        kind: weapon.kind,
        ownerId: car.id,
        x: dropX,
        y: dropY,
        z: dropZ,
        ttl: weapon.kind === 'bomb' ? spec.detonationDelay : spec.lifetime,
        armTimer: weapon.kind === 'bomb' ? spec.detonationDelay : 0.75,
        radius: spec.radius,
        damage: spec.damage,
        mesh,
      });
    }

    callbacks?.onWeaponFired?.(car, weapon.kind);

    if (weapon.usesRemaining <= 0) {
      car.equippedWeapon = null;
    }
    return true;
  }

  private createHazardMesh(
    kind: 'bomb' | 'spike_trap' | 'proximity_mine',
  ): THREE.Group {
    const grp = new THREE.Group();
    if (kind === 'bomb') {
      const m = new THREE.Mesh(this.bombSphereGeo, this.bombMat);
      m.position.y = 0.55;
      grp.add(m);
    } else if (kind === 'spike_trap') {
      const base = new THREE.Mesh(this.spikeBaseGeo, this.spikeMat);
      base.position.y = 0.08;
      grp.add(base);
      for (const sx of [-1.0, -0.35, 0.35, 1.0]) {
        for (const sz of [-0.35, 0.35]) {
          const sp = new THREE.Mesh(this.spikeConeGeo, this.spikeMat);
          sp.position.set(sx, 0.32, sz);
          grp.add(sp);
        }
      }
    } else {
      const disc = new THREE.Mesh(this.mineDiscGeo, this.mineMat);
      disc.position.y = 0.12;
      grp.add(disc);
    }
    return grp;
  }

  public useAbility(
    car: CarController,
    callbacks?: CombatEventCallbacks,
  ): boolean {
    const ability = car.equippedAbility;
    if (!car.alive || !ability || ability.usesRemaining <= 0 || ability.cooldown > 0) {
      return false;
    }

    const spec = ABILITY_SPECS[ability.kind];
    let activated = false;

    if (ability.kind === 'shield') {
      car.shieldTimer = spec.duration;
      ability.activeRemaining = spec.duration;
      activated = true;
    } else if (ability.kind === 'armor') {
      car.armorTimer = spec.duration;
      ability.activeRemaining = spec.duration;
      activated = true;
    } else if (ability.kind === 'nitro') {
      car.nitroAbilityTimer = spec.duration;
      car.nitro = 100;
      ability.activeRemaining = spec.duration;
      activated = true;
    } else if (ability.kind === 'super_jump') {
      activated = car.activateSuperJump();
    } else if (ability.kind === 'triple_jump') {
      activated = car.activateTripleJump();
      if (activated) {
        ability.cooldown = spec.cooldown;
        car.abilityCooldown = spec.cooldown;
      }
    } else if (ability.kind === 'lightning_dash') {
      activated = car.activateLightningDash();
      if (activated) {
        ability.activeRemaining = spec.duration;
      }
    }

    if (!activated) return false;

    ability.usesRemaining -= 1;
    const p = car.body.translation();
    this.spawnBurst(p.x, p.y + 0.8, p.z, 14, spec.color, 10, 1.1);
    callbacks?.onAbilityUsed?.(car);

    if (ability.usesRemaining <= 0 && ability.activeRemaining <= 0) {
      car.equippedAbility = null;
    }
    return true;
  }

  public getActiveHazards(): Array<{
    id: string;
    kind: 'bomb' | 'spike_trap' | 'proximity_mine';
    x: number;
    z: number;
  }> {
    return this.hazards.map((h) => ({
      id: h.id,
      kind: h.kind,
      x: h.x,
      z: h.z,
    }));
  }

  public update(
    dt: number,
    cars: CarController[],
    callbacks?: CombatEventCallbacks,
  ): void {
    this.stepParticlesAndShockwaves(dt);

    // 2. Update Rocket projectiles (45m/s, 45m range, 5m blast radius, 30 HP)
    for (const rk of this.rockets) {
      if (!rk.active) continue;
      const stepX = rk.vx * dt;
      const stepZ = rk.vz * dt;
      rk.x += stepX;
      rk.z += stepZ;
      rk.distanceTraveled += Math.hypot(stepX, stepZ);
      rk.mesh.position.set(rk.x, rk.y, rk.z);
      if (Math.random() < 0.75) {
        this.spawnBurst(rk.x, rk.y, rk.z, 1, '#e2e8f0', 2.2, 0.75);
      }

      let shouldDetonate =
        rk.distanceTraveled >= rk.maxRange ||
        Math.abs(rk.x) > 298 ||
        Math.abs(rk.z) > 298;

      if (!shouldDetonate) {
        for (const car of cars) {
          if (!car.alive || car.id === rk.ownerId) continue;
          const cp = car.body.translation();
          const dx = cp.x - rk.x;
          const dz = cp.z - rk.z;
          if (dx * dx + dz * dz < 2.35 * 2.35 && Math.abs(cp.y - rk.y) < 2.8) {
            shouldDetonate = true;
            break;
          }
        }
      }

      if (shouldDetonate) {
        rk.active = false;
        rk.mesh.visible = false;
        const targets = cars.filter((c) => c.id !== rk.ownerId);
        this.detonateAoE(
          rk.x,
          rk.y,
          rk.z,
          rk.blastRadius,
          rk.damage,
          rk.ownerId,
          targets,
          15,
          callbacks,
        );
      }
    }

    // 3. Update Hazards (Bomb, Spike Trap, Proximity Mine)
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const haz = this.hazards[i];
      haz.ttl -= dt;
      haz.armTimer = Math.max(0, haz.armTimer - dt);

      if (haz.kind === 'bomb') {
        const pulse = 1 + 0.18 * Math.sin((3.0 - haz.ttl) * 16);
        haz.mesh.scale.setScalar(pulse);
        if (haz.ttl <= 0) {
          this.scene.remove(haz.mesh);
          this.hazards.splice(i, 1);
          this.detonateAoE(
            haz.x,
            haz.y,
            haz.z,
            haz.radius,
            haz.damage,
            haz.ownerId,
            cars,
            17,
            callbacks,
          );
          continue;
        }
      } else if (haz.kind === 'proximity_mine') {
        const blink = Math.sin(haz.ttl * 12) > 0 ? 1.1 : 0.85;
        haz.mesh.scale.setScalar(blink);
        if (haz.ttl <= 0) {
          this.scene.remove(haz.mesh);
          this.hazards.splice(i, 1);
          continue;
        }
        if (haz.armTimer <= 0) {
          let triggered = false;
          for (const car of cars) {
            if (!car.alive || car.id === haz.ownerId) continue;
            const cp = car.body.translation();
            const d = Math.hypot(cp.x - haz.x, cp.z - haz.z);
            if (d <= haz.radius && Math.abs(cp.y - haz.y) < 3.0) {
              triggered = true;
              break;
            }
          }
          if (triggered) {
            this.scene.remove(haz.mesh);
            this.hazards.splice(i, 1);
            this.detonateAoE(
              haz.x,
              haz.y,
              haz.z,
              haz.radius,
              haz.damage,
              haz.ownerId,
              cars.filter((c) => c.id !== haz.ownerId),
              14,
              callbacks,
            );
            continue;
          }
        }
      } else if (haz.kind === 'spike_trap') {
        if (haz.ttl <= 0) {
          this.scene.remove(haz.mesh);
          this.hazards.splice(i, 1);
          continue;
        }
        if (haz.armTimer <= 0) {
          let hit = false;
          for (const car of cars) {
            if (!car.alive || car.id === haz.ownerId) continue;
            const cp = car.body.translation();
            const d = Math.hypot(cp.x - haz.x, cp.z - haz.z);
            if (d <= haz.radius && Math.abs(cp.y - haz.y) < 2.2) {
              const res = car.applyCombatDamage(haz.damage, 'weapon', haz.ownerId);
              if (res.damageDealt > 0 || car.shieldTimer > 0) {
                car.slowTimer = 2.0; // Reduce enemy speed for 2 seconds
                this.spawnBurst(haz.x, haz.y + 0.5, haz.z, 12, '#a855f7', 9, 1.0);
                callbacks?.onDamageDealt?.(
                  car,
                  haz.ownerId,
                  res.damageDealt,
                  res.eliminated,
                  cp.x,
                  cp.z,
                );
              }
              hit = true;
              break;
            }
          }
          if (hit) {
            this.scene.remove(haz.mesh);
            this.hazards.splice(i, 1);
            continue;
          }
        }
      }
    }
  }

  private stepParticlesAndShockwaves(dt: number): void {
    let colorDirty = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const pt = this.particles[i];
      if (!pt.active) {
        _dummy.position.set(0, -100, 0);
        _dummy.scale.setScalar(0.001);
        _dummy.updateMatrix();
        this.instancedParticles.setMatrixAt(i, _dummy.matrix);
        continue;
      }

      pt.life -= dt;
      if (pt.life <= 0) {
        pt.active = false;
        _dummy.position.set(0, -100, 0);
        _dummy.scale.setScalar(0.001);
        _dummy.updateMatrix();
        this.instancedParticles.setMatrixAt(i, _dummy.matrix);
        continue;
      }

      pt.vy -= 18 * dt;
      pt.x += pt.vx * dt;
      pt.y = Math.max(0.1, pt.y + pt.vy * dt);
      pt.z += pt.vz * dt;

      const t = pt.life / pt.maxLife;
      _dummy.position.set(pt.x, pt.y, pt.z);
      _dummy.scale.setScalar(pt.scale * t);
      _dummy.rotation.set(t * 4, t * 3, 0);
      _dummy.updateMatrix();
      this.instancedParticles.setMatrixAt(i, _dummy.matrix);
      this.instancedParticles.setColorAt(i, pt.color);
      colorDirty = true;
    }
    this.instancedParticles.instanceMatrix.needsUpdate = true;
    if (colorDirty && this.instancedParticles.instanceColor) {
      this.instancedParticles.instanceColor.needsUpdate = true;
    }

    for (const sw of this.shockwaves) {
      if (!sw.active) continue;
      sw.life -= dt;
      if (sw.life <= 0) {
        sw.active = false;
        sw.mesh.visible = false;
        continue;
      }
      const progress = 1 - sw.life / sw.maxLife;
      const radius = 0.6 + progress * sw.maxRadius;
      sw.mesh.scale.setScalar(radius);
      sw.mat.opacity = 0.85 * (1 - progress);
    }
  }

  public syncNetworkVisuals(
    rockets: Array<{ id: string; x: number; y: number; z: number; yaw: number }>,
    hazards: Array<{ id: string; kind: 'bomb' | 'spike_trap' | 'proximity_mine'; x: number; y: number; z: number; ttl: number }>,
    dt: number,
  ): void {
    this.stepParticlesAndShockwaves(dt);

    const keepRockets = new Set(rockets.map((r) => r.id));
    for (const [id, grp] of this.netRocketMeshes) {
      if (!keepRockets.has(id)) {
        this.scene.remove(grp);
        this.netRocketMeshes.delete(id);
      }
    }
    for (const rk of rockets) {
      let grp = this.netRocketMeshes.get(rk.id);
      if (!grp) {
        grp = new THREE.Group();
        const body = new THREE.Mesh(this.rocketBodyGeo, this.rocketMat);
        const tip = new THREE.Mesh(this.rocketTipGeo, this.rocketMat);
        tip.position.z = -0.65;
        grp.add(body, tip);
        this.scene.add(grp);
        this.netRocketMeshes.set(rk.id, grp);
      }
      grp.position.set(rk.x, rk.y, rk.z);
      grp.rotation.y = rk.yaw;
      if (Math.random() < 0.7) {
        this.spawnBurst(rk.x, rk.y, rk.z, 1, '#e2e8f0', 2.0, 0.75);
      }
    }

    const keepHazards = new Set(hazards.map((h) => h.id));
    for (const [id, grp] of this.netHazardMeshes) {
      if (!keepHazards.has(id)) {
        this.scene.remove(grp);
        this.netHazardMeshes.delete(id);
      }
    }
    for (const hz of hazards) {
      let grp = this.netHazardMeshes.get(hz.id);
      if (!grp) {
        grp = this.createHazardMesh(hz.kind);
        this.scene.add(grp);
        this.netHazardMeshes.set(hz.id, grp);
      }
      grp.position.set(hz.x, hz.y, hz.z);
      if (hz.kind === 'bomb') {
        grp.scale.setScalar(1 + 0.16 * Math.sin(hz.ttl * 14));
      } else if (hz.kind === 'proximity_mine') {
        grp.scale.setScalar(Math.sin(hz.ttl * 12) > 0 ? 1.1 : 0.88);
      }
    }
  }

  public reset(): void {
    for (const pt of this.particles) pt.active = false;
    for (const sw of this.shockwaves) {
      sw.active = false;
      sw.mesh.visible = false;
    }
    for (const rk of this.rockets) {
      rk.active = false;
      rk.mesh.visible = false;
    }
    for (const haz of this.hazards) {
      this.scene.remove(haz.mesh);
    }
    this.hazards.length = 0;
    for (const grp of this.netRocketMeshes.values()) this.scene.remove(grp);
    this.netRocketMeshes.clear();
    for (const grp of this.netHazardMeshes.values()) this.scene.remove(grp);
    this.netHazardMeshes.clear();
  }

  public dispose(scene: THREE.Scene): void {
    this.reset();
    scene.remove(this.instancedParticles);
    this.particleGeo.dispose();
    this.particleMat.dispose();
    for (const rk of this.rockets) scene.remove(rk.mesh);
    for (const sw of this.shockwaves) {
      scene.remove(sw.mesh);
      sw.mat.dispose();
    }
    this.shockwaveGeo.dispose();
    this.rocketBodyGeo.dispose();
    this.rocketTipGeo.dispose();
    this.rocketMat.dispose();
    this.bombSphereGeo.dispose();
    this.spikeBaseGeo.dispose();
    this.spikeConeGeo.dispose();
    this.mineDiscGeo.dispose();
    this.bombMat.dispose();
    this.spikeMat.dispose();
    this.mineMat.dispose();
  }
}

