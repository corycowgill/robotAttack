// ============================================================
// Robot Strategy Attack 2026 — Three.js Renderer
// 2D GRID VERSION: Tilted top-down view of a 40x24 grid
// ============================================================

(function () {
  'use strict';

  const COLORS = CONST.COLORS;
  const CELL = CONST.CELL_SIZE;
  const GW = CONST.GRID_W;
  const GH = CONST.GRID_H;
  const TOTAL = TOTAL_CELLS;

  let scene, camera, renderer, clock;
  let ambientLight, directionalLight;

  const segmentMeshes = [];   // tile mesh per cell index
  const gridLineMeshes = [];
  const fogMeshes = [];       // fog over AI cells
  const segmentElevations = [];

  // Camera control — now 2D pan (X, Z)
  let cameraTargetX = 0;
  let cameraTargetZ = 0;
  let cameraDragActive = false;
  let cameraDragStartMouse = { x: 0, y: 0 };
  let cameraDragStart = { x: 0, z: 0 };
  let cameraZoom = 1.0;

  // Screen shake
  let shakeIntensity = 0;
  let shakeDuration = 0;
  let shakeElapsed = 0;

  const PLATFORM_HEIGHT = 1.5;
  const BASE_Y = 0;
  const CRATER_DEPTH = -3;

  // World dimensions
  const WORLD_W = GW * CELL;
  const WORLD_H = GH * CELL;
  const WORLD_CENTER_X = WORLD_W / 2;
  const WORLD_CENTER_Z = WORLD_H / 2;

  // Camera bounds
  const CAM_MIN_X = -CELL * 2;
  const CAM_MAX_X = WORLD_W + CELL * 2;
  const CAM_MIN_Z = -CELL * 2;
  const CAM_MAX_Z = WORLD_H + CELL * 2;

  // ── CSS Overlays ──
  function createCSSOverlays() {
    const scanlineEl = document.createElement('div');
    scanlineEl.id = 'crt-scanlines';
    scanlineEl.style.cssText = [
      'position: fixed', 'top: 0', 'left: 0',
      'width: 100%', 'height: 100%',
      'pointer-events: none', 'z-index: 100',
      'background: repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 3px)',
      'mix-blend-mode: multiply'
    ].join(';');
    document.body.appendChild(scanlineEl);

    const vignetteEl = document.createElement('div');
    vignetteEl.id = 'crt-vignette';
    vignetteEl.style.cssText = [
      'position: fixed', 'top: 0', 'left: 0',
      'width: 100%', 'height: 100%',
      'pointer-events: none', 'z-index: 99',
      'background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%)'
    ].join(';');
    document.body.appendChild(vignetteEl);
  }

  // ── Seeded random for terrain ──
  function seededRandom(seed) {
    let s = seed;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function generateElevations() {
    const rng = seededRandom(42);
    for (let i = 0; i < TOTAL; i++) {
      const { x, y } = indexToXY(i);
      // Gentle rolling terrain with 2D noise
      const base =
        Math.sin(x * 0.3) * 0.8 +
        Math.sin(y * 0.4) * 0.6 +
        Math.sin((x + y) * 0.2) * 0.4;
      const noise = (rng() - 0.5) * 0.6;
      segmentElevations[i] = base + noise;
    }
  }

  // ── World position for a cell ──
  function segmentToWorldPos(index) {
    const { x, y } = indexToXY(index);
    return {
      x: x * CELL + CELL / 2,
      y: BASE_Y + (segmentElevations[index] || 0) + PLATFORM_HEIGHT / 2,
      z: y * CELL + CELL / 2
    };
  }

  // Also expose as cellToWorldPos for clarity
  function cellToWorldPos(x, y) {
    return segmentToWorldPos(xyToIndex(x, y));
  }

  // ── Create a cell tile ──
  function createSegmentMesh(index) {
    const { x, y } = indexToXY(index);
    const elev = segmentElevations[index] || 0;
    const side = cellSide(x);

    // Color tint: slight tint per side, checker pattern
    const isEven = (x + y) % 2 === 0;
    let baseColor;
    if (side === CONST.SIDE_PLAYER) {
      baseColor = isEven ? COLORS.TERRAIN_PLAYER : COLORS.TERRAIN;
    } else {
      baseColor = isEven ? COLORS.TERRAIN_AI : COLORS.TERRAIN;
    }

    const geo = new THREE.BoxGeometry(CELL - 0.3, PLATFORM_HEIGHT, CELL - 0.3);
    const mat = new THREE.MeshLambertMaterial({ color: baseColor });
    const mesh = new THREE.Mesh(geo, mat);

    const pos = segmentToWorldPos(index);
    mesh.position.set(pos.x, pos.y, pos.z);

    mesh.userData = {
      segmentIndex: index,
      cellX: x,
      cellY: y,
      side,
      destroyed: false,
      originalY: pos.y,
      originalColor: baseColor
    };

    scene.add(mesh);
    segmentMeshes[index] = mesh;
  }

  // ── Create all terrain ──
  function createTerrain() {
    generateElevations();
    for (let i = 0; i < TOTAL; i++) {
      createSegmentMesh(i);
    }

    // Ground plane beneath
    const groundGeo = new THREE.BoxGeometry(WORLD_W + CELL * 6, 1, WORLD_H + CELL * 6);
    const groundMat = new THREE.MeshLambertMaterial({ color: COLORS.BG_DARK });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(WORLD_CENTER_X, BASE_Y - 4, WORLD_CENTER_Z);
    scene.add(ground);

    // Dividing line between player and AI territory
    const dividerGeo = new THREE.BoxGeometry(0.3, 2, WORLD_H);
    const dividerMat = new THREE.MeshBasicMaterial({ color: COLORS.AMBER_DARK });
    const divider = new THREE.Mesh(dividerGeo, dividerMat);
    divider.position.set(WORLD_CENTER_X, BASE_Y + 1, WORLD_CENTER_Z);
    scene.add(divider);
  }

  // ── Fog of war over AI half ──
  function createFogOfWar() {
    for (let i = 0; i < TOTAL; i++) {
      const { x, y } = indexToXY(i);
      if (x < GW / 2) continue; // only AI side

      const pos = segmentToWorldPos(i);
      const fogGeo = new THREE.BoxGeometry(CELL, PLATFORM_HEIGHT + 8, CELL);
      const fogMat = new THREE.MeshBasicMaterial({
        color: 0x050500,
        transparent: true,
        opacity: 0.88
      });
      const fogMesh = new THREE.Mesh(fogGeo, fogMat);
      fogMesh.position.set(pos.x, pos.y + 4, pos.z);
      fogMesh.userData.segmentIndex = i;
      fogMesh.userData.isFog = true;
      scene.add(fogMesh);
      fogMeshes[i] = fogMesh;
    }
  }

  function setFogRevealed(segmentIndex, revealed) {
    const fog = fogMeshes[segmentIndex];
    if (!fog) return;
    fog.visible = !revealed;
  }

  // ── Crater effect ──
  function createCrater(segmentIndex) {
    const mesh = segmentMeshes[segmentIndex];
    if (!mesh) return;
    mesh.userData.destroyed = true;
    mesh.position.y = mesh.userData.originalY + CRATER_DEPTH;
    mesh.material.color.setHex(COLORS.CRATER);
    mesh.material.needsUpdate = true;
    mesh.scale.set(1, 0.3, 1);
  }

  // ── Lighting ──
  function createLights() {
    ambientLight = new THREE.AmbientLight(0x554400, 0.7);
    scene.add(ambientLight);

    directionalLight = new THREE.DirectionalLight(0xFFCC66, 0.9);
    directionalLight.position.set(WORLD_CENTER_X + 100, 300, WORLD_CENTER_Z - 100);
    directionalLight.target.position.set(WORLD_CENTER_X, 0, WORLD_CENTER_Z);
    scene.add(directionalLight);
    scene.add(directionalLight.target);
  }

  // ── Camera — tilted top-down ──
  function createCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(50, aspect, 1, 3000);

    // Start centered on player CC
    cameraTargetX = CONST.CC_PLAYER_X * CELL + CELL / 2;
    cameraTargetZ = CONST.CC_PLAYER_Y * CELL + CELL / 2;

    // Position high and tilted
    updateCameraPosition(0);
  }

  function updateCameraPosition(shakeOffX, shakeOffZ) {
    shakeOffX = shakeOffX || 0;
    shakeOffZ = shakeOffZ || 0;
    const height = 220 * cameraZoom;
    const backOffset = 120 * cameraZoom;
    camera.position.set(
      cameraTargetX + shakeOffX,
      height,
      cameraTargetZ + backOffset + shakeOffZ
    );
    camera.lookAt(cameraTargetX, 0, cameraTargetZ);
  }

  function setCameraTarget(x, z) {
    cameraTargetX = clamp(x, CAM_MIN_X, CAM_MAX_X);
    if (z !== undefined) {
      cameraTargetZ = clamp(z, CAM_MIN_Z, CAM_MAX_Z);
    }
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function updateCamera(dt) {
    // Handle shake
    let shakeOffX = 0, shakeOffZ = 0;
    if (shakeDuration > 0) {
      shakeElapsed += dt;
      if (shakeElapsed < shakeDuration) {
        const decay = 1 - (shakeElapsed / shakeDuration);
        shakeOffX = (Math.random() - 0.5) * 2 * shakeIntensity * decay;
        shakeOffZ = (Math.random() - 0.5) * 2 * shakeIntensity * decay;
      } else {
        shakeDuration = 0;
        shakeElapsed = 0;
      }
    }
    updateCameraPosition(shakeOffX, shakeOffZ);
  }

  function shakeScreen(intensity, duration) {
    shakeIntensity = intensity;
    shakeDuration = duration;
    shakeElapsed = 0;
  }

  // ── Input ──
  function setupInput() {
    const canvas = renderer.domElement;

    canvas.addEventListener('mousedown', function (e) {
      if (e.button === 1 || e.button === 2) {
        cameraDragActive = true;
        cameraDragStartMouse.x = e.clientX;
        cameraDragStartMouse.y = e.clientY;
        cameraDragStart.x = cameraTargetX;
        cameraDragStart.z = cameraTargetZ;
      }
    });

    window.addEventListener('mousemove', function (e) {
      if (!cameraDragActive) return;
      const dx = e.clientX - cameraDragStartMouse.x;
      const dy = e.clientY - cameraDragStartMouse.y;
      const panScale = 1.2 * cameraZoom;
      cameraTargetX = clamp(cameraDragStart.x - dx * panScale, CAM_MIN_X, CAM_MAX_X);
      cameraTargetZ = clamp(cameraDragStart.z - dy * panScale, CAM_MIN_Z, CAM_MAX_Z);
    });

    window.addEventListener('mouseup', function () {
      cameraDragActive = false;
    });

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // Zoom with mouse wheel
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1.1 : 0.9;
      cameraZoom = clamp(cameraZoom * delta, 0.5, 2.5);
    }, { passive: false });

    // Arrow keys / WASD
    const keysDown = {};
    window.addEventListener('keydown', function (e) {
      keysDown[e.key] = true;
      keysDown[e.key.toLowerCase()] = true;
    });
    window.addEventListener('keyup', function (e) {
      keysDown[e.key] = false;
      keysDown[e.key.toLowerCase()] = false;
    });

    Renderer._keysDown = keysDown;

    window.addEventListener('resize', onResize);
  }

  function updateInputPan(dt) {
    const keys = Renderer._keysDown || {};
    const panSpeed = 250 * cameraZoom;
    if (keys['ArrowLeft'] || keys['a']) {
      cameraTargetX = clamp(cameraTargetX - panSpeed * dt, CAM_MIN_X, CAM_MAX_X);
    }
    if (keys['ArrowRight'] || keys['d']) {
      cameraTargetX = clamp(cameraTargetX + panSpeed * dt, CAM_MIN_X, CAM_MAX_X);
    }
    if (keys['ArrowUp'] || keys['w']) {
      cameraTargetZ = clamp(cameraTargetZ - panSpeed * dt, CAM_MIN_Z, CAM_MAX_Z);
    }
    if (keys['ArrowDown'] || keys['s']) {
      cameraTargetZ = clamp(cameraTargetZ + panSpeed * dt, CAM_MIN_Z, CAM_MAX_Z);
    }
  }

  function onResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function getScene() { return scene; }
  function getCamera() { return camera; }

  function addMeshToScene(mesh) { if (scene && mesh) scene.add(mesh); }
  function removeMeshFromScene(mesh) { if (scene && mesh) scene.remove(mesh); }

  function update(dt) {
    updateInputPan(dt);
    updateCamera(dt);
    renderer.render(scene, camera);
  }

  let lastTime = 0;
  function animate(time) {
    requestAnimationFrame(animate);
    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    update(dt);
  }

  function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.BG_DARK);
    scene.fog = new THREE.Fog(COLORS.BG_DARK, 300, 900);

    clock = new THREE.Clock();

    createCamera();

    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(COLORS.BG_DARK, 1);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.position = 'fixed';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.zIndex = '0';
    document.body.appendChild(renderer.domElement);

    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.overflow = 'hidden';
    document.body.style.background = '#0A0A00';

    createLights();
    createTerrain();
    createFogOfWar();
    createCSSOverlays();
    setupInput();

    lastTime = performance.now();
    requestAnimationFrame(animate);

    console.log('[Renderer] Initialized — ' + TOTAL + ' cells (' + GW + 'x' + GH + '), Three.js r' + THREE.REVISION);
  }

  const Renderer = {
    init,
    update,
    segmentToWorldPos,
    cellToWorldPos,
    addMeshToScene,
    removeMeshFromScene,
    setCameraTarget,
    createCrater,
    setFogRevealed,
    getScene,
    getCamera,
    shakeScreen,
    segmentMeshes,
    fogMeshes,
    segmentElevations,
    _keysDown: {}
  };

  window.Renderer = Renderer;
})();
