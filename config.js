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
  START_BUILDINGS: [{ type: 'silo', dx: 2, dy: 0 }],   // relative to HQ, mirrored for the AI
  MAX_TURNS: 30,
  LAND_TARGET: 120,          // cells per island (each side's zone is 14x16 = 224 cells)

  // Economy
  START_CREDITS: 350,
  START_ENERGY: 10,
  BASE_CREDITS: 60,
  BASE_ENERGY: 5,
  ENERGY_CAP_BASE: 30,

  // Weapons
  MISSILE_ENERGY: 8,
  MISSILE_DAMAGE: 45,
  MISSILE_SPLASH: 15,
  DROP_ENERGY: 12,
  MAX_ROBOTS: 6,
  DROP_HQ_EXCLUSION: 2,      // no drops within this Chebyshev distance of the enemy HQ
  STRIKE_CHARGE: 4,          // turns a Strike Uplink needs to charge
  STRIKE_ENERGY: 15,
  STRIKE_DAMAGE: 80,
  STRIKE_SPLASH: 40,         // to every structure in the 3x3 around the target

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
    stats: () => ['+' + CONST.BASE_CREDITS + ' credits, +' + CONST.BASE_ENERGY + ' energy / turn', 'Point defense: 1 shot, radius 2, ' + Math.round(BUILDINGS.hq.hitChance * 100) + '% hit', 'Defense gun: 15 dmg to a mech within 2', 'No enemy drops within 2 cells'],
    range: 2, hitChance: 0.4,
    gun: { shots: 1, damage: 15, range: 2 }
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
    name: 'Radar', short: 'RDR', key: '3', cost: 90, hp: 30, range: 12,
    desc: 'Reveals enemy territory and detects incoming missiles in range. Comes online the turn after it is built.',
    stats: () => ['Scan radius 12', 'Shows incoming missile targets']
  },
  silo: {
    name: 'Missile Silo', short: 'SLO', key: '4', cost: 140, hp: 50, max: 5,
    desc: 'Fires 1 ballistic missile per turn. Missiles land at the START of next turn\'s combat.',
    stats: () => [CONST.MISSILE_DAMAGE + ' damage + ' + CONST.MISSILE_SPLASH + ' splash', CONST.MISSILE_ENERGY + ' energy per launch', 'Max 5 silos'],
    counter: 'Countered by AA Batteries and Shields'
  },
  aa: {
    name: 'AA Battery', short: 'AA', key: '5', cost: 110, hp: 45, range: 4, shots: 1, hitChance: 0.7,
    desc: 'Fires at 1 incoming missile per turn aimed within its range (70% hit). Batteries back each other up on a miss.',
    stats: () => ['1 shot / turn, 70% hit', 'Covers radius 4']
  },
  shield: {
    name: 'Shield Generator', short: 'SHD', key: '6', cost: 120, hp: 35, range: 1, pool: 50, regen: 20,
    desc: 'Projects a 3x3 energy dome that absorbs damage from missiles and robots.',
    stats: () => ['Absorbs 50 damage', 'Regenerates 20 / turn']
  },
  hangar: {
    name: 'Robot Hangar', short: 'HGR', key: '7', cost: 160, hp: 60,
    desc: 'Drops 1 battle mech per turn into enemy territory. Mechs walk to and smash enemy buildings.',
    stats: () => ['Mech: ' + CONST.ROBOT_HP + ' HP, ' + CONST.ROBOT_DAMAGE + ' dmg, moves 2', CONST.DROP_ENERGY + ' energy per drop', 'Drop pods cannot be intercepted', 'Drop on your own island to garrison it'],
    counter: 'Countered by Gun Pods'
  },
  gunpod: {
    name: 'Gun Pod', short: 'GUN', key: '8', cost: 90, hp: 50, range: 3, shots: 2, damage: 12,
    desc: 'Auto-turret that shreds enemy mechs in range.',
    stats: () => ['2 shots x 12 damage / turn', 'Range 3 (mechs only)']
  },
  decoy: {
    name: 'Decoy', short: 'DCY', key: '9', cost: 30, hp: 20,
    desc: 'Inflatable fake. The enemy sees it as a real high-value structure — it draws missiles and mechs away from your base.',
    stats: () => ['Disguised as a random silo, hangar, power plant, depot or AA', 'Exposed only when destroyed'],
    disguises: ['silo', 'hangar', 'power', 'depot', 'aa']
  },
  uplink: {
    name: 'Strike Uplink', short: 'UPL', key: '0', cost: 260, hp: 70, max: 1,
    desc: 'Orbital targeting array. Charges for ' + CONST.STRIKE_CHARGE + ' turns, then calls down a strike that AA cannot stop.',
    stats: () => ['Orbital strike: ' + CONST.STRIKE_DAMAGE + ' damage + ' + CONST.STRIKE_SPLASH + ' to the 3x3 area', 'Charges ' + CONST.STRIKE_CHARGE + ' turns, ' + CONST.STRIKE_ENERGY + ' energy to fire', 'Cannot be intercepted; Shields absorb it', 'Max 1'],
    counter: 'Strikes are always detected — spread out, shield and repair'
  }
};

