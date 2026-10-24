const test = require('node:test');
const assert = require('node:assert/strict');
const { CONST, BUILDINGS, UPGRADES, CAMPAIGN, Rules: R } = require('./load');

const P = 'player', A = 'ai';
const landCount = (land, side) => land.filter((v, i) => v && R.ownerOfCell(i) === side).length;
function freeLand(s, side, pred) {
  for (let c = 0; c < R.N; c++) if (R.ownerOfCell(c) === side && R.isLand(s, c) && !s.cells[c].building && !R.robotAt(s, c) && (!pred || pred(c))) return c;
  return -1;
}
function buildable(s, side, type) {
  for (let c = 0; c < R.N; c++) if (!R.buildableReason(s, side, type, c)) return c;
  return -1;
}
// silence building validity side-effects: give a side plenty of resources
function rich(s, side) { s.sides[side].credits = 99999; s.sides[side].energy = 999; }

test('islands are equal in area, connected and hold the HQ area', () => {
  const seeds = [];
  for (let i = 1; i <= 60; i++) seeds.push([i, CONST.LAND_TARGET]);
  for (const m of CAMPAIGN) seeds.push([m.mapSeed, m.land]);
  for (const [seed, target] of seeds) {
    const land = R.generateIslands(seed, target);
    assert.equal(landCount(land, P), target, `player land seed ${seed}`);
    assert.equal(landCount(land, A), target, `ai land seed ${seed}`);
    for (const side of [P, A]) {
      for (const c of [R.hqCell(side)].concat(R.neighbors(R.hqCell(side), 2))) assert.ok(land[c], `HQ surroundings are land (seed ${seed})`);
      // flood fill from the HQ reaches every land cell of that side
      const seen = new Set([R.hqCell(side)]), q = [R.hqCell(side)];
      while (q.length) {
        const c = q.pop(), p = R.xy(c);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!R.inBounds(p.x + dx, p.y + dy)) continue;
          const n = R.idx(p.x + dx, p.y + dy);
          if (land[n] && R.ownerOfCell(n) === side && !seen.has(n)) { seen.add(n); q.push(n); }
        }
      }
      assert.equal(seen.size, target, `island connected (seed ${seed}, ${side})`);
    }
    for (let c = 0; c < R.N; c++) if (R.ownerOfCell(c) === null) assert.equal(land[c], 0, 'strait is open sea');
  }
});

test('new game: HQ and starting silo per side, starting resources', () => {
  const s = R.newGame('commander', 7);
  for (const side of [P, A]) {
    assert.equal(R.buildingsOf(s, side, 'hq').length, 1);
    assert.equal(R.buildingsOf(s, side, 'silo').length, 1);
    assert.equal(s.sides[side].credits, CONST.START_CREDITS);
  }
  const m = CAMPAIGN[3];
  const c = R.newGame(m.difficulty, 1, { mapSeed: m.mapSeed, landTarget: m.land, start: m.start, credits: m.credits });
  assert.equal(c.sides.player.credits, m.credits.player);
  assert.ok(R.buildingsOf(c, A, 'shield').length >= 1, 'mission fortifications placed');
});

test('build validation: water, enemy land, range, credits, max, craters', () => {
  const s = R.newGame('patrol', 3);
  rich(s, P);
  const water = (() => { for (let c = 0; c < R.N; c++) if (R.ownerOfCell(c) === P && !R.isLand(s, c)) return c; })();
  assert.match(R.buildableReason(s, P, 'depot', water), /Water/);
  assert.equal(R.buildableReason(s, P, 'depot', R.hqCell(A)), 'Enemy territory');
  const far = freeLand(s, P, c => !R.buildingsOf(s, P).some(b => R.cheb(b.cell, c) <= CONST.BUILD_RADIUS));
  if (far >= 0) assert.equal(R.buildableReason(s, P, 'depot', far), 'Out of build range');
  const c = buildable(s, P, 'depot');
  s.cells[c].crater = 2;
  assert.match(R.buildableReason(s, P, 'depot', c), /Crater/);
  s.cells[c].crater = 0;
  s.sides[P].credits = 10;
  assert.match(R.buildableReason(s, P, 'depot', c), /Need/);
  rich(s, P);
  for (let i = 0; i < 10; i++) { const k = buildable(s, P, 'silo'); if (k >= 0) R.build(s, P, 'silo', k); }
  assert.equal(R.buildingsOf(s, P, 'silo').length, BUILDINGS.silo.max, 'silo cap');
});

