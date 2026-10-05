/* STATIC CUT — game.js
 * Main loop, input, state machine (boot -> title -> run -> victory/gameover),
 * collisions, hazards, projectiles, pause, accessibility wiring.
 */
(function () {
  'use strict';
  window.SC = window.SC || {};

  var W = 1280, H = 720;
  var STATES = { BOOT: 0, TITLE: 1, RUN: 2, PAUSED: 3, VICTORY: 4, GAMEOVER: 5 };

  function Game() {
    this.canvas = document.getElementById('game');
    this.render = new SC.Render(this.canvas);
    this.audio = new SC.Audio();
    this.state = STATES.BOOT;
    this.bootT = 0;
    this.time = 0;
    this.titleT = 0;
    this.endT = 0;
    this.newPB = false;
    this.statusEl = document.getElementById('status');
    this.muteBtn = document.getElementById('muteBtn');
    this._setupInput();
    this._setupA11y();
    this.world = null;
    this._lastBand = 1;
  }

  Game.prototype._setupA11y = function () {
    var settings = SC.Storage.getSettings();
    var mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.render.reducedMotion = settings.reducedMotion !== null ? settings.reducedMotion : !!mq;
    var self = this;
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && self.state === STATES.RUN) self.pause();
    });
    window.addEventListener('blur', function () {
      if (self.state === STATES.RUN) self.pause();
    });
  };

  Game.prototype._setupInput = function () {
    var self = this;
    this.input = {
      up: false, down: false, left: false, right: false,
      aimX: 0, aimY: 0, firing: false, kbFire: false,
      mute: false, mouseX: W / 2, mouseY: H / 2, mouseActive: false
    };
    this._keys = {};
    // touch controls
    this.touch = { active: false, moveId: null, mx: 0, my: 0, aimId: null, ax: 0, ay: 0 };

    document.addEventListener('keydown', function (e) {
      if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
      self._keys[e.code] = true;
      self._pollKeys();
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (self.state === STATES.RUN) self.pause();
        else if (self.state === STATES.PAUSED) self.resume();
      }
      if (e.code === 'Enter') self._confirm();
      // first gesture unlocks audio
      self.audio.init(); self.audio.resume();
    });
    document.addEventListener('keyup', function (e) {
      self._keys[e.code] = false;
      self._pollKeys();
    });
    this.canvas.addEventListener('mousemove', function (e) {
      var r = self.canvas.getBoundingClientRect();
      self.input.mouseX = (e.clientX - r.left) / r.width * W;
      self.input.mouseY = (e.clientY - r.top) / r.height * H;
      self.input.mouseActive = true;
    });
    this.canvas.addEventListener('mousedown', function (e) {
      self.audio.init(); self.audio.resume();
      if (e.button === 0) {
        if (self.state === STATES.TITLE || self.state === STATES.VICTORY || self.state === STATES.GAMEOVER) {
          self._confirm();
        } else {
          self.input.firing = true;
        }
      }
    });
    document.addEventListener('mouseup', function () { self.input.firing = false; });
    this.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // MUTE touch button
    if (this.muteBtn) {
      var setMute = function (on) {
        self.audio.init(); self.audio.resume();
        self.input.mute = on;
        self.muteBtn.classList.toggle('on', on);
      };
      this.muteBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); setMute(true); });
      this.muteBtn.addEventListener('pointerup', function () { setMute(false); });
      this.muteBtn.addEventListener('pointercancel', function () { setMute(false); });
      this.muteBtn.addEventListener('pointerleave', function () { setMute(false); });
    }

    // touch joysticks: left half move, right half aim+fire
    this.canvas.addEventListener('touchstart', function (e) {
      self.audio.init(); self.audio.resume();
      if (self.state === STATES.TITLE || self.state === STATES.VICTORY || self.state === STATES.GAMEOVER) {
        self._confirm(); return;
      }
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        var r = self.canvas.getBoundingClientRect();
        var x = (t.clientX - r.left) / r.width * W;
        if (x < W / 2 && self.touch.moveId === null) {
          self.touch.moveId = t.identifier; self.touch.mx = x; self.touch.my = (t.clientY - r.top) / r.height * H;
          self.touch.sx = x; self.touch.sy = (t.clientY - r.top) / r.height * H;
        } else if (self.touch.aimId === null) {
          self.touch.aimId = t.identifier;
          self.touch.ax = x - self.world.player.x; self.touch.ay = (t.clientY - r.top) / r.height * H - self.world.player.y;
          self.input.firing = true; self.input.mouseActive = false;
        }
      }
      e.preventDefault();
    }, { passive: false });
    this.canvas.addEventListener('touchmove', function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        var r = self.canvas.getBoundingClientRect();
        var x = (t.clientX - r.left) / r.width * W, y = (t.clientY - r.top) / r.height * H;
        if (t.identifier === self.touch.moveId) { self.touch.mx = x; self.touch.my = y; }
        if (t.identifier === self.touch.aimId) {
          var dx = x - self.world.player.x, dy = y - self.world.player.y, d = Math.hypot(dx, dy) || 1;
          self.input.aimX = dx / d; self.input.aimY = dy / d; self.input.mouseActive = false;
        }
      }
      e.preventDefault();
    }, { passive: false });
    var endTouch = function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier === self.touch.moveId) { self.touch.moveId = null; self.input.left = self.input.right = self.input.up = self.input.down = false; }
        if (t.identifier === self.touch.aimId) { self.touch.aimId = null; self.input.firing = false; self.input.aimX = self.input.aimY = 0; }
      }
    };
    this.canvas.addEventListener('touchend', endTouch);
    this.canvas.addEventListener('touchcancel', endTouch);
  };

  Game.prototype._pollKeys = function () {
    var k = this._keys, inp = this.input;
    inp.up = !!(k.KeyW || k.ArrowUp);
    inp.down = !!(k.KeyS || k.ArrowDown);
    inp.left = !!(k.KeyA || k.ArrowLeft);
    inp.right = !!(k.KeyD || k.ArrowRight);
    // keyboard aim: arrows double as aim when WASD is used for move
    var wasd = k.KeyW || k.KeyA || k.KeyS || k.KeyD;
    if (wasd) {
      inp.aimX = (k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0);
      inp.aimY = (k.ArrowDown ? 1 : 0) - (k.ArrowUp ? 1 : 0);
      if (inp.aimX || inp.aimY) inp.mouseActive = false;
    } else { inp.aimX = 0; inp.aimY = 0; }
    inp.kbFire = !!k.KeyZ || !!k.KeyJ;
    inp.mute = !!k.Space || this.muteBtn && this.muteBtn.classList.contains('on');
    // touch move joystick
    if (this.touch.moveId !== null) {
      var dx = this.touch.mx - this.touch.sx, dy = this.touch.my - this.touch.sy;
      if (Math.hypot(dx, dy) > 24) {
        inp.left = dx < -24; inp.right = dx > 24; inp.up = dy < -24; inp.down = dy > 24;
      }
    }
  };

  Game.prototype._confirm = function () {
    this.audio.init(); this.audio.resume();
    if (this.state === STATES.TITLE) this.startRun();
    else if (this.state === STATES.VICTORY || this.state === STATES.GAMEOVER) this.toTitle();
  };

  Game.prototype.toTitle = function () {
    this.state = STATES.TITLE;
    this.titleT = 0;
    this._announce('Static Cut. Press Enter or click to tune in.');
  };

  Game.prototype.startRun = function () {
    this.world = {
      time: 0,
      muted: false,
      player: new SC.Player(W / 2, H / 2 + 120),
      director: new SC.Director(this.audio),
      projectiles: [],
      hazards: [],
      particles: this.render.particles,
      audio: this.audio,
      W: W, H: H,
      playerHurt: null,
      onBandChange: null
    };
    var self = this;
    this.world.director._world = this.world;
    this.world.playerHurt = function () {
      var died = self.world.player.hurt(self.audio);
      self.render.shake = self.render.reducedMotion ? 0 : 0.7;
      self.render.particles.burst(self.world.player.x, self.world.player.y, 18, '#D94A32');
      if (died) self.gameOver();
      return died;
    };
    this.world.onBandChange = function (band) {
      var healed = false;
      if (self.world.player.hp < self.world.player.maxHp) {
        self.world.player.hp++;
        healed = true;
      }
      self._announce('Band ' + band + ': ' + SC.BANDS[band - 1].name + (healed ? '. Hull restored.' : ''));
    };
    this._lastBand = 1;
    this.newPB = false;
    this.state = STATES.RUN;
    this.audio.start();
    this._announce('Run started. Band 1: Calibration. Hold Space to mute.');
  };

  Game.prototype.pause = function () {
    if (this.state !== STATES.RUN) return;
    this.state = STATES.PAUSED;
    this.audio.setMuted(false);
    this._announce('Paused. Signal held.');
  };
  Game.prototype.resume = function () {
    if (this.state !== STATES.PAUSED) return;
    this.state = STATES.RUN;
    this._announce('Resumed.');
  };

  Game.prototype.gameOver = function () {
    this.state = STATES.GAMEOVER;
    this.endT = 0;
    this.world.director.finishRun();
    this.audio.setMuted(false);
    this.audio.stop();
    this._announce('Signal lost. Score ' + this.world.director.score + '. Press Enter to retune.');
  };

  Game.prototype.victory = function () {
    this.state = STATES.VICTORY;
    this.endT = 0;
    var d = this.world.director;
    d.finishRun();
    this.audio.setMuted(false);
    this.audio.stop();
    this.audio.victory();
    this.newPB = SC.Storage.setPB(d.score, d.splits);
    this._announce('Transmission survived. Score ' + d.score + (this.newPB ? '. New personal best.' : '.'));
  };

  Game.prototype._announce = function (msg) {
    if (this.statusEl) this.statusEl.textContent = msg;
  };

  Game.prototype.update = function (dt) {
    this.time += dt;
    if (this.state === STATES.BOOT) {
      this.bootT += dt;
      if (this.bootT > 1.0 && !this._identPlayed) { this._identPlayed = true; this.audio.init(); this.audio.ident(); }
      if (this.bootT >= 3.0) this.toTitle();
      return;
    }
    if (this.state === STATES.TITLE) { this.titleT += dt; return; }
    if (this.state === STATES.PAUSED) return;
    if (this.state === STATES.VICTORY || this.state === STATES.GAMEOVER) {
      this.endT += dt;
      this.render.particles.update(dt);
      return;
    }
    // RUN
    var w = this.world, d = w.director, p = w.player;
    w.time += dt;
    var wasMuting = p.muting;
    var fireEvt = p.update(dt, this.input, this.audio, W, H);
    w.muted = p.muting; // sync BEFORE enemies read it
    if (fireEvt) {
      w.projectiles.push({ x: fireEvt.x, y: fireEvt.y, vx: fireEvt.dx * 720, vy: fireEvt.dy * 720,
                           r: 5, life: 1.1, foe: false });
      d.recordFire();
    }
    if (p.muting && !wasMuting) d.recordMute(p.x, p.y);
    d.update(dt, w);
    this.audio.update(dt);

    // enemies
    var list = d.enemies;
    for (var i = list.length - 1; i >= 0; i--) {
      var e = list[i];
      if (e.dead) {
        // death already scored at kill time except detonations
        if (e.type === 'feedback' && !e._scored && e.swell >= 1.6) {
          // detonated: no score, small consolation
        }
        list.splice(i, 1);
        continue;
      }
      e.update(dt, w);
      // touch damage
      if (p.alive && e.type !== 'stationvoice' &&
          Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r - 2) {
        w.playerHurt();
        e.hp -= 1;
        if (e.hp <= 0 && !e.dead) { e.dead = true; d.onKill(e, false); w.particles.burst(e.x, e.y, 12, '#D8D0B8'); }
      }
    }

    // projectiles
    var pr = w.projectiles;
    for (var j = pr.length - 1; j >= 0; j--) {
      var prj = pr[j];
      prj.x += prj.vx * dt; prj.y += prj.vy * dt;
      prj.life -= dt;
      var dead = prj.life <= 0 || prj.x < -40 || prj.x > W + 40 || prj.y < -40 || prj.y > H + 40;
      if (!dead) {
        if (prj.foe) {
          if (p.alive && Math.hypot(prj.x - p.x, prj.y - p.y) < prj.r + p.r - 2) {
            w.playerHurt(); dead = true;
            w.particles.burst(prj.x, prj.y, 6, '#D94A32');
          }
        } else {
          for (var k = 0; k < list.length; k++) {
            var en = list[k];
            if (en.dead) continue;
            var rr = en.r + prj.r;
            if (Math.abs(en.x - prj.x) < rr && Math.abs(en.y - prj.y) < rr &&
                Math.hypot(en.x - prj.x, en.y - prj.y) < rr) {
              var killed = en.hit(w);
              w.particles.burst(prj.x, prj.y, 4, '#D8D0B8');
              dead = true;
              if (killed && !en.dead) {
                en.dead = true;
                d.onKill(en, false);
                w.particles.burst(en.x, en.y, 16, en.type === 'screecher' ? '#D94A32' : '#7FA66A');
                this.render.shake = this.render.reducedMotion ? 0 : Math.max(this.render.shake, 0.25);
              }
              break;
            }
          }
        }
      }
      if (dead) pr.splice(j, 1);
    }

    // hazards
    var hz = w.hazards;
    for (var m = hz.length - 1; m >= 0; m--) {
      var h = hz[m];
      h.t += dt;
      if (h.t >= h.dur) { hz.splice(m, 1); continue; }
      if (h.t > h.telegraph && p.alive && p.invuln <= 0) {
        var hitP = false;
        if (h.kind === 'cut') {
          hitP = Math.hypot(p.x - h.x, p.y - h.y) < h.r;
        } else if (h.kind === 'sweep') {
          var rx = p.x - h.x, ry = p.y - h.y;
          var along = rx * h.dx + ry * h.dy;
          var perp = Math.abs(-ry * h.dx + rx * h.dy);
          hitP = along > 0 && along < h.length && perp < h.width / 2;
        }
        if (hitP) w.playerHurt();
      }
    }

    // boss death -> victory
    if (d.boss && d.boss.dead && !d.done) {
      this.victory();
      return;
    }

    // starvation already handled in render via runT
    this.render.particles.update(dt);
    this.render.shake = Math.max(0, this.render.shake - dt * 1.4);
  };

  Game.prototype.draw = function () {
    var g = this.render.g;
    if (this.state === STATES.BOOT) { this.render.drawBoot(g, this.bootT); return; }
    if (this.state === STATES.TITLE) { this.render.drawTitle(g, this.titleT); return; }
    if (this.state === STATES.PAUSED) {
      this.render.drawWorld(this.world, 0);
      this.render.drawPaused(g);
      return;
    }
    if (this.state === STATES.VICTORY) { this.render.drawVictory(g, this.world); return; }
    if (this.state === STATES.GAMEOVER) { this.render.drawGameOver(g, this.world); return; }
    this.render.drawWorld(this.world, 1 / 60);
  };

  Game.prototype.frame = function (now) {
    if (!this._last) this._last = now;
    var dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    this.update(dt);
    this.draw();
    var self = this;
    requestAnimationFrame(function (t) { self.frame(t); });
  };

  Game.prototype.boot = function () {
    var self = this;
    // audio ident needs a gesture; boot visuals run regardless
    requestAnimationFrame(function (t) { self.frame(t); });
  };

  SC.Game = Game;

  document.addEventListener('DOMContentLoaded', function () {
    var game = new SC.Game();
    game.boot();
  });
})();
