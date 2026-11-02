// Manual check: node tests/iphone-walkthrough.js "iPhone 14" <out-dir>  (needs the game served on localhost:8798)
// iPhone touch walkthrough: screenshots + audits at each step
const { chromium, devices } = require('playwright');
const [dev, out] = [process.argv[2], process.argv[3]];
(async () => {
  const d = Object.assign({}, devices[dev]); delete d.defaultBrowserType;
  const b = await chromium.launch();
  const ctx = await b.newContext(d);
  await ctx.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('ra_quality', '0'); } catch (e) {} });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push('console: ' + m.text().slice(0, 160)));
  const tag = dev.replace(/\W+/g, '_');
  const log = [];
  let n = 0;
  const audit = async (name) => {
    await p.screenshot({ path: `${out}/${tag}_${String(++n).padStart(2, '0')}_${name}.png` });
    const r = await p.evaluate(() => {
      const W = innerWidth, H = innerHeight, small = [], off = [];
      const vis = el => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      for (const el of document.querySelectorAll('#ui button, #ui .card, #ui .abtn, #ui .diff, #ui .mission:not(.locked), #ui .navbtn, #ui .lnk, #ui .iconbtn, #ui .akit, #ui .ach, #ui .sbtn, #ui input, #ui .x, #ui .close')) {
        if (!vis(el)) continue;
        let anc = el, hidden = false; while (anc && anc !== document.body) { if (!vis(anc)) { hidden = true; break; } anc = anc.parentElement; }
        if (hidden) continue;
        const r = el.getBoundingClientRect();
        const id = (el.id || el.className || el.tagName).toString().slice(0, 28) + ':' + (el.textContent || '').trim().slice(0, 16);
        if (Math.min(r.width, r.height) < 32) small.push(id + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
        if (r.right > W + 1 || r.left < -1 || r.bottom > H + 1 || r.top < -1) off.push(id + ' @' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      }
      return { W, H, hscroll: document.documentElement.scrollWidth > W + 1, small: small.slice(0, 12), nsmall: small.length, off: off.slice(0, 8) };
    });
    log.push(`[${name}] ${r.W}x${r.H}${r.hscroll ? ' HSCROLL' : ''} small(<32px):${r.nsmall} ${r.small.join('; ')}${r.off.length ? ' | OFFSCREEN: ' + r.off.join('; ') : ''}`);
  };
  const tapSel = async (sel) => { await p.tap(sel); await p.waitForTimeout(450); };
  const tapCell = async (c) => { const [x, y] = await p.evaluate(c => { const v = Renderer.project(Renderer.cellCenter(c)); return [v.x, v.y]; }, c); await p.touchscreen.tap(x, y); await p.waitForTimeout(350); return [x, y]; };
  try {
    await p.goto('http://localhost:8798/');
    await p.waitForFunction(() => window.__game && document.querySelector('.diff'));
    await p.waitForTimeout(1500);
    await audit('splash');
    for (let i = 0; i < 5 && await p.evaluate(() => UI.isSplashOpen()); i++) { await p.touchscreen.tap(d.viewport.width / 2, d.viewport.height / 2); await p.waitForTimeout(500); }
    const rot = await p.evaluate(() => { const r = document.getElementById('rotate'); return r && getComputedStyle(r).display !== 'none' && r.classList.contains('show'); });
    if (rot) { await audit('rotate_prompt'); const btn = await p.$('#rotate button'); if (btn) { await btn.tap(); await p.waitForTimeout(400); } }
    await p.waitForTimeout(1200);
    await audit('home');
    await tapSel('#m-go-campaign'); await audit('campaign');
    await tapSel('.mission:not(.locked)'); await p.waitForSelector('#briefing.show'); await audit('briefing');
    await tapSel('#br-back'); await tapSel('#m-back');
    await tapSel('#m-settings'); await audit('settings'); await tapSel('#set-done');
    await tapSel('#m-go-skirmish'); await audit('skirmish');
    await tapSel('.diff[data-diff="patrol"]');
    await p.waitForFunction(() => __game.phase === 'live'); await p.waitForTimeout(2500);
    await audit('battle_start');
    // build a depot by tapping its card then tapping a free cell twice (tap-to-confirm)
    await tapSel('.card[data-type="depot"]');
    await audit('build_selected');
    const cell = await p.evaluate(() => { const s = __game.state, hq = Rules.hqCell('player'); return Rules.neighbors(hq, 3).find(c => !Rules.buildableReason(s, 'player', 'depot', c) && Rules.dist(c, hq) >= 2); });
    await tapCell(cell); await audit('build_first_tap');
    await tapCell(cell); await p.waitForTimeout(400);
    const built = await p.evaluate(c => !!(__game.state.cells[c].building), cell);
    log.push('built depot by double tap: ' + built);
    await audit('built');
    // structure info by tapping it
    await tapCell(Rules = await p.evaluate(() => Rules.hqCell('player'))); await audit('selected_hq');
    // attack: Fire Missile, warhead, target the enemy HQ (tap twice), launch
    await p.evaluate(() => { const s = __game.state; s.sides.player.energy = 30; s.sides.player.credits = 2000; for (const b of Rules.buildingsOf(s, 'player', 'silo')) b.readyAt = 0;
      for (let c = 0; c < Rules.N; c++) if (!Rules.buildableReason(s, 'player', 'hangar', c)) { const r = Rules.build(s, 'player', 'hangar', c); r.building.progress = 1; r.building.readyAt = 0; break; } });
    await p.waitForTimeout(800);
    await tapSel('#b-fire'); await audit('attack_open');
    const pen = await p.$('.akit[data-v="penetrator"]'); if (pen) { await pen.tap(); await p.waitForTimeout(300); }
    const ehq = await p.evaluate(() => Rules.hqCell('ai'));
    await tapCell(ehq); await audit('target_tap1'); await tapCell(ehq); await audit('target_tap2');
    const goOk = await p.evaluate(() => !document.getElementById('at-go').disabled);
    log.push('launch enabled after target: ' + goOk);
    if (goOk) { await tapSel('#at-go'); }
    const flying = await p.evaluate(() => __game.state.rt.flights.filter(f => f.side === 'player').map(f => f.kind + ':' + (f.warhead || f.loadout || '')));
    log.push('flights after launch: ' + JSON.stringify(flying));
    await p.waitForTimeout(1200); await audit('in_flight');
    // drop mechs
    await tapSel('#b-drop'); await audit('drop_open');
    const land = await p.evaluate(() => { const s = __game.state; const bs = Realtime.bases(s, 'ai').find(b => b.type === 'base'); return Rules.neighbors(bs.cell, 2).find(c => Rules.isLand(s, c) && Realtime.landingCells(s, 'player', c).length); });
    await tapCell(land); await tapCell(land); await p.waitForTimeout(300);
    const dropOk = await p.evaluate(() => !document.getElementById('at-go').disabled);
    log.push('drop launch enabled: ' + dropOk);
    if (dropOk) await tapSel('#at-go'); else { await audit('drop_blocked'); const x = await p.$('#at-x'); if (x) await x.tap(); }
    // pause, log panel, help
    await tapSel('#b-end'); await audit('paused');
    const logBtn = await p.$('#b-log'); if (logBtn && await logBtn.isVisible()) { await logBtn.tap(); await p.waitForTimeout(400); await audit('log_open'); await logBtn.tap(); await p.waitForTimeout(300); }
    await tapSel('#b-help'); await audit('help'); const close = await p.$('#help .close'); if (close) { await close.scrollIntoViewIfNeeded(); await close.tap(); await p.waitForTimeout(300); }
    await tapSel('#b-end');
    // win -> result screen
    await p.evaluate(() => { for (const b of Realtime.bases(__game.state, 'ai')) b.dead = true; });
    await p.waitForFunction(() => __game.phase === 'gameover', null, { timeout: 60000 }); await p.waitForTimeout(3000);
    await audit('result');
    const menuBtn = await p.$('#go-menu'); await menuBtn.scrollIntoViewIfNeeded(); await menuBtn.tap(); await p.waitForTimeout(1000);
    await audit('back_home');
  } catch (e) { log.push('STEP FAILED: ' + e.message.split('\n')[0]); await p.screenshot({ path: `${out}/${tag}_FAIL.png` }).catch(() => {}); }
  console.log(log.join('\n')); console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
