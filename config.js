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
  IMPACT_REVEAL_RADIUS: 2,
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

// Real-time mode: resources flow every second, attacks launch whenever
// launchers are ready, and the defender sees them coming. Per-turn values in CONST/BUILDINGS
// (income, shield regen, uplink charge) are paid out smoothly over one ROUND.
const RT = {
  TICK: 0.1,              // simulation step, seconds
  ROUND: 15,              // seconds over which one turn's income, regen and repair allowance arrive
  CLOCK_PER_TURN: 30,     // the turn-limit option becomes a clock: 30 turns = 15 minutes
  SILO_RELOAD: 16,        // seconds before a silo can fire again
  HANGAR_RELOAD: 20,      // seconds to ready a new mech after the last one came home or died
  MISSILE_FLIGHT: 8,      // launch to impact, plus a little per cell travelled
  SALVO_GAP: 0.4,         // missiles in one attack leave one after another
  SHIP_DELAY: 1.0,        // the dropship follows the last missile
  SHIP_FLIGHT: 10,
  SHIP_HULL: 3,           // AA hits to bring a dropship down, +1 per extra mech aboard
  MECHS_PER_SHIP: 3,
  MECH_TIME: 30,          // seconds a landed mech fights before its dropship collects it
  MECH_ZONE: 2,           // mechs fight inside the 5x5 around where they landed
  MECH_STEP: 1.6,         // seconds between a mech's moves or blows
  MECH_DAMAGE_MUL: 0.5,   // per blow, versus a turn-based blow
  ENGAGE_FROM: 0.5,       // AA can shoot at a missile in the second half of its flight
  SHOT_TIME: 0.7,         // interceptor flight
  AA_RELOAD: 3.5,
  HQ_PD_RELOAD: 6,
  GUN_RELOAD: 2,
  HQ_GUN_RELOAD: 3,
  REVEAL_TIME: 30,        // an impact or a firing battery stays revealed this long
  STRIKE_FLIGHT: 11,      // a long, loud warning: time to raise a shield or repair
  STRIKE_CHARGE_TIME: 90, // seconds for an uplink to charge
  STRIKE_SPLASH_MUL: 0.85,// so a full-health 40 HP depot or power plant survives the splash
  AI_THINK: 1.5,          // seconds between AI decisions (Patrol: double)
  AI_ATTACK_GAP: { patrol: [25, 45], commander: [14, 26], warlord: [12, 22] },  // random wait between AI waves
  OPENING_GRACE: { patrol: 45, commander: 25, warlord: 20 },  // no AI attack before this
  START_LOAD: 24,         // the starting silo is ready this many seconds in
  RADAR_BOOT: 5,          // seconds before a new radar comes online (after construction)
  // Construction: a new structure does nothing until it is built.
  // Each factory (an Assembly Line counts twice) adds FACTORY_BUILD_BOOST to construction
  // speed and FACTORY_RELOAD_BOOST to silo reloading and mech production.
  BUILD_TIME: { depot: 8, power: 8, radar: 8, silo: 14, aa: 9, shield: 12, hangar: 16, gunpod: 7, decoy: 3, uplink: 24, factory: 12 },
  FACTORY_BUILD_BOOST: 0.5,
  FACTORY_RELOAD_BOOST: 0.15,
  REFUND_WINDOW: 5,       // a structure sold this soon after building refunds in full
  REPAIR_PER_ROUND: 15,   // HP a structure can be repaired per ROUND (turn-based: 30 per turn)
  // Real-time rules
  BASES_PER_SIDE: 2,      // extra Bases besides the Command Center; all must fall to lose
  HQ_HP: 150,             // the Command Center is one base among several here (turn-based: 200)
  RADAR_AA_BOOST: 0.15,   // AA batteries within an online radar's range hit more often
  AA_MAX_CHANCE: 0.95,
  DEFENDERS: 3,           // ready mechs that scramble from their hangars when raiders land
  DEFENDER_STEP: 1.0,     // defenders hurry: seconds per move or blow
  DEFENDER_TIME: 60,
  MAX_MISSILES_PER_ATTACK: 4
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
    name: 'Supply Depot', short: 'DEP', key: '1', cost: 100, hp: 40, credits: 30, costStep: 25,   // each depot you own adds costStep to the next
    desc: 'Generates credits for construction and repairs.',
    stats: () => ['+30 credits / turn', 'Each depot you own makes the next cost ' + BUILDINGS.depot.costStep + ' more'],
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
    name: 'AA Battery', short: 'AA', key: '5', cost: 110, hp: 45, range: 4, shots: 1, hitChance: 0.7, rtCostStep: 20,   // real time: each AA you own makes the next 20 dearer
    desc: 'Fires at 1 incoming missile per turn aimed within its range (70% hit). Batteries back each other up on a miss.',
    stats: () => ['1 shot / turn, 70% hit', 'Covers radius 4']
  },
  shield: {
    name: 'Shield Generator', short: 'SHD', key: '6', cost: 120, hp: 50, range: 1, pool: 50, regen: 20,
    desc: 'Projects a 3x3 energy dome that absorbs missile and orbital-strike damage. Mechs that walk inside the dome hit at full force.',
    stats: () => ['Absorbs 50 damage', 'Regenerates 20 / turn']
  },
  hangar: {
    name: 'Robot Hangar', short: 'HGR', key: '7', cost: 160, hp: 60,
    desc: 'Drops 1 battle mech per turn into enemy territory. Mechs walk to and smash enemy buildings.',
    stats: () => ['Mech: ' + CONST.ROBOT_HP + ' HP, ' + CONST.ROBOT_DAMAGE + ' dmg, moves 2', CONST.DROP_ENERGY + ' energy per drop', 'Drop pods cannot be intercepted', 'Drop on your own island to garrison it'],
    counter: 'Countered by Sentry Turrets'
  },
  gunpod: {
    name: 'Sentry Turret', short: 'GUN', key: '8', cost: 90, hp: 50, range: 3, shots: 2, damage: 12,
    desc: 'Auto-turret that shreds enemy mechs in range.',
    stats: () => ['2 shots x 12 damage / turn', 'Range 3 (mechs only)']
  },
  decoy: {
    name: 'Decoy', short: 'DCY', key: '9', cost: 30, hp: 20,
    desc: 'Inflatable fake. The enemy sees it as a real high-value structure — it draws missiles and mechs away from your base.',
    stats: () => ['Disguised as a random silo, hangar, power plant, depot or AA', 'Exposed only when destroyed'],
    disguises: ['silo', 'hangar', 'power', 'depot', 'aa']
  },
  // Hidden in a separate list (state.mines), never a structure: the enemy can't see, target or
  // count them. A mine blows up under the first enemy mech that steps on it.
  mine: {
    name: 'Minefield', short: 'MIN', key: 'N', cost: 40, hp: 0, max: 6, mine: true, damage: 40,
    desc: 'Buried charges the enemy cannot see. Blows up under the first enemy mech that walks onto it.',
    stats: () => ['40 damage to the mech that trips it', 'Invisible to the enemy · max 6', 'A missile or strike landing on or beside it sets it off harmlessly'],
  },
  uplink: {
    name: 'Strike Uplink', short: 'UPL', key: '0', cost: 200, hp: 70, max: 1,
    desc: 'Orbital targeting array. Charges for ' + CONST.STRIKE_CHARGE + ' turns, then calls down a strike that AA cannot stop.',
    stats: () => ['Orbital strike: ' + CONST.STRIKE_DAMAGE + ' damage + ' + CONST.STRIKE_SPLASH + ' to the 3x3 area', 'Charges ' + CONST.STRIKE_CHARGE + ' turns, ' + CONST.STRIKE_ENERGY + ' energy to fire', 'Cannot be intercepted; Shields absorb it', 'Max 1'],
    counter: 'Strikes are always detected — spread out, shield and repair'
  },
  // Real-time battles: each side has extra Bases besides its Command Center. Destroy every
  // enemy base (the Command Center included) to win. Bases can't be built.
  base: {
    name: 'Base', short: 'BSE', key: null, cost: 0, hp: 120, rtOnly: true,
    desc: 'One of your bases. Lose all of them, Command Center included, and you lose the war.',
    stats: () => ['Win: destroy every enemy base', 'Can\'t be built — protect the ones you have']
  },
  // Real-time battles only: construction takes time there, and factories speed it up
  factory: {
    name: 'Factory', short: 'FAC', key: 'B', cost: 150, hp: 50, max: 3, rtOnly: true,
    desc: 'Speeds up construction, missile reloads and mech production. Real-time battles only.',
    stats: () => ['Each factory: builds ' + Math.round(RT.FACTORY_BUILD_BOOST * 100) + '% faster, reloads ' + Math.round(RT.FACTORY_RELOAD_BOOST * 100) + '% faster', 'Max 3']
  }
};

