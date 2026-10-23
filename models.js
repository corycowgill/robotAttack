// ============================================================
// Robot Attack — procedural 3D models (Three.js r128, global THREE)
// ============================================================
// Defines window.Models. No loaders / addons; everything is built from
// primitive geometries + a few canvas textures.
//
// Scale: 1 grid cell = 12 world units. Buildings ~9-10 wide (HQ ~11.6),
// origin at ground center, +Y up. Robots ~9 tall, facing +Z.
//
// Sharing rules:
//   * Materials and geometries are cached and SHARED across all models.
//   * Per-instance resources (pushed to group.userData._own) are:
//       - building beacon material (clone of team trim, blinks per instance)
//       - robot hull / paint / visor materials (clones, flashed on hit;
//         listed in userData.flashMats, each has userData.baseEmissive /
//         userData.baseIntensity to restore after a flash)
//     Models.dispose(group) disposes ONLY those.
// ============================================================
(function () {
  'use strict';

  var PI = Math.PI;
  var TEAM = { player: 0x2EC4FF, ai: 0xFF4422 };

  function teamColor(side) { return side === 'ai' ? TEAM.ai : TEAM.player; }
  function sideKey(side) { return side === 'ai' ? 'ai' : 'player'; }

  // ── Canvas textures ────────────────────────────────────────
  var _glowTex = null;
  function glowTexture() {
    if (_glowTex) return _glowTex;
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0.0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(255,255,255,0.75)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    grd.addColorStop(1.0, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    _glowTex = new THREE.CanvasTexture(c);
    return _glowTex;
  }

  var _hazTex = null;
  function hazardTexture() {
    if (_hazTex) return _hazTex;
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    g.fillStyle = '#1b1b1b';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#e8a90c';
    for (var i = -64; i < 128; i += 32) {
      g.beginPath();
      g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 + 64, 64); g.lineTo(i + 64, 64);
      g.closePath(); g.fill();
    }
    _hazTex = new THREE.CanvasTexture(c);
    _hazTex.wrapS = _hazTex.wrapT = THREE.RepeatWrapping;
    _hazTex.repeat.set(3, 1);
    _hazTex.encoding = THREE.sRGBEncoding;
    return _hazTex;
  }

  var _panelTex = null;
  function panelTexture() {
    if (_panelTex) return _panelTex;
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#e6e6e6';
    g.fillRect(0, 0, 128, 128);
    // speckle noise (deterministic LCG so all sessions look the same)
    var s = 12345;
    function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    for (var i = 0; i < 900; i++) {
      var v = 190 + Math.floor(rnd() * 60);
      g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    // panel seams
    g.strokeStyle = 'rgba(60,60,60,0.55)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, 126, 126);
    g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.stroke();
    g.strokeStyle = 'rgba(70,70,70,0.25)';
    g.beginPath(); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
    _panelTex = new THREE.CanvasTexture(c);
    _panelTex.encoding = THREE.sRGBEncoding;
    return _panelTex;
  }

  // ── Material cache ─────────────────────────────────────────
  var MC = {};
  function std(key, opts) {
    if (!MC[key]) MC[key] = new THREE.MeshStandardMaterial(opts);
    return MC[key];
  }
  var MAT = {
    concrete: function () { return std('concrete', { color: 0x8a8478, roughness: 0.85, metalness: 0.0, map: panelTexture() }); },
    concreteDS: function () { return std('concreteDS', { color: 0x8a8478, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide }); },
    concreteDark: function () { return std('concreteDark', { color: 0x55524c, roughness: 0.92, metalness: 0.0, map: panelTexture() }); },
    gunmetal: function () { return std('gunmetal', { color: 0x3a3f45, roughness: 0.45, metalness: 0.6 }); },
    gunmetalDS: function () { return std('gunmetalDS', { color: 0x4a5058, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }); },
    steel: function () { return std('steel', { color: 0x24282d, roughness: 0.5, metalness: 0.65 }); },
    steelLight: function () { return std('steelLight', { color: 0x7a8189, roughness: 0.35, metalness: 0.75 }); },
    hazard: function () { return std('hazard', { color: 0xffffff, roughness: 0.7, metalness: 0.1, map: hazardTexture() }); },
    pit: function () { return std('pit', { color: 0x050607, roughness: 1.0, metalness: 0.0 }); },
    glass: function () { return std('glass', { color: 0x0d1419, roughness: 0.15, metalness: 0.8 }); },
    lamp: function () { return std('lamp', { color: 0xffe0a0, emissive: 0xffc060, emissiveIntensity: 1.6, roughness: 0.4 }); },
    white: function () { return std('white', { color: 0xd9dcdf, roughness: 0.4, metalness: 0.3 }); },
    yellow: function () { return std('yellow', { color: 0xffc72c, roughness: 0.45, metalness: 0.2 }); },
    rubber: function () { return std('rubber', { color: 0x15171a, roughness: 0.95, metalness: 0.0 }); },
    robotHull: function () { return std('robotHull', { color: 0x5c636b, roughness: 0.42, metalness: 0.65 }); },
    podHull: function () { return std('podHull', { color: 0x6f767e, roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide }); },
    orbCore: function () { return std('orbCore', { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.0, roughness: 0.3 }); }
  };
  // team emissive trim (light strips, windows, markers)
  function trim(side) {
    var k = sideKey(side), c = TEAM[k];
    // dark base colour so the visible hue is almost purely emissive (stays saturated under ACES)
    var base = new THREE.Color(c).multiplyScalar(0.25);
    return std('trim_' + k, { color: base, emissive: c, emissiveIntensity: 1.25, roughness: 0.35, metalness: 0.0 });
  }
  // brighter variant for orbs/cores
  function trimHot(side) {
    var k = sideKey(side), c = TEAM[k];
    var base = new THREE.Color(c).multiplyScalar(0.3);
    return std('trimHot_' + k, { color: base, emissive: c, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.0 });
  }
  // team paint (non-emissive armour panels)
  function paint(side) {
    var k = sideKey(side);
    var col = new THREE.Color(TEAM[k]).multiplyScalar(0.55);
    return std('paint_' + k, { color: col, roughness: 0.6, metalness: 0.15 });
  }
  function paintDS(side) {
    var k = sideKey(side);
    var col = new THREE.Color(TEAM[k]).multiplyScalar(0.55);
    return std('paintDS_' + k, { color: col, roughness: 0.6, metalness: 0.15, side: THREE.DoubleSide });
  }
  // additive unlit materials
  function additive(key, color, opacity) {
    if (!MC[key]) MC[key] = new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: opacity, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false
    });
    return MC[key];
  }
  function haloMat(color) {
    var key = 'halo_' + color;
    if (!MC[key]) MC[key] = new THREE.SpriteMaterial({
      map: glowTexture(), color: color, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false
    });
    return MC[key];
  }
  var ghostLineMat = null;
  function ghostMat() {
    if (!ghostLineMat) ghostLineMat = new THREE.LineBasicMaterial({ color: 0xff7755, transparent: true, opacity: 0.35, depthWrite: false });
    return ghostLineMat;
  }

  // ── Geometry cache ────────────────────────────────────────
  var GC = {};
  function geo(key, make) { return GC[key] || (GC[key] = make()); }
  function r3(n) { return Math.round(n * 1000) / 1000; }
  function box(w, h, d) {
    return geo('box' + r3(w) + '_' + r3(h) + '_' + r3(d), function () { return new THREE.BoxGeometry(w, h, d); });
  }
  function cyl(rt, rb, h, seg, open, ts, tl) {
    seg = seg || 16;
    var key = 'cyl' + [r3(rt), r3(rb), r3(h), seg, !!open, r3(ts || 0), r3(tl === undefined ? 2 * PI : tl)].join('_');
    return geo(key, function () { return new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!open, ts || 0, tl === undefined ? 2 * PI : tl); });
  }
  function sph(r, ws, hs, ts, tl) {
    var key = 'sph' + [r3(r), ws, hs, r3(ts || 0), r3(tl === undefined ? PI : tl)].join('_');
    return geo(key, function () { return new THREE.SphereGeometry(r, ws, hs, 0, 2 * PI, ts || 0, tl === undefined ? PI : tl); });
  }
  function cone(r, h, seg) {
    return geo('cone' + [r3(r), r3(h), seg || 16].join('_'), function () { return new THREE.ConeGeometry(r, h, seg || 16); });
  }
  function torus(r, t, rs, ts) {
    return geo('tor' + [r3(r), r3(t), rs || 8, ts || 24].join('_'), function () { return new THREE.TorusGeometry(r, t, rs || 8, ts || 24); });
  }
  // square frustum with axis-aligned faces (half-widths)
  function frustum(hwTop, hwBot, h) {
    return geo('fru' + [r3(hwTop), r3(hwBot), r3(h)].join('_'), function () {
      var g = new THREE.CylinderGeometry(hwTop * Math.SQRT2, hwBot * Math.SQRT2, h, 4, 1);
      g.rotateY(PI / 4);
      return g;
    });
  }

  // ── Mesh helpers ──────────────────────────────────────────
  function add(parent, g, m, x, y, z, noShadow) {
    var mesh = new THREE.Mesh(g, m);
    mesh.position.set(x || 0, y || 0, z || 0);
    if (!noShadow) { mesh.castShadow = true; mesh.receiveShadow = true; }
    parent.add(mesh);
    return mesh;
  }
  function addFlat(parent, g, m, x, y, z) { // emissive/decals: receive only
    var mesh = new THREE.Mesh(g, m);
    mesh.position.set(x || 0, y || 0, z || 0);
    mesh.receiveShadow = false; mesh.castShadow = false;
    parent.add(mesh);
    return mesh;
  }
  function group(parent, x, y, z) {
    var g = new THREE.Group();
    g.position.set(x || 0, y || 0, z || 0);
    if (parent) parent.add(g);
    return g;
  }
  var _up = new THREE.Vector3(0, 1, 0);
  // cylinder strut between two points
  function beam(parent, a, b, r, m, seg) {
    var dir = new THREE.Vector3().subVectors(b, a);
    var len = dir.length();
    var mesh = add(parent, cyl(r, r, r3(len), seg || 6), m);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(_up, dir.normalize());
    return mesh;
  }
  function halo(parent, color, size, x, y, z) {
    var s = new THREE.Sprite(haloMat(color));
    s.scale.set(size, size, size);
    s.position.set(x || 0, y || 0, z || 0);
    s.renderOrder = 10;
    parent.add(s);
    return s;
  }
  function bolts(parent, m, cx, y, cz, hx, hz) { // 4 bolt heads at rectangle corners
    var g = box(0.18, 0.12, 0.18);
    add(parent, g, m, cx - hx, y, cz - hz); add(parent, g, m, cx + hx, y, cz - hz);
    add(parent, g, m, cx - hx, y, cz + hz); add(parent, g, m, cx + hx, y, cz + hz);
  }
  function vent(parent, x, y, z, ry) { // small roof vent box with grill slats
    var v = group(parent, x, y, z);
    v.rotation.y = ry || 0;
    add(v, box(1.1, 0.45, 0.8), MAT.gunmetal(), 0, 0.22, 0);
    for (var i = -1; i <= 1; i++) add(v, box(0.9, 0.06, 0.1), MAT.steel(), 0, 0.47, i * 0.22, true);
    return v;
  }
  function pipeRun(parent, pts, r, m) {
    for (var i = 0; i < pts.length - 1; i++) {
      beam(parent, pts[i], pts[i + 1], r, m, 8);
      if (i > 0) add(parent, sph(r * 1.25, 8, 6), m, pts[i].x, pts[i].y, pts[i].z);
    }
  }
  function V(x, y, z) { return new THREE.Vector3(x, y, z); }

  var PLINTH_H = 0.6;
  function plinth(g, side, w) {
    add(g, box(w, PLINTH_H, w), MAT.concreteDark(), 0, PLINTH_H / 2, 0);
    // bevel lip
    add(g, box(w + 0.3, 0.15, w + 0.3), MAT.steel(), 0, 0.075, 0);
    var t = trim(side), h = w / 2 - 0.35, L = 1.6;
    // team-coloured light band around the plinth's vertical faces (reads from any angle)
    var bx = box(w + 0.02, 0.14, 0.04), bz = box(0.04, 0.14, w + 0.02);
    addFlat(g, bx, t, 0, PLINTH_H * 0.55, w / 2 + 0.01); addFlat(g, bx, t, 0, PLINTH_H * 0.55, -w / 2 - 0.01);
    addFlat(g, bz, t, w / 2 + 0.01, PLINTH_H * 0.55, 0); addFlat(g, bz, t, -w / 2 - 0.01, PLINTH_H * 0.55, 0);
    var gx = box(L, 0.1, 0.3), gz = box(0.3, 0.1, L);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) {
      addFlat(g, gx, t, s[0] * (h - L / 2 + 0.15), PLINTH_H + 0.05, s[1] * h);
      addFlat(g, gz, t, s[0] * h, PLINTH_H + 0.05, s[1] * (h - L / 2 + 0.15));
    });
    return PLINTH_H;
  }

  // per-instance beacon (blinks)
  function beacon(g, side, parent, x, y, z, size) {
    var m = trimHot(side).clone();
    g.userData._own.push(m);
    var b = add(parent, sph(0.28 * (size || 1), 10, 8), m, x, y, z, true);
    b.castShadow = false;
    var h = halo(b, teamColor(side), 3.2 * (size || 1));
    b.userData.halo = h;
    b.userData.haloSize = 3.2 * (size || 1);
    return b;
  }

  function baseGroup(type, side) {
    var g = new THREE.Group();
    g.name = 'building_' + type;
    g.userData = { type: type, side: sideKey(side), parts: {}, muzzle: null, height: 5, _own: [], _phase: Math.random() * 10 };
    return g;
  }

  // ════════════════════════════════════════════════════════
  // BUILDINGS
  // ════════════════════════════════════════════════════════

  function buildDepot(g, side) {
    var y0 = plinth(g, side, 10);
    var C = MAT.concrete(), GM = MAT.gunmetal(), ST = MAT.steel(), T = trim(side), P = paint(side);
    // main warehouse
    add(g, box(7.6, 3.4, 6.0), C, -0.6, y0 + 1.7, -0.9);
    // roof: shallow pitched (two slabs)
    var r1 = add(g, box(8.0, 0.3, 3.4), GM, -0.6, y0 + 3.75, -2.35); r1.rotation.x = -0.18;
    var r2 = add(g, box(8.0, 0.3, 3.4), GM, -0.6, y0 + 3.75, 0.55); r2.rotation.x = 0.18;
    add(g, box(8.1, 0.25, 0.3), P, -0.6, y0 + 4.05, -0.9);
    // front loading doors with hazard frame
    for (var i = 0; i < 2; i++) {
      var dx = -2.6 + i * 3.6;
      add(g, box(2.9, 2.6, 0.25), MAT.hazard(), dx, y0 + 1.3, 2.12);
      add(g, box(2.5, 2.3, 0.3), ST, dx, y0 + 1.2, 2.15);
      for (var k = 0; k < 5; k++) add(g, box(2.5, 0.06, 0.1), GM, dx, y0 + 0.3 + k * 0.45, 2.33, true);
      addFlat(g, box(2.4, 0.16, 0.12), T, dx, y0 + 2.75, 2.2);
    }
    // loading dock slab
    add(g, box(7.6, 0.4, 1.4), MAT.concreteDark(), -0.6, y0 + 0.2, 2.9);
    // side fuel tanks (horizontal)
    for (var j = 0; j < 2; j++) {
      var tz = -2.6 + j * 2.3;
      var tank = add(g, cyl(0.85, 0.85, 3.2, 16), MAT.steelLight(), 4.0, y0 + 1.15, tz);
      tank.rotation.x = PI / 2;
      add(g, sph(0.85, 14, 8, 0, PI / 2), MAT.steelLight(), 4.0, y0 + 1.15, tz + 1.6).rotation.x = PI / 2;
      add(g, sph(0.85, 14, 8, 0, PI / 2), MAT.steelLight(), 4.0, y0 + 1.15, tz - 1.6).rotation.x = -PI / 2;
      addFlat(g, cyl(0.87, 0.87, 0.25, 16), P, 4.0, y0 + 1.15, tz).rotation.x = PI / 2;
      add(g, box(1.4, 0.3, 0.4), ST, 4.0, y0 + 0.15, tz - 1.0);
      add(g, box(1.4, 0.3, 0.4), ST, 4.0, y0 + 0.15, tz + 1.0);
    }
    pipeRun(g, [V(3.6, y0 + 2.0, -2.6), V(3.6, y0 + 2.6, -2.6), V(3.2, y0 + 2.6, -2.6)], 0.12, MAT.steelLight());
    // stacked crates front-right
    var cr = [[3.4, 0.45, 3.4, 0], [4.2, 0.45, 3.0, 0.3], [3.8, 1.3, 3.2, 0.15]];
    cr.forEach(function (c, n) {
      var m = add(g, box(0.9, 0.9, 0.9), n === 2 ? P : MAT.yellow(), c[0], y0 + c[1], c[2]);
      m.rotation.y = c[3];
    });
    // roof vents
    vent(g, -3.0, y0 + 3.8, -0.9); vent(g, 1.6, y0 + 3.8, -0.9);
    // side windows
    addFlat(g, box(0.1, 0.35, 4.6), T, -4.42, y0 + 2.7, -0.9);
    g.userData.parts.beacon = beacon(g, side, g, 2.7, y0 + 4.5, -3.2, 0.8);
    add(g, cyl(0.06, 0.06, 0.8, 6), ST, 2.7, y0 + 4.0, -3.2);
    g.userData.height = 5.4;
  }

  function buildPower(g, side) {
    var y0 = plinth(g, side, 10);
    var C = MAT.concrete(), GM = MAT.gunmetal(), ST = MAT.steel(), T = trim(side), P = paint(side);
    // cooling tower (hyperboloid lathe)
    var tower = geo('coolTower', function () {
      var pts = [];
      for (var i = 0; i <= 12; i++) {
        var y = i / 12 * 6.6;
        var r = 1.55 * Math.sqrt(1 + Math.pow((y - 4.6) / 2.1, 2));
        pts.push(new THREE.Vector2(r, y));
      }
      return new THREE.LatheGeometry(pts, 24);
    });
    var tw = add(g, tower, MAT.concreteDS(), -2.2, y0, -1.8);
    add(g, cyl(2.0, 2.0, 0.1, 20), MAT.pit(), -2.2, y0 + 6.0, -1.8, true);
    addFlat(g, cyl(1.98, 2.02, 0.35, 24, true), T, -2.2, y0 + 5.4, -1.8);
    // support legs at base of tower
    for (var a = 0; a < 8; a++) {
      var ang = a / 8 * 2 * PI;
      add(g, box(0.3, 0.6, 0.3), ST, -2.2 + Math.cos(ang) * 2.7, y0 + 0.3, -1.8 + Math.sin(ang) * 2.7);
    }
    // reactor / turbine hall
    add(g, box(5.0, 2.8, 4.0), C, 2.2, y0 + 1.4, 1.8);
    add(g, box(5.2, 0.25, 4.2), GM, 2.2, y0 + 2.9, 1.8);
    // reactor dome
    add(g, sph(1.5, 18, 10, 0, PI / 2), GM, 1.7, y0 + 3.0, 2.0);
    addFlat(g, torus(1.5, 0.09, 6, 24), T, 1.7, y0 + 3.05, 2.0).rotation.x = PI / 2;
    // glowing reactor window
    addFlat(g, box(2.8, 0.5, 0.12), T, 2.2, y0 + 1.9, 3.82);
    add(g, box(2.0, 1.4, 0.2), ST, 1.5, y0 + 0.7, 3.85);
    // turbine fan housing on hall roof
    add(g, cyl(1.05, 1.05, 0.5, 20, true), GM, 3.85, y0 + 3.25, 0.6);
    var fan = group(g, 3.85, y0 + 3.3, 0.6);
    add(fan, cyl(0.25, 0.25, 0.3, 10), ST, 0, 0, 0);
    for (var b = 0; b < 5; b++) {
      var bl = add(fan, box(0.85, 0.05, 0.3), MAT.steelLight(), 0, 0, 0);
      var ba = b / 5 * 2 * PI;
      bl.position.set(Math.cos(ba) * 0.5, 0, Math.sin(ba) * 0.5);
      bl.rotation.y = -ba; bl.rotation.x = 0.4;
    }
    g.userData.parts.fan = fan;
    // smoke stacks
    for (var s = 0; s < 2; s++) {
      var sx = 3.6 + s * 0.0, sz = -1.6 - s * 1.7;
      add(g, cyl(0.45, 0.55, 8.2, 14), MAT.steelLight(), sx, y0 + 4.1, sz);
      addFlat(g, cyl(0.47, 0.47, 0.25, 14), T, sx, y0 + 7.4, sz);
      add(g, cyl(0.55, 0.55, 0.3, 14), ST, sx, y0 + 8.2, sz);
      add(g, cyl(0.38, 0.38, 0.05, 12), MAT.pit(), sx, y0 + 8.36, sz, true);
      add(g, cyl(0.75, 0.75, 0.3, 14), C, sx, y0 + 0.15, sz);
    }
    // pipes: tower -> hall
    var pm = MAT.steelLight();
    pipeRun(g, [V(-0.4, y0 + 1.0, -0.7), V(0.6, y0 + 1.0, -0.7), V(0.6, y0 + 1.0, 0.0), V(0.6, y0 + 1.6, 0.0)], 0.2, pm);
    pipeRun(g, [V(-0.6, y0 + 0.5, -2.6), V(2.8, y0 + 0.5, -2.6), V(2.8, y0 + 0.5, -0.2)], 0.16, pm);
    // transformers
    for (var t = 0; t < 2; t++) {
      var tx = -3.6 + t * 1.6;
      add(g, box(1.2, 1.2, 1.0), GM, tx, y0 + 0.6, 3.4);
      for (var f = -2; f <= 2; f++) add(g, box(0.06, 1.0, 0.9), ST, tx + f * 0.2, y0 + 0.6, 3.95);
      add(g, cyl(0.1, 0.12, 0.5, 6), MAT.white(), tx - 0.3, y0 + 1.45, 3.4);
      add(g, cyl(0.1, 0.12, 0.5, 6), MAT.white(), tx + 0.3, y0 + 1.45, 3.4);
      addFlat(g, box(0.9, 0.12, 0.05), P, tx, y0 + 0.95, 3.92);
    }
    g.userData.parts.beacon = beacon(g, side, g, 3.6, y0 + 8.7, -3.3, 0.8);
    g.userData.height = 9.4;
  }

  function buildRadar(g, side) {
    var y0 = plinth(g, side, 10);
    var C = MAT.concrete(), GM = MAT.gunmetal(), ST = MAT.steel(), T = trim(side), P = paint(side);
    // control bunker
    add(g, frustum(2.6, 3.1, 2.2), C, 0, y0 + 1.1, 0);
    add(g, box(5.4, 0.25, 5.4), GM, 0, y0 + 2.3, 0);
    addFlat(g, box(3.8, 0.3, 0.1), T, 0, y0 + 1.5, 2.86);
    addFlat(g, box(0.1, 0.3, 3.8), T, 2.86, y0 + 1.5, 0);
    addFlat(g, box(0.1, 0.3, 3.8), T, -2.86, y0 + 1.5, 0);
    add(g, box(1.2, 1.5, 0.3), ST, -1.6, y0 + 0.75, 2.95);
    // equipment cabinets outside
    add(g, box(1.6, 1.4, 1.0), GM, 3.6, y0 + 0.7, -3.4);
    add(g, box(1.0, 1.0, 1.0), P, 3.6, y0 + 0.5, -2.0);
    add(g, box(1.6, 1.0, 1.0), GM, -3.6, y0 + 0.5, 3.6);
    vent(g, -3.6, y0 + 1.0, 3.6);
    // lattice mast
    var base = y0 + 2.4, top = y0 + 8.0;
    var legs = [];
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (s) {
      var a = V(s[0] * 1.5, base, s[1] * 1.5), b = V(s[0] * 0.45, top, s[1] * 0.45);
      legs.push([a, b]);
      beam(g, a, b, 0.12, ST, 6);
    });
    var lv = 4;
    for (var i = 0; i < lv; i++) {
      var f0 = i / lv, f1 = (i + 1) / lv;
      for (var L = 0; L < 4; L++) {
        var A = legs[L], B = legs[(L + 1) % 4];
        var p0 = A[0].clone().lerp(A[1], f0), p1 = B[0].clone().lerp(B[1], f1);
        beam(g, p0, p1, 0.05, GM, 4);
        var q0 = A[0].clone().lerp(A[1], f1), q1 = B[0].clone().lerp(B[1], f1);
        beam(g, q0, q1, 0.06, GM, 4);
      }
    }
    // rotating platform + dish
    add(g, cyl(0.9, 0.9, 0.35, 16), GM, 0, top + 0.15, 0);
    var dish = group(g, 0, top + 0.35, 0);
    add(dish, cyl(0.35, 0.5, 0.9, 10), ST, 0, 0.45, 0);
    add(dish, box(1.0, 0.6, 1.2), GM, 0, 0.9, -0.5);
    add(dish, box(0.7, 0.7, 0.9), P, 0, 0.9, -1.4); // counterweight
    var piv = group(dish, 0, 1.1, 0.1);
    var tilt = 0.6; // radians above horizon
    var d = V(0, Math.sin(tilt), Math.cos(tilt));
    var R = 3.0;
    var dishGeo = sph(R, 24, 6, 0, 0.72);
    var dm = add(piv, dishGeo, MAT.gunmetalDS(), d.x * R, d.y * R, d.z * R);
    dm.quaternion.setFromUnitVectors(_up, d.clone().negate());
    var rimR = R * Math.sin(0.72), rimOff = R - R * Math.cos(0.72);
    var rim = addFlat(piv, torus(rimR, 0.06, 6, 32), T, d.x * rimOff, d.y * rimOff, d.z * rimOff);
    rim.quaternion.setFromUnitVectors(V(0, 0, 1), d);
    // feed horn + struts
    var focal = d.clone().multiplyScalar(R * 0.5);
    add(piv, cyl(0.12, 0.2, 0.45, 8), ST, focal.x, focal.y, focal.z).quaternion.setFromUnitVectors(_up, d);
    for (var k = 0; k < 3; k++) {
      var ang = k / 3 * 2 * PI;
      var side1 = V(Math.cos(ang), 0, 0).add(V(0, -Math.sin(ang) * Math.cos(tilt), Math.sin(ang) * Math.sin(tilt)));
      var rp = d.clone().multiplyScalar(rimOff).add(side1.multiplyScalar(rimR * 0.95));
      beam(piv, rp, focal, 0.035, ST, 4);
    }
    beam(piv, V(0, 0, 0), d.clone().multiplyScalar(0.3), 0.18, ST, 8);
    g.userData.parts.dish = dish;
    // beacon on a whip antenna at a corner
    add(g, cyl(0.05, 0.08, 4.5, 6), ST, -3.8, y0 + 2.25, -3.8);
    g.userData.parts.beacon = beacon(g, side, g, -3.8, y0 + 4.6, -3.8, 0.9);
    g.userData.height = 11.5;
  }

  function buildSilo(g, side) {
    var y0 = plinth(g, side, 10);
    var C = MAT.concrete(), GM = MAT.gunmetal(), ST = MAT.steel(), T = trim(side), P = paint(side);
    // armoured bunker body
    add(g, frustum(3.9, 4.6, 2.2), C, 0, y0 + 1.1, 0);
    add(g, box(7.9, 0.3, 7.9), GM, 0, y0 + 2.35, 0);
    // pit opening
    add(g, box(4.6, 0.1, 5.0), MAT.pit(), 0, y0 + 2.52, 0, true);
    // missile nose visible in pit
    add(g, cone(0.75, 1.6, 16), MAT.white(), 0, y0 + 1.8, 0);
    addFlat(g, cyl(0.76, 0.76, 0.2, 16), T, 0, y0 + 1.1, 0);
    // rails
    add(g, box(7.6, 0.25, 0.4), ST, 0, y0 + 2.62, 2.75);
    add(g, box(7.6, 0.25, 0.4), ST, 0, y0 + 2.62, -2.75);
    // hatch doors
    function door(sx) {
      var d = group(g, sx * 1.2, y0 + 2.85, 0);
      add(d, box(2.4, 0.35, 5.6), GM, 0, 0, 0);
      add(d, box(2.0, 0.1, 5.2), MAT.hazard(), 0, 0.2, 0);
      add(d, box(1.4, 0.12, 4.2), P, sx * -0.1, 0.25, 0);
      bolts(d, ST, 0, 0.22, 0, 0.95, 2.6);
      // hinge block / actuator
      add(d, box(0.4, 0.5, 1.0), ST, sx * 1.0, 0.1, 2.2);
      add(d, box(0.4, 0.5, 1.0), ST, sx * 1.0, 0.1, -2.2);
      return d;
    }
    g.userData.parts.hatchL = door(-1);
    g.userData.parts.hatchR = door(1);
    g.userData._hatchX = 1.2;
    // corner exhaust vents & lights
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) {
      add(g, cyl(0.35, 0.45, 0.8, 10), ST, s[0] * 3.55, y0 + 2.85, s[1] * 3.55);
      add(g, cyl(0.25, 0.25, 0.05, 10), MAT.pit(), s[0] * 3.55, y0 + 3.27, s[1] * 3.55, true);
      addFlat(g, box(1.4, 0.18, 0.1), T, s[0] * 2.6, y0 + 1.5, s[1] * 4.3);
    });
    // side control box + cable
    add(g, box(1.2, 1.3, 0.8), GM, 4.4, y0 + 0.65, -2.6);
    addFlat(g, box(0.5, 0.2, 0.05), T, 4.4, y0 + 1.0, -2.18);
    pipeRun(g, [V(4.4, y0 + 1.3, -2.6), V(4.4, y0 + 1.6, -2.6), V(3.8, y0 + 2.2, -2.6)], 0.08, MAT.steelLight());
    var mz = new THREE.Object3D(); mz.position.set(0, y0 + 3.2, 0); g.add(mz);
    g.userData.muzzle = mz;
    g.userData.parts.beacon = beacon(g, side, g, 4.4, y0 + 1.6, -2.15, 0.7);
    g.userData.height = 4.2;
  }

  function buildAA(g, side) {
    var y0 = plinth(g, side, 10);
    var C = MAT.concrete(), GM = MAT.gunmetal(), ST = MAT.steel(), T = trim(side), P = paint(side);
    // octagonal armoured base
    add(g, cyl(3.0, 4.0, 1.4, 8), C, 0, y0 + 0.7, 0).rotation.y = PI / 8;
    add(g, cyl(2.4, 2.6, 0.4, 20), GM, 0, y0 + 1.6, 0);
    addFlat(g, cyl(2.62, 2.62, 0.12, 24, true), T, 0, y0 + 1.5, 0);
    // ammo crates on the base
    add(g, box(1.0, 0.7, 0.7), MAT.yellow(), 3.4, y0 + 0.35, 3.0);
    add(g, box(1.0, 0.7, 0.7), GM, -3.5, y0 + 0.35, -2.8);
    // turret
    var tur = group(g, 0, y0 + 1.8, 0);
    add(tur, cyl(1.8, 2.0, 0.4, 20), ST, 0, 0.2, 0);
    add(tur, box(2.8, 1.3, 2.6), GM, 0, 1.05, -0.2);
    var wedge = add(tur, box(2.8, 0.9, 1.2), GM, 0, 1.05, 1.2); wedge.rotation.x = -0.5;
    add(tur, box(0.3, 1.2, 2.2), P, 1.55, 1.05, -0.2);
    add(tur, box(0.3, 1.2, 2.2), P, -1.55, 1.05, -0.2);
    addFlat(tur, box(0.06, 0.18, 1.8), T, 1.72, 1.35, -0.2);
    addFlat(tur, box(0.06, 0.18, 1.8), T, -1.72, 1.35, -0.2);
    // tracking radar on the back
    add(tur, box(0.8, 0.8, 0.8), ST, 0, 2.0, -1.0);
    var td = add(tur, cyl(0.7, 0.7, 0.12, 16), MAT.steelLight(), 0, 2.5, -1.0); td.rotation.x = -1.2;
    add(tur, cyl(0.05, 0.05, 1.2, 6), ST, 0.8, 2.3, -1.2);
    g.userData.parts.beacon = beacon(g, side, tur, 0.8, 2.95, -1.2, 0.7);
    // gun cradle (pitched up)
    var cradle = group(tur, 0, 1.3, 0.6);
    cradle.rotation.x = -0.5;
    add(cradle, box(1.9, 0.8, 1.2), ST, 0, 0, 0);
    add(cradle, cyl(0.25, 0.25, 2.2, 10), GM, 0, 0, 0).rotation.z = PI / 2;
    [-0.62, 0.62].forEach(function (x) {
      add(cradle, cyl(0.26, 0.26, 1.0, 12), GM, x, 0, 0.9).rotation.x = PI / 2;
      add(cradle, cyl(0.13, 0.13, 3.2, 10), ST, x, 0, 2.4).rotation.x = PI / 2;
      add(cradle, cyl(0.2, 0.2, 0.45, 10), GM, x, 0, 4.0).rotation.x = PI / 2;
      addFlat(cradle, cyl(0.15, 0.15, 0.12, 10), T, x, 0, 1.45).rotation.x = PI / 2;
      // ammo feed boxes
      add(cradle, box(0.4, 0.6, 0.9), MAT.yellow(), x * 1.75, -0.1, 0.1);
    });
    var mz = new THREE.Object3D(); mz.position.set(0, 0, 4.3); cradle.add(mz);
    g.userData.parts.turret = tur;
    g.userData.parts.pitch = cradle;
    g.userData.muzzle = mz;
    g.userData.height = 6.2;
  }

  function buildShield(g, side) {
    var y0 = plinth(g, side, 10);
    var C = MAT.concrete(), GM = MAT.gunmetal(), ST = MAT.steel(), T = trim(side), P = paint(side);
    add(g, cyl(3.6, 4.4, 1.0, 6), C, 0, y0 + 0.5, 0);
    add(g, cyl(2.4, 3.0, 0.6, 6), GM, 0, y0 + 1.3, 0);
    addFlat(g, cyl(3.62, 3.62, 0.14, 6, true), T, 0, y0 + 1.02, 0);
    add(g, cyl(0.9, 1.3, 1.6, 12), ST, 0, y0 + 2.2, 0);
    addFlat(g, cyl(0.5, 0.5, 2.0, 12), trimHot(side), 0, y0 + 2.6, 0);
    // three curved pylons (tall vertical then bent inward)
    for (var i = 0; i < 3; i++) {
      var a = i / 3 * 2 * PI + PI / 6;
      var cx = Math.cos(a), cz = Math.sin(a);
      var p0 = V(cx * 2.9, y0 + 1.0, cz * 2.9);
      var p1 = V(cx * 2.6, y0 + 4.2, cz * 2.6);
      var p2 = V(cx * 1.5, y0 + 5.9, cz * 1.5);
      var b1 = beam(g, p0, p1, 0.32, GM, 6);
      var b2 = beam(g, p1, p2, 0.26, GM, 6);
      add(g, sph(0.4, 10, 8), ST, p1.x, p1.y, p1.z);
      add(g, box(0.9, 0.9, 0.9), P, p0.x * 0.95, y0 + 1.5, p0.z * 0.95).rotation.y = -a;
      // emitter tip
      var tip = add(g, cone(0.22, 0.7, 8), trimHot(side), p2.x * 0.85, p2.y - 0.1, p2.z * 0.85, true);
      tip.quaternion.setFromUnitVectors(_up, V(-cx, -0.3, -cz).normalize());
      // glowing strips on pylons
      var s = addFlat(g, box(0.12, 2.6, 0.12), T, cx * 3.05, y0 + 2.7, cz * 3.05);
      s.quaternion.copy(b1.quaternion);
    }
    // orb
    var orb = group(g, 0, y0 + 5.1, 0);
    addFlat(orb, sph(0.95, 20, 14), trimHot(side));
    addFlat(orb, sph(0.4, 12, 10), MAT.orbCore());
    halo(orb, teamColor(side), 7.0);
    var rings = group(orb);
    var r1 = addFlat(rings, torus(1.55, 0.06, 6, 40), trim(side)); r1.rotation.x = PI / 2 + 0.35;
    var r2 = addFlat(rings, torus(1.35, 0.05, 6, 40), trim(side)); r2.rotation.x = PI / 2 - 0.35; r2.rotation.y = 0.6;
    g.userData.parts.orb = orb;
    g.userData._rings = rings;
    // side capacitors
    add(g, cyl(0.45, 0.45, 1.4, 12), MAT.steelLight(), 3.9, y0 + 0.7, -3.4);
    add(g, cyl(0.45, 0.45, 1.4, 12), MAT.steelLight(), 3.0, y0 + 0.7, -3.9);
    addFlat(g, cyl(0.47, 0.47, 0.15, 12), T, 3.9, y0 + 1.2, -3.4);
    addFlat(g, cyl(0.47, 0.47, 0.15, 12), T, 3.0, y0 + 1.2, -3.9);
    g.userData.parts.beacon = beacon(g, side, g, -3.7, y0 + 1.4, 3.3, 0.7);
    add(g, cyl(0.06, 0.06, 1.2, 6), ST, -3.7, y0 + 0.7, 3.3);
    g.userData.height = 6.6;
  }

  function buildHangar(g, side) {
    var y0 = plinth(g, side, 10);
    var C = MAT.concrete(), GM = MAT.gunmetal(), ST = MAT.steel(), T = trim(side), P = paint(side);
    var W = 9.0, D = 7.6, Hw = 3.6;
    // side walls + back
    add(g, box(0.8, Hw, D), C, -W / 2 + 0.4, y0 + Hw / 2, -0.4);
    add(g, box(0.8, Hw, D), C, W / 2 - 0.4, y0 + Hw / 2, -0.4);
    add(g, box(W, Hw, 0.6), C, 0, y0 + Hw / 2, -D / 2 - 0.1);
    // arched roof
    var roof = geo('hangarRoof', function () {
      var gg = new THREE.CylinderGeometry(W / 2, W / 2, D, 20, 1, false, PI / 2, PI);
      gg.rotateX(PI / 2);
      gg.scale(1, 0.62, 1);
      return gg;
    });
    add(g, roof, GM, 0, y0 + Hw, -0.4);
    // roof ribs
    for (var i = -1; i <= 1; i++) {
      var rib = geo('hangarRib', function () {
        var gg = new THREE.TorusGeometry(W / 2 + 0.05, 0.12, 5, 20, PI);
        gg.scale(1, 0.62, 1);
        return gg;
      });
      add(g, rib, ST, 0, y0 + Hw, -0.4 + i * 2.6);
    }
    // team stripe across the roof
    var stripe = geo('hangarStripe', function () {
      var gg = new THREE.CylinderGeometry(W / 2 + 0.03, W / 2 + 0.03, 1.2, 20, 1, true, PI / 2 + 0.25, PI - 0.5);
      gg.rotateX(PI / 2);
      gg.scale(1, 0.62, 1);
      return gg;
    });
    add(g, stripe, P, 0, y0 + Hw, -1.4);
    // dark interior behind door
    add(g, box(7.4, 4.4, 0.3), MAT.pit(), 0, y0 + 2.2, 2.9, true);
    // door frame gantry
    add(g, box(0.7, 4.8, 0.9), ST, -3.85, y0 + 2.4, 3.4);
    add(g, box(0.7, 4.8, 0.9), ST, 3.85, y0 + 2.4, 3.4);
    add(g, box(8.4, 0.8, 0.9), ST, 0, y0 + 5.0, 3.4);
    add(g, box(0.75, 4.8, 0.1), MAT.hazard(), -3.85, y0 + 2.4, 3.86);
    add(g, box(0.75, 4.8, 0.1), MAT.hazard(), 3.85, y0 + 2.4, 3.86);
    addFlat(g, box(6.6, 0.22, 0.1), T, 0, y0 + 5.0, 3.88);
    // door
    var door = group(g, 0, y0, 3.25);
    add(door, box(7.0, 4.4, 0.3), GM, 0, 2.2, 0);
    for (var k = 0; k < 6; k++) add(door, box(6.8, 0.12, 0.12), ST, 0, 0.5 + k * 0.7, 0.18);
    add(door, box(7.0, 0.5, 0.34), MAT.hazard(), 0, 0.25, 0);
    add(door, box(2.6, 1.4, 0.06), P, 0, 2.6, 0.17);
    addFlat(door, box(1.6, 0.25, 0.08), T, 0, 2.6, 0.22);
    g.userData.parts.door = door;
    // apron lights in front
    addFlat(g, box(0.4, 0.06, 0.4), MAT.lamp(), -3.0, y0 + 0.03, 4.55);
    addFlat(g, box(0.4, 0.06, 0.4), MAT.lamp(), 3.0, y0 + 0.03, 4.55);
    // side windows + side control booth
    addFlat(g, box(0.08, 0.35, 5.6), T, W / 2 + 0.01, y0 + 2.9, -0.6);
    addFlat(g, box(0.08, 0.35, 5.6), T, -W / 2 - 0.01, y0 + 2.9, -0.6);
    // roof vents & exhausts
    vent(g, -1.8, y0 + Hw + 2.6, -2.4); vent(g, 1.8, y0 + Hw + 2.6, -2.4);
    add(g, cyl(0.3, 0.3, 1.2, 10), MAT.steelLight(), 2.6, y0 + Hw + 2.6, 0.8);
    pipeRun(g, [V(-4.7, y0 + 0.4, -3.5), V(-4.7, y0 + 3.0, -3.5), V(-4.7, y0 + 3.0, 1.0)], 0.12, MAT.steelLight());
    g.userData.parts.beacon = beacon(g, side, g, 0, y0 + 5.65, 3.4, 0.9);
    g.userData.height = 7.4;
  }

  function buildGunpod(g, side) {
    var y0 = plinth(g, side, 9.5);
    var C = MAT.concrete(), GM = MAT.gunmetal(), ST = MAT.steel(), T = trim(side), P = paint(side);
    // sandbag ring-ish armoured skirt
    add(g, cyl(2.9, 3.6, 1.0, 6), C, 0, y0 + 0.5, 0);
    addFlat(g, cyl(2.92, 2.92, 0.12, 6, true), T, 0, y0 + 0.94, 0);
    for (var s = 0; s < 6; s++) {
      var a = s / 6 * 2 * PI + PI / 6;
      add(g, box(0.5, 0.35, 1.2), MAT.rubber(), Math.cos(a) * 3.75, y0 + 0.18, Math.sin(a) * 3.75).rotation.y = -a;
    }
    var tur = group(g, 0, y0 + 1.0, 0);
    add(tur, cyl(1.9, 2.1, 0.4, 16), ST, 0, 0.2, 0);
    var dome = add(tur, sph(1.85, 18, 10, 0, PI / 2), GM, 0, 0.4, -0.1);
    dome.scale.set(1, 0.75, 1.1);
    add(tur, box(2.6, 0.25, 2.2), P, 0, 1.55, -0.4);
    addFlat(tur, box(1.6, 0.18, 0.1), T, 0, 1.0, 1.85);
    // side ammo drum
    var drum = add(tur, cyl(0.6, 0.6, 0.7, 14), MAT.yellow(), -1.85, 0.9, 0.0); drum.rotation.z = PI / 2;
    add(tur, box(0.5, 0.3, 1.4), ST, -1.25, 0.9, 0.6);
    // mantlet
    add(tur, box(1.3, 1.0, 0.8), ST, 0, 0.95, 1.6);
    // rotary barrel assembly (spins about local Z)
    var barrel = group(tur, 0, 0.95, 2.0);
    add(barrel, cyl(0.42, 0.42, 0.5, 12), GM, 0, 0, 0.2).rotation.x = PI / 2;
    for (var b = 0; b < 6; b++) {
      var ba = b / 6 * 2 * PI;
      add(barrel, cyl(0.09, 0.09, 2.2, 6), ST, Math.cos(ba) * 0.26, Math.sin(ba) * 0.26, 1.3).rotation.x = PI / 2;
    }
    add(barrel, cyl(0.4, 0.4, 0.18, 12), GM, 0, 0, 1.4).rotation.x = PI / 2;
    add(barrel, cyl(0.4, 0.4, 0.22, 12), GM, 0, 0, 2.3).rotation.x = PI / 2;
    var mz = new THREE.Object3D(); mz.position.set(0, 0.95, 4.5); tur.add(mz);
    g.userData.parts.turret = tur;
    g.userData.parts.barrel = barrel;
    g.userData.muzzle = mz;
    // sensor + beacon
    add(tur, box(0.5, 0.4, 0.5), ST, 0.9, 1.75, -0.6);
    addFlat(tur, box(0.3, 0.15, 0.05), T, 0.9, 1.75, -0.33);
    g.userData.parts.beacon = beacon(g, side, tur, -0.8, 1.9, -0.9, 0.7);
    g.userData.height = 4.2;
  }

  function buildHQ(g, side) {
    var y0 = plinth(g, side, 11.6);
    var C = MAT.concrete(), GM = MAT.gunmetal(), ST = MAT.steel(), T = trim(side), P = paint(side);
    // tier 1
    add(g, frustum(4.6, 5.2, 3.0), C, 0, y0 + 1.5, 0);
    add(g, box(9.4, 0.3, 9.4), GM, 0, y0 + 3.15, 0);
    // window bands tier 1
    [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(function (d) {
      var wb = d[0] === 0 ? box(6.5, 0.32, 0.1) : box(0.1, 0.32, 6.5);
      addFlat(g, wb, T, d[0] * 5.0, y0 + 1.9, d[1] * 5.0);
      addFlat(g, wb, T, d[0] * 5.07, y0 + 1.1, d[1] * 5.07);
    });
    // entrance
    add(g, box(2.4, 2.0, 1.0), ST, 0, y0 + 1.0, 5.1);
    addFlat(g, box(1.6, 1.4, 0.08), MAT.glass(), 0, y0 + 0.8, 5.62);
    addFlat(g, box(2.4, 0.2, 0.1), T, 0, y0 + 2.05, 5.65);
    // tier 2
    add(g, frustum(3.2, 3.6, 2.6), C, -0.6, y0 + 4.6, -0.6);
    add(g, box(6.6, 0.25, 6.6), GM, -0.6, y0 + 6.0, -0.6);
    addFlat(g, box(5.4, 0.3, 0.1), T, -0.6, y0 + 4.9, 2.92);
    addFlat(g, box(0.1, 0.3, 5.4), T, 2.92, y0 + 4.9, -0.6);
    add(g, box(0.5, 1.8, 3.0), P, -3.7, y0 + 4.4, -0.6);
    // command tower
    add(g, cyl(1.7, 1.9, 3.2, 10), GM, -0.6, y0 + 7.7, -0.6);
    add(g, cyl(2.5, 1.8, 1.4, 10), C, -0.6, y0 + 9.9, -0.6);
    addFlat(g, cyl(2.3, 2.05, 0.5, 10, true), T, -0.6, y0 + 9.9, -0.6);
    add(g, cyl(2.55, 2.55, 0.2, 10), ST, -0.6, y0 + 10.7, -0.6);
    // antenna mast + beacon
    add(g, cyl(0.08, 0.14, 2.6, 6), ST, -0.2, y0 + 12.0, -0.2);
    add(g, box(1.2, 0.06, 0.06), ST, -0.2, y0 + 11.6, -0.2);
    add(g, box(0.06, 0.06, 0.9), ST, -0.2, y0 + 12.1, -0.2);
    g.userData.parts.beacon = beacon(g, side, g, -0.2, y0 + 13.4, -0.2, 1.3);
    // small sat dish on tower roof
    var sd = add(g, sph(0.7, 12, 4, 0, 0.9), MAT.gunmetalDS(), -1.7, y0 + 11.2, -1.4);
    sd.rotation.x = 2.3;
    // helipad on tier-1 roof corner
    add(g, cyl(1.5, 1.5, 0.12, 20), MAT.concreteDark(), 3.2, y0 + 3.36, 3.2);
    addFlat(g, torus(1.25, 0.07, 4, 24), T, 3.2, y0 + 3.44, 3.2).rotation.x = PI / 2;
    addFlat(g, box(0.18, 0.04, 1.0), MAT.white(), 2.9, y0 + 3.44, 3.2);
    addFlat(g, box(0.18, 0.04, 1.0), MAT.white(), 3.5, y0 + 3.44, 3.2);
    addFlat(g, box(0.6, 0.04, 0.18), MAT.white(), 3.2, y0 + 3.44, 3.2);
    // flag pole with team banner
    add(g, cyl(0.05, 0.05, 3.4, 6), MAT.steelLight(), 4.2, y0 + 5.0, -4.2);
    add(g, box(0.05, 0.8, 1.3), P, 4.2, y0 + 6.2, -3.55);
    // rooftop vents & radio
    vent(g, 3.5, y0 + 3.3, -1.5); vent(g, 3.5, y0 + 3.3, 0.3);
    vent(g, -3.5, y0 + 3.3, 3.6, PI / 2);
    pipeRun(g, [V(-5.0, y0 + 0.3, -3.0), V(-5.0, y0 + 2.6, -3.0), V(-4.0, y0 + 3.5, -3.0)], 0.13, MAT.steelLight());
    g.userData.height = 13.5;
  }

  var BUILDERS = {
    hq: buildHQ, depot: buildDepot, power: buildPower, radar: buildRadar, silo: buildSilo,
    aa: buildAA, shield: buildShield, hangar: buildHangar, gunpod: buildGunpod
  };

  function building(type, side) {
    var g = baseGroup(type, side);
    var fn = BUILDERS[type] || buildDepot;
    fn(g, sideKey(side));
    g.userData._yaw0 = g.userData.parts.turret ? g.userData.parts.turret.rotation.y : 0;
    return g;
  }

  function wrapPi(a) {
    a = (a + PI) % (2 * PI);
    if (a < 0) a += 2 * PI;
    return a - PI;
  }

  // Idle animation. Optional caller controls on group.userData:
  //   aimYaw   (radians) turret yaw target (aa, gunpod)
  //   open     (0..1) silo hatches / hangar door opening amount
  //   barrelSpin (rad/s) gunpod barrel spin speed (default 0.6 idle)
  function animate(g, t, dt) {
    var ud = g.userData, p = ud.parts;
    if (!p) return;
    dt = dt || 0;
    var ph = ud._phase || 0;
    if (p.dish) p.dish.rotation.y += dt * 0.9;
    if (p.fan) p.fan.rotation.y += dt * 7.0;
    if (p.beacon) {
      var on = ((t + ph) % 1.4) < 0.35 ? 1 : 0;
      var m = p.beacon.material;
      m.emissiveIntensity = on ? 3.0 : 0.25;
      var h = p.beacon.userData.halo;
      if (h) { var s = on ? p.beacon.userData.haloSize : 0.001; h.scale.set(s, s, s); }
    }
    if (p.orb) {
      var k = 1 + 0.08 * Math.sin((t + ph) * 3.2);
      p.orb.scale.set(k, k, k);
      if (ud._rings) { ud._rings.rotation.y += dt * 1.4; ud._rings.rotation.z = 0.2 * Math.sin(t * 0.7 + ph); }
    }
    if (p.turret) {
      if (ud.aimYaw === undefined || ud.aimYaw === null) {
        if (ud.type === 'aa') p.turret.rotation.y = Math.sin((t + ph) * 0.35) * 1.3;
      } else {
        var cur = p.turret.rotation.y;
        var diff = wrapPi(ud.aimYaw - cur);
        var step = 8 * dt;
        if (Math.abs(diff) <= step) cur = ud.aimYaw;
        else cur += diff > 0 ? step : -step;
        p.turret.rotation.y = wrapPi(cur);
      }
    }
    if (p.barrel) p.barrel.rotation.z += dt * (ud.barrelSpin === undefined ? 0.6 : ud.barrelSpin);
    if (typeof ud.open === 'number') {
      var o = Math.max(0, Math.min(1, ud.open));
      if (p.hatchL) { p.hatchL.position.x = -ud._hatchX - 2.5 * o; p.hatchR.position.x = ud._hatchX + 2.5 * o; }
      if (p.door) p.door.position.y = PLINTH_H + 5 * o;
    }
  }

  // ════════════════════════════════════════════════════════
  // ROBOT
  // ════════════════════════════════════════════════════════
  function robot(side) {
    side = sideKey(side);
    var g = new THREE.Group();
    g.name = 'robot';
    var own = [];
    var hull = MAT.robotHull().clone();
    var pnt = paint(side).clone();
    var visor = trimHot(side).clone();
    [hull, pnt, visor].forEach(function (m) {
      m.userData.baseEmissive = m.emissive.getHex();
      m.userData.baseIntensity = m.emissiveIntensity;
      own.push(m);
    });
    var ST = MAT.steel(), GM = MAT.gunmetal(), T = trim(side);
    var parts = {};

    // pelvis (static)
    var HIP_Y = 4.6;
    add(g, box(2.4, 0.8, 1.5), ST, 0, HIP_Y + 0.1, 0);
    add(g, box(1.2, 0.6, 0.4), pnt, 0, HIP_Y - 0.1, 0.8);

    function leg(sx) {
      var hip = group(g, sx * 1.15, HIP_Y, 0);
      var j = add(hip, cyl(0.5, 0.5, 0.7, 12), ST, 0, 0, 0); j.rotation.z = PI / 2;
      add(hip, box(0.95, 2.0, 1.15), hull, 0, -1.15, 0);
      add(hip, box(0.18, 1.5, 0.95), pnt, sx * 0.56, -1.05, 0);
      var knee = group(hip, 0, -2.2, 0);
      var kj = add(knee, cyl(0.42, 0.42, 0.85, 10), ST, 0, 0, 0); kj.rotation.z = PI / 2;
      add(knee, box(0.75, 0.75, 0.45), pnt, 0, 0.05, 0.55);
      var shin = add(knee, frustum(0.5, 0.62, 1.9), hull, 0, -1.05, 0);
      add(knee, box(0.75, 1.3, 0.25), pnt, 0, -0.9, 0.62);
      beam(knee, V(0, -0.3, -0.6), V(0, -1.7, -0.5), 0.1, MAT.steelLight(), 6);
      // foot
      add(knee, box(0.5, 0.35, 0.5), ST, 0, -2.0, 0);
      add(knee, box(1.3, 0.4, 2.1), GM, 0, -2.2, 0.3);
      add(knee, box(1.35, 0.15, 0.6), pnt, 0, -2.0, 1.05);
      add(knee, box(0.6, 0.3, 0.5), GM, 0, -2.25, -0.85);
      return { hip: hip, knee: knee };
    }
    var L = leg(1), R = leg(-1);
    parts.hipL = L.hip; parts.kneeL = L.knee; parts.hipR = R.hip; parts.kneeR = R.knee;

    // torso
    var TORSO_Y = 4.9;
    var torso = group(g, 0, TORSO_Y, 0);
    add(torso, cyl(0.7, 0.85, 0.7, 10), ST, 0, 0.3, 0);
    add(torso, frustum(1.6, 1.25, 1.4), hull, 0, 1.2, 0);
    add(torso, box(3.6, 1.5, 2.4), hull, 0, 2.5, 0);
    add(torso, box(2.8, 1.5, 0.35), pnt, 0, 2.45, 1.25);
    var core = addFlat(torso, cyl(0.38, 0.38, 0.2, 14), visor, 0, 2.35, 1.48); core.rotation.x = PI / 2;
    halo(torso, teamColor(side), 1.6, 0, 2.35, 1.7);
    addFlat(torso, box(0.12, 0.9, 0.08), T, 1.2, 2.5, 1.44);
    addFlat(torso, box(0.12, 0.9, 0.08), T, -1.2, 2.5, 1.44);
    // backpack + exhausts
    add(torso, box(2.4, 1.9, 1.0), GM, 0, 2.3, -1.6);
    add(torso, cyl(0.25, 0.3, 1.0, 8), ST, 0.7, 3.4, -1.75);
    add(torso, cyl(0.25, 0.3, 1.0, 8), ST, -0.7, 3.4, -1.75);
    add(torso, box(1.8, 0.2, 0.08), T, 0, 1.6, -2.12, true);
    parts.torso = torso;

    // head
    var head = group(torso, 0, 3.25, 0.15);
    add(head, cyl(0.35, 0.4, 0.4, 8), ST, 0, 0.1, 0);
    add(head, box(1.3, 0.95, 1.4), hull, 0, 0.7, 0);
    add(head, box(1.4, 0.3, 1.2), pnt, 0, 1.22, -0.1);
    addFlat(head, box(1.1, 0.26, 0.12), visor, 0, 0.75, 0.72);
    halo(head, teamColor(side), 1.8, 0, 0.75, 0.9);
    add(head, cyl(0.03, 0.03, 0.9, 4), ST, 0.45, 1.6, -0.4);
    parts.head = head;

    function arm(sx, isRight) {
      var sh = group(torso, sx * 2.3, 2.85, 0);
      add(sh, sph(0.55, 10, 8), ST, 0, 0, 0);
      add(sh, box(1.4, 1.0, 1.6), pnt, sx * 0.15, 0.25, 0);
      addFlat(sh, box(0.08, 0.22, 1.3), T, sx * 0.87, 0.35, 0);
      add(sh, box(0.75, 1.5, 0.75), hull, 0, -1.0, 0);
      var el = group(sh, 0, -1.9, 0);
      add(el, sph(0.42, 8, 6), ST, 0, 0, 0);
      if (isRight) {
        add(el, box(1.0, 1.5, 1.05), hull, 0, -0.9, 0.05);
        add(el, box(0.2, 1.2, 0.8), pnt, sx * 0.55, -0.9, 0.05);
        add(el, box(1.1, 0.9, 1.1), GM, 0, -2.05, 0.1); // fist
        add(el, box(1.15, 0.2, 0.3), ST, 0, -2.0, 0.6);
      } else {
        // gun-arm
        add(el, box(0.95, 1.4, 1.0), hull, 0, -0.85, 0);
        add(el, cyl(0.3, 0.3, 1.6, 10), GM, 0, -1.6, 0.35);
        add(el, cyl(0.16, 0.16, 0.5, 8), ST, 0, -2.6, 0.35);
      }
      return sh;
    }
    parts.shoulderL = arm(1, false);
    parts.shoulderR = arm(-1, true);

    // shoulder cannon (on torso, left side, does not swing with the arm)
    var cannon = group(torso, 1.45, 3.75, -0.3);
    add(cannon, box(0.9, 0.75, 1.6), GM, 0, 0, 0);
    add(cannon, box(0.95, 0.12, 1.2), pnt, 0, 0.42, -0.1);
    add(cannon, cyl(0.2, 0.24, 2.0, 10), ST, 0, 0.05, 1.6).rotation.x = PI / 2;
    add(cannon, cyl(0.3, 0.3, 0.35, 10), GM, 0, 0.05, 2.55).rotation.x = PI / 2;
    addFlat(cannon, box(0.08, 0.15, 1.0), T, 0.48, 0.1, 0);
    var mz = new THREE.Object3D(); mz.position.set(0, 0.05, 2.8); cannon.add(mz);
    parts.cannon = cannon;

    g.userData = {
      type: 'robot', side: side, parts: parts, muzzle: mz, height: 9.2,
      flashMats: [hull, pnt, visor], visorMat: visor, _own: own, _torsoY: TORSO_Y
    };
    return g;
  }

  function animateRobot(g, walkPhase, moving, punch) {
    var p = g.userData.parts;
    if (!p) return;
    punch = punch || 0;
    var s = Math.sin(walkPhase || 0);
    var swing = moving ? s * 0.55 : 0;
    p.hipL.rotation.x = -swing;
    p.hipR.rotation.x = swing;
    if (p.kneeL) {
      p.kneeL.rotation.x = moving ? 0.12 + Math.max(0, Math.sin((walkPhase || 0) + PI * 0.5)) * 0.75 : 0.05;
      p.kneeR.rotation.x = moving ? 0.12 + Math.max(0, Math.sin((walkPhase || 0) - PI * 0.5)) * 0.75 : 0.05;
    }
    var bob;
    if (moving) bob = Math.abs(Math.cos(walkPhase || 0)) * 0.22 - 0.1;
    else bob = Math.sin((typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.0018) * 0.05;
    p.torso.position.y = g.userData._torsoY + bob;
    p.torso.rotation.y = (moving ? s * 0.08 : 0) - punch * 0.35;
    p.torso.rotation.x = punch * 0.12 + (moving ? 0.05 : 0);
    var armSwing = moving ? s * 0.45 : 0;
    p.shoulderL.rotation.x = armSwing;
    var rBase = -armSwing;
    p.shoulderR.rotation.x = rBase + (-1.55 - rBase) * punch;
    p.shoulderR.position.z = punch * 0.6;
  }

  // ════════════════════════════════════════════════════════
  // MISSILES / POD
  // ════════════════════════════════════════════════════════
  function exhaust(parent, len, rad, y) {
    var ex = group(parent, 0, y, 0);
    var outer = addFlat(ex, cone(rad, len, 12), additive('exOuter', 0xff7a1a, 0.75));
    outer.rotation.x = PI; outer.position.y = -len / 2;
    var inner = addFlat(ex, cone(rad * 0.55, len * 0.6, 10), additive('exInner', 0xfff0b0, 0.95));
    inner.rotation.x = PI; inner.position.y = -len * 0.3;
    halo(ex, 0xff9a40, rad * 6.5, 0, -rad, 0);
    return ex;
  }

  function missile(side) {
    side = sideKey(side);
    var g = new THREE.Group();
    g.name = 'missile';
    var W = MAT.white(), GM = MAT.gunmetal(), ST = MAT.steel();
    add(g, cyl(0.3, 0.3, 2.6, 14), W, 0, -0.15, 0); // body -1.45..1.15
    add(g, cone(0.3, 1.0, 14), W, 0, 1.65, 0);
    add(g, cone(0.08, 0.15, 8), ST, 0, 2.2, 0);
    addFlat(g, cyl(0.31, 0.31, 0.3, 14), trim(side), 0, 0.85, 0);
    add(g, cyl(0.31, 0.31, 0.2, 14), paint(side), 0, 0.4, 0);
    add(g, cyl(0.32, 0.28, 0.35, 14), GM, 0, -1.55, 0);
    add(g, cyl(0.2, 0.26, 0.25, 12), ST, 0, -1.85, 0);
    for (var i = 0; i < 4; i++) {
      var f = add(g, box(0.05, 0.75, 0.55), GM, 0, -1.15, 0);
      var a = i * PI / 2;
      f.position.x = Math.sin(a) * 0.55; f.position.z = Math.cos(a) * 0.55;
      f.rotation.y = a + PI / 2;
      var sf = add(g, box(0.04, 0.3, 0.3), GM, Math.sin(a) * 0.4, 0.6, Math.cos(a) * 0.4);
      sf.rotation.y = a + PI / 2;
    }
    var ex = exhaust(g, 1.6, 0.26, -1.95);
    g.userData = { type: 'missile', side: side, exhaust: ex, _own: [] };
    return g;
  }

  function interceptor() {
    var g = new THREE.Group();
    g.name = 'interceptor';
    add(g, cyl(0.12, 0.12, 1.4, 10), MAT.white(), 0, 0, 0);
    add(g, cone(0.12, 0.5, 10), MAT.yellow(), 0, 0.95, 0);
    addFlat(g, cyl(0.125, 0.125, 0.12, 10), MAT.yellow(), 0, 0.35, 0);
    for (var i = 0; i < 4; i++) {
      var a = i * PI / 2;
      var f = add(g, box(0.03, 0.35, 0.25), MAT.yellow(), Math.sin(a) * 0.2, -0.55, Math.cos(a) * 0.2);
      f.rotation.y = a + PI / 2;
    }
    var ex = exhaust(g, 0.8, 0.12, -0.7);
    g.userData = { type: 'interceptor', exhaust: ex, _own: [] };
    return g;
  }

  function pod(side) {
    side = sideKey(side);
    var g = new THREE.Group();
    g.name = 'pod';
    var HULL = MAT.podHull(), GM = MAT.gunmetal(), ST = MAT.steel(), T = trim(side);
    var R = 1.55, BASE = 0.9, H = 2.8, HN = 2.2;
    // base / heat shield / landing struts
    add(g, cyl(1.7, 1.4, 0.9, 16), GM, 0, 0.45 + 0.0, 0);
    add(g, cyl(1.75, 1.75, 0.15, 16), ST, 0, 0.92, 0);
    for (var l = 0; l < 4; l++) {
      var la = l * PI / 2 + PI / 4;
      beam(g, V(Math.cos(la) * 1.4, 0.8, Math.sin(la) * 1.4), V(Math.cos(la) * 2.3, 0.05, Math.sin(la) * 2.3), 0.09, ST, 6);
      add(g, box(0.5, 0.1, 0.5), ST, Math.cos(la) * 2.3, 0.05, Math.sin(la) * 2.3);
    }
    for (var n = 0; n < 4; n++) {
      var na = n * PI / 2;
      add(g, cyl(0.25, 0.32, 0.4, 8), ST, Math.cos(na) * 0.9, 0.0, Math.sin(na) * 0.9);
    }
    // inner core (visible when opened)
    add(g, cyl(0.9, 0.9, H + 0.6, 12), MAT.steel(), 0, BASE + (H + 0.6) / 2, 0);
    addFlat(g, cyl(0.92, 0.92, 0.25, 12), T, 0, BASE + 1.8, 0);
    // petals: each a quarter of cylinder + cone, hinged at the bottom edge
    var petals = [];
    var bodyG = geo('podBody', function () { return new THREE.CylinderGeometry(R, R, H, 10, 1, true, -PI / 4 + 0.02, PI / 2 - 0.04); });
    var noseG = geo('podNose', function () { return new THREE.CylinderGeometry(0.15, R, HN, 10, 1, true, -PI / 4 + 0.02, PI / 2 - 0.04); });
    var stripeG = geo('podStripe', function () { return new THREE.CylinderGeometry(R + 0.03, R + 0.03, 0.35, 10, 1, true, -PI / 4 + 0.08, PI / 2 - 0.16); });
    var panelG = geo('podPanel', function () { return new THREE.CylinderGeometry(R + 0.02, R + 0.02, 1.0, 10, 1, true, -PI / 4 + 0.25, PI / 2 - 0.5); });
    var pd = paintDS(side);
    for (var i = 0; i < 4; i++) {
      var a = i * PI / 2;
      var pv = group(g, Math.sin(a) * R, BASE, Math.cos(a) * R);
      pv.rotation.order = 'YXZ'; // yaw first, then local pitch: rotation.x > 0 opens outward
      pv.rotation.y = a;
      add(pv, bodyG, HULL, 0, H / 2, -R);
      add(pv, noseG, HULL, 0, H + HN / 2, -R);
      addFlat(pv, stripeG, T, 0, H - 0.4, -R);
      add(pv, panelG, pd, 0, 1.0, -R);
      add(pv, box(0.5, 0.2, 0.15), ST, 0, 0.1, 0.05); // hinge
      petals.push(pv);
    }
    add(g, cyl(0.18, 0.18, 0.4, 8), ST, 0, BASE + H + HN + 0.1, 0);
    var tipLight = addFlat(g, sph(0.16, 8, 6), trimHot(side), 0, BASE + H + HN + 0.35, 0);
    halo(tipLight, teamColor(side), 1.8);
    // thruster flame (points down)
    var flame = group(g, 0, 0, 0);
    var fo = addFlat(flame, cone(1.0, 3.2, 14), additive('podFlameO', 0xff6a20, 0.7));
    fo.rotation.x = PI; fo.position.y = -1.6;
    var fi = addFlat(flame, cone(0.55, 2.0, 12), additive('podFlameI', 0xfff2c0, 0.9));
    fi.rotation.x = PI; fi.position.y = -1.0;
    halo(flame, 0xff8a30, 5.5, 0, -0.6, 0);
    g.userData = { type: 'pod', side: side, flame: flame, petals: petals, height: BASE + H + HN, _own: [] };
    return g;
  }

  // ════════════════════════════════════════════════════════
  // GHOSTS (fog-of-war "last known")
  // ════════════════════════════════════════════════════════
  // shape list: ['b', w,h,d, x,y,z] boxes, ['c', rTop,rBot,h,seg, x,y,z] cylinders
  var GHOST_SHAPES = {
    hq: [['b', 11.6, 0.6, 11.6, 0, 0.3, 0], ['c', 6.6, 7.4, 3, 4, 0, 2.1, 0, 1], ['c', 4.5, 5.1, 2.6, 4, -0.6, 4.9, -0.6, 1], ['c', 1.8, 1.8, 3.2, 8, -0.6, 8.3, -0.6], ['c', 2.5, 1.8, 1.4, 8, -0.6, 10.5, -0.6], ['c', 0.1, 0.1, 2.6, 4, -0.2, 12.6, -0.2]],
    depot: [['b', 10, 0.6, 10, 0, 0.3, 0], ['b', 7.6, 3.6, 6, -0.6, 2.4, -0.9], ['c', 0.85, 0.85, 4.8, 8, 4.0, 1.75, -1.45, 0, 'x']],
    power: [['b', 10, 0.6, 10, 0, 0.3, 0], ['c', 2.1, 3.6, 6.6, 12, -2.2, 3.9, -1.8], ['b', 5, 2.8, 4, 2.2, 2.0, 1.8], ['c', 0.5, 0.5, 8.2, 6, 3.6, 4.7, -1.6], ['c', 0.5, 0.5, 8.2, 6, 3.6, 4.7, -3.3]],
    radar: [['b', 10, 0.6, 10, 0, 0.3, 0], ['c', 3.7, 4.4, 2.2, 4, 0, 1.7, 0, 1], ['c', 0.6, 2.1, 5.6, 4, 0, 5.8, 0, 1], ['c', 2.9, 2.9, 0.6, 12, 0, 10.4, 0.6]],
    silo: [['b', 10, 0.6, 10, 0, 0.3, 0], ['c', 5.5, 6.5, 2.2, 4, 0, 1.7, 0, 1], ['b', 4.8, 0.35, 5.6, 0, 3.45, 0]],
    aa: [['b', 10, 0.6, 10, 0, 0.3, 0], ['c', 3.0, 4.0, 1.4, 8, 0, 1.3, 0], ['b', 2.8, 1.3, 2.6, 0, 3.45, 0], ['b', 1.6, 0.3, 4.0, 0, 4.4, 2.2]],
    shield: [['b', 10, 0.6, 10, 0, 0.3, 0], ['c', 3.6, 4.4, 1.0, 6, 0, 1.1, 0], ['c', 0.9, 1.3, 1.6, 6, 0, 2.8, 0], ['c', 1.4, 2.8, 4.8, 3, 0, 4.0, 0], ['c', 0.95, 0.95, 1.9, 8, 0, 5.7, 0]],
    hangar: [['b', 10, 0.6, 10, 0, 0.3, 0], ['b', 9, 3.6, 7.6, 0, 2.4, -0.4], ['b', 6.6, 1.9, 7.6, 0, 5.1, -0.4], ['b', 8.4, 5.4, 0.9, 0, 3.3, 3.4]],
    gunpod: [['b', 9.5, 0.6, 9.5, 0, 0.3, 0], ['c', 2.9, 3.6, 1.0, 6, 0, 1.1, 0], ['c', 1.2, 1.9, 1.6, 8, 0, 2.4, 0], ['b', 0.9, 0.9, 2.6, 0, 2.55, 3.2]]
  };
  function ghost(type) {
    var g = new THREE.Group();
    g.name = 'ghost_' + type;
    var list = GHOST_SHAPES[type] || GHOST_SHAPES.depot;
    var m = ghostMat();
    list.forEach(function (s, idx) {
      var eg = geo('ghost_' + type + '_' + idx, function () {
        var base;
        if (s[0] === 'b') base = new THREE.BoxGeometry(s[1], s[2], s[3]);
        else {
          base = new THREE.CylinderGeometry(s[1], s[2], s[3], s[4]);
          if (s[8]) base.rotateY(PI / 4);
          if (s[9] === 'x') base.rotateX(PI / 2);
        }
        var e = new THREE.EdgesGeometry(base, 20);
        base.dispose();
        return e;
      });
      var ls = new THREE.LineSegments(eg, m);
      if (s[0] === 'b') ls.position.set(s[4], s[5], s[6]);
      else ls.position.set(s[5], s[6], s[7]);
      g.add(ls);
    });
    g.userData = { type: type, ghost: true, _own: [] };
    return g;
  }

  function dispose(g) {
    if (!g || !g.userData || !g.userData._own) return;
    g.userData._own.forEach(function (r) { if (r && r.dispose) r.dispose(); });
    g.userData._own.length = 0;
  }

  window.Models = {
    building: building,
    animate: animate,
    robot: robot,
    animateRobot: animateRobot,
    missile: missile,
    interceptor: interceptor,
    pod: pod,
    ghost: ghost,
    glowTexture: glowTexture,
    dispose: dispose,
    TEAM_COLORS: TEAM,
    materials: MC // shared material cache (read-only; do not dispose)
  };
})();
