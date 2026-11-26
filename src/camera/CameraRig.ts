import * as THREE from 'three';

const _desiredPos = new THREE.Vector3();
const _desiredLook = new THREE.Vector3();
const _carForward = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _targetOrigin = new THREE.Vector3();

export type CameraMode = 'chase' | 'menu' | 'garage';

export class CameraRig {
  public readonly camera: THREE.PerspectiveCamera;
  private currentPos = new THREE.Vector3(0, 6, 70);
  private currentLook = new THREE.Vector3(0, 1, 56);
  private trauma = 0;
  private menuOrbitAngle = 0.45;
  private garageOrbitAngle = 2.45;
  private cameraDistanceScale = 1.0;
  private raycaster = new THREE.Raycaster();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.25, 900);
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLook);
  }

  public setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  public setDistanceScale(scale: number): void {
    this.cameraDistanceScale = Math.max(0.75, Math.min(1.4, scale));
  }

  public addTrauma(amount: number): void {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  public snapBehindCar(carPos: THREE.Vector3, carYaw: number): void {
    _carForward.set(-Math.sin(carYaw), 0, -Math.cos(carYaw));
    const backDist = 8.4 * this.cameraDistanceScale;
    this.currentPos.set(
      carPos.x - _carForward.x * backDist,
      carPos.y + 3.4,
      carPos.z - _carForward.z * backDist,
    );
    this.currentLook.set(
      carPos.x + _carForward.x * 4.5,
      carPos.y + 1.35,
      carPos.z + _carForward.z * 4.5,
    );
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLook);
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();
  }

  public snapToGarage(carPos: THREE.Vector3): void {
    this.garageOrbitAngle = 0.62;
    const radius = 6.2;
    this.currentPos.set(
      carPos.x + Math.sin(this.garageOrbitAngle) * radius,
      carPos.y + 2.05,
      carPos.z + Math.cos(this.garageOrbitAngle) * radius,
    );
    const toCamX = this.currentPos.x - carPos.x;
    const toCamZ = this.currentPos.z - carPos.z;
    const len = Math.hypot(toCamX, toCamZ) || 1;
    const camRightX = toCamZ / len;
    const camRightZ = -toCamX / len;
    this.currentLook.set(
      carPos.x - camRightX * 1.35,
      carPos.y + 0.72,
      carPos.z - camRightZ * 1.35,
    );
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLook);
    this.camera.fov = 54;
    this.camera.updateProjectionMatrix();
  }

  public update(
    dt: number,
    mode: CameraMode,
    carPos: THREE.Vector3,
    carYaw: number,
    speedKmh: number,
    nitroActive: boolean,
    raycastTargets: THREE.Object3D[],
    carVelY = 0,
    isGrounded = true,
  ): void {
    if (mode === 'menu') {
      this.menuOrbitAngle += dt * 0.14;
      const radius = 36;
      _desiredPos.set(
        Math.sin(this.menuOrbitAngle) * radius,
        38 + Math.sin(this.menuOrbitAngle * 0.7) * 3,
        Math.cos(this.menuOrbitAngle) * radius,
      );
      _desiredLook.set(0, 5.0, 0);

      const alpha = 1 - Math.exp(-3.5 * dt);
      this.currentPos.lerp(_desiredPos, alpha);
      this.currentLook.lerp(_desiredLook, alpha);
      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLook);
      return;
    }

    if (mode === 'garage') {
      this.garageOrbitAngle += dt * 0.35;
      const radius = 6.2;
      _desiredPos.set(
        carPos.x + Math.sin(this.garageOrbitAngle) * radius,
        carPos.y + 2.05,
        carPos.z + Math.cos(this.garageOrbitAngle) * radius,
      );
      // Shift look target toward camera-left so the car sits clearly in the open right-center area
      const toCamX = _desiredPos.x - carPos.x;
      const toCamZ = _desiredPos.z - carPos.z;
      const len = Math.hypot(toCamX, toCamZ) || 1;
      // Camera right = normalize(forward × up) = (toCamZ/len, 0, -toCamX/len)
      // Looking toward camera-left (-right) places the car to the right of screen center
      const camRightX = toCamZ / len;
      const camRightZ = -toCamX / len;
      _desiredLook.set(
        carPos.x - camRightX * 1.35,
        carPos.y + 0.72,
        carPos.z - camRightZ * 1.35,
      );

      const alpha = 1 - Math.exp(-6 * dt);
      this.currentPos.lerp(_desiredPos, alpha);
      this.currentLook.lerp(_desiredLook, alpha);
      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLook);
      if (Math.abs(this.camera.fov - 52) > 0.1) {
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 52, alpha);
        this.camera.updateProjectionMatrix();
      }
      return;
    }

    // Third-person chase camera behind player car
    _carForward.set(-Math.sin(carYaw), 0, -Math.cos(carYaw));
    const speedRatio = Math.min(1, speedKmh / 140);
    const airborneExtra = isGrounded ? 0 : Math.min(1.4, Math.max(-0.4, Math.abs(carVelY) * 0.08));
    const backDist = (7.8 + speedRatio * 1.4 + airborneExtra * 0.9) * this.cameraDistanceScale;
    const heightOffset = 3.25 + speedRatio * 0.45 + airborneExtra * 0.55;

    _desiredPos.set(
      carPos.x - _carForward.x * backDist,
      carPos.y + heightOffset,
      carPos.z - _carForward.z * backDist,
    );
    _desiredLook.set(
      carPos.x + _carForward.x * 5.0,
      carPos.y + 1.3 + (isGrounded ? 0 : Math.max(-0.5, Math.min(0.8, carVelY * 0.04))),
      carPos.z + _carForward.z * 5.0,
    );

    // Wall pull-in raycast so camera never clips behind buildings/walls
    _targetOrigin.set(carPos.x, carPos.y + 1.4, carPos.z);
    _rayDir.subVectors(_desiredPos, _targetOrigin);
    const desiredDist = _rayDir.length();
    if (desiredDist > 0.1 && raycastTargets.length > 0) {
      _rayDir.divideScalar(desiredDist);
      this.raycaster.set(_targetOrigin, _rayDir);
      this.raycaster.near = 0.5;
      this.raycaster.far = desiredDist;
      const hits = this.raycaster.intersectObjects(raycastTargets, false);
      if (hits.length > 0) {
        const safeDist = Math.max(2.6, hits[0].distance - 0.5);
        _desiredPos.copy(_targetOrigin).addScaledVector(_rayDir, safeDist);
      }
    }

    // Exponential damping for silky chase follow
    const posAlpha = 1 - Math.exp(-9.5 * dt);
    const lookAlpha = 1 - Math.exp(-14 * dt);
    this.currentPos.lerp(_desiredPos, posAlpha);
    this.currentLook.lerp(_desiredLook, lookAlpha);

    // Dynamic FOV kick during speed & Nitro
    const targetFov = 62 + speedRatio * 8 + (nitroActive ? 7 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(
        this.camera.fov,
        targetFov,
        1 - Math.exp(-6 * dt),
      );
      this.camera.updateProjectionMatrix();
    }

    // Decaying trauma^2 camera shake
    this.trauma = Math.max(0, this.trauma - dt * 2.2);
    const shakeMag = this.trauma * this.trauma * 0.45;
    const sx = shakeMag > 0.001 ? (Math.random() - 0.5) * 2 * shakeMag : 0;
    const sy = shakeMag > 0.001 ? (Math.random() - 0.5) * 2 * shakeMag : 0;

    this.camera.position.set(
      this.currentPos.x + sx,
      this.currentPos.y + sy,
      this.currentPos.z,
    );
    this.camera.lookAt(this.currentLook);
  }
}
