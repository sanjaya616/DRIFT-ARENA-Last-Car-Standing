import * as THREE from 'three';
import { CAR_DIMENSIONS, type CarCustomization, type VehicleId } from '../types/game';

export interface CarVisualRig {
  root: THREE.Group;
  chassisPivot: THREE.Group;
  wheelPivots: {
    frontLeft: THREE.Group;
    frontRight: THREE.Group;
  };
  wheels: {
    frontLeft: THREE.Group;
    frontRight: THREE.Group;
    rearLeft: THREE.Group;
    rearRight: THREE.Group;
  };
  bodyPaintMaterial: THREE.MeshPhysicalMaterial;
  accentMaterial: THREE.MeshStandardMaterial;
  rimMaterial: THREE.MeshStandardMaterial;
  tailLightMaterial: THREE.MeshStandardMaterial;
  nitroFlames: THREE.Mesh[];
  shieldMesh: THREE.Mesh;
  contactShadow: THREE.Mesh;
  applyVehicleStyle: (vehicleId: VehicleId) => void;
  dispose: () => void;
}

let sharedShadowTex: THREE.CanvasTexture | null = null;

function getContactShadowTexture(): THREE.CanvasTexture {
  if (sharedShadowTex) return sharedShadowTex;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    grad.addColorStop(0, 'rgba(6, 10, 16, 0.72)');
    grad.addColorStop(0.55, 'rgba(6, 10, 16, 0.35)');
    grad.addColorStop(1, 'rgba(6, 10, 16, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  sharedShadowTex = new THREE.CanvasTexture(canvas);
  sharedShadowTex.colorSpace = THREE.SRGBColorSpace;
  return sharedShadowTex;
}

function createWheelAssembly(
  tireMat: THREE.Material,
  rimMat: THREE.Material,
  caliperMat: THREE.Material,
  isLeft: boolean,
): THREE.Group {
  const wheelGroup = new THREE.Group();
  const r = CAR_DIMENSIONS.wheelRadius;
  const w = CAR_DIMENSIONS.wheelWidth;

  const tireGeo = new THREE.CylinderGeometry(r, r, w, 24);
  tireGeo.rotateZ(Math.PI / 2);
  const tireMesh = new THREE.Mesh(tireGeo, tireMat);
  tireMesh.castShadow = true;
  tireMesh.receiveShadow = true;
  wheelGroup.add(tireMesh);

  const rimGeo = new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 18);
  rimGeo.rotateZ(Math.PI / 2);
  const rimMesh = new THREE.Mesh(rimGeo, rimMat);
  wheelGroup.add(rimMesh);

  const spokeGeo = new THREE.BoxGeometry(0.04, r * 1.12, 0.055);
  const hubOffsetX = isLeft ? -w * 0.5 - 0.005 : w * 0.5 + 0.005;
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(spokeGeo, rimMat);
    spoke.position.x = hubOffsetX;
    spoke.rotation.x = (i * Math.PI) / 3;
    wheelGroup.add(spoke);
  }

  const rotorMat = new THREE.MeshStandardMaterial({
    color: '#94a3b8',
    metalness: 0.78,
    roughness: 0.3,
  });
  const rotorGeo = new THREE.CylinderGeometry(r * 0.48, r * 0.48, 0.04, 16);
  rotorGeo.rotateZ(Math.PI / 2);
  const rotorMesh = new THREE.Mesh(rotorGeo, rotorMat);
  rotorMesh.position.x = isLeft ? 0.04 : -0.04;
  wheelGroup.add(rotorMesh);

  const lipGeo = new THREE.TorusGeometry(r * 0.62, 0.022, 6, 20);
  lipGeo.rotateY(Math.PI / 2);
  const lipMesh = new THREE.Mesh(lipGeo, rimMat);
  lipMesh.position.x = isLeft ? -w * 0.5 : w * 0.5;
  wheelGroup.add(lipMesh);

  const caliper = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.16, 0.14),
    caliperMat,
  );
  caliper.position.set(isLeft ? -0.06 : 0.06, 0.08, 0.08);
  wheelGroup.add(caliper);

  return wheelGroup;
}

