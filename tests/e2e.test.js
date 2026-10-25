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
  await dismissSplash(page);
  return { ctx, page, errors };
}

// The title screen: the first key during the logo reveal skips it, the next one starts
async function dismissSplash(page) {
  await page.waitForSelector('#splash.show');
  for (let i = 0; i < 3 && await page.evaluate(() => UI.isSplashOpen()); i++) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
  }
  await page.waitForFunction(() => !document.getElementById('splash').classList.contains('show'));
}

const waitPlanning = (page, turn) => page.waitForFunction(t => __game.phase === 'planning' && __game.state.turn >= t, turn, { timeout: 60000 });
// Screen position of a cell, once the camera has stopped gliding (it eases into place after a game starts)
async function cellXY(page, cell) {
  const at = () => page.evaluate(c => { const p = Renderer.project(Renderer.cellCenter(c)); return [p.x, p.y]; }, cell);
  let prev = await at();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(100);
    const cur = await at();
    if (Math.abs(cur[0] - prev[0]) < 0.5 && Math.abs(cur[1] - prev[1]) < 0.5) return cur;
    prev = cur;
  }
  return prev;
}
async function clickCell(page, cell) {
  const [x, y] = await cellXY(page, cell);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(100);
}
const freeCell = (page, type) => page.evaluate(t => {
  for (let c = 0; c < Rules.N; c++) if (!Rules.buildableReason(__game.state, 'player', t, c)) return c;
  return -1;
}, type);
// Skirmish defaults to real time; most tests drive the turn-based game
async function startSkirmish(page, diff = 'patrol', live = false) {
  await page.click(`#m-opts button[data-k="pace"][data-v="${live ? 1 : 0}"]`);
  await page.click(`.diff[data-diff="${diff}"]`);
  await page.waitForFunction(want => __game.phase === want, live ? 'live' : 'planning');
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

test('Q pressed again while aiming keeps fire mode: two missiles queue (regression)', async t => {
  const { page, errors } = await open(t);
  await startSkirmish(page);
  await page.evaluate(() => { __game.state.sides.player.credits += 500; __game.state.sides.player.energy = 30; });
  await page.click('.card[data-type="silo"]');
  await clickCell(page, await freeCell(page, 'silo'));
  await page.keyboard.press('Escape');
  const hq = await page.evaluate(() => Rules.hqCell('ai'));
  await page.keyboard.press('KeyQ');
  await clickCell(page, hq);
  await page.keyboard.press('KeyQ');      // used to toggle aiming off, so the next click only selected
  await clickCell(page, hq);
  assert.strictEqual(await page.evaluate(() => __game.state.sides.player.orders.filter(o => o.kind === 'missile').length), 2);
  assert.deepStrictEqual(errors, []);
});

test('defeat screen explains what went wrong', async t => {
  const { page, errors } = await open(t);
  await startSkirmish(page);
  await page.evaluate(() => { Rules.buildingsOf(__game.state, 'player', 'hq')[0].dead = true; });
  await page.click('#b-end');
  await skipPlayback(page);
  await page.waitForFunction(() => __game.phase === 'gameover', null, { timeout: 60000 });
  await page.waitForSelector('#go-tip', { state: 'visible', timeout: 15000 });
  assert.match(await page.textContent('#go-tip'), /^Debrief: /);
  assert.deepStrictEqual(errors, []);
});

test('real time: the clock runs, build anytime, pick an attack, see it in the air, pause, resume after a reload', async t => {
  const { page, errors } = await open(t);
  await startSkirmish(page, 'patrol', true);
  await page.waitForFunction(() => __game.state.rt.t > 2);
  const c0 = await page.evaluate(() => __game.state.sides.player.credits);
  await page.waitForFunction(c => __game.state.sides.player.credits > c, c0);
  assert.match(await page.textContent('#hud'), /\d:\d\d \/ 10:00/, 'a battle clock instead of turns');
  // building works while the clock runs
  await page.click('.card[data-type="depot"]');
  await clickCell(page, await freeCell(page, 'depot'));
  assert.strictEqual(await page.evaluate(() => Rules.buildingsOf(__game.state, 'player', 'depot').length), 1);
  await page.keyboard.press('Escape');
  // attack: Q, click the enemy HQ, the panel picks the loaded silo, Enter launches
  await page.evaluate(() => { const s = __game.state; s.sides.player.energy = 30; for (const b of Rules.buildingsOf(s, 'player', 'silo')) b.readyAt = 0; });
  await page.keyboard.press('KeyQ');
  await clickCell(page, await page.evaluate(() => Rules.hqCell('ai')));
  await page.waitForSelector('#attack.show');
  assert.strictEqual(await page.locator('#attack .ach.on').count(), 1, 'the loaded silo is picked');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => __game.state.rt.flights.some(f => f.side === 'player'));
  assert.ok(!(await page.isVisible('#attack')), 'the panel closes on launch');
  assert.strictEqual(await page.evaluate(() => __game.state.sides.player.energy <= 30 - CONST.MISSILE_ENERGY + 2), true);
  await page.waitForFunction(() => /Missile/.test(document.getElementById('orderlist').textContent));
  // Space pauses the clock
  await page.keyboard.press('Space');
  const t1 = await page.evaluate(() => __game.state.rt.t);
  await page.waitForTimeout(800);
  assert.strictEqual(await page.evaluate(() => __game.state.rt.t), t1, 'paused');
  await page.keyboard.press('Space');
  await page.waitForFunction(t => __game.state.rt.t > t, t1);
  // the autosave each round lets Continue pick the battle back up
  await page.waitForFunction(() => __game.state.turn >= 2, null, { timeout: 60000 });
  await page.reload();
  await dismissSplash(page);
  await page.waitForSelector('#m-continue', { state: 'visible' });
  await page.click('#m-continue');
  await page.waitForFunction(() => __game.phase === 'live' && __game.state.rt.t >= 15);
  assert.strictEqual(await page.evaluate(() => Rules.buildingsOf(__game.state, 'player', 'depot').length), 1);
  // the battle ends when a Command Center falls
  await page.evaluate(() => { Rules.buildingsOf(__game.state, 'ai', 'hq')[0].dead = true; });
  await page.waitForFunction(() => __game.phase === 'gameover', null, { timeout: 30000 });
  await page.waitForSelector('#go-reason', { state: 'visible', timeout: 15000 });
  assert.match(await page.textContent('#go-reason'), /real time/);
  assert.deepStrictEqual(errors, []);
});

