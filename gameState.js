// ============================================================
// Robot Strategy Attack 2026 — GameState & Shared Constants
// ============================================================

const CONST = {
  // Terrain
  SEGMENTS_PER_SIDE: 14,
  SEGMENT_WIDTH: 50,
  MAP_WIDTH: 1600,
  MAP_HEIGHT: 600,

  // Energy
  STARTING_ENERGY: 4,
  POWER_PLANT_INCOME: 3,

  // Command Center
  COMMAND_CENTER_HP: 20,
  COMMAND_CENTER_SEGMENT_PLAYER: 0,   // leftmost segment
  COMMAND_CENTER_SEGMENT_AI: 27,      // rightmost segment (14+14-1)

  // Building costs
  COST: {
    POWER_PLANT:       2,
    RADAR_STATION:     2,
    MISSILE_SILO:      3,
    ANTI_MISSILE:      3,
    ROBOT_HANGAR:      4,
    SHIELD_GENERATOR:  3,
    COMMAND_CENTER:    0  // built-in
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
  MISSILE_AOE_RADIUS: 1,        // damages adjacent segments too (half dmg)
  MISSILE_AOE_HALF_DAMAGE: 4,
  ANTI_MISSILE_SHOTS_PER_TURN: 2,
  SHIELD_ABSORB_COUNT: 1,       // absorbs next impact on adjacent segments

  // Robot stats
  ROBOT_MELEE_DAMAGE: 10,
  ROBOT_HP: 5,

  // Radar
  RADAR_REVEAL_COUNT: 3,

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
    CRATER:       0x1A1000,
    PLAYER:       0xFFB000,
    AI_ENEMY:     0xFF3300,
    SHIELD:       0x00CCFF,
    EXPLOSION:    0xFF6600,
    GRID:         0x332200,
    HUD_BG:       'rgba(10, 10, 0, 0.85)',
    HUD_TEXT:     '#FFB000',
    HUD_DIM:      '#8B6914',
    HUD_DANGER:   '#FF3300',
    HUD_SHIELD:   '#00CCFF'
  }
};

// Total segments = SEGMENTS_PER_SIDE * 2
const TOTAL_SEGMENTS = CONST.SEGMENTS_PER_SIDE * 2;

// ── Segment Factory ──
function createSegment(index, side) {
  return {
    index,
    side,
    destroyed: false,       // cratered
    building: null,         // building object or null
    shielded: false,        // shield generator coverage
    revealed: false         // fog of war (for opponent view)
  };
}

// ── Building Factory ──
function createBuilding(type, side, segmentIndex) {
  return {
    id: `${side}_${type}_${segmentIndex}_${Date.now()}`,
    type,
    side,
    segmentIndex,
    hp: CONST.HP[type.toUpperCase()] || CONST.HP[
      Object.keys(CONST.BUILDING).find(k => CONST.BUILDING[k] === type)?.toUpperCase()
    ] || 6,
    maxHp: CONST.HP[type.toUpperCase()] || CONST.HP[
      Object.keys(CONST.BUILDING).find(k => CONST.BUILDING[k] === type)?.toUpperCase()
    ] || 6,
    active: true,
    turnsAlive: 0,
    // Anti-missile specific
    interceptsRemaining: type === CONST.BUILDING.ANTI_MISSILE ? CONST.ANTI_MISSILE_SHOTS_PER_TURN : 0,
    // Shield generator specific
    shieldActive: type === CONST.BUILDING.SHIELD_GENERATOR,
    // Robot hangar specific
    deployedThisTurn: false,
    // Mesh reference (set by renderer, not serialized)
    _mesh: null
  };
}

