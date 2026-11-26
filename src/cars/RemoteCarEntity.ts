import * as THREE from 'three';
import { buildSportsCar, type CarVisualRig } from './CarFactory';
import type { NetCarState } from '../multiplayer/protocol';

function lerpAngle(current: number, target: number, alpha: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * alpha;
}

export class RemoteCarEntity {
  public readonly id: string;
  public readonly isLocalPlayer: boolean;
  public readonly visual: CarVisualRig;
  public name: string;

  public targetX = 0;
  public targetY = 0.15;
  public targetZ = 0;
  public targetYaw = 0;
  public currentX = 0;
  public currentY = 0.15;
  public currentZ = 0;
  public currentYaw = 0;
  public speedKmh = 0;
  public wheelSteerAngle = 0;
  public wheelSpinAngle = 0;
  public hp = 100;
  public maxHp = 100;
  public alive = true;
  public connected = true;
  public nitroActive = false;
  public shieldActive = false;
  public isDrifting = false;
  public koExplosionDone = false;

  private hpBarGroup: THREE.Group | null = null;
  private hpBarFill: THREE.Mesh | null = null;
  private hpBarFillMat: THREE.MeshBasicMaterial | null = null;
  private nameSprite: THREE.Sprite | null = null;
  private nameTex: THREE.CanvasTexture | null = null;
  private extraGeos: THREE.BufferGeometry[] = [];
  private extraMats: THREE.Material[] = [];

  constructor(
    initial: NetCarState,
    isLocalPlayer: boolean,
    scene: THREE.Scene,
    isSoftwareGl: boolean,
  ) {
    this.id = initial.id;
    this.name = initial.name;
    this.isLocalPlayer = isLocalPlayer;
    this.visual = buildSportsCar(initial.customization, isSoftwareGl);

    this.currentX = initial.x;
    this.currentY = initial.y;
    this.currentZ = initial.z;
    this.currentYaw = initial.yaw;
    this.targetX = initial.x;
    this.targetY = initial.y;
    this.targetZ = initial.z;
    this.targetYaw = initial.yaw;

    this.visual.root.position.set(initial.x, initial.y, initial.z);
    this.visual.root.rotation.y = initial.yaw;

    if (!isLocalPlayer) {
      this.createFloatingHeader(scene, initial.name, initial.isAi);
    }

    scene.add(this.visual.root);
    this.applySnapshot(initial, true);
  }

