# Robot Attack 2026

*Inspired by classic 1990s island-war strategy games. Robot Attack 2026 is an original work and is not affiliated with, endorsed by, or connected to any other game, developer or publisher; all trademarks belong to their respective owners.*

A base-building artillery strategy game in the browser, played in real time or turn by turn, rendered with Three.js (r128), with a generated orchestral/synth score and sound effects (and a procedural Web Audio fallback).

Build an economy, raise missile silos and mech hangars, and destroy the enemy Command Center before it destroys yours.

## Running

**Play online:** https://corycowgill.github.io/robotAttack/ (CI deploys `main` to GitHub Pages after the tests pass).

The game is static files with no build step.
- **Local:** open `index.html` in a modern browser, or serve the folder (`python3 -m http.server`) and browse to it.
- **Hosting:** put the folder on any static host.

Three.js r128 is bundled in `vendor/` (MIT licence), so only the web fonts come from a CDN, and the game falls back to system fonts without them. When the game is served over HTTPS, a service worker (`sw.js`) caches it on the first visit, and after that it plays offline, including from the home screen. It fetches its own files network-first, so updates show up as soon as you're online.

**iPhone / phones:**
- Landscape is best. In portrait the game asks you to rotate, but you can play anyway: the view turns a quarter so the islands stack, yours at the bottom and the enemy's on top.
- On small screens the interface switches to a compact layout: a slimmer HUD, a scrollable build bar, and the battle log behind a button.
- Tap to select. Placing a building or picking a missile or drop target takes two taps: one to preview, one to confirm.
- Drag to pan, pinch to zoom.
- In Safari, **Share → Add to Home Screen** runs the game fullscreen with its own icon.

## Real-time battles

The campaign is always played in real time, and skirmishes play in real time by default:
- **Destroy every enemy base.** Each side has its Command Center (150 HP in real time) and 2 more Bases (120 HP), spread across its island. Bases are always marked on the map, like the Command Center, but decoys often pose as one (a Dummy Base). You win when all the enemy's bases are gone, and lose when all of yours are. Bases can't be built or repaired.
- **Resources flow every second.** One turn's income arrives over 15 seconds. You can build, repair, upgrade and sell at any moment, and so can the enemy.
- **Construction takes time.** A new structure is a building site, shown at part height with a cyan progress bar. It produces, shoots and shields nothing until it's finished. Build times run from 3 seconds (decoy) to 24 seconds (uplink); a depot takes 8 and a silo 14. **Factories** (`B`, 150 credits, max 3, real-time only) speed everything up:
  - each factory makes construction 50% faster and silo reloads and mech production 15% faster;
  - an upgraded factory (Assembly Line) counts as two.

  The AI builds its first factory early in its opening and a second one about 2½ minutes in.
- **Attacks launch whenever you're ready.** There is no End Turn: silos reload in 16 seconds and hangars build a new mech in 20. The starting silo finishes loading 24 seconds in, and the AI holds its first wave for 25 seconds (Patrol 45, Warlord 20), so each battle opens with a short calm to build in.
  - To attack, press `Q` (missiles), `E` (mechs) or `R` (orbital strike). **Time stops while you plan**. The Fire Missile button pulses when a loaded silo has sat idle for 12 seconds, or when your energy is full.
  - Each click on the map gives the next loaded missile its own target, up to 4 missiles per attack. With `E`, the click picks where the mechs land: the 5×5 box they will fight in, outlined on the map. With `R`, it picks the strike's target. `Q`/`E`/`R` switch what the next click aims.
  - The attack panel lists every silo and hangar with its status (ready, reloading, or its target). Click a chip to add or free a silo, mech or the strike. It shows the energy cost and, for each target, how many missiles should get past the defences you know about. `Enter` or **Launch** sends it all; `Esc` cancels.
  - Missiles leave one after another. The dropship carrying the mechs follows them.
- **Every launch is announced.** The moment an enemy missile or dropship lifts off:
  - an alarm sounds;
  - it appears in the **In the air** list with a countdown (about 8–10 seconds), one row per wave;
  - it becomes visible in flight once it is over the sea.

  Radar, or being near your HQ, shows what it's aimed at; otherwise the target is unknown. You have that long to repair, raise a shield, build AA or hit back.
