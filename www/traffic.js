(function (root) {
  "use strict";

  var KEY = "oE6c7oDmIR80A8Vsr4o96nBlcqNRs3vD";
  var MARKS = [0, 0.33, 0.66];

  function haversine(a, b) {
    var r = 6371000;
    var p1 = a.lat * Math.PI / 180;
    var p2 = b.lat * Math.PI / 180;
    var dlat = (b.lat - a.lat) * Math.PI / 180;
    var dlng = (b.lng - a.lng) * Math.PI / 180;
    var h = Math.sin(dlat / 2) * Math.sin(dlat / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dlng / 2) * Math.sin(dlng / 2);
    return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function blank() {
    return { n: 0, busy: false, failed: false, segments: [], extra: 0 };
  }

  function arm(route) {
    route.traffic = blank();
  }

  function metersOnRoute(route, lng, lat) {
    var coords = route.coords || [];
    var cum = route.cum || [];
    var best = 0;
    var bestD = Infinity;
    for (var i = 0; i < coords.length; i++) {
      var d = haversine(coords[i], { lng: lng, lat: lat });
      if (d < bestD) {
        bestD = d;
        best = cum[i] || 0;
      }
    }
    return best;
  }

  function isJam(sec) {
    var cat = String(sec.simpleCategory || "").toUpperCase();
    var delay = Number(sec.delayInSeconds) || 0;
    if (cat === "JAM" || cat === "ROAD_CLOSURE") return true;
    return delay >= 45;
  }

  function readSections(data, route) {
    var tt = data && data.routes && data.routes[0];
    if (!tt) return { segments: [], extra: 0 };
    var points = [];
    (tt.legs || []).forEach(function (leg) {
      (leg.points || []).forEach(function (p) {
        if (Number.isFinite(p.longitude) && Number.isFinite(p.latitude)) {
          points.push({ lng: p.longitude, lat: p.latitude });
        }
      });
    });
    var segments = [];
    var located = 0;
    (tt.sections || []).forEach(function (sec) {
      if (String(sec.sectionType || "").toUpperCase() !== "TRAFFIC") return;
      if (!isJam(sec)) return;
      var a = points[Math.max(0, Number(sec.startPointIndex) || 0)];
      var b = points[Math.min(points.length - 1, Number(sec.endPointIndex) || 0)];
      if (!a || !b) return;
      var start = metersOnRoute(route, a.lng, a.lat);
      var end = metersOnRoute(route, b.lng, b.lat);
      if (end < start) {
        var swap = start;
        start = end;
        end = swap;
      }
      if (end - start < 20) end = start + 20;
      var delay = Math.max(0, Number(sec.delayInSeconds) || 0);
      located += delay;
      segments.push({
        start: start,
        end: end,
        delay: delay,
        speedKmh: Number(sec.effectiveSpeedInKmh) || 0,
        closure: String(sec.simpleCategory || "").toUpperCase() === "ROAD_CLOSURE"
      });
    });
    var summary = tt.summary || {};
    var live = Number(summary.travelTimeInSeconds) || 0;
    var free = Number(summary.noTrafficTravelTimeInSeconds) || live;
    var summaryExtra = Math.max(0, live - free);
    return { segments: segments, extra: Math.max(0, summaryExtra - located) + located };
  }

  function fetchOnce(route, from, dest) {
    var watch = route.traffic;
    var url = "https://api.tomtom.com/routing/1/calculateRoute/" +
      from.lat.toFixed(5) + "," + from.lng.toFixed(5) + ":" +
      dest.lat.toFixed(5) + "," + dest.lng.toFixed(5) +
      "/json?key=" + encodeURIComponent(KEY) +
      "&traffic=true&travelMode=car&sectionType=traffic&routeRepresentation=polyline&computeTravelTimeFor=all";
    watch.busy = true;
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("tomtom");
      return res.json();
    }).then(function (data) {
      var parsed = readSections(data, route);
      watch.segments = parsed.segments;
      watch.extra = parsed.extra;
      watch.failed = false;
      watch.n += 1;
    }).catch(function () {
      if (!watch.segments.length && !watch.extra) watch.failed = true;
      watch.n += 1;
    }).then(function () {
      watch.busy = false;
    });
  }

  function consider(route, traveled, from, dest) {
    if (!route || !dest || !from) return Promise.resolve(false);
    if (!route.traffic) arm(route);
    var watch = route.traffic;
    if (watch.busy || watch.n >= MARKS.length) return Promise.resolve(false);
    var frac = route.length > 1 ? traveled / route.length : 0;
    if (frac + 0.001 < MARKS[watch.n]) return Promise.resolve(false);
    return fetchOnce(route, from, dest).then(function () { return true; });
  }

  function delayAhead(route, traveled) {
    var watch = route && route.traffic;
    if (!watch) return 0;
    var extra = 0;
    (watch.segments || []).forEach(function (seg) {
      if (seg.end <= traveled) return;
      var span = Math.max(1, seg.end - seg.start);
      var left = Math.max(0, seg.end - Math.max(seg.start, traveled));
      extra += seg.delay * (left / span);
    });
    var remain = route.length > 1 ? Math.max(0, (route.length - traveled) / route.length) : 0;
    extra += (watch.extra || 0) * remain;
    return extra;
  }

  function pace(route, traveled) {
    var watch = route && route.traffic;
    if (!watch) return 1;
    var seg = null;
    (watch.segments || []).forEach(function (item) {
      if (traveled >= item.start && traveled < item.end) seg = item;
    });
    if (!seg) return 1;
    if (seg.closure) return 0.45;
    if (!(seg.speedKmh > 0)) return 1;
    return Math.max(0.4, Math.min(1, seg.speedKmh / 50));
  }

  function label(route, traveled) {
    var watch = route && route.traffic;
    if (!watch || (watch.n === 0 && !watch.failed)) return "";
    if (watch.failed && !(watch.segments || []).length && !watch.extra) return "Forgalom most nem elérhető";
    var extra = delayAhead(route, traveled);
    if (extra < 60) return "Forgalom: szabad";
    return "Forgalom: +" + Math.round(extra / 60) + " perc";
  }

  root.Traffic = {
    arm: arm,
    consider: consider,
    delayAhead: delayAhead,
    pace: pace,
    label: label
  };
})(typeof window !== "undefined" ? window : globalThis);
