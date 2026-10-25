// ============================================================
// Robot Attack 2026 — Orchestrator
// ============================================================
// State machine (menu → planning → resolving → planning … → game over),
// input handling, world/view synchronisation and the combat playback
// timeline. A single requestAnimationFrame loop drives everything;
// playback is dt-based so it can be sped up or skipped safely.

(function () {
  'use strict';

  const R = Rules;
  // The side being played from the controls. Hot-seat swaps it between the two humans.
  let P = CONST.SIDE_PLAYER, A = CONST.SIDE_AI;
  const P1 = CONST.SIDE_PLAYER, P2 = CONST.SIDE_AI;
  const seatName = side => side === P1 ? 'Player 1' : 'Player 2';
  const SND = window.GameAudio;

  let state = null;
  let phase = 'menu';           // menu | planning | resolving | gameover
  let difficulty = 'commander';
  let tutorial = true;
  let hotseat = false;        // two humans sharing the device
  let mechHintShown = false;
  let tapTipTimer = 0;  // one-time tip the first time enemy mechs reach your island
  let handoffNext = null;     // what to do when the next player taps Ready on the hand-off screen
  let logs = {};              // hot-seat: each player's battle log, swapped with the seat
  let lastReportP2 = null;    // hot-seat: last combat report, from Player 2's side
  // Hot-seat fairness: Player 2 plans on a copy of the board where Player 1's island is shown as it
  // was at round start (Player 1's same-turn builds, sells and repairs stay hidden, just as the AI's
  // moves are hidden from a single player). Player 2's half is merged back when they end their turn.
  let roundStart = null;      // JSON snapshot taken when Player 1's planning begins
  let realState = null;       // the live game while Player 2 plans on the copy
  let mode = 'select';          // select | build | fire | drop
  let buildType = null;
  let selectedCell = -1;
  let hoverCell = -1;
  let visible = new Set();      // enemy cells the player sees
  let speed = 1;   // combat playback speed; the saved preference is applied at boot
  let lastFrame = performance.now();
  let reportTimer = 0;
  let mouse = { x: 0, y: 0, downX: 0, downY: 0, down: false };
  let hoveredOrder = null;
  let objectivesHidden = false;
  let lastPointer = 'mouse', pendingTap = -1;

  // ── Boot ──────────────────────────────────────────────────
  function boot() {
    window.__game = { get state() { return state; }, get phase() { return phase; }, get side() { return P; }, setSpeed(v) { speed = v; } }; // debug handle
    Renderer.init();
    UI.init({
      onStart: (diff, tut) => confirmOverwrite('skirmish:' + diff) && startGame(diff, tut, null, null, false, UI.getSkirmishOptions()),
      onHotseat: () => confirmOverwrite('hotseat') && startGame('commander', false, null, null, true, UI.getSkirmishOptions()),
      onHandoffReady: () => { SND.play('uiClick'); const go = handoffNext; handoffNext = null; UI.hideHandoff(); if (go) go(); },
      onContinue: continueGame,
      onRematch: () => state && state.mission ? startMission(state.mission) : state && state.daily ? startDaily() : startGame(difficulty, tutorial, null, null, !!(state && state.hotseat), state && state.custom),
      onDaily: startDaily,
      onAchievements: () => { SND.play('uiClick'); const got = loadAch(); UI.showAchievements(ACHIEVEMENTS.map(a => Object.assign({ got: !!got[a.id] }, a))); },
      onMission: id => { SND.play('uiClick'); UI.showBriefing(CAMPAIGN[id - 1], bestMedals(id)); },
      onLaunchMission: id => { if (confirmOverwrite('mission:' + id)) startMission(id); else UI.showBriefing(CAMPAIGN[id - 1], bestMedals(id)); },
      onBriefingBack: () => { SND.play('uiClick'); toMenu(); },
      onNextMission: () => { const n = CAMPAIGN[state.mission]; if (n) { UI.hideGameOver(); UI.showBriefing(n, bestMedals(n.id)); } },
      onMenu: toMenu,
      onLayout: () => { if (state && phase !== 'menu') frameView(false); },
      onBuildSelect: selectBuild,
      onAction: action,
      onVolume: v => { SND.setVolume(v); },
      onSettings: () => { SND.play('uiClick'); UI.showSettings(currentSettings()); },
      onSetting: applySetting,
      onSpeed: cycleSpeed,
      onMusic: on => SND.setMusicEnabled(on),
      onHover: () => SND.play('uiHover'),
      onCardHover: cardTooltip,
      onOrderHover: id => { hoveredOrder = id; }
    });
    UI.setVolume(SND.getVolume());
    speed = [1, 2, 3].includes(+lsGet('ra_speed', 1)) ? +lsGet('ra_speed', 1) : 1;
    Renderer.setShake(lsGet('ra_shake', '1') !== '0');
    UI.setMuted(SND.isMuted());
    UI.setMusicChecked(SND.isMusicEnabled());
    refreshContinue();
    // Title screen: cinematic flyover of a battle in progress, logo reveal, then "press start"
    // (the first user gesture is also what lets the browser play audio)
    let seen = false;
    try { seen = !!sessionStorage.getItem('ra_intro'); sessionStorage.setItem('ra_intro', '1'); } catch (e) { /* private mode */ }
    setupBackdrop(true);
    UI.showSplash(seen, () => {
      SND.unlock();
      SND.play('titleSting');
      SND.setMode('menu');
      UI.showMenu(true, true);
    });

    const canvas = document.getElementById('game-canvas');
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', e => { mouse.down = true; mouse.downX = e.clientX; mouse.downY = e.clientY; });
    canvas.addEventListener('pointerdown', e => { lastPointer = e.pointerType; });
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', () => { hoverCell = -1; UI.hideTip(); refreshHover(); });
    window.addEventListener('keydown', onKey);
    const unlock = () => SND.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('touchend', unlock, true);   // iOS only unlocks audio on touchend/click
    window.addEventListener('click', unlock, true);
    window.addEventListener('keydown', unlock, true);

    requestAnimationFrame(frame);
  }

  // ── Game lifecycle ────────────────────────────────────────
  // ── Save / continue (one autosave slot, written each planning phase) ──
  const SAVE_KEY = 'ra_save_v2';   // v2: island maps
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
  // ── Campaign progress (number of missions completed) ──
  function campaignDone() {
    try { return Math.max(0, parseInt(localStorage.getItem('ra_campaign'), 10) || 0); } catch (e) { return 0; }
  }
  // Best medals per mission: { [id]: [won, par, hq] }
  function loadMedals() {
    try { return JSON.parse(localStorage.getItem('ra_medals')) || {}; } catch (e) { return {}; }
  }
  function bestMedals(id) { return loadMedals()[id] || [false, false, false]; }
  function recordMedals(id, got) {
    const all = loadMedals(), prev = all[id] || [false, false, false];
    all[id] = prev.map((v, i) => v || got[i]);
    try { localStorage.setItem('ra_medals', JSON.stringify(all)); } catch (e) { /* ignore */ }
    return got.some((v, i) => v && !prev[i]);
  }
  function refreshCampaign() {
    const done = campaignDone();
    UI.setCampaign(CAMPAIGN.map(m => ({ id: m.id, name: m.name, enemy: m.enemy, medals: bestMedals(m.id), state: m.id <= done ? 'done' : m.id === done + 1 ? 'open' : 'locked' })));
  }
  function startMission(id) {
    const m = CAMPAIGN[id - 1];
    if (!m) return;
    const tutBox = document.getElementById('m-tut');
    startGame(m.difficulty, id === 1 && (!tutBox || tutBox.checked), null, m);   // checklist on the first mission
  }

  // Starting a new game replaces the autosave: the first click warns, a second confirms
  let pendingOverwrite = null;
  function confirmOverwrite(key) {
    const s = loadSave();
    if (!s || pendingOverwrite === key) { pendingOverwrite = null; UI.warnOverwrite(null); return true; }
    pendingOverwrite = key;
    UI.warnOverwrite('This replaces your saved game (' + (s.state.hotseat ? 'two players, ' : s.state.mission ? 'Mission ' + s.state.mission + ', ' : '') + 'turn ' + s.state.turn + '). Click again to confirm — or use Continue.');
    SND.play('error');
    return false;
  }

  function refreshContinue() {
    const s = loadSave();
    refreshDaily();
    UI.setAchCount(Object.keys(loadAch()).filter(id => ACHIEVEMENTS.some(a => a.id === id)).length, ACHIEVEMENTS.length);
    UI.setContinue(s ? (s.state.daily ? 'Daily Operation · Turn ' + s.state.turn : s.state.hotseat ? 'Two players · Turn ' + s.state.turn : (s.state.mission ? 'Mission ' + s.state.mission + ' · ' : '') + 'Turn ' + s.state.turn + ' vs ' + (s.state.mission ? COMMANDERS[CAMPAIGN[s.state.mission - 1].enemy].name : CONST.DIFFICULTY[s.state.difficulty].name)) : null);
    refreshCampaign();
    pendingOverwrite = null;
    UI.warnOverwrite(null);
  }

  function continueGame() {
    const s = loadSave();
    if (!s) return refreshContinue();
    startGame(s.state.difficulty, s.tutorial, s);
  }

  // Battle options (SKIRMISH_OPTIONS values) -> newGame options
  function customGameOpts(o) {
    if (!o) return {};
    return { landTarget: o.land, credits: { player: o.credits, ai: o.credits }, maxTurns: o.turns, locked: o.uplink ? [] : ['uplink'] };
  }

  // "Large islands · Rich start · no superweapon" — only the options that differ from the defaults
  function customSummary(o) {
    if (!o) return '';
    const label = k => (SKIRMISH_OPTIONS[k].choices.find(c => c[0] === o[k]) || [])[1];
    const parts = [];
    if (o.land !== SKIRMISH_OPTIONS.land.def) parts.push(label('land') + ' islands');
    if (o.credits !== SKIRMISH_OPTIONS.credits.def) parts.push(label('credits') + ' start');
    if (o.turns !== SKIRMISH_OPTIONS.turns.def) parts.push(o.turns + ' turns');
    if (!o.uplink) parts.push('no superweapon');
    return parts.join(' · ');
  }

  // ── Daily Operation: the same seeded battle for everyone on a given day ──
  function dailyInfo(d) {
    d = d || new Date();
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const seed = +key.replace(/-/g, '');
    const twist = DAILY_TWISTS[seed % DAILY_TWISTS.length];
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const custom = {};
    for (const k in SKIRMISH_OPTIONS) custom[k] = SKIRMISH_OPTIONS[k].def;
    Object.assign(custom, twist.opts);
    return { key, seed, twist, difficulty: weekend ? 'warlord' : 'commander', custom };
  }
  function dailyBest(key) {
    try { return (JSON.parse(localStorage.getItem('ra_daily')) || {})[key] || 0; } catch (e) { return 0; }
  }
  function recordDaily(key, score) {
    let all = {};
    try { all = JSON.parse(localStorage.getItem('ra_daily')) || {}; } catch (e) { /* fresh */ }
    const prev = all[key] || 0;
    if (score > prev) { all[key] = score; try { localStorage.setItem('ra_daily', JSON.stringify(all)); } catch (e) { /* ignore */ } }
    return prev;
  }
  function refreshDaily() {
    const d = dailyInfo();
    UI.setDaily({ date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), opponent: CONST.DIFFICULTY[d.difficulty].name, twist: d.twist.name, best: dailyBest(d.key) });
  }
  function startDaily() {
    const d = dailyInfo();
    if (!confirmOverwrite('daily')) return;
    startGame(d.difficulty, false, null, null, false, d.custom, d);
  }

  // ── Achievements ──
  function loadAch() { try { return JSON.parse(localStorage.getItem('ra_ach')) || {}; } catch (e) { return {}; } }
  function unlock(id) {
    if (hotseat) return;
    const all = loadAch();
    if (all[id]) return;
    all[id] = Date.now();
    try { localStorage.setItem('ra_ach', JSON.stringify(all)); } catch (e) { /* ignore */ }
    const a = ACHIEVEMENTS.find(x => x.id === id);
    if (a) { UI.toast('🏆 Achievement unlocked: ' + a.name, 'good'); SND.play('select'); }
  }
  // checked after every resolved turn
  function checkTurnAchievements(events) {
    for (const e of events) {
      if (e.type === 'end' && e.destroyed.some(d => d.side === A)) unlock('first_blood');
      if (e.type === 'impact' && e.strike && e.side === P && e.hits.some(h => h.dmg > 0)) unlock('orbital');
      if ((e.type === 'impact' && e.side === A && e.hits.some(h => h.type === 'decoy')) || (e.type === 'robotHit' && e.side === A && e.hit.type === 'decoy')) unlock('fooled');
      if (e.type === 'gunfire' && e.side === P && e.shots.some(sh => sh.killed)) unlock('garrison');
      if (e.type === 'robotFight' && e.side === P && e.killed && R.ownerOfCell(e.targetCell) === P) unlock('garrison');
    }
    if (state.sides[P].stats.intercepts >= 10) unlock('iron_dome');
    if (R.buildingsOf(state, P, 'depot').length >= 5) unlock('tycoon');
  }
  function checkEndAchievements() {
    if (state.winner !== P) return;
    const hq = R.buildingsOf(state, P, 'hq')[0];
    if (hq && hq.hp >= hq.maxHp) unlock('untouched');
    if (state.turn <= 10) unlock('blitz');
    if (!state.mission && !state.daily && state.difficulty === 'warlord') unlock('warlord');
    if (state.daily) unlock('daily');
    if (campaignDone() >= CAMPAIGN.length) unlock('campaign');
    const medals = loadMedals();
    if (CAMPAIGN.every(m => (medals[m.id] || []).filter(Boolean).length === 3)) unlock('all_medals');
  }

  function startGame(diff, tut, saved, mission, twoPlayer, custom, daily) {
    SND.unlock();
    SND.play('uiClick');
    difficulty = diff;
    hotseat = saved ? !!saved.state.hotseat : !!twoPlayer;
    tutorial = !hotseat && tut !== false;
    setActive(P1);
    handoffNext = null;
    UI.hideHandoff();
    logs = {};
    lastReportP2 = null; roundStart = null; realState = null;
    mechHintShown = false;
    objectivesHidden = saved ? saved.objectivesHidden : !tutorial;
    Timeline.cancel();
    leaveBackdrop();
    Renderer.reset();
    UI.clearLog();
    UI.hideGameOver();
    UI.showMenu(false);
    UI.showGameUI(true);
    state = saved ? saved.state : R.newGame(diff, daily ? daily.seed : undefined, mission ? { mapSeed: mission.mapSeed, landTarget: mission.land, start: mission.start, credits: mission.credits, locked: mission.locked } : Object.assign(customGameOpts(custom), { hotseat }));
    if (!saved && !mission && custom) state.custom = Object.assign({}, custom);   // kept for Rematch
    if (mission) state.mission = mission.id;
    if (daily) state.daily = daily.key;
    if (!saved) { state.history = []; recordHistory(); }   // turn 0: the starting position
    Renderer.setMap(state.land);
    mode = 'select'; buildType = null; selectedCell = -1;
    syncWorld(true);
    const m = state.mission ? CAMPAIGN[state.mission - 1] : null;
    if (saved) UI.log('Resumed operation — turn ' + state.turn + (hotseat ? ' · two players' : ' vs ' + (m ? COMMANDERS[m.enemy].name : CONST.DIFFICULTY[diff].name)), 'sys');
    else if (hotseat) {
      UI.log('Two-player battle. Player 1 is blue (left), Player 2 is red (right).', 'sys');
      if (customSummary(custom)) UI.log('Battle options: ' + customSummary(custom), 'sys');
      UI.log('Pass the device when prompted — the hand-off screen hides each base from the other player.', 'sys');
    }
    else if (m) {
      UI.log('Mission ' + m.id + ': ' + m.name, 'sys');
      UI.log(COMMANDERS[m.enemy].name + ': “' + m.taunt + '”', 'enemy');
    } else {
      UI.log((state.daily ? 'Daily Operation ' + state.daily : 'Operation started') + ' — opponent: ' + CONST.DIFFICULTY[diff].name, 'sys');
      if (customSummary(custom)) UI.log('Battle options: ' + customSummary(custom), 'sys');
      UI.log('Destroy the enemy Command Center (red, far right).', 'sys');
    }
    if (saved && hotseat) {
      // a resumed two-player game opens on Player 1's turn: don't show their base to whoever holds the device
      phase = 'handoff';
      UI.showHandoff({ side: P1, title: 'Player 1 — your turn', sub: 'Resuming turn ' + state.turn + '. Pass the device to Player 1. Player 2, no peeking!', button: 'I\'m ready' });
      handoffNext = () => beginPlanning(false);
      return;
    }
    beginPlanning(!saved);
  }

  // ── Title-screen backdrop: a seeded AI-vs-AI battle, nine turns in, trading missile volleys ──
  let backdrop = null, backdropFx = [], volleyIn = 0;
  function setupBackdrop(intro) {
    Renderer.reset();
    const s = R.newGame('commander', 20261024, { landTarget: 125 });
    for (let t = 0; t < 9 && !s.winner; t++) { AI.planTurn(s, P1); AI.planTurn(s, P2); R.resolveTurn(s); }
    Renderer.setMap(s.land);
    Renderer.setViewer(P1);
    for (let c = 0; c < R.N; c++) {
      const b = s.cells[c].building;
      if (b) {
        Renderer.addBuilding(b, false);
        if (b.type === 'shield') Renderer.setShieldPool(b.id, b.pool);
        if (b.type !== 'decoy') Renderer.setBuildingLevel(b.id, b.level || 1);
      }
      Renderer.setCrater(c, s.cells[c].crater > 0 && !b);
    }
    for (const r of s.robots) {
      const rec = Renderer.addRobot(r), p = Renderer.cellCenter(r.cell);
      rec.group.position.set(p.x, 0, p.z);
    }
    Renderer.setFog(() => false);
    Renderer.setGhosts([]);
    Renderer.setDecorHidden(true);
    Renderer.setCinematic(intro ? 'intro' : 'attract');
    backdrop = s; backdropFx = []; volleyIn = intro ? 4.5 : 1.5;
  }
  function leaveBackdrop() {
    backdrop = null; backdropFx = [];
    Renderer.setDecorHidden(false);
    Renderer.setCinematic(null);
  }
  function backdropTick(dt) {
    if (!backdrop || phase !== 'menu') return;
    backdropFx = backdropFx.filter(f => {
      f.e += dt;
      const k = Math.min(1, f.e / f.dur);
      f.update(k);
      if (k >= 1) { f.done(); return false; }
      return true;
    });
    volleyIn -= dt;
    if (volleyIn > 0) return;
    volleyIn = 1.8 + Math.random() * 2.4;
    const side = Math.random() < 0.5 ? P1 : P2;
    const silos = R.buildingsOf(backdrop, side, 'silo'), targets = R.buildingsOf(backdrop, R.enemyOf(side));
    if (!silos.length || !targets.length) return;
    const n = 1 + Math.floor(Math.random() * Math.min(3, silos.length));
    for (let i = 0; i < n; i++) {
      const silo = silos[i % silos.length], tgt = targets[Math.floor(Math.random() * targets.length)];
      setTimeout(() => backdropMissile(side, silo, tgt), i * 260);
    }
  }
  function backdropMissile(side, silo, tgt) {
    if (!backdrop) return;
    const a = Renderer.cellCenter(silo.cell); a.y = 6;
    if (Renderer.getBuilding(silo.id)) { Renderer.openHatch(silo.id); a.copy(Renderer.muzzleWorld(silo.id)); }
    const b = Renderer.cellCenter(tgt.cell); b.y = 1;
    const h = Renderer.missileArcHeight(a, b), m = Models.missile(side), p = new THREE.Vector3(), prev = a.clone();
    m.scale.setScalar(2.4);
    Renderer.add(m);
    SND.play('missileLaunch', { gain: 0.12, pan: side === P1 ? -0.5 : 0.5 });
    const intercept = Math.random() < 0.4, endK = intercept ? 0.8 + Math.random() * 0.12 : 1;
    backdropFx.push({
      e: 0, dur: 2.6 * endK,
      update: k => { arcPoint(a, b, h, k * endK, p); m.position.copy(p); orient(m, p.clone().sub(prev)); Fx.trail(p, 'missile', side === P1 ? 0x66ccff : 0xff6a00); prev.copy(p); },
      done: () => {
        Renderer.remove(m); Models.dispose(m);
        if (!backdrop) return;
        if (intercept) { Fx.smallBlast(p, 0xffdd88); SND.play('intercept', { gain: 0.12 }); }
        else { Fx.explosion(b, 0.9); SND.play('explosion', { gain: 0.16 }); }
      }
    });
  }

  function toMenu() {
    Timeline.cancel();
    phase = 'menu';
    handoffNext = null;
    UI.hideHandoff();
    lastReportP2 = null; roundStart = null; realState = null;
    setActive(P1);
    UI.hideGameOver();
    UI.showGameUI(false);
    UI.setCombatHint(false);
    state = null;
    setupBackdrop(false);
    refreshContinue();
    UI.showMenu(true, true);
    SND.setMode('menu');
    SND.setTension(false);
  }

  // Frame the map in the screen area not covered by side panels
  function frameView(instant) {
    const rectOf = id => { const el = document.getElementById(id); if (!el || el.offsetParent === null) return null; return el.getBoundingClientRect(); };
    // Keep the map clear of the orders/log panel, HUD and build dock. The briefing panel is
    // short and closable and only overlaps the player's rear corner, so it doesn't count.
    const ord = rectOf('orders'), hud = rectOf('hud'), dock = rectOf('dock');
    const dockH = dock && !document.getElementById('dock').classList.contains('hidden') ? window.innerHeight - dock.top : (UI.isCompact() ? 40 : 120);
    Renderer.setOcclusion(0, ord ? window.innerWidth - ord.left : 0, hud ? hud.bottom : 80, Math.max(dockH, UI.isCompact() ? 64 : 120));
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
    UI.banner(hotseat ? seatName(P).toUpperCase() : 'TURN ' + state.turn, hotseat ? 'Turn ' + state.turn + ' · planning' : first ? 'Plan your opening' : 'Planning phase');
    SND.play('turnStart');
    const inc = R.detectedIncoming(state, P);
    if (inc.length) {
      setTimeout(() => { if (phase === 'planning') SND.play('alarm'); }, 500);
      const strikes = inc.filter(m => m.strike), missiles = inc.length - strikes.length;
      if (missiles) UI.toast(missiles + ' incoming missile' + (missiles > 1 ? 's' : '') + ' detected!', 'bad');
      for (const m of strikes) UI.toast('ORBITAL STRIKE inbound on ' + describeCell(m.to) + ' — AA cannot stop it. Shield, repair or move out!', 'bad');
    }
    UI.log('Turn ' + state.turn, 'turn');
    const raiders = R.robotsOf(state, A).filter(r => R.ownerOfCell(r.cell) === P && playerSees(r.cell));
    if (raiders.length && !mechHintShown) {
      mechHintShown = true;
      UI.toast('Enemy mechs on your island! Arrows show where they go next. Gun Pods [8] shred them — or drop a garrison mech [E] on your own island.', 'warn');
    }
    // Gen. Hale warns a player who is falling behind on economy
    if (!hotseat && state.turn === 5 && R.buildingsOf(state, P, 'depot').length < 2)
      UI.toast('Gen. Hale: Only one Supply Depot? The enemy will out-build us. Get a second one up now.', 'warn');
    if (P === P1) saveGame(); // hot-seat saves at the start of a round, before either side has planned
    if (hotseat && P === P1) roundStart = JSON.stringify(state.cells);
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
        if (b.type === 'uplink') Renderer.setBuildingCharge(b.id, playerSees(c) ? b.charge : 0);
        if (b.type !== 'decoy') Renderer.setBuildingLevel(b.id, b.level || 1);
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

  // ── Settings (persisted per browser) ──
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const lsPut = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* storage blocked */ } };
  let showIntents = lsGet('ra_intents', '1') !== '0';
  function currentSettings() {
    return { vol: SND.getVolume(), music: SND.getMusicVolume(), sfx: SND.getSfxVolume(), quality: Renderer.getQuality(),
      speed, shake: lsGet('ra_shake', '1') === '0' ? 0 : 1, intents: showIntents ? 1 : 0 };
  }
  function applySetting(key, v) {
    if (key === 'vol') { SND.setVolume(v); UI.setVolume(v); }
    if (key === 'music') SND.setMusicVolume(v);
    if (key === 'sfx') { SND.setSfxVolume(v); SND.play('select'); }
    if (key === 'quality') Renderer.setQuality(v);
    if (key === 'speed') { speed = v; lsPut('ra_speed', v); }
    if (key === 'shake') { Renderer.setShake(!!v); lsPut('ra_shake', v); }
    if (key === 'intents') { showIntents = !!v; lsPut('ra_intents', v); if (state && phase === 'planning') refreshMarkers(); }
    if (key !== 'sfx' && key !== 'vol' && key !== 'music') SND.play('uiClick');
    UI.paintSettings(currentSettings());
  }
  function cycleSpeed() {
    speed = speed === 1 ? 2 : speed === 2 ? 3 : 1;
    lsPut('ra_speed', speed);
    UI.setCombatHint(phase === 'resolving', speed);
    if (phase !== 'resolving') UI.toast('Combat playback speed: ' + speed + 'x', 'good');
  }

  // What every mech the player can see will do next resolution, for the planning overlay
  function mechIntents() {
    if (!showIntents) return [];
    const out = [];
    for (const r of state.robots) {
      if (r.hp <= 0 || !playerSees(r.cell)) continue;
      const a = R.robotIntent(state, r);
      if (a.kind === 'hold') continue;
      const target = a.kind === 'hit' ? a.building.cell : a.kind === 'fight' ? a.robot.cell : a.goal;
      // don't point at things the player can't see
      out.push({ side: r.side, from: r.cell, kind: a.kind, path: a.path, target: playerSees(target) ? target : -1 });
    }
    return out;
  }
  function intentText(r) {
    const a = R.robotIntent(state, r);
    if (a.kind === 'hold') return 'Holding position';
    const what = c => { const b = R.buildingAt(state, c); return b && playerSees(c) ? (b.side === P ? 'your ' : 'enemy ') + BUILDINGS[b.side === P ? b.type : R.apparent(b).type].name : R.robotAt(state, c) ? 'a mech' : cellName(c); };
    if (a.kind === 'hit') return 'Next turn: smashes ' + what(a.building.cell);
    if (a.kind === 'fight') return 'Next turn: attacks ' + (a.robot.side === P ? 'your' : 'an enemy') + ' mech';
    return 'Next turn: walks toward ' + what(a.goal);
  }

  function refreshMarkers() {
    if (!state || phase !== 'planning') { Renderer.setMarkers([], []); return; }
    Renderer.setMarkers(state.sides[P].orders, R.detectedIncoming(state, P), mechIntents());
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
      red: P === CONST.SIDE_AI,
      credits: s.credits, creditInc: inc.credits,
      energy: s.energy, energyCap: R.energyCap(state, P), energyInc: inc.energy,
      turn: state.turn, maxTurns: state.maxTurns || CONST.MAX_TURNS, phase: phaseName,
      hq: { hp: hq ? hq.hp : 0, max: BUILDINGS.hq.hp }, enemyHq: enemyHqView()
    });
  }

  function refreshDock() {
    const s = state.sides[P];
    const locked = state.locked || [];
    const cards = BUILD_ORDER.filter(t => !locked.includes(t)).map(t => {
      const def = BUILDINGS[t];
      const count = R.buildingsOf(state, P, t).length;
      let reason = null;
      const cost = R.buildCost(state, P, t);
      if (s.credits < cost) reason = 'Need ' + cost + ' credits';
      else if (def.max && count >= def.max) reason = 'Max ' + def.max;
      return { type: t, key: def.key, name: def.name, cost, enabled: !reason, reason, selected: mode === 'build' && buildType === t, count };
    });
    UI.setCards(cards);
    const silos = R.buildingsOf(state, P, 'silo').length, freeSilos = R.freeLaunchers(state, P, 'silo').length;
    const hangars = R.buildingsOf(state, P, 'hangar').length, freeH = R.freeLaunchers(state, P, 'hangar').length;
    const fireReason = !silos ? 'Build a Missile Silo first' : !freeSilos ? 'All silos tasked' : s.energy < CONST.MISSILE_ENERGY ? 'Need ' + CONST.MISSILE_ENERGY + ' energy' : null;
    const dropReason = !hangars ? 'Build a Robot Hangar first' : R.dropReadyReason(state, P);
    const uplink = R.buildingsOf(state, P, 'uplink')[0];
    const strikeReason = R.strikeReadyReason(state, P);
    const strikeOrdered = s.orders.some(o => o.kind === 'strike');
    const ready = phase === 'planning' && !!fireReason && !!dropReason && (!!strikeReason || !uplink) && s.credits < 80;
    UI.setActions({
      fire: { enabled: !fireReason, selected: mode === 'fire', reason: fireReason, sub: CONST.MISSILE_ENERGY + 'e', badge: silos ? freeSilos + '/' + silos : '' },
      drop: { enabled: !dropReason, selected: mode === 'drop', reason: dropReason, sub: CONST.DROP_ENERGY + 'e', badge: hangars ? freeH + '/' + hangars : '' },
      strike: {
        visible: !!uplink, enabled: !strikeReason, selected: mode === 'strike', reason: strikeReason, sub: CONST.STRIKE_ENERGY + 'e',
        ready: !strikeReason, badge: uplink ? (strikeOrdered ? 'SET' : uplink.charge >= CONST.STRIKE_CHARGE ? 'READY' : uplink.charge + '/' + CONST.STRIKE_CHARGE) : ''
      },
      endReady: ready
    });
  }

  function cellName(c) {
    const p = R.xy(c);
    return String.fromCharCode(65 + p.y) + (p.x + 1);
  }
  // During combat playback the board has already been resolved: name cells as they were before it
  let preNames = null;
  function describeCell(c) {
    if (preNames && c in preNames) return preNames[c];
    const b = R.buildingAt(state, c);
    if (b && playerSees(c)) return (b.side === A ? 'enemy ' + BUILDINGS[R.apparent(b).type].name : BUILDINGS[b.type].name) + ' ' + cellName(c);
    const g = state.sides[P].intel.seen[c];
    if (g) return BUILDINGS[g.type].name + '? ' + cellName(c);
    return 'grid ' + cellName(c);
  }

  function refreshOrders() {
    const label = { missile: 'Missile → ', drop: 'Mech drop → ', strike: 'Orbital strike → ' };
    const orders = state.sides[P].orders.map(o => ({ id: o.id, kind: o.kind, text: label[o.kind] + describeCell(o.to) }));
    const inc = R.detectedIncoming(state, P).map(m => ({ text: (m.strike ? 'ORBITAL STRIKE → ' : 'INCOMING → ') + describeCell(m.to), strike: !!m.strike }));
    UI.setOrders(orders, phase === 'planning' ? inc : []);
  }

  function selectionInfo(c) {
    if (c < 0) return null;
    const b = R.buildingAt(state, c);
    if (b && playerSees(c)) {
      const own = b.side === P;
      const a = own ? b : R.apparent(b);
      const def = BUILDINGS[a.type];
      const info = { type: a.type, name: def.name, own, hp: a.hp, maxHp: a.maxHp, desc: def.desc, stats: def.stats(), ghost: false };
      if (own && b.type === 'decoy') info.extra = 'Disguised as ' + BUILDINGS[b.disguise].name;
      if ((a.level || 1) > 1 && UPGRADES[a.type]) {
        // the upgrade supersedes the structure's headline stat (always the first line)
        info.level = 2;
        info.stats = ['★ ' + UPGRADES[a.type].name + ': ' + UPGRADES[a.type].desc].concat(info.stats.slice(1));
      }
      if (own) info.upgrade = R.upgradeInfo(state, P, c);
      if (b.type === 'shield') info.extra = 'Shield ' + b.pool + '/' + R.stat(b, 'pool');
      if (b.type === 'uplink') info.extra = b.charge >= CONST.STRIKE_CHARGE ? (own ? 'Strike READY — press R' : 'Fully charged — a strike can come any turn') : 'Charging ' + b.charge + '/' + CONST.STRIKE_CHARGE;
      // decoys disguised as AA show what a fresh AA would
      if (a.type === 'aa' || a.type === 'hq') info.extra = (info.extra ? info.extra + ' · ' : '') + 'Intercepts ready: ' + (b.type === 'decoy' ? 1 : b.shots);
      if (own) {
        const rep = R.repairInfo(state, P, c);
        info.repair = rep;
        info.sellValue = R.sellValue(b, state);
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
    if (info) showRangeFor(info.type, selectedCell, info.own, info.level);
    Renderer.setBarsForced(selectedCell >= 0 && R.buildingAt(state, selectedCell) ? [R.buildingAt(state, selectedCell).id] : null);
  }

  function showRangeFor(type, cell, own, level) {
    const up = level > 1 && UPGRADES[type] && UPGRADES[type].range;
    const range = up || BUILDINGS[type].range;
    const color = own ? 0x2ec4ff : 0xff4422;
    if (type === 'aa') Renderer.showRange(cell, range, color);
    else if (type === 'gunpod') Renderer.showRange(cell, range, 0xffb000);
    else if (type === 'radar') Renderer.showRange(cell, range, 0x66ff99);
    else if (type === 'shield') Renderer.showRange(cell, range, 0x9d7cff, true);
    else if (type === 'hq') Renderer.showRange(cell, range, color);
    else Renderer.hideRange();
  }

  function refreshZone() {
    if (phase !== 'planning') { Renderer.setZone(null); Renderer.setGridEmphasis(false); return; }
    if (mode === 'build') {
      const can = state.sides[P].credits >= R.buildCost(state, P, buildType);
      Renderer.setZone(c => R.inBuildZone(state, P, c) ? (can ? [60, 255, 130, 70] : [255, 200, 60, 50]) : (R.ownerOfCell(c) === P ? [0, 0, 0, 40] : null));
      Renderer.setGridEmphasis(true);
    } else if (mode === 'fire' || mode === 'drop' || mode === 'strike') {
      const col = mode === 'fire' ? [255, 120, 30, 46] : mode === 'strike' ? [61, 255, 200, 40] : [46, 196, 255, 46];
      // drops may also target your own island (garrison)
      Renderer.setZone(c => R.ownerOfCell(c) === A ? col : (mode === 'drop' && R.isLand(state, c) && R.ownerOfCell(c) === P ? [120, 255, 170, 26] : null));
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
    } else if (mode === 'strike') {
      Renderer.setBuildGhost(null, -1);
      const bad = R.strikeReason(state, P, hoverCell);
      Renderer.setHover(hoverCell, bad ? 0xff4444 : 0x3dffc8);
      if (bad) Renderer.hideRange(); else Renderer.showRange(hoverCell, 1, 0x3dffc8, true); // the 3x3 blast area
    } else {
      Renderer.setBuildGhost(null, -1);
      Renderer.setHover(hoverCell, 0xdddddd);
    }
  }

  // Tutorial objectives
  const OBJECTIVES = [
    { text: 'Build a <b>Supply Depot</b> <kbd>1</kbd> next to your HQ for credits', done: s => has(s, 'depot') },
    { text: 'Build a <b>Power Plant</b> <kbd>2</kbd> for energy', done: s => has(s, 'power') },
    { text: 'You start with a <b>Missile Silo</b>. Press <kbd>Q</kbd> and click the red <b>enemy HQ</b>', touch: 'You start with a <b>Missile Silo</b>. Tap <b>Fire Missile</b>, then the red <b>enemy HQ</b> (twice to confirm)', done: s => s.sides[P].stats.missilesFired > 0 || s.sides[P].orders.some(o => o.kind === 'missile') },
    { text: 'Press <kbd>Space</kbd> to end the turn and watch the battle', touch: 'Tap <b>End Turn</b> and watch the battle', done: s => s.turn > 1 },
    { text: 'HQs and AA shoot missiles down (40% / 70%). Fire <b>several at once</b> to break through — build more silos', done: s => R.buildingsOf(s, P, 'silo').length >= 2 },
    { text: 'Build a <b>Radar</b> <kbd>3</kbd> on your east coast — each structure extends your build zone, so build eastward first. The placement tip shows how many enemy cells it reveals', touch: 'Build a <b>Radar</b> on your east coast (build eastward first) — the placement tip shows how many enemy cells it reveals', done: s => has(s, 'radar') },
    { text: 'Protect your HQ with an <b>AA Battery</b> <kbd>5</kbd>', done: s => has(s, 'aa') },
    { text: 'Enemy mechs? A <b>Gun Pod</b> <kbd>8</kbd> shreds them', done: s => has(s, 'gunpod') },
    { text: 'Select one of your structures and press <kbd>U</kbd> to <b>upgrade</b> it', touch: 'Tap one of your structures, then <b>Upgrade</b>', done: s => R.buildingsOf(s, P).some(b => (b.level || 1) > 1) }
  ];
  function has(s, t) { return R.buildingsOf(s, P, t).length > 0; }
  function refreshObjectives() {
    if (objectivesHidden || !state) { UI.setObjectives(null); return; }
    const touch = lastPointer === 'touch' || matchMedia('(hover: none)').matches;
    const list = OBJECTIVES.map(o => ({ text: touch && o.touch ? o.touch : o.text, done: o.done(state) }));
    if (list.every(o => o.done)) { objectivesHidden = true; UI.setObjectives(null); UI.toast('Briefing complete — good luck, Commander', 'good'); return; }
    UI.setObjectives(list);
  }

  // ── Tooltips ──────────────────────────────────────────────
  function cardTooltip(type, e) {
    const d = BUILDINGS[type];
    const s = state ? state.sides[P] : null;
    const cost = state ? R.buildCost(state, P, type) : d.cost;
    const reason = s && s.credits < cost ? 'Need ' + cost + ' credits' : null;
    const step = d.costStep ? ' <span class="k">(+' + d.costStep + ' per depot owned)</span>' : '';
    const r = e.currentTarget.getBoundingClientRect();
    UI.showTip(`<b>${UI.esc(d.name)}</b> <span class="k">[${d.key}]</span><br><span style="color:var(--c-credit)">${cost} credits</span>${step} · ${d.hp} HP<br>${UI.esc(d.desc)}<br><span class="k">${d.stats().map(UI.esc).join(' · ')}</span>${d.counter ? '<br><span class="cnt">' + UI.esc(d.counter) + '</span>' : ''}${reason ? '<br><span class="bad">' + reason + '</span>' : ''}`, r.left, r.top - 150);
  }

  function cellTooltip() {
    if (!state || phase !== 'planning' || hoverCell < 0) { UI.hideTip(); return; }
    let html = null;
    if (mode === 'build') {
      const reason = R.buildableReason(state, P, buildType, hoverCell);
      if (reason) html = '<span class="bad">' + UI.esc(reason) + '</span>';
      else html = placementPreview(buildType, hoverCell);
    } else if (mode === 'fire') {
      const reason = R.missileReason(state, P, hoverCell);
      html = reason ? '<span class="bad">' + UI.esc(reason) + '</span>'
        : !R.isLand(state, hoverCell) ? '<span class="bad">Open water</span> — a missile here would be wasted'
          : 'Fire at <b>' + UI.esc(describeCell(hoverCell)) + '</b><br><span class="k">Lands at the start of next turn\'s combat</span>' + defenceOdds(hoverCell);
    } else if (mode === 'strike') {
      const reason = R.strikeReason(state, P, hoverCell);
      html = reason ? '<span class="bad">' + UI.esc(reason) + '</span>'
        : 'Orbital strike on <b>' + UI.esc(describeCell(hoverCell)) + '</b><br><span class="k">' + CONST.STRIKE_DAMAGE + ' damage + ' + CONST.STRIKE_SPLASH + ' to the 3x3 area · lands next turn · cannot be intercepted</span>';
    } else if (mode === 'drop') {
      const reason = R.dropReason(state, P, hoverCell);
      html = reason ? '<span class="bad">' + UI.esc(reason) + '</span>' : 'Drop mech at <b>' + UI.esc(cellName(hoverCell)) + '</b><br><span class="k">Lands this turn, attacks from next turn</span>';
    } else {
      const info = selectionInfo(hoverCell);
      const rob = R.robotAt(state, hoverCell);
      if (info && hoverCell === selectedCell) html = null; // the selection panel already shows it
      else if (info) html = `<b>${UI.esc(info.name)}</b>${info.ghost ? ' <span class="k">(last known)</span>' : ''}<br>HP ${info.hp}/${info.maxHp}${info.extra ? '<br><span class="k">' + UI.esc(info.extra) + '</span>' : ''}`;
      else if (rob && playerSees(hoverCell)) html = `<b>${rob.side === P ? 'Your' : 'Enemy'} mech</b><br>HP ${rob.hp}/${rob.maxHp}<br><span class="k">${UI.esc(intentText(rob))}</span>`;
      else if (R.ownerOfCell(hoverCell) === A && !visible.has(hoverCell)) html = '<span class="k">Unknown — fogged.<br>Radar or missile impacts reveal it.</span>';
    }
    if (html) UI.showTip(html, mouse.x, mouse.y); else UI.hideTip();
  }

  // What a structure would do from this cell, shown while placing it
  function placementPreview(type, cell) {
    const d = BUILDINGS[type];
    if (type === 'radar') {
      const n = R.cellsInRadius(cell, d.range).filter(c => R.ownerOfCell(c) === A && R.isLand(state, c)).length;
      return n ? 'Reveals <b>' + n + '</b> enemy land cells' : '<span class="bad">Reveals no enemy cells from here</span> — build closer to the coast facing the enemy';
    }
    if (type === 'aa' || type === 'shield') {
      const covered = R.buildingsOf(state, P).filter(b => R.dist(b.cell, cell) <= d.range + 0.01);
      const hq = covered.some(b => b.type === 'hq');
      return 'Covers <b>' + covered.length + '</b> of your structures' + (hq ? ' <span class="good">incl. HQ</span>' : '');
    }
    if (type === 'gunpod') {
      const hq = R.dist(R.hqCell(P), cell) <= d.range + 0.01;
      return 'Shoots mechs within radius ' + d.range + (hq ? ' — covers your HQ' : '');
    }
    return null;
  }

  // Defences the player knows about around a missile target, and the odds one missile gets through
  function defenceOdds(cell) {
    const seen = state.sides[P].intel.seen;
    const known = [];
    const hq = R.hqCell(A);
    if (R.dist(hq, cell) <= BUILDINGS.hq.range + 0.01) known.push({ name: 'HQ', p: BUILDINGS.hq.hitChance });
    for (const k in seen) {
      if (seen[k].type !== 'aa') continue;
      const lvl2 = seen[k].level === 2;
      const range = lvl2 ? UPGRADES.aa.range : BUILDINGS.aa.range;
      if (R.dist(+k, cell) <= range + 0.01) known.push({ name: 'AA', p: lvl2 ? UPGRADES.aa.hitChance : BUILDINGS.aa.hitChance });
    }
    if (!known.length) return '<br><span class="good">No known air defence covers this cell</span>';
    const through = known.reduce((a, d) => a * (1 - d.p), 1);
    return '<br><span class="k">Known defences: ' + known.map(d => d.name + ' ' + Math.round(d.p * 100) + '%').join(', ')
      + ' — a lone missile gets through ~' + Math.round(through * 100) + '%</span>';
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
    // taps emulate a mousemove first; don't leave hover tooltips stuck on touch screens
    if (lastPointer === 'touch' && mode === 'select') UI.hideTip(); else cellTooltip();
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
    // touch: the first tap previews a placement/target, a second tap on the same cell confirms
    if (lastPointer === 'touch' && mode !== 'select' && pendingTap !== c) {
      pendingTap = c;
      hoverCell = c;
      refreshHover();
      cellTooltip();
      UI.toast('Tap again to confirm', 'warn');
      return;
    }
    pendingTap = -1;
    clickCell(c, e.shiftKey);
    if (lastPointer === 'touch') UI.hideTip(); else cellTooltip();
  }

  function clickCell(c, keepMode) {
    reportTimer = Math.min(reportTimer, 0.01);
    if (mode === 'build') {
      const r = R.build(state, P, buildType, c);
      if (!r.ok) return fail(r.reason);
      SND.play('build', { pan: panAt(c) });
      Renderer.addBuilding(r.building, true);
      Fx.buildDust(Renderer.cellCenter(c));
      floatAt(c, '-' + r.building.paid + 'c', 'info');
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
      const queued = state.sides[P].orders.filter(o => o.kind === 'missile').length;
      const more = R.freeLaunchers(state, P, 'silo').length && state.sides[P].energy >= CONST.MISSILE_ENERGY;
      UI.toast('Missile ' + queued + '/' + R.buildingsOf(state, P, 'silo').length + ' queued' + (more ? ' — click another target' : ''), 'good');
      if (!more) cancelMode();
    } else if (mode === 'strike') {
      const r = R.queueStrike(state, P, c);
      if (!r.ok) return fail(r.reason);
      SND.play('select');
      UI.log('Orbital strike locked on ' + describeCell(c), 'player');
      cancelMode();
    } else if (mode === 'drop') {
      const r = R.queueDrop(state, P, c);
      if (!r.ok) return fail(r.reason);
      SND.play('select');
      UI.log('Mech drop ordered at ' + cellName(c), 'player');
      if (R.dropReadyReason(state, P)) cancelMode();
    } else {
      selectedCell = (selectionInfo(c) ? c : -1);
      // touch has no hover: tapping a mech shows its card (and where it's headed) for a moment
      const rob = R.robotAt(state, c);
      if (selectedCell < 0 && rob && playerSees(c) && lastPointer === 'touch') {
        const p = Renderer.project(Renderer.cellCenter(c));
        const html = `<b>${rob.side === P ? 'Your' : 'Enemy'} mech</b><br>HP ${rob.hp}/${rob.maxHp}<br><span class="k">${UI.esc(intentText(rob))}</span>`;
        setTimeout(() => UI.showTip(html, p.x, p.y - 30), 0); // after the tap handler clears tooltips
        clearTimeout(tapTipTimer);
        tapTipTimer = setTimeout(() => UI.hideTip(), 2600);
      }
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
    pendingTap = -1;
    if (mode !== 'select') { mode = 'select'; buildType = null; }
    else selectedCell = -1;
    refreshAll();
  }

  function selectBuild(type) {
    if (!state || phase !== 'planning') return;
    const def = BUILDINGS[type];
    if ((state.locked || []).includes(type)) return fail(def.name + ' is not available in this mission');
    const cost = R.buildCost(state, P, type);
    if (state.sides[P].credits < cost) return fail('Need ' + cost + ' credits for ' + def.name);
    if (def.max && R.buildingsOf(state, P, type).length >= def.max) return fail('Max ' + def.max + ' ' + def.name + 's');
    SND.play('uiClick');
    pendingTap = -1;
    if (UI.isCompact() && !(mode === 'build' && buildType === type)) UI.toast(def.name + ' · ' + cost + 'c — ' + def.stats()[0], 'good');
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
      if (phase === 'planning' && P === P1) saveGame(); // hot-seat: mid-round, the round-start autosave stands
      toMenu();
      return;
    }
    if (phase === 'resolving' && name === 'end') { slowmo = 0; Timeline.skip(); return; }
    if (phase !== 'planning') return;
    switch (name) {
      case 'fire': {
        const reason = R.missileReason(state, P, R.hqCell(A));
        if (reason && reason !== 'Target must be in enemy territory') return fail(reason);
        SND.play('uiClick');
        // the hotkey always (re-)arms; only the button toggles, Esc / right-click cancel
        mode = mode === 'fire' && arg !== 'key' ? 'select' : 'fire'; selectedCell = -1;
        if (mode === 'fire') UI.toast('Click an enemy cell to target (right-click to cancel)', 'warn');
        break;
      }
      case 'strike': {
        const reason = R.strikeReadyReason(state, P);
        if (reason) return fail(reason);
        SND.play('uiClick');
        mode = mode === 'strike' && arg !== 'key' ? 'select' : 'strike'; selectedCell = -1;
        if (mode === 'strike') UI.toast('Click an enemy cell for the orbital strike (right-click to cancel)', 'warn');
        break;
      }
      case 'drop': {
        const reason = R.dropReadyReason(state, P);
        if (reason) return fail(reason);
        SND.play('uiClick');
        mode = mode === 'drop' && arg !== 'key' ? 'select' : 'drop'; selectedCell = -1;
        if (mode === 'drop') UI.toast('Click the enemy island to raid — or your own island to garrison', 'warn');
        break;
      }
      case 'upgrade': {
        if (selectedCell < 0) return fail('Select one of your structures first');
        const r = R.upgrade(state, P, selectedCell);
        if (!r.ok) return fail(r.reason);
        SND.play('build', { pan: panAt(selectedCell) });
        Renderer.setBuildingLevel(r.building.id, 2);
        Renderer.setBuildingHp(r.building.id, r.building.hp, r.building.maxHp);
        Fx.heal(Renderer.cellCenter(selectedCell));
        floatAt(selectedCell, r.name + '!', 'info');
        UI.log('Upgraded ' + BUILDINGS[r.building.type].name + ' at ' + cellName(selectedCell) + ': ' + r.name, 'player');
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
        UI.toast('Sold ' + BUILDINGS[r.building.type].name + ' for ' + r.value + 'c — Z to undo', 'warn');
        selectedCell = -1;
        if (r.building.type === 'radar') syncWorld(false);
        break;
      }
      case 'undo': {
        const r = R.undo(state, P);
        if (!r.ok) return fail(r.reason);
        SND.play('uiClick');
        if (r.kind === 'build') { Renderer.removeBuilding(r.building.id, true); if (r.building.type === 'radar') syncWorld(false); }
        if (r.kind === 'repair' || r.kind === 'upgrade') Renderer.setBuildingHp(r.building.id, r.building.hp, r.building.maxHp);
        if (r.kind === 'upgrade') Renderer.setBuildingLevel(r.building.id, 1);
        if (r.kind === 'sell') { Renderer.addBuilding(r.building, true); if (r.building.type === 'radar') syncWorld(false); }
        UI.toast('Undone', 'good');
        UI.log('Undid ' + (r.kind === 'order' ? ({ drop: 'mech drop', strike: 'orbital strike' }[r.order && r.order.kind] || 'missile order') : r.kind + ' of ' + BUILDINGS[r.building.type].name), 'sys');
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
    cellTooltip();
  }

  function onKey(e) {
    if (!/Tab|Shift|Control|Alt/.test(e.key)) reportTimer = Math.min(reportTimer, 0.01);
    if (e.repeat && e.code !== 'Tab') return;
    if (UI.isBriefingOpen()) {
      if (e.code === 'Escape') UI.closeBriefing();
      return;
    }
    if (UI.isSettingsOpen()) {
      if (e.code === 'Escape') UI.showSettings(null);
      return;
    }
    if (UI.isHelpOpen()) {
      if (e.code === 'Escape' || e.key === '?' || e.code === 'Slash') UI.showHelp(false);
      e.preventDefault();
      return;
    }
    if (e.key === '?' || e.code === 'Slash') { UI.showHelp(true); return; }
    if (e.code === 'KeyM') { action('mute'); return; }
    if (e.code === 'KeyG') { UI.toast('Graphics quality: ' + Renderer.cycleQuality(), 'good'); return; }
    if (!state) return;
    if (e.code === 'Tab') { e.preventDefault(); cycleSpeed(); return; }
    if (e.code === 'KeyH') { Renderer.focusCell(R.hqCell(P), 250, true); return; }
    if (e.code === 'KeyF') { frameView(false); return; }
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); action('end'); return; }
    if (phase !== 'planning') return;
    const digit = /^Digit([0-9])$/.exec(e.code) || /^Numpad([0-9])$/.exec(e.code);
    if (digit) {
      const type = BUILD_ORDER.find(t => BUILDINGS[t].key === digit[1]);
      if (type) selectBuild(type);
      return;
    }
    switch (e.code) {
      case 'KeyQ': action('fire', 'key'); break;
      case 'KeyE': action('drop', 'key'); break;
      case 'KeyR': action('strike', 'key'); break;
      case 'KeyT': action('repair'); break;
      case 'KeyU': action('upgrade'); break;
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

    if (hotseat) {
      // Player 1 done: Player 2 plans next. Player 2 done: back to Player 1, who watches the battle.
      if (P === P1) handoff(P2, () => { seatCopyForP2(); syncWorld(true); if (lastReportP2) { UI.showReport(lastReportP2); reportTimer = 8; } beginPlanning(false); });
      else { mergeP2(); handoff(P1, startResolution); }
      return;
    }
    AI.planTurn(state, A);
    startResolution();
  }

  // Hide the board behind the hand-off screen, then switch seats once the next player is ready
  function handoff(next, then) {
    phase = 'handoff';
    logs[P] = UI.getLog();
    const resolving = next === P1;
    UI.showHandoff({
      side: next, title: seatName(next) + (resolving ? ' — battle' : ' — your turn'),
      sub: 'Pass the device to ' + seatName(next) + '. ' + seatName(R.enemyOf(next)) + ', no peeking!',
      button: resolving ? 'Watch the battle' : 'I\'m ready'
    });
    handoffNext = () => {
      setActive(next);
      Renderer.reset();
      UI.setLog(logs[P] || '');
      syncWorld(true);
      frameView(true);
      then();
    };
  }

  function seatCopyForP2() {
    realState = state;
    state = JSON.parse(JSON.stringify(realState));
    if (roundStart) {
      const before = JSON.parse(roundStart);
      for (let c = 0; c < R.N; c++) if (R.ownerOfCell(c) === P1) state.cells[c] = before[c];
    }
  }
  function mergeP2() {
    if (!realState) return;
    for (let c = 0; c < R.N; c++) if (R.ownerOfCell(c) === P2) realState.cells[c] = state.cells[c];
    realState.sides[P2] = state.sides[P2];
    realState.nextId = state.nextId;
    state = realState;
    realState = null;
  }

  function setActive(side) {
    P = side; A = R.enemyOf(side);
    Renderer.setViewer(side);
  }

  function startResolution() {
    phase = 'resolving';
    syncWorld(true); // show AI construction (if visible) before combat
    for (const b of R.buildingsOf(state, A)) if (b.builtTurn === state.turn && b.type !== 'hq' && playerSees(b.cell)) UI.log('Enemy built ' + BUILDINGS[R.apparent(b).type].name + ' at ' + cellName(b.cell), 'enemy');

    // Snapshot ids by cell before resolution mutates the board
    const idAt = {};
    for (let c = 0; c < R.N; c++) { const b = state.cells[c].building; if (b) idAt[c] = b.id; }
    const turn = state.turn;
    combatHud = hudData();   // HUD stays on this turn's values during playback
    UI.setHUD(combatHud);
    slowmo = 0;
    preNames = {};
    for (let c = 0; c < R.N; c++) if (state.cells[c].building || state.sides[P].intel.seen[c]) preNames[c] = describeCell(c);
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
    // camera director: ease toward where each beat's action is, if it's all on one island
    const direct = (time, cells) => at(Math.max(0, time - 0.1), () => focusAction(cells));

    // Descents + intercepts + impacts
    const desc = byBeat(R.BEAT.DESCEND);
    const DESC = 1.7;
    if (desc.length) direct(t, desc.map(e => e.to));
    desc.forEach((e, i) => {
      const t0 = t + i * 0.22;
      at(t0, () => animateDescent(e, DESC, idAt, impacts[e.id]));
    });
    if (desc.length) t += (desc.length - 1) * 0.22 + DESC + 0.7;

    // Gun pods
    const guns = byBeat(R.BEAT.GUNFIRE);
    const botsAhead = byBeat(R.BEAT.ROBOTS);
    if (guns.length || botsAhead.length) direct(t, [].concat(...guns.map(e => e.shots.map(s => s.cell)), botsAhead.map(e => e.cell !== undefined ? e.cell : e.from)));
    guns.forEach((e, i) => at(t + i * 0.4, () => animateGunfire(e, idAt)));
    if (guns.length) t += guns.length * 0.4 + 0.5;

    // Robots
    const bots = byBeat(R.BEAT.ROBOTS);
    let botEnd = 0;
    bots.forEach((e, i) => {
      const t0 = t + i * 0.18;
      const dur = e.type === 'robotMove' ? e.path.length * 0.42 : 0.7;
      botEnd = Math.max(botEnd, t0 + dur);
      at(t0, () => e.type === 'robotMove' ? animateRobotMove(e) : e.type === 'robotFight' ? animateRobotFight(e) : animateRobotHit(e, idAt));
    });
    if (bots.length) t = botEnd + 0.4;

    // Drops
    const drops = byBeat(R.BEAT.DROPS);
    if (drops.length) direct(t, drops.filter(e => e.type === 'drop').map(e => e.to));
    drops.forEach((e, i) => at(t + i * 0.25, () => e.type === 'drop' ? animateDrop(e, idAt) : logCancelled(e)));
    if (drops.length) t += (drops.length - 1) * 0.25 + 2.0;

    // Launches
    const launches = byBeat(R.BEAT.LAUNCH);
    if (launches.length) at(Math.max(0, t - 0.1), () => frameView(false));
    launches.forEach((e, i) => at(t + i * 0.2, () => e.type === 'launch' ? animateLaunch(e, idAt) : logCancelled(e)));
    if (launches.length) t += (launches.length - 1) * 0.2 + 1.5;

    if (!desc.length && !guns.length && !bots.length && !drops.length && !launches.length) {
      at(0.8, () => UI.log('A quiet turn. No combat.', 'sys'));
      t = 1.4;
    }
    at(t + 0.3, () => {});
    return items;
  }

  function focusAction(cells) {
    cells = cells.filter(c => c !== undefined && c >= 0);
    if (!cells.length) return;
    const xs = cells.map(c => c % CONST.GRID_W);
    if (Math.max(...xs) - Math.min(...xs) > 13) { frameView(false); return; }
    let x = 0, z = 0;
    for (const c of cells) { const p = Renderer.cellCenter(c); x += p.x; z += p.z; }
    Renderer.focus(x / cells.length, z / cells.length + 6, Math.max(200, Renderer.framedDist() * 0.68));
  }

  function logCancelled(e) {
    UI.log((e.side === P ? 'Your ' : 'Enemy ') + (e.kind === 'drop' ? 'drop' : e.kind === 'strike' ? 'orbital strike' : 'launch') + ' cancelled — launcher destroyed' + (e.side === P && e.refund ? ' (' + e.refund + ' energy refunded)' : ''), e.side === P ? 'bad' : 'good');
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

  // Orbital strike, part 1: the uplink fires a column of light into the sky
  function animateStrikeLaunch(e) {
    const own = e.side === P;
    const pos = Renderer.cellCenter(e.from);
    UI.log(own ? 'Orbital strike away — it lands on ' + describeCell(e.to) + ' next turn'
      : 'ENEMY ORBITAL STRIKE launched — target ' + describeCell(e.to) + ', impact next turn', own ? 'player' : 'bad');
    if (!playerSees(e.from)) { SND.play('strikeUp', { pan: 0.6, gain: 0.5 }); return; }
    SND.play('strikeUp', { pan: panAt(e.from) });
    const beam = Renderer.strikeBeam(pos, own ? 0x66e8ff : 0xff7a55, 1.4, true);
    Fx.dustRing(pos, 1.2);
    Renderer.addTrauma(0.2, pos);
    Timeline.tween(1.4, k => beam.update(k), () => beam.dispose());
  }

  // Orbital strike, part 2: a targeting beam, then the strike itself
  function animateStrikeDescent(e, impact, idAt) {
    const own = e.side === P;
    const pos = Renderer.cellCenter(e.to);
    SND.play('strikeDown', { pan: panAt(e.to) });
    const beam = Renderer.strikeBeam(pos, own ? 0x9ff4ff : 0xffb08a, 1.3, false);
    Timeline.tween(1.3, k => {
      beam.update(k);
      if (k > 0.25) Renderer.addTrauma(0.02, pos);
    }, () => { beam.dispose(); if (impact) applyImpact(impact, idAt); });
  }

  // Missiles stay readable when the whole map is framed (far camera), true to size up close
  function missileScale() { return 2.4 * Math.max(1, Math.min(1.7, Renderer.framedDist() / 380)); }

  // A beat of slow motion on the moments that matter (HQ hits, the killing blow)
  let slowmo = 0, slowmoRate = 1;
  function slowMotion(seconds, rate) { if (seconds > slowmo) { slowmo = seconds; slowmoRate = rate; } }

  function animateLaunch(e, idAt) {
    if (e.strike) return animateStrikeLaunch(e);
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
    m.scale.setScalar(missileScale());
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
    if (e.strike) return animateStrikeDescent(e, impact, idAt);
    const own = e.side === P;
    const { a, b, h } = missilePath(e);
    const m = Models.missile(e.side);
    m.scale.setScalar(missileScale());
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
      // grow in from the apex instead of popping into view mid-air
      m.scale.setScalar(missileScale() * Math.min(1, 0.15 + kk * 6));
      if (kk > 0.04) Fx.trail(p, 'missile', own ? 0x66ccff : 0xff6a00);
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
        const by = shotBy(e.interceptedBy, shots[shots.length - 1]);
        UI.log((own ? 'Your missile was shot down by ' + by : 'Enemy missile shot down by your ' + by) + ' over ' + cellName(e.to), own ? 'bad' : 'good');
        if (own) revealInterceptor(e.interceptedBy);
        Renderer.addTrauma(0.12, p);
      } else if (impact) {
        if (shots.length) {
          const names = shots.map(sh => shotBy(sh.by, sh)).join(' and ');
          UI.log((own ? 'Your missile slipped past ' + names : 'Your ' + names + ' missed the enemy missile') + ' over ' + cellName(e.to), own ? 'good' : 'bad');
          if (own) shots.forEach(sh => revealInterceptor(sh.by));
        }
        applyImpact(impact, idAt);
      }
    });
  }

  // Who fired at a missile, in log wording: 'HQ point defence' or 'AA Battery at I27 (70%)'
  function shotBy(cell, shot) {
    const b = R.buildingAt(state, cell);
    const pct = shot && shot.chance ? ' (' + Math.round(shot.chance * 100) + '%)' : '';
    if (b && b.type === 'hq') return 'HQ point defence' + pct;
    return 'AA Battery at ' + cellName(cell) + pct;
  }
  // An enemy battery that fires gives its position away: remember it as last-known intel
  function revealInterceptor(cell) {
    if (R.ownerOfCell(cell) !== A) return;
    const b = R.buildingAt(state, cell);
    if (!b || b.type === 'hq') return;
    const seen = state.sides[P].intel.seen;
    if (visible.has(cell) || seen[cell]) return;
    const a = R.apparent(b);
    seen[cell] = { type: a.type, hp: a.hp, maxHp: a.maxHp, level: a.level, turn: state.turn };
    Renderer.setGhosts(Object.keys(seen).filter(k => !visible.has(+k)).map(k => ({ cell: +k, type: seen[k].type })));
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
    const wet = !R.isLand(state, ev.cell);
    const big = ev.strike;
    if (wet) { Fx.splash(pos.clone().setY(-1)); SND.play('explosion', { pan: panAt(ev.cell), gain: 0.5 }); }
    else { Fx.explosion(pos, big ? 2.2 : hqHit ? 1.3 : 1); SND.play('explosion', { pan: panAt(ev.cell), big: hqHit || big }); }
    if (big) for (const n of R.neighbors(ev.cell, 1)) if (R.isLand(state, n)) Fx.smallBlast(Renderer.cellCenter(n).setY(2), 0xffd28a);
    Renderer.addTrauma(big ? 0.9 : wet ? 0.15 : hqHit ? 0.6 : 0.38, pos);
    if (hqHit) slowMotion(0.55, 0.35);
    // the target's own damage, with splash on its neighbours reported separately
    let direct = 0, splash = 0, absorbed = 0;
    for (const h of ev.hits) { const d = shownDmg(h, h.dmg); if (h.cell === ev.cell) direct += d; else splash += d; absorbed += h.absorbed > 0 ? h.absorbed : 0; }
    const name = describeCell(ev.cell);
    const dmgText = (ev.hits.some(h => h.cell === ev.cell) ? direct + ' damage' : 'no direct hit') + (splash ? ', ' + splash + ' splash to nearby structures' : '')
      + (absorbed ? ' (' + absorbed + ' absorbed by shields)' : '');
    if (big) UI.log((own ? 'ORBITAL STRIKE on ' : 'ENEMY ORBITAL STRIKE on ') + name + ': ' + dmgText, own ? 'good' : 'bad');
    else if (!ev.hits.length) UI.log((own ? 'Your missile ' : 'Enemy missile ') + (wet ? 'splashed into the sea at ' : 'hit empty ground at ') + cellName(ev.cell), own ? 'player' : 'enemy');
    else UI.log((own ? 'Missile impact on ' : 'Enemy missile hit ') + name + ': ' + dmgText, own ? 'good' : 'bad');
    // log the summary first, then the losses it caused
    for (const h of ev.hits) applyHit(h, idAt);
    // the impact reveals the area — lift fog right away for the attacker
    if (own) {
      for (const c of ev.reveal) visible.add(c);
      Renderer.setFog(c => R.ownerOfCell(c) === A && !visible.has(c));
      for (const c of ev.reveal) { const id = idAt[c]; if (id && Renderer.getBuilding(id)) Renderer.setBuildingVisible(id, true); }
    }
  }

  // Damage as the player perceives it: hits on an enemy decoy are scaled to its disguise
  function shownDmg(h, amount) {
    if (!h.disguise || h.side === P || h.destroyed) return amount;
    return Math.round(amount * BUILDINGS[h.disguise].hp / BUILDINGS.decoy.hp);
  }
  function shownType(h) { return h.disguise && h.side !== P && !h.destroyed ? h.disguise : h.type; }

  // Apply a damage record from the rules to the view. Returns damage as shown to the player.
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
    if (h.dmg > 0 && vis) floatAt(h.cell, '-' + shownDmg(h, h.dmg), h.type === 'hq' ? 'dmg big' : 'dmg');
    if (h.destroyed) {
      const pos = Renderer.cellCenter(h.cell);
      Renderer.setBuildingVisible(h.id, true);
      Renderer.removeBuilding(h.id, false);
      Fx.explosion(pos, h.type === 'hq' ? 2 : 1.2);
      if (h.type === 'hq') slowMotion(1.4, 0.25); // the killing blow
      Fx.setEmitter('ruin' + h.cell, { x: pos.x, y: 1, z: pos.z }, 'fire', 6);
      SND.play('destroyed', { pan: panAt(h.cell), big: h.type === 'hq' });
      Renderer.addTrauma(h.type === 'hq' ? 1 : 0.5, pos);
      floatAt(h.cell, 'DESTROYED', 'dmg big', 20);
      if (h.type === 'decoy') UI.log(h.side === P ? 'Your decoy at ' + cellName(h.cell) + ' soaked up the attack' : 'That was a DECOY at ' + cellName(h.cell) + '!', h.side === P ? 'good' : 'bad');
      else UI.log((h.side === P ? 'LOST: your ' : 'DESTROYED: enemy ') + BUILDINGS[h.type].name + ' at ' + cellName(h.cell), h.side === P ? 'bad' : 'good');
    }
    if (h.type === 'hq') refreshHQFromHit(h);
    return shownDmg(h, h.dmg);
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
        } else if (e.side === P) {
          if (rec && rec.group.visible) UI.log('Your ' + gun + ' hit an enemy mech (-' + s.dmg + ', ' + s.hpAfter + ' HP left)', 'good');
        } else {
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
      const what = (e.side === P ? 'Your mech smashes enemy ' : 'Enemy mech smashes your ') + BUILDINGS[shownType(e.hit)].name;
      UI.log(what + (e.hit.dmg > 0 ? ' (-' + shownDmg(e.hit, e.hit.dmg) + (e.hit.absorbed ? ', ' + e.hit.absorbed + ' absorbed by shield' : '') + ')' : ' — absorbed by shield'), e.side === P ? 'good' : 'bad');
      applyHit(e.hit, idAt);
    });
  }

  // Mech vs mech melee
  function animateRobotFight(e) {
    const rec = Renderer.getRobot(e.id), foe = Renderer.getRobot(e.targetId);
    const tp = foe ? foe.group.position.clone() : Renderer.cellCenter(e.targetCell);
    if (rec) {
      rec.group.rotation.y = Math.atan2(tp.x - rec.group.position.x, tp.z - rec.group.position.z);
      rec.punch = 1;
    }
    if (foe) foe.group.rotation.y = Math.atan2((rec ? rec.group.position.x : tp.x) - tp.x, (rec ? rec.group.position.z : tp.z) - tp.z);
    Timeline.tween(0.22, () => {}, () => {
      const p = tp.clone().setY(6);
      Fx.smallBlast(p, 0xffcc66);
      SND.play('robotPunch', { pan: panAtPos(p) });
      Renderer.hitRobot(e.targetId);
      Renderer.setRobotHp(e.targetId, e.hpAfter);
      if (foe && foe.group.visible) floatAt(e.targetCell, '-' + e.dmg, 'dmg', 16);
      const own = e.side === P;
      if (e.killed) {
        Fx.explosion(p.setY(2), 0.7);
        SND.play('robotDie', { pan: panAtPos(p) });
        Renderer.removeRobot(e.targetId);
        UI.log(own ? 'Your mech destroyed an enemy mech in melee' : 'Your mech was destroyed in melee', own ? 'good' : 'bad');
      } else {
        UI.log((own ? 'Your mech pummels an enemy mech' : 'Enemy mech pummels your mech') + ' (-' + e.dmg + ', ' + e.hpAfter + ' HP left)', own ? 'good' : 'bad');
      }
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
      const garrison = R.ownerOfCell(e.to) === e.side;
      UI.log(own ? (garrison ? 'Garrison mech deployed at ' : 'Mech landed at ') + cellName(e.to)
        : garrison ? 'Enemy garrison mech deployed' : (landVisible ? 'Enemy mech landed at ' + cellName(e.to) + '!' : 'Enemy drop pod detected'), own ? 'player' : 'bad');
    });
  }

  // Per-turn record for the post-battle chart: HQ health % and structure count, both sides
  function recordHistory() {
    const snap = side => {
      const hq = R.buildingsOf(state, side, 'hq')[0];
      return { hq: hq ? Math.round(100 * hq.hp / hq.maxHp) : 0, n: R.buildingsOf(state, side).length };
    };
    state.history = state.history || [];
    const t = state.winner ? state.turn : state.turn - 1;   // the turn that just resolved
    state.history = state.history.filter(h => h.t !== t);
    state.history.push({ t, player: snap(P1), ai: snap(P2) });
  }

  function finishTurn(events, turn) {
    preNames = null;
    recordHistory();
    checkTurnAchievements(events);
    frameView(false);
    UI.setCombatHint(false);
    combatHud = null;
    syncWorld(true);
    lastReportP2 = null;
    if (state.winner) return gameOver();
    const report = buildReport(events, turn);
    const eventful = events.some(e => /descend|gunfire|robotHit|drop/.test(e.type));
    if (eventful) { UI.showReport(report); reportTimer = 6; }
    // Player 2 didn't watch: they get the same report from their side when their turn starts
    lastReportP2 = hotseat && eventful ? Object.assign({}, report, { player: report.ai, ai: report.player, income: R.income(state, P2), swap: true }) : null;
    if (hotseat) {
      // Player 2 didn't watch the battle: give their log a one-line summary
      const lost = report.ai.lostNames.length ? ' Lost: ' + report.ai.lostNames.join(', ') + '.' : '';
      const line = eventful ? 'Turn ' + turn + ' battle: you dealt ' + report.ai.dealt + ' damage and took ' + report.player.dealt + '.' + lost : 'Turn ' + turn + ': a quiet turn.';
      logs[P2] = (logs[P2] || '') + '<div class="' + (report.ai.lostNames.length ? 'bad' : 'sys') + '">' + UI.esc(line) + '</div>';
    }
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
      if (e.type === 'robotFight' && e.killed) r[other(e.side)].robotsLost++;
      if (e.type === 'end') for (const d of e.destroyed) r[d.side].lostNames.push(BUILDINGS[d.type].name);
    }
    r.intel = intelLine(r.swap ? P2 : P);
    return r;
  }

  // What the side has seen of the enemy's base, for the turn report
  function intelLine(side) {
    const seen = state.sides[side].intel.seen;
    const types = Object.keys(seen).map(k => seen[k].type);
    const depots = types.filter(t => t === 'depot').length;
    return 'Intel: ' + (types.length + 1) + '+ enemy structures seen' + (depots ? ', ' + depots + ' depot' + (depots > 1 ? 's' : '') : '');
  }

  // One actionable line for the defeat screen: the biggest thing that went wrong
  function defeatTip() {
    const ps = state.sides[P].stats, as = state.sides[A].stats;
    const mine = t => R.buildingsOf(state, P, t).length, theirs = t => R.buildingsOf(state, A, t).length;
    const landed = as.missilesFired - state.missiles.filter(m => m.side === A && !m.strike).length;
    if (theirs('depot') >= mine('depot') + 2) return 'The enemy ran ' + theirs('depot') + ' Supply Depots to your ' + mine('depot') + '. Build a second and third depot in the first five turns.';
    if (landed >= 4 && as.missilesHit / landed > 0.6 && ps.intercepts < 3) return as.missilesHit + ' of ' + landed + ' enemy missiles got through. AA Batteries next to your HQ shoot down 70%, and you can stack them.';
    if (as.robotsDeployed >= 2 && ps.robotsKilled < as.robotsDeployed / 2) return 'Enemy mechs did most of the damage. A Gun Pod near your HQ, or a garrison mech, stops them.';
    if (ps.missilesFired >= 4 && ps.missilesHit / Math.max(1, ps.missilesFired) < 0.35) return 'Most of your missiles were shot down. Fire several in the same turn, or aim at targets outside the enemy\'s AA cover (the aim tooltip shows the odds).';
    if (ps.missilesFired < state.turn / 2) return 'You fired only ' + ps.missilesFired + ' missiles. More silos and power plants keep the pressure on.';
    return 'Diversify: mix missile salvos with a mech drop or an orbital strike so the enemy can\'t defend against everything.';
  }

  function gameOver() {
    phase = 'gameover';
    clearSave();
    const mission = state.mission ? CAMPAIGN[state.mission - 1] : null;
    if (mission && state.winner === P && campaignDone() < mission.id) {
      try { localStorage.setItem('ra_campaign', String(mission.id)); } catch (e) { /* ignore */ }
    }
    const medals = mission ? R.missionMedals(state, mission, P) : null;
    const newBest = medals ? recordMedals(mission.id, medals) : false;
    const daily = state.daily ? { score: R.dailyScore(state, P) } : null;
    if (daily) daily.prev = recordDaily(state.daily, daily.score);
    checkEndAchievements();
    UI.setDock(false);
    SND.setMode('off');
    SND.setTension(false);
    const w = state.winner;
    const title = hotseat ? (w === 'draw' ? 'DRAW' : seatName(w).toUpperCase() + ' WINS') : w === P ? 'VICTORY' : w === A ? 'DEFEAT' : 'DRAW';
    SND.play(w === P || (hotseat && w !== 'draw') ? 'victory' : 'defeat');
    const seatReason = w === 'draw' || /Turn limit/.test(state.endReason) ? state.endReason : seatName(R.enemyOf(w)) + '\'s Command Center destroyed';
    UI.banner(title, hotseat ? seatReason : state.endReason, !hotseat && w !== P);
    refreshHUD();
    const ps = state.sides[P].stats, as = state.sides[A].stats;
    // missiles still in the air when the game ended never had a chance to land
    const landed = side => state.sides[side].stats.missilesFired - state.missiles.filter(m => m.side === side && !m.strike).length;
    const acc = (s, side) => landed(side) > 0 ? Math.round(100 * s.missilesHit / landed(side)) + '%' : '—';
    setTimeout(() => {
      if (phase !== 'gameover') return;
      UI.showGameOver({
        title,
        kind: hotseat ? (w === 'draw' ? 'draw' : 'win') : w === P ? 'win' : w === A ? 'lose' : 'draw',
        cols: hotseat ? ['Player 1', 'Player 2'] : null,
        tip: !hotseat && w === A ? defeatTip() : null,
        reason: (hotseat ? seatReason + ' — turn ' + state.turn + ' · two players' : state.endReason + ' — turn ' + state.turn + ' · ' + (mission ? 'Mission ' + mission.id + ': ' + mission.name : state.daily ? 'Daily Operation ' + state.daily : CONST.DIFFICULTY[state.difficulty].name)),
        daily: daily ? { score: daily.score, best: Math.max(daily.score, daily.prev), newBest: daily.score > daily.prev } : null,
        next: !!(mission && w === P && CAMPAIGN[mission.id]),
        again: mission ? (w === P ? 'Replay Mission' : 'Retry Mission') : state.daily ? 'Retry Daily' : 'Rematch',
        medals: medals ? { got: medals, labels: UI.medalLabels(mission), newBest } : null,
        quote: mission ? (w === P ? { who: COMMANDERS.hale, text: mission.win } : { who: COMMANDERS[mission.enemy], text: w === A ? 'As expected. Go home, Commander.' : 'Stalemate... this time.' }) : null,
        history: state.history || [],
        rows: [
          ['Damage dealt', ps.damageDealt, as.damageDealt],
          ['Structures built', ps.built, as.built],
          ['Structures destroyed', ps.destroyed, as.destroyed],
          ['Missiles fired', ps.missilesFired, as.missilesFired],
          ['Missiles past defenses', acc(ps, P), acc(as, A)],
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
    if (phase === 'resolving') {
      let rate = speed;
      if (slowmo > 0) { slowmo -= raw; rate = Math.min(speed, slowmoRate); }
      Timeline.update(raw * rate);
    }
    backdropTick(raw);
    if (reportTimer > 0) { reportTimer -= raw; if (reportTimer <= 0) UI.hideReport(); }
    // highlight hovered order's target
    Renderer.render(dt, !UI.isHelpOpen() && phase !== 'menu');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
