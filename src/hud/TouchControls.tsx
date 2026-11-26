import type { TouchActionKey } from '../controls/InputManager';
import type { EquippedAbility, EquippedWeapon } from '../types/game';

interface TouchControlsProps {
  onTouchAction: (action: TouchActionKey, pressed: boolean) => void;
  equippedWeapon: EquippedWeapon | null;
  equippedAbility: EquippedAbility | null;
  nitroPercent: number;
}

interface TouchPadButtonProps {
  action: TouchActionKey;
  label: string;
  sublabel?: string;
  className: string;
  onTouchAction: (action: TouchActionKey, pressed: boolean) => void;
  disabled?: boolean;
}

function TouchPadButton({
  action,
  label,
  sublabel,
  className,
  onTouchAction,
  disabled = false,
}: TouchPadButtonProps) {
  return (
    <button
      type="button"
      tabIndex={-1}
      disabled={disabled}
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        onTouchAction(action, true);
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        onTouchAction(action, false);
      }}
      onPointerCancel={() => onTouchAction(action, false)}
      onLostPointerCapture={() => onTouchAction(action, false)}
      className={`pointer-events-auto flex flex-col items-center justify-center rounded-xl border-2 font-black tracking-wide active:scale-95 transition-transform touch-none select-none ${className}`}
    >
      <span className="leading-none truncate max-w-full px-1">{label}</span>
      {sublabel && (
        <span className="mt-0.5 text-[9px] font-bold opacity-85 leading-none">
          {sublabel}
        </span>
      )}
    </button>
  );
}

export function TouchControls({
  onTouchAction,
  equippedWeapon,
  equippedAbility,
  nitroPercent,
}: TouchControlsProps) {
  const weaponLabel = equippedWeapon
    ? equippedWeapon.name.split(' ')[0].toUpperCase()
    : 'NO WPN';
  const weaponSub = equippedWeapon
    ? equippedWeapon.cooldown > 0
      ? `${equippedWeapon.cooldown.toFixed(1)}s`
      : `x${equippedWeapon.usesRemaining}`
    : 'SLOT 1';

  const abilityLabel = equippedAbility
    ? equippedAbility.name.split(' ')[0].toUpperCase()
    : 'NO ABL';
  const abilitySub = equippedAbility
    ? equippedAbility.activeRemaining > 0
      ? `${equippedAbility.activeRemaining.toFixed(1)}s`
      : equippedAbility.cooldown > 0
        ? `${equippedAbility.cooldown.toFixed(1)}s`
        : `x${equippedAbility.usesRemaining}`
    : 'SLOT 2';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex items-end justify-between px-3 pb-3 sm:px-5 sm:pb-4">
      {/* Left Steering Control Cluster */}
      <div className="flex items-center gap-2.5">
        <TouchPadButton
          action="left"
          label="◀"
          sublabel="LEFT"
          onTouchAction={onTouchAction}
          className="h-14 w-16 sm:h-16 sm:w-20 border-slate-400/60 bg-slate-900/80 text-white text-xl shadow-lg"
        />
        <TouchPadButton
          action="right"
          label="▶"
          sublabel="RIGHT"
          onTouchAction={onTouchAction}
          className="h-14 w-16 sm:h-16 sm:w-20 border-slate-400/60 bg-slate-900/80 text-white text-xl shadow-lg"
        />
      </div>

      {/* Right Action & Pedals Cluster */}
      <div className="flex flex-col items-end gap-2">
        {/* Top Row: Weapon, Ability, Jump, Nitro */}
        <div className="flex items-center gap-2">
          <TouchPadButton
            action="weapon"
            label={weaponLabel}
            sublabel={weaponSub}
            onTouchAction={onTouchAction}
            className={`h-11 w-16 text-[10px] shadow-md ${
              !equippedWeapon || equippedWeapon.cooldown > 0
                ? 'border-slate-600/70 bg-slate-900/75 text-slate-400'
                : 'border-rose-400/85 bg-rose-950/85 text-rose-100'
            }`}
          />
          <TouchPadButton
            action="ability"
            label={abilityLabel}
            sublabel={abilitySub}
            onTouchAction={onTouchAction}
            className={`h-11 w-16 text-[10px] shadow-md ${
              !equippedAbility || equippedAbility.cooldown > 0
                ? 'border-slate-600/70 bg-slate-900/75 text-slate-400'
                : 'border-amber-400/85 bg-amber-950/85 text-amber-100'
            }`}
          />
          <TouchPadButton
            action="jump"
            label="JUMP"
            onTouchAction={onTouchAction}
            className="h-11 w-14 border-emerald-400/80 bg-emerald-950/85 text-emerald-200 text-[11px] shadow-md"
          />
          <TouchPadButton
            action={'nitro' as TouchActionKey}
            label="NOS"
            sublabel={`${nitroPercent}%`}
            onTouchAction={onTouchAction}
            className="h-11 w-14 border-cyan-400/80 bg-cyan-950/85 text-cyan-200 text-[11px] shadow-md"
          />
        </div>

        {/* Bottom Row: Drift, Brake, Accelerator */}
        <div className="flex items-end gap-2">
          <TouchPadButton
            action="drift"
            label="DRIFT"
            onTouchAction={onTouchAction}
            className="h-14 w-16 border-orange-400/85 bg-orange-950/85 text-orange-200 text-xs shadow-lg"
          />
          <TouchPadButton
            action="brake"
            label="BRK"
            sublabel="REV"
            onTouchAction={onTouchAction}
            className="h-14 w-14 border-rose-400/85 bg-rose-950/85 text-rose-200 text-xs shadow-lg"
          />
          <TouchPadButton
            action="throttle"
            label="GAS"
            sublabel="GO"
            onTouchAction={onTouchAction}
            className="h-16 w-18 border-lime-400/90 bg-lime-950/85 text-lime-200 text-sm shadow-lg"
          />
        </div>
      </div>
    </div>
  );
}