const BUILD_ORDER = ['depot', 'power', 'radar', 'silo', 'aa', 'shield', 'hangar', 'gunpod', 'decoy', 'uplink'];

// One upgrade level per structure (Metal Marines style). Values replace the base stats.
const UPGRADES = {
  silo:   { name: 'Heavy Warheads',  desc: 'Missiles deal 60 damage + 20 splash', dmg: 60, splash: 20 },
  aa:     { name: 'Fire Control',    desc: '85% hit chance, radius 5', hitChance: 0.85, range: 5 },
  depot:  { name: 'Logistics Hub',   desc: '+50 credits per turn', credits: 50 },
  power:  { name: 'Fusion Core',     desc: '+11 energy per turn, +20 capacity', energy: 11, cap: 20 },
  gunpod: { name: 'Rotary Cannons',  desc: '3 shots per turn', shots: 3 },
  shield: { name: 'Hardened Field',  desc: 'Dome absorbs 90, regenerates 35', pool: 90, regen: 35 },
  hangar: { name: 'Heavy Mechs',     desc: 'Mechs get 75 HP and hit for 30', mechHp: 75, mechDmg: 30 },
  radar:  { name: 'Phased Array',    desc: 'Scan radius 15', range: 15 }
};
// Skirmish / two-player battle options: [value, label] choices and the default value
const SKIRMISH_OPTIONS = {
  land:    { label: 'Islands',       choices: [[95, 'Small'], [120, 'Normal'], [150, 'Large']], def: 120 },
  credits: { label: 'Start credits', choices: [[250, 'Lean'], [350, 'Standard'], [600, 'Rich']], def: 350 },
  turns:   { label: 'Turn limit',    choices: [[20, '20'], [30, '30'], [45, '45']], def: 30 },
  uplink:  { label: 'Superweapon',   choices: [[1, 'On'], [0, 'Off']], def: 1 }
};

const UPGRADE_COST = 0.75;    // fraction of the structure's price
const UPGRADE_HP = 1.5;       // max HP multiplier

// ── Campaign ────────────────────────────────────────────────
// Positions in `start` are relative to that side's HQ (dx points toward the enemy).
const COMMANDERS = {
  hale:  { name: 'Gen. Hale',      title: 'Your commanding officer', look: { color: '#2ec4ff', visor: '#bff3ff', gear: 'beret' } },
  rusk:  { name: 'Cmdr. Rusk',     title: 'Coastal garrison',        look: { color: '#ff7a3d', visor: '#ffd2a8', gear: 'none' } },
  vey:   { name: 'Capt. Vey',      title: 'Reef fortress warden',    look: { color: '#ffb000', visor: '#fff0b0', gear: 'patch' } },
  kord:  { name: 'Marshal Kord',   title: 'Strait fleet command',    look: { color: '#ff4422', visor: '#ffb3a3', gear: 'antenna' } },
  nyx:   { name: 'Overseer NYX',   title: 'Autonomous war AI',       look: { color: '#c04dff', visor: '#f0c2ff', gear: 'crown' } },
  sol:   { name: 'Director Sol',   title: 'Orbital network command', look: { color: '#ff3d7f', visor: '#ffc2d6', gear: 'antenna' } }
};