test('undo restores builds, repairs, upgrades and sales', () => {
  const s = R.newGame('patrol', 4);
  s.sides[P].credits = 1000;
  const c = buildable(s, P, 'depot');
  R.build(s, P, 'depot', c);
  assert.equal(s.sides[P].credits, 900);
  R.undo(s, P);
  assert.equal(s.sides[P].credits, 1000);
  assert.equal(R.buildingAt(s, c), null);

  R.build(s, P, 'depot', c);
  const cost = R.upgradeCost('depot');
  assert.equal(cost, Math.round(BUILDINGS.depot.cost * 0.75 / 10) * 10);
  const up = R.upgrade(s, P, c);
  assert.ok(up.ok);
  const b = R.buildingAt(s, c);
  assert.equal(b.level, 2);
  assert.equal(b.maxHp, Math.round(BUILDINGS.depot.hp * 1.5));
  assert.equal(R.income(s, P).credits, CONST.BASE_CREDITS + UPGRADES.depot.credits);
  R.undo(s, P);
  assert.equal(b.level, 1);
  assert.equal(b.maxHp, BUILDINGS.depot.hp);

  const before = s.sides[P].credits;
  const sold = R.sell(s, P, c);
  assert.equal(s.sides[P].credits, before + sold.value);
  assert.ok(R.undo(s, P).ok);
  assert.equal(R.buildingAt(s, c).id, b.id);
  assert.equal(s.sides[P].credits, before);
});

test('repair-then-sell cannot make a profit', () => {
  const s = R.newGame('patrol', 5);
  rich(s, P);
  const c = buildable(s, P, 'shield');
  R.build(s, P, 'shield', c);
  const b = R.buildingAt(s, c);
  b.hp = 5;
  const v0 = R.sellValue(b);
  R.repair(s, P, c);
  assert.equal(R.sellValue(b), v0, 'repairs this turn do not raise the sale price');
});

test('decoys look like their disguise to the enemy, including HP', () => {
  const s = R.newGame('warlord', 6);   // Warlord AI sees the whole map
  rich(s, P);
  const c = buildable(s, P, 'decoy');
  R.build(s, P, 'decoy', c);
  const d = R.buildingAt(s, c);
  assert.ok(BUILDINGS.decoy.disguises.includes(d.disguise));
  const a = R.apparent(d);
  assert.equal(a.type, d.disguise);
  assert.equal(a.maxHp, BUILDINGS[d.disguise].hp);
  R.updateIntel(s, A);
  assert.equal(s.sides[A].intel.seen[c].type, d.disguise, 'enemy intel records the disguise');
});

test('drop rules: HQ no-drop zone, water, garrison, and readiness independent of target', () => {
  const s = R.newGame('patrol', 8);
  rich(s, P);
  R.build(s, P, 'hangar', buildable(s, P, 'hangar'));
  // regression: the Drop button must not depend on a probe target (it used to probe the enemy HQ cell)
  assert.equal(R.dropReadyReason(s, P), null);
  assert.match(R.dropReason(s, P, R.neighbors(R.hqCell(A), 1)[0]), /Too close|land/);
  const seaAI = (() => { for (let c = 0; c < R.N; c++) if (R.ownerOfCell(c) === A && !R.isLand(s, c)) return c; })();
  assert.match(R.dropReason(s, P, seaAI), /land/);
  const own = freeLand(s, P);
  assert.equal(R.dropReason(s, P, own), null, 'garrison drop on own island');
  assert.match(R.dropReason(s, P, R.hqCell(P)), /free cell/);
  s.sides[P].energy = 0;
  assert.match(R.dropReadyReason(s, P), /energy/);
});

test('missiles: enemy targets only, energy refund on cancel, land next turn', () => {
  const s = R.newGame('patrol', 9);
  s.sides[P].energy = 30;
  assert.match(R.missileReason(s, P, R.hqCell(P)), /enemy/);
  const r = R.queueMissile(s, P, R.hqCell(A));
  assert.ok(r.ok);
  assert.equal(s.sides[P].energy, 30 - CONST.MISSILE_ENERGY);
  R.cancelOrder(s, P, r.order.id);
  assert.equal(s.sides[P].energy, 30);
  const target = freeLand(s, A, c => R.dist(c, R.hqCell(A)) > 4);
  R.queueMissile(s, P, target);
  let ev = R.resolveTurn(s);
  assert.ok(ev.some(e => e.type === 'launch' && e.side === P));
  assert.ok(!ev.some(e => e.type === 'impact' && e.side === P), 'no impact on the launch turn');
  ev = R.resolveTurn(s);
  assert.ok(ev.some(e => (e.type === 'impact' || e.type === 'descend') && e.side === P), 'arrives the next turn');
});

