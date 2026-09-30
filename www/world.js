(function () {
  "use strict";

  var canvas = document.getElementById("stage");
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd7e8f8);
  scene.fog = new THREE.Fog(0xe4eef8, 70, 260);

  var camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(0, 1.65, 8);

  scene.add(new THREE.HemisphereLight(0xfff4ea, 0xc9b6dc, 1.15));
  var sun = new THREE.DirectionalLight(0xfff7ee, 1.35);
  sun.position.set(-40, 80, 20);
  scene.add(sun);

  var clay = function (color) {
    return new THREE.MeshStandardMaterial({ color: color, roughness: 0.86, metalness: 0 });
  };
  var roadMat = clay(0x9ed9b0);
  roadMat.side = THREE.DoubleSide;
  var edgeMat = clay(0xf7f3ee);
  edgeMat.side = THREE.DoubleSide;
  var groundMat = clay(0xe7f3ea);
  var hillMat = clay(0xd9c6ee);
  var trunkMat = clay(0xf3e6d4);
  var leafMat = clay(0xffffff);
  var dashMat = clay(0xf6f3f0);

  var ground = new THREE.Mesh(new THREE.CircleGeometry(800, 48), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  scene.add(ground);

  var dash = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.22, 1.1), dashMat);
  dash.position.set(0, -0.72, -1.15);
  camera.add(dash);
  scene.add(camera);

  var signCanvas = document.createElement("canvas");
  signCanvas.width = 512;
  signCanvas.height = 256;
  var signTex = new THREE.CanvasTexture(signCanvas);
  signTex.colorSpace = THREE.SRGBColorSpace || signTex.colorSpace;
  var sign = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 2.1),
    new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.7, metalness: 0, transparent: true })
  );
  var signPost = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 12), trunkMat);
  var signGroup = new THREE.Group();
  sign.position.y = 2.15;
  signPost.position.y = 0.8;
  signGroup.add(signPost);
  signGroup.add(sign);
  signGroup.visible = false;
  scene.add(signGroup);

  var routeLocal = [];
  var routeCum = [];
  var routeOrigin = null;
  var meters = 0;
  var disposed = [];
  var signKey = "";

  function localOf(lng, lat) {
    var cos = Math.cos(routeOrigin.lat * Math.PI / 180);
    return {
      x: (lng - routeOrigin.lng) * 111320 * cos,
      z: -(lat - routeOrigin.lat) * 110540
    };
  }

  function simplify(points) {
    var out = [points[0]];
    for (var i = 1; i < points.length - 1; i++) {
      var prev = out[out.length - 1];
      var p = points[i];
      if (Math.hypot(p.x - prev.x, p.z - prev.z) >= 6) out.push(p);
    }
    out.push(points[points.length - 1]);
    return out;
  }

  function ribbon(points, width, y) {
    var half = width / 2;
    var n = points.length;
    var verts = new Float32Array(n * 2 * 3);
    for (var i = 0; i < n; i++) {
      var a = points[Math.max(0, i - 1)];
      var b = points[Math.min(n - 1, i + 1)];
      var dx = b.x - a.x;
      var dz = b.z - a.z;
      var len = Math.hypot(dx, dz) || 1;
      var sx = -dz / len * half;
      var sz = dx / len * half;
      var o = i * 6;
      verts[o] = points[i].x + sx;
      verts[o + 1] = y;
      verts[o + 2] = points[i].z + sz;
      verts[o + 3] = points[i].x - sx;
      verts[o + 4] = y;
      verts[o + 5] = points[i].z - sz;
    }
    var indices = [];
    for (var j = 0; j < n - 1; j++) {
      var k = j * 2;
      indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  function addMesh(geo, material) {
    var mesh = new THREE.Mesh(geo, material);
    scene.add(mesh);
    disposed.push(mesh);
    return mesh;
  }

  function clearBuilt() {
    var seen = [];
    disposed.forEach(function (mesh) {
      scene.remove(mesh);
      if (mesh.geometry && seen.indexOf(mesh.geometry) < 0) {
        seen.push(mesh.geometry);
        mesh.geometry.dispose();
      }
    });
    disposed = [];
  }

  function fit(text, n) {
    text = String(text || "");
    if (text.length <= n) return text;
    return text.slice(0, n - 1) + "…";
  }

  function paintSign(distance, maneuver, street) {
    var key = distance + "|" + maneuver + "|" + street;
    if (key === signKey) return;
    signKey = key;
    var ctx = signCanvas.getContext("2d");
    ctx.clearRect(0, 0, 512, 256);
    ctx.fillStyle = "#f7f4ef";
    roundRect(ctx, 16, 16, 480, 224, 36);
    ctx.fill();
    ctx.fillStyle = "#6d5b86";
    ctx.font = "700 64px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(distance || "—", 256, 110);
    ctx.fillStyle = "#3c3150";
    ctx.font = "700 36px Segoe UI, sans-serif";
    ctx.fillText(fit(maneuver || "", 22), 256, 168);
    ctx.fillStyle = "#8a7b9e";
    ctx.font = "600 30px Segoe UI, sans-serif";
    ctx.fillText(fit(street || "", 26), 256, 212);
    signTex.needsUpdate = true;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function scatter(points) {
    var leafColors = [0xdec4e4, 0xf3c9dc, 0xc9d8f4, 0xe7d0f0];
    var treeGeo = new THREE.SphereGeometry(1, 16, 12);
    var trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.1, 8);
    var trees = new THREE.InstancedMesh(treeGeo, leafMat, Math.max(1, Math.floor(points.length / 2) * 2));
    var trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.count);
    var houseGeo = new THREE.BoxGeometry(1, 1, 1);
    var houseMat = clay(0xffffff);
    var houses = new THREE.InstancedMesh(houseGeo, houseMat, Math.max(1, Math.floor(points.length / 3)));
    var dummy = new THREE.Object3D();
    var color = new THREE.Color();
    var treeIndex = 0;
    var houseIndex = 0;
    for (var i = 2; i < points.length - 2; i += 2) {
      var a = points[i - 1];
      var b = points[i + 1];
      var dx = b.x - a.x;
      var dz = b.z - a.z;
      var len = Math.hypot(dx, dz) || 1;
      var sx = -dz / len;
      var sz = dx / len;
      var side = (i % 4 === 0) ? 1 : -1;
      var p = points[i];
      if (treeIndex < trees.count) {
        var scale = 1.3 + (i % 5) * 0.18;
        dummy.position.set(p.x + sx * side * 11, 1.5 * scale, p.z + sz * side * 11);
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        trees.setMatrixAt(treeIndex, dummy.matrix);
        trees.setColorAt(treeIndex, color.setHex(leafColors[i % leafColors.length]));
        dummy.position.set(p.x + sx * side * 11, 0.45, p.z + sz * side * 11);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        trunks.setMatrixAt(treeIndex, dummy.matrix);
        treeIndex++;
      }
      if (i % 6 === 0 && houseIndex < houses.count) {
        var h = 2.2 + (i % 4) * 0.7;
        dummy.position.set(p.x + sx * -side * 16, h / 2, p.z + sz * -side * 16);
        dummy.scale.set(2.4, h, 2.8);
        dummy.updateMatrix();
        houses.setMatrixAt(houseIndex, dummy.matrix);
        houses.setColorAt(houseIndex, color.setHex([0xfff6ee, 0xf6e3ef, 0xe7e4fb, 0xf8efe4][houseIndex % 4]));
        houseIndex++;
      }
    }
    trees.count = treeIndex;
    trunks.count = treeIndex;
    houses.count = houseIndex;
    if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
    if (houses.instanceColor) houses.instanceColor.needsUpdate = true;
    trees.instanceMatrix.needsUpdate = true;
    trunks.instanceMatrix.needsUpdate = true;
    houses.instanceMatrix.needsUpdate = true;
    scene.add(trees);
    scene.add(trunks);
    scene.add(houses);
    disposed.push(trees, trunks, houses);
    placePandas(points);

    var hill = new THREE.SphereGeometry(1, 20, 14);
    for (var h = 0; h < 7; h++) {
      var anchor = points[Math.floor((h + 1) * points.length / 8)] || points[0];
      var mesh = new THREE.Mesh(hill, hillMat);
      var hs = 18 + h * 4;
      mesh.position.set(anchor.x + (h % 2 ? 46 : -52), -hs * 0.35, anchor.z - 30 - h * 6);
      mesh.scale.set(hs, hs * 0.62, hs);
      scene.add(mesh);
      disposed.push(mesh);
    }
  }

  function placePandas(points) {
    var white = clay(0xf7f7f7);
    var black = clay(0x2c2c2c);
    var bodyGeo = new THREE.SphereGeometry(0.55, 14, 12);
    var earGeo = new THREE.SphereGeometry(0.12, 10, 8);
    for (var n = 1; n <= 3; n++) {
      var p = points[Math.floor(n * points.length / 5)];
      if (!p) continue;
      var panda = new THREE.Group();
      var body = new THREE.Mesh(bodyGeo, white);
      body.scale.set(1.15, 0.82, 0.95);
      body.position.y = 0.5;
      var head = new THREE.Mesh(bodyGeo, white);
      head.scale.set(0.62, 0.62, 0.62);
      head.position.set(0, 1.05, 0.12);
      var earL = new THREE.Mesh(earGeo, black);
      earL.position.set(-0.22, 1.32, 0.05);
      var earR = new THREE.Mesh(earGeo, black);
      earR.position.set(0.22, 1.32, 0.05);
      panda.add(body, head, earL, earR);
      panda.position.set(p.x + 8, 0, p.z);
      scene.add(panda);
      disposed.push(body, head, earL, earR, panda);
    }
  }

  function sample(dist) {
    if (!routeCum.length) return { x: 0, z: 6, tx: 0, tz: -1 };
    if (dist <= 0) dist = 0;
    if (dist >= routeCum[routeCum.length - 1]) dist = routeCum[routeCum.length - 1] - 0.05;
    var i = 1;
    while (i < routeCum.length && routeCum[i] < dist) i++;
    var span = (routeCum[i] - routeCum[i - 1]) || 1;
    var t = (dist - routeCum[i - 1]) / span;
    var a = routeLocal[i - 1];
    var b = routeLocal[i];
    var x = a.x + (b.x - a.x) * t;
    var z = a.z + (b.z - a.z) * t;
    var dx = b.x - a.x;
    var dz = b.z - a.z;
    var len = Math.hypot(dx, dz) || 1;
    return { x: x, z: z, tx: dx / len, tz: dz / len };
  }

  function frame() {
    var here = sample(meters);
    var ahead = sample(meters + 22);
    camera.position.set(here.x, 1.55, here.z);
    camera.lookAt(ahead.x, 1.35, ahead.z);
    camera.up.set(0, 1, 0);
  }

  function previewRoad() {
    var points = [];
    for (var i = 0; i <= 40; i++) points.push({ x: 0, z: -i * 8 });
    clearBuilt();
    addMesh(ribbon(points, 10.5, 0.01), edgeMat);
    addMesh(ribbon(points, 7.2, 0.05), roadMat);
    scatter(points);
    routeLocal = points;
    routeCum = points.map(function (_, i) { return i * 8; });
    meters = 8;
    signGroup.visible = false;
    frame();
  }

  function setRoute(route) {
    routeOrigin = route.coords[0];
    var raw = route.coords.map(function (p) { return localOf(p.lng, p.lat); });
    var points = simplify(raw);
    if (points.length < 2) return;
    clearBuilt();
    addMesh(ribbon(points, 10.5, 0.01), edgeMat);
    addMesh(ribbon(points, 7.2, 0.05), roadMat);
    scatter(points);
    routeLocal = points;
    routeCum = [0];
    for (var i = 1; i < points.length; i++) {
      routeCum.push(routeCum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
    }
    meters = 0;
    signKey = "";
    signGroup.visible = true;
    frame();
  }

  function setDrive(traveled, maneuver, street, distance) {
    meters = traveled;
    paintSign(distance, maneuver, street);
    var spot = sample(Math.min(routeCum[routeCum.length - 1] || 0, traveled + 28));
    var here = sample(traveled);
    var sideX = -here.tz;
    var sideZ = here.tx;
    signGroup.position.set(spot.x + sideX * 3.2, 0, spot.z + sideZ * 3.2);
    signGroup.lookAt(camera.position.x, sign.position.y, camera.position.z);
    frame();
  }

  function resize() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  window.addEventListener("resize", resize);

  function loop() {
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  previewRoad();
  loop();

  window.Clay = {
    setRoute: setRoute,
    setDrive: setDrive
  };
})();
