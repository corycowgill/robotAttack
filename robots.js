// ============================================================
// Robot Strategy Attack 2026 — Robot System
// ============================================================

(function () {
  'use strict';

  // ── Robot Deployment ──

  /**
   * Creates a robot deployment action from a Robot Hangar.
   * Validates hangar exists, is active, and hasn't deployed this turn.
   * @returns action object or null if invalid
   */
  function deployRobot(state, hangarSegment, targetSegment) {
    var seg = state.segments[hangarSegment];
    if (!seg || !seg.building) return null;
    if (seg.building.type !== CONST.BUILDING.ROBOT_HANGAR) return null;
    if (!seg.building.active) return null;
    if (seg.building.deployedThisTurn) return null;

    var side = seg.building.side;

    // Energy check
    var energyField = side === CONST.SIDE_PLAYER ? 'playerEnergy' : 'aiEnergy';
    if (state[energyField] < CONST.ENERGY_DEPLOY_ROBOT) return null;
    state[energyField] -= CONST.ENERGY_DEPLOY_ROBOT;

    // Mark hangar as deployed
    seg.building.deployedThisTurn = true;

    return createAction(CONST.ACTION.DEPLOY_ROBOT, side, {
      hangarSegment: hangarSegment,
      targetSegment: targetSegment,
      intercepted: false,
      robot: createRobot(side, hangarSegment, targetSegment)
    });
  }

  // ── Robot Landing Trajectory ──

  /**
   * Returns trajectory points for robot delivery missile arc.
   * Similar to missile trajectory but slightly lower arc.
   */
  function createRobotLandingAnim(startPos, endPos, steps) {
    steps = steps || 50;
    var points = [];
    var dx = endPos.x - startPos.x;
    var dy = (endPos.y || 0) - (startPos.y || 0);
    var dz = (endPos.z || 0) - (startPos.z || 0);
    var arcHeight = Math.abs(dx) * 0.45 + 80;

    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var arcY = 4 * arcHeight * t * (1 - t);
      points.push({
        x: startPos.x + dx * t,
        y: (startPos.y || 0) + dy * t + arcY,
        z: (startPos.z || 0) + dz * t
      });
    }
    return points;
  }

  // ── Robot Attack Animation ──

  /**
   * Moves robot toward target. Returns true when in melee range.
   * Modifies robot.x, robot.y in place.
   */
  function animateRobotAttack(robot, targetPos, dt) {
    var speed = 80; // units per second
    var dx = targetPos.x - robot.x;
    var dz = (targetPos.z || 0) - (robot.z || 0);
    var dist = Math.sqrt(dx * dx + dz * dz);
    var meleeRange = 15;

    if (dist <= meleeRange) {
      // In range — do punch animation: bob the mesh up/down
      if (robot._mesh) {
        // Arm swing for punch effect
        var arms = robot._mesh.getObjectByName('armRight');
        if (arms) {
          var punchCycle = (Date.now() % 400) / 400;
          arms.rotation.x = Math.sin(punchCycle * Math.PI * 2) * 0.8;
        }
      }
      return true;
    }

    // Walk toward target
    var step = speed * (dt / 1000);
    if (step > dist) step = dist;
    var nx = dx / dist;
    var nz = dz / dist;
    robot.x += nx * step;
    if (robot.z !== undefined) robot.z += nz * step;

    // Bob walk animation on mesh
    if (robot._mesh) {
      var walkCycle = (Date.now() % 600) / 600;
      robot._mesh.position.y += Math.sin(walkCycle * Math.PI * 2) * 0.3;

      var leftLeg = robot._mesh.getObjectByName('legLeft');
      var rightLeg = robot._mesh.getObjectByName('legRight');
      if (leftLeg && rightLeg) {
        var legSwing = Math.sin(walkCycle * Math.PI * 2) * 0.4;
        leftLeg.rotation.x = legSwing;
        rightLeg.rotation.x = -legSwing;
      }
    }

    return false;
  }

  // ── Robot Death Explosion ──

  /**
   * Creates explosion particle data at position.
   * Returns a Three.js Group with small box particles that should be animated.
   */
  function createRobotDeathEffect(position) {
    var group = new THREE.Group();
    group.position.set(position.x || 0, position.y || 0, position.z || 0);

    var particleCount = 12;
    for (var i = 0; i < particleCount; i++) {
      var size = 1 + Math.random() * 2;
      var geo = new THREE.BoxGeometry(size, size, size);
      var mat = new THREE.MeshBasicMaterial({
        color: Math.random() > 0.5 ? CONST.COLORS.EXPLOSION : CONST.COLORS.AMBER,
        transparent: true,
        opacity: 1.0
      });
      var particle = new THREE.Mesh(geo, mat);

      // Random velocity stored as userData
      var angle = Math.random() * Math.PI * 2;
      var upVel = 20 + Math.random() * 40;
      var outVel = 10 + Math.random() * 30;
      particle.userData.velocity = {
        x: Math.cos(angle) * outVel,
        y: upVel,
        z: Math.sin(angle) * outVel
      };
      particle.userData.life = 1.0;
      particle.userData.decay = 0.8 + Math.random() * 0.6; // per second

      group.add(particle);
    }

    // Attach update function
    group.userData.update = function (dt) {
      var dtSec = dt / 1000;
      var allDead = true;
      for (var c = 0; c < group.children.length; c++) {
        var p = group.children[c];
        if (p.userData.life <= 0) continue;
        allDead = false;

        p.position.x += p.userData.velocity.x * dtSec;
        p.position.y += p.userData.velocity.y * dtSec;
        p.position.z += p.userData.velocity.z * dtSec;
        p.userData.velocity.y -= 60 * dtSec; // gravity

        p.userData.life -= p.userData.decay * dtSec;
        if (p.userData.life < 0) p.userData.life = 0;
        p.material.opacity = p.userData.life;
        var s = 0.5 + p.userData.life * 0.5;
        p.scale.set(s, s, s);
      }
      return !allDead; // returns false when effect is done
    };

    return group;
  }

  // ── Create Robot Mesh ──

  /**
   * Returns a Three.js Group: chunky bipedal mech built from BoxGeometry.
   * Player = amber, AI = red. Approximately 20 units tall.
   */
  function createRobotMesh(side) {
    var color = side === CONST.SIDE_PLAYER ? CONST.COLORS.PLAYER : CONST.COLORS.AI_ENEMY;
    var darkColor = side === CONST.SIDE_PLAYER ? CONST.COLORS.AMBER_DARK : 0x991100;

    var robot = new THREE.Group();

    // Body (torso) — 6 x 8 x 4
    var bodyGeo = new THREE.BoxGeometry(6, 8, 4);
    var bodyMat = new THREE.MeshBasicMaterial({ color: color });
    var body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0, 12, 0);
    body.name = 'body';
    robot.add(body);

    // Head — 4 x 3 x 3
    var headGeo = new THREE.BoxGeometry(4, 3, 3);
    var headMat = new THREE.MeshBasicMaterial({ color: color });
    var head = new THREE.Mesh(headGeo, headMat);
    head.position.set(0, 17.5, 0);
    head.name = 'head';
    robot.add(head);

    // Visor (eye slit) — 3 x 0.8 x 0.5
    var visorGeo = new THREE.BoxGeometry(3, 0.8, 0.5);
    var visorMat = new THREE.MeshBasicMaterial({
      color: side === CONST.SIDE_PLAYER ? 0xFFFFAA : 0xFF8888
    });
    var visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 17.8, 1.5);
    visor.name = 'visor';
    robot.add(visor);

    // Left arm — 2 x 7 x 2
    var armGeo = new THREE.BoxGeometry(2, 7, 2);
    var armMat = new THREE.MeshBasicMaterial({ color: darkColor });

    var armLeft = new THREE.Mesh(armGeo, armMat);
    armLeft.position.set(-5, 12, 0);
    armLeft.name = 'armLeft';
    robot.add(armLeft);

    // Right arm
    var armRight = new THREE.Mesh(armGeo.clone(), armMat.clone());
    armRight.position.set(5, 12, 0);
    armRight.name = 'armRight';
    robot.add(armRight);

    // Left leg — 2.5 x 6 x 2.5
    var legGeo = new THREE.BoxGeometry(2.5, 6, 2.5);
    var legMat = new THREE.MeshBasicMaterial({ color: darkColor });

    var legLeft = new THREE.Mesh(legGeo, legMat);
    legLeft.position.set(-2, 5, 0);
    legLeft.name = 'legLeft';
    robot.add(legLeft);

    // Right leg
    var legRight = new THREE.Mesh(legGeo.clone(), legMat.clone());
    legRight.position.set(2, 5, 0);
    legRight.name = 'legRight';
    robot.add(legRight);

    // Feet — 3 x 1.5 x 3.5
    var footGeo = new THREE.BoxGeometry(3, 1.5, 3.5);
    var footMat = new THREE.MeshBasicMaterial({ color: color });

    var footLeft = new THREE.Mesh(footGeo, footMat);
    footLeft.position.set(-2, 1.5, 0.5);
    footLeft.name = 'footLeft';
    robot.add(footLeft);

    var footRight = new THREE.Mesh(footGeo.clone(), footMat.clone());
    footRight.position.set(2, 1.5, 0.5);
    footRight.name = 'footRight';
    robot.add(footRight);

    // Shoulder plates — 3 x 2 x 3
    var shoulderGeo = new THREE.BoxGeometry(3, 2, 3);
    var shoulderMat = new THREE.MeshBasicMaterial({ color: color });

    var shoulderL = new THREE.Mesh(shoulderGeo, shoulderMat);
    shoulderL.position.set(-5, 16, 0);
    shoulderL.name = 'shoulderLeft';
    robot.add(shoulderL);

    var shoulderR = new THREE.Mesh(shoulderGeo.clone(), shoulderMat.clone());
    shoulderR.position.set(5, 16, 0);
    shoulderR.name = 'shoulderRight';
    robot.add(shoulderR);

    return robot;
  }

  // ── Find Nearest Enemy Building ──

  function findNearestEnemyBuilding(state, segmentIndex, robotSide) {
    var enemySide = robotSide === CONST.SIDE_PLAYER ? CONST.SIDE_AI : CONST.SIDE_PLAYER;
    var nearest = -1;
    var nearestDist = Infinity;

    for (var i = 0; i < state.segments.length; i++) {
      var seg = state.segments[i];
      if (seg.side !== enemySide) continue;
      if (seg.destroyed || !seg.building || !seg.building.active) continue;
      var dist = cellDistance(i, segmentIndex);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    }
    return nearest;
  }

  // ── Resolve Robot Deployments ──

  /**
   * Processes robot deployments:
   * 1. Robot launches as delivery missile from hangar
   * 2. Can be intercepted by anti-missile batteries
   * 3. If not intercepted: lands at target segment and PERSISTS
   *    (attacks happen via resolveRobotCombat each turn)
   */
  function resolveRobotDeployments(state, actions, onAnimate) {
    var robotActions = actions.filter(function (a) {
      return a.type === CONST.ACTION.DEPLOY_ROBOT && !a.resolved;
    });

    if (robotActions.length === 0) return;

    // Group by target side for interception (2D)
    var playerIncoming = robotActions.filter(function (a) {
      return state.segments[a.targetSegment] && state.segments[a.targetSegment].side === CONST.SIDE_PLAYER;
    });
    var aiIncoming = robotActions.filter(function (a) {
      return state.segments[a.targetSegment] && state.segments[a.targetSegment].side === CONST.SIDE_AI;
    });

    // Step 1: Anti-missile interception (robots travel as delivery missiles)
    if (window.Weapons && window.Weapons.resolveInterceptions) {
      window.Weapons.resolveInterceptions(state, playerIncoming, CONST.SIDE_PLAYER);
      window.Weapons.resolveInterceptions(state, aiIncoming, CONST.SIDE_AI);
    }

    // Animate interceptions
    var interceptedRobots = robotActions.filter(function (a) { return a.intercepted; });
    interceptedRobots.forEach(function (ra) {
      state.combatLog.push({
        event: 'robot_intercepted',
        hangarSegment: ra.hangarSegment,
        targetSegment: ra.targetSegment,
        side: ra.side
      });
      if (onAnimate) {
        onAnimate({ type: 'robot_intercepted', action: ra });
      }
      ra.resolved = true;
    });

    // Step 2-4: Process non-intercepted robots
    for (var i = 0; i < robotActions.length; i++) {
      var ra = robotActions[i];
      if (ra.resolved) continue;

      // Lazily create robot if action came from AI (which doesn't pre-populate it)
      if (!ra.robot) {
        ra.robot = createRobot(ra.side, ra.hangarSegment, ra.targetSegment);
      }
      var robot = ra.robot;
      var target = ra.targetSegment;

      // Set robot cell position to target
      var targetXY = indexToXY(target);
      var hangarXY = indexToXY(ra.hangarSegment);
      robot.x = targetXY.x * CONST.CELL_SIZE + CONST.CELL_SIZE / 2;
      robot.y = 0;
      robot.z = targetXY.y * CONST.CELL_SIZE + CONST.CELL_SIZE / 2;
      robot.currentSegment = target;
      robot.state = 'landing';
      robot.landed = true;

      // Animate delivery arc (orchestrator recalculates with real world positions)
      if (onAnimate) {
        onAnimate({
          type: 'robot_launch',
          action: ra,
          trajectory: createRobotLandingAnim(
            { x: hangarXY.x * CONST.CELL_SIZE, y: 0, z: hangarXY.y * CONST.CELL_SIZE },
            { x: targetXY.x * CONST.CELL_SIZE, y: 0, z: targetXY.y * CONST.CELL_SIZE }
          )
        });
      }

      state.combatLog.push({
        event: 'robot_landed',
        segment: target,
        side: ra.side
      });

      // Robot lands and becomes persistent
      robot.state = 'idle';
      robot.attackTarget = findNearestEnemyBuilding(state, target, ra.side);

      if (onAnimate) {
        onAnimate({ type: 'robot_landed', robot: robot, segment: target });
      }

      // Add to active robots — survives until killed
      state.activeRobots.push(robot);

      ra.resolved = true;
    }
  }

  // ── Resolve Robot Combat (per-turn) ──
  /**
   * Resolves combat for all active robots and gun pods:
   * (a) Gun pods auto-fire at enemy robots in range
   * (b) Robot-vs-robot melee in adjacent cells
   * (c) Alive robots attack adjacent enemy buildings
   */
  function resolveRobotCombat(state, onAnimate) {
    if (!state.activeRobots) state.activeRobots = [];

    // (a) Gun pods fire at enemy robots
    for (var s = 0; s < state.segments.length; s++) {
      var seg = state.segments[s];
      if (!seg.building || !seg.building.active) continue;
      if (seg.building.type !== CONST.BUILDING.GUN_POD) continue;
      var gunSide = seg.building.side;
      // Find enemy robots in range
      var bestTarget = null;
      var bestDist = Infinity;
      for (var r = 0; r < state.activeRobots.length; r++) {
        var rob = state.activeRobots[r];
        if (rob.side === gunSide) continue;
        if (rob.hp <= 0 || rob.state === 'destroyed') continue;
        var d = cellDistance(s, rob.currentSegment);
        if (d <= CONST.GUN_POD_RANGE && d < bestDist) {
          bestDist = d;
          bestTarget = rob;
        }
      }
      if (bestTarget) {
        bestTarget.hp -= CONST.GUN_POD_DAMAGE;
        state.combatLog.push({
          event: 'gun_pod_fire',
          gunSegment: s,
          targetRobotId: bestTarget.id,
          damage: CONST.GUN_POD_DAMAGE,
          remainingHp: bestTarget.hp
        });
        if (onAnimate) {
          onAnimate({
            type: 'gun_pod_fire',
            gunSegment: s,
            targetRobot: bestTarget
          });
        }
        if (bestTarget.hp <= 0) {
          bestTarget.hp = 0;
          bestTarget.state = 'destroyed';
          state.combatLog.push({
            event: 'robot_destroyed',
            segment: bestTarget.currentSegment,
            side: bestTarget.side,
            source: 'gun_pod'
          });
          if (onAnimate) {
            onAnimate({
              type: 'robot_death',
              robot: bestTarget,
              position: { x: bestTarget.x, y: bestTarget.y, z: bestTarget.z }
            });
          }
        }
      }
    }

    // (b) Robot-vs-robot melee
    for (var i = 0; i < state.activeRobots.length; i++) {
      var a = state.activeRobots[i];
      if (a.state === 'destroyed' || a.hp <= 0) continue;
      for (var j = i + 1; j < state.activeRobots.length; j++) {
        var b = state.activeRobots[j];
        if (b.state === 'destroyed' || b.hp <= 0) continue;
        if (a.side === b.side) continue;
        var adj = cellDistance(a.currentSegment, b.currentSegment);
        if (adj <= Math.SQRT2 + 0.01) {
          // Mutual melee
          a.hp -= CONST.ROBOT_MELEE_DAMAGE;
          b.hp -= CONST.ROBOT_MELEE_DAMAGE;
          state.combatLog.push({ event: 'robot_melee', a: a.id, b: b.id });
          if (onAnimate) {
            onAnimate({ type: 'robot_vs_robot', a: a, b: b });
          }
          if (a.hp <= 0) { a.state = 'destroyed'; if (onAnimate) onAnimate({ type: 'robot_death', robot: a, position: { x: a.x, y: a.y, z: a.z } }); }
          if (b.hp <= 0) { b.state = 'destroyed'; if (onAnimate) onAnimate({ type: 'robot_death', robot: b, position: { x: b.x, y: b.y, z: b.z } }); }
        }
      }
    }

    // (c) Robots attack adjacent enemy buildings
    for (var rr = 0; rr < state.activeRobots.length; rr++) {
      var robot = state.activeRobots[rr];
      if (robot.state === 'destroyed' || robot.hp <= 0) continue;

      // Find adjacent enemy building (including own cell)
      var candidates = [robot.currentSegment].concat(getAdjacentCells(robot.currentSegment));
      var targetIdx = -1;
      var enemySide = robot.side === CONST.SIDE_PLAYER ? CONST.SIDE_AI : CONST.SIDE_PLAYER;
      for (var c = 0; c < candidates.length; c++) {
        var cseg = state.segments[candidates[c]];
        if (!cseg || !cseg.building || !cseg.building.active) continue;
        if (cseg.building.side !== enemySide) continue;
        targetIdx = candidates[c];
        break;
      }

      if (targetIdx < 0) {
        // No adjacent target — walk toward nearest enemy building
        var nearest = findNearestEnemyBuilding(state, robot.currentSegment, robot.side);
        if (nearest >= 0) {
          // Move one cell closer
          var rxy = indexToXY(robot.currentSegment);
          var txy = indexToXY(nearest);
          var stepX = Math.sign(txy.x - rxy.x);
          var stepY = Math.sign(txy.y - rxy.y);
          var newX = rxy.x + stepX;
          var newY = rxy.y + stepY;
          if (newX >= 0 && newX < CONST.GRID_W && newY >= 0 && newY < CONST.GRID_H) {
            var newIdx = xyToIndex(newX, newY);
            var nseg = state.segments[newIdx];
            // Don't walk onto our own buildings
            if (!nseg.building || nseg.building.side !== robot.side) {
              robot.currentSegment = newIdx;
              robot.x = newX * CONST.CELL_SIZE + CONST.CELL_SIZE / 2;
              robot.z = newY * CONST.CELL_SIZE + CONST.CELL_SIZE / 2;
              if (onAnimate) {
                onAnimate({ type: 'robot_move', robot: robot, segment: newIdx });
              }
            }
          }
        }
        continue;
      }

      // Attack the adjacent enemy building
      var shielded = false;
      if (window.Weapons && window.Weapons.checkShieldAbsorb) {
        shielded = window.Weapons.checkShieldAbsorb(state, targetIdx);
      }

      if (shielded) {
        state.combatLog.push({ event: 'shield_absorb', segment: targetIdx, source: 'robot' });
        if (onAnimate) onAnimate({ type: 'shield_absorb', segment: targetIdx });
      } else {
        if (window.Weapons && window.Weapons.applyDamage) {
          window.Weapons.applyDamage(state, targetIdx, CONST.ROBOT_MELEE_DAMAGE, state.combatLog);
        }
        if (onAnimate) {
          onAnimate({
            type: 'robot_melee_hit',
            robot: robot,
            targetSegment: targetIdx,
            damage: CONST.ROBOT_MELEE_DAMAGE
          });
        }
      }
    }

    // Remove destroyed robots
    state.activeRobots = state.activeRobots.filter(function (r) {
      return r.state !== 'destroyed' && r.hp > 0;
    });
  }

  // ── Reset Hangars at Turn Start ──

  function resetHangars(state) {
    for (var i = 0; i < state.segments.length; i++) {
      var b = state.segments[i].building;
      if (b && b.type === CONST.BUILDING.ROBOT_HANGAR && b.active) {
        b.deployedThisTurn = false;
      }
    }
  }

  // ── Clean Up Destroyed Robots (only destroyed, keep alive ones persistent) ──

  function cleanUpRobots(state) {
    state.activeRobots = (state.activeRobots || []).filter(function (r) {
      return r.state !== 'destroyed' && r.hp > 0;
    });
  }

  // ── Expose on window ──

  window.Robots = {
    deployRobot: deployRobot,
    resolveRobotDeployments: resolveRobotDeployments,
    resolveRobotCombat: resolveRobotCombat,
    createRobotMesh: createRobotMesh,
    createRobotLandingAnim: createRobotLandingAnim,
    animateRobotAttack: animateRobotAttack,
    createRobotDeathEffect: createRobotDeathEffect,
    findNearestEnemyBuilding: findNearestEnemyBuilding,
    resetHangars: resetHangars,
    cleanUpRobots: cleanUpRobots
  };

})();
