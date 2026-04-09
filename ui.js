// ============================================================
// Robot Strategy Attack 2026 — UI System
// ============================================================
// Vanilla JS DOM overlay: HUD, build menu, turn log, fog, menus

window.UI = (function() {

  let container = null;
  let hudEl = null;
  let buildMenuEl = null;
  let turnLogEl = null;
  let mainMenuEl = null;
  let gameOverEl = null;
  let fogOverlayEl = null;
  let tooltipEl = null;
  let selectedBuildType = null;
  let onBuildSelect = null;
  let onEndTurn = null;
  let onMissileTarget = null;
  let onRobotTarget = null;
  let onStartGame = null;
  let currentMode = 'build'; // 'build', 'missile_target', 'robot_target'
  let targetingCallback = null;

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');

    #ui-container {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none;
      font-family: 'Share Tech Mono', 'Courier New', monospace;
      z-index: 100;
    }
    #ui-container * {
      box-sizing: border-box;
    }
    .ui-interactive {
      pointer-events: auto;
    }

    /* ── HUD Top Bar ── */
    #hud-bar {
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 48px;
      background: rgba(10, 10, 0, 0.9);
      border-bottom: 1px solid #553300;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      color: #FFB000;
      font-size: 14px;
      pointer-events: auto;
    }
    #hud-bar .hud-section {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    #hud-bar .hud-label {
      color: #8B6914;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    #hud-bar .hud-value {
      color: #FFB000;
      font-size: 16px;
      font-weight: bold;
    }
    #hud-bar .hud-value.danger {
      color: #FF3300;
    }
    #hud-turn {
      color: #FFB000;
      font-size: 18px;
      text-transform: uppercase;
      letter-spacing: 2px;
    }
    #hud-phase {
      color: #8B6914;
      font-size: 12px;
      text-transform: uppercase;
    }

    /* ── Build Menu (bottom panel) ── */
    #build-menu {
      position: absolute;
      bottom: 0; left: 0; right: 0;
      background: rgba(10, 10, 0, 0.92);
      border-top: 1px solid #553300;
      padding: 8px 12px;
      display: none;
      pointer-events: auto;
    }
    #build-menu.visible {
      display: block;
    }
    #build-menu-title {
      color: #8B6914;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 2px;
      margin-bottom: 6px;
    }
    #build-menu-grid {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .build-btn {
      background: rgba(85, 51, 0, 0.4);
      border: 1px solid #553300;
      color: #FFB000;
      padding: 8px 12px;
      font-family: 'Share Tech Mono', monospace;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s;
      min-width: 140px;
      text-align: left;
    }
    .build-btn:hover {
      background: rgba(255, 176, 0, 0.15);
      border-color: #FFB000;
    }
    .build-btn.selected {
      background: rgba(255, 176, 0, 0.25);
      border-color: #FFB000;
      box-shadow: 0 0 8px rgba(255, 176, 0, 0.3);
    }
    .build-btn.disabled {
      opacity: 0.3;
      cursor: not-allowed;
      pointer-events: none;
    }
    .build-btn .btn-name {
      display: block;
      font-size: 13px;
      margin-bottom: 2px;
    }
    .build-btn .btn-cost {
      color: #8B6914;
      font-size: 11px;
    }
    .build-btn .btn-desc {
      color: #665522;
      font-size: 10px;
      display: block;
      margin-top: 2px;
    }

    /* ── Action Buttons ── */
    #action-bar {
      position: absolute;
      bottom: 0; right: 16px;
      display: flex;
      gap: 8px;
      padding: 10px 0;
      pointer-events: auto;
    }
    #build-menu.visible ~ #action-bar {
      bottom: auto;
      position: relative;
      justify-content: flex-end;
      margin-top: 8px;
    }
    .action-btn {
      background: rgba(255, 176, 0, 0.2);
      border: 1px solid #FFB000;
      color: #FFB000;
      padding: 8px 20px;
      font-family: 'Share Tech Mono', monospace;
      font-size: 13px;
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 1px;
      transition: all 0.15s;
    }
    .action-btn:hover {
      background: rgba(255, 176, 0, 0.35);
      box-shadow: 0 0 12px rgba(255, 176, 0, 0.4);
    }
    .action-btn.danger {
      border-color: #FF3300;
      color: #FF3300;
    }
    .action-btn.danger:hover {
      background: rgba(255, 51, 0, 0.25);
    }

    /* ── Turn Log (right side) ── */
    #turn-log {
      position: absolute;
      top: 56px; right: 8px;
      width: 280px;
      max-height: 300px;
      background: rgba(10, 10, 0, 0.85);
      border: 1px solid #332200;
      padding: 8px;
      overflow-y: auto;
      display: none;
      pointer-events: auto;
      font-size: 11px;
    }
    #turn-log.visible {
      display: block;
    }
    #turn-log-title {
      color: #8B6914;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 4px;
      font-size: 10px;
    }
    .log-entry {
      color: #8B6914;
      padding: 2px 0;
      border-bottom: 1px solid rgba(51, 34, 0, 0.3);
    }
    .log-entry.player { color: #FFB000; }
    .log-entry.enemy { color: #FF3300; }
    .log-entry.system { color: #8B6914; }
    .log-entry.damage { color: #FF6600; }

    /* ── Targeting Mode Overlay ── */
    #targeting-overlay {
      position: absolute;
      top: 48px; left: 0; right: 0;
      height: 32px;
      background: rgba(255, 51, 0, 0.15);
      border-bottom: 1px solid #FF3300;
      display: none;
      align-items: center;
      justify-content: center;
      color: #FF3300;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 2px;
      animation: targetPulse 1s ease-in-out infinite;
      pointer-events: auto;
    }
    #targeting-overlay.visible {
      display: flex;
    }
    @keyframes targetPulse {
      0%, 100% { opacity: 0.7; }
      50% { opacity: 1; }
    }

    /* ── Main Menu ── */
    #main-menu {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(10, 10, 0, 0.95);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      z-index: 200;
    }
    #main-menu.hidden { display: none; }
    #menu-title {
      color: #FFB000;
      font-size: 48px;
      text-transform: uppercase;
      letter-spacing: 6px;
      margin-bottom: 4px;
      text-shadow: 0 0 20px rgba(255, 176, 0, 0.5);
    }
    #menu-subtitle {
      color: #8B6914;
      font-size: 16px;
      letter-spacing: 4px;
      margin-bottom: 48px;
    }
    #menu-year {
      color: #553300;
      font-size: 14px;
      margin-bottom: 40px;
      letter-spacing: 8px;
    }
    .menu-btn {
      background: transparent;
      border: 1px solid #553300;
      color: #FFB000;
      padding: 14px 48px;
      font-family: 'Share Tech Mono', monospace;
      font-size: 16px;
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 3px;
      margin: 6px 0;
      min-width: 320px;
      transition: all 0.2s;
    }
    .menu-btn:hover {
      background: rgba(255, 176, 0, 0.1);
      border-color: #FFB000;
      box-shadow: 0 0 16px rgba(255, 176, 0, 0.3);
    }
    .menu-btn .btn-sub {
      display: block;
      font-size: 10px;
      color: #8B6914;
      margin-top: 4px;
      letter-spacing: 1px;
    }

    /* ── Game Over Screen ── */
    #game-over {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(10, 10, 0, 0.9);
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      z-index: 200;
    }
    #game-over.visible {
      display: flex;
    }
    #game-over-title {
      font-size: 56px;
      letter-spacing: 8px;
      text-transform: uppercase;
      margin-bottom: 16px;
      text-shadow: 0 0 30px currentColor;
    }
    #game-over-title.victory { color: #FFB000; }
    #game-over-title.defeat { color: #FF3300; }
    #game-over-stats {
      color: #8B6914;
      font-size: 14px;
      margin-bottom: 32px;
      text-align: center;
      line-height: 1.8;
    }

    /* ── Tooltip ── */
    #tooltip {
      position: absolute;
      background: rgba(10, 10, 0, 0.95);
      border: 1px solid #553300;
      color: #FFB000;
      padding: 6px 10px;
      font-size: 11px;
      pointer-events: none;
      display: none;
      z-index: 150;
      max-width: 200px;
    }
    #tooltip.visible { display: block; }

    /* ── Combat Phase Overlay ── */
    #combat-overlay {
      position: absolute;
      top: 48px; left: 50%;
      transform: translateX(-50%);
      background: rgba(10, 10, 0, 0.85);
      border: 1px solid #FF3300;
      color: #FF3300;
      padding: 8px 24px;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 3px;
      display: none;
      pointer-events: none;
    }
    #combat-overlay.visible { display: block; }

    /* ── Building Info Popup ── */
    #building-info {
      position: absolute;
      top: 60px; left: 12px;
      width: 260px;
      background: rgba(10, 10, 0, 0.95);
      border: 1px solid #FFB000;
      color: #FFB000;
      padding: 10px 12px;
      font-size: 12px;
      display: none;
      pointer-events: auto;
      box-shadow: 0 0 16px rgba(255, 176, 0, 0.25);
    }
    #building-info.visible { display: block; }
    #building-info .bi-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #553300;
      padding-bottom: 4px;
      margin-bottom: 6px;
    }
    #building-info .bi-name {
      color: #FFB000;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    #building-info .bi-close {
      background: transparent;
      border: 1px solid #553300;
      color: #8B6914;
      cursor: pointer;
      padding: 2px 6px;
      font-family: inherit;
      font-size: 11px;
    }
    #building-info .bi-close:hover { color: #FF3300; border-color: #FF3300; }
    #building-info .bi-hp {
      height: 8px;
      background: rgba(85, 51, 0, 0.4);
      border: 1px solid #553300;
      margin: 4px 0;
      position: relative;
    }
    #building-info .bi-hp-fill {
      height: 100%;
      background: #FFB000;
      transition: width 0.2s;
    }
    #building-info .bi-hp-text {
      font-size: 10px;
      color: #8B6914;
    }
    #building-info .bi-desc {
      color: #8B6914;
      font-size: 11px;
      margin: 6px 0;
      line-height: 1.4;
    }
    #building-info .bi-stats {
      color: #FFB000;
      font-size: 11px;
    }
    #building-info .bi-stats div {
      padding: 1px 0;
    }

    /* ── Scrollbar styling ── */
    #turn-log::-webkit-scrollbar { width: 4px; }
    #turn-log::-webkit-scrollbar-track { background: #0A0A00; }
    #turn-log::-webkit-scrollbar-thumb { background: #553300; }
  `;

  // ── Building info for UI ──
  const BUILDING_INFO = {
    [CONST.BUILDING.POWER_PLANT]:      { name: 'Power Plant',      desc: '+' + CONST.POWER_PLANT_ENERGY + ' energy/turn',          icon: '[P]' },
    [CONST.BUILDING.SUPPLY_DEPOT]:     { name: 'Supply Depot',     desc: '+' + CONST.SUPPLY_DEPOT_CREDITS + ' credits/turn',        icon: '[$]' },
    [CONST.BUILDING.RADAR_STATION]:    { name: 'Radar Station',    desc: 'Persistent scan ' + CONST.RADAR_RANGE + ' cells',         icon: '[R]' },
    [CONST.BUILDING.MISSILE_SILO]:     { name: 'Missile Silo',     desc: 'Fire missile (' + CONST.ENERGY_FIRE_MISSILE + ' energy)', icon: '[M]' },
    [CONST.BUILDING.ANTI_MISSILE]:     { name: 'Anti-Missile',     desc: 'Intercepts ' + CONST.ANTI_MISSILE_SHOTS_PER_TURN + ' missiles/turn', icon: '[A]' },
    [CONST.BUILDING.ROBOT_HANGAR]:     { name: 'Robot Hangar',     desc: 'Deploy mech (' + CONST.ENERGY_DEPLOY_ROBOT + ' energy)',  icon: '[H]' },
    [CONST.BUILDING.SHIELD_GENERATOR]: { name: 'Shield Gen',       desc: 'Absorbs 1 hit on adj cells',                              icon: '[S]' },
    [CONST.BUILDING.GUN_POD]:          { name: 'Gun Pod',          desc: 'Anti-robot turret, ' + CONST.GUN_POD_RANGE + ' cell range', icon: '[G]' },
    [CONST.BUILDING.COMMAND_CENTER]:   { name: 'Command Center',   desc: 'HQ — Protect at all costs',                               icon: '[C]' }
  };

  function getCostForType(type) {
    const keyMap = {
      [CONST.BUILDING.POWER_PLANT]: 'POWER_PLANT',
      [CONST.BUILDING.RADAR_STATION]: 'RADAR_STATION',
      [CONST.BUILDING.MISSILE_SILO]: 'MISSILE_SILO',
      [CONST.BUILDING.ANTI_MISSILE]: 'ANTI_MISSILE',
      [CONST.BUILDING.ROBOT_HANGAR]: 'ROBOT_HANGAR',
      [CONST.BUILDING.SHIELD_GENERATOR]: 'SHIELD_GENERATOR',
      [CONST.BUILDING.SUPPLY_DEPOT]: 'SUPPLY_DEPOT',
      [CONST.BUILDING.GUN_POD]: 'GUN_POD',
      [CONST.BUILDING.COMMAND_CENTER]: 'COMMAND_CENTER'
    };
    return CONST.COST[keyMap[type]] || 0;
  }

  // ════════════════════════════════════════
  // INITIALIZATION
  // ════════════════════════════════════════
  function init(callbacks) {
    onBuildSelect = callbacks.onBuildSelect || function(){};
    onEndTurn = callbacks.onEndTurn || function(){};
    onMissileTarget = callbacks.onMissileTarget || function(){};
    onRobotTarget = callbacks.onRobotTarget || function(){};
    onStartGame = callbacks.onStartGame || function(){};

    // Inject CSS
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // Container
    container = document.createElement('div');
    container.id = 'ui-container';
    document.body.appendChild(container);

    // HUD Bar
    hudEl = document.createElement('div');
    hudEl.id = 'hud-bar';
    hudEl.innerHTML = `
      <div class="hud-section">
        <div>
          <span class="hud-label">Credits</span>
          <span class="hud-value" id="hud-credits" style="color:#66FF99">400</span>
          <span class="hud-label">(+<span id="hud-credit-income">8</span>)</span>
        </div>
        <div>
          <span class="hud-label">Energy</span>
          <span class="hud-value" id="hud-energy" style="color:#00CCFF">20</span>
          <span class="hud-label">(+<span id="hud-energy-income">2</span>)</span>
        </div>
      </div>
      <div>
        <div id="hud-turn">Turn 1</div>
        <div id="hud-phase">Planning Phase</div>
      </div>
      <div class="hud-section">
        <div>
          <span class="hud-label">HQ HP</span>
          <span class="hud-value" id="hud-hq-hp">150</span>
        </div>
        <div>
          <span class="hud-label">Enemy HQ</span>
          <span class="hud-value" id="hud-enemy-hp">??</span>
        </div>
      </div>
    `;
    container.appendChild(hudEl);

    // Build Menu
    buildMenuEl = document.createElement('div');
    buildMenuEl.id = 'build-menu';
    buildMenuEl.innerHTML = `
      <div id="build-menu-title">Build Structure</div>
      <div id="build-menu-grid"></div>
      <div id="action-bar">
        <button class="action-btn" id="btn-fire-missile">Fire Missile</button>
        <button class="action-btn" id="btn-deploy-robot">Deploy Robot</button>
        <button class="action-btn danger" id="btn-end-turn">End Turn</button>
      </div>
    `;
    container.appendChild(buildMenuEl);

    // Turn Log
    turnLogEl = document.createElement('div');
    turnLogEl.id = 'turn-log';
    turnLogEl.innerHTML = `<div id="turn-log-title">Combat Log</div><div id="turn-log-entries"></div>`;
    container.appendChild(turnLogEl);

    // Targeting Overlay
    const targetOverlay = document.createElement('div');
    targetOverlay.id = 'targeting-overlay';
    targetOverlay.textContent = 'Select Target Segment';
    container.appendChild(targetOverlay);

    // Combat Overlay
    const combatOverlay = document.createElement('div');
    combatOverlay.id = 'combat-overlay';
    combatOverlay.textContent = 'Combat Phase';
    container.appendChild(combatOverlay);

    // Tooltip
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'tooltip';
    container.appendChild(tooltipEl);

    // Building Info Popup
    const bInfo = document.createElement('div');
    bInfo.id = 'building-info';
    bInfo.innerHTML = `
      <div class="bi-header">
        <div class="bi-name" id="bi-name">-</div>
        <button class="bi-close" id="bi-close">X</button>
      </div>
      <div class="bi-hp-text" id="bi-hp-text">HP: -/-</div>
      <div class="bi-hp"><div class="bi-hp-fill" id="bi-hp-fill" style="width:100%"></div></div>
      <div class="bi-desc" id="bi-desc">-</div>
      <div class="bi-stats" id="bi-stats"></div>
    `;
    container.appendChild(bInfo);
    document.getElementById('bi-close').addEventListener('click', hideBuildingInfo);

    // Main Menu
    mainMenuEl = document.createElement('div');
    mainMenuEl.id = 'main-menu';
    mainMenuEl.innerHTML = `
      <div id="menu-title">Robot Attack</div>
      <div id="menu-subtitle">Strategy 2026</div>
      <div id="menu-year">/// TACTICAL COMMAND INTERFACE ///</div>
      <button class="menu-btn" id="btn-patrol">
        Patrol Mode
        <span class="btn-sub">Random AI — Easier</span>
      </button>
      <button class="menu-btn" id="btn-commander">
        Commander Mode
        <span class="btn-sub">Strategic AI — Harder</span>
      </button>
    `;
    container.appendChild(mainMenuEl);

    // Game Over
    gameOverEl = document.createElement('div');
    gameOverEl.id = 'game-over';
    gameOverEl.innerHTML = `
      <div id="game-over-title">Victory</div>
      <div id="game-over-stats"></div>
      <button class="menu-btn" id="btn-play-again">Play Again</button>
    `;
    container.appendChild(gameOverEl);

    // ── Event Bindings ──
    document.getElementById('btn-patrol').addEventListener('click', () => {
      onStartGame(CONST.AI_MODE_PATROL);
    });
    document.getElementById('btn-commander').addEventListener('click', () => {
      onStartGame(CONST.AI_MODE_COMMANDER);
    });
    document.getElementById('btn-end-turn').addEventListener('click', () => {
      exitTargetingMode();
      onEndTurn();
    });
    document.getElementById('btn-fire-missile').addEventListener('click', () => {
      enterTargetingMode('missile_target', 'Select Missile Target', (segIdx) => {
        onMissileTarget(segIdx);
      });
    });
    document.getElementById('btn-deploy-robot').addEventListener('click', () => {
      enterTargetingMode('robot_target', 'Select Robot Landing Zone', (segIdx) => {
        onRobotTarget(segIdx);
      });
    });
    document.getElementById('btn-play-again').addEventListener('click', () => {
      gameOverEl.classList.remove('visible');
      mainMenuEl.classList.remove('hidden');
    });
  }

  // ════════════════════════════════════════
  // STATE UPDATE
  // ════════════════════════════════════════
  function updateHUD(state) {
    document.getElementById('hud-credits').textContent = state.playerCredits;
    document.getElementById('hud-energy').textContent = state.playerEnergy;
    const ciEl = document.getElementById('hud-credit-income');
    if (ciEl) ciEl.textContent = state.playerCreditIncome;
    const eiEl = document.getElementById('hud-energy-income');
    if (eiEl) eiEl.textContent = state.playerEnergyIncome;
    document.getElementById('hud-turn').textContent = `Turn ${state.turn}`;

    // HQ HP
    const playerCC = state.segments[CONST.COMMAND_CENTER_SEGMENT_PLAYER].building;
    const hqHp = playerCC ? playerCC.hp : 0;
    const hqEl = document.getElementById('hud-hq-hp');
    hqEl.textContent = hqHp;
    hqEl.className = 'hud-value' + (hqHp <= 40 ? ' danger' : '');

    // Enemy HQ (show if revealed or unknown)
    const enemyCC = state.segments[CONST.COMMAND_CENTER_SEGMENT_AI].building;
    const enemyRevealed = state.revealedEnemySegments.includes(CONST.COMMAND_CENTER_SEGMENT_AI);
    const enemyHpEl = document.getElementById('hud-enemy-hp');
    if (enemyRevealed && enemyCC) {
      enemyHpEl.textContent = enemyCC.hp;
      enemyHpEl.className = 'hud-value danger';
    } else {
      enemyHpEl.textContent = '??';
      enemyHpEl.className = 'hud-value';
    }

    // Phase text
    const phaseText = {
      [CONST.PHASE_PLANNING]: 'Planning Phase',
      [CONST.PHASE_AI_PLANNING]: 'Enemy Planning...',
      [CONST.PHASE_COMBAT]: 'Combat Phase',
      [CONST.PHASE_RESOLUTION]: 'Resolving...',
    };
    document.getElementById('hud-phase').textContent = phaseText[state.phase] || '';
  }

  function updateBuildMenu(state) {
    const grid = document.getElementById('build-menu-grid');
    grid.innerHTML = '';

    const buildableTypes = [
      CONST.BUILDING.POWER_PLANT,
      CONST.BUILDING.SUPPLY_DEPOT,
      CONST.BUILDING.RADAR_STATION,
      CONST.BUILDING.MISSILE_SILO,
      CONST.BUILDING.ANTI_MISSILE,
      CONST.BUILDING.ROBOT_HANGAR,
      CONST.BUILDING.SHIELD_GENERATOR,
      CONST.BUILDING.GUN_POD
    ];

    for (const type of buildableTypes) {
      const info = BUILDING_INFO[type];
      const cost = getCostForType(type);
      const canAfford = state.playerCredits >= cost;
      const hasSlot = getEmptySegments(state, CONST.SIDE_PLAYER).length > 0;
      const enabled = canAfford && hasSlot;

      const btn = document.createElement('button');
      btn.className = 'build-btn' + (!enabled ? ' disabled' : '') + (selectedBuildType === type ? ' selected' : '');
      btn.innerHTML = `
        <span class="btn-name">${info.icon} ${info.name}</span>
        <span class="btn-cost">Cost: ${cost} credits</span>
        <span class="btn-desc">${info.desc}</span>
      `;

      if (enabled) {
        btn.addEventListener('click', () => {
          selectedBuildType = (selectedBuildType === type) ? null : type;
          updateBuildMenu(state);
          if (selectedBuildType) {
            onBuildSelect(selectedBuildType);
          }
        });
      }

      grid.appendChild(btn);
    }

    // Update missile/robot buttons (also disable if insufficient energy)
    const hasSilo = getBuildingsOfType(state, CONST.SIDE_PLAYER, CONST.BUILDING.MISSILE_SILO).length > 0;
    const canFire = hasSilo && state.playerEnergy >= CONST.ENERGY_FIRE_MISSILE;
    const hasHangar = getBuildingsOfType(state, CONST.SIDE_PLAYER, CONST.BUILDING.ROBOT_HANGAR).some(h => !h.deployedThisTurn);
    const canDeploy = hasHangar && state.playerEnergy >= CONST.ENERGY_DEPLOY_ROBOT;

    document.getElementById('btn-fire-missile').style.opacity = canFire ? '1' : '0.3';
    document.getElementById('btn-fire-missile').style.pointerEvents = canFire ? 'auto' : 'none';
    document.getElementById('btn-deploy-robot').style.opacity = canDeploy ? '1' : '0.3';
    document.getElementById('btn-deploy-robot').style.pointerEvents = canDeploy ? 'auto' : 'none';
  }

  // ════════════════════════════════════════
  // TARGETING MODE
  // ════════════════════════════════════════
  function enterTargetingMode(mode, text, callback) {
    currentMode = mode;
    targetingCallback = callback;
    const overlay = document.getElementById('targeting-overlay');
    overlay.textContent = text;
    overlay.classList.add('visible');
    document.body.style.cursor = 'crosshair';
  }

  function exitTargetingMode() {
    currentMode = 'build';
    targetingCallback = null;
    const overlay = document.getElementById('targeting-overlay');
    overlay.classList.remove('visible');
    document.body.style.cursor = 'default';
  }

  function handleSegmentClick(segmentIndex) {
    if (currentMode === 'missile_target' || currentMode === 'robot_target') {
      if (targetingCallback) {
        targetingCallback(segmentIndex);
      }
      exitTargetingMode();
      return true;
    }
    return false;
  }

  // ════════════════════════════════════════
  // LOG
  // ════════════════════════════════════════
  function addLogEntry(text, type = 'system') {
    const entries = document.getElementById('turn-log-entries');
    if (!entries) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = text;
    entries.appendChild(entry);
    entries.scrollTop = entries.scrollHeight;
  }

  function clearLog() {
    const entries = document.getElementById('turn-log-entries');
    if (entries) entries.innerHTML = '';
  }

  // ════════════════════════════════════════
  // PHASE TRANSITIONS
  // ════════════════════════════════════════
  function showMainMenu() {
    mainMenuEl.classList.remove('hidden');
    buildMenuEl.classList.remove('visible');
    turnLogEl.classList.remove('visible');
    document.getElementById('combat-overlay').classList.remove('visible');
  }

  function showPlanningPhase(state) {
    mainMenuEl.classList.add('hidden');
    gameOverEl.classList.remove('visible');
    buildMenuEl.classList.add('visible');
    turnLogEl.classList.add('visible');
    document.getElementById('combat-overlay').classList.remove('visible');
    selectedBuildType = null;
    currentMode = 'build';
    updateHUD(state);
    updateBuildMenu(state);
  }

  function showCombatPhase(state) {
    buildMenuEl.classList.remove('visible');
    exitTargetingMode();
    document.getElementById('combat-overlay').classList.add('visible');
    updateHUD(state);
  }

  function showGameOver(winner, state) {
    buildMenuEl.classList.remove('visible');
    document.getElementById('combat-overlay').classList.remove('visible');
    exitTargetingMode();

    const titleEl = document.getElementById('game-over-title');
    titleEl.textContent = winner === CONST.SIDE_PLAYER ? 'Victory' : 'Defeat';
    titleEl.className = winner === CONST.SIDE_PLAYER ? 'victory' : 'defeat';

    const statsEl = document.getElementById('game-over-stats');
    statsEl.innerHTML = `
      Turns survived: ${state.turn}<br>
      AI Mode: ${state.aiMode.toUpperCase()}<br>
      Buildings constructed: ${state.segments.filter(s => s.building && s.building.side === CONST.SIDE_PLAYER && s.building.type !== CONST.BUILDING.COMMAND_CENTER).length}<br>
    `;

    gameOverEl.classList.add('visible');
  }

  // ════════════════════════════════════════
  // TOOLTIP
  // ════════════════════════════════════════
  function showTooltip(x, y, text) {
    tooltipEl.textContent = text;
    tooltipEl.style.left = (x + 12) + 'px';
    tooltipEl.style.top = (y - 8) + 'px';
    tooltipEl.classList.add('visible');
  }

  function hideTooltip() {
    tooltipEl.classList.remove('visible');
  }

  // ════════════════════════════════════════
  // BUILDING INFO POPUP
  // ════════════════════════════════════════
  let _lastInfoSegment = -1;
  function showBuildingInfo(segmentIndex, state) {
    const seg = state.segments[segmentIndex];
    if (!seg || !seg.building) { hideBuildingInfo(); return; }
    const b = seg.building;
    _lastInfoSegment = segmentIndex;

    const info = BUILDING_INFO[b.type] || { name: b.type, desc: '' };
    const tableInfo = (typeof BUILDING_INFO_TABLE !== 'undefined') ? BUILDING_INFO_TABLE[b.type] : null;

    document.getElementById('bi-name').textContent = (info.icon || '') + ' ' + info.name;
    const pct = Math.max(0, b.hp / b.maxHp);
    document.getElementById('bi-hp-fill').style.width = (pct * 100) + '%';
    document.getElementById('bi-hp-fill').style.background = pct > 0.5 ? '#FFB000' : (pct > 0.25 ? '#FF8800' : '#FF3300');
    document.getElementById('bi-hp-text').textContent = 'HP: ' + b.hp + '/' + b.maxHp;
    document.getElementById('bi-desc').textContent = tableInfo ? tableInfo.desc : info.desc;
    const statsEl = document.getElementById('bi-stats');
    statsEl.innerHTML = '';
    const stats = tableInfo && tableInfo.stats ? tableInfo.stats() : [];
    const cost = getCostForType(b.type);
    if (cost > 0) stats.push('Cost: ' + cost + ' credits');
    stats.push('Side: ' + b.side);
    for (const s of stats) {
      const d = document.createElement('div');
      d.textContent = '• ' + s;
      statsEl.appendChild(d);
    }
    document.getElementById('building-info').classList.add('visible');
  }

  function hideBuildingInfo() {
    document.getElementById('building-info').classList.remove('visible');
    _lastInfoSegment = -1;
  }

  function isBuildingInfoShowing() {
    return _lastInfoSegment >= 0;
  }

  function getSelectedInfoSegment() {
    return _lastInfoSegment;
  }

  // ════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════
  return {
    init,
    updateHUD,
    updateBuildMenu,
    showMainMenu,
    showPlanningPhase,
    showCombatPhase,
    showGameOver,
    addLogEntry,
    clearLog,
    showTooltip,
    hideTooltip,
    showBuildingInfo,
    hideBuildingInfo,
    isBuildingInfoShowing,
    getSelectedInfoSegment,
    handleSegmentClick,
    enterTargetingMode,
    exitTargetingMode,
    getSelectedBuildType() { return selectedBuildType; },
    clearBuildSelection() { selectedBuildType = null; },
    isTargeting() { return currentMode !== 'build'; },
    getMode() { return currentMode; },
    BUILDING_INFO
  };
})();
