// ============================================================
// Robot Attack 2026 — Visual effects
// ============================================================
// Pooled GPU particles (two THREE.Points systems: additive glow and
// alpha-blended smoke/debris), a fixed pool of flash lights,
// shockwave rings, scorch decals and persistent smoke/fire emitters
// for damaged buildings. Everything is driven by Fx.update(dt).

window.Fx = (function () {
  'use strict';

  const MAX = 4000;
  let scene = null;
  let pools = null;
  const lights = [];
  const rings = [];
  const emitters = {};
  let decalMat = null, ringMat = null;
  const decals = [];

  const VERT = `
    attribute float size;
    attribute vec4 pcolor;
    varying vec4 vColor;
    uniform float scale;
    void main() {
      vColor = pcolor;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * scale / -mv.z;
      gl_Position = projectionMatrix * mv;
    }`;
  const FRAG_SOFT = `
    varying vec4 vColor;
    void main() {
      vec2 d = gl_PointCoord - 0.5;
      float r = length(d);
      if (r > 0.5) discard;
      float a = smoothstep(0.5, 0.0, r);
      gl_FragColor = vec4(vColor.rgb, vColor.a * a);
    }`;
  const FRAG_SMOKE = `
    varying vec4 vColor;
    void main() {
      vec2 d = gl_PointCoord - 0.5;
      float r = length(d);
      if (r > 0.5) discard;
      float a = smoothstep(0.5, 0.15, r);
      gl_FragColor = vec4(vColor.rgb, vColor.a * a);
    }`;

  function makePool(blending, frag) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX * 3);
    const col = new Float32Array(MAX * 4);
    const size = new Float32Array(MAX);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: window.innerHeight * 0.9 } },
      vertexShader: VERT, fragmentShader: frag,
      transparent: true, depthWrite: false, blending
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = blending === THREE.AdditiveBlending ? 20 : 19;
    scene.add(pts);
    // particle data (struct of arrays)
    return {
      pts, geo, mat, pos, col, size,
      count: 0,
      px: new Float32Array(MAX), py: new Float32Array(MAX), pz: new Float32Array(MAX),
      vx: new Float32Array(MAX), vy: new Float32Array(MAX), vz: new Float32Array(MAX),
      life: new Float32Array(MAX), maxLife: new Float32Array(MAX),
      s0: new Float32Array(MAX), s1: new Float32Array(MAX),
      c0: new Float32Array(MAX * 3), c1: new Float32Array(MAX * 3),
      a0: new Float32Array(MAX), grav: new Float32Array(MAX), drag: new Float32Array(MAX),
      bounce: new Uint8Array(MAX)
    };
  }

  function init(sc) {
    scene = sc;
    pools = {
      glow: makePool(THREE.AdditiveBlending, FRAG_SOFT),
      smoke: makePool(THREE.NormalBlending, FRAG_SMOKE)
    };
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 90, 2);
      l.position.set(0, -100, 0);
      scene.add(l);
      lights.push({ light: l, t: 0, dur: 0, peak: 0 });
    }
    ringMat = new THREE.MeshBasicMaterial({ color: 0xffd090, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    decalMat = new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    window.addEventListener('resize', () => {
      for (const k in pools) pools[k].mat.uniforms.scale.value = window.innerHeight * 0.9;
    });
  }

  function scorchTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grd.addColorStop(0, 'rgba(10,8,6,0.95)');
    grd.addColorStop(0.5, 'rgba(20,14,10,0.7)');
    grd.addColorStop(1, 'rgba(20,14,10,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    // a few streaks
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      g.lineWidth = 2 + Math.random() * 4;
      g.beginPath();
      g.moveTo(64 + Math.cos(a) * 14, 64 + Math.sin(a) * 14);
      g.lineTo(64 + Math.cos(a) * (40 + Math.random() * 20), 64 + Math.sin(a) * (40 + Math.random() * 20));
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  // ── Spawning ──────────────────────────────────────────────
  const tmpC0 = new THREE.Color(), tmpC1 = new THREE.Color();
  function spawn(poolName, o) {
    const p = pools[poolName];
    if (p.count >= MAX) return;
    const i = p.count++;
    p.px[i] = o.x; p.py[i] = o.y; p.pz[i] = o.z;
    p.vx[i] = o.vx || 0; p.vy[i] = o.vy || 0; p.vz[i] = o.vz || 0;
    p.life[i] = p.maxLife[i] = o.life || 1;
    p.s0[i] = o.size || 2; p.s1[i] = o.size1 !== undefined ? o.size1 : p.s0[i];
    tmpC0.set(o.color !== undefined ? o.color : 0xffffff);
    tmpC1.set(o.color1 !== undefined ? o.color1 : (o.color !== undefined ? o.color : 0xffffff));
    p.c0[i * 3] = tmpC0.r; p.c0[i * 3 + 1] = tmpC0.g; p.c0[i * 3 + 2] = tmpC0.b;
    p.c1[i * 3] = tmpC1.r; p.c1[i * 3 + 1] = tmpC1.g; p.c1[i * 3 + 2] = tmpC1.b;
    p.a0[i] = o.alpha !== undefined ? o.alpha : 1;
    p.grav[i] = o.grav || 0;
    p.drag[i] = o.drag || 0;
    p.bounce[i] = o.bounce ? 1 : 0;
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function sphere(speed) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    return { x: s * Math.cos(th) * speed, y: u * speed, z: s * Math.sin(th) * speed };
  }

  function flashLight(pos, color, peak, dur) {
    let slot = lights[0];
    for (const l of lights) if (l.t >= l.dur) { slot = l; break; }
    slot.light.position.set(pos.x, pos.y + 6, pos.z);
    slot.light.color.set(color);
    slot.t = 0; slot.dur = dur; slot.peak = peak;
  }

  function ring(pos, color, maxScale, dur) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.2, 40), ringMat.clone());
    m.material.color.set(color);
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, pos.y + 0.4, pos.z);
    scene.add(m);
    rings.push({ m, t: 0, dur, maxScale });
  }

  function scorch(pos, size) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), decalMat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * Math.PI * 2;
    m.position.set(pos.x, 0.08 + decals.length * 0.001, pos.z);
    m.renderOrder = 2;
    scene.add(m);
    decals.push(m);
    if (decals.length > 80) {
      const old = decals.shift();
      scene.remove(old);
      old.geometry.dispose();
    }
  }

  // ── Composite effects ─────────────────────────────────────
  function explosion(pos, scale) {
    scale = scale || 1;
    const s = scale;
    // core flash
    spawn('glow', { x: pos.x, y: pos.y + 3, z: pos.z, size: 30 * s, size1: 50 * s, life: 0.25, color: 0xffffff, color1: 0xffaa33, alpha: 1 });
    // fireball
    for (let i = 0; i < 45 * s; i++) {
      const v = sphere(rnd(8, 30) * s);
      spawn('glow', { x: pos.x, y: pos.y + 3, z: pos.z, vx: v.x, vy: Math.abs(v.y) * 1.1 + 4, vz: v.z, drag: 3.2, grav: -6,
        size: rnd(5, 10) * s, size1: rnd(1, 3), life: rnd(0.45, 0.95), color: 0xffe9a0, color1: 0xff3a00, alpha: 0.95 });
    }
    // smoke column
    for (let i = 0; i < 26 * s; i++) {
      const v = sphere(rnd(3, 12) * s);
      spawn('smoke', { x: pos.x + v.x * 0.2, y: pos.y + 4, z: pos.z + v.z * 0.2, vx: v.x, vy: rnd(6, 16) * s, vz: v.z, drag: 1.4, grav: -2,
        size: rnd(6, 10) * s, size1: rnd(16, 26) * s, life: rnd(1.6, 3.0), color: 0x3a3430, color1: 0x1a1816, alpha: 0.65 });
    }
    // debris with gravity and bounce
    for (let i = 0; i < 16 * s; i++) {
      const v = sphere(rnd(15, 40) * s);
      spawn('smoke', { x: pos.x, y: pos.y + 3, z: pos.z, vx: v.x, vy: Math.abs(v.y) + 18, vz: v.z, grav: 70, drag: 0.3, bounce: true,
        size: rnd(1.2, 2.4), size1: rnd(1, 2), life: rnd(1.2, 2.0), color: 0x2a2622, alpha: 1 });
    }
    // sparks
    for (let i = 0; i < 24 * s; i++) {
      const v = sphere(rnd(30, 70) * s);
      spawn('glow', { x: pos.x, y: pos.y + 3, z: pos.z, vx: v.x, vy: Math.abs(v.y) + 10, vz: v.z, grav: 60, drag: 1,
        size: rnd(1, 2), size1: 0.3, life: rnd(0.4, 0.9), color: 0xffdd88, color1: 0xff5500 });
    }
    ring(pos, 0xffc070, 26 * s, 0.55);
    flashLight(pos, 0xff9944, 7 * s, 0.6);
    scorch(pos, 14 * s);
  }

  function smallBlast(pos, color) {
    spawn('glow', { x: pos.x, y: pos.y, z: pos.z, size: 16, size1: 26, life: 0.2, color: 0xffffff, color1: color || 0xffcc66 });
    for (let i = 0; i < 18; i++) {
      const v = sphere(rnd(10, 26));
      spawn('glow', { x: pos.x, y: pos.y, z: pos.z, vx: v.x, vy: v.y, vz: v.z, drag: 3, size: rnd(2.5, 5), size1: 0.5, life: rnd(0.3, 0.6), color: 0xfff0c0, color1: color || 0xff8800 });
    }
    for (let i = 0; i < 8; i++) {
      const v = sphere(rnd(3, 8));
      spawn('smoke', { x: pos.x, y: pos.y, z: pos.z, vx: v.x, vy: v.y + 2, vz: v.z, drag: 1, size: 5, size1: 12, life: rnd(1, 1.6), color: 0x55504a, color1: 0x2a2826, alpha: 0.5 });
    }
    flashLight(pos, color || 0xffcc66, 3, 0.3);
  }

  function shieldHit(pos) {
    for (let i = 0; i < 30; i++) {
      const v = sphere(rnd(10, 22));
      spawn('glow', { x: pos.x, y: pos.y, z: pos.z, vx: v.x, vy: v.y, vz: v.z, drag: 2.5, size: rnd(2, 4), size1: 0.4, life: rnd(0.4, 0.8), color: 0xe0d0ff, color1: 0x7a50ff });
    }
    spawn('glow', { x: pos.x, y: pos.y, z: pos.z, size: 20, size1: 34, life: 0.3, color: 0xcbb8ff, color1: 0x5530ff, alpha: 0.9 });
    flashLight(pos, 0x9d7cff, 4, 0.4);
  }

  function dustRing(pos, scale) {
    scale = scale || 1;
    for (let i = 0; i < 28 * scale; i++) {
      const a = (i / (28 * scale)) * Math.PI * 2;
      const sp = rnd(14, 24) * scale;
      spawn('smoke', { x: pos.x, y: pos.y + 0.6, z: pos.z, vx: Math.cos(a) * sp, vy: rnd(1, 4), vz: Math.sin(a) * sp, drag: 2.6,
        size: rnd(4, 6) * scale, size1: rnd(9, 14) * scale, life: rnd(0.9, 1.5), color: 0x8a7a62, color1: 0x5a5040, alpha: 0.55 });
    }
  }

  function muzzle(pos, dir, color) {
    spawn('glow', { x: pos.x, y: pos.y, z: pos.z, size: 7, size1: 2, life: 0.08, color: 0xffffff, color1: color || 0xffcc66 });
    for (let i = 0; i < 4; i++) {
      spawn('glow', { x: pos.x, y: pos.y, z: pos.z, vx: dir.x * 40 + rnd(-8, 8), vy: dir.y * 40 + rnd(-8, 8), vz: dir.z * 40 + rnd(-8, 8), drag: 4, size: 1.5, size1: 0.2, life: 0.15, color: 0xffeeaa, color1: 0xff7700 });
    }
  }

  // Line tracer as a sequence of glow particles
  function tracer(a, b, color) {
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      spawn('glow', { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, size: 1.6, size1: 0.4, life: 0.12 + t * 0.06, color: 0xffffcc, color1: color || 0xffaa33 });
    }
  }

  // Exhaust/trail puff for moving projectiles
  function trail(pos, kind, color) {
    if (kind === 'missile') {
      spawn('glow', { x: pos.x, y: pos.y, z: pos.z, vx: rnd(-2, 2), vy: rnd(-2, 2), vz: rnd(-2, 2), size: 9, size1: 2, life: 0.3, color: 0xfff2b0, color1: color || 0xff6a00 });
      spawn('glow', { x: pos.x, y: pos.y, z: pos.z, size: 5, size1: 1, life: 0.12, color: 0xffffff, color1: 0xffe0a0 });
      spawn('smoke', { x: pos.x, y: pos.y, z: pos.z, vx: rnd(-1.5, 1.5), vy: rnd(0, 2), vz: rnd(-1.5, 1.5), drag: 0.6, size: 4, size1: 15, life: rnd(1.6, 2.4), color: 0x9a958f, color1: 0x4a4744, alpha: 0.5 });
    } else if (kind === 'interceptor') {
      spawn('glow', { x: pos.x, y: pos.y, z: pos.z, size: 5, size1: 1, life: 0.25, color: 0xffffff, color1: 0x88ccff });
      spawn('smoke', { x: pos.x, y: pos.y, z: pos.z, size: 2.5, size1: 8, life: 1.1, color: 0xd0d4d8, color1: 0x6a6e72, alpha: 0.45 });
    } else if (kind === 'pod') {
      spawn('glow', { x: pos.x, y: pos.y, z: pos.z, vx: rnd(-3, 3), vy: rnd(8, 14), vz: rnd(-3, 3), size: 5, size1: 1, life: 0.3, color: 0xfff2b0, color1: color || 0xff6a00 });
      spawn('smoke', { x: pos.x, y: pos.y + 2, z: pos.z, vx: rnd(-2, 2), vy: rnd(2, 5), vz: rnd(-2, 2), drag: 0.6, size: 3, size1: 10, life: rnd(1, 1.6), color: 0x77726c, color1: 0x3a3836, alpha: 0.4 });
    }
  }

  function buildDust(pos) { dustRing(pos, 0.7); }

  function heal(pos) {
    for (let i = 0; i < 16; i++) {
      spawn('glow', { x: pos.x + rnd(-4, 4), y: pos.y + rnd(0, 4), z: pos.z + rnd(-4, 4), vy: rnd(6, 12), drag: 1, size: rnd(1.5, 3), size1: 0.3, life: rnd(0.6, 1), color: 0xbaffd0, color1: 0x33ff88 });
    }
  }

  // ── Persistent emitters (damaged buildings, burning ruins) ─
  function setEmitter(key, pos, kind, ttl) {
    if (!kind) { delete emitters[key]; return; }
    emitters[key] = { pos: { x: pos.x, y: pos.y, z: pos.z }, kind, acc: 0, ttl: ttl || Infinity };
  }
  function clearEmitters() { for (const k in emitters) delete emitters[k]; }

  function runEmitters(dt) {
    for (const k in emitters) {
      const e = emitters[k];
      e.ttl -= dt;
      if (e.ttl <= 0) { delete emitters[k]; continue; }
      const rate = e.kind === 'fire' ? 22 : 7;
      e.acc += dt * rate;
      while (e.acc >= 1) {
        e.acc -= 1;
        const p = e.pos;
        if (e.kind === 'fire') {
          spawn('glow', { x: p.x + rnd(-2.5, 2.5), y: p.y, z: p.z + rnd(-2.5, 2.5), vx: rnd(-1, 1), vy: rnd(6, 11), vz: rnd(-1, 1), drag: 1, size: rnd(3, 5), size1: 0.5, life: rnd(0.4, 0.8), color: 0xffd070, color1: 0xff3000 });
          if (Math.random() < 0.35) spawn('smoke', { x: p.x, y: p.y + 3, z: p.z, vx: rnd(-1, 1) + 1.5, vy: rnd(5, 8), vz: rnd(-1, 1), drag: 0.4, size: 4, size1: 14, life: rnd(2, 3), color: 0x2a2624, color1: 0x141210, alpha: 0.55 });
        } else {
          spawn('smoke', { x: p.x + rnd(-1.5, 1.5), y: p.y, z: p.z + rnd(-1.5, 1.5), vx: rnd(-0.5, 0.5) + 1.2, vy: rnd(4, 7), vz: rnd(-0.5, 0.5), drag: 0.4, size: 3, size1: 11, life: rnd(1.8, 2.6), color: 0x55504c, color1: 0x2a2826, alpha: 0.45 });
        }
      }
    }
  }

  // ── Update ────────────────────────────────────────────────
  function updatePool(p, dt) {
    let i = 0;
    while (i < p.count) {
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        // swap-remove
        const last = --p.count;
        if (i !== last) copyParticle(p, last, i);
        continue;
      }
      const dr = Math.max(0, 1 - p.drag[i] * dt);
      p.vx[i] *= dr; p.vy[i] *= dr; p.vz[i] *= dr;
      p.vy[i] -= p.grav[i] * dt;
      p.px[i] += p.vx[i] * dt; p.py[i] += p.vy[i] * dt; p.pz[i] += p.vz[i] * dt;
      if (p.py[i] < 0.3) {
        if (p.bounce[i]) { p.py[i] = 0.3; p.vy[i] = -p.vy[i] * 0.35; p.vx[i] *= 0.6; p.vz[i] *= 0.6; }
        else if (p.grav[i] > 0) p.py[i] = 0.3;
      }
      const t = 1 - p.life[i] / p.maxLife[i];
      p.pos[i * 3] = p.px[i]; p.pos[i * 3 + 1] = p.py[i]; p.pos[i * 3 + 2] = p.pz[i];
      p.size[i] = p.s0[i] + (p.s1[i] - p.s0[i]) * t;
      const j = i * 3, k = i * 4;
      p.col[k] = p.c0[j] + (p.c1[j] - p.c0[j]) * t;
      p.col[k + 1] = p.c0[j + 1] + (p.c1[j + 1] - p.c0[j + 1]) * t;
      p.col[k + 2] = p.c0[j + 2] + (p.c1[j + 2] - p.c0[j + 2]) * t;
      // fade in fast, fade out over last 60%
      const fade = t < 0.08 ? t / 0.08 : Math.min(1, (1 - t) / 0.6);
      p.col[k + 3] = p.a0[i] * fade;
      i++;
    }
    p.geo.setDrawRange(0, p.count);
    p.geo.attributes.position.needsUpdate = true;
    p.geo.attributes.pcolor.needsUpdate = true;
    p.geo.attributes.size.needsUpdate = true;
  }

  function copyParticle(p, from, to) {
    p.px[to] = p.px[from]; p.py[to] = p.py[from]; p.pz[to] = p.pz[from];
    p.vx[to] = p.vx[from]; p.vy[to] = p.vy[from]; p.vz[to] = p.vz[from];
    p.life[to] = p.life[from]; p.maxLife[to] = p.maxLife[from];
    p.s0[to] = p.s0[from]; p.s1[to] = p.s1[from];
    for (let c = 0; c < 3; c++) { p.c0[to * 3 + c] = p.c0[from * 3 + c]; p.c1[to * 3 + c] = p.c1[from * 3 + c]; }
    p.a0[to] = p.a0[from]; p.grav[to] = p.grav[from]; p.drag[to] = p.drag[from]; p.bounce[to] = p.bounce[from];
  }

  function update(dt) {
    if (!pools) return;
    runEmitters(dt);
    updatePool(pools.glow, dt);
    updatePool(pools.smoke, dt);
    for (const l of lights) {
      if (l.t >= l.dur) { l.light.intensity = 0; continue; }
      l.t += dt;
      const k = Math.max(0, 1 - l.t / l.dur);
      l.light.intensity = l.peak * k * k;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose();
        rings.splice(i, 1);
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      r.m.scale.setScalar(1 + e * r.maxScale);
      r.m.material.opacity = (1 - k) * 0.9;
    }
  }

  function reset() {
    if (!pools) return;
    pools.glow.count = 0; pools.smoke.count = 0;
    clearEmitters();
    for (const d of decals) { scene.remove(d); d.geometry.dispose(); }
    decals.length = 0;
    for (const r of rings) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); }
    rings.length = 0;
    for (const l of lights) { l.t = l.dur = 0; l.light.intensity = 0; }
  }

  return { init, update, reset, spawn, explosion, smallBlast, shieldHit, dustRing, buildDust, muzzle, tracer, trail, heal, scorch, ring, flashLight, setEmitter, clearEmitters };
})();
