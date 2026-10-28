// Real-time engine: economy, attacks, interception, dropships, mechs, determinism.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONST, BUILDINGS, RT, Rules: R, AI, Realtime: RTE } = require('./load');

const P = 'player', A = 'ai';
function game(seed, opts) { return RTE.init(R.newGame('commander', seed || 3, opts)); }
function run(s, seconds, opts) {
  const out = [];
  for (let i = 0; i < Math.round(seconds / RT.TICK); i++) out.push(...RTE.step(s, RT.TICK, opts));
  return out;
}
// builds a structure and (unless `wait`) skips its construction time
function buildAt(s, side, type, wait) {
  for (let c = 0; c < R.N; c++) {
    if (R.buildableReason(s, side, type, c)) continue;
    s.sides[side].credits += 1000;
    const b = R.build(s, side, type, c).building;
    if (!wait) { b.progress = 1; if (type === 'shield') b.pool = BUILDINGS.shield.pool; }
    return b;
  }
  throw new Error('no space for ' + type);
}

test('resources flow every second: one turn of income per round', () => {
  const s = game();
  const c0 = s.sides[P].credits, e0 = s.sides[P].energy;
  const inc = R.income(s, P);
  run(s, RT.ROUND);
  assert.equal(s.sides[P].credits - c0, inc.credits);
  assert.equal(s.sides[P].energy - e0, inc.energy);
  assert.equal(s.turn, 2, 'a round passed');
});

test('attacks: pick loaded silos, pay energy, see it coming, land after the flight', () => {
  const s = game();
  const silo = R.buildingsOf(s, P, 'silo')[0];
  const to = R.hqCell(A);
  assert.match(RTE.attackReason(s, P, { to, silos: [silo.cell] }), /reloading/, 'a calm opening: the starting silo is still loading');
  run(s, RT.START_LOAD);
  s.sides[P].energy = 20;
  assert.equal(RTE.attackReason(s, P, { to: R.hqCell(P), silos: [silo.cell] }), 'Missiles must target enemy territory');
  const r = RTE.launchAttack(s, P, { to, silos: [silo.cell] });
  assert.ok(r.ok, r.reason);
  assert.equal(s.sides[P].energy, 20 - CONST.MISSILE_ENERGY);
  assert.match(RTE.attackReason(s, P, { to, silos: [silo.cell] }), /reloading/);
  const ev = run(s, 0.2);
  const launch = ev.find(e => e.type === 'launch');
  assert.ok(launch && launch.detected, 'a missile at the HQ is always seen coming');
  assert.equal(RTE.inbound(s, A).length, 1, 'the defender has it on the warning list');
  const later = run(s, RT.MISSILE_FLIGHT + 2);
  const done = later.find(e => (e.type === 'impact' || e.type === 'intercept') && e.id === launch.id);
  assert.ok(done, 'the missile either lands or is shot down');
  if (done.type === 'intercept') assert.ok(later.some(e => e.type === 'aaShot' && e.hit), 'interceptions come from a hit');
});

test('AA batteries reload between shots, so a salvo outnumbering them gets through', () => {
  const s = game(11);
  s.sides[P].credits = 9999;
  const silos = [R.buildingsOf(s, P, 'silo')[0]];
  while (silos.length < 4) silos.push(buildAt(s, P, 'silo'));
  run(s, RT.START_LOAD);
  s.sides[P].energy = 40;
  const r = RTE.launchAttack(s, P, { to: R.hqCell(A), silos: silos.map(b => b.cell) });
  assert.ok(r.ok, r.reason);
  const ev = run(s, RT.MISSILE_FLIGHT + 4);
  const shots = ev.filter(e => e.type === 'aaShot');
  assert.equal(shots.length, 1, 'the HQ point defence alone gets one shot at a 4-missile salvo');
  assert.ok(ev.filter(e => e.type === 'impact').length >= 3);
});

