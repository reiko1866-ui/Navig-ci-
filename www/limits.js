(function (root) {
  "use strict";

  var DRIVE = {
    motorway: 1, trunk: 1, primary: 1, secondary: 1, tertiary: 1,
    unclassified: 1, residential: 1, living_street: 1, service: 1,
    motorway_link: 1, trunk_link: 1, primary_link: 1, secondary_link: 1, tertiary_link: 1
  };

  function parseMaxspeed(raw) {
    if (raw == null || raw === "") return null;
    var s = String(raw).trim().toLowerCase();
    var named = {
      "hu:urban": 50, urban: 50, "hu:rural": 90, rural: 90,
      "hu:motorway": 130, "hu:trunk": 110, "hu:living_street": 20
    };
    if (named[s]) return named[s];
    var mph = s.match(/^(\d+(?:\.\d+)?)\s*mph/);
    if (mph) return Math.round(parseFloat(mph[1]) * 1.60934);
    var num = s.match(/^(\d+(?:\.\d+)?)/);
    if (!num) return null;
    var v = Math.round(parseFloat(num[1]));
    if (v < 5 || v > 140) return null;
    return v;
  }

  function fallbackLimit(tags) {
    var hw = String(tags.highway || "");
    var blob = [tags["source:maxspeed"], tags["maxspeed:type"], tags["zone:maxspeed"], tags["zone:traffic"]].join(" ").toLowerCase();
    if (blob.indexOf("rural") >= 0) {
      if (hw === "motorway") return 130;
      if (hw === "trunk") return 110;
      return 90;
    }
    if (blob.indexOf("urban") >= 0) return 50;
    if (hw === "living_street") return 20;
    if (hw === "motorway") return 130;
    if (hw === "trunk") return 110;
    if (hw === "residential" || hw === "service" || hw === "unclassified") return 50;
    return null;
  }

  function wayLimit(way, a, b) {
    var tags = way.tags || {};
    var nodes = way.nodes || [];
    var ia = nodes.indexOf(a);
    var ib = nodes.indexOf(b);
    var forward = ib >= ia;
    var raw = forward ? (tags["maxspeed:forward"] || tags.maxspeed) : (tags["maxspeed:backward"] || tags.maxspeed);
    var posted = parseMaxspeed(raw);
    if (posted) return { limit: posted, posted: true };
    var guessed = fallbackLimit(tags);
    if (!guessed) return null;
    return { limit: guessed, posted: false };
  }

  function indexWays(ways) {
    var byNode = {};
    ways.forEach(function (way) {
      var hw = String((way.tags || {}).highway || "");
      if (!DRIVE[hw]) return;
      (way.nodes || []).forEach(function (id) {
        if (!byNode[id]) byNode[id] = [];
        byNode[id].push(way);
      });
    });
    return byNode;
  }

  function pickWay(byNode, a, b) {
    var list = byNode[a] || [];
    var both = [];
    for (var i = 0; i < list.length; i++) {
      var nodes = list[i].nodes || [];
      if (nodes.indexOf(b) >= 0) both.push(list[i]);
    }
    if (!both.length) return null;
    for (var j = 0; j < both.length; j++) {
      var nodes = both[j].nodes || [];
      if (Math.abs(nodes.indexOf(a) - nodes.indexOf(b)) === 1) return both[j];
    }
    return both[0];
  }

  function build(nodes, distances, ways) {
    var byNode = indexWays(ways);
    var parts = [];
    var at = 0;
    for (var i = 0; i < distances.length; i++) {
      var meters = Number(distances[i]) || 0;
      var a = Math.round(nodes[i]);
      var b = Math.round(nodes[i + 1]);
      var way = a === b ? null : pickWay(byNode, a, b);
      var info = way ? wayLimit(way, a, b) : null;
      parts.push({
        start: at,
        end: at + meters,
        limit: info ? info.limit : 0,
        posted: info ? info.posted : false
      });
      at += meters;
    }
    fillGaps(parts);
    return merge(parts);
  }

  function fillGaps(parts) {
    var i;
    var last = null;
    for (i = 0; i < parts.length; i++) {
      if (parts[i].limit) {
        last = parts[i];
        continue;
      }
      var gap = parts[i].end - parts[i].start;
      if (last && gap > 0 && gap <= 250) {
        parts[i].limit = last.limit;
        parts[i].posted = last.posted;
      }
    }
    var next = null;
    for (i = parts.length - 1; i >= 0; i--) {
      if (parts[i].limit) {
        next = parts[i];
        continue;
      }
      var hole = parts[i].end - parts[i].start;
      if (next && hole > 0 && hole <= 250) {
        parts[i].limit = next.limit;
        parts[i].posted = next.posted;
      }
    }
  }

  function merge(parts) {
    var out = [];
    parts.forEach(function (part) {
      if (!part.limit || part.end <= part.start) return;
      var prev = out[out.length - 1];
      if (prev && prev.limit === part.limit && prev.posted === part.posted) prev.end = part.end;
      else out.push({ start: part.start, end: part.end, limit: part.limit, posted: part.posted });
    });
    return out;
  }

  function at(segments, meters) {
    if (!segments || !segments.length) return null;
    var lo = 0;
    var hi = segments.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (segments[mid].end < meters) lo = mid + 1;
      else hi = mid;
    }
    var seg = segments[lo];
    if (!seg || meters < seg.start || meters > seg.end + 1) return null;
    return seg;
  }

  function nextChange(segments, meters) {
    var cur = at(segments, meters);
    if (!cur) return null;
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      if (seg.start <= meters + 15) continue;
      if (seg.end - seg.start < 40) continue;
      if (seg.limit !== cur.limit) return { dist: seg.start - meters, limit: seg.limit };
    }
    return null;
  }

  function fetchWays(ids) {
    var chunks = [];
    for (var i = 0; i < ids.length; i += 120) chunks.push(ids.slice(i, i + 120));
    return Promise.all(chunks.map(fetchChunk)).then(function (groups) {
      var all = [];
      groups.forEach(function (list) { all = all.concat(list); });
      return all;
    });
  }

  function fetchChunk(ids) {
    var query = "[out:json][timeout:25];node(id:" + ids.join(",") + ")->.nds;way(bn.nds)[highway];out body;";
    var body = "data=" + encodeURIComponent(query);
    function once() {
      return fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Navig-ci/1.0 (speed limits)"
        },
        body: body
      }).then(function (res) {
        if (!res.ok) throw new Error("overpass");
        return res.json();
      });
    }
    return once().catch(function () { return once(); }).then(function (data) {
      return ((data && data.elements) || []).filter(function (el) { return el.type === "way"; });
    });
  }

  function load(route) {
    var nodes = route.nodes || [];
    var distances = route.segDist || [];
    if (nodes.length < 2 || distances.length < 1) return Promise.resolve([]);
    var ids = [];
    var seen = {};
    nodes.forEach(function (n) {
      var id = String(Math.round(n));
      if (!seen[id]) {
        seen[id] = 1;
        ids.push(id);
      }
    });
    return fetchWays(ids).then(function (ways) {
      return build(nodes, distances, ways);
    });
  }

  root.SpeedLimits = { load: load, at: at, nextChange: nextChange, build: build };
})(typeof window !== "undefined" ? window : globalThis);
