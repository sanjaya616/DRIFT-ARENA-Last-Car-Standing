import RAPIER from '@dimforge/rapier3d-compat';

export interface CollisionImpactEvent {
  colliderHandleA: number;
  colliderHandleB: number;
}

export interface DynamicPropHandle {
  id: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  halfExtents: { x: number; y: number; z: number };
}

export interface KinematicBodyHandle {
  id: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export class PhysicsWorld {
  public rapier!: typeof RAPIER;
  public world!: RAPIER.World;
  private eventQueue!: RAPIER.EventQueue;
  private initialized = false;
  private colliderOwnerMap = new Map<number, string>();

  public async init(): Promise<void> {
    if (this.initialized) return;
    await RAPIER.init();
    this.rapier = RAPIER;
    this.createWorld();
    this.initialized = true;
  }

  public resetWorld(): void {
    if (!this.initialized) return;
    this.eventQueue?.free();
    this.world?.free();
    this.colliderOwnerMap.clear();
    this.createWorld();
  }

  private createWorld(): void {
    this.world = new this.rapier.World({ x: 0.0, y: -18.0, z: 0.0 });
    this.eventQueue = new this.rapier.EventQueue(true);
  }

  public registerOwner(colliderHandle: number, ownerId: string): void {
    this.colliderOwnerMap.set(colliderHandle, ownerId);
  }

  public getOwner(colliderHandle: number): string | undefined {
    return this.colliderOwnerMap.get(colliderHandle);
  }

  public createGround(halfSize: number): RAPIER.Collider {
    const bodyDesc = this.rapier.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
    const body = this.world.createRigidBody(bodyDesc);
    const colDesc = this.rapier.ColliderDesc.cuboid(halfSize, 0.5, halfSize)
      .setFriction(0.05)
      .setRestitution(0.1);
    const col = this.world.createCollider(colDesc, body);
    this.registerOwner(col.handle, 'ground');
    return col;
  }

  public createStaticBox(
    ownerId: string,
    x: number,
    y: number,
    z: number,
    hx: number,
    hy: number,
    hz: number,
    yawRad = 0,
    pitchRad = 0,
    rollRad = 0,
  ): RAPIER.Collider {
    const bodyDesc = this.rapier.RigidBodyDesc.fixed().setTranslation(x, y, z);

    // Intrinsic YXZ rotation quaternion: q = qY * qX * qZ
    const cy = Math.cos(yawRad * 0.5);
    const sy = Math.sin(yawRad * 0.5);
    const cp = Math.cos(pitchRad * 0.5);
    const sp = Math.sin(pitchRad * 0.5);
    const cr = Math.cos(rollRad * 0.5);
    const sr = Math.sin(rollRad * 0.5);

    const qx = cy * sp * cr + sy * cp * sr;
    const qy = sy * cp * cr - cy * sp * sr;
    const qz = cy * cp * sr - sy * sp * cr;
    const qw = cy * cp * cr + sy * sp * sr;

    bodyDesc.setRotation({ x: qx, y: qy, z: qz, w: qw });

    const body = this.world.createRigidBody(bodyDesc);
    const colDesc = this.rapier.ColliderDesc.cuboid(hx, hy, hz)
      .setFriction(0.06)
      .setRestitution(0.32);
    const col = this.world.createCollider(colDesc, body);
    this.registerOwner(col.handle, ownerId);
    return col;
  }

  public createKinematicBox(
    ownerId: string,
    x: number,
    y: number,
    z: number,
    hx: number,
    hy: number,
    hz: number,
  ): KinematicBodyHandle {
    const bodyDesc = this.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
      x,
      y,
      z,
    );
    const body = this.world.createRigidBody(bodyDesc);
    const colDesc = this.rapier.ColliderDesc.cuboid(hx, hy, hz)
      .setFriction(0.08)
      .setRestitution(0.38)
      .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS);
    const collider = this.world.createCollider(colDesc, body);
    this.registerOwner(collider.handle, ownerId);
    return { id: ownerId, body, collider };
  }

  public createDynamicBox(
    ownerId: string,
    x: number,
    y: number,
    z: number,
    hx: number,
    hy: number,
    hz: number,
    mass = 40,
  ): DynamicPropHandle {
    const bodyDesc = this.rapier.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(0.6)
      .setAngularDamping(1.2);
    const body = this.world.createRigidBody(bodyDesc);
    const colDesc = this.rapier.ColliderDesc.cuboid(hx, hy, hz)
      .setMass(mass)
      .setFriction(0.55)
      .setRestitution(0.35)
      .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS);
    const col = this.world.createCollider(colDesc, body);
    this.registerOwner(col.handle, ownerId);
    return { id: ownerId, body, collider: col, halfExtents: { x: hx, y: hy, z: hz } };
  }

  public createCarBody(
    ownerId: string,
    x: number,
    y: number,
    z: number,
    yawRad: number,
    massKg: number,
  ): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const halfY = Math.sin(yawRad * 0.5);
    const halfW = Math.cos(yawRad * 0.5);
    const bodyDesc = this.rapier.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setRotation({ x: 0, y: halfY, z: 0, w: halfW })
      .setLinearDamping(0.18)
      .setAngularDamping(3.4)
      .enabledRotations(false, true, false)
      .setCanSleep(false);

    const body = this.world.createRigidBody(bodyDesc);

    const colDesc = this.rapier.ColliderDesc.cuboid(0.92, 0.44, 2.04)
      .setTranslation(0, 0.52, 0)
      .setMass(massKg)
      .setFriction(0.02)
      .setRestitution(0.32)
      .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS);

    const collider = this.world.createCollider(colDesc, body);
    this.registerOwner(collider.handle, ownerId);
    return { body, collider };
  }

  public castGroundRay(
    x: number,
    y: number,
    z: number,
    maxDistance: number,
    excludeCollider: RAPIER.Collider,
  ): { grounded: boolean; distance: number; normalY: number } {
    const ray = new this.rapier.Ray({ x, y, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDistance,
      true,
      undefined,
      undefined,
      excludeCollider,
    );
    if (!hit) {
      return { grounded: false, distance: maxDistance, normalY: 1 };
    }
    return {
      grounded: true,
      distance: hit.timeOfImpact,
      normalY: hit.normal.y,
    };
  }

  public step(dt: number, onCollision: (evt: CollisionImpactEvent) => void): void {
    if (!this.initialized) return;
    this.world.timestep = dt;
    this.world.step(this.eventQueue);

    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      if (started) {
        onCollision({ colliderHandleA: handle1, colliderHandleB: handle2 });
      }
    });
  }

  public dispose(): void {
    this.eventQueue?.free();
    this.world?.free();
    this.colliderOwnerMap.clear();
    this.initialized = false;
  }
}