test('dropships: shot down by enough AA hits, or land mechs that fight in their zone and fly home', () => {
  const s = game(5);
  s.sides[P].credits = 9999;
  const h = buildAt(s, P, 'hangar');
  run(s, RT.HANGAR_RELOAD);
  s.sides[P].energy = 30;
  // aim at enemy land well away from its HQ
  let to = -1;
  for (let c = 0; c < R.N && to < 0; c++) if (R.ownerOfCell(c) === A && R.isLand(s, c) && R.cheb(c, R.hqCell(A)) > 4 && RTE.landingCells(s, P, c).length) to = c;
  const r = RTE.launchAttack(s, P, { to, hangars: [h.cell] });
  assert.ok(r.ok, r.reason);
  assert.ok(!RTE.isReady(s, h), 'the hangar is empty while its mech is away');
  let ev = run(s, RT.SHIP_FLIGHT + 2);
  const dep = ev.find(e => e.type === 'deploy');
  assert.ok(dep, 'no AA near the drop zone: the mech lands');
  const mech = s.robots.find(m => m.side === P);
  assert.ok(R.cheb(mech.cell, to) <= RT.MECH_ZONE);
  ev = run(s, RT.MECH_TIME + 3);
  assert.ok(ev.some(e => e.type === 'recall'), 'the mech is collected when its time is up (or its zone is clear)');
  assert.ok(ev.filter(e => e.type === 'robotMove').every(e => e.path.every(c => R.cheb(c, to) <= RT.MECH_ZONE + 1)), 'mechs stay in their zone');
  assert.equal(s.robots.filter(m => m.side === P).length, 0);
  run(s, RT.HANGAR_RELOAD + 0.5);
  assert.ok(RTE.isReady(s, h), 'the hangar has a new mech ready');
});

test('a dropship flying into AA cover can be brought down', () => {
  let downs = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const s = game(seed);
    s.sides[A].credits = 9999;
    for (let k = 0; k < 3; k++) buildAt(s, A, 'aa');
    s.sides[P].credits = 9999;
    const h = buildAt(s, P, 'hangar');
    run(s, RT.HANGAR_RELOAD);
    s.sides[P].energy = 30;
    const aa = R.buildingsOf(s, A, 'aa')[0];
    const to = RTE.landingCells(s, P, aa.cell)[0] ?? R.neighbors(aa.cell, 2).find(c => RTE.landingCells(s, P, c).length);
    if (to === undefined || !RTE.launchAttack(s, P, { to, hangars: [h.cell] }).ok) continue;
    const ev = run(s, RT.SHIP_FLIGHT + 2);
    if (ev.some(e => e.type === 'shipDown')) {
      downs++;
      assert.ok(!s.robots.some(m => m.side === P), 'no mechs from a downed ship');
      run(s, RT.HANGAR_RELOAD + 0.5);
      assert.ok(RTE.isReady(s, h), 'the hangar rebuilds its mech');
    } else assert.ok(ev.some(e => e.type === 'deploy'));
  }
  assert.ok(downs >= 1, 'heavy AA brings some dropships down');
});

test('the engine is deterministic and survives a save/load mid-flight', () => {
  const mk = () => game(42, { aiStyle: 'blitz' });
  const a = mk(), b = mk();
  run(a, 90, { ai: [P, A] }); run(b, 90, { ai: [P, A] });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  const c = JSON.parse(JSON.stringify(a));
  run(a, 60, { ai: [P, A] }); run(c, 60, { ai: [P, A] });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(c)));
});

test('AI-vs-AI real-time games finish within the rules and the clock', () => {
  for (const diff of ['patrol', 'commander', 'warlord']) {
    for (let g = 0; g < 4; g++) {
      const s = RTE.init(R.newGame(diff, 900 + g));
      let guard = 0;
      while (!s.winner && guard++ < 2000) {
        RTE.step(s, 1, { ai: [P, A] });
        for (const sd of [P, A]) {
          assert.ok(s.sides[sd].credits >= 0 && s.sides[sd].energy >= 0, 'resources never go negative');
          assert.ok(s.robots.filter(r => r.side === sd).length <= CONST.MAX_ROBOTS);
        }
      }
      assert.ok(['player', 'ai', 'draw'].includes(s.winner));
      assert.ok(s.rt.t <= s.rt.timeLimit + 1);
    }
  }
});

