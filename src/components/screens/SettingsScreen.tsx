import type { GameSettings, TouchControlsMode } from '../../types/game';

interface SettingsScreenProps {
  settings: GameSettings;
  onChange: (next: GameSettings) => void;
  onBack: () => void;
}

export function SettingsScreen({
  settings,
  onChange,
  onBack,
}: SettingsScreenProps) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center p-4 bg-slate-950/65">
      <div className="w-full max-w-lg rounded-xl border border-slate-600/60 bg-slate-950/96 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between border-b border-slate-800 pb-3">
          <h1 className="text-xl font-black tracking-wide text-white uppercase">
            Settings
          </h1>
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500"
          >
            Done
          </button>
        </div>

        <div className="flex flex-col gap-4 text-sm">
          {/* Audio Mute & Volume */}
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="vol-slider" className="font-bold text-slate-200">
              Master Volume ({Math.round(settings.masterVolume * 100)}%)
            </label>
            <div className="flex items-center gap-3">
              <input
                id="vol-slider"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.masterVolume}
                onChange={(e) =>
                  onChange({ ...settings, masterVolume: Number(e.target.value) })
                }
                className="w-32 accent-orange-500"
              />
              <button
                type="button"
                onClick={() => onChange({ ...settings, muted: !settings.muted })}
                className={`rounded-md border px-2.5 py-1 text-xs font-bold uppercase ${
                  settings.muted
                    ? 'border-rose-500 bg-rose-500/20 text-rose-200'
                    : 'border-emerald-500 bg-emerald-500/20 text-emerald-200'
                }`}
              >
                {settings.muted ? 'Muted' : 'Sound On'}
              </button>
            </div>
          </div>

          {/* Synth Music Toggle */}
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-200">Arcade Synth Music</span>
            <button
              type="button"
              onClick={() =>
                onChange({ ...settings, musicEnabled: !settings.musicEnabled })
              }
              className={`rounded-lg border px-3.5 py-1.5 text-xs font-black uppercase ${
                settings.musicEnabled
                  ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                  : 'border-slate-700 bg-slate-900 text-slate-400'
              }`}
            >
              {settings.musicEnabled ? 'Music On' : 'Music Off'}
            </button>
          </div>

          {/* Touch Controls Mode */}
          <div>
            <div className="mb-1.5 text-xs font-bold tracking-wider text-slate-400 uppercase">
              Mobile Touch Controls
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['auto', 'always', 'off'] as TouchControlsMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() =>
                    onChange({ ...settings, touchControlsMode: mode })
                  }
                  className={`rounded-lg border py-2 text-xs font-black uppercase ${
                    settings.touchControlsMode === mode
                      ? 'border-sky-400 bg-sky-500/20 text-white'
                      : 'border-slate-700 bg-slate-900 text-slate-300'
                  }`}
                >
                  {mode === 'auto' ? 'Auto' : mode === 'always' ? 'Always Show' : 'Hide'}
                </button>
              ))}
            </div>
          </div>

          {/* Camera Chase Distance */}
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="cam-dist" className="font-bold text-slate-200">
              Camera Distance ({settings.cameraDistance.toFixed(2)}x)
            </label>
            <input
              id="cam-dist"
              type="range"
              min={0.8}
              max={1.3}
              step={0.05}
              value={settings.cameraDistance}
              onChange={(e) =>
                onChange({ ...settings, cameraDistance: Number(e.target.value) })
              }
              className="w-40 accent-sky-400"
            />
          </div>

          {/* Steering Sensitivity */}
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="steer-sens" className="font-bold text-slate-200">
              Steering Sensitivity ({settings.steerSensitivity.toFixed(1)}x)
            </label>
            <input
              id="steer-sens"
              type="range"
              min={0.6}
              max={1.5}
              step={0.1}
              value={settings.steerSensitivity}
              onChange={(e) =>
                onChange({ ...settings, steerSensitivity: Number(e.target.value) })
              }
              className="w-40 accent-sky-400"
            />
          </div>

          {/* Graphics Quality & Target FPS */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={() =>
                onChange({ ...settings, highQuality: !settings.highQuality })
              }
              className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-xs font-black uppercase text-white hover:border-slate-400"
            >
              Quality: {settings.highQuality ? 'High' : 'Fast'}
            </button>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...settings,
                  targetFps: settings.targetFps === 60 ? 30 : 60,
                })
              }
              className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-xs font-black uppercase text-sky-200 hover:border-sky-400"
            >
              Target: {settings.targetFps} FPS
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
