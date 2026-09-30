(function (root) {
  "use strict";

  var Cue = root.NavCue;
  var packs = {};
  var dur = {};
  var heard = {};
  var ready = false;
  var el = null;
  var clipBusy = false;
  var lastSpoken = "";
  var lastAt = 0;
  var said = {};
  var gpsSaid = false;
  var speakBusy = false;
  var huVoice = null;

  function clipUrl(name) {
    var file = String(name || "").replace(/^.*\//, "").replace(/\.ogg$/i, ".mp3");
    return file ? "./voice/clips/" + file : "";
  }

  function nativeSpeak() {
    var cap = root.Capacitor;
    if (!cap || !cap.Plugins || !cap.Plugins.NavSpeak) return null;
    return cap.Plugins.NavSpeak;
  }

  function cueBox() {
    return typeof document !== "undefined" ? document.getElementById("cue") : null;
  }

  function showCue(text) {
    lastSpoken = text || "";
    var box = cueBox();
    if (!box) return;
    box.hidden = !text;
    box.textContent = text || "";
  }

  function pickVoice() {
    if (!root.speechSynthesis) return null;
    var list = root.speechSynthesis.getVoices() || [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (/^hu(-|_|$)/i.test(list[i].lang) || /hungarian|magyar/i.test(list[i].name)) return list[i];
    }
    return null;
  }

  function webSpeak(text, interrupt) {
    if (!root.speechSynthesis) return false;
    try {
      if (interrupt) root.speechSynthesis.cancel();
      var utter = new SpeechSynthesisUtterance(text);
      utter.lang = "hu-HU";
      utter.rate = 0.96;
      huVoice = huVoice || pickVoice();
      if (huVoice) utter.voice = huVoice;
      speakBusy = true;
      utter.onend = function () { speakBusy = false; };
      utter.onerror = function () { speakBusy = false; };
      root.speechSynthesis.speak(utter);
      return true;
    } catch (_e) {
      speakBusy = false;
      return false;
    }
  }

  function speakText(text, interrupt) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    if (!text) return false;
    showCue(text);
    lastAt = Date.now();
    var plugin = nativeSpeak();
    if (plugin && plugin.speak) {
      speakBusy = true;
      if (interrupt && plugin.stop) plugin.stop();
      var go = plugin.speak({ text: text });
      if (go && go.then) {
        go.then(function () { speakBusy = false; }).catch(function () {
          speakBusy = false;
          webSpeak(text, interrupt);
        });
      }
      return true;
    }
    return webSpeak(text, interrupt);
  }

  function add(event, phase, name) {
    var url = clipUrl(name);
    if (!url) return;
    if (!packs[event]) packs[event] = { now: [], ahead: [] };
    var list = packs[event][phase === "ahead" ? "ahead" : "now"];
    if (list.indexOf(url) < 0) list.push(url);
  }

  function load() {
    if (root.speechSynthesis) {
      huVoice = pickVoice();
      if (root.speechSynthesis.onvoiceschanged !== undefined) {
        root.speechSynthesis.onvoiceschanged = function () { huVoice = pickVoice(); };
      }
    }
    return fetch("./voice/catalog.json").then(function (res) { return res.json(); }).then(function (cat) {
      Object.keys(cat.files || {}).forEach(function (event) {
        (cat.files[event] || []).forEach(function (name) {
          var url = clipUrl(name);
          dur[url] = Number(cat.dur[name]) || Number(cat.dur[name.replace(".mp3", ".ogg")]) || 3;
          add(event, "now", name);
        });
      });
      ready = true;
    });
  }

  function listFor(event, maxSec) {
    var pack = packs[event] || { now: [], ahead: [] };
    var raw = pack.now.length ? pack.now : pack.ahead;
    var short = raw.filter(function (url) { return (dur[url] || 99) <= maxSec; });
    return short.length ? short : raw.slice().sort(function (a, b) {
      return (dur[a] || 99) - (dur[b] || 99);
    }).slice(0, 3);
  }

  function spin(event, maxSec) {
    var list = listFor(event, maxSec);
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
    clipBusy = false;
  }

  function playClip(event, maxSec) {
    if (!ready || clipBusy) return false;
    var url = spin(event, maxSec);
    if (!url) return false;
    if (!el) {
      el = new Audio();
      el.preload = "none";
      el.setAttribute("playsinline", "");
    }
    clipBusy = true;
    el.src = url;
    el.onended = function () {
      heard[url] = (heard[url] || 0) + 1;
      release();
    };
    el.onerror = release;
    var go = el.play();
    if (go && go.catch) go.catch(release);
    return true;
  }

  function reset() {
    said = {};
    lastSpoken = "";
    showCue("");
  }

  function stepIndex(route, traveled) {
    var steps = route.steps;
    var i = 0;
    while (i < steps.length - 1 && steps[i + 1].at <= traveled + 8) i++;
    return i;
  }

  function nextTurn(route, i) {
    var j;
    for (j = i + 1; j < route.steps.length; j++) {
      if (Cue.isTurn(route.steps[j].kind)) return route.steps[j];
    }
    return null;
  }

  function speakStep(step, remain, dest, next, interrupt) {
    var text = Cue.line(step, remain, dest, next);
    if (!text) return false;
    return speakText(text, interrupt);
  }

  function tick(route, traveled) {
    if (!ready || !route || !Cue) return;
    var i = stepIndex(route, traveled);
    var step = route.steps[i];
    var remain = Math.max(0, step.at + step.distance - traveled);
    var mark = said[i] || (said[i] = {});
    var kind = step.kind || "";
    var next = nextTurn(route, i);
    if (!Cue.isTurn(kind)) return;

    if (kind === "arrive") {
      if (remain <= 30 && !mark.now) {
        mark.now = 1;
        speakStep(step, remain, route.dest, null, true);
      }
      return;
    }

    if (!mark.far && remain <= 280 && remain > 80 && step.distance >= 140) {
      mark.far = 1;
      speakStep(step, remain, route.dest, next, false);
      return;
    }

    if (!mark.now && remain <= 45) {
      mark.now = 1;
      mark.far = 1;
      speakStep(step, remain, route.dest, next, true);
    }
  }

  function start(route, traveled) {
    said = {};
    var extra = "";
    if (route && Cue) {
      var i = stepIndex(route, traveled || 0);
      var step = route.steps[i];
      if (step && Cue.isTurn(step.kind)) {
        var remain = Math.max(0, step.at + step.distance - (traveled || 0));
        extra = Cue.line(step, remain, route.dest, nextTurn(route, i));
        if (remain <= 280) said[i] = remain <= 45 ? { far: 1, now: 1 } : { far: 1 };
      }
    }
    speakText(extra ? "Indulás. " + extra : "Indulás.", true);
  }

  function gps(hasFix) {
    if (!ready || !hasFix || gpsSaid) return;
    gpsSaid = true;
    if (lastSpoken) return;
    playClip("gps", 4);
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
    tick: tick,
    reset: reset,
    start: start,
    gps: gps,
    speak: speakText,
    last: function () { return lastSpoken; },
    heard: heardCount,
    total: total
  };
})(typeof window !== "undefined" ? window : globalThis);