test('construction takes time, and factories speed up building, reloading and mech production', () => {
  const s = game(8);
  const depot = buildAt(s, P, 'depot', true);
  assert.ok(!R.online(depot), 'a new depot is a building site');
  const inc0 = R.income(s, P).credits;
  run(s, RT.BUILD_TIME.depot / 2);
  assert.equal(R.income(s, P).credits, inc0, 'no income until it is finished');
  const ev = run(s, RT.BUILD_TIME.depot / 2 + 0.2);
  assert.ok(ev.some(e => e.type === 'built' && e.id === depot.id), 'announced when finished');
  assert.ok(R.online(depot) && R.income(s, P).credits > inc0);
  assert.equal(R.upgradeInfo(s, P, buildAt(s, P, 'power', true).cell).reason, 'Still under construction');
  // a battery under construction does not shoot
  const aa = buildAt(s, A, 'aa', true);
  assert.ok(!R.online(aa));
  // factories: faster construction and reloads
  assert.equal(RTE.buildSpeed(s, P), 1);
  const f = buildAt(s, P, 'factory');
  assert.equal(RTE.buildSpeed(s, P), 1 + RT.FACTORY_BUILD_BOOST);
  assert.equal(RTE.reloadSpeed(s, P), 1 + RT.FACTORY_RELOAD_BOOST);
  const slow = RT.BUILD_TIME.silo, silo = buildAt(s, P, 'silo', true);
  run(s, slow / (1 + RT.FACTORY_BUILD_BOOST) + 0.2);
  assert.ok(R.online(silo), 'one factory builds a silo in two thirds of the time');
  s.sides[P].credits += 1000;
  assert.ok(R.upgrade(s, P, f.cell).ok);
  assert.equal(RTE.factories(s, P), 2, 'an Assembly Line counts as two factories');
  assert.ok(R.newGame('commander', 1).locked.includes('factory'), 'turn-based games have no factories');
  assert.ok(!s.locked.includes('factory'));
});

test('every campaign mission plays out as a real-time battle', () => {
  const { CAMPAIGN } = require('./load');
  for (const m of CAMPAIGN) {
    const s = RTE.init(R.newGame(m.difficulty, 77 + m.id, { mapSeed: m.mapSeed, landTarget: m.land, start: m.start, credits: m.credits, locked: m.locked }));
    s.sides[P].credits += m.rtBonus || 0;
    s.rt.aiDiff = { player: 'commander' };
    let guard = 0;
    while (!s.winner && guard++ < 2000) RTE.step(s, 1, { ai: [P, A] });
    assert.ok(['player', 'ai', 'draw'].includes(s.winner), 'mission ' + m.id + ' finished');
    for (const t of m.locked || []) assert.ok(s.locked.includes(t), 'mission ' + m.id + ' keeps ' + t + ' locked');
    assert.equal(R.missionMedals(s, m, P).length, 3);
  }
});