const CAMPAIGN = [
  {
    id: 1, name: 'Operation Sandbar', enemy: 'rusk', difficulty: 'patrol', mapSeed: 1101, land: 140, par: 12, locked: ['uplink'],
    brief: 'Rusk holds a lightly defended sand island across the strait. Build an economy, get missiles in the air and knock out his Command Center.',
    taunt: 'A rookie? I will have you swimming home by sundown.',
    win: 'Clean work. Rusk is out of the fight — but word of you will travel.',
    start: { player: [], ai: [] }
  },
  {
    id: 2, name: 'Coral Gate', enemy: 'vey', difficulty: 'patrol', mapSeed: 2207, land: 125, par: 18, locked: ['uplink'],
    brief: 'Vey has dug in behind AA batteries and a gun pod. Saturate her air defense — fire several missiles in the same turn — or slip mechs past it.',
    taunt: 'My batteries have never let a missile through. Try your luck.',
    win: 'Her defenses cracked. Remember: volume beats precision against AA.',
    start: { player: [], ai: [{ type: 'aa', dx: 2, dy: -2 }, { type: 'aa', dx: 2, dy: 2 }, { type: 'gunpod', dx: 3, dy: 0 }] }
  },
  {
    id: 3, name: 'Iron Strait', enemy: 'kord', difficulty: 'commander', mapSeed: 3313, land: 120, par: 17, locked: ['uplink'],
    brief: 'Marshal Kord reads the battlefield and adapts. Scout with Radar, use Decoys to waste his salvos, and strike what he cannot cover.',
    taunt: 'I have studied your every move, Commander. You are predictable.',
    win: 'Kord underestimated you. The strait is ours.',
    credits: { player: 450 },
    start: { player: [{ type: 'depot', dx: 1, dy: -2 }], ai: [{ type: 'depot', dx: 2, dy: 2 }, { type: 'radar', dx: 4, dy: 0 }] }
  },
  {
    id: 4, name: 'Fortress Isle', enemy: 'vey', difficulty: 'commander', mapSeed: 4421, land: 110, par: 18, locked: ['uplink'],
    brief: 'Vey is back with a fortress: shields, layered AA and gun pods around her HQ. Starve her economy first, then break the walls.',
    taunt: 'Coral Gate was a lesson. This time I built walls.',
    win: 'The fortress fell. Only one enemy remains.',
    credits: { player: 660 },
    start: { player: [{ type: 'power', dx: 1, dy: 2 }, { type: 'depot', dx: 1, dy: -2 }], ai: [{ type: 'shield', dx: 1, dy: 1 }, { type: 'aa', dx: 2, dy: -2 }, { type: 'aa', dx: 3, dy: 2 }, { type: 'gunpod', dx: 2, dy: 0 }, { type: 'depot', dx: 4, dy: -1 }] }
  },
  {
    id: 5, name: 'Black Tide', enemy: 'nyx', difficulty: 'warlord', mapSeed: 5531, land: 110, par: 17, locked: ['uplink'],
    brief: 'NYX sees everything and out-produces us. There is no trick left — only everything you have learned. End this.',
    taunt: 'PROBABILITY OF YOUR SURVIVAL: 3.1%. PROCEEDING.',
    win: 'NYX is silent. Outstanding — but its orbital codes are already being sold.',
    credits: { player: 580 },
    start: { player: [{ type: 'depot', dx: 1, dy: -2 }, { type: 'aa', dx: 1, dy: 2 }, { type: 'power', dx: 2, dy: 2 }], ai: [{ type: 'aa', dx: 2, dy: 1 }, { type: 'decoy', dx: 5, dy: -3 }, { type: 'decoy', dx: 5, dy: 3 }] }
  },
  {
    id: 6, name: 'Skyfall', enemy: 'kord', difficulty: 'commander', mapSeed: 6637, land: 115, par: 22,
    brief: 'Kord bought NYX\'s orbital codes. His Strike Uplink is already charging, and no AA can stop what it calls down. Spread out, shield the HQ, and get our own Uplink online.',
    taunt: 'Look up, Commander. The sky belongs to me now.',
    win: 'Kord\'s uplink is scrap. But those codes came from somewhere higher up.',
    credits: { player: 480 },
    start: { player: [{ type: 'uplink', dx: -1, dy: 3, charge: 1 }], ai: [{ type: 'uplink', dx: -1, dy: -3, charge: 2 }, { type: 'depot', dx: 2, dy: 2 }, { type: 'radar', dx: 4, dy: 0 }] }
  },
  {
    id: 7, name: 'Zero Hour', enemy: 'sol', difficulty: 'warlord', mapSeed: 7741, land: 110, par: 20,
    brief: 'Director Sol runs the orbital network itself: strikes early and often, shields that go up the moment you fire, eyes on everything. Our Uplink is half charged. Make the first strike count.',
    taunt: 'I have watched your little war from above. It ends today.',
    win: 'The network is down and the skies are clear. Now the war is over, Commander.',
    credits: { player: 840 },
    start: { player: [{ type: 'uplink', dx: -1, dy: 3, charge: 2 }, { type: 'shield', dx: 1, dy: 0 }, { type: 'depot', dx: 1, dy: -2 }], ai: [{ type: 'uplink', dx: -1, dy: -3, charge: 1 }, { type: 'shield', dx: 1, dy: 1 }, { type: 'aa', dx: 2, dy: -2 }, { type: 'decoy', dx: 5, dy: 0 }] }
  }
];


if (typeof module !== 'undefined') module.exports = { CONST, BUILDINGS, BUILD_ORDER, UPGRADES, UPGRADE_COST, UPGRADE_HP, COMMANDERS, CAMPAIGN, SKIRMISH_OPTIONS };
