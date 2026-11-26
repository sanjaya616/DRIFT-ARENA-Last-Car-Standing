import * as THREE from 'three';
import type { CarController } from '../cars/CarController';
import {
  ABILITY_SPECS,
  isPickupSpawnValid,
  isWeaponPickup,
  PICKUP_SPAWN_CONFIG,
  pickWeightedPickupKind,
  WEAPON_SPECS,
} from '../combat/combatRules';
import { PICKUP_CANDIDATE_ZONES } from '../maps/neonHarborLayout';
import type { PickupKind } from '../types/game';

export interface ActivePowerUp {
  id: string;
  kind: PickupKind;
  zoneIndex: number;
  x: number;
  y: number;
  z: number;
  ttl: number;
  color: string;
  mesh: THREE.Group;
  iconGroup: THREE.Group;
  ringMesh: THREE.Mesh;
}

export function getPickupColor(kind: PickupKind): string {
  return isWeaponPickup(kind) ? WEAPON_SPECS[kind].color : ABILITY_SPECS[kind].color;
}

export class PowerUpSystem {
  public readonly nodes: ActivePowerUp[] = [];
  private scene: THREE.Scene;
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private ringGeo: THREE.TorusGeometry;
  private shadowGeo: THREE.CircleGeometry;
  private shadowMat: THREE.MeshBasicMaterial;
  private elapsed = 0;
  private spawnCooldown = 0;
  private nextId = 0;
  private initialWaveSpawned = false;

  // Shared icon sub-geometries
  private coneGeo: THREE.ConeGeometry;
  private cylGeo: THREE.CylinderGeometry;
  private boxGeo: THREE.BoxGeometry;
  private sphereGeo: THREE.SphereGeometry;
  private octGeo: THREE.OctahedronGeometry;
  private discGeo: THREE.CylinderGeometry;
  private spikeGeo: THREE.ConeGeometry;

