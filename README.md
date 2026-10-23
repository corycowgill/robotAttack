# Robot Attack 2026

A turn-based base-building artillery strategy game in the browser, rendered with Three.js (r128) and scored with procedural Web Audio.

Build an economy, raise missile silos and mech hangars, and destroy the enemy Command Center before it destroys yours.

## Running

The game is static files with no build step.
- **Local:** open `index.html` in a modern browser, or serve the folder (`python3 -m http.server`) and browse to it.
- **Hosting:** put the folder on any static host.

Three.js and the fonts load from CDNs, so the game needs an internet connection.

## How a turn works

Each side starts with a Command Center and one Missile Silo.


1. **Plan.**
   - Spend **credits** on structures and repairs, and **energy** on missiles and mech drops.
   - You can only build on your side (the blue zone) within 3 cells of one of your existing structures.
   - Missile and drop orders can be cancelled for a full refund until you end the turn. `Z` undoes your last action.
2. **Resolve.** Both sides' orders play out at once, in this order:
   1. Missiles launched *last* turn come down. AA Batteries and your HQ's point defense shoot at them; shots can miss, and a missed missile is engaged by the next battery in range.
   2. Missiles hit. Shields absorb damage first; each missile does 35 damage to its target and 12 to adjacent cells.
   3. Gun Pods fire at mechs.
   4. Mechs move (2 cells) or smash an adjacent structure.
   5. Drop pods land. New mechs wait one turn before they act.
   6. New missiles launch. They are in the air until next turn.
3. **React.**
   - Enemy missiles are in flight for a full turn.
   - **Red reticles** mark incoming missiles your Radar (or the area around your HQ) has detected. Build AA or shields, or repair, before they land.

**Winning:** destroy the enemy Command Center. If both HQs fall in the same turn it's a draw. After 30 turns, the side whose HQ has more HP left (as a percentage) wins.

**Fog of war:** enemy territory is hidden except around your Radar, your mechs and recent missile impacts. Enemy structures you have seen stay on the map as "last known" outlines. The enemy HQ is always visible.

## Structures

| Key | Structure | Cost | HP | Effect |
|---|---|---|---|---|
| — | Command Center | — | 200 | +60 credits and +5 energy per turn; 1 point-defense shot (40% hit) within radius 2 |
| 1 | Supply Depot | 100 | 40 | +30 credits per turn |
| 2 | Power Plant | 80 | 40 | +6 energy per turn, +10 energy capacity (base capacity 30) |
| 3 | Radar | 90 | 30 | Reveals enemy cells and detects incoming missiles within radius 9; comes online the turn after it is built |
| 4 | Missile Silo | 140 | 50 | 1 missile per turn (8 energy); 35 damage + 12 splash; maximum 5 |
| 5 | AA Battery | 110 | 45 | 1 shot per turn (70% hit) at a missile aimed within radius 4; if it misses, other batteries in range get a shot |
| 6 | Shield Generator | 120 | 35 | 50-point damage-absorbing dome over a 3×3 area; regenerates 20 per turn |
| 7 | Robot Hangar | 160 | 60 | Drops 1 mech per turn (12 energy). Mechs have 50 HP, deal 20 melee damage and move 2 cells. Drop pods can't be intercepted. Maximum 6 mechs. |
| 8 | Gun Pod | 90 | 50 | 2 shots × 12 damage per turn against mechs within range 3 |

- **Repair:** 1 credit per HP, up to 30 HP per structure per turn.
- **Sell:** refunds 50% of the cost, scaled by remaining HP (repairs made this turn don't count).
- **Craters:** a destroyed structure leaves a crater that blocks building for 2 turns.

## Opponents

- **Patrol:**
  - 80% income.
  - Fixed build order and loose targeting.
- **Commander:**
  - Adapts its builds: AA when you shell it, Gun Pods when your mechs land.
  - Fires all its missiles at once to overwhelm your AA, picks off unprotected economy buildings, and repairs its HQ.
- **Warlord:**
  - Commander tactics plus full map vision and +25% income.
  - Repairs structures that your missiles are about to hit.

## Controls

| Input | Action |
|---|---|
| `1`–`8` | Select a structure to build (Shift+click places several) |
| Left click | Place / target / select |
| Right click, `Esc` | Cancel |
| `Q` / `E` | Fire missile / drop mech |
| `T` / `X` | Repair / sell the selected structure |
| `Z` | Undo |
| `Space` | End turn; during combat, skip the playback |
| `Tab` | Playback speed 1x / 2x / 3x |
| WASD / arrows, right-drag | Pan |
| Mouse wheel | Zoom |
| `H` / `F` | Camera to your HQ / whole map |
| `M` | Mute |
| `G` | Cycle graphics quality (auto-detected by default) |
| `?` | Help |

## Code layout

All scripts are plain `<script>` modules loaded by `index.html`, in this order:

| File | Role |
|---|---|
| `config.js` | Constants and the structure table (costs, HP, descriptions); the single source of truth |
| `rules.js` | Pure game logic: state, validation, build/repair/sell, orders, vision, and the deterministic `resolveTurn()`, which returns an event list. No DOM, and it runs under Node. |
| `ai.js` | Opponent logic. It uses the same `Rules` functions, and therefore the same restrictions, as the player. |
| `audio.js` | Procedural Web Audio: sound-effect recipes, ambient and combat music, volume/mute (`window.GameAudio`) |
| `models.js` | Procedural Three.js models for structures, mechs, missiles, drop pods and ghosts |
| `fx.js` | Pooled GPU particles, flash lights, shockwaves, scorch decals, smoke and fire emitters |
| `renderer.js` | Scene, lighting, terrain, overlays (grid, build zone, fog shader), camera rig, picking, mesh registry |
| `ui.js` | DOM HUD, build bar, orders, selection panel, tooltips, report, menus, help |
| `main.js` | State machine, input, view synchronisation, and the combat playback timeline (`dt`-driven, skippable) |

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
