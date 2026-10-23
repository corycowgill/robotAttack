#!/usr/bin/env python3
"""Generate the game's sound effects and music with text-to-audio models.

Writes MP3 clips plus assets/audio/manifest.json, which audio.js loads at
startup. Sounds without a clip keep their procedural WebAudio recipe, so this
can be run for any subset of sounds.

Backends (weights download from Hugging Face on first use):
  stable     stabilityai/stable-audio-open-1.0  44.1 kHz stereo, SFX + music.
             Gated: accept the licence on its model page and set HF_TOKEN.
  audioldm2  cvssp/audioldm2                     16 kHz, SFX. Ungated, CC BY-NC-SA.
  musicgen   facebook/musicgen-small             32 kHz, music only. Ungated, CC BY-NC.

Examples:
  python tools/gen_audio.py --list
  python tools/gen_audio.py --backend stable
  python tools/gen_audio.py --backend audioldm2 --only explosion,flak
  python tools/gen_audio.py --music-backend musicgen --music-only
"""

import argparse
import json
import os
import sys
import time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'assets', 'audio')
SR = 44100

SFX_NEG = 'music, melody, speech, voice, singing, crowd, low quality, distorted, clipping'
MUSIC_NEG = 'vocals, speech, singing, low quality, distorted, abrupt ending'

# name: (prompt, seconds, variants, target RMS dBFS)
# Names match GameAudio.play() names; explosionBig is used for HQ-sized blasts.
SFX = {
    'explosion':     ('powerful missile explosion impact, deep boom with debris and rumble, close, cinematic war sound effect', 2.5, 3, -14),
    'explosionBig':  ('massive building demolition explosion, huge low boom, collapsing concrete and metal debris, long rumbling tail, cinematic', 4.0, 2, -13),
    'flak':          ('anti-aircraft flak shell burst in the sky, sharp crack and pop, distant, military', 1.0, 3, -18),
    'missileLaunch': ('ballistic missile launch from silo, rocket ignition roar and whoosh rising away', 2.0, 2, -16),
    'incoming':      ('incoming artillery shell whistle falling from the sky, descending pitch, no explosion', 2.0, 2, -20),
    'intercept':     ('missile intercepted mid-air, sharp metallic explosion pop high in the sky', 1.0, 3, -17),
    'shieldHit':     ('sci-fi energy shield absorbing an impact, electric shimmer and resonant hum', 1.5, 2, -18),
    'gunfire':       ('short burst of heavy automatic turret gunfire, four rapid shots, metallic', 0.8, 3, -17),
    'robotStep':     ('single heavy mech robot footstep, metal stomp with hydraulic hiss', 0.6, 4, -22),
    'robotLand':     ('heavy robot mech landing on the ground from a drop pod, metal impact thud and dust', 1.2, 2, -16),
    'robotPunch':    ('giant robot fist punching a metal building, heavy metallic clang and crunch', 0.8, 3, -16),
    'robotDie':      ('robot mech destroyed, electrical sparks, metal breaking apart and small explosion', 2.0, 2, -16),
    'podLaunch':     ('drop pod rocket launch, short thruster blast and hiss, sci-fi', 1.5, 2, -18),
    'build':         ('construction complete, mechanical ratchet clicks, metal panels locking into place, positive sci-fi chime', 1.2, 2, -20),
    'repair':        ('sci-fi repair tool, welding sparks and soft rising chime', 1.0, 2, -21),
    'sell':          ('sci-fi structure dismantled, quick descending mechanical whirr', 0.8, 2, -21),
    'destroyed':     ('large military building collapsing, concrete and steel crumbling, explosion debris falling', 3.0, 2, -15),
    'alarm':         ('military base warning klaxon, two short alarm blasts', 1.2, 1, -20),
    'turnStart':     ('sonar radar ping with echo, clean sci-fi interface sound', 1.8, 1, -22),
    'endTurn':       ('sci-fi command confirmation sound, short rising tone', 0.6, 1, -22),
    'victory':       ('triumphant short orchestral victory fanfare with brass and drums', 4.0, 1, -16),
    'defeat':        ('somber short orchestral defeat stinger, low brass and strings, descending', 4.0, 1, -18),
}

# mode: (prompt, seconds, target RMS dBFS)
MUSIC = {
    'planning': ('dark ambient sci-fi strategy game music, slow evolving synth pads, low drones, subtle pulse, tense but calm, loopable, 80 bpm', 40.0, -24),
    'combat':   ('intense electronic military action game music, driving synth bass, heavy drums, cinematic percussion, 120 bpm, loopable', 40.0, -20),
    'menu':     ('epic cinematic sci-fi main menu theme, atmospheric synth pads, distant drums, mysterious, loopable, 90 bpm', 40.0, -23),
}


