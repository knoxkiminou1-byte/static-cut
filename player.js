/* STATIC CUT — player.js
 * THE OPERATOR: bone-ceramic broadcast technician, VU-meter face.
 * WASD/arrows move, mouse or arrows aim, click/Z fire, Space MUTE.
 */
(function () {
  'use strict';
  window.SC = window.SC || {};

  var SPEED = 330;
  var RADIUS = 16;
  var FIRE_CD = 0.13;
  var HEAT_RATE = 100 / 2.5;   // 2.5s hold -> full
  var COOL_RATE = 100 / 1.6;   // release cools faster
  var OVERHEAT_LOCK = 3.0;

  function Player(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = RADIUS;
    this.hp = 3; this.maxHp = 3;
    this.invuln = 0;
    this.fireCd = 0;
    this.aimX = 1; this.aimY = 0;   // aim vector
    this.facePhase = 0;             // VU-meter face animation
    // MUTE / heat
    this.muting = false;
    this.heat = 0;
    this.overheated = false;
    this.lockout = 0;
    this.muteFlashes = 0;           // presses this run (for HUD)
    this.alive = true;
  }

  Player.prototype.update = function (dt, input, audio, W, H) {
    if (!this.alive) return;
    // movement
    var mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    var my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    var len = Math.hypot(mx, my);
    if (len > 0) { mx /= len; my /= len; }
    var sp = SPEED * (this.muting ? 0.75 : 1); // slightly slower while muted
    this.vx = mx * sp; this.vy = my * sp;
    this.x = Math.max(this.r, Math.min(W - this.r, this.x + this.vx * dt));
    this.y = Math.max(this.r, Math.min(H - this.r, this.y + this.vy * dt));

    // aim: mouse wins, else arrow-aim keys, else last move dir
    if (input.mouseActive) {
      var dx = input.mouseX - this.x, dy = input.mouseY - this.y;
      var dl = Math.hypot(dx, dy);
      if (dl > 4) { this.aimX = dx / dl; this.aimY = dy / dl; }
    } else if (input.aimX !== 0 || input.aimY !== 0) {
      var al = Math.hypot(input.aimX, input.aimY);
      this.aimX = input.aimX / al; this.aimY = input.aimY / al;
    } else if (len > 0) { this.aimX = mx; this.aimY = my; }

    // MUTE / heat
    var wantMute = input.mute && !this.overheated;
    if (wantMute && !this.muting) {
      this.muting = true;
      this.muteFlashes++;
      if (audio) audio.muteOn();
    } else if (!wantMute && this.muting) {
      this.muting = false;
    }
    if (this.muting) {
      this.heat += HEAT_RATE * dt;
      if (this.heat >= 100) {
        this.heat = 100;
        this.muting = false;
        this.overheated = true;
        this.lockout = OVERHEAT_LOCK;
        if (audio) { audio.overheat(); audio.setMuted(false); }
      }
    } else {
      this.heat = Math.max(0, this.heat - COOL_RATE * dt);
      if (this.overheated) {
        this.lockout -= dt;
        if (this.lockout <= 0) { this.overheated = false; this.lockout = 0; }
      }
    }
    if (audio) audio.setMuted(this.muting);

    // fire
    this.fireCd -= dt;
    var wantFire = (input.firing || input.kbFire) && this.fireCd <= 0;
    if (wantFire) {
      this.fireCd = FIRE_CD;
      if (audio) audio.shoot();
      return { fire: true, x: this.x + this.aimX * 20, y: this.y + this.aimY * 20,
               dx: this.aimX, dy: this.aimY };
    }

    this.facePhase += dt * (this.muting ? 1.5 : 6);
    if (this.invuln > 0) this.invuln -= dt;
    return null;
  };

  Player.prototype.hurt = function (audio) {
    if (this.invuln > 0 || !this.alive) return false;
    this.hp--;
    this.invuln = 1.2;
    if (audio) audio.playerHurt();
    if (this.hp <= 0) { this.alive = false; return true; }
    return false;
  };

  // draw: bone-ceramic circle body, VU-meter face (two bars bouncing), aim tick
  Player.prototype.draw = function (g, muted) {
    var p = this;
    g.save();
    g.translate(p.x, p.y);
    if (p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0) g.globalAlpha = 0.35;
    // body
    g.fillStyle = '#D8D0B8';
    g.strokeStyle = '#8a7f5c';
    g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, p.r, 0, Math.PI * 2); g.fill(); g.stroke();
    // ceramic crack lines
    g.strokeStyle = 'rgba(90,80,55,0.5)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(-8, -4); g.lineTo(-2, 2); g.lineTo(-6, 8); g.stroke();
    // VU-meter face: two bouncing bars
    var a = (Math.sin(p.facePhase) * 0.5 + 0.5);
    var b = (Math.sin(p.facePhase * 1.7 + 1) * 0.5 + 0.5);
    g.fillStyle = '#7FA66A';
    g.fillRect(-9, -6 + (1 - a) * 8, 6, a * 8 + 1);
    g.fillRect(3, -6 + (1 - b) * 8, 6, b * 8 + 1);
    g.strokeStyle = '#3d4436'; g.strokeRect(-9, -6, 6, 9); g.strokeRect(3, -6, 6, 9);
    // aim tick
    var ang = Math.atan2(p.aimY, p.aimX);
    g.strokeStyle = '#D94A32'; g.lineWidth = 3;
    g.beginPath();
    g.moveTo(Math.cos(ang) * (p.r + 2), Math.sin(ang) * (p.r + 2));
    g.lineTo(Math.cos(ang) * (p.r + 10), Math.sin(ang) * (p.r + 10));
    g.stroke();
    g.restore();
    // heat ring
    if (p.heat > 1) {
      g.save();
      g.strokeStyle = p.overheated ? '#D94A32' : '#c8a24a';
      g.lineWidth = 4;
      g.globalAlpha = 0.9;
      g.beginPath();
      g.arc(p.x, p.y, p.r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (p.heat / 100));
      g.stroke();
      g.restore();
    }
  };

  SC.Player = Player;
})();
