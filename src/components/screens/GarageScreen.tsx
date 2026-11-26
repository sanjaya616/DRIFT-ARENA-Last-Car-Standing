import {
  PAINT_SWATCHES,
  RIM_SWATCHES,
  type CarCustomization,
  type VehicleId,
} from '../../types/game';
import { VEHICLE_CONFIGS, VEHICLE_ORDER } from '../../cars/vehicleConfigs';

interface GarageScreenProps {
  customization: CarCustomization;
  onChange: (next: CarCustomization) => void;
  onDriveNow: () => void;
  onBack: () => void;
}

export function GarageScreen({
  customization,
  onChange,
  onDriveNow,
  onBack,
}: GarageScreenProps) {
  const activeSpec = VEHICLE_CONFIGS[customization.vehicleId];

  const handleSelectVehicle = (vehicleId: VehicleId) => {
    const spec = VEHICLE_CONFIGS[vehicleId];
    onChange({
      vehicleId,
      bodyColor: spec.defaultBodyColor,
      accentColor: spec.defaultAccentColor,
      rimColor: spec.defaultRimColor,
    });
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-4 sm:p-6">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div className="pointer-events-auto rounded-lg border border-slate-600/60 bg-slate-950/90 px-4 py-2 shadow-lg">
          <h1 className="text-lg font-black tracking-wide text-white uppercase">
            Car Garage — {activeSpec.name}
          </h1>
          <p className="text-[11px] text-slate-400">
            4.2m × 1.9m × 1.4m Chassis · {activeSpec.category} · Live 3D Preview
          </p>
        </div>

        <button
          type="button"
          onClick={onBack}
          className="pointer-events-auto rounded-lg border border-slate-500/70 bg-slate-950/90 px-4 py-2 text-xs font-black tracking-wider text-slate-100 uppercase hover:border-white"
        >
          Back to Menu
        </button>
      </div>

      {/* Left Compact Customization Dock (keeps center 3D spinning car unobstructed) */}
      <div className="pointer-events-auto my-auto flex w-full max-w-sm flex-col gap-3 rounded-xl border border-slate-600/60 bg-slate-950/92 p-4 shadow-2xl">
        {/* 6 Vehicle Models */}
        <div>
          <div className="mb-1.5 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
            Select Vehicle (6 Models)
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {VEHICLE_ORDER.map((id) => {
              const spec = VEHICLE_CONFIGS[id];
              const active = customization.vehicleId === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleSelectVehicle(id)}
                  className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
                    active
                      ? 'border-orange-400 bg-orange-500/20 text-white'
                      : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <div className="text-[11px] font-black uppercase leading-tight">
                    {spec.name}
                  </div>
                  <div className="text-[9px] font-semibold text-sky-300">
                    {spec.maxSpeedKmh} km/h
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 text-[11px] font-semibold text-sky-300">
            {activeSpec.tagline}
          </div>
        </div>

        {/* Spec Stats */}
        <div className="grid grid-cols-4 gap-1.5 rounded-lg border border-slate-800 bg-slate-900/80 p-2 text-center">
          <div>
            <div className="text-[8px] font-bold text-slate-400 uppercase">Max Speed</div>
            <div className="tabular-nums text-xs font-black text-white">
              {activeSpec.maxSpeedKmh}
            </div>
          </div>
          <div>
            <div className="text-[8px] font-bold text-slate-400 uppercase">Mass</div>
            <div className="tabular-nums text-xs font-black text-white">
              {activeSpec.massKg}kg
            </div>
          </div>
          <div>
            <div className="text-[8px] font-bold text-slate-400 uppercase">Ram</div>
            <div className="tabular-nums text-xs font-black text-amber-300">
              {activeSpec.ramMultiplier.toFixed(2)}x
            </div>
          </div>
          <div>
            <div className="text-[8px] font-bold text-slate-400 uppercase">Armor</div>
            <div className="tabular-nums text-xs font-black text-emerald-300">
              {activeSpec.collisionResistance.toFixed(2)}x
            </div>
          </div>
        </div>

        {/* Paint Livery Swatches */}
        <div>
          <div className="mb-1.5 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
            Body Livery
          </div>
          <div className="flex flex-wrap gap-2">
            {PAINT_SWATCHES.map((sw) => {
              const active = customization.bodyColor === sw.hex;
              return (
                <button
                  key={sw.name}
                  type="button"
                  aria-label={`Paint ${sw.name}`}
                  onClick={() =>
                    onChange({
                      ...customization,
                      bodyColor: sw.hex,
                      accentColor: sw.accent,
                    })
                  }
                  className={`h-7 w-7 rounded-md border-2 transition-transform ${
                    active ? 'scale-110 border-white' : 'border-slate-700'
                  }`}
                  style={{ backgroundColor: sw.hex }}
                />
              );
            })}
          </div>
        </div>

        {/* Rim Finish Swatches */}
        <div>
          <div className="mb-1.5 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
            Wheel Rims
          </div>
          <div className="flex gap-2">
            {RIM_SWATCHES.map((rim) => {
              const active = customization.rimColor === rim.hex;
              return (
                <button
                  key={rim.name}
                  type="button"
                  aria-label={`Rims ${rim.name}`}
                  onClick={() =>
                    onChange({ ...customization, rimColor: rim.hex })
                  }
                  className={`h-6 flex-1 rounded-md border-2 ${
                    active ? 'border-white' : 'border-slate-700'
                  }`}
                  style={{ backgroundColor: rim.hex }}
                />
              );
            })}
          </div>
        </div>

        <button
          type="button"
          data-start="true"
          onClick={onDriveNow}
          className="mt-1 w-full rounded-lg bg-orange-500 py-2.5 text-sm font-black tracking-wider text-slate-950 uppercase hover:bg-orange-400"
        >
          Drive {activeSpec.name}
        </button>
      </div>

      <div />
    </div>
  );
}
