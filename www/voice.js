(function (root) {
  "use strict";

  var KEY = "nav_voice_heard";
  var FALLBACK = {
    left: "leftKeep",
    leftKeep: "left",
    rightSharp: "right",
    rightKeep: "right",
    motorwayOff: "right",
    motorwayOn: "straight",
    ferryOff: "ferryOn",
    ferryOn: "straight",
    recompute: "start",
    uturn: "left",
    arrive: "start",
    gps: "start",
    start: "straight",
    straight: "start"
  };

  var packs = {};
  var all = [];
  var heard = {};
  var ready = false;
  var el = null;
  var busy = false;
  var lastAt = 0;
  var said = {};
  var gpsSaid = false;
  var gpsLost = 0;

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
    if (all.indexOf(url) < 0) all.push(url);
  }

  function load() {
    heard = readHeard();
    return Promise.all([
      fetch("./voice/catalog.json").then(function (res) { return res.json(); }),
      fetch("./voice/files.json").then(function (res) { return res.json(); })
    ]).then(function (pair) {
      var cat = pair[0] || {};
      Object.keys(cat.files || {}).forEach(function (event) {
        (cat.files[event] || []).forEach(function (name) { add(event, "now", name); });
      });
      Object.keys(cat.ahead || {}).forEach(function (event) {
        (cat.ahead[event] || []).forEach(function (name) { add(event, "ahead", name); });
      });
      (pair[1] || []).forEach(function (path) {
        var url = clipUrl(path);
        if (url && all.indexOf(url) < 0) {
          add("start", "now", path);
        }
      });
      ready = all.length > 0;
    });
  }

  function listFor(event, phase) {
    var pack = packs[event];
    if (pack) {
      var first = phase === "ahead" ? pack.ahead : pack.now;
      if (first.length) return first;
      if (pack.now.length) return pack.now;
      if (pack.ahead.length) return pack.ahead;
    }
    var next = FALLBACK[event];
    if (next && next !== event) return listFor(next, phase);
    return all;
  }

  function spin(event, phase) {
    var list = listFor(event, phase);
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
    var kind = step.kind || "straight";
    if (kind === "arrive" && remain <= 25 && !mark.now) {
      mark.now = 1;
      play("arrive", "now");
      return;
    }
    if (kind !== "start" && kind !== "straight") {
      if (!mark.far && remain <= 280 && remain > 110 && step.distance >= 180) {
        mark.far = 1;
        play(kind, "ahead");
        return;
      }
      if (!mark.mid && remain <= 110 && remain > 35 && step.distance >= 80) {
        mark.mid = 1;
        play(kind, remain > 70 ? "ahead" : "now");
        return;
      }
      if (!mark.now && remain <= 35) {
        mark.now = 1;
        play(kind, "now");
        return;
      }
    }
    if (Date.now() - lastAt < 12000) return;
    if (remain > 220 || kind === "start" || kind === "straight") play("start", "now");
  }

  function start() {
    play("start", "now");
  }

  function gps(hasFix) {
    if (!ready) return;
    if (hasFix) {
      if (!gpsSaid || (gpsLost && Date.now() - gpsLost > 20000)) play("gps", "now");
      gpsSaid = true;
      gpsLost = 0;
    } else if (gpsSaid && !gpsLost) {
      gpsLost = Date.now();
    }
  }

  function heardCount() {
    return all.filter(function (url) { return heard[url]; }).length;
  }

  function total() {
    return all.length;
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
    size: function (event, phase) { return listFor(event, phase).length; }
  };
})(typeof window !== "undefined" ? window : globalThis);
