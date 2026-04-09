// ============================================================
// Robot Strategy Attack 2026 — GameState & Shared Constants
// 2D GRID VERSION: 40 x 24 cells (960 total)
// ============================================================

const CONST = {
  // Grid dimensions (2D)
  GRID_W: 40,
  GRID_H: 24,
  CELL_SIZE: 12,       // world units per cell

  // Resources
  STARTING_CREDITS: 400,
  STARTING_ENERGY:  20,
  POWER_PLANT_ENERGY: 4,   // energy generated per power plant per turn
  SUPPLY_DEPOT_CREDITS: 5, // credits generated per supply depot per turn
  BASE_CREDITS_PER_TURN: 8, // baseline income
  BASE_ENERGY_PER_TURN: 2,  // baseline energy

  // Energy costs for actions
  ENERGY_FIRE_MISSILE: 10,
  ENERGY_DEPLOY_ROBOT: 15,

  // Command Center positions (x, y)
  CC_PLAYER_X: 2,
  CC_PLAYER_Y: 12,
  CC_AI_X: 37,
  CC_AI_Y: 12,
  COMMAND_CENTER_HP: 150,

  // Building CREDIT costs (spent on construction)
  COST: {
    POWER_PLANT:      100,
    RADAR_STATION:    120,
    MISSILE_SILO:     180,
    ANTI_MISSILE:     160,
    ROBOT_HANGAR:     200,
    SHIELD_GENERATOR: 170,
    SUPPLY_DEPOT:     150,
    GUN_POD:          120,
    COMMAND_CENTER:     0
  },

  // Building HP
  HP: {
    POWER_PLANT:       30,
    RADAR_STATION:     25,
    MISSILE_SILO:      50,
    ANTI_MISSILE:      40,
    ROBOT_HANGAR:      60,
    SHIELD_GENERATOR:  35,
    SUPPLY_DEPOT:      40,
    GUN_POD:           50,
    COMMAND_CENTER:   150
  },

  // Weapon stats
  MISSILE_DAMAGE: 25,
  MISSILE_AOE_RADIUS: 1,
  MISSILE_AOE_HALF_DAMAGE: 12,
  ANTI_MISSILE_SHOTS_PER_TURN: 2,
  SHIELD_ABSORB_COUNT: 1,

  // Gun Pod
  GUN_POD_DAMAGE: 8,
  GUN_POD_RANGE: 3,

  // Robot stats
  ROBOT_MELEE_DAMAGE: 15,
  ROBOT_HP: 40,

  // Radar — persistent scan radius
  RADAR_RANGE: 4,

  // Combat phase
  COMBAT_DURATION_MS: 10000,

  // AI modes
  AI_MODE_PATROL: 'patrol',
  AI_MODE_COMMANDER: 'commander',

  // Turn phases
  PHASE_MENU: 'menu',
  PHASE_PLANNING: 'planning',
  PHASE_AI_PLANNING: 'ai_planning',
  PHASE_COMBAT: 'combat',
  PHASE_RESOLUTION: 'resolution',
  PHASE_GAME_OVER: 'game_over',

  // Sides
  SIDE_PLAYER: 'player',
  SIDE_AI: 'ai',

  // Building type enum
  BUILDING: {
    POWER_PLANT:      'power_plant',
    RADAR_STATION:    'radar_station',
    MISSILE_SILO:     'missile_silo',
    ANTI_MISSILE:     'anti_missile',
    ROBOT_HANGAR:     'robot_hangar',
    SHIELD_GENERATOR: 'shield_generator',
    SUPPLY_DEPOT:     'supply_depot',
    GUN_POD:          'gun_pod',
    COMMAND_CENTER:   'command_center'
  },

  // Action types
  ACTION: {
    BUILD:          'build',
    FIRE_MISSILE:   'fire_missile',
    DEPLOY_ROBOT:   'deploy_robot',
    INTERCEPT:      'intercept',
    SHIELD_ABSORB:  'shield_absorb'
  },

  // Colors — amber CRT palette
  COLORS: {
    AMBER:        0xFFB000,
    AMBER_DARK:   0x8B6914,
    AMBER_DIM:    0x553300,
    BG_DARK:      0x0A0A00,
    TERRAIN:      0x3A2A00,
    TERRAIN_LIGHT:0x5A4A10,
    TERRAIN_PLAYER: 0x2A2005,
    TERRAIN_AI:    0x2A0505,
    CRATER:       0x1A1000,
    PLAYER:       0xFFB000,
    AI_ENEMY:     0xFF3300,
    SHIELD:       0x00CCFF,
    EXPLOSION:    0xFF6600,
    GRID:         0x553300,
    CREDITS:      0x66FF99,
    ENERGY:       0x00CCFF,
    HUD_BG:       'rgba(10, 10, 0, 0.85)',
    HUD_TEXT:     '#FFB000',
    HUD_DIM:      '#8B6914',
    HUD_DANGER:   '#FF3300',
    HUD_SHIELD:   '#00CCFF',
    HUD_CREDITS:  '#66FF99',
    HUD_ENERGY:   '#00CCFF'
  }
};

