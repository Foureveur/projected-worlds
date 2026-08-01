/**
 * Audio — bruitages rétro générés à la volée avec la Web Audio API.
 * Aucun fichier son : tout est synthétisé (bleeps 8-bit).
 */

export class AudioFx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }

  // À appeler sur une interaction utilisateur (politique autoplay navigateurs).
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _blip({ type = 'square', freq = 440, to = null, dur = 0.1, vol = 0.5, decay = true }) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    if (decay) g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    else g.gain.setValueAtTime(vol, t0 + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  _noise({ dur = 0.15, vol = 0.4, hp = 800 }) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'highpass'; filt.frequency.value = hp;
    const g = this.ctx.createGain(); g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + dur);
  }

  play(event, data = {}) {
    if (!this.ctx) return;
    this.resume();
    switch (event) {
      case 'hit':
        if (data.heavy) { this._blip({ type: 'square', freq: 180, to: 60, dur: 0.14, vol: 0.5 }); this._noise({ dur: 0.12, vol: 0.35, hp: 500 }); }
        else { this._blip({ type: 'square', freq: 320, to: 140, dur: 0.08, vol: 0.4 }); this._noise({ dur: 0.05, vol: 0.2 }); }
        break;
      case 'block':
        this._blip({ type: 'triangle', freq: 900, to: 500, dur: 0.06, vol: 0.35 });
        this._noise({ dur: 0.04, vol: 0.15, hp: 2000 });
        break;
      case 'whiff':
        this._noise({ dur: 0.08, vol: 0.12, hp: 1500 });
        break;
      case 'special':
        this._blip({ type: 'sawtooth', freq: 220, to: 660, dur: 0.18, vol: 0.4 });
        break;
      case 'transform':
        this._blip({ type: 'sawtooth', freq: 120, to: 800, dur: 0.4, vol: 0.5 });
        this._blip({ type: 'square', freq: 300, to: 1200, dur: 0.35, vol: 0.3 });
        this._noise({ dur: 0.3, vol: 0.25, hp: 300 });
        break;
      case 'ko':
        this._blip({ type: 'square', freq: 400, to: 40, dur: 0.5, vol: 0.5 });
        this._noise({ dur: 0.4, vol: 0.4, hp: 200 });
        break;
      case 'round-start':
        this._blip({ type: 'square', freq: 660, dur: 0.1, vol: 0.4 });
        setTimeout(() => this._blip({ type: 'square', freq: 880, dur: 0.15, vol: 0.4 }), 120);
        break;
      case 'fight':
        this._blip({ type: 'sawtooth', freq: 440, to: 880, dur: 0.25, vol: 0.5 });
        break;
      case 'match-end':
        [523, 659, 784, 1047].forEach((f, i) =>
          setTimeout(() => this._blip({ type: 'square', freq: f, dur: 0.2, vol: 0.4 }), i * 130));
        break;
    }
  }
}