# ── Models ─────────────────────────────────────────────────

class StableBackend:
    model = 'stabilityai/stable-audio-open-1.0'

    def __init__(self, steps):
        import torch
        from diffusers import StableAudioPipeline
        self.torch = torch
        self.pipe = StableAudioPipeline.from_pretrained(self.model, torch_dtype=torch.float32)
        self.sr = self.pipe.vae.sampling_rate
        self.steps = steps

    def generate(self, prompt, neg, seconds, n, seed):
        g = self.torch.Generator().manual_seed(seed)
        out = self.pipe(prompt, negative_prompt=neg, num_inference_steps=self.steps,
                        audio_end_in_s=seconds, num_waveforms_per_prompt=n, generator=g).audios
        return [a.float().cpu().numpy().T for a in out]  # (samples, channels)


class AudioLDM2Backend:
    model = 'cvssp/audioldm2'

    def __init__(self, steps):
        import torch
        from diffusers import AudioLDM2Pipeline
        self.torch = torch
        self.pipe = AudioLDM2Pipeline.from_pretrained(self.model, torch_dtype=torch.float32)
        self.sr = 16000
        self.steps = steps

    def generate(self, prompt, neg, seconds, n, seed):
        g = self.torch.Generator().manual_seed(seed)
        out = self.pipe(prompt, negative_prompt=neg, num_inference_steps=self.steps,
                        audio_length_in_s=max(seconds, 1.0), num_waveforms_per_prompt=n, generator=g).audios
        return [np.asarray(a)[:, None] for a in out]


class MusicGenBackend:
    model = 'facebook/musicgen-small'

    def __init__(self, steps):
        import torch
        from transformers import AutoProcessor, MusicgenForConditionalGeneration
        self.torch = torch
        self.proc = AutoProcessor.from_pretrained(self.model)
        self.net = MusicgenForConditionalGeneration.from_pretrained(self.model)
        self.sr = self.net.config.audio_encoder.sampling_rate

    def generate(self, prompt, neg, seconds, n, seed):
        self.torch.manual_seed(seed)
        inputs = self.proc(text=[prompt] * n, padding=True, return_tensors='pt')
        out = self.net.generate(**inputs, do_sample=True, guidance_scale=3.0, max_new_tokens=int(seconds * 50))
        return [a.cpu().numpy().T for a in out]


BACKENDS = {'stable': StableBackend, 'audioldm2': AudioLDM2Backend, 'musicgen': MusicGenBackend}


# ── Post-processing ────────────────────────────────────────

def resample(x, sr):
    if sr == SR:
        return x
    from scipy.signal import resample_poly
    g = np.gcd(SR, sr)
    return resample_poly(x, SR // g, sr // g, axis=0)


def db(x):
    return 20 * np.log10(max(float(x), 1e-9))


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)) + 1e-12))


