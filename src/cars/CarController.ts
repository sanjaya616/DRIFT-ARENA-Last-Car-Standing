import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type {
  CarCustomization,
  EquippedAbility,
  EquippedWeapon,
  InputState,
  PickupKind,
} from '../types/game';
import { VEHICLE_CONFIGS } from './vehicleConfigs';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import {
  computeVehicleKinematics,
  mpsToKmh,
  updateDriftState,
  type DriftState,
} from '../physics/vehicleDynamics';
import {
  applyHealthChange,
  calculateEffectiveDamage,
  createEquippedAbility,
  createEquippedWeapon,
  isWeaponPickup,
  jumpVelocityForHeight,
  MAX_PLAYER_HP,
  type DamageSourceKind,
} from '../combat/combatRules';
import { isOnAsphaltRoad } from '../maps/neonHarborLayout';
import { buildSportsCar, type CarVisualRig } from './CarFactory';

const _quat = new THREE.Quaternion();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _vel = new THREE.Vector3();

export class CarController {
  public readonly id: string;
  public readonly isPlayer: boolean;
  public readonly driverName: string;
  public readonly body: RAPIER.RigidBody;
  public readonly collider: RAPIER.Collider;
  public readonly visual: CarVisualRig;

  public customization: CarCustomization;
  public hp: number = MAX_PLAYER_HP;
  public maxHp: number = MAX_PLAYER_HP;
  public alive = true;
  public nitro = 100;
  public nitroActive = false;

  // 2 independent inventory slots (1 Weapon, 1 Ability)
  public equippedWeapon: EquippedWeapon | null = null;
  public equippedAbility: EquippedAbility | null = null;

  // Active combat states & timers
  public shieldTimer = 0;
  public armorTimer = 0;
  public nitroAbilityTimer = 0;
  public dashTimer = 0;
  public slowTimer = 0;
  public spawnProtectionTimer = 0;

  public weaponCooldown = 0;
  public abilityCooldown = 0;
  public hitFlashTimer = 0;
  public damageTaken = 0;
  public eliminations = 0;
  public lastAttackerId: string | null = null;
  public koTimer = 0;
  public koExplosionDone = false;

  public driftState: DriftState = {
    isDrifting: false,
    driftCharge: 0,
    driftBoostRemaining: 0,
    driftMultiplier: 1,
    driftScore: 0,
    wasDriftHeld: false,
  };

  public speedKmh = 0;
  public forwardSpeed = 0;
  public lateralSpeed = 0;
  public slipRatio = 0;
  public isGrounded = true;
  public isOffroad = false;
  public lastSafePos = { x: 0, y: 0.15, z: 52, yaw: 0 };

  private coyoteTimer = 0;
  private jumpCooldown = 0;
  private tripleJumpAirUsed = 0;
  private tripleJumpCooldown = 0;
  private wheelSpinAngle = 0;
  private visualSteerAngle = 0;
  private visualPitch = 0;
  private visualRoll = 0;
  private squashY = 1;
  private suspensionOffsetY = 0;
  private suspensionVelY = 0;
  private wasGrounded = true;
  private prevVelY = 0;

  // 3D Health Bar above non-player cars
  private hpBarGroup: THREE.Group | null = null;
  private hpBarFill: THREE.Mesh | null = null;
  private hpBarFillMat: THREE.MeshBasicMaterial | null = null;
  private hpBarGeos: THREE.BufferGeometry[] = [];
  private hpBarMats: THREE.Material[] = [];

  // 360-degree Stunt Loop traversal assist (X=-210, Z=85, R=13)
  private loopRide = {
    active: false,
    progress: 0,
    dir: 1 as 1 | -1,
    visualPitch: 0,
    cooldown: 0,
  };

