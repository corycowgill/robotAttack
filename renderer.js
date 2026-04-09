// ============================================================
// Robot Strategy Attack 2026 — Three.js Renderer
// ============================================================
// Depends on: gameState.js (CONST, TOTAL_SEGMENTS)
// Depends on: Three.js r128 loaded from CDN
// ============================================================

(function () {
  'use strict';

  // ── Local references ──
  const COLORS = CONST.COLORS;
  const SEG_W = CONST.SEGMENT_WIDTH;
  const TOTAL = TOTAL_SEGMENTS; // 28
  const HALF = CONST.SEGMENTS_PER_SIDE; // 14

  // ── Renderer state ──
  let scene, camera, renderer;
  let ambientLight, directionalLight;
  let clock;

  // Terrain
  const segmentMeshes = [];   // THREE.Mesh[] indexed by segment index
  const gridLineMeshes = [];  // grid overlay meshes per segment
  const fogMeshes = [];       // fog of war overlay meshes (AI side only)
  const segmentElevations = []; // base Y for each segment

  // Camera control
  let cameraTargetX = 0;
  let cameraDragActive = false;
  let cameraDragStartX = 0;
  let cameraDragCamStartX = 0;

  // Screen shake
  let shakeIntensity = 0;
  let shakeDuration = 0;
  let shakeElapsed = 0;
  let shakeOffsetX = 0;
  let shakeOffsetY = 0;

  // Map bounds for camera panning
  const MAP_LEFT = -SEG_W * 2;
  const MAP_RIGHT = TOTAL * SEG_W + SEG_W * 2;
  const MAP_CENTER_X = (TOTAL * SEG_W) / 2;

  // Platform geometry constants
  const PLATFORM_HEIGHT = 4;
  const PLATFORM_DEPTH = 60;
  const CRATER_DEPTH = -8;
  const BASE_Y = 0;

  // ── CSS Overlay Setup ──
  function createCSSOverlays() {
    // Scanline overlay
    const scanlineEl = document.createElement('div');
    scanlineEl.id = 'crt-scanlines';
    scanlineEl.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'width: 100%',
      'height: 100%',
      'pointer-events: none',
      'z-index: 100',
      'background: repeating-linear-gradient(' +
        '0deg,' +
        'rgba(0, 0, 0, 0.15) 0px,' +
        'rgba(0, 0, 0, 0.15) 1px,' +
        'transparent 1px,' +
        'transparent 3px' +
      ')',
      'mix-blend-mode: multiply'
    ].join(';');
    document.body.appendChild(scanlineEl);

    // Vignette overlay
    const vignetteEl = document.createElement('div');
    vignetteEl.id = 'crt-vignette';
    vignetteEl.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'width: 100%',
      'height: 100%',
      'pointer-events: none',
      'z-index: 99',
      'background: radial-gradient(' +
        'ellipse at center,' +
        'transparent 50%,' +
        'rgba(0, 0, 0, 0.55) 100%' +
      ')'
    ].join(';');
    document.body.appendChild(vignetteEl);
  }

  // ── Seed-based pseudo-random for consistent terrain ──
  function seededRandom(seed) {
    let s = seed;
    return function () {
      s = (s * 16807 + 0) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  // ── Generate elevation map ──
  function generateElevations() {
    const rng = seededRandom(42);
    for (let i = 0; i < TOTAL; i++) {
      // Gentle rolling terrain, slight variation
      const base = Math.sin(i * 0.4) * 2 + Math.sin(i * 0.15) * 3;
      const noise = (rng() - 0.5) * 2;
      segmentElevations[i] = base + noise;
    }
  }

  // ── Convert segment index to world position ──
  function segmentToWorldPos(index) {
    const x = index * SEG_W + SEG_W / 2;
    const y = BASE_Y + (segmentElevations[index] || 0) + PLATFORM_HEIGHT / 2;
    const z = 0;
    return { x: x, y: y, z: z };
  }

  // ── Create a single terrain segment mesh ──
  function createSegmentMesh(index) {
    const elev = segmentElevations[index] || 0;
    const side = index < HALF ? CONST.SIDE_PLAYER : CONST.SIDE_AI;

    // Determine color — alternate slightly for visual grid
    const isEven = index % 2 === 0;
    const baseColor = isEven ? COLORS.TERRAIN : COLORS.TERRAIN_LIGHT;

    // Platform geometry
    const geo = new THREE.BoxGeometry(SEG_W - 1, PLATFORM_HEIGHT, PLATFORM_DEPTH);
    const mat = new THREE.MeshLambertMaterial({ color: baseColor });
    const mesh = new THREE.Mesh(geo, mat);

    const pos = segmentToWorldPos(index);
    mesh.position.set(pos.x, pos.y, pos.z);

    // Assign metadata
    mesh.userData = {
      segmentIndex: index,
      side: side,
      destroyed: false,
      originalY: pos.y,
      originalColor: baseColor
    };

    scene.add(mesh);
    segmentMeshes[index] = mesh;

    // Grid line on top of segment (thin box as a line)
    createGridLines(index, pos);

    return mesh;
  }

  // ── Create grid line markings on a segment ──
  function createGridLines(index, pos) {
    const lineGroup = new THREE.Group();

    // Border lines (left and right edges)
    const edgeGeo = new THREE.BoxGeometry(0.5, 0.3, PLATFORM_DEPTH);
    const lineMat = new THREE.MeshBasicMaterial({ color: COLORS.GRID });

    // Left edge
    const leftLine = new THREE.Mesh(edgeGeo, lineMat);
    leftLine.position.set(
      pos.x - (SEG_W - 1) / 2,
      pos.y + PLATFORM_HEIGHT / 2 + 0.2,
      0
    );
    lineGroup.add(leftLine);

    // Right edge
    const rightLine = new THREE.Mesh(edgeGeo, lineMat);
    rightLine.position.set(
      pos.x + (SEG_W - 1) / 2,
      pos.y + PLATFORM_HEIGHT / 2 + 0.2,
      0
    );
    lineGroup.add(rightLine);

    // Cross line (front-to-back center)
    const crossGeo = new THREE.BoxGeometry(SEG_W - 1, 0.3, 0.5);
    const crossLine = new THREE.Mesh(crossGeo, lineMat);
    crossLine.position.set(
      pos.x,
      pos.y + PLATFORM_HEIGHT / 2 + 0.2,
      0
    );
    lineGroup.add(crossLine);

    scene.add(lineGroup);
    gridLineMeshes[index] = lineGroup;
  }

  // ── Create terrain (all 28 segments) ──
  function createTerrain() {
    generateElevations();
    for (let i = 0; i < TOTAL; i++) {
      createSegmentMesh(i);
    }

    // Ground plane beneath terrain (dark abyss)
    const groundGeo = new THREE.BoxGeometry(TOTAL * SEG_W + SEG_W * 6, 2, PLATFORM_DEPTH + 40);
    const groundMat = new THREE.MeshLambertMaterial({ color: COLORS.BG_DARK });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(MAP_CENTER_X, BASE_Y - 10, 0);
    scene.add(ground);
  }

  // ── Create fog of war meshes (AI side) ──
  function createFogOfWar() {
    for (let i = HALF; i < TOTAL; i++) {
      const pos = segmentToWorldPos(i);
      const fogGeo = new THREE.BoxGeometry(SEG_W, PLATFORM_HEIGHT + 20, PLATFORM_DEPTH + 2);
      const fogMat = new THREE.MeshBasicMaterial({
        color: 0x050500,
        transparent: true,
        opacity: 0.85
      });
      const fogMesh = new THREE.Mesh(fogGeo, fogMat);
      fogMesh.position.set(pos.x, pos.y + 6, 0);
      fogMesh.userData.segmentIndex = i;
      fogMesh.userData.isFog = true;
      scene.add(fogMesh);
      fogMeshes[i] = fogMesh;
    }
  }

  // ── Toggle fog for a segment ──
  function setFogRevealed(segmentIndex, revealed) {
    const fog = fogMeshes[segmentIndex];
    if (!fog) return;
    fog.visible = !revealed;
  }

  // ── Create crater effect at a segment ──
  function createCrater(segmentIndex) {
    const mesh = segmentMeshes[segmentIndex];
    if (!mesh) return;

    mesh.userData.destroyed = true;

    // Lower the segment
    const targetY = mesh.userData.originalY + CRATER_DEPTH;
    mesh.position.y = targetY;

    // Darken the material
    mesh.material.color.setHex(COLORS.CRATER);
    mesh.material.needsUpdate = true;

    // Scale down slightly for crater look
    mesh.scale.set(1, 0.3, 1);

    // Update grid lines position
    const grid = gridLineMeshes[segmentIndex];
    if (grid) {
      grid.visible = false;
    }
  }

  // ── Lighting setup ──
  function createLights() {
    // Dim amber ambient
    ambientLight = new THREE.AmbientLight(0x554400, 0.6);
    scene.add(ambientLight);

    // Directional from above
    directionalLight = new THREE.DirectionalLight(0xFFCC66, 0.8);
    directionalLight.position.set(MAP_CENTER_X, 200, 100);
    directionalLight.target.position.set(MAP_CENTER_X, 0, 0);
    scene.add(directionalLight);
    scene.add(directionalLight.target);
  }

  // ── Camera setup ──
  function createCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(45, aspect, 1, 3000);

    // 2.5D side-scrolling: camera to the side and slightly above
    camera.position.set(MAP_CENTER_X, 120, 350);
    camera.lookAt(MAP_CENTER_X, 0, 0);

    cameraTargetX = MAP_CENTER_X;
  }

  // ── Camera panning ──
  function setCameraTarget(x) {
    cameraTargetX = clampCameraX(x);
  }

  function clampCameraX(x) {
    return Math.max(MAP_LEFT + 100, Math.min(MAP_RIGHT - 100, x));
  }

  function updateCamera(dt) {
    // Smooth lerp toward target
    const lerpSpeed = 4.0;
    const dx = cameraTargetX - camera.position.x;
    camera.position.x += dx * Math.min(1, lerpSpeed * dt);

    // Apply screen shake
    let offsetX = 0;
    let offsetY = 0;
    if (shakeDuration > 0) {
      shakeElapsed += dt;
      if (shakeElapsed < shakeDuration) {
        const progress = shakeElapsed / shakeDuration;
        const decay = 1 - progress;
        offsetX = (Math.random() - 0.5) * 2 * shakeIntensity * decay;
        offsetY = (Math.random() - 0.5) * 2 * shakeIntensity * decay;
      } else {
        shakeDuration = 0;
        shakeElapsed = 0;
        shakeIntensity = 0;
      }
    }

    shakeOffsetX = offsetX;
    shakeOffsetY = offsetY;

    // Apply final camera position with shake
    camera.position.y = 120 + offsetY;
    camera.position.z = 350;
    camera.lookAt(camera.position.x + offsetX, 0, 0);
  }

  // ── Screen shake ──
  function shakeScreen(intensity, duration) {
    shakeIntensity = intensity;
    shakeDuration = duration;
    shakeElapsed = 0;
  }

  // ── Input handling ──
  function setupInput() {
    const canvas = renderer.domElement;

    // Mouse drag for camera pan
    canvas.addEventListener('mousedown', function (e) {
      if (e.button === 0 || e.button === 2) {
        cameraDragActive = true;
        cameraDragStartX = e.clientX;
        cameraDragCamStartX = cameraTargetX;
      }
    });

    window.addEventListener('mousemove', function (e) {
      if (!cameraDragActive) return;
      const dx = e.clientX - cameraDragStartX;
      // Pan speed scaled to world units
      const panScale = 2.0;
      cameraTargetX = clampCameraX(cameraDragCamStartX - dx * panScale);
    });

    window.addEventListener('mouseup', function () {
      cameraDragActive = false;
    });

    // Arrow keys for camera pan
    const keysDown = {};
    window.addEventListener('keydown', function (e) {
      keysDown[e.key] = true;
    });
    window.addEventListener('keyup', function (e) {
      keysDown[e.key] = false;
    });

    // Store reference for update loop
    Renderer._keysDown = keysDown;

    // Window resize
    window.addEventListener('resize', onResize);

    // Prevent context menu on canvas
    canvas.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });
  }

  function updateInputPan(dt) {
    const keys = Renderer._keysDown || {};
    const panSpeed = 400;
    if (keys['ArrowLeft'] || keys['a'] || keys['A']) {
      cameraTargetX = clampCameraX(cameraTargetX - panSpeed * dt);
    }
    if (keys['ArrowRight'] || keys['d'] || keys['D']) {
      cameraTargetX = clampCameraX(cameraTargetX + panSpeed * dt);
    }
  }

  // ── Resize handler ──
  function onResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ── Scene accessors ──
  function getScene() { return scene; }
  function getCamera() { return camera; }

  // ── Add/remove mesh helpers ──
  function addMeshToScene(mesh) {
    if (scene && mesh) scene.add(mesh);
  }

  function removeMeshFromScene(mesh) {
    if (scene && mesh) scene.remove(mesh);
  }

  // ── Main update ──
  function update(dt) {
    updateInputPan(dt);
    updateCamera(dt);
    renderer.render(scene, camera);
  }

  // ── Animation loop ──
  let lastTime = 0;
  function animate(time) {
    requestAnimationFrame(animate);
    const dt = Math.min((time - lastTime) / 1000, 0.05); // cap delta to 50ms
    lastTime = time;
    update(dt);
  }

  // ── Initialization ──
  function init() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.BG_DARK);
    scene.fog = new THREE.Fog(COLORS.BG_DARK, 600, 1400);

    // Clock
    clock = new THREE.Clock();

    // Camera
    createCamera();

    // Renderer
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

    // Set body style
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.overflow = 'hidden';
    document.body.style.background = '#0A0A00';

    // Lights
    createLights();

    // Terrain
    createTerrain();

    // Fog of war
    createFogOfWar();

    // CSS overlays (scanlines + vignette)
    createCSSOverlays();

    // Input
    setupInput();

    // Start animation loop
    lastTime = performance.now();
    requestAnimationFrame(animate);

    console.log('[Renderer] Initialized — ' + TOTAL + ' segments, Three.js r' + THREE.REVISION);
  }

  // ── Public API ──
  const Renderer = {
    init: init,
    update: update,
    segmentToWorldPos: segmentToWorldPos,
    addMeshToScene: addMeshToScene,
    removeMeshFromScene: removeMeshFromScene,
    setCameraTarget: setCameraTarget,
    createCrater: createCrater,
    setFogRevealed: setFogRevealed,
    getScene: getScene,
    getCamera: getCamera,
    shakeScreen: shakeScreen,
    segmentMeshes: segmentMeshes,
    fogMeshes: fogMeshes,
    segmentElevations: segmentElevations,
    _keysDown: {}
  };

  window.Renderer = Renderer;

})();