const BUILD_ORDER = ['depot', 'power', 'radar', 'silo', 'aa', 'shield', 'hangar', 'gunpod', 'decoy', 'mine', 'uplink', 'factory'];

// One upgrade level per structure. Values replace the base stats.
const UPGRADES = {
  silo:   { name: 'Heavy Warheads',  desc: 'Missiles deal 60 damage + 20 splash', dmg: 60, splash: 20 },
  aa:     { name: 'Fire Control',    desc: '85% hit chance, radius 5', hitChance: 0.85, range: 5 },
  depot:  { name: 'Logistics Hub',   desc: '+50 credits per turn', credits: 50 },
  power:  { name: 'Fusion Core',     desc: '+11 energy per turn, +20 capacity', energy: 11, cap: 20 },
  gunpod: { name: 'Rotary Cannons',  desc: '3 shots per turn', shots: 3 },
  shield: { name: 'Hardened Field',  desc: 'Dome absorbs 90, regenerates 35', pool: 90, regen: 35 },
  hangar: { name: 'Heavy Mechs',     desc: 'Mechs get 75 HP and hit for 30', mechHp: 75, mechDmg: 30 },
  radar:  { name: 'Phased Array',    desc: 'Scan radius 15', range: 15 },
  factory: { name: 'Assembly Line',  desc: 'Counts as two factories', factories: 2 }
};
// Skirmish / two-player battle options: [value, label] choices and the default value
const SKIRMISH_OPTIONS = {
  land:    { label: 'Islands',       choices: [[95, 'Small'], [120, 'Normal'], [150, 'Large']], def: 120 },
  credits: { label: 'Start credits', choices: [[250, 'Lean'], [350, 'Standard'], [600, 'Rich']], def: 350 },
  turns:   { label: 'Turn limit',    choices: [[20, '20'], [30, '30'], [45, '45']], def: 30 },
  uplink:  { label: 'Superweapon',   choices: [[1, 'On'], [0, 'Off']], def: 1 },
  pace:    { label: 'Pace',          choices: [[1, 'Real-time'], [0, 'Turns']], def: 1, solo: true },
  style:   { label: 'Opponent',      choices: [[0, 'Balanced'], [1, 'Blitz'], [2, 'Fortress'], [3, 'Raider']], def: 0, solo: true }
};
// Opponent personalities for the 'style' option (index = option value); the AI reads the key
const AI_STYLE_INFO = [
  { key: 'balanced', name: 'Balanced', desc: 'Economy first, then missiles, mechs and the superweapon.' },
  { key: 'blitz',    name: 'Blitz',    desc: 'Masses silos and heavy warheads to break you early. Get AA up fast.' },
  { key: 'fortress', name: 'Fortress', desc: 'Turtles behind AA and shields, then calls down orbital strikes. Scout and out-build it.' },
  { key: 'raider',   name: 'Raider',   desc: 'Swarms your economy with heavy mechs. Sentry Turrets and garrison mechs hold the line.' }
];

