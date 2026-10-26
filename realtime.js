// ============================================================
// Robot Attack 2026 — Real-time engine (Metal Marines style)
// ============================================================
// The turn-based rules (rules.js) settle a whole turn at once. This engine runs the same
// board continuously: credits and energy flow every second, silos and hangars reload on
// timers, attacks launch whenever a side chooses, missiles and dropships are visible in
// flight (the defender is warned the moment they lift off), AA batteries reload between
// shots, and landed mechs fight inside a small zone for a limited time before their
// dropship takes them home.
//
// Pure logic: no DOM, no Three.js, no timers. step(state, dt) advances the simulation in
// fixed ticks and returns the events that happened, for the presentation layer.
// Building, repairing, upgrading and selling use the rules.js functions unchanged.

(function (root) {
  'use strict';

  const cfg = (typeof CONST !== 'undefined') ? null : require('./config.js');
  const C = cfg ? cfg.CONST : CONST;
  const B = cfg ? cfg.BUILDINGS : BUILDINGS;
  const UP = cfg ? cfg.UPGRADES : UPGRADES;
  const T = cfg ? cfg.RT : RT;
  const R = (typeof Rules !== 'undefined') ? Rules : require('./rules.js');
  const P = C.SIDE_PLAYER, A = C.SIDE_AI;

  // ── Setup ─────────────────────────────────────────────────
  // Turns an ordinary new game (R.newGame) into a real-time one.
  function init(state) {
    state.realtime = true;
    state.missiles = [];
    state.locked = (state.locked || []).filter(t => t !== 'factory');   // factories are a real-time structure
    state.rt = {
      t: 0, acc: 0,
      timeLimit: (state.maxTurns || C.MAX_TURNS) * T.CLOCK_PER_TURN,
      nextRound: T.ROUND, nextIntel: 1,
      flights: [],            // missiles, strikes and dropships, pending or in the air
      shots: [],              // interceptors on their way
      frac: { player: { c: 0, e: 0 }, ai: { c: 0, e: 0 } },
      reveals: { player: [], ai: [] },
      think: { player: 0.5, ai: 0.5 },
      ai: { player: {}, ai: {} }   // per-side AI memory
    };
    // a short calm before the first salvo: the starting silo finishes loading START_LOAD in
    for (const side of [P, A]) for (const b of R.buildingsOf(state, side)) if (b.type === 'silo' || b.type === 'hangar') b.readyAt = b.type === 'silo' ? T.START_LOAD : reloadOf(b) / 2;
    // Metal Marines: several bases per side, spread out; all of them must fall
    state.rt.baseMax = {};
    for (const side of [P, A]) {
      for (const hq of R.buildingsOf(state, side, 'hq')) { hq.maxHp = T.HQ_HP; hq.hp = Math.min(hq.hp, T.HQ_HP); }
      placeBases(state, side, T.BASES_PER_SIDE);
      state.rt.baseMax[side] = bases(state, side).reduce((n, b) => n + b.maxHp, 0);
    }
    return state;
  }

  // The structures that count for victory: the Command Center and every Base
  function bases(state, side) { return R.buildingsOf(state, side).filter(b => b.type === 'hq' || b.type === 'base'); }

  // Bases go as far as possible from each other (and the HQ), on open ground with room around
  function placeBases(state, side, n) {
    const taken = bases(state, side).map(b => b.cell);
    for (let k = 0; k < n; k++) {
      let best = -1, bd = -1;
      for (let c = 0; c < R.N; c++) {
        if (R.ownerOfCell(c) !== side || !R.isLand(state, c) || state.cells[c].building) continue;
        const ring = R.neighbors(c, 1);
        if (ring.length < 8 || ring.some(x => !R.isLand(state, x) || state.cells[x].building)) continue;
        const d = Math.min(...taken.map(x => R.dist(x, c)));
        if (d > bd + 1e-9) { bd = d; best = c; }
      }
      if (best < 0) return;
      const id = state.nextId++;
      const b = { id, type: 'base', side, cell: best, hp: B.base.hp, maxHp: B.base.hp, shots: 0, pool: 0, level: 1,
        fired: false, deployed: false, repaired: 0, dead: false, builtTurn: 0, progress: 1 };
      state.cells[best].building = b;
      taken.push(best);
    }
  }

  // ── Factories and construction ────────────────────────────
  // Online factories, an Assembly Line counting twice
  function factories(state, side) {
    return R.buildingsOf(state, side, 'factory').filter(R.online).reduce((n, b) => n + (R.stat(b, 'factories') || 1), 0);
  }
  function buildSpeed(state, side) { return 1 + T.FACTORY_BUILD_BOOST * factories(state, side); }
  function reloadSpeed(state, side) { return 1 + T.FACTORY_RELOAD_BOOST * factories(state, side); }
  // Seconds until a structure under construction is finished at the current speed
  function buildLeft(state, b) {
    if (R.online(b)) return 0;
    return (1 - b.progress) * (T.BUILD_TIME[b.type] || 8) / buildSpeed(state, b.side);
  }

  // ── Launcher readiness ────────────────────────────────────
  function reloadOf(b) { return b.type === 'silo' ? T.SILO_RELOAD : T.HANGAR_RELOAD; }
  function isReady(state, b) {
    if (!R.online(b)) return false;
    if (b.type === 'hangar' && b.out) return false;
    return (b.readyAt || 0) <= state.rt.t + 1e-6;
  }
  function readyLaunchers(state, side, type) {
    return R.buildingsOf(state, side, type).filter(b => isReady(state, b));
  }
  // Seconds until a launcher is ready (0 if ready, null while its mech is away)
  function readyIn(state, b) {
    if (!R.online(b)) return buildLeft(state, b) + reloadOf(b) / 2 / reloadSpeed(state, b.side);
    if (b.type === 'hangar' && b.out) return null;
    return Math.max(0, (b.readyAt || 0) - state.rt.t);
  }

  // Cells a dropship can set mechs down on around `to`
  function landingCells(state, side, to) {
    const owner = R.ownerOfCell(to);
    if (owner === null) return [];
    const raid = owner !== side, foeHq = R.hqCell(R.enemyOf(side));
    const out = [];
    for (const c of [to].concat(R.neighbors(to, T.MECH_ZONE))) {
      if (R.ownerOfCell(c) !== owner || !R.passable(state, c, null)) continue;
      if (raid && R.cheb(c, foeHq) <= C.DROP_HQ_EXCLUSION) continue;
      out.push(c);
    }
    return out.sort((a, b) => R.dist(a, to) - R.dist(b, to));
  }

  function mechsCommitted(state, side) {
    let n = R.robotsOf(state, side).length;
    for (const f of state.rt.flights) if (f.kind === 'ship' && f.side === side && !f.done) n += f.mechs.length;
    return n;
  }

  // ── Attacks ───────────────────────────────────────────────
  // As in Metal Marines, one attack sends each missile at its own target, and all its mechs
  // land together:  a = { missiles: [{ from: siloCell, to }], hangars: [cells], landing, strikeTo }
  // The short form { to, silos, hangars, strike } sends everything at one cell.
  function norm(a) {
    if (a.missiles || a.landing !== undefined || a.strikeTo !== undefined) return { missiles: a.missiles || [], hangars: a.hangars || [], landing: a.landing, strikeTo: a.strikeTo };
    return { missiles: (a.silos || []).map(c => ({ from: c, to: a.to })), hangars: a.hangars || [], landing: a.to, strikeTo: a.strike ? a.to : undefined };
  }
  function attackCost(a) {
    a = norm(a);
    return a.missiles.length * C.MISSILE_ENERGY + a.hangars.length * C.DROP_ENERGY + (a.strikeTo !== undefined ? C.STRIKE_ENERGY : 0);
  }

  function attackReason(state, side, raw) {
    const a = norm(raw);
    const foe = R.enemyOf(side);
    if (!a.missiles.length && !a.hangars.length && a.strikeTo === undefined) return 'Pick at least one missile, mech or strike';
    if (a.missiles.length > T.MAX_MISSILES_PER_ATTACK) return 'Up to ' + T.MAX_MISSILES_PER_ATTACK + ' missiles per attack';
    const used = new Set();
    for (const m of a.missiles) {
      const b = R.buildingAt(state, m.from);
      if (!b || b.side !== side || b.type !== 'silo') return 'Not one of your silos';
      if (used.has(m.from)) return 'Each silo fires once per attack';
      used.add(m.from);
      if (!R.online(b)) return 'That silo is still under construction';
      if (!isReady(state, b)) return 'Silo ' + m.from + ' is reloading';
      if (m.to === undefined || R.ownerOfCell(m.to) !== foe) return 'Missiles must target enemy territory';
    }
    if (a.hangars.length) {
      if (a.hangars.length > T.MECHS_PER_SHIP) return 'A dropship carries ' + T.MECHS_PER_SHIP + ' mechs';
      for (const c of a.hangars) {
        const b = R.buildingAt(state, c);
        if (!b || b.side !== side || b.type !== 'hangar') return 'Not one of your hangars';
        if (!isReady(state, b)) return 'Hangar is not ready';
      }
      if (a.landing === undefined) return 'Pick where the mechs land';
      const owner = R.ownerOfCell(a.landing);
      if (owner !== side && owner !== foe) return 'Mechs must land on an island';
      if (mechsCommitted(state, side) + a.hangars.length > C.MAX_ROBOTS) return 'Max ' + C.MAX_ROBOTS + ' mechs in the field';
      if (!R.isLand(state, a.landing)) return 'Mechs need land to drop on';
      if (!landingCells(state, side, a.landing).length) return owner === foe ? 'No landing zone there (enemy HQ air defense)' : 'No free ground there';
    }
    if (a.strikeTo !== undefined) {
      const up = R.buildingsOf(state, side, 'uplink')[0];
      if (!up) return 'Build a Strike Uplink first';
      if (!R.online(up)) return 'The uplink is still under construction';
      if (up.charge < C.STRIKE_CHARGE) return 'Uplink charging';
      if (R.ownerOfCell(a.strikeTo) !== foe) return 'The strike must target enemy territory';
    }
    const cost = attackCost(a);
    if (state.sides[side].energy < cost) return 'Need ' + cost + ' energy';
    return null;
  }

  function flightTime(kind, from, to) {
    const base = kind === 'ship' ? T.SHIP_FLIGHT : kind === 'strike' ? T.STRIKE_FLIGHT : T.MISSILE_FLIGHT;
    return base + (kind === 'strike' ? 0 : R.dist(from, to) * 0.03);
  }

  function launchAttack(state, side, raw) {
    const reason = attackReason(state, side, raw);
    if (reason) return { ok: false, reason };
    const a = norm(raw);
    const rt = state.rt, t = rt.t, s = state.sides[side];
    s.energy -= attackCost(a);
    const ids = [];
    let at = t;
    // the strike first (it never misses), then missiles one after another, then the dropship
    if (a.strikeTo !== undefined) {
      const up = R.buildingsOf(state, side, 'uplink')[0];
      up.charge = 0;
      rt.flights.push(newFlight(state, 'strike', side, up.cell, a.strikeTo, at, { dmg: C.STRIKE_DAMAGE, splash: Math.round(C.STRIKE_SPLASH * T.STRIKE_SPLASH_MUL), cost: C.STRIKE_ENERGY }));
      ids.push(rt.flights[rt.flights.length - 1].id);
      at += T.SALVO_GAP;
    }
    for (const m of a.missiles) {
      const c = m.from, silo = R.buildingAt(state, c);
      silo.readyAt = at + T.SILO_RELOAD / reloadSpeed(state, side);
      rt.flights.push(newFlight(state, 'missile', side, c, m.to, at, {
        dmg: R.stat(silo, 'dmg') || C.MISSILE_DAMAGE, splash: R.stat(silo, 'splash') || C.MISSILE_SPLASH, cost: C.MISSILE_ENERGY
      }));
      ids.push(rt.flights[rt.flights.length - 1].id);
      at += T.SALVO_GAP;
    }
    if (a.hangars.length) {
      const mechs = a.hangars.map(c => {
        const h = R.buildingAt(state, c);
        h.out = true;
        const heavy = h.level > 1;
        const hp = heavy ? UP.hangar.mechHp : C.ROBOT_HP;
        return { hangar: c, hp, maxHp: hp, dmg: heavy ? UP.hangar.mechDmg : C.ROBOT_DAMAGE, heavy };
      });
      // the ship leaves from the hangar nearest the target
      const from = a.hangars.slice().sort((x, y) => R.dist(x, a.landing) - R.dist(y, a.landing))[0];
      rt.flights.push(newFlight(state, 'ship', side, from, a.landing, at + T.SHIP_DELAY - T.SALVO_GAP, {
        mechs, hull: T.SHIP_HULL + mechs.length - 1, cost: C.DROP_ENERGY * mechs.length
      }));
      ids.push(rt.flights[rt.flights.length - 1].id);
    }
    return { ok: true, ids };
  }

  function newFlight(state, kind, side, from, to, launchAt, extra) {
    return Object.assign({
      id: state.nextId++, kind, side, from, to, launchAt,
      flight: flightTime(kind, from, to), launched: false, done: false
    }, extra);
  }

  // Can `side` see where a flight is headed? (radar coverage or near its HQ; strikes always)
  function detects(state, side, f) {
    if (f.kind === 'strike') return true;
    if (R.dist(f.to, R.hqCell(side)) <= C.INCOMING_HQ_RADIUS + 0.01) return true;
    return R.onlineRadars(state, side).some(r => R.dist(r.cell, f.to) <= R.stat(r, 'range') + 0.01);
  }

  function progress(state, f) { return f.launched ? (state.rt.t - f.launchAt) / f.flight : 0; }

  // ── Simulation ────────────────────────────────────────────
  // opts.ai: the sides the built-in AI plays (e.g. ['ai']); opts.brain: the AI module
  function step(state, dt, opts) {
    const events = [];
    if (!state.rt || state.winner) return events;
    opts = opts || {};
    const rt = state.rt;
    rt.acc += Math.min(dt, 1);
    while (rt.acc >= T.TICK - 1e-9 && !state.winner) {
      rt.acc -= T.TICK;
      tick(state, events, opts);
    }
    return events;
  }

  function tick(state, events, opts) {
    const rt = state.rt;
    const dt = T.TICK;
    rt.t = Math.round((rt.t + dt) * 1000) / 1000;
    const t = rt.t;
    const ev = e => { e.t = t; events.push(e); return e; };

    // 1. Economy: one turn's income arrives over ROUND seconds
    for (const side of [P, A]) {
      const s = state.sides[side], f = rt.frac[side], inc = R.income(state, side);
      f.c += inc.credits * dt / T.ROUND;
      f.e += inc.energy * dt / T.ROUND;
      const dc = Math.floor(f.c + 1e-6), de = Math.floor(f.e + 1e-6);
      if (dc) { s.credits += dc; f.c -= dc; }
      if (de) { s.energy = Math.min(R.energyCap(state, side), s.energy + de); f.e -= de; }
    }
    // construction, then shields recharge and uplinks charge continuously
    const speed = { player: buildSpeed(state, P), ai: buildSpeed(state, A) };
    for (let i = 0; i < R.N; i++) {
      const b = state.cells[i].building;
      if (!b || b.dead) continue;
      if (!R.online(b)) {
        b.progress = Math.min(1, b.progress + dt * speed[b.side] / (T.BUILD_TIME[b.type] || 8));
        if (b.progress < 1 - 1e-9) continue;
        b.progress = 1;
        b.doneAt = t;
        if (b.type === 'shield') b.pool = R.stat(b, 'pool');
        // a new launcher starts half loaded
        if (b.type === 'silo' || b.type === 'hangar') b.readyAt = t + reloadOf(b) / 2 / reloadSpeed(state, b.side);
        ev({ type: 'built', id: b.id, side: b.side, cell: b.cell, kind: b.type });
        continue;
      }
      if (b.type === 'shield') {
        // whole points only, so damage (and HP, and repair bills) stay whole numbers
        b.poolAcc = (b.poolAcc || 0) + R.stat(b, 'regen') * dt / T.ROUND;
        const whole = Math.floor(b.poolAcc + 1e-6);
        if (whole) { b.pool = Math.min(R.stat(b, 'pool'), Math.floor(b.pool) + whole); b.poolAcc -= whole; }
      }
      if (b.type === 'uplink') b.charge = Math.min(C.STRIKE_CHARGE, (b.charge || 0) + C.STRIKE_CHARGE * dt / T.STRIKE_CHARGE_TIME);
      if ((b.type === 'silo' || b.type === 'hangar') && b.readyAt === undefined) b.readyAt = t + reloadOf(b) / 2;
    }

    // 2. Rounds: the turn counter keeps radar start-up, craters and repair allowances working
    if (t >= rt.nextRound - 1e-6) {
      rt.nextRound += T.ROUND;
      state.turn++;
      for (let i = 0; i < R.N; i++) {
        const c = state.cells[i];
        if (c.crater > 0) c.crater--;
        if (c.building) c.building.repaired = 0;
      }
      for (const side of [P, A]) state.sides[side].undo = [];
      ev({ type: 'round', turn: state.turn });
    }

    // 3. AI decisions
    const brain = opts.brain || root.AI;
    for (const side of opts.ai || []) {
      if (t < rt.think[side] || !brain || !brain.thinkRealtime) continue;
      rt.think[side] = t + T.AI_THINK * (C.DIFFICULTY[state.difficulty].smart ? 1 : 2);
      brain.thinkRealtime(state, side, api);
    }

    // 4. Flights: lift-off, AA, interceptions, impacts and landings
    for (const f of rt.flights) {
      if (f.done || f.launched || t < f.launchAt) continue;
      const launcher = R.buildingAt(state, f.from);
      if (!launcher || launcher.side !== f.side) {
        f.done = true;
        state.sides[f.side].energy += f.cost || 0;
        if (f.kind === 'ship') for (const m of f.mechs) mechHome(state, m.hangar);
        ev({ type: 'cancelled', kind: f.kind, side: f.side, from: f.from, refund: f.cost || 0, id: f.id });
        continue;
      }
      f.launched = true;
      if (f.kind === 'missile') state.sides[f.side].stats.missilesFired++;
      if (f.kind === 'strike') state.sides[f.side].stats.strikes = (state.sides[f.side].stats.strikes || 0) + 1;
      ev({ type: 'launch', id: f.id, kind: f.kind, side: f.side, from: f.from, to: f.to, flight: f.flight,
        mechs: f.mechs ? f.mechs.length : 0, detected: detects(state, R.enemyOf(f.side), f) });
    }
    engage(state, ev);
    for (const sh of rt.shots) {
      if (sh.done || t < sh.at - 1e-6) continue;
      sh.done = true;
      const f = rt.flights.find(x => x.id === sh.flight);
      if (!f || f.done) continue;
      // a battery destroyed while its interceptor was in the air loses guidance
      const bat = R.buildingAt(state, sh.by);
      if (!bat || bat.id !== sh.byId) { ev({ type: 'aaMiss', id: f.id, side: f.side, by: sh.by, lost: true }); continue; }
      if (!sh.hit) { ev({ type: 'aaMiss', id: f.id, side: f.side, by: sh.by }); continue; }
      const def = state.sides[R.enemyOf(f.side)].stats;
      if (f.kind === 'missile') {
        f.done = true;
        def.intercepts++;
        ev({ type: 'intercept', id: f.id, side: f.side, to: f.to, by: sh.by, chance: sh.chance });
      } else if (f.kind === 'ship') {
        f.hull--;
        ev({ type: 'shipHit', id: f.id, side: f.side, to: f.to, by: sh.by, hull: f.hull });
        if (f.hull <= 0) {
          f.done = true;
          state.sides[f.side].stats.robotsLost += f.mechs.length;
          def.robotsKilled += f.mechs.length;
          for (const m of f.mechs) mechHome(state, m.hangar);
          ev({ type: 'shipDown', id: f.id, side: f.side, to: f.to, mechs: f.mechs.length });
        }
      }
    }
    rt.shots = rt.shots.filter(sh => !sh.done);
    for (const f of rt.flights) {
      if (f.done || !f.launched || progress(state, f) < 1) continue;
      f.done = true;
      if (f.kind === 'ship') land(state, f, ev);
      else impact(state, f, ev, events);
    }
    rt.flights = rt.flights.filter(f => !f.done);
    state.missiles = rt.flights.filter(f => f.launched && f.kind !== 'ship')
      .map(f => ({ id: f.id, side: f.side, from: f.from, to: f.to, strike: f.kind === 'strike' }));

    // 5. Gun pods and Command Center guns shoot at mechs in range
    gunnery(state, ev);

    // 6. Mechs
    mechs(state, ev, events);

    // 7. Cleanup, intel and the end of the game
    const destroyed = [];
    for (let i = 0; i < R.N; i++) {
      const b = state.cells[i].building;
      if (b && b.dead) {
        destroyed.push({ id: b.id, cell: b.cell, type: b.type, side: b.side });
        state.cells[i].building = null;
        state.cells[i].crater = C.CRATER_TURNS + 1;
      }
    }
    for (const r of state.robots) if (r.hp <= 0) mechHome(state, r.hangar);
    state.robots = state.robots.filter(r => r.hp > 0);
    if (destroyed.length) ev({ type: 'destroyed', list: destroyed });
    if (t >= rt.nextIntel - 1e-6 || destroyed.length) {
      rt.nextIntel = t + 1;
      for (const side of [P, A]) {
        rt.reveals[side] = rt.reveals[side].filter(r => r.until > t);
        state.sides[side].intel.reveal = [...new Set(rt.reveals[side].map(r => r.c))];
        R.updateIntel(state, side);
      }
    }
    endCheck(state, destroyed, ev);
  }

  function reveal(state, side, cells) {
    const until = state.rt.t + T.REVEAL_TIME;
    for (const c of cells) state.rt.reveals[side].push({ c, until });
  }

  // AA batteries and HQ point defence pick targets as they reload
  function engage(state, ev) {
    const rt = state.rt, t = rt.t;
    for (const def of [P, A]) {
      const batteries = R.buildingsOf(state, def).filter(b => (b.type === 'aa' || b.type === 'hq') && R.online(b));
      const radars = R.onlineRadars(state, def);
      for (const bat of batteries) {
        if ((bat.reloadAt || 0) > t) continue;
        const range = R.stat(bat, 'range');
        let best = null, bp = -1;
        for (const f of rt.flights) {
          if (f.done || !f.launched || f.side === def || f.kind === 'strike') continue;
          const p = progress(state, f);
          if (p < T.ENGAGE_FROM || (t + T.SHOT_TIME - f.launchAt) / f.flight >= 1) continue;
          if (R.dist(bat.cell, f.to) > range + 0.01) continue;
          const pending = rt.shots.filter(sh => !sh.done && sh.flight === f.id).length;
          if (f.kind === 'missile' ? pending > 0 : pending >= f.hull) continue;
          if (p > bp) { bp = p; best = f; }
        }
        if (!best) continue;
        bat.reloadAt = t + (bat.type === 'hq' ? T.HQ_PD_RELOAD : T.AA_RELOAD * (bat.level > 1 ? 0.75 : 1));
        // Metal Marines: radar guides the batteries in its range
        const guided = bat.type === 'aa' && radars.some(r => R.dist(r.cell, bat.cell) <= R.stat(r, 'range') + 0.01);
        const chance = Math.min(T.AA_MAX_CHANCE, R.stat(bat, 'hitChance') + (guided ? T.RADAR_AA_BOOST : 0));
        const hit = R.rand(state) < chance;
        rt.shots.push({ by: bat.cell, byId: bat.id, flight: best.id, hit, chance, at: t + T.SHOT_TIME });
        if (bat.type === 'aa') reveal(state, best.side, [bat.cell]);
        ev({ type: 'aaShot', side: def, by: bat.cell, byId: bat.id, id: best.id, kind: best.kind, hit, chance, travel: T.SHOT_TIME });
      }
    }
  }

  function impact(state, f, ev, events) {
    const atk = f.side, sd = state.sides;
    if (f.kind === 'missile') sd[atk].stats.missilesHit++;
    const hits = [];
    const direct = R.buildingAt(state, f.to);
    if (direct) hits.push(R.damageBuilding(state, direct, f.dmg, atk, events));
    for (const n of R.neighbors(f.to, 1)) {
      const b = R.buildingAt(state, n);
      if (b && b.side !== atk) hits.push(R.damageBuilding(state, b, f.splash, atk, events));
    }
    if (f.kind === 'missile') {
      const def = sd[R.enemyOf(atk)].stats;
      def.missileDamageTaken = (def.missileDamageTaken || 0) + hits.reduce((tot, h) => tot + h.dmg, 0);
    }
    state.cells[f.to].scorch = 1;
    const rev = [f.to].concat(R.neighbors(f.to, C.IMPACT_REVEAL_RADIUS)).filter(c => R.ownerOfCell(c) === R.enemyOf(atk));
    reveal(state, atk, rev);
    ev({ type: 'impact', id: f.id, side: atk, cell: f.to, hits, reveal: rev, strike: f.kind === 'strike' });
  }

  function land(state, f, ev) {
    const cells = landingCells(state, f.side, f.to);
    const robots = [];
    const garrison = R.ownerOfCell(f.to) === f.side;
    f.mechs.forEach((m, i) => {
      const cell = cells[i];
      if (cell === undefined) { mechHome(state, m.hangar); return; }
      const r = {
        id: state.nextId++, side: f.side, cell, hp: m.hp, maxHp: m.maxHp, dmg: m.dmg, heavy: m.heavy,
        hangar: m.hangar, zone: f.to, garrison, leaveAt: state.rt.t + T.MECH_TIME, nextAct: state.rt.t + 1 + i * 0.35
      };
      state.robots.push(r);
      state.sides[f.side].stats.robotsDeployed++;
      robots.push(Object.assign({}, r));
    });
    ev({ type: 'deploy', id: f.id, side: f.side, to: f.to, garrison, robots });
    if (!garrison && robots.length) scramble(state, R.enemyOf(f.side), f.to, ev);
  }

  // Metal Marines: mechs waiting in their hangars activate to defend the base (up to three)
  function scramble(state, side, zone, ev) {
    const out = [];
    const ready = readyLaunchers(state, side, 'hangar').sort((a, b) => R.dist(a.cell, zone) - R.dist(b.cell, zone));
    for (const h of ready) {
      if (out.length >= T.DEFENDERS || mechsCommitted(state, side) >= C.MAX_ROBOTS) break;
      const cell = R.neighbors(h.cell, 1).filter(c => R.passable(state, c, null)).sort((a, b) => R.dist(a, zone) - R.dist(b, zone))[0];
      if (cell === undefined) continue;
      h.out = true;
      const heavy = h.level > 1, hp = heavy ? UP.hangar.mechHp : C.ROBOT_HP;
      const r = {
        id: state.nextId++, side, cell, hp, maxHp: hp, dmg: heavy ? UP.hangar.mechDmg : C.ROBOT_DAMAGE, heavy,
        hangar: h.cell, zone, garrison: true, defender: true, step: T.DEFENDER_STEP,
        leaveAt: state.rt.t + T.DEFENDER_TIME, nextAct: state.rt.t + 0.5
      };
      state.robots.push(r);
      state.sides[side].stats.robotsDeployed++;
      out.push(Object.assign({}, r));
    }
    if (out.length) ev({ type: 'scramble', side, zone, robots: out });
  }

  // A mech came home (or was lost): its hangar starts building the next one
  function mechHome(state, hangarCell) {
    const h = R.buildingAt(state, hangarCell);
    if (!h || h.type !== 'hangar' || !h.out) return;
    h.out = false;
    h.readyAt = state.rt.t + T.HANGAR_RELOAD / reloadSpeed(state, h.side);
  }

  function gunnery(state, ev) {
    const t = state.rt.t;
    for (const side of [P, A]) {
      for (const g of R.buildingsOf(state, side).filter(b => (b.type === 'gunpod' || b.type === 'hq') && R.online(b))) {
        if ((g.gunAt || 0) > t) continue;
        const gun = g.type === 'hq' ? B.hq.gun : { shots: R.stat(g, 'shots'), damage: B.gunpod.damage, range: B.gunpod.range };
        const shots = [];
        for (let k = 0; k < gun.shots; k++) {
          let tgt = null;
          for (const r of state.robots) {
            if (r.side === side || r.hp <= 0 || R.dist(g.cell, r.cell) > gun.range + 0.01) continue;
            if (!tgt || r.hp < tgt.hp || (r.hp === tgt.hp && r.id < tgt.id)) tgt = r;
          }
          if (!tgt) break;
          tgt.hp = Math.max(0, tgt.hp - gun.damage);
          const killed = tgt.hp <= 0;
          if (killed) { state.sides[side].stats.robotsKilled++; state.sides[tgt.side].stats.robotsLost++; }
          shots.push({ robotId: tgt.id, robotSide: tgt.side, cell: tgt.cell, dmg: gun.damage, hpAfter: tgt.hp, killed });
          reveal(state, tgt.side, [g.cell]);
        }
        if (!shots.length) continue;
        g.gunAt = t + (g.type === 'hq' ? T.HQ_GUN_RELOAD : T.GUN_RELOAD);
        ev({ type: 'gunfire', side, from: g.cell, gunType: g.type, shots });
      }
    }
  }

  // What a landed mech does next: it only fights inside its zone
  function inZone(r, cell, extra) { return R.cheb(cell, r.zone) <= T.MECH_ZONE + (extra || 0); }
  function mechIntent(state, r) {
    const foe = R.enemyOf(r.side);
    let duel = null;
    for (const o of state.robots) {
      if (o.side === r.side || o.hp <= 0 || R.cheb(o.cell, r.cell) > 1) continue;
      if (!duel || o.hp < duel.hp) duel = o;
    }
    if (r.garrison) {
      if (duel) return { kind: 'fight', robot: duel };
      // defenders hunt raiders anywhere on their island; a dropped garrison guards its zone
      const prey = state.robots.filter(o => o.side === foe && o.hp > 0 && R.ownerOfCell(o.cell) === r.side && (r.defender || R.dist(o.cell, r.zone) <= T.MECH_ZONE + 3))
        .sort((a, b) => R.dist(a.cell, r.cell) - R.dist(b.cell, r.cell))[0];
      if (!prey) return r.defender ? { kind: 'done' } : { kind: 'hold' };
      const path = R.bfsPath(state, r, c => R.cheb(c, prey.cell) <= 1);
      return path && path.length ? { kind: 'move', path: path.slice(0, 1), facing: prey.cell } : { kind: 'hold' };
    }
    // Metal Marines priorities: fight mechs that close in, then a base if one is close, then
    // gun pods, then the nearest building, all inside the landing zone
    if (duel) return { kind: 'fight', robot: duel };
    const targets = R.buildingsOf(state, foe).filter(b => inZone(r, b.cell, 1));
    if (!targets.length) {
      const foeMech = state.robots.filter(o => o.side === foe && o.hp > 0 && inZone(r, o.cell, 1)).sort((a, b) => R.dist(a.cell, r.cell) - R.dist(b.cell, r.cell))[0];
      if (!foeMech) return { kind: 'done' };
      const path = R.bfsPath(state, r, c => R.cheb(c, foeMech.cell) <= 1 && inZone(r, c, 1));
      return path && path.length ? { kind: 'move', path: path.slice(0, 1), facing: foeMech.cell } : { kind: 'done' };
    }
    const rank = b => ((b.type === 'hq' || b.type === 'base') && R.cheb(b.cell, r.cell) <= 2 ? 0 : b.type === 'gunpod' ? 1 : 2) * 100 + R.dist(b.cell, r.cell);
    targets.sort((a, b) => rank(a) - rank(b));
    for (const tgt of targets) {
      if (R.cheb(tgt.cell, r.cell) <= 1) return { kind: 'hit', building: tgt };
      const path = R.bfsPath(state, r, c => R.cheb(c, tgt.cell) <= 1 && inZone(r, c, 1));
      if (path && path.length) return { kind: 'move', path: path.slice(0, 1), facing: tgt.cell };
    }
    const adj = targets.find(b => R.cheb(b.cell, r.cell) <= 1);
    return adj ? { kind: 'hit', building: adj } : { kind: 'done' };
  }

  function mechs(state, ev, events) {
    const t = state.rt.t;
    for (const r of state.robots.slice().sort((a, b) => a.id - b.id)) {
      if (r.hp <= 0 || t < r.nextAct) continue;
      r.nextAct = t + (r.step || T.MECH_STEP);
      const act = t >= r.leaveAt ? { kind: 'done' } : mechIntent(state, r);
      if (act.kind === 'done') {
        r.hp = 0;   // lifts off: removed in cleanup, not counted as lost
        r.recalled = true;
        ev({ type: 'recall', id: r.id, side: r.side, cell: r.cell, why: t >= r.leaveAt ? 'time' : 'clear' });
      } else if (act.kind === 'fight') {
        const o = act.robot, dmg = Math.round((r.dmg || C.ROBOT_DAMAGE) * T.MECH_DAMAGE_MUL);
        o.hp = Math.max(0, o.hp - dmg);
        const killed = o.hp <= 0;
        if (killed) { state.sides[r.side].stats.robotsKilled++; state.sides[o.side].stats.robotsLost++; }
        ev({ type: 'robotFight', id: r.id, side: r.side, cell: r.cell, targetId: o.id, targetCell: o.cell, dmg, hpAfter: o.hp, killed });
      } else if (act.kind === 'hit') {
        const hit = R.damageBuilding(state, act.building, Math.round((r.dmg || C.ROBOT_DAMAGE) * T.MECH_DAMAGE_MUL), r.side, events, true);
        ev({ type: 'robotHit', id: r.id, side: r.side, cell: r.cell, hit });
      } else if (act.kind === 'move') {
        const from = r.cell;
        r.cell = act.path[act.path.length - 1];
        ev({ type: 'robotMove', id: r.id, side: r.side, from, path: act.path, facing: act.facing });
      }
    }
  }

  // Integrity: what is left of a side's bases (Command Center included), 0..1
  function baseIntegrity(state, side) {
    const max = (state.rt.baseMax && state.rt.baseMax[side]) || B.hq.hp;
    return bases(state, side).reduce((n, b) => n + b.hp, 0) / max;
  }

  function endCheck(state, destroyed, ev) {
    const lostBase = destroyed.filter(b => b.type === 'hq' || b.type === 'base');
    for (const b of lostBase) ev({ type: 'baseLost', side: b.side, cell: b.cell, kind: b.type, left: bases(state, b.side).length });
    const pDead = lostBase.length && !bases(state, P).length;
    const aDead = lostBase.length && !bases(state, A).length;
    if (pDead && aDead) { state.winner = 'draw'; state.endReason = 'Mutual destruction'; }
    else if (pDead) { state.winner = A; state.endReason = 'All your bases were destroyed'; }
    else if (aDead) { state.winner = P; state.endReason = 'All enemy bases destroyed'; }
    else if (state.rt.t >= state.rt.timeLimit - 1e-6) {
      const pp = baseIntegrity(state, P), ap = baseIntegrity(state, A);
      if (Math.abs(pp - ap) < 0.005) {
        const val = side => R.buildingsOf(state, side).reduce((tot, b) => tot + B[b.type].cost + (b.level > 1 ? R.upgradeCost(b.type) : 0), 0);
        const pv = val(P), av = val(A);
        state.winner = pv === av ? 'draw' : (pv > av ? P : A);
      } else state.winner = pp > ap ? P : A;
      state.endReason = 'Time up — decided on what is left of the bases';
    }
    if (state.winner) ev({ type: 'end', winner: state.winner });
  }

  // Inbound flights against `side`, for the warning list
  function inbound(state, side) {
    const t = state.rt.t;
    return state.rt.flights.filter(f => f.launched && !f.done && f.side !== side).map(f => ({
      id: f.id, kind: f.kind, to: f.to, eta: Math.max(0, f.launchAt + f.flight - t),
      detected: detects(state, side, f), mechs: f.mechs ? f.mechs.length : 0, hull: f.hull
    })).sort((a, b) => a.eta - b.eta);
  }

  const api = {
    init, step, attackReason, attackCost, launchAttack, readyLaunchers, readyIn, isReady,
    factories, buildSpeed, reloadSpeed, buildLeft,
    landingCells, inbound, progress, detects, mechsCommitted, bases, baseIntegrity
  };
  root.Realtime = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
