// ============================================================
// Robot Attack 2026 — Configuration & data tables
// ============================================================
// Pure data. No DOM / Three.js. Loaded first.

const CONST = {
  GRID_W: 32,
  GRID_H: 16,
  CELL: 12,                 // world units per cell

  PLAYER_MAX_X: 13,         // player owns columns 0..13
  AI_MIN_X: 18,             // AI owns columns 18..31; 14..17 is no-man's land
  HQ_PLAYER: { x: 2, y: 8 },
  HQ_AI: { x: 29, y: 8 },

  BUILD_RADIUS: 3,          // Chebyshev distance from an existing own building
  MAX_TURNS: 30,

  // Economy
  START_CREDITS: 350,
  START_ENERGY: 10,
  BASE_CREDITS: 60,
  BASE_ENERGY: 5,
  ENERGY_CAP_BASE: 30,

  // Weapons
  MISSILE_ENERGY: 8,
  MISSILE_DAMAGE: 35,
  MISSILE_SPLASH: 12,
  DROP_ENERGY: 12,
  MAX_ROBOTS: 6,

  // Robots
  ROBOT_HP: 50,
  ROBOT_DAMAGE: 20,
  ROBOT_MOVE: 2,
  ROBOT_HQ_PREFERENCE: 5,

  // Repair / sell
  REPAIR_COST_PER_HP: 1,
  REPAIR_MAX_PER_TURN: 30,
  SELL_REFUND: 0.5,

  CRATER_TURNS: 2,
  IMPACT_REVEAL_RADIUS: 1,
  INCOMING_HQ_RADIUS: 3,

  SIDE_PLAYER: 'player',
  SIDE_AI: 'ai',

  DIFFICULTY: {
    patrol:    { name: 'Patrol',    desc: 'Relaxed opponent. Fixed build order, sloppy targeting.', incomeMul: 0.8, fullVision: false, repairs: false, smart: false, fireChance: 0.6 },
    commander: { name: 'Commander', desc: 'Adaptive opponent. Saturates your AA, counters your army.', incomeMul: 1.0, fullVision: false, repairs: true, smart: true, fireChance: 1 },
    warlord:   { name: 'Warlord',   desc: 'Full map vision and +25% income. Brutal.', incomeMul: 1.25, fullVision: true, repairs: true, smart: true, fireChance: 1 }
  },

  COLORS: {
    PLAYER: 0x2EC4FF,
    AI: 0xFF4422,
    SHIELD: 0x9D7CFF,
    CREDITS: '#66FF99',
    ENERGY: '#FFD23F'
  }
};

// Building table — single source of truth for costs, HP and descriptions.
const BUILDINGS = {
  hq: {
    name: 'Command Center', short: 'HQ', key: null, cost: 0, hp: 200,
    desc: 'Your headquarters. Lose it and you lose the war. Provides income and 1 point-defense intercept.',
    stats: () => ['+' + CONST.BASE_CREDITS + ' credits, +' + CONST.BASE_ENERGY + ' energy / turn', 'Point defense: 1 intercept, radius 2'],
    range: 2
  },
  depot: {
    name: 'Supply Depot', short: 'DEP', key: '1', cost: 100, hp: 40, credits: 30,
    desc: 'Generates credits for construction and repairs.',
    stats: () => ['+30 credits / turn', 'Pays for itself in 4 turns'],
    counter: 'Vulnerable: high-value economic target'
  },
  power: {
    name: 'Power Plant', short: 'PWR', key: '2', cost: 80, hp: 40, energy: 6, cap: 10,
    desc: 'Generates energy to fire missiles and launch robots.',
    stats: () => ['+6 energy / turn', '+10 energy capacity']
  },
  radar: {
    name: 'Radar', short: 'RDR', key: '3', cost: 90, hp: 30, range: 5,
    desc: 'Reveals enemy territory and detects incoming missiles in range.',
    stats: () => ['Scan radius 5', 'Shows incoming missile targets']
  },
  silo: {
    name: 'Missile Silo', short: 'SLO', key: '4', cost: 140, hp: 50, max: 5,
    desc: 'Fires 1 ballistic missile per turn. Missiles land at the START of next turn\'s combat.',
    stats: () => [CONST.MISSILE_DAMAGE + ' damage + ' + CONST.MISSILE_SPLASH + ' splash', CONST.MISSILE_ENERGY + ' energy per launch', 'Max 5 silos'],
    counter: 'Countered by AA Batteries and Shields'
  },
  aa: {
    name: 'AA Battery', short: 'AA', key: '5', cost: 110, hp: 45, range: 4, shots: 1,
    desc: 'Automatically shoots down 1 incoming missile per turn aimed within its range.',
    stats: () => ['1 intercept / turn', 'Covers radius 4']
  },
  shield: {
    name: 'Shield Generator', short: 'SHD', key: '6', cost: 120, hp: 35, range: 1, pool: 50, regen: 20,
    desc: 'Projects a 3x3 energy dome that absorbs damage from missiles and robots.',
    stats: () => ['Absorbs 50 damage', 'Regenerates 20 / turn']
  },
  hangar: {
    name: 'Robot Hangar', short: 'HGR', key: '7', cost: 160, hp: 60,
    desc: 'Drops 1 battle mech per turn into enemy territory. Mechs walk to and smash enemy buildings.',
    stats: () => ['Mech: ' + CONST.ROBOT_HP + ' HP, ' + CONST.ROBOT_DAMAGE + ' dmg, moves 2', CONST.DROP_ENERGY + ' energy per drop', 'Drop pods cannot be intercepted'],
    counter: 'Countered by Gun Pods'
  },
  gunpod: {
    name: 'Gun Pod', short: 'GUN', key: '8', cost: 90, hp: 50, range: 3, shots: 2, damage: 12,
    desc: 'Auto-turret that shreds enemy mechs in range.',
    stats: () => ['2 shots x 12 damage / turn', 'Range 3 (mechs only)']
  }
};

const BUILD_ORDER = ['depot', 'power', 'radar', 'silo', 'aa', 'shield', 'hangar', 'gunpod'];

if (typeof module !== 'undefined') module.exports = { CONST, BUILDINGS, BUILD_ORDER };
