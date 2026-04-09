// ============================================================
// Robot Strategy Attack 2026 — AI Agent
// ============================================================
// Two difficulty modes: Patrol (random) and Commander (strategic)

window.AI = (function() {

  // ── Helper: get all buildings of a type for a side ──
  function getBuildings(state, side, type) {
    return getBuildingsOfType(state, side, type);
  }

  // ── Helper: count active buildings ──
  function countBuildings(state, side, type) {
    return getBuildings(state, side, type).length;
  }

  // ── Helper: find empty AI segments ──
  function getEmptyAISegments(state) {
    return getEmptySegments(state, CONST.SIDE_AI);
  }

  // ── Helper: pick random element ──
  function pickRandom(arr) {
    if (!arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ── Helper: pick random enemy segment (for targeting) ──
  function pickRandomEnemySegment(state) {
    const playerSegs = getPlayerSegments(state).filter(s => !s.destroyed);
    return pickRandom(playerSegs);
  }

  // ── Energy spending plan ──
  function createSpendingPlan(budget, items) {
    // items = [{type, cost, priority, segment?}]
    // Sort by priority descending, greedily pick what fits
    items.sort((a, b) => b.priority - a.priority);
    const plan = [];
    let remaining = budget;
    for (const item of items) {
      if (item.cost <= remaining) {
        plan.push(item);
        remaining -= item.cost;
      }
    }
    return plan;
  }

  // ═══════════════════════════════════════════════════
  // PATROL MODE — Random/defensive AI
  // ═══════════════════════════════════════════════════
  function planPatrol(state) {
    const actions = [];
    let energy = state.aiEnergy;
    const emptySegs = getEmptyAISegments(state);
    const silos = getBuildings(state, CONST.SIDE_AI, CONST.BUILDING.MISSILE_SILO);
    const hangars = getBuildings(state, CONST.SIDE_AI, CONST.BUILDING.ROBOT_HANGAR);

    // Phase 1: Fire existing weapons randomly
    for (const silo of silos) {
      const target = pickRandomEnemySegment(state);
      if (target) {
        actions.push(createAction(CONST.ACTION.FIRE_MISSILE, CONST.SIDE_AI, {
          fromSegment: silo.segmentIndex,
          targetSegment: target.index
        }));
      }
    }

    // Deploy robots from hangars randomly
    for (const hangar of hangars) {
      if (!hangar.deployedThisTurn) {
        const target = pickRandomEnemySegment(state);
        if (target) {
          actions.push(createAction(CONST.ACTION.DEPLOY_ROBOT, CONST.SIDE_AI, {
            hangarSegment: hangar.segmentIndex,
            targetSegment: target.index
          }));
        }
      }
    }

    // Phase 2: Build stuff randomly
    const buildOptions = [];

    if (emptySegs.length > 0) {
      // Always want power if income is low
      if (countBuildings(state, CONST.SIDE_AI, CONST.BUILDING.POWER_PLANT) < 3) {
        buildOptions.push({
          type: CONST.BUILDING.POWER_PLANT,
          cost: CONST.COST.POWER_PLANT,
          priority: 5 + Math.random() * 3
        });
      }

      // Random building selection
      const allTypes = [
        { type: CONST.BUILDING.MISSILE_SILO, cost: CONST.COST.MISSILE_SILO, priority: 3 + Math.random() * 4 },
        { type: CONST.BUILDING.ANTI_MISSILE, cost: CONST.COST.ANTI_MISSILE, priority: 2 + Math.random() * 3 },
        { type: CONST.BUILDING.ROBOT_HANGAR, cost: CONST.COST.ROBOT_HANGAR, priority: 2 + Math.random() * 3 },
        { type: CONST.BUILDING.SHIELD_GENERATOR, cost: CONST.COST.SHIELD_GENERATOR, priority: 1 + Math.random() * 3 },
        { type: CONST.BUILDING.RADAR_STATION, cost: CONST.COST.RADAR_STATION, priority: 1 + Math.random() * 2 }
      ];

      buildOptions.push(...allTypes);
    }

    const plan = createSpendingPlan(energy, buildOptions);

    for (const item of plan) {
      const seg = pickRandom(emptySegs);
      if (seg) {
        actions.push(createAction(CONST.ACTION.BUILD, CONST.SIDE_AI, {
          buildingType: item.type,
          segmentIndex: seg.index
        }));
        // Remove segment from available
        const idx = emptySegs.indexOf(seg);
        if (idx > -1) emptySegs.splice(idx, 1);
        energy -= item.cost;
      }
    }

    return actions;
  }

  // ═══════════════════════════════════════════════════
  // COMMANDER MODE — Strategic/aggressive AI
  // ═══════════════════════════════════════════════════
  function planCommander(state) {
    const actions = [];
    let energy = state.aiEnergy;
    const emptySegs = getEmptyAISegments(state);
    const silos = getBuildings(state, CONST.SIDE_AI, CONST.BUILDING.MISSILE_SILO);
    const hangars = getBuildings(state, CONST.SIDE_AI, CONST.BUILDING.ROBOT_HANGAR);
    const turn = state.turn;

    // ── Intelligence: prioritize targets ──
    function findBestTarget() {
      const revealed = state.revealedEnemySegments || [];
      const playerSegs = getPlayerSegments(state);

      // Priority 1: Known power plants (cripple economy)
      for (const idx of revealed) {
        const seg = state.segments[idx];
        if (seg && seg.building && seg.building.type === CONST.BUILDING.POWER_PLANT && seg.building.active) {
          return seg;
        }
      }

      // Priority 2: Known missile silos (reduce threat)
      for (const idx of revealed) {
        const seg = state.segments[idx];
        if (seg && seg.building && seg.building.type === CONST.BUILDING.MISSILE_SILO && seg.building.active) {
          return seg;
        }
      }

      // Priority 3: Known robot hangars
      for (const idx of revealed) {
        const seg = state.segments[idx];
        if (seg && seg.building && seg.building.type === CONST.BUILDING.ROBOT_HANGAR && seg.building.active) {
          return seg;
        }
      }

      // Priority 4: Command Center (if revealed and late game)
      if (turn >= 5) {
        const ccSeg = state.segments[CONST.COMMAND_CENTER_SEGMENT_PLAYER];
        if (ccSeg && ccSeg.building && ccSeg.building.active) {
          return ccSeg;
        }
      }

      // Fallback: any revealed building
      for (const idx of revealed) {
        const seg = state.segments[idx];
        if (seg && seg.building && seg.building.active) return seg;
      }

      // Last resort: random
      return pickRandomEnemySegment(state);
    }

    // ── Phase 1: Attack with existing weapons ──
    // Concentrate fire on high-value targets
    const primaryTarget = findBestTarget();

    for (const silo of silos) {
      // Commander focuses fire — 70% chance to hit primary target, 30% secondary
      let target;
      if (primaryTarget && Math.random() < 0.7) {
        target = primaryTarget;
      } else {
        target = pickRandomEnemySegment(state);
      }
      if (target) {
        actions.push(createAction(CONST.ACTION.FIRE_MISSILE, CONST.SIDE_AI, {
          fromSegment: silo.segmentIndex,
          targetSegment: target.index
        }));
      }
    }

    // Deploy robots toward command center or key buildings
    for (const hangar of hangars) {
      if (!hangar.deployedThisTurn) {
        // Robots target command center in late game
        let target;
        if (turn >= 4 && Math.random() < 0.6) {
          target = state.segments[CONST.COMMAND_CENTER_SEGMENT_PLAYER];
        } else {
          target = primaryTarget || pickRandomEnemySegment(state);
        }
        if (target) {
          actions.push(createAction(CONST.ACTION.DEPLOY_ROBOT, CONST.SIDE_AI, {
            hangarSegment: hangar.segmentIndex,
            targetSegment: target.index
          }));
        }
      }
    }

    // ── Phase 2: Strategic building ──
    const buildItems = [];
    const numPower = countBuildings(state, CONST.SIDE_AI, CONST.BUILDING.POWER_PLANT);
    const numSilos = countBuildings(state, CONST.SIDE_AI, CONST.BUILDING.MISSILE_SILO);
    const numAM = countBuildings(state, CONST.SIDE_AI, CONST.BUILDING.ANTI_MISSILE);
    const numHangars = countBuildings(state, CONST.SIDE_AI, CONST.BUILDING.ROBOT_HANGAR);
    const numShields = countBuildings(state, CONST.SIDE_AI, CONST.BUILDING.SHIELD_GENERATOR);
    const numRadar = countBuildings(state, CONST.SIDE_AI, CONST.BUILDING.RADAR_STATION);

    // Early game (turns 1-3): economy focus
    if (turn <= 3) {
      if (numPower < 2) buildItems.push({ type: CONST.BUILDING.POWER_PLANT, cost: CONST.COST.POWER_PLANT, priority: 10 });
      if (numRadar < 1) buildItems.push({ type: CONST.BUILDING.RADAR_STATION, cost: CONST.COST.RADAR_STATION, priority: 8 });
      if (numSilos < 1) buildItems.push({ type: CONST.BUILDING.MISSILE_SILO, cost: CONST.COST.MISSILE_SILO, priority: 7 });
      if (numAM < 1) buildItems.push({ type: CONST.BUILDING.ANTI_MISSILE, cost: CONST.COST.ANTI_MISSILE, priority: 6 });
    }
    // Mid game (turns 4-7): military buildup
    else if (turn <= 7) {
      if (numPower < 3) buildItems.push({ type: CONST.BUILDING.POWER_PLANT, cost: CONST.COST.POWER_PLANT, priority: 8 });
      if (numSilos < 3) buildItems.push({ type: CONST.BUILDING.MISSILE_SILO, cost: CONST.COST.MISSILE_SILO, priority: 9 });
      if (numHangars < 2) buildItems.push({ type: CONST.BUILDING.ROBOT_HANGAR, cost: CONST.COST.ROBOT_HANGAR, priority: 7 });
      if (numAM < 2) buildItems.push({ type: CONST.BUILDING.ANTI_MISSILE, cost: CONST.COST.ANTI_MISSILE, priority: 6 });
      if (numShields < 1) buildItems.push({ type: CONST.BUILDING.SHIELD_GENERATOR, cost: CONST.COST.SHIELD_GENERATOR, priority: 5 });
    }
    // Late game (turn 8+): full aggression
    else {
      if (numSilos < 4) buildItems.push({ type: CONST.BUILDING.MISSILE_SILO, cost: CONST.COST.MISSILE_SILO, priority: 10 });
      if (numHangars < 3) buildItems.push({ type: CONST.BUILDING.ROBOT_HANGAR, cost: CONST.COST.ROBOT_HANGAR, priority: 9 });
      if (numPower < 4) buildItems.push({ type: CONST.BUILDING.POWER_PLANT, cost: CONST.COST.POWER_PLANT, priority: 7 });
      if (numAM < 2) buildItems.push({ type: CONST.BUILDING.ANTI_MISSILE, cost: CONST.COST.ANTI_MISSILE, priority: 6 });
      if (numShields < 2) buildItems.push({ type: CONST.BUILDING.SHIELD_GENERATOR, cost: CONST.COST.SHIELD_GENERATOR, priority: 5 });
    }

    const plan = createSpendingPlan(energy, buildItems);

    for (const item of plan) {
      // Commander places buildings strategically
      let seg;
      if (item.type === CONST.BUILDING.SHIELD_GENERATOR) {
        // Place shields near command center
        seg = emptySegs.find(s => Math.abs(s.index - CONST.COMMAND_CENTER_SEGMENT_AI) <= 2) || pickRandom(emptySegs);
      } else if (item.type === CONST.BUILDING.ANTI_MISSILE) {
        // Place anti-missile near front line
        seg = emptySegs.find(s => s.index <= CONST.SEGMENTS_PER_SIDE + 3) || pickRandom(emptySegs);
      } else {
        seg = pickRandom(emptySegs);
      }

      if (seg) {
        actions.push(createAction(CONST.ACTION.BUILD, CONST.SIDE_AI, {
          buildingType: item.type,
          segmentIndex: seg.index
        }));
        const idx = emptySegs.indexOf(seg);
        if (idx > -1) emptySegs.splice(idx, 1);
        energy -= item.cost;
      }
    }

    return actions;
  }

  // ═══════════════════════════════════════════════════
  // RADAR REVEAL — Process radar stations
  // ═══════════════════════════════════════════════════
  function processRadar(state, side) {
    const radars = getBuildings(state, side, CONST.BUILDING.RADAR_STATION);
    const revealed = new Set(state.revealedEnemySegments || []);

    const enemySide = side === CONST.SIDE_PLAYER ? CONST.SIDE_AI : CONST.SIDE_PLAYER;
    const unrevealed = [];

    for (let i = 0; i < state.segments.length; i++) {
      const seg = state.segments[i];
      if (seg.side !== enemySide) continue;
      if (!revealed.has(i) && !seg.destroyed) {
        unrevealed.push(i);
      }
    }

    for (const radar of radars) {
      for (let r = 0; r < CONST.RADAR_REVEAL_COUNT; r++) {
        if (unrevealed.length === 0) break;
        const idx = Math.floor(Math.random() * unrevealed.length);
        revealed.add(unrevealed[idx]);
        unrevealed.splice(idx, 1);
      }
    }

    if (side === CONST.SIDE_PLAYER) {
      state.revealedEnemySegments = Array.from(revealed);
    }
    // AI always sees everything (no fog for AI)
  }

  // ═══════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════
  return {
    /**
     * Generate AI actions for the current turn
     */
    planTurn(state) {
      if (state.aiMode === CONST.AI_MODE_COMMANDER) {
        return planCommander(state);
      }
      return planPatrol(state);
    },

    /**
     * Process radar reveals for a side
     */
    processRadar,

    /**
     * Get AI difficulty description
     */
    getModeDescription(mode) {
      if (mode === CONST.AI_MODE_COMMANDER) {
        return 'COMMANDER — Strategic targeting, economy disruption, escalating aggression';
      }
      return 'PATROL — Random attacks, basic building, unpredictable but less efficient';
    }
  };
})();
