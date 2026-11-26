import type { CarCustomization, MatchConfig, VehicleId } from '../../types/game';
import { VEHICLE_CONFIGS, VEHICLE_ORDER } from '../../cars/vehicleConfigs';
import { PLAYER_SPAWN_POINTS } from '../../maps/neonHarborLayout';

interface SinglePlayerScreenProps {
  config: MatchConfig;
  customization: CarCustomization;
  onChange: (next: MatchConfig) => void;
  onSelectVehicle: (vehicleId: VehicleId) => void;
  onLaunch: () => void;
  onBack: () => void;
}

export function SinglePlayerScreen({
  config,
  customization,
  onChange,
  onSelectVehicle,
  onLaunch,
  onBack,
}: SinglePlayerScreenProps) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center p-4 bg-slate-950/60 overflow-y-auto">
      <div className="w-full max-w-xl rounded-xl border border-slate-600/60 bg-slate-950/95 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h1 className="text-xl font-black tracking-wide text-white uppercase">
              Single Player Setup
            </h1>
            <p className="text-xs text-slate-400">
              NEON HARBOR · 600m × 600m 5-District Open Arena
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500"
          >
            Back
          </button>
        </div>

        <div className="flex flex-col gap-3.5">
          {/* Vehicle Selector */}
          <div>
            <div className="mb-1.5 text-xs font-bold tracking-wider text-slate-400 uppercase">
              Vehicle
            </div>
            <div className="grid grid-cols-3 gap-2">
              {VEHICLE_ORDER.map((id) => {
                const spec = VEHICLE_CONFIGS[id];
                const active = customization.vehicleId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onSelectVehicle(id)}
                    className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      active
                        ? 'border-orange-400 bg-orange-500/20 text-white'
                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    <div className="text-xs font-black uppercase">{spec.name}</div>
                    <div className="text-[10px] text-sky-300">
                      {spec.maxSpeedKmh} km/h · {spec.category}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Starting District / Spawn Position */}
          <div>
            <div className="mb-1.5 text-xs font-bold tracking-wider text-slate-400 uppercase">
              Starting Zone (8 Spaced Spawns)
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => onChange({ ...config, spawnIndex: -1 })}
                className={`rounded-md border px-2 py-1.5 text-left text-[11px] font-bold uppercase ${
                  config.spawnIndex === -1
                    ? 'border-sky-400 bg-sky-500/20 text-white'
                    : 'border-slate-700 bg-slate-900 text-slate-300'
                }`}
              >
                Random Spawn
              </button>
              {PLAYER_SPAWN_POINTS.map((sp) => (
                <button
                  key={sp.id}
                  type="button"
                  onClick={() => onChange({ ...config, spawnIndex: sp.id })}
                  className={`rounded-md border px-2 py-1.5 text-left text-[11px] font-bold truncate ${
                    config.spawnIndex === sp.id
                      ? 'border-sky-400 bg-sky-500/20 text-white'
                      : 'border-slate-700 bg-slate-900 text-slate-300'
                  }`}
                >
                  {sp.label}
                </button>
              ))}
            </div>
          </div>

          {/* Mode */}
          <div>
            <div className="mb-1.5 text-xs font-bold tracking-wider text-slate-400 uppercase">
              Mode
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...config,
                    mode: 'survival',
                    rivalCount: config.rivalCount || 5,
                    durationSeconds: config.durationSeconds < 180 ? 420 : config.durationSeconds,
                  })
                }
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  config.mode === 'survival'
                    ? 'border-orange-400 bg-orange-500/15 text-white'
                    : 'border-slate-700 bg-slate-900 text-slate-300'
                }`}
              >
                <div className="text-sm font-black uppercase">
                  Survival Derby (1v{config.rivalCount || 5})
                </div>
                <div className="text-[11px] text-slate-400">
                  Last car standing · Shrinking Safe Zone
                </div>
              </button>

              <button
                type="button"
                onClick={() =>
                  onChange({ ...config, mode: 'freedrive', rivalCount: 0 })
                }
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  config.mode === 'freedrive'
                    ? 'border-sky-400 bg-sky-500/15 text-white'
                    : 'border-slate-700 bg-slate-900 text-slate-300'
                }`}
              >
                <div className="text-sm font-black uppercase">Free Drive Test</div>
                <div className="text-[11px] text-slate-400">
                  Solo handling, stunts &amp; drift testing
                </div>
              </button>
            </div>
          </div>

          {/* Rival Count + Difficulty + Countdown */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {config.mode === 'survival' && (
              <div>
                <div className="mb-1 text-xs font-bold tracking-wider text-slate-400 uppercase">
                  AI Rivals ({config.rivalCount + 1} Cars)
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[1, 3, 5].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => onChange({ ...config, rivalCount: count })}
                      className={`rounded-lg border py-1.5 text-xs font-black tabular-nums ${
                        config.rivalCount === count
                          ? 'border-orange-400 bg-orange-500/20 text-white'
                          : 'border-slate-700 bg-slate-900 text-slate-300'
                      }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {config.mode === 'survival' && (
              <div>
                <div className="mb-1 text-xs font-bold tracking-wider text-slate-400 uppercase">
                  AI Difficulty
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['easy', 'normal', 'hard'] as const).map((diff) => (
                    <button
                      key={diff}
                      type="button"
                      onClick={() => onChange({ ...config, difficulty: diff })}
                      className={`rounded-lg border py-1.5 text-[11px] font-black uppercase ${
                        config.difficulty === diff
                          ? 'border-emerald-400 bg-emerald-500/20 text-white'
                          : 'border-slate-700 bg-slate-900 text-slate-300'
                      }`}
                    >
                      {diff}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className={config.mode === 'freedrive' ? 'sm:col-span-3' : ''}>
              <div className="mb-1 text-xs font-bold tracking-wider text-slate-400 uppercase">
                Survival Clock
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[180, 300, 420].map((secs) => (
                  <button
                    key={secs}
                    type="button"
                    onClick={() => onChange({ ...config, durationSeconds: secs })}
                    className={`rounded-lg border py-1.5 text-xs font-black tabular-nums ${
                      config.durationSeconds === secs
                        ? 'border-sky-400 bg-sky-500/20 text-white'
                        : 'border-slate-700 bg-slate-900 text-slate-300'
                    }`}
                  >
                    {secs / 60} MIN
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            data-start="true"
            onClick={onLaunch}
            className="mt-1 w-full rounded-lg bg-orange-500 py-3 text-base font-black tracking-wider text-slate-950 uppercase hover:bg-orange-400"
          >
            Enter NEON HARBOR
          </button>
        </div>
      </div>
    </div>
  );
}
