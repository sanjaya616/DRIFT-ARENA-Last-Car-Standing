import type { DistrictId, HudSnapshot, VehicleId } from '../../types/game';
import type { MatchStanding } from '../../multiplayer/protocol';
import { VEHICLE_CONFIGS, VEHICLE_ORDER } from '../../cars/vehicleConfigs';
import { DISTRICT_LABELS } from '../../maps/neonHarborLayout';

interface PauseModalProps {
  activeVehicle: VehicleId;
  activeDistrict: DistrictId;
  isOnline?: boolean;
  onResume: () => void;
  onRecover: () => void;
  onRestart: () => void;
  onExitToMenu: () => void;
  onSelectVehicle: (vehicleId: VehicleId) => void;
  onWarpDistrict: (district: DistrictId) => void;
}

export function PauseModal({
  activeVehicle,
  activeDistrict,
  isOnline,
  onResume,
  onRecover,
  onRestart,
  onExitToMenu,
  onSelectVehicle,
  onWarpDistrict,
}: PauseModalProps) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-slate-950/75">
      <div className="w-full max-w-md rounded-xl border border-slate-600/70 bg-slate-950/96 p-5 text-center shadow-2xl">
        <h2 className="text-2xl font-black tracking-wider text-white uppercase">
          {isOnline ? 'Online Match Options' : 'Match Paused'}
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          {isOnline
            ? 'Server simulation stays live during online matches.'
            : 'Esc / P to resume · R to recover · Keys 1–6 to hot-swap cars'}
        </p>

        {!isOnline && (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/80 p-3 text-left">
            <div className="mb-1.5 text-[10px] font-black tracking-widest text-amber-300 uppercase">
              Dev Car Test Switcher
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {VEHICLE_ORDER.map((id) => {
                const spec = VEHICLE_CONFIGS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onSelectVehicle(id)}
                    className={`rounded border px-2 py-1 text-left text-[10px] font-bold uppercase ${
                      activeVehicle === id
                        ? 'border-orange-400 bg-orange-500/25 text-white'
                        : 'border-slate-700 bg-slate-950 text-slate-300'
                    }`}
                  >
                    <div>{spec.name}</div>
                    <div className="text-[9px] text-sky-300">{spec.maxSpeedKmh} km/h</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-2.5 mb-1 text-[10px] font-black tracking-widest text-sky-300 uppercase">
              Warp to District
            </div>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(DISTRICT_LABELS) as DistrictId[]).map((dist) => (
                <button
                  key={dist}
                  type="button"
                  onClick={() => {
                    onWarpDistrict(dist);
                    onResume();
                  }}
                  className={`rounded border px-2 py-1 text-[10px] font-bold uppercase ${
                    activeDistrict === dist
                      ? 'border-sky-400 bg-sky-500/20 text-white'
                      : 'border-slate-700 bg-slate-950 text-slate-300'
                  }`}
                >
                  {DISTRICT_LABELS[dist]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onResume}
            className="w-full rounded-lg bg-orange-500 py-2.5 text-sm font-black tracking-wider text-slate-950 uppercase hover:bg-orange-400"
          >
            Resume Driving
          </button>
          <div className={isOnline ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-3 gap-2'}>
            {!isOnline && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onRecover();
                    onResume();
                  }}
                  className="rounded-lg border border-emerald-500/60 bg-emerald-950/50 py-2 text-xs font-bold text-emerald-200 uppercase hover:border-emerald-400"
                >
                  Recover
                </button>
                <button
                  type="button"
                  onClick={onRestart}
                  className="rounded-lg border border-slate-600 bg-slate-900 py-2 text-xs font-bold text-slate-100 uppercase hover:border-slate-400"
                >
                  Restart
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onExitToMenu}
              className="rounded-lg border border-rose-500/50 bg-slate-900/90 py-2 text-xs font-bold text-rose-200 uppercase hover:border-rose-400 hover:text-white"
            >
              {isOnline ? 'Leave Online Match' : 'Menu'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface GameOverModalProps {
  snapshot: HudSnapshot;
  standings?: MatchStanding[] | null;
  onPlayAgain: () => void;
  onExitToMenu: () => void;
}

export function GameOverModal({
  snapshot,
  standings,
  onPlayAgain,
  onExitToMenu,
}: GameOverModalProps) {
  const isVictory = snapshot.outcome === 'victory';
  const title = isVictory
    ? 'Last Car Standing!'
    : snapshot.outcome === 'wrecked'
      ? 'Car Wrecked'
      : 'Time Expired';

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4 bg-slate-950/75">
      <div className="w-full max-w-lg rounded-xl border border-slate-600/70 bg-slate-950/96 p-6 text-center shadow-2xl">
        <h2
          className={`text-2xl font-black tracking-wider uppercase ${
            isVictory ? 'text-emerald-400' : 'text-orange-400'
          }`}
        >
          {title}
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          {isVictory
            ? 'All rival cars eliminated in NEON HARBOR.'
            : snapshot.outcome === 'wrecked'
              ? 'Hull integrity reached zero.'
              : 'Arena match clock reached 0:00.'}
        </p>

        {snapshot.winner && (
          <div className="mt-4 rounded-lg border border-emerald-400/60 bg-emerald-950/50 px-3.5 py-2.5 text-left">
            <div className="text-[10px] font-black tracking-widest text-emerald-300 uppercase">
              {snapshot.isOnline ? 'Server Authoritative Winner' : 'Match Winner'}
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-2">
              <span className="text-sm font-black text-white uppercase">
                {snapshot.winner.name} · {snapshot.winner.vehicleName}
              </span>
              <span className="tabular-nums text-xs font-bold text-emerald-300">
                {snapshot.winner.hpRemaining} HP
              </span>
            </div>
          </div>
        )}

        {standings && standings.length > 0 && (
          <div className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/90 p-2 text-left">
            <div className="mb-1 text-[10px] font-black tracking-widest text-sky-300 uppercase">
              Final Match Standings
            </div>
            <table className="w-full text-[11px]">
              <tbody className="divide-y divide-slate-800">
                {standings.map((st) => (
                  <tr key={st.id} className="text-slate-200">
                    <td className="py-1 font-black text-amber-300 tabular-nums">#{st.placement}</td>
                    <td className="py-1 font-bold">{st.name}</td>
                    <td className="py-1 text-slate-400">{st.vehicleName}</td>
                    <td className="py-1 text-right tabular-nums text-rose-300">{st.eliminations} KO</td>
                    <td className="py-1 text-right font-black tabular-nums text-white">{st.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase">Score</div>
            <div className="tabular-nums mt-1 text-lg font-black text-amber-300">
              {snapshot.score}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase">KOs</div>
            <div className="tabular-nums mt-1 text-lg font-black text-rose-300">
              {snapshot.eliminations}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase">Drift Pts</div>
            <div className="tabular-nums mt-1 text-lg font-black text-orange-300">
              {snapshot.driftScore}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-2.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase">Best</div>
            <div className="tabular-nums mt-1 text-lg font-black text-white">
              {snapshot.bestScore}
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            data-start="true"
            onClick={onPlayAgain}
            className="flex-1 rounded-lg bg-orange-500 py-3 text-sm font-black tracking-wider text-slate-950 uppercase hover:bg-orange-400"
          >
            {snapshot.isOnline ? 'Back to Lobby' : 'Play Again'}
          </button>
          <button
            type="button"
            onClick={onExitToMenu}
            className="rounded-lg border border-slate-600 bg-slate-900 px-5 py-3 text-sm font-bold text-slate-200 uppercase hover:border-slate-400"
          >
            Menu
          </button>
        </div>
      </div>
    </div>
  );
}
