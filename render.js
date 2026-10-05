/* STATIC CUT — render.js
 * Canvas renderer: 1280x720 internal, half-res phosphor buffer, object-pooled
 * particles, MUTE crush (~120ms toward horizontal axis), CRT decay
 * (minute 1 rich -> minute 5 starvation), HUD + screens.
 */
(function () {
  'use strict';
  window.SC = window.SC || {};

  var W = 1280, H = 720;
  var POOL = 500;

  function Particles() {
    this.items = [];
    for (var i = 0; i < POOL; i++) {
      this.items.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, color: '#fff', ring: false, maxR: 0 });
    }
    this.cursor = 0;
  }
  Particles.prototype._next = function () {
    var p = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % POOL;
    return p;
  };
  Particles.prototype.burst = function (x, y, n, color) {
    for (var i = 0; i < n; i++) {
      var p = this._next(), a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 260;
      p.x = x; p.y = y; p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
      p.max = p.life = 0.4 + Math.random() * 0.5;
      p.size = 1.5 + Math.random() * 3; p.color = color; p.ring = false;
    }
  };
  Particles.prototype.shockwave = function (x, y, maxR, color) {
    var p = this._next();
    p.x = x; p.y = y; p.vx = 0; p.vy = 0;
    p.max = p.life = 0.45; p.color = color; p.ring = true; p.maxR = maxR;
  };
  Particles.prototype.update = function (dt) {
    for (var i = 0; i < POOL; i++) {
      var p = this.items[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.96; p.vy *= 0.96;
    }
  };
  Particles.prototype.draw = function (g) {
    for (var i = 0; i < POOL; i++) {
      var p = this.items[i];
      if (p.life <= 0) continue;
      var a = Math.max(0, p.life / p.max);
      if (p.ring) {
        var rr = p.maxR * (1 - a);
        g.strokeStyle = p.color; g.globalAlpha = a; g.lineWidth = 3;
        g.beginPath(); g.arc(p.x, p.y, rr, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 1;
      } else {
        g.fillStyle = p.color; g.globalAlpha = a;
        g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        g.globalAlpha = 1;
      }
    }
  };

  function Render(canvas) {
    this.canvas = canvas;
    canvas.width = W; canvas.height = H;
    this.g = canvas.getContext('2d');
    // half-res phosphor buffer
    this.buf = document.createElement('canvas');
    this.buf.width = W / 2; this.buf.height = H / 2;
    this.bg = this.buf.getContext('2d');
    this.particles = new Particles();
    this.crush = 0;        // 0..1 eased toward mute target
    this.shake = 0;
    this.starve = 0;       // 0 (rich CRT) -> 1 (visual starvation)
    this.reducedMotion = false;
    this.scanPhase = 0;
  }

  Render.prototype.resize = function () {
    // CSS scales; keep internal 1280x720. Canvas CSS handled in style.css.
  };

  // background: decommissioned broadcast laboratory
  Render.prototype._drawLab = function (g, t) {
    g.fillStyle = '#11120F';
    g.fillRect(0, 0, W, H);
    // floor grid, dim brass
    g.strokeStyle = 'rgba(140,120,70,0.10)';
    g.lineWidth = 1;
    var step = 80;
    for (var x = 0; x <= W; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (var y = 0; y <= H; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    // broadcast towers (silhouettes) — parallax-static set dressing
    g.fillStyle = 'rgba(30,32,26,0.9)';
    var towers = [[120, 300], [1150, 260], [640, 560]];
    for (var i = 0; i < towers.length; i++) {
      var tx = towers[i][0], ty = towers[i][1];
      g.fillRect(tx - 6, ty - 180, 12, 180);
      g.beginPath(); g.moveTo(tx - 30, ty - 180); g.lineTo(tx + 30, ty - 180); g.lineTo(tx, ty - 220); g.closePath(); g.fill();
      // blinking beacon
      var bl = (Math.sin(t * 2 + i * 2) * 0.5 + 0.5);
      g.fillStyle = 'rgba(217,74,50,' + (0.25 + bl * 0.6 * (1 - this.starve * 0.7)) + ')';
      g.beginPath(); g.arc(tx, ty - 224, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(30,32,26,0.9)';
    }
    // drifting dust in the signal
    g.fillStyle = 'rgba(216,208,184,0.05)';
    for (var d = 0; d < 24; d++) {
      var dx = (d * 197 + t * 12) % W, dy = (d * 331 + t * 7) % H;
      g.fillRect(dx, dy, 2, 2);
    }
  };

  Render.prototype.drawWorld = function (world, dt) {
    var g = this.g, bg = this.bg;
    var t = world.time;

    // ease crush toward target (120ms)
    var target = world.player.muting ? 1 : 0;
    var k = Math.min(1, dt / 0.12);
    this.crush += (target - this.crush) * k;
    this.starve = Math.min(1, world.director.runT / 300);

    // screen shake (disabled under reduced motion)
    var shx = 0, shy = 0;
    if (!this.reducedMotion && this.shake > 0) {
      this.shake -= dt;
      shx = (Math.random() - 0.5) * 10 * this.shake;
      shy = (Math.random() - 0.5) * 10 * this.shake;
    }

    // --- draw scene into half-res buffer ---
    bg.save();
    bg.scale(0.5, 0.5);
    bg.translate(shx, shy);
    this._drawLab(bg, t);

    // hazards (telegraphs)
    this._drawHazards(bg, world);

    // enemies
    var list = world.director.enemies;
    for (var i = 0; i < list.length; i++) {
      if (!list[i].dead) list[i].draw(bg);
    }
    // player projectiles + foe projectiles
    this._drawProjectiles(bg, world.projectiles);
    // player
    if (world.player.alive) world.player.draw(bg, world.player.muting);
    // particles
    this.particles.draw(bg);
    bg.restore();

    // --- composite to main canvas with phosphor tint + crush ---
    g.save();
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    // crush: scale Y toward horizontal axis
    var cy = H / 2;
    var sy = 1 - this.crush * 0.82;
    g.translate(0, cy);
    g.scale(1, sy);
    g.translate(0, -cy);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.buf, 0, 0, W, H);
    // phosphor green wash, stronger at edges when starving
    g.globalCompositeOperation = 'overlay';
    g.fillStyle = 'rgba(127,166,106,' + (0.06 + this.crush * 0.10) + ')';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    g.restore();

    // scanlines: rich early, starved late
    this._scanlines(g, t);
    // vignette
    var vg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,' + (0.35 + this.starve * 0.25) + ')');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);

    this.drawHUD(g, world);
  };

  Render.prototype._drawProjectiles = function (g, arr) {
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i];
      if (p.foe) {
        g.fillStyle = p.color || '#D94A32';
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(p.x, p.y, p.r * 0.35, 0, Math.PI * 2); g.fill();
      } else {
        g.strokeStyle = '#D8D0B8'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
        g.lineTo(p.x, p.y); g.stroke();
        g.fillStyle = '#7FA66A';
        g.beginPath(); g.arc(p.x, p.y, 3, 0, Math.PI * 2); g.fill();
      }
    }
  };

  Render.prototype._drawHazards = function (g, world) {
    var hs = world.hazards;
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      var active = h.t > h.telegraph;
      if (h.kind === 'sweep') {
        g.save();
        g.translate(h.x, h.y);
        g.rotate(Math.atan2(h.dy, h.dx));
        if (!active) {
          g.strokeStyle = 'rgba(217,74,50,0.5)'; g.lineWidth = 2;
          g.setLineDash([12, 10]);
          g.strokeRect(0, -h.width / 2, h.length, h.width);
          g.setLineDash([]);
        } else {
          var a = this.reducedMotion ? 0.5 : (0.5 + 0.4 * Math.sin(h.t * 30));
          g.fillStyle = 'rgba(217,74,50,' + a + ')';
          g.fillRect(0, -h.width / 2, h.length, h.width);
        }
        g.restore();
      } else if (h.kind === 'cut') {
        if (!active) {
          g.strokeStyle = 'rgba(217,74,50,0.6)'; g.lineWidth = 2;
          g.setLineDash([10, 8]);
          g.beginPath(); g.arc(h.x, h.y, h.r, 0, Math.PI * 2); g.stroke();
          g.setLineDash([]);
        } else {
          var a2 = this.reducedMotion ? 0.45 : (0.45 + 0.35 * Math.sin(h.t * 26));
          g.fillStyle = 'rgba(217,74,50,' + a2 + ')';
          g.beginPath(); g.arc(h.x, h.y, h.r, 0, Math.PI * 2); g.fill();
          // static noise marks
          g.strokeStyle = '#11120F'; g.lineWidth = 1;
          for (var s = 0; s < 8; s++) {
            var ang = s / 8 * Math.PI * 2 + h.t;
            g.beginPath();
            g.moveTo(h.x + Math.cos(ang) * h.r * 0.3, h.y + Math.sin(ang) * h.r * 0.3);
            g.lineTo(h.x + Math.cos(ang) * h.r * 0.9, h.y + Math.sin(ang) * h.r * 0.9);
            g.stroke();
          }
        }
      }
    }
  };

  Render.prototype._scanlines = function (g, t) {
    this.scanPhase += 0.05;
    var alpha = 0.10 * (1 - this.starve * 0.75) + 0.02;
    g.fillStyle = 'rgba(0,0,0,' + alpha.toFixed(3) + ')';
    for (var y = 0; y < H; y += 4) g.fillRect(0, y, W, 2);
    // rolling band (rich CRT feel, dies with starvation)
    if (this.starve < 0.8) {
      var by = (t * 90) % (H + 200) - 100;
      var grad = g.createLinearGradient(0, by - 60, 0, by + 60);
      grad.addColorStop(0, 'rgba(127,166,106,0)');
      grad.addColorStop(0.5, 'rgba(127,166,106,' + (0.06 * (1 - this.starve)) + ')');
      grad.addColorStop(1, 'rgba(127,166,106,0)');
      g.fillStyle = grad;
      g.fillRect(0, by - 60, W, 120);
    }
  };

  /* ---------- HUD ---------- */
  Render.prototype.drawHUD = function (g, world) {
    var d = world.director, p = world.player;
    g.save();
    g.textBaseline = 'top';
    // score
    g.fillStyle = '#D8D0B8';
    g.font = '700 34px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText(String(d.score).padStart(6, '0'), 28, 22);
    // PB
    var pb = SC.Storage.getPB();
    g.font = '400 16px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = '#8a7f5c';
    g.fillText('PB ' + (pb ? String(pb.score).padStart(6, '0') : '------'), 28, 62);
    // band
    var band = SC.BANDS[d.band - 1];
    g.font = '700 20px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = '#7FA66A';
    g.textAlign = 'center';
    g.fillText('BAND ' + d.band + ' // ' + band.name, W / 2, 24);
    // combo
    if (d.combo > 1) {
      g.fillStyle = '#D94A32';
      g.font = '700 26px "IBM Plex Mono", ui-monospace, monospace';
      g.fillText('x' + Math.min(5, d.combo) + ' COMBO', W / 2, 52);
    }
    g.textAlign = 'left';
    // HP pips
    for (var i = 0; i < p.maxHp; i++) {
      g.fillStyle = i < p.hp ? '#D94A32' : '#3d332a';
      g.beginPath(); g.arc(40 + i * 30, 110, 9, 0, Math.PI * 2); g.fill();
    }
    // heat bar
    var bx = W - 320, bw = 280;
    g.fillStyle = '#3d332a';
    g.fillRect(bx, 30, bw, 14);
    var hg = p.overheated ? '#D94A32' : (p.muting ? '#7FA66A' : '#c8a24a');
    g.fillStyle = hg;
    g.fillRect(bx, 30, bw * (p.heat / 100), 14);
    g.fillStyle = '#8a7f5c';
    g.font = '400 14px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText(p.overheated ? 'OVERHEAT — SIGNAL LOCKED' : 'MUTE HEAT [SPACE]', bx, 50);
    // mute indicator
    if (p.muting) {
      g.fillStyle = '#7FA66A';
      g.font = '700 22px "IBM Plex Mono", ui-monospace, monospace';
      g.textAlign = 'center';
      var pulse = this.reducedMotion ? 1 : (0.7 + 0.3 * Math.sin(world.time * 10));
      g.globalAlpha = pulse;
      g.fillText('// SILENCE //', W / 2, H - 60);
      g.globalAlpha = 1;
      g.textAlign = 'left';
    }
    // boss HP
    if (d.boss) {
      var bwid = 560;
      g.fillStyle = '#3d332a';
      g.fillRect(W / 2 - bwid / 2, H - 44, bwid, 12);
      g.fillStyle = '#D94A32';
      g.fillRect(W / 2 - bwid / 2, H - 44, bwid * Math.max(0, d.boss.hp / d.boss.maxHp), 12);
      g.fillStyle = '#D8D0B8';
      g.font = '700 16px "IBM Plex Mono", ui-monospace, monospace';
      g.textAlign = 'center';
      g.fillText('STATION VOICE', W / 2, H - 68);
      g.textAlign = 'left';
    }
    // brand
    g.fillStyle = 'rgba(138,127,92,0.8)';
    g.font = '400 13px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText('Built by AAFC', 28, H - 30);
    g.restore();
  };

  /* ---------- screens ---------- */
  Render.prototype._plate = function (g, title, lines, accent) {
    g.save();
    g.fillStyle = 'rgba(10,11,9,0.72)';
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.fillStyle = accent || '#D8D0B8';
    g.font = '900 72px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText(title, W / 2, H / 2 - 60);
    g.font = '400 20px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = '#8a7f5c';
    for (var i = 0; i < lines.length; i++) {
      g.fillText(lines[i], W / 2, H / 2 + i * 34);
    }
    g.restore();
  };

  Render.prototype.drawBoot = function (g, t) {
    // 3s ident: calibration line -> plate -> vermilion stamp -> waveform becomes title
    g.fillStyle = '#0a0b09'; g.fillRect(0, 0, W, H);
    g.save(); g.textAlign = 'center';
    if (t < 0.8) {
      g.strokeStyle = '#7FA66A'; g.lineWidth = 3;
      g.beginPath();
      var n = 120;
      for (var i = 0; i <= n; i++) {
        var x = W / 2 - 300 + (i / n) * 600;
        var y = H / 2 + Math.sin(i * 0.6 + t * 20) * 20 * (i / n);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    } else if (t < 1.8) {
      g.fillStyle = '#D8D0B8';
      g.font = '700 30px "IBM Plex Mono", ui-monospace, monospace';
      g.fillText('AAFC // SIGNAL SYSTEMS UNIT 001', W / 2, H / 2 - 20);
      if (t > 1.3) {
        g.fillStyle = '#D94A32';
        g.font = '900 22px "IBM Plex Mono", ui-monospace, monospace';
        g.fillText('[ SIGNAL LOCKED ]', W / 2, H / 2 + 30);
      }
    } else {
      // waveform collapses into title
      var k = Math.min(1, (t - 1.8) / 0.9);
      g.strokeStyle = '#7FA66A'; g.lineWidth = 2;
      g.beginPath();
      var m2 = 160;
      for (var j = 0; j <= m2; j++) {
        var x2 = W / 2 - 360 + (j / m2) * 720;
        var amp = 46 * (1 - k);
        var y2 = H / 2 - 40 + Math.sin(j * 0.35) * amp;
        if (j === 0) g.moveTo(x2, y2); else g.lineTo(x2, y2);
      }
      g.stroke();
      g.globalAlpha = k;
      g.fillStyle = '#D8D0B8';
      g.font = '900 84px "IBM Plex Mono", ui-monospace, monospace';
      g.fillText('STATIC//CUT', W / 2, H / 2 + 60);
      g.globalAlpha = 1;
    }
    g.restore();
  };

  Render.prototype.drawTitle = function (g, t) {
    this._drawLab(g, t);
    g.save();
    g.fillStyle = 'rgba(10,11,9,0.55)';
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    // hero waveform
    g.strokeStyle = '#7FA66A'; g.lineWidth = 3;
    g.beginPath();
    for (var i = 0; i <= 200; i++) {
      var x = W / 2 - 420 + (i / 200) * 840;
      var y = 250 + Math.sin(i * 0.22 + t * 2.4) * 34 * Math.sin(i * 0.05 + t);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = '#D8D0B8';
    g.font = '900 96px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText('STATIC//CUT', W / 2, 400);
    g.fillStyle = '#7FA66A';
    g.font = '400 22px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText('Cut the signal. Survive the silence.', W / 2, 448);
    var pb = SC.Storage.getPB();
    g.fillStyle = '#8a7f5c';
    g.font = '400 18px "IBM Plex Mono", ui-monospace, monospace';
    var blink = this.reducedMotion ? 1 : (0.55 + 0.45 * Math.sin(t * 4));
    g.globalAlpha = blink;
    g.fillText('PRESS ENTER OR CLICK TO TUNE IN', W / 2, 540);
    g.globalAlpha = 1;
    if (pb) g.fillText('PERSONAL BEST ' + pb.score, W / 2, 576);
    g.fillText('WASD MOVE · MOUSE AIM · CLICK FIRE · HOLD SPACE TO MUTE', W / 2, 620);
    g.fillText('ARROWS AIM TOO — FULL KEYBOARD PLAY SUPPORTED', W / 2, 648);
    g.fillStyle = 'rgba(138,127,92,0.9)';
    g.fillText('Built by AAFC', W / 2, 690);
    g.restore();
  };

  Render.prototype.drawVictory = function (g, world) {
    var d = world.director;
    g.fillStyle = '#0a0b09'; g.fillRect(0, 0, W, H);
    // victory trace: waveform carrying four band scars writes the score
    g.save(); g.textAlign = 'center';
    g.strokeStyle = '#7FA66A'; g.lineWidth = 3;
    g.beginPath();
    var scars = [0.18, 0.38, 0.58, 0.78]; // four band scars
    for (var i = 0; i <= 220; i++) {
      var x = W / 2 - 440 + (i / 220) * 880;
      var scar = 0;
      for (var s = 0; s < 4; s++) {
        if (Math.abs(i / 220 - scars[s]) < 0.02) scar = 26;
      }
      var y = 260 + Math.sin(i * 0.2) * 30 + (Math.random() - 0.5) * scar;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = '#D8D0B8';
    g.font = '900 64px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText(String(d.score).padStart(6, '0'), W / 2, 400);
    var isPB = world.newPB;
    g.fillStyle = isPB ? '#D94A32' : '#7FA66A';
    g.font = '700 26px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText(isPB ? 'NEW PERSONAL BEST' : 'TRANSMISSION SURVIVED', W / 2, 460);
    g.fillStyle = '#8a7f5c';
    g.font = '400 18px "IBM Plex Mono", ui-monospace, monospace';
    g.fillText('KILLS ' + d.kills + ' · COUNTER-KILLS ' + d.counterKills, W / 2, 510);
    g.globalAlpha = this.reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(world.time * 3);
    g.fillText('PRESS ENTER TO RUN IT BACK', W / 2, 570);
    g.globalAlpha = 1;
    g.restore();
  };

  Render.prototype.drawGameOver = function (g, world) {
    var d = world.director;
    this._plate(g, 'SIGNAL LOST', [
      'SCORE ' + d.score,
      'BAND ' + d.band + ' // ' + SC.BANDS[d.band - 1].name,
      'KILLS ' + d.kills + ' · COUNTER-KILLS ' + d.counterKills,
      '',
      'PRESS ENTER TO RETUNE'
    ], '#D94A32');
  };

  Render.prototype.drawPaused = function (g) {
    this._plate(g, 'PAUSED', ['SIGNAL HELD', '', 'ESC / P TO RESUME'], '#c8a24a');
  };

  SC.Render = Render;
  SC.Particles = Particles;
  SC.GAME_W = W; SC.GAME_H = H;
})();
