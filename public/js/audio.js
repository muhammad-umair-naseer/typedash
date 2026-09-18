/**
 * All sounds are synthesised with WebAudio so the project ships without audio
 * assets. The AudioContext is created lazily on the first user gesture.
 */
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem('td_sound') !== '0';
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('td_sound', this.enabled ? '1' : '0');
    if (this.enabled) this.ensure();
    return this.enabled;
  }

  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  tone(freq, dur = 0.08, type = 'sine', vol = 0.18, when = 0, slideTo = null) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  key() { this.tone(1400 + Math.random() * 300, 0.025, 'square', 0.025); }
  error() { this.tone(200, 0.13, 'sawtooth', 0.07, 0, 110); }
  count() { this.tone(660, 0.12, 'sine', 0.2); }
  go() { this.tone(880, 0.4, 'sine', 0.24); this.tone(1320, 0.4, 'sine', 0.12, 0.03); }
  finish() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.18, i * 0.09)); }
  win() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.24, 'triangle', 0.2, i * 0.11));
    this.tone(1568, 0.7, 'triangle', 0.2, 0.58);
  }
  join() { this.tone(520, 0.08, 'sine', 0.12); this.tone(780, 0.1, 'sine', 0.12, 0.08); }

  /* --- game layer --- */
  combo(tier = 1) {
    const base = 660 + tier * 120;
    this.tone(base, 0.09, 'triangle', 0.14);
    this.tone(base * 1.5, 0.12, 'triangle', 0.14, 0.07);
    if (tier >= 3) this.tone(base * 2, 0.16, 'triangle', 0.12, 0.14);
  }
  comboBreak() { this.tone(320, 0.16, 'sawtooth', 0.06, 0, 160); }
  word() { this.tone(1046, 0.05, 'sine', 0.05); }
  golden() { [1319, 1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.16, 'sine', 0.13, i * 0.05)); }
  nitro() {
    this.tone(180, 0.55, 'sawtooth', 0.12, 0, 720);   // ignition whoosh
    this.tone(880, 0.3, 'square', 0.05, 0.1, 1760);
    this.tone(1760, 0.5, 'sine', 0.08, 0.25, 2600);
  }
  levelUp() {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.18, i * 0.09));
    this.tone(1568, 0.8, 'triangle', 0.16, 0.65);
  }
  achievement() { [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.14, 'sine', 0.15, i * 0.08)); }
  emote() { this.tone(900, 0.06, 'sine', 0.08, 0, 1300); }
  rev() { this.tone(90 + Math.random() * 30, 0.16, 'sawtooth', 0.07, 0, 260 + Math.random() * 120); }
}
