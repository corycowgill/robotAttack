# Commander portraits: image prompts

The dialog windows (campaign briefings, mission cards, enemy radio calls, the post-battle quote) show a
round portrait for each commander. Today those are simple drawn helmets. To replace one with generated art:

1. Generate the image with the prompt below (ChatGPT image generation or any other tool you are licensed to use).
2. Save it as `assets/portraits/<key>.webp` (or convert a PNG to WebP), square, at least 512 × 512.
   Keep the face centred with some margin: the game crops it to a circle.
3. Add the key to `PORTRAITS` in `config.js`, for example `const PORTRAITS = ['hale', 'rusk'];`.

Characters not listed in `PORTRAITS` keep the drawn portrait, so you can add them one at a time.

## Shared style (paste before every character prompt)

> Original character portrait for a gritty near-future military strategy video game. Head and
> shoulders, facing three-quarters toward the viewer, centred in a square frame with margin around the
> head so it can be cropped to a circle. Painterly digital illustration with realistic proportions,
> muted desaturated colours, cold steel-blue ambient light with a single rim light in the character's
> accent colour, subtle film grain. Dark, softly blurred background of a command bunker or battlefield
> haze. No text, no logos, no insignia of real armies or countries, no recognizable real person.

## Characters

| Key (file name) | Character | Accent colour |
|---|---|---|
| `hale` | Gen. Hale, your commanding officer | cyan `#2ec4ff` |
| `rusk` | Cmdr. Rusk, coastal garrison | orange `#ff7a3d` |
| `vey` | Capt. Vey, reef fortress warden | amber `#ffb000` |
| `kord` | Marshal Kord, strait fleet command | red `#ff4422` |
| `nyx` | Overseer NYX, autonomous war AI | violet `#c04dff` |
| `sol` | Director Sol, orbital network command | magenta `#ff3d7f` |

### hale: Gen. Hale (ally, your commanding officer)
> A seasoned general in their fifties, calm and determined, short grey hair under a dark navy beret
> with a small cyan badge, weathered face, worn armoured field jacket with cyan trim, a headset
> microphone. Cyan rim light. Mood: steady, trustworthy, tired but resolute.

### rusk: Cmdr. Rusk (mission 1)
> A brash young coastal garrison commander, sunburnt, stubble, cocky half-smile, bare-headed with a
> buzz cut, sand-dusted tactical vest over a rolled-sleeve uniform, binoculars around the neck, a
> beach and sandbags blurred behind. Orange rim light. Mood: overconfident, loud.

### vey: Capt. Vey (missions 2 and 4)
> A stern fortress commander in her forties, an eye patch over the left eye, tightly tied dark hair,
> high-collared armoured coat with amber trim, concrete bunker walls and AA guns blurred behind.
> Amber rim light. Mood: cold, disciplined, defensive.

### kord: Marshal Kord (missions 3 and 6)
> A calculating fleet marshal, older, sharp features, neatly trimmed grey beard, a slim tactical
> antenna rising from a headset, long dark greatcoat with red piping, holographic tactical map glow
> on his face. Red rim light. Mood: analytical, patient, menacing.

### nyx: Overseer NYX (mission 5)
> An autonomous military AI shown as a sleek armoured android head with a crown-like array of sensor
> fins, a glowing violet visor slit instead of eyes, matte gunmetal plating with fine panel lines,
> cables at the neck, data-light reflections. Violet rim light. Mood: inhuman, cold, all-seeing.

### sol: Director Sol (mission 7)
> The director of an orbital weapons network, ageless and immaculate, slicked silver hair, high-tech
> collar with a thin antenna and a magenta visor pushed up on the forehead, an orbital station
> window and the curve of a planet blurred behind. Magenta rim light. Mood: aloof, superior, untouchable.

## Notes

- Keep the set consistent: generate all six in one conversation and ask for the same style each time.
- Use original characters only (no likeness of real people or existing game characters).
- WebP at 512 × 512 is about 30–60 KB each; the game loads a portrait only when it is shown.
