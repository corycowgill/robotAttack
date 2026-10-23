// ============================================================
// Robot Attack 2026 — Orchestrator
// ============================================================
// State machine (menu → planning → resolving → planning … → game over),
// input handling, world/view synchronisation and the combat playback
// timeline. A single requestAnimationFrame loop drives everything;
// playback is dt-based so it can be sped up or skipped safely.

(function () {
  'use strict';

  const R = Rules, P = CONST.SIDE_PLAYER, A = CONST.SIDE_AI;
  const SND = window.GameAudio;

  let state = null;
  let phase = 'menu';           // menu | planning | resolving | gameover
  let difficulty = 'commander';
  let tutorial = true;
  let mode = 'select';          // select | build | fire | drop
  let buildType = null;
  let selectedCell = -1;
  let hoverCell = -1;
  let visible = new Set();      // enemy cells the player sees
  let speed = 1;
  let lastFrame = performance.now();
  let reportTimer = 0;
  let mouse = { x: 0, y: 0, downX: 0, downY: 0, down: false };
  let hoveredOrder = null;
  let objectivesHidden = false;

  // ── Boot ──────────────────────────────────────────────────
  function boot() {
    Renderer.init();
    UI.init({
      onStart: startGame,
      onContinue: continueGame,
      onRematch: () => startGame(difficulty, tutorial),
      onMenu: toMenu,
      onBuildSelect: selectBuild,
      onAction: action,
      onVolume: v => { SND.setVolume(v); },
      onMusic: on => SND.setMusicEnabled(on),
      onHover: () => SND.play('uiHover'),
      onCardHover: cardTooltip,
      onOrderHover: id => { hoveredOrder = id; }
    });
    UI.setVolume(SND.getVolume());
    UI.setMuted(SND.isMuted());
    UI.setMusicChecked(SND.isMusicEnabled());
    refreshContinue();
    UI.showMenu(true);
    SND.setMode('menu');

    const canvas = document.getElementById('game-canvas');
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', e => { mouse.down = true; mouse.downX = e.clientX; mouse.downY = e.clientY; });
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', () => { hoverCell = -1; UI.hideTip(); refreshHover(); });
    window.addEventListener('keydown', onKey);
    const unlock = () => SND.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);

    requestAnimationFrame(frame);
  }

  // ── Game lifecycle ────────────────────────────────────────
  // ── Save / continue (one autosave slot, written each planning phase) ──
  const SAVE_KEY = 'ra_save_v1';
  function saveGame() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ state, tutorial, objectivesHidden })); } catch (e) { /* storage full or blocked */ }
  }
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      return s && s.state && s.state.cells && s.state.cells.length === R.N && !s.state.winner ? s : null;
    } catch (e) { return null; }
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }
  function refreshContinue() {
    const s = loadSave();
    UI.setContinue(s ? 'Turn ' + s.state.turn + ' vs ' + CONST.DIFFICULTY[s.state.difficulty].name : null);
  }

  function continueGame() {
    const s = loadSave();
    if (!s) return refreshContinue();
    startGame(s.state.difficulty, s.tutorial, s);
  }

  function startGame(diff, tut, saved) {
    SND.unlock();
    SND.play('uiClick');
    difficulty = diff;
    tutorial = tut !== false;
    objectivesHidden = saved ? saved.objectivesHidden : !tutorial;
    Timeline.cancel();
    Renderer.reset();
    UI.clearLog();
    UI.hideGameOver();
    UI.showMenu(false);
    UI.showGameUI(true);
    state = saved ? saved.state : R.newGame(diff);
    window.__game = { get state() { return state; }, get phase() { return phase; }, setSpeed(v) { speed = v; } }; // debug handle
    mode = 'select'; buildType = null; selectedCell = -1;
    syncWorld(true);
    if (saved) UI.log('Resumed operation — turn ' + state.turn + ' vs ' + CONST.DIFFICULTY[diff].name, 'sys');
    else {
      UI.log('Operation started — opponent: ' + CONST.DIFFICULTY[diff].name, 'sys');
      UI.log('Destroy the enemy Command Center (red, far right).', 'sys');
    }
    beginPlanning(!saved);
  }

  function toMenu() {
    Timeline.cancel();
    phase = 'menu';
    UI.hideGameOver();
    UI.showGameUI(false);
    UI.setCombatHint(false);
    Renderer.reset();
    state = null;
    refreshContinue();
    UI.showMenu(true);
    SND.setMode('menu');
    SND.setTension(false);
  }

  // Frame the map in the screen area not covered by side panels
  function frameView(instant) {
    const rectOf = id => { const el = document.getElementById(id); if (!el || el.offsetParent === null) return null; return el.getBoundingClientRect(); };
    // Keep the map clear of the orders/log panel, HUD and build dock. The briefing panel is
    // short and closable and only overlaps the player's rear corner, so it doesn't count.
    const ord = rectOf('orders'), hud = rectOf('hud');
    Renderer.setOcclusion(0, ord ? window.innerWidth - ord.left : 0, hud ? hud.bottom : 80, 120);
    Renderer.frameAll(instant);
  }

  function beginPlanning(first) {
    phase = 'planning';
    mode = 'select'; buildType = null;
    UI.setDock(true);
    UI.setCombatHint(false);
    SND.setMode('planning');
    const hq = R.buildingsOf(state, P, 'hq')[0];
    SND.setTension(hq && hq.hp < hq.maxHp * 0.5);
    UI.banner('TURN ' + state.turn, first ? 'Plan your opening' : 'Planning phase');
    SND.play('turnStart');
    const inc = R.detectedIncoming(state, P);
    if (inc.length) {
      setTimeout(() => { if (phase === 'planning') SND.play('alarm'); }, 500);
      UI.toast(inc.length + ' incoming missile' + (inc.length > 1 ? 's' : '') + ' detected!', 'bad');
    }
    UI.log('Turn ' + state.turn, 'turn');
    saveGame();
    refreshAll();
    if (first) frameView(false);
  }

  // ── View synchronisation ──────────────────────────────────
  function playerSees(cell) {
    return R.ownerOfCell(cell) !== A || visible.has(cell);
  }

  function syncWorld(instant) {
    visible = R.visibleEnemyCells(state, P);
    const alive = new Set();
    for (let c = 0; c < R.N; c++) {
      const b = state.cells[c].building;
      if (b) {
        alive.add(b.id);
        let rec = Renderer.getBuilding(b.id);
        if (!rec) rec = Renderer.addBuilding(b, !instant && b.side === P && playerSees(c));
        else Renderer.setBuildingHp(b.id, b.hp, b.maxHp);
        if (b.type === 'shield') Renderer.setShieldPool(b.id, b.pool);
        Renderer.setBuildingVisible(b.id, playerSees(c));
      }
      Renderer.setCrater(c, state.cells[c].crater > 0 && !state.cells[c].building);
    }
    for (const id of Renderer.allBuildingIds()) if (!alive.has(id)) Renderer.removeBuilding(id, true);

    const liveRobots = new Set();
    for (const r of state.robots) {
      liveRobots.add(r.id);
      let rec = Renderer.getRobot(r.id);
      if (!rec) rec = Renderer.addRobot(r);
      const p = Renderer.cellCenter(r.cell);
      rec.group.position.set(p.x, 0, p.z);
      rec.cell = r.cell;
      rec.moving = false;
      Renderer.setRobotHp(r.id, r.hp);
      rec.group.visible = playerSees(r.cell);
      rec.bar.visible = rec.group.visible && r.hp < r.maxHp;
    }
    for (const id of Renderer.allRobotIds()) if (!liveRobots.has(id)) Renderer.removeRobot(id);

    // Fog + ghosts (last known enemy structures outside current vision)
    Renderer.setFog(c => R.ownerOfCell(c) === A && !visible.has(c));
    const seen = state.sides[P].intel.seen;
    const ghosts = [];
    for (const k in seen) if (!visible.has(+k)) ghosts.push({ cell: +k, type: seen[k].type });
    Renderer.setGhosts(ghosts);
  }

  function refreshMarkers() {
    if (!state || phase !== 'planning') { Renderer.setMarkers([], []); return; }
    Renderer.setMarkers(state.sides[P].orders, R.detectedIncoming(state, P));
  }

  // ── Planning-phase UI refresh ─────────────────────────────
  function refreshAll() {
    if (!state) return;
    refreshHUD();
    refreshDock();
    refreshOrders();
    refreshSelected();
    refreshZone();
    refreshMarkers();
    refreshHover();
    refreshObjectives();
  }

  function enemyHqView() {
    const real = R.buildingsOf(state, A, 'hq')[0];
    return { hp: real ? real.hp : 0, max: BUILDINGS.hq.hp, known: true };
  }

  function refreshHUD() { UI.setHUD(hudData()); }
  function hudData() {
    const s = state.sides[P];
    const inc = R.income(state, P);
    const hq = R.buildingsOf(state, P, 'hq')[0];
    const phaseName = { planning: 'Planning', resolving: 'Combat', gameover: 'Game over' }[phase] || '';
    return ({
      credits: s.credits, creditInc: inc.credits,
      energy: s.energy, energyCap: R.energyCap(state, P), energyInc: inc.energy,
      turn: state.turn, maxTurns: CONST.MAX_TURNS, phase: phaseName,
      hq: { hp: hq ? hq.hp : 0, max: BUILDINGS.hq.hp }, enemyHq: enemyHqView()
    });
  }

  function refreshDock() {
    const s = state.sides[P];
    const cards = BUILD_ORDER.map(t => {
      const def = BUILDINGS[t];
      const count = R.buildingsOf(state, P, t).length;
      let reason = null;
      if (s.credits < def.cost) reason = 'Need ' + def.cost + ' credits';
      else if (def.max && count >= def.max) reason = 'Max ' + def.max;
      return { type: t, key: def.key, name: def.name, cost: def.cost, enabled: !reason, reason, selected: mode === 'build' && buildType === t, count };
    });
    UI.setCards(cards);
    const silos = R.buildingsOf(state, P, 'silo').length, freeSilos = R.freeLaunchers(state, P, 'silo').length;
    const hangars = R.buildingsOf(state, P, 'hangar').length, freeH = R.freeLaunchers(state, P, 'hangar').length;
    const fireReason = !silos ? 'Build a Missile Silo first' : !freeSilos ? 'All silos tasked' : s.energy < CONST.MISSILE_ENERGY ? 'Need ' + CONST.MISSILE_ENERGY + ' energy' : null;
    const dropReason = !hangars ? 'Build a Robot Hangar first' : R.dropReason(state, P, R.hqCell(A));
    const ready = phase === 'planning' && !!fireReason && !!dropReason && s.credits < 80;
    UI.setActions({
      fire: { enabled: !fireReason, selected: mode === 'fire', reason: fireReason, sub: CONST.MISSILE_ENERGY + 'e', badge: silos ? freeSilos + '/' + silos : '' },
      drop: { enabled: !dropReason, selected: mode === 'drop', reason: dropReason, sub: CONST.DROP_ENERGY + 'e', badge: hangars ? freeH + '/' + hangars : '' },
      endReady: ready
    });
  }

  function cellName(c) {
    const p = R.xy(c);
    return String.fromCharCode(65 + p.y) + (p.x + 1);
  }
  function describeCell(c) {
    const b = R.buildingAt(state, c);
    if (b && playerSees(c)) return (b.side === A ? 'enemy ' : '') + BUILDINGS[b.type].name + ' ' + cellName(c);
    const g = state.sides[P].intel.seen[c];
    if (g) return BUILDINGS[g.type].name + '? ' + cellName(c);
    return 'grid ' + cellName(c);
  }

  function refreshOrders() {
    const orders = state.sides[P].orders.map(o => ({ id: o.id, kind: o.kind, text: (o.kind === 'missile' ? 'Missile → ' : 'Mech drop → ') + describeCell(o.to) }));
    const inc = R.detectedIncoming(state, P).map(m => ({ text: 'INCOMING → ' + describeCell(m.to) }));
    UI.setOrders(orders, phase === 'planning' ? inc : []);
  }

  function selectionInfo(c) {
    if (c < 0) return null;
    const b = R.buildingAt(state, c);
    if (b && playerSees(c)) {
      const def = BUILDINGS[b.type];
      const own = b.side === P;
      const info = { type: b.type, name: def.name, own, hp: b.hp, maxHp: b.maxHp, desc: def.desc, stats: def.stats(), ghost: false };
      if (b.type === 'shield') info.extra = 'Shield ' + b.pool + '/' + BUILDINGS.shield.pool;
      if (b.type === 'aa' || b.type === 'hq') info.extra = (info.extra ? info.extra + ' · ' : '') + 'Intercepts ready: ' + b.shots;
      if (own) {
        const rep = R.repairInfo(state, P, c);
        info.repair = rep;
        info.sellValue = R.sellValue(b);
      }
      return info;
    }
    const g = state.sides[P].intel.seen[c];
    if (g && R.ownerOfCell(c) === A) {
      const def = BUILDINGS[g.type];
      return { type: g.type, name: def.name, own: false, hp: g.hp, maxHp: g.maxHp, desc: def.desc, stats: def.stats(), ghost: true, extra: 'seen turn ' + g.turn };
    }
    return null;
  }

  function refreshSelected() {
    const info = phase === 'planning' ? selectionInfo(selectedCell) : null;
    if (!info) {
      if (selectedCell >= 0 && phase === 'planning') selectedCell = -1;
      Renderer.hideRange();
    }
    UI.showSelected(info);
    if (info) showRangeFor(info.type, selectedCell, info.own);
    Renderer.setBarsForced(selectedCell >= 0 && R.buildingAt(state, selectedCell) ? [R.buildingAt(state, selectedCell).id] : null);
  }

  function showRangeFor(type, cell, own) {
    const def = BUILDINGS[type];
    const color = own ? 0x2ec4ff : 0xff4422;
    if (type === 'aa') Renderer.showRange(cell, def.range, color);
    else if (type === 'gunpod') Renderer.showRange(cell, def.range, 0xffb000);
    else if (type === 'radar') Renderer.showRange(cell, def.range, 0x66ff99);
    else if (type === 'shield') Renderer.showRange(cell, def.range, 0x9d7cff, true);
    else if (type === 'hq') Renderer.showRange(cell, def.range, color);
    else Renderer.hideRange();
  }

  function refreshZone() {
    if (phase !== 'planning') { Renderer.setZone(null); Renderer.setGridEmphasis(false); return; }
    if (mode === 'build') {
      const can = state.sides[P].credits >= BUILDINGS[buildType].cost;
      Renderer.setZone(c => R.inBuildZone(state, P, c) ? (can ? [60, 255, 130, 70] : [255, 200, 60, 50]) : (R.ownerOfCell(c) === P ? [0, 0, 0, 40] : null));
      Renderer.setGridEmphasis(true);
    } else if (mode === 'fire' || mode === 'drop') {
      const col = mode === 'fire' ? [255, 120, 30, 46] : [46, 196, 255, 46];
      Renderer.setZone(c => R.ownerOfCell(c) === A ? col : null);
      Renderer.setGridEmphasis(true);
    } else {
      Renderer.setZone(null);
      Renderer.setGridEmphasis(false);
    }
  }

  function refreshHover() {
    if (!state || phase !== 'planning' || hoverCell < 0) {
      Renderer.setHover(-1); Renderer.setBuildGhost(null, -1);
      if (phase === 'planning' && mode === 'build') Renderer.hideRange();
      return;
    }
    if (mode === 'build') {
      const ok = !R.buildableReason(state, P, buildType, hoverCell);
      Renderer.setHover(hoverCell, ok ? 0x66ff99 : 0xff4444);
      Renderer.setBuildGhost(buildType, hoverCell, ok);
      showRangeFor(buildType, hoverCell, true);
    } else if (mode === 'fire') {
      Renderer.setBuildGhost(null, -1);
      Renderer.setHover(hoverCell, R.missileReason(state, P, hoverCell) ? 0xff4444 : 0xffb000);
    } else if (mode === 'drop') {
      Renderer.setBuildGhost(null, -1);
      Renderer.setHover(hoverCell, R.dropReason(state, P, hoverCell) ? 0xff4444 : 0x2ec4ff);
    } else {
      Renderer.setBuildGhost(null, -1);
      Renderer.setHover(hoverCell, 0xdddddd);
    }
  }

  // Tutorial objectives
  const OBJECTIVES = [
    { text: 'Build a <b>Supply Depot</b> <kbd>1</kbd> next to your HQ for credits', done: s => has(s, 'depot') },
    { text: 'Build a <b>Power Plant</b> <kbd>2</kbd> for energy', done: s => has(s, 'power') },
    { text: 'You start with a <b>Missile Silo</b>. Press <kbd>Q</kbd> and click the red <b>enemy HQ</b>', done: s => s.sides[P].stats.missilesFired > 0 || s.sides[P].orders.some(o => o.kind === 'missile') },
    { text: 'Press <kbd>Space</kbd> to end the turn and watch the battle', done: s => s.turn > 1 },
    { text: 'HQs and AA shoot missiles down (40% / 70%). Fire <b>several at once</b> to break through — build more silos', done: s => R.buildingsOf(s, P, 'silo').length >= 2 },
    { text: 'Build a <b>Radar</b> <kbd>3</kbd> — reveals targets and incoming missiles', done: s => has(s, 'radar') },
    { text: 'Protect your HQ with an <b>AA Battery</b> <kbd>5</kbd>', done: s => has(s, 'aa') },
    { text: 'Enemy mechs? A <b>Gun Pod</b> <kbd>8</kbd> shreds them', done: s => has(s, 'gunpod') }
  ];
  function has(s, t) { return R.buildingsOf(s, P, t).length > 0; }
  function refreshObjectives() {
    if (objectivesHidden || !state) { UI.setObjectives(null); return; }
    const list = OBJECTIVES.map(o => ({ text: o.text, done: o.done(state) }));
    if (list.every(o => o.done)) { objectivesHidden = true; UI.setObjectives(null); UI.toast('Briefing complete — good luck, Commander', 'good'); return; }
    UI.setObjectives(list);
  }

  // ── Tooltips ──────────────────────────────────────────────
  function cardTooltip(type, e) {
    const d = BUILDINGS[type];
    const s = state ? state.sides[P] : null;
    const reason = s && s.credits < d.cost ? 'Need ' + d.cost + ' credits' : null;
    const r = e.currentTarget.getBoundingClientRect();
    UI.showTip(`<b>${UI.esc(d.name)}</b> <span class="k">[${d.key}]</span><br><span style="color:var(--c-credit)">${d.cost} credits</span> · ${d.hp} HP<br>${UI.esc(d.desc)}<br><span class="k">${d.stats().map(UI.esc).join(' · ')}</span>${d.counter ? '<br><span class="cnt">' + UI.esc(d.counter) + '</span>' : ''}${reason ? '<br><span class="bad">' + reason + '</span>' : ''}`, r.left, r.top - 150);
  }

  function cellTooltip() {
    if (!state || phase !== 'planning' || hoverCell < 0) { UI.hideTip(); return; }
    let html = null;
    if (mode === 'build') {
      const reason = R.buildableReason(state, P, buildType, hoverCell);
      if (reason) html = '<span class="bad">' + UI.esc(reason) + '</span>';
    } else if (mode === 'fire') {
      const reason = R.missileReason(state, P, hoverCell);
      html = reason ? '<span class="bad">' + UI.esc(reason) + '</span>' : 'Fire at <b>' + UI.esc(describeCell(hoverCell)) + '</b><br><span class="k">Lands at the start of next turn\'s combat</span>';
    } else if (mode === 'drop') {
      const reason = R.dropReason(state, P, hoverCell);
      html = reason ? '<span class="bad">' + UI.esc(reason) + '</span>' : 'Drop mech at <b>' + UI.esc(cellName(hoverCell)) + '</b><br><span class="k">Lands this turn, attacks from next turn</span>';
    } else {
      const info = selectionInfo(hoverCell);
      const rob = R.robotAt(state, hoverCell);
      if (info) html = `<b>${UI.esc(info.name)}</b>${info.ghost ? ' <span class="k">(last known)</span>' : ''}<br>HP ${info.hp}/${info.maxHp}${info.extra ? '<br><span class="k">' + UI.esc(info.extra) + '</span>' : ''}`;
      else if (rob && playerSees(hoverCell)) html = `<b>${rob.side === P ? 'Your' : 'Enemy'} mech</b><br>HP ${rob.hp}/${rob.maxHp}${rob.fresh ? '<br><span class="k">Just landed</span>' : ''}`;
      else if (R.ownerOfCell(hoverCell) === A && !visible.has(hoverCell)) html = '<span class="k">Unknown — fogged.<br>Radar or missile impacts reveal it.</span>';
    }
    if (html) UI.showTip(html, mouse.x, mouse.y); else UI.hideTip();
  }

  // ── Input ─────────────────────────────────────────────────
  function onMouseMove(e) {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (!state) return;
    const c = Renderer.pickCell(e.clientX, e.clientY);
    if (c !== hoverCell) {
      hoverCell = c;
      refreshHover();
    }
    cellTooltip();
  }

  function onMouseUp(e) {
    UI.hideReport();
    if (!mouse.down) return;
    mouse.down = false;
    const moved = Math.hypot(e.clientX - mouse.downX, e.clientY - mouse.downY) > 6;
    if (moved || !state || phase !== 'planning') return;
    if (e.button === 2) { cancelMode(); return; }
    if (e.button !== 0) return;
    const c = Renderer.pickCell(e.clientX, e.clientY);
    if (c < 0) { cancelMode(); return; }
    clickCell(c, e.shiftKey);
    cellTooltip();
  }

  function clickCell(c, keepMode) {
    if (mode === 'build') {
      const r = R.build(state, P, buildType, c);
      if (!r.ok) return fail(r.reason);
      SND.play('build', { pan: panAt(c) });
      Renderer.addBuilding(r.building, true);
      Fx.buildDust(Renderer.cellCenter(c));
      floatAt(c, '-' + BUILDINGS[buildType].cost + 'c', 'info');
      UI.log('Built ' + BUILDINGS[buildType].name + ' at ' + cellName(c), 'player');
      if (buildType === 'radar') UI.toast('Radar comes online next turn', 'warn');
      if (!keepMode) { mode = 'select'; buildType = null; selectedCell = c; }
    } else if (mode === 'fire') {
      const r = R.queueMissile(state, P, c);
      if (!r.ok) return fail(r.reason);
      SND.play('select');
      UI.log('Missile targeted at ' + describeCell(c), 'player');
      const silo = R.buildingAt(state, r.order.from);
      if (silo) Renderer.aimTurret(silo.id, c);
      if (!R.freeLaunchers(state, P, 'silo').length || state.sides[P].energy < CONST.MISSILE_ENERGY) cancelMode();
    } else if (mode === 'drop') {
      const r = R.queueDrop(state, P, c);
      if (!r.ok) return fail(r.reason);
      SND.play('select');
      UI.log('Mech drop ordered at ' + cellName(c), 'player');
      if (R.dropReason(state, P, c)) cancelMode();
    } else {
      selectedCell = (selectionInfo(c) ? c : -1);
      if (selectedCell >= 0) SND.play('uiClick');
    }
    refreshAll();
  }

  function fail(reason) {
    SND.play('error');
    UI.toast(reason, 'bad');
    if (hoverCell >= 0) floatAt(hoverCell, '✕', 'dmg');
  }

  function cancelMode() {
    if (mode !== 'select') { mode = 'select'; buildType = null; }
    else selectedCell = -1;
    refreshAll();
  }

  function selectBuild(type) {
    if (!state || phase !== 'planning') return;
    const def = BUILDINGS[type];
    if (state.sides[P].credits < def.cost) return fail('Need ' + def.cost + ' credits for ' + def.name);
    if (def.max && R.buildingsOf(state, P, type).length >= def.max) return fail('Max ' + def.max + ' ' + def.name + 's');
    SND.play('uiClick');
    if (mode === 'build' && buildType === type) { mode = 'select'; buildType = null; }
    else { mode = 'build'; buildType = type; selectedCell = -1; }
    refreshAll();
  }

  function action(name, arg) {
    if (name === 'mute') { UI.setMuted(SND.toggleMute()); return; }
    if (name === 'hideObjectives') { objectivesHidden = true; refreshObjectives(); return; }
    if (name === 'dismissReport') { UI.hideReport(); return; }
    if (!state) return;
    if (name === 'menu') {
      if (phase === 'resolving') return UI.toast('Wait for combat to finish', 'warn');
      if (phase === 'planning') saveGame();
      toMenu();
      return;
    }
    if (phase === 'resolving' && name === 'end') { Timeline.skip(); return; }
    if (phase !== 'planning') return;
    switch (name) {
      case 'fire': {
        const reason = R.missileReason(state, P, R.hqCell(A));
        if (reason && reason !== 'Target must be in enemy territory') return fail(reason);
        SND.play('uiClick');
        mode = mode === 'fire' ? 'select' : 'fire'; selectedCell = -1;
        if (mode === 'fire') UI.toast('Click an enemy cell to target (right-click to cancel)', 'warn');
        break;
      }
      case 'drop': {
        const reason = R.dropReason(state, P, R.hqCell(A));
        if (reason) return fail(reason);
        SND.play('uiClick');
        mode = mode === 'drop' ? 'select' : 'drop'; selectedCell = -1;
        if (mode === 'drop') UI.toast('Click an enemy cell to drop a mech', 'warn');
        break;
      }
      case 'repair': {
        if (selectedCell < 0) return fail('Select one of your structures first');
        const r = R.repair(state, P, selectedCell);
        if (!r.ok) return fail(r.reason);
        SND.play('repair', { pan: panAt(selectedCell) });
        Renderer.setBuildingHp(r.building.id, r.building.hp, r.building.maxHp);
        Fx.heal(Renderer.cellCenter(selectedCell));
        floatAt(selectedCell, '+' + r.amount + ' HP', 'heal');
        break;
      }
      case 'sell': {
        if (selectedCell < 0) return fail('Select one of your structures first');
        const r = R.sell(state, P, selectedCell);
        if (!r.ok) return fail(r.reason);
        SND.play('sell', { pan: panAt(selectedCell) });
        Renderer.removeBuilding(r.building.id, false);
        floatAt(selectedCell, '+' + r.value + 'c', 'heal');
        UI.log('Sold ' + BUILDINGS[r.building.type].name + ' (+' + r.value + 'c)', 'player');
        selectedCell = -1;
        if (r.building.type === 'radar') syncWorld(false);
        break;
      }
      case 'undo': {
        const r = R.undo(state, P);
        if (!r.ok) return fail(r.reason);
        SND.play('uiClick');
        if (r.kind === 'build') { Renderer.removeBuilding(r.building.id, true); if (r.building.type === 'radar') syncWorld(false); }
        if (r.kind === 'repair') Renderer.setBuildingHp(r.building.id, r.building.hp, r.building.maxHp);
        if (r.kind === 'sell') { Renderer.addBuilding(r.building, true); if (r.building.type === 'radar') syncWorld(false); }
        UI.toast('Undone', 'good');
        break;
      }
      case 'cancel': {
        const r = R.cancelOrder(state, P, arg);
        if (r.ok) { SND.play('uiClick'); UI.toast('Order cancelled — energy refunded', 'good'); }
        break;
      }
      case 'end': endTurn(); return;
    }
    refreshAll();
  }

  function onKey(e) {
    if (!/Tab|Shift|Control|Alt/.test(e.key)) reportTimer = Math.min(reportTimer, 0.01);
    if (e.repeat && e.code !== 'Tab') return;
    if (UI.isHelpOpen()) {
      if (e.code === 'Escape' || e.key === '?' || e.code === 'Slash') UI.showHelp(false);
      e.preventDefault();
      return;
    }
    if (e.key === '?' || e.code === 'Slash') { UI.showHelp(true); return; }
    if (e.code === 'KeyM') { action('mute'); return; }
    if (e.code === 'KeyG') { UI.toast('Graphics quality: ' + Renderer.cycleQuality(), 'good'); return; }
    if (!state) return;
    if (e.code === 'Tab') {
      e.preventDefault();
      speed = speed === 1 ? 2 : speed === 2 ? 3 : 1;
      UI.setCombatHint(phase === 'resolving', speed);
      return;
    }
    if (e.code === 'KeyH') { Renderer.focusCell(R.hqCell(P), 250, true); return; }
    if (e.code === 'KeyF') { frameView(false); return; }
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); action('end'); return; }
    if (phase !== 'planning') return;
    const digit = /^Digit([1-8])$/.exec(e.code) || /^Numpad([1-8])$/.exec(e.code);
    if (digit) { selectBuild(BUILD_ORDER[+digit[1] - 1]); return; }
    switch (e.code) {
      case 'KeyQ': action('fire'); break;
      case 'KeyE': action('drop'); break;
      case 'KeyT': action('repair'); break;
      case 'KeyX': case 'Delete': action('sell'); break;
      case 'KeyZ': case 'Backspace': e.preventDefault(); action('undo'); break;
      case 'Escape': cancelMode(); break;
    }
  }

  // ── Helpers for effects ───────────────────────────────────
  function panAt(cell) {
    const p = Renderer.project(Renderer.cellCenter(cell));
    return Math.max(-1, Math.min(1, (p.x / window.innerWidth) * 2 - 1)) * 0.8;
  }
  function panAtPos(v) {
    const p = Renderer.project(v);
    return Math.max(-1, Math.min(1, (p.x / window.innerWidth) * 2 - 1)) * 0.8;
  }
  function floatAt(cell, text, cls, h) {
    const v = Renderer.cellCenter(cell);
    v.y = h || 12;
    const p = Renderer.project(v);
    if (p.visible) UI.floatText(p.x + (Math.random() - 0.5) * 16, p.y, text, cls);
  }

  // ── Turn resolution & playback ────────────────────────────
  function endTurn() {
    if (phase !== 'planning') return;
    const s = state.sides[P];
    const cap = R.energyCap(state, P), inc = R.income(state, P).energy;
    if (s.energy + inc > cap && (R.freeLaunchers(state, P, 'silo').length && s.energy >= CONST.MISSILE_ENERGY)) {
      UI.toast('Note: energy above cap is wasted — idle silos could fire', 'warn');
    }
    SND.play('endTurn');
    phase = 'resolving';
    mode = 'select'; buildType = null; selectedCell = -1;
    UI.hideTip(); UI.hideReport();
    UI.setDock(false);
    UI.showSelected(null);
    UI.setObjectives(null);
    Renderer.setHover(-1); Renderer.setBuildGhost(null, -1); Renderer.hideRange(); Renderer.setZone(null); Renderer.setGridEmphasis(false);
    Renderer.setMarkers([], []);
    UI.setOrders([], []);

    AI.planTurn(state, A);
    syncWorld(true); // show AI construction (if visible) before combat
    for (const b of R.buildingsOf(state, A)) if (b.builtTurn === state.turn && b.type !== 'hq' && playerSees(b.cell)) UI.log('Enemy built ' + BUILDINGS[b.type].name + ' at ' + cellName(b.cell), 'enemy');

    // Snapshot ids by cell before resolution mutates the board
    const idAt = {};
    for (let c = 0; c < R.N; c++) { const b = state.cells[c].building; if (b) idAt[c] = b.id; }
    const turn = state.turn;
    combatHud = hudData();   // HUD stays on this turn's values during playback
    UI.setHUD(combatHud);
    const events = R.resolveTurn(state);
    SND.setMode('combat');
    UI.setCombatHint(true, speed);
    frameView(false);
    Timeline.start(buildPlayback(events, idAt, turn), () => finishTurn(events, turn));
  }

  function buildPlayback(events, idAt, turn) {
    const items = []; // {t, fn}
    const at = (t, fn) => items.push({ t, fn });
    const byBeat = b => events.filter(e => e.beat === b);
    const impacts = {};
    for (const e of byBeat(R.BEAT.IMPACT)) impacts[e.id] = e;

    at(0, () => UI.banner('COMBAT', 'Turn ' + turn + ' resolution', true));
    let t = 0.6;

    // Descents + intercepts + impacts
    const desc = byBeat(R.BEAT.DESCEND);
    const DESC = 1.7;
    desc.forEach((e, i) => {
      const t0 = t + i * 0.22;
      at(t0, () => animateDescent(e, DESC, idAt, impacts[e.id]));
    });
    if (desc.length) t += (desc.length - 1) * 0.22 + DESC + 0.7;

    // Gun pods
    const guns = byBeat(R.BEAT.GUNFIRE);
    guns.forEach((e, i) => at(t + i * 0.4, () => animateGunfire(e, idAt)));
    if (guns.length) t += guns.length * 0.4 + 0.5;

    // Robots
    const bots = byBeat(R.BEAT.ROBOTS);
    let botEnd = 0;
    bots.forEach((e, i) => {
      const t0 = t + i * 0.18;
      const dur = e.type === 'robotMove' ? e.path.length * 0.42 : 0.7;
      botEnd = Math.max(botEnd, t0 + dur);
      at(t0, () => e.type === 'robotMove' ? animateRobotMove(e) : animateRobotHit(e, idAt));
    });
    if (bots.length) t = botEnd + 0.4;

    // Drops
    const drops = byBeat(R.BEAT.DROPS);
    drops.forEach((e, i) => at(t + i * 0.25, () => e.type === 'drop' ? animateDrop(e, idAt) : logCancelled(e)));
    if (drops.length) t += (drops.length - 1) * 0.25 + 2.0;

    // Launches
    const launches = byBeat(R.BEAT.LAUNCH);
    launches.forEach((e, i) => at(t + i * 0.2, () => e.type === 'launch' ? animateLaunch(e, idAt) : logCancelled(e)));
    if (launches.length) t += (launches.length - 1) * 0.2 + 1.5;

    if (!desc.length && !guns.length && !bots.length && !drops.length && !launches.length) {
      at(0.8, () => UI.log('A quiet turn. No combat.', 'sys'));
      t = 1.4;
    }
    at(t + 0.3, () => {});
    return items;
  }

  function logCancelled(e) {
    UI.log((e.side === P ? 'Your ' : 'Enemy ') + (e.kind === 'drop' ? 'drop' : 'launch') + ' cancelled — launcher destroyed', e.side === P ? 'bad' : 'good');
  }

  function arcPoint(a, b, h, t, out) {
    out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + 4 * h * t * (1 - t), a.z + (b.z - a.z) * t);
    return out;
  }
  const UP = new THREE.Vector3(0, 1, 0);
  function orient(obj, dir) {
    if (dir.lengthSq() < 1e-6) return;
    obj.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
  }

  function missilePath(e) {
    const a = Renderer.cellCenter(e.from); a.y = 4;
    const b = Renderer.cellCenter(e.to); b.y = 0.5;
    return { a, b, h: Renderer.missileArcHeight(a, b) };
  }

  function animateLaunch(e, idAt) {
    const sid = idAt[e.from];
    const own = e.side === P;
    const { a, b, h } = missilePath(e);
    if (sid) { Renderer.openHatch(sid); a.copy(Renderer.muzzleWorld(sid)); }
    const vis = playerSees(e.from);
    UI.log(own ? 'Missile launched at ' + describeCell(e.to) + ' — impact next turn'
      : vis ? 'Enemy missile launched from ' + cellName(e.from) + ' — impact next turn'
        : 'Enemy launch heard — origin and target unknown', own ? 'player' : 'enemy');
    if (!vis) {
      // Enemy launch from the fog: heard, not seen (its arc would reveal silo and target)
      SND.play('missileLaunch', { pan: 0.6, gain: 0.5 });
      return;
    } else {
      SND.play('missileLaunch', { pan: panAtPos(a) });
      Fx.dustRing(a, 0.6);
    }
    const m = Models.missile(e.side);
    m.scale.setScalar(2.4);
    Renderer.add(m);
    const p = new THREE.Vector3(), prev = new THREE.Vector3().copy(a);
    Timeline.tween(1.4, k => {
      const t = 0.5 * (k * k);
      arcPoint(a, b, h, t, p);
      m.position.copy(p);
      orient(m, p.clone().sub(prev));
      if (m.visible) Fx.trail(p, 'missile', own ? 0x66ccff : 0xff6a00);
      prev.copy(p);
    }, () => { Renderer.remove(m); Models.dispose(m); });
  }

  function animateDescent(e, dur, idAt, impact) {
    const own = e.side === P;
    const { a, b, h } = missilePath(e);
    const m = Models.missile(e.side);
    m.scale.setScalar(2.4);
    Renderer.add(m);
    if (!own) SND.play('incoming', { pan: panAt(e.to), gain: 0.8 });
    const intercepted = e.interceptedBy >= 0;
    const shots = e.shots || [];
    // each AA shot meets the missile a little further along its descent
    const meetK = i => 0.42 + 0.17 * i;
    const endK = intercepted ? meetK(shots.length - 1) : 1;
    const arcT = kk => 0.5 + 0.5 * (kk * kk * 0.6 + kk * 0.4);
    const p = new THREE.Vector3(), prev = new THREE.Vector3();
    arcPoint(a, b, h, 0.5, prev);
    const fired = shots.map(() => false);
    Timeline.tween(dur * endK, k => {
      const kk = k * endK;
      arcPoint(a, b, h, arcT(kk), p);
      m.position.copy(p);
      orient(m, p.clone().sub(prev));
      Fx.trail(p, 'missile', own ? 0x66ccff : 0xff6a00);
      prev.copy(p);
      shots.forEach((shot, i) => {
        if (fired[i] || kk < meetK(i) - 0.25) return;
        fired[i] = true;
        fireInterceptor(shot, arcPoint(a, b, h, arcT(meetK(i)), new THREE.Vector3()), dur * 0.25, idAt, e);
      });
    }, () => {
      Renderer.remove(m); Models.dispose(m);
      if (intercepted) {
        Fx.smallBlast(p, 0xffdd88);
        SND.play('intercept', { pan: panAtPos(p) });
        const sp = Renderer.project(p.clone());
        if (sp.visible) UI.floatText(sp.x, sp.y - 10, 'INTERCEPTED', 'blue');
        UI.log((own ? 'Your missile was intercepted' : 'Intercepted enemy missile') + ' over ' + cellName(e.to), own ? 'bad' : 'good');
        Renderer.addTrauma(0.12, p);
      } else if (impact) {
        if (shots.length) UI.log((own ? 'Your missile evaded AA fire over ' : 'AA missed the enemy missile over ') + cellName(e.to), own ? 'good' : 'bad');
        applyImpact(impact, idAt);
      }
    });
  }

  // Interceptor from a battery to a meeting point; a miss bursts beside the missile
  function fireInterceptor(shot, meet, flight, idAt, e) {
    const batId = idAt[shot.by];
    if (batId) Renderer.aimTurret(batId, e.to);
    const start = batId ? Renderer.muzzleWorld(batId) : Renderer.cellCenter(shot.by).setY(6);
    const goal = meet.clone();
    if (!shot.hit) goal.add(new THREE.Vector3((Math.random() - 0.5) * 14, 5 + Math.random() * 5, (Math.random() - 0.5) * 14));
    const it = Models.interceptor();
    it.scale.setScalar(2.2);
    Renderer.add(it);
    SND.play('flak', { pan: panAtPos(start) });
    const ip = new THREE.Vector3(), iprev = start.clone();
    Timeline.tween(flight, q => {
      ip.lerpVectors(start, goal, q * q);
      ip.y += Math.sin(q * Math.PI) * 6;
      it.position.copy(ip);
      orient(it, ip.clone().sub(iprev));
      Fx.trail(ip, 'interceptor');
      iprev.copy(ip);
    }, () => {
      Renderer.remove(it); Models.dispose(it);
      if (!shot.hit) {
        Fx.smallBlast(ip, 0xaaaaaa);
        SND.play('flak', { pan: panAtPos(ip), gain: 0.6 });
        const sp = Renderer.project(ip.clone());
        if (sp.visible) UI.floatText(sp.x, sp.y - 10, 'MISS', 'info');
      }
    });
  }

  function applyImpact(ev, idAt) {
    const pos = Renderer.cellCenter(ev.cell);
    const own = ev.side === P;
    const hqHit = ev.hits.some(h => h.type === 'hq' && h.dmg > 0);
    Fx.explosion(pos, hqHit ? 1.3 : 1);
    SND.play('explosion', { pan: panAt(ev.cell), big: hqHit });
    Renderer.addTrauma(hqHit ? 0.6 : 0.38, pos);
    let total = 0;
    for (const h of ev.hits) total += applyHit(h, idAt);
    const name = describeCell(ev.cell);
    if (!ev.hits.length) UI.log((own ? 'Missile hit empty ground at ' : 'Enemy missile hit empty ground at ') + cellName(ev.cell), own ? 'player' : 'enemy');
    else UI.log((own ? 'Missile impact on ' : 'Enemy missile hit ') + name + ': ' + total + ' damage', own ? 'good' : 'bad');
    // the impact reveals the area — lift fog right away for the attacker
    if (own) {
      for (const c of ev.reveal) visible.add(c);
      Renderer.setFog(c => R.ownerOfCell(c) === A && !visible.has(c));
      for (const c of ev.reveal) { const id = idAt[c]; if (id && Renderer.getBuilding(id)) Renderer.setBuildingVisible(id, true); }
    }
  }

  // Apply a damage record from the rules to the view. Returns damage dealt.
  function applyHit(h, idAt) {
    const vis = playerSees(h.cell);
    if (h.absorbed > 0 && h.shieldCell >= 0) {
      const sid = idAt[h.shieldCell];
      if (sid) { Renderer.flashShield(sid); Renderer.setShieldPool(sid, h.shieldPool); }
      const sp = Renderer.cellCenter(h.cell); sp.y = 8;
      Fx.shieldHit(sp);
      SND.play('shieldHit', { pan: panAt(h.cell) });
      if (vis) floatAt(h.cell, '◈' + h.absorbed, 'shield', 16);
    }
    Renderer.setBuildingHp(h.id, h.hpAfter, h.maxHp);
    if (h.dmg > 0 && vis) floatAt(h.cell, '-' + h.dmg, h.type === 'hq' ? 'dmg big' : 'dmg');
    if (h.destroyed) {
      const pos = Renderer.cellCenter(h.cell);
      Renderer.setBuildingVisible(h.id, true);
      Renderer.removeBuilding(h.id, false);
      Fx.explosion(pos, h.type === 'hq' ? 2 : 1.2);
      Fx.setEmitter('ruin' + h.cell, { x: pos.x, y: 1, z: pos.z }, 'fire', 6);
      SND.play('destroyed', { pan: panAt(h.cell), big: h.type === 'hq' });
      Renderer.addTrauma(h.type === 'hq' ? 1 : 0.5, pos);
      floatAt(h.cell, 'DESTROYED', 'dmg big', 20);
      UI.log((h.side === P ? 'LOST: your ' : 'DESTROYED: enemy ') + BUILDINGS[h.type].name + ' at ' + cellName(h.cell), h.side === P ? 'bad' : 'good');
    }
    if (h.type === 'hq') refreshHQFromHit(h);
    return h.dmg;
  }

  let combatHud = null;
  function refreshHQFromHit(h) {
    if (!combatHud) return;
    (h.side === P ? combatHud.hq : combatHud.enemyHq).hp = h.hpAfter;
    UI.setHUD(combatHud);
  }

  function animateGunfire(e, idAt) {
    const gid = idAt[e.from];
    e.shots.forEach((s, i) => {
      Timeline.tween(0.14 * i + 0.01, () => {}, () => {
        const rec = Renderer.getRobot(s.robotId);
        const target = rec ? rec.group.position.clone().setY(5) : Renderer.cellCenter(s.cell).setY(5);
        if (gid) Renderer.aimTurret(gid, s.cell);
        const from = gid ? Renderer.muzzleWorld(gid) : Renderer.cellCenter(e.from).setY(4);
        Fx.muzzle(from, target.clone().sub(from).normalize(), 0xffcc66);
        Fx.tracer(from, target, e.side === P ? 0x66ccff : 0xff7744);
        Fx.smallBlast(target, 0xffaa44);
        SND.play('gunfire', { pan: panAtPos(target) });
        Renderer.hitRobot(s.robotId);
        Renderer.setRobotHp(s.robotId, s.hpAfter);
        if (rec && rec.group.visible) floatAt(s.cell, '-' + s.dmg, 'dmg', 14);
        const gun = e.gunType === 'hq' ? 'Command Center gun' : 'gun pod';
        if (s.killed) {
          Fx.explosion(target.setY(2), 0.7);
          SND.play('robotDie', { pan: panAtPos(target) });
          Renderer.removeRobot(s.robotId);
          UI.log(e.side === P ? 'Your ' + gun + ' destroyed an enemy mech' : 'Your mech was destroyed by an enemy ' + gun + ' at ' + cellName(e.from), e.side === P ? 'good' : 'bad');
        } else if (e.side !== P) {
          UI.log('Your mech hit by an enemy ' + gun + ' at ' + cellName(e.from) + ' (-' + s.dmg + ', ' + s.hpAfter + ' HP left)', 'bad');
        }
      });
    });
  }

  function animateRobotMove(e) {
    const rec = Renderer.getRobot(e.id);
    if (!rec) return;
    const pts = [Renderer.cellCenter(e.from)].concat(e.path.map(c => Renderer.cellCenter(c)));
    rec.moving = true;
    const n = pts.length - 1;
    let lastStep = -1;
    Timeline.tween(n * 0.42, k => {
      const f = Math.min(n - 1e-6, k * n);
      const i = Math.floor(f), t = f - i;
      const a = pts[i], b = pts[i + 1];
      rec.group.position.set(a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t);
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      rec.group.rotation.y = yaw;
      const cell = i < e.path.length ? (t < 0.5 ? (i === 0 ? e.from : e.path[i - 1]) : e.path[i]) : e.path[e.path.length - 1];
      rec.group.visible = e.side === P || playerSees(cell);
      const step = Math.floor(f * 2);
      if (step !== lastStep) { lastStep = step; if (rec.group.visible) SND.play('robotStep', { pan: panAtPos(rec.group.position), gain: 0.5 }); }
    }, () => {
      rec.moving = false;
      rec.cell = e.path[e.path.length - 1];
      const t = Renderer.cellCenter(e.facing);
      rec.group.rotation.y = Math.atan2(t.x - rec.group.position.x, t.z - rec.group.position.z);
    });
  }

  function animateRobotHit(e, idAt) {
    const rec = Renderer.getRobot(e.id);
    const tp = Renderer.cellCenter(e.hit.cell);
    if (rec) {
      rec.group.rotation.y = Math.atan2(tp.x - rec.group.position.x, tp.z - rec.group.position.z);
      rec.punch = 1;
    }
    Timeline.tween(0.22, () => {}, () => {
      const p = tp.clone().setY(4);
      Fx.smallBlast(p, 0xffaa33);
      SND.play('robotPunch', { pan: panAtPos(p) });
      Renderer.addTrauma(e.hit.type === 'hq' ? 0.3 : 0.15, p);
      const what = (e.side === P ? 'Your mech smashes enemy ' : 'Enemy mech smashes your ') + BUILDINGS[e.hit.type].name;
      UI.log(what + (e.hit.dmg > 0 ? ' (-' + e.hit.dmg + (e.hit.absorbed ? ', ' + e.hit.absorbed + ' absorbed by shield' : '') + ')' : ' — absorbed by shield'), e.side === P ? 'good' : 'bad');
      applyHit(e.hit, idAt);
    });
  }

  function animateDrop(e, idAt) {
    const own = e.side === P;
    const hid = idAt[e.from];
    if (hid) Renderer.openHatch(hid);
    const a = Renderer.cellCenter(e.from); a.y = 4;
    const b = Renderer.cellCenter(e.to);
    const h = Math.min(80, 35 + a.distanceTo(b) * 0.18);
    const pod = Models.pod(e.side);
    pod.scale.setScalar(1.5);
    Renderer.add(pod);
    const p = new THREE.Vector3();
    SND.play('podLaunch', { pan: panAtPos(a), gain: own || playerSees(e.from) ? 1 : 0.5 });
    const landVisible = own || playerSees(e.to);
    Timeline.tween(1.6, k => {
      const t = 1 - Math.pow(1 - k, 2.2);
      arcPoint(a, b, h, t, p);
      pod.position.copy(p);
      pod.visible = own || p.y > 25 || playerSees(k < 0.5 ? e.from : e.to);
      if (pod.userData.flame) pod.userData.flame.scale.setScalar(k > 0.75 ? 1.6 : 0.8);
      if (pod.visible) Fx.trail(p, 'pod', own ? 0x66ccff : 0xff6a00);
    }, () => {
      Renderer.remove(pod); Models.dispose(pod);
      const rec = Renderer.addRobot(e.robot);
      rec.group.visible = landVisible;
      const tgt = Renderer.cellCenter(own ? R.hqCell(A) : R.hqCell(P));
      rec.group.rotation.y = Math.atan2(tgt.x - b.x, tgt.z - b.z);
      if (landVisible) {
        Fx.dustRing(b, 1.1);
        Fx.smallBlast(b.clone().setY(2), 0xffaa55);
        Renderer.addTrauma(0.2, b);
      }
      SND.play('robotLand', { pan: panAt(e.to) });
      UI.log(own ? 'Mech landed at ' + cellName(e.to) : (landVisible ? 'Enemy mech landed at ' + cellName(e.to) + '!' : 'Enemy drop pod detected'), own ? 'player' : 'bad');
    });
  }

  function finishTurn(events, turn) {
    UI.setCombatHint(false);
    combatHud = null;
    syncWorld(true);
    if (state.winner) return gameOver();
    const report = buildReport(events, turn);
    if (events.some(e => /descend|gunfire|robotHit|drop/.test(e.type))) { UI.showReport(report); reportTimer = 6; }
    beginPlanning(false);
  }

  function buildReport(events, turn) {
    const side = s => ({ dealt: 0, hits: 0, landing: 0, intercepts: 0, robotsLost: 0, lostNames: [] });
    const r = { turn, player: side(), ai: side(), income: R.income(state, P) };
    const other = s => (s === P ? A : P);
    for (const e of events) {
      if (e.type === 'descend') {
        r[e.side].landing++;
        if (e.interceptedBy >= 0) r[other(e.side)].intercepts++; else r[e.side].hits++;
      }
      if (e.type === 'impact') for (const h of e.hits) r[e.side].dealt += h.dmg;
      if (e.type === 'robotHit') r[e.side].dealt += e.hit.dmg;
      if (e.type === 'gunfire') for (const s of e.shots) if (s.killed) r[other(e.side)].robotsLost++;
      if (e.type === 'end') for (const d of e.destroyed) r[d.side].lostNames.push(BUILDINGS[d.type].name);
    }
    return r;
  }

  function gameOver() {
    phase = 'gameover';
    clearSave();
    UI.setDock(false);
    SND.setMode('off');
    SND.setTension(false);
    const w = state.winner;
    SND.play(w === P ? 'victory' : 'defeat');
    UI.banner(w === P ? 'VICTORY' : w === A ? 'DEFEAT' : 'DRAW', state.endReason, w !== P);
    refreshHUD();
    const ps = state.sides[P].stats, as = state.sides[A].stats;
    const acc = s => s.missilesFired ? Math.round(100 * s.missilesHit / Math.max(1, s.missilesFired)) + '%' : '—';
    setTimeout(() => {
      if (phase !== 'gameover') return;
      UI.showGameOver({
        title: w === P ? 'VICTORY' : w === A ? 'DEFEAT' : 'DRAW',
        kind: w === P ? 'win' : w === A ? 'lose' : 'draw',
        reason: state.endReason + ' — turn ' + state.turn + ' · ' + CONST.DIFFICULTY[state.difficulty].name,
        rows: [
          ['Damage dealt', ps.damageDealt, as.damageDealt],
          ['Structures built', ps.built, as.built],
          ['Structures destroyed', ps.destroyed, as.destroyed],
          ['Missiles fired', ps.missilesFired, as.missilesFired],
          ['Missiles past defenses', acc(ps), acc(as)],
          ['Enemy missiles shot down', ps.intercepts, as.intercepts],
          ['Mechs deployed', ps.robotsDeployed, as.robotsDeployed],
          ['Enemy mechs destroyed', ps.robotsKilled, as.robotsKilled]
        ]
      });
    }, 2600);
  }

  // ── Timeline (dt-driven; skippable) ───────────────────────
  const Timeline = (function () {
    let items = [], tweens = [], t = 0, running = false, onDone = null, endT = 0, gen = 0;
    function start(list, done) {
      items = list.slice().sort((a, b) => a.t - b.t);
      tweens = []; t = 0; running = true; onDone = done;
      endT = items.length ? items[items.length - 1].t : 0;
      gen++;
    }
    function tween(dur, update, done) {
      tweens.push({ dur: Math.max(0.001, dur), e: 0, update, done });
    }
    function update(dt) {
      if (!running) return;
      t += dt;
      while (items.length && items[0].t <= t) items.shift().fn();
      for (let i = 0; i < tweens.length; i++) {
        const tw = tweens[i];
        tw.e += dt;
        const k = Math.min(1, tw.e / tw.dur);
        tw.update(k);
        if (k >= 1) { tweens.splice(i--, 1); if (tw.done) tw.done(); }
      }
      if (!items.length && !tweens.length && t >= endT) {
        running = false;
        const d = onDone; onDone = null;
        if (d) d();
      }
    }
    function skip() {
      if (!running) return;
      // run everything to completion, quickly
      let guard = 0;
      while ((items.length || tweens.length) && guard++ < 2000) update(0.25);
      update(0);
    }
    function cancel() { items = []; tweens = []; running = false; onDone = null; gen++; }
    return { start, tween, update, skip, cancel, get running() { return running; } };
  })();

  // ── Frame loop ────────────────────────────────────────────
  function frame(now) {
    requestAnimationFrame(frame);
    const raw = Math.min(0.25, (now - lastFrame) / 1000);   // real time, so slow machines don't slow playback
    const dt = Math.min(0.05, raw);
    lastFrame = now;
    if (phase === 'resolving') Timeline.update(raw * speed);
    if (reportTimer > 0) { reportTimer -= raw; if (reportTimer <= 0) UI.hideReport(); }
    // highlight hovered order's target
    Renderer.render(dt, !UI.isHelpOpen() && phase !== 'menu');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