// Total cells in the grid
const TOTAL_CELLS = CONST.GRID_W * CONST.GRID_H;

// ── Legacy alias (used by old code expecting 1D) ──
const TOTAL_SEGMENTS = TOTAL_CELLS;

// ── Index conversion helpers ──
function xyToIndex(x, y) {
  return y * CONST.GRID_W + x;
}

function indexToXY(index) {
  return {
    x: index % CONST.GRID_W,
    y: Math.floor(index / CONST.GRID_W)
  };
}

// ── Determine which side owns a cell based on its X column ──
function cellSide(x) {
  return x < CONST.GRID_W / 2 ? CONST.SIDE_PLAYER : CONST.SIDE_AI;
}

// ── Cell Factory ──
function createCell(x, y) {
  return {
    x, y,
    index: xyToIndex(x, y),
    side: cellSide(x),
    destroyed: false,
    building: null,
    shielded: false,
    revealed: false
  };
}

// Legacy alias
function createSegment(index, side) {
  const xy = indexToXY(index);
  const cell = createCell(xy.x, xy.y);
  return cell;
}

// ── Building type → HP key lookup ──
const BUILDING_HP_KEY = {
  [CONST.BUILDING.POWER_PLANT]:      'POWER_PLANT',
  [CONST.BUILDING.RADAR_STATION]:    'RADAR_STATION',
  [CONST.BUILDING.MISSILE_SILO]:     'MISSILE_SILO',
  [CONST.BUILDING.ANTI_MISSILE]:     'ANTI_MISSILE',
  [CONST.BUILDING.ROBOT_HANGAR]:     'ROBOT_HANGAR',
  [CONST.BUILDING.SHIELD_GENERATOR]: 'SHIELD_GENERATOR',
  [CONST.BUILDING.SUPPLY_DEPOT]:     'SUPPLY_DEPOT',
  [CONST.BUILDING.GUN_POD]:          'GUN_POD',
  [CONST.BUILDING.COMMAND_CENTER]:   'COMMAND_CENTER'
};

// ── Building Factory ──
function createBuilding(type, side, segmentIndex) {
  const hpKey = BUILDING_HP_KEY[type] || 'POWER_PLANT';
  const hp = CONST.HP[hpKey];

  return {
    id: `${side}_${type}_${segmentIndex}_${Date.now()}`,
    type,
    side,
    segmentIndex,
    hp: hp,
    maxHp: hp,
    active: true,
    turnsAlive: 0,
    interceptsRemaining: type === CONST.BUILDING.ANTI_MISSILE ? CONST.ANTI_MISSILE_SHOTS_PER_TURN : 0,
    shieldActive: type === CONST.BUILDING.SHIELD_GENERATOR,
    deployedThisTurn: false,
    _mesh: null
  };
}

function getBuildingHP(type) {
  return CONST.HP[BUILDING_HP_KEY[type]] || 30;
}

function getBuildingCost(type) {
  return CONST.COST[BUILDING_HP_KEY[type]] || 0;
}

