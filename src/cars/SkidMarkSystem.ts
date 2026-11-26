import * as THREE from 'three';

interface SkidSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  life: number;
  maxLife: number;
}

const MAX_SKIDS = 260;
const _dummy = new THREE.Object3D();

export class SkidMarkSystem {
  private slots: SkidSlot[] = [];
  private cursor = 0;
  private mesh: THREE.InstancedMesh;
  private geo: THREE.PlaneGeometry;
  private mat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.geo = new THREE.PlaneGeometry(0.32, 0.95);
    this.geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({
      color: '#0f131a',
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, MAX_SKIDS);
    this.mesh.frustumCulled = false;

    for (let i = 0; i < MAX_SKIDS; i++) {
      this.slots.push({
        active: false,
        x: 0,
        y: -50,
        z: 0,
        yaw: 0,
        life: 0,
        maxLife: 1,
      });
      _dummy.position.set(0, -50, 0);
      _dummy.scale.setScalar(0.001);
      _dummy.updateMatrix();
      this.mesh.setMatrixAt(i, _dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }

  public emitPair(
    cx: number,
    cy: number,
    cz: number,
    yaw: number,
  ): void {
    // Rear axle offsets relative to car center (rear = +1.32m along local +Z, lateral ±0.81m)
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const rearLocalZ = 1.28;

    for (const side of [-0.78, 0.78]) {
      const wx = cx + side * cos + rearLocalZ * sin;
      const wz = cz - side * sin + rearLocalZ * cos;

      const slot = this.slots[this.cursor];
      this.cursor = (this.cursor + 1) % MAX_SKIDS;
      slot.active = true;
      slot.x = wx;
      slot.y = cy + 0.045;
      slot.z = wz;
      slot.yaw = yaw;
      slot.maxLife = 5.0;
      slot.life = 5.0;
    }
  }

  public update(dt: number): void {
    let anyChanged = false;
    for (let i = 0; i < MAX_SKIDS; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      anyChanged = true;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        _dummy.position.set(0, -50, 0);
        _dummy.scale.setScalar(0.001);
        _dummy.updateMatrix();
        this.mesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }

      const fade = Math.min(1, s.life / 1.5);
      _dummy.position.set(s.x, s.y, s.z);
      _dummy.rotation.set(0, s.yaw, 0);
      _dummy.scale.set(1, 1, fade);
      _dummy.updateMatrix();
      this.mesh.setMatrixAt(i, _dummy.matrix);
    }
    if (anyChanged) {
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  public reset(): void {
    for (let i = 0; i < MAX_SKIDS; i++) {
      this.slots[i].active = false;
      _dummy.position.set(0, -50, 0);
      _dummy.scale.setScalar(0.001);
      _dummy.updateMatrix();
      this.mesh.setMatrixAt(i, _dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  public dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}
