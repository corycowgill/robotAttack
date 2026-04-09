// ============================================================
// Robot Strategy Attack 2026 — Audio & Visual Effects
// ============================================================
// Web Audio API procedural 8-bit tones + particle system + screen shake

window.SFX = (function() {
  let audioCtx = null;
  let masterGain = null;
  let particles = [];
  let shakeState = { intensity: 0, duration: 0, elapsed: 0, offsetX: 0, offsetY: 0 };
  let scene = null;
  let muted = false;

  // ════════════════════════════════════════
  // AUDIO INITIALIZATION
  // ════════════════════════════════════════
  function initAudio() {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.3;
      masterGain.connect(audioCtx.destination);
    } catch (e) {
      console.warn('Web Audio not available:', e);
    }
  }

  function ensureAudio() {
    if (!audioCtx) initAudio();
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  // ════════════════════════════════════════
  // TONE GENERATORS (8-bit style)
  // ════════════════════════════════════════
  function playTone(freq, duration, type = 'square', volume = 0.3) {
    if (muted || !audioCtx) return;
    ensureAudio();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + duration);
  }

  function playNoise(duration, volume = 0.2) {
    if (muted || !audioCtx) return;
    ensureAudio();

    const bufferSize = audioCtx.sampleRate * duration;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

    source.connect(gain);
    gain.connect(masterGain);
    source.start();
  }

  // ── Named sound effects ──
  const sounds = {
    build() {
      playTone(200, 0.05, 'square', 0.2);
      setTimeout(() => playTone(400, 0.08, 'square', 0.2), 50);
      setTimeout(() => playTone(600, 0.1, 'square', 0.15), 100);
    },
    missileLaunch() {
      playTone(150, 0.3, 'sawtooth', 0.25);
      setTimeout(() => playTone(300, 0.2, 'sawtooth', 0.2), 100);
      setTimeout(() => playTone(600, 0.4, 'sawtooth', 0.15), 200);
    },
    explosion() {
      playNoise(0.5, 0.4);
      playTone(80, 0.3, 'sawtooth', 0.3);
      setTimeout(() => playTone(40, 0.4, 'sawtooth', 0.2), 100);
    },
    intercept() {
      playTone(800, 0.05, 'square', 0.2);
      setTimeout(() => playTone(600, 0.05, 'square', 0.15), 50);
      setTimeout(() => playTone(400, 0.1, 'square', 0.1), 100);
    },
    shieldAbsorb() {
      playTone(500, 0.15, 'sine', 0.2);
      setTimeout(() => playTone(700, 0.2, 'sine', 0.15), 80);
    },
    robotLand() {
      playNoise(0.2, 0.3);
      playTone(100, 0.2, 'square', 0.2);
      setTimeout(() => playTone(60, 0.3, 'sawtooth', 0.15), 100);
    },
    robotAttack() {
      playTone(120, 0.08, 'sawtooth', 0.25);
      setTimeout(() => playNoise(0.15, 0.3), 80);
      setTimeout(() => playTone(80, 0.15, 'square', 0.2), 120);
    },
    turnStart() {
      playTone(330, 0.08, 'square', 0.15);
      setTimeout(() => playTone(440, 0.08, 'square', 0.15), 100);
      setTimeout(() => playTone(550, 0.12, 'square', 0.2), 200);
    },
    victory() {
      const notes = [330, 440, 550, 660, 880];
      notes.forEach((n, i) => {
        setTimeout(() => playTone(n, 0.2, 'square', 0.2), i * 120);
      });
    },
    defeat() {
      const notes = [440, 330, 220, 165, 110];
      notes.forEach((n, i) => {
        setTimeout(() => playTone(n, 0.3, 'sawtooth', 0.2), i * 150);
      });
    },
    menuClick() {
      playTone(600, 0.05, 'square', 0.15);
    },
    error() {
      playTone(200, 0.1, 'square', 0.2);
      setTimeout(() => playTone(150, 0.15, 'square', 0.2), 100);
    }
  };

  // ════════════════════════════════════════
  // PARTICLE SYSTEM
  // ════════════════════════════════════════
  class Particle {
    constructor(x, y, z, vx, vy, vz, color, size, life) {
      this.mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshBasicMaterial({ color, transparent: true })
      );
      this.mesh.position.set(x, y, z);
      this.vx = vx;
      this.vy = vy;
      this.vz = vz;
      this.life = life;
      this.maxLife = life;
      this.alive = true;
    }

    update(dt) {
      if (!this.alive) return;
      this.life -= dt;
      if (this.life <= 0) {
        this.alive = false;
        return;
      }
      this.mesh.position.x += this.vx * dt;
      this.mesh.position.y += this.vy * dt;
      this.mesh.position.z += this.vz * dt;
      this.vy -= 40 * dt; // gravity
      const alpha = this.life / this.maxLife;
      this.mesh.material.opacity = alpha;
      this.mesh.scale.setScalar(alpha);
    }
  }

  function spawnExplosion(x, y, z, count = 20, color = 0xFF6600) {
    if (!scene) return;
    for (let i = 0; i < count; i++) {
      const speed = 20 + Math.random() * 60;
      const angle = Math.random() * Math.PI * 2;
      const pitch = Math.random() * Math.PI - Math.PI / 2;
      const vx = Math.cos(angle) * Math.cos(pitch) * speed;
      const vy = Math.sin(pitch) * speed + 20;
      const vz = Math.sin(angle) * Math.cos(pitch) * speed * 0.3;
      const size = 1 + Math.random() * 3;
      const life = 0.4 + Math.random() * 0.8;

      // Vary colors: orange, yellow, red
      const colors = [0xFF6600, 0xFFB000, 0xFF3300, 0xFF8800];
      const c = color === 0xFF6600 ? colors[Math.floor(Math.random() * colors.length)] : color;

      const p = new Particle(x, y, z, vx, vy, vz, c, size, life);
      scene.add(p.mesh);
      particles.push(p);
    }
  }

  function spawnSmoke(x, y, z, count = 8) {
    if (!scene) return;
    for (let i = 0; i < count; i++) {
      const vx = (Math.random() - 0.5) * 10;
      const vy = 5 + Math.random() * 15;
      const vz = (Math.random() - 0.5) * 5;
      const size = 2 + Math.random() * 4;
      const life = 0.8 + Math.random() * 1.2;
      const p = new Particle(x, y, z, vx, vy, vz, 0x554400, size, life);
      scene.add(p.mesh);
      particles.push(p);
    }
  }

  function spawnSparks(x, y, z, count = 12) {
    if (!scene) return;
    for (let i = 0; i < count; i++) {
      const speed = 30 + Math.random() * 50;
      const angle = Math.random() * Math.PI * 2;
      const vx = Math.cos(angle) * speed;
      const vy = Math.random() * 40;
      const vz = Math.sin(angle) * speed * 0.2;
      const p = new Particle(x, y, z, vx, vy, vz, 0xFFB000, 0.5 + Math.random(), 0.3 + Math.random() * 0.4);
      scene.add(p.mesh);
      particles.push(p);
    }
  }

  function spawnShieldHit(x, y, z) {
    if (!scene) return;
    for (let i = 0; i < 15; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 15 + Math.random() * 25;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const p = new Particle(x, y, z, vx, vy, 0, 0x00CCFF, 1.5, 0.5 + Math.random() * 0.3);
      scene.add(p.mesh);
      particles.push(p);
    }
  }

  // ════════════════════════════════════════
  // SCREEN SHAKE
  // ════════════════════════════════════════
  function triggerShake(intensity = 5, duration = 0.3) {
    shakeState.intensity = intensity;
    shakeState.duration = duration;
    shakeState.elapsed = 0;
  }

  function updateShake(dt, camera) {
    if (shakeState.duration <= 0) return;
    shakeState.elapsed += dt;
    if (shakeState.elapsed >= shakeState.duration) {
      shakeState.duration = 0;
      shakeState.offsetX = 0;
      shakeState.offsetY = 0;
      return;
    }
    const progress = shakeState.elapsed / shakeState.duration;
    const decay = 1 - progress;
    shakeState.offsetX = (Math.random() - 0.5) * shakeState.intensity * decay;
    shakeState.offsetY = (Math.random() - 0.5) * shakeState.intensity * decay;
    if (camera) {
      camera.position.x += shakeState.offsetX;
      camera.position.y += shakeState.offsetY;
    }
  }

  // ════════════════════════════════════════
  // UPDATE LOOP
  // ════════════════════════════════════════
  function update(dt, camera) {
    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      particles[i].update(dt);
      if (!particles[i].alive) {
        if (scene) scene.remove(particles[i].mesh);
        particles[i].mesh.geometry.dispose();
        particles[i].mesh.material.dispose();
        particles.splice(i, 1);
      }
    }

    // Update screen shake
    updateShake(dt, camera);
  }

  // ════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════
  return {
    init(threeScene) {
      scene = threeScene;
      initAudio();
    },

    update,

    // Sound effects
    play(name) {
      if (sounds[name]) sounds[name]();
    },

    // Particle effects
    spawnExplosion,
    spawnSmoke,
    spawnSparks,
    spawnShieldHit,

    // Screen shake
    triggerShake,

    // Mute toggle
    toggleMute() {
      muted = !muted;
      return muted;
    },
    isMuted() { return muted; },

    // Cleanup
    clearParticles() {
      for (const p of particles) {
        if (scene) scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
      }
      particles = [];
    }
  };
})();
