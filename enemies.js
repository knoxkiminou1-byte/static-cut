/* STATIC CUT — enemies.js
 * Screecher, Drummer, Tracker, Feedback + STATION VOICE (3-phase boss).
 * Each enemy: {type,x,y,vx,vy,r,hp,update(dt,world),draw(g),onDeath}.
 * world = {player, muted, heat, projectiles, particles, audio, director, W, H, time}
 */
(function () {
  'use strict';
  window.SC = window.SC || {};

  var TAU = Math.PI * 2;

  function base(type, x, y, r, hp) {
    return { type: type, x: x, y: y, vx: 0, vy: 0, r: r, hp: hp, maxHp: hp,
             t: Math.random() * 10, flash: 0, dead: false, counter: false };
  }

  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
  function toward(e, tx, ty, speed) {
    var dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 1;
    e.vx = dx / d * speed; e.vy = dy / d * speed;
  }

  /* ---- SCREECHER: sawtooth humanoid. Shield halo blocks damage unless muted. ---- */
  function screecher(x, y) {
    var e = base('screecher', x, y, 18, 3);
    e.speed = 95; e.shield = true; e.saw = 0;
    e.update = function (dt, w) {
      this.t += dt; this.saw += dt * 9;
      if (this.shieldStripped > 0) this.shieldStripped -= dt;
      this.shield = !w.muted && !(this.shieldStripped > 0); // silence collapses the shield
      toward(this, w.player.x, w.player.y, this.speed * (w.muted ? 0.6 : 1));
      this.x += this.vx * dt; this.y += this.vy * dt;
      if (this.flash > 0) this.flash -= dt;
    };
    e.hit = function (w) {
      if (this.shield) { if (w.audio) w.audio.hit(); return false; } // blocked
      this.hp--;
      this.flash = 0.08;
      if (w.muted || this.shieldStripped > 0) this.counter = true; // killed under your silence = counter-kill
      return this.hp <= 0;
    };
    e.draw = function (g) {
      g.save(); g.translate(this.x, this.y);
      if (this.shield) { // halo
        g.strokeStyle = '#D94A32'; g.lineWidth = 3; g.globalAlpha = 0.85;
        var n = 10;
        for (var i = 0; i < n; i++) {
          var a = i / n * TAU + this.t;
          var r1 = this.r + 6, r2 = this.r + 10 + ((this.saw * 7 + i * 3) % 4);
          g.beginPath();
          g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
          g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
          g.stroke();
        }
        g.globalAlpha = 1;
      }
      // sawtooth humanoid body
      g.fillStyle = this.flash > 0 ? '#ffffff' : '#D94A32';
      g.beginPath();
      var teeth = 8;
      for (var k = 0; k <= teeth; k++) {
        var ang = k / teeth * TAU;
        var rr = this.r * (k % 2 === 0 ? 1 : 0.72);
        var px = Math.cos(ang + this.t * 0.8) * rr, py = Math.sin(ang + this.t * 0.8) * rr;
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath(); g.fill();
      g.fillStyle = '#11120F';
      g.beginPath(); g.arc(0, 0, 5, 0, TAU); g.fill(); // dark core
      g.restore();
    };
    return e;
  }

  /* ---- DRUMMER: speaker-disc bruiser. Silence stores danger in frozen rings. ---- */
  function drummer(x, y) {
    var e = base('drummer', x, y, 26, 5);
    e.speed = 55; e.stored = 0; e.ringT = 0; e.beat = 0;
    e.update = function (dt, w) {
      this.t += dt; this.beat += dt;
      toward(this, w.player.x, w.player.y, this.speed);
      this.x += this.vx * dt; this.y += this.vy * dt;
      if (w.muted) {
        this.stored = Math.min(3, this.stored + dt * 1.5); // danger accumulates
        this.ringT += dt;
      } else if (this.stored > 0.5) {
        // UNMUTE: release stored rings as radial burst (capped for fairness)
        var n = Math.min(8, Math.floor(this.stored * 4));
        for (var i = 0; i < n; i++) {
          var a = i / n * TAU + this.t;
          w.projectiles.push({ x: this.x, y: this.y, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240,
                               r: 7, life: 2.2, foe: true, color: '#c8a24a' });
        }
        if (w.audio) w.audio.hit();
        w.particles.burst(this.x, this.y, 14, '#c8a24a');
        this.stored = 0;
      } else { this.stored = Math.max(0, this.stored - dt); }
      if (this.flash > 0) this.flash -= dt;
    };
    e.hit = function () { this.hp--; this.flash = 0.08; return this.hp <= 0; };
    e.draw = function (g) {
      g.save(); g.translate(this.x, this.y);
      // frozen rings while storing
      if (this.stored > 0.3) {
        g.strokeStyle = '#c8a24a'; g.lineWidth = 2;
        for (var i = 1; i <= 3; i++) {
          g.globalAlpha = 0.25 + 0.2 * i;
          g.beginPath(); g.arc(0, 0, this.r + i * 12 + Math.sin(this.ringT * 6) * 3, 0, TAU); g.stroke();
        }
        g.globalAlpha = 1;
      }
      // speaker disc: concentric brass rings
      g.fillStyle = this.flash > 0 ? '#ffffff' : '#8a6f3a';
      g.beginPath(); g.arc(0, 0, this.r, 0, TAU); g.fill();
      g.strokeStyle = '#5c4a24'; g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, this.r * 0.66, 0, TAU); g.stroke();
      g.beginPath(); g.arc(0, 0, this.r * 0.33, 0, TAU); g.stroke();
      // pulsing cone
      var p = 0.5 + 0.5 * Math.sin(this.beat * 7.9); // ~126bpm pulse
      g.fillStyle = '#2a2416';
      g.beginPath(); g.arc(0, 0, this.r * 0.33 * (0.7 + 0.5 * p), 0, TAU); g.fill();
      g.fillStyle = '#D94A32';
      g.beginPath(); g.arc(0, 0, 4, 0, TAU); g.fill();
      g.restore();
    };
    return e;
  }

  /* ---- TRACKER: waveform hound. Silence -> charges along "last known signal vector". ---- */
  function tracker(x, y) {
    var e = base('tracker', x, y, 14, 2);
    e.speed = 150; e.charge = 0; e.windup = 0; e.cdx = 0; e.cdy = 0; e.wag = 0;
    e.update = function (dt, w) {
      this.t += dt; this.wag += dt * 14;
      if (w.muted) {
        if (this.charge <= 0 && this.windup <= 0) {
          // lock last known signal vector, telegraph, THEN charge
          var dx = w.player.x - this.x, dy = w.player.y - this.y, d = Math.hypot(dx, dy) || 1;
          this.cdx = dx / d; this.cdy = dy / d;
          this.windup = 0.35;
          if (w.audio) w.audio._blip(160, 0.2, 0.25, 'sawtooth');
        }
      }
      if (this.windup > 0) {
        this.windup -= dt;
        // shake in place, flashing — the tell
        this.x += (Math.random() - 0.5) * 4; this.y += (Math.random() - 0.5) * 4;
        if (this.windup <= 0) this.charge = 0.55;
      } else if (this.charge > 0) {
        this.charge -= dt;
        this.x += this.cdx * 520 * dt; this.y += this.cdy * 520 * dt;
        // charge can strike other enemies (mastery: counter-kills)
        var list = w.director.enemies;
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          if (o !== this && !o.dead && dist(this.x, this.y, o.x, o.y) < this.r + o.r + 4) {
            o.hp -= 2; o.flash = 0.1;
            if (o.type === 'screecher') o.shieldStripped = 1.0; // charge strips shield (persists via the shield system)
            if (o.hp <= 0) { o.dead = true; o.counter = true; w.director.onKill(o, true); }
            w.particles.burst(o.x, o.y, 8, '#7FA66A');
          }
        }
      } else {
        // prowl: sine-wave slink toward player
        toward(this, w.player.x, w.player.y, this.speed);
        var px = -this.vy, py = this.vx, pl = Math.hypot(px, py) || 1;
        this.x += (this.vx + px / pl * Math.sin(this.wag) * 90) * dt;
        this.y += (this.vy + py / pl * Math.sin(this.wag) * 90) * dt;
      }
      this.x = Math.max(this.r, Math.min(w.W - this.r, this.x));
      this.y = Math.max(this.r, Math.min(w.H - this.r, this.y));
      if (this.flash > 0) this.flash -= dt;
    };
    e.hit = function () { this.hp--; this.flash = 0.08; return this.hp <= 0; };
    e.draw = function (g) {
      g.save(); g.translate(this.x, this.y);
      var committed = this.windup > 0 || this.charge > 0;
      var ang = committed ? Math.atan2(this.cdy, this.cdx) : Math.atan2(this.vy, this.vx || 1);
      g.rotate(ang);
      // waveform body: jagged line beast
      g.strokeStyle = this.flash > 0 ? '#ffffff' : '#7FA66A';
      g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath();
      for (var i = 0; i <= 12; i++) {
        var x = -this.r + (i / 12) * this.r * 2;
        var y = Math.sin(i * 2.2 + this.wag) * 7 * (1 - Math.abs(i - 6) / 8);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      // head
      g.fillStyle = '#7FA66A';
      g.beginPath(); g.arc(this.r + 4, 0, 7, 0, TAU); g.fill();
      g.fillStyle = (this.charge > 0 || this.windup > 0) ? '#D94A32' : '#11120F';
      g.beginPath(); g.arc(this.r + 6, -2, 2.4, 0, TAU); g.fill();
      // windup telegraph: dashed vector line
      if (this.windup > 0) {
        g.strokeStyle = 'rgba(217,74,50,0.7)'; g.lineWidth = 2;
        g.setLineDash([8, 6]);
        g.beginPath(); g.moveTo(this.r + 10, 0); g.lineTo(this.r + 130, 0); g.stroke();
        g.setLineDash([]);
      }
      g.restore();
    };
    return e;
  }

  /* ---- FEEDBACK: unstable waveform orb. Silence swells it toward detonation. ---- */
  function feedback(x, y) {
    var e = base('feedback', x, y, 15, 2);
    e.speed = 70; e.swell = 0; e.pulse = 0;
    e.update = function (dt, w) {
      this.t += dt; this.pulse += dt * (2 + this.swell * 6);
      toward(this, w.player.x, w.player.y, this.speed * 0.5);
      this.x += this.vx * dt; this.y += this.vy * dt;
      if (w.muted) {
        this.swell += dt * 0.8;
        if (this.swell >= 1.6 && !this.dead) {
          // DETONATION
          this.dead = true;
          w.director.onDetonate(this);
        }
      } else {
        this.swell = Math.max(0, this.swell - dt * 1.2); // unmute vents it
      }
      if (this.flash > 0) this.flash -= dt;
    };
    e.hit = function (w) {
      this.hp--; this.flash = 0.08;
      if (this.hp <= 0 && this.swell < 1.2) this.counter = true; // popped before swelling = skill
      return this.hp <= 0;
    };
    e.draw = function (g) {
      g.save(); g.translate(this.x, this.y);
      var rr = this.r * (1 + this.swell * 0.55 + Math.sin(this.pulse) * 0.08);
      var glow = Math.min(1, this.swell);
      g.fillStyle = this.flash > 0 ? '#ffffff' : 'rgba(216,208,184,' + (0.35 + glow * 0.6) + ')';
      g.beginPath();
      var n = 16;
      for (var i = 0; i <= n; i++) {
        var a = i / n * TAU;
        var wob = rr * (1 + 0.18 * Math.sin(a * 5 + this.pulse * 3));
        var px = Math.cos(a) * wob, py = Math.sin(a) * wob;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath(); g.fill();
      g.strokeStyle = glow > 0.5 ? '#D94A32' : '#8a7f5c'; g.lineWidth = 2; g.stroke();
      // unstable core
      g.fillStyle = '#D94A32';
      g.beginPath(); g.arc(0, 0, 3 + glow * 5, 0, TAU); g.fill();
      // warning ring as it nears detonation
      if (this.swell > 0.8) {
        g.strokeStyle = '#D94A32'; g.globalAlpha = 0.5 + 0.5 * Math.sin(this.pulse * 4);
        g.beginPath(); g.arc(0, 0, rr + 10, 0, TAU); g.stroke(); g.globalAlpha = 1;
      }
      g.restore();
    };
    return e;
  }

  /* ---- WRAITH: a frequency with no body. Silence is the only way it becomes visible. ----
   * Unmuted: faint shimmer, intangible — bullets pass through, contact is harmless.
   * Muted: snaps solid (reveal burst), vulnerable, and kills under silence are counter-kills.
   * This is the frame Grok asked for: a correct mute is the ONLY way the enemy becomes visible. */
  function wraith(x, y) {
    var e = base('wraith', x, y, 16, 2);
    e.speed = 85;
    e.solid = 0;            // 0 = shimmer, 1 = fully solid
    e.revealed = false;     // reveal burst fired for this mute press
    e.intangible = true;    // game.js skips touch damage while true
    e.update = function (dt, w) {
      this.t += dt;
      var target = w.muted ? 1 : 0;
      var prev = this.solid;
      this.solid += (target - this.solid) * Math.min(1, dt * 7);
      this.intangible = !w.muted;
      if (!w.muted) this.revealed = false;
      // the reveal frame: correct mute snaps it into the picture
      if (w.muted && !this.revealed && prev < 0.5 && this.solid >= 0.5) {
        this.revealed = true;
        w.particles.shockwave(this.x, this.y, 60, '#7FA66A');
        w.particles.burst(this.x, this.y, 10, '#7FA66A');
        if (w.audio) w.audio._blip(660, 0.16, 0.3, 'sine');
      }
      toward(this, w.player.x, w.player.y, this.speed * (w.muted ? 1 : 0.35));
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.x = Math.max(this.r, Math.min(w.W - this.r, this.x));
      this.y = Math.max(this.r, Math.min(w.H - this.r, this.y));
      if (this.flash > 0) this.flash -= dt;
    };
    e.hit = function (w) {
      if (this.solid < 0.5) { if (w.audio) w.audio.hit(); return false; } // passes through
      this.hp--;
      this.flash = 0.08;
      if (w.muted) this.counter = true; // revealed by your silence = counter-kill
      return this.hp <= 0;
    };
    e.draw = function (g) {
      var s = this.solid;
      g.save(); g.translate(this.x, this.y);
      if (s < 0.5) {
        // shimmer: the thing that is only a frequency
        g.globalAlpha = 0.10 + 0.06 * Math.sin(this.t * 9);
        g.strokeStyle = '#7FA66A'; g.lineWidth = 2;
        for (var k = 0; k < 3; k++) {
          g.beginPath();
          for (var i = 0; i <= 14; i++) {
            var x = -this.r + (i / 14) * this.r * 2;
            var y = Math.sin(i * 1.8 + this.t * 7 + k * 2.1) * 6;
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
        }
      } else {
        // solid: interference body — layered waveforms braided into mass
        if (this.flash > 0) { g.globalAlpha = 1; }
        g.lineWidth = 4; g.lineCap = 'round';
        for (var b = 0; b < 4; b++) {
          var ph = this.t * 3 + b * 1.7;
          g.strokeStyle = this.flash > 0 ? '#ffffff' : (b % 2 ? '#7FA66A' : '#a8bf95');
          g.globalAlpha = 0.55 + b * 0.15;
          g.beginPath();
          for (var j = 0; j <= 16; j++) {
            var yy = -this.r + (j / 16) * this.r * 2;
            var xx = Math.sin(yy * 0.35 + ph) * (this.r * 0.7) * Math.sin((j / 16) * Math.PI);
            if (j === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy);
          }
          g.stroke();
        }
        g.globalAlpha = 1;
        // vermilion core: the heart the cut exposed
        g.fillStyle = this.flash > 0 ? '#ffffff' : '#D94A32';
        g.beginPath(); g.arc(0, 0, 5 + Math.sin(this.t * 6) * 1.5, 0, TAU); g.fill();
      }
      g.restore();
    };
    return e;
  }

  /* ---- STATION VOICE: final boss. 3 phases driven by the player's recorded rhythm. ---- */
  function stationVoice(x, y, recording) {
    var e = base('stationvoice', x, y, 90, 60);
    e.rec = recording || { fires: [], moves: [], mutes: [] };
    e.phase = 1;
    e.atkT = 0; e.sweepA = 0; e.intro = 2.5;
    e.mouth = 0;
    // derive attack data from recording
    e.fireCadence = deriveCadence(e.rec.fires);
    e.moveDirs = deriveMoveDirs(e.rec.moves);
    e.muteZones = deriveMuteZones(e.rec.mutes);
    e.update = function (dt, w) {
      this.t += dt; this.mouth += dt * 3;
      if (this.intro > 0) { this.intro -= dt; return; }
      var frac = this.hp / this.maxHp;
      this.phase = frac > 0.66 ? 1 : (frac > 0.33 ? 2 : 3);
      this.atkT -= dt;
      var p = w.player;
      if (this.phase === 1) {
        // firing rhythm -> projectile patterns at the player's cadence
        if (this.atkT <= 0) {
          this.atkT = this.fireCadence;
          var n = 5, spread = 0.9;
          var baseA = Math.atan2(p.y - this.y, p.x - this.x);
          for (var i = 0; i < n; i++) {
            var a = baseA + (i / (n - 1) - 0.5) * spread;
            w.projectiles.push({ x: this.x, y: this.y + 40, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300,
                                 r: 8, life: 3, foe: true, color: '#D94A32' });
          }
          if (w.audio) w.audio._blip(98, 0.25, 0.4, 'sawtooth');
          w.particles.burst(this.x, this.y + 40, 6, '#D94A32');
        }
      } else if (this.phase === 2) {
        // movement -> sweeping vectors along the player's dominant directions
        if (this.atkT <= 0) {
          this.atkT = 1.6;
          var dir = this.moveDirs.length ? this.moveDirs[Math.floor(Math.random() * this.moveDirs.length)] : { x: 1, y: 0 };
          w.hazards.push({ kind: 'sweep', x: this.x, y: this.y, dx: dir.x, dy: dir.y,
                           width: 90, length: 900, t: 0, dur: 1.4, telegraph: 0.7 });
          if (w.audio) w.audio._blip(65, 0.5, 0.5, 'sawtooth');
        }
      } else {
        // MUTE timing -> arena signal cuts where the player used to mute
        if (this.atkT <= 0) {
          this.atkT = 2.2;
          var z = this.muteZones.length ? this.muteZones[Math.floor(Math.random() * this.muteZones.length)] : { x: p.x, y: p.y };
          w.hazards.push({ kind: 'cut', x: z.x, y: z.y, r: 120, t: 0, dur: 2.0, telegraph: 0.9 });
          // plus a tight aimed burst
          var a2 = Math.atan2(p.y - this.y, p.x - this.x);
          for (var j = -1; j <= 1; j++) {
            w.projectiles.push({ x: this.x, y: this.y + 40, vx: Math.cos(a2 + j * 0.18) * 360, vy: Math.sin(a2 + j * 0.18) * 360,
                                 r: 7, life: 2.5, foe: true, color: '#D94A32' });
          }
          if (w.audio) w.audio._blip(55, 0.4, 0.5, 'sawtooth');
        }
      }
      // slow drift toward arena top-center
      this.x += (w.W / 2 - this.x) * dt * 0.3;
      this.y += (150 - this.y) * dt * 0.3;
      if (this.flash > 0) this.flash -= dt;
    };
    e.hit = function () { this.hp--; this.flash = 0.08; return this.hp <= 0; };
    e.draw = function (g) {
      g.save(); g.translate(this.x, this.y);
      if (this.intro > 0) g.globalAlpha = 1 - this.intro / 2.5;
      // arena architecture: dark housing
      g.fillStyle = '#1c1d18';
      g.strokeStyle = '#8a6f3a'; g.lineWidth = 4;
      g.beginPath();
      g.moveTo(-130, 90); g.lineTo(-110, -60); g.lineTo(-70, -110);
      g.lineTo(70, -110); g.lineTo(110, -60); g.lineTo(130, 90); g.closePath();
      g.fill(); g.stroke();
      // cracked speaker cone
      var open = 0.5 + 0.5 * Math.sin(this.mouth);
      g.fillStyle = '#0c0d0a';
      g.beginPath(); g.ellipse(0, 10, 62, 44 + open * 18, 0, 0, TAU); g.fill();
      // vermilion cracks (phase-reactive)
      g.strokeStyle = '#D94A32'; g.lineWidth = 2 + this.phase;
      var cracks = 5 + this.phase * 2;
      for (var i = 0; i < cracks; i++) {
        var a = i / cracks * TAU + this.t * 0.15;
        g.beginPath();
        g.moveTo(Math.cos(a) * 20, 10 + Math.sin(a) * 16);
        g.lineTo(Math.cos(a) * 58, 10 + Math.sin(a) * 42);
        g.stroke();
      }
      // mouth glow
      g.fillStyle = 'rgba(217,74,50,' + (0.25 + open * 0.4) + ')';
      g.beginPath(); g.ellipse(0, 10, 30, 18 + open * 12, 0, 0, TAU); g.fill();
      // phase pips
      for (var k = 0; k < 3; k++) {
        g.fillStyle = k < this.phase ? '#D94A32' : '#3d4436';
        g.beginPath(); g.arc(-24 + k * 24, -88, 7, 0, TAU); g.fill();
      }
      g.restore();
    };
    return e;
  }

  /* ---- recording -> boss data ---- */
  function deriveCadence(fires) {
    if (!fires || fires.length < 4) return 0.9;
    var gaps = [];
    for (var i = 1; i < fires.length; i++) gaps.push(fires[i] - fires[i - 1]);
    gaps.sort(function (a, b) { return a - b; });
    var med = gaps[Math.floor(gaps.length / 2)];
    return Math.max(0.35, Math.min(1.6, med * 1.15));
  }
  function deriveMoveDirs(moves) {
    var dirs = [];
    if (!moves) return dirs;
    for (var i = 1; i < moves.length; i++) {
      var dx = moves[i].x - moves[i - 1].x, dy = moves[i].y - moves[i - 1].y;
      var d = Math.hypot(dx, dy);
      if (d > 40) dirs.push({ x: dx / d, y: dy / d });
    }
    return dirs.slice(-24);
  }
  function deriveMuteZones(mutes) {
    var zones = [];
    if (!mutes) return zones;
    for (var i = 0; i < mutes.length; i++) zones.push({ x: mutes[i].x, y: mutes[i].y });
    return zones.slice(-12);
  }

  SC.Enemies = {
    screecher: screecher,
    drummer: drummer,
    tracker: tracker,
    feedback: feedback,
    wraith: wraith,
    stationVoice: stationVoice
  };
})();