// Daily Operation: one seeded battle per calendar day, with one twist from this list
const DAILY_TWISTS = [
  { id: 'large',   name: 'Large islands',     opts: { land: 150 } },
  { id: 'small',   name: 'Cramped islands',   opts: { land: 95 } },
  { id: 'rich',    name: 'War chest',         opts: { credits: 600 } },
  { id: 'lean',    name: 'Lean supply',       opts: { credits: 250 } },
  { id: 'blitz',   name: 'Blitz (20 turns)',  opts: { turns: 20 } },
  { id: 'noorbit', name: 'No superweapons',   opts: { uplink: 0 } }
];

// Achievements: checked by main.js against game stats; ids are stored in the browser
const ACHIEVEMENTS = [
  { id: 'first_blood', name: 'First Blood',      desc: 'Destroy an enemy structure' },
  { id: 'iron_dome',   name: 'Iron Dome',        desc: 'Shoot down 10 missiles in one battle' },
  { id: 'fooled',      name: 'Fooled You',       desc: 'Have a decoy soak up an enemy attack' },
  { id: 'orbital',     name: 'Fire From Above',  desc: 'Land an orbital strike' },
  { id: 'garrison',    name: 'Home Guard',       desc: 'Destroy an invading mech with a garrison mech or Sentry Turret' },
  { id: 'untouched',   name: 'Untouchable',      desc: 'Win with your Command Center at full health' },
  { id: 'blitz',       name: 'Blitzkrieg',       desc: 'Win by turn 10 (in real time: within 3:20)' },
  { id: 'tycoon',      name: 'Tycoon',           desc: 'Own 5 Supply Depots at once' },
  { id: 'tripwire',    name: 'Tripwire',         desc: 'Destroy 3 enemy mechs with minefields in one battle' },
  { id: 'warlord',     name: 'Warlord Slayer',   desc: 'Beat the Warlord in a skirmish' },
  { id: 'campaign',    name: 'Victory in the Pacific', desc: 'Complete the campaign' },
  { id: 'all_medals',  name: 'Decorated',        desc: 'Earn all 21 campaign medals' },
  { id: 'daily',       name: 'Daily Duty',       desc: 'Win a Daily Operation' }
];

