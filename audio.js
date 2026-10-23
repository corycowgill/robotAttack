/* Robot Attack - procedural WebAudio sound engine.
 * Exposes window.GameAudio. No dependencies. All calls are safe no-ops
 * before unlock() or when WebAudio is unavailable. */
(function () {
  'use strict';

  // ---------- persisted settings ----------
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ } }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  var volume = 0.8;
  (function () { var v = parseFloat(lsGet('ra_volume')); if (isFinite(v)) volume = clamp(v, 0, 1); })();
  var muted = lsGet('ra_muted') === '1';
  var musicEnabled = lsGet('ra_music') !== '0';

  var MUSIC_LEVEL = 0.32;
  var MAX_VOICES = 24;
  var THROTTLE_MS = 40;

  // ---------- engine state ----------
  var ctx = null, triedCreate = false;
  var master, comp, sfxBus, uiBus, musicBus, reverbIn, noiseBuf;
  var mode = 'off', tension = false;
  var lastPlay = {}, activeVoices = 0;

  function ok() { return !!ctx; }
  function now() { return ctx.currentTime; }

  // ---------- small node helpers ----------
  function G(v) { var g = ctx.createGain(); g.gain.value = v == null ? 1 : v; return g; }
  function F(type, freq, q) {
    var f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    if (q != null) f.Q.value = q; return f;
  }
  function O(type, freq, t, dur) {
    var o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    o.start(t); o.stop(t + dur + 0.05); return o;
  }
  function N(t, dur) {
    var s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05); return s;
  }
  function chain() {
    for (var i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]);
    return arguments[arguments.length - 1];
  }
  // exponential envelope: silence -> peak in a -> 0.0001 after d
  function env(g, t, a, peak, d) {
    var p = g.gain;
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + Math.max(a, 0.001));
    p.exponentialRampToValueAtTime(0.0001, t + Math.max(a, 0.001) + d);
  }
  function sweep(param, from, to, t, dur) {
    param.setValueAtTime(from, t);
    param.exponentialRampToValueAtTime(to, t + dur);
  }
  function fadeTo(param, v, time) {
    var t = now();
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.setTargetAtTime(v, t, Math.max(time, 0.01) / 3);
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  // ---------- graph setup ----------
  function buildGraph() {
    var sr = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, Math.floor(sr * 2), sr);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    comp.knee.value = 8; comp.attack.value = 0.004; comp.release.value = 0.2;
    comp.connect(ctx.destination);

    master = G(muted ? 0 : volume);
    master.connect(comp);

    sfxBus = G(0.9); sfxBus.connect(master);
    uiBus = G(0.8); uiBus.connect(master);
    musicBus = G(musicEnabled ? MUSIC_LEVEL : 0); musicBus.connect(master);

    // reverb: generated stereo IR, 2s noise * e^(-3t)
    try {
      var len = Math.floor(sr * 2), ir = ctx.createBuffer(2, len, sr);
      for (var c = 0; c < 2; c++) {
        var ch = ir.getChannelData(c);
        for (var j = 0; j < len; j++) ch[j] = (Math.random() * 2 - 1) * Math.exp(-3 * j / sr);
      }
      var conv = ctx.createConvolver(); conv.buffer = ir;
      var ret = G(0.8); conv.connect(ret); ret.connect(master);
      reverbIn = conv;
      var mSend = G(0.3); musicBus.connect(mSend); mSend.connect(reverbIn);
    } catch (e) { reverbIn = null; }
  }

  // per-voice output: gain -> (panner) -> bus, plus reverb send
  function makeOut(opts, bus, rev) {
    var g = G(opts.gain == null ? 1 : clamp(+opts.gain || 0, 0, 1)), node = g;
    if (opts.pan && ctx.createStereoPanner) {
      try {
        var p = ctx.createStereoPanner(); p.pan.value = clamp(+opts.pan || 0, -1, 1);
        g.connect(p); node = p;
      } catch (e) { node = g; }
    }
    node.connect(bus);
    if (rev > 0 && reverbIn) { var s = G(rev); node.connect(s); s.connect(reverbIn); }
    return g;
  }

  // ---------- reusable sound pieces ----------
  function tone(o, type, f, t, a, peak, d, fEnd, filt) {
    var osc = O(type, f, t, a + d);
    if (fEnd) osc.frequency.exponentialRampToValueAtTime(fEnd, t + a + d);
    var g = G(0); env(g, t, a, peak, d);
    if (filt) chain(osc, filt, g, o); else chain(osc, g, o);
    return osc;
  }
  function noiseHit(o, t, type, freq, q, a, peak, d) {
    var n = N(t, a + d), f = F(type, freq, q), g = G(0);
    env(g, t, a, peak, d); chain(n, f, g, o);
    return f;
  }
  function crackle(o, t, count, spread, vol) {
    for (var i = 0; i < count; i++) {
      var tt = t + 0.04 + Math.random() * spread;
      noiseHit(o, tt, 'highpass', rnd(2500, 6000), 0.7, 0.001, vol * rnd(0.3, 1), rnd(0.01, 0.03));
    }
  }
  function clank(o, t, f1, f2, center, peak, d) {
    var bp = F('bandpass', center, 3), g = G(0);
    env(g, t, 0.002, peak, d);
    O('square', f1, t, d + 0.01).connect(bp);
    O('square', f2, t, d + 0.01).connect(bp);
    chain(bp, g, o);
  }
  function thump(o, t, f0, f1, dur, peak) {
    tone(o, 'sine', f0, t, 0.004, peak, dur, f1);
  }
  function chime(o, t, f, peak, d) {
    tone(o, 'sine', f, t, 0.005, peak, d);
    tone(o, 'triangle', f * 2, t, 0.005, peak * 0.15, d * 0.6);
  }

  // ---------- recipes: fn(out, t, pitch, opts) ----------
  var R = {};

  R.explosion = function (o, t, p, opts) {
    var big = !!opts.big;
    var n = N(t, big ? 2.8 : 1.5), lp = F('lowpass', 2500 * p, 0.8), g = G(0);
    sweep(lp.frequency, 2500 * p, 180 * p, t, big ? 1.4 : 0.9);
    env(g, t, 0.005, big ? 0.95 : 0.75, big ? 2.2 : 1.2);
    chain(n, lp, g, o);
    var subDur = big ? 0.6 : 0.35;
    thump(o, t, 90 * p, 32, subDur, big ? 0.9 : 0.75);
    if (big) {
      thump(o, t + 0.01, 60 * p, 24, subDur * 1.4, 0.8);
      noiseHit(o, t + 0.15, 'lowpass', 120, 0.7, 0.2, 0.5, 2.0); // long rumble tail
    }
    crackle(o, t, big ? 16 : 8, big ? 1.2 : 0.6, big ? 0.22 : 0.16);
  };

  R.flak = function (o, t, p) {
    var f = noiseHit(o, t, 'bandpass', 900 * p, 0.9, 0.003, 0.6, 0.35);
    sweep(f.frequency, 1400 * p, 300, t, 0.3);
    thump(o, t, 130 * p, 45, 0.18, 0.45);
    crackle(o, t, 4, 0.25, 0.12);
  };

  R.missileLaunch = function (o, t, p) {
    noiseHit(o, t, 'highpass', 1500, 0.7, 0.001, 0.5, 0.003); // click
    var n = N(t, 1.2), bp = F('bandpass', 400, 1.6), g = G(0);
    sweep(bp.frequency, 400 * p, 2500 * p, t, 1.0);
    env(g, t, 0.06, 0.55, 1.05);
    chain(n, bp, g, o);
    var saw = O('sawtooth', 70 * p, t, 0.9), lp = F('lowpass', 180, 1), rg = G(0);
    saw.frequency.exponentialRampToValueAtTime(55, t + 0.9);
    env(rg, t, 0.03, 0.3, 0.85);
    chain(saw, lp, rg, o);
  };

  R.incoming = function (o, t, p) {
    var osc = O('sine', 1800 * p, t, 1.85);
    osc.frequency.exponentialRampToValueAtTime(500 * p, t + 1.8);
    var lfo = O('sine', 5, t, 1.85), depth = G(18);
    chain(lfo, depth, osc.frequency);
    var g = G(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.25);
    g.gain.setValueAtTime(0.11, t + 1.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.82);
    chain(osc, g, o);
  };

  R.intercept = function (o, t, p) {
    tone(o, 'square', 1400 * p, t, 0.003, 0.16, 0.12, 300 * p, F('lowpass', 3000, 0.7));
    noiseHit(o, t + 0.01, 'highpass', 2000, 0.7, 0.002, 0.45, 0.07);
    thump(o, t + 0.01, 160 * p, 60, 0.12, 0.3);
  };

  R.shieldHit = function (o, t, p) {
    var mod = O('sine', 9, t, 0.9), md = G(14);
    md.gain.setValueAtTime(14, t); md.gain.exponentialRampToValueAtTime(2, t + 0.8);
    mod.connect(md);
    [220, 330].forEach(function (f, i) {
      var osc = O('sine', f * p, t, 0.9); md.connect(osc.frequency);
      var g = G(0); env(g, t, 0.006, i ? 0.18 : 0.25, 0.8); chain(osc, g, o);
    });
    var f = noiseHit(o, t, 'bandpass', 3200 * p, 4, 0.01, 0.12, 0.6);
    sweep(f.frequency, 3200 * p, 1800 * p, t, 0.6);
  };

  R.gunfire = function (o, t, p) {
    for (var i = 0; i < 4; i++) {
      var tt = t + i * 0.07, v = rnd(0.85, 1);
      noiseHit(o, tt, 'highpass', 1500 * p, 0.7, 0.001, 0.45 * v, 0.025);
      tone(o, 'square', 150 * p * rnd(0.97, 1.03), tt, 0.001, 0.14 * v, 0.03, 0, F('lowpass', 1200, 0.7));
    }
  };

  R.robotStep = function (o, t, p) {
    thump(o, t, 60 * p, 42, 0.16, 0.5);
    clank(o, t + 0.005, 420 * p, 630 * p, 1100 * p, 0.12, 0.08);
  };

  R.robotLand = function (o, t, p) {
    thump(o, t, 70 * p, 28, 0.45, 0.9);
    noiseHit(o, t, 'lowpass', 400, 0.7, 0.004, 0.6, 0.35);
    clank(o, t + 0.01, 400 * p, 600 * p, 1000 * p, 0.2, 0.15);
    crackle(o, t, 3, 0.2, 0.08);
  };

  R.robotPunch = function (o, t, p) {
    clank(o, t, 520 * p, 780 * p, 1300 * p, 0.22, 0.12);
    noiseHit(o, t, 'bandpass', 1500 * p, 1, 0.002, 0.5, 0.1);
    thump(o, t, 110 * p, 50, 0.12, 0.45);
  };

  R.robotDie = function (o, t, p) {
    tone(o, 'sawtooth', 420 * p, t, 0.01, 0.16, 0.8, 50, F('lowpass', 1400, 2));
    tone(o, 'square', 300 * p, t, 0.005, 0.05, 0.4, 40, F('lowpass', 900, 1));
    R.explosion(o, t + 0.25, p * 1.15, {});
    crackle(o, t, 8, 0.5, 0.12);
  };

  R.podLaunch = function (o, t, p) {
    noiseHit(o, t, 'highpass', 3000, 0.7, 0.005, 0.3, 0.35); // pneumatic hiss
    thump(o, t, 120 * p, 55, 0.2, 0.55);
    clank(o, t, 380 * p, 570 * p, 900 * p, 0.12, 0.1);
    var f = noiseHit(o, t + 0.05, 'bandpass', 300, 1.5, 0.08, 0.35, 0.7);
    sweep(f.frequency, 300 * p, 1800 * p, t + 0.05, 0.7);
  };

  R.build = function (o, t, p) {
    for (var i = 0; i < 3; i++) {
      var tt = t + i * 0.06;
      noiseHit(o, tt, 'bandpass', 3000, 2, 0.001, 0.25, 0.012);
      tone(o, 'square', 1800, tt, 0.001, 0.04, 0.012, 0, F('lowpass', 3500, 0.7));
    }
    chime(o, t + 0.22, 660 * p, 0.18, 0.45);
    chime(o, t + 0.32, 990 * p, 0.16, 0.6);
  };

  R.repair = function (o, t, p) {
    chime(o, t, 880 * p, 0.14, 0.35);
    chime(o, t + 0.08, 1320 * p, 0.12, 0.5);
    noiseHit(o, t, 'bandpass', 5000, 4, 0.05, 0.04, 0.3);
  };

  R.sell = function (o, t, p) {
    // reversed chime: swell up, then cut
    [990, 660].forEach(function (f, i) {
      var tt = t + i * 0.12, osc = O('sine', f * p, tt, 0.3), g = G(0);
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.16, tt + 0.22);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.26);
      chain(osc, g, o);
    });
    noiseHit(o, t + 0.36, 'bandpass', 2500, 2, 0.001, 0.12, 0.02);
  };

  R.destroyed = function (o, t, p) {
    var f = noiseHit(o, t, 'lowpass', 180, 0.8, 0.03, 0.75, 1.9);
    sweep(f.frequency, 220 * p, 70, t, 1.8);
    thump(o, t, 55 * p, 30, 1.2, 0.6);
    thump(o, t + 0.35, 48 * p, 25, 0.9, 0.45);
    for (var i = 0; i < 12; i++) {
      var tt = t + 0.15 + Math.pow(Math.random(), 1.3) * 1.3, v = 1 - (tt - t) / 1.6;
      noiseHit(o, tt, 'bandpass', rnd(700, 3000), 4, 0.001, 0.3 * v, rnd(0.015, 0.045));
      if (Math.random() < 0.4) clank(o, tt, rnd(300, 700), rnd(800, 1200), rnd(900, 1800), 0.06 * v, 0.05);
    }
  };

  R.uiHover = function (o, t) { tone(o, 'sine', 2000, t, 0.001, 0.04, 0.015); };
  R.uiClick = function (o, t) {
    tone(o, 'triangle', 900, t, 0.001, 0.16, 0.035);
    noiseHit(o, t, 'highpass', 4000, 0.7, 0.001, 0.04, 0.008);
  };
  R.select = function (o, t) {
    tone(o, 'triangle', 1200, t, 0.002, 0.09, 0.03);
    tone(o, 'triangle', 1600, t + 0.035, 0.002, 0.08, 0.05);
  };
  R.error = function (o, t) {
    var lp = F('lowpass', 1100, 0.7); lp.connect(o);
    tone(lp, 'square', 180, t, 0.004, 0.13, 0.08);
    tone(lp, 'square', 140, t + 0.09, 0.004, 0.13, 0.08);
  };

  R.turnStart = function (o, t, p) {
    var dl = ctx.createDelay(1.0), fb = G(0.35), wet = G(0.6), lp = F('lowpass', 3000, 0.5);
    dl.delayTime.value = 0.22;
    chain(dl, lp, fb, dl); lp.connect(wet); wet.connect(o);
    var osc = O('sine', 1200 * p, t, 0.35), g = G(0);
    env(g, t, 0.003, 0.22, 0.3);
    osc.connect(g); g.connect(o); g.connect(dl);
    tone(o, 'sine', 600 * p, t, 0.003, 0.05, 0.25);
  };

  R.endTurn = function (o, t) {
    tone(o, 'triangle', 800, t, 0.004, 0.12, 0.12, 700);
    tone(o, 'triangle', 600, t + 0.1, 0.004, 0.12, 0.2, 520);
    var f = noiseHit(o, t, 'bandpass', 1500, 1, 0.08, 0.05, 0.25);
    sweep(f.frequency, 2500, 600, t, 0.33);
  };

  R.alarm = function (o, t) {
    var lp = F('lowpass', 1800, 1), g = G(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13, t + 0.02);
    g.gain.setValueAtTime(0.13, t + 0.84);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    chain(lp, g, o);
    var s1 = O('sawtooth', 520, t, 0.9), s2 = O('sawtooth', 523, t, 0.9);
    for (var i = 0; i < 4; i++) {
      var f = i % 2 ? 400 : 520, tt = t + i * 0.225;
      s1.frequency.setValueAtTime(f, tt); s2.frequency.setValueAtTime(f * 1.006, tt);
    }
    s1.connect(lp); s2.connect(lp);
  };

  R.victory = function (o, t) {
    [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
      tone(o, 'triangle', f, t + i * 0.15, 0.005, 0.2, i === 3 ? 1.4 : 0.6);
    });
    var lp = F('lowpass', 1200, 0.5), g = G(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.5);
    g.gain.setValueAtTime(0.07, t + 1.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
    chain(lp, g, o);
    [261.63, 329.63, 392].forEach(function (f) {
      O('sawtooth', f, t, 3.0).connect(lp);
      O('sawtooth', f * 1.004, t, 3.0).connect(lp);
    });
  };

  R.defeat = function (o, t) {
    var lp = F('lowpass', 3000, 1.5);
    sweep(lp.frequency, 3000, 180, t, 2.4);
    lp.connect(o);
    [440, 329.63, 261.63, 220].forEach(function (f, i) {
      var tt = t + i * 0.28, last = i === 3;
      tone(lp, 'sawtooth', f, tt, 0.01, 0.12, last ? 1.8 : 0.5);
      tone(lp, 'triangle', f / 2, tt, 0.01, 0.12, last ? 1.8 : 0.5);
    });
  };

  // name -> [bus, duration(s) incl. tails, reverb send, pitch variation]
  var META = {
    explosion: ['sfx', 1.8, 0.22, 1], flak: ['sfx', 0.6, 0.2, 1],
    missileLaunch: ['sfx', 1.3, 0.2, 1], incoming: ['sfx', 1.9, 0.15, 1],
    intercept: ['sfx', 0.3, 0.2, 1], shieldHit: ['sfx', 1.0, 0.6, 1],
    gunfire: ['sfx', 0.4, 0.15, 1], robotStep: ['sfx', 0.25, 0.1, 1],
    robotLand: ['sfx', 0.6, 0.2, 1], robotPunch: ['sfx', 0.3, 0.15, 1],
    robotDie: ['sfx', 1.9, 0.25, 1], podLaunch: ['sfx', 0.9, 0.2, 1],
    build: ['sfx', 1.0, 0.2, 0], repair: ['sfx', 0.7, 0.25, 0],
    sell: ['sfx', 0.5, 0.2, 0], destroyed: ['sfx', 2.1, 0.3, 1],
    uiHover: ['ui', 0.05, 0, 0], uiClick: ['ui', 0.08, 0, 0],
    select: ['ui', 0.12, 0.05, 0], error: ['ui', 0.2, 0, 0],
    turnStart: ['ui', 1.8, 0.15, 0], endTurn: ['ui', 0.4, 0.1, 0],
    alarm: ['sfx', 1.0, 0.1, 0], victory: ['ui', 3.1, 0.3, 0],
    defeat: ['ui', 3.0, 0.3, 0]
  };

  // ---------- sample layer ----------
  // Optional pre-rendered clips listed in assets/audio/manifest.json
  // (generated offline by tools/gen_audio.py). Any sound or music mode
  // without a clip keeps using the procedural recipes above.
  var SAMPLE_DIR = 'assets/audio/';
  var samples = {}, sampleGain = {}, musicBufs = {}, track = null;

  function decode(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url); return r.arrayBuffer(); })
      .then(function (ab) {
        return new Promise(function (res, rej) {
          var p = ctx.decodeAudioData(ab, res, rej);
          if (p && p.then) p.then(res, rej);
        });
      });
  }

  function loadSamples() {
    if (typeof fetch !== 'function' || location.protocol === 'file:') return;
    fetch(SAMPLE_DIR + 'manifest.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (man) {
        if (!man) return;
        sampleGain = man.gain || {};
        Object.keys(man.sfx || {}).forEach(function (name) {
          (man.sfx[name] || []).forEach(function (file) {
            decode(SAMPLE_DIR + file).then(function (buf) {
              (samples[name] = samples[name] || []).push(buf);
            }).catch(function () { /* keep procedural */ });
          });
        });
        Object.keys(man.music || {}).forEach(function (m) {
          decode(SAMPLE_DIR + man.music[m]).then(function (buf) {
            musicBufs[m] = buf;
            applyMusic();
          }).catch(function () { /* keep procedural */ });
        });
      })
      .catch(function () { /* no manifest: procedural only */ });
  }

  function playSample(out, buf, t, pitch, gain) {
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch;
    var g = G(gain == null ? 1 : gain);
    chain(src, g, out);
    src.start(t);
    return buf.duration / pitch;
  }

  function musicFor(m) {
    if (musicBufs[m]) return musicBufs[m];
    if (m === 'menu') return musicBufs.planning || null;
    return null;
  }

  // Crossfade to a looping music clip (or to nothing)
  function setTrack(m) {
    var buf = m ? musicFor(m) : null;
    if (track && track.buf === buf) return;
    if (track) {
      var old = track;
      fadeTo(old.out.gain, 0.0001, 1.5);
      setTimeout(function () { try { old.src.stop(); old.out.disconnect(); } catch (e) { /* ignore */ } }, 2500);
      track = null;
    }
    if (!buf) return;
    var out = G(0.0001); out.connect(musicBus);
    var src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.connect(out); src.start();
    fadeTo(out.gain, sampleGain['music_' + m] || 1, 1.5);
    track = { buf: buf, src: src, out: out };
  }

  function play(name, opts) {
    try {
      if (!ok() || muted || !R.hasOwnProperty(name) || !META.hasOwnProperty(name)) return;
      if (ctx.state === 'closed') return;
      opts = opts || {};
      var m = META[name], nowMs = Date.now();
      if (lastPlay[name] && nowMs - lastPlay[name] < THROTTLE_MS) return;
      if (m[0] !== 'ui' && activeVoices >= MAX_VOICES) return;
      lastPlay[name] = nowMs;
      var big = name === 'explosion' && opts.big;
      var out = makeOut(opts, m[0] === 'ui' ? uiBus : sfxBus, big ? 0.45 : m[2]);
      var pitch = m[3] ? 1 + (Math.random() * 0.1 - 0.05) : 1;
      var key = big && samples.explosionBig ? 'explosionBig' : name;
      var bufs = samples[key], dur;
      if (bufs && bufs.length) {
        var gain = (sampleGain[key] || 1) * (big && key === name ? 1.3 : 1);
        dur = playSample(out, bufs[Math.floor(Math.random() * bufs.length)], now() + 0.005, pitch, gain) + 0.3;
      } else {
        R[name](out, now() + 0.005, pitch, opts);
        dur = (big ? 3.0 : m[1]) + 0.3;
      }
      activeVoices++;
      setTimeout(function () {
        activeVoices = Math.max(0, activeVoices - 1);
        try { out.disconnect(); } catch (e) { /* ignore */ }
      }, dur * 1000);
    } catch (e) { /* never throw */ }
  }

  // ---------- music / ambient ----------
  var bed = null, combat = null, tens = null;
  var A_MINOR = [220, 261.63, 329.63, 392, 440, 523.25, 587.33, 659.25];

  function stopNodes(list) {
    list.forEach(function (n) { try { n.stop(); } catch (e) { /* ignore */ } });
  }

  function startBed() {
    if (bed) { bed.token++; fadeTo(bed.out.gain, 1, 2.0); return; }
    var out = G(0.0001); out.connect(musicBus);
    var lp = F('lowpass', 450, 2.5);
    var s1 = ctx.createOscillator(), s2 = ctx.createOscillator();
    s1.type = s2.type = 'sawtooth'; s1.frequency.value = 55; s2.frequency.value = 55.4;
    var sg = G(0.16);
    s1.connect(lp); s2.connect(lp); chain(lp, sg, out);
    var lfo = ctx.createOscillator(), ld = G(250); lfo.frequency.value = 0.07;
    chain(lfo, ld, lp.frequency);
    var wn = ctx.createBufferSource(); wn.buffer = noiseBuf; wn.loop = true;
    var bp = F('bandpass', 500, 0.7), wg = G(0.05);
    var wl = ctx.createOscillator(), wld = G(0.035); wl.frequency.value = 0.11;
    chain(wl, wld, wg.gain);
    chain(wn, bp, wg, out);
    var nodes = [s1, s2, lfo, wn, wl];
    nodes.forEach(function (n) { n.start(); });
    bed = { out: out, nodes: nodes, token: 0, sonar: null };
    fadeTo(out.gain, 1, 2.0);
    scheduleSonar(bed, 2500 + Math.random() * 3000);
  }

  function scheduleSonar(b, ms) {
    b.sonar = setTimeout(function () {
      b.sonar = null;
      if (bed !== b || !ok()) return;
      try {
        var t = now() + 0.02, f = A_MINOR[Math.floor(Math.random() * A_MINOR.length)];
        var osc = O('sine', f, t, 3.2), g = G(0);
        env(g, t, 0.03, 0.06, 3.0); chain(osc, g, b.out);
        var o2 = O('sine', f * 2.01, t, 1.6), g2 = G(0);
        env(g2, t, 0.02, 0.012, 1.4); chain(o2, g2, b.out);
      } catch (e) { /* ignore */ }
      scheduleSonar(b, 5000 + Math.random() * 7000);
    }, ms);
  }

  function stopBed() {
    if (!bed) return;
    var b = bed, tok = ++b.token;
    fadeTo(b.out.gain, 0.0001, 1.5);
    setTimeout(function () {
      if (bed !== b || b.token !== tok) return;
      stopNodes(b.nodes);
      if (b.sonar) clearTimeout(b.sonar);
      try { b.out.disconnect(); } catch (e) { /* ignore */ }
      bed = null;
    }, 3000);
  }

  var BASS = [55, 55, 82.41, 55, 55, 82.41, 55, 82.41, 55, 55, 82.41, 55, 49, 49, 65.41, 73.42];

  function combatStep(c, step, t) {
    var o = c.out, f = BASS[step];
    // bass: saw + square through a plucky resonant lowpass
    var lp = F('lowpass', 1100, 6), g = G(0);
    sweep(lp.frequency, step % 4 === 0 ? 1300 : 1000, 220, t, 0.18);
    env(g, t, 0.004, 0.2, 0.22);
    chain(lp, g, o);
    O('sawtooth', f, t, 0.24).connect(lp);
    var sq = O('square', f * 0.998, t, 0.24), sqg = G(0.4); chain(sq, sqg, lp);
    // hihat
    var off = step % 2 === 1;
    var n = N(t, 0.05), hp = F('highpass', 7000, 0.7), hg = G(0);
    env(hg, t, 0.001, off ? 0.05 : 0.025, off ? 0.05 : 0.03);
    chain(n, hp, hg, o);
    // soft kick on quarter downbeats
    if (step % 4 === 0) {
      var k = O('sine', 110, t, 0.25), kg = G(0);
      k.frequency.exponentialRampToValueAtTime(42, t + 0.2);
      env(kg, t, 0.003, 0.28, 0.22); chain(k, kg, o);
    }
  }

  function combatTick() {
    var c = combat;
    if (!c || !ok()) return;
    try {
      var t = now();
      if (c.next < t - 0.2) c.next = t + 0.05; // recover after timer throttling
      while (c.next < t + 0.1) {
        combatStep(c, c.step, c.next);
        c.next += 0.25; // 8th notes @ 120bpm
        c.step = (c.step + 1) % 16;
      }
    } catch (e) { /* ignore */ }
  }

  function startCombat() {
    if (!combat) {
      var out = G(0.0001); out.connect(musicBus);
      combat = { out: out, timer: null, next: 0, step: 0, token: 0 };
    }
    combat.token++;
    if (!combat.timer) {
      combat.next = now() + 0.1; combat.step = 0;
      combat.timer = setInterval(combatTick, 25);
    }
    fadeTo(combat.out.gain, 1, 1.0);
  }

  function stopCombat() {
    if (!combat) return;
    var c = combat, tok = ++c.token;
    fadeTo(c.out.gain, 0.0001, 1.0);
    setTimeout(function () {
      if (combat !== c || c.token !== tok) return;
      if (c.timer) clearInterval(c.timer);
      c.timer = null;
    }, 1600);
  }

  function updateTension(on) {
    if (on) {
      if (!tens) {
        var out = G(0.0001); out.connect(musicBus);
        var osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 1318.5;
        var amp = G(0.5), lfo = ctx.createOscillator(), depth = G(0.5);
        lfo.frequency.value = 2; chain(lfo, depth, amp.gain);
        chain(osc, amp, out);
        osc.start(); lfo.start();
        tens = { out: out, nodes: [osc, lfo], token: 0 };
      }
      tens.token++;
      fadeTo(tens.out.gain, 0.06, 1.0);
    } else if (tens) {
      var tn = tens, tok = ++tn.token;
      fadeTo(tn.out.gain, 0.0001, 1.0);
      setTimeout(function () {
        if (tens !== tn || tn.token !== tok) return;
        stopNodes(tn.nodes);
        try { tn.out.disconnect(); } catch (e) { /* ignore */ }
        tens = null;
      }, 2000);
    }
  }

  function applyMusic() {
    if (!ok()) return;
    try {
      var m = musicEnabled ? mode : 'off';
      var clip = m !== 'off' && musicFor(m);
      setTrack(clip ? m : null);
      if (!clip && (m === 'menu' || m === 'planning' || m === 'combat')) startBed(); else stopBed();
      if (!clip && m === 'combat') startCombat(); else stopCombat();
      updateTension(tension && m !== 'off');
    } catch (e) { /* ignore */ }
  }

  // ---------- public API ----------
  function unlock() {
    try {
      if (!ctx && !triedCreate) {
        triedCreate = true;
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        var c = new AC();
        ctx = c;
        try { buildGraph(); } catch (e) { ctx = null; try { c.close(); } catch (e2) { /* ignore */ } return; }
        applyMusic();
        loadSamples();
      }
      if (ctx && ctx.state === 'suspended' && ctx.resume) {
        var pr = ctx.resume();
        if (pr && pr.catch) pr.catch(function () { /* ignore */ });
      }
    } catch (e) { /* never throw */ }
  }

  function setMode(m) {
    if (m !== 'menu' && m !== 'planning' && m !== 'combat' && m !== 'off') return;
    if (m === mode) return;
    mode = m;
    applyMusic();
  }

  function setTension(b) {
    b = !!b;
    if (b === tension) return;
    tension = b;
    applyMusic();
  }

  function setVolume(v) {
    v = +v;
    if (!isFinite(v)) return;
    volume = clamp(v, 0, 1);
    lsSet('ra_volume', volume);
    try { if (ok() && !muted) fadeTo(master.gain, volume, 0.06); } catch (e) { /* ignore */ }
  }

  function toggleMute() {
    muted = !muted;
    lsSet('ra_muted', muted ? '1' : '0');
    try { if (ok()) fadeTo(master.gain, muted ? 0 : volume, 0.06); } catch (e) { /* ignore */ }
    return muted;
  }

  function setMusicEnabled(b) {
    musicEnabled = !!b;
    lsSet('ra_music', musicEnabled ? '1' : '0');
    try {
      if (ok()) { fadeTo(musicBus.gain, musicEnabled ? MUSIC_LEVEL : 0, 0.8); applyMusic(); }
    } catch (e) { /* ignore */ }
  }

  window.GameAudio = {
    unlock: unlock,
    play: play,
    setMode: setMode,
    getMode: function () { return mode; },
    setTension: setTension,
    setVolume: setVolume,
    getVolume: function () { return volume; },
    toggleMute: toggleMute,
    isMuted: function () { return muted; },
    setMusicEnabled: setMusicEnabled,
    isMusicEnabled: function () { return musicEnabled; }
  };
})();
