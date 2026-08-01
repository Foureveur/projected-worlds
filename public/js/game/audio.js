/**
 * Audio — bruitages rétro générés à la volée avec la Web Audio API.
 * Aucun fichier son : tout est synthétisé (bleeps 8-bit).
 */

export class AudioFx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.enabled = true;
    this.muted = false;
    this.music = { playing: false, track: null, step: 0, nextTime: 0, stepDur: 0.11, timer: null, intensity: 0 };
  }

  // À appeler sur une interaction utilisateur (politique autoplay navigateurs).
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.35;
    this.master.connect(this.ctx.destination);
    // Bus dédié à la musique (pour la doser/couper indépendamment des SFX)
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.connect(this.master);
  }

  setMuted(v) {
    this.muted = v;
    if (this.master) this.master.gain.value = v ? 0 : 0.35;
    return this.muted;
  }
  toggleMute() { return this.setMuted(!this.muted); }

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
      case 'throw':
        this._blip({ type: 'sawtooth', freq: 300, to: 90, dur: 0.16, vol: 0.4 });
        this._blip({ type: 'square', freq: 160, to: 50, dur: 0.2, vol: 0.4 });
        this._noise({ dur: 0.14, vol: 0.3, hp: 400 });
        break;
      case 'armor':
        this._blip({ type: 'square', freq: 1200, to: 700, dur: 0.08, vol: 0.35 });
        this._noise({ dur: 0.05, vol: 0.2, hp: 3000 });
        break;
      case 'dash':
        this._noise({ dur: 0.12, vol: 0.16, hp: 1200 });
        this._blip({ type: 'sine', freq: 500, to: 200, dur: 0.1, vol: 0.15 });
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

  // ------------------------------------------------------------------
  // Musique de fond (chiptune généré, sans fichier audio)
  // ------------------------------------------------------------------
  startMusic(track) {
    if (!this.ctx) return;
    this.resume();
    if (this.music.playing && this.music.track === track) return;
    const M = this.music;
    M.track = track;
    M.step = 0;
    M.intensity = 0;
    M.stepDur = track === 'battle' ? 60 / 148 / 4 : 60 / 104 / 4;
    M.nextTime = this.ctx.currentTime + 0.08;
    // fondu d'entrée
    const vol = track === 'battle' ? 0.5 : 0.35;
    this.musicGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, this.ctx.currentTime);
    this.musicGain.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + 0.6);
    if (!M.playing) {
      M.playing = true;
      M.timer = setInterval(() => this._scheduleMusic(), 25);
    }
  }

  stopMusic() {
    const M = this.music;
    if (M.timer) { clearInterval(M.timer); M.timer = null; }
    M.playing = false;
    M.track = null;
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.musicGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.3);
    }
  }

  // 0 = calme, 1 = furie (accélère le ressenti et monte le volume)
  setMusicIntensity(v) {
    this.music.intensity = Math.max(0, Math.min(1, v));
  }

  _scheduleMusic() {
    if (!this.music.playing) return;
    const ahead = 0.2;
    while (this.music.nextTime < this.ctx.currentTime + ahead) {
      this._musicStep(this.music.step, this.music.nextTime);
      this.music.step = (this.music.step + 1) % 64;
      this.music.nextTime += this.music.stepDur;
    }
  }

  _musicStep(step, time) {
    const M = this.music;
    const bar = Math.floor(step / 16) % 4;
    const s = step % 16;
    const roots = [110.0, 87.31, 130.81, 98.0]; // Am - F - C - G
    const root = roots[bar];

    if (M.track === 'battle') {
      // Basse pompée (croches)
      if (s % 2 === 0) this._mNote(root / 2, 'triangle', M.stepDur * 0.95, 0.22, time);
      // Lead arpégé (quintes/octaves : neutre majeur/mineur)
      const arp = [1, 1.5, 2, 1.5, 1, 2, 1.5, 3, 1, 1.5, 2, 1.5, 2, 3, 2, 1.5];
      this._mNote(root * arp[s], 'square', M.stepDur * 0.8, 0.05 + M.intensity * 0.05, time);
      if (M.intensity > 0.4) this._mNote(root * arp[s] * 2, 'square', M.stepDur * 0.6, 0.03, time);
      // Batterie
      if (s === 0 || s === 8) this._mKick(time);
      if (s === 4 || s === 12) this._mSnare(time, 0.4);
      if (s % 2 === 1) this._mHat(time, 0.03);
      if (M.intensity > 0.5 && (s === 6 || s === 14)) this._mSnare(time, 0.3);
    } else {
      // Menu : nappe douce + arpège lent
      if (s % 8 === 0) this._mNote(root / 2, 'triangle', M.stepDur * 6, 0.12, time);
      if (s % 2 === 0) {
        const arp = [1, 1.5, 2, 1.5];
        this._mNote(root * arp[(step / 2) % 4] * 2, 'triangle', M.stepDur * 1.6, 0.05, time);
      }
      if (s === 0) this._mHat(time, 0.015);
    }
  }

  _mNote(freq, type, dur, vol, time) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, time);
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    o.connect(g); g.connect(this.musicGain);
    o.start(time); o.stop(time + dur + 0.02);
  }
  _mKick(time) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, time);
    o.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    g.gain.setValueAtTime(0.5, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    o.connect(g); g.connect(this.musicGain);
    o.start(time); o.stop(time + 0.16);
  }
  _mNoiseBurst(time, dur, vol, hp) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const filt = this.ctx.createBiquadFilter(); filt.type = 'highpass'; filt.frequency.value = hp;
    const g = this.ctx.createGain(); g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.connect(filt); filt.connect(g); g.connect(this.musicGain);
    src.start(time); src.stop(time + dur);
  }
  _mSnare(time, vol) { this._mNoiseBurst(time, 0.12, vol, 1200); }
  _mHat(time, vol) { this._mNoiseBurst(time, 0.03, vol, 6000); }
}
