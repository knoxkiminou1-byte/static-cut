/* STATIC CUT — storage.js
 * localStorage: personal best, splits, settings. No external deps. */
(function () {
  'use strict';
  window.SC = window.SC || {};

  var PB_KEY = 'staticcut.pb.v1';
  var SET_KEY = 'staticcut.settings.v1';

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* storage unavailable */ }
  }

  SC.Storage = {
    getPB: function () {
      var raw = safeGet(PB_KEY);
      if (!raw) return null;
      try {
        var o = JSON.parse(raw);
        if (typeof o.score === 'number') return o;
      } catch (e) { /* corrupt */ }
      return null;
    },
    setPB: function (score, bandSplits) {
      var prev = this.getPB();
      var entry = { score: score, splits: bandSplits || [], date: Date.now() };
      if (!prev || score > prev.score) {
        safeSet(PB_KEY, JSON.stringify(entry));
        return true; // new personal best
      }
      return false;
    },
    getSettings: function () {
      var raw = safeGet(SET_KEY);
      var def = { reducedMotion: null, muteVolume: 1.0, showSplits: true };
      if (!raw) return def;
      try {
        var o = JSON.parse(raw);
        return {
          reducedMotion: typeof o.reducedMotion === 'boolean' ? o.reducedMotion : null,
          muteVolume: typeof o.muteVolume === 'number' ? o.muteVolume : 1.0,
          showSplits: o.showSplits !== false
        };
      } catch (e) { return def; }
    },
    setSettings: function (s) {
      safeSet(SET_KEY, JSON.stringify(s));
    }
  };
})();
