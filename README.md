# Robot Strategy Attack 2026

Turn-based base-building strategy game rendered in Three.js with a 2.5D battlefield view.

## How to Play

1. Open `game.html` in a modern browser
2. Choose difficulty: **Patrol** (easier, random AI) or **Commander** (harder, strategic AI)
3. Each turn:
   - **Build structures** on your segments (left side) by selecting a building type and clicking a segment
   - **Fire missiles** from Missile Silos at enemy segments
   - **Deploy robots** from Robot Hangars to attack enemy buildings
   - Click **End Turn** when done
4. Watch the combat phase resolve automatically (~8 seconds)
5. **Win** by destroying the enemy Command Center

## Buildings

| Building | Cost | Effect |
|----------|------|--------|
| Power Plant | 2 | +3 energy/turn |
| Radar Station | 2 | Reveals 3 enemy segments/turn |
| Missile Silo | 3 | Fire 1 ballistic missile/turn |
| Anti-Missile Battery | 3 | Intercepts 2 incoming missiles/turn |
| Robot Hangar | 4 | Deploy 1 combat mech/turn |
| Shield Generator | 3 | Absorbs next hit on adjacent segments |
| Command Center | Built-in | 20 HP, destruction = defeat |

## Controls

- **Click segment** to place selected building
- **Arrow keys / A/D** or **mouse drag** to pan camera
- **Build menu** at bottom of screen
- **Fire Missile / Deploy Robot** buttons enter targeting mode

## Tech Stack

- Three.js r128 (CDN)
- Web Audio API (procedural 8-bit sound)
- Vanilla JS (no frameworks)
- Single HTML entry point with modular JS files

## Files

- `game.html` — Entry point and orchestrator
- `gameState.js` — State schema, constants, factories
- `renderer.js` — Three.js scene, terrain, camera, CRT effects
- `buildings.js` — 7 building types with 3D geometry
- `weapons.js` — Missile system, interception, damage
- `robots.js` — Mech deployment, combat, animation
- `ai.js` — Patrol and Commander AI modes
- `ui.js` — HUD, menus, build interface
- `sfx.js` — Audio and particle effects