def trim_and_fade(x, seconds):
    """Trim leading silence, cut to length, fade the tail."""
    mono = np.abs(x).max(axis=1)
    thr = mono.max() * 0.03
    start = int(np.argmax(mono > thr))
    start = max(0, start - int(0.005 * SR))
    x = x[start:start + int(seconds * SR)]
    # drop trailing near-silence
    mono = np.abs(x).max(axis=1)
    loud = np.nonzero(mono > mono.max() * 0.004)[0]
    if len(loud):
        x = x[:min(len(x), loud[-1] + int(0.05 * SR))]
    fade = min(len(x) // 3, int(0.25 * SR))
    if fade > 0:
        x[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
    x[:16] *= np.linspace(0, 1, 16)[:, None]
    return x


def level(x, target_db):
    x = x * (10 ** ((target_db - db(rms(x))) / 20))
    peak = np.abs(x).max()
    if peak > 0.97:
        x *= 0.97 / peak
    return x


def make_loop(x, xfade_s=2.0):
    """Crossfade the tail into the head so the clip loops seamlessly."""
    n = int(xfade_s * SR)
    if len(x) < 3 * n:
        return x
    head, body, tail = x[:n], x[n:-n], x[-n:]
    t = np.linspace(0, 1, n)[:, None]
    blend = tail * np.cos(t * np.pi / 2) + head * np.sin(t * np.pi / 2)
    return np.concatenate([body, blend])


def score(x):
    """Prefer clips with strong, clean transients over muddy or clipped ones."""
    m = np.abs(x).max(axis=1)
    crest = m.max() / (rms(x) + 1e-9)
    clipped = float(np.mean(m > 0.99))
    return crest - 50 * clipped


def write_mp3(path, x, kbps):
    import lameenc
    ch = x.shape[1]
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    enc = lameenc.Encoder()
    enc.set_bit_rate(kbps)
    enc.set_in_sample_rate(SR)
    enc.set_channels(ch)
    enc.set_quality(2)
    data = enc.encode(pcm.reshape(-1).tobytes()) + enc.flush()
    with open(path, 'wb') as f:
        f.write(data)


# ── Main ───────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--backend', default='stable', choices=['stable', 'audioldm2'], help='model for sound effects')
    ap.add_argument('--music-backend', default=None, choices=['stable', 'musicgen'], help='model for music (default: --backend if it can do music, else musicgen)')
    ap.add_argument('--only', default='', help='comma-separated sound/music names to (re)generate')
    ap.add_argument('--sfx-only', action='store_true')
    ap.add_argument('--music-only', action='store_true')
    ap.add_argument('--steps', type=int, default=60, help='diffusion steps (fewer = faster, lower quality)')
    ap.add_argument('--candidates', type=int, default=2, help='takes generated per kept variant; the best is kept')
    ap.add_argument('--seed', type=int, default=2026)
    ap.add_argument('--list', action='store_true', help='print the prompt sheet and exit')
    a = ap.parse_args()

    if a.list:
        for k, v in SFX.items():
            print(f'sfx   {k:14s} {v[1]:4.1f}s x{v[2]}  {v[0]}')
        for k, v in MUSIC.items():
            print(f'music {k:14s} {v[1]:4.1f}s     {v[0]}')
        return

    only = {s for s in a.only.split(',') if s}
    os.makedirs(os.path.join(OUT_DIR, 'sfx'), exist_ok=True)
    os.makedirs(os.path.join(OUT_DIR, 'music'), exist_ok=True)
    man_path = os.path.join(OUT_DIR, 'manifest.json')
    manifest = {'sfx': {}, 'music': {}, 'gain': {}, 'source': {}}
    if os.path.exists(man_path):
        with open(man_path) as f:
            manifest.update(json.load(f))

    def save():
        with open(man_path, 'w') as f:
            json.dump(manifest, f, indent=2, sort_keys=True)

    if not a.music_only:
        todo = [k for k in SFX if not only or k in only]
        if todo:
            be = BACKENDS[a.backend](a.steps)
            for i, name in enumerate(todo):
                prompt, secs, variants, target = SFX[name]
                t0 = time.time()
                takes = be.generate(prompt, SFX_NEG, secs + 0.5, variants * a.candidates, a.seed + i * 101)
                clips = [level(trim_and_fade(resample(t, be.sr).mean(axis=1, keepdims=True), secs), target) for t in takes]
                clips.sort(key=score, reverse=True)
                files = []
                for v, clip in enumerate(clips[:variants]):
                    rel = f'sfx/{name}_{v + 1}.mp3'
                    write_mp3(os.path.join(OUT_DIR, rel), clip, 96)
                    files.append(rel)
                manifest['sfx'][name] = files
                manifest['source'][name] = f'{be.model}: {prompt}'
                save()
                print(f'[{i + 1}/{len(todo)}] {name}: {len(files)} clip(s) in {time.time() - t0:.0f}s', flush=True)

    if not a.sfx_only:
        todo = [k for k in MUSIC if not only or k in only]
        if todo:
            mb = a.music_backend or ('stable' if a.backend == 'stable' else 'musicgen')
            be = BACKENDS[mb](a.steps)
            for i, mode in enumerate(todo):
                prompt, secs, target = MUSIC[mode]
                t0 = time.time()
                take = be.generate(prompt, MUSIC_NEG, secs, 1, a.seed + 7 + i)[0]
                x = resample(take, be.sr)
                if x.shape[1] == 1:
                    x = np.repeat(x, 2, axis=1)
                x = level(make_loop(x[:, :2]), target)
                rel = f'music/{mode}.mp3'
                write_mp3(os.path.join(OUT_DIR, rel), x, 160)
                manifest['music'][mode] = rel
                manifest['source']['music_' + mode] = f'{be.model}: {prompt}'
                save()
                print(f'[music {i + 1}/{len(todo)}] {mode}: {len(x) / SR:.1f}s loop in {time.time() - t0:.0f}s', flush=True)

    print('manifest:', man_path)


if __name__ == '__main__':
    sys.exit(main())
