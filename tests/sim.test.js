// AI-vs-AI simulations: every game must finish cleanly and stay within the rules.
const test = require('node:test');
const assert = require('node:assert');
const { CAMPAIGN, Rules: R, AI } = require('./load.js');

function play(s, playerDifficulty) {
  while (!s.winner) {
    if (playerDifficulty) { const d = s.difficulty; s.difficulty = playerDifficulty; AI.planTurn(s, 'player'); s.difficulty = d; }
    else AI.planTurn(s, 'player');
    AI.planTurn(s, 'ai');
    for (const sd of ['player', 'ai']) {
      for (const o of s.sides[sd].orders) {
        if (o.kind === 'missile') assert.notStrictEqual(R.ownerOfCell(o.to), sd, `turn ${s.turn}: ${sd} fired at its own side`);
      }
    }
    R.resolveTurn(s);
    for (const sd of ['player', 'ai']) {
      assert.ok(s.sides[sd].credits >= 0, `turn ${s.turn}: ${sd} credits negative`);
      assert.ok(s.sides[sd].energy >= 0, `turn ${s.turn}: ${sd} energy negative`);
    }
    assert.ok(s.turn <= 31, 'game ran past the turn limit');
  }
  return s;
}

for (const diff of ['patrol', 'commander', 'warlord']) {
  test(`${diff}: 25 AI-vs-AI games finish within the rules`, () => {
    for (let g = 0; g < 25; g++) {
      const s = play(R.newGame(diff, 5000 + g));
      assert.ok(['player', 'ai', 'draw'].includes(s.winner));
    }
  });
}

test('commander mirror is roughly balanced', () => {
  const res = { player: 0, ai: 0, draw: 0 };
  const N = 60;
  for (let g = 0; g < N; g++) res[play(R.newGame('commander', 1000 + g)).winner]++;
  const rate = res.player / N;
  assert.ok(rate >= 0.25 && rate <= 0.75, `player win rate ${rate} (${JSON.stringify(res)})`);
});

test('every campaign mission plays to completion', () => {
  for (const m of CAMPAIGN) {
    for (let g = 0; g < 10; g++) {
      const s = R.newGame(m.difficulty, 100 + g, { mapSeed: m.mapSeed, landTarget: m.land, start: m.start, credits: m.credits, locked: m.locked });
      play(s, 'commander');
    }
  }
});

test('custom battle options play to completion', () => {
  for (const [land, credits, turns] of [[95, 250, 20], [150, 600, 45]]) {
    for (let g = 0; g < 8; g++) {
      const s = R.newGame('commander', 700 + g, { landTarget: land, credits: { player: credits, ai: credits }, maxTurns: turns });
      while (!s.winner) { AI.planTurn(s, 'player'); AI.planTurn(s, 'ai'); R.resolveTurn(s); assert.ok(s.turn <= turns + 1); }
    }
  }
});
