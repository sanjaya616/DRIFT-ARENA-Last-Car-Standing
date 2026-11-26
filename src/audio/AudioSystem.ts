import type { VehicleId, WeaponKind } from '../types/game';

const ENGINE_BASE_FREQ: Record<VehicleId, number> = {
  street_rs: 56,
  drift_x: 64,
  muscle_gt: 42,
  speedster: 72,
  rally_beast: 54,
  titan_4x: 38,
};

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private skidOsc: OscillatorNode | null = null;
  private skidFilter: BiquadFilterNode | null = null;
  private skidGain: GainNode | null = null;

  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicEnabled = true;

  private muted = false;
  private masterVolume = 0.65;
  private started = false;
  private vehicleId: VehicleId = 'street_rs';

  public unlock(): void {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
      this.masterGain.connect(this.ctx.destination);

      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 340;
      this.engineFilter.connect(this.masterGain);

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineGain.connect(this.engineFilter);

      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = ENGINE_BASE_FREQ[this.vehicleId];
      this.engineOsc.connect(this.engineGain);
      this.engineOsc.start();

      this.skidFilter = this.ctx.createBiquadFilter();
      this.skidFilter.type = 'bandpass';
      this.skidFilter.frequency.value = 1150;
      this.skidFilter.Q.value = 6.5;
      this.skidFilter.connect(this.masterGain);

      this.skidGain = this.ctx.createGain();
      this.skidGain.gain.value = 0;
      this.skidGain.connect(this.skidFilter);

      this.skidOsc = this.ctx.createOscillator();
      this.skidOsc.type = 'triangle';
      this.skidOsc.frequency.value = 980;
      this.skidOsc.connect(this.skidGain);
      this.skidOsc.start();

      this.started = true;
      this.ensureMusicLoop();
    } catch {
      // Ignore Web Audio errors on restricted contexts
    }
  }

  public setVehicleProfile(vehicleId: VehicleId): void {
    this.vehicleId = vehicleId;
  }

  public setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (!enabled && this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    } else if (enabled && this.started) {
      this.ensureMusicLoop();
    }
  }

  private ensureMusicLoop(): void {
    if (!this.musicEnabled || this.musicTimer !== null) return;
    const bassNotes = [55, 55, 65.4, 73.4, 55, 55, 82.4, 65.4];
    const leadNotes = [220, 0, 261.6, 293.7, 329.6, 0, 293.7, 261.6];
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx || !this.masterGain || this.muted || !this.musicEnabled) return;
      if (this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;
      const idx = this.musicStep % bassNotes.length;
      this.musicStep += 1;

      // Subtle arcade synthwave bass pulse
      const bassOsc = this.ctx.createOscillator();
      const bassGain = this.ctx.createGain();
      bassOsc.type = 'triangle';
      bassOsc.frequency.setValueAtTime(bassNotes[idx], now);
      bassGain.gain.setValueAtTime(0.035, now);
      bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
      bassOsc.connect(bassGain);
      bassGain.connect(this.masterGain);
      bassOsc.start(now);
      bassOsc.stop(now + 0.2);

      const lead = leadNotes[idx];
      if (lead > 0) {
        const leadOsc = this.ctx.createOscillator();
        const leadGain = this.ctx.createGain();
        leadOsc.type = 'sine';
        leadOsc.frequency.setValueAtTime(lead, now);
        leadGain.gain.setValueAtTime(0.014, now);
        leadGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        leadOsc.connect(leadGain);
        leadGain.connect(this.masterGain);
        leadOsc.start(now);
        leadOsc.stop(now + 0.17);
      }
    }, 240);
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        muted ? 0 : this.masterVolume,
        this.ctx.currentTime,
        0.03,
      );
    }
  }

  public setMasterVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx && !this.muted) {
      this.masterGain.gain.setTargetAtTime(
        this.masterVolume,
        this.ctx.currentTime,
        0.03,
      );
    }
  }

  public updateContinuous(
    active: boolean,
    speedKmh: number,
    throttle: number,
    driftSlip: number,
    nitroActive: boolean,
  ): void {
    if (!this.ctx || !this.engineOsc || !this.engineGain || !this.skidGain || !this.skidOsc) {
      return;
    }
    const now = this.ctx.currentTime;
    if (!active || this.muted) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.06);
      this.skidGain.gain.setTargetAtTime(0, now, 0.06);
      return;
    }

    const base = ENGINE_BASE_FREQ[this.vehicleId] ?? 55;
    const rpmFreq =
      base + Math.min(150, speedKmh * 0.92) + throttle * 26 + (nitroActive ? 38 : 0);
    this.engineOsc.frequency.setTargetAtTime(rpmFreq, now, 0.05);
    this.engineGain.gain.setTargetAtTime(0.055 + throttle * 0.045, now, 0.05);

    if (this.engineFilter) {
      this.engineFilter.frequency.setTargetAtTime(nitroActive ? 720 : 340, now, 0.06);
    }

    const skidVol = driftSlip > 0.25 ? Math.min(0.08, (driftSlip - 0.25) * 0.11) : 0;
    this.skidOsc.frequency.setTargetAtTime(920 + driftSlip * 340, now, 0.04);
    this.skidGain.gain.setTargetAtTime(skidVol, now, 0.04);
  }

  public playMenuClick(): void {
    this.unlock();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(760, now + 0.05);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  public playImpact(intensity: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const clamped = Math.max(0.2, Math.min(1, intensity));
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    const pitchJitter = 0.92 + Math.random() * 0.16;
    osc.frequency.setValueAtTime(140 * pitchJitter, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.18);
    gain.gain.setValueAtTime(0.28 * clamped, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  public playExplosion(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(24, now + 0.36);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  public playJump(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.14);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playBoost(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.28);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.31);
  }

  public playWeaponPulse(kind?: WeaponKind): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    if (kind === 'punch') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(65, now + 0.14);
    } else if (kind === 'bomb' || kind === 'proximity_mine' || kind === 'spike_trap') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(170, now + 0.12);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(640, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.2);
    }
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.21);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  public playAbilityShield(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.25);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.29);
  }

  public playPickup(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.setValueAtTime(780, now + 0.07);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  public playTrainHorn(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    for (const freq of [185, 233]) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.68);
    }
  }

  public playBridgeAlarm(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(580, now);
    osc.frequency.setValueAtTime(440, now + 0.14);
    gain.gain.setValueAtTime(0.065, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  public dispose(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    try {
      this.engineOsc?.stop();
      this.skidOsc?.stop();
      void this.ctx?.close();
    } catch {
      // ignore
    }
    this.ctx = null;
    this.started = false;
  }
}
