// ============================================================
// Robot Strategy Attack 2026 — Buildings (3D Geometry Models)
// ============================================================
// All models built from composed BoxGeometry / CylinderGeometry.
// Industrial retrofuturism style, amber CRT palette.
// ============================================================

(function () {
  'use strict';

  const C = CONST.COLORS;
  const B = CONST.BUILDING;

  // ── Material helpers ──────────────────────────────────────

  function mat(color, opts) {
    return new THREE.MeshLambertMaterial(Object.assign({ color: color }, opts || {}));
  }

  function matBasic(color, opts) {
    return new THREE.MeshBasicMaterial(Object.assign({ color: color }, opts || {}));
  }

  function sideTint(side) {
    return side === CONST.SIDE_PLAYER ? C.PLAYER : C.AI_ENEMY;
  }

  function sideAccent(side) {
    return side === CONST.SIDE_PLAYER ? C.AMBER_DARK : 0x991100;
  }

  function bodyColor(side) {
    return side === CONST.SIDE_PLAYER ? 0x4A3A10 : 0x3A1208;
  }

  function bodyDark(side) {
    return side === CONST.SIDE_PLAYER ? 0x2A1A08 : 0x220A04;
  }

  // ── Geometry helpers ──────────────────────────────────────

  function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
  function cyl(rT, rB, h, seg) { return new THREE.CylinderGeometry(rT, rB, h, seg || 12); }

  function addMesh(group, geo, material, x, y, z) {
    var m = new THREE.Mesh(geo, material);
    m.position.set(x || 0, y || 0, z || 0);
    group.add(m);
    return m;
  }

  // ── Building size registry ────────────────────────────────

  var SIZES = {};
  SIZES[B.POWER_PLANT]      = { width: 24, height: 30, depth: 20 };
  SIZES[B.RADAR_STATION]    = { width: 16, height: 28, depth: 16 };
  SIZES[B.MISSILE_SILO]     = { width: 22, height: 12, depth: 22 };
  SIZES[B.ANTI_MISSILE]     = { width: 20, height: 22, depth: 20 };
  SIZES[B.ROBOT_HANGAR]     = { width: 36, height: 20, depth: 28 };
  SIZES[B.SHIELD_GENERATOR] = { width: 18, height: 26, depth: 18 };
  SIZES[B.COMMAND_CENTER]   = { width: 30, height: 38, depth: 26 };
  SIZES[B.SUPPLY_DEPOT]     = { width: 26, height: 14, depth: 22 };
  SIZES[B.GUN_POD]          = { width: 18, height: 18, depth: 18 };

  // ── Animated parts registry ───────────────────────────────
  // Each entry: { mesh, animType, speed, ... }
  var animatedParts = [];

  // ── POWER PLANT ───────────────────────────────────────────

  function createPowerPlant(side) {
    var g = new THREE.Group();
    var bc = bodyColor(side);
    var ac = sideAccent(side);
    var tc = sideTint(side);

    // Main generator body
    addMesh(g, box(20, 12, 16), mat(bc), 0, 6, 0);
    // Top housing
    addMesh(g, box(16, 4, 12), mat(ac), 0, 14, 0);
    // Vents on side
    for (var i = -6; i <= 6; i += 4) {
      addMesh(g, box(1.5, 2, 14), mat(tc), 10.5, 8, i * 0.5);
    }
    // Smokestack
    addMesh(g, cyl(3, 4, 18, 8), mat(ac), -5, 21, 0);
    addMesh(g, cyl(3.5, 3, 3, 8), mat(bc), -5, 31, 0);
    // Glow element at base
    var glow = addMesh(g, box(8, 2, 8), matBasic(tc), 0, 1, 0);
    glow.userData.isGlow = true;

    // Smoke particle emitter placeholder (small cubes reused)
    var smokeGroup = new THREE.Group();
    smokeGroup.position.set(-5, 33, 0);
    for (var s = 0; s < 5; s++) {
      var smoke = addMesh(smokeGroup, box(2, 2, 2), matBasic(0x554400, { transparent: true, opacity: 0.4 }), 0, s * 4, 0);
      smoke.userData.smokeIndex = s;
      smoke.userData.smokeTime = s * 0.4;
      smoke.visible = true;
    }
    g.add(smokeGroup);
    animatedParts.push({ mesh: smokeGroup, animType: 'smoke', speed: 1.2 });

    return g;
  }

  // ── RADAR STATION ─────────────────────────────────────────

  function createRadarStation(side) {
    var g = new THREE.Group();
    var bc = bodyColor(side);
    var ac = sideAccent(side);
    var tc = sideTint(side);

    // Base platform
    addMesh(g, box(14, 4, 14), mat(bc), 0, 2, 0);
    // Pole
    addMesh(g, cyl(1.5, 2, 16, 6), mat(ac), 0, 12, 0);
    // Dish pivot group (this rotates)
    var dish = new THREE.Group();
    dish.position.set(0, 22, 0);
    // Dish — flat cylinder
    var d = addMesh(dish, cyl(8, 8, 1.5, 12), mat(tc), 0, 0, 0);
    d.rotation.x = Math.PI * 0.15;
    // Feed horn
    addMesh(dish, cyl(0.8, 0.8, 6, 6), mat(ac), 0, 3, -3);
    g.add(dish);

    // Indicator light
    addMesh(g, box(2, 2, 2), matBasic(tc), 0, 4.5, 7);

    animatedParts.push({ mesh: dish, animType: 'rotate', speed: 1.5, axis: 'y' });

    return g;
  }

  // ── MISSILE SILO ──────────────────────────────────────────

  function createMissileSilo(side) {
    var g = new THREE.Group();
    var bc = bodyColor(side);
    var ac = sideAccent(side);
    var tc = sideTint(side);

    // Underground bunker — low profile box
    addMesh(g, box(20, 6, 20), mat(bc), 0, 3, 0);
    // Reinforced edges
    addMesh(g, box(22, 2, 22), mat(ac), 0, 0.5, 0);
    // Hatch (cylinder, slightly raised)
    addMesh(g, cyl(7, 7, 2, 10), mat(ac), 0, 7, 0);
    // Hatch ring
    addMesh(g, cyl(8, 8, 1, 10), mat(tc), 0, 6.5, 0);
    // Missile tip visible through hatch
    addMesh(g, cyl(1.5, 2.5, 4, 6), mat(tc), 0, 9, 0);
    // Warning stripes (small boxes)
    addMesh(g, box(22, 1, 2), matBasic(tc), 0, 6.2, 10);
    addMesh(g, box(22, 1, 2), matBasic(tc), 0, 6.2, -10);

    return g;
  }

  // ── ANTI-MISSILE BATTERY ──────────────────────────────────

  function createAntiMissile(side) {
    var g = new THREE.Group();
    var bc = bodyColor(side);
    var ac = sideAccent(side);
    var tc = sideTint(side);

    // Turret base
    addMesh(g, box(18, 6, 18), mat(bc), 0, 3, 0);
    // Rotating turret top
    addMesh(g, box(12, 5, 12), mat(ac), 0, 8.5, 0);
    // Twin barrels pointing up/outward
    var barrel1 = addMesh(g, cyl(1.5, 1.5, 14, 6), mat(tc), -4, 16, 0);
    barrel1.rotation.z = 0.15;
    var barrel2 = addMesh(g, cyl(1.5, 1.5, 14, 6), mat(tc), 4, 16, 0);
    barrel2.rotation.z = -0.15;
    // Barrel base brackets
    addMesh(g, box(12, 3, 4), mat(ac), 0, 11, 0);
    // Sensor array
    addMesh(g, box(3, 3, 3), matBasic(tc), 0, 12, 7);

    return g;
  }

  // ── ROBOT HANGAR ──────────────────────────────────────────

  function createRobotHangar(side) {
    var g = new THREE.Group();
    var bc = bodyColor(side);
    var ac = sideAccent(side);
    var tc = sideTint(side);

    // Main hangar body — wide box
    addMesh(g, box(34, 16, 26), mat(bc), 0, 8, 0);
    // Roof ridge
    addMesh(g, box(30, 3, 20), mat(ac), 0, 17.5, 0);
    // Sliding door suggestion — front face
    addMesh(g, box(14, 12, 1), mat(ac), 0, 7, 13.5);
    // Door track lines
    addMesh(g, box(16, 0.5, 0.5), matBasic(tc), 0, 13.5, 13.8);
    addMesh(g, box(16, 0.5, 0.5), matBasic(tc), 0, 1.5, 13.8);
    // Interior glow through door gap
    addMesh(g, box(1, 12, 0.5), matBasic(tc, { transparent: true, opacity: 0.6 }), 7.5, 7, 14);
    // Side rivets / panels
    for (var p = -12; p <= 12; p += 8) {
      addMesh(g, box(1, 14, 1), mat(ac), 17.5, 8, p);
      addMesh(g, box(1, 14, 1), mat(ac), -17.5, 8, p);
    }
    // Ventilation on top
    addMesh(g, box(6, 4, 6), mat(ac), 10, 20, 0);
    addMesh(g, cyl(2, 2, 3, 6), mat(bc), 10, 23, 0);

    return g;
  }

  // ── SHIELD GENERATOR ──────────────────────────────────────

  function createShieldGenerator(side) {
    var g = new THREE.Group();
    var bc = bodyColor(side);
    var ac = sideAccent(side);
    var tc = sideTint(side);

    // Base
    addMesh(g, box(16, 4, 16), mat(bc), 0, 2, 0);
    // Dome — stacked flattened cylinders
    addMesh(g, cyl(8, 9, 4, 10), mat(ac), 0, 6, 0);
    addMesh(g, cyl(7, 8, 3, 10), mat(ac), 0, 9.5, 0);
    addMesh(g, cyl(5.5, 7, 3, 10), mat(ac), 0, 12.5, 0);
    addMesh(g, cyl(3.5, 5.5, 3, 10), mat(ac), 0, 15.5, 0);
    addMesh(g, cyl(1.5, 3.5, 2, 10), mat(ac), 0, 18, 0);
    // Glowing core
    var core = addMesh(g, cyl(2, 2, 8, 8), matBasic(C.SHIELD, { transparent: true, opacity: 0.6 }), 0, 10, 0);
    core.userData.isShieldCore = true;
    // Emitter ring at top
    addMesh(g, cyl(4, 4, 1, 10), matBasic(tc), 0, 19.5, 0);
    // Pulse ring (animated)
    var pulse = addMesh(g, cyl(10, 10, 0.5, 16), matBasic(C.SHIELD, { transparent: true, opacity: 0.25, side: THREE.DoubleSide }), 0, 12, 0);
    pulse.userData.isPulse = true;

    animatedParts.push({ mesh: pulse, animType: 'pulse', speed: 2.0 });
    animatedParts.push({ mesh: core, animType: 'glow', speed: 3.0, baseOpacity: 0.6 });

    return g;
  }

  // ── COMMAND CENTER ────────────────────────────────────────

  function createCommandCenter(side) {
    var g = new THREE.Group();
    var bc = bodyColor(side);
    var ac = sideAccent(side);
    var tc = sideTint(side);

    // Ground floor — widest tier
    addMesh(g, box(28, 10, 24), mat(bc), 0, 5, 0);
    // Second tier
    addMesh(g, box(22, 8, 18), mat(ac), 0, 14, 0);
    // Third tier (command deck)
    addMesh(g, box(16, 6, 14), mat(bc), 0, 21, 0);
    // Antenna mast
    addMesh(g, cyl(1, 1, 14, 6), mat(tc), 0, 31, 0);
    // Antenna cross-bar
    addMesh(g, box(8, 0.8, 0.8), mat(tc), 0, 36, 0);
    addMesh(g, box(0.8, 0.8, 8), mat(tc), 0, 34, 0);
    // Antenna tip
    addMesh(g, cyl(0.5, 0.5, 3, 4), matBasic(tc), 0, 39.5, 0);
    // Window band on command deck
    addMesh(g, box(17, 2, 0.5), matBasic(tc, { transparent: true, opacity: 0.7 }), 0, 22, 7.3);
    addMesh(g, box(17, 2, 0.5), matBasic(tc, { transparent: true, opacity: 0.7 }), 0, 22, -7.3);
    // Reinforced corners
    for (var cx = -1; cx <= 1; cx += 2) {
      for (var cz = -1; cz <= 1; cz += 2) {
        addMesh(g, box(3, 10, 3), mat(ac), cx * 13, 5, cz * 11);
      }
    }
    // Base detail — steps
    addMesh(g, box(32, 2, 28), mat(ac), 0, 0.5, 0);
    // Side comm dishes
    addMesh(g, cyl(3, 3, 0.5, 8), mat(tc), 12, 18, 9);
    addMesh(g, cyl(3, 3, 0.5, 8), mat(tc), -12, 18, 9);

    return g;
  }

  // ── SUPPLY DEPOT ──────────────────────────────────────────

  function createSupplyDepot(side) {
    var g = new THREE.Group();
    var bc = bodyColor(side);
    var ac = sideAccent(side);
    var tc = sideTint(side);

    // Main warehouse body
    addMesh(g, box(22, 10, 18), mat(bc), 0, 5, 0);
    // Slanted roof (two tilted boxes)
    var roofL = addMesh(g, box(12, 1.5, 18), mat(ac), -5, 11.5, 0);
    roofL.rotation.z = 0.35;
    var roofR = addMesh(g, box(12, 1.5, 18), mat(ac), 5, 11.5, 0);
    roofR.rotation.z = -0.35;
    // Ridge line
    addMesh(g, box(0.8, 0.8, 18), mat(tc), 0, 13, 0);
    // Loading bay door (front)
    addMesh(g, box(10, 7, 1), mat(ac), 0, 4, 9.2);
    addMesh(g, box(10, 0.5, 0.3), matBasic(tc), 0, 7.8, 9.5);
    // Crates stacked on side
    addMesh(g, box(4, 4, 4), mat(ac), -13, 2, 6);
    addMesh(g, box(4, 4, 4), mat(ac), -13, 2, 0);
    addMesh(g, box(4, 4, 4), mat(ac), -13, 6, 3);
    // Supply marker (bright box)
    addMesh(g, box(3, 0.5, 3), matBasic(tc), 0, 13.8, 0);
    // Side panels
    for (var p = -6; p <= 6; p += 4) {
      addMesh(g, box(0.5, 6, 0.5), mat(ac), 11.2, 5, p);
      addMesh(g, box(0.5, 6, 0.5), mat(ac), -11.2, 5, p);
    }
    return g;
  }

  // ── GUN POD (anti-robot turret) ───────────────────────────

  function createGunPod(side) {
    var g = new THREE.Group();
    var bc = bodyColor(side);
    var ac = sideAccent(side);
    var tc = sideTint(side);

    // Base pad
    addMesh(g, box(16, 3, 16), mat(bc), 0, 1.5, 0);
    // Reinforcement ring
    addMesh(g, cyl(8, 8.5, 1.5, 10), mat(ac), 0, 3.5, 0);
    // Rotating turret group
    var turret = new THREE.Group();
    turret.position.set(0, 5, 0);
    // Turret body
    addMesh(turret, box(8, 4, 10), mat(ac), 0, 2, 0);
    // Turret dome
    addMesh(turret, cyl(3, 4, 2, 10), mat(bc), 0, 5, -1);
    // Barrel (long horizontal cylinder)
    var barrel = addMesh(turret, cyl(0.8, 0.8, 12, 8), mat(tc), 0, 3, 6);
    barrel.rotation.x = Math.PI / 2;
    // Barrel tip
    addMesh(turret, cyl(1.2, 1.2, 1, 8), mat(tc), 0, 3, 11.5);
    // Ammo box side
    addMesh(turret, box(2, 3, 4), mat(ac), 4.5, 2.5, -1);
    // Sensor eye
    addMesh(turret, box(1.5, 1.5, 1.5), matBasic(tc), 0, 6, 1);
    g.add(turret);
    g.userData.turret = turret;

    // Track rotation (slowly sweeps looking for targets)
    animatedParts.push({ mesh: turret, animType: 'rotate', speed: 0.4, axis: 'y' });

    return g;
  }

  // ── Builder dispatch ──────────────────────────────────────

  var builders = {};
  builders[B.POWER_PLANT]      = createPowerPlant;
  builders[B.RADAR_STATION]    = createRadarStation;
  builders[B.MISSILE_SILO]     = createMissileSilo;
  builders[B.ANTI_MISSILE]     = createAntiMissile;
  builders[B.ROBOT_HANGAR]     = createRobotHangar;
  builders[B.SHIELD_GENERATOR] = createShieldGenerator;
  builders[B.COMMAND_CENTER]   = createCommandCenter;
  builders[B.SUPPLY_DEPOT]     = createSupplyDepot;
  builders[B.GUN_POD]          = createGunPod;

  // ── PUBLIC: createBuildingMesh ─────────────────────────────

  function createBuildingMesh(buildingType, side) {
    var builder = builders[buildingType];
    if (!builder) {
      console.warn('Buildings: unknown type', buildingType);
      var fallback = new THREE.Group();
      addMesh(fallback, box(10, 10, 10), mat(0xFF00FF), 0, 5, 0);
      fallback.userData.type = buildingType;
      return fallback;
    }
    var group = builder(side);
    group.userData.type = buildingType;
    group.userData.side = side;
    group.userData.hpPercent = 1.0;
    return group;
  }

  // ── PUBLIC: updateBuildingDamage ───────────────────────────

  function updateBuildingDamage(mesh, hpPercent) {
    if (!mesh) return;
    mesh.userData.hpPercent = hpPercent;

    mesh.traverse(function (child) {
      if (!child.isMesh) return;

      if (hpPercent > 0.75) {
        // Normal state
        child.position.x = child.userData.origX || child.position.x;
        child.position.y = child.userData.origY || child.position.y;
        child.position.z = child.userData.origZ || child.position.z;
        if (child.material && child.userData.origColor !== undefined) {
          child.material.color.setHex(child.userData.origColor);
        }
      } else {
        // Store originals on first damage
        if (child.userData.origX === undefined) {
          child.userData.origX = child.position.x;
          child.userData.origY = child.position.y;
          child.userData.origZ = child.position.z;
          if (child.material) {
            child.userData.origColor = child.material.color.getHex();
          }
        }

        if (hpPercent > 0.5) {
          // Slight damage — color shift toward darker
          if (child.material && !child.userData.isGlow && !child.userData.isShieldCore) {
            var c = new THREE.Color(child.userData.origColor);
            c.multiplyScalar(0.8);
            child.material.color.copy(c);
          }
        } else if (hpPercent > 0.25) {
          // Moderate damage — darker + slight geometry offset
          if (child.material && !child.userData.isGlow && !child.userData.isShieldCore) {
            var c2 = new THREE.Color(child.userData.origColor);
            c2.multiplyScalar(0.55);
            child.material.color.copy(c2);
          }
          child.position.x = child.userData.origX + (Math.random() - 0.5) * 0.8;
          child.position.z = child.userData.origZ + (Math.random() - 0.5) * 0.8;
        } else {
          // Heavy damage — very dark, significant displacement
          if (child.material && !child.userData.isGlow && !child.userData.isShieldCore) {
            var c3 = new THREE.Color(child.userData.origColor);
            c3.multiplyScalar(0.3);
            child.material.color.copy(c3);
          }
          child.position.x = child.userData.origX + (Math.random() - 0.5) * 2.0;
          child.position.y = child.userData.origY - Math.random() * 1.5;
          child.position.z = child.userData.origZ + (Math.random() - 0.5) * 2.0;
        }
      }
    });
  }

  // ── PUBLIC: getBuildingSize ────────────────────────────────

  function getBuildingSize(type) {
    return SIZES[type] || { width: 20, height: 20, depth: 20 };
  }

  // ── PUBLIC: animateBuildings ──────────────────────────────

  var animTime = 0;

  function animateBuildings(dt) {
    animTime += dt;

    for (var i = animatedParts.length - 1; i >= 0; i--) {
      var part = animatedParts[i];
      // Clean up removed meshes
      if (!part.mesh.parent) {
        animatedParts.splice(i, 1);
        continue;
      }

      switch (part.animType) {
        case 'rotate':
          part.mesh.rotation[part.axis || 'y'] += part.speed * dt;
          break;

        case 'smoke':
          part.mesh.children.forEach(function (child) {
            if (child.userData.smokeIndex !== undefined) {
              child.userData.smokeTime += dt * part.speed;
              var t = child.userData.smokeTime % 3.0;
              child.position.y = t * 6;
              child.position.x = Math.sin(t * 2 + child.userData.smokeIndex) * 2;
              child.scale.setScalar(1 + t * 0.5);
              if (child.material) {
                child.material.opacity = Math.max(0, 0.5 - t * 0.18);
              }
            }
          });
          break;

        case 'pulse':
          var pScale = 1.0 + Math.sin(animTime * part.speed) * 0.3;
          part.mesh.scale.set(pScale, 1, pScale);
          if (part.mesh.material) {
            part.mesh.material.opacity = 0.15 + Math.sin(animTime * part.speed) * 0.1;
          }
          break;

        case 'glow':
          if (part.mesh.material) {
            part.mesh.material.opacity = part.baseOpacity + Math.sin(animTime * part.speed) * 0.2;
          }
          break;
      }
    }
  }

  // ── PUBLIC: createDestructionEffect ───────────────────────

  function createDestructionEffect(position) {
    var group = new THREE.Group();
    group.position.copy(position);
    group.userData.lifetime = 0;
    group.userData.maxLifetime = 2.0;
    group.userData.isEffect = true;

    var particleCount = 24;
    for (var i = 0; i < particleCount; i++) {
      var size = 1.5 + Math.random() * 3;
      var isFlame = Math.random() > 0.4;
      var pColor = isFlame ? C.EXPLOSION : C.AMBER_DARK;
      var p = new THREE.Mesh(
        box(size, size, size),
        matBasic(pColor, { transparent: true, opacity: 1.0 })
      );
      // Random outward velocity stored in userData
      var angle = Math.random() * Math.PI * 2;
      var upVel = 8 + Math.random() * 20;
      var outVel = 4 + Math.random() * 14;
      p.userData.vx = Math.cos(angle) * outVel;
      p.userData.vy = upVel;
      p.userData.vz = Math.sin(angle) * outVel;
      p.userData.rotSpeed = (Math.random() - 0.5) * 10;
      p.position.set(
        (Math.random() - 0.5) * 8,
        Math.random() * 6,
        (Math.random() - 0.5) * 8
      );
      group.add(p);
    }

    // Shockwave ring
    var ring = new THREE.Mesh(
      cyl(1, 1, 1, 16),
      matBasic(C.EXPLOSION, { transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    ring.userData.isShockwave = true;
    ring.scale.set(1, 0.2, 1);
    group.add(ring);

    // Attach update function
    group.userData.update = function (dt) {
      group.userData.lifetime += dt;
      var t = group.userData.lifetime;
      var frac = t / group.userData.maxLifetime;

      group.children.forEach(function (child) {
        if (child.userData.isShockwave) {
          var rScale = 2 + frac * 30;
          child.scale.set(rScale, 0.2, rScale);
          if (child.material) {
            child.material.opacity = Math.max(0, 0.8 - frac * 1.2);
          }
          return;
        }
        // Particle physics
        child.position.x += child.userData.vx * dt;
        child.position.y += child.userData.vy * dt;
        child.position.z += child.userData.vz * dt;
        child.userData.vy -= 30 * dt; // gravity
        child.rotation.x += child.userData.rotSpeed * dt;
        child.rotation.z += child.userData.rotSpeed * dt * 0.7;
        // Fade out
        if (child.material) {
          child.material.opacity = Math.max(0, 1.0 - frac);
        }
        // Shrink
        var s = Math.max(0.1, 1.0 - frac * 0.6);
        child.scale.setScalar(s);
      });

      return frac < 1.0; // return false when done
    };

    return group;
  }

  // ── Export to window ──────────────────────────────────────

  window.Buildings = {
    createBuildingMesh: createBuildingMesh,
    updateBuildingDamage: updateBuildingDamage,
    getBuildingSize: getBuildingSize,
    animateBuildings: animateBuildings,
    createDestructionEffect: createDestructionEffect
  };

})();