/**
 * Builds a 4.2m x 1.9m x 1.4m composite sports/combat vehicle with distinct silhouettes
 * across all 6 vehicle models while preserving exact 4.2 x 1.9 x 1.4 dimensions.
 */
export function buildSportsCar(
  customization: CarCustomization,
  isSoftwareGl = false,
): CarVisualRig {
  const root = new THREE.Group();
  const chassisPivot = new THREE.Group();
  root.add(chassisPivot);

  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const materialsToDispose: THREE.Material[] = [];

  const bodyPaintMaterial = new THREE.MeshPhysicalMaterial({
    color: customization.bodyColor,
    metalness: 0.65,
    roughness: 0.24,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
  });

  const accentMaterial = new THREE.MeshStandardMaterial({
    color: customization.accentColor,
    metalness: 0.4,
    roughness: 0.35,
  });

  const carbonMat = new THREE.MeshStandardMaterial({
    color: '#171c26',
    metalness: 0.2,
    roughness: 0.72,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: '#0b1524',
    metalness: 0.15,
    roughness: 0.08,
    clearcoat: 1.0,
    transparent: true,
    opacity: isSoftwareGl ? 0.78 : 0.85,
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: '#e2e8f0',
    metalness: 0.92,
    roughness: 0.16,
  });

  const tireMat = new THREE.MeshStandardMaterial({
    color: '#14171c',
    metalness: 0.05,
    roughness: 0.88,
  });

  const rimMaterial = new THREE.MeshStandardMaterial({
    color: customization.rimColor,
    metalness: 0.86,
    roughness: 0.2,
  });

  const caliperMat = new THREE.MeshStandardMaterial({
    color: '#ef4444',
    metalness: 0.4,
    roughness: 0.35,
  });

  const headlightMat = new THREE.MeshStandardMaterial({
    color: '#e0f2fe',
    emissive: '#7dd3fc',
    emissiveIntensity: 2.2,
    roughness: 0.15,
  });

  const tailLightMaterial = new THREE.MeshStandardMaterial({
    color: '#ef4444',
    emissive: '#dc2626',
    emissiveIntensity: 1.8,
    roughness: 0.2,
  });

  const flameMat = new THREE.MeshBasicMaterial({
    color: '#38bdf8',
    transparent: true,
    opacity: 0.88,
  });

  const shieldMat = new THREE.MeshBasicMaterial({
    color: '#38bdf8',
    wireframe: true,
    transparent: true,
    opacity: 0.42,
  });

  materialsToDispose.push(
    bodyPaintMaterial,
    accentMaterial,
    carbonMat,
    glassMat,
    chromeMat,
    tireMat,
    rimMaterial,
    caliperMat,
    headlightMat,
    tailLightMaterial,
    flameMat,
    shieldMat,
  );

  // 1. Primary sculpted wedge hull (4.2m x 1.76m)
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-2.02, 0.26);
  hullShape.lineTo(-2.06, 0.48);
  hullShape.lineTo(-1.45, 0.68);
  hullShape.lineTo(-0.55, 0.84);
  hullShape.lineTo(1.25, 0.86);
  hullShape.lineTo(2.04, 0.78);
  hullShape.lineTo(2.06, 0.34);
  hullShape.lineTo(1.88, 0.26);
  hullShape.lineTo(-2.02, 0.26);

  const hullGeo = new THREE.ExtrudeGeometry(hullShape, {
    depth: 1.68,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.05,
    bevelSegments: 2,
  });
  hullGeo.translate(0, 0, -0.84);
  hullGeo.rotateY(-Math.PI / 2);
  hullGeo.computeVertexNormals();
  geometriesToDispose.push(hullGeo);

  const hullMesh = new THREE.Mesh(hullGeo, bodyPaintMaterial);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  chassisPivot.add(hullMesh);

  // 2. Cabin Canopy (up to 1.38m)
  const cabinShape = new THREE.Shape();
  cabinShape.moveTo(-0.75, 0.78);
  cabinShape.lineTo(-0.22, 1.32);
  cabinShape.lineTo(0.68, 1.32);
  cabinShape.lineTo(1.42, 0.82);
  cabinShape.lineTo(-0.75, 0.78);

  const cabinGeo = new THREE.ExtrudeGeometry(cabinShape, {
    depth: 1.24,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
  cabinGeo.translate(0, 0, -0.62);
  cabinGeo.rotateY(-Math.PI / 2);
  cabinGeo.computeVertexNormals();
  geometriesToDispose.push(cabinGeo);

  const cabinMesh = new THREE.Mesh(cabinGeo, glassMat);
  cabinMesh.castShadow = true;
  chassisPivot.add(cabinMesh);

  const roofGeo = new THREE.BoxGeometry(1.12, 0.07, 0.88);
  geometriesToDispose.push(roofGeo);
  const roofCap = new THREE.Mesh(roofGeo, bodyPaintMaterial);
  roofCap.position.set(0, 1.355, 0.22);
  chassisPivot.add(roofCap);

  // 3. Flush Hood & Rear Deck Racing Stripes
  const hoodStripeGeo = new THREE.BoxGeometry(0.36, 0.03, 1.05);
  const deckStripeGeo = new THREE.BoxGeometry(0.36, 0.03, 0.72);
  geometriesToDispose.push(hoodStripeGeo, deckStripeGeo);
  const hoodStripe = new THREE.Mesh(hoodStripeGeo, accentMaterial);
  hoodStripe.position.set(0, 0.71, -1.25);
  hoodStripe.rotation.x = 0.21;
  const deckStripe = new THREE.Mesh(deckStripeGeo, accentMaterial);
  deckStripe.position.set(0, 0.89, 1.62);
  deckStripe.rotation.x = -0.09;
  chassisPivot.add(hoodStripe, deckStripe);

  // 4. Front Splitter & Side Skirts
  const splitterGeo = new THREE.BoxGeometry(1.88, 0.09, 0.42);
  geometriesToDispose.push(splitterGeo);
  const splitter = new THREE.Mesh(splitterGeo, carbonMat);
  splitter.position.set(0, 0.25, -1.92);
  chassisPivot.add(splitter);

  const skirtGeo = new THREE.BoxGeometry(1.88, 0.1, 2.3);
  geometriesToDispose.push(skirtGeo);
  const skirts = new THREE.Mesh(skirtGeo, carbonMat);
  skirts.position.set(0, 0.25, 0.0);
  chassisPivot.add(skirts);

  // 5. Rear GT Wing + Uprights
  const wingGroup = new THREE.Group();
  const wingGeo = new THREE.BoxGeometry(1.84, 0.07, 0.34);
  geometriesToDispose.push(wingGeo);
  const wing = new THREE.Mesh(wingGeo, accentMaterial);
  wing.position.set(0, 1.24, 1.88);
  wing.rotation.x = 0.09;
  wing.castShadow = true;

  const uprightGeo = new THREE.BoxGeometry(0.06, 0.36, 0.2);
  geometriesToDispose.push(uprightGeo);
  const uprightL = new THREE.Mesh(uprightGeo, carbonMat);
  uprightL.position.set(-0.56, 1.04, 1.88);
  const uprightR = new THREE.Mesh(uprightGeo, carbonMat);
  uprightR.position.set(0.56, 1.04, 1.88);
  wingGroup.add(wing, uprightL, uprightR);
  chassisPivot.add(wingGroup);

  // Vehicle-specific silhouette trim pieces (toggled per VehicleId)
  // Muscle GT Hood Blower
  const blowerGeo = new THREE.BoxGeometry(0.52, 0.16, 0.65);
  geometriesToDispose.push(blowerGeo);
  const blowerMesh = new THREE.Mesh(blowerGeo, chromeMat);
  blowerMesh.position.set(0, 0.81, -1.2);
  chassisPivot.add(blowerMesh);

  // Titan 4X Front Armored Bullbar & Roof Rack
  const bullbarGeo = new THREE.BoxGeometry(1.86, 0.24, 0.16);
  const rackGeo = new THREE.BoxGeometry(1.06, 0.09, 1.0);
  geometriesToDispose.push(bullbarGeo, rackGeo);
  const bullbarMesh = new THREE.Mesh(bullbarGeo, carbonMat);
  bullbarMesh.position.set(0, 0.42, -2.06);
  const rackMesh = new THREE.Mesh(rackGeo, carbonMat);
  rackMesh.position.set(0, 1.38, 0.25);
  chassisPivot.add(bullbarMesh, rackMesh);

  // Rally Beast Roof Light Pod
  const podGeo = new THREE.BoxGeometry(0.95, 0.11, 0.16);
  geometriesToDispose.push(podGeo);
  const rallyPod = new THREE.Mesh(podGeo, headlightMat);
  rallyPod.position.set(0, 1.38, -0.18);
  chassisPivot.add(rallyPod);

  // 6. Side Mirrors
  const mirrorGeo = new THREE.BoxGeometry(0.18, 0.1, 0.14);
  geometriesToDispose.push(mirrorGeo);
  const mirrorL = new THREE.Mesh(mirrorGeo, bodyPaintMaterial);
  mirrorL.position.set(-0.86, 0.92, -0.45);
  const mirrorR = new THREE.Mesh(mirrorGeo, bodyPaintMaterial);
  mirrorR.position.set(0.86, 0.92, -0.45);
  chassisPivot.add(mirrorL, mirrorR);

  // 7. Headlights & Tail Light Bar
  const headGeo = new THREE.BoxGeometry(0.36, 0.09, 0.08);
  geometriesToDispose.push(headGeo);
  const headL = new THREE.Mesh(headGeo, headlightMat);
  headL.position.set(-0.58, 0.56, -2.06);
  const headR = new THREE.Mesh(headGeo, headlightMat);
  headR.position.set(0.58, 0.56, -2.06);
  chassisPivot.add(headL, headR);

  const tailGeo = new THREE.BoxGeometry(1.56, 0.1, 0.08);
  geometriesToDispose.push(tailGeo);
  const tailBar = new THREE.Mesh(tailGeo, tailLightMaterial);
  tailBar.position.set(0, 0.68, 2.06);
  chassisPivot.add(tailBar);

  // 8. Diffuser & Exhaust Pipes
  const diffuserGeo = new THREE.BoxGeometry(1.5, 0.18, 0.25);
  geometriesToDispose.push(diffuserGeo);
  const diffuser = new THREE.Mesh(diffuserGeo, carbonMat);
  diffuser.position.set(0, 0.3, 1.98);
  chassisPivot.add(diffuser);

  const pipeGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.22, 12);
  pipeGeo.rotateX(Math.PI / 2);
  geometriesToDispose.push(pipeGeo);
  const pipeL = new THREE.Mesh(pipeGeo, chromeMat);
  pipeL.position.set(-0.46, 0.3, 2.05);
  const pipeR = new THREE.Mesh(pipeGeo, chromeMat);
  pipeR.position.set(0.46, 0.3, 2.05);
  chassisPivot.add(pipeL, pipeR);

  // Rear diffuser accent trim & roof sharkfin antenna
  const plateGeo = new THREE.BoxGeometry(0.54, 0.14, 0.05);
  const finGeo = new THREE.BoxGeometry(0.05, 0.16, 0.28);
  geometriesToDispose.push(plateGeo, finGeo);
  const plateMesh = new THREE.Mesh(plateGeo, headlightMat);
  plateMesh.position.set(0, 0.48, 2.07);
  const finMesh = new THREE.Mesh(finGeo, accentMaterial);
  finMesh.position.set(0, 1.44, 0.55);
  chassisPivot.add(plateMesh, finMesh);

  // 9. Nitro Exhaust Flame Cones
  const flameGeo = new THREE.ConeGeometry(0.11, 0.85, 10);
  flameGeo.rotateX(Math.PI / 2);
  flameGeo.translate(0, 0, 0.42);
  geometriesToDispose.push(flameGeo);
  const flameL = new THREE.Mesh(flameGeo, flameMat);
  flameL.position.set(-0.46, 0.3, 2.1);
  flameL.visible = false;
  const flameR = new THREE.Mesh(flameGeo, flameMat);
  flameR.position.set(0.46, 0.3, 2.1);
  flameR.visible = false;
  chassisPivot.add(flameL, flameR);

  // 10. Four Wheels
  const wheelY = CAR_DIMENSIONS.wheelRadius;
  const wheelX = 0.81;
  const frontZ = -1.32;
  const rearZ = 1.32;

  const frontLeftPivot = new THREE.Group();
  frontLeftPivot.position.set(-wheelX, wheelY, frontZ);
  const frontLeftWheel = createWheelAssembly(tireMat, rimMaterial, caliperMat, true);
  frontLeftPivot.add(frontLeftWheel);

  const frontRightPivot = new THREE.Group();
  frontRightPivot.position.set(wheelX, wheelY, frontZ);
  const frontRightWheel = createWheelAssembly(tireMat, rimMaterial, caliperMat, false);
  frontRightPivot.add(frontRightWheel);

  const rearLeftWheel = createWheelAssembly(tireMat, rimMaterial, caliperMat, true);
  rearLeftWheel.position.set(-wheelX, wheelY, rearZ);

  const rearRightWheel = createWheelAssembly(tireMat, rimMaterial, caliperMat, false);
  rearRightWheel.position.set(wheelX, wheelY, rearZ);

  root.add(frontLeftPivot, frontRightPivot, rearLeftWheel, rearRightWheel);

  // 11. Contact Shadow
  const shadowGeo = new THREE.PlaneGeometry(2.45, 4.75);
  shadowGeo.rotateX(-Math.PI / 2);
  geometriesToDispose.push(shadowGeo);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: getContactShadowTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.55,
  });
  materialsToDispose.push(shadowMat);
  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.position.y = 0.025;
  root.add(contactShadow);

  // 12. Overdrive Shield Dome
  const shieldGeo = new THREE.IcosahedronGeometry(2.55, 1);
  geometriesToDispose.push(shieldGeo);
  const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
  shieldMesh.position.y = 0.72;
  shieldMesh.scale.set(0.65, 0.5, 1.05);
  shieldMesh.visible = false;
  root.add(shieldMesh);

  const applyVehicleStyle = (vehicleId: VehicleId) => {
    wingGroup.visible =
      vehicleId === 'street_rs' ||
      vehicleId === 'drift_x' ||
      vehicleId === 'speedster' ||
      vehicleId === 'rally_beast';
    wing.scale.set(vehicleId === 'drift_x' ? 1.05 : 0.96, 1, vehicleId === 'speedster' ? 1.15 : 1);
    blowerMesh.visible = vehicleId === 'muscle_gt';
    bullbarMesh.visible = vehicleId === 'titan_4x' || vehicleId === 'muscle_gt';
    rackMesh.visible = vehicleId === 'titan_4x';
    rallyPod.visible = vehicleId === 'rally_beast' || vehicleId === 'titan_4x';
  };

  applyVehicleStyle(customization.vehicleId);

  return {
    root,
    chassisPivot,
    wheelPivots: {
      frontLeft: frontLeftPivot,
      frontRight: frontRightPivot,
    },
    wheels: {
      frontLeft: frontLeftWheel,
      frontRight: frontRightWheel,
      rearLeft: rearLeftWheel,
      rearRight: rearRightWheel,
    },
    bodyPaintMaterial,
    accentMaterial,
    rimMaterial,
    tailLightMaterial,
    nitroFlames: [flameL, flameR],
    shieldMesh,
    contactShadow,
    applyVehicleStyle,
    dispose: () => {
      geometriesToDispose.forEach((g) => g.dispose());
      materialsToDispose.forEach((m) => m.dispose());
    },
  };
}
