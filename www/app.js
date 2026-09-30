(function () {
  "use strict";

  var BUDAPEST = { lng: 19.0402, lat: 47.4979 };
  var origin = { lng: BUDAPEST.lng, lat: BUDAPEST.lat };
  var route = null;
  var destination = null;
  var routeChoices = [];
  var traveled = 0;
  var running = false;
  var raf = 0;
  var lastT = 0;
  var lastCam = 0;
  var marker = null;
  var voiceFiles = [];
  var SPEED = 50 / 3.6;
  var limitToken = 0;
  var limitShown = "";
  var nextShown = "";
  var trafficShown = "";
  var gps = { at: 0 };

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(text) {
    $("status").textContent = text;
  }

  function haversine(a, b) {
    var r = 6371000;
    var p1 = a.lat * Math.PI / 180;
    var p2 = b.lat * Math.PI / 180;
    var dlat = (b.lat - a.lat) * Math.PI / 180;
    var dlng = (b.lng - a.lng) * Math.PI / 180;
    var h = Math.sin(dlat / 2) * Math.sin(dlat / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dlng / 2) * Math.sin(dlng / 2);
    return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function fmtDist(m) {
    m = Math.max(0, Number(m) || 0);
    if (m < 1000) return Math.round(m) + " m";
    return (m / 1000).toFixed(1).replace(".", ",") + " km";
  }

  function fmtRemain(m) {
    if (m < 30) return "Most";
    return fmtDist(m);
  }

  function labelOf(step) {
    var man = step.maneuver || {};
    var type = String(man.type || "").toLowerCase();
    var mod = String(man.modifier || "").toLowerCase();
    if (type === "arrive") return "Megérkeztél";
    if (type === "depart") return "Indulás";
    if (type === "roundabout" || type === "rotary" || type === "exit roundabout") {
      return man.exit ? "Körforgalom, " + man.exit + ". kijárat" : "Körforgalom";
    }
    if (type === "merge") return "Sorolj be";
    if (type === "fork" || type === "end of road") {
      if (mod.indexOf("left") >= 0) return "Tarts balra";
      if (mod.indexOf("right") >= 0) return "Tarts jobbra";
    }
    if (type === "continue" || type === "new name" || type === "notification") return "Haladj tovább";
    if (mod.indexOf("uturn") >= 0) return "Fordulj vissza";
    if ((mod.indexOf("slight") >= 0 || mod.indexOf("keep") >= 0) && mod.indexOf("left") >= 0) return "Tarts balra";
    if ((mod.indexOf("slight") >= 0 || mod.indexOf("keep") >= 0) && mod.indexOf("right") >= 0) return "Tarts jobbra";
    if (mod.indexOf("sharp") >= 0 && mod.indexOf("left") >= 0) return "Élesen balra";
    if (mod.indexOf("sharp") >= 0 && mod.indexOf("right") >= 0) return "Élesen jobbra";
    if (mod.indexOf("left") >= 0) return "Fordulj balra";
    if (mod.indexOf("right") >= 0) return "Fordulj jobbra";
    if (type === "turn" && mod === "straight") return "Haladj tovább";
    return "Haladj tovább";
  }

  function kindOf(step) {
    var man = step.maneuver || {};
    var type = String(man.type || "").toLowerCase();
    var mod = String(man.modifier || "").toLowerCase();
    if (type === "arrive") return "arrive";
    if (type === "depart") return "start";
    if (type === "roundabout" || type === "rotary" || type === "exit roundabout") return "roundabout";
    if (type === "notification" && /ferry|komp/.test(String(step.name || "").toLowerCase())) return "ferryOn";
    if (type === "off ramp" || type === "exit") return "motorwayOff";
    if (type === "on ramp" || type === "merge") return "motorwayOn";
    if (mod.indexOf("uturn") >= 0) return "uturn";
    if ((mod.indexOf("slight") >= 0 || mod.indexOf("keep") >= 0) && mod.indexOf("left") >= 0) return "leftKeep";
    if ((mod.indexOf("slight") >= 0 || mod.indexOf("keep") >= 0) && mod.indexOf("right") >= 0) return "rightKeep";
    if (mod.indexOf("sharp") >= 0 && mod.indexOf("left") >= 0) return "left";
    if (mod.indexOf("sharp") >= 0 && mod.indexOf("right") >= 0) return "rightSharp";
    if (mod.indexOf("left") >= 0) return "left";
    if (mod.indexOf("right") >= 0) return "right";
    if (type === "continue" || type === "new name" || type === "notification" || type === "fork" || type === "end of road") return "straight";
    return "straight";
  }

  function buildRoute(osrmRoute, index) {
    var steps = [];
    var at = 0;
    var raw = (osrmRoute.legs && osrmRoute.legs[0] && osrmRoute.legs[0].steps) || [];
    raw.forEach(function (step) {
      var dist = Number(step.distance) || 0;
      steps.push({
        at: at,
        text: labelOf(step),
        kind: kindOf(step),
        street: step.name || "",
        distance: dist
      });
      at += dist;
    });
    var leg = (osrmRoute.legs && osrmRoute.legs[0]) || {};
    var ann = leg.annotation || {};
    var coords = (((osrmRoute.geometry || {}).coordinates) || []).map(function (c) {
      return { lng: c[0], lat: c[1] };
    });
    var cum = [0];
    for (var i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
    var length = cum.length ? cum[cum.length - 1] : 0;
    return {
      index: index,
      label: "Útvonal " + (index + 1),
      distance: Number(osrmRoute.distance) || length,
      duration: Number(osrmRoute.duration) || 0,
      steps: steps,
      coords: coords,
      cum: cum,
      length: length,
      nodes: ann.nodes || [],
      segDist: ann.distance || [],
      limits: []
    };
  }

  function placeOnRoute(item, meters) {
    var coords = item.coords;
    var cum = item.cum;
    if (!coords.length) return { lng: origin.lng, lat: origin.lat, bearing: 0 };
    if (meters <= 0) return { lng: coords[0].lng, lat: coords[0].lat, bearing: bearing(coords[0], coords[Math.min(1, coords.length - 1)]) };
    if (meters >= item.length) {
      var last = coords[coords.length - 1];
      var prev = coords[Math.max(0, coords.length - 2)];
      return { lng: last.lng, lat: last.lat, bearing: bearing(prev, last) };
    }
    var i = 1;
    while (i < cum.length && cum[i] < meters) i++;
    var span = cum[i] - cum[i - 1] || 1;
    var t = (meters - cum[i - 1]) / span;
    return {
      lng: coords[i - 1].lng + (coords[i].lng - coords[i - 1].lng) * t,
      lat: coords[i - 1].lat + (coords[i].lat - coords[i - 1].lat) * t,
      bearing: bearing(coords[i - 1], coords[i])
    };
  }

  function bearing(a, b) {
    var y = Math.sin((b.lng - a.lng) * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180);
    var x = Math.cos(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180) -
      Math.sin(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos((b.lng - a.lng) * Math.PI / 180);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function currentStep() {
    var steps = route.steps;
    var i = 0;
    while (i < steps.length - 1 && steps[i + 1].at <= traveled + 8) i++;
    return steps[i];
  }

  function paintBanner() {
    var step = currentStep();
    var remain = Math.max(0, step.at + step.distance - traveled);
    $("turnDist").textContent = fmtRemain(remain);
    $("turnText").textContent = step.text;
    $("turnStreet").textContent = step.street;
    highlightRow(step);
    if (window.Clay) window.Clay.setDrive(traveled, step.text, step.street, fmtRemain(remain));
    paintLimit();
    if (running && window.Voice) window.Voice.tick(route, traveled);
  }

  function paintLimit() {
    var segments = route && route.limits;
    var cur = window.SpeedLimits ? window.SpeedLimits.at(segments, traveled) : null;
    var disc = $("limit");
    var key = cur ? cur.limit + ":" + (cur.posted ? "1" : "0") : "";
    if (key !== limitShown) {
      limitShown = key;
      disc.hidden = !cur;
      if (cur) {
        $("limitVal").textContent = String(cur.limit);
        disc.dataset.posted = cur.posted ? "true" : "false";
      }
    }
    var nxt = cur && window.SpeedLimits.nextChange(segments, traveled);
    var ahead = nxt ? Math.max(10, Math.round(nxt.dist / 10) * 10) : 0;
    var nextText = nxt && nxt.dist < 800 ? ahead + " m múlva " + nxt.limit : "";
    if (nextText !== nextShown) {
      nextShown = nextText;
      $("limitNext").hidden = !nextText;
      $("limitNext").textContent = nextText;
    }
  }

  function loadLimits(item) {
    var token = ++limitToken;
    item.limits = [];
    limitShown = "";
    nextShown = "";
    $("limit").hidden = true;
    $("limitNext").hidden = true;
    if (!window.SpeedLimits) return;
    window.SpeedLimits.load(item).then(function (segments) {
      if (token !== limitToken || route !== item) return;
      item.limits = segments;
      paintLimit();
      var posted = segments.filter(function (seg) { return seg.posted; }).length;
      setStatus(item.label + ": " + fmtDist(item.distance) + ". Sebességhatár " + segments.length + " szakasz, ebből " + posted + " tábla szerint. " + heardLine() + ".");
    }).catch(function () {
      if (token !== limitToken) return;
      setStatus("A sebességhatár most nem elérhető. Az út megvan. " + heardLine() + ".");
    });
  }

  function fillTable() {
    var body = $("maneuvers");
    body.innerHTML = "";
    route.steps.forEach(function (step, index) {
      var tr = document.createElement("tr");
      tr.dataset.index = String(index);
      tr.innerHTML = "<td>" + (index + 1) + "</td><td>" + step.text + "</td><td>" + (step.street || "—") + "</td><td>" + fmtDist(step.distance) + "</td>";
      body.appendChild(tr);
    });
  }

  function highlightRow(step) {
    var index = route.steps.indexOf(step);
    var rows = $("maneuvers").querySelectorAll("tr");
    Array.prototype.forEach.call(rows, function (row) {
      row.className = row.dataset.index === String(index) ? "active" : "";
    });
  }

  function showRoute(item) {
    stop();
    route = item;
    traveled = 0;
    $("panel").hidden = false;
    $("routes").hidden = routeChoices.length < 2;
    Array.prototype.forEach.call($("routes").querySelectorAll("button"), function (button) {
      button.setAttribute("aria-current", button.dataset.index === String(item.index) ? "true" : "false");
    });
    fillTable();
    if (window.Clay) window.Clay.setRoute(route);
    if (window.Voice) window.Voice.reset();
    paintBanner();
    $("go").hidden = false;
    setStatus(item.label + " kiválasztva: " + fmtDist(item.distance) + ". Sebességhatár olvasása…");
    loadLimits(item);
    if (window.Traffic) window.Traffic.arm(route);
    trafficShown = "";
    considerTraffic(true);
  }

  function considerTraffic(forcePaint) {
    if (!route || !destination || !window.Traffic) return;
    var pos = placeOnRoute(route, traveled);
    window.Traffic.consider(route, traveled, pos, destination).then(function (got) {
      if (got || forcePaint) paintTraffic(true);
    });
  }

  function paintTraffic(force) {
    if (!window.Traffic || !route) return;
    var text = window.Traffic.label(route, traveled);
    var extra = window.Traffic.delayAhead(route, traveled);
    var left = Math.max(0, route.duration * (1 - traveled / Math.max(1, route.length)) + extra);
    var arrival = text ? text + " · érkezés " + Math.max(1, Math.round(left / 60)) + " perc" : "";
    if (!force && arrival === trafficShown) return;
    trafficShown = arrival;
    $("traffic").hidden = !arrival;
    $("traffic").textContent = arrival;
  }

  function showRouteChoices(list) {
    routeChoices = list;
    var box = $("routes");
    box.innerHTML = "";
    list.forEach(function (item) {
      var li = document.createElement("li");
      var button = document.createElement("button");
      button.type = "button";
      button.dataset.index = String(item.index);
      var minutes = Math.max(1, Math.round(item.duration / 60));
      button.textContent = item.label + " — " + fmtDist(item.distance) + ", " + minutes + " perc";
      button.addEventListener("click", function () { showRoute(item); });
      li.appendChild(button);
      box.appendChild(li);
    });
    box.hidden = list.length < 2;
    showRoute(list[0]);
  }

  function plan(dest) {
    destination = dest;
    setStatus("Útvonal számítása…");
    $("results").hidden = true;
    var url = "https://router.project-osrm.org/route/v1/driving/" +
      origin.lng + "," + origin.lat + ";" + dest.lng + "," + dest.lat +
      "?overview=full&geometries=geojson&steps=true&alternatives=true&annotations=nodes,distance";
    fetch(url).then(function (res) { return res.json(); }).then(function (data) {
      var routes = (data && data.routes) || [];
      if (!routes.length) {
        setStatus("Nincs útvonal.");
        return;
      }
      showRouteChoices(routes.slice(0, 3).map(buildRoute));
    }).catch(function () {
      setStatus("Az útvonaltervező nem válaszolt.");
    });
  }

  function labelPlace(p) {
    return [p.name, p.street, p.city, p.country].filter(Boolean).join(", ");
  }

  function search(query) {
    setStatus("Keresés…");
    fetch("https://photon.komoot.io/api/?limit=6&q=" + encodeURIComponent(query))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var features = (data && data.features) || [];
        var box = $("results");
        box.innerHTML = "";
        if (!features.length) {
          box.hidden = true;
          setStatus("Nincs találat.");
          return;
        }
        features.forEach(function (feature) {
          var p = feature.properties || {};
          var coords = (feature.geometry || {}).coordinates || [];
          var li = document.createElement("li");
          var button = document.createElement("button");
          button.type = "button";
          button.textContent = labelPlace(p);
          button.addEventListener("click", function () {
            plan({ lng: coords[0], lat: coords[1], label: labelPlace(p) });
          });
          li.appendChild(button);
          box.appendChild(li);
        });
        box.hidden = false;
        setStatus(features.length + " találat. Válassz célt.");
      }).catch(function () {
        setStatus("A keresés nem válaszolt.");
      });
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function tick(now) {
    if (!running || !route) return;
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    var liveGps = Date.now() - gps.at < 4000;
    if (!liveGps) {
      var pace = window.Traffic ? window.Traffic.pace(route, traveled) : 1;
      traveled += SPEED * pace * dt;
    }
    paintBanner();
    if (Math.floor(now / 1000) !== Math.floor((now - dt * 1000) / 1000)) {
      considerTraffic(false);
      paintTraffic(false);
    }
    if (traveled >= route.length) {
      stop();
      if (window.Voice) window.Voice.play("arrive", "now");
      setStatus("Megérkeztél. Hang: " + heardLine() + ".");
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function heardLine() {
    if (!window.Voice) return voiceFiles.length + " hang";
    return window.Voice.heard() + "/" + window.Voice.total() + " hang elhangzott";
  }

  function prepareVoices() {
    if (!window.Voice) return Promise.resolve();
    return window.Voice.load().then(function () {
      voiceFiles = Array(window.Voice.total());
      setStatus("Keresés egy célra. " + heardLine() + ", minden irány él.");
    }).catch(function () {
      setStatus("Keresés egy célra. A hanglista nem tölthető.");
    });
  }

  $("search").addEventListener("submit", function (event) {
    event.preventDefault();
    var query = $("q").value.trim();
    if (query) search(query);
  });

  $("go").addEventListener("click", function () {
    if (!route || running) return;
    if (traveled >= route.length) traveled = 0;
    running = true;
    lastT = performance.now();
    lastCam = 0;
    if (window.Voice) window.Voice.start();
    raf = requestAnimationFrame(tick);
  });

  function snapTravel(lng, lat) {
    var best = 0;
    var bestD = 1e12;
    var coords = route.coords;
    var cum = route.cum;
    for (var i = 0; i < coords.length; i++) {
      var d = haversine(coords[i], { lng: lng, lat: lat });
      if (d < bestD) {
        bestD = d;
        best = cum[i] || 0;
      }
    }
    if (bestD < 70) traveled = best;
  }

  function onGps(lat, lng, speed) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    gps.at = Date.now();
    gps.speed = Number.isFinite(speed) && speed >= 0 ? speed : null;
    if (window.Voice) window.Voice.gps(true);
    if (!route) {
      origin = { lng: lng, lat: lat };
      return;
    }
    if (running) snapTravel(lng, lat);
  }

  function startGps() {
    var native = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    if (!native) {
      if (!navigator.geolocation) return;
      navigator.geolocation.watchPosition(function (pos) {
        onGps(pos.coords.latitude, pos.coords.longitude, pos.coords.speed);
      }, function () {}, { enableHighAccuracy: true, maximumAge: 1000 });
      return;
    }
    var geo = window.Capacitor.registerPlugin("Geolocation");
    var begin = function () {
      geo.watchPosition({ enableHighAccuracy: true }, function (pos, err) {
        if (err || !pos || !pos.coords) return;
        onGps(pos.coords.latitude, pos.coords.longitude, pos.coords.speed);
      });
    };
    if (geo.requestPermissions) geo.requestPermissions().then(begin).catch(begin);
    else begin();
  }

  prepareVoices();
  startGps();
})();
