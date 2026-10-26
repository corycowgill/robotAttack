# Third-party notices

Robot Attack 2026 is an original game. It is not affiliated with, endorsed by, or connected to any other game, developer or publisher; all trademarks belong to their respective owners.

The game's own code, 3D models (built procedurally in `models.js`), icons and text are covered by the MIT License in `LICENSE`. The components below are under their own terms.

## three.js r128

- Files: `vendor/three.min.js`
- License: MIT. The full text is in `vendor/three.LICENSE`.
- Copyright © 2010-2021 three.js authors. https://threejs.org

## Fonts: Rajdhani, Russo One, Share Tech Mono

- Loaded from Google Fonts at runtime; not bundled in this repository.
- License: SIL Open Font License 1.1. https://openfontlicense.org
- Sources: https://fonts.google.com/specimen/Rajdhani, https://fonts.google.com/specimen/Russo+One, https://fonts.google.com/specimen/Share+Tech+Mono

## Music and sound effects

- Files: `assets/audio/`
- Generated locally with **Stable Audio 3 Small** (Stability AI) using `tools/gen_audio.py`. The prompts are in that script.
- Powered by Stability AI.
- The model is released under the Stability AI Community License (https://stability.ai/license). Free use is limited to individuals and organisations with under US$1M in annual revenue; above that, an enterprise license from Stability AI is required. Check the license that ships with the model before any commercial release.

## Development only (not deployed)

- Playwright (Apache-2.0), used for the browser tests.