  private iconMaterials = new Map<PickupKind, THREE.MeshStandardMaterial>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.ringGeo = new THREE.TorusGeometry(1.05, 0.075, 8, 24);
    this.ringGeo.rotateX(Math.PI / 2);
    this.shadowGeo = new THREE.CircleGeometry(1.1, 16);
    this.shadowGeo.rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: '#090d14',
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });

    this.coneGeo = new THREE.ConeGeometry(0.32, 0.72, 10);
    this.cylGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.72, 10);
    this.boxGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    this.sphereGeo = new THREE.SphereGeometry(0.45, 12, 10);
    this.octGeo = new THREE.OctahedronGeometry(0.56, 0);
    this.discGeo = new THREE.CylinderGeometry(0.56, 0.62, 0.16, 14);
    this.spikeGeo = new THREE.ConeGeometry(0.14, 0.42, 6);

    this.geometries.push(
      this.ringGeo,
      this.shadowGeo,
      this.coneGeo,
      this.cylGeo,
      this.boxGeo,
      this.sphereGeo,
      this.octGeo,
      this.discGeo,
      this.spikeGeo,
    );
    this.materials.push(this.shadowMat);

    const allKinds: PickupKind[] = [
      'rocket',
      'punch',
      'bomb',
      'spike_trap',
      'proximity_mine',
      'shield',
      'armor',
      'nitro',
      'super_jump',
      'triple_jump',
      'lightning_dash',
    ];
    for (const k of allKinds) {
      const col = getPickupColor(k);
      const mat = new THREE.MeshStandardMaterial({
        color: col,
        emissive: col,
        emissiveIntensity: 0.95,
        roughness: 0.25,
        metalness: 0.35,
      });
      this.iconMaterials.set(k, mat);
      this.materials.push(mat);
    }
  }

  private buildIconMesh(kind: PickupKind): THREE.Group {
    const icon = new THREE.Group();
    const mat = this.iconMaterials.get(kind)!;

    if (kind === 'rocket') {
      const body = new THREE.Mesh(this.cylGeo, mat);
      body.rotation.z = Math.PI / 4;
      const tip = new THREE.Mesh(this.coneGeo, mat);
      tip.position.set(-0.35, 0.35, 0);
      tip.rotation.z = Math.PI / 4;
      icon.add(body, tip);
    } else if (kind === 'punch') {
      const fist = new THREE.Mesh(this.boxGeo, mat);
      fist.scale.set(1.25, 0.95, 0.95);
      const thumb = new THREE.Mesh(this.boxGeo, mat);
      thumb.scale.set(0.5, 0.5, 0.5);
      thumb.position.set(0.28, -0.25, 0.28);
      icon.add(fist, thumb);
    } else if (kind === 'bomb') {
      const ball = new THREE.Mesh(this.sphereGeo, mat);
      const cap = new THREE.Mesh(this.cylGeo, mat);
      cap.scale.set(0.45, 0.38, 0.45);
      cap.position.y = 0.48;
      icon.add(ball, cap);
    } else if (kind === 'spike_trap') {
      const base = new THREE.Mesh(this.discGeo, mat);
      icon.add(base);
      const offsets = [
        [-0.24, -0.24],
        [0.24, -0.24],
        [-0.24, 0.24],
        [0.24, 0.24],
      ];
      for (const [ox, oz] of offsets) {
        const sp = new THREE.Mesh(this.spikeGeo, mat);
        sp.position.set(ox, 0.24, oz);
        icon.add(sp);
      }
    } else if (kind === 'proximity_mine') {
      const disc = new THREE.Mesh(this.discGeo, mat);
      const dome = new THREE.Mesh(this.sphereGeo, mat);
      dome.scale.set(0.55, 0.38, 0.55);
      dome.position.y = 0.14;
      icon.add(disc, dome);
    } else if (kind === 'shield') {
      const core = new THREE.Mesh(this.octGeo, mat);
      core.scale.set(1.05, 1.25, 0.55);
      icon.add(core);
    } else if (kind === 'armor') {
      const plate = new THREE.Mesh(this.boxGeo, mat);
      plate.scale.set(1.2, 1.35, 0.55);
      const crest = new THREE.Mesh(this.boxGeo, mat);
      crest.scale.set(1.5, 0.42, 0.62);
      crest.position.y = 0.25;
      icon.add(plate, crest);
    } else if (kind === 'nitro') {
      const c1 = new THREE.Mesh(this.cylGeo, mat);
      c1.position.x = -0.22;
      c1.scale.set(0.75, 1.05, 0.75);
      const c2 = new THREE.Mesh(this.cylGeo, mat);
      c2.position.x = 0.22;
      c2.scale.set(0.75, 1.05, 0.75);
      icon.add(c1, c2);
    } else if (kind === 'super_jump') {
      const shaft = new THREE.Mesh(this.cylGeo, mat);
      shaft.scale.set(0.65, 0.85, 0.65);
      shaft.position.y = -0.18;
      const head = new THREE.Mesh(this.coneGeo, mat);
      head.scale.set(1.4, 0.85, 1.4);
      head.position.y = 0.38;
      icon.add(shaft, head);
    } else if (kind === 'triple_jump') {
      for (let i = -1; i <= 1; i++) {
        const chev = new THREE.Mesh(this.coneGeo, mat);
        chev.scale.set(1.15, 0.48, 1.15);
        chev.position.y = i * 0.34;
        icon.add(chev);
      }
    } else {
      // lightning_dash
      const top = new THREE.Mesh(this.boxGeo, mat);
      top.scale.set(0.45, 1.0, 0.35);
      top.rotation.z = -0.45;
      top.position.set(0.12, 0.22, 0);
      const bot = new THREE.Mesh(this.boxGeo, mat);
      bot.scale.set(0.45, 1.0, 0.35);
      bot.rotation.z = -0.45;
      bot.position.set(-0.12, -0.22, 0);
      icon.add(top, bot);
    }

    return icon;
  }

  private trySpawnOne(
    cars: CarController[],
    safeZoneRadiusMeters: number,
    drawbridgeOpenAmount: number,
  ): boolean {
    if (this.nodes.length >= PICKUP_SPAWN_CONFIG.maxActive) return false;

    const playerPositions = cars
      .filter((c) => c.alive)
      .map((c) => {
        const p = c.body.translation();
        return { x: p.x, z: p.z };
      });

    const indices = PICKUP_CANDIDATE_ZONES.map((_, idx) => idx);
    // Shuffle candidate indices
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = indices[i];
      indices[i] = indices[j];
      indices[j] = tmp;
    }

    for (const zoneIdx of indices) {
      const zone = PICKUP_CANDIDATE_ZONES[zoneIdx];
      const onOpenBridge =
        drawbridgeOpenAmount > 0.1 &&
        zone.x >= 130 &&
        zone.x <= 200 &&
        Math.abs(zone.z) <= 18;
      const valid = isPickupSpawnValid({
        x: zone.x,
        z: zone.z,
        existingPickups: this.nodes,
        playerPositions,
        safeZoneRadiusMeters,
        isAccessible: !onOpenBridge,
      });
      if (!valid) continue;

      const kind = pickWeightedPickupKind();
      const color = getPickupColor(kind);
      const group = new THREE.Group();
      group.position.set(zone.x, zone.y, zone.z);

      const iconGroup = this.buildIconMesh(kind);
      iconGroup.position.y = 1.2;

      const ringMesh = new THREE.Mesh(
        this.ringGeo,
        this.iconMaterials.get(kind)!,
      );
      ringMesh.position.y = 1.2;

      const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
      shadow.position.y = 0.04;

      group.add(iconGroup, ringMesh, shadow);
      this.scene.add(group);

      this.nodes.push({
        id: `pickup_${this.nextId++}`,
        kind,
        zoneIndex: zoneIdx,
        x: zone.x,
        y: zone.y,
        z: zone.z,
        ttl: PICKUP_SPAWN_CONFIG.pickupLifetimeSec,
        color,
        mesh: group,
        iconGroup,
        ringMesh,
      });
      return true;
    }

    return false;
  }

  private removeNodeAt(index: number): void {
    const node = this.nodes[index];
    this.scene.remove(node.mesh);
    this.nodes.splice(index, 1);
  }

  public reset(): void {
    for (const node of this.nodes) {
      this.scene.remove(node.mesh);
    }
    this.nodes.length = 0;
    this.elapsed = 0;
    this.spawnCooldown = 0;
    this.initialWaveSpawned = false;
  }

  public update(
    dt: number,
    cars: CarController[],
    params: {
      canSpawn: boolean;
      safeZoneRadiusMeters: number;
      drawbridgeOpenAmount: number;
    },
    onCollect: (
      car: CarController,
      kind: PickupKind,
      x: number,
      z: number,
      color: string,
    ) => void,
  ): void {
    this.elapsed += dt;

    // Spawn initial 8 pickups once delay expires, then 1 every 5-8s up to 12 max
    if (params.canSpawn) {
      if (!this.initialWaveSpawned) {
        this.initialWaveSpawned = true;
        for (let i = 0; i < PICKUP_SPAWN_CONFIG.minActive; i++) {
          this.trySpawnOne(
            cars,
            params.safeZoneRadiusMeters,
            params.drawbridgeOpenAmount,
          );
        }
        this.spawnCooldown =
          PICKUP_SPAWN_CONFIG.minSpawnIntervalSec +
          Math.random() *
            (PICKUP_SPAWN_CONFIG.maxSpawnIntervalSec -
              PICKUP_SPAWN_CONFIG.minSpawnIntervalSec);
      } else {
        this.spawnCooldown -= dt;
        // Maintain 8–12 active pickups; spawn new pickup every 5–8 seconds
        if (this.nodes.length < PICKUP_SPAWN_CONFIG.minActive) {
          this.trySpawnOne(
            cars,
            params.safeZoneRadiusMeters,
            params.drawbridgeOpenAmount,
          );
        } else if (
          this.spawnCooldown <= 0 &&
          this.nodes.length < PICKUP_SPAWN_CONFIG.maxActive
        ) {
          this.trySpawnOne(
            cars,
            params.safeZoneRadiusMeters,
            params.drawbridgeOpenAmount,
          );
          this.spawnCooldown =
            PICKUP_SPAWN_CONFIG.minSpawnIntervalSec +
            Math.random() *
              (PICKUP_SPAWN_CONFIG.maxSpawnIntervalSec -
                PICKUP_SPAWN_CONFIG.minSpawnIntervalSec);
        }
      }
    }

    // Iterate backwards so TTL removal or collection is safe
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      node.ttl -= dt;
      if (node.ttl <= 0) {
        this.removeNodeAt(i);
        continue;
      }

      const bob = 1.2 + Math.sin(this.elapsed * 3.1 + node.x * 0.12) * 0.22;
      node.iconGroup.position.y = bob;
      node.iconGroup.rotation.y += dt * 2.4;
      node.ringMesh.position.y = bob;
      node.ringMesh.rotation.z += dt * 1.5;

      // Subtle shrink warning in final 1.5s before disappearing
      if (node.ttl < 1.5) {
        const s = Math.max(0.25, node.ttl / 1.5);
        node.iconGroup.scale.setScalar(s);
        node.ringMesh.scale.setScalar(s);
      } else {
        node.iconGroup.scale.setScalar(1);
        node.ringMesh.scale.setScalar(1);
      }

      let collected = false;
      for (const car of cars) {
        if (!car.alive) continue;
        const p = car.body.translation();
        const dx = p.x - node.x;
        const dy = p.y - node.y;
        const dz = p.z - node.z;
        if (
          dx * dx + dz * dz <=
            PICKUP_SPAWN_CONFIG.collectDistanceMeters *
              PICKUP_SPAWN_CONFIG.collectDistanceMeters &&
          Math.abs(dy) < 2.8
        ) {
          car.equipPickup(node.kind);
          onCollect(car, node.kind, node.x, node.z, node.color);
          this.removeNodeAt(i);
          collected = true;
          break;
        }
      }
      if (collected) continue;
    }
  }

  public syncFromServer(
    serverPickups: Array<{ id: string; kind: PickupKind; x: number; y: number; z: number; ttl: number }>,
    dt: number,
  ): void {
    this.elapsed += dt;
    const keepIds = new Set(serverPickups.map((p) => p.id));

    for (let i = this.nodes.length - 1; i >= 0; i--) {
      if (!keepIds.has(this.nodes[i].id)) {
        this.removeNodeAt(i);
      }
    }

    for (const sp of serverPickups) {
      let existing = this.nodes.find((n) => n.id === sp.id);
      if (!existing) {
        const color = getPickupColor(sp.kind);
        const group = new THREE.Group();
        group.position.set(sp.x, sp.y, sp.z);
        const iconGroup = this.buildIconMesh(sp.kind);
        iconGroup.position.y = 1.2;
        const ringMesh = new THREE.Mesh(this.ringGeo, this.iconMaterials.get(sp.kind)!);
        ringMesh.position.y = 1.2;
        const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
        shadow.position.y = 0.04;
        group.add(iconGroup, ringMesh, shadow);
        this.scene.add(group);

        existing = {
          id: sp.id,
          kind: sp.kind,
          zoneIndex: -1,
          x: sp.x,
          y: sp.y,
          z: sp.z,
          ttl: sp.ttl,
          color,
          mesh: group,
          iconGroup,
          ringMesh,
        };
        this.nodes.push(existing);
      }

      existing.ttl = sp.ttl;
      const bob = 1.2 + Math.sin(this.elapsed * 3.1 + existing.x * 0.12) * 0.22;
      existing.iconGroup.position.y = bob;
      existing.iconGroup.rotation.y += dt * 2.4;
      existing.ringMesh.position.y = bob;
      existing.ringMesh.rotation.z += dt * 1.5;

      const s = existing.ttl < 1.5 ? Math.max(0.25, existing.ttl / 1.5) : 1;
      existing.iconGroup.scale.setScalar(s);
      existing.ringMesh.scale.setScalar(s);
    }
  }

  public dispose(scene: THREE.Scene): void {
    for (const node of this.nodes) {
      scene.remove(node.mesh);
    }
    this.nodes.length = 0;
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}