test('AA engagement: shots recorded, a hit stops the missile', () => {
  const s = R.newGame('patrol', 10);
  rich(s, P); rich(s, A);
  const t = R.hqCell(A);
  R.queueMissile(s, P, t);
  R.resolveTurn(s);
  const ev = R.resolveTurn(s);
  const d = ev.find(e => e.type === 'descend' && e.side === P);
  assert.ok(d.shots.length >= 1, 'HQ point defense engaged');
  const hit = d.shots.some(x => x.hit);
  assert.equal(d.interceptedBy >= 0, hit);
  assert.equal(ev.some(e => e.type === 'impact' && e.id === d.id), !hit);
});

test('upgraded silo missiles hit harder', () => {
  const s = R.newGame('patrol', 5);
  rich(s, P);
  const silo = R.buildingsOf(s, P, 'silo')[0];
  R.upgrade(s, P, silo.cell);
  R.queueMissile(s, P, R.hqCell(A));
  R.resolveTurn(s);
  assert.equal(s.missiles.find(m => m.side === P).dmg, UPGRADES.silo.dmg);
});

test('win, loss and draw', () => {
  const kill = (s, side) => { R.buildingsOf(s, side, 'hq')[0].dead = true; };
  let s = R.newGame('patrol', 11); kill(s, A); R.resolveTurn(s); assert.equal(s.winner, P);
  s = R.newGame('patrol', 11); kill(s, P); R.resolveTurn(s); assert.equal(s.winner, A);
  s = R.newGame('patrol', 11); kill(s, P); kill(s, A); R.resolveTurn(s); assert.equal(s.winner, 'draw');
});

test('garrison mechs fight invaders on their own island', () => {
  const s = R.newGame('patrol', 3);
  rich(s, P);
  R.build(s, P, 'hangar', buildable(s, P, 'hangar'));
  const ec = freeLand(s, P, c => R.neighbors(c, 1).every(n => !s.cells[n].building) && R.dist(c, R.hqCell(P)) > 3);
  s.robots.push({ id: 9999, side: A, cell: ec, hp: 50, maxHp: 50, fresh: false, dmg: 20 });
  const spot = R.neighbors(ec, 1).find(c => !R.dropReason(s, P, c));
  assert.ok(R.queueDrop(s, P, spot).ok);
  R.resolveTurn(s);
  const ev = R.resolveTurn(s);
  assert.ok(ev.some(e => e.type === 'robotFight' && e.side === P && e.targetId === 9999));
});

test('turn resolution is deterministic and survives a save/load round trip', () => {
  const play = s => { for (let t = 0; t < 6 && !s.winner; t++) { AI.planTurn(s, P); AI.planTurn(s, A); R.resolveTurn(s); } };
  const a = R.newGame('commander', 42);
  play(a);
  const saved = JSON.parse(JSON.stringify(a));
  const b = R.newGame('commander', 42);
  play(b);
  assert.deepEqual(JSON.parse(JSON.stringify(b)), saved, 'same seed, same game');
  play(a); play(saved);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), JSON.parse(JSON.stringify(a)), 'a reloaded save continues identically');
});

test('campaign medals: win, par and HQ health', () => {
  const m = CAMPAIGN[0];
  const s = R.newGame(m.difficulty, 1, { mapSeed: m.mapSeed, landTarget: m.land, start: m.start, credits: m.credits });
  const hq = R.buildingsOf(s, 'player', 'hq')[0];
  assert.deepStrictEqual(R.missionMedals(s, m), [false, false, false]);
  s.winner = 'player'; s.turn = m.par;
  assert.deepStrictEqual(R.missionMedals(s, m), [true, true, true]);
  s.turn = m.par + 1; hq.hp = Math.floor(hq.maxHp / 2) - 1;
  assert.deepStrictEqual(R.missionMedals(s, m), [true, false, false]);
  s.winner = 'ai';
  assert.deepStrictEqual(R.missionMedals(s, m), [false, false, false]);
});
