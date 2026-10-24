# Robot Attack 2026

*Inspired by Namco's Metal Marines (SNES).*

A turn-based base-building artillery strategy game in the browser, rendered with Three.js (r128) and scored with procedural Web Audio.

Build an economy, raise missile silos and mech hangars, and destroy the enemy Command Center before it destroys yours.

## Running

**Play online:** https://corycowgill.github.io/robotAttack/ (CI deploys `main` to GitHub Pages after the tests pass).

The game is static files with no build step.
- **Local:** open `index.html` in a modern browser, or serve the folder (`python3 -m http.server`) and browse to it.
- **Hosting:** put the folder on any static host.

Three.js r128 is bundled in `vendor/` (MIT licence), so only the web fonts come from a CDN, and the game falls back to system fonts without them. When the game is served over HTTPS, a service worker (`sw.js`) caches it on the first visit, and after that it plays offline, including from the home screen. It fetches its own files network-first, so updates show up as soon as you're online.

**iPhone / phones:**
- Landscape is best. In portrait the game asks you to rotate, but you can play anyway.
- On small screens the interface switches to a compact layout: a slimmer HUD, a scrollable build bar, and the battle log behind a button.
- Tap to select. Placing a building or picking a missile or drop target takes two taps: one to preview, one to confirm.
- Drag to pan, pinch to zoom.
- In Safari, **Share → Add to Home Screen** runs the game fullscreen with its own icon.

## How a turn works

Each side starts on its own island with a Command Center and one Missile Silo. Island shapes are generated fresh every game (the two islands always have the same area); the strait between them is open sea.


1. **Plan.**
   - Spend **credits** on structures and repairs, and **energy** on missiles and mech drops.
   - You can only build on your side (the blue zone) within 3 cells of one of your existing structures.
   - Missile and drop orders can be cancelled for a full refund until you end the turn. `Z` undoes your last action.
