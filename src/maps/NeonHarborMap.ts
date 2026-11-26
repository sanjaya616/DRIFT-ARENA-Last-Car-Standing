import * as THREE from 'three';
import {
  WORLD_HALF_METERS,
  WORLD_SIZE_METERS,
  type DrawbridgePhase,
  type MinimapObstacle,
  type TrainPhase,
} from '../types/game';
import { PhysicsWorld, type DynamicPropHandle, type KinematicBodyHandle } from '../physics/PhysicsWorld';
import {
  CONNECTED_ROADS,
  createInitialTrainSchedule,
  evaluateDrawbridgeState,
  stepTrainSchedule,
  type TrainScheduleState,
} from './neonHarborLayout';

export interface ArenaDynamicProp {
  handle: DynamicPropHandle;
  mesh: THREE.Mesh;
}

export interface NeonHarborMapInstance {
  group: THREE.Group;
  raycastTargets: THREE.Object3D[];
  minimapObstacles: MinimapObstacle[];
  dynamicProps: ArenaDynamicProp[];
  drawbridgePhase: DrawbridgePhase;
  drawbridgeOpenAmount: number;
  trainPhase: TrainPhase;
  trainZ: number;
  updateDynamicWorld: (dt: number, elapsedSec: number) => void;
  syncFromNetworkState: (
    dt: number,
    elapsedSec: number,
    bridgePhase: DrawbridgePhase,
    bridgeOpenAmount: number,
    trainPhase: TrainPhase,
    trainZ: number,
  ) => void;
  resetDynamicProps: () => void;
  dispose: () => void;
}

function createAsphaltTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#242933';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 30 + Math.floor(Math.random() * 24);
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    ctx.fillRect(x, y, 2, 2);
  }

  ctx.fillStyle = '#facc15';
  for (let y = 16; y < 512; y += 64) {
    ctx.fillRect(250, y, 12, 36);
  }

  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(14, 0, 8, 512);
  ctx.fillRect(490, 0, 8, 512);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

function createGroundTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#2d443a';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const g = 56 + Math.floor(Math.random() * 26);
    ctx.fillStyle = `rgb(${Math.floor(g * 0.62)},${g},${Math.floor(g * 0.72)})`;
    ctx.fillRect(x, y, 3, 3);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 2;
  for (let p = 0; p <= 512; p += 128) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(512, p);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(42, 42);
  tex.anisotropy = maxAniso;
  return tex;
}

function createStripeTexture(
  colorA: string,
  colorB: string,
  maxAniso: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = colorA;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = colorB;
  for (let i = -256; i < 512; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 32, 0);
    ctx.lineTo(i + 288, 256);
    ctx.lineTo(i + 256, 256);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

function createWaterTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0c4a6e';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.28)';
  ctx.lineWidth = 3;
  for (let y = 16; y < 256; y += 32) {
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 16) {
      const wy = y + Math.sin((x / 256) * Math.PI * 4) * 5;
      if (x === 0) ctx.moveTo(x, wy);
      else ctx.lineTo(x, wy);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 18);
  tex.anisotropy = maxAniso;
  return tex;
}

function createBuildingFacadeTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#252f3f';
  ctx.fillRect(0, 0, 256, 512);
  for (let y = 18; y < 500; y += 28) {
    for (let x = 14; x < 242; x += 28) {
      const lit = (x * 13 + y * 7) % 11 > 4;
      ctx.fillStyle = lit
        ? (x + y) % 5 === 0
          ? 'rgba(56, 189, 248, 0.72)'
          : 'rgba(254, 240, 138, 0.58)'
        : 'rgba(15, 23, 42, 0.82)';
      ctx.fillRect(x, y, 16, 16);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

export function buildNeonHarborMap(
  scene: THREE.Scene,
  physics: PhysicsWorld,
  renderer: THREE.WebGLRenderer,
): NeonHarborMapInstance {
  const group = new THREE.Group();
  const raycastTargets: THREE.Object3D[] = [];
  const minimapObstacles: MinimapObstacle[] = [];
  const dynamicProps: ArenaDynamicProp[] = [];
  const initialPropPositions: Array<{ x: number; y: number; z: number }> = [];

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const facadeTex = createBuildingFacadeTexture(maxAniso);
  textures.push(facadeTex);

  // Shared materials
  const buildingMat = new THREE.MeshStandardMaterial({
    color: '#cbd5e1',
    map: facadeTex,
    roughness: 0.65,
    metalness: 0.25,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: '#0f172a',
    roughness: 0.45,
    metalness: 0.55,
  });
  const neonCyanMat = new THREE.MeshStandardMaterial({
    color: '#38bdf8',
    emissive: '#0284c7',
    emissiveIntensity: 1.4,
  });
  const neonOrangeMat = new THREE.MeshStandardMaterial({
    color: '#f97316',
    emissive: '#ea580c',
    emissiveIntensity: 1.4,
  });
  const neonPinkMat = new THREE.MeshStandardMaterial({
    color: '#f43f5e',
    emissive: '#e11d48',
    emissiveIntensity: 1.35,
  });
  const neonGreenMat = new THREE.MeshStandardMaterial({
    color: '#22c55e',
    emissive: '#16a34a',
    emissiveIntensity: 1.25,
  });
  const concreteMat = new THREE.MeshStandardMaterial({
    color: '#64748b',
    roughness: 0.85,
    metalness: 0.1,
  });
  const steelMat = new THREE.MeshStandardMaterial({
    color: '#475569',
    roughness: 0.38,
    metalness: 0.72,
  });
  const hazardTex = createStripeTexture('#f59e0b', '#1e293b', maxAniso);
  const barrierTex = createStripeTexture('#ef4444', '#f8fafc', maxAniso);
  textures.push(hazardTex, barrierTex);

  const rampMat = new THREE.MeshStandardMaterial({
    map: hazardTex,
    roughness: 0.55,
    metalness: 0.2,
  });
  const barrierMat = new THREE.MeshStandardMaterial({
    map: barrierTex,
    roughness: 0.65,
    metalness: 0.12,
  });
  materials.push(
    buildingMat,
    trimMat,
    neonCyanMat,
    neonOrangeMat,
    neonPinkMat,
    neonGreenMat,
    concreteMat,
    steelMat,
    rampMat,
    barrierMat,
  );

  // ============================================================================
  // 1. 600m x 600m BASE GROUND & OUTER BOUNDARY WALLS (-300 to +300)
  // ============================================================================
  physics.createGround(WORLD_HALF_METERS);
  const groundTex = createGroundTexture(maxAniso);
  textures.push(groundTex);
  const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE_METERS, WORLD_SIZE_METERS);
  groundGeo.rotateX(-Math.PI / 2);
  geometries.push(groundGeo);
  const groundMat = new THREE.MeshStandardMaterial({
    map: groundTex,
    roughness: 0.92,
    metalness: 0.04,
  });
  materials.push(groundMat);
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.receiveShadow = true;
  group.add(groundMesh);

  // World outer perimeter barriers at ±298m
  const wallNSGeo = new THREE.BoxGeometry(WORLD_SIZE_METERS, 4, 3);
  const wallEWGeo = new THREE.BoxGeometry(3, 4, WORLD_SIZE_METERS);
  geometries.push(wallNSGeo, wallEWGeo);
  const wallN = new THREE.Mesh(wallNSGeo, concreteMat);
  wallN.position.set(0, 2, -298);
  const wallS = new THREE.Mesh(wallNSGeo, concreteMat);
  wallS.position.set(0, 2, 298);
  const wallW = new THREE.Mesh(wallEWGeo, concreteMat);
  wallW.position.set(-298, 2, 0);
  const wallE = new THREE.Mesh(wallEWGeo, concreteMat);
  wallE.position.set(298, 2, 0);
  group.add(wallN, wallS, wallW, wallE);

  physics.createStaticBox('world_bound_n', 0, 3, -298, 300, 3, 1.5);
  physics.createStaticBox('world_bound_s', 0, 3, 298, 300, 3, 1.5);
  physics.createStaticBox('world_bound_w', -298, 3, 0, 1.5, 3, 300);
  physics.createStaticBox('world_bound_e', 298, 3, 0, 1.5, 3, 300);

  // ============================================================================
  // 2. CONNECTED ROAD NETWORK ACROSS ALL 5 DISTRICTS
  // ============================================================================
  const roadTexNS = createAsphaltTexture(maxAniso);
  roadTexNS.repeat.set(1, 8);
  const roadTexEW = createAsphaltTexture(maxAniso);
  roadTexEW.repeat.set(1, 8);
  textures.push(roadTexNS, roadTexEW);

  const roadMatNS = new THREE.MeshStandardMaterial({
    map: roadTexNS,
    roughness: 0.78,
    metalness: 0.05,
  });
  const roadMatEW = new THREE.MeshStandardMaterial({
    map: roadTexEW,
    roughness: 0.78,
    metalness: 0.05,
  });
  materials.push(roadMatNS, roadMatEW);

  const unitPlaneGeo = new THREE.PlaneGeometry(1, 1);
  unitPlaneGeo.rotateX(-Math.PI / 2);
  geometries.push(unitPlaneGeo);

  CONNECTED_ROADS.forEach((r, idx) => {
    const isHorizontal = r.w > r.d;
    const mesh = new THREE.Mesh(unitPlaneGeo, isHorizontal ? roadMatEW : roadMatNS);
    mesh.scale.set(r.w, 1, r.d);
    mesh.position.set(r.x, 0.025 + (idx % 5) * 0.002, r.z);
    mesh.receiveShadow = true;
    group.add(mesh);
  });

  // Central Downtown Roundabout Plaza
  const plazaGeo = new THREE.CircleGeometry(28, 40);
  plazaGeo.rotateX(-Math.PI / 2);
  const plazaRingGeo = new THREE.RingGeometry(20, 22, 40);
  plazaRingGeo.rotateX(-Math.PI / 2);
  geometries.push(plazaGeo, plazaRingGeo);
  const plazaMat = new THREE.MeshStandardMaterial({
    color: '#2c3340',
    roughness: 0.75,
  });
  materials.push(plazaMat);
  const plaza = new THREE.Mesh(plazaGeo, plazaMat);
  plaza.position.set(0, 0.038, 0);
  plaza.receiveShadow = true;
  const plazaRing = new THREE.Mesh(plazaRingGeo, neonCyanMat);
  plazaRing.position.set(0, 0.044, 0);
  group.add(plaza, plazaRing);

  // Downtown Pedestrian Crosswalks & Concrete Road Curbs
  const crosswalkGeo = new THREE.PlaneGeometry(1.1, 3.2);
  crosswalkGeo.rotateX(-Math.PI / 2);
  geometries.push(crosswalkGeo);
  const crosswalkMat = new THREE.MeshBasicMaterial({ color: '#e2e8f0' });
  materials.push(crosswalkMat);
  const crosswalkPositions = [
    { x: 0, z: 32, rot: 0 },
    { x: 0, z: -32, rot: 0 },
    { x: 32, z: 0, rot: Math.PI / 2 },
    { x: -32, z: 0, rot: Math.PI / 2 },
  ];
  const cwInst = new THREE.InstancedMesh(crosswalkGeo, crosswalkMat, crosswalkPositions.length * 5);
  const cwDummy = new THREE.Object3D();
  let cwIdx = 0;
  for (const cw of crosswalkPositions) {
    for (let s = -2; s <= 2; s++) {
      cwDummy.position.set(
        cw.x + (cw.rot === 0 ? s * 2.2 : 0),
        0.046,
        cw.z + (cw.rot === 0 ? 0 : s * 2.2),
      );
      cwDummy.rotation.set(0, cw.rot, 0);
      cwDummy.updateMatrix();
      cwInst.setMatrixAt(cwIdx++, cwDummy.matrix);
    }
  }
  cwInst.instanceMatrix.needsUpdate = true;
  cwInst.computeBoundingSphere();
  group.add(cwInst);

  // North Gateway Road Tunnel Overpass at X=0, Z=-90 (18m clear span over 14m road)
  const tunnelSpan = new THREE.Group();
  tunnelSpan.position.set(0, 0, -90);
  const tunPillarGeo = new THREE.BoxGeometry(2.2, 6.4, 18);
  const tunRoofGeo = new THREE.BoxGeometry(22.4, 1.4, 18);
  const tunStripGeo = new THREE.BoxGeometry(19, 0.35, 0.45);
  geometries.push(tunPillarGeo, tunRoofGeo, tunStripGeo);
  const tunPillarL = new THREE.Mesh(tunPillarGeo, concreteMat);
  tunPillarL.position.set(-10.1, 3.2, 0);
  const tunPillarR = new THREE.Mesh(tunPillarGeo, concreteMat);
  tunPillarR.position.set(10.1, 3.2, 0);
  const tunRoof = new THREE.Mesh(tunRoofGeo, trimMat);
  tunRoof.position.set(0, 6.8, 0);
  tunRoof.castShadow = true;
  const tunSignS = new THREE.Mesh(tunStripGeo, neonCyanMat);
  tunSignS.position.set(0, 6.4, 9.1);
  const tunSignN = new THREE.Mesh(tunStripGeo, neonOrangeMat);
  tunSignN.position.set(0, 6.4, -9.1);
  tunnelSpan.add(tunPillarL, tunPillarR, tunRoof, tunSignS, tunSignN);
  group.add(tunnelSpan);
  physics.createStaticBox('dt_tunnel_pillar_l', -10.1, 3.2, -90, 1.1, 3.2, 9);
  physics.createStaticBox('dt_tunnel_pillar_r', 10.1, 3.2, -90, 1.1, 3.2, 9);

  // Central Spire Monument
  const spireBaseGeo = new THREE.CylinderGeometry(5, 5.8, 0.7, 20);
  const spireColGeo = new THREE.CylinderGeometry(1.1, 2.2, 22, 10);
  const spireHaloGeo = new THREE.TorusGeometry(3.4, 0.35, 10, 24);
  geometries.push(spireBaseGeo, spireColGeo, spireHaloGeo);
  const spireBase = new THREE.Mesh(spireBaseGeo, trimMat);
  spireBase.position.set(0, 0.35, 0);
  const spireCol = new THREE.Mesh(spireColGeo, trimMat);
  spireCol.position.set(0, 11.3, 0);
  spireCol.castShadow = true;
  const spireHalo = new THREE.Mesh(spireHaloGeo, neonCyanMat);
  spireHalo.position.set(0, 19.5, 0);
  spireHalo.rotation.x = Math.PI / 2;
  group.add(spireBase, spireCol, spireHalo);
  raycastTargets.push(spireBase, spireCol);
  physics.createStaticBox('downtown_spire', 0, 2, 0, 5.2, 2, 5.2);
  minimapObstacles.push({ x: 0, z: 0, w: 10.4, d: 10.4, kind: 'building' });

  // ============================================================================
  // 3. DISTRICT 1 – DOWNTOWN (-90..+90)
  // Buildings neatly inside city blocks, never blocking 14m/12m/8m roads!
  // ============================================================================
  const downtownBlocks = [
    { x: -22, z: -24, w: 16, h: 24, d: 18, accent: neonCyanMat },
    { x: 22, z: -24, w: 16, h: 30, d: 18, accent: neonOrangeMat },
    { x: -22, z: 24, w: 16, h: 20, d: 18, accent: neonPinkMat },
    { x: 22, z: 24, w: 16, h: 26, d: 18, accent: neonCyanMat },
    { x: -56, z: -56, w: 20, h: 32, d: 20, accent: neonOrangeMat },
    { x: 56, z: -56, w: 20, h: 28, d: 20, accent: neonCyanMat },
    { x: -56, z: 56, w: 20, h: 22, d: 20, accent: neonCyanMat },
    { x: 56, z: 56, w: 20, h: 26, d: 20, accent: neonPinkMat },
    { x: -56, z: -22, w: 18, h: 14, d: 14, accent: neonOrangeMat },
    { x: 56, z: 22, w: 18, h: 16, d: 14, accent: neonCyanMat },
  ];

  const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);
  geometries.push(unitBoxGeo);

  const addBuilding = (
    id: string,
    x: number,
    z: number,
    w: number,
    h: number,
    d: number,
    accent: THREE.Material,
  ) => {
    const bg = new THREE.Group();
    bg.position.set(x, 0, z);

    const plinth = new THREE.Mesh(unitBoxGeo, trimMat);
    plinth.scale.set(w + 1.2, 1.1, d + 1.2);
    plinth.position.y = 0.55;

    const tower = new THREE.Mesh(unitBoxGeo, buildingMat);
    tower.scale.set(w, h, d);
    tower.position.y = h / 2;
    tower.castShadow = true;
    tower.receiveShadow = true;

    const band = new THREE.Mesh(unitBoxGeo, accent);
    band.scale.set(w + 0.4, 0.9, d + 0.4);
    band.position.y = h - 2.2;

    const roof = new THREE.Mesh(unitBoxGeo, trimMat);
    roof.scale.set(w * 0.55, 2.2, d * 0.55);
    roof.position.y = h + 1.1;

    // Rooftop detail + LOD wrapper so distant buildings reduce sub-mesh draw calls
    const detailGrp = new THREE.Group();
    const acUnit = new THREE.Mesh(unitBoxGeo, concreteMat);
    acUnit.scale.set(w * 0.28, 1.1, d * 0.24);
    acUnit.position.set(w * 0.14, h + 2.6, -d * 0.1);
    const mast = new THREE.Mesh(unitBoxGeo, neonCyanMat);
    mast.scale.set(0.35, 3.2, 0.35);
    mast.position.set(-w * 0.12, h + 3.4, d * 0.12);
    detailGrp.add(plinth, band, roof, acUnit, mast);

    const lod = new THREE.LOD();
    const highLevel = new THREE.Group();
    highLevel.add(tower, detailGrp);
    const lowTower = new THREE.Mesh(unitBoxGeo, buildingMat);
    lowTower.scale.set(w, h, d);
    lowTower.position.y = h / 2;
    lod.addLevel(highLevel, 0);
    lod.addLevel(lowTower, 190);

    bg.add(lod);
    group.add(bg);
    raycastTargets.push(tower);
    physics.createStaticBox(id, x, h / 2, z, w / 2, h / 2, d / 2);
    minimapObstacles.push({ x, z, w, d, kind: 'building' });
  };

  downtownBlocks.forEach((b, i) =>
    addBuilding(`dt_bldg_${i}`, b.x, b.z, b.w, b.h, b.d, b.accent),
  );

  // Downtown Parking Areas + Rooftop Stunt Ramps (at X=-56, Z=22 and X=56, Z=-22)
  const addRamp = (
    id: string,
    x: number,
    yBase: number,
    z: number,
    width: number,
    length: number,
    height: number,
    yawRad: number,
    kind: 'ramp' | 'stunt' = 'ramp',
  ) => {
    const pitchRad = Math.atan2(height, length);
    const shape = new THREE.Shape();
    shape.moveTo(-length / 2, 0);
    shape.lineTo(length / 2, 0);
    shape.lineTo(length / 2, height);
    shape.lineTo(-length / 2, 0);

    const rGeo = new THREE.ExtrudeGeometry(shape, {
      depth: width,
      bevelEnabled: false,
    });
    rGeo.translate(0, 0, -width / 2);
    rGeo.rotateY(Math.PI / 2);
    geometries.push(rGeo);

    const rMesh = new THREE.Mesh(rGeo, rampMat);
    rMesh.position.set(x, yBase, z);
    rMesh.rotation.y = yawRad;
    rMesh.castShadow = true;
    rMesh.receiveShadow = true;
    group.add(rMesh);

    const hyp = Math.hypot(length, height);
    physics.createStaticBox(
      id,
      x,
      yBase + height * 0.44,
      z,
      width * 0.5,
      0.28,
      hyp * 0.5,
      yawRad,
      pitchRad,
    );
    minimapObstacles.push({ x, z, w: width, d: length, kind });
  };

  // Downtown parking deck + rooftop stunt ramps
  const addDeck = (id: string, x: number, yTop: number, z: number, w: number, d: number) => {
    const deck = new THREE.Mesh(unitBoxGeo, concreteMat);
    deck.scale.set(w, 0.8, d);
    deck.position.set(x, yTop - 0.4, z);
    deck.receiveShadow = true;
    group.add(deck);
    physics.createStaticBox(id, x, yTop - 0.4, z, w / 2, 0.4, d / 2);
  };

  addDeck('dt_parking_deck_w', -56, 2.2, 22, 16, 14);
  addRamp('dt_rooftop_ramp_w1', -56, 0, 35, 7, 11, 2.2, 0);
  addRamp('dt_rooftop_ramp_w2', -56, 2.2, 17, 7, 7, 1.5, 0);

  addDeck('dt_parking_deck_e', 56, 2.2, -22, 16, 14);
  addRamp('dt_rooftop_ramp_e1', 56, 0, -35, 7, 11, 2.2, Math.PI);
  addRamp('dt_rooftop_ramp_e2', 56, 2.2, -17, 7, 7, 1.5, Math.PI);

  // Streetlights (InstancedMesh along Downtown avenues)
  const poleGeo = new THREE.CylinderGeometry(0.14, 0.2, 6.5, 6);
  const lampGeo = new THREE.BoxGeometry(1.1, 0.25, 0.45);
  geometries.push(poleGeo, lampGeo);
  const lampMat = new THREE.MeshStandardMaterial({
    color: '#fef08a',
    emissive: '#fde047',
    emissiveIntensity: 1.8,
  });
  materials.push(lampMat);

  const lightCoords: Array<{ x: number; z: number }> = [];
  for (let d = -68; d <= 68; d += 34) {
    if (Math.abs(d) > 20) {
      lightCoords.push({ x: -8.5, z: d }, { x: 8.5, z: d });
      lightCoords.push({ x: d, z: -8.5 }, { x: d, z: 8.5 });
    }
  }
  const poleInst = new THREE.InstancedMesh(poleGeo, trimMat, lightCoords.length);
  const lampInst = new THREE.InstancedMesh(lampGeo, lampMat, lightCoords.length);
  const dummy = new THREE.Object3D();
  lightCoords.forEach((lc, i) => {
    dummy.position.set(lc.x, 3.25, lc.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poleInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(lc.x, 6.5, lc.z);
    dummy.updateMatrix();
    lampInst.setMatrixAt(i, dummy.matrix);
  });
  poleInst.instanceMatrix.needsUpdate = true;
  lampInst.instanceMatrix.needsUpdate = true;
  poleInst.computeBoundingSphere();
  lampInst.computeBoundingSphere();
  group.add(poleInst, lampInst);

  // ============================================================================
  // 4. DISTRICT 2 – MOUNTAIN (North: Z < -90)
  // Winding mountain road, 6 major hairpin turns, 2 stunt ramps, cliff edges,
  // elevated summit + downhill drifting chute + safe recovery checkpoints
  // ============================================================================
  // Mountain terraced plateau + elevated ridge road (9m wide)
  const mountainMat = new THREE.MeshStandardMaterial({
    color: '#475569',
    roughness: 0.9,
    metalness: 0.05,
  });
  materials.push(mountainMat);

  // Elevated Summit Plateau at X ∈ [-125..-35], Z ∈ [-235..-205], Y = 8m
  const summitGeo = new THREE.BoxGeometry(92, 8, 32);
  geometries.push(summitGeo);
  const summitBlock = new THREE.Mesh(summitGeo, mountainMat);
  summitBlock.position.set(-80, 4, -220);
  summitBlock.receiveShadow = true;
  group.add(summitBlock);
  physics.createStaticBox('mtn_summit', -80, 4, -220, 46, 4, 16);

  // East ascent ramp (from X=0, Z=-220 up to X=-35, Z=-220, rise 8m over 36m)
  addRamp('mtn_ascent_e', -17, 0, -220, 10, 36, 8, Math.PI / 2, 'ramp');
  // West downhill drift chute (from X=-125, Z=-220 down to X=-155, Z=-220)
  addRamp('mtn_descent_w', -140, 0, -220, 10, 32, 8, -Math.PI / 2, 'ramp');

  // 6 Hairpin Corner Chicane Switchback Dividers & Guardrails along Mountain roads
  const hairpinMarkers = [
    { x: 10, z: -135 },
    { x: -10, z: -175 },
    { x: 10, z: -205 },
    { x: -75, z: -205 },
    { x: -145, z: -195 },
    { x: -165, z: -145 },
  ];
  hairpinMarkers.forEach((hp, i) => {
    const rail = new THREE.Mesh(unitBoxGeo, barrierMat);
    rail.scale.set(6, 1.1, 1.2);
    rail.position.set(hp.x, 0.55, hp.z);
    group.add(rail);
    physics.createStaticBox(`mtn_hairpin_rail_${i}`, hp.x, 0.55, hp.z, 3, 0.55, 0.6);
  });

  // 2 Mountain Stunt Ramps
  addRamp('mtn_stunt_1', -75, 8, -220, 8, 12, 2.6, Math.PI / 2, 'stunt');
  addRamp('mtn_stunt_2', -155, 0, -145, 8, 11, 2.4, Math.PI, 'stunt');

  // Safe Recovery Checkpoint Arches (visual cues on mountain path)
  const checkpointCoords = [
    { x: 0, y: 0, z: -118 },
    { x: -75, y: 8, z: -220 },
    { x: -155, y: 0, z: -120 },
  ];
  const archPostGeo = new THREE.BoxGeometry(0.6, 5, 0.6);
  const archTopGeo = new THREE.BoxGeometry(11, 0.7, 0.8);
  geometries.push(archPostGeo, archTopGeo);
  checkpointCoords.forEach((cp) => {
    const pL = new THREE.Mesh(archPostGeo, neonGreenMat);
    pL.position.set(cp.x - 5.2, cp.y + 2.5, cp.z);
    const pR = new THREE.Mesh(archPostGeo, neonGreenMat);
    pR.position.set(cp.x + 5.2, cp.y + 2.5, cp.z);
    const top = new THREE.Mesh(archTopGeo, neonGreenMat);
    top.position.set(cp.x, cp.y + 5.1, cp.z);
    group.add(pL, pR, top);
  });

  // Rocks & Trees (InstancedMesh across Mountain & Harbor/Stunt perimeters)
  const rockGeo = new THREE.DodecahedronGeometry(2.4, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 2.4, 6);
  const foliageGeo = new THREE.ConeGeometry(2.2, 5.2, 7);
  geometries.push(rockGeo, trunkGeo, foliageGeo);
  const foliageMat = new THREE.MeshStandardMaterial({
    color: '#1e5e3e',
    roughness: 0.85,
  });
  materials.push(foliageMat);

  const rockCoords = [
    { x: -42, z: -115 }, { x: 42, z: -125 }, { x: -85, z: -175 },
    { x: -45, z: -265 }, { x: -125, z: -265 }, { x: -195, z: -215 },
    { x: -215, z: -145 }, { x: 45, z: -185 }, { x: 75, z: -245 },
    { x: -255, z: -245 }, { x: -265, z: -115 }, { x: -195, z: -55 },
  ];
  const rockInst = new THREE.InstancedMesh(rockGeo, mountainMat, rockCoords.length);
  rockCoords.forEach((rc, i) => {
    dummy.position.set(rc.x, 1.4, rc.z);
    dummy.rotation.set(i * 0.4, i * 0.9, 0);
    dummy.scale.set(1 + (i % 3) * 0.45, 0.9 + (i % 2) * 0.5, 1 + (i % 3) * 0.35);
    dummy.updateMatrix();
    rockInst.setMatrixAt(i, dummy.matrix);
    physics.createStaticBox(`rock_${i}`, rc.x, 1.5, rc.z, 2.4, 1.8, 2.4);
  });
  rockInst.instanceMatrix.needsUpdate = true;
  rockInst.computeBoundingSphere();
  group.add(rockInst);

  const treeCoords = [
    { x: -28, z: -110 }, { x: 28, z: -110 }, { x: -30, z: -165 },
    { x: 32, z: -165 }, { x: -185, z: -165 }, { x: -190, z: -115 },
    { x: -135, z: -105 }, { x: -95, z: -255 }, { x: -165, z: -255 },
    { x: 65, z: -210 }, { x: -265, z: -35 }, { x: -265, z: 25 },
  ];
  const trunkInst = new THREE.InstancedMesh(trunkGeo, buildingMat, treeCoords.length);
  const foliageInst = new THREE.InstancedMesh(foliageGeo, foliageMat, treeCoords.length);
  treeCoords.forEach((tc, i) => {
    dummy.position.set(tc.x, 1.2, tc.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(tc.x, 4.4, tc.z);
    dummy.scale.set(0.9 + (i % 3) * 0.15, 0.9 + (i % 3) * 0.15, 0.9 + (i % 3) * 0.15);
    dummy.updateMatrix();
    foliageInst.setMatrixAt(i, dummy.matrix);
  });
  trunkInst.instanceMatrix.needsUpdate = true;
  foliageInst.instanceMatrix.needsUpdate = true;
  trunkInst.computeBoundingSphere();
  foliageInst.computeBoundingSphere();
  group.add(trunkInst, foliageInst);

  // ============================================================================
  // 5. DISTRICT 3 – RIVER AND HARBOR (East: X > 90)
  // 35m wide animated River + Animated 3D Drawbridge (18m wide, 60m long)
  // + Alternative Stunt Ramp Route
  // ============================================================================
  const waterTex = createWaterTexture(maxAniso);
  textures.push(waterTex);
  const waterMat = new THREE.MeshStandardMaterial({
    map: waterTex,
    roughness: 0.18,
    metalness: 0.45,
  });
  materials.push(waterMat);

  // River centered at X=165, width 35m (X ∈ 147.5..182.5), Z ∈ -295..+95
  const riverGeo = new THREE.PlaneGeometry(35, 390);
  riverGeo.rotateX(-Math.PI / 2);
  geometries.push(riverGeo);
  const riverMesh = new THREE.Mesh(riverGeo, waterMat);
  riverMesh.position.set(165, 0.06, -100);
  group.add(riverMesh);

  // Drawbridge Towers & Pivoting 30m Leaves (total 60m span from X=135 to X=195, width 18m)
  const leafGeo = new THREE.BoxGeometry(30, 0.7, 18);
  geometries.push(leafGeo);
  const deckMat = new THREE.MeshStandardMaterial({
    color: '#334155',
    roughness: 0.65,
    metalness: 0.35,
  });
  materials.push(deckMat);

  const westLeafPivot = new THREE.Group();
  westLeafPivot.position.set(135, 0.36, 0);
  const westLeafMesh = new THREE.Mesh(leafGeo, deckMat);
  westLeafMesh.position.set(15, 0, 0);
  westLeafMesh.receiveShadow = true;
  westLeafPivot.add(westLeafMesh);

  const eastLeafPivot = new THREE.Group();
  eastLeafPivot.position.set(195, 0.36, 0);
  const eastLeafMesh = new THREE.Mesh(leafGeo, deckMat);
  eastLeafMesh.position.set(-15, 0, 0);
  eastLeafMesh.receiveShadow = true;
  eastLeafPivot.add(eastLeafMesh);

  group.add(westLeafPivot, eastLeafPivot);

  // Kinematic bridge deck colliders + physical road blocker gates
  const westLeafBody: KinematicBodyHandle = physics.createKinematicBox(
    'drawbridge_leaf_w',
    150,
    0.36,
    0,
    15,
    0.35,
    9,
  );
  const eastLeafBody: KinematicBodyHandle = physics.createKinematicBox(
    'drawbridge_leaf_e',
    180,
    0.36,
    0,
    15,
    0.35,
    9,
  );

  // Road Blockers (lower onto road when drawbridge opens so road is physically blocked!)
  const blockerGeo = new THREE.BoxGeometry(1.4, 2.2, 18);
  geometries.push(blockerGeo);
  const westBlockerMesh = new THREE.Mesh(blockerGeo, barrierMat);
  const eastBlockerMesh = new THREE.Mesh(blockerGeo, barrierMat);
  westBlockerMesh.position.set(132, 6, 0);
  eastBlockerMesh.position.set(198, 6, 0);
  group.add(westBlockerMesh, eastBlockerMesh);

  const westBlockerBody = physics.createKinematicBox('bridge_gate_w', 132, 6, 0, 0.7, 1.1, 9);
  const eastBlockerBody = physics.createKinematicBox('bridge_gate_e', 198, 6, 0, 0.7, 1.1, 9);

  // Bridge warning signal towers
  const beaconMat = new THREE.MeshStandardMaterial({
    color: '#ef4444',
    emissive: '#ef4444',
    emissiveIntensity: 0.2,
  });
  materials.push(beaconMat);
  const beaconGeo = new THREE.SphereGeometry(0.85, 10, 10);
  geometries.push(beaconGeo);
  const beaconW = new THREE.Mesh(beaconGeo, beaconMat);
  beaconW.position.set(134, 7.5, -10.5);
  const beaconE = new THREE.Mesh(beaconGeo, beaconMat);
  beaconE.position.set(196, 7.5, -10.5);
  group.add(beaconW, beaconE);

  // Alternative Stunt Ramp Route across the river at Z = +55
  addRamp('harbor_alt_ramp_w', 141, 0, 55, 10, 14, 3.6, Math.PI / 2, 'stunt');
  addRamp('harbor_alt_ramp_e', 189, 0, 55, 10, 14, 3.6, -Math.PI / 2, 'stunt');
  // Floating pontoon barge in middle of river gap at (165, 55) as landing assist
  addDeck('harbor_barge', 165, 0.4, 55, 16, 14);

  // Harbor Cranes & Warehouses
  addBuilding('harbor_wh_1', 218, -55, 22, 12, 32, neonCyanMat);
  addBuilding('harbor_wh_2', 272, 48, 22, 14, 28, neonOrangeMat);

  // ============================================================================
  // 6. DISTRICT 4 – INDUSTRIAL RAILWAY (South-East: X >= 70, Z > 95)
  // Warehouses, shipping containers, factories, 2 railway crossings, moving freight train
  // ============================================================================
  addBuilding('rail_factory_1', 152, 185, 26, 16, 30, neonOrangeMat);
  addBuilding('rail_factory_2', 225, 185, 20, 14, 26, neonCyanMat);
  addBuilding('rail_wh_3', 272, 160, 18, 12, 32, neonOrangeMat);

  // Shipping Container Stacks (InstancedMesh off roads)
  const containerGeo = new THREE.BoxGeometry(3.2, 3.0, 7.5);
  geometries.push(containerGeo);
  const containerMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.65,
    metalness: 0.25,
  });
  materials.push(containerMat);
  const containerCoords = [
    { x: 145, y: 1.5, z: 108, c: '#0284c7' },
    { x: 150, y: 1.5, z: 108, c: '#dc2626' },
    { x: 147, y: 4.5, z: 108, c: '#f59e0b' },
    { x: 222, y: 1.5, z: 108, c: '#16a34a' },
    { x: 227, y: 1.5, z: 108, c: '#0284c7' },
    { x: 145, y: 1.5, z: 262, c: '#dc2626' },
    { x: 150, y: 1.5, z: 262, c: '#16a34a' },
    { x: 222, y: 1.5, z: 262, c: '#f59e0b' },
  ];
  const contInst = new THREE.InstancedMesh(
    containerGeo,
    containerMat,
    containerCoords.length,
  );
  containerCoords.forEach((cc, i) => {
    dummy.position.set(cc.x, cc.y, cc.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    contInst.setMatrixAt(i, dummy.matrix);
    contInst.setColorAt(i, new THREE.Color(cc.c));
    if (cc.y < 2) {
      physics.createStaticBox(`container_${i}`, cc.x, 2, cc.z, 1.6, 2, 3.75);
    }
  });
  contInst.instanceMatrix.needsUpdate = true;
  if (contInst.instanceColor) contInst.instanceColor.needsUpdate = true;
  contInst.computeBoundingSphere();
  group.add(contInst);

  // Railway Track Bed, Sleepers & Steel Rails along X = 195, Z ∈ [75, 295]
  const trackBed = new THREE.Mesh(unitBoxGeo, concreteMat);
  trackBed.scale.set(4.8, 0.08, 225);
  trackBed.position.set(195, 0.04, 185);
  group.add(trackBed);

  const railGeo = new THREE.BoxGeometry(0.18, 0.14, 225);
  const sleeperGeo = new THREE.BoxGeometry(3.4, 0.08, 0.45);
  geometries.push(railGeo, sleeperGeo);
  const railL = new THREE.Mesh(railGeo, steelMat);
  railL.position.set(193.9, 0.12, 185);
  const railR = new THREE.Mesh(railGeo, steelMat);
  railR.position.set(196.1, 0.12, 185);
  group.add(railL, railR);

  const sleeperCount = 74;
  const sleeperInst = new THREE.InstancedMesh(sleeperGeo, trimMat, sleeperCount);
  const slDummy = new THREE.Object3D();
  for (let i = 0; i < sleeperCount; i++) {
    slDummy.position.set(195, 0.08, 76 + i * 3);
    slDummy.updateMatrix();
    sleeperInst.setMatrixAt(i, slDummy.matrix);
  }
  sleeperInst.instanceMatrix.needsUpdate = true;
  sleeperInst.computeBoundingSphere();
  group.add(sleeperInst);

  // Railway Crossing Barrier Gates & Warning Flashers at Z=135 and Z=235
  const railGateGeo = new THREE.BoxGeometry(1.0, 1.5, 14);
  geometries.push(railGateGeo);
  const railGate1Mesh = new THREE.Mesh(railGateGeo, barrierMat);
  const railGate2Mesh = new THREE.Mesh(railGateGeo, barrierMat);
  railGate1Mesh.position.set(186, 6, 135);
  railGate2Mesh.position.set(186, 6, 235);
  const railStrobeMat = new THREE.MeshStandardMaterial({
    color: '#ef4444',
    emissive: '#ef4444',
    emissiveIntensity: 0.2,
  });
  materials.push(railStrobeMat);
  const railFlash1 = new THREE.Mesh(beaconGeo, railStrobeMat);
  railFlash1.position.set(186, 5.2, 127);
  const railFlash2 = new THREE.Mesh(beaconGeo, railStrobeMat);
  railFlash2.position.set(186, 5.2, 227);
  group.add(railGate1Mesh, railGate2Mesh, railFlash1, railFlash2);

  const railGate1Body = physics.createKinematicBox('rail_gate_1', 186, 6, 135, 0.5, 0.8, 7);
  const railGate2Body = physics.createKinematicBox('rail_gate_2', 186, 6, 235, 0.5, 0.8, 7);

  // Working Moving Freight Train (50m long articulated body along X=195)
  const trainGroup = new THREE.Group();
  const locoMesh = new THREE.Mesh(unitBoxGeo, neonOrangeMat);
  locoMesh.scale.set(3.4, 3.8, 12);
  locoMesh.position.set(0, 2.0, -18);
  const car1Mesh = new THREE.Mesh(unitBoxGeo, steelMat);
  car1Mesh.scale.set(3.2, 3.2, 11);
  car1Mesh.position.set(0, 1.7, -5);
  const car2Mesh = new THREE.Mesh(unitBoxGeo, buildingMat);
  car2Mesh.scale.set(3.2, 3.2, 11);
  car2Mesh.position.set(0, 1.7, 7);
  const car3Mesh = new THREE.Mesh(unitBoxGeo, steelMat);
  car3Mesh.scale.set(3.2, 3.2, 11);
  car3Mesh.position.set(0, 1.7, 19);
  trainGroup.add(locoMesh, car1Mesh, car2Mesh, car3Mesh);
  trainGroup.position.set(195, 0, 340);
  group.add(trainGroup);

  const trainBody = physics.createKinematicBox(
    'freight_train',
    195,
    2.0,
    340,
    1.7,
    2.0,
    25,
  );
  let trainSchedule: TrainScheduleState = createInitialTrainSchedule();

  // ============================================================================
  // 7. DISTRICT 5 – STUNT PLAYGROUND (West / South-West: X < -90)
  // Giant ramps, elevated roads, half-pipe, 360-degree loop, moving stunt platforms
  // ============================================================================
  // Elevated Road Deck along X = -185, Z ∈ [20..80], Y = 5.5m with access ramps
  addDeck('stunt_elevated_road', -185, 5.5, 50, 12, 40);
  addRamp('stunt_elev_ramp_n', -185, 0, 19, 12, 22, 5.5, Math.PI, 'stunt');
  addRamp('stunt_elev_ramp_s', -185, 0, 81, 12, 22, 5.5, 0, 'stunt');

  // Giant Mega Ramps
  addRamp('stunt_giant_ramp_1', -152, 0, 190, 12, 22, 6.2, 0, 'stunt');
  addRamp('stunt_giant_ramp_2', -152, 0, 160, 12, 22, 6.2, Math.PI, 'stunt');

  // Half-Pipe (at X = -245, Z = 165, curved U-trough with 7 angled collider segments)
  const hpAngles = [-0.85, -0.52, -0.22, 0, 0.22, 0.52, 0.85];
  const hpOffsetsX = [-10.5, -7.2, -3.6, 0, 3.6, 7.2, 10.5];
  const hpOffsetsY = [4.6, 2.1, 0.45, 0.1, 0.45, 2.1, 4.6];
  hpAngles.forEach((roll, idx) => {
    const seg = new THREE.Mesh(unitBoxGeo, idx % 2 === 0 ? concreteMat : neonPinkMat);
    seg.scale.set(4.2, 0.4, 24);
    seg.position.set(-245 + hpOffsetsX[idx], hpOffsetsY[idx], 165);
    seg.rotation.z = roll;
    seg.receiveShadow = true;
    group.add(seg);
    physics.createStaticBox(
      `halfpipe_seg_${idx}`,
      -245 + hpOffsetsX[idx],
      hpOffsetsY[idx],
      165,
      2.1,
      0.2,
      12,
      0,
      0,
      roll,
    );
  });
  minimapObstacles.push({ x: -245, z: 165, w: 24, d: 24, kind: 'stunt' });

  // 360-Degree Stunt Loop (at X = -210, Z = 85, radius 13m, width 10m)
  const loopSegCount = 18;
  const loopRadius = 13;
  const loopCenterX = -210;
  const loopCenterZ = 85;
  for (let i = 0; i < loopSegCount; i++) {
    const theta = (i / loopSegCount) * Math.PI * 2; // 0 at bottom, PI at top
    const nextTheta = ((i + 1) / loopSegCount) * Math.PI * 2;
    const midTheta = (theta + nextTheta) * 0.5;
    // Slight helical X offset (-4m to +4m) so entrance & exit don't collide
    const helixOffset = (i / loopSegCount - 0.5) * 8.0;
    const y = loopRadius * (1 - Math.cos(midTheta)) + 0.25;
    const z = loopCenterZ - loopRadius * Math.sin(midTheta);
    const segLen = (2 * Math.PI * loopRadius) / loopSegCount + 0.5;

    const seg = new THREE.Mesh(
      unitBoxGeo,
      i % 2 === 0 ? neonCyanMat : trimMat,
    );
    seg.scale.set(9.5, 0.45, segLen);
    seg.position.set(loopCenterX + helixOffset, y, z);
    seg.rotation.x = midTheta;
    group.add(seg);

    // Lower half & outer arcs get solid colliders so entry/exit is smooth
    if (y < 14) {
      physics.createStaticBox(
        `loop_seg_${i}`,
        loopCenterX + helixOffset,
        y,
        z,
        4.75,
        0.22,
        segLen * 0.5,
        0,
        midTheta,
        0,
      );
    }
  }
  minimapObstacles.push({ x: loopCenterX, z: loopCenterZ, w: 18, d: 28, kind: 'stunt' });

  // 2 Moving Stunt Platforms (kinematic oscillating bridges)
  const platGeo = new THREE.BoxGeometry(10, 0.7, 14);
  geometries.push(platGeo);
  const plat1Mesh = new THREE.Mesh(platGeo, neonGreenMat);
  const plat2Mesh = new THREE.Mesh(platGeo, neonPinkMat);
  plat1Mesh.position.set(-150, 1.5, 115);
  plat2Mesh.position.set(-225, 2.2, 210);
  group.add(plat1Mesh, plat2Mesh);

  const plat1Body = physics.createKinematicBox('moving_plat_1', -150, 1.5, 115, 5, 0.35, 7);
  const plat2Body = physics.createKinematicBox('moving_plat_2', -225, 2.2, 210, 5, 0.35, 7);

  // ============================================================================
  // 8. DESTRUCTIBLE TRAFFIC BARRIERS & CRATES ACROSS DISTRICTS
  // ============================================================================
  const crateGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
  geometries.push(crateGeo);
  const crateMat = new THREE.MeshStandardMaterial({
    color: '#fb923c',
    roughness: 0.58,
    metalness: 0.15,
  });
  materials.push(crateMat);

  const crateLocations = [
    { x: -6, z: 30 }, { x: 6, z: -30 },
    { x: -38, z: 24 }, { x: 38, z: -24 },
    { x: 118, z: -25 }, { x: 245, z: 25 },
    { x: 145, z: 135 }, { x: 145, z: 235 },
    { x: -120, z: 145 }, { x: -185, z: 145 },
    { x: -245, z: 45 }, { x: -75, z: -140 },
  ];
  crateLocations.forEach((loc, idx) => {
    const handle = physics.createDynamicBox(
      `crate_${idx}`,
      loc.x,
      0.75,
      loc.z,
      0.7,
      0.7,
      0.7,
      30,
    );
    const mesh = new THREE.Mesh(crateGeo, crateMat);
    mesh.position.set(loc.x, 0.75, loc.z);
    mesh.castShadow = true;
    group.add(mesh);
    dynamicProps.push({ handle, mesh });
    initialPropPositions.push({ x: loc.x, y: 0.75, z: loc.z });
  });

  scene.add(group);

  const instance: NeonHarborMapInstance = {
    group,
    raycastTargets,
    minimapObstacles,
    dynamicProps,
    drawbridgePhase: 'closed',
    drawbridgeOpenAmount: 0,
    trainPhase: 'idle',
    trainZ: 340,
    updateDynamicWorld: (dt: number, elapsedSec: number) => {
      // Animate river water scroll
      waterTex.offset.y -= dt * 0.18;

      // 1. Update Drawbridge (75s closed -> 5s warn -> 5s open -> 10s open -> 5s close)
      const bridgeState = evaluateDrawbridgeState(elapsedSec);
      instance.drawbridgePhase = bridgeState.phase;
      instance.drawbridgeOpenAmount = bridgeState.openAmount;

      const angle = bridgeState.openAmount * (Math.PI * 0.36);
      westLeafPivot.rotation.z = angle;
      eastLeafPivot.rotation.z = -angle;

      // Sync kinematic leaf colliders
      const halfAngle = angle * 0.5;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      westLeafBody.body.setNextKinematicTranslation({
        x: 135 + 15 * cosA,
        y: 0.36 + 15 * sinA,
        z: 0,
      });
      westLeafBody.body.setNextKinematicRotation({
        x: 0,
        y: 0,
        z: Math.sin(halfAngle),
        w: Math.cos(halfAngle),
      });

      eastLeafBody.body.setNextKinematicTranslation({
        x: 195 - 15 * cosA,
        y: 0.36 + 15 * sinA,
        z: 0,
      });
      eastLeafBody.body.setNextKinematicRotation({
        x: 0,
        y: 0,
        z: -Math.sin(halfAngle),
        w: Math.cos(halfAngle),
      });

      // Physical road blockers when open/opening/closing
      const blockerY = bridgeState.roadBlocked ? 1.1 : 7.5;
      westBlockerMesh.position.y = blockerY;
      eastBlockerMesh.position.y = blockerY;
      westBlockerBody.body.setNextKinematicTranslation({ x: 132, y: blockerY, z: 0 });
      eastBlockerBody.body.setNextKinematicTranslation({ x: 198, y: blockerY, z: 0 });

      // Warning beacons pulse
      beaconMat.emissiveIntensity =
        bridgeState.phase === 'warning' || bridgeState.roadBlocked
          ? 1.5 + Math.sin(elapsedSec * 12) * 1.2
          : 0.15;

      // 2. Update Freight Train & Railway Crossing Gates
      trainSchedule = stepTrainSchedule(trainSchedule, dt);
      instance.trainPhase = trainSchedule.phase;
      instance.trainZ = trainSchedule.trainZ;

      trainGroup.position.set(195, 0, trainSchedule.trainZ);
      trainBody.body.setNextKinematicTranslation({
        x: 195,
        y: 2.0,
        z: trainSchedule.trainZ,
      });

      const gateY = 6.0 - trainSchedule.barrierClosedAmount * 5.2;
      railGate1Mesh.position.y = gateY;
      railGate2Mesh.position.y = gateY;
      railGate1Body.body.setNextKinematicTranslation({ x: 186, y: gateY, z: 135 });
      railGate2Body.body.setNextKinematicTranslation({ x: 186, y: gateY, z: 235 });
      railStrobeMat.emissiveIntensity =
        trainSchedule.phase !== 'idle' ? 1.8 + Math.sin(elapsedSec * 14) * 1.4 : 0.15;

      // 3. Update Moving Stunt Platforms
      const p1x = -150 + Math.sin(elapsedSec * 0.9) * 16;
      const p2z = 210 + Math.cos(elapsedSec * 0.75) * 18;
      plat1Mesh.position.set(p1x, 1.5, 115);
      plat2Mesh.position.set(-225, 2.2, p2z);
      plat1Body.body.setNextKinematicTranslation({ x: p1x, y: 1.5, z: 115 });
      plat2Body.body.setNextKinematicTranslation({ x: -225, y: 2.2, z: p2z });

      // 4. Sync dynamic crates
      for (const prop of dynamicProps) {
        const p = prop.handle.body.translation();
        const r = prop.handle.body.rotation();
        prop.mesh.position.set(p.x, p.y, p.z);
        prop.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
    },
    syncFromNetworkState: (
      dt: number,
      elapsedSec: number,
      bridgePhase: DrawbridgePhase,
      bridgeOpenAmount: number,
      trainPhase: TrainPhase,
      trainZ: number,
    ) => {
      waterTex.offset.y -= dt * 0.18;
      instance.drawbridgePhase = bridgePhase;
      instance.drawbridgeOpenAmount = bridgeOpenAmount;
      instance.trainPhase = trainPhase;
      instance.trainZ = trainZ;

      const angle = bridgeOpenAmount * (Math.PI * 0.36);
      westLeafPivot.rotation.z = angle;
      eastLeafPivot.rotation.z = -angle;

      const blocked = bridgeOpenAmount > 0.08;
      const blockerY = blocked ? 1.1 : 7.5;
      westBlockerMesh.position.y = blockerY;
      eastBlockerMesh.position.y = blockerY;
      beaconMat.emissiveIntensity =
        bridgePhase === 'warning' || blocked
          ? 1.5 + Math.sin(elapsedSec * 12) * 1.2
          : 0.15;

      trainGroup.position.set(195, 0, trainZ);
      const barrierClosed = trainPhase === 'closing' || trainPhase === 'passing' ? 1 : 0;
      const gateY = 6.0 - barrierClosed * 5.2;
      railGate1Mesh.position.y = gateY;
      railGate2Mesh.position.y = gateY;
      railStrobeMat.emissiveIntensity =
        trainPhase !== 'idle' ? 1.8 + Math.sin(elapsedSec * 14) * 1.4 : 0.15;

      const p1x = -150 + Math.sin(elapsedSec * 0.9) * 16;
      const p2z = 210 + Math.cos(elapsedSec * 0.75) * 18;
      plat1Mesh.position.set(p1x, 1.5, 115);
      plat2Mesh.position.set(-225, 2.2, p2z);
    },
    resetDynamicProps: () => {
      trainSchedule = createInitialTrainSchedule();
      dynamicProps.forEach((prop, idx) => {
        const init = initialPropPositions[idx];
        prop.handle.body.setTranslation({ x: init.x, y: init.y, z: init.z }, true);
        prop.handle.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        prop.handle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        prop.handle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      });
    },
    dispose: () => {
      scene.remove(group);
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };

  return instance;
}
