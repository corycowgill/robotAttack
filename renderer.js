// ============================================================
// Robot Attack 2026 — Renderer
// ============================================================
// Three.js scene: lighting, terrain, overlays (grid, build zone,
// fog of war), camera rig with damping + trauma shake, picking and
// the registry of building / robot / marker meshes.

window.Renderer = (function () {
  'use strict';

  const CELL = CONST.CELL, GW = CONST.GRID_W, GH = CONST.GRID_H;
  const MAP_W = GW * CELL, MAP_H = GH * CELL;
  const MARGIN = 140;

  let scene, camera, renderer;
  let sun;
  let gridMat, zoneTex, zoneData, fogTex, fogData, fogMat;
  let hover, hoverMat, rangeGroup = null, buildGhost = null;
  const buildings = {};   // id -> rec
  const robots = {};      // id -> rec
  const ghosts = {};      // cell -> group
  const craters = {};     // cell -> group
  let markers = [];       // order/incoming marker objects
  let time = 0;

  // Camera rig
  const cam = {
    tx: MAP_W / 2, tz: MAP_H / 2 + 10, dist: 400, pitch: 0.98,
    gx: MAP_W / 2, gz: MAP_H / 2 + 10, gdist: 400,
    trauma: 0, userPanAt: -10,
    keys: {}, drag: null
  };

  // ── Helpers ───────────────────────────────────────────────
  function cellCenter(cell) {
    const x = cell % GW, y = Math.floor(cell / GW);
    return new THREE.Vector3(x * CELL + CELL / 2, 0, y * CELL + CELL / 2);
  }

  function hash(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y) {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, y * f); f *= 2; a *= 0.5; }
    return s;
  }

  // ── Scene setup ───────────────────────────────────────────
  function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111b24);
    scene.fog = new THREE.FogExp2(0x111b24, 0.0012);

    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 2, 3000);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.id = 'game-canvas';
    document.body.appendChild(renderer.domElement);

    createLights();
    createZoneOverlay();
    createFog();
    createWater();
    setMap(Rules.generateIslands(424242, CONST.LAND_TARGET));   // backdrop for the menu
    createLabels();
    createHover();

    Fx.init(scene);
    setupCameraInput();
    window.addEventListener('resize', onResize);
    frameAll(true);
    loadQuality();
  }

  function createLights() {
    const hemi = new THREE.HemisphereLight(0x8fa3c0, 0x3a2814, 0.65);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xffd9a0, 2.3);
    sun.position.set(MAP_W / 2 - 170, 280, MAP_H / 2 + 140);
    sun.target.position.set(MAP_W / 2, 0, MAP_H / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -260; sc.right = 260; sc.top = 200; sc.bottom = -200; sc.near = 50; sc.far = 800;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.4;
    scene.add(sun); scene.add(sun.target);
    const rim = new THREE.DirectionalLight(0x5fa8ff, 0.45);
    rim.position.set(MAP_W / 2 + 200, 120, MAP_H / 2 - 220);
    scene.add(rim);
  }

  // ── Islands: terrain, sea, grid and scenery rebuilt per map ─
  let terrainMesh = null, gridMesh = null, decorGroup = null, landField = null, water = null, landTex = null;

  // land mask blurred into a smooth field (1 = inland, 0 = open sea)
  function buildLandField(land) {
    let f = new Float32Array(GW * GH);
    for (let i = 0; i < f.length; i++) f[i] = land[i] ? 1 : 0;
    for (let pass = 0; pass < 2; pass++) {
      const g = new Float32Array(f.length);
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
        let t = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          t += (xx < 0 || yy < 0 || xx >= GW || yy >= GH) ? 0 : f[yy * GW + xx];
          n++;
        }
        g[y * GW + x] = land[y * GW + x] ? Math.max(0.62, t / n) : Math.min(0.45, t / n);
      }
      f = g;
    }
    return f;
  }
  function fieldAt(x, z) {
    const fx = x / CELL - 0.5, fz = z / CELL - 0.5;
    const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
    const g = (i, j) => (i < 0 || j < 0 || i >= GW || j >= GH) ? 0 : landField[j * GW + i];
    return (g(x0, z0) * (1 - tx) + g(x0 + 1, z0) * tx) * (1 - tz) + (g(x0, z0 + 1) * (1 - tx) + g(x0 + 1, z0 + 1) * tx) * tz;
  }
  const SEA_Y = -1.1;
  function terrainHeight(x, z) {
    const l = fieldAt(x, z);
    const t = Math.min(1, Math.max(0, (l - 0.3) / 0.3));
    const s = t * t * (3 - 2 * t);
    const n = fbm(x * 0.02, z * 0.02);
    const out = Math.hypot(Math.max(0, -x, x - MAP_W), Math.max(0, -z, z - MAP_H));
    const seabed = -9 - Math.min(14, out * 0.06) + (n - 0.5) * 3;
    return seabed + (0.15 + (n - 0.5) * 0.5 - seabed) * s;
  }

  function createWater() {
    const t = cellTexture(THREE.LinearFilter);
    landTex = t;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, land: { value: t.tex },
      mapSize: { value: new THREE.Vector2(MAP_W, MAP_H) },
      deep: { value: new THREE.Color(0x0a2f45) }, shallow: { value: new THREE.Color(0x2f8a96) }
    }]);
    uniforms.land.value = t.tex;
    const mat = new THREE.ShaderMaterial({
      uniforms, fog: true, transparent: true, depthWrite: false,
      vertexShader: `
        varying vec2 vW; varying vec3 vView;
        #include <fog_pars_vertex>
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xz; vView = cameraPosition - wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform float time; uniform sampler2D land; uniform vec2 mapSize; uniform vec3 deep; uniform vec3 shallow;
        varying vec2 vW; varying vec3 vView;
        #include <fog_pars_fragment>
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main() {
          vec2 uv = vW / mapSize;
          float l = 0.0;
          if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) l = texture2D(land, vec2(uv.x, 1.0 - uv.y)).a;
          float w1 = n(vW * 0.08 + vec2(time * 0.35, time * 0.2));
          float w2 = n(vW * 0.21 - vec2(time * 0.5, -time * 0.3));
          float waves = w1 * 0.6 + w2 * 0.4;
          vec3 col = mix(deep, shallow, clamp(l * 1.6 + waves * 0.15, 0.0, 1.0));
          // shoreline foam bands
          float shore = smoothstep(0.18, 0.42, l) * (1.0 - smoothstep(0.42, 0.5, l));
          float foam = shore * smoothstep(0.45, 0.8, n(vW * 0.35 + vec2(time * 0.6, 0.0)) + 0.35 * sin(l * 40.0 - time * 2.5));
          // sun glint
          vec3 V = normalize(vView);
          float glint = pow(max(0.0, waves - 0.55) * 2.2, 3.0) * (1.0 - V.y * 0.6);
          col += vec3(1.0, 0.92, 0.75) * glint * 0.35 + vec3(0.9, 0.95, 1.0) * foam * 0.75;
          gl_FragColor = vec4(col, 0.86 + foam * 0.14);
          #include <fog_fragment>
        }`
    });
    water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), mat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(MAP_W / 2, SEA_Y, MAP_H / 2);
    water.renderOrder = 1;
    scene.add(water);
  }

  function setMap(land) {
    landField = buildLandField(land);
    // sea shader shoreline texture (alpha = smoothed land)
    for (let c = 0; c < GW * GH; c++) {
      const i = texIndex(c);
      landTex.data[i] = landTex.data[i + 1] = landTex.data[i + 2] = 255;
      landTex.data[i + 3] = Math.round(landField[c] * 255);
    }
    landTex.tex.needsUpdate = true;

    // terrain
    if (terrainMesh) { scene.remove(terrainMesh); terrainMesh.geometry.dispose(); }
    const w = MAP_W + MARGIN * 2, h = MAP_H + MARGIN * 2;
    const geo = new THREE.PlaneGeometry(w, h, Math.round(w / 3), Math.round(h / 3));
    geo.rotateX(-Math.PI / 2);
    geo.translate(MAP_W / 2, 0, MAP_H / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cGround = new THREE.Color(0x7a6a50), cGround2 = new THREE.Color(0x5e5240);
    const cPlayer = new THREE.Color(0x56606a), cAI = new THREE.Color(0x6e5246);
    const cBeach = new THREE.Color(0xc9b483), cBed = new THREE.Color(0x1f3b3c);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = terrainHeight(x, z);
      pos.setY(i, y);
      const n = fbm(x * 0.035 + 7, z * 0.035 + 3);
      c.copy(cGround).lerp(cGround2, n);
      c.lerp(x / CELL <= CONST.PLAYER_MAX_X + 1 ? cPlayer : cAI, 0.32);
      const l = fieldAt(x, z);
      const beach = Math.max(0, 1 - Math.abs(l - 0.52) / 0.14);
      c.lerp(cBeach, Math.min(1, beach * 1.2));
      if (y < SEA_Y) c.lerp(cBed, Math.min(1, (SEA_Y - y) / 3));
      c.multiplyScalar(0.9 + hash(Math.floor(x * 0.7), Math.floor(z * 0.7)) * 0.18);
      c.convertSRGBToLinear();
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    terrainMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // grid: cell lines on land only, island coastlines in team colours
    if (gridMesh) { scene.remove(gridMesh); gridMesh.material.map.dispose(); gridMesh.material.dispose(); gridMesh.geometry.dispose(); }
    const px = 32;
    const cv = document.createElement('canvas');
    cv.width = GW * px; cv.height = GH * px;
    const g = cv.getContext('2d');
    const isL = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && land[y * GW + x];
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.5;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      if (!isL(x, y)) continue;
      g.strokeRect(x * px + 0.5, y * px + 0.5, px - 1, px - 1);
    }
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      if (!isL(x, y)) continue;
      g.strokeStyle = x <= CONST.PLAYER_MAX_X ? 'rgba(46,196,255,1)' : 'rgba(255,68,34,1)';
      g.lineWidth = 4;
      const X = x * px, Y = y * px;
      if (!isL(x, y - 1)) { g.beginPath(); g.moveTo(X, Y + 2); g.lineTo(X + px, Y + 2); g.stroke(); }
      if (!isL(x, y + 1)) { g.beginPath(); g.moveTo(X, Y + px - 2); g.lineTo(X + px, Y + px - 2); g.stroke(); }
      if (!isL(x - 1, y)) { g.beginPath(); g.moveTo(X + 2, Y); g.lineTo(X + 2, Y + px); g.stroke(); }
      if (!isL(x + 1, y)) { g.beginPath(); g.moveTo(X + px - 2, Y); g.lineTo(X + px - 2, Y + px); g.stroke(); }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    gridMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: gridMat ? gridMat.opacity : 0.09, depthWrite: false, blending: THREE.AdditiveBlending });
    gridMesh = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H), gridMat);
    gridMesh.rotation.x = -Math.PI / 2;
    gridMesh.position.set(MAP_W / 2, 0.35, MAP_H / 2);
    gridMesh.renderOrder = 3;
    scene.add(gridMesh);

    // scenery: rocks on beaches and in the shallows, a few sea stacks offshore
    if (decorGroup) { scene.remove(decorGroup); }
    decorGroup = new THREE.Group();
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 0.95, flatShading: true });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    let seed = 7;
    for (let k = 0; k < GW * GH; k++) seed = (seed * 31 + (land[k] ? 1 : 0)) % 2147483647;
    const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    let placed = 0;
    for (let tries = 0; tries < 4000 && placed < 120; tries++) {
      const x = -40 + r() * (MAP_W + 80), z = -40 + r() * (MAP_H + 80);
      const l = fieldAt(x, z);
      const inChannel = x > (CONST.PLAYER_MAX_X + 1) * CELL && x < CONST.AI_MIN_X * CELL && z > 0 && z < MAP_H;
      const offshore = l < 0.02 && !inChannel && r() < 0.012;
      if (!(l > 0.25 && l < 0.5) && !offshore) continue;
      const m = new THREE.Mesh(rockGeo, rockMat);
      const s = offshore ? 4 + r() * 6 : 1.2 + r() * 3;
      m.scale.set(s, s * (offshore ? 1.2 : 0.6 + r() * 0.5), s * (0.7 + r() * 0.6));
      m.rotation.set(r() * 3, r() * 3, r() * 3);
      m.position.set(x, Math.max(terrainHeight(x, z), SEA_Y - 1.5) + s * (offshore ? 0.1 : 0.25), z);
      m.castShadow = true; m.receiveShadow = true;
      decorGroup.add(m);
      placed++;
    }
    scene.add(decorGroup);
  }

  // Row letters / column numbers around the map, matching the log's cell names (e.g. "H5")
  function createLabels() {
    const px = 48, W = (GW + 2) * px, Hh = (GH + 2) * px;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = Hh;
    const g = cv.getContext('2d');
    g.font = 'bold 22px "Share Tech Mono", monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(230,240,255,0.95)';
    for (let x = 0; x < GW; x++) {
      const cx = (x + 1.5) * px;
      g.fillText(String(x + 1), cx, px * 0.55);
      g.fillText(String(x + 1), cx, Hh - px * 0.55);
    }
    for (let y = 0; y < GH; y++) {
      const cy = (y + 1.5) * px, L = String.fromCharCode(65 + y);
      g.fillText(L, px * 0.55, cy);
      g.fillText(L, W - px * 0.55, cy);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W + CELL * 2, MAP_H + CELL * 2), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(MAP_W / 2, 0.5, MAP_H / 2);
    mesh.renderOrder = 3;
    scene.add(mesh);
  }

  // Team-coloured ground marking under each structure (readable from far away)
  const footMats = {};
  let footGeo = null;
  function footprint(side, upgraded) {
    const key = side + (upgraded ? '_up' : '');
    if (!footMats[key]) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const g = cv.getContext('2d');
      const col = side === CONST.SIDE_PLAYER ? '46,196,255' : '255,68,34';
      const grd = g.createRadialGradient(64, 64, 20, 64, 64, 64);
      grd.addColorStop(0, 'rgba(' + col + ',0.0)');
      grd.addColorStop(0.75, 'rgba(' + col + ',0.25)');
      grd.addColorStop(1, 'rgba(' + col + ',0.0)');
      g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(' + col + ',0.95)'; g.lineWidth = 5;
      g.strokeRect(8, 8, 112, 112);
      if (upgraded) { g.strokeStyle = 'rgba(255,200,60,1)'; g.lineWidth = 4; g.strokeRect(18, 18, 92, 92); }
      footMats[key] = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      footGeo = footGeo || new THREE.PlaneGeometry(CELL * 0.98, CELL * 0.98).rotateX(-Math.PI / 2);
    }
    const m = new THREE.Mesh(footGeo, footMats[key]);
    m.name = 'footprint';
    m.position.y = 0.12;
    m.renderOrder = 5;
    return m;
  }

  // Strategic-zoom icon badges (same glyphs as the build bar), faded in when zoomed out
  const badgeMats = {};
  function badgeMaterial(type, side) {
    const key = type + '_' + side;
    if (badgeMats[key]) return badgeMats[key];
    const cv = document.createElement('canvas');
    cv.width = cv.height = 96;
    const g = cv.getContext('2d');
    const col = side === CONST.SIDE_PLAYER ? '#2ec4ff' : '#ff4422';
    g.fillStyle = 'rgba(8,12,18,0.82)';
    g.beginPath(); g.arc(48, 48, 40, 0, Math.PI * 2); g.fill();
    g.lineWidth = 6; g.strokeStyle = col; g.stroke();
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
    badgeMats[key] = mat;
    if (window.UI && UI.icon) {
      const svg = UI.icon(type).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" ').replace(/currentColor/g, '#ffffff');
      const img = new Image();
      img.onload = () => { g.drawImage(img, 22, 22, 52, 52); tex.needsUpdate = true; };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }
    return mat;
  }
  function makeBadge(type, side) {
    const s = new THREE.Sprite(badgeMaterial(type, side));
    s.scale.set(type === 'hq' ? 15 : 12, type === 'hq' ? 15 : 12, 1);
    s.renderOrder = 28;
    return s;
  }

  function cellTexture(filter) {
    const data = new Uint8Array(GW * GH * 4);
    const tex = new THREE.DataTexture(data, GW, GH, THREE.RGBAFormat);
    tex.magFilter = filter; tex.minFilter = filter;
    tex.needsUpdate = true;
    return { tex, data };
  }
  function texIndex(cell) {
    const x = cell % GW, y = Math.floor(cell / GW);
    return ((GH - 1 - y) * GW + x) * 4;
  }

  function createZoneOverlay() {
    const t = cellTexture(THREE.NearestFilter);
    zoneTex = t.tex; zoneData = t.data;
    const mat = new THREE.MeshBasicMaterial({ map: zoneTex, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(MAP_W / 2, 0.3, MAP_H / 2);
    mesh.renderOrder = 4;
    scene.add(mesh);
  }

  function createFog() {
    const t = cellTexture(THREE.LinearFilter);
    fogTex = t.tex; fogData = t.data;
    fogMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: fogTex }, time: { value: 0 }, res: { value: new THREE.Vector2(GW, GH) } },
      transparent: true, depthWrite: false,
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform sampler2D map; uniform float time; uniform vec2 res;
        varying vec2 vUv;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main() {
          float fog = texture2D(map, vUv).a;
          if (fog < 0.01) discard;
          vec2 p = vUv * res;
          float cl = n(p * 0.9 + vec2(time * 0.25, time * 0.11)) * 0.6 + n(p * 2.3 - vec2(time * 0.17, 0.0)) * 0.4;
          float scan = 0.04 * sin((vUv.y * res.y * 6.0) + time * 2.0);
          vec3 col = mix(vec3(0.05, 0.06, 0.10), vec3(0.16, 0.19, 0.27), cl) + scan;
          float a = fog * (0.74 + cl * 0.2);
          gl_FragColor = vec4(col, a);
        }`
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H), fogMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(MAP_W / 2, 0.6, MAP_H / 2);
    mesh.renderOrder = 6;
    scene.add(mesh);
  }

  function createHover() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    g.strokeStyle = '#fff'; g.lineWidth = 4;
    const L = 18;
    // corner brackets
    [[2, 2, 1, 1], [62, 2, -1, 1], [2, 62, 1, -1], [62, 62, -1, -1]].forEach(([x, y, sx, sy]) => {
      g.beginPath(); g.moveTo(x, y + sy * L); g.lineTo(x, y); g.lineTo(x + sx * L, y); g.stroke();
    });
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(4, 4, 56, 56);
    hoverMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x2ec4ff });
    hover = new THREE.Mesh(new THREE.PlaneGeometry(CELL, CELL), hoverMat);
    hover.rotation.x = -Math.PI / 2;
    hover.position.y = 0.9;
    hover.renderOrder = 8;
    hover.visible = false;
    scene.add(hover);
  }

  // ── Overlays ──────────────────────────────────────────────
  function setZone(fn) {
    for (let c = 0; c < GW * GH; c++) {
      const v = fn ? fn(c) : null;
      const i = texIndex(c);
      if (!v) { zoneData[i + 3] = 0; continue; }
      zoneData[i] = v[0]; zoneData[i + 1] = v[1]; zoneData[i + 2] = v[2]; zoneData[i + 3] = v[3];
    }
    zoneTex.needsUpdate = true;
  }

  function setFog(fn) {
    for (let c = 0; c < GW * GH; c++) {
      const i = texIndex(c);
      fogData[i] = fogData[i + 1] = fogData[i + 2] = 0;
      fogData[i + 3] = fn(c) ? 255 : 0;
    }
    fogTex.needsUpdate = true;
  }

  function setGridEmphasis(on) { gridMat.opacity = on ? 0.3 : 0.09; }

  function setHover(cell, color) {
    if (cell < 0) { hover.visible = false; return; }
    const p = cellCenter(cell);
    hover.position.x = p.x; hover.position.z = p.z;
    hoverMat.color.setHex(color || 0x2ec4ff);
    hover.visible = true;
  }

  function showRange(cell, radius, color, square) {
    hideRange();
    const p = cellCenter(cell);
    rangeGroup = new THREE.Group();
    const r = (radius + 0.5) * CELL;
    let edge, fill;
    if (square) {
      fill = new THREE.PlaneGeometry(r * 2, r * 2);
      fill.rotateX(-Math.PI / 2);
      edge = new THREE.EdgesGeometry(fill);
    } else {
      fill = new THREE.CircleGeometry(r, 64);
      fill.rotateX(-Math.PI / 2);
      const pts = [];
      for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
      edge = new THREE.BufferGeometry().setFromPoints(pts);
    }
    const fm = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.09, depthWrite: false, blending: THREE.AdditiveBlending });
    const lm = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const fillMesh = new THREE.Mesh(fill, fm);
    const line = square ? new THREE.LineSegments(edge, lm) : new THREE.Line(edge, lm);
    fillMesh.renderOrder = 7; line.renderOrder = 7;
    rangeGroup.add(fillMesh); rangeGroup.add(line);
    rangeGroup.position.set(p.x, 1.0, p.z);
    scene.add(rangeGroup);
  }
  function hideRange() {
    if (!rangeGroup) return;
    scene.remove(rangeGroup);
    rangeGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    rangeGroup = null;
  }

  const ghostLineOK = new THREE.LineBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.95 });
  const ghostLineBad = new THREE.LineBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.95 });
  function setBuildGhost(type, cell, valid) {
    if (buildGhost && (buildGhost.userData.ghostType !== type || cell < 0)) {
      scene.remove(buildGhost);
      Models.dispose(buildGhost);
      buildGhost = null;
    }
    if (!type || cell < 0) return;
    if (!buildGhost) {
      buildGhost = Models.ghost(type);
      buildGhost.userData.ghostType = type;
      scene.add(buildGhost);
    }
    const mat = valid ? ghostLineOK : ghostLineBad;
    buildGhost.traverse(o => { if (o.isLineSegments || o.isLine) o.material = mat; });
    const p = cellCenter(cell);
    buildGhost.position.set(p.x, 0, p.z);
  }

  // ── Order / incoming markers ──────────────────────────────
  let reticleTex = null;
  function getReticleTex() {
    if (reticleTex) return reticleTex;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    g.strokeStyle = '#fff'; g.lineWidth = 6;
    g.beginPath(); g.arc(64, 64, 44, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3;
    g.beginPath(); g.arc(64, 64, 26, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 6;
    [[64, 4, 64, 30], [64, 98, 64, 124], [4, 64, 30, 64], [98, 64, 124, 64]].forEach(l => { g.beginPath(); g.moveTo(l[0], l[1]); g.lineTo(l[2], l[3]); g.stroke(); });
    reticleTex = new THREE.CanvasTexture(cv);
    return reticleTex;
  }

  function clearMarkers() {
    for (const m of markers) {
      scene.remove(m.obj);
      m.obj.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== hoverMat) o.material.dispose(); });
    }
    markers = [];
  }

  function arcPoints(a, b, height, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + 4 * height * t * (1 - t), a.z + (b.z - a.z) * t));
    }
    return pts;
  }

  // orders: [{kind, from, to}], incoming: [{to}]
  function setMarkers(orders, incoming) {
    clearMarkers();
    for (const o of orders) {
      const color = o.kind === 'missile' ? 0xffb000 : 0x2ec4ff;
      const a = cellCenter(o.from), b = cellCenter(o.to);
      a.y = 5;
      const ret = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 1.1, CELL * 1.1),
        new THREE.MeshBasicMaterial({ map: getReticleTex(), color, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      ret.rotation.x = -Math.PI / 2;
      ret.position.set(b.x, 1.2, b.z);
      ret.renderOrder = 9;
      scene.add(ret);
      markers.push({ obj: ret, spin: o.kind === 'missile' ? 1.2 : -0.8 });
      const geo = new THREE.BufferGeometry().setFromPoints(arcPoints(a, b, missileArcHeight(a, b), 48));
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.75 }));
      line.computeLineDistances();
      line.renderOrder = 9;
      scene.add(line);
      markers.push({ obj: line, dash: true });
    }
    for (const m of incoming) {
      const b = cellCenter(m.to);
      const ret = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 1.6, CELL * 1.6),
        new THREE.MeshBasicMaterial({ map: getReticleTex(), color: 0xff2222, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      ret.rotation.x = -Math.PI / 2;
      ret.position.set(b.x, 1.25, b.z);
      ret.renderOrder = 10;
      scene.add(ret);
      markers.push({ obj: ret, spin: -2, pulse: true });
      // warning beam from the sky
      const beamGeo = new THREE.CylinderGeometry(0.6, 2.2, 90, 12, 1, true);
      beamGeo.translate(0, 45, 0);
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      beam.position.set(b.x, 0, b.z);
      beam.renderOrder = 10;
      scene.add(beam);
      markers.push({ obj: beam, pulse: true, base: 0.22 });
    }
  }

  function missileArcHeight(a, b) {
    return Math.min(85, 30 + a.distanceTo(b) * 0.18);
  }

  // ── Buildings ─────────────────────────────────────────────
  function makeHpBar(width) {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.6, 1.5), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.65, depthTest: false }));
    const fgGeo = new THREE.PlaneGeometry(width, 0.9);
    fgGeo.translate(width / 2, 0, 0.01);
    const fg = new THREE.Mesh(fgGeo, new THREE.MeshBasicMaterial({ color: 0x66ff66, depthTest: false }));
    fg.position.x = -width / 2;
    bg.renderOrder = 30; fg.renderOrder = 31;
    g.add(bg); g.add(fg);
    g.userData.fg = fg;
    g.visible = false;
    return g;
  }
  function setBar(bar, frac, force) {
    frac = Math.max(0, Math.min(1, frac));
    bar.userData.fg.scale.x = Math.max(0.001, frac);
    bar.userData.fg.material.color.setHex(frac > 0.6 ? 0x66ff66 : frac > 0.3 ? 0xffc030 : 0xff3b2f);
    bar.visible = force || frac < 0.999;
  }

  function makeShieldDome() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(CONST.COLORS.SHIELD) }, strength: { value: 1 }, flash: { value: 0 }, time: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          vP = position;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 color; uniform float strength; uniform float flash; uniform float time;
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          float f = pow(1.0 - abs(dot(vN, vV)), 2.5);
          float hex = 0.5 + 0.5 * sin(vP.y * 1.4 - time * 3.0) * sin(vP.x * 1.4) * sin(vP.z * 1.4);
          float a = (f * 0.85 + hex * 0.08) * strength + flash * 0.6;
          gl_FragColor = vec4(mix(color, vec3(1.0), flash), a);
        }`
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(CELL * 1.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.scale.y = 0.55;
    dome.renderOrder = 12;
    return dome;
  }

  const bakeCache = {};

  // Concatenate meshes (already transformed by `matrixOf(mesh)`) into one geometry
  function mergeGeometry(meshes, matrixOf) {
    const pos = [], nor = [], uv = [];
    for (const m of meshes) {
      const gg = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      gg.applyMatrix4(matrixOf(m));
      const n = gg.attributes.position.count;
      pos.push(gg.attributes.position.array);
      nor.push(gg.attributes.normal ? gg.attributes.normal.array : new Float32Array(n * 3));
      uv.push(gg.attributes.uv ? gg.attributes.uv.array : new Float32Array(n * 2));
      gg.dispose();
    }
    const cat = arrs => { const out = new Float32Array(arrs.reduce((t, a) => t + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(cat(pos), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(cat(nor), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(cat(uv), 2));
    geo.computeBoundingSphere();
    return geo;
  }

  // Merge every opaque leaf mesh into its nearest animated pivot (or the root),
  // one mesh per material, so rigs keep animating with far fewer draw calls.
  // Merged geometry is cached per model key.
  function bakePivots(root, pivots, key) {
    const cache = bakeCache[key] || (bakeCache[key] = {});
    root.updateMatrixWorld(true);
    const all = [root].concat(pivots.filter(p => p && p !== root));
    const isPivot = new Set(all);
    const m4 = new THREE.Matrix4();
    all.forEach((pivot, pi) => {
      const inv = new THREE.Matrix4().copy(pivot.matrixWorld).invert();
      const meshes = [];
      const walk = o => {
        for (const ch of o.children) {
          if (isPivot.has(ch)) continue;
          if (ch.isMesh && !ch.children.length && !Array.isArray(ch.material) && !ch.material.transparent) meshes.push(ch);
          else walk(ch);
        }
      };
      walk(pivot);
      const byMat = new Map();
      for (const m of meshes) { if (!byMat.has(m.material)) byMat.set(m.material, []); byMat.get(m.material).push(m); }
      let mi = 0;
      byMat.forEach((list, mat) => {
        if (list.length < 2) return;
        const ck = pi + '_' + (mi++);
        const geo = cache[ck] || (cache[ck] = mergeGeometry(list, m => m4.multiplyMatrices(inv, m.matrixWorld)));
        let cast = false, receive = false;
        for (const m of list) { cast = cast || m.castShadow; receive = receive || m.receiveShadow; m.parent.remove(m); }
        const merged = new THREE.Mesh(geo, mat);
        merged.castShadow = cast; merged.receiveShadow = receive;
        pivot.add(merged);
      });
    });
  }

  let blobMat = null, blobGeo = null;
  function blobShadow() {
    if (!blobMat) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const g = cv.getContext('2d');
      const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
      blobMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false });
      blobGeo = new THREE.PlaneGeometry(7, 7).rotateX(-Math.PI / 2);
    }
    const m = new THREE.Mesh(blobGeo, blobMat);
    m.position.y = 0.2;
    m.renderOrder = 4;
    return m;
  }

  function addBuilding(b, rise) {
    removeBuilding(b.id, true);
    // decoys wear their disguise; only the owner's badge gives them away
    const modelType = b.type === 'decoy' ? b.disguise : b.type;
    const g = Models.building(modelType, b.side);
    const parts = g.userData.parts || {};
    bakePivots(g, Object.keys(parts).sort().map(k => parts[k]), modelType + '_' + b.side);
    const p = cellCenter(b.cell);
    g.position.copy(p);
    // face the enemy
    g.rotation.y = b.side === CONST.SIDE_PLAYER ? Math.PI / 2 : -Math.PI / 2;
    scene.add(g);
    g.add(footprint(b.side, b.level > 1));
    const height = g.userData.height || 8;
    const bar = makeHpBar(b.type === 'hq' ? 12 : 8);
    bar.position.set(p.x, height + 3, p.z);
    scene.add(bar);
    const badge = makeBadge(b.type === 'decoy' && b.side === CONST.SIDE_PLAYER ? 'decoy' : modelType, b.side);
    badge.position.set(p.x, height + 9, p.z);
    scene.add(badge);
    const rec = { id: b.id, b: { type: b.type, side: b.side, cell: b.cell }, group: g, bar, badge, hp: b.hp, maxHp: b.maxHp, rise: rise ? 0 : 1, collapse: -1, hatch: 0, hatchT: 0, smoke: null, dome: null, forceBar: false };
    if (modelType === 'shield') {
      rec.dome = makeShieldDome();
      rec.dome.position.copy(p);
      scene.add(rec.dome);
      rec.pool = b.pool; rec.domeFlash = 0;
    }
    buildings[b.id] = rec;
    setBuildingHp(b.id, b.hp, b.maxHp);
    rec.level = 1;
    if (b.level > 1 && b.type !== 'decoy') setBuildingLevel(b.id, b.level);
    if (rise) g.scale.y = 0.01;
    return rec;
  }

  // Upgraded structures are a little larger and get a gold ground frame
  function setBuildingLevel(id, level) {
    const rec = buildings[id];
    if (!rec || rec.level === level) return;
    rec.level = level;
    const s = level > 1 ? 1.14 : 1;
    rec.group.scale.x = rec.group.scale.z = s;
    if (rec.rise >= 1 && rec.collapse < 0) rec.group.scale.y = s;
    rec.baseScale = s;
    const old = rec.group.getObjectByName('footprint');
    if (old) rec.group.remove(old);
    const f = footprint(rec.b.side, level > 1);
    f.scale.setScalar(1 / s);
    rec.group.add(f);
  }

  function setBuildingHp(id, hp, maxHp) {
    const rec = buildings[id];
    if (!rec) return;
    rec.hp = hp; rec.maxHp = maxHp || rec.maxHp;
    const frac = rec.hp / rec.maxHp;
    setBar(rec.bar, frac, rec.forceBar);
    const pos = { x: rec.group.position.x, y: (rec.group.userData.height || 8) * 0.7, z: rec.group.position.z };
    const kind = frac <= 0 ? null : frac < 0.34 ? 'fire' : frac < 0.67 ? 'smoke' : null;
    if (kind !== rec.smoke) {
      rec.smoke = kind;
      Fx.setEmitter('b' + id, pos, kind);
    }
  }

  function setShieldPool(id, pool) {
    const rec = buildings[id];
    if (!rec || !rec.dome) return;
    rec.pool = pool;
  }
  function flashShield(id) {
    const rec = buildings[id];
    if (rec && rec.dome) rec.domeFlash = 1;
  }

  function removeBuilding(id, instant) {
    const rec = buildings[id];
    if (!rec) return;
    Fx.setEmitter('b' + id, null, null);
    if (instant) {
      disposeBuilding(rec);
      delete buildings[id];
    } else {
      rec.collapse = 0;
      rec.bar.visible = false;
      rec.badge.visible = false;
      if (rec.dome) rec.dome.visible = false;
    }
  }
  function disposeTree(obj) {
    obj.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  function disposeBuilding(rec) {
    scene.remove(rec.group);
    scene.remove(rec.bar);
    scene.remove(rec.badge);
    disposeTree(rec.bar);
    if (rec.dome) { scene.remove(rec.dome); disposeTree(rec.dome); }
    Models.dispose(rec.group);
  }

  function setBuildingVisible(id, v) {
    const rec = buildings[id];
    if (!rec) return;
    rec.group.visible = v;
    if (rec.dome) rec.dome.visible = v;
    if (!v) rec.bar.visible = false; else setBar(rec.bar, rec.hp / rec.maxHp, rec.forceBar);
    if (!v) Fx.setEmitter('b' + id, null, null);
    else { rec.smoke = undefined; setBuildingHp(id, rec.hp, rec.maxHp); }
  }

  function setBarsForced(ids) {
    for (const id in buildings) {
      const rec = buildings[id];
      rec.forceBar = !!(ids && ids.indexOf(+id) >= 0);
      if (rec.group.visible && rec.collapse < 0) setBar(rec.bar, rec.hp / rec.maxHp, rec.forceBar);
    }
  }

  function aimTurret(id, cell) {
    const rec = buildings[id];
    if (!rec) return;
    const a = rec.group.position, b = cellCenter(cell);
    // yaw in the group's local frame; turret barrels point along local +Z
    rec.group.userData.aimYaw = Math.atan2(b.x - a.x, b.z - a.z) - rec.group.rotation.y;
    rec.aimTimer = 2.5;
  }

  function openHatch(id) {
    const rec = buildings[id];
    if (rec) { rec.hatchT = 1.6; }
  }

  function muzzleWorld(id) {
    const rec = buildings[id];
    const v = new THREE.Vector3();
    if (!rec) return v;
    if (rec.group.userData.muzzle) {
      rec.group.updateMatrixWorld(true);
      rec.group.userData.muzzle.getWorldPosition(v);
      return v;
    }
    v.copy(rec.group.position); v.y = (rec.group.userData.height || 6) * 0.8;
    return v;
  }

  // ── Ghosts (last known enemy buildings) and craters ───────
  function setGhosts(list) {
    // list: [{cell, type}]
    const want = {};
    for (const g of list) want[g.cell] = g.type;
    for (const cell in ghosts) {
      if (want[cell] !== ghosts[cell].userData.ghostType) {
        scene.remove(ghosts[cell]);
        Models.dispose(ghosts[cell]);
        delete ghosts[cell];
      }
    }
    for (const cell in want) {
      if (ghosts[cell]) continue;
      const g = Models.ghost(want[cell]);
      g.userData.ghostType = want[cell];
      const p = cellCenter(+cell);
      g.position.set(p.x, 0.5, p.z);
      g.rotation.y = -Math.PI / 2;
      g.renderOrder = 11;
      scene.add(g);
      ghosts[cell] = g;
    }
  }

  const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.95, flatShading: true });
  const rubbleGeo = new THREE.DodecahedronGeometry(1, 0);
  function setCrater(cell, on) {
    if (on && !craters[cell]) {
      const g = new THREE.Group();
      const p = cellCenter(cell);
      for (let i = 0; i < 9; i++) {
        const m = new THREE.Mesh(rubbleGeo, rubbleMat);
        const s = 0.8 + Math.random() * 1.8;
        m.scale.set(s, s * 0.6, s);
        m.position.set((Math.random() - 0.5) * 8, s * 0.2, (Math.random() - 0.5) * 8);
        m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
        m.castShadow = true; m.receiveShadow = true;
        g.add(m);
      }
      g.position.copy(p);
      scene.add(g);
      craters[cell] = g;
      Fx.scorch(p, 16);
    } else if (!on && craters[cell]) {
      scene.remove(craters[cell]);
      delete craters[cell];
    }
  }

  // ── Robots ────────────────────────────────────────────────
  function addRobot(r) {
    removeRobot(r.id);
    const g = Models.robot(r.side);
    const rp = g.userData.parts || {};
    bakePivots(g, Object.keys(rp).sort().map(k => rp[k]), 'robot_' + r.side);
    // cheap blob shadow instead of shadow-map casting (mechs are small and always moving)
    g.traverse(o => { if (o.isMesh) o.castShadow = false; });
    g.add(blobShadow());
    g.scale.setScalar(1.3);
    const p = cellCenter(r.cell);
    g.position.copy(p);
    g.rotation.y = r.side === CONST.SIDE_PLAYER ? Math.PI / 2 : -Math.PI / 2;
    scene.add(g);
    const bar = makeHpBar(6);
    scene.add(bar);
    const rec = { id: r.id, side: r.side, group: g, bar, hp: r.hp, maxHp: r.maxHp, phase: Math.random() * 6, moving: false, punch: 0, flash: 0, cell: r.cell };
    robots[r.id] = rec;
    setRobotHp(r.id, r.hp);
    return rec;
  }
  function setRobotHp(id, hp) {
    const rec = robots[id];
    if (!rec) return;
    rec.hp = hp;
    setBar(rec.bar, hp / rec.maxHp, false);
  }
  function hitRobot(id) {
    const rec = robots[id];
    if (!rec) return;
    rec.flash = 0.12;
  }
  function removeRobot(id) {
    const rec = robots[id];
    if (!rec) return;
    scene.remove(rec.group); scene.remove(rec.bar);
    disposeTree(rec.bar);
    Models.dispose(rec.group);
    delete robots[id];
  }
  function getRobot(id) { return robots[id]; }
  function getBuilding(id) { return buildings[id]; }
  function allBuildingIds() { return Object.keys(buildings).map(Number); }
  function allRobotIds() { return Object.keys(robots).map(Number); }

  // ── Generic object helpers for projectiles ────────────────
  function add(obj) { scene.add(obj); }
  function remove(obj) { scene.remove(obj); }

  // ── Camera ────────────────────────────────────────────────
  function setupCameraInput() {
    const el = renderer.domElement;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('mousedown', e => {
      if (e.button === 1 || e.button === 2) {
        cam.drag = { x: e.clientX, y: e.clientY, gx: cam.gx, gz: cam.gz };
      }
    });
    window.addEventListener('mousemove', e => {
      if (!cam.drag) return;
      const k = cam.gdist / window.innerHeight * 1.1;
      cam.gx = cam.drag.gx - (e.clientX - cam.drag.x) * k;
      cam.gz = cam.drag.gz - (e.clientY - cam.drag.y) * k / Math.sin(cam.pitch);
      clampCam();
      cam.userPanAt = time;
    });
    window.addEventListener('mouseup', () => { cam.drag = null; });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      cam.gdist = Math.max(120, Math.min(560, cam.gdist * (e.deltaY > 0 ? 1.12 : 0.89)));
      cam.userPanAt = time;
    }, { passive: false });
    window.addEventListener('keydown', e => { cam.keys[e.code] = true; });
    window.addEventListener('keyup', e => { cam.keys[e.code] = false; });
    window.addEventListener('blur', () => { cam.keys = {}; });
  }

  function clampCam() {
    cam.gx = Math.max(-40, Math.min(MAP_W + 40, cam.gx));
    cam.gz = Math.max(-20, Math.min(MAP_H + 60, cam.gz));
  }

  function focus(x, z, dist, force) {
    if (!force && time - cam.userPanAt < 2) return;
    cam.gx = x; cam.gz = z;
    if (dist) cam.gdist = dist;
    clampCam();
  }
  function focusCell(cell, dist, force) {
    const p = cellCenter(cell);
    focus(p.x, p.z + 8, dist, force);
  }
  // Fit the labelled map into the screen area not covered by UI panels, by
  // projecting its corners from candidate camera positions (exact under perspective).
  let occl = { left: 0, right: 0, top: 0, bottom: 0 };
  function setOcclusion(left, right, top, bottom) { occl = { left: left || 0, right: right || 0, top: top || 0, bottom: bottom || 0 }; }
  const fitCam = new THREE.PerspectiveCamera();
  const corners = [[-CELL, -CELL], [MAP_W + CELL, -CELL], [-CELL, MAP_H + CELL], [MAP_W + CELL, MAP_H + CELL]].map(c => new THREE.Vector3(c[0], 0, c[1]));
  function screenBox(gx, gz, d) {
    fitCam.copy(camera);
    fitCam.position.set(gx, Math.sin(cam.pitch) * d, gz + Math.cos(cam.pitch) * d);
    fitCam.lookAt(gx, 0, gz);
    fitCam.updateMatrixWorld(true);
    const W = window.innerWidth, H = window.innerHeight, v = new THREE.Vector3();
    const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    for (const c of corners) {
      v.copy(c).project(fitCam);
      const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
      box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x);
      box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
    }
    return box;
  }
  function frameAll(instant) {
    const W = window.innerWidth, H = window.innerHeight, pad = 10;
    const ax0 = occl.left + pad, ax1 = W - occl.right - pad, ay0 = occl.top + pad, ay1 = H - occl.bottom - pad;
    let gx = MAP_W / 2, gz = MAP_H / 2, d = 400;
    for (let iter = 0; iter < 3; iter++) {
      // closest distance at which the map fits the free area
      let lo = 150, hi = 1400;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2, bx = screenBox(gx, gz, mid);
        if (bx.x1 - bx.x0 <= ax1 - ax0 && bx.y1 - bx.y0 <= ay1 - ay0) hi = mid; else lo = mid;
      }
      d = hi;
      // centre the projected map in the free area
      const bx = screenBox(gx, gz, d);
      const worldPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * d) / H;
      gx -= ((ax0 + ax1) / 2 - (bx.x0 + bx.x1) / 2) * worldPerPx;
      gz -= ((ay0 + ay1) / 2 - (bx.y0 + bx.y1) / 2) * worldPerPx / Math.sin(cam.pitch);
    }
    cam.gx = gx; cam.gz = gz; cam.gdist = Math.min(760, d);
    if (instant) { cam.tx = cam.gx; cam.tz = cam.gz; cam.dist = cam.gdist; }
  }
  function addTrauma(t, pos) {
    let k = 1;
    if (pos) {
      const d = Math.hypot(pos.x - cam.tx, pos.z - cam.tz);
      k = Math.max(0.35, 1 - d / 500);
    }
    cam.trauma = Math.min(1, cam.trauma + t * k);
  }

  function updateCamera(dt, keyboardEnabled) {
    if (keyboardEnabled) {
      const sp = cam.gdist * 1.1 * dt;
      const k = cam.keys;
      let moved = false;
      if (k.KeyA || k.ArrowLeft) { cam.gx -= sp; moved = true; }
      if (k.KeyD || k.ArrowRight) { cam.gx += sp; moved = true; }
      if (k.KeyW || k.ArrowUp) { cam.gz -= sp; moved = true; }
      if (k.KeyS || k.ArrowDown) { cam.gz += sp; moved = true; }
      if (moved) { clampCam(); cam.userPanAt = time; }
    }
    const a = 1 - Math.exp(-7 * dt);
    cam.tx += (cam.gx - cam.tx) * a;
    cam.tz += (cam.gz - cam.tz) * a;
    cam.dist += (cam.gdist - cam.dist) * a;
    cam.trauma = Math.max(0, cam.trauma - dt * 1.5);
    const s = cam.trauma * cam.trauma;
    const ox = s * 3.2 * (Math.sin(time * 41) + Math.sin(time * 27.3) * 0.5);
    const oy = s * 2.4 * (Math.sin(time * 37.1 + 1) + Math.sin(time * 23.7) * 0.5);
    const roll = s * 0.018 * Math.sin(time * 31.7);
    camera.position.set(cam.tx + ox, Math.sin(cam.pitch) * cam.dist + oy, cam.tz + Math.cos(cam.pitch) * cam.dist);
    camera.lookAt(cam.tx + ox, 0, cam.tz);
    camera.rotation.z += roll;
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ── Picking ───────────────────────────────────────────────
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  function pickCell(clientX, clientY) {
    ndc.x = (clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(clientY / window.innerHeight) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(ground, hit)) return -1;
    const x = Math.floor(hit.x / CELL), y = Math.floor(hit.z / CELL);
    if (x < 0 || x >= GW || y < 0 || y >= GH) return -1;
    return y * GW + x;
  }

  const projV = new THREE.Vector3();
  function project(v) {
    projV.copy(v).project(camera);
    return { x: (projV.x + 1) / 2 * window.innerWidth, y: (1 - projV.y) / 2 * window.innerHeight, visible: projV.z < 1 };
  }

  // ── Frame ─────────────────────────────────────────────────
  // ── Graphics quality (auto-detected, overridable with G) ──
  const QUALITY = [
    { name: 'Low', ratio: 1, shadows: false, shadowSize: 512 },
    { name: 'Medium', ratio: 1, shadows: true, shadowSize: 1024 },
    { name: 'High', ratio: 2, shadows: true, shadowSize: 2048 }
  ];
  let quality = 2, qualityLocked = false;
  const perf = { t: 0, frames: 0, warm: 1.5 };
  function loadQuality() {
    try {
      const q = localStorage.getItem('ra_quality');
      if (q !== null && QUALITY[+q]) { quality = +q; qualityLocked = true; }
    } catch (e) { /* storage unavailable */ }
    applyQuality();
  }
  function applyQuality() {
    const q = QUALITY[quality];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.ratio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    sun.castShadow = q.shadows;
    if (sun.shadow.mapSize.x !== q.shadowSize) {
      sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
  }
  function cycleQuality() {
    quality = (quality + QUALITY.length - 1) % QUALITY.length;
    qualityLocked = true;
    try { localStorage.setItem('ra_quality', quality); } catch (e) { /* ignore */ }
    applyQuality();
    return QUALITY[quality].name;
  }
  // Step quality down while the average frame time stays above ~30 fps
  function autoQuality(dt) {
    if (qualityLocked || quality === 0) return;
    if (perf.warm > 0) { perf.warm -= dt; return; }
    perf.t += dt; perf.frames++;
    if (perf.t < 2) return;
    const avg = perf.t / perf.frames;
    perf.t = 0; perf.frames = 0;
    if (avg > 1 / 30) { quality--; applyQuality(); perf.warm = 1; }
  }

  function render(dt, keyboardEnabled) {
    time += dt;
    autoQuality(dt);
    updateCamera(dt, keyboardEnabled);
    fogMat.uniforms.time.value = time;
    if (water) water.material.uniforms.time.value = time;
    if (hover.visible) hoverMat.opacity = 0.75 + Math.sin(time * 6) * 0.25;
    for (const m of markers) {
      if (m.spin) m.obj.rotation.z += m.spin * dt;
      if (m.pulse) m.obj.material.opacity = (m.base || 0.6) * (1 + Math.sin(time * 8) * 0.6);
      if (m.dash) m.obj.material.dashOffset = -time * 8;
    }
    const q = camera.quaternion;
    const badgeAlpha = Math.max(0, Math.min(1, (cam.dist - 310) / 110));
    for (const k in badgeMats) badgeMats[k].opacity = badgeAlpha;
    for (const id in buildings) {
      const rec = buildings[id];
      const g = rec.group;
      if (rec.rise < 1) {
        rec.rise = Math.min(1, rec.rise + dt / 0.55);
        const t = rec.rise, c1 = 1.70158, c3 = c1 + 1;
        g.scale.y = Math.max(0.01, 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)) * (rec.baseScale || 1);
      }
      if (rec.collapse >= 0) {
        rec.collapse += dt / 0.8;
        const t = Math.min(1, rec.collapse);
        g.scale.y = 1 - 0.8 * t * t;
        g.position.y = -2 * t;
        g.rotation.z = 0.25 * t;
        if (rec.collapse >= 1) { disposeBuilding(rec); delete buildings[id]; }
        continue;
      }
      if (rec.aimTimer > 0) { rec.aimTimer -= dt; if (rec.aimTimer <= 0) delete g.userData.aimYaw; }
      // silo hatch / hangar door
      if (rec.hatchT > 0) rec.hatchT -= dt;
      const want = rec.hatchT > 0 ? 1 : 0;
      rec.hatch += (want - rec.hatch) * Math.min(1, dt * 6);
      g.userData.open = rec.hatch;
      if (g.visible) Models.animate(g, time, dt);
      if (rec.bar.visible) rec.bar.quaternion.copy(q);
      rec.badge.visible = g.visible && rec.collapse < 0;
      if (rec.dome) {
        rec.domeFlash = Math.max(0, rec.domeFlash - dt * 2.5);
        const u = rec.dome.material.uniforms;
        u.time.value = time;
        u.flash.value = rec.domeFlash;
        u.strength.value = 0.15 + 0.85 * (rec.pool / BUILDINGS.shield.pool);
      }
    }
    for (const id in robots) {
      const rec = robots[id];
      if (rec.moving) rec.phase += dt * 9;
      rec.punch = Math.max(0, rec.punch - dt * 2.5);
      Models.animateRobot(rec.group, rec.phase + (rec.moving ? 0 : time * 0.4), rec.moving, rec.punch > 0 ? Math.sin(rec.punch * Math.PI) : 0);
      if (rec.flash > 0) {
        rec.flash -= dt;
        const on = rec.flash > 0;
        for (const m of rec.group.userData.flashMats || []) {
          if (on) { m.emissive.setHex(0xffffff); m.emissiveIntensity = 1.5; }
          else { if (m.userData.baseEmissive !== undefined) m.emissive.copy(m.userData.baseEmissive.isColor ? m.userData.baseEmissive : new THREE.Color(m.userData.baseEmissive)); m.emissiveIntensity = m.userData.baseIntensity !== undefined ? m.userData.baseIntensity : 1; }
        }
      }
      rec.bar.position.set(rec.group.position.x, rec.group.position.y + 15, rec.group.position.z);
      if (rec.bar.visible) rec.bar.quaternion.copy(q);
    }
    Fx.update(dt);
    renderer.render(scene, camera);
  }

  function reset() {
    for (const id in buildings) { disposeBuilding(buildings[id]); delete buildings[id]; }
    for (const id in robots) removeRobot(id);
    for (const c in ghosts) { scene.remove(ghosts[c]); Models.dispose(ghosts[c]); delete ghosts[c]; }
    for (const c in craters) { scene.remove(craters[c]); delete craters[c]; }
    clearMarkers();
    hideRange();
    setBuildGhost(null, -1);
    setZone(null);
    Fx.reset();
    frameAll(false);
  }

  return {
    stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs.length }),
    init, render, reset, cycleQuality, setOcclusion, setMap, setBuildingLevel, cellCenter, pickCell, project, missileArcHeight,
    setZone, setFog, setGridEmphasis, setHover, showRange, hideRange, setBuildGhost, setMarkers,
    addBuilding, removeBuilding, setBuildingHp, setBuildingVisible, setBarsForced, setShieldPool, flashShield, aimTurret, openHatch, muzzleWorld,
    getBuilding, allBuildingIds, setGhosts, setCrater,
    addRobot, removeRobot, getRobot, setRobotHp, hitRobot, allRobotIds,
    add, remove, focus, focusCell, frameAll, addTrauma,
    get camera() { return camera; }, get time() { return time; }
  };
})();