  constructor(
    id: string,
    isPlayer: boolean,
    scene: THREE.Scene,
    physics: PhysicsWorld,
    spawnPos: { x: number; y: number; z: number; yaw: number },
    customization: CarCustomization,
    isSoftwareGl: boolean,
    driverName?: string,
  ) {
    this.id = id;
    this.isPlayer = isPlayer;
    this.driverName = driverName ?? (isPlayer ? 'YOU' : id.toUpperCase());
    this.customization = { ...customization };
    const spec = VEHICLE_CONFIGS[customization.vehicleId];
    this.maxHp = MAX_PLAYER_HP;
    this.hp = MAX_PLAYER_HP;
    this.lastSafePos = { ...spawnPos };

    const phys = physics.createCarBody(
      id,
      spawnPos.x,
      spawnPos.y,
      spawnPos.z,
      spawnPos.yaw,
      spec.massKg,
    );
    this.body = phys.body;
    this.collider = phys.collider;

    this.visual = buildSportsCar(customization, isSoftwareGl);
    this.visual.root.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
    this.visual.root.rotation.y = spawnPos.yaw;

    if (!isPlayer) {
      this.createWorldHealthBar(scene);
    }

    scene.add(this.visual.root);
  }

  private createWorldHealthBar(scene: THREE.Scene): void {
    const group = new THREE.Group();
    const bgGeo = new THREE.PlaneGeometry(2.4, 0.3);
    const bgMat = new THREE.MeshBasicMaterial({
      color: '#090d14',
      side: THREE.DoubleSide,
    });
    const bgMesh = new THREE.Mesh(bgGeo, bgMat);

    const fillGeo = new THREE.PlaneGeometry(2.26, 0.18);
    const fillMat = new THREE.MeshBasicMaterial({
      color: '#22c55e',
      side: THREE.DoubleSide,
    });
    const fillMesh = new THREE.Mesh(fillGeo, fillMat);
    fillMesh.position.z = 0.015;

    group.add(bgMesh, fillMesh);
    group.position.set(
      this.visual.root.position.x,
      this.visual.root.position.y + 2.3,
      this.visual.root.position.z,
    );
    scene.add(group);

    this.hpBarGroup = group;
    this.hpBarFill = fillMesh;
    this.hpBarFillMat = fillMat;
    this.hpBarGeos.push(bgGeo, fillGeo);
    this.hpBarMats.push(bgMat, fillMat);
  }

  public applyCustomization(next: CarCustomization): void {
    const prevVehicle = this.customization.vehicleId;
    this.customization = { ...next };
    this.visual.bodyPaintMaterial.color.set(next.bodyColor);
    this.visual.accentMaterial.color.set(next.accentColor);
    this.visual.rimMaterial.color.set(next.rimColor);
    this.visual.applyVehicleStyle(next.vehicleId);
    if (prevVehicle !== next.vehicleId) {
      const spec = VEHICLE_CONFIGS[next.vehicleId];
      this.collider.setMass(spec.massKg);
      this.maxHp = MAX_PLAYER_HP;
      this.hp = Math.min(MAX_PLAYER_HP, this.hp);
    }
  }

