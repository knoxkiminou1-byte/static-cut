/* STATIC CUT — audio.js
 * Live Web Audio sequencer: 126 BPM D minor. Stems die per band.
 * MUTE collapses the mix in ~35ms. Voice budget: 24 (8 perc / 8 harm / 6 bass / 2 fx).
 * No samples, no external assets — everything synthesized.
 */
(function () {
  'use strict';
  window.SC = window.SC || {};

  var BPM = 126;
  var SPB = 60 / BPM;          // seconds per beat
  var STEP = SPB / 4;          // 16th note
  var VOICE_CAP = 24;

  // Dm – Bb – Gm – A, one bar each
  var PROG = [
    { root: 73.42, name: 'D',  tones: [146.83, 174.61, 220.00] },  // D3 F3 A3
    { root: 58.27, name: 'Bb', tones: [116.54, 146.83, 174.61] },  // Bb2 D3 F3
    { root: 98.00, name: 'G',  tones: [116.54, 146.83, 196.00] },  // G2 Bb2 D3? (Gm voicing)
    { root: 110.00, name: 'A', tones: [138.59, 164.81, 220.00] }   // A2 C#3 A3
  ];

  function Audio() {
    this.ctx = null;
    this.master = null;      // master gain (MUTE collapses this)
    this.musicBus = null;    // music sub-bus
    this.sfxBus = null;      // sfx sub-bus (ducked slightly less)
    this.filter = null;      // crush lowpass
    this.band = 1;
    this.muted = false;
    this.muteDepth = 0;       // 0..1 eased
    this.stemLevel = { perc: 1, harm: 1, bass: 1 };
    this.nextStepTime = 0;
    this.step = 0;
    this.voices = 0;
    this.started = false;
    this.bossMode = false;
    this.noiseBuf = null;
    this._timer = null;
  }

  Audio.prototype.init = function () {
    if (this.ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 18000;
    this.filter.connect(this.master);
    this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.8; this.musicBus.connect(this.filter);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.filter);
    // shared noise buffer (percussion / static)
    var len = ctx.sampleRate * 1;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  };

  Audio.prototype.resume = function () {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  };

  Audio.prototype.start = function () {
    if (!this.ctx || this.started) return;
    this.started = true;
    this.nextStepTime = this.ctx.currentTime + 0.06;
    this.step = 0;
    var self = this;
    this._timer = setInterval(function () { self._schedule(); }, 25);
  };

  Audio.prototype.stop = function () {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this.started = false;
  };

  Audio.prototype._voice = function (n) {
    if (this.voices + n > VOICE_CAP) return false;
    this.voices += n;
    var self = this;
    setTimeout(function () { self.voices = Math.max(0, self.voices - n); }, 1200);
    return true;
  };

  Audio.prototype._schedule = function () {
    if (!this.ctx) return;
    var ahead = 0.12;
    while (this.nextStepTime < this.ctx.currentTime + ahead) {
      this._playStep(this.step, this.nextStepTime);
      this.nextStepTime += STEP;
      this.step = (this.step + 1) % 64; // 4 bars of 16
    }
  };

  Audio.prototype._playStep = function (step, t) {
    var bar = Math.floor(step / 16);
    var s16 = step % 16;
    var chord = PROG[bar % 4];
    var L = this.stemLevel;

    if (this.bossMode) { this._playBossStep(step, t, bar, s16); return; }

    // PERCUSSION — dies through band 2
    if (L.perc > 0.01) {
      if (s16 % 4 === 0 && this._voice(1)) this._kick(t, L.perc);
      if (s16 % 4 === 2 && this._voice(1)) this._hat(t, L.perc * 0.5, true);
      if ((s16 === 4 || s16 === 12) && this._voice(1)) this._snare(t, L.perc * 0.8);
      if (s16 % 2 === 1 && L.perc > 0.3 && this._voice(1)) this._hat(t, L.perc * 0.25, false);
    }
    // BASS — dies through band 4
    if (L.bass > 0.01 && s16 % 2 === 0 && this._voice(1)) {
      var oct = (s16 === 14) ? 2 : 1;
      this._bass(t, chord.root * oct, L.bass, s16 === 0 ? 0.32 : 0.18);
    }
    // HARMONY — dies through band 3
    if (L.harm > 0.01 && this._voice(3)) {
      if (s16 === 0) this._pad(t, chord.tones, L.harm * 0.5, SPB * 4);
      if (s16 === 6 || s16 === 11) this._pluck(t, chord.tones[(s16 + bar) % 3] * 2, L.harm * 0.35);
    }
  };

  Audio.prototype._playBossStep = function (step, t, bar, s16) {
    // near-vacuum: sub drone + sparse pulse + rhythmic signal cuts
    if (s16 === 0 && this._voice(1)) this._drone(t, 36.71, SPB * 4, 0.5); // D1
    if (s16 % 8 === 4 && this._voice(1)) this._pluck(t, 73.42, 0.3);
    if (s16 % 2 === 0 && this._voice(1)) this._hat(t, 0.12, false);
  };

  // ---- instruments ----
  Audio.prototype._kick = function (t, v) {
    var ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.11);
    g.gain.setValueAtTime(0.9 * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.16);
  };
  Audio.prototype._hat = function (t, v, open) {
    var ctx = this.ctx, s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    s.buffer = this.noiseBuf; f.type = 'highpass'; f.frequency.value = 7000;
    var dur = open ? 0.18 : 0.05;
    g.gain.setValueAtTime(0.35 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.musicBus); s.start(t); s.stop(t + dur + 0.02);
  };
  Audio.prototype._snare = function (t, v) {
    var ctx = this.ctx, s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    s.buffer = this.noiseBuf; f.type = 'bandpass'; f.frequency.value = 1800;
    g.gain.setValueAtTime(0.5 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    s.connect(f); f.connect(g); g.connect(this.musicBus); s.start(t); s.stop(t + 0.14);
  };
  Audio.prototype._bass = function (t, freq, v, dur) {
    var ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = freq;
    f.type = 'lowpass'; f.frequency.value = 400;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55 * v, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + dur + 0.05);
  };
  Audio.prototype._pad = function (t, tones, v, dur) {
    var ctx = this.ctx;
    for (var i = 0; i < tones.length; i++) {
      var o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'triangle'; o.frequency.value = tones[i];
      f.type = 'lowpass'; f.frequency.value = 1200;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22 * v, t + 0.3);
      g.gain.setValueAtTime(0.22 * v, t + dur - 0.4);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(f); f.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + dur + 0.05);
    }
  };
  Audio.prototype._pluck = function (t, freq, v) {
    var ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.28 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.25);
  };
  Audio.prototype._drone = function (t, freq, dur, v) {
    var ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = freq;
    f.type = 'lowpass'; f.frequency.value = 160;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.5);
    g.gain.setValueAtTime(0.5 * v, t + dur - 0.5);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + dur + 0.05);
  };

  // ---- MUTE: collapse the mix in ~35ms ----
  Audio.prototype.setMuted = function (on) {
    if (!this.ctx || this.muted === on) return;
    this.muted = on;
    var t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    if (on) {
      this.master.gain.exponentialRampToValueAtTime(0.02, t + 0.035);
      this.filter.frequency.exponentialRampToValueAtTime(220, t + 0.035);
    } else {
      this.master.gain.exponentialRampToValueAtTime(0.9, t + 0.25);
      this.filter.frequency.exponentialRampToValueAtTime(18000, t + 0.25);
    }
  };

  // ---- band / stem control ----
  Audio.prototype.setBand = function (n) {
    this.band = n;
    // stems are eased by update(); targets per band
    if (n <= 1) this._target = { perc: 1, harm: 1, bass: 1 };
    else if (n === 2) this._target = { perc: 0.25, harm: 1, bass: 1 };
    else if (n === 3) this._target = { perc: 0, harm: 0.25, bass: 1 };
    else if (n === 4) this._target = { perc: 0, harm: 0, bass: 0.25 };
    else { this._target = { perc: 0, harm: 0, bass: 0 }; this.bossMode = (n === 5); }
    if (n < 5) this.bossMode = false;
  };

  Audio.prototype.update = function (dt) {
    if (!this._target) return;
    var k = Math.min(1, dt * 1.2);
    for (var s in this.stemLevel) {
      this.stemLevel[s] += (this._target[s] - this.stemLevel[s]) * k;
    }
  };

  // ---- one-shots ----
  Audio.prototype._blip = function (freq, dur, v, type, pan) {
    if (!this.ctx || !this._voice(1)) return;
    var ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    if (typeof pan === 'number' && ctx.createStereoPanner) {
      var p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); p.connect(this.sfxBus);
    } else {
      g.connect(this.sfxBus);
    }
    o.start(t); o.stop(t + dur + 0.02);
  };
  Audio.prototype.shoot = function () { this._blip(880 + Math.random() * 120, 0.07, 0.16); };
  Audio.prototype.hit = function () { this._blip(220, 0.12, 0.3, 'sawtooth'); };
  Audio.prototype.kill = function () { this._blip(520, 0.18, 0.3, 'triangle'); this._blip(780, 0.22, 0.2, 'triangle'); };
  Audio.prototype.counterKill = function () {
    var self = this;
    this._blip(660, 0.1, 0.3, 'triangle');
    setTimeout(function () { self._blip(990, 0.14, 0.3, 'triangle'); }, 70);
  };
  Audio.prototype.playerHurt = function () { this._blip(110, 0.3, 0.5, 'sawtooth'); };
  Audio.prototype.overheat = function () { this._blip(1400, 0.4, 0.35, 'sawtooth'); };
  Audio.prototype.muteOn = function () {
    if (!this.ctx || !this._voice(1)) return;
    var ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    s.buffer = this.noiseBuf; f.type = 'lowpass'; f.frequency.setValueAtTime(4000, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.12);
    g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(t); s.stop(t + 0.16);
  };
  Audio.prototype.ident = function () { // two-note boot ident: D4 -> A3
    var self = this;
    this._blip(293.66, 0.35, 0.4, 'sine');
    setTimeout(function () { self._blip(220.00, 0.6, 0.4, 'sine'); }, 320);
  };
  Audio.prototype.victory = function () {
    var self = this, seq = [293.66, 349.23, 440.00, 587.33];
    seq.forEach(function (f, i) {
      setTimeout(function () { self._blip(f, 0.4, 0.35, 'triangle'); }, i * 140);
    });
  };

  SC.Audio = Audio;
})();
