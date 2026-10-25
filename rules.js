// ============================================================
// Robot Attack 2026 — Rules engine
// ============================================================
// Pure game logic: state factory, validation, planning actions and
// deterministic turn resolution. No DOM, no Three.js, no timers.
// resolveTurn() mutates the state and returns an ordered list of
// events which the presentation layer plays back.

(function (root) {
  'use strict';

  const C = (typeof CONST !== 'undefined') ? CONST : require('./config.js').CONST;
  const B = (typeof BUILDINGS !== 'undefined') ? BUILDINGS : require('./config.js').BUILDINGS;
  const UP = (typeof UPGRADES !== 'undefined') ? UPGRADES : require('./config.js').UPGRADES;
  const UP_COST = (typeof UPGRADE_COST !== 'undefined') ? UPGRADE_COST : require('./config.js').UPGRADE_COST;
  const UP_HP = (typeof UPGRADE_HP !== 'undefined') ? UPGRADE_HP : require('./config.js').UPGRADE_HP;

  // A structure's stat, honouring its upgrade level
  function stat(b, key) {
    const u = b.level > 1 && UP[b.type];
    return u && u[key] !== undefined ? u[key] : B[b.type][key];
  }
  function upgradeCost(type) { return UP[type] ? Math.round(B[type].cost * UP_COST / 10) * 10 : 0; }

  const W = C.GRID_W, H = C.GRID_H, N = W * H;
  const P = C.SIDE_PLAYER, A = C.SIDE_AI;

  // Beats: groups of events that play back together
  const BEAT = { DESCEND: 0, IMPACT: 1, GUNFIRE: 2, ROBOTS: 3, DROPS: 4, LAUNCH: 5, END: 6 };

  // ── Geometry helpers ─────────────────────────────────────
  function idx(x, y) { return y * W + x; }
  function xy(i) { return { x: i % W, y: Math.floor(i / W) }; }
  function inBounds(x, y) { return x >= 0 && x < W && y >= 0 && y < H; }
  function cheb(a, b) {
    const p = xy(a), q = xy(b);
    return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));
  }
  function dist(a, b) {
    const p = xy(a), q = xy(b);
    return Math.hypot(p.x - q.x, p.y - q.y);
  }
  function neighbors(i, r) {
    r = r || 1;
    const p = xy(i), out = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (!dx && !dy) continue;
        if (inBounds(p.x + dx, p.y + dy)) out.push(idx(p.x + dx, p.y + dy));
      }
    }
    return out;
  }
  function cellsInRadius(i, r) {
    const p = xy(i), out = [];
    const rc = Math.ceil(r);
    for (let dy = -rc; dy <= rc; dy++) {
      for (let dx = -rc; dx <= rc; dx++) {
        if (dx * dx + dy * dy > r * r + 0.01) continue;
        if (inBounds(p.x + dx, p.y + dy)) out.push(idx(p.x + dx, p.y + dy));
      }
    }
    return out;
  }
  function ownerOfCell(i) {
    const x = i % W;
    if (x <= C.PLAYER_MAX_X) return P;
    if (x >= C.AI_MIN_X) return A;
    return null;
  }
  function enemyOf(side) { return side === P ? A : P; }
  function hqCell(side) {
    const h = side === P ? C.HQ_PLAYER : C.HQ_AI;
    return idx(h.x, h.y);
  }

  // ── Seeded RNG (mulberry32) for AI decisions only ────────
  function rand(state) {
    let t = (state.rng = (state.rng + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ── State factory ────────────────────────────────────────
  function newStats() {
    return {
      damageDealt: 0, damageTaken: 0, built: 0, destroyed: 0, lost: 0,
      missilesFired: 0, missilesHit: 0, intercepts: 0, strikes: 0, missileDamageTaken: 0,
      robotsDeployed: 0, robotsLost: 0, robotsKilled: 0
    };
  }

  function newSide(side) {
    return {
      side,
      credits: C.START_CREDITS,
      energy: C.START_ENERGY,
      orders: [],
      undo: [],
      stats: newStats(),
      intel: { seen: {}, reveal: [] }
    };
  }

  // ── Island maps ──────────────────────────────────────────
  // Each side gets one irregular island around its HQ; the channel between
  // them (and anything not on an island) is open sea.
  function makeRng(seed) {
    let s = seed >>> 0;
    return () => {
      let t = (s = (s + 0x6D2B79F5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateIslands(seed, landTarget) {
    const rnd = makeRng(seed);
    const LW = 12, LH = 8, lattice = [];
    for (let i = 0; i < LW * LH; i++) lattice.push(rnd());
    const noise = (x, y) => {
      const fx = x / W * (LW - 1), fy = y / H * (LH - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const g = (i, j) => lattice[Math.min(LH - 1, j) * LW + Math.min(LW - 1, i)];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return (g(x0, y0) * (1 - sx) + g(x0 + 1, y0) * sx) * (1 - sy) + (g(x0, y0 + 1) * (1 - sx) + g(x0 + 1, y0 + 1) * sx) * sy;
    };
    const land = new Array(N).fill(0);
    for (const side of [P, A]) {
      const hq = xy(hqCell(side));
      const cx = hq.x + (side === P ? 4.5 : -4.5), cy = H / 2 - 0.5 + (rnd() - 0.5) * 2;
      const cols = [];
      for (let i = 0; i < N; i++) if (ownerOfCell(i) === side) cols.push(i);
      const shape = off => {
        const m = new Set();
        for (const i of cols) {
          const p = xy(i);
          const dx = (p.x - cx) / 7.5, dy = (p.y - cy) / 8.5;
          const v = 1 - Math.hypot(dx, dy) + (noise(p.x, p.y) - 0.5) * 0.9 + off;
          if (v > 0 || cheb(i, hqCell(side)) <= 2) m.add(i);
        }
        // keep the part connected to the HQ (4-connected), then fill enclosed lakes
        const keep = new Set([hqCell(side)]), q = [hqCell(side)];
        while (q.length) {
          const c = q.shift(), p = xy(c);
          for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (!inBounds(p.x + ddx, p.y + ddy)) continue;
            const n = idx(p.x + ddx, p.y + ddy);
            if (m.has(n) && !keep.has(n)) { keep.add(n); q.push(n); }
          }
        }
        return keep;
      };
      // binary-search the threshold for an area close to the target...
      let lo = -0.6, hi = 0.8, best = shape(0);
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) / 2, s = shape(mid);
        if (Math.abs(s.size - landTarget) < Math.abs(best.size - landTarget)) best = s;
        if (s.size < landTarget) lo = mid; else hi = mid;
      }
      fillLakes(best, cols);
      // ...then grow or erode the coastline one cell at a time to hit it exactly
      const hqc = hqCell(side);
      const n4 = c => { const p = xy(c), out = []; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inBounds(p.x + dx, p.y + dy)) out.push(idx(p.x + dx, p.y + dy)); return out; };
      const colSet = new Set(cols);
      const score = c => { const p = xy(c); return noise(p.x, p.y) - Math.hypot((p.x - cx) / 7.5, (p.y - cy) / 8.5); };
      for (let guard = 0; guard < 400 && best.size !== landTarget; guard++) {
        if (best.size < landTarget) {
          let pick = -1, ps = -Infinity;
          for (const c of best) for (const n of n4(c)) if (colSet.has(n) && !best.has(n) && score(n) > ps) { ps = score(n); pick = n; }
          if (pick < 0) break;
          best.add(pick);
        } else {
          // erode the weakest coastline cell that keeps the island in one piece
          const coast = [...best].filter(c => cheb(c, hqc) > 2 && n4(c).filter(n => best.has(n)).length <= 2)
            .sort((a, b) => score(a) - score(b));
          let pick = -1;
          for (const c of coast) {
            best.delete(c);
            if (connected(best, hqc)) { pick = c; break; }
            best.add(c);
          }
          if (pick < 0) break;
        }
      }
      best.forEach(i => { land[i] = 1; });
    }
    return land;
  }

  // every cell reachable from the HQ (4-connected)?
  function connected(set, start) {
    const seen = new Set([start]), q = [start];
    while (q.length) {
      const c = q.pop(), p = xy(c);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!inBounds(p.x + dx, p.y + dy)) continue;
        const n = idx(p.x + dx, p.y + dy);
        if (set.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
      }
    }
    return seen.size === set.size;
  }

  // water pockets fully enclosed by the island become land
  function fillLakes(set, cols) {
    const colSet = new Set(cols), seen = new Set();
    for (const c of cols) {
      if (set.has(c) || seen.has(c)) continue;
      const comp = [c], q = [c];
      seen.add(c);
      let open = false;
      while (q.length) {
        const k = q.pop(), p = xy(k);
        if (p.x === 0 || p.y === 0 || p.x === W - 1 || p.y === H - 1) open = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!inBounds(p.x + dx, p.y + dy)) continue;
          const n = idx(p.x + dx, p.y + dy);
          if (!colSet.has(n)) { open = true; continue; }   // touches the strait
          if (set.has(n) || seen.has(n)) continue;
          seen.add(n); comp.push(n); q.push(n);
        }
      }
      if (!open) comp.forEach(k => set.add(k));
    }
  }

  function isLand(state, cell) { return !!(state.land && state.land[cell]); }

  // nearest free land cell of a side (for scripted starting structures)
  function nearestFreeLand(state, side, cell) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      if (ownerOfCell(i) !== side || !state.land[i] || state.cells[i].building) continue;
      const d = dist(i, cell);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // opts: { mapSeed, landTarget, start: { player: [{type,dx,dy}], ai: [...] }, credits: { player, ai } }
  function newGame(difficulty, seed, opts) {
    opts = opts || {};
    const state = {
      turn: 1,
      difficulty: C.DIFFICULTY[difficulty] ? difficulty : 'commander',
      winner: null,           // 'player' | 'ai' | 'draw'
      endReason: '',
      nextId: 1,
      rng: (seed >>> 0) || ((Math.random() * 4294967296) >>> 0),
      cells: [],
      robots: [],
      missiles: [],           // in flight, launched last turn
      sides: { player: newSide(P), ai: newSide(A) },
      locked: (opts.locked || []).slice(),  // structure types not available in this game
      hotseat: !!opts.hotseat,              // two humans: no AI income bonus
      aiStyle: opts.aiStyle || 'balanced',  // skirmish opponent personality (see AI_STYLES in ai.js)
      maxTurns: opts.maxTurns || C.MAX_TURNS
    };
    state.mapSeed = (opts.mapSeed >>> 0) || ((state.rng * 7919 + 17) >>> 0);
    state.land = generateIslands(state.mapSeed, opts.landTarget || C.LAND_TARGET);
    for (let i = 0; i < N; i++) state.cells.push({ building: null, crater: 0, scorch: 0 });
    for (const side of [P, A]) {
      placeBuilding(state, side, 'hq', hqCell(side));
      // starting structures, mirrored for the AI
      const extra = (opts.start && opts.start[side]) || [];
      for (const sb of C.START_BUILDINGS.concat(extra)) {
        const h = xy(hqCell(side));
        const want = idx(Math.max(0, Math.min(W - 1, h.x + (side === P ? sb.dx : -sb.dx))), Math.max(0, Math.min(H - 1, h.y + sb.dy)));
        const cell = state.land[want] && !state.cells[want].building ? want : nearestFreeLand(state, side, want);
        if (cell >= 0) {
          const b = placeBuilding(state, side, sb.type, cell);
          b.builtTurn = 0;
          if (sb.charge !== undefined) b.charge = sb.charge;
        }
      }
      if (opts.credits && opts.credits[side] !== undefined) state.sides[side].credits = opts.credits[side];
    }
    refreshTurnState(state);
    updateIntel(state, P);
    updateIntel(state, A);
    return state;
  }

  function placeBuilding(state, side, type, cell) {
    const def = B[type];
    const b = {
      id: state.nextId++, type, side, cell,
      hp: def.hp, maxHp: def.hp,
      shots: 0, pool: def.pool || 0, level: 1,
      fired: false, deployed: false, repaired: 0,
      dead: false, builtTurn: state.turn
    };
    if (type === 'aa') b.shots = def.shots;
    if (type === 'hq') b.shots = 1;
    if (type === 'uplink') b.charge = 0;
    if (type === 'decoy') {
      // pre-rolled per side and put back if the build is undone, so build / undo / build can't re-roll it
      const sd = state.sides[side];
      b.disguise = sd.nextDisguise || def.disguises[Math.floor(rand(state) * def.disguises.length)];
      sd.nextDisguise = def.disguises[Math.floor(rand(state) * def.disguises.length)];
    }
    state.cells[cell].building = b;
    return b;
  }

  // ── Queries ──────────────────────────────────────────────
  function buildingsOf(state, side, type) {
    const out = [];
    for (let i = 0; i < N; i++) {
      const b = state.cells[i].building;
      if (b && b.side === side && !b.dead && (!type || b.type === type)) out.push(b);
    }
    return out;
  }
  function buildingAt(state, cell) {
    const b = state.cells[cell] && state.cells[cell].building;
    return b && !b.dead ? b : null;
  }
  function robotAt(state, cell) {
    for (const r of state.robots) if (r.cell === cell && r.hp > 0) return r;
    return null;
  }
  function robotsOf(state, side) { return state.robots.filter(r => r.side === side && r.hp > 0); }

  function incomeMul(state, side) {
    return side === A && !state.hotseat ? C.DIFFICULTY[state.difficulty].incomeMul : 1;
  }
  function income(state, side) {
    let credits = C.BASE_CREDITS, energy = C.BASE_ENERGY;
    for (const b of buildingsOf(state, side)) {
      if (b.type === 'depot') credits += stat(b, 'credits');
      if (b.type === 'power') energy += stat(b, 'energy');
    }
    const m = incomeMul(state, side);
    return { credits: Math.round(credits * m), energy: Math.round(energy * m) };
  }
  function energyCap(state, side) {
    return C.ENERGY_CAP_BASE + buildingsOf(state, side, 'power').reduce((t, b) => t + stat(b, 'cap'), 0);
  }

  // What an enemy observer sees: decoys pose as their disguise, HP scaled to match
  // Campaign medals for a finished game: [won, won within par turns, won with HQ at 50%+ HP]
  function missionMedals(state, mission, side) {
    side = side || P;
    const won = state.winner === side;
    const hq = buildingsOf(state, side, 'hq')[0];
    return [won, won && state.turn <= mission.par, won && !!hq && hq.hp * 2 >= hq.maxHp];
  }

  // Daily Operation score: wins score 1000 + 30 per turn under the limit + 5 per HQ health %;
  // a loss or draw scores 10 per enemy-HQ health % destroyed (so a close loss still counts)
  function dailyScore(state, side) {
    side = side || P;
    const limit = state.maxTurns || C.MAX_TURNS;
    const mine = buildingsOf(state, side, 'hq')[0], theirs = buildingsOf(state, enemyOf(side), 'hq')[0];
    if (state.winner === side) return 1000 + Math.max(0, limit - state.turn) * 30 + Math.round(100 * (mine ? mine.hp / mine.maxHp : 0)) * 5;
    return Math.round(100 * (theirs ? 1 - theirs.hp / theirs.maxHp : 1)) * 10;
  }

  function apparent(b) {
    if (!b.disguise) return { type: b.type, hp: b.hp, maxHp: b.maxHp, level: b.level };
    const maxHp = B[b.disguise].hp;
    return { type: b.disguise, hp: Math.max(1, Math.round(b.hp / b.maxHp * maxHp)), maxHp, level: 1 };
  }

  // ── Vision ───────────────────────────────────────────────
  // Radars come online the turn after construction (no build-peek-undo)
  function onlineRadars(state, side) {
    return buildingsOf(state, side, 'radar').filter(r => r.builtTurn < state.turn);
  }

  // Returns a Set of enemy-owned cells that `side` can currently see.
  function visibleEnemyCells(state, side) {
    const out = new Set();
    const foe = enemyOf(side);
    if (side === A && C.DIFFICULTY[state.difficulty].fullVision) {
      for (let i = 0; i < N; i++) if (ownerOfCell(i) === foe) out.add(i);
      return out;
    }
    for (const r of onlineRadars(state, side)) {
      for (const c of cellsInRadius(r.cell, stat(r, 'range'))) if (ownerOfCell(c) === foe) out.add(c);
    }
    for (const c of state.sides[side].intel.reveal) out.add(c);
    // Enemy HQ position is always known
    out.add(hqCell(foe));
    // Own robots see around themselves
    for (const r of robotsOf(state, side)) {
      for (const c of [r.cell].concat(neighbors(r.cell, 1))) if (ownerOfCell(c) === foe) out.add(c);
    }
    return out;
  }

  function updateIntel(state, side) {
    const seen = state.sides[side].intel.seen;
    const vis = visibleEnemyCells(state, side);
    vis.forEach(c => {
      const b = buildingAt(state, c);
      if (b) { const a = apparent(b); seen[c] = { type: a.type, hp: a.hp, maxHp: a.maxHp, level: a.level, turn: state.turn }; }
      else delete seen[c];
    });
    return vis;
  }

  // Enemy missiles in flight that `side` can detect (target within radar range or near HQ)
  function detectedIncoming(state, side) {
    const radars = onlineRadars(state, side);
    const hq = hqCell(side);
    return state.missiles.filter(m => {
      if (m.side === side) return false;
      if (m.strike) return true; // orbital strikes light up every sensor
      if (dist(m.to, hq) <= C.INCOMING_HQ_RADIUS + 0.01) return true;
      return radars.some(r => dist(r.cell, m.to) <= stat(r, 'range') + 0.01);
    });
  }

  // ── Building validation ──────────────────────────────────
  function buildableReason(state, side, type, cell) {
    const def = B[type];
    if (!def || type === 'hq') return 'Unknown structure';
    if (state.locked && state.locked.includes(type)) return 'Not available in this mission';
    if (cell < 0 || cell >= N) return 'Out of bounds';
    const owner = ownerOfCell(cell);
    if (owner === null) return 'Open sea';
    if (owner !== side) return 'Enemy territory';
    if (!isLand(state, cell)) return 'Water — build on your island';
    const c = state.cells[cell];
    if (c.building) return 'Cell occupied';
    if (c.crater > 0) return 'Crater (' + c.crater + ' turn' + (c.crater > 1 ? 's' : '') + ')';
    if (robotAt(state, cell)) return 'Mech in the way';
    const own = buildingsOf(state, side);
    if (!own.some(b => cheb(b.cell, cell) <= C.BUILD_RADIUS)) return 'Out of build range';
    if (def.max && buildingsOf(state, side, type).length >= def.max) return 'Max ' + def.max + ' ' + def.name + 's';
    const cost = buildCost(state, side, type);
    if (state.sides[side].credits < cost) return 'Need ' + cost + ' credits';
    return null;
  }

  // What the next structure of a type costs this side. Supply Depots get pricier the more you own,
  // so an all-economy opening can't snowball unchecked.
  function buildCost(state, side, type) {
    const def = B[type];
    return def.cost + (def.costStep ? def.costStep * buildingsOf(state, side, type).length : 0);
  }

  // Cheap check ignoring credits/max — for the build-zone overlay
  function inBuildZone(state, side, cell) {
    if (ownerOfCell(cell) !== side || !isLand(state, cell)) return false;
    const c = state.cells[cell];
    if (c.building || c.crater > 0 || robotAt(state, cell)) return false;
    return buildingsOf(state, side).some(b => cheb(b.cell, cell) <= C.BUILD_RADIUS);
  }

  function build(state, side, type, cell) {
    const reason = buildableReason(state, side, type, cell);
    if (reason) return { ok: false, reason };
    const s = state.sides[side];
    const cost = buildCost(state, side, type);
    s.credits -= cost;
    const b = placeBuilding(state, side, type, cell);
    b.paid = cost;
    s.undo.push({ kind: 'build', id: b.id, cell, cost, disguise: b.disguise });
    s.stats.built++;
    return { ok: true, building: b };
  }

  function repairInfo(state, side, cell) {
    const b = buildingAt(state, cell);
    if (!b || b.side !== side) return { amount: 0, cost: 0, reason: 'Nothing to repair' };
    const missing = b.maxHp - b.hp;
    if (missing <= 0) return { amount: 0, cost: 0, reason: 'Already at full HP' };
    const left = C.REPAIR_MAX_PER_TURN - b.repaired;
    if (left <= 0) return { amount: 0, cost: 0, reason: 'Repair limit reached this turn' };
    const credits = state.sides[side].credits;
    const amount = Math.min(missing, left, Math.floor(credits / C.REPAIR_COST_PER_HP));
    if (amount <= 0) return { amount: 0, cost: 0, reason: 'Not enough credits' };
    return { amount, cost: amount * C.REPAIR_COST_PER_HP, reason: null };
  }

  function repair(state, side, cell) {
    const info = repairInfo(state, side, cell);
    if (info.reason) return { ok: false, reason: info.reason };
    const b = buildingAt(state, cell);
    b.hp += info.amount;
    b.repaired += info.amount;
    state.sides[side].credits -= info.cost;
    state.sides[side].undo.push({ kind: 'repair', id: b.id, cell, amount: info.amount, cost: info.cost });
    return { ok: true, amount: info.amount, cost: info.cost, building: b };
  }

  function sellValue(b, state) {
    const invested = (b.paid || B[b.type].cost) + (b.level > 1 ? upgradeCost(b.type) : 0);
    if (state && b.builtTurn === state.turn) return invested; // changed your mind this turn: full refund
    return Math.floor(invested * C.SELL_REFUND * (Math.max(0, b.hp - b.repaired) / b.maxHp));
  }

  function upgradeInfo(state, side, cell) {
    const b = buildingAt(state, cell);
    if (!b || b.side !== side) return { reason: 'Select one of your structures' };
    if (!UP[b.type]) return { reason: B[b.type].name + ' cannot be upgraded' };
    if (b.level > 1) return { reason: 'Already upgraded' };
    const cost = upgradeCost(b.type);
    if (state.sides[side].credits < cost) return { cost, reason: 'Need ' + cost + ' credits' };
    return { cost, reason: null, name: UP[b.type].name, desc: UP[b.type].desc };
  }

  function upgrade(state, side, cell) {
    const info = upgradeInfo(state, side, cell);
    if (info.reason) return { ok: false, reason: info.reason };
    const b = buildingAt(state, cell), s = state.sides[side];
    const extra = Math.round(b.maxHp * (UP_HP - 1));
    s.credits -= info.cost;
    const poolBefore = b.type === 'shield' ? stat(b, 'pool') : 0;
    b.level = 2; b.maxHp += extra; b.hp += extra; b.upgradedTurn = state.turn;
    if (b.type === 'shield') b.pool += stat(b, 'pool') - poolBefore;
    if (b.type === 'aa' && !b.fired) b.shots = stat(b, 'shots');
    s.undo.push({ kind: 'upgrade', id: b.id, cell, cost: info.cost, extra, poolBefore: b.type === 'shield' ? b.pool - (stat(b, 'pool') - poolBefore) : undefined });
    return { ok: true, building: b, cost: info.cost, name: info.name };
  }

  function sell(state, side, cell) {
    const b = buildingAt(state, cell);
    if (!b || b.side !== side) return { ok: false, reason: 'Nothing to sell' };
    if (b.type === 'hq') return { ok: false, reason: 'Cannot sell the Command Center' };
    if (state.sides[side].orders.some(o => o.from === cell)) return { ok: false, reason: 'Cancel its orders first' };
    const value = sellValue(b, state);
    state.cells[cell].building = null;
    state.sides[side].credits += value;
    // Selling replaces earlier undo entries for that building with a sell entry
    const s = state.sides[side];
    s.undo = s.undo.filter(u => u.id !== b.id);
    s.undo.push({ kind: 'sell', id: b.id, cell, value, building: b });
    return { ok: true, value, building: b };
  }

  // ── Orders (missiles / drops) ────────────────────────────
  function freeLaunchers(state, side, type) {
    const used = new Set(state.sides[side].orders.map(o => o.from));
    return buildingsOf(state, side, type).filter(b => !used.has(b.cell));
  }

  function missileReason(state, side, to) {
    if (ownerOfCell(to) !== enemyOf(side)) return 'Target must be in enemy territory';
    if (!freeLaunchers(state, side, 'silo').length) {
      return buildingsOf(state, side, 'silo').length ? 'All silos already tasked' : 'Build a Missile Silo first';
    }
    if (state.sides[side].energy < C.MISSILE_ENERGY) return 'Need ' + C.MISSILE_ENERGY + ' energy';
    return null;
  }

  function queueMissile(state, side, to, from) {
    const reason = missileReason(state, side, to);
    if (reason) return { ok: false, reason };
    const silos = freeLaunchers(state, side, 'silo');
    let silo = silos.find(s => s.cell === from);
    if (!silo) silo = silos.sort((a, b) => dist(a.cell, to) - dist(b.cell, to))[0];
    const s = state.sides[side];
    s.energy -= C.MISSILE_ENERGY;
    const order = { id: state.nextId++, kind: 'missile', from: silo.cell, to, cost: C.MISSILE_ENERGY };
    s.orders.push(order);
    s.undo.push({ kind: 'order', id: order.id });
    return { ok: true, order };
  }

  // Orbital strike from a fully charged Strike Uplink
  function strikeReadyReason(state, side) {
    const up = buildingsOf(state, side, 'uplink')[0];
    if (!up) return 'Build a Strike Uplink first';
    if (state.sides[side].orders.some(o => o.kind === 'strike')) return 'Strike already ordered';
    if (up.charge < C.STRIKE_CHARGE) return 'Charging (' + up.charge + '/' + C.STRIKE_CHARGE + ')';
    if (state.sides[side].energy < C.STRIKE_ENERGY) return 'Need ' + C.STRIKE_ENERGY + ' energy';
    return null;
  }

  function strikeReason(state, side, to) {
    if (ownerOfCell(to) !== enemyOf(side)) return 'Target must be in enemy territory';
    return strikeReadyReason(state, side);
  }

  function queueStrike(state, side, to) {
    const reason = strikeReason(state, side, to);
    if (reason) return { ok: false, reason };
    const up = buildingsOf(state, side, 'uplink')[0];
    const s = state.sides[side];
    s.energy -= C.STRIKE_ENERGY;
    const order = { id: state.nextId++, kind: 'strike', from: up.cell, to, cost: C.STRIKE_ENERGY };
    s.orders.push(order);
    s.undo.push({ kind: 'order', id: order.id });
    return { ok: true, order };
  }

  // Can this side launch a drop at all this turn? (hangar free, mech cap, energy)
  function dropReadyReason(state, side) {
    if (!freeLaunchers(state, side, 'hangar').length) {
      return buildingsOf(state, side, 'hangar').length ? 'All hangars already tasked' : 'Build a Robot Hangar first';
    }
    const queued = state.sides[side].orders.filter(o => o.kind === 'drop').length;
    if (robotsOf(state, side).length + queued >= C.MAX_ROBOTS) return 'Max ' + C.MAX_ROBOTS + ' mechs in the field';
    if (state.sides[side].energy < C.DROP_ENERGY) return 'Need ' + C.DROP_ENERGY + ' energy';
    return null;
  }

  function dropReason(state, side, to) {
    const owner = ownerOfCell(to);
    if (owner === null) return 'Drop zone must be on an island';
    if (!isLand(state, to)) return 'Drop zone must be on land';
    // own island = garrison drop (defends against enemy mechs)
    if (owner === side && (state.cells[to].building || robotAt(state, to))) return 'Garrison drop needs a free cell';
    if (owner !== side && cheb(to, hqCell(enemyOf(side))) <= C.DROP_HQ_EXCLUSION) return 'Too close to the enemy HQ (air defense zone)';
    if (!freeLaunchers(state, side, 'hangar').length) {
      return buildingsOf(state, side, 'hangar').length ? 'All hangars already tasked' : 'Build a Robot Hangar first';
    }
    const queued = state.sides[side].orders.filter(o => o.kind === 'drop').length;
    if (robotsOf(state, side).length + queued >= C.MAX_ROBOTS) return 'Max ' + C.MAX_ROBOTS + ' mechs in the field';
    if (state.sides[side].energy < C.DROP_ENERGY) return 'Need ' + C.DROP_ENERGY + ' energy';
    return null;
  }

  function queueDrop(state, side, to) {
    const reason = dropReason(state, side, to);
    if (reason) return { ok: false, reason };
    const hangar = freeLaunchers(state, side, 'hangar').sort((a, b) => dist(a.cell, to) - dist(b.cell, to))[0];
    const s = state.sides[side];
    s.energy -= C.DROP_ENERGY;
    const order = { id: state.nextId++, kind: 'drop', from: hangar.cell, to, cost: C.DROP_ENERGY };
    s.orders.push(order);
    s.undo.push({ kind: 'order', id: order.id });
    return { ok: true, order };
  }

  function cancelOrder(state, side, id) {
    const s = state.sides[side];
    const i = s.orders.findIndex(o => o.id === id);
    if (i < 0) return { ok: false };
    const o = s.orders.splice(i, 1)[0];
    s.energy += o.cost;
    s.undo = s.undo.filter(u => !(u.kind === 'order' && u.id === id));
    return { ok: true, order: o };
  }

  function undo(state, side) {
    const s = state.sides[side];
    const u = s.undo.pop();
    if (!u) return { ok: false, reason: 'Nothing to undo' };
    if (u.kind === 'order') {
      const r = cancelOrder(state, side, u.id);
      return { ok: r.ok, kind: 'order', order: r.order };
    }
    if (u.kind === 'sell') {
      const c = state.cells[u.cell];
      if (c.building || robotAt(state, u.cell)) return { ok: false, reason: 'Cell no longer free' };
      if (s.credits < u.value) return { ok: false, reason: 'Credits already spent' };
      c.building = u.building;
      s.credits -= u.value;
      return { ok: true, kind: 'sell', building: u.building };
    }
    const b = buildingAt(state, u.cell);
    if (!b || b.id !== u.id) return { ok: false, reason: 'Cannot undo' };
    if (u.kind === 'build') {
      if (s.orders.some(o => o.from === u.cell)) return { ok: false, reason: 'Cancel its orders first' };
      state.cells[u.cell].building = null;
      if (u.disguise) s.nextDisguise = u.disguise;
      s.credits += u.cost;
      s.stats.built--;
      return { ok: true, kind: 'build', building: b };
    }
    if (u.kind === 'upgrade') {
      b.level = 1; b.maxHp -= u.extra; b.hp = Math.min(b.maxHp, Math.max(1, b.hp - u.extra));
      if (b.type === 'aa') b.shots = Math.min(b.shots, stat(b, 'shots'));
      if (b.type === 'shield') b.pool = u.poolBefore !== undefined ? Math.min(u.poolBefore, b.pool) : Math.min(b.pool, stat(b, 'pool'));
      s.credits += u.cost;
      return { ok: true, kind: 'upgrade', building: b };
    }
    if (u.kind === 'repair') {
      b.hp -= u.amount;
      b.repaired -= u.amount;
      s.credits += u.cost;
      return { ok: true, kind: 'repair', building: b };
    }
    return { ok: false };
  }

  // ── Turn bookkeeping ─────────────────────────────────────
  // Resets per-turn building state. Called at game start and after each resolution.
  function refreshTurnState(state) {
    for (let i = 0; i < N; i++) {
      const b = state.cells[i].building;
      if (!b) continue;
      b.fired = false; b.deployed = false; b.repaired = 0;
      if (b.type === 'aa') b.shots = stat(b, 'shots');
      if (b.type === 'hq') b.shots = 1;
    }
    for (const r of state.robots) r.fresh = false;
    for (const side of [P, A]) {
      state.sides[side].orders = [];
      state.sides[side].undo = [];
    }
  }

  function startNextTurn(state) {
    state.turn++;
    for (let i = 0; i < N; i++) {
      const c = state.cells[i];
      if (c.crater > 0) c.crater--;
      const b = c.building;
      if (b && b.type === 'shield') b.pool = Math.min(stat(b, 'pool'), b.pool + stat(b, 'regen'));
      if (b && b.type === 'uplink' && b.builtTurn < state.turn) b.charge = Math.min(C.STRIKE_CHARGE, b.charge + 1);
    }
    refreshTurnState(state);
    for (const side of [P, A]) {
      const s = state.sides[side];
      const inc = income(state, side);
      s.credits += inc.credits;
      s.energy = Math.min(energyCap(state, side), s.energy + inc.energy);
    }
    updateIntel(state, P);
    updateIntel(state, A);
  }

  // ── Damage ───────────────────────────────────────────────
  // Shields of the defending side absorb damage first. Returns hit record.
  // melee: a mech already inside the dome — shields stop projectiles, not mechs walking in
  function damageBuilding(state, b, amount, attacker, events, melee) {
    let absorbed = 0, shieldCell = -1, shieldPool = 0;
    for (const s of melee ? [] : buildingsOf(state, b.side, 'shield')) {
      if (s.pool <= 0 || cheb(s.cell, b.cell) > B.shield.range) continue;
      const take = Math.min(s.pool, amount - absorbed);
      s.pool -= take;
      absorbed += take;
      shieldCell = s.cell; shieldPool = s.pool;
      if (absorbed >= amount) break;
    }
    const dmg = amount - absorbed;
    b.hp = Math.max(0, b.hp - dmg);
    const sa = state.sides[attacker].stats, sd = state.sides[b.side].stats;
    sa.damageDealt += dmg; sd.damageTaken += dmg;
    let destroyed = false;
    if (b.hp <= 0 && !b.dead) {
      b.dead = true; destroyed = true;
      sa.destroyed++; sd.lost++;
    }
    return { cell: b.cell, id: b.id, type: b.type, disguise: b.disguise, side: b.side, dmg, absorbed, shieldCell, shieldPool, hpAfter: b.hp, maxHp: b.maxHp, destroyed };
  }

  function targetValue(state, cell) {
    const b = buildingAt(state, cell);
    if (!b) return 0;
    return { hq: 10, silo: 8, aa: 7, hangar: 6, power: 5, depot: 4, shield: 4, radar: 3, gunpod: 3 }[b.type] || 1;
  }

  // ── Robot pathfinding (8-way BFS avoiding buildings and robots) ──
  function passable(state, cell, self) {
    if (!isLand(state, cell)) return false;
    if (state.cells[cell].building) return false;
    for (const r of state.robots) if (r !== self && r.hp > 0 && r.cell === cell) return false;
    return true;
  }

  function bfsPath(state, robot, goalFn) {
    const prev = new Int32Array(N).fill(-2);
    const q = [robot.cell];
    prev[robot.cell] = -1;
    let best = -1;
    while (q.length) {
      const c = q.shift();
      if (goalFn(c)) { best = c; break; }
      for (const n of neighbors(c, 1)) {
        if (prev[n] !== -2 || !passable(state, n, robot)) continue;
        // no diagonal corner cutting through two blocked cells
        const a = xy(c), b = xy(n);
        if (a.x !== b.x && a.y !== b.y) {
          if (!passable(state, idx(b.x, a.y), robot) && !passable(state, idx(a.x, b.y), robot)) continue;
        }
        prev[n] = c;
        q.push(n);
      }
    }
    if (best < 0) return null;
    const path = [];
    for (let c = best; c !== robot.cell; c = prev[c]) path.unshift(c);
    return path;
  }

  function robotTarget(state, robot) {
    const foes = buildingsOf(state, enemyOf(robot.side));
    if (!foes.length) return null;
    const hq = foes.find(b => b.type === 'hq');
    if (hq && dist(hq.cell, robot.cell) <= C.ROBOT_HQ_PREFERENCE + 0.01) return hq;
    let best = null, bd = Infinity;
    for (const b of foes) {
      const d = dist(b.cell, robot.cell);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // ── Turn resolution ──────────────────────────────────────
  // What a mech will do when robots act this turn, given the board as it stands:
  //   { kind: 'fight', robot }        melee an adjacent enemy mech
  //   { kind: 'hit', building }       smash an adjacent enemy structure
  //   { kind: 'move', path, facing, goal }  walk up to ROBOT_MOVE cells toward `goal`
  //   { kind: 'hold' }
  // resolveTurn uses this for every mech, so the planning preview shows exactly the same logic.
  function robotIntent(state, r) {
    const foe = enemyOf(r.side);
    const guard = ownerOfCell(r.cell) === r.side;
    // Enemy mech next to us? Garrison mechs always engage; raiders only when no structure is in reach
    let duel = null;
    for (const o of state.robots) {
      if (o.side === r.side || o.hp <= 0 || cheb(o.cell, r.cell) > 1) continue;
      if (!duel || o.hp < duel.hp) duel = o;
    }
    if (duel && guard) return { kind: 'fight', robot: duel };
    if (guard) {
      // hunt the nearest invader on our island; hold position otherwise
      const prey = state.robots.filter(o => o.side === foe && o.hp > 0 && ownerOfCell(o.cell) === r.side)
        .sort((a, b) => dist(a.cell, r.cell) - dist(b.cell, r.cell))[0];
      if (!prey) return { kind: 'hold' };
      const path = bfsPath(state, r, c => cheb(c, prey.cell) <= 1);
      return path && path.length ? { kind: 'move', path: path.slice(0, C.ROBOT_MOVE), facing: prey.cell, goal: prey.cell } : { kind: 'hold' };
    }
    // Adjacent target? HQ first, then lowest HP
    let adj = null;
    for (const n of neighbors(r.cell, 1)) {
      const b = buildingAt(state, n);
      if (!b || b.side !== foe || b.dead) continue;
      if (!adj || (b.type === 'hq' && adj.type !== 'hq') || (adj.type !== 'hq' && b.hp / b.maxHp < adj.hp / adj.maxHp)) adj = b;
    }
    if (adj) return { kind: 'hit', building: adj };
    if (duel) return { kind: 'fight', robot: duel };
    const tgt = robotTarget(state, r);
    if (!tgt) return { kind: 'hold' };
    let path = bfsPath(state, r, c => cheb(c, tgt.cell) <= 1);
    if (!path) {
      // Unreachable: approach as close as possible
      let best = r.cell, bd = dist(r.cell, tgt.cell);
      const reach = bfsReach(state, r);
      for (const c of reach) { const d = dist(c, tgt.cell); if (d < bd) { bd = d; best = c; } }
      path = best === r.cell ? [] : bfsPath(state, r, c => c === best);
    }
    return path && path.length ? { kind: 'move', path: path.slice(0, C.ROBOT_MOVE), facing: tgt.cell, goal: tgt.cell } : { kind: 'hold' };
  }

  function resolveTurn(state) {
    const events = [];
    const ev = (beat, e) => { e.beat = beat; events.push(e); return e; };
    const sideOf = s => state.sides[s];

    // 1. DESCENT of missiles launched last turn, AA assignment
    const incoming = state.missiles;
    state.missiles = [];
    for (const def of [P, A]) {
      for (const m of incoming.filter(m => m.strike && ownerOfCell(m.to) === def)) {
        ev(BEAT.DESCEND, { type: 'descend', id: m.id, side: m.side, from: m.from, to: m.to, shots: [], interceptedBy: -1, strike: true });
      }
      const ms = incoming.filter(m => !m.strike && ownerOfCell(m.to) === def)
        .sort((a, b) => targetValue(state, b.to) - targetValue(state, a.to) || a.id - b.id);
      const batteries = buildingsOf(state, def).filter(b => b.type === 'aa' || b.type === 'hq');
      const covers = (bat, m) => dist(bat.cell, m.to) <= stat(bat, 'range') + 0.01;
      for (let mi = 0; mi < ms.length; mi++) {
        const m = ms[mi];
        // Prefer the battery that covers the fewest remaining missiles, so
        // batteries with wide coverage stay free for missiles only they can reach
        let best = null, bScore = Infinity, bd = Infinity;
        for (const bat of batteries) {
          if (bat.shots <= 0 || !covers(bat, m)) continue;
          let load = 0;
          for (let mj = mi + 1; mj < ms.length; mj++) if (covers(bat, ms[mj])) load++;
          const d = dist(bat.cell, m.to);
          if (load < bScore || (load === bScore && d < bd)) { bScore = load; bd = d; best = bat; }
        }
        // Engage: each shot may miss; a miss lets the next battery in range try
        const shots = [];
        const tried = new Set();
        while (best) {
          best.shots--;
          tried.add(best);
          const hit = rand(state) < stat(best, 'hitChance');
          shots.push({ by: best.cell, hit, chance: stat(best, 'hitChance') });
          // a battery that fires gives its position away: the attacker sees it next planning phase
          if (best.type === 'aa') { const ai = sideOf(m.side).intel; ai.nextReveal = (ai.nextReveal || []).concat([best.cell]); }
          if (hit) { m.interceptedBy = best.cell; sideOf(def).stats.intercepts++; break; }
          best = null; bd = Infinity;
          for (const bat of batteries) {
            if (bat.shots <= 0 || tried.has(bat) || !covers(bat, m)) continue;
            const d = dist(bat.cell, m.to);
            if (d < bd) { bd = d; best = bat; }
          }
        }
        ev(BEAT.DESCEND, { type: 'descend', id: m.id, side: m.side, from: m.from, to: m.to, shots, interceptedBy: m.interceptedBy !== undefined ? m.interceptedBy : -1 });
      }
    }

    // 2. IMPACTS
    for (const m of incoming) {
      if (m.interceptedBy !== undefined) continue;
      const atk = m.side;
      if (!m.strike) sideOf(atk).stats.missilesHit++;
      const hits = [];
      const direct = buildingAt(state, m.to);
      if (direct) hits.push(damageBuilding(state, direct, m.dmg || C.MISSILE_DAMAGE, atk, events));
      for (const n of neighbors(m.to, 1)) {
        const b = buildingAt(state, n);
        if (b && b.side !== atk) hits.push(damageBuilding(state, b, m.splash || C.MISSILE_SPLASH, atk, events));
      }
      if (!m.strike) { const def = sideOf(enemyOf(atk)).stats; def.missileDamageTaken = (def.missileDamageTaken || 0) + hits.reduce((t, h) => t + h.dmg, 0); }
      state.cells[m.to].scorch = 1;
      // Impact reveals the area for the attacker next planning phase
      const reveal = [m.to].concat(neighbors(m.to, C.IMPACT_REVEAL_RADIUS)).filter(c => ownerOfCell(c) === enemyOf(atk));
      sideOf(atk).intel.nextReveal = (sideOf(atk).intel.nextReveal || []).concat(reveal);
      ev(BEAT.IMPACT, { type: 'impact', id: m.id, side: atk, cell: m.to, hits, reveal, strike: !!m.strike });
    }

    // 3. GUN PODS fire at enemy robots
    for (const side of [P, A]) {
      // Gun Pods, plus the Command Center's own close-defense gun
      for (const g of buildingsOf(state, side).filter(b => b.type === 'gunpod' || b.type === 'hq')) {
        const gun = g.type === 'hq' ? B.hq.gun : { shots: stat(g, 'shots'), damage: B.gunpod.damage, range: B.gunpod.range };
        const shots = [];
        for (let s = 0; s < gun.shots; s++) {
          let tgt = null;
          for (const r of state.robots) {
            if (r.side === side || r.hp <= 0) continue;
            if (dist(g.cell, r.cell) > gun.range + 0.01) continue;
            if (!tgt || r.hp < tgt.hp || (r.hp === tgt.hp && r.id < tgt.id)) tgt = r;
          }
          if (!tgt) break;
          tgt.hp = Math.max(0, tgt.hp - gun.damage);
          const killed = tgt.hp <= 0;
          if (killed) { sideOf(side).stats.robotsKilled++; sideOf(tgt.side).stats.robotsLost++; }
          shots.push({ robotId: tgt.id, robotSide: tgt.side, cell: tgt.cell, dmg: gun.damage, hpAfter: tgt.hp, killed });
          // muzzle flashes give the shooter's position away
          const intel = sideOf(tgt.side).intel;
          intel.nextReveal = (intel.nextReveal || []).concat([g.cell]);
        }
        if (shots.length) ev(BEAT.GUNFIRE, { type: 'gunfire', side, from: g.cell, gunType: g.type, shots });
      }
    }

    // 4. ROBOTS act (older robots first; fresh drops wait a turn)
    const actors = state.robots.filter(r => r.hp > 0 && !r.fresh).sort((a, b) => a.id - b.id);
    for (const r of actors) {
      if (r.hp <= 0) continue;
      const act = robotIntent(state, r);
      if (act.kind === 'fight') {
        const o = act.robot, dmg = r.dmg || C.ROBOT_DAMAGE;
        o.hp = Math.max(0, o.hp - dmg);
        const killed = o.hp <= 0;
        if (killed) { sideOf(r.side).stats.robotsKilled++; sideOf(o.side).stats.robotsLost++; }
        ev(BEAT.ROBOTS, { type: 'robotFight', id: r.id, side: r.side, cell: r.cell, targetId: o.id, targetCell: o.cell, dmg, hpAfter: o.hp, killed });
      } else if (act.kind === 'hit') {
        const hit = damageBuilding(state, act.building, r.dmg || C.ROBOT_DAMAGE, r.side, events, true);
        ev(BEAT.ROBOTS, { type: 'robotHit', id: r.id, side: r.side, cell: r.cell, hit });
      } else if (act.kind === 'move') {
        const fromCell = r.cell;
        r.cell = act.path[act.path.length - 1];
        ev(BEAT.ROBOTS, { type: 'robotMove', id: r.id, side: r.side, from: fromCell, path: act.path, facing: act.facing });
      }
    }

    // 5. DROP PODS land
    for (const side of [P, A]) {
      for (const o of sideOf(side).orders.filter(o => o.kind === 'drop')) {
        const hangar = buildingAt(state, o.from);
        if (!hangar) { sideOf(side).energy += o.cost; ev(BEAT.DROPS, { type: 'cancelled', kind: 'drop', side, from: o.from, refund: o.cost }); continue; }
        hangar.deployed = true;
        let cell = o.to;
        if (!passable(state, cell, null)) {
          // scatter to the nearest free cell on the island that was aimed at (a raid still
          // respects the enemy HQ's no-drop zone)
          const raid = ownerOfCell(o.to) !== side, foeHq = hqCell(enemyOf(side));
          let best = -1, bd = Infinity;
          for (let i = 0; i < N; i++) {
            if (ownerOfCell(i) !== ownerOfCell(o.to) || !passable(state, i, null)) continue;
            if (raid && cheb(i, foeHq) <= C.DROP_HQ_EXCLUSION) continue;
            const d = dist(i, o.to);
            if (d < bd) { bd = d; best = i; }
          }
          cell = best;
        }
        if (cell < 0) { sideOf(side).energy += o.cost; ev(BEAT.DROPS, { type: 'cancelled', kind: 'drop', side, from: o.from, refund: o.cost }); continue; }
        const mhp = hangar.level > 1 ? UP.hangar.mechHp : C.ROBOT_HP;
        const robot = { id: state.nextId++, side, cell, hp: mhp, maxHp: mhp, dmg: hangar.level > 1 ? UP.hangar.mechDmg : C.ROBOT_DAMAGE, heavy: hangar.level > 1, fresh: true };
        state.robots.push(robot);
        sideOf(side).stats.robotsDeployed++;
        ev(BEAT.DROPS, { type: 'drop', side, from: o.from, to: cell, aimed: o.to, robot: Object.assign({}, robot) });
      }
    }

    // 6. LAUNCHES (land next turn)
    for (const side of [P, A]) {
      for (const o of sideOf(side).orders.filter(o => o.kind === 'missile')) {
        const silo = buildingAt(state, o.from);
        if (!silo) { sideOf(side).energy += o.cost; ev(BEAT.LAUNCH, { type: 'cancelled', kind: 'missile', side, from: o.from, refund: o.cost }); continue; }
        silo.fired = true;
        const m = { id: state.nextId++, side, from: o.from, to: o.to, dmg: stat(silo, 'dmg') || C.MISSILE_DAMAGE, splash: stat(silo, 'splash') || C.MISSILE_SPLASH };
        state.missiles.push(m);
        sideOf(side).stats.missilesFired++;
        ev(BEAT.LAUNCH, { type: 'launch', id: m.id, side, from: o.from, to: o.to });
      }
      for (const o of sideOf(side).orders.filter(o => o.kind === 'strike')) {
        const up = buildingAt(state, o.from);
        if (!up || up.type !== 'uplink') { sideOf(side).energy += o.cost; ev(BEAT.LAUNCH, { type: 'cancelled', kind: 'strike', side, from: o.from, refund: o.cost }); continue; }
        up.charge = 0;
        const m = { id: state.nextId++, side, from: o.from, to: o.to, dmg: C.STRIKE_DAMAGE, splash: C.STRIKE_SPLASH, strike: true };
        state.missiles.push(m);
        sideOf(side).stats.strikes = (sideOf(side).stats.strikes || 0) + 1; // saves from before strikes lack the field
        ev(BEAT.LAUNCH, { type: 'launch', id: m.id, side, from: o.from, to: o.to, strike: true });
      }
    }

    // 7. CLEANUP
    const destroyed = [];
    for (let i = 0; i < N; i++) {
      const b = state.cells[i].building;
      if (b && b.dead) {
        destroyed.push(b);
        state.cells[i].building = null;
        state.cells[i].crater = C.CRATER_TURNS + 1; // decremented at next turn start
      }
    }
    state.robots = state.robots.filter(r => r.hp > 0);
    for (const side of [P, A]) {
      const s = sideOf(side);
      s.intel.reveal = s.intel.nextReveal || [];
      s.intel.nextReveal = [];
    }

    const pDead = destroyed.some(b => b.type === 'hq' && b.side === P);
    const aDead = destroyed.some(b => b.type === 'hq' && b.side === A);
    if (pDead && aDead) { state.winner = 'draw'; state.endReason = 'Mutual destruction'; }
    else if (pDead) { state.winner = A; state.endReason = 'Your Command Center was destroyed'; }
    else if (aDead) { state.winner = P; state.endReason = 'Enemy Command Center destroyed'; }
    else if (state.turn >= (state.maxTurns || C.MAX_TURNS)) {
      const ph = buildingsOf(state, P, 'hq')[0], ah = buildingsOf(state, A, 'hq')[0];
      const pp = ph.hp / ph.maxHp, ap = ah.hp / ah.maxHp;
      if (Math.abs(pp - ap) < 0.005) {
        const val = side => buildingsOf(state, side).reduce((t, b) => t + B[b.type].cost + (b.level > 1 ? upgradeCost(b.type) : 0), 0);
        const pv = val(P), av = val(A);
        state.winner = pv === av ? 'draw' : (pv > av ? P : A);
      } else {
        state.winner = pp > ap ? P : A;
      }
      state.endReason = 'Turn limit reached — decided on Command Center integrity';
    }

    ev(BEAT.END, { type: 'end', winner: state.winner, destroyed: destroyed.map(b => ({ id: b.id, cell: b.cell, type: b.type, side: b.side })) });
    if (!state.winner) startNextTurn(state);
    return events;
  }

  function bfsReach(state, robot) {
    const seen = new Set([robot.cell]);
    const q = [robot.cell];
    while (q.length) {
      const c = q.shift();
      for (const n of neighbors(c, 1)) {
        if (seen.has(n) || !passable(state, n, robot)) continue;
        seen.add(n); q.push(n);
      }
    }
    return seen;
  }

  const Rules = {
    BEAT, W, H, N,
    idx, xy, inBounds, cheb, dist, neighbors, cellsInRadius, ownerOfCell, enemyOf, hqCell, rand,
    newGame, generateIslands, isLand, apparent, missionMedals, dailyScore, stat, upgradeCost, upgradeInfo, upgrade, buildingsOf, buildingAt, robotAt, robotsOf, income, energyCap,
    visibleEnemyCells, updateIntel, detectedIncoming,
    buildableReason, buildCost, inBuildZone, build, repairInfo, repair, sell, sellValue,
    freeLaunchers, missileReason, queueMissile, strikeReadyReason, strikeReason, queueStrike, dropReadyReason, dropReason, queueDrop, cancelOrder, undo,
    resolveTurn, robotIntent, targetValue,
    // shared with the real-time engine
    damageBuilding, passable, bfsPath, onlineRadars
  };

  root.Rules = Rules;
  if (typeof module !== 'undefined') module.exports = Rules;
})(typeof window !== 'undefined' ? window : globalThis);