const UPGRADE_COST = 0.75;    // fraction of the structure's price
const UPGRADE_HP = 1.5;       // max HP multiplier

// ── Campaign ────────────────────────────────────────────────
// Positions in `start` are relative to that side's HQ (dx points toward the enemy).
const COMMANDERS = {
  hale:  { name: 'Gen. Hale',      title: 'Your commanding officer', look: { color: '#2ec4ff', visor: '#bff3ff', gear: 'beret' } },
  rusk:  { name: 'Cmdr. Rusk',     title: 'Coastal garrison',        look: { color: '#ff7a3d', visor: '#ffd2a8', gear: 'none' },
    lines: { lost: ['Lucky shot. You won\'t get another.', 'Hold the beach! Nobody falls back!'], won: ['One down. Start swimming, rookie.', 'That\'s my sandbar you\'re shelling.'] } },
  vey:   { name: 'Capt. Vey',      title: 'Reef fortress warden',    look: { color: '#ffb000', visor: '#fff0b0', gear: 'patch' },
    lines: { lost: ['A crack in the wall. Seal it.', 'You\'ll pay for every stone of that.'], won: ['Walls win wars, Commander.', 'Did you think I only defend?'] } },
  kord:  { name: 'Marshal Kord',   title: 'Strait fleet command',    look: { color: '#ff4422', visor: '#ffb3a3', gear: 'antenna' },
    lines: { lost: ['Noted. Adjusting the plan.', 'An acceptable loss. Recalculating.'], won: ['Predictable.', 'I read you three moves ago.'] } },
  nyx:   { name: 'Overseer NYX',   title: 'Autonomous war AI',       look: { color: '#c04dff', visor: '#f0c2ff', gear: 'crown' },
    lines: { lost: ['NODE LOST. REROUTING.', 'ANOMALY LOGGED. ESCALATING RESPONSE.'], won: ['TARGET NEUTRALIZED.', 'SURVIVAL PROBABILITY: DECREASING.'] } },
  sol:   { name: 'Director Sol',   title: 'Orbital network command', look: { color: '#ff3d7f', visor: '#ffc2d6', gear: 'antenna' },
    lines: { lost: ['You scratched the ground. I own the sky.', 'Insignificant. Charge the array.'], won: ['From orbit, everything is a target.', 'The network sees every one of you.'] } }
};