  public resetTo(x: number, y: number, z: number, yaw: number): void {
    this.maxHp = MAX_PLAYER_HP;
    this.hp = MAX_PLAYER_HP;
    this.alive = true;
    this.nitro = 100;
    this.nitroActive = false;

    this.equippedWeapon = null;
    this.equippedAbility = null;
    this.shieldTimer = 0;
    this.armorTimer = 0;
    this.nitroAbilityTimer = 0;
    this.dashTimer = 0;
    this.slowTimer = 0;
    this.spawnProtectionTimer = 0;

    this.weaponCooldown = 0;
    this.abilityCooldown = 0;
    this.hitFlashTimer = 0;
    this.damageTaken = 0;
    this.eliminations = 0;
    this.lastAttackerId = null;
    this.koTimer = 0;
    this.koExplosionDone = false;
    this.tripleJumpAirUsed = 0;
    this.tripleJumpCooldown = 0;
    this.suspensionOffsetY = 0;
    this.suspensionVelY = 0;
    this.loopRide.active = false;
    this.loopRide.progress = 0;
    this.loopRide.visualPitch = 0;
    this.loopRide.cooldown = 0;
    this.lastSafePos = { x, y, z, yaw };
    this.driftState = {
      isDrifting: false,
      driftCharge: 0,
      driftBoostRemaining: 0,
      driftMultiplier: 1,
      driftScore: 0,
      wasDriftHeld: false,
    };

    const hy = Math.sin(yaw * 0.5);
    const hw = Math.cos(yaw * 0.5);
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: 0, y: hy, z: 0, w: hw }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.visual.root.visible = true;
    this.visual.shieldMesh.visible = false;
    if (this.hpBarGroup) this.hpBarGroup.visible = true;
    this.syncVisual(0.016, 0, 0);
  }

  public equipPickup(kind: PickupKind): void {
    if (isWeaponPickup(kind)) {
      this.equippedWeapon = createEquippedWeapon(kind);
    } else {
      this.equippedAbility = createEquippedAbility(kind);
    }
  }

  public recoverToCheckpoint(): void {
    const { x, y, z, yaw } = this.lastSafePos;
    const hy = Math.sin(yaw * 0.5);
    const hw = Math.cos(yaw * 0.5);
    this.body.setTranslation({ x, y: y + 0.4, z }, true);
    this.body.setRotation({ x: 0, y: hy, z: 0, w: hw }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  public applyCombatDamage(
    rawDamage: number,
    source: DamageSourceKind,
    attackerId?: string,
  ): { damageDealt: number; eliminated: boolean } {
    if (!this.alive || rawDamage <= 0) {
      return { damageDealt: 0, eliminated: false };
    }
    const effective = calculateEffectiveDamage({
      rawDamage,
      source,
      spawnProtected: this.spawnProtectionTimer > 0,
      shieldActive: this.shieldTimer > 0,
      armorActive: this.armorTimer > 0,
      dashActive: this.dashTimer > 0,
    });
    if (effective <= 0) {
      return { damageDealt: 0, eliminated: false };
    }

    const res = applyHealthChange(this.hp, -effective, this.maxHp);
    this.hp = res.nextHp;
    this.damageTaken += effective;
    this.hitFlashTimer = 0.09;
    if (attackerId && attackerId !== this.id) {
      this.lastAttackerId = attackerId;
    }

    if (res.eliminated) {
      this.alive = false;
      this.koTimer = 0.5;
      return { damageDealt: effective, eliminated: true };
    }
    return { damageDealt: effective, eliminated: false };
  }

  public applyDamage(amount: number): boolean {
    return this.applyCombatDamage(amount, 'collision').eliminated;
  }

  public activateSuperJump(): boolean {
    if (!this.alive) return false;
    const lv = this.body.linvel();
    const vy = jumpVelocityForHeight(8, 18); // ~8m vertical jump
    this.body.setLinvel({ x: lv.x, y: vy, z: lv.z }, true);
    this.coyoteTimer = 0;
    this.squashY = 1.24;
    this.suspensionVelY = 2.4;
    return true;
  }

  public activateTripleJump(): boolean {
    if (!this.alive || this.tripleJumpCooldown > 0) return false;
    const onGroundOrCoyote = this.isGrounded || this.coyoteTimer > 0;
    if (!onGroundOrCoyote && this.tripleJumpAirUsed >= 1) {
      return false; // Max 1 additional jump before landing
    }
    const lv = this.body.linvel();
    const vy = jumpVelocityForHeight(5, 18); // ~5m vertical jump
    this.body.setLinvel({ x: lv.x, y: vy, z: lv.z }, true);
    if (!onGroundOrCoyote) {
      this.tripleJumpAirUsed += 1;
    } else {
      this.tripleJumpAirUsed = 0;
    }
    this.coyoteTimer = 0;
    this.tripleJumpCooldown = 0.7; // Minimum 0.7s interval between jumps
    this.squashY = 1.18;
    this.suspensionVelY = 1.9;
    return true;
  }

  public activateLightningDash(): boolean {
    if (!this.alive) return false;
    this.dashTimer = 1.2;
    const r = this.body.rotation();
    _quat.set(r.x, r.y, r.z, r.w);
    _forward.set(0, 0, -1).applyQuaternion(_quat).normalize();
    const lv = this.body.linvel();
    const spec = VEHICLE_CONFIGS[this.customization.vehicleId];
    const dashSpeed = Math.max(this.forwardSpeed + 18, (spec.maxSpeedKmh / 3.6) * 1.45);
    this.body.setLinvel(
      {
        x: _forward.x * dashSpeed,
        y: Math.max(lv.y, 0.8),
        z: _forward.z * dashSpeed,
      },
      true,
    );
    return true;
  }

  public step(
    dt: number,
    input: InputState,
    physics: PhysicsWorld,
    callbacks?: {
      onJump?: () => void;
      onLand?: (impactSpeedY: number) => void;
      onDriftBoost?: () => void;
    },
    holdDuringCountdown = false,
  ): void {
    this.weaponCooldown = Math.max(0, this.weaponCooldown - dt);
    this.abilityCooldown = Math.max(0, this.abilityCooldown - dt);
    this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    this.armorTimer = Math.max(0, this.armorTimer - dt);
    this.nitroAbilityTimer = Math.max(0, this.nitroAbilityTimer - dt);
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    this.slowTimer = Math.max(0, this.slowTimer - dt);
    this.spawnProtectionTimer = Math.max(0, this.spawnProtectionTimer - dt);
    this.tripleJumpCooldown = Math.max(0, this.tripleJumpCooldown - dt);
    this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);

    if (this.equippedWeapon) {
      this.equippedWeapon.cooldown = Math.max(0, this.equippedWeapon.cooldown - dt);
    }
    if (this.equippedAbility) {
      this.equippedAbility.cooldown = Math.max(0, this.equippedAbility.cooldown - dt);
      if (this.equippedAbility.activeRemaining > 0) {
        this.equippedAbility.activeRemaining = Math.max(
          0,
          this.equippedAbility.activeRemaining - dt,
        );
        if (
          this.equippedAbility.activeRemaining <= 0 &&
          this.equippedAbility.usesRemaining <= 0
        ) {
          this.equippedAbility = null;
        }
      }
    }

    if (!this.alive) {
      if (this.koTimer > 0) {
        this.koTimer = Math.max(0, this.koTimer - dt);
      }
      this.syncVisual(dt, 0, 0);
      return;
    }

    if (holdDuringCountdown) {
      this.body.setLinvel({ x: 0, y: this.body.linvel().y, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.speedKmh = 0;
      this.forwardSpeed = 0;
      this.lateralSpeed = 0;
      this.syncVisual(dt, 0, 0);
      return;
    }

    const spec = VEHICLE_CONFIGS[this.customization.vehicleId];
    const pos = this.body.translation();
    const rot = this.body.rotation();
    _quat.set(rot.x, rot.y, rot.z, rot.w);

    const groundCheck = physics.castGroundRay(
      pos.x,
      pos.y + 0.5,
      pos.z,
      0.85,
      this.collider,
    );
    this.isGrounded = groundCheck.grounded;

    this.isOffroad =
      this.isGrounded && pos.y < 0.45 && !isOnAsphaltRoad(pos.x, pos.z);

    if (this.isGrounded && !this.isOffroad && pos.y >= -0.2) {
      this.lastSafePos = {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        yaw: this.getYaw(),
      };
    }

    const lv = this.body.linvel();
    if (this.isGrounded) {
      this.coyoteTimer = 0.1;
      this.tripleJumpAirUsed = 0;
      if (!this.wasGrounded) {
        const dropSpeed = Math.abs(this.prevVelY);
        this.squashY = Math.max(0.75, 1 - dropSpeed * 0.022);
        this.suspensionVelY = -Math.min(2.8, dropSpeed * 0.25);
        if (dropSpeed > 3.5) {
          callbacks?.onLand?.(dropSpeed);
        }
      }
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }
    this.wasGrounded = this.isGrounded;
    this.prevVelY = lv.y;

    const springK = 140;
    const springDamp = 15;
    const springForce = -springK * this.suspensionOffsetY - springDamp * this.suspensionVelY;
    this.suspensionVelY += springForce * dt;
    this.suspensionOffsetY = THREE.MathUtils.clamp(
      this.suspensionOffsetY + this.suspensionVelY * dt,
      -0.18,
      0.12,
    );

    _forward.set(0, 0, -1).applyQuaternion(_quat).normalize();
    _right.set(1, 0, 0).applyQuaternion(_quat).normalize();
    _vel.set(lv.x, lv.y, lv.z);

    this.forwardSpeed = _vel.dot(_forward);
    this.lateralSpeed = _vel.dot(_right);
    this.speedKmh = mpsToKmh(this.forwardSpeed);

    const wantsNitro = input.nitro && this.nitro > 1 && input.throttle > 0;
    if (wantsNitro) {
      this.nitroActive = true;
      this.nitro = Math.max(0, this.nitro - 25 * dt);
    } else {
      this.nitroActive = false;
      this.nitro = Math.min(100, this.nitro + 5 * dt);
    }

    if (input.jumpBuffered && this.coyoteTimer > 0 && this.jumpCooldown <= 0) {
      this.body.setLinvel({ x: lv.x, y: spec.jumpImpulse, z: lv.z }, true);
      this.coyoteTimer = 0;
      this.jumpCooldown = 0.65;
      this.squashY = 1.18;
      this.suspensionVelY = 1.8;
      callbacks?.onJump?.();
    }

    this.loopRide.cooldown = Math.max(0, this.loopRide.cooldown - dt);

    // 360-degree Stunt Loop traversal (X=-210, Z=85, R=13)
    const loopCenterX = -210;
    const loopCenterZ = 85;
    const loopRadius = 13;
    const loopCircumference = 2 * Math.PI * loopRadius;
    const entryDx = pos.x - (loopCenterX - 3.6);
    const entryDz = pos.z - loopCenterZ;

    if (
      !this.loopRide.active &&
      this.loopRide.cooldown <= 0 &&
      Math.abs(entryDx) < 5.2 &&
      Math.abs(entryDz) < 5.5 &&
      pos.y < 2.2 &&
      this.speedKmh >= 55 &&
      Math.abs(_forward.z) > 0.65
    ) {
      this.loopRide.active = true;
      this.loopRide.progress = 0.02;
      this.loopRide.dir = _forward.z < 0 ? 1 : -1;
    }

    if (this.loopRide.active) {
      const arcSpeed = Math.max(20, Math.abs(this.forwardSpeed));
      this.loopRide.progress += (arcSpeed * dt) / loopCircumference;
      const p = Math.min(1, this.loopRide.progress);
      const theta = p * Math.PI * 2;
      const helixOffset = (p - 0.5) * 8.0;
      const targetX = loopCenterX + helixOffset;
      const targetY = loopRadius * (1 - Math.cos(theta)) + 0.28;
      const targetZ = loopCenterZ - this.loopRide.dir * loopRadius * Math.sin(theta);

      this.body.setTranslation({ x: targetX, y: targetY, z: targetZ }, true);
      this.body.setLinvel(
        { x: 0, y: 0, z: -this.loopRide.dir * arcSpeed * Math.cos(theta) },
        true,
      );
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.isGrounded = true;
      this.loopRide.visualPitch = this.loopRide.dir * theta;

      if (this.loopRide.progress >= 1) {
        this.loopRide.active = false;
        this.loopRide.visualPitch = 0;
        this.loopRide.cooldown = 1.5;
        this.body.setLinvel(
          { x: 0, y: 1.5, z: -this.loopRide.dir * arcSpeed },
          true,
        );
      }

      this.syncVisual(dt, 0, 0);
      return;
    }

    this.loopRide.visualPitch = 0;

    const driftBoostActive = this.driftState.driftBoostRemaining > 0;
    const kin = computeVehicleKinematics({
      forwardSpeed: this.forwardSpeed,
      lateralSpeed: this.lateralSpeed,
      throttle: input.throttle,
      brake: input.brake,
      steerInput: input.steer,
      isDrifting: input.drift,
      isNitroActive: this.nitroActive,
      driftBoostActive,
      abilityNitroActive: this.nitroAbilityTimer > 0,
      dashActive: this.dashTimer > 0,
      slowActive: this.slowTimer > 0,
      isGrounded: this.isGrounded,
      isOffroad: this.isOffroad,
      vehicleId: this.customization.vehicleId,
      dt,
    });

    this.slipRatio = kin.slipRatio;

    const nextForward = this.forwardSpeed + kin.forwardAccel * dt;
    const nextLateral = this.lateralSpeed + kin.lateralGripDecel * dt;

    const currentLv = this.body.linvel();
    const newVx = _forward.x * nextForward + _right.x * nextLateral;
    const newVz = _forward.z * nextForward + _right.z * nextLateral;
    this.body.setLinvel(
      { x: newVx, y: currentLv.y, z: newVz },
      true,
    );
    this.body.setAngvel({ x: 0, y: kin.yawRate, z: 0 }, true);

    const driftRes = updateDriftState(
      this.driftState,
      this.forwardSpeed,
      this.lateralSpeed,
      input.steer,
      input.drift,
      this.isGrounded,
      dt,
    );
    this.driftState = driftRes.next;
    if (driftRes.nitroEarned > 0) {
      this.nitro = Math.min(100, this.nitro + driftRes.nitroEarned);
    }
    if (driftRes.boostTriggered) {
      callbacks?.onDriftBoost?.();
    }

    const isBraking = input.brake > 0 || input.drift;
    this.visual.tailLightMaterial.emissiveIntensity = isBraking ? 4.2 : 1.6;

    if (pos.y < -5) {
      this.recoverToCheckpoint();
    }

    this.syncVisual(dt, kin.wheelSteerAngle, kin.forwardAccel);
  }

  public syncWorldHealthBar(cameraPos: THREE.Vector3): void {
    if (!this.hpBarGroup || !this.hpBarFill || !this.hpBarFillMat) return;
    if (!this.alive) {
      this.hpBarGroup.visible = false;
      return;
    }
    this.hpBarGroup.visible = true;
    const pos = this.body.translation();
    this.hpBarGroup.position.set(pos.x, pos.y + 2.35, pos.z);
    this.hpBarGroup.lookAt(cameraPos);

    const ratio = Math.max(0.001, Math.min(1, this.hp / this.maxHp));
    this.hpBarFill.scale.x = ratio;
    this.hpBarFill.position.x = -(1 - ratio) * 1.13;
    if (ratio > 0.55) {
      this.hpBarFillMat.color.set('#22c55e');
    } else if (ratio > 0.28) {
      this.hpBarFillMat.color.set('#f59e0b');
    } else {
      this.hpBarFillMat.color.set('#ef4444');
    }
  }

  public syncVisual(dt: number, targetSteerRad: number, forwardAccel: number): void {
    const pos = this.body.translation();
    const rot = this.body.rotation();

    this.visual.root.position.set(pos.x, pos.y, pos.z);
    this.visual.root.quaternion.set(rot.x, rot.y, rot.z, rot.w);

    const steerAlpha = 1 - Math.exp(-14 * dt);
    this.visualSteerAngle = THREE.MathUtils.lerp(
      this.visualSteerAngle,
      targetSteerRad,
      steerAlpha,
    );
    this.visual.wheelPivots.frontLeft.rotation.y = this.visualSteerAngle;
    this.visual.wheelPivots.frontRight.rotation.y = this.visualSteerAngle;

    const wheelDelta = (this.forwardSpeed * dt) / 0.36;
    this.wheelSpinAngle -= wheelDelta;
    this.visual.wheels.frontLeft.rotation.x = this.wheelSpinAngle;
    this.visual.wheels.frontRight.rotation.x = this.wheelSpinAngle;
    this.visual.wheels.rearLeft.rotation.x = this.wheelSpinAngle;
    this.visual.wheels.rearRight.rotation.x = this.wheelSpinAngle;

    const airPitch = !this.isGrounded
      ? THREE.MathUtils.clamp(this.body.linvel().y * -0.015, -0.18, 0.18)
      : 0;
    const targetPitch =
      airPitch + THREE.MathUtils.clamp(forwardAccel * 0.0022, -0.06, 0.06);
    const targetRoll = THREE.MathUtils.clamp(-this.lateralSpeed * 0.01, -0.1, 0.1);
    const suspAlpha = 1 - Math.exp(-10 * dt);
    this.visualPitch = THREE.MathUtils.lerp(this.visualPitch, targetPitch, suspAlpha);
    this.visualRoll = THREE.MathUtils.lerp(this.visualRoll, targetRoll, suspAlpha);
    this.squashY = THREE.MathUtils.lerp(this.squashY, 1.0, 1 - Math.exp(-12 * dt));

    this.visual.chassisPivot.position.y = this.suspensionOffsetY;
    this.visual.chassisPivot.rotation.set(
      this.visualPitch + this.loopRide.visualPitch,
      0,
      this.visualRoll,
    );
    this.visual.chassisPivot.scale.set(
      1 + (1 - this.squashY) * 0.38,
      this.squashY,
      1 + (1 - this.squashY) * 0.22,
    );

    const showFlames =
      this.alive &&
      (this.nitroActive ||
        this.driftState.driftBoostRemaining > 0 ||
        this.nitroAbilityTimer > 0 ||
        this.dashTimer > 0);
    for (const flame of this.visual.nitroFlames) {
      flame.visible = showFlames;
      if (showFlames) {
        const flicker = 0.85 + Math.random() * 0.55;
        flame.scale.set(1, 1, flicker);
      }
    }

    const showShieldShell =
      this.alive && (this.shieldTimer > 0 || this.spawnProtectionTimer > 0 || this.armorTimer > 0);
    this.visual.shieldMesh.visible = showShieldShell;
    if (showShieldShell) {
      const mat = this.visual.shieldMesh.material as THREE.MeshBasicMaterial;
      if (this.shieldTimer > 0) {
        mat.color.set('#38bdf8');
      } else if (this.spawnProtectionTimer > 0) {
        mat.color.set('#22c55e');
      } else {
        mat.color.set('#94a3b8');
      }
      this.visual.shieldMesh.rotation.y += dt * 1.8;
    }

    this.visual.contactShadow.position.y = Math.max(0.025, 0.025 - pos.y);
    this.visual.contactShadow.visible = pos.y < 14;

    if (this.hitFlashTimer > 0) {
      this.visual.bodyPaintMaterial.emissive.set('#ffffff');
      this.visual.bodyPaintMaterial.emissiveIntensity = 0.75;
    } else if (!this.alive) {
      this.visual.bodyPaintMaterial.emissive.set('#1f2937');
      this.visual.bodyPaintMaterial.emissiveIntensity = 0.1;
    } else if (this.slowTimer > 0) {
      this.visual.bodyPaintMaterial.emissive.set('#a855f7');
      this.visual.bodyPaintMaterial.emissiveIntensity = 0.35;
    } else if (this.dashTimer > 0) {
      this.visual.bodyPaintMaterial.emissive.set('#fde047');
      this.visual.bodyPaintMaterial.emissiveIntensity = 0.45;
    } else {
      this.visual.bodyPaintMaterial.emissive.set('#000000');
      this.visual.bodyPaintMaterial.emissiveIntensity = 0;
    }
  }

  public getPosition(out = new THREE.Vector3()): THREE.Vector3 {
    const p = this.body.translation();
    return out.set(p.x, p.y, p.z);
  }

  public getYaw(): number {
    const r = this.body.rotation();
    _quat.set(r.x, r.y, r.z, r.w);
    _forward.set(0, 0, -1).applyQuaternion(_quat);
    return Math.atan2(-_forward.x, -_forward.z);
  }

  public dispose(scene: THREE.Scene): void {
    scene.remove(this.visual.root);
    this.visual.dispose();
    if (this.hpBarGroup) {
      scene.remove(this.hpBarGroup);
    }
    this.hpBarGeos.forEach((g) => g.dispose());
    this.hpBarMats.forEach((m) => m.dispose());
  }
}

