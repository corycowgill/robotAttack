// ============================================================
// Robot Attack 2026 — AI opponent
// ============================================================
// Plans the AI side's turn using exactly the same rule functions
// (and therefore the same restrictions) as the player.

(function (root) {
  'use strict';

  const C = (typeof CONST !== 'undefined') ? CONST : require('./config.js').CONST;
  const B = (typeof BUILDINGS !== 'undefined') ? BUILDINGS : require('./config.js').BUILDINGS;
  const R = (typeof Rules !== 'undefined') ? Rules : require('./rules.js');

  let ME = C.SIDE_AI, FOE = C.SIDE_PLAYER;
  const MID = (C.GRID_W - 1) / 2;
  function depth(cell) { return Math.abs(R.xy(cell).x - MID); } // distance from the front line

  const TARGET_SCORE = { hq: 10, silo: 8, aa: 6, hangar: 6, power: 5, depot: 5, shield: 4, radar: 3, gunpod: 2 };

  function count(state, type) { return R.buildingsOf(state, ME, type).length; }

  // ── Placement scoring ─────────────────────────────────────
  function candidateCells(state, type) {
    const out = [];
    for (let i = 0; i < R.N; i++) {
      if (!R.buildableReason(state, ME, type, i)) out.push(i);
    }
    return out;
  }

  function valueOf(b) { return b.type === 'hq' ? 4 : (b.type === 'silo' || b.type === 'hangar') ? 2 : 1; }

  function placementScore(state, type, cell) {
    const own = R.buildingsOf(state, ME);
    const hq = R.hqCell(ME);
    let score = R.rand(state) * 0.6;

    // Mild penalty for packing next to other buildings (missile splash), except shields
    if (type !== 'shield') {
      for (const n of R.neighbors(cell, 1)) if (R.buildingAt(state, n)) score -= 0.5;
    }
    // Being under AA cover is good for everything
    const aaCover = own.filter(b => b.type === 'aa' && R.dist(b.cell, cell) <= B.aa.range).length;

    switch (type) {
      case 'aa': {
        for (const b of own) {
          if (b.type === 'aa') continue;
          if (R.dist(b.cell, cell) <= B.aa.range) {
            const already = own.filter(a => a.type === 'aa' && R.dist(a.cell, b.cell) <= B.aa.range).length;
            score += valueOf(b) / (1 + already);
          }
        }
        break;
      }
      case 'shield': {
        for (const n of [cell].concat(R.neighbors(cell, 1))) {
          const b = R.buildingAt(state, n);
          if (b && b.side === ME) score += valueOf(b) * 1.5;
        }
        break;
      }
      case 'gunpod': {
        const enemies = R.robotsOf(state, FOE);
        if (enemies.length) {
          for (const r of enemies) if (R.dist(r.cell, cell) <= B.gunpod.range) score += 4;
        }
        // guard the HQ approach
        if (R.dist(cell, hq) <= B.gunpod.range) score += 2;
        score -= own.filter(b => b.type === 'gunpod' && R.dist(b.cell, cell) < 3).length * 1.5;
        break;
      }
      case 'radar':
        score -= depth(cell) * 0.25; // toward the front
        break;
      case 'depot': case 'power':
        score += depth(cell) * 0.15 + aaCover * 1.2; // toward the back, under cover
        break;
      default:
        score += aaCover * 1.0;
    }
    return score;
  }

  function tryBuild(state, type) {
    const cells = candidateCells(state, type);
    if (!cells.length) return false;
    let best = -1, bs = -Infinity;
    for (const c of cells) {
      const s = placementScore(state, type, c);
      if (s > bs) { bs = s; best = c; }
    }
    return R.build(state, ME, type, best).ok;
  }

  // ── Build planning ────────────────────────────────────────
  function enemyRobotsOnMySide(state) {
    return R.robotsOf(state, FOE).filter(r => R.ownerOfCell(r.cell) !== FOE);
  }

  function aaCoveringHQ(state) {
    const hq = R.hqCell(ME);
    return R.buildingsOf(state, ME, 'aa').filter(a => R.dist(a.cell, hq) <= B.aa.range).length;
  }

  function knownEnemy(state, type) {
    const seen = state.sides[ME].intel.seen;
    return Object.keys(seen).filter(k => seen[k].type === type).length;
  }

  function nextSmartBuild(state, mem) {
    const n = t => count(state, t);
    const opening = ['depot', 'power', 'silo', 'aa', 'silo', 'depot', 'radar'];
    const have = {};
    for (const t of opening) {
      have[t] = (have[t] || 0) + 1;
      if (n(t) < have[t]) return t;
    }
    const threats = enemyRobotsOnMySide(state);
    if (threats.length && n('gunpod') < Math.min(4, threats.length + 1)) return 'gunpod';
    if ((mem.missileDamageTaken > 0 || knownEnemy(state, 'silo') >= 2) && aaCoveringHQ(state) < 2 && n('aa') < 4) return 'aa';
    if (knownEnemy(state, 'hangar') && n('gunpod') < 1) return 'gunpod';
    // Keep energy income in line with what the launchers can spend
    const need = n('silo') * C.MISSILE_ENERGY + n('hangar') * C.DROP_ENERGY;
    const inc = R.income(state, ME).energy;
    if (inc < need * 0.8 && state.sides[ME].energy < need * 1.5) return 'power';
    if (n('depot') < 2 + Math.floor(state.turn / 6)) return 'depot';
    if (n('silo') < 3) return 'silo';
    if (n('hangar') < 1) return 'hangar';
    if (state.turn >= 6 && n('shield') < 1) return 'shield';
    if (n('silo') < 5 && n('silo') <= n('hangar') * 2 + 1) return 'silo';
    if (n('hangar') < 3) return 'hangar';
    if (n('aa') < 3) return 'aa';
    if (n('shield') < 2) return 'shield';
    if (n('gunpod') < 3) return 'gunpod';
    if (n('aa') < 5) return 'aa';
    return null;
  }

  const PATROL_ORDER = ['depot', 'power', 'silo', 'aa', 'gunpod', 'radar', 'depot', 'hangar', 'silo', 'power', 'aa'];
  function nextPatrolBuild(state) {
    const have = {};
    for (const t of PATROL_ORDER) {
      have[t] = (have[t] || 0) + 1;
      if (count(state, t) < have[t]) {
        // ±1 jitter: occasionally skip ahead
        return R.rand(state) < 0.2 ? PATROL_ORDER[Math.min(PATROL_ORDER.length - 1, PATROL_ORDER.indexOf(t) + 1)] : t;
      }
    }
    const pool = ['depot', 'power', 'silo', 'aa', 'gunpod', 'hangar', 'shield'];
    return pool[Math.floor(R.rand(state) * pool.length)];
  }

  function planBuilds(state, mem, smart) {
    for (let guard = 0; guard < 6; guard++) {
      const type = smart ? nextSmartBuild(state, mem) : nextPatrolBuild(state);
      if (!type) return;
      if (state.sides[ME].credits < B[type].cost) return; // save up for it
      if (!tryBuild(state, type)) return;
    }
  }

  // ── Repairs ───────────────────────────────────────────────
  function planRepairs(state, diff) {
    if (!diff.repairs) return;
    const s = state.sides[ME];
    const hq = R.buildingsOf(state, ME, 'hq')[0];
    if (hq && hq.hp < hq.maxHp * 0.6 && s.credits > 150) R.repair(state, ME, hq.cell);
    // Warlord: patch up buildings under detected incoming fire
    if (diff.fullVision) {
      for (const m of state.missiles.filter(m => m.side !== ME)) {
        const b = R.buildingAt(state, m.to);
        if (b && b.hp <= C.MISSILE_DAMAGE + 5 && s.credits > 120) R.repair(state, ME, b.cell);
      }
    }
  }

  // ── Offense ───────────────────────────────────────────────
  function knownTargets(state) {
    const seen = state.sides[ME].intel.seen;
    return Object.keys(seen).map(k => Object.assign({ cell: +k }, seen[k]));
  }

  function knownCover(state, targets, cell) {
    let cover = 0;
    for (const t of targets) {
      // expected interceptions, not guaranteed ones
      if (t.type === 'aa' && R.dist(t.cell, cell) <= B.aa.range) cover += B.aa.shots * B.aa.hitChance;
      if (t.type === 'hq' && R.dist(t.cell, cell) <= B.hq.range) cover += B.hq.hitChance;
    }
    return cover;
  }

  function randomEnemyCell(state) {
    for (let k = 0; k < 50; k++) {
      const span = C.PLAYER_MAX_X + 1;
      const x = FOE === C.SIDE_PLAYER ? Math.floor(R.rand(state) * span) : C.AI_MIN_X + Math.floor(R.rand(state) * span);
      const y = Math.floor(R.rand(state) * C.GRID_H);
      const c = R.idx(x, y);
      if (!state.sides[ME].intel.seen[c]) return c;
    }
    return R.hqCell(FOE);
  }

  function planMissiles(state, diff, smart, reserve) {
    const s = state.sides[ME];
    const silos = R.freeLaunchers(state, ME, 'silo');
    let shots = Math.min(silos.length, Math.floor((s.energy - reserve) / C.MISSILE_ENERGY));
    if (shots <= 0) return;
    const targets = knownTargets(state);
    const fire = to => { if (R.queueMissile(state, ME, to).ok) shots--; };

    if (!smart) {
      const silosLeft = shots;
      for (let i = 0; i < silosLeft; i++) {
        if (R.rand(state) > diff.fireChance) continue;
        const roll = R.rand(state);
        const others = targets.filter(t => t.type !== 'hq');
        if (roll < 0.5 || !others.length) fire(roll < 0.75 ? R.hqCell(FOE) : randomEnemyCell(state));
        else fire(others[Math.floor(R.rand(state) * others.length)].cell);
      }
      return;
    }

    // Smart: rank targets, saturate AA where possible
    const ranked = targets.map(t => {
      let score = TARGET_SCORE[t.type] || 1;
      if (t.type === 'hq' && t.hp < t.maxHp * 0.5) score += 4;
      if (t.type === 'aa' && R.dist(t.cell, R.hqCell(FOE)) <= B.aa.range) score += 1;
      const cover = knownCover(state, targets, t.cell);
      const need = t.type === 'hq' ? Infinity : Math.ceil(cover) + Math.max(1, Math.ceil(t.hp / C.MISSILE_DAMAGE));
      return { t, score: score - cover * 0.8, cover, need };
    }).sort((a, b) => b.score - a.score);

    for (const r of ranked) {
      if (shots <= 0) break;
      if (r.t.type === 'hq') {
        if (shots > r.cover) { while (shots > 0) fire(r.t.cell); }
        continue;
      }
      if (r.need <= shots) {
        for (let k = 0; k < r.need && shots > 0; k++) fire(r.t.cell);
      }
    }
    // Leftover: pressure the HQ (drains interceptors) or probe unknown territory
    while (shots > 0) {
      const before = shots;
      fire(R.rand(state) < 0.8 ? R.hqCell(FOE) : randomEnemyCell(state));
      if (shots === before) break;
    }
  }

  function planDrops(state, smart) {
    const s = state.sides[ME];
    const targets = knownTargets(state);
    const gunpods = targets.filter(t => t.type === 'gunpod');
    for (const hangar of R.freeLaunchers(state, ME, 'hangar')) {
      if (s.energy < C.DROP_ENERGY) return;
      let goal = R.hqCell(FOE);
      if (smart) {
        let best = null, bs = -Infinity;
        for (const t of targets) {
          const covered = gunpods.filter(g => R.dist(g.cell, t.cell) <= B.gunpod.range + 1).length;
          const sc = (TARGET_SCORE[t.type] || 1) - covered * 4 + R.rand(state);
          if (sc > bs) { bs = sc; best = t; }
        }
        if (best) goal = best.cell;
      } else if (targets.length && R.rand(state) < 0.5) {
        goal = targets[Math.floor(R.rand(state) * targets.length)].cell;
      }
      // Land on a free cell next to the goal
      const options = R.neighbors(goal, 1).filter(c => R.ownerOfCell(c) === FOE && !R.buildingAt(state, c) && !R.robotAt(state, c));
      const to = options.length ? options[Math.floor(R.rand(state) * options.length)] : goal;
      if (!R.queueDrop(state, ME, to).ok) return;
    }
  }

  // ── Entry point ───────────────────────────────────────────
  function planTurn(state, side) {
    ME = side || C.SIDE_AI;
    FOE = R.enemyOf(ME);
    const diff = C.DIFFICULTY[state.difficulty];
    const smart = diff.smart;
    const s = state.sides[ME];
    state.aiMem = state.aiMem || {};
    const mem = state.aiMem[ME] || (state.aiMem[ME] = { lastTaken: 0, missileDamageTaken: 0 });
    mem.missileDamageTaken = s.stats.damageTaken - mem.lastTaken;
    mem.lastTaken = s.stats.damageTaken;

    planRepairs(state, diff);

    // Alternate priority between drops and missiles so energy is shared
    const robotsFirst = state.turn % 2 === 0 && R.freeLaunchers(state, ME, 'hangar').length > 0;
    if (robotsFirst) {
      planDrops(state, smart);
      planMissiles(state, diff, smart, 0);
    } else {
      planMissiles(state, diff, smart, 0);
      planDrops(state, smart);
    }

    planBuilds(state, mem, smart);
  }

  const AI = { planTurn };
  root.AI = AI;
  if (typeof module !== 'undefined') module.exports = AI;
})(typeof window !== 'undefined' ? window : globalThis);
