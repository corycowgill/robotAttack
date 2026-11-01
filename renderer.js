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
  let sun, hemi, rim;
  let gridMat, zoneTex, zoneData, fogTex, fogData, fogMat;
  let hover, hoverMat, rangeGroup = null, buildGhost = null;
  const buildings = {};   // id -> rec
  const robots = {};      // id -> rec
  const ghosts = {};      // cell -> group
  const craters = {};     // cell -> group
  const ruins = {};       // cell -> wreck left by a destroyed structure (cosmetic)
  let markers = [];       // order/incoming marker objects
  let time = 0;

  // Camera rig
  const cam = {
    tx: MAP_W / 2, tz: MAP_H / 2 + 10, dist: 400, pitch: 0.98,
    // yaw 0 looks north with the player's island on the left; a tall (portrait) screen turns
    // the view a quarter turn so the islands stack: the player's at the bottom, the enemy's on top
    yaw: 0,
    gx: MAP_W / 2, gz: MAP_H / 2 + 10, gdist: 400,
    trauma: 0, userPanAt: -10,
    keys: {}, drag: null
  };

  // screen axes on the ground: right (r) and up-the-screen (f) for the current yaw
  function camAxes() { return { rx: Math.cos(cam.yaw), rz: -Math.sin(cam.yaw), fx: -Math.sin(cam.yaw), fz: -Math.cos(cam.yaw) }; }
  // move the camera goal by a screen-space offset (pixels right / down) scaled to world units
  function panScreen(gx, gz, dx, dy, k) {
    const a = camAxes();
    cam.gx = gx - a.rx * dx * k + a.fx * dy * k / Math.sin(cam.pitch);
    cam.gz = gz - a.rz * dx * k + a.fz * dy * k / Math.sin(cam.pitch);
  }
  function camOffset(d) { const h = Math.cos(cam.pitch) * d; return { x: Math.sin(cam.yaw) * h, y: Math.sin(cam.pitch) * d, z: Math.cos(cam.yaw) * h }; }

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
    renderer.debug.checkShaderErrors = false;   // checking forces a synchronous shader compile (a hitch) per new material
    renderer.domElement.id = 'game-canvas';
    document.body.appendChild(renderer.domElement);

    createLights();
    createCloudShadows();
    createZoneOverlay();
    createFog();
    createWater();
    createSky();
    setMap(Rules.generateIslands(424242, CONST.LAND_TARGET));   // backdrop for the menu
    createLabels();
    createHover();

    Fx.init(scene);
    setupCameraInput();
    window.addEventListener('resize', onResize);
    cam.yaw = portraitYaw();
    frameAll(true);
    loadQuality();
    setAtmosphere('day');
    prewarm();
  }

  // compile the shaders of things that first appear mid-battle (drop pods, both sides' missiles,
  // interceptors), so the first launch doesn't hitch while the GPU builds them
  // ...and every structure type (baked exactly as addBuilding does), both sides' mechs, a ruin and
  // battle damage, so nothing compiles a shader in the middle of a fight
  function prewarm() {
    const objs = [Models.pod('player'), Models.pod('ai'), Models.missile('player'), Models.missile('ai'), Models.interceptor(), Models.ruin('ai', 10, 1)];
    for (const side of ['player', 'ai']) {
      for (const type of Object.keys(BUILDINGS)) {
        if (type === 'decoy' || type === 'mine') continue;
        try {
          const g = Models.building(type, side), parts = g.userData.parts || {};
          bakePivots(g, Object.keys(parts).sort().map(k => parts[k]), type + '_' + side);
          objs.push(g);
        } catch (e) { /* not a model type */ }
      }
    }
    // target reticles (plain and additive) and fog-of-war ghost outlines appear mid-battle too
    const extra = [false, true].map(add => new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: getReticleTex(), transparent: true, depthWrite: false, depthTest: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending })));
    extra.push(Models.ghost('depot'));
    const warmBar = makeHpBar(8); objs.push(warmBar);   // health / progress bars (no fog, no tone mapping)
    for (const o of extra) objs.push(o);
    for (const o of objs) { o.position.set(MAP_W / 2, -40, MAP_H / 2); scene.add(o); }
    if (objs.length > 6) { objs[6].updateMatrixWorld(true); Models.setDamage(objs[6], 2, 1); }
    const mechs = ['player', 'ai'].map((side, i) => { try { return addRobot({ id: -100 - i, side, cell: 0, hp: 1, maxHp: 1 }); } catch (e) { return null; } });
    try { renderer.compile(scene, camera); } catch (e) { /* compiled on first use instead */ }
    for (const o of objs) { scene.remove(o); Models.dispose(o); }
    for (const o of extra.slice(0, 2)) { o.geometry.dispose(); o.material.dispose(); }
    disposeTree(warmBar);
    for (let i = 0; i < 2; i++) if (mechs[i] !== null) removeRobot(-100 - i);
  }

  function createLights() {
    hemi = new THREE.HemisphereLight(0x8fa3c0, 0x3a2814, 0.65);
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
    rim = new THREE.DirectionalLight(0x5fa8ff, 0.45);
    rim.position.set(MAP_W / 2 + 200, 120, MAP_H / 2 - 220);
    scene.add(rim);
  }

  // ── Atmospheres: the light a battle is fought in (campaign missions pick one) ──
  const ATMOS = {
    day:   { sun: [0xe2e8f0, 2.25], sunPos: [-170, 280, 140], sky: [0x7d8a98, 0x23262a, 0.62], rim: [0x5fa8ff, 0.4], bg: 0x0e161d, fog: 1, exp: 1.05, bloom: 0.6 },
    dusk:  { glow: 1.4, sun: [0xff9450, 2.0], sunPos: [-300, 110, 60], sky: [0x9a7a96, 0x2e1c14, 0.55], rim: [0xff6f9a, 0.5], bg: 0x23161f, fog: 1.1, exp: 1.05, bloom: 0.95 },
    night: { glow: 2.2, sun: [0x8fa8ff, 0.7], sunPos: [140, 240, -120], sky: [0x2c3c60, 0x0b0e12, 0.36], rim: [0x4f7dff, 0.55], bg: 0x060a11, fog: 1.15, exp: 1.2, bloom: 1.05 },
    storm: { sun: [0xb4c0d0, 0.95], sunPos: [-120, 300, 80], sky: [0x5c6a78, 0x1c1a18, 0.58], rim: [0x8aaccc, 0.3], bg: 0x10151a, fog: 1.6, exp: 0.95, lightning: true, bloom: 0.9 }
  };
  let atmos = ATMOS.day, atmosName = 'day', nextBolt = 0, bolt = null, boltT = 0, rain = null;
  function setAtmosphere(name) {
    atmosName = ATMOS[name] ? name : 'day';
    atmos = ATMOS[atmosName];
    sun.color.set(atmos.sun[0]); sun.intensity = atmos.sun[1];
    sun.position.set(MAP_W / 2 + atmos.sunPos[0], atmos.sunPos[1], MAP_H / 2 + atmos.sunPos[2]);
    hemi.color.set(atmos.sky[0]); hemi.groundColor.set(atmos.sky[1]); hemi.intensity = atmos.sky[2];
    rim.color.set(atmos.rim[0]); rim.intensity = atmos.rim[1];
    scene.background.set(atmos.bg); scene.fog.color.set(atmos.bg);
    renderer.toneMappingExposure = atmos.exp;
    Models.setGlow(atmos.glow || 1);
    nextBolt = time + 4;
    if (!bolt) {
      // lightning lights the whole battlefield for an instant
      bolt = new THREE.DirectionalLight(0xd6e4ff, 0);
      bolt.position.set(MAP_W / 2 + 80, 400, MAP_H / 2 - 60);
      bolt.target.position.set(MAP_W / 2, 0, MAP_H / 2);
      scene.add(bolt); scene.add(bolt.target);
    }
    setRain(!!atmos.lightning);
  }
  // rain: streaks falling over the islands (storms only)
  function setRain(on) {
    if (!on) { if (rain) rain.visible = false; return; }
    if (!rain) {
      const n = 1400, pos = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) {
        const x = Math.random() * (MAP_W + 200) - 100, y = Math.random() * 160, z = Math.random() * (MAP_H + 160) - 80;
        pos.set([x, y, z, x - 0.6, y - 5, z + 0.3], i * 6);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xa8bccf, transparent: true, opacity: 0.32, depthWrite: false }));
      rain.frustumCulled = false;
      scene.add(rain);
    }
    rain.visible = true;
  }
  function rainTick(dt) {
    if (!rain || !rain.visible) return;
    const a = rain.geometry.attributes.position, arr = a.array;
    const fall = 140 * dt;
    for (let i = 0; i < arr.length; i += 6) {
      arr[i + 1] -= fall; arr[i + 4] -= fall; arr[i] -= fall * 0.12; arr[i + 3] -= fall * 0.12;
      if (arr[i + 4] < 0) { const y = 150 + Math.random() * 10, x = arr[i] + 18 > MAP_W + 100 ? arr[i] + 18 - MAP_W - 200 : arr[i] + 18; arr[i + 1] = y; arr[i + 4] = y - 5; arr[i] = x; arr[i + 3] = x - 0.6; }
    }
    a.needsUpdate = true;
  }
  // drifting cloud shadows over the islands (day and dusk): a soft dark noise texture sliding
  // slowly across a plane just above the ground
  let cloudShadow = null;
  function createCloudShadows() {
    const S = 256, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, S, S);
    let seed = 99;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S, y = rnd() * S, r = 18 + rnd() * 46;
      // draw each blob 4 times (wrapped) so the texture tiles seamlessly
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
        const grd = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.beginPath(); g.arc(x + dx, y + dy, r, 0, Math.PI * 2); g.fill();
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2.2, 1.2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.38, depthWrite: false, fog: false });
    cloudShadow = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W + 160, MAP_H + 120), mat);
    cloudShadow.rotation.x = -Math.PI / 2;
    cloudShadow.position.set(MAP_W / 2, 0.5, MAP_H / 2);
    cloudShadow.renderOrder = 2;
    scene.add(cloudShadow);
  }
  function cloudTick(dt) {
    if (!cloudShadow) return;
    cloudShadow.visible = !cinema && (atmosName === 'day' || atmosName === 'dusk');
    const m = cloudShadow.material.map;
    m.offset.x += dt * 0.006; m.offset.y += dt * 0.0025;
  }

  // storms: now and then a lightning flash somewhere over the sea
  function weather(dt) {
    rainTick(dt);
    cloudTick(dt);
    if (bolt) { boltT = Math.max(0, boltT - dt); bolt.intensity = boltT > 0 ? 3.2 * Math.min(1, boltT / 0.08) * (0.6 + 0.4 * Math.random()) : 0; }
    if (!atmos.lightning || cinema || time < nextBolt) return;
    nextBolt = time + 6 + Math.random() * 10;
    boltT = 0.22;
    if (onLightning) onLightning();
    if (Math.random() < 0.5) setTimeout(() => { boltT = 0.14; }, 180);
  }
  let onLightning = null;   // main.js hooks the screen flash and the thunder here
  function setLightningHook(fn) { onLightning = fn; }

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

  // Sky dome: the fog colour at the horizon (seamless with the fogged sea), deepening to a dark
  // zenith, with a faint glow band. Only the low title-screen camera really sees it.
  function createSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { horizon: { value: new THREE.Color(0x111b24) }, zenith: { value: new THREE.Color(0x03060a) }, glow: { value: new THREE.Color(0x2a6f8f) } },
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 horizon, zenith, glow; varying vec3 vDir;
        void main() {
          float h = max(vDir.y, 0.0);
          vec3 c = mix(horizon, zenith, pow(h, 0.55));
          c += glow * 0.35 * exp(-h * 18.0);
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), mat);
    sky.position.set(MAP_W / 2, 0, MAP_H / 2);
    sky.renderOrder = -10;
    scene.add(sky);
  }

  function createWater() {
    const t = cellTexture(THREE.LinearFilter);
    landTex = t;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      time: { value: 0 }, land: { value: t.tex },
      mapSize: { value: new THREE.Vector2(MAP_W, MAP_H) },
      deep: { value: new THREE.Color(0x0b1c26) }, shallow: { value: new THREE.Color(0x2c5a60) }
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
          float w3 = n(vW * 0.9 + vec2(time * 0.9, -time * 0.7));
          float waves = w1 * 0.55 + w2 * 0.33 + w3 * 0.12;
          vec3 col = mix(deep, shallow, clamp(l * 1.6 + waves * 0.15, 0.0, 1.0));
          // shoreline foam bands
          float shore = smoothstep(0.18, 0.42, l) * (1.0 - smoothstep(0.42, 0.5, l));
          float foam = shore * smoothstep(0.45, 0.8, n(vW * 0.35 + vec2(time * 0.6, 0.0)) + 0.35 * sin(l * 40.0 - time * 2.5));
          // break the surf into lacy streaks
          foam *= smoothstep(0.35, 0.75, n(vW * 1.7 + vec2(-time * 0.8, time * 0.5)) * 0.65 + n(vW * 3.9 - vec2(time * 1.3, 0.0)) * 0.35 + foam * 0.25);
          // sun glint
          vec3 V = normalize(vView);
          float glint = pow(max(0.0, waves - 0.55) * 2.2, 3.0) * (1.0 - V.y * 0.6);
          col += vec3(0.82, 0.88, 0.95) * glint * 0.32 + vec3(0.74, 0.78, 0.8) * foam * 0.55;
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

  // Ground detail tiled over the whole terrain: grain, pebbles, hairline cracks (multiplies the colours)
  let _grit = null;
  function gritTexture(w, h) {
    if (!_grit) {
      const S = 512, cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const g = cv.getContext('2d');
      let s = 4242;
      const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      // tiling value noise (periodic lattice), a few octaves: broad stains down to fine grain
      const lattice = (n) => { const L = new Float32Array(n * n); for (let i = 0; i < L.length; i++) L[i] = r(); return L; };
      const oct = [[4, 0.42], [8, 0.26], [32, 0.14], [128, 0.1], [512, 0.08]].map(o => ({ n: o[0], a: o[1], L: lattice(o[0]) }));
      const sm = t => t * t * (3 - 2 * t);
      const img = g.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        let v = 0;
        for (const o of oct) {
          const fx = x * o.n / S, fy = y * o.n / S, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
          const x0 = ix % o.n, y0 = iy % o.n, x1 = (ix + 1) % o.n, y1 = (iy + 1) % o.n;
          const a = o.L[y0 * o.n + x0], b = o.L[y0 * o.n + x1], c = o.L[y1 * o.n + x0], d = o.L[y1 * o.n + x1];
          v += o.a * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
        }
        const k = (y * S + x) * 4, c = 150 + v * 100;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = c; img.data[k + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      // wrap-aware drawing: repeat a shape at the opposite edges so the tile stays seamless
      const wrap = (fn) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.save(); g.translate(ox, oy); fn(); g.restore(); } };
      // slab joints every quarter tile, sunk and slightly darker
      g.strokeStyle = 'rgba(40,40,38,0.36)'; g.lineWidth = 2;
      for (let i = 0; i <= 4; i++) { const q = i * S / 4; g.beginPath(); g.moveTo(q, 0); g.lineTo(q, S); g.moveTo(0, q); g.lineTo(S, q); g.stroke(); }
      // clustered aggregate: a few patches of exposed stone, a sprinkle of fine pits elsewhere
      for (let c = 0; c < 7; c++) {
        const cx = r() * S, cy = r() * S, cr = 40 + r() * 60;
        const seed = s;
        wrap(() => { s = seed; for (let i = 0; i < 60; i++) { const a = r() * 7, d = Math.sqrt(r()) * cr; g.fillStyle = 'rgba(' + (r() < 0.4 ? '55,55,52' : '200,200,195') + ',' + (0.12 + r() * 0.25) + ')'; g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.6 + r() * 2.2, 0, 7); g.fill(); } });
      }
      for (let i = 0; i < 180; i++) { g.fillStyle = 'rgba(40,40,38,' + (0.12 + r() * 0.25) + ')'; g.beginPath(); g.arc(r() * S, r() * S, 0.5 + r() * 1.1, 0, 7); g.fill(); }
      // cracks: wandering lines that fork
      const crack = (x, y, ang, len, w, depth) => {
        g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < len; k++) {
          ang += (r() - 0.5) * 0.9; x += Math.cos(ang) * 7; y += Math.sin(ang) * 7; g.lineTo(x, y);
          if (depth < 2 && r() < 0.12) { g.stroke(); crack(x, y, ang + (r() < 0.5 ? 0.8 : -0.8), len * 0.5 | 0, w * 0.7, depth + 1); g.lineWidth = w; g.beginPath(); g.moveTo(x, y); }
        }
        g.stroke();
      };
      g.strokeStyle = 'rgba(30,30,28,0.26)';
      for (let i = 0; i < 6; i++) { const x = r() * S, y = r() * S, ang = r() * 7, len = 8 + (r() * 14 | 0), w = 0.7 + r() * 0.6, seed = s; wrap(() => { s = seed; crack(x, y, ang, len, w, 0); }); }
      _grit = new THREE.CanvasTexture(cv);
      _grit.wrapS = _grit.wrapT = THREE.RepeatWrapping;
      _grit.encoding = THREE.sRGBEncoding;
      _grit.anisotropy = 4;
      // a normal map from the same picture (dark = low): pebbles and cracks catch the light
      _gritN = normalFrom(g.getImageData(0, 0, S, S), S, 3.0);
    }
    // one tile spans 4x4 cells, offset so the slab joints run along the cell borders
    const T = 4 * CELL;
    _grit.repeat.set(w / T, h / T);
    _grit.offset.set(-MARGIN / T, -(h - MARGIN) / T);
    _gritN.offset.copy(_grit.offset);
    _gritN.repeat.copy(_grit.repeat);
    return _grit;
  }
  let _gritN = null;
  // Tangent-space normal map from a greyscale height picture (Sobel), wrapping at the edges
  function normalFrom(img, S, strength) {
    const out = document.createElement('canvas');
    out.width = out.height = S;
    const og = out.getContext('2d'), od = og.createImageData(S, S);
    const H = (x, y) => img.data[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
      const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * S + x) * 4;
      od.data[i] = (nx * 0.5 + 0.5) * 255; od.data[i + 1] = (ny * 0.5 + 0.5) * 255; od.data[i + 2] = (nz * 0.5 + 0.5) * 255; od.data[i + 3] = 255;
    }
    og.putImageData(od, 0, 0);
    const tx = new THREE.CanvasTexture(out);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.anisotropy = 4;
    return tx;
  }
  // Old battle damage on the islands: soot, oil stains and tread marks, drawn once per map
  let grimeGroup = null, _grimeTex = null;
  function grimeTexture() {
    if (_grimeTex) return _grimeTex;
    const S = 128, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(15,14,12,0.85)'); grd.addColorStop(0.55, 'rgba(20,19,16,0.4)'); grd.addColorStop(1, 'rgba(20,19,16,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    _grimeTex = new THREE.CanvasTexture(cv);
    return _grimeTex;
  }
  // Static scenery: merge a group's direct child meshes into one mesh per material (one draw
  // call, and one shadow-pass draw, instead of hundreds). Merged geometry is tagged for disposal.
  function mergeStatic(group) {
    const byMat = new Map();
    for (const m of group.children.slice()) {
      if (!m.isMesh || Array.isArray(m.material)) continue;
      if (!byMat.has(m.material)) byMat.set(m.material, []);
      byMat.get(m.material).push(m);
    }
    byMat.forEach((list, mat) => {
      if (list.length < 2) return;
      list.forEach(m => m.updateMatrix());
      const geo = mergeGeometry(list, m => m.matrix, false);
      const merged = new THREE.Mesh(geo, mat);
      merged.castShadow = list.some(m => m.castShadow); merged.receiveShadow = list.some(m => m.receiveShadow);
      merged.renderOrder = list[0].renderOrder;
      merged.userData.merged = true;
      for (const m of list) {
        group.remove(m);
        if (m.geometry.type === 'PlaneGeometry' || m.geometry.type === 'RingGeometry') m.geometry.dispose();   // per-instance; rock/hedgehog shapes are shared
      }
      group.add(merged);
    });
  }
  function disposeMerged(group) { group.traverse(o => { if (o.userData && o.userData.merged) o.geometry.dispose(); }); }

  function placeGrime(land) {
    if (grimeGroup) { scene.remove(grimeGroup); grimeGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    grimeGroup = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ map: grimeTexture(), transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    const trackMat = new THREE.MeshBasicMaterial({ color: 0x141412, transparent: true, opacity: 0.18, depthWrite: false });
    let s = 77;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const landCells = [];
    for (let c = 0; c < GW * GH; c++) if (land[c]) landCells.push(c);
    for (let i = 0; i < Math.min(46, landCells.length / 4); i++) {
      const c = landCells[Math.floor(r() * landCells.length)];
      const p = cellCenter(c);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      const sz = 6 + r() * 12;
      m.scale.set(sz, sz * (0.5 + r() * 0.6), 1);
      m.rotation.set(-Math.PI / 2, 0, r() * Math.PI);
      m.position.set(p.x + (r() - 0.5) * CELL, 0.42, p.z + (r() - 0.5) * CELL);
      m.renderOrder = 2;
      grimeGroup.add(m);
    }
    // a few pairs of tread marks across each island
    for (let i = 0; i < 10; i++) {
      const c = landCells[Math.floor(r() * landCells.length)], p = cellCenter(c), a = r() * Math.PI, len = 20 + r() * 30;
      // only where both ends are on land (never across the water)
      const ex = Math.sin(a) * len / 2, ez = Math.cos(a) * len / 2;
      if (fieldAt(p.x + ex, p.z + ez) < 0.6 || fieldAt(p.x - ex, p.z - ez) < 0.6) continue;
      for (const off of [-1.6, 1.6]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, len), trackMat);
        m.rotation.set(-Math.PI / 2, 0, a);
        m.position.set(p.x + Math.cos(a) * off, 0.43, p.z - Math.sin(a) * off);
        m.renderOrder = 2;
        grimeGroup.add(m);
      }
    }
    mergeStatic(grimeGroup);
    scene.add(grimeGroup);
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
    // a war-torn palette: grey dirt and rock, dirty grey sand, a cold tint per side
    const cGround = new THREE.Color(0x67675f), cGround2 = new THREE.Color(0x46463f);
    const cPlayer = new THREE.Color(0x4c5862), cAI = new THREE.Color(0x5e4a44);
    const cBeach = new THREE.Color(0x8e8878), cBed = new THREE.Color(0x172629);
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
      else if (y < SEA_Y + 0.9) c.multiplyScalar(1 - 0.4 * (1 - (y - SEA_Y) / 0.9));   // wet sand at the waterline
      c.multiplyScalar(0.9 + hash(Math.floor(x * 0.7), Math.floor(z * 0.7)) * 0.18);
      c.convertSRGBToLinear();
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    terrainMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, map: gritTexture(w, h), normalMap: _gritN, normalScale: new THREE.Vector2(0.9, 0.9) }));
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);
    placeGrime(land);

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
    if (decorGroup) { scene.remove(decorGroup); disposeMerged(decorGroup); }
    decorGroup = new THREE.Group();
    const rockMat = rockMaterial(), rockGeos = rockGeometries();
    const foamMat = new THREE.MeshBasicMaterial({ color: 0xc4ccd0, transparent: true, opacity: 0.22, depthWrite: false });
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
      const m = new THREE.Mesh(rockGeos[(r() * rockGeos.length) | 0], rockMat);
      const s = offshore ? 4 + r() * 6 : 1.2 + r() * 3;
      m.scale.set(s, s * (offshore ? 1.2 : 0.6 + r() * 0.5), s * (0.7 + r() * 0.6));
      m.rotation.set((r() - 0.5) * 0.5, r() * 6.3, (r() - 0.5) * 0.5);
      m.position.set(x, Math.max(terrainHeight(x, z), SEA_Y - 1.5) + s * (offshore ? -0.05 : 0.25), z);
      m.castShadow = true; m.receiveShadow = true;
      decorGroup.add(m);
      // sea stacks sit in a ring of surf, so they read as rising from the water rather than floating
      if (offshore) {
        const foam = new THREE.Mesh(new THREE.RingGeometry(s * 0.9, s * 1.7, 18), foamMat);
        foam.rotation.x = -Math.PI / 2;
        foam.position.set(x, SEA_Y + 0.15, z);
        decorGroup.add(foam);
      }
      placed++;
    }
    // anti-tank hedgehogs in small clusters along the beaches
    const hhGeo = hedgehogGeometry(), hhMat = _hhMat || (_hhMat = new THREE.MeshStandardMaterial({ color: 0x2e2620, roughness: 0.7, metalness: 0.6 }));
    let hh = 0;
    for (let tries = 0; tries < 3000 && hh < 36; tries++) {
      const x = r() * MAP_W, z = r() * MAP_H, l = fieldAt(x, z);
      if (l < 0.46 || l > 0.6 || terrainHeight(x, z) < SEA_Y + 0.2) continue;
      const n = 2 + (r() * 3 | 0);
      for (let i = 0; i < n; i++) {
        const hx = x + (r() - 0.5) * 9, hz = z + (r() - 0.5) * 9;
        const hy = terrainHeight(hx, hz);
        if (hy < SEA_Y - 0.3 || fieldAt(hx, hz) > 0.64) continue;
        const m = new THREE.Mesh(hhGeo, hhMat);
        const k = 1.1 + r() * 0.5;
        m.scale.setScalar(k);
        m.rotation.set((r() - 0.5) * 0.3, r() * 6.3, (r() - 0.5) * 0.3);
        m.position.set(hx, hy + 0.55 * k, hz);
        m.castShadow = true; m.receiveShadow = true;
        decorGroup.add(m);
        hh++;
      }
    }
    mergeStatic(decorGroup);
    scene.add(decorGroup);
  }
  // three crossed girders, merged into one geometry
  let _hhGeo = null, _hhMat = null;
  function hedgehogGeometry() {
    if (_hhGeo) return _hhGeo;
    const parts = [[0.6, 0, 0.3], [-0.3, 0.9, 0], [0, -0.6, 1.0]].map(a => {
      const b = new THREE.BoxGeometry(3.2, 0.32, 0.32).toNonIndexed();
      b.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(a[0], a[1], a[2])));
      return b;
    });
    const merged = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const arrs = parts.map(b => b.attributes[name].array), len = arrs.reduce((t, a) => t + a.length, 0);
      const out = new Float32Array(len); let o = 0;
      for (const a of arrs) { out.set(a, o); o += a.length; }
      merged.setAttribute(name, new THREE.BufferAttribute(out, parts[0].attributes[name].itemSize));
    }
    parts.forEach(b => b.dispose());
    return (_hhGeo = merged);
  }

  // Jagged rocks: a few displaced icosahedra, dusty on top and dark, wet and a little green low down
  let _rockGeos = null, _rockMat = null;
  function rockMaterial() {
    return _rockMat || (_rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02, flatShading: true }));
  }
  function rockGeometries() {
    if (_rockGeos) return _rockGeos;
    const top = new THREE.Color(0x4a4945), mid = new THREE.Color(0x2b2b29), wet = new THREE.Color(0x111816), c = new THREE.Color();
    _rockGeos = [0, 1, 2, 3].map(v => {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const pos = g.attributes.position, disp = {};
      let s = 101 + v * 977;
      const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      const cols = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const key = Math.round(x * 100) + ',' + Math.round(y * 100) + ',' + Math.round(z * 100);
        const k = disp[key] || (disp[key] = 0.72 + r() * 0.45);
        const fy = y < 0 ? 0.75 : 1;          // flatter bottoms so they sit on the ground
        pos.setXYZ(i, x * k, y * k * fy, z * k);
      }
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y > 0.15) c.copy(mid).lerp(top, Math.min(1, (y - 0.15) / 0.7));
        else c.copy(wet).lerp(mid, Math.max(0, (y + 0.5) / 0.65));
        const n = 0.85 + ((i * 2654435761) % 1000) / 1000 * 0.3;
        c.multiplyScalar(n); c.convertSRGBToLinear();
        cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      g.computeVertexNormals();
      return g;
    });
    return _rockGeos;
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
    labelMesh = mesh;
  }
  let labelMesh = null;

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
    const k = type === 'hq' ? 14 : type === 'base' ? 12 : 8.5;   // bases stand out; the rest stay small
    s.scale.set(k, k, 1);
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
          // drifting banks of cloud (warped, three octaves) instead of scanlines
          vec2 q = p * 0.55 + vec2(time * 0.06, time * 0.025);
          vec2 w = vec2(n(q + 3.1), n(q + 7.7)) * 1.6;
          float cl = n(q + w) * 0.55 + n(q * 2.1 - w + time * 0.04) * 0.3 + n(q * 4.3 + 11.0) * 0.15;
          vec3 col = mix(vec3(0.04, 0.05, 0.09), vec3(0.19, 0.22, 0.31), smoothstep(0.25, 0.85, cl));
          col += vec3(0.05, 0.08, 0.12) * pow(n(q * 1.3 - time * 0.05), 6.0);   // a faint glint here and there
          float a = fog * (0.7 + cl * 0.25);
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

  let gridBase = 0.09;
  function setGridEmphasis(on) { gridBase = on ? 0.3 : 0.09; }

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
  // intents: [{ side, from, kind: 'move'|'hit'|'fight', path?: [cells], target?: cell }] — what each
  // visible mech will do next resolution (dashed walk path + bracket on what it will attack)
  function setMarkers(orders, incoming, intents) {
    clearMarkers();
    for (const it of intents || []) {
      const color = it.side === CONST.SIDE_PLAYER ? 0x5fd4ff : 0xff5a3a;
      if (it.kind === 'move' && it.path && it.path.length) {
        // a flat ribbon along the walk (GL lines are 1px wide) with an arrowhead on the last step
        const pts = [it.from].concat(it.path).map(c => { const p = cellCenter(c); p.y = 1.6; return p; });
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthTest: false, side: THREE.DoubleSide });
        const g = new THREE.Group();
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i], last = i === pts.length - 1;
          const len = a.distanceTo(b) - (last ? 4.5 : 0);
          const seg = new THREE.Mesh(new THREE.PlaneGeometry(1.8, Math.max(0.1, len)), mat);
          seg.rotation.x = -Math.PI / 2;
          seg.rotation.z = -Math.atan2(b.z - a.z, b.x - a.x) + Math.PI / 2;
          const dir = b.clone().sub(a).normalize();
          seg.position.copy(a).addScaledVector(dir, len / 2);
          g.add(seg);
          if (last) {
            const tri = new THREE.Shape([new THREE.Vector2(-3.2, 0), new THREE.Vector2(3.2, 0), new THREE.Vector2(0, 5)]);
            const head = new THREE.Mesh(new THREE.ShapeGeometry(tri), mat);
            head.rotation.x = -Math.PI / 2;
            head.rotation.z = -Math.atan2(b.z - a.z, b.x - a.x) - Math.PI / 2;
            head.position.copy(a).addScaledVector(dir, len);
            g.add(head);
          }
        }
        g.renderOrder = 11;
        g.traverse(o => { o.renderOrder = 11; });
        scene.add(g);
        markers.push({ obj: g });
      }
      if (it.target !== undefined && it.target >= 0) {
        // corner brackets around the structure (or mech) it is going for; solid when it strikes this turn
        const strikesNow = it.kind !== 'move';
        const ret = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 1.25, CELL * 1.25),
          new THREE.MeshBasicMaterial({ map: getReticleTex(), color, transparent: true, opacity: strikesNow ? 1 : 0.7, depthWrite: false, depthTest: false }));
        ret.rotation.x = -Math.PI / 2;
        const t = cellCenter(it.target);
        ret.position.set(t.x, 1.3, t.z);
        ret.renderOrder = 10;
        scene.add(ret);
        markers.push(strikesNow ? { obj: ret, pulse: true, base: 0.6 } : { obj: ret, spin: 0.6 });
      }
    }
    for (const o of orders) {
      const strike = o.kind === 'strike';
      const color = o.kind === 'missile' ? 0xffb000 : strike ? 0x3dffc8 : 0x2ec4ff;
      const a = cellCenter(o.from), b = cellCenter(o.to);
      a.y = 5;
      // a strike's reticle covers its whole 3x3 blast area, and it comes from orbit: no arc
      const size = strike ? CELL * 3.1 : o.zone ? CELL * 5.1 : CELL * 1.1;   // zone: a mech landing box
      const ret = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ map: getReticleTex(), color, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      ret.rotation.x = -Math.PI / 2;
      ret.position.set(b.x, 1.2, b.z);
      ret.renderOrder = 9;
      scene.add(ret);
      markers.push({ obj: ret, spin: o.kind === 'missile' ? 1.2 : -0.8 });
      if (strike) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(arcPoints(a, b, missileArcHeight(a, b), 48));
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.75 }));
      line.computeLineDistances();
      line.renderOrder = 9;
      scene.add(line);
      markers.push({ obj: line, dash: true });
    }
    for (const m of incoming) {
      const b = cellCenter(m.to);
      const rs = m.zone ? CELL * 5.2 : m.strike ? CELL * 3.2 : CELL * 1.6;
      const ret = new THREE.Mesh(new THREE.PlaneGeometry(rs, rs),
        new THREE.MeshBasicMaterial({ map: getReticleTex(), color: 0xff2222, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      ret.rotation.x = -Math.PI / 2;
      ret.position.set(b.x, 1.25, b.z);
      ret.renderOrder = 10;
      scene.add(ret);
      markers.push(m.zone ? { obj: ret, pulse: true, base: 0.5 } : { obj: ret, spin: -2, pulse: true });
      if (m.zone) continue;   // a mech raid's zone: no beam from the sky
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
    // HUD-like overlays: no fog or tone mapping, so the colours stay true at any distance; both
    // halves are transparent so renderOrder (not the opaque pass) puts the fill over its backing
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.6, 1.5), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.65, depthTest: false, fog: false, toneMapped: false }));
    const fgGeo = new THREE.PlaneGeometry(width, 0.9);
    fgGeo.translate(width / 2, 0, 0.01);
    const fg = new THREE.Mesh(fgGeo, new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent: true, depthTest: false, fog: false, toneMapped: false }));
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

  // Concatenate meshes (already transformed by `matrixOf(mesh)`) into one geometry.
  // With `withMat`, each vertex also carries its material's colour and roughness/metalness.
  function mergeGeometry(meshes, matrixOf, withMat) {
    const pos = [], nor = [], uv = [], col = [], rm = [];
    const keepColor = !withMat && meshes.every(m => m.geometry.attributes.color);
    for (const m of meshes) {
      const gg = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      gg.applyMatrix4(matrixOf(m));
      const n = gg.attributes.position.count;
      pos.push(gg.attributes.position.array);
      nor.push(gg.attributes.normal ? gg.attributes.normal.array : new Float32Array(n * 3));
      uv.push(gg.attributes.uv ? gg.attributes.uv.array : new Float32Array(n * 2));
      if (!withMat && keepColor) col.push(gg.attributes.color.array);
      if (withMat) {
        const c = new Float32Array(n * 3), r = new Float32Array(n * 2), mc = m.material.color;
        for (let i = 0; i < n; i++) { c[i * 3] = mc.r; c[i * 3 + 1] = mc.g; c[i * 3 + 2] = mc.b; r[i * 2] = m.material.roughness; r[i * 2 + 1] = m.material.metalness; }
        col.push(c); rm.push(r);
      }
      gg.dispose();
    }
    const cat = arrs => { const out = new Float32Array(arrs.reduce((t, a) => t + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(cat(pos), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(cat(nor), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(cat(uv), 2));
    if (keepColor) geo.setAttribute('color', new THREE.BufferAttribute(cat(col), 3));
    if (withMat) {
      geo.setAttribute('color', new THREE.BufferAttribute(cat(col), 3));
      geo.setAttribute('rm', new THREE.BufferAttribute(cat(rm), 2));
    }
    geo.computeBoundingSphere();
    return geo;
  }

  // Standard material whose colour, roughness and metalness come from vertex attributes,
  // so plain untextured parts with different materials can share one draw call
  function vertexMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true });
    m.onBeforeCompile = sh => {
      sh.vertexShader = 'attribute vec2 rm;\nvarying vec2 vRM;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRM = rm;');
      sh.fragmentShader = 'varying vec2 vRM;\n' + sh.fragmentShader
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;');
    };
    m.customProgramCacheKey = () => 'vertex-rm';
    return m;
  }
  let sharedVertexMat = null;
  const plainMaterial = (mat, own, metal) => mat.isMeshStandardMaterial && (!mat.map || (metal && mat.map === metal)) && !mat.transparent && !mat.vertexColors &&
    mat.side === THREE.FrontSide && !mat.flatShading && mat.emissive.getHex() === 0 && !own.has(mat);

  // Merge every opaque leaf mesh into its nearest animated pivot (or the root), so rigs keep
  // animating with far fewer draw calls: all plain untextured parts become one vertex-coloured
  // mesh per pivot, everything else one mesh per material. Merged geometry is cached per model key.
  // `vertexMat` overrides the shared vertex-coloured material (robots flash theirs per instance).
  function bakePivots(root, pivots, key, vertexMat, metal) {
    const cache = bakeCache[key] || (bakeCache[key] = {});
    const own = new Set(root.userData._own || []);
    const vmat = vertexMat || sharedVertexMat || (sharedVertexMat = vertexMaterial());
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
      const groups = new Map(), plain = [];
      for (const m of meshes) {
        if (plainMaterial(m.material, own, metal)) { plain.push(m); continue; }
        if (!groups.has(m.material)) groups.set(m.material, []);
        groups.get(m.material).push(m);
      }
      const emit = (list, mat, ck, withMat) => {
        const geo = cache[ck] || (cache[ck] = mergeGeometry(list, m => m4.multiplyMatrices(inv, m.matrixWorld), withMat));
        let cast = false, receive = false;
        for (const m of list) { cast = cast || m.castShadow; receive = receive || m.receiveShadow; m.parent.remove(m); }
        const merged = new THREE.Mesh(geo, mat);
        merged.castShadow = cast; merged.receiveShadow = receive;
        pivot.add(merged);
      };
      if (plain.length) emit(plain, vmat, pi + '_v', true);
      let mi = 0;
      groups.forEach((list, mat) => { if (list.length >= 2) emit(list, mat, pi + '_' + (mi++), false); });
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

  // Minefields: drawn for their owner only (the caller passes just the viewer's mines)
  const mineMeshes = {};
  function setMines(list) {
    const keep = new Set(list.map(m => m.id));
    for (const id in mineMeshes) if (!keep.has(+id)) { scene.remove(mineMeshes[id]); Models.dispose(mineMeshes[id]); delete mineMeshes[id]; }
    for (const m of list) {
      if (mineMeshes[m.id]) continue;
      const g = Models.mine(m.side);
      bakePivots(g, [], 'mine_' + m.side);          // a few merged meshes instead of ~30
      g.traverse(o => { if (o.isMesh) o.castShadow = false; });   // flat charges: no shadow-pass cost
      const p = cellCenter(m.cell);
      g.position.set(p.x, 0, p.z);
      scene.add(g);
      mineMeshes[m.id] = g;
    }
  }

  function addBuilding(b, rise) {
    removeBuilding(b.id, true);
    removeRuin(b.cell);
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
    const badge = makeBadge(b.type === 'decoy' && b.side === viewer ? 'decoy' : modelType, b.side);
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
    if (b.type === 'uplink') Models.setCharge(g, b.charge || 0, CONST.STRIKE_CHARGE);
    if (rise) g.scale.y = 0.01;
    return rec;
  }

  // Real-time construction: a building site rises with its progress and shows a cyan progress bar
  // `queued`: one of the player's sites waiting for a free build crew (amber, pulsing bar)
  function setBuildingProgress(id, k, queued) {
    const rec = buildings[id];
    if (!rec) return;
    if (k === undefined || k >= 1) {
      if (rec.build !== undefined && rec.build < 1) {
        rec.build = 1;
        if (rec.rise >= 1 && rec.collapse < 0) rec.group.scale.y = rec.baseScale || 1;
        if (rec.pbar) rec.pbar.visible = false;
      }
      return;
    }
    rec.build = k;
    if (!rec.pbar) {
      rec.pbar = makeHpBar(8);
      rec.pbar.position.copy(rec.bar.position);
      rec.pbar.position.y += 1.8;
      scene.add(rec.pbar);
    }
    rec.queued = !!queued;
    rec.pbar.userData.fg.scale.x = Math.max(queued ? 0.04 : 0.001, k);
    rec.pbar.userData.fg.material.color.setHex(queued ? 0xffb347 : 0x5fd4ff);
    if (!queued) rec.pbar.userData.fg.material.opacity = 1;
    rec.pbar.visible = rec.group.visible;
  }

  // Whose eyes the board is drawn through (hot-seat swaps it): only the owner sees a decoy's badge
  let viewer = CONST.SIDE_PLAYER;
  function setViewer(side) { viewer = side; }

  function setBuildingCharge(id, n) {
    const rec = buildings[id];
    if (rec) Models.setCharge(rec.group, n, CONST.STRIKE_CHARGE);
  }

  // Orbital strike visuals: a vertical additive light column that swells then fades.
  // `up` sends it from the ground into the sky (the uplink firing), otherwise it comes down.
  function strikeBeam(pos, color, dur, up) {
    const h = 260;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, h, 20, 1, true), mat);
    const glow = new THREE.Mesh(core.geometry, mat.clone());
    glow.scale.set(3, 1, 3);
    const g = new THREE.Group();
    g.add(core, glow);
    g.position.set(pos.x, h / 2, pos.z);
    g.renderOrder = 15;
    scene.add(g);
    return {
      update(k) { // 0..1
        const grow = up ? Math.min(1, k * 3) : Math.min(1, k * 4);
        const fade = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        const w = (up ? 1.4 : 2.6 + 3 * Math.sin(Math.min(1, k * 1.6) * Math.PI / 2)) * (0.6 + 0.4 * grow);
        core.scale.set(w, 1, w);
        glow.scale.set(w * 3, 1, w * 3);
        // the column extends from its source end
        const len = Math.max(0.01, grow);
        g.scale.y = len;
        g.position.y = up ? h * len / 2 : h - h * len / 2;
        mat.opacity = 0.9 * fade;
        glow.material.opacity = 0.28 * fade;
      },
      dispose() { scene.remove(g); core.geometry.dispose(); mat.dispose(); glow.material.dispose(); }
    };
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
    // scorched blast holes on the structure itself
    const lvl = frac <= 0 ? rec.dmg || 0 : frac < 0.34 ? 2 : frac < 0.67 ? 1 : 0;
    if (lvl !== (rec.dmg || 0) && rec.collapse < 0) { rec.dmg = lvl; Models.setDamage(rec.group, lvl, id); }
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
    if (rec.pbar) { scene.remove(rec.pbar); disposeTree(rec.pbar); }
    Models.dispose(rec.group);
  }

  function setBuildingVisible(id, v) {
    const rec = buildings[id];
    if (!rec) return;
    rec.group.visible = v;
    if (rec.dome) rec.dome.visible = v;
    if (!v) rec.bar.visible = false; else setBar(rec.bar, rec.hp / rec.maxHp, rec.forceBar);
    if (rec.pbar) rec.pbar.visible = v && rec.build < 1;
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

  let ruinSeed = 1;
  function addRuin(cell, side, w) {
    removeRuin(cell);
    const g = Models.ruin(side, w, ruinSeed++);
    g.position.copy(cellCenter(cell));
    g.rotation.y = (ruinSeed % 4) * Math.PI / 2;
    scene.add(g);
    ruins[cell] = g;
  }
  function removeRuin(cell) {
    if (ruins[cell]) { scene.remove(ruins[cell]); delete ruins[cell]; }
  }
  function setCrater(cell, on) {
    if (on) removeRuin(cell);
    if (on && !craters[cell]) {
      const g = new THREE.Group();
      const p = cellCenter(cell);
      for (let i = 0; i < 9; i++) {
        const m = new THREE.Mesh(rockGeometries()[i % 4], rockMaterial());
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
    // one vertex-coloured material per mech, so a hit flashes the whole armour
    const body = vertexMaterial();
    // armour plate texture on the whole body (parts sharing it merge into this one material)
    body.map = Models.armorTexture(); body.normalMap = Models.armorNormal(); body.normalScale = new THREE.Vector2(0.5, 0.5);
    body.userData.baseEmissive = 0; body.userData.baseIntensity = 1;
    g.userData._own.push(body);
    g.userData.flashMats = [body, g.userData.visorMat];
    bakePivots(g, Object.keys(rp).sort().map(k => rp[k]), 'robot_' + r.side, body, Models.armorTexture());
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
  function allBuildingIds() { return Object.keys(buildings).filter(id => buildings[id].collapse < 0).map(Number); }
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
      panScreen(cam.drag.gx, cam.drag.gz, e.clientX - cam.drag.x, e.clientY - cam.drag.y, k);
      clampCam();
      cam.userPanAt = time;
    });
    window.addEventListener('mouseup', () => { cam.drag = null; });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      cam.gdist = Math.max(120, Math.min(Math.max(780, framedDist * 1.15), cam.gdist * (e.deltaY > 0 ? 1.12 : 0.89)));
      cam.userPanAt = time;
    }, { passive: false });

    // Touch: one finger drags the map, two fingers pinch-zoom. Taps still reach
    // the game as ordinary clicks (browsers only emulate mouse events for taps).
    el.style.touchAction = 'none';
    const touches = new Map();
    let pinch = null;
    el.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 1) cam.drag = { x: e.clientX, y: e.clientY, gx: cam.gx, gz: cam.gz, touch: true };
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, dist: cam.gdist };
        cam.drag = null;
      }
    });
    el.addEventListener('pointermove', e => {
      if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size >= 2) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        cam.gdist = Math.max(120, Math.min(Math.max(780, framedDist * 1.15), pinch.dist * pinch.d / d));
        cam.userPanAt = time;
      } else if (cam.drag && cam.drag.touch && Math.hypot(e.clientX - cam.drag.x, e.clientY - cam.drag.y) > 8) {
        const k = cam.gdist / window.innerHeight * 1.1;
        panScreen(cam.drag.gx, cam.drag.gz, e.clientX - cam.drag.x, e.clientY - cam.drag.y, k);
        clampCam();
        cam.userPanAt = time;
      }
    });
    const endTouch = e => {
      if (e.pointerType !== 'touch') return;
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
      if (!touches.size) cam.drag = null;
    };
    el.addEventListener('pointerup', endTouch);
    el.addEventListener('pointercancel', endTouch);
    window.addEventListener('keydown', e => { cam.keys[e.code] = true; });
    window.addEventListener('keyup', e => { cam.keys[e.code] = false; });
    window.addEventListener('blur', () => { cam.keys = {}; });
  }

  function clampCam() {
    const side = cam.yaw ? 60 : 40;
    cam.gx = Math.max(-side, Math.min(MAP_W + side, cam.gx));
    cam.gz = Math.max(cam.yaw ? -60 : -20, Math.min(MAP_H + 60, cam.gz));
  }

  // returns false when it held back because the player just moved the camera
  function focus(x, z, dist, force) {
    if (!force && time - cam.userPanAt < 2) return false;
    cam.gx = x; cam.gz = z;
    if (dist) cam.gdist = dist;
    clampCam();
    return true;
  }
  function focusCell(cell, dist, force) {
    const p = cellCenter(cell), a = camAxes();
    return focus(p.x - a.fx * 8, p.z - a.fz * 8, dist, force);   // a little toward the camera, whichever way it faces
  }
  function userPannedWithin(sec) { return time - cam.userPanAt < sec; }
  // Fit the labelled map into the screen area not covered by UI panels, by
  // projecting its corners from candidate camera positions (exact under perspective).
  let occl = { left: 0, right: 0, top: 0, bottom: 0 };
  let framedDist = 400;
  function setOcclusion(left, right, top, bottom) { occl = { left: left || 0, right: right || 0, top: top || 0, bottom: bottom || 0 }; }
  const fitCam = new THREE.PerspectiveCamera();
  const corners = [[-CELL, -CELL], [MAP_W + CELL, -CELL], [-CELL, MAP_H + CELL], [MAP_W + CELL, MAP_H + CELL]].map(c => new THREE.Vector3(c[0], 0, c[1]));
  function screenBox(gx, gz, d) {
    fitCam.copy(camera);
    const o = camOffset(d);
    fitCam.position.set(gx + o.x, o.y, gz + o.z);
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
      let lo = 150, hi = 1800;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2, bx = screenBox(gx, gz, mid);
        if (bx.x1 - bx.x0 <= ax1 - ax0 && bx.y1 - bx.y0 <= ay1 - ay0) hi = mid; else lo = mid;
      }
      d = hi;
      // centre the projected map in the free area
      const bx = screenBox(gx, gz, d);
      const worldPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * d) / H;
      panScreen(gx, gz, (ax0 + ax1) / 2 - (bx.x0 + bx.x1) / 2, (ay0 + ay1) / 2 - (bx.y0 + bx.y1) / 2, worldPerPx);
      gx = cam.gx; gz = cam.gz;
    }
    cam.gx = gx; cam.gz = gz; cam.gdist = Math.min(1500, d);
    framedDist = cam.gdist;
    if (instant) { cam.tx = cam.gx; cam.tz = cam.gz; cam.dist = cam.gdist; }
  }
  function addTrauma(t, pos) {
    if (!shakeOn) return;
    let k = 1;
    if (pos) {
      const d = Math.hypot(pos.x - cam.tx, pos.z - cam.tz);
      k = Math.max(0.35, 1 - d / 500);
    }
    cam.trauma = Math.min(1, cam.trauma + t * k);
  }

  // Cinematic camera for the title screen: 'intro' flies in low over the sea and sweeps across the
  // islands into 'attract', a slow orbit. null hands the camera back to the gameplay rig.
  let cinema = null, cinemaT = 0, cinemaStart = 0;
  function setCinematic(mode) {
    cinema = mode; cinemaT = 0; cinemaStart = performance.now();
    if (!mode) frameAll(true);
  }
  const ease = k => k * k * (3 - 2 * k);
  function cinematicCamera() {
    cinemaT = (performance.now() - cinemaStart) / 1000; // wall clock: slow devices skip frames, not seconds
    const cx = MAP_W / 2, cz = MAP_H / 2;
    let yaw, dist, height, tx = cx, tz = cz;
    const orbit = t => ({ yaw: -0.55 + t * 0.045, dist: 360, height: 150 });
    if (cinema === 'intro' && cinemaT < 6.5) {
      const k = ease(Math.min(1, cinemaT / 6.5));
      // from low and far over the open sea behind the player's island, to the orbit's start
      const o = orbit(0);
      yaw = -2.1 + (o.yaw + 2.1) * k;
      dist = 760 + (o.dist - 760) * k;
      height = 34 + (o.height - 34) * k;
      tx = cx - 120 * (1 - k); tz = cz + 40 * (1 - k);
    } else {
      const o = orbit(cinema === 'intro' ? cinemaT - 6.5 : cinemaT + 2);
      yaw = o.yaw; dist = o.dist; height = o.height + Math.sin(cinemaT * 0.21) * 12;
    }
    camera.position.set(tx + Math.sin(yaw) * dist, height, tz + Math.cos(yaw) * dist);
    camera.lookAt(tx, 55, tz); // aim above the ground: the battle sits low in frame, under the logo
    cam.dist = Math.hypot(dist, height); // keeps fog density and LOD logic sensible
  }

  // Title screen: no health bars or badges over the backdrop battle
  let decorHidden = false;
  function setDecorHidden(v) {
    decorHidden = v;
    // the board furniture (coordinates, grid) reads as a game UI, not a battlefield
    if (labelMesh) labelMesh.visible = !v;
    if (gridMat) gridMat.visible = !v;
  }

  function updateCamera(dt, keyboardEnabled) {
    if (cinema) { cinematicCamera(); return; }
    if (keyboardEnabled) {
      const sp = cam.gdist * 1.1 * dt;
      const k = cam.keys;
      let moved = false;
      const a = camAxes();
      const mx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
      const my = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
      if (mx || my) { cam.gx += (a.rx * mx + a.fx * my) * sp; cam.gz += (a.rz * mx + a.fz * my) * sp; moved = true; }
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
    const o = camOffset(cam.dist);
    camera.position.set(cam.tx + ox + o.x, o.y + oy, cam.tz + o.z);
    camera.lookAt(cam.tx + ox, 0, cam.tz);
    camera.rotation.z += roll;
  }

  function portraitYaw() { return window.innerHeight > window.innerWidth * 1.15 ? -Math.PI / 2 : 0; }
  function onResize() {
    const yaw = portraitYaw();
    if (yaw !== cam.yaw) { cam.yaw = yaw; frameAll(true); }
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    sizeBloom();
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
  // ── Bloom (High quality): bright lights, flames and blasts bleed a soft glow ──
  // The scene renders into a multisampled sRGB target; a bright pass is blurred at half and
  // quarter resolution and added back over it on a full-screen quad.
  let bloom = null;
  function bloomShader(frag, uniforms) {
    return new THREE.ShaderMaterial({
      uniforms, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tex; varying vec2 vUv;\n' + frag
    });
  }
  function makeBloom() {
    if (!renderer.capabilities.isWebGL2 || !THREE.WebGLMultisampleRenderTarget) return null;
    const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, encoding: THREE.sRGBEncoding };
    const main = new THREE.WebGLMultisampleRenderTarget(1, 1, opts); main.samples = 4;
    const mk = () => new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat });
    const b = { main, h1: mk(), h2: mk(), q1: mk(), q2: mk() };
    b.bright = bloomShader(`uniform float threshold;
      void main() { vec3 c = texture2D(tex, vUv).rgb; float l = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c * smoothstep(threshold, threshold + 0.25, l), 1.0); }`, { tex: { value: null }, threshold: { value: 0.84 } });
    b.blur = bloomShader(`uniform vec2 dir;
      void main() { vec3 c = texture2D(tex, vUv).rgb * 0.227;
        c += (texture2D(tex, vUv + dir * 1.385).rgb + texture2D(tex, vUv - dir * 1.385).rgb) * 0.316;
        c += (texture2D(tex, vUv + dir * 3.231).rgb + texture2D(tex, vUv - dir * 3.231).rgb) * 0.070;
        gl_FragColor = vec4(c, 1.0); }`, { tex: { value: null }, dir: { value: new THREE.Vector2() } });
    b.copy = bloomShader('void main() { gl_FragColor = vec4(texture2D(tex, vUv).rgb, 1.0); }', { tex: { value: null } });
    // composite: bloom, then the colour grade (saturate .84, contrast 1.08, brightness .98) and a
    // light animated film grain, all in this one pass instead of CSS filters and a blended overlay
    b.comp = bloomShader(`uniform sampler2D bh; uniform sampler2D bq; uniform float strength; uniform float seed; uniform vec2 res;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() { vec3 c = texture2D(tex, vUv).rgb;
        vec3 g = texture2D(bh, vUv).rgb * 0.55 + texture2D(bq, vUv).rgb * 0.75;
        c += g * strength * (1.0 - c * 0.5);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, 0.84);
        c = (c - 0.5) * 1.08 + 0.5;
        c *= 0.98;
        c += (hash(floor(vUv * res * 0.5) + seed) - 0.5) * 0.035;
        gl_FragColor = vec4(c, 1.0); }`, { tex: { value: null }, bh: { value: null }, bq: { value: null }, strength: { value: 0.9 }, seed: { value: 0 }, res: { value: new THREE.Vector2(1, 1) } });
    b.scene = new THREE.Scene();
    b.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    b.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), b.copy);
    b.quad.frustumCulled = false;
    b.scene.add(b.quad);
    return b;
  }
  function sizeBloom() {
    if (!bloom) return;
    const v = renderer.getDrawingBufferSize(new THREE.Vector2());
    bloom.main.setSize(v.x, v.y);
    const hw = Math.max(1, v.x >> 1), hh = Math.max(1, v.y >> 1), qw = Math.max(1, v.x >> 2), qh = Math.max(1, v.y >> 2);
    bloom.h1.setSize(hw, hh); bloom.h2.setSize(hw, hh); bloom.q1.setSize(qw, qh); bloom.q2.setSize(qw, qh);
    bloom.hpx = new THREE.Vector2(1 / hw, 1 / hh); bloom.qpx = new THREE.Vector2(1 / qw, 1 / qh);
  }
  function setBloom(on) {
    if (on && !bloom) { bloom = makeBloom(); sizeBloom(); }
    else if (!on && bloom) { ['main', 'h1', 'h2', 'q1', 'q2'].forEach(k => bloom[k].dispose()); bloom = null; }
  }
  function pass(mat, target) { bloom.quad.material = mat; renderer.setRenderTarget(target); renderer.render(bloom.scene, bloom.cam); }
  function blur2(src, tmp, px) {
    const B = bloom.blur;
    B.uniforms.tex.value = src.texture; B.uniforms.dir.value.set(px.x, 0); pass(B, tmp);
    B.uniforms.tex.value = tmp.texture; B.uniforms.dir.value.set(0, px.y); pass(B, src);
  }
  let shadowFrame = 0;
  function renderFrame() {
    renderer.info.autoReset = false; renderer.info.reset();   // stats cover the whole frame, not just the last pass
    // the sun never moves: redraw the shadow map every other frame (halves the shadow-pass cost)
    renderer.shadowMap.autoUpdate = false;
    if ((shadowFrame++ & 1) === 0) renderer.shadowMap.needsUpdate = true;
    if (!bloom) { renderer.render(scene, camera); return; }
    renderer.setRenderTarget(bloom.main);
    renderer.render(scene, camera);
    bloom.bright.uniforms.tex.value = bloom.main.texture; pass(bloom.bright, bloom.h1);
    blur2(bloom.h1, bloom.h2, bloom.hpx);
    bloom.copy.uniforms.tex.value = bloom.h1.texture; pass(bloom.copy, bloom.q1);
    blur2(bloom.q1, bloom.q2, bloom.qpx);
    blur2(bloom.q1, bloom.q2, bloom.qpx.clone().multiplyScalar(2));
    const C = bloom.comp;
    C.uniforms.tex.value = bloom.main.texture; C.uniforms.bh.value = bloom.h1.texture; C.uniforms.bq.value = bloom.q1.texture;
    C.uniforms.strength.value = atmos && atmos.bloom !== undefined ? atmos.bloom : 0.9;
    C.uniforms.seed.value = (shadowFrame >> 3) % 64;   // grain shifts every 8 frames
    C.uniforms.res.value.set(bloom.main.width, bloom.main.height);
    pass(C, null);
  }

  // ── Graphics quality (auto-detected, overridable with G) ──
  const QUALITY = [
    { name: 'Low', ratio: 1, shadows: false, shadowSize: 512 },
    { name: 'Medium', ratio: 1.25, shadows: true, shadowSize: 1024 },
    { name: 'High', ratio: 1.5, shadows: true, shadowSize: 2048, bloom: true }
  ];
  let quality = 2, qualityLocked = false;
  const perf = { t: 0, frames: 0, warm: 1.5 };
  function loadQuality() {
    try {
      const q = localStorage.getItem('ra_quality');
      if (q !== null && QUALITY[+q]) { quality = +q; qualityLocked = true; }
      // phones and tablets start at Medium; auto-detection can still step down
      else if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) quality = 1;
    } catch (e) { /* storage unavailable */ }
    applyQuality();
  }
  function applyQuality() {
    const q = QUALITY[quality];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.ratio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    setBloom(!!q.bloom); sizeBloom();
    // where the grade runs: the post shader (High), a CSS filter (Medium) or nowhere (Low)
    document.body.dataset.fx = bloom ? 'post' : q.shadows ? 'css' : 'none';
    sun.castShadow = q.shadows;
    if (sun.shadow.mapSize.x !== q.shadowSize) {
      sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
  }
  // 'auto' or an index into QUALITY; returns the active level's name
  function setQuality(q) {
    if (q === 'auto') {
      qualityLocked = false;
      try { localStorage.removeItem('ra_quality'); } catch (e) { /* ignore */ }
      quality = window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? 1 : 2;
      perf.warm = 1.5;
    } else if (QUALITY[q]) {
      quality = q; qualityLocked = true;
      try { localStorage.setItem('ra_quality', q); } catch (e) { /* ignore */ }
    }
    applyQuality();
    return QUALITY[quality].name;
  }
  function getQuality() { return qualityLocked ? quality : 'auto'; }
  let shakeOn = true;
  function setShake(on) { shakeOn = !!on; if (!on) cam.trauma = 0; }

  function cycleQuality() {
    quality = (quality + QUALITY.length - 1) % QUALITY.length;
    qualityLocked = true;
    try { localStorage.setItem('ra_quality', quality); } catch (e) { /* ignore */ }
    applyQuality();
    return QUALITY[quality].name;
  }
  // Step quality down while the average frame rate stays below ~40 fps
  function autoQuality(dt) {
    if (qualityLocked || quality === 0) return;
    if (perf.warm > 0) { perf.warm -= dt; return; }
    perf.t += dt; perf.frames++;
    if (perf.t < 2) return;
    const avg = perf.t / perf.frames;
    perf.t = 0; perf.frames = 0;
    if (avg > 1 / 40) { quality--; applyQuality(); perf.warm = 1; }
  }

  function render(dt, keyboardEnabled) {
    time += dt;
    autoQuality(dt);
    updateCamera(dt, keyboardEnabled);
    fogMat.uniforms.time.value = time;
    // keep the atmosphere consistent when zoomed far out (narrow screens frame from further away)
    scene.fog.density = (cinema ? 0.0011 : 0.0012 * 420 / Math.max(420, cam.dist)) * (cinema ? 1 : atmos.fog);
    weather(dt);
    // the cell grid fades as the camera comes in close (the terrain carries the scene up close)
    if (gridMat) gridMat.opacity = gridBase * Math.max(gridBase > 0.1 ? 0.7 : 0.35, Math.min(1, cam.dist / 420));
    // mechs grow a little when the camera is far out, so a raid still reads at whole-map framing
    const ms = 1.3 * Math.max(1, Math.min(1.7, cam.dist / 360));
    for (const id in robots) robots[id].group.scale.setScalar(ms);
    if (water) water.material.uniforms.time.value = time;
    if (hover.visible) hoverMat.opacity = 0.75 + Math.sin(time * 6) * 0.25;
    for (const m of markers) {
      if (m.spin) m.obj.rotation.z += m.spin * dt;
      if (m.pulse) m.obj.material.opacity = (m.base || 0.6) * (1 + Math.sin(time * 8) * 0.6);
      if (m.dash) m.obj.material.dashOffset = -time * 8;
    }
    const q = camera.quaternion;
    const badgeAlpha = decorHidden ? 0 : 0.9 * Math.max(0, Math.min(1, (cam.dist - 310) / 110));
    for (const k in badgeMats) badgeMats[k].opacity = badgeAlpha;
    for (const id in buildings) {
      const rec = buildings[id];
      const g = rec.group;
      if (rec.rise < 1) {
        rec.rise = Math.min(1, rec.rise + dt / 0.55);
        const t = rec.rise, c1 = 1.70158, c3 = c1 + 1;
        g.scale.y = Math.max(0.01, 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)) * (rec.baseScale || 1);
      }
      // a building site stands at a fraction of its height until finished
      if (rec.build < 1 && rec.rise >= 1 && rec.collapse < 0) g.scale.y = (0.25 + 0.75 * rec.build) * (rec.baseScale || 1);
      if (rec.queued && rec.pbar && rec.pbar.visible) { const fm = rec.pbar.userData.fg.material; fm.transparent = true; fm.opacity = 0.45 + 0.55 * Math.abs(Math.sin(time * 3)); }
      if (rec.collapse >= 0) {
        rec.collapse += dt / 0.8;
        const t = Math.min(1, rec.collapse);
        g.scale.y = 1 - 0.8 * t * t;
        g.position.y = -2 * t;
        g.rotation.z = 0.25 * t;
        if (rec.collapse >= 1) { addRuin(rec.b.cell, rec.b.side, g.userData.padW); disposeBuilding(rec); delete buildings[id]; }
        continue;
      }
      if (rec.aimTimer > 0) { rec.aimTimer -= dt; if (rec.aimTimer <= 0) delete g.userData.aimYaw; }
      // silo hatch / hangar door
      if (rec.hatchT > 0) rec.hatchT -= dt;
      const want = rec.hatchT > 0 ? 1 : 0;
      rec.hatch += (want - rec.hatch) * Math.min(1, dt * 6);
      g.userData.open = rec.hatch;
      if (g.visible) Models.animate(g, time, dt);
      if (decorHidden) rec.bar.visible = false;
      if (rec.bar.visible) rec.bar.quaternion.copy(q);
      rec.badge.visible = g.visible && rec.collapse < 0;
      if (rec.dome) {
        rec.domeFlash = Math.max(0, rec.domeFlash - dt * 2.5);
        const u = rec.dome.material.uniforms;
        u.time.value = time;
        u.flash.value = rec.domeFlash;
        u.strength.value = 0.15 + 0.85 * Math.min(1, rec.pool / BUILDINGS.shield.pool);
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
      if (decorHidden) rec.bar.visible = false;
      if (rec.bar.visible) rec.bar.quaternion.copy(q);
    }
    Fx.update(dt);
    renderFrame();
  }

  function reset() {
    for (const id in buildings) { disposeBuilding(buildings[id]); delete buildings[id]; }
    for (const id in robots) removeRobot(id);
    for (const c in ghosts) { scene.remove(ghosts[c]); Models.dispose(ghosts[c]); delete ghosts[c]; }
    for (const c in craters) { scene.remove(craters[c]); delete craters[c]; }
    for (const c in ruins) removeRuin(c);
    setMines([]);
    clearMarkers();
    hideRange();
    setBuildGhost(null, -1);
    setZone(null);
    Fx.reset();
    frameAll(false);
  }

  return {
    ruinCells: () => Object.keys(ruins).map(Number),
    _scene: () => scene,
    _renderer: () => renderer,
    warm: () => { try { renderer.compile(scene, camera); } catch (e) { /* compiled on first use */ } },
    stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs.length }),
    framedDist: () => framedDist,
    init, render, reset, cycleQuality, setQuality, getQuality, setShake, setOcclusion, setMap, setBuildingLevel, setBuildingCharge, strikeBeam, setViewer, setCinematic, setDecorHidden, cellCenter, pickCell, project, missileArcHeight,
    setZone, setFog, setGridEmphasis, setHover, showRange, hideRange, setBuildGhost, setMarkers,
    addBuilding, removeBuilding, setBuildingHp, setBuildingVisible, setBarsForced, setShieldPool, flashShield, aimTurret, openHatch, muzzleWorld,
    getBuilding, allBuildingIds, setGhosts, setCrater,
    addRobot, removeRobot, getRobot, setRobotHp, hitRobot, allRobotIds,
    add, remove, focus, focusCell, userPannedWithin, frameAll, addTrauma, setBuildingProgress, setMines, setAtmosphere, setLightningHook,
    get camera() { return camera; }, get time() { return time; }
  };
})();