test('Bases: several per side, always on the map, all must fall', () => {
  const s = game(21);
  for (const side of [P, A]) assert.equal(RTE.bases(s, side).length, 1 + RT.BASES_PER_SIDE, side + ' has its HQ and its bases');
  const enemyBases = RTE.bases(s, A).filter(b => b.type === 'base');
  for (const b of enemyBases) assert.ok(R.visibleEnemyCells(s, P).has(b.cell), 'enemy bases are marked like the HQ');
  assert.match(R.repairInfo(s, P, RTE.bases(s, P)[1].cell).reason || 'full', /full|can't be repaired/);
  RTE.bases(s, P)[1].hp -= 10;
  assert.match(R.repairInfo(s, P, RTE.bases(s, P)[1].cell).reason, /can't be repaired/);
  // the HQ alone falling is not the end
  R.buildingsOf(s, A, 'hq')[0].dead = true;
  let ev = run(s, 0.2);
  assert.ok(!s.winner, 'bases still stand');
  assert.ok(ev.some(e => e.type === 'baseLost' && e.kind === 'hq' && e.left === RT.BASES_PER_SIDE));
  for (const b of enemyBases) b.dead = true;
  ev = run(s, 0.2);
  assert.equal(s.winner, P);
  assert.match(s.endReason, /All enemy bases destroyed/);
});

test('one attack, a target per missile; mechs land together', () => {
  const s = game(12);
  s.sides[P].credits = 9999;
  const silos = [R.buildingsOf(s, P, 'silo')[0], buildAt(s, P, 'silo')];
  run(s, RT.START_LOAD);
  s.sides[P].energy = 40;
  const targets = RTE.bases(s, A).slice(0, 2).map(b => b.cell);
  const plan = { missiles: [{ from: silos[0].cell, to: targets[0] }, { from: silos[1].cell, to: targets[1] }] };
  assert.equal(RTE.attackCost(plan), 2 * CONST.MISSILE_ENERGY);
  assert.equal(RTE.attackReason(s, P, { missiles: [{ from: silos[0].cell, to: R.hqCell(P) }] }), 'Missiles must target enemy territory');
  assert.equal(RTE.attackReason(s, P, { missiles: [{ from: silos[0].cell, to: targets[0] }, { from: silos[0].cell, to: targets[1] }] }), 'Each silo fires once per attack');
  assert.ok(RTE.launchAttack(s, P, plan).ok);
  const ev = run(s, 0.6);
  const aims = ev.filter(e => e.type === 'launch').map(e => e.to).sort();
  assert.deepEqual(aims, targets.slice().sort(), 'each missile flies at its own target');
});

test('raiders landing wake the defenders in their hangars; radar guides AA', () => {
  const s = game(31);
  s.sides[A].credits = 9999; s.sides[P].credits = 9999;
  const hA = buildAt(s, A, 'hangar');
  const hP = buildAt(s, P, 'hangar');
  run(s, RT.HANGAR_RELOAD);
  s.sides[P].energy = 30;
  let to = -1;
  for (let c = 0; c < R.N && to < 0; c++) if (R.ownerOfCell(c) === A && R.isLand(s, c) && R.cheb(c, R.hqCell(A)) > 4 && RTE.landingCells(s, P, c).length) to = c;
  const la = RTE.launchAttack(s, P, { hangars: [hP.cell], landing: to });
  assert.ok(la.ok, la.reason);
  const ev = run(s, RT.SHIP_FLIGHT + 2);
  if (ev.some(e => e.type === 'deploy')) {
    const sc = ev.find(e => e.type === 'scramble');
    assert.ok(sc && sc.side === A && sc.robots.length >= 1, 'the defender scrambles');
    assert.ok(!RTE.isReady(s, hA), 'its hangar is empty while it fights');
  }
  // radar boost: a guided battery's shot carries the higher hit chance
  const s2 = game(32);
  s2.sides[A].credits = 9999; s2.sides[P].credits = 9999;
  const radar = buildAt(s2, A, 'radar'); radar.doneAt = -99;
  const aa = buildAt(s2, A, 'aa');
  run(s2, RT.START_LOAD);
  s2.sides[P].energy = 30;
  assert.ok(RTE.launchAttack(s2, P, { missiles: [{ from: R.buildingsOf(s2, P, 'silo')[0].cell, to: aa.cell }] }).ok);
  const shots = run(s2, RT.MISSILE_FLIGHT + 2).filter(e => e.type === 'aaShot' && e.by === aa.cell);
  if (R.dist(radar.cell, aa.cell) <= BUILDINGS.radar.range) for (const sh of shots) assert.equal(sh.chance, BUILDINGS.aa.hitChance + RT.RADAR_AA_BOOST);
});

test('minefields go off under raiding mechs in real time', () => {
  const s = game(5);
  // a raider on enemy land a few cells from the HQ, with hidden mines all around it
  const hq = R.hqCell(A);
  const cell = R.cellsInRadius(hq, 3).find(c => R.cheb(c, hq) === 3 && R.isLand(s, c) && R.cellsInRadius(c, 1).every(n => !s.cells[n].building));
  s.robots.push({ id: 9000, side: P, cell, hp: 50, maxHp: 50, dmg: 20, zone: cell, leaveAt: 999, nextAct: 0 });
  for (const c of R.cellsInRadius(cell, 2)) if (c !== cell && R.ownerOfCell(c) === A && R.isLand(s, c) && !s.cells[c].building) s.mines.push({ id: 7000 + c, side: A, cell: c });
  const before = s.mines.length;
  const ev = run(s, RT.MECH_STEP * 2 + 0.2);
  const boom = ev.find(e => e.type === 'mine');
  assert.ok(boom, 'the mech steps on a mine');
  assert.equal(boom.robotSide, P);
  assert.equal(s.mines.length, before - ev.filter(e => e.type === 'mine').length);
  assert.ok(!s.robots.some(r => r.id === 9000) || s.robots.find(r => r.id === 9000).hp <= 50 - BUILDINGS.mine.damage);
});

test('a mech dropped straight onto a mine sets it off as it lands', () => {
  const s = game(5);
  s.sides[P].credits = 9999;
  const h = buildAt(s, P, 'hangar');
  run(s, RT.HANGAR_RELOAD);
  s.sides[P].energy = 30;
  let to = -1;
  for (let c = 0; c < R.N && to < 0; c++) if (R.ownerOfCell(c) === A && R.isLand(s, c) && R.cheb(c, R.hqCell(A)) > 4 && RTE.landingCells(s, P, c).length) to = c;
  for (const c of RTE.landingCells(s, P, to)) s.mines.push({ id: 8000 + c, side: A, cell: c });
  assert.ok(RTE.launchAttack(s, P, { to, hangars: [h.cell] }).ok);
  const ev = run(s, RT.SHIP_FLIGHT + 1.5);
  const boom = ev.find(e => e.type === 'mine');
  assert.ok(boom && boom.landed, 'the landing sets the mine off');
  assert.equal(boom.robotSide, P);
});
