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
    this.moveMag = 0;               // 0..1, eased — drives the move pose
    this.moveAng = 0;               // movement direction
    this.breath = 0;                // idle breathing phase
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
    this.breath += dt * 2.2;
    // pose tracking: ease move magnitude, remember direction
    var targetMag = len > 0 ? 1 : 0;
    this.moveMag += (targetMag - this.moveMag) * Math.min(1, dt * 8);
    if (len > 0) this.moveAng = Math.atan2(my, mx);
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

  // draw: THE OPERATOR pose set — idle (breathing), move (lean + streaks),
  // hit (X-eyes), overheat collapse (slump). Reads as a broadcast technician:
  // headset band, antenna, chest dial, VU-meter face.
  Player.prototype.draw = function (g, muted) {
    var p = this;
    var collapsed = p.overheated;
    var hitFace = p.invuln > 0.6;   // fresh hit: X-eyes for the first stretch of invuln
    g.save();
    g.translate(p.x, p.y);
    if (p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0) g.globalAlpha = 0.35;
    // turn: body twists toward movement relative to aim (strafing reads)
    var aimA = Math.atan2(p.aimY, p.aimX);
    var dAng = p.moveAng - aimA;
    while (dAng > Math.PI) dAng -= Math.PI * 2;
    while (dAng < -Math.PI) dAng += Math.PI * 2;
    var turn = p.moveMag * 0.38 * Math.max(-1, Math.min(1, dAng * 1.4));
    g.rotate(collapsed ? 0.32 : turn);
    // move bob / idle breathing
    var bob = p.moveMag * Math.sin(p.breath * 3.2) * 2.5;
    var breathe = (1 - p.moveMag) * Math.sin(p.breath) * 0.022;
    g.translate(0, bob);
    g.scale(1 + breathe, 1 + breathe);
    var bodyFill = collapsed ? '#57503f' : '#D8D0B8';
    // body
    g.fillStyle = bodyFill;
    g.strokeStyle = collapsed ? '#D94A32' : '#8a7f5c';
    g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, p.r, 0, Math.PI * 2); g.fill(); g.stroke();
    // ceramic crack lines
    g.strokeStyle = 'rgba(90,80,55,0.5)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(-8, -4); g.lineTo(-2, 2); g.lineTo(-6, 8); g.stroke();
    // headset band (technician read)
    g.strokeStyle = '#3d4436'; g.lineWidth = 3;
    g.beginPath(); g.arc(0, 0, p.r - 2, -Math.PI * 0.82, -Math.PI * 0.18); g.stroke();
    // antenna with blinking tip
    var tipOn = Math.sin(p.facePhase * 0.7) > 0;
    g.strokeStyle = '#3d4436'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(p.r * 0.55, -p.r * 0.8); g.lineTo(p.r * 0.9, -p.r * 1.5); g.stroke();
    g.fillStyle = tipOn ? '#D94A32' : '#5c2a1e';
    g.beginPath(); g.arc(p.r * 0.9, -p.r * 1.5, 2.6, 0, Math.PI * 2); g.fill();
    // chest dial
    g.strokeStyle = '#3d4436'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, 9, 5, 0, Math.PI * 2); g.stroke();
    var needle = p.facePhase * 0.4;
    g.beginPath(); g.moveTo(0, 9);
    g.lineTo(Math.cos(needle) * 4, 9 + Math.sin(needle) * 4); g.stroke();
    // face: VU bars, X-eyes on hit, flatlined on collapse
    if (hitFace) {
      g.strokeStyle = '#D94A32'; g.lineWidth = 3; g.lineCap = 'round';
      var xs = [[-9, -6], [3, -6]];
      for (var xi = 0; xi < 2; xi++) {
        var cx = xs[xi][0] + 3, cy = xs[xi][1] + 4.5;
        g.beginPath();
        g.moveTo(cx - 4, cy - 4); g.lineTo(cx + 4, cy + 4);
        g.moveTo(cx + 4, cy - 4); g.lineTo(cx - 4, cy + 4);
        g.stroke();
      }
    } else {
      var a = (Math.sin(p.facePhase) * 0.5 + 0.5);
      var b = (Math.sin(p.facePhase * 1.7 + 1) * 0.5 + 0.5);
      if (collapsed) { a = 0.06; b = 0.06; }
      g.fillStyle = collapsed ? '#D94A32' : '#7FA66A';
      g.fillRect(-9, -6 + (1 - a) * 8, 6, a * 8 + 1);
      g.fillRect(3, -6 + (1 - b) * 8, 6, b * 8 + 1);
      g.strokeStyle = '#3d4436'; g.lineWidth = 1;
      g.strokeRect(-9, -6, 6, 9); g.strokeRect(3, -6, 6, 9);
    }
    // collapse static ticks above head
    if (collapsed) {
      g.strokeStyle = '#D94A32'; g.lineWidth = 2;
      for (var st = 0; st < 3; st++) {
        var sx = -10 + st * 10 + Math.sin(p.facePhase * 2 + st) * 2;
        g.beginPath(); g.moveTo(sx, -p.r - 6); g.lineTo(sx, -p.r - 12); g.stroke();
      }
    }
    // aim tick
    var ang = Math.atan2(p.aimY, p.aimX);
    g.strokeStyle = '#D94A32'; g.lineWidth = 3;
    g.beginPath();
    g.moveTo(Math.cos(ang) * (p.r + 2), Math.sin(ang) * (p.r + 2));
    g.lineTo(Math.cos(ang) * (p.r + 10), Math.sin(ang) * (p.r + 10));
    g.stroke();
    g.restore();
    // motion streaks while moving (outside the rotated frame)
    if (p.moveMag > 0.4 && !collapsed) {
      g.save();
      g.globalAlpha = 0.3 * p.moveMag;
      g.strokeStyle = '#8a7f5c'; g.lineWidth = 2;
      for (var mI = 0; mI < 3; mI++) {
        var back = p.moveAng + Math.PI + (mI - 1) * 0.25;
        var sx2 = p.x + Math.cos(back) * (p.r + 6), sy2 = p.y + Math.sin(back) * (p.r + 6);
        g.beginPath(); g.moveTo(sx2, sy2);
        g.lineTo(sx2 + Math.cos(back) * 14 * p.moveMag, sy2 + Math.sin(back) * 14 * p.moveMag);
        g.stroke();
      }
      g.restore();
    }
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
