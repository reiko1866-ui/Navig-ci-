var assert = require("assert");
var Cue = require("../www/cue.js");

function step(kind, street, extra) {
  extra = extra || {};
  return {
    kind: kind,
    street: street || "",
    exit: extra.exit || 0,
    ref: extra.ref || "",
    distance: extra.distance || 200
  };
}

assert.strictEqual(Cue.street("Andrássy út; Kossuth"), "Andrássy út");
assert.strictEqual(Cue.street("unnamed"), "");
assert.strictEqual(Cue.round(37), 0);
assert.strictEqual(Cue.round(92), 100);
assert.strictEqual(Cue.round(240), 250);
assert.strictEqual(Cue.dist(240), "kétszázötven méter múlva");
assert.strictEqual(Cue.action(step("right")), "fordulj jobbra");
assert.strictEqual(Cue.action(step("roundabout", "", { exit: 2 })), "a körforgalomban vedd a második kijáratot");

var far = Cue.line(step("right", "Kossuth Lajos utca"), 240, "", null);
assert.strictEqual(far, "Kétszázötven méter múlva fordulj jobbra, Kossuth Lajos utca.");

var now = Cue.line(step("left", "Andrássy út"), 20, "", null);
assert.strictEqual(now, "Most fordulj balra, Andrássy út.");

var stacked = Cue.line(
  step("right", "Petőfi utca"),
  20,
  "",
  step("leftKeep", "Bajcsy-Zsilinszky út", { distance: 40 })
);
assert.strictEqual(
  stacked,
  "Most fordulj jobbra, Petőfi utca. Aztán tarts balra, Bajcsy-Zsilinszky út."
);

var arrive = Cue.line(step("arrive"), 10, "Hősök tere", null);
assert.strictEqual(arrive, "Megérkeztél, Hősök tere.");

var noStreet = Cue.line(step("uturn"), 100, "", null);
assert.strictEqual(noStreet, "Száz méter múlva fordulj vissza.");

var motorway = Cue.line(step("motorwayOff", "M3"), 500, "", null);
assert.strictEqual(motorway, "Ötszáz méter múlva hajts le az autópályáról, M3.");

console.log("cue tests ok");
