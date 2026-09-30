(function (root) {
  "use strict";

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

  var ACTION = {
    left: "fordulj balra",
    right: "fordulj jobbra",
    leftKeep: "tarts balra",
    rightKeep: "tarts jobbra",
    rightSharp: "élesen fordulj jobbra",
    uturn: "fordulj vissza",
    motorwayOn: "hajts fel az autópályára",
    motorwayOff: "hajts le az autópályáról",
    ferryOn: "hajts a kompra",
    ferryOff: "hajts le a kompról",
    arrive: "megérkeztél"
  };

  var EXIT = {
    1: "első",
    2: "második",
    3: "harmadik",
    4: "negyedik",
    5: "ötödik",
    6: "hatodik"
  };

  var DIST = {
    50: "ötven méter múlva",
    100: "száz méter múlva",
    150: "százötven méter múlva",
    200: "kétszáz méter múlva",
    250: "kétszázötven méter múlva",
    300: "háromszáz méter múlva",
    400: "négyszáz méter múlva",
    500: "ötszáz méter múlva",
    700: "hétszáz méter múlva",
    1000: "egy kilométer múlva",
    1500: "másfél kilométer múlva",
    2000: "két kilométer múlva",
    2500: "két és fél kilométer múlva",
    3000: "három kilométer múlva",
    4000: "négy kilométer múlva",
    5000: "öt kilométer múlva"
  };

  function isTurn(kind) {
    return !!(kind && TURN[kind]);
  }

  function cap(s) {
    s = String(s || "");
    if (!s) return "";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function street(name) {
    name = String(name || "").replace(/\s+/g, " ").trim();
    if (!name || /^unnamed$/i.test(name) || name === "-" || name === "—") return "";
    return name.split(/[;,]/)[0].trim();
  }

  function roundMeters(m) {
    m = Math.max(0, Number(m) || 0);
    if (m < 40) return 0;
    if (m < 80) return 50;
    if (m < 130) return 100;
    if (m < 180) return 150;
    if (m < 230) return 200;
    if (m < 280) return 250;
    if (m < 350) return 300;
    if (m < 450) return 400;
    if (m < 600) return 500;
    if (m < 850) return 700;
    if (m < 1250) return 1000;
    if (m < 1750) return 1500;
    if (m < 2250) return 2000;
    if (m < 2750) return 2500;
    if (m < 3500) return 3000;
    if (m < 4500) return 4000;
    if (m < 6000) return 5000;
    return Math.round(m / 1000) * 1000;
  }

  function distPhrase(m) {
    var r = roundMeters(m);
    if (!r) return "most";
    if (DIST[r]) return DIST[r];
    if (r >= 1000) {
      var km = Math.round(r / 1000);
      return km + " kilométer múlva";
    }
    return r + " méter múlva";
  }

  function actionOf(step) {
    if (!step) return "";
    var kind = step.kind || "";
    if (kind === "roundabout") {
      var n = Number(step.exit) || 0;
      var word = EXIT[n] || (n ? n + "." : "");
      if (!word) return "hajts be a körforgalomba";
      return "a körforgalomban vedd a " + word + " kijáratot";
    }
    return ACTION[kind] || "";
  }

  function withStreet(action, step) {
    var road = street(step && (step.street || step.ref));
    if (!action) return "";
    if (!road || (step && step.kind === "arrive")) return action;
    return action + ", " + road;
  }

  function line(step, remain, dest, next) {
    if (!step) return "";
    var kind = step.kind || "";
    if (!TURN[kind]) return "";
    var road = street(step.street || step.ref);
    var place = street(dest);
    var now = (Number(remain) || 0) < 40;
    var text = "";

    if (kind === "arrive") {
      if (now) text = place ? "Megérkeztél, " + place : "Megérkeztél";
      else text = cap(distPhrase(remain)) + " megérkezel" + (place ? ", " + place : "");
      return text + ".";
    }

    var act = withStreet(actionOf(step), step);
    if (!act) return "";
    text = now ? "Most " + act : cap(distPhrase(remain) + " " + act);

    if (now && next && TURN[next.kind] && next.kind !== "arrive" && (Number(next.distance) || 0) <= 90) {
      var thenAct = withStreet(actionOf(next), next);
      if (thenAct) text += ". Aztán " + thenAct;
    } else if (!now && road) {
      /* street already in act */
    }

    return text + ".";
  }

  var api = {
    TURN: TURN,
    isTurn: isTurn,
    street: street,
    dist: distPhrase,
    round: roundMeters,
    action: actionOf,
    line: line
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NavCue = api;
})(typeof window !== "undefined" ? window : globalThis);
