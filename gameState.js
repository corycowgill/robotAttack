// ============================================================
// Robot Strategy Attack 2026 — GameState & Shared Constants
// 2D GRID VERSION: 40 x 24 cells (960 total)
// ============================================================

const CONST = {
  // Grid dimensions (2D)
  GRID_W: 40,
  GRID_H: 24,
  CELL_SIZE: 12,       // world units per cell

  // Energy
  STARTING_ENERGY: 4,
  POWER_PLANT_INCOME: 3,

  // Command Center positions (x, y)
  CC_PLAYER_X: 2,
  CC_PLAYER_Y: 12,
  CC_AI_X: 37,
  CC_AI_Y: 12,
  COMMAND_CENTER_HP: 20,

  // Building costs
  COST: {
    POWER_PLANT:       2,
    RADAR_STATION:     2,
    MISSILE_SILO:      3,
    ANTI_MISSILE:      3,
    ROBOT_HANGAR:      4,
    SHIELD_GENERATOR:  3,
    COMMAND_CENTER:    0
  },

  // Building HP
  HP: {
    POWER_PLANT:       6,
    RADAR_STATION:     4,
    MISSILE_SILO:      8,
    ANTI_MISSILE:      6,
    ROBOT_HANGAR:     10,
    SHIELD_GENERATOR:  5,
    COMMAND_CENTER:   20
  },

  // Weapon stats
  MISSILE_DAMAGE: 8,
  MISSILE_AOE_RADIUS: 1,        // 2D radius (8-neighbors)
  MISSILE_AOE_HALF_DAMAGE: 4,
  ANTI_MISSILE_SHOTS_PER_TURN: 2,
  SHIELD_ABSORB_COUNT: 1,

  // Robot stats
  ROBOT_MELEE_DAMAGE: 10,
  ROBOT_HP: 5,

  // Radar
  RADAR_REVEAL_COUNT: 6,

  // Combat phase
  COMBAT_DURATION_MS: 8000,

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
    HUD_BG:       'rgba(10, 10, 0, 0.85)',
    HUD_TEXT:     '#FFB000',
    HUD_DIM:      '#8B6914',
    HUD_DANGER:   '#FF3300',
    HUD_SHIELD:   '#00CCFF'
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

// ── Building Factory ──
function createBuilding(type, side, segmentIndex) {
  const keyMap = {
    [CONST.BUILDING.POWER_PLANT]:      'POWER_PLANT',
    [CONST.BUILDING.RADAR_STATION]:    'RADAR_STATION',
    [CONST.BUILDING.MISSILE_SILO]:     'MISSILE_SILO',
    [CONST.BUILDING.ANTI_MISSILE]:     'ANTI_MISSILE',
    [CONST.BUILDING.ROBOT_HANGAR]:     'ROBOT_HANGAR',
    [CONST.BUILDING.SHIELD_GENERATOR]: 'SHIELD_GENERATOR',
    [CONST.BUILDING.COMMAND_CENTER]:   'COMMAND_CENTER'
  };
  const hpKey = keyMap[type] || 'POWER_PLANT';
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
  const keyMap = {
    [CONST.BUILDING.POWER_PLANT]: 'POWER_PLANT',
    [CONST.BUILDING.RADAR_STATION]: 'RADAR_STATION',
    [CONST.BUILDING.MISSILE_SILO]: 'MISSILE_SILO',
    [CONST.BUILDING.ANTI_MISSILE]: 'ANTI_MISSILE',
    [CONST.BUILDING.ROBOT_HANGAR]: 'ROBOT_HANGAR',
    [CONST.BUILDING.SHIELD_GENERATOR]: 'SHIELD_GENERATOR',
    [CONST.BUILDING.COMMAND_CENTER]: 'COMMAND_CENTER'
  };
  return CONST.HP[keyMap[type]] || 6;
}

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
    hp: CONST.ROBOT_HP,
    state: 'launching',
    x: 0, y: 0, z: 0,
    attackTarget: null,
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

    playerEnergy: CONST.STARTING_ENERGY,
    aiEnergy: CONST.STARTING_ENERGY,
    playerIncome: CONST.STARTING_ENERGY,
    aiIncome: CONST.STARTING_ENERGY,

    segments,  // still called "segments" for backward compat, but it's a 2D grid

    playerActions: [],
    aiActions: [],
    activeRobots: [],
    revealedEnemySegments: [],
    combatLog: [],
    turnLog: []
  };
}

// ── Energy Calculation ──
function calculateIncome(state, side) {
  let income = CONST.STARTING_ENERGY;
  for (let i = 0; i < state.segments.length; i++) {
    const seg = state.segments[i];
    if (seg.side !== side) continue;
    if (seg.building && seg.building.type === CONST.BUILDING.POWER_PLANT && seg.building.active) {
      income += CONST.POWER_PLANT_INCOME;
    }
  }
  return income;
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

// ── Serialization (strip mesh refs) ──
function serializeState(state) {
  return JSON.parse(JSON.stringify(state, (key, value) => {
    if (key.startsWith('_')) return undefined;
    return value;
  }));
}

// Legacy constant for backward compat (no longer per-side)
CONST.SEGMENTS_PER_SIDE = (CONST.GRID_W / 2) * CONST.GRID_H;  // player/AI cell count
CONST.SEGMENT_WIDTH = CONST.CELL_SIZE;
CONST.COMMAND_CENTER_SEGMENT_PLAYER = xyToIndex(CONST.CC_PLAYER_X, CONST.CC_PLAYER_Y);
CONST.COMMAND_CENTER_SEGMENT_AI = xyToIndex(CONST.CC_AI_X, CONST.CC_AI_Y);

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONST, TOTAL_CELLS, TOTAL_SEGMENTS,
    xyToIndex, indexToXY, cellSide, cellDistance, getAdjacentCells,
    createCell, createSegment, createBuilding, createAction, createRobot,
    createInitialGameState, calculateIncome, getBuildingHP,
    getPlayerSegments, getAISegments, getEmptySegments, getBuildingsOfType,
    serializeState
  };
}
