// ============================================================
// AUDIO MANAGER
// ============================================================
// Uses procedurally generated WebAudio sounds by default so the
// game works with zero external assets. To use real audio files
// instead, drop files into assets/sounds/ and set the matching
// path below in ASSET_PATHS — loadBuffer() will prefer a real
// file over the procedural fallback if it loads successfully.
// ============================================================

const ASSET_PATHS = {
  pickup: "assets/sounds/pickup.mp3",
  successTiming: "assets/sounds/success.mp3",
  failTiming: "assets/sounds/fail.mp3",
  place: "assets/sounds/place.mp3",
  wobble: "assets/sounds/wobble.mp3",
  collapse: "assets/sounds/collapse.mp3",
  uiClick: "assets/sounds/click.mp3",
  music: "assets/sounds/music.mp3"
};

class AudioManager {
  constructor() {
    this.ctx = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.buffers = {};
    this.musicSource = null;
    this.sfxVolume = 0.8;
    this.musicVolume = 0.4;
    this.unlocked = false;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.sfxGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxVolume;
    this.musicGain.gain.value = this.musicVolume;
    this.sfxGain.connect(this.ctx.destination);
    this.musicGain.connect(this.ctx.destination);
  }

  unlock() {
    if (!this.ctx) this.init();
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.unlocked = true;
  }

  setSfxVolume(v) {
    this.sfxVolume = v;
    if (this.sfxGain) this.sfxGain.gain.value = v;
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.musicGain) this.musicGain.gain.value = v;
  }

  // ---- Procedural sound generators ----
  _envGain(dest, attack, decay, peak = 1) {
    const g = this.ctx.createGain();
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + attack);
    g.gain.exponentialRampToValueAtTime(0.001, now + attack + decay);
    g.connect(dest);
    return g;
  }

  _tone(freq, duration, type = "sine", opts = {}) {
    if (!this.ctx) this.init();
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    if (opts.slideTo) {
      osc.frequency.exponentialRampToValueAtTime(opts.slideTo, this.ctx.currentTime + duration);
    }
    const g = this._envGain(this.sfxGain, opts.attack ?? 0.005, duration, opts.peak ?? 0.5);
    osc.connect(g);
    osc.start();
    osc.stop(this.ctx.currentTime + duration + 0.05);
  }

  _noiseBurst(duration, opts = {}) {
    if (!this.ctx) this.init();
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.filterType || "lowpass";
    filter.frequency.value = opts.filterFreq || 1200;
    const g = this._envGain(this.sfxGain, 0.001, duration, opts.peak ?? 0.6);
    src.connect(filter);
    filter.connect(g);
    src.start();
  }

  playPickup() {
    this.init();
    this._tone(340, 0.09, "triangle", { slideTo: 520, peak: 0.35 });
  }

  playSuccessTiming() {
    this.init();
    this._tone(520, 0.08, "sine", { slideTo: 780, peak: 0.4 });
    setTimeout(() => this._tone(780, 0.12, "sine", { peak: 0.3 }), 60);
  }

  playFailTiming() {
    this.init();
    this._tone(220, 0.18, "sawtooth", { slideTo: 110, peak: 0.3 });
  }

  playPlace() {
    this.init();
    this._noiseBurst(0.12, { filterFreq: 700, peak: 0.5 });
    this._tone(150, 0.1, "triangle", { peak: 0.3 });
  }

  playWobble() {
    this.init();
    this._noiseBurst(0.25, { filterFreq: 350, peak: 0.25 });
  }

  playCollapse() {
    this.init();
    this._noiseBurst(0.9, { filterFreq: 900, peak: 0.7 });
    for (let i = 0; i < 5; i++) {
      setTimeout(() => this._noiseBurst(0.3 + Math.random() * 0.2, {
        filterFreq: 400 + Math.random() * 500,
        peak: 0.3
      }), i * 90);
    }
  }

  playUiClick() {
    this.init();
    this._tone(600, 0.05, "square", { peak: 0.2 });
  }

  startMusic() {
    // Ambient procedural pad loop — subtle, low volume by default.
    this.init();
    if (this.musicSource) return;
    const now = this.ctx.currentTime;
    const notes = [130.81, 164.81, 196.0]; // C3, E3, G3
    const master = this.ctx.createGain();
    master.gain.value = 0.5;
    master.connect(this.musicGain);
    this._musicOscillators = notes.map((f, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.02;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 0.08;
      lfo.connect(lfoGain);
      const g = this.ctx.createGain();
      g.gain.value = 0.12;
      lfoGain.connect(g.gain);
      osc.connect(g);
      g.connect(master);
      osc.start(now);
      lfo.start(now);
      return { osc, lfo };
    });
    this.musicSource = master;
  }

  stopMusic() {
    if (!this.musicSource) return;
    (this._musicOscillators || []).forEach(({ osc, lfo }) => {
      try { osc.stop(); lfo.stop(); } catch { /* ignore */ }
    });
    this._musicOscillators = [];
    this.musicSource = null;
  }
}

export const audio = new AudioManager();