test('real time: enemy launches are announced with a countdown, and mechs land, fight in their zone and leave', async t => {
  const { page, errors } = await open(t);
  await startSkirmish(page, 'patrol', true);
  await page.evaluate(() => {
    const s = __game.state;
    s.sides.ai.energy = 30;
    for (const b of Rules.buildingsOf(s, 'ai', 'silo')) b.readyAt = 0;
    Realtime.launchAttack(s, 'ai', { to: Rules.hqCell('player'), silos: Rules.buildingsOf(s, 'ai', 'silo').map(b => b.cell) });
  });
  await page.waitForFunction(() => /MISSILE → .*\d+s/.test(document.getElementById('orderlist').textContent));
  await page.waitForFunction(() => /Enemy attack inbound/.test(document.getElementById('log').textContent));
  // our mechs: land next to an enemy structure, fight, then fly home
  const to = await page.evaluate(() => {
    const s = __game.state;
    s.sides.player.credits = 2000; s.sides.player.energy = 30;
    for (let c = 0; c < Rules.N; c++) if (!Rules.buildableReason(s, 'player', 'hangar', c)) { Rules.build(s, 'player', 'hangar', c); break; }
    for (const h of Rules.buildingsOf(s, 'player', 'hangar')) h.readyAt = 0;
    const silo = Rules.buildingsOf(s, 'ai', 'silo')[0];
    return Rules.neighbors(silo.cell, 2).find(c => Realtime.landingCells(s, 'player', c).length);
  });
  await page.keyboard.press('KeyE');
  await clickCell(page, to);
  await page.waitForSelector('#attack.show');
  await page.click('#at-go');   // the panel takes clicks over the map (regression)
  await page.waitForFunction(() => __game.state.rt.flights.some(f => f.side === 'player' && f.kind === 'ship') || __game.state.robots.some(r => r.side === 'player'), null, { timeout: 5000 })
    .catch(async () => { throw new Error('no dropship launched: ' + await page.evaluate(() => document.getElementById('attack').innerText + ' | ' + document.getElementById('log').innerText.slice(-300))); });
  // the dropship arrives: it lands its mechs or is shot down
  await page.waitForFunction(() => /landed at|dropship was shot down/.test(document.getElementById('log').textContent), null, { timeout: 90000 });
  // don't wait out the full raid: shorten the landed mechs' timer
  await page.evaluate(() => { for (const r of __game.state.robots) if (r.side === 'player') r.leaveAt = Math.min(r.leaveAt, __game.state.rt.t + 4); });
  // landed, lost or shot down, they're gone again and the hangar is rebuilding
  await page.waitForFunction(() => !__game.state.robots.some(r => r.side === 'player') && !__game.state.rt.flights.some(f => f.side === 'player' && f.kind === 'ship'), null, { timeout: 90000 });
  assert.ok(await page.evaluate(() => /time is up|nothing left|shot down|destroyed/.test(document.getElementById('log').textContent)), 'the log says what happened to them');
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
  assert.strictEqual(await page.locator('#go-medals .medal.on').count(), 3, 'quick win with a full-health HQ earns all medals');
  assert.strictEqual(await page.locator('#go-chart svg').count(), 2, 'post-battle charts: HQ health and structures');
  await page.screenshot({ path: 'test-results/victory.png' }).catch(() => {});
  await page.click('#go-next');
  await page.waitForSelector('#briefing.show');
  await page.click('#br-back');
  await page.waitForFunction(() => __game.phase === 'menu');
  const open2 = await page.evaluate(() => [...document.querySelectorAll('.mission')].filter(m => !m.classList.contains('locked')).length);
  assert.strictEqual(open2, 2);
  assert.strictEqual(await page.locator('.mission.done .star.on').count(), 3, 'medals shown on the mission card');
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
  await dismissSplash(page);
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
  await page.tap('#m-opts button[data-k="pace"][data-v="0"]');
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

test('orbital strike: build an uplink, charge, target with R, strike lands', async t => {
  const { page, errors } = await open(t);
  await startSkirmish(page);
  assert.ok(!(await page.isVisible('#b-strike')), 'no strike button without an uplink');
  await page.evaluate(() => { __game.state.sides.player.credits += 600; });
  await page.click('.card[data-type="uplink"]');
  await clickCell(page, await freeCell(page, 'uplink'));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#b-strike', { state: 'visible' });
  assert.match(await page.textContent('#strike-badge'), /0\/4/);
  await page.keyboard.press('KeyR'); // still charging: refused
  assert.strictEqual(await page.evaluate(() => __game.state.sides.player.orders.length), 0);

  await page.evaluate(() => { Rules.buildingsOf(__game.state, 'player', 'uplink')[0].charge = CONST.STRIKE_CHARGE; __game.state.sides.player.energy = 30; });
  await page.keyboard.press('KeyR');
  await clickCell(page, await page.evaluate(() => Rules.hqCell('ai')));
  assert.deepStrictEqual(await page.evaluate(() => __game.state.sides.player.orders.map(o => o.kind)), ['strike']);
  const before = await page.evaluate(() => Rules.buildingsOf(__game.state, 'ai', 'hq')[0].hp);
  await endTurn(page);
  assert.ok(await page.evaluate(() => __game.state.missiles.some(m => m.strike && m.side === 'player')));
  await endTurn(page);
  const after = await page.evaluate(() => Rules.buildingsOf(__game.state, 'ai', 'hq')[0].hp);
  assert.ok(before - after >= 40, `strike hit the HQ (${before} -> ${after})`);
  assert.deepStrictEqual(errors, []);
});

test('two players: hand-off screens, separate views and logs, battle after both plan', async t => {
  const { page, errors } = await open(t);
  await page.click('#m-hotseat');
  await page.waitForFunction(() => __game.phase === 'planning' && __game.side === 'player');
  await page.evaluate(() => __game.setSpeed(3));
  const p1cell = await freeCell(page, 'depot');
  await page.click('.card[data-type="depot"]');
  await clickCell(page, p1cell);
  await page.keyboard.press('Escape');
  await page.click('#b-end');
  await page.waitForSelector('#handoff.show');
  assert.match(await page.textContent('#ho-title'), /Player 2/);
  assert.strictEqual(await page.evaluate(() => __game.state.turn), 1, 'no combat before Player 2 has planned');

  await page.click('#ho-go');
  await page.waitForFunction(() => __game.phase === 'planning' && __game.side === 'ai');
  assert.ok(!(await page.textContent('#log')).includes('Built Supply Depot'), "Player 1's log stays with Player 1");
  assert.strictEqual(await page.evaluate(c => Rules.buildingAt(__game.state, c), p1cell), null, "Player 2 doesn't see Player 1's same-turn build");
  const p2cell = await page.evaluate(() => { for (let c = 0; c < Rules.N; c++) if (!Rules.buildableReason(__game.state, 'ai', 'depot', c)) return c; return -1; });
  await page.click('.card[data-type="depot"]');
  await clickCell(page, p2cell);
  await page.keyboard.press('Escape');
  assert.strictEqual(await page.evaluate(c => Rules.buildingAt(__game.state, c)?.side, p2cell), 'ai', 'Player 2 builds on the red island');
  await page.click('#b-end');
  await page.waitForSelector('#handoff.show');
  assert.match(await page.textContent('#ho-title'), /Player 1/);
  await page.click('#ho-go');
  await skipPlayback(page);
  await waitPlanning(page, 2);
  assert.strictEqual(await page.evaluate(() => __game.side), 'player');
  assert.ok((await page.textContent('#log')).includes('Built Supply Depot'), "Player 1's log is back");
  assert.strictEqual(await page.evaluate(() => Rules.buildingsOf(__game.state, 'ai', 'depot').length), 1);
  assert.strictEqual(await page.evaluate(c => Rules.buildingAt(__game.state, c)?.type, p1cell), 'depot', "both players' builds are in the battle");

  // a resumed two-player game opens behind a hand-off screen
  await page.reload();
  await dismissSplash(page);
  await page.waitForSelector('#m-continue', { state: 'visible' });
  await page.click('#m-continue');
  await page.waitForSelector('#handoff.show');
  assert.match(await page.textContent('#ho-title'), /Player 1/);
  assert.strictEqual(await page.evaluate(() => __game.phase), 'handoff');
  await page.click('#ho-go');
  await page.waitForFunction(() => __game.phase === 'planning' && __game.side === 'player');
  assert.deepStrictEqual(errors, []);
});

test('battle options apply to the skirmish and are remembered', async t => {
  const { page, errors } = await open(t);
  for (const [k, v] of [['land', 150], ['credits', 600], ['turns', 20], ['uplink', 0]]) await page.click(`#m-opts button[data-k="${k}"][data-v="${v}"]`);
  await startSkirmish(page);
  const s = await page.evaluate(() => {
    const st = __game.state;
    return { land: st.land.filter((v, i) => v && Rules.ownerOfCell(i) === 'player').length, credits: st.sides.player.credits, aiCredits: st.sides.ai.credits, maxTurns: st.maxTurns, locked: st.locked };
  });
  assert.deepStrictEqual(s, { land: 150, credits: 600, aiCredits: 600, maxTurns: 20, locked: ['uplink'] });
  assert.strictEqual(await page.locator('.card[data-type="uplink"]').count(), 0, 'no superweapon card');
  assert.match(await page.textContent('#hud'), /1 \/ 20/);
  await page.reload();
  await dismissSplash(page);
  await page.waitForFunction(() => window.__game && document.querySelector('#m-opts'));
  assert.strictEqual(await page.locator('#m-opts button.on').evaluateAll(bs => bs.map(b => b.dataset.k + '=' + b.dataset.v).join(',')), 'land=150,credits=600,turns=20,uplink=0,pace=0,style=0');
  assert.deepStrictEqual(errors, []);
});

test('settings: gear opens them, choices apply and persist across a reload', async t => {
  const { page, errors } = await open(t);
  await page.click('#m-settings');
  await page.waitForSelector('#settings.show');
  await page.click('#settings button[data-set="speed"][data-v="3"]');
  await page.click('#settings button[data-set="shake"][data-v="0"]');
  await page.click('#settings button[data-set="intents"][data-v="0"]');
  await page.click('#settings button[data-set="quality"][data-v="0"]');
  await page.click('#settings button[data-set="style"][data-v="retro"]');
  await page.click('#settings button[data-set="bgMute"][data-v="0"]');
  await page.locator('#settings input[data-set="music"]').fill('0.3');
  await page.locator('#settings input[data-set="ui"]').fill('0.4');
  await page.locator('#settings input[data-set="amb"]').fill('0.2');
  assert.strictEqual(await page.evaluate(() => GameAudio.getStyle()), 'retro');
  await page.click('#set-done');
  assert.ok(!(await page.isVisible('#settings')));
  await page.reload();
  await dismissSplash(page);
  await page.click('#m-settings');
  const on = await page.locator('#settings button.on').evaluateAll(bs => bs.map(b => b.dataset.set + '=' + b.dataset.v).sort().join(','));
  assert.strictEqual(on, 'bgMute=0,intents=0,musicOn=1,quality=0,shake=0,speed=3,style=retro');
  assert.strictEqual(+(await page.locator('#settings input[data-set="music"]').inputValue()), 0.3);
  assert.strictEqual(+(await page.locator('#settings input[data-set="ui"]').inputValue()), 0.4);
  assert.strictEqual(+(await page.locator('#settings input[data-set="amb"]').inputValue()), 0.2);
  // music off in Settings also unticks the menu's Music box
  await page.click('#settings button[data-set="musicOn"][data-v="0"]');
  assert.strictEqual(await page.isChecked('#m-music'), false);
  assert.strictEqual(await page.evaluate(() => GameAudio.isMusicEnabled()), false);
  await page.keyboard.press('Escape');
  assert.ok(!(await page.isVisible('#settings')));
  assert.deepStrictEqual(errors, []);
});

test('audio: generated clips load and each phase plays its music track', async t => {
  const { page, errors } = await open(t);
  const loaded = () => page.evaluate(() => GameAudio.loadedSamples());
  await page.waitForFunction(() => GameAudio.loadedSamples().track === 'menu', null, { timeout: 20000 });
  await page.waitForFunction(() => ['explosion', 'missileLaunch', 'uiClick', 'victory'].every(n => GameAudio.loadedSamples().sfx.includes(n)), null, { timeout: 20000 });
  assert.ok((await loaded()).amb.includes('ocean'));
  await startSkirmish(page);
  await page.waitForFunction(() => GameAudio.loadedSamples().track === 'planning', null, { timeout: 20000 });
  // every sound the game asks for plays without throwing, in both styles
  for (const style of ['studio', 'retro']) {
    await page.evaluate(s => {
      GameAudio.setStyle(s);
      ['explosion', 'splash', 'strikeImpact', 'decoyPop', 'mechClash', 'hqGun', 'upgrade', 'targetLock', 'strikeLock', 'dropOrder',
        'undo', 'cancel', 'combatStart', 'achievement', 'radio', 'handoff', 'uplinkReady'].forEach(n => GameAudio.play(n));
      GameAudio.play('missileLaunch', { far: true, pan: 0.6, gain: 0.6 });
      GameAudio.play('destroyed', { big: true });
    }, style);
  }
  assert.ok(!(await loaded()).track, 'retro style uses the synth score');
  await page.evaluate(() => GameAudio.setStyle('studio'));
  await page.waitForFunction(() => GameAudio.loadedSamples().track === 'planning');
  // after a combat the planning track picks up where it left off
  await page.waitForTimeout(1500);
  const before = (await loaded()).pos;
  assert.ok(before > 1.5, 'planning track is playing: ' + before);
  await page.evaluate(() => GameAudio.setMode('combat'));
  await page.waitForFunction(() => GameAudio.loadedSamples().track === 'combat', null, { timeout: 20000 });
  await page.evaluate(() => GameAudio.setMode('planning'));
  await page.waitForFunction(() => GameAudio.loadedSamples().track === 'planning', null, { timeout: 20000 });
  assert.ok((await loaded()).pos >= before, 'planning resumed at ' + (await loaded()).pos + ', left at ' + before);
  // a Command Center in danger brings in the tense arrangement; the debriefs follow the game
  await page.evaluate(() => GameAudio.setTension(true));
  await page.waitForFunction(() => GameAudio.loadedSamples().track === 'planningTense', null, { timeout: 20000 });
  await page.evaluate(() => GameAudio.setMode('won', false));
  await page.waitForFunction(() => GameAudio.loadedSamples().track === 'debriefWin', null, { timeout: 20000 });
  await page.evaluate(() => GameAudio.setMode('lost'));
  await page.waitForFunction(() => GameAudio.loadedSamples().track === 'debriefLoss', null, { timeout: 20000 });
  assert.deepStrictEqual(errors, []);
});

test('daily operation: seeded by date, scored, best kept; achievements unlock', async t => {
  const { page, errors } = await open(t);
  assert.match(await page.textContent('#dl-best'), /Not played/);
  await page.click('#m-daily');
  await page.waitForFunction(() => __game.phase === 'planning' && __game.state.daily);
  const first = await page.evaluate(() => ({ key: __game.state.daily, seed: __game.state.mapSeed, max: __game.state.maxTurns }));
  const d = new Date(), key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  assert.strictEqual(first.key, key);
  // win at once: the enemy HQ falls this turn
  await page.evaluate(() => { __game.setSpeed(3); Rules.buildingsOf(__game.state, 'ai', 'hq')[0].dead = true; });
  await page.click('#b-end');
  await skipPlayback(page);
  await page.waitForFunction(() => __game.phase === 'gameover', null, { timeout: 60000 });
  await page.waitForSelector('#go-daily', { state: 'visible', timeout: 15000 });
  assert.match(await page.textContent('#go-daily'), /Daily score \d+ — new best!/);
  const ach = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('ra_ach')) || {}).sort());
  assert.ok(ach.includes('daily') && ach.includes('first_blood') && ach.includes('blitz'), ach.join(','));
  // retry replays the same seeded battle
  await page.click('#go-again');
  await page.waitForFunction(() => __game.phase === 'planning');
  assert.strictEqual(await page.evaluate(() => __game.state.mapSeed), first.seed);
  assert.deepStrictEqual(errors, []);
});