- **AA reloads between shots.** A battery fires at missiles in the second half of their flight, then reloads for 3.5 seconds (HQ point defence: 6 seconds). Hit chances are the same as in turn-based games, but an **online Radar guides the batteries in its range**: +15% to hit.
  - A salvo with more missiles than the defence has shots gets through. The attack panel estimates how many will land against the defences you know about.
  - So that walls of AA don't stall the late game, each AA Battery you own makes the next one 20 credits dearer.
  - A battery destroyed while its interceptor is in the air loses guidance.
- **Dropships can be shot down.** One ship carries up to 3 mechs and takes 3 AA hits to destroy, plus 1 per extra mech. If it goes down, its mechs are lost and their hangars start building new ones.
- **Mechs raid a zone and leave.** Landed mechs fight inside their 5×5 landing box for 30 seconds, then their dropship takes them home. They leave early if the box is clear. They fight mechs that close in first, then a base if one is within 2 cells, then sentry turrets, then the nearest building.
- **Mechs defend at home.** When enemy mechs land on your island, up to 3 ready mechs scramble from their hangars for free and hunt them down. They return when the raiders are gone. Enemy raids are outlined on the map, and every raid gets a row in the list with its time left. The hangar has a new mech ready 20 seconds after it returns or dies.
- **Intel:** an impact, or an AA battery or gun that fires, stays revealed for 30 seconds. A new radar comes online 5 seconds after it is built.
- **Orbital strikes** charge for 90 seconds and land 11 seconds after launch: a long, loud warning. Splash is 34, so a full-health depot or power plant survives it.
- **Repairs** restore up to 15 HP per structure every 15 seconds; bases and the Command Center can't be repaired. A structure sold within 5 seconds of building refunds in full.
- **The clock:** the turn-limit option becomes a battle clock (30 turns = 15 minutes). When time runs out, the side with more of its bases' health left wins.
- **Pause:** `Space` pauses, and the game also pauses when you switch tabs. While paused you can look around and inspect, but building and attacking wait until you resume.
- **Saving:** the battle autosaves every 15 seconds, and **Continue** resumes it, missiles in flight included.

The AI plays with the same rules. It builds with the turn-based planners and attacks in waves when its silos are loaded, choosing targets (bases rank just below the Command Center) with the turn-based target pickers. A wave can be missiles plus a dropship aimed nearby. In AI-vs-AI simulations about two thirds of Commander mirrors end with one side's bases all destroyed, in a median of about 11 minutes; the rest are decided on the clock.

Two Players and the Daily Operation stay turn-based. To play a skirmish turn by turn, choose **Pace: Turns** in the battle options.

In the campaign, a mission's par medal is a clock time: its par in turns × 30 seconds (for example, mission 1 is 6:00). Missions 3 and 5 give you 250 extra starting credits in real time. In simulations (a Commander-level player) the win rates run about 100, 100, 73, 57, 45, 47 and 53% for missions 1–7. Mission 1's briefing checklist teaches the real-time controls.

## How a turn works

Each side starts on its own island with a Command Center and one Missile Silo. Island shapes are generated fresh every game (the two islands always have the same area); the strait between them is open sea.


1. **Plan.**
   - Spend **credits** on structures and repairs, and **energy** on missiles and mech drops.
   - You can only build on your side (the blue zone) within 3 cells of one of your existing structures.
   - Missile and drop orders can be cancelled for a full refund until you end the turn. `Z` undoes your last action.
   - If a silo, hangar or uplink is destroyed before its order goes off, the order is cancelled and its energy refunded.
2. **Resolve.** Both sides' orders play out at once, in this order:
   1. Missiles launched *last* turn come down. AA Batteries and your HQ's point defense shoot at them; shots can miss, and a missed missile is engaged by the next battery in range.
   2. Missiles hit. Shields absorb damage first; each missile does 45 damage to its target and 15 to adjacent cells.
   3. Sentry Turrets fire at mechs.
   4. Mechs move (2 cells) or smash an adjacent structure, Shields or not. Mechs raid: they chew through whatever structures are nearest, so they attack your economy and defences rather than the well-guarded HQ. Raiders fight enemy mechs when no structure is in reach. **Garrison** mechs, dropped on your own island, hunt down invaders.
   5. Drop pods land. New mechs wait one turn before they act.
   6. New missiles launch. They are in the air until next turn.
