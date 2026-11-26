import type { InputState } from '../types/game';

export type TouchActionKey =
  | 'left'
  | 'right'
  | 'throttle'
  | 'brake'
  | 'drift'
  | 'jump'
  | 'weapon'
  | 'ability'
  | 'nitro';

export class InputManager {
  private heldKeys = new Set<string>();
  private touchHeld = new Set<TouchActionKey>();
  private analogSteer = 0; // -1 right .. +1 left from touch drag if used

  private jumpBufferTimer = 0;
  private weaponJustPressed = false;
  private abilityJustPressed = false;
  private recoverJustPressed = false;
  private pauseJustPressed = false;

  private steerSensitivity = 1.0;

  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onKeyUpBound: (e: KeyboardEvent) => void;
  private onBlurBound: () => void;
  private onVisibilityChangeBound: () => void;

  constructor() {
    this.onKeyDownBound = this.handleKeyDown.bind(this);
    this.onKeyUpBound = this.handleKeyUp.bind(this);
    this.onBlurBound = this.clearAll.bind(this);
    this.onVisibilityChangeBound = () => {
      if (document.hidden) this.clearAll();
    };

    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);
    window.addEventListener('blur', this.onBlurBound);
    document.addEventListener('visibilitychange', this.onVisibilityChangeBound);
  }

  public setSteerSensitivity(value: number): void {
    this.steerSensitivity = Math.max(0.5, Math.min(1.6, value));
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT')
    ) {
      return;
    }

    const code = e.code;
    const isRepeat = e.repeat;

    if (
      code === 'Space' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    ) {
      if (document.body.dataset.state === 'playing') {
        e.preventDefault();
      }
    }

    this.heldKeys.add(code);

    if (!isRepeat) {
      if (code === 'KeyE') {
        this.jumpBufferTimer = 0.14;
      } else if (code === 'KeyF') {
        this.weaponJustPressed = true;
      } else if (code === 'KeyQ') {
        this.abilityJustPressed = true;
      } else if (code === 'KeyR') {
        this.recoverJustPressed = true;
      } else if (code === 'Escape' || code === 'KeyP') {
        this.pauseJustPressed = true;
      }
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.heldKeys.delete(e.code);
  }

  public setTouchButton(action: TouchActionKey, pressed: boolean): void {
    if (pressed) {
      const wasPressed = this.touchHeld.has(action);
      this.touchHeld.add(action);
      if (!wasPressed) {
        if (action === 'jump') this.jumpBufferTimer = 0.14;
        if (action === 'weapon') this.weaponJustPressed = true;
        if (action === 'ability') this.abilityJustPressed = true;
      }
    } else {
      this.touchHeld.delete(action);
    }
  }

  public setTouchAnalogSteer(steer: number): void {
    this.analogSteer = Math.max(-1, Math.min(1, steer));
  }

  public triggerWeapon(): void {
    this.weaponJustPressed = true;
  }

  public triggerAbility(): void {
    this.abilityJustPressed = true;
  }

  public triggerRecover(): void {
    this.recoverJustPressed = true;
  }

  public clearAll(): void {
    this.heldKeys.clear();
    this.touchHeld.clear();
    this.analogSteer = 0;
    this.jumpBufferTimer = 0;
    this.weaponJustPressed = false;
    this.abilityJustPressed = false;
    this.recoverJustPressed = false;
    this.pauseJustPressed = false;
  }

  public sampleAndStep(dt: number): InputState {
    const throttle =
      this.heldKeys.has('KeyW') ||
      this.heldKeys.has('ArrowUp') ||
      this.touchHeld.has('throttle')
        ? 1
        : 0;

    const brake =
      this.heldKeys.has('KeyS') ||
      this.heldKeys.has('ArrowDown') ||
      this.touchHeld.has('brake')
        ? 1
        : 0;

    const steerLeft =
      this.heldKeys.has('KeyA') ||
      this.heldKeys.has('ArrowLeft') ||
      this.touchHeld.has('left')
        ? 1
        : 0;

    const steerRight =
      this.heldKeys.has('KeyD') ||
      this.heldKeys.has('ArrowRight') ||
      this.touchHeld.has('right')
        ? 1
        : 0;

    let rawSteer = steerLeft - steerRight;
    if (rawSteer === 0 && Math.abs(this.analogSteer) > 0.05) {
      rawSteer = this.analogSteer;
    }
    const steer = Math.max(-1, Math.min(1, rawSteer * this.steerSensitivity));

    const drift =
      this.heldKeys.has('Space') || this.touchHeld.has('drift');

    const nitro =
      this.heldKeys.has('ShiftLeft') ||
      this.heldKeys.has('ShiftRight') ||
      this.touchHeld.has('nitro');

    const jumpBuffered = this.jumpBufferTimer > 0;
    this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);

    const weaponTriggered = this.weaponJustPressed;
    const abilityTriggered = this.abilityJustPressed;
    const recoverTriggered = this.recoverJustPressed;
    const pauseTriggered = this.pauseJustPressed;

    this.weaponJustPressed = false;
    this.abilityJustPressed = false;
    this.recoverJustPressed = false;
    this.pauseJustPressed = false;

    return {
      throttle,
      brake,
      steer,
      drift,
      nitro,
      jumpBuffered,
      weaponTriggered,
      abilityTriggered,
      recoverTriggered,
      pauseTriggered,
    };
  }

  public consumeJumpBuffer(): void {
    this.jumpBufferTimer = 0;
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    window.removeEventListener('blur', this.onBlurBound);
    document.removeEventListener('visibilitychange', this.onVisibilityChangeBound);
  }
}