const CAMPAIGN = [
  {
    id: 1, name: 'Operation Sandbar', enemy: 'rusk', difficulty: 'patrol', mapSeed: 1101, land: 140, par: 12, locked: ['uplink'],
    brief: 'Rusk holds a lightly defended sand island across the strait. Build an economy, get missiles in the air and knock out all three of his bases. Start with the outer ones: they have little AA cover.',
    taunt: 'A rookie? I will have you swimming home by sundown.',
    win: 'Clean work. Rusk is out of the fight — but word of you will travel.',
    start: { player: [], ai: [] }
  },
  {
    id: 2, name: 'Coral Gate', enemy: 'vey', difficulty: 'patrol', mapSeed: 2207, land: 125, par: 18, locked: ['uplink'],
    brief: 'Vey has dug in behind AA batteries and a sentry turret. Saturate her air defense — send several missiles in one attack — or slip mechs past it.',
    taunt: 'My batteries have never let a missile through. Try your luck.',
    win: 'Her defenses cracked. Remember: volume beats precision against AA.',
    start: { player: [], ai: [{ type: 'aa', dx: 2, dy: -2 }, { type: 'aa', dx: 2, dy: 2 }, { type: 'gunpod', dx: 3, dy: 0 }] }
  },
  {
    id: 3, name: 'Iron Strait', enemy: 'kord', difficulty: 'commander', mapSeed: 3313, land: 120, par: 19, locked: ['uplink'],
    rtBonus: 250,   // real time: extra starting credits for the player (tuned in simulation)
    brief: 'Marshal Kord reads the battlefield and adapts. Scout with Radar, use Decoys to waste his salvos, and strike what he cannot cover.',
    taunt: 'I have studied your every move, Commander. You are predictable.',
    win: 'Kord underestimated you. The strait is ours.',
    credits: { player: 450 },
    start: { player: [{ type: 'depot', dx: 1, dy: -2 }], ai: [{ type: 'depot', dx: 2, dy: 2 }, { type: 'radar', dx: 4, dy: 0 }] }
  },
  {
    id: 4, name: 'Fortress Isle', enemy: 'vey', difficulty: 'commander', mapSeed: 4421, land: 110, par: 17, locked: ['uplink'],
    brief: 'Vey is back with a fortress: shields, layered AA and sentry turrets around her HQ. Starve her economy first, then break the walls.',
    taunt: 'Coral Gate was a lesson. This time I built walls.',
    win: 'The fortress fell. Only one enemy remains.',
    credits: { player: 600 },
    start: { player: [{ type: 'power', dx: 1, dy: 2 }, { type: 'depot', dx: 1, dy: -2 }], ai: [{ type: 'shield', dx: 1, dy: 1 }, { type: 'aa', dx: 2, dy: -2 }, { type: 'aa', dx: 3, dy: 2 }, { type: 'gunpod', dx: 2, dy: 0 }, { type: 'depot', dx: 4, dy: -1 }] }
  },
  {
    id: 5, name: 'Black Tide', enemy: 'nyx', difficulty: 'warlord', mapSeed: 5531, land: 110, par: 16, locked: ['uplink'],
    rtBonus: 250,   // real time: extra starting credits for the player (tuned in simulation)
    brief: 'NYX sees everything and out-produces us. There is no trick left — only everything you have learned. End this.',
    taunt: 'PROBABILITY OF YOUR SURVIVAL: 3.1%. PROCEEDING.',
    win: 'NYX is silent. Outstanding — but its orbital codes are already being sold.',
    credits: { player: 550 },
    start: { player: [{ type: 'depot', dx: 1, dy: -2 }, { type: 'aa', dx: 1, dy: 2 }, { type: 'power', dx: 2, dy: 2 }], ai: [{ type: 'aa', dx: 2, dy: 1 }, { type: 'decoy', dx: 5, dy: -3 }, { type: 'decoy', dx: 5, dy: 3 }] }
  },
  {
    id: 6, name: 'Skyfall', enemy: 'kord', difficulty: 'commander', mapSeed: 6637, land: 115, par: 26,
    brief: 'Kord bought NYX\'s orbital codes. His Strike Uplink is already charging, and no AA can stop what it calls down. Spread out, shield the HQ, and get our own Uplink online.',
    taunt: 'Look up, Commander. The sky belongs to me now.',
    win: 'Kord\'s uplink is scrap. But those codes came from somewhere higher up.',
    credits: { player: 480 },
    start: { player: [{ type: 'uplink', dx: -1, dy: 3, charge: 1 }], ai: [{ type: 'uplink', dx: -1, dy: -3, charge: 2 }, { type: 'depot', dx: 2, dy: 2 }, { type: 'radar', dx: 4, dy: 0 }] }
  },
  {
    id: 7, name: 'Zero Hour', enemy: 'sol', difficulty: 'warlord', mapSeed: 7741, land: 110, par: 16,
    brief: 'Director Sol runs the orbital network itself: strikes early and often, shields that go up the moment you fire, eyes on everything. Our Uplink is half charged. Make the first strike count.',
    taunt: 'I have watched your little war from above. It ends today.',
    win: 'The network is down and the skies are clear. Now the war is over, Commander.',
    credits: { player: 740 },
    start: { player: [{ type: 'uplink', dx: -1, dy: 3, charge: 2 }, { type: 'shield', dx: 1, dy: 0 }, { type: 'depot', dx: 1, dy: -2 }], ai: [{ type: 'uplink', dx: -1, dy: -3, charge: 1 }, { type: 'shield', dx: 1, dy: 1 }, { type: 'aa', dx: 2, dy: -2 }, { type: 'decoy', dx: 5, dy: 0 }] }
  }
];


if (typeof module !== 'undefined') module.exports = { CONST, BUILDINGS, BUILD_ORDER, UPGRADES, UPGRADE_COST, UPGRADE_HP, COMMANDERS, CAMPAIGN, RT, SKIRMISH_OPTIONS, AI_STYLE_INFO, DAILY_TWISTS, ACHIEVEMENTS };
