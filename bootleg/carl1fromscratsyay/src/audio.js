// Tiny WebAudio blip synth -- no audio files, everything is oscillators.

const Sfx = {
  ctx: null,
  master: null,
  muted: false,

  // Browsers only allow audio after a user gesture, so this is called from
  // the first keypress/click rather than on load.
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.28;
    this.master.connect(this.ctx.destination);
  },

  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.28;
    return this.muted;
  },

  // One enveloped note. `slideTo` bends the pitch over the note's life.
  tone(freq, dur, type, vol, slideTo, delay) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + (delay || 0);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },

  noise(dur, vol) {
    if (!this.ctx || this.muted) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    gain.gain.value = vol || 0.2;
    src.buffer = buf;
    src.connect(gain);
    gain.connect(this.master);
    src.start();
  },

  jump()   { this.tone(320, 0.14, "square", 0.22, 620); },
  coin()   { this.tone(988, 0.07, "square", 0.2); this.tone(1319, 0.14, "square", 0.18, null, 0.06); },
  stomp()  { this.tone(200, 0.1, "square", 0.25, 90); this.noise(0.12, 0.12); },
  spring() { this.tone(280, 0.2, "sine", 0.3, 880); },
  hurt()   { this.tone(400, 0.35, "sawtooth", 0.22, 70); },
  select() { this.tone(660, 0.08, "square", 0.2); },

  goal() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, 0.22, "square", 0.22, null, i * 0.09));
  },

  gameOver() {
    const notes = [392, 330, 262, 196];
    notes.forEach((f, i) => this.tone(f, 0.3, "triangle", 0.25, null, i * 0.16));
  },

  victory() {
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((f, i) => this.tone(f, 0.26, "square", 0.22, null, i * 0.12));
  },
};