2. **Resolve.** Both sides' orders play out at once, in this order:
   1. Missiles launched *last* turn come down. AA Batteries and your HQ's point defense shoot at them; shots can miss, and a missed missile is engaged by the next battery in range.
   2. Missiles hit. Shields absorb damage first; each missile does 45 damage to its target and 15 to adjacent cells.
   3. Gun Pods fire at mechs.
   4. Mechs move (2 cells) or smash an adjacent structure. Raiders fight enemy mechs when no structure is in reach. **Garrison** mechs, dropped on your own island, hunt down invaders.
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
| — | Command Center | — | 200 | +60 credits and +5 energy per turn; 1 point-defense shot (40% hit) within radius 2; close-defense gun (15 damage to a mech within 2); no enemy drops within 2 cells |
| 1 | Supply Depot | 100 | 40 | +30 credits per turn |
| 2 | Power Plant | 80 | 40 | +6 energy per turn, +10 energy capacity (base capacity 30) |
| 3 | Radar | 90 | 30 | Reveals enemy cells and detects incoming missiles within radius 12; comes online the turn after it is built |
| 4 | Missile Silo | 140 | 50 | 1 missile per turn (8 energy); 45 damage + 15 splash; maximum 5 |
| 5 | AA Battery | 110 | 45 | 1 shot per turn (70% hit) at a missile aimed within radius 4; if it misses, other batteries in range get a shot |
| 6 | Shield Generator | 120 | 35 | 50-point damage-absorbing dome over a 3×3 area; regenerates 20 per turn |
| 7 | Robot Hangar | 160 | 60 | Drops 1 mech per turn (12 energy). Mechs have 50 HP, deal 20 melee damage and move 2 cells. Drop pods can't be intercepted. Maximum 6 mechs. |
| 8 | Gun Pod | 90 | 50 | 2 shots × 12 damage per turn against mechs within range 3 |
| 9 | Decoy | 30 | 20 | Inflatable fake: the enemy sees a random silo, hangar, power plant, depot or AA (with matching HP). It draws missiles and mechs and is exposed only when destroyed. |
- **Repair:** 1 credit per HP, up to 30 HP per structure per turn.
- **Sell:** refunds 50% of the cost, scaled by remaining HP (repairs made this turn don't count). Selling can be undone with `Z` within the same turn.
- **Craters:** a destroyed structure leaves a crater that blocks building for 2 turns.

## Upgrades

Select one of your structures and press `U` to upgrade it once. An upgrade costs 75% of the structure's price (rounded to the nearest 10 credits), adds 50% HP and can be undone in the same turn. Upgraded structures are drawn slightly larger, with a gold frame.

| Structure | Upgrade | Effect |
|---|---|---|
| Missile Silo | Heavy Warheads | 60 damage + 20 splash |
| AA Battery | Fire Control | 85% hit chance, radius 5 |
| Supply Depot | Logistics Hub | +50 credits/turn |
| Power Plant | Fusion Core | +11 energy/turn, +20 capacity |
| Gun Pod | Rotary Cannons | 3 shots/turn |
| Shield Generator | Hardened Field | Absorbs 90, regenerates 35 |
| Robot Hangar | Heavy Mechs | Mechs get 75 HP and hit for 30 |
| Radar | Phased Array | Scan radius 15 |

## Campaign

Five missions, each on a fixed island map against a named enemy commander. Each one opens with a briefing from your CO, Gen. Hale. Clearing a mission unlocks the next, and progress is saved in the browser.

| # | Mission | Opponent | Twist |
|---|---|---|---|
| 1 | Operation Sandbar | Cmdr. Rusk (Patrol) | Tutorial checklist; a big, open island |
| 2 | Coral Gate | Capt. Vey (Patrol) | Enemy starts behind two AA Batteries and a Gun Pod |
| 3 | Iron Strait | Marshal Kord (Commander) | Adaptive AI with an early Radar |
| 4 | Fortress Isle | Capt. Vey (Commander) | Shielded fortress HQ; you get extra starting credits |
| 5 | Black Tide | Overseer NYX (Warlord) | Full-vision AI with decoys |

**Medals:** each mission awards up to three stars:
- one for winning;
- one for winning within the mission's par turn count (12, 18, 14, 14 and 15 turns);
- one for finishing with your HQ above 50% health.

Your best medals show on the mission cards and in the briefing. Replay a mission to complete the set.

**Skirmish** plays a random island map against any of the three opponents.

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
| `1`–`9` | Select a structure to build (Shift+click places several) |
| Left click | Place / target / select |
| Right click, `Esc` | Cancel |
| `Q` / `E` | Fire missile / drop mech |
| `T` / `U` / `X` | Repair / upgrade / sell the selected structure |
| `Z` | Undo |
| `Space` | End turn; during combat, skip the playback |
| `Tab` | Playback speed 1x / 2x / 3x |
| WASD / arrows, right-drag | Pan |
| Mouse wheel | Zoom |
| `H` / `F` | Camera to your HQ / whole map |
| `M` | Mute |
| `G` | Cycle graphics quality (auto-detected by default) |
| `?` | Help |
| Touch | Tap to select / place / target; drag one finger to pan, pinch to zoom |

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

### Generated audio

`audio.js` plays pre-rendered clips listed in `assets/audio/manifest.json` and falls back to its procedural WebAudio recipes for anything missing. Opening `index.html` directly from disk (`file://`) always uses the procedural sounds, because browsers block `fetch` there.

`tools/gen_audio.py` renders the clips with text-to-audio models. It holds a prompt sheet for every gameplay sound plus three music loops, then trims, levels and loop-crossfades the output, encodes MP3s and writes the manifest.

```bash
pip install torch diffusers transformers accelerate soundfile lameenc scipy torchsde sentencepiece
export HF_TOKEN=...                                 # for the gated Stable Audio Open weights
python tools/gen_audio.py --list                    # show prompts
python tools/gen_audio.py --backend stable          # all SFX + music (Stable Audio Open 1.0)
python tools/gen_audio.py --only explosion,flak     # regenerate a few
python tools/gen_audio.py --backend audioldm2 --music-backend musicgen   # ungated, non-commercial licences
```

Check each model's licence before shipping generated audio:
- Stable Audio Open uses the Stability AI Community License.
- AudioLDM2 and MusicGen weights are non-commercial.

## Testing

```bash
npm install
npm test              # rules unit tests + AI-vs-AI simulations (Node only, a few seconds)
npx playwright install chromium   # once, for the browser tests
npm run test:e2e      # headless-browser smoke tests of real UI flows
```

- `tests/rules.test.js`: island generation, build/upgrade/sell/undo, decoys, drops, missiles and AA, win conditions, determinism and save round trips.
- `tests/sim.test.js`: AI-vs-AI games at every difficulty and on every campaign map must finish within the rules; the Commander mirror must stay roughly balanced.
- `tests/e2e.test.js`: plays through skirmish, the Drop button, a campaign victory, Continue after a reload, and the phone layout with tap-to-confirm, in Chromium with software WebGL. Everything is served locally, so the tests need no internet access.

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
