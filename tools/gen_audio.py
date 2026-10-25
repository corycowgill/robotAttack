#!/usr/bin/env python3
"""Generate the game's sound effects, ambience and music with Stable Audio 3.

Renders every clip through a local ComfyUI server running the Stable Audio 3
Small checkpoints (stable_audio_3_small_sfx / _music + t5gemma_b_b_ul2 text
encoder), ranks several takes per sound with a CLAP audio-text model, then
trims, levels, loops and encodes the winners to MP3 and writes
assets/audio/manifest.json, which audio.js loads at startup. Any sound without
a clip keeps its procedural WebAudio recipe, so this can run for any subset.

Raw takes are cached in .audio-work/raw, so re-running only post-processes;
pass --regen to sample fresh takes.

  python tools/gen_audio.py --list
  python tools/gen_audio.py                          # everything
  python tools/gen_audio.py --only explosion,combat  # a few sounds
  python tools/gen_audio.py --url http://127.0.0.1:8188

Requirements: ComfyUI with the checkpoints above, plus
  pip install numpy scipy soundfile torch transformers
and ffmpeg on PATH. CLAP weights (laion/larger_clap_general) download from
Hugging Face on first use; --no-rank skips ranking and keeps the first takes.
Stable Audio 3 is released under the Stability AI Community License; check it
before shipping generated audio commercially.
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'assets', 'audio')
WORK = os.path.join(ROOT, '.audio-work')
SR = 44100

# Common tail for sound-effect prompts: keeps the model on one isolated event
ISO = ' Isolated one-shot game sound effect, close and clean, no music, no speech.'

# name: settings
#   kind      sfx (one-shot), sting (one-shot from the music model), amb (looping ambience), music (looping)
#   prompt    text for Stable Audio 3; clap: short description CLAP ranks takes against
#   gen       seconds generated; keep: seconds kept (one-shots trim the tail early when it decays)
#   n         variants kept (the game picks one at random each time); cand: takes sampled per kept variant
#   db        RMS target (dBFS) of the active part; stereo: keep two channels (positional SFX are mono)
# Names match GameAudio.play() names / music tracks. Sounds left out use their procedural
# recipe in audio.js.
SHEET = {
    # ── Missiles ──
    'missileLaunch': dict(kind='sfx', gen=4, keep=2.6, n=3, db=-17,
        prompt='Heavy ballistic missile launching from an underground silo: a metal hatch clanks open, a rocket motor ignites with a deep roar and the missile whooshes up and away into the sky.' + ISO,
        clap='a missile launching with a rocket roar whooshing away'),
    'incoming': dict(kind='sfx', gen=3, keep=2.0, n=2, db=-21,
        prompt='An incoming missile falling from the sky toward the listener, a rising descending whistle and air-tearing scream, ending right before impact, no explosion.' + ISO,
        clap='a falling bomb whistling down from the sky'),
    'explosion': dict(kind='sfx', gen=4, keep=2.6, n=4, db=-14,
        prompt='A missile warhead exploding on a concrete military base: sharp powerful blast, deep bass boom, crunching concrete and metal debris raining down, short rumbling tail.' + ISO,
        clap='a powerful explosion with debris'),
    'explosionBig': dict(kind='sfx', gen=6, keep=4.2, n=2, db=-12,
        prompt='A gigantic explosion destroying a fortified command bunker: enormous concussive blast, sub-bass shockwave, collapsing steel and concrete, long rolling thunderous rumble.' + ISO,
        clap='a massive huge explosion with a long rumbling tail'),
    'splash': dict(kind='sfx', gen=3, keep=2.0, n=3, db=-17,
        prompt='A missile plunging into the ocean and exploding underwater: a muffled deep boom and a tall column of water crashing back down with heavy splashing.' + ISO,
        clap='an underwater explosion with a big water splash'),
    'flak': dict(kind='sfx', gen=2, keep=0.9, n=4, db=-18,
        prompt='A single anti-aircraft flak cannon shot: sharp punchy thump of the gun firing and a high crackling airburst of the shell.' + ISO,
        clap='an anti aircraft gun firing a flak shell'),
    'intercept': dict(kind='sfx', gen=2, keep=1.4, n=3, db=-16,
        prompt='A missile shot down in mid-air far overhead: a sharp explosive crack and a full boom, then burning fragments sizzling and a short echo across the sky.' + ISO,
        clap='an explosion in the sky'),
    'shieldHit': dict(kind='sfx', gen=3, keep=1.6, n=3, db=-18,
        prompt='A sci-fi energy shield deflecting an impact: a sharp electric zap and crackle, then a bright shimmering hum that wobbles and fades out.' + ISO,
        clap='an electric zap and a shimmering energy hum'),
    # ── Orbital strike ──
    'strikeUp': dict(kind='sfx', gen=3, keep=2.0, n=2, db=-17,
        prompt='A sci-fi orbital uplink cannon firing a beam of light straight up into space: rising electrical charge-up whine, powerful energy release and a fading shimmering tail.' + ISO,
        clap='a sci-fi laser beam charging and firing'),
    'strikeDown': dict(kind='sfx', gen=3, keep=1.6, n=2, db=-17,
        prompt='An orbital laser strike descending from the sky: an ominous growing electric roar with crackling plasma that builds up to the moment of impact.' + ISO,
        clap='a powerful laser beam coming down from the sky, electric roar'),
    'strikeImpact': dict(kind='sfx', gen=6, keep=4.0, n=2, db=-12,
        prompt='A devastating orbital laser strike hitting the ground: a blinding plasma blast, a massive explosion with a deep sub-bass shockwave, crackling energy and a long rumbling tail.' + ISO,
        clap='a massive sci-fi energy explosion'),
    'uplinkReady': dict(kind='sfx', gen=3, keep=2.0, n=1, db=-20,
        prompt='A futuristic weapon system reaching full charge: a rising electronic power-up hum ending in a clean bright confirmation tone.' + ISO,
        clap='a futuristic power up charging sound'),
    # ── Defences ──
    'gunfire': dict(kind='sfx', gen=2, keep=0.7, n=3, db=-17,
        prompt='A short burst of an automated sentry gun turret: four rapid heavy cannon shots with metallic mechanical clatter.' + ISO,
        clap='a short burst of machine gun fire'),
    'hqGun': dict(kind='sfx', gen=2, keep=1.0, n=2, db=-16,
        prompt='A single heavy autocannon shot from a fortified bunker turret: a deep punchy blast with metallic recoil and a short echo.' + ISO,
        clap='a single heavy cannon shot'),
    # ── Mechs ──
    'robotStep': dict(kind='sfx', gen=2, keep=0.45, n=4, db=-22,
        prompt='One single heavy footstep of a giant battle mech robot: a deep metal stomp on the ground with a short hydraulic servo hiss.' + ISO,
        clap='a heavy metal robot footstep'),
    'robotLand': dict(kind='sfx', gen=3, keep=1.4, n=3, db=-15,
        prompt='A heavy armored drop pod crashing down onto the ground and a battle mech standing up: a massive metal impact thud, dust, then hydraulic servos whirring.' + ISO,
        clap='a heavy metal object crashing to the ground, then servo motors'),
    'robotPunch': dict(kind='sfx', gen=2, keep=0.8, n=3, db=-16,
        prompt='A giant robot fist smashing into a steel building: a heavy metallic clang, crunching dented metal and a brief rattle.' + ISO,
        clap='a heavy metal impact clang'),
    'mechClash': dict(kind='sfx', gen=2, keep=0.9, n=3, db=-16,
        prompt='Two giant battle robots clashing in melee: a heavy metal-on-metal slam, grinding armor plates and sparking servos.' + ISO,
        clap='two metal robots clashing'),
    'robotDie': dict(kind='sfx', gen=3, keep=2.0, n=3, db=-15,
        prompt='A battle mech robot being destroyed: electrical sparks, a failing servo motor winding down, then a small explosion and metal parts clattering to the ground.' + ISO,
        clap='a robot breaking down with sparks and an explosion'),
    'podLaunch': dict(kind='sfx', gen=3, keep=1.6, n=2, db=-18,
        prompt='A sci-fi drop pod launched from a hangar: a pneumatic clamp release, a short powerful thruster burst and a whoosh flying away.' + ISO,
        clap='a rocket thruster launching and whooshing away'),
    # ── Base building ──
    'build': dict(kind='sfx', gen=3, keep=1.4, n=2, db=-19,
        prompt='A futuristic military structure assembling itself: quick mechanical ratchets, heavy metal panels locking into place and a short pneumatic hiss.' + ISO,
        clap='mechanical construction, metal parts locking into place'),
    'upgrade': dict(kind='sfx', gen=3, keep=1.6, n=2, db=-19,
        prompt='A military structure being upgraded: heavy machinery reconfiguring with clanks and servo whirs, finishing with a rising bright power-up tone.' + ISO,
        clap='machinery upgrading with a power up sound'),
    'repair': dict(kind='sfx', gen=2, keep=1.1, n=2, db=-21,
        prompt='A sci-fi repair tool fixing a metal structure: a short burst of crackling welding sparks and a quick soft rising hum.' + ISO,
        clap='welding sparks and a repair tool'),
    'sell': dict(kind='sfx', gen=2, keep=0.9, n=2, db=-21,
        prompt='A sci-fi structure being dismantled and recycled: a quick descending mechanical whirr, metal panels unlatching and a soft thump.' + ISO,
        clap='machinery powering down and dismantling'),
    'decoyPop': dict(kind='sfx', gen=2, keep=1.3, n=2, db=-18,
        prompt='A big inflatable rubber decoy bursting: a loud rubbery pop followed by air hissing out as it deflates and flaps.' + ISO,
        clap='a balloon popping and air hissing out'),
    'destroyed': dict(kind='sfx', gen=4, keep=3.0, n=3, db=-15,
        prompt='A large military building collapsing after an explosion: steel beams groaning and snapping, concrete crumbling, debris crashing down and settling.' + ISO,
        clap='a building collapsing with crashing debris'),
    # ── Orders ──
    'targetLock': dict(kind='sfx', gen=2, keep=0.7, n=2, db=-22,
        prompt='A military targeting computer locking on to a target: quick rising electronic beeps ending in a solid lock-on tone.' + ISO,
        clap='an electronic target lock beep'),
    'strikeLock': dict(kind='sfx', gen=2, keep=1.2, n=1, db=-21,
        prompt='A sci-fi orbital satellite weapon locking onto a ground target: a short rising electronic charge whine, three fast targeting beeps and a bright metallic lock-on chime.' + ISO,
        clap='electronic targeting beeps and a lock on chime'),
    'dropOrder': dict(kind='sfx', gen=2, keep=0.9, n=1, db=-21,
        prompt='A heavy steel hatch locking shut with one deep solid mechanical clunk, sci-fi military.' + ISO,
        clap='a heavy metal clunk'),
    'undo': dict(kind='sfx', gen=2, keep=0.5, n=1, db=-23,
        prompt='A quick soft reversed whoosh user interface sound, like rewinding.' + ISO,
        clap='a short reverse whoosh'),
    'cancel': dict(kind='sfx', gen=2, keep=0.5, n=1, db=-23,
        prompt='A short soft descending two-note electronic interface blip, cancelling a command.' + ISO,
        clap='a short descending electronic blip'),
    # ── Interface ──
    'uiClick': dict(kind='sfx', gen=1, keep=0.12, n=3, db=-22,
        prompt='A single crisp tactile click of a military console button, tiny and dry.' + ISO,
        clap='a single button click'),
    'uiHover': dict(kind='sfx', gen=1, keep=0.08, n=2, db=-30,
        prompt='A very tiny soft high electronic tick, a subtle interface hover sound.' + ISO,
        clap='a tiny soft electronic tick'),
    'select': dict(kind='sfx', gen=1, keep=0.25, n=2, db=-23,
        prompt='A short soft digital blip, a crisp clean sci-fi interface select sound.' + ISO,
        clap='a short digital blip'),
    'error': dict(kind='sfx', gen=1, keep=0.4, n=2, db=-22,
        prompt='A short harsh low electronic buzzer, two quick buzzes, access denied.' + ISO,
        clap='an error buzzer'),
    'turnStart': dict(kind='sfx', gen=3, keep=2.0, n=1, db=-22,
        prompt='A submarine sonar radar ping with a long clean echo, calm sci-fi command interface.' + ISO,
        clap='a sonar ping with echo'),
    'endTurn': dict(kind='sfx', gen=2, keep=0.8, n=1, db=-21,
        prompt='A clean short sci-fi computer interface confirmation chime: two bright synthesizer tones rising, crisp and clean, no noise.' + ISO,
        clap='a clean electronic confirmation chime'),
    'combatStart': dict(kind='sting', gen=4, keep=2.6, n=1, db=-17, stereo=True,
        prompt='A short cinematic battle start hit: a huge orchestral and synth impact with a deep boom, a brass stab and a metallic reverb tail. Trailer hit, no melody, no vocals.',
        clap='a cinematic trailer impact hit'),
    'alarm': dict(kind='sfx', gen=3, keep=1.6, n=1, db=-20,
        prompt='Two urgent blasts of a loud military base warning siren klaxon, a harsh electric horn.' + ISO,
        clap='a loud warning klaxon horn'),
    'achievement': dict(kind='sting', gen=3, keep=2.2, n=1, db=-20, stereo=True,
        prompt='A short bright rewarding achievement unlocked jingle: a sparkling rising synth arpeggio ending on a shiny major chord. No vocals.',
        clap='a short happy reward jingle'),
    'radio': dict(kind='sfx', gen=2, keep=0.9, n=2, db=-23,
        prompt='A military field radio squelch: a short burst of crackling static and a click as the channel opens.' + ISO,
        clap='radio static squelch'),
    'handoff': dict(kind='sfx', gen=2, keep=1.0, n=1, db=-22,
        prompt='A smooth sci-fi screen transition whoosh with a soft low swell.' + ISO,
        clap='a soft whoosh transition'),
    'titleSting': dict(kind='sting', gen=6, keep=4.5, n=1, db=-16, stereo=True,
        prompt='A huge cinematic title logo reveal for a sci-fi war game: a deep sub-bass boom, a rising metallic whoosh, a wide powerful brass and synth chord that blooms and rings out. No vocals.',
        clap='an epic cinematic logo reveal boom and brass chord'),
    # ── Stingers (music model) ──
    'victory': dict(kind='sting', gen=10, keep=8.0, n=1, db=-16, stereo=True,
        prompt='A short triumphant victory fanfare for a sci-fi war game: heroic brass melody rising over pounding timpani and strings, ending on a big bright major chord with a reverberant tail. Instrumental, no vocals.',
        clap='a triumphant orchestral victory fanfare'),
    'defeat': dict(kind='sting', gen=10, keep=8.0, n=1, db=-18, stereo=True,
        prompt='A short somber defeat cue for a sci-fi war game: a slow descending low brass phrase over dark strings and a distant muffled drum, fading to a bleak minor chord. Instrumental, no vocals.',
        clap='a sad somber orchestral defeat music'),
    # ── Ambience ──
    'ocean': dict(kind='amb', gen=30, n=1, db=-30, stereo=True,
        prompt='Calm ocean ambience on a remote island: gentle waves washing onto the shore, a soft steady sea wind, distant seabirds very faint. Continuous field recording, no music, no voices.',
        clap='ocean waves and wind ambience'),
    'battleAmb': dict(kind='amb', gen=30, n=1, db=-32, stereo=True,
        prompt='Distant battlefield ambience across the sea: faint far-away explosions and artillery rumbles, low wind, occasional distant sirens. Continuous background, no music, no voices, no close sounds.',
        clap='distant explosions and war ambience'),
    # ── Music loops ──
    'menu': dict(kind='music', gen=95, db=-20, stereo=True,
        prompt='Epic main title theme for a near-future sci-fi military strategy game about island warfare with giant mechs and missiles. Hybrid orchestral and synth score, D minor, 96 BPM: a heroic French horn and brass melody over pulsing analog synth bass, big taiko and orchestral drums, soaring strings, steady driving rhythm. Instrumental, no vocals, high quality cinematic recording.',
        clap='epic heroic orchestral game theme music with brass and drums'),
    'planning': dict(kind='music', gen=95, db=-23, stereo=True,
        prompt='Tense, thoughtful strategy game underscore for planning a military operation in a sci-fi island war. Minimal hybrid score in D minor, 90 BPM: soft pulsing synth arpeggio, deep warm pads, sparse low piano notes, light ticking percussion, subtle cello swells. Calm but suspenseful, steady energy, no climax. Instrumental, no vocals.',
        clap='calm tense ambient strategy game music with synth pulse'),
    'combat': dict(kind='music', gen=95, db=-19, stereo=True,
        prompt='Intense battle music for a sci-fi mech and missile war game. Hybrid orchestral electronic action score, D minor, 132 BPM: driving staccato strings, aggressive distorted synth bass ostinato, pounding war drums and taiko, powerful brass stabs, relentless energy. Instrumental, no vocals, high quality cinematic recording.',
        clap='intense epic battle music with drums and brass'),
    'climax': dict(kind='music', gen=95, db=-18, stereo=True,
        prompt='Desperate final battle music for a sci-fi war game, the base is about to fall. Huge hybrid orchestral score, D minor, 144 BPM: frantic racing strings, urgent brass fanfares, massive pounding percussion, roaring synth bass, rising tension and dramatic choir-like synth pads. Instrumental, no vocals.',
        clap='urgent dramatic final battle orchestral music'),
    # planning while a Command Center is below 40%: the same world as 'planning', on edge
    'planningTense': dict(kind='music', gen=95, db=-22, stereo=True,
        prompt='Suspenseful strategy game underscore: the base is badly damaged and the next move decides the war. Hybrid score in D minor, 100 BPM: an anxious ticking synth arpeggio, nervous tremolo violins, a repeating high piano ostinato, muted brass swells, light snare ticks, rising tension but no release. Clear and present mix. Instrumental, no vocals.',
        clap='dark suspenseful thriller music'),
    # the after-action screen, after the victory / defeat stinger
    'debriefWin': dict(kind='music', gen=95, db=-23, stereo=True,
        prompt='Calm, proud after-battle music for a sci-fi war game victory debrief. Warm hybrid orchestral score in D major, 80 BPM: a noble slow French horn melody, gentle strings, soft piano, a light steady synth pulse, hopeful and resolved. Instrumental, no vocals.',
        clap='calm hopeful proud orchestral music'),
    'debriefLoss': dict(kind='music', gen=95, db=-24, stereo=True,
        prompt='Quiet, mournful after-battle music for a sci-fi war game defeat debrief. Sparse hybrid score in D minor, 70 BPM: a lonely solo cello, soft low piano chords, a faint cold synth pad, distant wind, reflective and sad but not hopeless. Instrumental, no vocals.',
        clap='sad slow reflective cello and piano music'),
}

NEG_CLAP = ['music with melody', 'a person speaking', 'silence', 'noise hiss static']
NEG_CLAP_MUSIC = ['a person speaking', 'singing vocals', 'silence', 'noise hiss static']
DEFAULT_CAND = {'sfx': 3, 'sting': 4, 'amb': 3, 'music': 3}


# ── ComfyUI ───────────────────────────────────────────────

class Comfy:
    def __init__(self, url):
        self.url = url.rstrip('/')
        if urllib.parse.urlparse(self.url).hostname not in ('127.0.0.1', 'localhost', '::1'):
            raise SystemExit('Use a local ComfyUI server URL.')

    def _req(self, path, data=None, timeout=120):
        raw = None if data is None else json.dumps(data).encode()
        r = urllib.request.Request(self.url + path, data=raw, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(r, timeout=timeout) as res:
            return res.read()

    @staticmethod
    def graph(model, prompt, seconds, seed, batch, prefix):
        return {
            '1': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': f'stable_audio_3_small_{model}.safetensors'}},
            '2': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': 't5gemma_b_b_ul2.safetensors', 'type': 'stable_audio', 'device': 'default'}},
            '3': {'class_type': 'CLIPTextEncode', 'inputs': {'text': prompt, 'clip': ['2', 0]}},
            '4': {'class_type': 'CLIPTextEncode', 'inputs': {'text': '', 'clip': ['2', 0]}},
            '5': {'class_type': 'ConditioningStableAudio', 'inputs': {'positive': ['3', 0], 'negative': ['4', 0], 'seconds_start': 0, 'seconds_total': seconds}},
            '6': {'class_type': 'EmptyLatentAudio', 'inputs': {'seconds': seconds, 'batch_size': batch}},
            '7': {'class_type': 'KSampler', 'inputs': {'model': ['1', 0], 'seed': seed, 'steps': 8, 'cfg': 1, 'sampler_name': 'lcm', 'scheduler': 'simple',
                                                       'denoise': 1, 'positive': ['5', 0], 'negative': ['5', 1], 'latent_image': ['6', 0]}},
            '8': {'class_type': 'VAEDecodeAudio', 'inputs': {'samples': ['7', 0], 'vae': ['1', 2]}},
            '9': {'class_type': 'SaveAudio', 'inputs': {'audio': ['8', 0], 'filename_prefix': prefix}},
        }

    def generate(self, model, prompt, seconds, seed, batch, prefix):
        """Returns a list of FLAC bytes, one per take."""
        wf = self.graph(model, prompt, seconds, seed, batch, prefix)
        pid = json.loads(self._req('/prompt', {'prompt': wf, 'client_id': 'robot-attack-audio'}))['prompt_id']
        deadline = time.time() + 1800
        while time.time() < deadline:
            h = json.loads(self._req('/history/' + pid)).get(pid)
            if h:
                if h.get('status', {}).get('status_str') == 'error':
                    raise RuntimeError(json.dumps(h['status'])[:2000])
                files = h.get('outputs', {}).get('9', {}).get('audio', [])
                if files:
                    return [self._req('/view?' + urllib.parse.urlencode(f)) for f in files]
            time.sleep(0.5)
        raise TimeoutError(prefix)


# ── CLAP ranking ──────────────────────────────────────────

class Clap:
    def __init__(self):
        import torch
        from transformers import ClapModel, ClapProcessor
        self.torch = torch
        self.model = ClapModel.from_pretrained('laion/larger_clap_general').eval()
        self.proc = ClapProcessor.from_pretrained('laion/larger_clap_general')

    def logits(self, audio, texts):
        from scipy.signal import resample_poly
        y = resample_poly(audio.mean(axis=1), 48000, SR).astype(np.float32)
        y = y[:48000 * 10]
        inp = self.proc(text=texts, audio=[y], sampling_rate=48000, return_tensors='pt', padding=True)
        with self.torch.no_grad():
            return self.model(**inp).logits_per_audio[0].numpy()


# ── Signal helpers ────────────────────────────────────────

def read_flac(data):
    import io
    import soundfile as sf
    x, sr = sf.read(io.BytesIO(data), dtype='float32', always_2d=True)
    if sr != SR:
        from scipy.signal import resample_poly
        g = np.gcd(SR, sr)
        x = resample_poly(x, SR // g, sr // g, axis=0).astype(np.float32)
    return x


def db(v):
    return 20 * np.log10(max(float(v), 1e-9))


def envelope(x, win=0.01):
    """RMS envelope (one value per `win` seconds)."""
    n = max(1, int(win * SR))
    m = np.square(x).mean(axis=1)
    k = len(m) // n
    return np.sqrt(m[:k * n].reshape(k, n).mean(axis=1) + 1e-12)


def highpass(x, hz=28):
    from scipy.signal import butter, sosfilt
    sos = butter(2, hz, 'highpass', fs=SR, output='sos')
    return sosfilt(sos, x, axis=0).astype(np.float32)


def active_rms(x):
    """RMS over the loud part (envelope within 20 dB of its peak)."""
    e = envelope(x)
    if not len(e):
        return 1e-9
    loud = e[e > e.max() * 0.1]
    return float(np.sqrt(np.mean(np.square(loud))))


# peak ceiling before encoding, with room for MP3 overshoot (write_mp3 checks the result)
CEIL = 0.84


def level(x, target_db):
    x = x * (10 ** ((target_db - db(active_rms(x))) / 20))
    peak = np.abs(x).max()
    if peak > CEIL:  # soft-knee limit: tanh above 0.55, then rescale
        x = np.where(np.abs(x) > 0.55, np.sign(x) * (0.55 + 0.45 * np.tanh((np.abs(x) - 0.55) / 0.45)), x)
        x *= CEIL / max(np.abs(x).max(), 1e-9)
    return x.astype(np.float32)


def mid_share(x):
    """Share of the energy in 300 Hz - 4 kHz, the range small speakers actually play."""
    sp = np.abs(np.fft.rfft(x.mean(axis=1))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return float(sp[(f > 300) & (f < 4000)].sum() / (sp.sum() + 1e-12))


def bass_share(x, hz=150):
    sp = np.abs(np.fft.rfft(x.mean(axis=1))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return float(sp[f < hz].sum() / (sp.sum() + 1e-12))


def add_presence(x, mix=0.35):
    """Phone and laptop speakers can't play much below ~150 Hz, so a sound that lives down there
    vanishes on them. Saturating the sub band adds its harmonics in the 150-900 Hz range, which
    the ear hears as the missing fundamental (the same trick as hardware 'bass enhancers')."""
    from scipy.signal import butter, sosfilt
    if bass_share(x) < 0.55:
        return x
    low = sosfilt(butter(4, 150, 'lowpass', fs=SR, output='sos'), x, axis=0)
    g = 1.0 / (np.abs(low).max() + 1e-9)
    harm = np.tanh(3.0 * g * low) / g
    harm = sosfilt(butter(2, [180, 900], 'bandpass', fs=SR, output='sos'), harm, axis=0)
    # match the added band to a fixed fraction of the sub band's level
    harm *= mix * np.sqrt(np.mean(low ** 2)) / (np.sqrt(np.mean(harm ** 2)) + 1e-12)
    return (x + harm).astype(np.float32)


def shape_oneshot(x, keep):
    """Trim lead-in silence, cut where the tail has decayed, fade out."""
    e = envelope(x)
    if not len(e) or e.max() < 1e-5:
        return None
    on = int(np.argmax(e > e.max() * 0.06))
    start = max(0, on * int(0.01 * SR) - int(0.004 * SR))
    x = x[start:start + int(keep * SR)]
    e = envelope(x)
    above = np.nonzero(e > e.max() * 0.004)[0]  # -48 dB
    if len(above):
        x = x[:min(len(x), (above[-1] + 3) * int(0.01 * SR))]
    fade = min(len(x) // 3, int(0.2 * SR) if keep > 0.6 else int(0.03 * SR))
    if fade > 1:
        x[-fade:] *= (np.linspace(1, 0, fade) ** 2)[:, None]
    ramp = min(len(x), 32)
    x[:ramp] *= np.linspace(0, 1, ramp)[:, None]
    return x


def oneshot_quality(x_raw, shaped, keep):
    """Penalties for things CLAP doesn't notice: clipping, late onsets, sounds that don't fit their slot."""
    pen = 0.0
    pen += 40 * float(np.mean(np.abs(x_raw).max(axis=1) > 0.995))
    e = envelope(x_raw)
    on = int(np.argmax(e > e.max() * 0.06)) * 0.01
    pen += max(0.0, on - 0.4) * 2
    # energy still going strong at the cut point means the event was longer than its slot
    es = envelope(shaped)
    if len(es) > 10:
        tail = es[-10:].mean() / (es.max() + 1e-9)
        pen += max(0.0, tail - 0.25) * 6
    return pen


def onset_env(x, hop=0.01):
    e = envelope(x, hop)
    d = np.maximum(0, np.diff(np.log(e + 1e-4)))
    return np.concatenate([[0], d])


def best_loop(x, min_len=40.0, xfade=1.5, skip=4.0):
    """Pick loop [s, s+L) whose end matches its start rhythmically; returns (s, L, match)."""
    hop = 0.01
    oe = onset_env(x, hop)
    env = envelope(x, hop)
    s = int(skip / hop)
    w = int(6.0 / hop)
    ref = oe[s:s + w]
    refe = env[s:s + w]
    best = (None, -1e9)
    total = len(oe)
    for L in range(int(min_len / hop), total - s - w - int(1.0 / hop)):
        seg = oe[s + L:s + L + w]
        sege = env[s + L:s + L + w]
        c = float(np.dot(ref - ref.mean(), seg - seg.mean()) / (np.std(ref) * np.std(seg) * w + 1e-9))
        ce = float(np.dot(refe - refe.mean(), sege - sege.mean()) / (np.std(refe) * np.std(sege) * w + 1e-9))
        score = c + 0.5 * ce + 0.002 * L * hop  # prefer longer loops when matches are close
        if score > best[1]:
            best = (L, score)
    L = best[0] * int(hop * SR)
    start = s * int(hop * SR)
    return start, L, best[1]


def make_loop(x, start, L, xfade=1.5):
    """Loop body x[start:start+L] whose last `xfade` s blend into the audio before `start`."""
    n = int(xfade * SR)
    start = max(start, n)
    body = x[start:start + L].copy()
    t = np.linspace(0, 1, n)[:, None]
    body[-n:] = body[-n:] * np.cos(t * np.pi / 2) + x[start - n:start] * np.sin(t * np.pi / 2)
    return body


def loop_seam(body):
    """How well the end flows into the start (spectral distance, lower is better)."""
    n = int(0.25 * SR)
    a, b = body[-n:].mean(axis=1), body[:n].mean(axis=1)
    fa, fb = np.abs(np.fft.rfft(a)), np.abs(np.fft.rfft(b))
    return float(np.mean(np.abs(np.log(fa + 1e-4) - np.log(fb + 1e-4))))


def cyclic_pad(body, pad=0.5):
    """Wrap the loop with its own tail/head so loop points tolerate decoder offsets."""
    n = int(pad * SR)
    return np.concatenate([body[-n:], body, body[:n]]), n


def write_mp3(path, x, kbps, ceil_db=-0.8):
    """Encode, then decode and check the peak: dense, bright clips can overshoot by 2 dB or
    more once encoded, and the browser would clip them. Turn the input down and retry."""
    ch = x.shape[1]
    for _ in range(4):
        pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
        cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', str(SR), '-ac', str(ch), '-i', 'pipe:0',
               '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', path]
        subprocess.run(cmd, input=pcm, check=True)
        dec = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', path, '-f', 'f32le', '-'], capture_output=True).stdout
        over = db(np.abs(np.frombuffer(dec, np.float32)).max()) - ceil_db
        if over <= 0:
            return
        x = x * 10 ** (-(over + 0.2) / 20)


# ── Main ──────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--url', default='http://127.0.0.1:8191', help='local ComfyUI server')
    ap.add_argument('--only', default='', help='comma-separated names to (re)process')
    ap.add_argument('--regen', action='store_true', help='sample new takes instead of reusing cached ones')
    ap.add_argument('--cand', type=int, default=0, help='takes per kept variant (default per kind)')
    ap.add_argument('--more', type=int, default=0, help='sample this many new takes per kept variant on top of the cached ones')
    ap.add_argument('--no-rank', action='store_true', help='skip CLAP ranking')
    ap.add_argument('--seed', type=int, default=2026)
    ap.add_argument('--list', action='store_true', help='print the prompt sheet and exit')
    a = ap.parse_args()

    if a.list:
        for k, v in SHEET.items():
            print(f"{v['kind']:6s} {k:14s} {v.get('keep', v['gen']):5.1f}s x{v.get('n', 1)}  {v['prompt']}")
        return

    only = [s for s in a.only.split(',') if s]
    for s in only:
        if s not in SHEET:
            raise SystemExit('unknown sound: ' + s)
    todo = [k for k in SHEET if not only or k in only]
    os.makedirs(os.path.join(OUT_DIR, 'sfx'), exist_ok=True)
    os.makedirs(os.path.join(OUT_DIR, 'music'), exist_ok=True)
    man_path = os.path.join(OUT_DIR, 'manifest.json')
    manifest = {'sfx': {}, 'music': {}, 'amb': {}, 'gain': {}, 'source': {}}
    if os.path.exists(man_path):
        with open(man_path) as f:
            manifest.update(json.load(f))
        manifest.setdefault('amb', {})

    comfy = Comfy(a.url)
    clap = None if a.no_rank else Clap()
    report = {}

    for idx, name in enumerate(todo):
        spec = SHEET[name]
        kind = spec['kind']
        n_keep = spec.get('n', 1)
        cand = a.cand or DEFAULT_CAND[kind]
        model = 'sfx' if kind in ('sfx', 'amb') else 'music'
        raw_dir = os.path.join(WORK, 'raw', name)
        os.makedirs(raw_dir, exist_ok=True)
        t0 = time.time()

        # takes: cached FLACs, topped up from ComfyUI in batches of up to 4
        want = n_keep * cand
        cached = sorted(f for f in os.listdir(raw_dir) if f.endswith('.flac'))
        if a.regen:
            for f in cached:
                os.remove(os.path.join(raw_dir, f))
            cached = []
        want = max(want, len(cached) + a.more * n_keep)
        seed = a.seed + idx * 1009 + len(cached) * 7
        while len(cached) < want:
            batch = min(4 if spec['gen'] <= 12 else 1, want - len(cached))
            for data in comfy.generate(model, spec['prompt'], spec['gen'], seed, batch, 'robotattack/' + name):
                fn = f'take_{len(cached):02d}.flac'
                with open(os.path.join(raw_dir, fn), 'wb') as f:
                    f.write(data)
                cached.append(fn)
            seed += 7
        takes = []
        for fn in cached[:max(want, len(cached))]:
            with open(os.path.join(raw_dir, fn), 'rb') as f:
                takes.append((fn, highpass(read_flac(f.read()))))

        texts = [spec['clap']] + (NEG_CLAP_MUSIC if kind in ('music', 'sting') else NEG_CLAP)
        scored = []
        for fn, x in takes:
            if not spec.get('stereo'):
                x = x.mean(axis=1, keepdims=True)
            elif x.shape[1] == 1:
                x = np.repeat(x, 2, axis=1)
            if kind in ('sfx', 'sting'):
                shaped = shape_oneshot(x.copy(), spec['keep'])
                if shaped is None or len(shaped) < int(0.03 * SR):
                    continue
                pen = oneshot_quality(x, shaped, spec['keep'])
                clip = level(add_presence(shaped), spec['db'])
                extra = {}
            else:
                if kind == 'music':
                    start, L, match = best_loop(x)
                else:
                    start, L, match = int(2.0 * SR), len(x) - int(4.0 * SR), 0.0
                body = make_loop(x, start, L, 1.5 if kind == 'music' else 3.0)
                pen = loop_seam(body) * 2 - match
                # a track that is nearly all sub-bass is a murmur on phone and laptop speakers
                pen += max(0.0, 0.12 - mid_share(body)) * 60
                clip = level(body, spec['db'])
                extra = {'match': round(float(match), 3), 'len': round(len(body) / SR, 2)}
            if clap:
                lg = clap.logits(clip, texts)
                score = float(lg[0] - max(0.0, float(lg[1:].max()) - lg[0] + 6) * 0.5) - pen
            else:
                score = -pen
            scored.append((score, fn, clip, extra))
        scored.sort(key=lambda s: s[0], reverse=True)
        keep = scored[:n_keep]

        if kind in ('sfx', 'sting'):
            files = []
            for v, (_, fn, clip, _) in enumerate(keep):
                rel = f'sfx/{name}_{v + 1}.mp3'
                write_mp3(os.path.join(OUT_DIR, rel), clip, 128 if spec.get('stereo') else 96)
                files.append(rel)
            for old in os.listdir(os.path.join(OUT_DIR, 'sfx')):  # drop variants from older runs
                if old.startswith(name + '_') and 'sfx/' + old not in files and old[len(name) + 1:-4].isdigit():
                    os.remove(os.path.join(OUT_DIR, 'sfx', old))
            manifest['sfx'][name] = files
        else:
            _, fn, clip, extra = keep[0]
            padded, pad = cyclic_pad(clip)
            rel = f'music/{name}.mp3'
            write_mp3(os.path.join(OUT_DIR, rel), padded, 160 if kind == 'music' else 112)
            entry = {'file': rel, 'loopStart': round(pad / SR, 4), 'loopEnd': round((pad + len(clip)) / SR, 4)}
            manifest['music' if kind == 'music' else 'amb'][name] = entry
        manifest['source'][name] = 'Stable Audio 3 Small (' + model + '): ' + spec['prompt']
        report[name] = [(round(float(s), 2), fn, e) for s, fn, _, e in scored]
        with open(man_path, 'w') as f:
            json.dump(manifest, f, indent=2, sort_keys=True)
        print(f'[{idx + 1}/{len(todo)}] {name}: kept {len(keep)}/{len(scored)} '
              f'(scores {", ".join(str(round(s[0], 1)) for s in scored[:n_keep + 2])}) in {time.time() - t0:.0f}s', flush=True)

    with open(os.path.join(WORK, 'rank_report.json'), 'w') as f:
        json.dump(report, f, indent=1)
    print('manifest:', man_path)


if __name__ == '__main__':
    sys.exit(main())
