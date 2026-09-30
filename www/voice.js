(function (root) {
  "use strict";

  var KEY = "nav_voice_heard";
  var TURN = {
    left: 1,
    right: 1,
    leftKeep: 1,
    rightKeep: 1,
    rightSharp: 1,
    roundabout: 1,
    uturn: 1,
    motorwayOn: 1,
    motorwayOff: 1,
    ferryOn: 1,
    ferryOff: 1,
    arrive: 1
  };
  var FALLBACK = {
    leftKeep: "left",
    rightKeep: "right",
    rightSharp: "right",
    motorwayOff: "right",
    ferryOff: "ferryOn"
  };

  var packs = {};
  var dur = {};
  var heard = {};
  var ready = false;
  var el = null;
  var busy = false;
  var lastAt = 0;
  var said = {};
  var gpsSaid = false;

  function clipUrl(name) {
    var file = String(name || "").replace(/^.*\//, "").replace(/\.ogg$/i, ".mp3");
    return file ? "./voice/clips/" + file : "";
  }

  function readHeard() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch (_e) {
      return {};
    }
  }

  function writeHeard() {
    try { localStorage.setItem(KEY, JSON.stringify(heard)); } catch (_e) {}
  }

  function add(event, phase, name) {
    var url = clipUrl(name);
    if (!url) return;
    if (!packs[event]) packs[event] = { now: [], ahead: [] };
    var list = packs[event][phase === "ahead" ? "ahead" : "now"];
    if (list.indexOf(url) < 0) list.push(url);
    var ogg = String(name || "").replace(/^.*\//, "");
    if (typeof dur[url] !== "number") {
      var sec = root._voiceDur && root._voiceDur[ogg];
      if (typeof sec === "number") dur[url] = sec;
    }
  }

  function load() {
    heard = readHeard();
    return fetch("./voice/catalog.json").then(function (res) { return res.json(); }).then(function (cat) {
      root._voiceDur = cat.dur || {};
      Object.keys(cat.files || {}).forEach(function (event) {
        (cat.files[event] || []).forEach(function (name) {
          var url = clipUrl(name);
          dur[url] = Number(cat.dur[name]) || Number(cat.dur[name.replace(".mp3", ".ogg")]) || 3;
          add(event, "now", name);
        });
      });
      Object.keys(cat.ahead || {}).forEach(function (event) {
        (cat.ahead[event] || []).forEach(function (name) {
          var url = clipUrl(name);
          if (typeof dur[url] !== "number") {
            dur[url] = Number(cat.dur[name]) || Number(cat.dur[name.replace(".mp3", ".ogg")]) || 3;
          }
          add(event, "ahead", name);
        });
      });
      ready = true;
    });
  }

  function listFor(event, phase, maxSec) {
    var pack = packs[event] || { now: [], ahead: [] };
    var raw = phase === "ahead"
      ? (pack.ahead.length ? pack.ahead : pack.now)
      : (pack.now.length ? pack.now : pack.ahead);
    var short = raw.filter(function (url) { return (dur[url] || 99) <= maxSec; });
    if (short.length) return short;
    if (raw.length) {
      return raw.slice().sort(function (a, b) { return (dur[a] || 99) - (dur[b] || 99); }).slice(0, Math.min(4, raw.length));
    }
    var next = FALLBACK[event];
    if (next && next !== event) return listFor(next, phase, maxSec);
    return [];
  }

  function spin(event, phase) {
    var maxSec = phase === "ahead" ? 3.6 : 2.8;
    if (event === "gps") maxSec = 4;
    if (event === "start") maxSec = 1.3;
    if (event === "arrive") maxSec = 4;
    var list = listFor(event, phase, maxSec);
    if (!list.length) return "";
    var low = Infinity;
    var bag = [];
    list.forEach(function (url) {
      var n = heard[url] || 0;
      if (n < low) {
        low = n;
        bag = [url];
      } else if (n === low) bag.push(url);
    });
    return bag[Math.floor(Math.random() * bag.length)] || "";
  }

  function release() {
    if (!el) return;
    el.onended = null;
    el.onerror = null;
    try { el.pause(); } catch (_e) {}
    el.removeAttribute("src");
    try { el.load(); } catch (_e2) {}
    busy = false;
  }

  function play(event, phase) {
    if (!ready || busy) return false;
    var url = spin(event, phase);
    if (!url) return false;
    if (!el) {
      el = new Audio();
      el.preload = "none";
      el.setAttribute("playsinline", "");
    }
    busy = true;
    lastAt = Date.now();
    el.src = url;
    el.onended = function () {
      heard[url] = (heard[url] || 0) + 1;
      writeHeard();
      release();
    };
    el.onerror = release;
    var go = el.play();
    if (go && go.catch) go.catch(release);
    return true;
  }

  function reset() {
    said = {};
  }

  function stepIndex(route, traveled) {
    var steps = route.steps;
    var i = 0;
    while (i < steps.length - 1 && steps[i + 1].at <= traveled + 8) i++;
    return i;
  }

  function tick(route, traveled) {
    if (!ready || !route || busy) return;
    var i = stepIndex(route, traveled);
    var step = route.steps[i];
    var remain = Math.max(0, step.at + step.distance - traveled);
    var mark = said[i] || (said[i] = {});
    var kind = step.kind || "";
    if (!TURN[kind]) return;
    if (kind === "arrive") {
      if (remain <= 30 && !mark.now) {
        mark.now = 1;
        play("arrive", "now");
      }
      return;
    }
    if (!mark.far && remain <= 240 && remain > 70 && step.distance >= 160) {
      mark.far = 1;
      play(kind, "ahead");
      return;
    }
    if (!mark.now && remain <= 40) {
      mark.now = 1;
      play(kind, "now");
    }
  }

  function start() {
    play("start", "now");
  }

  function gps(hasFix) {
    if (!ready || !hasFix || gpsSaid) return;
    gpsSaid = true;
    play("gps", "now");
  }

  function heardCount() {
    return Object.keys(heard).length;
  }

  function total() {
    var n = 0;
    Object.keys(packs).forEach(function (k) {
      n += packs[k].now.length + packs[k].ahead.length;
    });
    return n;
  }

  root.Voice = {
    load: load,
    play: play,
    tick: tick,
    reset: reset,
    start: start,
    gps: gps,
    heard: heardCount,
    total: total,
    size: function (event, phase) { return listFor(event, phase, 8).length; }
  };
})(typeof window !== "undefined" ? window : globalThis);
