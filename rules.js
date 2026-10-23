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
      missilesFired: 0, missilesHit: 0, intercepts: 0,
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

  function newGame(difficulty, seed) {
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
      sides: { player: newSide(P), ai: newSide(A) }
    };
    for (let i = 0; i < N; i++) state.cells.push({ building: null, crater: 0, scorch: 0 });
    for (const side of [P, A]) {
      placeBuilding(state, side, 'hq', hqCell(side));
      // starting structures, mirrored for the AI
      for (const sb of C.START_BUILDINGS) {
        const h = xy(hqCell(side));
        placeBuilding(state, side, sb.type, idx(h.x + (side === P ? sb.dx : -sb.dx), h.y + sb.dy)).builtTurn = 0;
      }
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
      shots: 0, pool: def.pool || 0,
      fired: false, deployed: false, repaired: 0,
      dead: false, builtTurn: state.turn
    };
    if (type === 'aa') b.shots = def.shots;
    if (type === 'hq') b.shots = 1;
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
    return side === A ? C.DIFFICULTY[state.difficulty].incomeMul : 1;
  }
  function income(state, side) {
    let credits = C.BASE_CREDITS, energy = C.BASE_ENERGY;
    for (const b of buildingsOf(state, side)) {
      if (b.type === 'depot') credits += B.depot.credits;
      if (b.type === 'power') energy += B.power.energy;
    }
    const m = incomeMul(state, side);
    return { credits: Math.round(credits * m), energy: Math.round(energy * m) };
  }
  function energyCap(state, side) {
    return C.ENERGY_CAP_BASE + buildingsOf(state, side, 'power').length * B.power.cap;
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
      for (const c of cellsInRadius(r.cell, B.radar.range)) if (ownerOfCell(c) === foe) out.add(c);
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
      if (b) seen[c] = { type: b.type, hp: b.hp, maxHp: b.maxHp, turn: state.turn };
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
      if (dist(m.to, hq) <= C.INCOMING_HQ_RADIUS + 0.01) return true;
      return radars.some(r => dist(r.cell, m.to) <= B.radar.range + 0.01);
    });
  }

  // ── Building validation ──────────────────────────────────
  function buildableReason(state, side, type, cell) {
    const def = B[type];
    if (!def || type === 'hq') return 'Unknown structure';
    if (cell < 0 || cell >= N) return 'Out of bounds';
    const owner = ownerOfCell(cell);
    if (owner === null) return "No-man's land";
    if (owner !== side) return 'Enemy territory';
    const c = state.cells[cell];
    if (c.building) return 'Cell occupied';
    if (c.crater > 0) return 'Crater (' + c.crater + ' turn' + (c.crater > 1 ? 's' : '') + ')';
    if (robotAt(state, cell)) return 'Mech in the way';
    const own = buildingsOf(state, side);
    if (!own.some(b => cheb(b.cell, cell) <= C.BUILD_RADIUS)) return 'Out of build range';
    if (def.max && buildingsOf(state, side, type).length >= def.max) return 'Max ' + def.max + ' ' + def.name + 's';
    if (state.sides[side].credits < def.cost) return 'Need ' + def.cost + ' credits';
    return null;
  }

  // Cheap check ignoring credits/max — for the build-zone overlay
  function inBuildZone(state, side, cell) {
    if (ownerOfCell(cell) !== side) return false;
    const c = state.cells[cell];
    if (c.building || c.crater > 0 || robotAt(state, cell)) return false;
    return buildingsOf(state, side).some(b => cheb(b.cell, cell) <= C.BUILD_RADIUS);
  }

  function build(state, side, type, cell) {
    const reason = buildableReason(state, side, type, cell);
    if (reason) return { ok: false, reason };
    const s = state.sides[side];
    s.credits -= B[type].cost;
    const b = placeBuilding(state, side, type, cell);
    s.undo.push({ kind: 'build', id: b.id, cell, cost: B[type].cost });
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

  function sellValue(b) { return Math.floor(B[b.type].cost * C.SELL_REFUND * (Math.max(0, b.hp - b.repaired) / b.maxHp)); }

  function sell(state, side, cell) {
    const b = buildingAt(state, cell);
    if (!b || b.side !== side) return { ok: false, reason: 'Nothing to sell' };
    if (b.type === 'hq') return { ok: false, reason: 'Cannot sell the Command Center' };
    if (state.sides[side].orders.some(o => o.from === cell)) return { ok: false, reason: 'Cancel its orders first' };
    const value = sellValue(b);
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

  function dropReason(state, side, to) {
    if (ownerOfCell(to) !== enemyOf(side)) return 'Drop zone must be in enemy territory';
    if (cheb(to, hqCell(enemyOf(side))) <= C.DROP_HQ_EXCLUSION) return 'Too close to the enemy HQ (air defense zone)';
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
      s.credits += u.cost;
      s.stats.built--;
      return { ok: true, kind: 'build', building: b };
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
      if (b.type === 'aa') b.shots = B.aa.shots;
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
      if (b && b.type === 'shield') b.pool = Math.min(B.shield.pool, b.pool + B.shield.regen);
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
  function damageBuilding(state, b, amount, attacker, events) {
    let absorbed = 0, shieldCell = -1, shieldPool = 0;
    for (const s of buildingsOf(state, b.side, 'shield')) {
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
    return { cell: b.cell, id: b.id, type: b.type, side: b.side, dmg, absorbed, shieldCell, shieldPool, hpAfter: b.hp, maxHp: b.maxHp, destroyed };
  }

  function targetValue(state, cell) {
    const b = buildingAt(state, cell);
    if (!b) return 0;
    return { hq: 10, silo: 8, aa: 7, hangar: 6, power: 5, depot: 4, shield: 4, radar: 3, gunpod: 3 }[b.type] || 1;
  }

  // ── Robot pathfinding (8-way BFS avoiding buildings and robots) ──
  function passable(state, cell, self) {
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
  function resolveTurn(state) {
    const events = [];
    const ev = (beat, e) => { e.beat = beat; events.push(e); return e; };
    const sideOf = s => state.sides[s];

    // 1. DESCENT of missiles launched last turn, AA assignment
    const incoming = state.missiles;
    state.missiles = [];
    for (const def of [P, A]) {
      const ms = incoming.filter(m => ownerOfCell(m.to) === def)
        .sort((a, b) => targetValue(state, b.to) - targetValue(state, a.to) || a.id - b.id);
      const batteries = buildingsOf(state, def).filter(b => b.type === 'aa' || b.type === 'hq');
      const covers = (bat, m) => dist(bat.cell, m.to) <= (bat.type === 'aa' ? B.aa.range : B.hq.range) + 0.01;
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
          const hit = rand(state) < B[best.type].hitChance;
          shots.push({ by: best.cell, hit });
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
      sideOf(atk).stats.missilesHit++;
      const hits = [];
      const direct = buildingAt(state, m.to);
      if (direct) hits.push(damageBuilding(state, direct, C.MISSILE_DAMAGE, atk, events));
      for (const n of neighbors(m.to, 1)) {
        const b = buildingAt(state, n);
        if (b && b.side !== atk) hits.push(damageBuilding(state, b, C.MISSILE_SPLASH, atk, events));
      }
      state.cells[m.to].scorch = 1;
      // Impact reveals the area for the attacker next planning phase
      const reveal = [m.to].concat(neighbors(m.to, C.IMPACT_REVEAL_RADIUS)).filter(c => ownerOfCell(c) === enemyOf(atk));
      sideOf(atk).intel.nextReveal = (sideOf(atk).intel.nextReveal || []).concat(reveal);
      ev(BEAT.IMPACT, { type: 'impact', id: m.id, side: atk, cell: m.to, hits, reveal });
    }

    // 3. GUN PODS fire at enemy robots
    for (const side of [P, A]) {
      // Gun Pods, plus the Command Center's own close-defense gun
      for (const g of buildingsOf(state, side).filter(b => b.type === 'gunpod' || b.type === 'hq')) {
        const gun = g.type === 'hq' ? B.hq.gun : B.gunpod;
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
      const foe = enemyOf(r.side);
      // Adjacent target? HQ first, then lowest HP
      let adj = null;
      for (const n of neighbors(r.cell, 1)) {
        const b = buildingAt(state, n);
        if (!b || b.side !== foe) continue;
        if (!adj || (b.type === 'hq' && adj.type !== 'hq') || (adj.type !== 'hq' && b.hp < adj.hp)) adj = b;
      }
      if (adj) {
        const hit = damageBuilding(state, adj, C.ROBOT_DAMAGE, r.side, events);
        ev(BEAT.ROBOTS, { type: 'robotHit', id: r.id, side: r.side, cell: r.cell, hit });
        continue;
      }
      const tgt = robotTarget(state, r);
      if (!tgt) continue;
      let path = bfsPath(state, r, c => cheb(c, tgt.cell) <= 1);
      if (!path) {
        // Unreachable: approach as close as possible
        let best = r.cell, bd = dist(r.cell, tgt.cell);
        const reach = bfsReach(state, r);
        for (const c of reach) { const d = dist(c, tgt.cell); if (d < bd) { bd = d; best = c; } }
        path = best === r.cell ? [] : bfsPath(state, r, c => c === best);
      }
      if (path && path.length) {
        const steps = path.slice(0, C.ROBOT_MOVE);
        const fromCell = r.cell;
        r.cell = steps[steps.length - 1];
        ev(BEAT.ROBOTS, { type: 'robotMove', id: r.id, side: r.side, from: fromCell, path: steps, facing: tgt.cell });
      }
    }

    // 5. DROP PODS land
    for (const side of [P, A]) {
      for (const o of sideOf(side).orders.filter(o => o.kind === 'drop')) {
        const hangar = buildingAt(state, o.from);
        if (!hangar) { ev(BEAT.DROPS, { type: 'cancelled', kind: 'drop', side, from: o.from }); continue; }
        hangar.deployed = true;
        let cell = o.to;
        if (!passable(state, cell, null)) {
          // scatter to nearest free cell in enemy territory
          let best = -1, bd = Infinity;
          for (let i = 0; i < N; i++) {
            if (ownerOfCell(i) !== enemyOf(side) || !passable(state, i, null)) continue;
            const d = dist(i, o.to);
            if (d < bd) { bd = d; best = i; }
          }
          cell = best;
        }
        if (cell < 0) { ev(BEAT.DROPS, { type: 'cancelled', kind: 'drop', side, from: o.from }); continue; }
        const robot = { id: state.nextId++, side, cell, hp: C.ROBOT_HP, maxHp: C.ROBOT_HP, fresh: true };
        state.robots.push(robot);
        sideOf(side).stats.robotsDeployed++;
        ev(BEAT.DROPS, { type: 'drop', side, from: o.from, to: cell, aimed: o.to, robot: Object.assign({}, robot) });
      }
    }

    // 6. LAUNCHES (land next turn)
    for (const side of [P, A]) {
      for (const o of sideOf(side).orders.filter(o => o.kind === 'missile')) {
        const silo = buildingAt(state, o.from);
        if (!silo) { ev(BEAT.LAUNCH, { type: 'cancelled', kind: 'missile', side, from: o.from }); continue; }
        silo.fired = true;
        const m = { id: state.nextId++, side, from: o.from, to: o.to };
        state.missiles.push(m);
        sideOf(side).stats.missilesFired++;
        ev(BEAT.LAUNCH, { type: 'launch', id: m.id, side, from: o.from, to: o.to });
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
    else if (state.turn >= C.MAX_TURNS) {
      const ph = buildingsOf(state, P, 'hq')[0], ah = buildingsOf(state, A, 'hq')[0];
      const pp = ph.hp / ph.maxHp, ap = ah.hp / ah.maxHp;
      if (Math.abs(pp - ap) < 0.005) {
        const val = side => buildingsOf(state, side).reduce((t, b) => t + B[b.type].cost, 0);
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
    newGame, buildingsOf, buildingAt, robotAt, robotsOf, income, energyCap,
    visibleEnemyCells, updateIntel, detectedIncoming,
    buildableReason, inBuildZone, build, repairInfo, repair, sell, sellValue,
    freeLaunchers, missileReason, queueMissile, dropReason, queueDrop, cancelOrder, undo,
    resolveTurn, targetValue
  };

  root.Rules = Rules;
  if (typeof module !== 'undefined') module.exports = Rules;
})(typeof window !== 'undefined' ? window : globalThis);
