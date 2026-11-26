import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  type CarCustomization,
  type DistrictId,
  type GamePhase,
  type GameSettings,
  type HudSnapshot,
  type MatchConfig,
  type MinimapObstacle,
  type ScreenId,
  type VehicleId,
} from './types/game';
import { VEHICLE_CONFIGS, VEHICLE_ORDER } from './cars/vehicleConfigs';
import { evaluateSafeZone } from './combat/survivalRules';
import { GameEngine } from './engine/GameEngine';
import type { TouchActionKey } from './controls/InputManager';
import { GameHUD } from './hud/GameHUD';
import { MainMenu } from './components/screens/MainMenu';
import { SinglePlayerScreen } from './components/screens/SinglePlayerScreen';
import { MultiplayerScreen } from './components/screens/MultiplayerScreen';
import { GarageScreen } from './components/screens/GarageScreen';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { GameOverModal, PauseModal } from './components/screens/StatusModals';
import { MultiplayerClient } from './multiplayer/MultiplayerClient';
import type { MatchStanding, RoomLobbySnapshot } from './multiplayer/protocol';
import {
  auth,
  signInWithGoogle,
  signOutAccount,
} from './firebase/firebaseClient';
import {
  ensureUserProfile,
  recordMatchOutcome,
  type RacerProfile,
} from './firebase/profileService';

const INITIAL_CUSTOMIZATION: CarCustomization = {
  vehicleId: 'street_rs',
  bodyColor: '#f97316',
  accentColor: '#0f172a',
  rimColor: '#cbd5e1',
};

const INITIAL_SETTINGS: GameSettings = {
  masterVolume: 0.65,
  muted: false,
  musicEnabled: true,
  touchControlsMode: 'auto',
  cameraDistance: 1.0,
  steerSensitivity: 1.0,
  highQuality: true,
  targetFps: 60,
};

const INITIAL_MATCH: MatchConfig = {
  mode: 'survival',
  rivalCount: 5,
  durationSeconds: 420,
  spawnIndex: 0,
  difficulty: 'normal',
};

