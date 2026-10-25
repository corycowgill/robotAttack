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
function buildAt(s, side, type) {
  for (let c = 0; c < R.N; c++) if (!R.buildableReason(s, side, type, c)) { s.sides[side].credits += 1000; return R.build(s, side, type, c).building; }
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
  assert.match(RTE.attackReason(s, P, { to, silos: [silo.cell] }), /reloading/, 'new launchers start half loaded');
  run(s, RT.SILO_RELOAD / 2);
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
  run(s, RT.SILO_RELOAD);
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
