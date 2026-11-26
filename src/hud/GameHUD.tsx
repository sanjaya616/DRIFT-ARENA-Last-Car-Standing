import { useEffect, useState } from 'react';
import type {
  AbilityKind,
  DistrictId,
  HudSnapshot,
  MinimapObstacle,
  PickupKind,
  TouchControlsMode,
  VehicleId,
  WeaponKind,
} from '../types/game';
import { VEHICLE_CONFIGS, VEHICLE_ORDER } from '../cars/vehicleConfigs';
import { DISTRICT_LABELS } from '../maps/neonHarborLayout';
import { ABILITY_SPECS, PICKUP_WEIGHTS, WEAPON_SPECS, isWeaponPickup } from '../combat/combatRules';
import type { TouchActionKey } from '../controls/InputManager';
import { MiniMap } from './MiniMap';
import { TouchControls } from './TouchControls';

interface GameHUDProps {
  hud: HudSnapshot;
  obstacles: MinimapObstacle[];
  touchMode: TouchControlsMode;
  muted: boolean;
  onToggleMute: () => void;
  onPause: () => void;
  onRestart: () => void;
  onRecover: () => void;
  onWeaponClick: () => void;
  onAbilityClick: () => void;
  onTouchAction: (action: TouchActionKey, pressed: boolean) => void;
  onSelectVehicle: (vehicleId: VehicleId) => void;
  onWarpDistrict: (district: DistrictId) => void;
  onCycleSpectator: (dir: 1 | -1) => void;
  onExitSpectator: () => void;
  onGrantPickup?: (kind: PickupKind) => void;
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function WeaponIcon({ kind }: { kind?: WeaponKind }) {
  const color = kind ? WEAPON_SPECS[kind].color : '#64748b';
  switch (kind) {
    case 'rocket':
      return (
        <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#450a0a" stroke={color} strokeWidth="1.8" />
          <path d="M12 5l4 8H8l4-8z" fill="#fca5a5" />
          <rect x="10.5" y="13" width="3" height="5" fill={color} />
        </svg>
      );
    case 'punch':
      return (
        <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#431407" stroke={color} strokeWidth="1.8" />
          <rect x="7" y="9" width="10" height="7" rx="2" fill="#fdba74" />
          <path d="M7 9V7h10v2" stroke={color} strokeWidth="2" fill="none" />
        </svg>
      );
    case 'bomb':
      return (
        <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#422006" stroke={color} strokeWidth="1.8" />
          <circle cx="11.5" cy="13.5" r="4.5" fill="#fef08a" />
          <path d="M14 9l3-3" stroke={color} strokeWidth="2" />
        </svg>
      );
    case 'spike_trap':
      return (
        <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#3b0764" stroke={color} strokeWidth="1.8" />
          <polygon points="7,16 9,8 11,16" fill="#e9d5ff" />
          <polygon points="11,16 13,7 15,16" fill="#e9d5ff" />
          <polygon points="14,16 16,9 18,16" fill="#e9d5ff" />
        </svg>
      );
    case 'proximity_mine':
      return (
        <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#500724" stroke={color} strokeWidth="1.8" />
          <circle cx="12" cy="13" r="4.2" fill="#fbcfe8" />
          <circle cx="12" cy="13" r="1.8" fill={color} />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" fill="#0f172a" stroke="#475569" strokeWidth="1.6" strokeDasharray="3 2" />
          <path d="M9 12h6" stroke="#64748b" strokeWidth="2" />
        </svg>
      );
  }
}

function AbilityIcon({ kind }: { kind?: AbilityKind }) {
  const color = kind ? ABILITY_SPECS[kind].color : '#64748b';
  switch (kind) {
    case 'shield':
      return (
        <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0" aria-hidden="true">
          <path d="M12 2L5 5v6.5c0 4.6 3 8.8 7 10 4-1.2 7-5.4 7-10V5l-7-3z" fill="#082f49" stroke={color} strokeWidth="1.8" />
          <path d="M12 7v9M8.5 11.5h7" stroke="#bae6fd" strokeWidth="2" />
        </svg>
      );
    case 'armor':
      return (
        <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0" aria-hidden="true">
          <polygon points="12,3 20,8 18,18 12,21 6,18 4,8" fill="#1e293b" stroke={color} strokeWidth="1.8" />
          <rect x="9" y="9" width="6" height="6" fill="#e2e8f0" />
        </svg>
      );
    case 'nitro':
      return (
        <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#083344" stroke={color} strokeWidth="1.8" />
          <polygon points="13,5 8,13 12,13 11,19 16,11 12,11" fill="#67e8f9" />
        </svg>
      );
    case 'super_jump':
    case 'triple_jump':
      return (
        <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#052e16" stroke={color} strokeWidth="1.8" />
          <path d="M12 17V7M7.5 11.5L12 7l4.5 4.5" stroke="#bbf7d0" strokeWidth="2.2" fill="none" />
        </svg>
      );
    case 'lightning_dash':
      return (
        <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#422006" stroke={color} strokeWidth="1.8" />
          <path d="M6 12h9M12 8l5 4-5 4" stroke="#fef08a" strokeWidth="2.2" fill="none" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" fill="#0f172a" stroke="#475569" strokeWidth="1.6" strokeDasharray="3 2" />
          <circle cx="12" cy="12" r="2.5" fill="#64748b" />
        </svg>
      );
  }
}

export function GameHUD({
  hud,
  obstacles,
  touchMode,
  muted,
  onToggleMute,
  onPause,
  onRestart,
  onRecover,
  onWeaponClick,
  onAbilityClick,
  onTouchAction,
  onSelectVehicle,
  onWarpDistrict,
  onCycleSpectator,
  onExitSpectator,
  onGrantPickup,
}: GameHUDProps) {
  const [ghostHp, setGhostHp] = useState(hud.hp);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [devOpen, setDevOpen] = useState(false);

  useEffect(() => {
    const checkTouch = () => {
      const coarse = window.matchMedia?.('(pointer: coarse)').matches;
      const smallScreen = window.innerWidth <= 960;
      setIsTouchDevice(Boolean(coarse || smallScreen));
    };
    checkTouch();
    window.addEventListener('resize', checkTouch);
    return () => window.removeEventListener('resize', checkTouch);
  }, []);

  useEffect(() => {
    if (hud.hp >= ghostHp) {
      setGhostHp(hud.hp);
      return;
    }
    const timer = window.setTimeout(() => {
      setGhostHp(hud.hp);
    }, 380);
    return () => window.clearTimeout(timer);
  }, [hud.hp, ghostHp]);

  const showTouch =
    touchMode === 'always' || (touchMode === 'auto' && isTouchDevice);

  const hpPct = Math.max(0, Math.min(100, (hud.hp / hud.maxHp) * 100));
  const ghostPct = Math.max(hpPct, Math.min(100, (ghostHp / hud.maxHp) * 100));
  const hpColor =
    hpPct > 55 ? 'bg-emerald-400' : hpPct > 28 ? 'bg-amber-400' : 'bg-rose-500';

  const nearHarborBridge =
    hud.currentDistrict === 'harbor' ||
    Math.hypot(hud.playerX - 165, hud.playerZ) < 105;
  const nearRailway =
    hud.currentDistrict === 'railway' ||
    (Math.abs(hud.playerX - 195) < 95 && hud.playerZ > 55);

  let hazardBanner: { text: string; tone: string } | null = null;
  if (hud.safeZone.outsideWarning) {
    hazardBanner = {
      text: `OUTSIDE SAFE ZONE — RETURN TO ARENA (-${hud.safeZone.damagePerTick} HP/${hud.safeZone.tickIntervalSec}s)`,
      tone: 'border-rose-400 bg-rose-950/92 text-rose-100',
    };
  } else if (hud.safeZone.warningText) {
    hazardBanner = {
      text: hud.safeZone.warningText,
      tone: hud.safeZone.isSuddenDeath
        ? 'border-rose-400 bg-rose-950/92 text-rose-100'
        : 'border-amber-400 bg-amber-950/92 text-amber-100',
    };
  } else if (
    nearRailway &&
    (hud.trainPhase === 'warning' || hud.trainPhase === 'closing' || hud.trainPhase === 'passing')
  ) {
    hazardBanner = {
      text:
        hud.trainPhase === 'warning'
          ? 'RAILWAY WARNING — FREIGHT TRAIN APPROACHING'
          : 'TRAIN CROSSING CLOSED — CLEAR THE TRACKS',
      tone: 'border-rose-400 bg-rose-950/90 text-rose-100',
    };
  } else if (nearHarborBridge && hud.drawbridgePhase !== 'closed') {
    hazardBanner = {
      text:
        hud.drawbridgePhase === 'warning'
          ? 'DRAWBRIDGE WARNING — CLOSING SOON'
          : 'DRAWBRIDGE OPEN — USE SOUTH STUNT RAMP',
      tone: 'border-amber-400 bg-amber-950/90 text-amber-100',
    };
  }

  const boostPct = Math.min(100, (hud.driftBoostRemaining / 3.0) * 100);

  const activeBuffs: Array<{ label: string; tone: string }> = [];
  if (hud.spawnProtectionRemaining > 0) {
    activeBuffs.push({
      label: `SPAWN SHIELD ${hud.spawnProtectionRemaining.toFixed(1)}s`,
      tone: 'border-sky-400/70 bg-sky-950/90 text-sky-200',
    });
  }
  if (hud.abilityActiveRemaining > 0 && hud.equippedAbility?.kind === 'shield') {
    activeBuffs.push({
      label: `SHIELD ${hud.abilityActiveRemaining.toFixed(1)}s`,
      tone: 'border-cyan-400/80 bg-cyan-950/90 text-cyan-200',
    });
  }
  if (hud.activeArmorRemaining > 0) {
    activeBuffs.push({
      label: `ARMOR -50% ${hud.activeArmorRemaining.toFixed(1)}s`,
      tone: 'border-slate-300/70 bg-slate-800/90 text-slate-100',
    });
  }
  if (hud.activeNitroBoostRemaining > 0) {
    activeBuffs.push({
      label: `NITRO +50% ${hud.activeNitroBoostRemaining.toFixed(1)}s`,
      tone: 'border-cyan-400/80 bg-cyan-950/90 text-cyan-200',
    });
  }
  if (hud.activeDashRemaining > 0) {
    activeBuffs.push({
      label: `DASH ${hud.activeDashRemaining.toFixed(1)}s`,
      tone: 'border-yellow-400/80 bg-yellow-950/90 text-yellow-200',
    });
  }
  if (hud.activeSlowRemaining > 0) {
    activeBuffs.push({
      label: `SPIKED · SLOWED ${hud.activeSlowRemaining.toFixed(1)}s`,
      tone: 'border-purple-400/80 bg-purple-950/90 text-purple-200',
    });
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-2.5 sm:p-4">
      {((hud.hp <= 28 && hud.hp > 0) || hud.safeZone.outsideWarning) && (
        <div
          className="pointer-events-none fixed inset-0"
          style={{
            boxShadow: 'inset 0 0 90px rgba(225, 29, 72, 0.45)',
          }}
        />
      )}

      {/* Online Connection / Reconnect / Player Event Alert Banner */}
      {hud.connectionBanner && (
        <div
          data-testid="hud-connection-banner"
          className="pointer-events-none fixed inset-x-0 top-12 z-30 flex justify-center px-4"
        >
          <div className="rounded-lg border border-sky-400/80 bg-slate-950/94 px-4 py-1.5 text-xs font-black tracking-wider text-sky-100 uppercase shadow-xl">
            {hud.connectionBanner}
          </div>
        </div>
      )}

      {/* 5-Second Match Start Countdown Overlay */}
      {hud.startingCountdown > 0 && (
        <div
          data-testid="hud-start-countdown"
          className="pointer-events-none fixed inset-x-0 top-24 z-30 flex justify-center px-4"
        >
          <div className="rounded-xl border-2 border-orange-400 bg-slate-950/92 px-7 py-3 text-center shadow-2xl">
            <div className="text-[11px] font-black tracking-[0.24em] text-orange-300 uppercase">
              {hud.isOnline ? 'Online Match · Neon Harbor' : 'Get Ready · Neon Harbor'}
            </div>
            <div className="tabular-nums mt-0.5 text-4xl font-black text-white">
              {hud.startingCountdown}
            </div>
            <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
              15s Spawn Shield Active On Launch
            </div>
          </div>
        </div>
      )}

      {/* Spectator Mode Banner */}
      {hud.spectating && (
        <div
          data-testid="hud-spectator-bar"
          className="pointer-events-auto fixed inset-x-0 top-20 z-30 flex justify-center px-4"
        >
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-400/75 bg-slate-950/92 px-4 py-2 shadow-2xl">
            <div className="text-left">
              <div className="text-[10px] font-black tracking-widest text-rose-400 uppercase">
                Eliminated · Spectating Survivor
              </div>
              <div className="text-xs font-black text-white uppercase">
                {hud.spectatingName ?? 'Rival'} · {hud.spectatingVehicle ?? 'Vehicle'}{' '}
                <span className="tabular-nums text-emerald-300">
                  ({hud.spectatingHp} HP)
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onCycleSpectator(-1)}
                className="rounded-md border border-slate-600 bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-slate-100 hover:border-sky-400"
              >
                ◀ Prev
              </button>
              <button
                type="button"
                onClick={() => onCycleSpectator(1)}
                className="rounded-md border border-slate-600 bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-slate-100 hover:border-sky-400"
              >
                Next ▶
              </button>
              <button
                type="button"
                onClick={onExitSpectator}
                className="rounded-md bg-orange-500 px-2.5 py-1 text-[11px] font-black text-slate-950 uppercase hover:bg-orange-400"
              >
                Finish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOP BAR */}
      <div className="flex items-start justify-between gap-2">
        {/* Top-Left: HP Bar + Timer + Score + Cars + Buffs */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5 rounded-lg border border-slate-500/45 bg-slate-950/88 px-3 py-1.5 shadow-lg">
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
              <path
                d="M12 2L4 5.5v6c0 5 3.4 9.6 8 10.9 4.6-1.3 8-5.9 8-10.9v-6L12 2z"
                fill="#1e293b"
                stroke="#f8fafc"
                strokeWidth="1.8"
              />
              <path
                d="M12 5.2L6.5 7.6v4c0 3.7 2.3 7.1 5.5 8.2 3.2-1.1 5.5-4.5 5.5-8.2v-4L12 5.2z"
                fill={hpPct > 28 ? '#22c55e' : '#ef4444'}
              />
            </svg>

            <div className="w-32 sm:w-44">
              <div className="mb-0.5 flex items-baseline justify-between">
                <span className="text-[9px] font-bold tracking-widest text-slate-400 uppercase">
                  HULL HP
                </span>
                <span
                  data-testid="hud-hp"
                  className="tabular-nums text-base sm:text-lg font-black leading-none text-white"
                >
                  {hud.hp}
                  <span className="text-[11px] font-semibold text-slate-400">/{hud.maxHp}</span>
                </span>
              </div>
              <div className="relative h-2 w-full overflow-hidden rounded-sm bg-slate-800">
                <div
                  className="absolute inset-y-0 left-0 bg-rose-300/75 transition-all duration-300"
                  style={{ width: `${ghostPct}%` }}
                />
                <div
                  className={`relative h-full transition-all duration-100 ${hpColor}`}
                  style={{ width: `${hpPct}%` }}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="rounded-lg border border-slate-500/45 bg-slate-950/88 px-2.5 py-1 shadow-md">
              <div className="text-[8px] font-bold tracking-widest text-slate-400 uppercase">
                {hud.safeZone.isSuddenDeath ? 'SUDDEN DEATH' : 'TIME'}
              </div>
              <div
                data-testid="hud-timer"
                className={`tabular-nums text-sm sm:text-base font-black leading-tight ${
                  hud.safeZone.isSuddenDeath || hud.countdownSeconds <= 15
                    ? 'text-rose-400'
                    : 'text-white'
                }`}
              >
                {hud.safeZone.isSuddenDeath ? 'LIVE' : formatClock(hud.countdownSeconds)}
              </div>
            </div>

            <div className="rounded-lg border border-slate-500/45 bg-slate-950/88 px-2.5 py-1 shadow-md">
              <div className="text-[8px] font-bold tracking-widest text-slate-400 uppercase">
                SCORE
              </div>
              <div
                data-testid="hud-score"
                className="tabular-nums text-sm sm:text-base font-black leading-tight text-amber-300"
              >
                {hud.score}
              </div>
            </div>

            {hud.rivalsTotal > 0 && (
              <div className="rounded-lg border border-slate-500/45 bg-slate-950/88 px-2.5 py-1 shadow-md">
                <div className="text-[8px] font-bold tracking-widest text-slate-400 uppercase">
                  ALIVE · KO
                </div>
                <div
                  data-testid="hud-alive"
                  className="tabular-nums text-sm sm:text-base font-black leading-tight text-sky-300"
                >
                  {hud.rivalsAlive + (hud.hp > 0 ? 1 : 0)}/{hud.rivalsTotal + 1}
                  <span className="ml-1.5 text-xs text-orange-300">· {hud.eliminations}</span>
                </div>
              </div>
            )}
          </div>

          {/* Active District, Vehicle & Safe Zone Phase */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-600/45 bg-slate-950/85 px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase shadow">
            <span data-testid="hud-district" className="text-sky-300">
              {DISTRICT_LABELS[hud.currentDistrict]}
            </span>
            <span className="text-slate-500">·</span>
            <span data-testid="hud-vehicle" className="text-amber-300">
              {hud.vehicleName}
            </span>
            <span className="text-slate-500">·</span>
            <span
              data-testid="hud-safezone"
              className={hud.safeZone.phaseIndex >= 5 ? 'text-rose-300' : 'text-emerald-300'}
            >
              {hud.safeZone.phaseLabel} ({hud.safeZone.areaPercent}%)
            </span>
          </div>

          {hud.isOnline && (
            <div
              data-testid="hud-online-badge"
              className="w-fit rounded-md border border-sky-400/60 bg-slate-950/90 px-2.5 py-0.5 text-[10px] font-black tracking-wider text-sky-200 uppercase shadow"
            >
              ONLINE · ROOM {hud.roomCode ?? '----'} · {hud.pingMs ?? 0}ms
            </div>
          )}

          {/* Active Buff & Debuff Status Chips */}
          {activeBuffs.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {activeBuffs.map((b) => (
                <span
                  key={b.label}
                  className={`rounded border px-2 py-0.5 text-[10px] font-black tracking-wider uppercase shadow ${b.tone}`}
                >
                  {b.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Top-Center Live Hazard / Safe Zone Alert */}
        {hazardBanner && (
          <div
            data-testid="hud-hazard-banner"
            className={`hidden sm:block rounded-lg border px-4 py-1.5 text-xs font-black tracking-wider uppercase shadow-lg ${hazardBanner.tone}`}
          >
            {hazardBanner.text}
          </div>
        )}

        {/* Top-Right: Utility Buttons + Dev Toggle + Live 600m Mini-Map */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-start gap-2">
            <div className="flex items-center gap-1.5">
              {!hud.isOnline && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Dev Vehicle & District Tools"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setDevOpen((prev) => !prev);
                  }}
                  className={`pointer-events-auto flex h-9 items-center justify-center rounded-lg border px-2 text-[10px] font-black tracking-wider uppercase ${
                    devOpen
                      ? 'border-amber-400 bg-amber-950/90 text-amber-200'
                      : 'border-slate-500/50 bg-slate-950/85 text-slate-200 hover:border-slate-300'
                  }`}
                >
                  DEV
                </button>
              )}

              <button
                type="button"
                tabIndex={-1}
                aria-label="Recover to Road [R]"
                title="Recover to Road (R)"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onRecover();
                }}
                className="pointer-events-auto flex h-9 items-center justify-center rounded-lg border border-slate-500/50 bg-slate-950/85 px-2 text-[10px] font-black tracking-wider text-emerald-300 uppercase hover:border-emerald-400"
              >
                REC
              </button>

              <button
                type="button"
                tabIndex={-1}
                aria-label={muted ? 'Unmute Audio' : 'Mute Audio'}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onToggleMute();
                }}
                className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-lg border border-slate-500/50 bg-slate-950/85 text-slate-200 hover:border-slate-300 hover:text-white"
              >
                {muted ? (
                  <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 5L6 9H2v6h4l5 4V5z" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 5L6 9H2v6h4l5 4V5z" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                )}
              </button>

              {!hud.isOnline && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Restart Match"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onRestart();
                  }}
                  className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-lg border border-slate-500/50 bg-slate-950/85 text-slate-200 hover:border-slate-300 hover:text-white"
                >
                  <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                </button>
              )}

              <button
                type="button"
                tabIndex={-1}
                aria-label="Pause Game"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onPause();
                }}
                className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-lg border border-slate-500/50 bg-slate-950/85 text-slate-200 hover:border-slate-300 hover:text-white"
              >
                <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              </button>
            </div>

            <MiniMap
              obstacles={obstacles}
              actors={hud.actors}
              drawbridgePhase={hud.drawbridgePhase}
              safeZoneRadiusMeters={hud.safeZone.radiusMeters}
            />
          </div>

          {/* Collapsible Dev Testing Drawer */}
          {!hud.isOnline && devOpen && (
            <div className="pointer-events-auto max-h-[68vh] w-80 overflow-y-auto rounded-xl border border-amber-400/55 bg-slate-950/95 p-3 shadow-2xl">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-black tracking-widest text-amber-300 uppercase">
                  Dev Vehicle Switcher [1–6]
                </span>
                <button
                  type="button"
                  onClick={() => setDevOpen(false)}
                  className="text-[10px] font-bold text-slate-400 hover:text-white"
                >
                  CLOSE
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {VEHICLE_ORDER.map((id, idx) => {
                  const spec = VEHICLE_CONFIGS[id];
                  const active = hud.vehicleId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onSelectVehicle(id)}
                      className={`rounded border px-2 py-1 text-left text-[10px] font-bold uppercase ${
                        active
                          ? 'border-orange-400 bg-orange-500/25 text-white'
                          : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      <div className="flex justify-between">
                        <span>{spec.name}</span>
                        <span className="text-slate-400">{idx + 1}</span>
                      </div>
                      <div className="text-[9px] text-sky-300">{spec.maxSpeedKmh} km/h</div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-2.5 mb-1 text-[10px] font-black tracking-widest text-sky-300 uppercase">
                District Warp
              </div>
              <div className="flex flex-wrap gap-1">
                {(Object.keys(DISTRICT_LABELS) as DistrictId[]).map((dist) => (
                  <button
                    key={dist}
                    type="button"
                    onClick={() => onWarpDistrict(dist)}
                    className={`rounded border px-2 py-1 text-[10px] font-bold uppercase ${
                      hud.currentDistrict === dist
                        ? 'border-sky-400 bg-sky-500/20 text-white'
                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {DISTRICT_LABELS[dist]}
                  </button>
                ))}
              </div>

              {onGrantPickup && (
                <>
                  <div className="mt-2.5 mb-1 text-[10px] font-black tracking-widest text-emerald-300 uppercase">
                    Equip Power-Up (Slot Test)
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {PICKUP_WEIGHTS.map(({ kind }) => {
                      const label = isWeaponPickup(kind)
                        ? WEAPON_SPECS[kind].name
                        : ABILITY_SPECS[kind].name;
                      return (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => onGrantPickup(kind)}
                          className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-left text-[10px] font-bold text-slate-200 uppercase hover:border-emerald-400"
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* DESKTOP BOTTOM BAR */}
      {!showTouch && (
        <div className="flex items-end justify-between gap-4">
          {/* Bottom-Left: Independent Slot 1 (Weapon) + Slot 2 (Ability) */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              tabIndex={-1}
              data-testid="slot-weapon"
              aria-label="Use Equipped Weapon [F]"
              onClick={(e) => {
                e.currentTarget.blur();
                onWeaponClick();
              }}
              className={`pointer-events-auto flex min-w-[152px] items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                !hud.equippedWeapon
                  ? 'border-slate-700/70 bg-slate-950/80 text-slate-400'
                  : hud.equippedWeapon.cooldown > 0
                    ? 'border-slate-600/70 bg-slate-950/85 text-slate-300'
                    : 'border-rose-400/80 bg-slate-950/92 text-white hover:border-rose-300'
              }`}
            >
              <WeaponIcon kind={hud.equippedWeapon?.kind} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="truncate text-xs font-black tracking-wide uppercase">
                    {hud.equippedWeapon ? hud.equippedWeapon.name : 'NO WEAPON'}
                  </span>
                  <span className="rounded bg-slate-800 px-1 py-0.5 text-[10px] font-bold text-slate-300">
                    F
                  </span>
                </div>
                <div className="tabular-nums text-[11px] font-semibold text-rose-300">
                  {hud.equippedWeapon
                    ? hud.equippedWeapon.cooldown > 0
                      ? `${hud.equippedWeapon.cooldown.toFixed(1)}s · ${hud.equippedWeapon.usesRemaining}/${hud.equippedWeapon.maxUses}`
                      : `READY · ${hud.equippedWeapon.usesRemaining}/${hud.equippedWeapon.maxUses}`
                    : 'COLLECT PICKUP'}
                </div>
              </div>
            </button>

            <button
              type="button"
              tabIndex={-1}
              data-testid="slot-ability"
              aria-label="Activate Equipped Ability [Q]"
              onClick={(e) => {
                e.currentTarget.blur();
                onAbilityClick();
              }}
              className={`pointer-events-auto flex min-w-[156px] items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                !hud.equippedAbility
                  ? 'border-slate-700/70 bg-slate-950/80 text-slate-400'
                  : hud.equippedAbility.activeRemaining > 0
                    ? 'border-amber-300 bg-amber-950/90 text-amber-100'
                    : hud.equippedAbility.cooldown > 0
                      ? 'border-slate-600/70 bg-slate-950/85 text-slate-300'
                      : 'border-amber-400/80 bg-slate-950/92 text-white hover:border-amber-300'
              }`}
            >
              <AbilityIcon kind={hud.equippedAbility?.kind} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="truncate text-xs font-black tracking-wide uppercase">
                    {hud.equippedAbility ? hud.equippedAbility.name : 'NO ABILITY'}
                  </span>
                  <span className="rounded bg-slate-800 px-1 py-0.5 text-[10px] font-bold text-slate-300">
                    Q
                  </span>
                </div>
                <div className="tabular-nums text-[11px] font-semibold text-amber-300">
                  {hud.equippedAbility
                    ? hud.equippedAbility.activeRemaining > 0
                      ? `ACTIVE ${hud.equippedAbility.activeRemaining.toFixed(1)}s`
                      : hud.equippedAbility.cooldown > 0
                        ? `${hud.equippedAbility.cooldown.toFixed(1)}s · ${hud.equippedAbility.usesRemaining}/${hud.equippedAbility.maxUses}`
                        : `READY · ${hud.equippedAbility.usesRemaining}/${hud.equippedAbility.maxUses}`
                    : 'COLLECT PICKUP'}
                </div>
              </div>
            </button>
          </div>

          {/* Bottom-Center: Drift Meter / Drift Boost */}
          <div className="flex flex-col items-center">
            <div
              className={`rounded-lg border px-4 py-1.5 transition-colors ${
                hud.driftBoostRemaining > 0
                  ? 'border-cyan-400 bg-cyan-950/90'
                  : hud.isDrifting
                    ? 'border-orange-400 bg-slate-950/90'
                    : 'border-slate-600/50 bg-slate-950/85'
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <span
                  className={`text-[10px] font-black tracking-widest uppercase ${
                    hud.driftBoostRemaining > 0 ? 'text-cyan-300' : 'text-orange-300'
                  }`}
                >
                  {hud.driftBoostRemaining > 0
                    ? `DRIFT BOOST ${hud.driftBoostRemaining.toFixed(1)}s`
                    : hud.isDrifting
                      ? 'DRIFTING'
                      : 'DRIFT METER'}
                </span>
                <span className="tabular-nums text-xs font-black text-white">
                  x{hud.driftMultiplier} · {hud.driftScore} PTS
                </span>
              </div>
              <div className="mt-1 h-2 w-48 overflow-hidden rounded-sm bg-slate-800">
                <div
                  className={`h-full transition-all duration-75 ${
                    hud.driftBoostRemaining > 0 ? 'bg-cyan-400' : 'bg-orange-400'
                  }`}
                  style={{
                    width: `${
                      hud.driftBoostRemaining > 0 ? boostPct : hud.driftCharge
                    }%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Bottom-Right: Speedometer (km/h) & Nitro Bar */}
          <div className="flex flex-col items-end rounded-lg border border-slate-500/45 bg-slate-950/88 px-4 py-2.5 shadow-lg">
            <div className="flex items-baseline gap-1.5">
              <span
                data-testid="hud-speed"
                className="tabular-nums text-4xl font-black tracking-tight leading-none text-white"
              >
                {hud.speedKmh}
              </span>
              <span className="text-xs font-bold tracking-wider text-slate-400">
                KM/H
              </span>
            </div>
            <div className="mt-1.5 flex w-36 items-center gap-2">
              <span className="text-[10px] font-black tracking-wider text-cyan-300">
                NOS
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-sm bg-slate-800">
                <div
                  className={`h-full transition-all duration-75 ${
                    hud.nitroActive ? 'bg-cyan-300' : 'bg-cyan-500'
                  }`}
                  style={{ width: `${hud.nitro}%` }}
                />
              </div>
              <span className="tabular-nums text-[10px] font-bold text-slate-300">
                {hud.nitro}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE LANDSCAPE BOTTOM HUD + TOUCH CONTROLS */}
      {showTouch && (
        <>
          <div className="pointer-events-none fixed inset-x-0 bottom-3 z-20 flex items-center justify-center gap-2">
            <div className="rounded-lg border border-slate-500/50 bg-slate-950/85 px-2.5 py-1 shadow-md">
              <span
                data-testid="hud-speed"
                className="tabular-nums text-xl font-black text-white"
              >
                {hud.speedKmh}
              </span>
              <span className="ml-1 text-[10px] font-bold text-slate-400">
                KM/H
              </span>
            </div>
            <div className="rounded-lg border border-orange-400/60 bg-slate-950/85 px-2.5 py-1 shadow-md">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-[10px] font-bold ${
                    hud.driftBoostRemaining > 0 ? 'text-cyan-300' : 'text-orange-300'
                  }`}
                >
                  {hud.driftBoostRemaining > 0
                    ? `BOOST ${hud.driftBoostRemaining.toFixed(1)}s`
                    : `DRIFT x${hud.driftMultiplier}`}
                </span>
              </div>
              <div className="mt-0.5 h-1.5 w-20 overflow-hidden rounded-sm bg-slate-800">
                <div
                  className={`h-full ${
                    hud.driftBoostRemaining > 0 ? 'bg-cyan-400' : 'bg-orange-400'
                  }`}
                  style={{
                    width: `${
                      hud.driftBoostRemaining > 0 ? boostPct : hud.driftCharge
                    }%`,
                  }}
                />
              </div>
            </div>
          </div>
          <TouchControls
            onTouchAction={onTouchAction}
            equippedWeapon={hud.equippedWeapon}
            equippedAbility={hud.equippedAbility}
            nitroPercent={hud.nitro}
          />
        </>
      )}
    </div>
  );
}
