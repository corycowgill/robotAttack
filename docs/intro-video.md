# Intro cinematic

The game can play a short video once per visit, before the logo reveal. It is muted (browsers
only autoplay muted video), and a click, tap or any key skips it. If the file is missing, fails to
load within 4 seconds or will not play, the game goes straight to the title screen.

## Turning it on

1. Save the clip as `assets/brand/intro.mp4`.
2. Set `const INTRO_VIDEO = 'assets/brand/intro.mp4';` in `config.js`.
3. Bump the cache name in `sw.js`.

## File format

- MP4, H.264 video (plays on iPhone Safari, Chrome, Edge and Firefox); no audio track needed.
- 1920 × 1080 or 1280 × 720, 24 or 30 fps, 6–15 seconds.
- Keep it under about 8 MB so it starts quickly on phones. For example:
  `ffmpeg -i in.mp4 -an -vf scale=1280:-2 -c:v libx264 -crf 26 -preset slow -movflags +faststart assets/brand/intro.mp4`
- Phones and wide screens crop the edges (the video fills the screen), so keep the action centred.
- End on a dark frame: the title screen fades in from black.

## Prompt (text-to-video)

Most video models make 5–10 second clips, so generate the shots separately and join them, or use
the single-clip prompt.

**Style (add to every shot):**

> Cinematic, gritty near-future military realism, cold steel-blue night with orange fire light,
> volumetric haze, light rain, film grain, anamorphic lens, slow deliberate camera. Original
> design, no text, no logos, no real-world insignia.

**Shot 1: the strait (about 4 s)**

> Aerial shot gliding low over a dark, choppy sea strait at night toward two fortified rocky
> islands facing each other, concrete bunkers and radar dishes on each shore, searchlights
> sweeping the water, cyan running lights on the near island, orange warning lights on the far one.

**Shot 2: launch (about 3 s)**

> Close-up of an armoured missile silo hatch sliding open on a concrete island base, a missile
> lifting off in a burst of white smoke and flame, rain streaking through the light.

**Shot 3: intercept (about 3 s)**

> Night sky above the far island: anti-aircraft tracer fire in orange arcs, a missile streaking
> overhead, an explosion lighting the clouds.

**Shot 4: drop (about 3 s)**

> A sleek armoured dropship skimming over the waves at speed, rear hatch open, a heavy bipedal
> combat mech dropping onto a beach in a spray of sand, its visor glowing cyan, then the frame
> fades to black.

**Single clip (if you only generate one):**

> A low, fast aerial shot over a dark sea strait at night between two fortified rocky islands;
> a missile launches from a concrete silo on the near island, orange anti-aircraft tracers rise
> from the far island, a sleek dropship skims the waves toward the far shore, explosions light
> the clouds, then the camera rises into the smoke and the frame fades to black. Cinematic,
> gritty near-future military realism, cold steel blue with orange fire light, haze, light rain,
> film grain, no text.

Use only original designs, and only tools whose terms let you use the output in the game.
