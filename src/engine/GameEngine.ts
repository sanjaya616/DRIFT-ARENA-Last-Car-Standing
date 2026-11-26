import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  type CarCustomization,
  type DistrictId,
  type DrawbridgePhase,
  type GamePhase,
  type GameSettings,
  type HudSnapshot,
  type MatchConfig,
  type MinimapActor,
  type MinimapObstacle,
  type PickupKind,
  type TrainPhase,
  type VehicleId,
  type WinnerInfo,
} from '../types/game';
import { RemoteCarEntity } from '../cars/RemoteCarEntity';
import type { MultiplayerClient } from '../multiplayer/MultiplayerClient';
import type {
  CombatEventPayload,
  MatchStanding,
  WorldSnapshotPayload,
} from '../multiplayer/protocol';
import { VEHICLE_CONFIGS } from '../cars/vehicleConfigs';
import { AudioSystem } from '../audio/AudioSystem';
import { InputManager, type TouchActionKey } from '../controls/InputManager';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import {
  clampDt,
  COLLISION_PAIR_COOLDOWN_SEC,
  computeCollisionDamage,
} from '../physics/vehicleDynamics';
import {
  buildNeonHarborMap,
  type NeonHarborMapInstance,
} from '../maps/NeonHarborMap';
import {
  getDistrictAt,
  PLAYER_SPAWN_POINTS,
  type SpawnPoint,
} from '../maps/neonHarborLayout';
import { CarController } from '../cars/CarController';
import { SkidMarkSystem } from '../cars/SkidMarkSystem';
import { CameraRig, type CameraMode } from '../camera/CameraRig';
import { getPickupColor, PowerUpSystem } from '../powerups/PowerUpSystem';
import { CombatSystem, type CombatEventCallbacks } from '../combat/CombatSystem';
import { AIController, type AIPolicy } from '../ai/AIController';
import {
  evaluateSafeZone,
  evaluateSurvivalMatchResult,
  isOutsideSafeZone,
  PICKUP_START_DELAY_SEC,
  SPAWN_PROTECTION_SEC,
  START_COUNTDOWN_SEC,
  SURVIVAL_TARGET_DURATION_SEC,
} from '../combat/survivalRules';

const _camTargetPos = new THREE.Vector3();
const _rivalPos = new THREE.Vector3();

const RIVAL_LOADOUTS: Array<{
  name: string;
  vehicleId: VehicleId;
  color: string;
  accent: string;
  policy: AIPolicy;
}> = [
  { name: 'Viper', vehicleId: 'muscle_gt', color: '#dc2626', accent: '#f8fafc', policy: 'rammer' },
  { name: 'Blaze', vehicleId: 'drift_x', color: '#8b5cf6', accent: '#38bdf8', policy: 'drifter' },
  { name: 'Phantom', vehicleId: 'speedster', color: '#10b981', accent: '#f8fafc', policy: 'flanker' },
  { name: 'Crusher', vehicleId: 'titan_4x', color: '#eab308', accent: '#0f172a', policy: 'rammer' },
  { name: 'Ranger', vehicleId: 'rally_beast', color: '#f43f5e', accent: '#fef08a', policy: 'drifter' },
];

const SOLID_OBSTACLE_PREFIXES = [
  'dt_bldg_',
  'harbor_wh_',
  'rail_factory_',
  'rail_wh_',
  'rail_gate_',
  'container_',
  'rock_',
  'world_bound_',
  'bridge_gate_',
  'mtn_hairpin_rail_',
];

function isSolidWallObstacle(ownerId: string): boolean {
  if (ownerId === 'downtown_spire') return true;
  return SOLID_OBSTACLE_PREFIXES.some((prefix) => ownerId.startsWith(prefix));
}

export interface EngineCallbacks {
  onHudUpdate: (snapshot: HudSnapshot) => void;
  onPhaseChange: (phase: GamePhase) => void;
  onMapReady: (obstacles: MinimapObstacle[]) => void;
  onPauseToggle: () => void;
}

export class GameEngine {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly cameraRig: CameraRig;
  public readonly input: InputManager;
  public readonly audio: AudioSystem;
  public readonly isSoftwareGl: boolean;

  private physics: PhysicsWorld;
  private arena!: NeonHarborMapInstance;
  private playerCar!: CarController;
  private rivalCars: CarController[] = [];
  private skidMarks!: SkidMarkSystem;
  private powerUps!: PowerUpSystem;
  private combat!: CombatSystem;
  private ai: AIController;

  // Shrinking Safe Zone 3D boundary ring & energy wall
  private safeZoneWall: THREE.Mesh;
  private safeZoneRing: THREE.Mesh;
  private safeZoneGeos: THREE.BufferGeometry[] = [];
  private safeZoneMats: THREE.Material[] = [];

  private callbacks: EngineCallbacks;
  private mountEl: HTMLElement;
  private resizeObserver: ResizeObserver;

  private phase: GamePhase = 'title';
  private cameraMode: CameraMode = 'menu';
  private matchConfig: MatchConfig = {
    mode: 'survival',
    rivalCount: 5,
    durationSeconds: SURVIVAL_TARGET_DURATION_SEC,
    spawnIndex: 0,
    difficulty: 'normal',
  };
  private customization: CarCustomization;
  private settings: GameSettings;

  private startingCountdown = 0;
  private elapsedSec = 0;
  private skidEmitTimer = 0;
  private countdownRemaining = SURVIVAL_TARGET_DURATION_SEC;
  private score = 0;
  private bestScore = 0;
  private hitstopTimer = 0;
  private lastHudEmit = 0;
  private frameId = 0;
  private lastTimeMs = 0;
  private disposed = false;
  private ready = false;
  private impactCooldowns = new Map<string, number>();
  private boundaryTickTimers = new Map<string, number>();

  private spectating = false;
  private spectatorIndex = 0;
  private matchWinner: WinnerInfo | null = null;

  // Online multiplayer mode state
  private isOnlineMatch = false;
  private onlineClient: MultiplayerClient | null = null;
  private onlineUnsubscribe: (() => void) | null = null;
  private localOnlinePlayerId: string | null = null;
  private onlineRoomCode: string | null = null;
  private onlineConnectionBanner: string | null = null;
  private bannerClearTimer = 0;
  private netCars = new Map<string, RemoteCarEntity>();
  private latestSnapshot: WorldSnapshotPayload | null = null;
  private lastInputSendMs = 0;
  private prevBridgePhase: DrawbridgePhase = 'closed';
  private prevTrainPhase: TrainPhase = 'idle';
  private smokeEmitTimer = 0;
  private onOnlineMatchOverCb?: (payload: {
    roomCode: string;
    matchId: string;
    mode: 'online_public' | 'online_private';
    durationSec: number;
    winner: WinnerInfo;
    standings: MatchStanding[];
  }) => void;

  constructor(
    mountEl: HTMLElement,
    initialCustomization: CarCustomization,
    initialSettings: GameSettings,
    callbacks: EngineCallbacks,
  ) {
    this.mountEl = mountEl;
    this.customization = { ...initialCustomization };
    this.settings = { ...initialSettings };
    this.callbacks = callbacks;

    try {
      const savedBest = localStorage.getItem('drift_arena_best_score');
      if (savedBest) this.bestScore = Number(savedBest) || 0;
    } catch {
      // ignore storage failure
    }

    this.isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = Math.max(1, mountEl.clientWidth || window.innerWidth);
    const height = Math.max(1, mountEl.clientHeight || window.innerHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl && initialSettings.highQuality,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 0.75 : Math.min(window.devicePixelRatio, 2),
    );
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    mountEl.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const skyColor = new THREE.Color('#78a6c8');
    this.scene.background = skyColor;
    this.scene.fog = new THREE.Fog('#78a6c8', 150, 480);

    if (!this.isSoftwareGl) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }

    const hemi = new THREE.HemisphereLight('#bce0fd', '#3a4a3f', 0.72);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight('#fff2d6', 1.85);
    sun.position.set(110, 140, 85);
    sun.castShadow = !this.isSoftwareGl;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 380;
    const d = 160;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);

    const rimLight = new THREE.DirectionalLight('#93c5fd', 0.45);
    rimLight.position.set(-110, 50, -90);
    this.scene.add(rimLight);

    // 3D Shrinking Safe Zone cylinder wall + ground ring
    const wallGeo = new THREE.CylinderGeometry(1, 1, 22, 48, 1, true);
    const wallMat = new THREE.MeshBasicMaterial({
      color: '#f43f5e',
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.safeZoneWall = new THREE.Mesh(wallGeo, wallMat);
    this.safeZoneWall.position.y = 11;
    this.safeZoneWall.visible = false;
    this.scene.add(this.safeZoneWall);

    const ringGeo = new THREE.RingGeometry(0.985, 1.0, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#fb7185',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    this.safeZoneRing = new THREE.Mesh(ringGeo, ringMat);
    this.safeZoneRing.position.y = 0.12;
    this.safeZoneRing.visible = false;
    this.scene.add(this.safeZoneRing);
    this.safeZoneGeos.push(wallGeo, ringGeo);
    this.safeZoneMats.push(wallMat, ringMat);

    this.cameraRig = new CameraRig(width / height);
    this.cameraRig.setDistanceScale(initialSettings.cameraDistance);

    this.input = new InputManager();
    this.input.setSteerSensitivity(initialSettings.steerSensitivity);

    this.audio = new AudioSystem();
    this.audio.setMasterVolume(initialSettings.masterVolume);
    this.audio.setMuted(initialSettings.muted);
    this.audio.setMusicEnabled(initialSettings.musicEnabled);
    this.audio.setVehicleProfile(initialCustomization.vehicleId);

    this.physics = new PhysicsWorld();
    this.ai = new AIController();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(mountEl);
  }

  private resolvePlayerSpawn(spawnIndex: number): SpawnPoint {
    if (spawnIndex < 0 || spawnIndex >= PLAYER_SPAWN_POINTS.length) {
      const idx = Math.floor(Math.random() * PLAYER_SPAWN_POINTS.length);
      return PLAYER_SPAWN_POINTS[idx];
    }
    return PLAYER_SPAWN_POINTS[spawnIndex];
  }

  private pickRivalSpawns(playerSpawn: SpawnPoint, count: number): SpawnPoint[] {
    const farSpawns = PLAYER_SPAWN_POINTS.filter((sp) => {
      const dist = Math.hypot(sp.x - playerSpawn.x, sp.z - playerSpawn.z);
      return dist >= 40;
    });
    const list: SpawnPoint[] = [];
    for (let i = 0; i < count; i++) {
      list.push(farSpawns[i % farSpawns.length]);
    }
    return list;
  }

  public async init(): Promise<void> {
    await this.physics.init();
    if (this.disposed) return;

    this.arena = buildNeonHarborMap(this.scene, this.physics, this.renderer);
    this.callbacks.onMapReady(this.arena.minimapObstacles);

    this.skidMarks = new SkidMarkSystem(this.scene);
    this.powerUps = new PowerUpSystem(this.scene);
    this.combat = new CombatSystem(this.scene);

    const playerSpawn = this.resolvePlayerSpawn(this.matchConfig.spawnIndex);
    this.playerCar = new CarController(
      'player',
      true,
      this.scene,
      this.physics,
      playerSpawn,
      this.customization,
      this.isSoftwareGl,
      'YOU',
    );

    this.spawnRivals(this.matchConfig.rivalCount, playerSpawn);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.cameraRig.camera);
    }

    this.ready = true;
    this.emitHudSnapshot('none');
    this.cameraRig.update(
      0.016,
      this.cameraMode,
      this.playerCar.getPosition(_camTargetPos),
      this.playerCar.getYaw(),
      0,
      false,
      this.arena.raycastTargets,
    );
    this.renderer.render(this.scene, this.cameraRig.camera);
    this.lastTimeMs = performance.now();
    this.scheduleNextFrame();
  }

  private spawnRivals(count: number, playerSpawn: SpawnPoint): void {
    for (const r of this.rivalCars) {
      r.dispose(this.scene);
    }
    this.rivalCars = [];
    this.ai.clear();

    const clamped = Math.max(0, Math.min(RIVAL_LOADOUTS.length, count));
    const spawns = this.pickRivalSpawns(playerSpawn, clamped);
    for (let i = 0; i < clamped; i++) {
      const sp = spawns[i];
      const loadout = RIVAL_LOADOUTS[i % RIVAL_LOADOUTS.length];
      const rival = new CarController(
        `rival_${i}`,
        false,
        this.scene,
        this.physics,
        { x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw },
        {
          vehicleId: loadout.vehicleId,
          bodyColor: loadout.color,
          accentColor: loadout.accent,
          rimColor: '#cbd5e1',
        },
        this.isSoftwareGl,
        loadout.name,
      );
      this.rivalCars.push(rival);
      this.ai.registerCar(rival, loadout.policy, (i * 3) % 14);
    }
  }

  public setCustomization(next: CarCustomization): void {
    this.customization = { ...next };
    this.audio.setVehicleProfile(next.vehicleId);
    if (this.playerCar) {
      this.playerCar.applyCustomization(next);
      this.emitHudSnapshot('none');
    }
  }

  public setVehicle(vehicleId: VehicleId): void {
    const spec = VEHICLE_CONFIGS[vehicleId];
    const next: CarCustomization = {
      ...this.customization,
      vehicleId,
      bodyColor: spec.defaultBodyColor,
      accentColor: spec.defaultAccentColor,
      rimColor: spec.defaultRimColor,
    };
    this.setCustomization(next);
  }

  public teleportToDistrict(district: DistrictId): void {
    if (!this.ready || !this.playerCar || this.isOnlineMatch) return;
    const sp =
      PLAYER_SPAWN_POINTS.find((p) => p.district === district) ??
      PLAYER_SPAWN_POINTS[0];
    this.playerCar.body.setTranslation({ x: sp.x, y: sp.y + 0.15, z: sp.z }, true);
    const hy = Math.sin(sp.yaw * 0.5);
    const hw = Math.cos(sp.yaw * 0.5);
    this.playerCar.body.setRotation({ x: 0, y: hy, z: 0, w: hw }, true);
    this.playerCar.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.playerCar.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.playerCar.lastSafePos = { x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw };
    this.cameraRig.snapBehindCar(
      this.playerCar.getPosition(_camTargetPos),
      this.playerCar.getYaw(),
    );
    this.renderer.render(this.scene, this.cameraRig.camera);
    this.emitHudSnapshot('none');
  }

  public recoverPlayer(): void {
    if (!this.ready || !this.playerCar || this.isOnlineMatch) return;
    this.playerCar.recoverToCheckpoint();
    this.emitHudSnapshot('none');
  }

  public givePlayerPickup(kind: PickupKind): void {
    if (!this.ready || !this.playerCar || !this.playerCar.alive || this.isOnlineMatch) return;
    this.playerCar.equipPickup(kind);
    this.audio.playPickup();
    this.emitHudSnapshot('none');
  }

  public cycleSpectator(dir: 1 | -1): void {
    if (this.isOnlineMatch && this.latestSnapshot) {
      const living = this.latestSnapshot.cars.filter(
        (c) => c.alive && c.id !== this.localOnlinePlayerId,
      );
      if (living.length === 0) return;
      this.spectatorIndex = (this.spectatorIndex + dir + living.length) % living.length;
      this.emitHudSnapshot('none');
      return;
    }
    const living = this.rivalCars.filter((r) => r.alive);
    if (living.length === 0) return;
    this.spectatorIndex =
      (this.spectatorIndex + dir + living.length) % living.length;
    this.emitHudSnapshot('none');
  }

  public finishSpectator(): void {
    if (!this.spectating || this.isOnlineMatch) return;
    this.finalizeMatch('wrecked');
  }

  public setSettings(next: GameSettings): void {
    this.settings = { ...next };
    this.audio.setMasterVolume(next.masterVolume);
    this.audio.setMuted(next.muted);
    this.audio.setMusicEnabled(next.musicEnabled);
    this.cameraRig.setDistanceScale(next.cameraDistance);
    this.input.setSteerSensitivity(next.steerSensitivity);
    this.renderer.setPixelRatio(
      this.isSoftwareGl
        ? 0.75
        : next.highQuality
          ? Math.min(window.devicePixelRatio, 2)
          : 1,
    );
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    if (mode === 'garage' && this.playerCar) {
      this.exitOnlineMatch();
      this.playerCar.visual.root.visible = true;
      this.playerCar.resetTo(0, 0.15, 52, 0);
      this.cameraRig.snapToGarage(this.playerCar.getPosition(_camTargetPos));
    } else if (mode === 'menu' && this.playerCar && !this.isOnlineMatch) {
      this.playerCar.visual.root.visible = true;
    }
  }

  public exitOnlineMatch(): void {
    if (this.onlineUnsubscribe) {
      this.onlineUnsubscribe();
      this.onlineUnsubscribe = null;
    }
    for (const nc of this.netCars.values()) {
      nc.dispose(this.scene);
    }
    this.netCars.clear();
    this.isOnlineMatch = false;
    this.onlineClient = null;
    this.localOnlinePlayerId = null;
    this.onlineRoomCode = null;
    this.onlineConnectionBanner = null;
    this.latestSnapshot = null;
    this.onOnlineMatchOverCb = undefined;
    if (this.playerCar) {
      this.playerCar.visual.root.visible = true;
    }
    for (const r of this.rivalCars) {
      r.visual.root.visible = true;
    }
  }

  public startOnlineMatch(
    client: MultiplayerClient,
    matchStart: {
      roomCode: string;
      matchId: string;
      durationSeconds: number;
      startingCountdown: number;
    },
    localPlayerId: string,
    onMatchOver?: (payload: {
      roomCode: string;
      matchId: string;
      mode: 'online_public' | 'online_private';
      durationSec: number;
      winner: WinnerInfo;
      standings: MatchStanding[];
    }) => void,
  ): void {
    if (!this.ready) return;
    this.exitOnlineMatch();
    this.audio.unlock();
    this.input.clearAll();
    this.skidMarks.reset();
    this.powerUps.reset();
    this.combat.reset();

    // Hide offline single-player car meshes while online room owns the arena
    this.playerCar.visual.root.visible = false;
    for (const r of this.rivalCars) {
      r.visual.root.visible = false;
    }

    this.isOnlineMatch = true;
    this.onlineClient = client;
    this.localOnlinePlayerId = localPlayerId;
    this.onlineRoomCode = matchStart.roomCode;
    this.onlineConnectionBanner = null;
    this.bannerClearTimer = 0;
    this.latestSnapshot = null;
    this.spectating = false;
    this.spectatorIndex = 0;
    this.matchWinner = null;
    this.prevBridgePhase = 'closed';
    this.prevTrainPhase = 'idle';
    this.onOnlineMatchOverCb = onMatchOver;

    this.safeZoneWall.visible = false;
    this.safeZoneRing.visible = false;

    this.onlineUnsubscribe = client.subscribe({
      onConnectionChange: (connected, reconnecting) => {
        if (!this.isOnlineMatch) return;
        if (reconnecting) {
          this.onlineConnectionBanner = 'Reconnecting to server (15s grace)...';
          this.bannerClearTimer = 0;
        } else if (connected) {
          this.onlineConnectionBanner = null;
        } else {
          this.onlineConnectionBanner = 'Disconnected from server';
          this.bannerClearTimer = 0;
        }
        this.emitHudSnapshot('none');
      },
      onWorldSnapshot: (snapshot) => {
        if (!this.isOnlineMatch) return;
        const firstSnapshot = this.latestSnapshot === null;
        this.latestSnapshot = snapshot;

        const seenIds = new Set<string>();
        for (const carState of snapshot.cars) {
          seenIds.add(carState.id);
          let entity = this.netCars.get(carState.id);
          if (!entity) {
            entity = new RemoteCarEntity(
              carState,
              carState.id === this.localOnlinePlayerId,
              this.scene,
              this.isSoftwareGl,
            );
            this.netCars.set(carState.id, entity);
          } else {
            entity.applySnapshot(carState, false);
          }
        }
        for (const [id, ent] of this.netCars) {
          if (!seenIds.has(id)) {
            ent.dispose(this.scene);
            this.netCars.delete(id);
          }
        }

        if (firstSnapshot && this.localOnlinePlayerId) {
          const mine = this.netCars.get(this.localOnlinePlayerId);
          if (mine) {
            this.cameraRig.snapBehindCar(
              new THREE.Vector3(mine.currentX, mine.currentY, mine.currentZ),
              mine.currentYaw,
            );
          }
        }

        // Check online spectator switch if local car eliminated while others battle
        const myState = snapshot.cars.find((c) => c.id === this.localOnlinePlayerId);
        const aliveOthers = snapshot.cars.filter(
          (c) => c.alive && c.id !== this.localOnlinePlayerId,
        );
        if (myState && !myState.alive && aliveOthers.length > 0 && !this.spectating) {
          this.spectating = true;
          this.spectatorIndex = 0;
        }
      },
      onCombatEvent: (evt) => {
        if (!this.isOnlineMatch) return;
        this.handleOnlineCombatEvent(evt);
      },
      onPlayerConnection: (info) => {
        if (!this.isOnlineMatch) return;
        if (info.status === 'disconnected') {
          this.onlineConnectionBanner = `${info.name} disconnected (${info.graceSeconds ?? 15}s to return)`;
          this.bannerClearTimer = 4.5;
        } else if (info.status === 'reconnected') {
          this.onlineConnectionBanner = `${info.name} reconnected`;
          this.bannerClearTimer = 3.0;
        } else if (info.status === 'eliminated') {
          this.onlineConnectionBanner = `${info.name} timed out & was eliminated`;
          this.bannerClearTimer = 3.5;
        }
      },
      onMatchOver: (payload) => {
        if (!this.isOnlineMatch) return;
        this.matchWinner = payload.winner;
        this.phase = 'gameover';
        document.body.dataset.state = 'gameover';
        this.audio.updateContinuous(false, 0, 0, 0, false);
        this.input.clearAll();
        const myStanding = payload.standings.find((s) => s.id === this.localOnlinePlayerId);
        const outcome: HudSnapshot['outcome'] =
          payload.winner.id === this.localOnlinePlayerId
            ? 'victory'
            : myStanding && !myStanding.alive
              ? 'wrecked'
              : 'timeup';
        this.emitHudSnapshot(outcome);
        this.callbacks.onPhaseChange('gameover');
        this.onOnlineMatchOverCb?.(payload);
      },
    });

    this.phase = 'playing';
    this.cameraMode = 'chase';
    document.body.dataset.state = 'playing';
    this.callbacks.onPhaseChange('playing');
    this.emitHudSnapshot('none');
  }

  private handleOnlineCombatEvent(evt: CombatEventPayload): void {
    const mine = this.localOnlinePlayerId ? this.netCars.get(this.localOnlinePlayerId) : undefined;
    const dist = mine ? Math.hypot(mine.currentX - evt.x, mine.currentZ - evt.z) : 0;

    if (evt.kind === 'explosion') {
      this.combat.spawnBurst(evt.x, evt.y + 0.5, evt.z, 22, evt.color ?? '#fb923c', 15, 1.4);
      this.combat.spawnShockwave(evt.x, evt.y, evt.z, evt.color ?? '#fb923c', 6);
      if (dist < 42) this.audio.playExplosion();
    } else if (evt.kind === 'elimination') {
      this.combat.spawnEliminationExplosion(evt.x, evt.y, evt.z);
      if (dist < 50) this.audio.playExplosion();
    } else if (evt.kind === 'weapon_fired' && evt.sourceId === this.localOnlinePlayerId) {
      this.audio.playWeaponPulse(evt.weaponKind);
    } else if (evt.kind === 'ability_used' && evt.sourceId === this.localOnlinePlayerId) {
      this.audio.playAbilityShield();
      this.combat.spawnBurst(evt.x, evt.y + 0.4, evt.z, 12, evt.color ?? '#38bdf8', 9, 1.0);
    } else if (evt.kind === 'pickup_collected') {
      this.combat.spawnBurst(evt.x, evt.y + 0.5, evt.z, 12, evt.color ?? '#38bdf8', 8, 1.0);
      if (evt.sourceId === this.localOnlinePlayerId) {
        this.audio.playPickup();
      }
    } else if (evt.kind === 'boost' && evt.sourceId === this.localOnlinePlayerId) {
      this.audio.playBoost();
    } else if (evt.kind === 'jump' && evt.sourceId === this.localOnlinePlayerId) {
      this.audio.playJump();
    } else if (evt.kind === 'collision') {
      this.combat.spawnBurst(evt.x, evt.y + 0.4, evt.z, 12, '#facc15', 10, 1.0);
      if (dist < 30) this.audio.playImpact(0.7);
    } else if (evt.kind === 'damage' && evt.targetId === this.localOnlinePlayerId) {
      this.cameraRig.addTrauma(0.5);
      this.audio.playImpact(0.75);
    }
  }

  public startMatch(config?: MatchConfig): void {
    if (!this.ready) return;
    this.exitOnlineMatch();
    if (config) {
      this.matchConfig = { ...config };
    }

    this.audio.unlock();
    this.input.clearAll();
    this.impactCooldowns.clear();
    this.boundaryTickTimers.clear();

    this.arena.resetDynamicProps();
    this.skidMarks.reset();
    this.powerUps.reset();
    this.combat.reset();

    const playerSpawn = this.resolvePlayerSpawn(this.matchConfig.spawnIndex);

    this.playerCar.applyCustomization(this.customization);
    this.playerCar.resetTo(playerSpawn.x, playerSpawn.y, playerSpawn.z, playerSpawn.yaw);

    const count =
      this.matchConfig.mode === 'freedrive' ? 0 : this.matchConfig.rivalCount;
    if (count !== this.rivalCars.length) {
      this.rebuildActorsForMatch(count, playerSpawn);
    } else {
      const spawns = this.pickRivalSpawns(playerSpawn, count);
      this.rivalCars.forEach((r, idx) => {
        const sp = spawns[idx];
        const loadout = RIVAL_LOADOUTS[idx % RIVAL_LOADOUTS.length];
        r.resetTo(sp.x, sp.y, sp.z, sp.yaw);
        this.ai.registerCar(r, loadout.policy, (idx * 3) % 14);
      });
    }

    const isSurvival = this.matchConfig.mode === 'survival';
    this.startingCountdown = isSurvival ? START_COUNTDOWN_SEC : 0;
    this.elapsedSec = 0;
    this.skidEmitTimer = 0;
    this.countdownRemaining = this.matchConfig.durationSeconds;
    this.score = 0;
    this.hitstopTimer = 0;
    this.spectating = false;
    this.spectatorIndex = 0;
    this.matchWinner = null;

    // 15s spawn damage protection at start of Survival match
    const prot = isSurvival ? SPAWN_PROTECTION_SEC : 0;
    this.playerCar.spawnProtectionTimer = prot;
    for (const r of this.rivalCars) {
      r.spawnProtectionTimer = prot;
    }

    this.safeZoneWall.visible = false;
    this.safeZoneRing.visible = false;

    this.phase = 'playing';
    this.cameraMode = 'chase';
    document.body.dataset.state = 'playing';

    this.cameraRig.snapBehindCar(
      this.playerCar.getPosition(_camTargetPos),
      this.playerCar.getYaw(),
    );
    this.renderer.render(this.scene, this.cameraRig.camera);

    this.callbacks.onPhaseChange('playing');
    this.emitHudSnapshot('none');
  }

  private rebuildActorsForMatch(rivalCount: number, playerSpawn: SpawnPoint): void {
    this.playerCar.dispose(this.scene);
    for (const r of this.rivalCars) r.dispose(this.scene);
    this.rivalCars = [];
    this.arena.dispose();
    this.physics.resetWorld();

    this.arena = buildNeonHarborMap(this.scene, this.physics, this.renderer);
    this.callbacks.onMapReady(this.arena.minimapObstacles);

    this.playerCar = new CarController(
      'player',
      true,
      this.scene,
      this.physics,
      playerSpawn,
      this.customization,
      this.isSoftwareGl,
      'YOU',
    );
    this.spawnRivals(rivalCount, playerSpawn);
  }

  public setPhase(next: GamePhase): void {
    this.phase = next;
    document.body.dataset.state = next;
    if (next !== 'playing') {
      this.input.clearAll();
      this.audio.updateContinuous(false, 0, 0, 0, false);
    } else {
      this.audio.unlock();
      this.cameraMode = 'chase';
    }
    this.callbacks.onPhaseChange(next);
  }

  public setTouchButton(action: TouchActionKey, pressed: boolean): void {
    this.audio.unlock();
    this.input.setTouchButton(action, pressed);
  }

  public setTouchAnalogSteer(steer: number): void {
    this.input.setTouchAnalogSteer(steer);
  }

  public triggerWeaponFromHud(): void {
    this.audio.unlock();
    this.input.triggerWeapon();
  }

  public triggerAbilityFromHud(): void {
    this.audio.unlock();
    this.input.triggerAbility();
  }

  private handleResize(): void {
    const width = Math.max(1, this.mountEl.clientWidth || window.innerWidth);
    const height = Math.max(1, this.mountEl.clientHeight || window.innerHeight);
    this.cameraRig.setAspect(width / height);
    this.renderer.setSize(width, height);
    if (this.ready) {
      this.renderer.render(this.scene, this.cameraRig.camera);
    }
  }

  private scheduleNextFrame(): void {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(() => this.tick());
    } else {
      this.frameId = requestAnimationFrame(() => this.tick());
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = typeof gl.fenceSync === 'function'
      ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
      : null;
    gl.flush();
    let polls = 0;
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.ALREADY_SIGNALED;
      if (state === gl.UNSIGNALED && polls < 25) {
        polls++;
        this.frameId = window.setTimeout(poll, 10);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 90);
      }
    };
    this.frameId = window.setTimeout(poll, 10);
  }

  private getSpectatedCar(): CarController | null {
    if (!this.spectating) return null;
    const living = this.rivalCars.filter((r) => r.alive);
    if (living.length === 0) return null;
    return living[this.spectatorIndex % living.length];
  }

  private tick(): void {
    if (this.disposed || !this.ready) return;

    const nowMs = performance.now();
    if (this.settings.targetFps === 30 && !this.isSoftwareGl && nowMs - this.lastTimeMs < 31) {
      this.scheduleNextFrame();
      return;
    }

    const rawDt = Math.max(0, (nowMs - this.lastTimeMs) / 1000);
    this.lastTimeMs = nowMs;
    const frameDt = Math.min(0.25, Math.max(0.001, rawDt));
    const dt = clampDt(rawDt);

    const playerInput = this.input.sampleAndStep(dt);

    if (playerInput.pauseTriggered && (this.phase === 'playing' || this.phase === 'paused')) {
      this.callbacks.onPauseToggle();
    }

    if (this.isOnlineMatch) {
      if (this.bannerClearTimer > 0) {
        this.bannerClearTimer -= frameDt;
        if (this.bannerClearTimer <= 0) {
          this.onlineConnectionBanner = null;
        }
      }
      if (this.phase === 'playing') {
        this.stepOnlineSimulation(frameDt, nowMs, playerInput);
      } else {
        this.audio.updateContinuous(false, 0, 0, 0, false);
        for (const nc of this.netCars.values()) {
          nc.updateVisual(frameDt, this.cameraRig.camera.position);
        }
      }

      const localEnt = this.localOnlinePlayerId ? this.netCars.get(this.localOnlinePlayerId) : undefined;
      let camEnt = localEnt;
      if (this.spectating && this.latestSnapshot) {
        const livingOthers = this.latestSnapshot.cars.filter(
          (c) => c.alive && c.id !== this.localOnlinePlayerId,
        );
        if (livingOthers.length > 0) {
          const specId = livingOthers[this.spectatorIndex % livingOthers.length].id;
          camEnt = this.netCars.get(specId) ?? camEnt;
        }
      }
      if (camEnt) {
        _camTargetPos.set(camEnt.currentX, camEnt.currentY, camEnt.currentZ);
        this.cameraRig.update(
          dt,
          'chase',
          _camTargetPos,
          camEnt.currentYaw,
          camEnt.speedKmh,
          camEnt.nitroActive,
          this.arena.raycastTargets,
        );
      }
      this.renderer.render(this.scene, this.cameraRig.camera);
      if (this.phase === 'playing' && nowMs - this.lastHudEmit >= 75) {
        this.lastHudEmit = nowMs;
        this.emitHudSnapshot('none');
      }
      this.scheduleNextFrame();
      return;
    }

    if (this.phase === 'playing') {
      if (this.hitstopTimer > 0) {
        this.hitstopTimer = Math.max(0, this.hitstopTimer - frameDt);
      } else {
        let remaining = frameDt;
        let firstSubstep = true;
        while (remaining > 0.0001 && this.phase === 'playing') {
          const subDt = Math.min(0.045, remaining);
          remaining -= subDt;
          const stepInput = firstSubstep
            ? playerInput
            : {
                ...playerInput,
                jumpBuffered: false,
                weaponTriggered: false,
                abilityTriggered: false,
                recoverTriggered: false,
                pauseTriggered: false,
              };
          firstSubstep = false;
          this.stepSimulation(subDt, stepInput);
        }
      }
    } else {
      this.audio.updateContinuous(false, 0, 0, 0, false);
    }

    const followCar = this.getSpectatedCar() ?? this.playerCar;
    followCar.getPosition(_camTargetPos);
    const camMode: CameraMode =
      this.phase === 'playing' || this.phase === 'paused' || this.phase === 'gameover'
        ? 'chase'
        : this.cameraMode;

    this.cameraRig.update(
      dt,
      camMode,
      _camTargetPos,
      followCar.getYaw(),
      followCar.speedKmh,
      followCar.nitroActive ||
        followCar.driftState.driftBoostRemaining > 0 ||
        followCar.nitroAbilityTimer > 0 ||
        followCar.dashTimer > 0,
      this.arena.raycastTargets,
      followCar.body.linvel().y,
      followCar.isGrounded,
    );

    // Sync world-space HP bars to face camera cleanly
    for (const r of this.rivalCars) {
      r.syncWorldHealthBar(this.cameraRig.camera.position);
    }

    this.renderer.render(this.scene, this.cameraRig.camera);

    if (this.phase === 'playing' && nowMs - this.lastHudEmit >= 75) {
      this.lastHudEmit = nowMs;
      this.emitHudSnapshot('none');
    }

    this.scheduleNextFrame();
  }

  private stepOnlineSimulation(
    dt: number,
    nowMs: number,
    playerInput: ReturnType<InputManager['sampleAndStep']>,
  ): void {
    const hasDiscrete =
      playerInput.jumpBuffered ||
      playerInput.weaponTriggered ||
      playerInput.abilityTriggered ||
      playerInput.recoverTriggered;

    if (this.onlineClient && (hasDiscrete || nowMs - this.lastInputSendMs >= 45)) {
      this.lastInputSendMs = nowMs;
      this.onlineClient.sendInput({
        throttle: playerInput.throttle,
        brake: playerInput.brake,
        steer: playerInput.steer,
        drift: playerInput.drift,
        nitro: playerInput.nitro,
        jump: playerInput.jumpBuffered,
        useWeapon: playerInput.weaponTriggered,
        useAbility: playerInput.abilityTriggered,
        recover: playerInput.recoverTriggered,
      });
      if (playerInput.jumpBuffered) this.input.consumeJumpBuffer();
    }

    this.skidMarks.update(dt);
    this.skidEmitTimer = Math.max(0, this.skidEmitTimer - dt);
    this.smokeEmitTimer = Math.max(0, this.smokeEmitTimer - dt);

    for (const ent of this.netCars.values()) {
      ent.updateVisual(dt, this.cameraRig.camera.position);
      if (ent.alive && ent.isDrifting && this.skidEmitTimer <= 0) {
        this.skidMarks.emitPair(ent.currentX, ent.currentY, ent.currentZ, ent.currentYaw);
        if (Math.random() < 0.65) {
          this.combat.spawnBurst(ent.currentX, ent.currentY + 0.15, ent.currentZ, 2, '#cbd5e1', 3.5, 0.85);
        }
      }
      if (ent.alive && ent.hp <= 30 && this.smokeEmitTimer <= 0) {
        this.combat.spawnSmokePuff(ent.currentX, ent.currentY, ent.currentZ);
      }
      // Water splash VFX when driving through river zone
      if (
        ent.alive &&
        ent.currentX >= 147.5 &&
        ent.currentX <= 182.5 &&
        ent.currentZ >= -295 &&
        ent.currentZ <= 95 &&
        ent.currentY < 0.65 &&
        ent.speedKmh > 12 &&
        Math.random() < 0.4
      ) {
        this.combat.spawnWaterSplash(ent.currentX, 0.15, ent.currentZ);
      }
    }
    if (this.skidEmitTimer <= 0) this.skidEmitTimer = 0.05;
    if (this.smokeEmitTimer <= 0) this.smokeEmitTimer = 0.14;

    const snap = this.latestSnapshot;
    if (!snap) return;

    this.powerUps.syncFromServer(snap.pickups, dt);
    this.combat.syncNetworkVisuals(snap.rockets, snap.hazards, dt);
    this.arena.syncFromNetworkState(
      dt,
      snap.matchElapsedSeconds,
      snap.drawbridgePhase,
      snap.drawbridgeOpenAmount,
      snap.trainPhase,
      snap.trainZ,
    );

    if (snap.drawbridgePhase === 'warning' && this.prevBridgePhase !== 'warning') {
      this.audio.playBridgeAlarm();
    }
    if (snap.trainPhase === 'closing' && this.prevTrainPhase !== 'closing') {
      this.audio.playTrainHorn();
    }
    this.prevBridgePhase = snap.drawbridgePhase;
    this.prevTrainPhase = snap.trainPhase;

    if (snap.safeZone.phaseIndex >= 2) {
      this.safeZoneWall.visible = true;
      this.safeZoneRing.visible = true;
      this.safeZoneWall.scale.set(snap.safeZone.radiusMeters, 1, snap.safeZone.radiusMeters);
      this.safeZoneRing.scale.set(snap.safeZone.radiusMeters, 1, snap.safeZone.radiusMeters);
    } else {
      this.safeZoneWall.visible = false;
      this.safeZoneRing.visible = false;
    }

    const mineState = snap.cars.find((c) => c.id === this.localOnlinePlayerId);
    if (mineState) {
      this.audio.updateContinuous(
        mineState.alive && snap.startingCountdown <= 0,
        mineState.speedKmh,
        playerInput.throttle,
        mineState.slipRatio,
        mineState.nitroActive || mineState.driftBoostRemaining > 0 || mineState.nitroAbilityTimer > 0,
      );
    }
  }

  private handleEliminations(allCars: CarController[]): void {
    for (const car of allCars) {
      if (!car.alive && !car.koExplosionDone) {
        car.koExplosionDone = true;
        const p = car.body.translation();
        this.combat.spawnEliminationExplosion(p.x, p.y, p.z);
        this.audio.playImpact(0.95);
        if (car.lastAttackerId) {
          const attacker = allCars.find((c) => c.id === car.lastAttackerId);
          if (attacker) {
            attacker.eliminations += 1;
            if (attacker.isPlayer) {
              this.score += 650;
            }
          }
        }
      }
    }
  }

  private finalizeMatch(outcome: 'victory' | 'timeup' | 'wrecked'): void {
    const allCars = [this.playerCar, ...this.rivalCars];
    const survivor = allCars.find((c) => c.alive) ?? this.playerCar;
    const spec = VEHICLE_CONFIGS[survivor.customization.vehicleId];
    this.matchWinner = {
      id: survivor.id,
      name: survivor.driverName,
      vehicleName: spec.name,
      isPlayer: survivor.isPlayer,
      hpRemaining: Math.round(survivor.hp),
    };

    const totalScore = this.score + this.playerCar.driftState.driftScore;
    if (totalScore > this.bestScore) {
      this.bestScore = totalScore;
      try {
        localStorage.setItem('drift_arena_best_score', String(totalScore));
      } catch {
        // ignore
      }
    }
    this.phase = 'gameover';
    document.body.dataset.state = 'gameover';
    this.audio.updateContinuous(false, 0, 0, 0, false);
    this.input.clearAll();
    this.emitHudSnapshot(outcome);
    this.callbacks.onPhaseChange('gameover');
  }

  private stepSimulation(
    dt: number,
    playerInput: ReturnType<InputManager['sampleAndStep']>,
  ): void {
    const allCars = [this.playerCar, ...this.rivalCars];
    const inStartCountdown = this.startingCountdown > 0;

    if (inStartCountdown) {
      this.startingCountdown = Math.max(0, this.startingCountdown - dt);
      // Keep cars parked during 5..1 countdown
      for (const car of allCars) {
        car.step(dt, playerInput, this.physics, undefined, true);
        // Freeze spawn protection timer until countdown reaches 0
        if (this.matchConfig.mode === 'survival') {
          car.spawnProtectionTimer = SPAWN_PROTECTION_SEC;
        }
      }
      this.arena.updateDynamicWorld(dt, 0);
      this.physics.step(dt, () => {});
      this.audio.updateContinuous(false, 0, 0, 0, false);
      return;
    }

    this.elapsedSec += dt;
    this.skidEmitTimer = Math.max(0, this.skidEmitTimer - dt);

    for (const [key, timer] of this.impactCooldowns) {
      if (timer - dt <= 0) this.impactCooldowns.delete(key);
      else this.impactCooldowns.set(key, timer - dt);
    }

    this.countdownRemaining = Math.max(0, this.countdownRemaining - dt);

    const safeZone =
      this.matchConfig.mode === 'survival'
        ? evaluateSafeZone(this.elapsedSec)
        : evaluateSafeZone(0);

    // Update 3D Safe Zone Boundary Wall
    if (this.matchConfig.mode === 'survival' && safeZone.phaseIndex >= 2) {
      this.safeZoneWall.visible = true;
      this.safeZoneRing.visible = true;
      this.safeZoneWall.scale.set(safeZone.radiusMeters, 1, safeZone.radiusMeters);
      this.safeZoneRing.scale.set(safeZone.radiusMeters, 1, safeZone.radiusMeters);
    } else {
      this.safeZoneWall.visible = false;
      this.safeZoneRing.visible = false;
    }

    if (playerInput.recoverTriggered && this.playerCar.alive) {
      this.playerCar.recoverToCheckpoint();
    }

    const combatCallbacks: CombatEventCallbacks = {
      onWeaponFired: (car, kind) => {
        if (car.isPlayer) {
          this.audio.playWeaponPulse(kind);
        }
      },
      onAbilityUsed: (car) => {
        if (car.isPlayer) {
          this.audio.playAbilityShield();
        }
      },
      onDamageDealt: (target, attackerId, damage) => {
        if (attackerId === 'player' && damage > 0) {
          this.score += target.alive ? damage * 5 : damage * 5 + 300;
          this.audio.playImpact(0.78);
          this.hitstopTimer = 0.035;
        } else if (target.isPlayer && damage > 0) {
          this.audio.playImpact(0.8);
          this.cameraRig.addTrauma(0.55);
        }
      },
      onExplosion: (x, _y, z) => {
        const pp = this.playerCar.body.translation();
        if (Math.hypot(pp.x - x, pp.z - z) < 35) {
          this.audio.playExplosion();
        }
      },
    };

    // Player physics step
    this.playerCar.step(dt, playerInput, this.physics, {
      onJump: () => {
        this.input.consumeJumpBuffer();
        this.audio.playJump();
        const p = this.playerCar.body.translation();
        this.combat.spawnBurst(p.x, p.y + 0.2, p.z, 6, '#e2e8f0', 6, 0.7);
      },
      onLand: (impactSpeedY) => {
        const p = this.playerCar.body.translation();
        this.combat.spawnBurst(p.x, p.y + 0.15, p.z, 6, '#cbd5e1', 5, 0.7);
        this.audio.playImpact(Math.min(0.45, impactSpeedY / 18));
      },
      onDriftBoost: () => {
        this.audio.playBoost();
        const p = this.playerCar.body.translation();
        this.combat.spawnBurst(p.x, p.y + 0.35, p.z, 10, '#38bdf8', 9, 0.9);
      },
    });

    if (playerInput.weaponTriggered) {
      this.combat.useWeapon(this.playerCar, allCars, combatCallbacks);
    }
    if (playerInput.abilityTriggered) {
      this.combat.useAbility(this.playerCar, combatCallbacks);
    }

    // Tire smoke & temporary tire skid marks during controlled drifts
    if (
      this.playerCar.alive &&
      (this.playerCar.driftState.isDrifting ||
        (this.playerCar.isGrounded && this.playerCar.slipRatio > 0.42))
    ) {
      const p = this.playerCar.body.translation();
      if (this.skidEmitTimer <= 0) {
        this.skidMarks.emitPair(p.x, p.y, p.z, this.playerCar.getYaw());
        this.skidEmitTimer = 0.045;
      }
      if (Math.random() < 0.7) {
        this.combat.spawnBurst(p.x, p.y + 0.15, p.z, 2, '#cbd5e1', 3.5, 0.9);
      }
    }

    // AI rivals step using full 8-state FSM + identical physics/combat/ability systems
    const hazards = this.combat.getActiveHazards();
    for (const rival of this.rivalCars) {
      const aiInput = this.ai.computeInput(
        rival,
        allCars,
        this.powerUps.nodes,
        hazards,
        {
          difficulty: this.matchConfig.difficulty,
          safeZoneRadiusMeters: safeZone.radiusMeters,
          drawbridgeOpenAmount: this.arena.drawbridgeOpenAmount,
          trainPhase: this.arena.trainPhase,
          trainZ: this.arena.trainZ,
        },
        dt,
      );
      rival.step(dt, aiInput, this.physics);
      if (aiInput.weaponTriggered) {
        this.combat.useWeapon(rival, allCars, combatCallbacks);
      }
      if (aiInput.abilityTriggered) {
        this.combat.useAbility(rival, combatCallbacks);
      }
    }

    this.arena.updateDynamicWorld(dt, this.elapsedSec);

    if (this.arena.drawbridgePhase === 'warning' && this.prevBridgePhase !== 'warning') {
      this.audio.playBridgeAlarm();
    }
    if (this.arena.trainPhase === 'closing' && this.prevTrainPhase !== 'closing') {
      this.audio.playTrainHorn();
    }
    this.prevBridgePhase = this.arena.drawbridgePhase;
    this.prevTrainPhase = this.arena.trainPhase;

    // Low-HP engine smoke & river splash particles in single-player
    this.smokeEmitTimer = Math.max(0, this.smokeEmitTimer - dt);
    for (const c of allCars) {
      if (!c.alive) continue;
      const cp = c.body.translation();
      if (c.hp <= 30 && this.smokeEmitTimer <= 0) {
        this.combat.spawnSmokePuff(cp.x, cp.y, cp.z);
      }
      if (
        cp.x >= 147.5 &&
        cp.x <= 182.5 &&
        cp.z >= -295 &&
        cp.z <= 95 &&
        cp.y < 0.65 &&
        c.speedKmh > 12 &&
        Math.random() < 0.35
      ) {
        this.combat.spawnWaterSplash(cp.x, 0.15, cp.z);
      }
    }
    if (this.smokeEmitTimer <= 0) this.smokeEmitTimer = 0.14;

    // Step Rapier physics & collision events
    this.physics.step(dt, (evt) => {
      const ownerA = this.physics.getOwner(evt.colliderHandleA);
      const ownerB = this.physics.getOwner(evt.colliderHandleB);
      if (!ownerA || !ownerB) return;

      const carA = allCars.find((c) => c.id === ownerA);
      const carB = allCars.find((c) => c.id === ownerB);

      if (carA && carB && carA.alive && carB.alive) {
        const pairKey = ownerA < ownerB ? `${ownerA}:${ownerB}` : `${ownerB}:${ownerA}`;
        if (this.impactCooldowns.has(pairKey)) return;

        const va = carA.body.linvel();
        const vb = carB.body.linvel();
        const relSpeed = Math.hypot(va.x - vb.x, va.z - vb.z);
        const ramA = VEHICLE_CONFIGS[carA.customization.vehicleId].ramMultiplier;
        const ramB = VEHICLE_CONFIGS[carB.customization.vehicleId].ramMultiplier;

        const rawDmgA = computeCollisionDamage(
          relSpeed,
          false,
          carA.customization.vehicleId,
          ramB,
        );
        const rawDmgB = computeCollisionDamage(
          relSpeed,
          false,
          carB.customization.vehicleId,
          ramA,
        );

        if (rawDmgA > 0 || rawDmgB > 0) {
          this.impactCooldowns.set(pairKey, COLLISION_PAIR_COOLDOWN_SEC);
          const resA = carA.applyCombatDamage(rawDmgA, 'collision', carB.id);
          const resB = carB.applyCombatDamage(rawDmgB, 'collision', carA.id);

          if (carA.isPlayer || carB.isPlayer) {
            this.audio.playImpact(Math.min(1, relSpeed / 25));
            this.cameraRig.addTrauma(Math.min(0.85, relSpeed / 26));
            if (relSpeed > 14) this.hitstopTimer = 0.04;
            if (carA.isPlayer && resB.damageDealt > 0) this.score += resB.damageDealt * 5;
            if (carB.isPlayer && resA.damageDealt > 0) this.score += resA.damageDealt * 5;
          }

          const pa = carA.body.translation();
          const pb = carB.body.translation();
          this.combat.spawnBurst(
            (pa.x + pb.x) * 0.5,
            Math.max(pa.y, pb.y) + 0.8,
            (pa.z + pb.z) * 0.5,
            14,
            '#facc15',
            11,
            1.1,
          );
        }
        return;
      }

      const hitCar = carA || carB;
      const otherId = carA ? ownerB : ownerA;
      if (!hitCar || !hitCar.alive) return;

      if (otherId === 'freight_train') {
        const pairKey = `${hitCar.id}:freight_train`;
        if (this.impactCooldowns.has(pairKey)) return;
        this.impactCooldowns.set(pairKey, COLLISION_PAIR_COOLDOWN_SEC);

        const p = hitCar.body.translation();
        const pushDir = p.x >= 195 ? 1 : -1;
        hitCar.body.setLinvel({ x: pushDir * 24, y: 6.5, z: -12 }, true);
        hitCar.applyCombatDamage(35, 'train');

        if (hitCar.isPlayer) {
          this.audio.playImpact(1.0);
          this.cameraRig.addTrauma(0.95);
          this.hitstopTimer = 0.06;
        }
        this.combat.spawnBurst(p.x, p.y + 1.0, p.z, 18, '#fb923c', 14, 1.2);
        return;
      }

      if (otherId.startsWith('crate_')) {
        const pairKey = `${hitCar.id}:${otherId}`;
        if (this.impactCooldowns.has(pairKey)) return;
        this.impactCooldowns.set(pairKey, 0.5);
        const v = hitCar.body.linvel();
        const speed = Math.hypot(v.x, v.z);
        if (hitCar.isPlayer && speed > 4) {
          this.audio.playImpact(0.35);
          this.score += 25;
        }
        return;
      }

      if (isSolidWallObstacle(otherId)) {
        const pairKey = `${hitCar.id}:${otherId}`;
        if (this.impactCooldowns.has(pairKey)) return;
        const v = hitCar.body.linvel();
        const speed = Math.hypot(v.x, v.z);
        const rawDmg = computeCollisionDamage(
          speed * 0.72,
          false,
          hitCar.customization.vehicleId,
        );
        if (rawDmg > 0) {
          this.impactCooldowns.set(pairKey, 0.75);
          hitCar.applyCombatDamage(rawDmg, 'collision');
          if (hitCar.isPlayer) {
            this.audio.playImpact(Math.min(0.9, speed / 28));
            this.cameraRig.addTrauma(Math.min(0.65, speed / 32));
          }
          const p = hitCar.body.translation();
          this.combat.spawnBurst(p.x, p.y + 0.6, p.z, 9, '#fb923c', 8, 0.9);
        }
      }
    });

    this.skidMarks.update(dt);

    // Update 11-item weighted power-ups (start at 8s in Survival, immediate in Free Drive)
    const canSpawnPickups =
      this.matchConfig.mode === 'freedrive' ||
      this.elapsedSec >= PICKUP_START_DELAY_SEC;

    this.powerUps.update(
      dt,
      allCars,
      {
        canSpawn: canSpawnPickups,
        safeZoneRadiusMeters: safeZone.radiusMeters,
        drawbridgeOpenAmount: this.arena.drawbridgeOpenAmount,
      },
      (car, _kind, x, z, color) => {
        if (car.isPlayer) {
          this.audio.playPickup();
          this.score += 100;
        }
        this.combat.spawnBurst(x, 1.0, z, 12, color, 8, 1.0);
      },
    );

    // Update rockets, deployed hazards & particles
    this.combat.update(dt, allCars, combatCallbacks);

    // Safe Zone boundary damage ticks (Phases 2–6)
    if (this.matchConfig.mode === 'survival' && safeZone.damagePerTick > 0) {
      for (const car of allCars) {
        if (!car.alive) continue;
        const cp = car.body.translation();
        if (isOutsideSafeZone(cp.x, cp.z, safeZone.radiusMeters)) {
          const prev = this.boundaryTickTimers.get(car.id) ?? 0;
          const next = prev + dt;
          if (next >= safeZone.tickIntervalSec) {
            this.boundaryTickTimers.set(car.id, next - safeZone.tickIntervalSec);
            car.applyCombatDamage(safeZone.damagePerTick, 'boundary');
          } else {
            this.boundaryTickTimers.set(car.id, next);
          }
        } else {
          this.boundaryTickTimers.set(car.id, 0);
        }
      }
    }

    // Trigger KO explosion & kill attribution
    this.handleEliminations(allCars);

    // Enter Spectator Mode automatically if human dies while >= 2 cars remain
    const aliveCars = allCars.filter((c) => c.alive);
    if (
      this.matchConfig.mode === 'survival' &&
      !this.playerCar.alive &&
      !this.spectating &&
      aliveCars.length > 1
    ) {
      this.spectating = true;
      this.spectatorIndex = 0;
    }

    // Continuous engine & tire screech audio for watched car
    const watched = this.getSpectatedCar() ?? this.playerCar;
    this.audio.updateContinuous(
      watched.alive,
      watched.speedKmh,
      watched.isPlayer ? playerInput.throttle : 0.7,
      watched.slipRatio,
      watched.nitroActive ||
        watched.driftState.driftBoostRemaining > 0 ||
        watched.nitroAbilityTimer > 0,
    );

    // Evaluate Win / Loss Outcome
    const outcome = evaluateSurvivalMatchResult({
      mode: this.matchConfig.mode,
      aliveCarsCount: aliveCars.length,
      playerAlive: this.playerCar.alive,
      spectating: this.spectating,
      matchElapsedSec: this.elapsedSec,
    });

    if (outcome !== 'none') {
      this.finalizeMatch(outcome);
    }
  }

  private emitHudSnapshot(outcome: HudSnapshot['outcome']): void {
    if (this.isOnlineMatch) {
      this.emitOnlineHudSnapshot(outcome);
      return;
    }

    const pPos = this.playerCar.getPosition(_camTargetPos);
    const pYaw = this.playerCar.getYaw();

    const actors: MinimapActor[] = [
      {
        id: 'player',
        x: pPos.x,
        z: pPos.z,
        yaw: pYaw,
        kind: 'player',
        alive: this.playerCar.alive,
        color: '#38bdf8',
      },
    ];

    for (const r of this.rivalCars) {
      const rp = r.getPosition(_rivalPos);
      actors.push({
        id: r.id,
        x: rp.x,
        z: rp.z,
        yaw: r.getYaw(),
        kind: 'rival',
        alive: r.alive,
        color: '#ef4444',
      });
    }

    for (const pu of this.powerUps.nodes) {
      actors.push({
        id: pu.id,
        x: pu.x,
        z: pu.z,
        yaw: 0,
        kind: 'pickup',
        alive: true,
        color: getPickupColor(pu.kind),
      });
    }

    for (const haz of this.combat.getActiveHazards()) {
      actors.push({
        id: haz.id,
        x: haz.x,
        z: haz.z,
        yaw: 0,
        kind: 'hazard',
        alive: true,
        color: haz.kind === 'bomb' ? '#facc15' : haz.kind === 'spike_trap' ? '#a855f7' : '#ec4899',
      });
    }

    if (this.arena.trainPhase === 'passing' || this.arena.trainPhase === 'closing') {
      actors.push({
        id: 'freight_train',
        x: 195,
        z: this.arena.trainZ,
        yaw: 0,
        kind: 'train',
        alive: true,
        color: '#f97316',
      });
    }

    const totalScore = this.score + this.playerCar.driftState.driftScore;
    if (totalScore > this.bestScore) {
      this.bestScore = totalScore;
    }

    const activeSpec = VEHICLE_CONFIGS[this.playerCar.customization.vehicleId];
    const safeZone =
      this.matchConfig.mode === 'survival'
        ? evaluateSafeZone(this.elapsedSec)
        : evaluateSafeZone(0);
    safeZone.outsideWarning =
      this.matchConfig.mode === 'survival' &&
      this.playerCar.alive &&
      isOutsideSafeZone(pPos.x, pPos.z, safeZone.radiusMeters);

    const spectated = this.getSpectatedCar();

    this.callbacks.onHudUpdate({
      hp: Math.round(this.playerCar.hp),
      maxHp: this.playerCar.maxHp,
      speedKmh: this.playerCar.speedKmh,
      nitro: Math.round(this.playerCar.nitro),
      nitroActive: this.playerCar.nitroActive,
      driftScore: this.playerCar.driftState.driftScore,
      driftCharge: Math.round(this.playerCar.driftState.driftCharge),
      driftBoostRemaining: Number(this.playerCar.driftState.driftBoostRemaining.toFixed(1)),
      driftMultiplier: this.playerCar.driftState.driftMultiplier,
      isDrifting: this.playerCar.driftState.isDrifting,
      startingCountdown: Math.ceil(this.startingCountdown),
      matchElapsedSeconds: Math.floor(this.elapsedSec),
      countdownSeconds: Math.ceil(this.countdownRemaining),
      spawnProtectionRemaining: Number(this.playerCar.spawnProtectionTimer.toFixed(1)),
      equippedWeapon: this.playerCar.equippedWeapon
        ? { ...this.playerCar.equippedWeapon }
        : null,
      equippedAbility: this.playerCar.equippedAbility
        ? { ...this.playerCar.equippedAbility }
        : null,
      weaponCooldown: Number(this.playerCar.weaponCooldown.toFixed(1)),
      weaponMaxCooldown: this.playerCar.equippedWeapon?.maxCooldown ?? 2.5,
      abilityCooldown: Number(this.playerCar.abilityCooldown.toFixed(1)),
      abilityMaxCooldown: 8.0,
      abilityActiveRemaining: Number(this.playerCar.shieldTimer.toFixed(1)),
      activeArmorRemaining: Number(this.playerCar.armorTimer.toFixed(1)),
      activeNitroBoostRemaining: Number(this.playerCar.nitroAbilityTimer.toFixed(1)),
      activeDashRemaining: Number(this.playerCar.dashTimer.toFixed(1)),
      activeSlowRemaining: Number(this.playerCar.slowTimer.toFixed(1)),
      rivalsAlive: this.rivalCars.filter((r) => r.alive).length,
      rivalsTotal: this.rivalCars.length,
      eliminations: this.playerCar.eliminations,
      score: totalScore,
      bestScore: this.bestScore,
      damageTaken: Math.round(this.playerCar.damageTaken),
      playerX: pPos.x,
      playerY: Number(pPos.y.toFixed(1)),
      playerZ: pPos.z,
      playerYaw: pYaw,
      vehicleId: activeSpec.id,
      vehicleName: activeSpec.name,
      currentDistrict: getDistrictAt(pPos.x, pPos.z),
      drawbridgePhase: this.arena.drawbridgePhase,
      drawbridgeOpenAmount: this.arena.drawbridgeOpenAmount,
      trainPhase: this.arena.trainPhase,
      trainZ: this.arena.trainZ,
      safeZone,
      spectating: this.spectating,
      spectatingName: spectated ? spectated.driverName : null,
      spectatingVehicle: spectated
        ? VEHICLE_CONFIGS[spectated.customization.vehicleId].name
        : null,
      spectatingHp: spectated ? Math.round(spectated.hp) : 0,
      winner: this.matchWinner,
      actors,
      outcome,
      isOnline: false,
      roomCode: null,
      pingMs: 0,
      connectionBanner: null,
    });
  }

  private emitOnlineHudSnapshot(outcome: HudSnapshot['outcome']): void {
    const snap = this.latestSnapshot;
    const myCar = snap?.cars.find((c) => c.id === this.localOnlinePlayerId) ?? snap?.cars[0];
    const spec = VEHICLE_CONFIGS[myCar?.customization.vehicleId ?? this.customization.vehicleId];
    const actors: MinimapActor[] = [];

    if (snap) {
      for (const c of snap.cars) {
        actors.push({
          id: c.id,
          x: c.x,
          z: c.z,
          yaw: c.yaw,
          kind: c.id === this.localOnlinePlayerId ? 'player' : 'rival',
          alive: c.alive,
          color: c.id === this.localOnlinePlayerId ? '#38bdf8' : '#ef4444',
        });
      }
      for (const pu of snap.pickups) {
        actors.push({
          id: pu.id,
          x: pu.x,
          z: pu.z,
          yaw: 0,
          kind: 'pickup',
          alive: true,
          color: getPickupColor(pu.kind),
        });
      }
      for (const haz of snap.hazards) {
        actors.push({
          id: haz.id,
          x: haz.x,
          z: haz.z,
          yaw: 0,
          kind: 'hazard',
          alive: true,
          color: haz.kind === 'bomb' ? '#facc15' : haz.kind === 'spike_trap' ? '#a855f7' : '#ec4899',
        });
      }
      if (snap.trainPhase === 'passing' || snap.trainPhase === 'closing') {
        actors.push({
          id: 'freight_train',
          x: 195,
          z: snap.trainZ,
          yaw: 0,
          kind: 'train',
          alive: true,
          color: '#f97316',
        });
      }
    }

    const livingOthers = snap?.cars.filter((c) => c.alive && c.id !== this.localOnlinePlayerId) ?? [];
    const spectated = this.spectating && livingOthers.length > 0
      ? livingOthers[this.spectatorIndex % livingOthers.length]
      : null;

    const myX = myCar?.x ?? 0;
    const myY = myCar?.y ?? 0.15;
    const myZ = myCar?.z ?? 0;
    const myYaw = myCar?.yaw ?? 0;
    const totalScore = myCar?.score ?? 0;
    if (totalScore > this.bestScore) this.bestScore = totalScore;

    const safeZone = snap?.safeZone ?? evaluateSafeZone(0);
    safeZone.outsideWarning = Boolean(
      myCar?.alive && isOutsideSafeZone(myX, myZ, safeZone.radiusMeters),
    );

    this.callbacks.onHudUpdate({
      hp: Math.round(myCar?.hp ?? 100),
      maxHp: myCar?.maxHp ?? 100,
      speedKmh: myCar?.speedKmh ?? 0,
      nitro: Math.round(myCar?.nitro ?? 100),
      nitroActive: Boolean(myCar?.nitroActive),
      driftScore: myCar?.driftScore ?? 0,
      driftCharge: Math.round(myCar?.driftCharge ?? 0),
      driftBoostRemaining: myCar?.driftBoostRemaining ?? 0,
      driftMultiplier: myCar?.driftMultiplier ?? 1,
      isDrifting: Boolean(myCar?.isDrifting),
      startingCountdown: snap?.startingCountdown ?? 5,
      matchElapsedSeconds: snap?.matchElapsedSeconds ?? 0,
      countdownSeconds: snap?.countdownRemaining ?? SURVIVAL_TARGET_DURATION_SEC,
      spawnProtectionRemaining: myCar?.spawnProtectionTimer ?? 0,
      equippedWeapon: myCar?.equippedWeapon ? { ...myCar.equippedWeapon } : null,
      equippedAbility: myCar?.equippedAbility ? { ...myCar.equippedAbility } : null,
      weaponCooldown: myCar?.weaponCooldown ?? 0,
      weaponMaxCooldown: myCar?.equippedWeapon?.maxCooldown ?? 2.5,
      abilityCooldown: myCar?.abilityCooldown ?? 0,
      abilityMaxCooldown: 8.0,
      abilityActiveRemaining: myCar?.shieldTimer ?? 0,
      activeArmorRemaining: myCar?.armorTimer ?? 0,
      activeNitroBoostRemaining: myCar?.nitroAbilityTimer ?? 0,
      activeDashRemaining: myCar?.dashTimer ?? 0,
      activeSlowRemaining: myCar?.slowTimer ?? 0,
      rivalsAlive: snap ? snap.cars.filter((c) => c.alive && c.id !== this.localOnlinePlayerId).length : 0,
      rivalsTotal: snap ? Math.max(0, snap.cars.length - 1) : 0,
      eliminations: myCar?.eliminations ?? 0,
      score: totalScore,
      bestScore: this.bestScore,
      damageTaken: myCar?.damageTaken ?? 0,
      playerX: myX,
      playerY: Number(myY.toFixed(1)),
      playerZ: myZ,
      playerYaw: myYaw,
      vehicleId: spec.id,
      vehicleName: spec.name,
      currentDistrict: getDistrictAt(myX, myZ),
      drawbridgePhase: snap?.drawbridgePhase ?? 'closed',
      drawbridgeOpenAmount: snap?.drawbridgeOpenAmount ?? 0,
      trainPhase: snap?.trainPhase ?? 'idle',
      trainZ: snap?.trainZ ?? 340,
      safeZone,
      spectating: this.spectating,
      spectatingName: spectated?.name ?? null,
      spectatingVehicle: spectated ? VEHICLE_CONFIGS[spectated.customization.vehicleId].name : null,
      spectatingHp: spectated ? Math.round(spectated.hp) : 0,
      winner: this.matchWinner,
      actors,
      outcome,
      isOnline: true,
      roomCode: this.onlineRoomCode,
      pingMs: this.onlineClient?.pingMs ?? 0,
      connectionBanner: this.onlineConnectionBanner,
    });
  }

  public dispose(): void {
    this.exitOnlineMatch();
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.audio.dispose();
    this.playerCar?.dispose(this.scene);
    for (const r of this.rivalCars) r.dispose(this.scene);
    this.skidMarks?.dispose(this.scene);
    this.powerUps?.dispose(this.scene);
    this.combat?.dispose(this.scene);
    this.scene.remove(this.safeZoneWall);
    this.scene.remove(this.safeZoneRing);
    this.safeZoneGeos.forEach((g) => g.dispose());
    this.safeZoneMats.forEach((m) => m.dispose());
    this.arena?.dispose();
    this.physics.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.mountEl) {
      this.mountEl.removeChild(this.renderer.domElement);
    }
  }
}