3. **React.**
   - During planning, arrows show where every mech you can see will walk next turn. A bracket marks the structure or mech it will attack: solid if the attack happens this turn, faint if it's still walking there. Hovering a mech says the same in words. Build a Sentry Turret or drop a garrison mech in its way.
   - Enemy missiles are in flight for a full turn.
   - **Red reticles** mark incoming missiles your Radar (or the area around your HQ) has detected. Build AA or shields, or repair, before they land.

**Winning:** destroy the enemy Command Center. If both HQs fall in the same turn it's a draw. After 30 turns, the side whose HQ has more HP left (as a percentage) wins. If that's a tie, the side with more invested in surviving structures (including upgrades) wins.

**Fog of war:** enemy territory is hidden except around your Radar, your mechs and recent missile impacts (each impact reveals the 5×5 area around it for your next planning phase). Enemy structures you have seen stay on the map as "last known" outlines. The enemy HQ is always visible. An AA Battery that fires at a missile gives its position away: the attacker sees it during the next planning phase. This works both ways, so a salvo can follow up on a battery that revealed itself.

**Reading the battle:**
- The battle log names who shot each missile down, with its hit chance (for example "AA Battery at I27 (70%)" or "HQ point defence (40%)").
- Impact lines come before the losses they caused, and say how much damage shields absorbed.
- While aiming, the tooltip lists the known defences covering the target and the chance that one missile gets through.
- While placing a structure, the tooltip previews what it does from that cell: how many enemy cells a Radar reveals, or which of your structures an AA Battery or Shield covers.
- The turn report shows what you have seen of the enemy base, and the log notes enemy builds and upgrades you can see.
- A defeat screen ends with a one-line debrief on the biggest thing that went wrong.

## Structures

