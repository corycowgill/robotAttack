// Headless-browser smoke tests of real UI flows (Playwright + software WebGL).
const test = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { start } = require('./serve.js');

let server, browser, base;

test.before(async () => {
  server = await start(0);
  base = `http://127.0.0.1:${server.address().port}/index.html`;
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
});
test.after(async () => { await browser?.close(); server?.close(); });

// Fresh context with an empty localStorage (kept across reloads), no web fonts, low graphics.
async function open(t, contextOpts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...contextOpts });
  t.after(() => ctx.close());
  await ctx.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('ra_test')) { localStorage.clear(); sessionStorage.setItem('ra_test', '1'); }
      localStorage.setItem('ra_quality', '0');
    } catch (e) {}
  });
  await ctx.route('https://fonts.**', r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(base);
  await page.waitForFunction(() => window.__game && document.querySelector('.diff'));
  return { ctx, page, errors };
}

const waitPlanning = (page, turn) => page.waitForFunction(t => __game.phase === 'planning' && __game.state.turn >= t, turn, { timeout: 60000 });
const cellXY = (page, cell) => page.evaluate(c => { const p = Renderer.project(Renderer.cellCenter(c)); return [p.x, p.y]; }, cell);
async function clickCell(page, cell) {
  const [x, y] = await cellXY(page, cell);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(100);
}
const freeCell = (page, type) => page.evaluate(t => {
  for (let c = 0; c < Rules.N; c++) if (!Rules.buildableReason(__game.state, 'player', t, c)) return c;
  return -1;
}, type);
async function startSkirmish(page, diff = 'patrol') {
  await page.click(`.diff[data-diff="${diff}"]`);
  await page.waitForFunction(() => __game.phase === 'planning');
  await page.evaluate(() => __game.setSpeed && __game.setSpeed(3));
}
// End Turn during playback skips it; checked inside the page so it can't race into ending the next turn
const skipPlayback = page => page.evaluate(() => { if (__game.phase === 'resolving') document.getElementById('b-end').click(); });
async function endTurn(page) {
  const t = await page.evaluate(() => __game.state.turn);
  await page.click('#b-end');
  // a quiet turn can finish playing before the click returns; otherwise skip the playback
  await skipPlayback(page);
  await waitPlanning(page, t + 1);
}

test('skirmish: build, fire a missile and end the turn', async t => {
  const { page, errors } = await open(t);
  await startSkirmish(page);
  const cell = await freeCell(page, 'depot');
  assert.ok(cell >= 0);
  await page.click('.card[data-type="depot"]');
  await clickCell(page, cell);
  assert.strictEqual(await page.evaluate(c => Rules.buildingAt(__game.state, c)?.type, cell), 'depot');

  await page.keyboard.press('KeyQ');
  await clickCell(page, await page.evaluate(() => Rules.hqCell('ai')));
  assert.strictEqual(await page.evaluate(() => __game.state.sides.player.orders.filter(o => o.kind === 'missile').length), 1);

  await endTurn(page);
  assert.strictEqual(await page.evaluate(() => __game.state.turn), 2);
  assert.strictEqual(await page.evaluate(() => __game.state.missiles.filter(m => m.side === 'player').length), 1);
  assert.deepStrictEqual(errors, []);
});

test('Drop button works once a hangar stands (regression)', async t => {
  const { page, errors } = await open(t);
  await startSkirmish(page);
  assert.ok(await page.evaluate(() => document.getElementById('b-drop').classList.contains('off')));
  await page.evaluate(() => { __game.state.sides.player.credits += 500; __game.state.sides.player.energy = 30; });
  const cell = await freeCell(page, 'hangar');
  await page.click('.card[data-type="hangar"]');
  await clickCell(page, cell);
  await page.keyboard.press('Escape');
  assert.strictEqual(await page.evaluate(c => Rules.buildingAt(__game.state, c)?.type, cell), 'hangar');
  await page.waitForFunction(() => !document.getElementById('b-drop').classList.contains('off'));

  await page.click('#b-drop');
  const target = await page.evaluate(() => {
    for (let c = 0; c < Rules.N; c++) if (Rules.ownerOfCell(c) === 'ai' && !Rules.dropReason(__game.state, 'player', c)) return c;
    return -1;
  });
  assert.ok(target >= 0);
  await clickCell(page, target);
  assert.strictEqual(await page.evaluate(() => __game.state.sides.player.orders.filter(o => o.kind === 'drop').length), 1);
  assert.deepStrictEqual(errors, []);
});

test('campaign: briefing, victory, next briefing and back to the menu', async t => {
  const { page, errors } = await open(t);
  await page.click('.mission:not(.locked)');
  await page.waitForSelector('#briefing.show');
  await page.click('#br-go');
  await page.waitForFunction(() => __game.phase === 'planning' && __game.state.mission);
  await page.evaluate(() => { __game.setSpeed && __game.setSpeed(3); Rules.buildingsOf(__game.state, 'ai', 'hq')[0].dead = true; });
  await page.click('#b-end');
  await skipPlayback(page);
  await page.waitForFunction(() => __game.phase === 'gameover', null, { timeout: 60000 });
  assert.strictEqual(await page.evaluate(() => __game.state.winner), 'player');
  await page.waitForSelector('#go-next', { state: 'visible', timeout: 15000 });
  await page.click('#go-next');
  await page.waitForSelector('#briefing.show');
  await page.click('#br-back');
  await page.waitForFunction(() => __game.phase === 'menu');
  const open2 = await page.evaluate(() => [...document.querySelectorAll('.mission')].filter(m => !m.classList.contains('locked')).length);
  assert.strictEqual(open2, 2);
  assert.ok(!(await page.isVisible('#m-cont-wrap')), 'no Continue after a finished mission');
  assert.deepStrictEqual(errors, []);
});

test('autosave: Continue after a reload restores the game', async t => {
  const { page, errors } = await open(t);
  await startSkirmish(page);
  await page.click('.card[data-type="depot"]');
  await clickCell(page, await freeCell(page, 'depot'));
  await page.keyboard.press('Escape');
  await endTurn(page);
  const before = await page.evaluate(() => ({ turn: __game.state.turn, n: Rules.buildingsOf(__game.state, 'player').length }));
  await page.reload();
  await page.waitForFunction(() => window.__game && __game.phase === 'menu');
  await page.waitForSelector('#m-continue', { state: 'visible' });
  await page.click('#m-continue');
  await page.waitForFunction(() => __game.phase === 'planning');
  const after = await page.evaluate(() => ({ turn: __game.state.turn, n: Rules.buildingsOf(__game.state, 'player').length }));
  assert.deepStrictEqual(after, before);
  await endTurn(page);
  assert.deepStrictEqual(errors, []);
});

test('phone: compact layout and tap-to-confirm building', async t => {
  const { page, errors } = await open(t, { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  assert.ok(await page.evaluate(() => document.body.classList.contains('compact')));
  await page.tap('.diff[data-diff="patrol"]');
  await page.waitForFunction(() => __game.phase === 'planning');
  const cell = await freeCell(page, 'depot');
  const [x, y] = await cellXY(page, cell);
  await page.tap('.card[data-type="depot"]');
  await page.touchscreen.tap(x, y); await page.waitForTimeout(200);
  assert.ok(!(await page.evaluate(c => Rules.buildingAt(__game.state, c), cell)), 'first tap only previews');
  await page.touchscreen.tap(x, y); await page.waitForTimeout(200);
  assert.strictEqual(await page.evaluate(c => Rules.buildingAt(__game.state, c)?.type, cell), 'depot');
  assert.deepStrictEqual(errors, []);
});
