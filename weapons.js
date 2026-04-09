// ============================================================
// Robot Strategy Attack 2026 — Weapons System
// ============================================================

(function () {
  'use strict';

  // ── Missile Trajectory ──

  /**
   * Creates a ballistic arc trajectory from startPos to endPos.
   * Returns array of {x, y, z} points along a parabola.
   */
  function createMissileTrajectory(startPos, endPos, steps) {
    steps = steps || 60;
    const points = [];
    const dx = endPos.x - startPos.x;
    const dy = endPos.y - startPos.y;
    const dz = (endPos.z || 0) - (startPos.z || 0);
    // Arc height scales with horizontal distance
    const arcHeight = Math.abs(dx) * 0.6 + 120;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Parabolic arc: rises then falls
      const arcY = 4 * arcHeight * t * (1 - t);
      points.push({
        x: startPos.x + dx * t,
        y: (startPos.y || 0) + dy * t + arcY,
        z: (startPos.z || 0) + dz * t
      });
    }
    return points;
  }

  /**
   * Returns missile flight animation duration in ms.
   */
  function getMissileAnimDuration() {
    return 1800;
  }

  // ── Fire Missile ──

  /**
   * Creates a missile fire action. Validates silo exists and is active.
   * @returns action object or null if invalid
   */
  function fireMissile(state, fromSegment, targetSegment) {
    const seg = state.segments[fromSegment];
    if (!seg || !seg.building) return null;
    if (seg.building.type !== CONST.BUILDING.MISSILE_SILO) return null;
    if (!seg.building.active) return null;

    const side = seg.building.side;

    return createAction(CONST.ACTION.FIRE_MISSILE, side, {
      fromSegment: fromSegment,
      targetSegment: targetSegment,
      intercepted: false,
      shieldBlocked: false
    });
  }

  // ── Valid Missile Targets ──

  /**
   * Returns array of valid target segment indices for a given side
   * (targeting enemy segments that are revealed, or all if no fog).
   */
  function getValidMissileTargets(state, side) {
    const enemySide = side === CONST.SIDE_PLAYER ? CONST.SIDE_AI : CONST.SIDE_PLAYER;
    const targets = [];

    for (let i = 0; i < state.segments.length; i++) {
      const seg = state.segments[i];
      if (seg.side !== enemySide) continue;
      if (seg.destroyed) continue;

      if (side === CONST.SIDE_PLAYER) {
        if (state.revealedEnemySegments.length > 0) {
          if (state.revealedEnemySegments.indexOf(i) === -1) continue;
        }
      }
      targets.push(i);
    }
    return targets;
  }

  // ── Anti-Missile Interception ──

  /**
   * Anti-missile batteries on defenseSide auto-fire at incoming missiles.
   * Each battery gets ANTI_MISSILE_SHOTS_PER_TURN intercepts.
   * Mutates battery interceptsRemaining. Returns array of intercepted missile actions.
   */
  function resolveInterceptions(state, incomingMissiles, defenseSide) {
    const batteries = getBuildingsOfType(state, defenseSide, CONST.BUILDING.ANTI_MISSILE);
    const intercepted = [];

    // Gather total available intercept shots
    let shotsAvailable = [];
    for (let b = 0; b < batteries.length; b++) {
      const battery = batteries[b];
      if (!battery.active) continue;
      for (let s = 0; s < battery.interceptsRemaining; s++) {
        shotsAvailable.push(battery);
      }
    }

    // Assign shots to incoming missiles (first come first served)
    for (let m = 0; m < incomingMissiles.length; m++) {
      if (shotsAvailable.length === 0) break;
      const missile = incomingMissiles[m];
      if (missile.intercepted) continue;

      // Use one shot
      const battery = shotsAvailable.shift();
      battery.interceptsRemaining--;
      missile.intercepted = true;
      intercepted.push(missile);
    }

    return intercepted;
  }

  // ── Shield Check ──

  /**
   * Check if a segment is protected by an adjacent shield generator.
   * If so, the shield absorbs the hit and the shield generator deactivates.
   * Returns true if shielded (hit absorbed).
   */
  function checkShieldAbsorb(state, segmentIndex) {
    // Check all 8 neighbors + self for active shield generator
    const candidates = [segmentIndex].concat(getAdjacentCells(segmentIndex));
    for (let d = 0; d < candidates.length; d++) {
      const adjSeg = state.segments[candidates[d]];
      if (!adjSeg) continue;
      if (
        adjSeg.building &&
        adjSeg.building.type === CONST.BUILDING.SHIELD_GENERATOR &&
        adjSeg.building.active &&
        adjSeg.building.shieldActive
      ) {
        adjSeg.building.shieldActive = false;
        return true;
      }
    }
    return false;
  }

  // ── Apply Damage to Segment ──

  function applyDamage(state, segmentIndex, damage, combatLog) {
    const seg = state.segments[segmentIndex];
    if (!seg || seg.destroyed) return;
    if (!seg.building) return;

    seg.building.hp -= damage;
    combatLog.push({
      event: 'damage',
      segment: segmentIndex,
      damage: damage,
      remainingHp: seg.building.hp,
      buildingType: seg.building.type
    });

    if (seg.building.hp <= 0) {
      combatLog.push({
        event: 'destroyed',
        segment: segmentIndex,
        buildingType: seg.building.type
      });
      seg.building.active = false;
      seg.building.hp = 0;
      seg.destroyed = true;
      seg.building = null;

      // Check for command center destruction → game over
        // Check if a command center was destroyed
      if (seg.building === null) {
        // already nulled — we need to check what was there
      }
      if (segmentIndex === CONST.COMMAND_CENTER_SEGMENT_PLAYER) {
        state.winner = CONST.SIDE_AI;
      } else if (segmentIndex === CONST.COMMAND_CENTER_SEGMENT_AI) {
        state.winner = CONST.SIDE_PLAYER;
      }
    }
  }

  // ── Resolve All Missiles ──

  /**
   * Processes all missile actions for a combat phase.
   * 1. Check anti-missile interceptions on target side
   * 2. Shield generators absorb hits on adjacent segments
   * 3. Apply damage: direct hit + AOE to adjacent segments
   * 4. Mark cratered segments
   * 5. Call onAnimate for visual effects
   */
  function resolveMissiles(state, actions, onAnimate) {
    // Filter to missile actions only
    const missileActions = actions.filter(function (a) {
      return a.type === CONST.ACTION.FIRE_MISSILE && !a.resolved;
    });

    if (missileActions.length === 0) return;

    // Group by target side for interception (2D: check cell's side)
    const playerIncoming = missileActions.filter(function (a) {
      return state.segments[a.targetSegment] && state.segments[a.targetSegment].side === CONST.SIDE_PLAYER;
    });
    const aiIncoming = missileActions.filter(function (a) {
      return state.segments[a.targetSegment] && state.segments[a.targetSegment].side === CONST.SIDE_AI;
    });

    // Step 1: Anti-missile interceptions
    var playerIntercepted = resolveInterceptions(state, playerIncoming, CONST.SIDE_PLAYER);
    var aiIntercepted = resolveInterceptions(state, aiIncoming, CONST.SIDE_AI);

    // Animate interceptions
    if (onAnimate) {
      playerIntercepted.forEach(function (m) {
        onAnimate({ type: 'intercept', missile: m });
      });
      aiIntercepted.forEach(function (m) {
        onAnimate({ type: 'intercept', missile: m });
      });
    }

    // Log interceptions
    playerIntercepted.concat(aiIntercepted).forEach(function (m) {
      state.combatLog.push({
        event: 'intercepted',
        fromSegment: m.fromSegment,
        targetSegment: m.targetSegment
      });
      m.resolved = true;
    });

    // Step 2-4: Process non-intercepted missiles
    for (var i = 0; i < missileActions.length; i++) {
      var missile = missileActions[i];
      if (missile.resolved) continue; // already intercepted

      var target = missile.targetSegment;

      // Animate missile flight
      if (onAnimate) {
        onAnimate({
          type: 'missile_flight',
          fromSegment: missile.fromSegment,
          targetSegment: target,
          trajectory: createMissileTrajectory(
            { x: missile.fromSegment * CONST.SEGMENT_WIDTH, y: 0, z: 0 },
            { x: target * CONST.SEGMENT_WIDTH, y: 0, z: 0 }
          ),
          duration: getMissileAnimDuration()
        });
      }

      // Check shield on direct target
      var shielded = checkShieldAbsorb(state, target);
      if (shielded) {
        missile.shieldBlocked = true;
        state.combatLog.push({
          event: 'shield_absorb',
          segment: target
        });
        if (onAnimate) {
          onAnimate({ type: 'shield_absorb', segment: target });
        }
        missile.resolved = true;
        continue;
      }

      // Direct hit damage
      applyDamage(state, target, CONST.MISSILE_DAMAGE, state.combatLog);

      if (onAnimate) {
        onAnimate({ type: 'explosion', segment: target, damage: CONST.MISSILE_DAMAGE });
      }

      // AOE: 2D adjacent cells get half damage
      var aoeCells = getAdjacentCells(target);
      for (var aoeI = 0; aoeI < aoeCells.length; aoeI++) {
        var adjIdx = aoeCells[aoeI];
        var adjSeg = state.segments[adjIdx];
        if (!adjSeg || adjSeg.destroyed || !adjSeg.building) continue;

        // Check shield on adjacent
        var adjShielded = checkShieldAbsorb(state, adjIdx);
        if (adjShielded) {
          state.combatLog.push({
            event: 'shield_absorb',
            segment: adjIdx
          });
          if (onAnimate) {
            onAnimate({ type: 'shield_absorb', segment: adjIdx });
          }
          continue;
        }

        applyDamage(state, adjIdx, CONST.MISSILE_AOE_HALF_DAMAGE, state.combatLog);

        if (onAnimate) {
          onAnimate({ type: 'aoe_damage', segment: adjIdx, damage: CONST.MISSILE_AOE_HALF_DAMAGE });
        }
      }

      missile.resolved = true;
    }
  }

  // ── Reset Anti-Missile Batteries at turn start ──

  function resetAntiMissileBatteries(state) {
    for (var i = 0; i < state.segments.length; i++) {
      var b = state.segments[i].building;
      if (b && b.type === CONST.BUILDING.ANTI_MISSILE && b.active) {
        b.interceptsRemaining = CONST.ANTI_MISSILE_SHOTS_PER_TURN;
      }
    }
  }

  // ── Reset Shield Generators at turn start ──

  function resetShieldGenerators(state) {
    for (var i = 0; i < state.segments.length; i++) {
      var b = state.segments[i].building;
      if (b && b.type === CONST.BUILDING.SHIELD_GENERATOR && b.active) {
        b.shieldActive = true;
      }
    }
  }

  // ── Expose on window ──

  window.Weapons = {
    fireMissile: fireMissile,
    resolveMissiles: resolveMissiles,
    createMissileTrajectory: createMissileTrajectory,
    getMissileAnimDuration: getMissileAnimDuration,
    resolveInterceptions: resolveInterceptions,
    getValidMissileTargets: getValidMissileTargets,
    checkShieldAbsorb: checkShieldAbsorb,
    applyDamage: applyDamage,
    resetAntiMissileBatteries: resetAntiMissileBatteries,
    resetShieldGenerators: resetShieldGenerators
  };

})();
