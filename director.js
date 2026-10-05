/* STATIC CUT — director.js
 * Five bands, 52-enemy spawn schedule, scoring/combo, the recording system
 * (player rhythm -> boss), Feedback detonations, band transitions.
 */
(function () {
  'use strict';
  window.SC = window.SC || {};

  var BANDS = [
    { name: 'CALIBRATION',   dur: 60,  spawn: [['screecher', 5], ['tracker', 3]] },
    { name: 'RHYTHM FAULT',  dur: 70,  spawn: [['drummer', 6], ['screecher', 4], ['tracker', 2]] },
    { name: 'FEEDBACK LOOP', dur: 70,  spawn: [['feedback', 6], ['drummer', 4], ['wraith', 2]] },
    { name: 'SIGNAL FAILURE', dur: 65,  spawn: [['screecher', 3], ['drummer', 3], ['tracker', 3], ['feedback', 3]] },
    { name: 'STATION VOICE', dur: 999, spawn: [['tracker', 2], ['screecher', 2], ['drummer', 2], ['feedback', 2]] }
  ];
  var COMBO_WINDOW = 3.5;
  var MAX_COMBO_MULT = 5;

  function Director(audio) {
    this.audio = audio;
    this.reset();
  }

  Director.prototype.reset = function () {
    this.band = 1;
    this.bandT = 0;
    this.runT = 0;
    this.score = 0;
    this.kills = 0;
    this.counterKills = 0;
    this.combo = 0; this.comboT = 0;
    this.spawnQueue = [];
    this.spawnT = 0;
    this.enemies = [];
    this.boss = null;
    this.bossSpawned = false;
    this.splits = [];
    this.recording = { fires: [], moves: [], mutes: [] };
    this._moveSampleT = 0;
    this.done = false;
    this._buildQueue(1);
    if (this.audio) this.audio.setBand(1);
  };

  Director.prototype._buildQueue = function (bandIdx) {
    var b = BANDS[bandIdx - 1];
    this.spawnQueue = [];
    b.spawn.forEach(function (pair) {
      for (var i = 0; i < pair[1]; i++) this.spawnQueue.push(pair[0]);
    }, this);
    // shuffle
    for (var i = this.spawnQueue.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = this.spawnQueue[i]; this.spawnQueue[i] = this.spawnQueue[j]; this.spawnQueue[j] = t;
    }
  };

  Director.prototype.update = function (dt, world) {
    if (this.done) return;
    this.runT += dt;
    this.bandT += dt;

    // recording: movement samples + mute presses handled via recordMute()
    this._moveSampleT -= dt;
    if (this._moveSampleT <= 0) {
      this._moveSampleT = 0.5;
      this.recording.moves.push({ x: world.player.x, y: world.player.y, t: this.runT });
    }

    // combo decay
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }

    // band transitions
    var b = BANDS[this.band - 1];
    if (this.band < 5 && this.bandT >= b.dur) {
      this._nextBand(world);
    }

    // spawning (continues even after the boss arrives — "8 adds + boss")
    this.spawnT -= dt;
    var aliveCount = this.enemies.filter(function (e) { return !e.dead; }).length;
    if (this.spawnQueue.length && this.spawnT <= 0 && aliveCount < 6) {
      this.spawnT = Math.max(0.8, 3.2 - this.band * 0.4);
      var type = this.spawnQueue.shift();
      this.spawnEnemy(type, world);
    }
    // band 5: spawn the boss shortly in
    if (this.band === 5 && this.bandT > 6 && !this.bossSpawned) {
      this.spawnBoss(world);
    }

    // win check handled by game (boss dead)
  };

  Director.prototype.spawnEnemy = function (type, world) {
    var m = 60;
    var x = m + Math.random() * (world.W - m * 2);
    var y = m + Math.random() * (world.H - m * 2);
    // keep distance from player
    if (Math.hypot(x - world.player.x, y - world.player.y) < 260) {
      x = world.W - x; y = world.H - y;
    }
    var e = SC.Enemies[type](x, y);
    this.enemies.push(e);
    world.particles.burst(x, y, 10, '#7FA66A');
    return e;
  };

  Director.prototype.spawnBoss = function (world) {
    this.bossSpawned = true;
    this.boss = SC.Enemies.stationVoice(world.W / 2, 170, this.recording);
    this.enemies.push(this.boss);
    if (this.audio) this.audio.setBand(5);
  };

  Director.prototype._nextBand = function (world) {
    this.splits.push({ band: this.band, score: this.score, t: this.runT });
    this.band++;
    this.bandT = 0;
    this._buildQueue(this.band);
    if (this.audio) this.audio.setBand(this.band);
    world.onBandChange(this.band);
  };

  // recording hooks
  Director.prototype.recordFire = function () {
    this.recording.fires.push(this.runT);
    if (this.recording.fires.length > 400) this.recording.fires.shift();
  };
  Director.prototype.recordMute = function (x, y) {
    this.recording.mutes.push({ x: x, y: y, t: this.runT });
    if (this.recording.mutes.length > 60) this.recording.mutes.shift();
  };

  // scoring
  Director.prototype.onKill = function (enemy, byInteraction) {
    if (enemy._scored) return;
    enemy._scored = true;
    this.kills++;
    this.combo++;
    this.comboT = COMBO_WINDOW;
    var mult = Math.min(MAX_COMBO_MULT, this.combo);
    var base = (enemy.counter || byInteraction) ? 250 : 100;
    if (enemy.counter || byInteraction) this.counterKills++;
    this.score += base * mult;
    if (this.audio) {
      if (enemy.counter || byInteraction) this.audio.counterKill(); else this.audio.kill();
    }
  };

  // Feedback detonation: damages player if close, strips Screecher shields in radius
  Director.prototype.onDetonate = function (fb) {
    var world = this._world;
    if (!world) return;
    var R = 170;
    world.particles.shockwave(fb.x, fb.y, R, '#D94A32');
    if (world.audio) world.audio.hit();
    var d = Math.hypot(world.player.x - fb.x, world.player.y - fb.y);
    if (d < R && world.player.invuln <= 0) {
      world.playerHurt();
    }
    // mastery: blast strips Screecher shields nearby
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.type === 'screecher' && !e.dead &&
          Math.hypot(e.x - fb.x, e.y - fb.y) < R) {
        e.shieldStripped = 0.6; // brief vulnerability window
        e.flash = 0.15;
      }
    }
  };

  Director.prototype.finishRun = function () {
    this.done = true;
    this.splits.push({ band: this.band, score: this.score, t: this.runT });
  };

  SC.Director = Director;
  SC.BANDS = BANDS;
})();