// ── Building info table (descriptions, stats) ──
const BUILDING_INFO_TABLE = {
  [CONST.BUILDING.POWER_PLANT]: {
    name: 'Power Plant',
    short: 'PWR',
    desc: 'Generates energy for firing missiles and deploying robots.',
    stats: function() { return ['+' + CONST.POWER_PLANT_ENERGY + ' energy/turn']; }
  },
  [CONST.BUILDING.SUPPLY_DEPOT]: {
    name: 'Supply Depot',
    short: 'SUP',
    desc: 'Stockpiles credits for construction.',
    stats: function() { return ['+' + CONST.SUPPLY_DEPOT_CREDITS + ' credits/turn']; }
  },
  [CONST.BUILDING.RADAR_STATION]: {
    name: 'Radar Station',
    short: 'RDR',
    desc: 'Persistently reveals enemy territory within its scan radius.',
    stats: function() { return ['Scan radius: ' + CONST.RADAR_RANGE + ' cells']; }
  },
  [CONST.BUILDING.MISSILE_SILO]: {
    name: 'Missile Silo',
    short: 'SLO',
    desc: 'Launches ballistic missiles at enemy targets.',
    stats: function() { return ['Damage: ' + CONST.MISSILE_DAMAGE, 'AOE: ' + CONST.MISSILE_AOE_HALF_DAMAGE, 'Energy/fire: ' + CONST.ENERGY_FIRE_MISSILE]; }
  },
  [CONST.BUILDING.ANTI_MISSILE]: {
    name: 'Anti-Missile',
    short: 'AA',
    desc: 'Intercepts incoming missiles.',
    stats: function() { return ['Intercepts: ' + CONST.ANTI_MISSILE_SHOTS_PER_TURN + '/turn']; }
  },
  [CONST.BUILDING.ROBOT_HANGAR]: {
    name: 'Robot Hangar',
    short: 'HGR',
    desc: 'Deploys battle mechs that land on enemy territory.',
    stats: function() { return ['Robot HP: ' + CONST.ROBOT_HP, 'Melee dmg: ' + CONST.ROBOT_MELEE_DAMAGE, 'Energy/deploy: ' + CONST.ENERGY_DEPLOY_ROBOT]; }
  },
  [CONST.BUILDING.SHIELD_GENERATOR]: {
    name: 'Shield Generator',
    short: 'SHD',
    desc: 'Absorbs one missile hit per turn on adjacent cells.',
    stats: function() { return ['Absorbs: 1 hit/turn']; }
  },
  [CONST.BUILDING.GUN_POD]: {
    name: 'Gun Pod',
    short: 'GUN',
    desc: 'Anti-robot turret that auto-fires at enemies in range.',
    stats: function() { return ['Damage: ' + CONST.GUN_POD_DAMAGE, 'Range: ' + CONST.GUN_POD_RANGE + ' cells']; }
  },
  [CONST.BUILDING.COMMAND_CENTER]: {
    name: 'Command Center',
    short: 'HQ',
    desc: 'Your headquarters. If destroyed, you lose.',
    stats: function() { return ['HP: ' + CONST.HP.COMMAND_CENTER]; }
  }
};

// ── Action Factory ──
function createAction(type, side, params = {}) {
  return {
    id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    type,
    side,
    resolved: false,
    ...params
  };
}