const INITIAL_HUD: HudSnapshot = {
  hp: 100,
  maxHp: 100,
  speedKmh: 0,
  nitro: 100,
  nitroActive: false,
  driftScore: 0,
  driftCharge: 0,
  driftBoostRemaining: 0,
  driftMultiplier: 1,
  isDrifting: false,
  startingCountdown: 0,
  matchElapsedSeconds: 0,
  countdownSeconds: 420,
  spawnProtectionRemaining: 0,
  equippedWeapon: null,
  equippedAbility: null,
  weaponCooldown: 0,
  weaponMaxCooldown: 2.5,
  abilityCooldown: 0,
  abilityMaxCooldown: 8.0,
  abilityActiveRemaining: 0,
  activeArmorRemaining: 0,
  activeNitroBoostRemaining: 0,
  activeDashRemaining: 0,
  activeSlowRemaining: 0,
  rivalsAlive: 5,
  rivalsTotal: 5,
  eliminations: 0,
  score: 0,
  bestScore: 0,
  damageTaken: 0,
  playerX: 0,
  playerY: 0.15,
  playerZ: 52,
  playerYaw: 0,
  vehicleId: 'street_rs',
  vehicleName: 'Street RS',
  currentDistrict: 'downtown',
  drawbridgePhase: 'closed',
  drawbridgeOpenAmount: 0,
  trainPhase: 'idle',
  trainZ: 340,
  safeZone: evaluateSafeZone(0),
  spectating: false,
  spectatingName: null,
  spectatingVehicle: null,
  spectatingHp: 0,
  winner: null,
  actors: [],
  outcome: 'none',
  isOnline: false,
  roomCode: null,
  pingMs: 0,
  connectionBanner: null,
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const mpClientRef = useRef<MultiplayerClient | null>(null);
  if (!mpClientRef.current) {
    mpClientRef.current = new MultiplayerClient();
  }
  const mpClient = mpClientRef.current;

  const [engineReady, setEngineReady] = useState(false);
  const [screen, setScreen] = useState<ScreenId>('menu');
  const [phase, setPhase] = useState<GamePhase>('title');
  const [customization, setCustomization] =
    useState<CarCustomization>(INITIAL_CUSTOMIZATION);
  const [settings, setSettings] = useState<GameSettings>(INITIAL_SETTINGS);
  const [matchConfig, setMatchConfig] = useState<MatchConfig>(INITIAL_MATCH);
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [obstacles, setObstacles] = useState<MinimapObstacle[]>([]);

  // Firebase Auth & Career Profile state
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<RacerProfile | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  // Online Multiplayer Lobby & Session state
  const [driverName, setDriverName] = useState('Driver');
  const [mpConnected, setMpConnected] = useState(false);
  const [mpReconnecting, setMpReconnecting] = useState(false);
  const [mpPlayerId, setMpPlayerId] = useState<string | null>(null);
  const [mpVerifiedUid, setMpVerifiedUid] = useState<string | null>(null);
  const [mpRoom, setMpRoom] = useState<RoomLobbySnapshot | null>(null);
  const [mpError, setMpError] = useState<string | null>(null);
  const [onlineStandings, setOnlineStandings] = useState<MatchStanding[] | null>(
    null,
  );

  const phaseRef = useRef<GamePhase>(phase);
  phaseRef.current = phase;
  const screenRef = useRef<ScreenId>(screen);
  screenRef.current = screen;
  const customizationRef = useRef<CarCustomization>(customization);
  customizationRef.current = customization;
  const driverNameRef = useRef<string>(driverName);
  driverNameRef.current = driverName;
  const userRef = useRef<User | null>(user);
  userRef.current = user;
  const recordedMatchKeyRef = useRef<string | null>(null);

  const connectMultiplayer = useCallback(
    async (explicitUser?: User | null) => {
      const activeUser =
        explicitUser === undefined ? userRef.current : explicitUser;
      let firebaseIdToken: string | undefined;
      if (activeUser) {
        try {
          firebaseIdToken = await activeUser.getIdToken();
        } catch {
          firebaseIdToken = undefined;
        }
      }
      mpClient.connect({
        displayName: driverNameRef.current.trim() || 'Driver',
        customization: customizationRef.current,
        firebaseIdToken,
      });
    },
    [mpClient],
  );

  const handlePauseToggle = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (phaseRef.current === 'playing') {
      engine.setPhase('paused');
    } else if (phaseRef.current === 'paused') {
      engine.setPhase('playing');
    }
  }, []);

  // Initialize 3D GameEngine once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let cancelled = false;
    const engine = new GameEngine(
      container,
      INITIAL_CUSTOMIZATION,
      INITIAL_SETTINGS,
      {
        onHudUpdate: (snap) => setHud(snap),
        onPhaseChange: (nextPhase) => setPhase(nextPhase),
        onMapReady: (obs) => setObstacles(obs),
        onPauseToggle: () => handlePauseToggle(),
      },
    );
    engineRef.current = engine;

    void engine.init().then(() => {
      if (cancelled) return;
      setEngineReady(true);

      const params = new URLSearchParams(window.location.search);
      if (params.get('autostart') === '1') {
        setScreen('gameplay');
        engine.startMatch(INITIAL_MATCH);
      }
    });

    return () => {
      cancelled = true;
      engine.dispose();
      engineRef.current = null;
    };
  }, [handlePauseToggle]);

  // Firebase Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        if (nextUser.displayName && driverNameRef.current === 'Driver') {
          setDriverName(nextUser.displayName.slice(0, 24));
        }
        void ensureUserProfile(nextUser, customizationRef.current.vehicleId)
          .then((loaded) => setProfile(loaded))
          .catch(() => {
            // Firestore errors are already logged via handleFirestoreError
          });
      } else {
        setProfile(null);
      }

      if (screenRef.current === 'multiplayer' || mpClient.connected) {
        void connectMultiplayer(nextUser);
      }
    });
    return () => unsub();
  }, [connectMultiplayer, mpClient]);

  // Subscribe to MultiplayerClient events
  useEffect(() => {
    const unsub = mpClient.subscribe({
      onConnectionChange: (connected, reconnecting) => {
        setMpConnected(connected);
        setMpReconnecting(reconnecting);
      },
      onWelcome: (playerId, verifiedUid) => {
        setMpPlayerId(playerId);
        setMpVerifiedUid(verifiedUid);
        setMpError(null);
      },
      onRoomState: (room) => {
        setMpRoom(room);
        if (room) setMpError(null);
      },
      onMatchStart: (payload) => {
        const engine = engineRef.current;
        if (!engine) return;
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        recordedMatchKeyRef.current = null;
        setOnlineStandings(null);
        setMpError(null);
        setScreen('gameplay');

        const localId = mpClient.playerId ?? '';
        engine.startOnlineMatch(mpClient, payload, localId, (over) => {
          setOnlineStandings(over.standings);
          const currentUser = userRef.current;
          if (currentUser && recordedMatchKeyRef.current !== over.matchId) {
            recordedMatchKeyRef.current = over.matchId;
            const myStanding = over.standings.find((s) => s.id === localId);
            void recordMatchOutcome({
              user: currentUser,
              roomCode: over.roomCode,
              mode: over.mode,
              vehicleId:
                myStanding?.vehicleId ?? customizationRef.current.vehicleId,
              placement: myStanding?.placement ?? over.standings.length,
              playersCount: over.standings.length,
              eliminations: myStanding?.eliminations ?? 0,
              score: myStanding?.score ?? 0,
              won: over.winner.id === localId,
              winnerName: over.winner.name,
              durationSec: over.durationSec,
            })
              .then((updated) => setProfile(updated))
              .catch(() => {
                // Logged by handleFirestoreError
              });
          }
        });
      },
      onError: (_code, message) => {
        setMpError(message);
      },
    });

    return () => {
      unsub();
    };
  }, [mpClient]);

  // Cleanup WS only on root unmount
  useEffect(() => {
    return () => {
      mpClient.disconnect();
    };
  }, [mpClient]);

  // Connect WS automatically when navigating to Multiplayer screen
  useEffect(() => {
    if (screen === 'multiplayer') {
      void connectMultiplayer();
    }
  }, [screen, connectMultiplayer]);

  // Record offline Survival / Free-Drive match completion once per match
  useEffect(() => {
    if (
      phase !== 'gameover' ||
      hud.isOnline ||
      hud.outcome === 'none' ||
      !user
    ) {
      return;
    }
    const key = `offline_${matchConfig.mode}_${Math.round(hud.matchElapsedSeconds)}_${hud.score}_${hud.outcome}`;
    if (recordedMatchKeyRef.current === key) return;
    recordedMatchKeyRef.current = key;

    const totalPlayers = Math.max(1, hud.rivalsTotal + 1);
    const placement =
      hud.outcome === 'victory'
        ? 1
        : Math.max(2, Math.min(totalPlayers, hud.rivalsAlive + 1));

    void recordMatchOutcome({
      user,
      roomCode: 'SOLO',
      mode: matchConfig.mode,
      vehicleId: hud.vehicleId,
      placement,
      playersCount: totalPlayers,
      eliminations: hud.eliminations,
      score: hud.score,
      won: hud.outcome === 'victory',
      winnerName:
        hud.winner?.name ??
        (hud.outcome === 'victory' ? user.displayName || 'You' : 'Rival'),
      durationSec: Math.round(hud.matchElapsedSeconds),
    })
      .then((updated) => setProfile(updated))
      .catch(() => {
        // Logged by handleFirestoreError
      });
  }, [
    phase,
    hud.isOnline,
    hud.outcome,
    hud.matchElapsedSeconds,
    hud.score,
    hud.rivalsTotal,
    hud.rivalsAlive,
    hud.eliminations,
    hud.vehicleId,
    hud.winner,
    matchConfig.mode,
    user,
  ]);

  const handleSignIn = useCallback(async () => {
    setAuthBusy(true);
    try {
      await signInWithGoogle();
    } catch {
      // Popup closed or auth blocked
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    setAuthBusy(true);
    try {
      await signOutAccount();
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const handleSelectVehicle = useCallback(
    (vehicleId: VehicleId) => {
      const spec = VEHICLE_CONFIGS[vehicleId];
      const next: CarCustomization = {
        vehicleId,
        bodyColor: spec.defaultBodyColor,
        accentColor: spec.defaultAccentColor,
        rimColor: spec.defaultRimColor,
      };
      setCustomization(next);
      engineRef.current?.setCustomization(next);
      if (mpRoom) {
        mpClient.updateLoadout(next);
      }
    },
    [mpClient, mpRoom],
  );

  // Dev hotkeys 1–6 during offline gameplay/pause to test all 6 vehicles
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (screen !== 'gameplay' || hud.isOnline) return;
      if (e.code.startsWith('Digit')) {
        const idx = Number(e.code.replace('Digit', '')) - 1;
        if (idx >= 0 && idx < VEHICLE_ORDER.length) {
          handleSelectVehicle(VEHICLE_ORDER[idx]);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [screen, hud.isOnline, handleSelectVehicle]);

  const startMatch = useCallback(
    (overrideConfig?: MatchConfig) => {
      const engine = engineRef.current;
      if (!engine || !engineReady) return;
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      recordedMatchKeyRef.current = null;
      setOnlineStandings(null);
      const cfg = overrideConfig ?? matchConfig;
      setMatchConfig(cfg);
      setScreen('gameplay');
      engine.startMatch(cfg);
    },
    [engineReady, matchConfig],
  );

  const navigateScreen = useCallback((next: ScreenId) => {
    setScreen(next);
    const engine = engineRef.current;
    if (!engine) return;
    if (next === 'garage') {
      engine.setCameraMode('garage');
    } else if (next !== 'gameplay') {
      engine.setCameraMode('menu');
    }
  }, []);

  const exitToMenu = useCallback(() => {
    const engine = engineRef.current;
    if (engine) {
      engine.exitOnlineMatch();
      engine.setPhase('title');
      engine.setCameraMode('menu');
    }
    if (mpClient.room) {
      mpClient.leaveRoom();
    }
    setOnlineStandings(null);
    setScreen('menu');
  }, [mpClient]);

  const handlePlayAgain = useCallback(() => {
    if (hud.isOnline) {
      const engine = engineRef.current;
      if (engine) {
        engine.exitOnlineMatch();
        engine.setPhase('title');
        engine.setCameraMode('menu');
      }
      if (mpClient.room) {
        mpClient.leaveRoom();
      }
      setOnlineStandings(null);
      setScreen('multiplayer');
      return;
    }
    startMatch(matchConfig);
  }, [hud.isOnline, matchConfig, mpClient, startMatch]);

  const handleCustomizationChange = useCallback(
    (next: CarCustomization) => {
      setCustomization(next);
      engineRef.current?.setCustomization(next);
      if (mpRoom) {
        mpClient.updateLoadout(next);
      }
    },
    [mpClient, mpRoom],
  );

  const handleSettingsChange = useCallback((next: GameSettings) => {
    setSettings(next);
    engineRef.current?.setSettings(next);
  }, []);

  const handleTouchAction = useCallback(
    (action: TouchActionKey, pressed: boolean) => {
      engineRef.current?.setTouchButton(action, pressed);
    },
    [],
  );

  const handleWarpDistrict = useCallback((district: DistrictId) => {
    engineRef.current?.teleportToDistrict(district);
  }, []);

  const playMenuClick = useCallback(() => {
    engineRef.current?.audio.playMenuClick();
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-slate-950">
      <div
        ref={mountRef}
        data-testid="game-canvas-container"
        className="fixed inset-0 h-full w-full"
      />

      {!engineReady && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/95">
          <div className="text-center">
            <div className="text-2xl font-black tracking-widest text-orange-400 uppercase">
              DRIFT ARENA
            </div>
            <div className="mt-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">
              Loading NEON HARBOR 600m Open World...
            </div>
          </div>
        </div>
      )}

      {engineReady && screen === 'menu' && (
        <MainMenu
          bestScore={hud.bestScore}
          user={user}
          profile={profile}
          authBusy={authBusy}
          onSignIn={() => void handleSignIn()}
          onSignOut={() => void handleSignOut()}
          onMenuClick={playMenuClick}
          onQuickPlay={() => startMatch(matchConfig)}
          onNavigate={(next) => {
            playMenuClick();
            navigateScreen(next);
          }}
        />
      )}

      {engineReady && screen === 'singleplayer' && (
        <SinglePlayerScreen
          config={matchConfig}
          customization={customization}
          onChange={setMatchConfig}
          onSelectVehicle={handleSelectVehicle}
          onLaunch={() => startMatch(matchConfig)}
          onBack={() => navigateScreen('menu')}
        />
      )}

      {engineReady && screen === 'multiplayer' && (
        <MultiplayerScreen
          client={mpClient}
          connected={mpConnected}
          reconnecting={mpReconnecting}
          playerId={mpPlayerId}
          verifiedUid={mpVerifiedUid}
          room={mpRoom}
          driverName={driverName}
          customization={customization}
          errorMsg={mpError}
          onDriverNameChange={setDriverName}
          onStartLocalSkirmish={() =>
            startMatch({
              mode: 'survival',
              rivalCount: 5,
              durationSeconds: 420,
              spawnIndex: 0,
              difficulty: 'normal',
            })
          }
          onBack={() => navigateScreen('menu')}
        />
      )}

      {engineReady && screen === 'garage' && (
        <GarageScreen
          customization={customization}
          onChange={handleCustomizationChange}
          onDriveNow={() => startMatch(matchConfig)}
          onBack={() => navigateScreen('menu')}
        />
      )}

      {engineReady && screen === 'settings' && (
        <SettingsScreen
          settings={settings}
          onChange={handleSettingsChange}
          onBack={() => navigateScreen('menu')}
        />
      )}

      {engineReady && screen === 'gameplay' && (
        <GameHUD
          hud={hud}
          obstacles={obstacles}
          touchMode={settings.touchControlsMode}
          muted={settings.muted}
          onToggleMute={() =>
            handleSettingsChange({ ...settings, muted: !settings.muted })
          }
          onPause={() => engineRef.current?.setPhase('paused')}
          onRestart={() => startMatch(matchConfig)}
          onRecover={() => engineRef.current?.recoverPlayer()}
          onWeaponClick={() => engineRef.current?.triggerWeaponFromHud()}
          onAbilityClick={() => engineRef.current?.triggerAbilityFromHud()}
          onTouchAction={handleTouchAction}
          onSelectVehicle={handleSelectVehicle}
          onWarpDistrict={handleWarpDistrict}
          onCycleSpectator={(dir) => engineRef.current?.cycleSpectator(dir)}
          onExitSpectator={() => engineRef.current?.finishSpectator()}
          onGrantPickup={(kind) => engineRef.current?.givePlayerPickup(kind)}
        />
      )}

      {engineReady && screen === 'gameplay' && phase === 'paused' && (
        <PauseModal
          activeVehicle={hud.vehicleId}
          activeDistrict={hud.currentDistrict}
          isOnline={hud.isOnline}
          onResume={() => engineRef.current?.setPhase('playing')}
          onRecover={() => engineRef.current?.recoverPlayer()}
          onRestart={() => startMatch(matchConfig)}
          onExitToMenu={exitToMenu}
          onSelectVehicle={handleSelectVehicle}
          onWarpDistrict={handleWarpDistrict}
        />
      )}

      {engineReady && screen === 'gameplay' && phase === 'gameover' && (
        <GameOverModal
          snapshot={hud}
          standings={hud.isOnline ? onlineStandings : null}
          onPlayAgain={handlePlayAgain}
          onExitToMenu={exitToMenu}
        />
      )}
    </main>
  );
}