  private createFloatingHeader(scene: THREE.Scene, driverName: string, isAi: boolean): void {
    const grp = new THREE.Group();
    const bgGeo = new THREE.PlaneGeometry(1.8, 0.24);
    const bgMat = new THREE.MeshBasicMaterial({
      color: '#090d14',
      transparent: true,
      opacity: 0.78,
      depthTest: false,
    });
    const bg = new THREE.Mesh(bgGeo, bgMat);

    const fillGeo = new THREE.PlaneGeometry(1.7, 0.16);
    const fillMat = new THREE.MeshBasicMaterial({
      color: '#22c55e',
      depthTest: false,
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.z = 0.01;

    grp.add(bg, fill);
    grp.renderOrder = 10;

    // Driver name plate via CanvasTexture Sprite
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 256, 64);
      ctx.fillStyle = 'rgba(9, 13, 20, 0.75)';
      ctx.fillRect(16, 12, 224, 40);
      ctx.strokeStyle = isAi ? '#f59e0b' : '#38bdf8';
      ctx.lineWidth = 3;
      ctx.strokeRect(16, 12, 224, 40);
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(driverName.slice(0, 14), 128, 33);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(spMat);
    sprite.scale.set(2.8, 0.7, 1);
    sprite.position.set(0, 0.48, 0);
    sprite.renderOrder = 11;
    grp.add(sprite);

    scene.add(grp);
    this.hpBarGroup = grp;
    this.hpBarFill = fill;
    this.hpBarFillMat = fillMat;
    this.nameSprite = sprite;
    this.nameTex = tex;
    this.extraGeos.push(bgGeo, fillGeo);
    this.extraMats.push(bgMat, fillMat, spMat);
  }

  public applySnapshot(state: NetCarState, snapImmediately = false): void {
    this.targetX = state.x;
    this.targetY = state.y;
    this.targetZ = state.z;
    this.targetYaw = state.yaw;
    this.speedKmh = state.speedKmh;
    this.wheelSteerAngle = state.wheelSteerAngle;
    this.hp = state.hp;
    this.maxHp = state.maxHp;
    this.alive = state.alive;
    this.connected = state.connected;
    this.nitroActive = state.nitroActive || state.driftBoostRemaining > 0 || state.nitroAbilityTimer > 0 || state.dashTimer > 0;
    this.shieldActive = state.shieldTimer > 0 || state.armorTimer > 0;
    this.isDrifting = state.isDrifting;

    if (snapImmediately || Math.hypot(state.x - this.currentX, state.z - this.currentZ) > 22) {
      this.currentX = state.x;
      this.currentY = state.y;
      this.currentZ = state.z;
      this.currentYaw = state.yaw;
    }

    this.visual.shieldMesh.visible = this.alive && this.shieldActive;
    for (const flame of this.visual.nitroFlames) {
      flame.visible = this.alive && this.nitroActive;
    }
    if (!this.alive) {
      this.visual.bodyPaintMaterial.color.set('#374151');
    } else if (!this.connected) {
      this.visual.bodyPaintMaterial.color.set('#64748b');
    } else {
      this.visual.bodyPaintMaterial.color.set(state.customization.bodyColor);
    }
  }

  public updateVisual(dt: number, cameraPos: THREE.Vector3): void {
    const posRate = this.isLocalPlayer ? 22 : 14;
    const alpha = 1 - Math.exp(-posRate * dt);

    this.currentX = THREE.MathUtils.lerp(this.currentX, this.targetX, alpha);
    this.currentY = THREE.MathUtils.lerp(this.currentY, this.targetY, alpha);
    this.currentZ = THREE.MathUtils.lerp(this.currentZ, this.targetZ, alpha);
    this.currentYaw = lerpAngle(this.currentYaw, this.targetYaw, alpha);

    this.visual.root.position.set(this.currentX, this.currentY, this.currentZ);
    this.visual.root.rotation.y = this.currentYaw;

    // Spin wheels proportionally to speed
    const speedMps = this.speedKmh / 3.6;
    this.wheelSpinAngle = (this.wheelSpinAngle + (speedMps / 0.36) * dt) % (Math.PI * 2);
    this.visual.wheelPivots.frontLeft.rotation.y = this.wheelSteerAngle;
    this.visual.wheelPivots.frontRight.rotation.y = this.wheelSteerAngle;
    this.visual.wheels.frontLeft.rotation.x = -this.wheelSpinAngle;
    this.visual.wheels.frontRight.rotation.x = -this.wheelSpinAngle;
    this.visual.wheels.rearLeft.rotation.x = -this.wheelSpinAngle;
    this.visual.wheels.rearRight.rotation.x = -this.wheelSpinAngle;

    if (this.visual.shieldMesh.visible) {
      this.visual.shieldMesh.rotation.y += dt * 1.4;
    }
    if (this.nitroActive) {
      const flicker = 0.85 + Math.random() * 0.45;
      for (const flame of this.visual.nitroFlames) {
        flame.scale.set(1, 1, flicker);
      }
    }

    if (this.hpBarGroup && this.hpBarFill && this.hpBarFillMat) {
      this.hpBarGroup.visible = this.alive;
      if (this.alive) {
        this.hpBarGroup.position.set(this.currentX, this.currentY + 2.35, this.currentZ);
        this.hpBarGroup.quaternion.copy(this.hpBarGroup.quaternion);
        this.hpBarGroup.lookAt(cameraPos);
        const ratio = Math.max(0.01, this.hp / this.maxHp);
        this.hpBarFill.scale.x = ratio;
        this.hpBarFill.position.x = -0.85 * (1 - ratio);
        this.hpBarFillMat.color.set(
          ratio > 0.5 ? '#22c55e' : ratio > 0.25 ? '#eab308' : '#ef4444',
        );
      }
    }
  }

  public dispose(scene: THREE.Scene): void {
    scene.remove(this.visual.root);
    this.visual.dispose();
    if (this.hpBarGroup) {
      scene.remove(this.hpBarGroup);
    }
    this.nameSprite?.clear();
    this.nameTex?.dispose();
    this.extraGeos.forEach((g) => g.dispose());
    this.extraMats.forEach((m) => m.dispose());
  }
}