// ── Robot Factory ──
function createRobot(side, originSegment, targetSegment) {
  return {
    id: `robot_${side}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    side,
    originSegment,
    targetSegment,
    currentSegment: targetSegment,
    hp: CONST.ROBOT_HP,
    maxHp: CONST.ROBOT_HP,
    state: 'launching',
    x: 0, y: 0, z: 0,
    attackTarget: null,
    landed: false,
    _mesh: null
  };
}

// ── Initial State Factory ──
function createInitialGameState(aiMode = CONST.AI_MODE_PATROL) {
  const segments = [];

  // Build grid of cells, flat-indexed
  for (let y = 0; y < CONST.GRID_H; y++) {
    for (let x = 0; x < CONST.GRID_W; x++) {
      segments.push(createCell(x, y));
    }
  }

  // Place Command Centers
  const playerCCIdx = xyToIndex(CONST.CC_PLAYER_X, CONST.CC_PLAYER_Y);
  const aiCCIdx = xyToIndex(CONST.CC_AI_X, CONST.CC_AI_Y);
  segments[playerCCIdx].building = createBuilding(CONST.BUILDING.COMMAND_CENTER, CONST.SIDE_PLAYER, playerCCIdx);
  segments[aiCCIdx].building = createBuilding(CONST.BUILDING.COMMAND_CENTER, CONST.SIDE_AI, aiCCIdx);

  return {
    turn: 1,
    phase: CONST.PHASE_MENU,
    aiMode,
    winner: null,

    // Energy — for firing missiles and deploying robots
    playerEnergy: CONST.STARTING_ENERGY,
    aiEnergy: CONST.STARTING_ENERGY,
    // Credits — for building construction
    playerCredits: CONST.STARTING_CREDITS,
    aiCredits: CONST.STARTING_CREDITS,
    // Incomes (computed each turn)
    playerEnergyIncome: CONST.BASE_ENERGY_PER_TURN,
    aiEnergyIncome: CONST.BASE_ENERGY_PER_TURN,
    playerCreditIncome: CONST.BASE_CREDITS_PER_TURN,
    aiCreditIncome: CONST.BASE_CREDITS_PER_TURN,

    segments,

    playerActions: [],
    aiActions: [],
    activeRobots: [],
    revealedEnemySegments: [],
    combatLog: [],
    turnLog: [],

    // Incoming missile warnings
    incomingWarnings: []
  };
}

// ── Resource Calculation ──
function calculateEnergyIncome(state, side) {
  let income = CONST.BASE_ENERGY_PER_TURN;
  for (let i = 0; i < state.segments.length; i++) {
    const seg = state.segments[i];
    if (seg.side !== side) continue;
    if (seg.building && seg.building.type === CONST.BUILDING.POWER_PLANT && seg.building.active) {
      income += CONST.POWER_PLANT_ENERGY;
    }
  }
  return income;
}

function calculateCreditIncome(state, side) {
  let income = CONST.BASE_CREDITS_PER_TURN;
  for (let i = 0; i < state.segments.length; i++) {
    const seg = state.segments[i];
    if (seg.side !== side) continue;
    if (seg.building && seg.building.type === CONST.BUILDING.SUPPLY_DEPOT && seg.building.active) {
      income += CONST.SUPPLY_DEPOT_CREDITS;
    }
  }
  return income;
}

// Legacy compat
function calculateIncome(state, side) {
  return calculateEnergyIncome(state, side);
}

// ── Segment Helpers ──
function getPlayerSegments(state) {
  return state.segments.filter(s => s.side === CONST.SIDE_PLAYER);
}

function getAISegments(state) {
  return state.segments.filter(s => s.side === CONST.SIDE_AI);
}

function getEmptySegments(state, side) {
  return state.segments.filter(s => s.side === side && !s.destroyed && !s.building);
}

function getBuildingsOfType(state, side, type) {
  const result = [];
  for (let i = 0; i < state.segments.length; i++) {
    const seg = state.segments[i];
    if (seg.side !== side) continue;
    const b = seg.building;
    if (b && b.type === type && b.active) result.push(b);
  }
  return result;
}

// ── 2D Distance between cells ──
function cellDistance(idxA, idxB) {
  const a = indexToXY(idxA);
  const b = indexToXY(idxB);
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Get 8-neighbor adjacent cell indices ──
function getAdjacentCells(index) {
  const { x, y } = indexToXY(index);
  const result = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= CONST.GRID_W || ny < 0 || ny >= CONST.GRID_H) continue;
      result.push(xyToIndex(nx, ny));
    }
  }
  return result;
}

// ── Cells within a radius (inclusive) ──
function getCellsInRadius(index, radius) {
  const { x, y } = indexToXY(index);
  const result = [];
  const r2 = radius * radius;
  const rCeil = Math.ceil(radius);
  for (let dy = -rCeil; dy <= rCeil; dy++) {
    for (let dx = -rCeil; dx <= rCeil; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= CONST.GRID_W || ny < 0 || ny >= CONST.GRID_H) continue;
      result.push(xyToIndex(nx, ny));
    }
  }
  return result;
}

// ── Compute revealed enemy segments from active radars ──
function computeRadarReveals(state, side) {
  const enemySide = side === CONST.SIDE_PLAYER ? CONST.SIDE_AI : CONST.SIDE_PLAYER;
  const revealed = new Set();
  const radars = getBuildingsOfType(state, side, CONST.BUILDING.RADAR_STATION);
  for (const radar of radars) {
    const cells = getCellsInRadius(radar.segmentIndex, CONST.RADAR_RANGE);
    for (const idx of cells) {
      const seg = state.segments[idx];
      if (seg && seg.side === enemySide) revealed.add(idx);
    }
  }
  return revealed;
}

// ── Serialization (strip mesh refs) ──
function serializeState(state) {
  return JSON.parse(JSON.stringify(state, (key, value) => {
    if (key.startsWith('_')) return undefined;
    return value;
  }));
}

// Legacy constant for backward compat (no longer per-side)
CONST.SEGMENTS_PER_SIDE = (CONST.GRID_W / 2) * CONST.GRID_H;
CONST.SEGMENT_WIDTH = CONST.CELL_SIZE;
CONST.COMMAND_CENTER_SEGMENT_PLAYER = xyToIndex(CONST.CC_PLAYER_X, CONST.CC_PLAYER_Y);
CONST.COMMAND_CENTER_SEGMENT_AI = xyToIndex(CONST.CC_AI_X, CONST.CC_AI_Y);

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONST, TOTAL_CELLS, TOTAL_SEGMENTS,
    xyToIndex, indexToXY, cellSide, cellDistance, getAdjacentCells, getCellsInRadius,
    createCell, createSegment, createBuilding, createAction, createRobot,
    createInitialGameState, calculateIncome, calculateEnergyIncome, calculateCreditIncome,
    getBuildingHP, getBuildingCost, computeRadarReveals,
    getPlayerSegments, getAISegments, getEmptySegments, getBuildingsOfType,
    serializeState, BUILDING_INFO_TABLE
  };
}