| Key | Structure | Cost | HP | Effect |
|---|---|---|---|---|
| — | Command Center | — | 200 | +60 credits and +5 energy per turn; 1 point-defense shot (40% hit) within radius 2; close-defense gun (15 damage to a mech within 2); no enemy drops within 2 cells |
| 1 | Supply Depot | 100 (+25 per depot you own) | 40 | +30 credits per turn |
| 2 | Power Plant | 80 | 40 | +6 energy per turn, +10 energy capacity (base capacity 30) |
| 3 | Radar | 90 | 30 | Reveals enemy cells and detects incoming missiles within radius 12; comes online the turn after it is built |
| 4 | Missile Silo | 140 | 50 | 1 missile per turn (8 energy); 45 damage + 15 splash; maximum 5 |
| 5 | AA Battery | 110 | 45 | 1 shot per turn (70% hit) at a missile aimed within radius 4; if it misses, other batteries in range get a shot |
| 6 | Shield Generator | 120 | 50 | 50-point dome over a 3×3 area that absorbs missiles and strikes (not mech melee); regenerates 20 per turn |
| 7 | Robot Hangar | 160 | 60 | Drops 1 mech per turn (12 energy). Mechs have 50 HP, deal 20 melee damage and move 2 cells. Drop pods can't be intercepted. Maximum 6 mechs. |
| 8 | Sentry Turret | 90 | 50 | 2 shots × 12 damage per turn against mechs within range 3 |
| 9 | Decoy | 30 | 20 | Inflatable fake: the enemy sees a random silo, hangar, power plant, depot or AA (with matching HP). It draws missiles and mechs and is exposed only when destroyed. |
| N | Minefield | 40 | — | Buried charges, maximum 6. Never a structure: the enemy can't see, target or count them. The first enemy mech to step on one takes 40 damage (it stops there), and the mine is used up. Your own mechs walk over them. A missile or strike landing on or next to a mine sets it off harmlessly, so shelling a landing zone first clears it. The AI starts laying mines once it has seen your hangars or your mechs, favours the spots where your raids have landed, and steers its own raids away from places its mechs hit mines. |
| 0 | Strike Uplink | 200 | 70 | Superweapon, maximum 1. Charges for 4 turns, then `R` calls down an orbital strike (15 energy): 80 damage to the target and 40 to every structure around it. AA can't intercept it, but Shields absorb it, and the target always sees it coming. Not available in missions 1–5. |
- **Repair:** 1 credit per HP, up to 30 HP per structure per turn.
- **Sell:** refunds 50% of the cost, scaled by remaining HP (repairs made this turn don't count). Selling a structure in the turn you built it refunds it in full. Selling can be undone with `Z` within the same turn.
- **Craters:** a destroyed structure leaves a crater that blocks building for 2 turns.

## Upgrades

Select one of your structures and press `U` to upgrade it once. An upgrade costs 75% of the structure's price (rounded to the nearest 10 credits), adds 50% HP and can be undone in the same turn. Upgraded structures are drawn slightly larger, with a gold frame.

| Structure | Upgrade | Effect |
|---|---|---|
| Missile Silo | Heavy Warheads | 60 damage + 20 splash |
| AA Battery | Fire Control | 85% hit chance, radius 5 |
| Supply Depot | Logistics Hub | +50 credits/turn |
| Power Plant | Fusion Core | +11 energy/turn, +20 capacity |
| Sentry Turret | Rotary Cannons | 3 shots/turn |
| Shield Generator | Hardened Field | Absorbs 90, regenerates 35 |
| Robot Hangar | Heavy Mechs | Mechs get 75 HP and hit for 30 |
| Radar | Phased Array | Scan radius 15 |

## Campaign

Seven real-time missions, each on a fixed island map against a named enemy commander. Each one opens with a briefing from your CO, Gen. Hale. Clearing a mission unlocks the next, and progress is saved in the browser.

| # | Mission | Opponent | Twist |
|---|---|---|---|
| 1 | Operation Sandbar | Cmdr. Rusk (Patrol) | Tutorial checklist; a big, open island |
| 2 | Coral Gate | Capt. Vey (Patrol) | Enemy starts behind two AA Batteries and a Sentry Turret |
| 3 | Iron Strait | Marshal Kord (Commander) | Adaptive AI with an early Radar |
| 4 | Fortress Isle | Capt. Vey (Commander) | Shielded fortress HQ; you get extra starting credits |
| 5 | Black Tide | Overseer NYX (Warlord) | Full-vision AI with decoys |
| 6 | Skyfall | Marshal Kord (Commander) | Kord's Strike Uplink is already half charged; you get one of your own |
| 7 | Zero Hour | Director Sol (Warlord) | Orbital duel: both Uplinks start charged, against a full-vision AI behind shields and AA |

**Medals:** each mission awards up to three stars:
- one for winning;
- one for winning within the mission's par time (6:00, 9:00, 9:30, 8:30, 8:00, 13:00 and 8:00);
- one for finishing with your HQ at 50% health or more.

Your best medals show on the mission cards and in the briefing. Replay a mission to complete the set.

**Skirmish** plays a random island map against any of the three opponents. The options row above the opponent cards sets:
- island size: small (95 cells), normal (120) or large (150);
- starting credits: 250, 350 or 600;
- length: 20, 30 or 45 turns, which in real time is a 10, 15 or 22.5-minute clock;
- whether the Strike Uplink is allowed;
- the pace: **Real-time** (default; see above) or **Turns**;
- the opponent's style:
  - **Balanced:** the standard AI.
  - **Blitz:** masses silos and heavy warheads to break you early.
  - **Fortress:** turtles behind AA and shields, then uses the superweapon.
  - **Raider:** swarms your economy with heavy mechs.

  In simulations against the standard AI, each style wins about as often as Balanced does at the same difficulty.

The browser remembers your choices. The map options also apply to Two Players; the opponent style doesn't, since there is no AI.

**Daily Operation** is one seeded battle per day: the same map, the same twist (large islands, a war chest, a 20-turn blitz…) and the same opponent (Commander on weekdays, Warlord at weekends) for everyone.
- A win scores 1000, plus 30 for every turn under the limit, plus 5 for every % of HQ health left.
- A loss scores 10 for every % of the enemy HQ you destroyed.
- The browser keeps your best score for each day, and **Retry Daily** replays the same battle.

**Achievements:** twelve of them, from *First Blood* to *Decorated* (all 21 campaign medals). Find them under **Achievements** on the menu.

**Two players** is a pass-and-play mode on one device:
- Player 1 (blue, left) plans first.
- A full-screen hand-off screen hides the board while you pass the device. Then Player 2 (red, right) plans, seeing only their own island and their own battle log.
- After a second hand-off the battle plays out for Player 1, who plans next. Player 2 gets the same turn report from their side when their turn starts.
- Neither side gets an income bonus. The game autosaves at the start of each round.

## Opponents

- **Patrol:**
  - 80% income.
  - Fixed build order and loose targeting.
- **Commander:**
  - Adapts its builds: AA when you shell it, Sentry Turrets when your mechs land.
  - Opens with a Robot Hangar and raids your base with mechs on a second front while its missiles pressure your HQ.
  - Fires all its missiles at once to overwhelm your AA, picks off unprotected economy buildings, and repairs its HQ.
  - Builds a Strike Uplink from turn 10 where available and aims each strike at the 3×3 area that hurts you most.
  - When your strike is inbound, it raises a Shield over the target and repairs whatever wouldn't survive.
- **Warlord:**
  - Commander tactics plus full map vision and +25% income.
  - Repairs structures that your missiles are about to hit.

## Controls

| Input | Action |
| `1`–`9`, `0`, `N`, `B` | Select a structure to build: `N` minefield, `B` factory (real time). Shift+click places several |
| `1`–`9`, `0` | Select a structure to build (Shift+click places several) |
| Left click | Place / target / select |
| Right click, `Esc` | Cancel |
| `Q` / `E` / `R` | Fire missile / drop mech / orbital strike. Pressing the key again keeps aiming, so `Q` click `Q` click queues two missiles. |
| `T` / `U` / `X` | Repair / upgrade / sell the selected structure |
| `Z` | Undo |
| `Space` | End turn; during combat, skip the playback |
| `Tab` | Playback speed 1x / 2x / 3x |
| WASD / arrows, right-drag | Pan |
| Mouse wheel | Zoom |
| `H` / `F` | Camera to your HQ / whole map |
| `M` | Mute |
| `G` | Cycle graphics quality (auto-detected by default) |
| Gear button / menu **Settings** | Audio: master, music (on/off and volume), sound effects, interface and ambience volume; sound style (Studio or Retro synth); mute in background. Game: graphics quality (Auto / Low / Medium / High); combat playback speed; camera shake; mech arrows. Saved in the browser. |
| `?` | Help |
| Touch | Tap to select / place / target; drag one finger to pan, pinch to zoom |

## Code layout

All scripts are plain `<script>` modules loaded by `index.html`, in this order:

| File | Role |
|---|---|
| `config.js` | Constants and the structure table (costs, HP, descriptions); the single source of truth |
| `rules.js` | Pure game logic: state, validation, build/repair/sell, orders, vision, and the deterministic `resolveTurn()`, which returns an event list. No DOM, and it runs under Node. |
| `ai.js` | Opponent logic. It uses the same `Rules` functions, and therefore the same restrictions, as the player. `planTurn()` plays a turn; `thinkRealtime()` plays a real-time battle. |
| `realtime.js` | The real-time engine (`Realtime`): per-second economy, launcher reloads, attacks, flights, AA reloads and shots, dropships, mech zones and recall, timed reveals and the clock. `step(state, dt)` runs in fixed 0.1 s ticks and returns events. It is pure and deterministic, and runs under Node. |
| `audio.js` | Sound engine (`window.GameAudio`): plays the generated clips and music loops, with procedural Web Audio recipes as fallback; buses for music, effects, interface and ambience; ducking, volume and mute |
| `models.js` | Procedural Three.js models for structures, mechs, missiles, drop pods and ghosts |
| `fx.js` | Pooled GPU particles, flash lights, shockwaves, scorch decals, smoke and fire emitters |
| `renderer.js` | Scene, lighting, terrain, overlays (grid, build zone, fog shader), camera rig, picking, mesh registry |
| `ui.js` | DOM HUD, build bar, orders, selection panel, tooltips, report, menus, help |
| `main.js` | State machine, input, view synchronisation, and the combat playback timeline (`dt`-driven, skippable) |

### Generated audio

All music, ambience and sound effects in `assets/audio/` were generated locally with **Stable Audio 3 Small** (the `sfx` and `music` checkpoints) running in ComfyUI. `assets/audio/manifest.json` lists them; `audio.js` loads it at startup and falls back to its procedural recipes for anything missing. Opening `index.html` directly from disk (`file://`) always uses the procedural sounds, because browsers block `fetch` there. The **Retro** sound style in Settings also uses them.

| Music (looping) | Plays |
|---|---|
| `menu` | Title screen and menus |
| `planning` | Planning phase |
| `combat` | Combat playback |
| `climax` | Combat while either Command Center is below 40% |
| `planningTense` | Planning while your Command Center is below 50% |
| `debriefWin` / `debriefLoss` | The after-action screen, once the victory / defeat stinger has played |

Stingers: `titleSting` (press start), `combatStart` (each combat phase), `victory`, `defeat`, `achievement`. Ambience beds: `ocean` (all the time) and `battleAmb` (combat and the title flyover). Music dips briefly under big explosions, and drops away when a Command Center falls. Each track picks up where it left off, so the planning music carries on across turns instead of restarting after every combat. Sounds heard from the fog (enemy launches and drop pods you can't see, your own missiles coming down on the far island) play muffled and roomy.

Every gameplay event has its own sound: launches, the incoming whistle, flak, interceptions, impacts, sea splashes, shield hits, building collapses, decoys bursting, the Sentry Turret and HQ guns, mech footsteps, landings, punches, mech-on-mech melee and mech deaths, drop pods, the orbital strike (charge-up, descent, impact and a cue when your Uplink is ready), building, upgrading, repairs, selling, undo, order confirmations (missile lock, strike lock, drop armed, cancel), turn start, end turn, alarms, radio chatter from Gen. Hale, the two-player hand-off, and interface clicks.

`tools/gen_audio.py` regenerates them. It holds the prompt sheet, samples several takes per sound through a local ComfyUI server, ranks the takes with the CLAP audio-text model (`laion/larger_clap_general`), then trims, levels, finds a tempo-matched loop point for the music, crossfades it, encodes MP3s and writes the manifest. Music takes with almost nothing in the 300 Hz - 4 kHz range (a murmur on small speakers) are marked down. Sounds whose energy sits below 150 Hz (big blasts, the HQ gun) get added harmonics of their bass so they still come through on phone and laptop speakers, and each MP3 is decoded again to check its peak stays below -0.8 dB. Raw takes are cached in `.audio-work/` (git-ignored).

```bash
pip install numpy scipy soundfile torch transformers   # and ffmpeg on PATH
# ComfyUI with stable_audio_3_small_sfx/_music.safetensors and t5gemma_b_b_ul2.safetensors
python ComfyUI/main.py --port 8191
python tools/gen_audio.py --list                    # show the prompt sheet
python tools/gen_audio.py                           # everything
python tools/gen_audio.py --only explosion,combat --regen   # resample a few
python tools/gen_audio.py --only alarm --more 6         # add 6 fresh takes per variant, keep the cached ones
```

Stable Audio 3 is released under the Stability AI Community License; check it before shipping generated audio commercially.

## License and credits

The game's code is under the MIT License (`LICENSE`). three.js, the fonts and the generated audio are under their own terms, listed in `THIRD_PARTY_NOTICES.md`. The same credits are shown in the game's help screen.

## Testing

```bash
npm install
npm test              # rules unit tests + AI-vs-AI simulations (Node only, a few seconds)
npx playwright install chromium   # once, for the browser tests
npm run test:e2e      # headless-browser smoke tests of real UI flows
```

- `tests/rules.test.js`: island generation, build/upgrade/sell/undo, decoys, drops, missiles and AA, win conditions, determinism and save round trips.
- `tests/realtime.test.js`: the real-time engine. It covers income per second, attack validation and costs, launch warnings, AA reloads against salvos, dropships landing or being shot down, mech zones and recall, determinism and save round trips mid-flight, and AI-vs-AI real-time games at every difficulty.
- `tests/sim.test.js`: AI-vs-AI games at every difficulty and on every campaign map must finish within the rules; the Commander mirror must stay roughly balanced.
- `tests/e2e.test.js`: plays through a real-time battle (clock, building, the attack panel, inbound warnings, mechs, pause, Continue, game over), skirmish, the Drop button, a campaign victory, Continue after a reload, and the phone layout with tap-to-confirm, in Chromium with software WebGL. Everything is served locally, so the tests need no internet access.

GitHub Actions (`.github/workflows/ci.yml`) runs both suites on every push and pull request. On `main`, a passing run then publishes the game to GitHub Pages.

### Simulating games headlessly

`rules.js` and `ai.js` load under Node, so AI-vs-AI games can be simulated for balance testing:

```js
const { CONST, BUILDINGS } = require('./config.js');
Object.assign(global, { CONST, BUILDINGS });
global.Rules = require('./rules.js');
const AI = require('./ai.js');
const s = Rules.newGame('commander', 42);
while (!s.winner) { AI.planTurn(s, 'player'); AI.planTurn(s, 'ai'); Rules.resolveTurn(s); }
console.log(s.winner, s.turn);
```