// ── Helper: get HP for building type ──
function getBuildingHP(type) {
  const keyMap = {
    [CONST.BUILDING.POWER_PLANT]:      'POWER_PLANT',
    [CONST.BUILDING.RADAR_STATION]:    'RADAR_STATION',
    [CONST.BUILDING.MISSILE_SILO]:     'MISSILE_SILO',
    [CONST.BUILDING.ANTI_MISSILE]:     'ANTI_MISSILE',
    [CONST.BUILDING.ROBOT_HANGAR]:     'ROBOT_HANGAR',
    [CONST.BUILDING.SHIELD_GENERATOR]: 'SHIELD_GENERATOR',
    [CONST.BUILDING.COMMAND_CENTER]:   'COMMAND_CENTER'
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
    state: 'launching',  // launching → flying → landing → attacking → destroyed
    x: 0, y: 0,         // world position (set by animation)
    attackTarget: null,
    _mesh: null
  };
}

// ── Full GameState Factory ──
function createInitialGameState(aiMode = CONST.AI_MODE_PATROL) {
  const segments = [];

  // Player segments (left side: indices 0..13)
  for (let i = 0; i < CONST.SEGMENTS_PER_SIDE; i++) {
    segments.push(createSegment(i, CONST.SIDE_PLAYER));
  }
  // AI segments (right side: indices 14..27)
  for (let i = 0; i < CONST.SEGMENTS_PER_SIDE; i++) {
    segments.push(createSegment(CONST.SEGMENTS_PER_SIDE + i, CONST.SIDE_AI));
  }

  // Place Command Centers
  const playerCC = createBuilding(CONST.BUILDING.COMMAND_CENTER, CONST.SIDE_PLAYER, 0);
  const aiCC = createBuilding(CONST.BUILDING.COMMAND_CENTER, CONST.SIDE_AI, TOTAL_SEGMENTS - 1);
  segments[0].building = playerCC;
  segments[TOTAL_SEGMENTS - 1].building = aiCC;

  return {
    turn: 1,
    phase: CONST.PHASE_MENU,
    aiMode,
    winner: null,

    // Energy
    playerEnergy: CONST.STARTING_ENERGY,
    aiEnergy: CONST.STARTING_ENERGY,
    playerIncome: CONST.STARTING_ENERGY,
    aiIncome: CONST.STARTING_ENERGY,

    // Terrain
    segments,

    // Action queues (populated during planning, consumed during combat)
    playerActions: [],
    aiActions: [],

    // Active robots on the field
    activeRobots: [],

    // Fog of war: which enemy segments are revealed to player
    revealedEnemySegments: [],  // array of segment indices

    // Combat log for the turn
    combatLog: [],

    // Turn history (for replay/log)
    turnLog: []
  };
}

// ── Energy Calculation ──
function calculateIncome(state, side) {
  let income = CONST.STARTING_ENERGY;
  const start = side === CONST.SIDE_PLAYER ? 0 : CONST.SEGMENTS_PER_SIDE;
  const end = start + CONST.SEGMENTS_PER_SIDE;

  for (let i = start; i < end; i++) {
    const seg = state.segments[i];
    if (seg.building && seg.building.type === CONST.BUILDING.POWER_PLANT && seg.building.active) {
      income += CONST.POWER_PLANT_INCOME;
    }
  }
  return income;
}

// ── Segment Helpers ──
function getPlayerSegments(state) {
  return state.segments.slice(0, CONST.SEGMENTS_PER_SIDE);
}

function getAISegments(state) {
  return state.segments.slice(CONST.SEGMENTS_PER_SIDE);
}

function getEmptySegments(state, side) {
  const segs = side === CONST.SIDE_PLAYER ? getPlayerSegments(state) : getAISegments(state);
  return segs.filter(s => !s.destroyed && !s.building);
}

function getBuildingsOfType(state, side, type) {
  const start = side === CONST.SIDE_PLAYER ? 0 : CONST.SEGMENTS_PER_SIDE;
  const end = start + CONST.SEGMENTS_PER_SIDE;
  const result = [];
  for (let i = start; i < end; i++) {
    const b = state.segments[i].building;
    if (b && b.type === type && b.active) result.push(b);
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

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONST, TOTAL_SEGMENTS,
    createSegment, createBuilding, createAction, createRobot,
    createInitialGameState, calculateIncome, getBuildingHP,
    getPlayerSegments, getAISegments, getEmptySegments, getBuildingsOfType,
    serializeState
  };
}
