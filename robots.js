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
   * 3. If not intercepted: lands at target segment
   * 4. On landing: auto-attacks nearest enemy building (melee)
   * 5. Robot is destroyed at end of turn
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

      var robot = ra.robot;
      var target = ra.targetSegment;

      // Set robot cell position to target
      var targetXY = indexToXY(target);
      var hangarXY = indexToXY(ra.hangarSegment);
      robot.x = targetXY.x * CONST.CELL_SIZE;
      robot.y = 0;
      robot.z = targetXY.y * CONST.CELL_SIZE;
      robot.state = 'landing';

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

      // Robot landed — find nearest enemy building and attack
      robot.state = 'attacking';
      var nearestEnemy = findNearestEnemyBuilding(state, target, ra.side);

      if (nearestEnemy >= 0) {
        robot.attackTarget = nearestEnemy;

        if (onAnimate) {
          onAnimate({
            type: 'robot_attack',
            robot: robot,
            targetSegment: nearestEnemy
          });
        }

        // Apply melee damage
        var enemySeg = state.segments[nearestEnemy];
        if (enemySeg.building && enemySeg.building.active) {
          // Check shield
          var shielded = false;
          if (window.Weapons && window.Weapons.checkShieldAbsorb) {
            shielded = window.Weapons.checkShieldAbsorb(state, nearestEnemy);
          }

          if (shielded) {
            state.combatLog.push({
              event: 'shield_absorb',
              segment: nearestEnemy,
              source: 'robot'
            });
            if (onAnimate) {
              onAnimate({ type: 'shield_absorb', segment: nearestEnemy });
            }
          } else {
            // Apply robot melee damage using Weapons.applyDamage if available
            if (window.Weapons && window.Weapons.applyDamage) {
              window.Weapons.applyDamage(state, nearestEnemy, CONST.ROBOT_MELEE_DAMAGE, state.combatLog);
            } else {
              // Inline damage application
              enemySeg.building.hp -= CONST.ROBOT_MELEE_DAMAGE;
              state.combatLog.push({
                event: 'damage',
                segment: nearestEnemy,
                damage: CONST.ROBOT_MELEE_DAMAGE,
                remainingHp: enemySeg.building.hp,
                buildingType: enemySeg.building.type,
                source: 'robot'
              });
              if (enemySeg.building.hp <= 0) {
                state.combatLog.push({
                  event: 'destroyed',
                  segment: nearestEnemy,
                  buildingType: enemySeg.building.type,
                  source: 'robot'
                });
                enemySeg.building.active = false;
                enemySeg.building.hp = 0;
                enemySeg.destroyed = true;
                enemySeg.building = null;

                if (nearestEnemy === CONST.COMMAND_CENTER_SEGMENT_PLAYER) {
                  state.winner = CONST.SIDE_AI;
                } else if (nearestEnemy === CONST.COMMAND_CENTER_SEGMENT_AI) {
                  state.winner = CONST.SIDE_PLAYER;
                }
              }
            }

            if (onAnimate) {
              onAnimate({
                type: 'robot_melee_hit',
                robot: robot,
                targetSegment: nearestEnemy,
                damage: CONST.ROBOT_MELEE_DAMAGE
              });
            }
          }
        }
      }

      // Step 5: Robot is destroyed at end of turn
      robot.state = 'destroyed';

      if (onAnimate) {
        onAnimate({
          type: 'robot_death',
          robot: robot,
          position: { x: robot.x, y: robot.y, z: 0 }
        });
      }

      state.combatLog.push({
        event: 'robot_destroyed',
        segment: target,
        side: ra.side
      });

      // Add to active robots briefly (for rendering), then clean up
      state.activeRobots.push(robot);

      ra.resolved = true;
    }
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

  // ── Clean Up Destroyed Robots ──

  function cleanUpRobots(state) {
    state.activeRobots = state.activeRobots.filter(function (r) {
      return r.state !== 'destroyed';
    });
  }

  // ── Expose on window ──

  window.Robots = {
    deployRobot: deployRobot,
    resolveRobotDeployments: resolveRobotDeployments,
    createRobotMesh: createRobotMesh,
    createRobotLandingAnim: createRobotLandingAnim,
    animateRobotAttack: animateRobotAttack,
    createRobotDeathEffect: createRobotDeathEffect,
    findNearestEnemyBuilding: findNearestEnemyBuilding,
    resetHangars: resetHangars,
    cleanUpRobots: cleanUpRobots
  };

})();
