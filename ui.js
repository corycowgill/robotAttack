// ============================================================
// Robot Attack 2026 — DOM user interface
// ============================================================
// HUD, build bar, order queue, selection panel, toasts, tooltips,
// banners, turn report, objectives, menus and help. The UI holds no
// game state: main.js pushes view data in and receives callbacks.

window.UI = (function () {
  'use strict';

  let H = {};       // handlers
  let root;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── Icons (inline SVG, 24x24, stroke = currentColor) ─────
  const ICON = {
    hq: '<path d="M4 20V10l8-6 8 6v10z"/><path d="M9 20v-6h6v6"/><path d="M12 4V1"/>',
    depot: '<rect x="3" y="9" width="18" height="11"/><path d="M3 9l3-5h12l3 5"/><path d="M8 13h8M8 16h8"/>',
    power: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
    radar: '<path d="M4 20a8 8 0 0 1 8-8"/><path d="M12 12L4 4"/><circle cx="12" cy="12" r="2"/><path d="M12 20V14"/><path d="M8 20h8"/><path d="M16 4a10 10 0 0 1 4 4"/>',
    silo: '<path d="M12 2c3 3 4 6 4 10v6H8v-6c0-4 1-7 4-10z"/><path d="M8 15l-3 4h3M16 15l3 4h-3"/>',
    aa: '<path d="M5 20h14"/><path d="M8 20v-5h8v5"/><path d="M11 15l6-10M13 15l6-9"/>',
    shield: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/>',
    hangar: '<path d="M3 20V11a9 9 0 0 1 18 0v9"/><path d="M7 20v-6h10v6"/><path d="M7 17h10"/>',
    gunpod: '<circle cx="10" cy="14" r="5"/><path d="M14 12h7M14 15h7"/><path d="M6 20h8"/>',
    missile: '<path d="M4 20l5-5"/><path d="M9 15l8-8 3-3-1 4-8 8z"/><path d="M8 11l-3 1M13 16l-1 3"/>',
    drop: '<path d="M12 3c3 2 4 5 4 9H8c0-4 1-7 4-9z"/><path d="M8 12l-2 5M16 12l2 5M12 12v6"/><path d="M5 21h14"/>',
    repair: '<path d="M14 6a4 4 0 0 0-5 5l-6 6 3 3 6-6a4 4 0 0 0 5-5l-3 3-3-3z"/>',
    sell: '<circle cx="12" cy="12" r="9"/><path d="M15 9c-1-1-5-1-5 1s5 1 5 3-4 2-5 1M12 6v2M12 16v2"/>',
    end: '<path d="M6 4l12 8-12 8z"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
    mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    log: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    decoy: '<path d="M6 20V11a6 6 0 0 1 12 0v9l-2-1.5L14 20l-2-1.5L10 20l-2-1.5z"/><path d="M9.5 11h.01M14.5 11h.01"/>',
    uplink: '<path d="M7 21l3-9h4l3 9"/><path d="M8.5 17h7"/><ellipse cx="12" cy="7" rx="6" ry="2"/><circle cx="12" cy="7" r="1"/><path d="M12 5V2"/>',
    strike: '<path d="M12 2v7"/><path d="M9 4l3 5 3-5"/><circle cx="12" cy="16" r="5"/><circle cx="12" cy="16" r="1.5"/><path d="M12 9v2M5 16h2M17 16h2"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    credits: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M3 11h18"/>',
    energy: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>'
  };
  function icon(name, cls) {
    return '<svg class="ico ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICON[name] || '') + '</svg>';
  }

  const CSS = `
  :root { --c-bg: rgba(10,14,20,.86); --c-bg2: rgba(18,24,33,.92); --c-line: rgba(120,160,200,.18); --c-text: #d8e3ee; --c-dim: #7d8fa3;
    --c-player: #2ec4ff; --c-ai: #ff4422; --c-credit: #66ff99; --c-energy: #ffd23f; --c-shield: #9d7cff; --c-warn: #ffb000; --c-bad: #ff4a3d; }
  #ui { position: fixed; inset: 0; pointer-events: none; font-family: 'Rajdhani', 'Segoe UI', system-ui, sans-serif; color: var(--c-text); z-index: 10; user-select: none; }
  #ui * { box-sizing: border-box; }
  #ui .pi { pointer-events: auto; }
  .ico { width: 20px; height: 20px; flex: none; }
  .panel { background: var(--c-bg); border: 1px solid var(--c-line); border-radius: 10px; backdrop-filter: blur(6px); box-shadow: 0 8px 30px rgba(0,0,0,.35); }
  .mono { font-family: 'Share Tech Mono', ui-monospace, monospace; }
  kbd { font-family: 'Share Tech Mono', monospace; font-size: 11px; padding: 1px 5px; border: 1px solid rgba(255,255,255,.25); border-bottom-width: 2px; border-radius: 4px; color: #cfe6ff; background: rgba(255,255,255,.06); }

  /* HUD */
  #hud { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); display: flex; align-items: stretch; gap: 0; padding: 0; overflow: hidden; }
  #hud .cell { white-space: nowrap; padding: 8px 16px; display: flex; flex-direction: column; justify-content: center; border-right: 1px solid var(--c-line); min-width: 110px; }
  #hud .cell:last-child { border-right: none; }
  #hud .lbl { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--c-dim); display: flex; align-items: center; gap: 6px; }
  #hud .val { font-size: 22px; font-weight: 700; line-height: 1.05; font-variant-numeric: tabular-nums; }
  #hud .inc { font-size: 13px; color: var(--c-dim); font-weight: 600; margin-left: 4px; }
  #hud .bar { height: 5px; background: rgba(255,255,255,.08); border-radius: 3px; margin-top: 4px; overflow: hidden; }
  #hud .bar > i { display: block; height: 100%; border-radius: 3px; transition: width .35s; }
  #hud-turn { text-align: center; min-width: 150px !important; }
  #hud-turn .val { font-size: 20px; letter-spacing: .08em; }
  #hud-phase { font-size: 12px; letter-spacing: .2em; text-transform: uppercase; color: var(--c-warn); }
  .hq-cell { min-width: 150px !important; }
  #hud .full { animation: pulse 1s infinite; }
  @keyframes pulse { 50% { opacity: .45; } }

  /* top-right buttons */
  #sysbtns { position: absolute; top: 12px; right: 12px; display: flex; gap: 6px; }
  .iconbtn { width: 38px; height: 38px; display: grid; place-items: center; cursor: pointer; color: var(--c-text); }
  .iconbtn:hover { color: #fff; border-color: rgba(46,196,255,.6); }
  #vol { width: 90px; accent-color: var(--c-player); }

  /* Build bar */
  #dock { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; align-items: flex-end; transition: transform .35s, opacity .35s; max-width: calc(100vw - 16px); }
  #dock.hidden { transform: translate(-50%, 140%); opacity: 0; }
  #cards { display: flex; gap: 6px; padding: 8px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
  .card { flex: none; width: clamp(64px, 5.7vw, 92px); height: clamp(76px, 5.9vw, 92px); border-radius: 8px; border: 1px solid var(--c-line); background: var(--c-bg2); cursor: pointer; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; transition: transform .12s, border-color .12s, background .12s; }
  .card .ico { width: 30px; height: 30px; color: var(--c-player); }
  .card .nm { font-size: 13px; font-weight: 700; letter-spacing: .02em; text-align: center; line-height: 1; }
  .card .cost { font-size: 13px; color: var(--c-credit); font-weight: 700; }
  .card .key { position: absolute; top: 4px; left: 6px; font-size: 11px; color: var(--c-dim); font-family: 'Share Tech Mono', monospace; }
  .card .cnt { position: absolute; top: 4px; right: 6px; font-size: 11px; color: var(--c-dim); }
  .card:hover { transform: translateY(-3px); border-color: rgba(46,196,255,.55); }
  .card.sel { border-color: var(--c-player); background: rgba(46,196,255,.16); box-shadow: 0 0 18px rgba(46,196,255,.35) inset; }
  .card.off { opacity: .42; }
  .card.off .cost { color: var(--c-bad); }
  #actions { display: flex; gap: 8px; padding: 8px; }
  .abtn { min-width: clamp(80px, 7.2vw, 112px); height: 92px; border-radius: 8px; border: 1px solid var(--c-line); background: var(--c-bg2); color: var(--c-text); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; font-family: inherit; font-size: 14px; font-weight: 700; letter-spacing: .04em; position: relative; transition: transform .12s, background .12s, border-color .12s; }
  .abtn .ico { width: 28px; height: 28px; }
  .abtn small { font-size: 12px; font-weight: 600; color: var(--c-dim); }
  .abtn:hover { transform: translateY(-3px); }
  .abtn.fire .ico { color: var(--c-warn); } .abtn.fire.sel { border-color: var(--c-warn); background: rgba(255,176,0,.15); }
  .abtn.drop .ico { color: var(--c-player); } .abtn.drop.sel { border-color: var(--c-player); background: rgba(46,196,255,.15); }
  .abtn.strike .ico { color: #3dffc8; } .abtn.strike.sel { border-color: #3dffc8; background: rgba(61,255,200,.14); }
  .abtn.strike.ready:not(.off) { border-color: rgba(61,255,200,.7); animation: glowStrike 1.2s infinite; }
  @keyframes glowStrike { 50% { box-shadow: 0 0 18px rgba(61,255,200,.55); } }
  .order.strike .ico, .order.incoming.strike .ico { color: #3dffc8; }
  .abtn.end { background: linear-gradient(180deg, rgba(46,196,255,.28), rgba(46,196,255,.12)); border-color: rgba(46,196,255,.6); min-width: clamp(92px, 8vw, 128px); }
  .abtn.end .ico { color: #fff; }
  .abtn.end.ready { animation: glow 1.4s infinite; }
  @keyframes glow { 50% { box-shadow: 0 0 22px rgba(46,196,255,.65); } }
  .abtn.off { opacity: .4; }
  .abtn .badge { position: absolute; top: 6px; right: 8px; font-size: 12px; color: var(--c-dim); }

  /* Side panels */
  #orders { position: absolute; right: 12px; top: 74px; width: 250px; max-height: max(200px, calc(100vh - 480px)); display: flex; flex-direction: column; overflow: hidden; }
  .ph { padding: 8px 12px; font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: var(--c-dim); border-bottom: 1px solid var(--c-line); display: flex; justify-content: space-between; align-items: center; }
  #orderlist { padding: 6px; display: flex; flex-direction: column; gap: 4px; }
  .order { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,.04); font-size: 14px; }
  .order .ico { width: 18px; height: 18px; }
  .order .x { margin-left: auto; cursor: pointer; color: var(--c-dim); font-size: 16px; padding: 0 4px; }
  .order .x:hover { color: var(--c-bad); }
  .order.missile .ico { color: var(--c-warn); } .order.drop .ico { color: var(--c-player); } .order.incoming { background: rgba(255,60,40,.12); } .order.incoming .ico { color: var(--c-bad); }
  .empty { color: var(--c-dim); font-size: 13px; padding: 6px 8px; }
  #log { flex: 1; overflow-y: auto; padding: 6px 10px 10px; font-size: 13px; line-height: 1.35; min-height: 60px; max-height: 32vh; }
  #log div { padding: 1px 0; color: #aab8c6; }
  #log .player { color: #8fdcff; } #log .enemy { color: #ff9a85; } #log .good { color: var(--c-credit); } #log .bad { color: var(--c-bad); } #log .sys { color: var(--c-warn); }
  #log .turn { color: var(--c-dim); letter-spacing: .12em; text-transform: uppercase; font-size: 11px; margin-top: 6px; border-top: 1px solid var(--c-line); padding-top: 4px; }

  #selected { position: absolute; right: 12px; bottom: 128px; width: 250px; padding: 12px 14px; display: none; max-height: calc(100vh - 452px); overflow-y: auto; }
  #selected.show { display: block; }
  #selected h3 { margin: 0 0 2px; font-size: 20px; display: flex; align-items: center; gap: 8px; }
  #selected .side { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; }
  #selected .hpb { height: 8px; background: rgba(255,255,255,.08); border-radius: 4px; margin: 8px 0 4px; overflow: hidden; }
  #selected .hpb i { display: block; height: 100%; }
  #selected .desc { font-size: 14px; color: #b9c6d3; margin: 6px 0; line-height: 1.3; }
  #selected ul { margin: 0; padding-left: 16px; font-size: 13px; color: var(--c-dim); }
  #selected .btns { display: flex; gap: 6px; margin-top: 10px; }
  .sbtn { flex: 1; padding: 7px 8px; border-radius: 6px; border: 1px solid var(--c-line); background: rgba(255,255,255,.05); color: var(--c-text); font-family: inherit; font-size: 14px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; }
  .sbtn:hover { border-color: rgba(46,196,255,.6); }
  .sbtn.off { opacity: .4; pointer-events: none; }
  .sbtn .ico { width: 16px; height: 16px; }
  .sbtn.up { border-color: rgba(255,200,60,.5); color: #ffe39a; }

  #objectives { position: absolute; left: 0; right: 0; margin: 0 auto; width: fit-content; top: 84px; max-width: min(560px, calc(100vw - 560px)); padding: 6px 12px; display: flex; align-items: center; gap: 10px; }
  #objectives h4 { margin: 0; font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: var(--c-warn); white-space: nowrap; }
  #objectives .x { cursor: pointer; color: var(--c-dim); font-size: 16px; padding-left: 4px; }
  #objectives .obj { padding: 0; }
  .obj { font-size: 13px; padding: 2px 0; display: flex; gap: 8px; color: #c5d2de; line-height: 1.25; }
  .obj b { color: var(--c-player); width: 16px; flex: none; }
  .obj.done { color: var(--c-dim); text-decoration: line-through; } .obj.done b { color: var(--c-credit); }
  .obj.cur { color: #fff; }

  /* Toast, tooltip, banner, floating text */
  #toasts { position: absolute; left: 50%; top: 132px; z-index: 2; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .toast { padding: 8px 16px; border-radius: 8px; font-size: 16px; font-weight: 700; background: var(--c-bg2); border: 1px solid var(--c-line); animation: tin .2s ease-out, tout .4s ease-in 1.8s forwards; }
  .toast.bad { border-color: rgba(255,74,61,.6); color: #ffb1a8; } .toast.good { border-color: rgba(102,255,153,.5); color: #b6ffd0; } .toast.warn { border-color: rgba(255,176,0,.6); color: #ffd98a; }
  @keyframes tin { from { opacity: 0; transform: translateY(-8px); } } @keyframes tout { to { opacity: 0; transform: translateY(-8px); } }
  #tip { position: absolute; max-width: 300px; padding: 10px 12px; font-size: 14px; line-height: 1.35; display: none; z-index: 5; }
  #tip b { font-size: 16px; } #tip .k { color: var(--c-dim); font-size: 13px; } #tip .bad { color: var(--c-bad); } #tip .cnt { color: var(--c-warn); font-size: 13px; }
  #banner { position: absolute; left: 0; right: 0; top: 30%; text-align: center; pointer-events: none; opacity: 0; }
  #banner.show { animation: ban 1.7s ease-out forwards; }
  #banner .t { font-size: 64px; font-weight: 700; letter-spacing: .25em; text-shadow: 0 0 30px rgba(46,196,255,.6); }
  #banner .s { font-size: 18px; letter-spacing: .3em; color: var(--c-dim); text-transform: uppercase; }
  #banner.red .t { color: #ff6a55; text-shadow: 0 0 30px rgba(255,68,34,.7); }
  @keyframes ban { 0% { opacity: 0; transform: scale(1.15); letter-spacing: .5em; } 15% { opacity: 1; transform: scale(1); } 75% { opacity: 1; } 100% { opacity: 0; } }
  .float { position: absolute; font-weight: 700; font-size: 18px; pointer-events: none; text-shadow: 0 2px 4px #000, 0 0 10px rgba(0,0,0,.8); animation: flt 1.1s ease-out forwards; transform: translate(-50%, -50%); white-space: nowrap; }
  .float.dmg { color: #ff6650; } .float.big { font-size: 26px; } .float.shield { color: #c3b0ff; } .float.heal { color: var(--c-credit); } .float.info { color: #ffd98a; font-size: 15px; } .float.blue { color: #8fdcff; }
  @keyframes flt { 0% { opacity: 0; margin-top: 0; } 12% { opacity: 1; } 100% { opacity: 0; margin-top: -42px; } }
  #combathint { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); padding: 8px 16px; font-size: 14px; color: var(--c-dim); display: none; gap: 16px; }
  #combathint.show { display: flex; }

  /* Report */
  #report { position: absolute; left: 50%; bottom: 128px; transform: translateX(-50%); width: 420px; padding: 14px 18px; display: none; pointer-events: none; }
  #report.show { display: block; animation: tin .25s ease-out; }
  #report h2 { margin: 0 0 10px; font-size: 22px; letter-spacing: .14em; text-transform: uppercase; }
  #report .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  #report h5 { margin: 0 0 4px; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; }
  #report .row { font-size: 14px; display: flex; justify-content: space-between; color: #c5d2de; padding: 1px 0; }
  #report .row b { font-variant-numeric: tabular-nums; }
  #report .lost { font-size: 13px; color: var(--c-dim); margin-top: 4px; }
  #report .foot { margin-top: 12px; font-size: 13px; color: var(--c-dim); display: flex; justify-content: space-between; }

  /* Menus */
  .screen { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; background: radial-gradient(ellipse at center, rgba(5,8,12,.55), rgba(5,8,12,.92)); pointer-events: auto; }
  .screen.show { display: flex; }
  .menu-box { width: min(880px, 94vw); text-align: center; }
  .title { font-size: clamp(42px, 7vw, 86px); font-weight: 700; letter-spacing: .18em; line-height: .95; background: linear-gradient(180deg, #fff, #8fdcff 55%, #2ec4ff); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0 24px rgba(46,196,255,.35)); }
  .title span { display: block; font-size: .32em; letter-spacing: .6em; color: var(--c-ai); -webkit-text-fill-color: var(--c-ai); margin-top: 8px; }
  .tag { color: var(--c-dim); letter-spacing: .3em; text-transform: uppercase; font-size: 13px; margin: 18px 0 28px; }
  .diffs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .diff { padding: 18px 16px; cursor: pointer; text-align: left; transition: transform .15s, border-color .15s; }
  .diff:hover { transform: translateY(-4px); border-color: rgba(46,196,255,.7); }
  .diff h3 { margin: 0 0 6px; font-size: 24px; letter-spacing: .1em; text-transform: uppercase; }
  .diff p { margin: 0; font-size: 14px; color: #a9b8c7; line-height: 1.35; }
  .diff .lvl { font-size: 12px; letter-spacing: .2em; color: var(--c-warn); margin-bottom: 6px; }
  .diff.d2 h3 { color: #ffd98a; } .diff.d3 h3 { color: #ff8a75; }
  .menu-foot { margin-top: 22px; display: flex; gap: 12px; justify-content: center; align-items: center; color: var(--c-dim); font-size: 14px; flex-wrap: wrap; }
  .lnk { cursor: pointer; color: #8fdcff; text-decoration: underline; text-underline-offset: 3px; }
  .chk { display: flex; gap: 6px; align-items: center; cursor: pointer; }
  .warnline { display: none; margin: 0 auto 14px; max-width: 560px; padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255,176,0,.6); background: rgba(255,176,0,.1); color: #ffd98a; font-size: 15px; text-align: center; }
  .warnline.show { display: block; }
  .sect { margin: 4px 0 10px; font-size: 13px; letter-spacing: .28em; text-transform: uppercase; color: var(--c-dim); display: flex; align-items: center; gap: 12px; }
  .sect::before, .sect::after { content: ''; flex: 1; height: 1px; background: var(--c-line); }
  .missions { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 22px; }
  .mission { padding: 10px 10px 12px; cursor: pointer; text-align: left; position: relative; transition: transform .15s, border-color .15s; }
  .mission:hover { transform: translateY(-3px); border-color: rgba(46,196,255,.7); }
  .mission .num { font-size: 11px; letter-spacing: .2em; color: var(--c-warn); }
  .mission h4 { margin: 2px 0 4px; font-size: 16px; line-height: 1.1; }
  .mission .vs { font-size: 12px; color: var(--c-dim); display: flex; align-items: center; gap: 6px; }
  .mission .vs svg { width: 28px; height: 28px; flex: none; }
  .mission.locked { opacity: .38; cursor: not-allowed; }
  .mission.locked:hover { transform: none; border-color: var(--c-line); }
  .mission .badge { position: absolute; top: 8px; right: 10px; font-size: 13px; }
  .mission.done .badge { color: var(--c-credit); }
  .star { color: #3a4654; }
  .star.on { color: #ffcf4a; text-shadow: 0 0 8px rgba(255,207,74,.55); }
  .medals { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; margin: 10px 0 14px; }
  .medal { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid var(--c-line); border-radius: 4px; font-size: 13px; color: var(--c-dim); }
  .medal .star { font-size: 18px; }
  .medal.on { color: var(--c-text); border-color: rgba(255,207,74,.5); }
  #go-medals .medal { opacity: 0; transform: scale(.6); animation: medalIn .35s ease-out forwards; }
  #go-medals .medal:nth-child(2) { animation-delay: .35s; } #go-medals .medal:nth-child(3) { animation-delay: .7s; }
  #go-medals .newbest { width: 100%; text-align: center; font-size: 12px; letter-spacing: .2em; color: #ffcf4a; opacity: 0; animation: medalIn .35s 1.05s ease-out forwards; }
  @keyframes medalIn { to { opacity: 1; transform: none; } }
  #briefing .menu-box { width: min(860px, 94vw); padding: 26px 28px; text-align: left; }
  #briefing h2 { margin: 0 0 4px; font-size: 30px; letter-spacing: .14em; text-transform: uppercase; }
  #briefing .sub { color: var(--c-dim); letter-spacing: .2em; font-size: 12px; text-transform: uppercase; margin-bottom: 18px; }
  .speakers { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 20px; }
  .speaker { display: flex; gap: 14px; align-items: flex-start; padding: 14px; border-radius: 10px; background: rgba(255,255,255,.04); border: 1px solid var(--c-line); }
  .speaker svg { width: 96px; height: 96px; flex: none; }
  .speaker .who { font-weight: 700; font-size: 18px; } .speaker .role { font-size: 12px; color: var(--c-dim); letter-spacing: .1em; text-transform: uppercase; margin-bottom: 6px; }
  .speaker .say { font-size: 15px; line-height: 1.4; color: #d3dee9; }
  .speaker.enemy .say { color: #ffb4a6; font-style: italic; }
  #gameover .menu-box { width: min(660px, 94vw); padding: 28px; }
  .opts { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 18px; margin: 0 0 12px; }
  .opt { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--c-dim); letter-spacing: .06em; }
  .opt .seg { display: flex; border: 1px solid var(--c-line); border-radius: 6px; overflow: hidden; }
  .opt button { background: var(--c-bg2); color: var(--c-text); border: 0; border-right: 1px solid var(--c-line); padding: 5px 10px; font: inherit; font-weight: 700; font-size: 13px; cursor: pointer; }
  .opt button:last-child { border-right: 0; }
  .opt button.on { background: rgba(46,196,255,.22); color: #fff; }
  body.compact .opts { gap: 6px 10px; margin-bottom: 8px; } body.compact .opt { font-size: 11px; } body.compact .opt button { padding: 4px 7px; font-size: 11px; }
  .hotseat { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 12px; padding: 12px 16px; cursor: pointer; text-align: left; transition: transform .15s, border-color .15s; }
  .hotseat:hover { transform: translateY(-3px); border-color: rgba(46,196,255,.7); }
  .hotseat h3 { margin: 0 0 2px; font-size: 18px; letter-spacing: .12em; } .hotseat p { margin: 0; font-size: 13px; color: var(--c-dim); }
  .hotseat .vs { font-size: 20px; font-weight: 700; white-space: nowrap; } .hotseat .vs b:first-child { color: var(--c-player); } .hotseat .vs b:last-child { color: var(--c-ai); }
  /* hot-seat hand-off: fully opaque and above everything, so the next player can't see the last one's base */
  #handoff { background: #05080c; z-index: 30; }
  #handoff .menu-box { text-align: center; padding: 34px 30px; width: min(520px, 92vw); }
  #handoff h2 { font-size: 34px; letter-spacing: .14em; margin: 0 0 10px; }
  #handoff p { color: var(--c-dim); margin: 0 0 22px; font-size: 16px; }
  #go-quote { display: none; gap: 12px; align-items: center; text-align: left; margin: 0 auto 16px; max-width: 440px; }
  #go-quote svg { width: 64px; height: 64px; flex: none; }
  #go-quote div { font-size: 15px; color: #d3dee9; line-height: 1.35; }
  @media (max-width: 900px) { .missions { grid-template-columns: repeat(3, 1fr); } .speakers { grid-template-columns: 1fr; } }
  #go-title { font-size: 64px; font-weight: 700; letter-spacing: .2em; }
  #go-title.win { color: #8fdcff; text-shadow: 0 0 30px rgba(46,196,255,.6); } #go-title.lose { color: #ff6a55; text-shadow: 0 0 30px rgba(255,68,34,.6); } #go-title.draw { color: #ffd98a; }
  #go-reason { color: var(--c-dim); margin-bottom: 18px; letter-spacing: .08em; }
  #go-stats { display: grid; grid-template-columns: 1fr auto auto; gap: 4px 18px; text-align: left; font-size: 15px; margin: 0 auto 20px; max-width: 380px; }
  #go-stats .h { color: var(--c-dim); font-size: 12px; letter-spacing: .14em; text-transform: uppercase; }
  .bigbtn { padding: 12px 26px; border-radius: 8px; border: 1px solid rgba(46,196,255,.6); background: rgba(46,196,255,.18); color: #fff; font-family: inherit; font-size: 18px; font-weight: 700; letter-spacing: .12em; cursor: pointer; margin: 0 6px; }
  .bigbtn:hover { background: rgba(46,196,255,.3); }
  .bigbtn.alt { border-color: var(--c-line); background: rgba(255,255,255,.05); }
  #help .menu-box { width: min(860px, 94vw); max-height: 90vh; overflow-y: auto; padding: 24px 28px; text-align: left; }
  #help h2 { margin: 0 0 8px; letter-spacing: .14em; text-transform: uppercase; }
  #help h4 { margin: 16px 0 6px; color: var(--c-warn); letter-spacing: .14em; text-transform: uppercase; font-size: 13px; }
  #help p, #help li { font-size: 15px; color: #c5d2de; line-height: 1.4; }
  #help table { width: 100%; border-collapse: collapse; font-size: 14px; }
  #help td, #help th { padding: 4px 6px; border-bottom: 1px solid var(--c-line); text-align: left; vertical-align: top; }
  #help th { color: var(--c-dim); font-weight: 600; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; }
  #help .keys { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 20px; font-size: 14px; }

  @media (max-width: 1500px) {
    .card .nm { font-size: 12px; } .card .ico { width: 26px; height: 26px; }
    .abtn { height: 84px; }
  }
  @media (max-width: 1240px) {
    .card .nm { font-size: 11px; } .abtn { height: 78px; }
    #orders { width: 220px; }
  }
  /* ── Compact layout (phones: short landscape or narrow screens) ── */
  #b-log { display: none; }
  #rotate { position: absolute; inset: 0; display: none; flex-direction: column; gap: 18px; align-items: center; justify-content: center; text-align: center; padding: 24px;
    background: rgba(5,8,12,.94); pointer-events: auto; z-index: 20; font-size: 18px; }
  #rotate.show { display: flex; }
  #rotate .phone { width: 64px; height: 108px; border: 4px solid #8fdcff; border-radius: 12px; animation: rot 2.2s ease-in-out infinite; }
  @keyframes rot { 0%, 30% { transform: rotate(0); } 60%, 100% { transform: rotate(-90deg); } }
  body.compact #ui { --safe-l: env(safe-area-inset-left, 0px); --safe-r: env(safe-area-inset-right, 0px); --safe-b: env(safe-area-inset-bottom, 0px); }
  body.compact #hud { top: 4px; border-radius: 8px; }
  body.compact #hud .cell { padding: 3px 9px; min-width: 0; }
  body.compact #hud .lbl { font-size: 9px; letter-spacing: .08em; gap: 3px; }
  body.compact #hud .lbl .ico { width: 11px; height: 11px; }
  body.compact #hud .val { font-size: 15px; }
  body.compact #hud .inc { font-size: 11px; }
  body.compact #hud-turn { min-width: 0 !important; } body.compact #hud-turn .val { font-size: 14px; } body.compact #hud-phase { font-size: 9px; }
  body.compact .hq-cell { min-width: 74px !important; }
  body.compact #hud .bar { height: 3px; margin-top: 2px; }
  body.compact #sysbtns { top: 4px; right: calc(var(--safe-r) + 6px); gap: 4px; }
  body.compact #sysbtns .panel:first-child { display: none !important; }
  body.compact .iconbtn { width: 34px; height: 34px; }
  body.compact #b-log { display: grid; }
  body.compact #orders { display: none; top: 44px; right: calc(var(--safe-r) + 6px); width: min(280px, 46vw); max-height: calc(100% - 120px); z-index: 4; }
  body.compact #orders.open { display: flex; }
  body.compact #log { max-height: none; }
  body.compact #dock { bottom: calc(var(--safe-b) + 3px); gap: 4px; max-width: calc(100vw - var(--safe-l) - var(--safe-r) - 8px); }
  body.compact #cards { padding: 4px; gap: 4px; overflow-x: auto; max-width: calc(100vw - var(--safe-l) - var(--safe-r) - 230px); scrollbar-width: none; }
  body.compact #cards::-webkit-scrollbar { display: none; }
  body.compact .card { flex: none; width: 52px; height: 56px; border-radius: 6px; gap: 1px; }
  body.compact .card .ico { width: 20px; height: 20px; }
  body.compact .card .nm { font-size: 8.5px; letter-spacing: 0; }
  body.compact .card .cost { font-size: 10px; }
  body.compact .card .key, body.compact .card .cnt { display: none; }
  body.compact #actions { padding: 4px; gap: 4px; }
  body.compact .abtn { min-width: 58px !important; height: 56px; font-size: 10px; gap: 1px; border-radius: 6px; }
  body.compact .abtn .ico { width: 20px; height: 20px; }
  body.compact .abtn small, body.compact .abtn .badge { display: none; }
  body.compact #selected { right: calc(var(--safe-r) + 6px); bottom: 70px; width: min(250px, 42vw); max-height: calc(100% - 120px); padding: 8px 10px; }
  body.compact #selected .desc, body.compact #selected ul, body.compact #selected .side { display: none; }
  body.compact #selected h3 { font-size: 15px; } body.compact #selected ul { font-size: 11px; }
  body.compact .sbtn { padding: 6px; font-size: 12px; } body.compact .sbtn kbd { display: none; }
  body.compact #objectives { top: 46px; max-width: 70vw; padding: 3px 8px; }
  body.compact #objectives .obj { font-size: 11px; } body.compact #objectives kbd { display: none; }
  body.compact #toasts { top: 76px; } body.compact .toast { font-size: 13px; padding: 6px 12px; }
  body.compact #report { bottom: 70px; width: min(380px, 70vw); padding: 10px 12px; }
  body.compact #report h2 { font-size: 15px; margin-bottom: 6px; } body.compact #report .row { font-size: 12px; } body.compact #report .lost, body.compact #report .foot { font-size: 11px; }
  body.compact #banner .t { font-size: 34px; } body.compact #banner .s { font-size: 12px; }
  body.compact #combathint { bottom: calc(var(--safe-b) + 6px); font-size: 12px; padding: 5px 10px; }
  body.compact #tip { font-size: 12px; max-width: 220px; padding: 6px 8px; }
  body.compact .screen { align-items: flex-start; overflow-y: auto; padding: 12px calc(var(--safe-r) + 12px) 24px calc(var(--safe-l) + 12px); -webkit-overflow-scrolling: touch; }
  body.compact .title { font-size: 34px; } body.compact .tag { margin: 8px 0 12px; font-size: 10px; letter-spacing: .18em; }
  body.compact .missions { gap: 5px; margin-bottom: 12px; } body.compact .mission { padding: 6px; } body.compact .mission h4 { font-size: 12px; }
  body.compact .mission .vs { font-size: 10px; } body.compact .mission .vs svg { width: 20px; height: 20px; }
  body.compact .diff { padding: 10px; } body.compact .diff h3 { font-size: 16px; } body.compact .diff p { font-size: 11px; }
  body.compact .menu-foot { margin-top: 10px; font-size: 12px; }
  body.compact .bigbtn { padding: 8px 16px; font-size: 14px; }
  body.compact #briefing .menu-box, body.compact #gameover .menu-box, body.compact #help .menu-box { padding: 14px 16px; max-height: none; }
  body.compact .medals { margin: 6px 0 8px; gap: 6px; } body.compact .medal { font-size: 12px; padding: 2px 8px; } body.compact .medal .star { font-size: 14px; }
  body.compact #briefing h2 { font-size: 18px; } body.compact .speaker svg { width: 56px; height: 56px; } body.compact .speaker .say { font-size: 13px; }
  body.compact #go-title { font-size: 34px; } body.compact #go-stats { font-size: 12px; margin-bottom: 10px; }
  body.compact .float { font-size: 14px; } body.compact .float.big { font-size: 18px; }
  /* small phones in landscape (iPhone SE/mini): left-align a slimmer HUD so the icon buttons fit */
  @media (max-width: 720px) {
    body.compact #hud { left: calc(var(--safe-l) + 4px); transform: none; }
    body.compact #hud .inc { display: none; }
    body.compact #hud .cell { padding: 3px 6px; } body.compact .hq-cell { min-width: 0 !important; }
  }
  /* narrow portrait ("play anyway") */
  @media (max-width: 600px) {
    body.compact #hud { left: calc(var(--safe-l) + 4px); transform: none; max-width: calc(100vw - 8px); }
    body.compact #hud .lbl, body.compact #hud .inc, body.compact #hud-phase { display: none; }
    body.compact #hud .cell { padding: 4px 7px; } body.compact .hq-cell { min-width: 0 !important; }
    body.compact #sysbtns { top: 46px; }
    body.compact #objectives { top: 88px; max-width: calc(100vw - 16px); }
    body.compact #toasts { top: 120px; }
    body.compact #cards { max-width: calc(100vw - 200px); }
  }

  @media (max-height: 820px) { #selected .desc { display: none; } #selected ul { font-size: 12px; } #selected h3 { font-size: 17px; } #selected { padding: 10px 12px; max-height: calc(100vh - 360px); } }
  @media (max-height: 700px) { #orders { display: none; } }
  `;

  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // ── Build DOM ─────────────────────────────────────────────
  function init(handlers) {
    H = handlers;
    const st = el('style'); st.textContent = CSS; document.head.appendChild(st);
    root = el('div', { id: 'ui' });
    document.body.appendChild(root);

    root.appendChild(el('div', { id: 'hud', class: 'panel pi', style: 'display:none' }, `
      <div class="cell"><div class="lbl" style="color:var(--c-credit)">${icon('credits')} Credits</div><div class="val" style="color:var(--c-credit)"><span id="h-cr">0</span><span class="inc" id="h-cri"></span></div></div>
      <div class="cell"><div class="lbl" style="color:var(--c-energy)">${icon('energy')} Energy</div><div class="val" style="color:var(--c-energy)"><span id="h-en">0</span><span class="inc" id="h-eni"></span></div><div class="bar"><i id="h-enb" style="background:var(--c-energy)"></i></div></div>
      <div class="cell" id="hud-turn"><div class="val" id="h-turn">TURN 1</div><div id="hud-phase">Planning</div></div>
      <div class="cell hq-cell"><div class="lbl" id="h-hql" style="color:var(--c-player)">Your HQ</div><div class="val" id="h-hq">200</div><div class="bar"><i id="h-hqb" style="background:var(--c-player)"></i></div></div>
      <div class="cell hq-cell"><div class="lbl" id="h-ehql" style="color:var(--c-ai)">Enemy HQ</div><div class="val" id="h-ehq">200</div><div class="bar"><i id="h-ehqb" style="background:var(--c-ai)"></i></div></div>
    `));

    root.appendChild(el('div', { id: 'sysbtns', class: 'pi' }, `
      <div class="panel" style="display:flex;align-items:center;padding:0 10px;gap:6px" title="Master volume"><input id="vol" type="range" min="0" max="1" step="0.05"></div>
      <div class="panel iconbtn" id="b-mute" title="Mute (M)">${icon('sound')}</div>
      <div class="panel iconbtn" id="b-log" title="Orders & battle log">${icon('log')}</div>
      <div class="panel iconbtn" id="b-help" title="How to play (?)">${icon('help')}</div>
      <div class="panel iconbtn" id="b-menu" title="Save &amp; return to menu" style="display:none">${icon('menu')}</div>
    `));

    root.appendChild(el('div', { id: 'objectives', class: 'panel pi', style: 'display:none' }));
    root.appendChild(el('div', { id: 'orders', class: 'panel pi', style: 'display:none' }, `
      <div class="ph"><span>Orders this turn</span><button class="sbtn" id="b-undo" title="Undo last action (Z)" style="flex:none;padding:3px 8px;font-size:12px">${icon('undo')} Undo <kbd>Z</kbd></button></div>
      <div id="orderlist"></div>
      <div class="ph"><span>Battle log</span></div>
      <div id="log"></div>
    `));
    root.appendChild(el('div', { id: 'selected', class: 'panel pi' }));

    root.appendChild(el('div', { id: 'dock', class: 'hidden pi' }, `
      <div id="cards" class="panel"></div>
      <div id="actions" class="panel">
        <button class="abtn fire" id="b-fire">${icon('missile')}<span>Fire Missile</span><small><kbd>Q</kbd> <span id="fire-sub"></span></small><span class="badge" id="fire-badge"></span></button>
        <button class="abtn drop" id="b-drop">${icon('drop')}<span>Drop Mech</span><small><kbd>E</kbd> <span id="drop-sub"></span></small><span class="badge" id="drop-badge"></span></button>
        <button class="abtn strike" id="b-strike" style="display:none">${icon('strike')}<span>Orbital Strike</span><small><kbd>R</kbd> <span id="strike-sub"></span></small><span class="badge" id="strike-badge"></span></button>
        <button class="abtn end" id="b-end">${icon('end')}<span>End Turn</span><small><kbd>Space</kbd></small></button>
      </div>
    `));
    root.appendChild(el('div', { id: 'combathint', class: 'panel' }, `<span><kbd>Space</kbd> skip</span><span><kbd>Tab</kbd> speed <b id="spd">1x</b></span>`));
    root.appendChild(el('div', { id: 'toasts' }));
    root.appendChild(el('div', { id: 'tip', class: 'panel' }));
    root.appendChild(el('div', { id: 'banner' }, '<div class="t"></div><div class="s"></div>'));
    root.appendChild(el('div', { id: 'floats', style: 'position:absolute;inset:0;overflow:hidden' }));
    root.appendChild(el('div', { id: 'report', class: 'panel' }));

    // Menu
    const diffs = Object.keys(CONST.DIFFICULTY).map((k, i) => `
      <div class="panel diff d${i + 1}" data-diff="${k}"><div class="lvl">${'◆'.repeat(i + 1)}${'◇'.repeat(2 - i)}</div><h3>${CONST.DIFFICULTY[k].name}</h3><p>${esc(CONST.DIFFICULTY[k].desc)}</p></div>`).join('');
    root.appendChild(el('div', { id: 'menu', class: 'screen' }, `
      <div class="menu-box">
        <div class="title">ROBOT ATTACK<span>STRATEGY 2026</span></div>
        <div class="tag">Build &middot; Strike &middot; Defend &mdash; an island war in the spirit of Metal Marines</div>
        <div id="m-cont-wrap" style="display:none;margin:-8px 0 20px"><button class="bigbtn" id="m-continue">Continue <span id="m-cont-sub" style="font-size:14px;opacity:.75;letter-spacing:.04em"></span></button></div>
        <div id="m-warn" class="warnline"></div>
        <div class="sect">Campaign</div>
        <div class="missions" id="m-missions"></div>
        <div class="sect">Skirmish &amp; two players &mdash; random islands</div>
        <div class="opts" id="m-opts">${Object.keys(SKIRMISH_OPTIONS).map(k => `<div class="opt"><span>${esc(SKIRMISH_OPTIONS[k].label)}</span><div class="seg">${SKIRMISH_OPTIONS[k].choices.map(c => `<button data-k="${k}" data-v="${c[0]}">${esc(c[1])}</button>`).join('')}</div></div>`).join('')}</div>
        <div class="diffs">${diffs}</div>
        <div class="panel hotseat" id="m-hotseat"><div><h3>TWO PLAYERS</h3><p>Pass &amp; play on one device: plan in turns, each behind a hand-off screen.</p></div><div class="vs"><b>P1</b> vs <b>P2</b></div></div>
        <div class="menu-foot">
          <span class="lnk" id="m-help">How to play</span>
          <label class="chk"><input type="checkbox" id="m-tut" checked> Show tutorial objectives</label>
          <label class="chk"><input type="checkbox" id="m-music" checked> Music</label>
        </div>
      </div>`));

    root.appendChild(el('div', { id: 'gameover', class: 'screen' }, `
      <div class="menu-box panel">
        <div id="go-title">VICTORY</div>
        <div id="go-reason"></div>
        <div id="go-medals" class="medals"></div>
        <div id="go-quote"></div>
        <div id="go-stats"></div>
        <button class="bigbtn" id="go-next" style="display:none">Next Mission</button><button class="bigbtn" id="go-again">Rematch</button><button class="bigbtn alt" id="go-menu">Main Menu</button>
      </div>`));

    root.appendChild(el('div', { id: 'briefing', class: 'screen' }, `
      <div class="menu-box panel">
        <h2 id="br-name"></h2><div class="sub" id="br-sub"></div>
        <div class="speakers">
          <div class="speaker" id="br-co"></div>
          <div class="speaker enemy" id="br-foe"></div>
        </div>
        <div id="br-medals" class="medals"></div>
        <div id="br-warn" class="warnline"></div>
        <div style="text-align:center"><button class="bigbtn" id="br-go">Launch Mission</button><button class="bigbtn alt" id="br-back">Back</button></div>
      </div>`));

    root.appendChild(el('div', { id: 'help', class: 'screen' }, helpHTML()));

    root.appendChild(el('div', { id: 'handoff', class: 'screen' }, `
      <div class="menu-box panel"><h2 id="ho-title"></h2><p id="ho-sub"></p><button class="bigbtn" id="ho-go">I'm ready</button></div>`));

    // Wire events (stopPropagation is not needed: input lives on the canvas only)
    root.querySelectorAll('.diff').forEach(d => {
      d.addEventListener('click', () => H.onStart(d.dataset.diff, $('m-tut').checked));
      d.addEventListener('mouseenter', () => H.onHover && H.onHover());
    });
    $('m-help').addEventListener('click', () => showHelp(true));
    $('m-hotseat').addEventListener('click', () => H.onHotseat());
    root.querySelectorAll('#m-opts button').forEach(b => b.addEventListener('click', () => {
      skirmishOpts[b.dataset.k] = +b.dataset.v;
      try { localStorage.setItem('ra_skirmish', JSON.stringify(skirmishOpts)); } catch (e) { /* storage blocked */ }
      paintOpts();
      H.onHover && H.onHover();
    }));
    paintOpts();
    $('ho-go').addEventListener('click', () => H.onHandoffReady());
    $('m-continue').addEventListener('click', () => H.onContinue());
    $('m-music').addEventListener('change', e => H.onMusic && H.onMusic(e.target.checked));
    $('help').addEventListener('click', e => { if (e.target.id === 'help' || e.target.classList.contains('close')) showHelp(false); });
    $('go-again').addEventListener('click', () => H.onRematch());
    $('go-next').addEventListener('click', () => H.onNextMission());
    $('br-go').addEventListener('click', () => { $('briefing').classList.remove('show'); H.onLaunchMission(briefingId); });
    $('br-back').addEventListener('click', () => closeBriefing());
    $('go-menu').addEventListener('click', () => H.onMenu());
    $('b-fire').addEventListener('click', () => H.onAction('fire'));
    $('b-drop').addEventListener('click', () => H.onAction('drop'));
    $('b-strike').addEventListener('click', () => H.onAction('strike'));
    $('b-end').addEventListener('click', () => H.onAction('end'));
    $('b-undo').addEventListener('click', () => H.onAction('undo'));
    $('b-mute').addEventListener('click', () => H.onAction('mute'));
    $('b-help').addEventListener('click', () => showHelp(!isHelpOpen()));
    $('b-log').addEventListener('click', () => $('orders').classList.toggle('open'));
    root.appendChild(el('div', { id: 'rotate' }, `<div class="phone"></div><div><b>Rotate your phone</b><br><span style="color:var(--c-dim);font-size:15px">Robot Attack plays best in landscape.</span></div><button class="bigbtn alt" id="rot-ok">Play anyway</button>`));
    $('rot-ok').addEventListener('click', () => { rotateDismissed = true; layout(); });
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', () => setTimeout(layout, 250));
    layout();
    $('b-menu').addEventListener('click', () => H.onAction('menu'));
    $('vol').addEventListener('input', e => H.onVolume(+e.target.value));
    root.addEventListener('mouseover', e => {
      const t = e.target.closest && e.target.closest('.card,.abtn,.sbtn,.diff,.bigbtn,.iconbtn');
      if (t && t !== lastHoverEl && H.onHover) H.onHover();
      lastHoverEl = t;
    });
  }
  let lastHoverEl = null;

  // Phone layout: compact UI on short or narrow screens; suggest landscape in portrait
  let rotateDismissed = false;
  function isCompact() { return window.innerHeight < 560 || window.innerWidth < 900; }
  function layout() {
    document.body.classList.toggle('compact', isCompact());
    const portrait = window.innerHeight > window.innerWidth && window.innerWidth < 700;
    $('rotate').classList.toggle('show', portrait && !rotateDismissed);
    if (H.onLayout) H.onLayout();
  }

  function helpHTML() {
    const rows = BUILD_ORDER.map(k => {
      const b = BUILDINGS[k];
      return `<tr><td><kbd>${b.key}</kbd></td><td><b>${b.name}</b></td><td>${b.cost}</td><td>${b.hp}</td><td>${esc(b.desc)}</td></tr>`;
    }).join('');
    return `<div class="menu-box panel">
      <h2>How to play</h2>
      <p><b>Goal:</b> destroy the enemy <b style="color:var(--c-ai)">Command Center</b> (always marked on the right side of the map) before yours falls. If both survive the turn limit (${CONST.MAX_TURNS} by default), the healthier HQ wins.</p>
      <h4>Each turn</h4>
      <ol>
        <li><b>Plan.</b> Spend <span style="color:var(--c-credit)">credits</span> on buildings and repairs, and <span style="color:var(--c-energy)">energy</span> on missiles and mech drops. You can only build within ${CONST.BUILD_RADIUS} cells of your existing buildings.</li>
        <li><b>End turn.</b> Both sides' orders resolve at the same time: missiles launched <i>last</i> turn come down, AA intercepts, gun pods fire, mechs fight, drop pods land, and new missiles launch.</li>
        <li><b>React.</b> Missiles are in the air for a full turn. Red reticles show enemy missiles your Radar (or HQ) has detected — build AA, shields or repair before they land.</li>
      </ol>
      <h4>Defenses</h4>
      <p>Every Command Center has a point-defense gun that hits 40% of missiles aimed within 2 cells, plus a close-defense gun against mechs, and enemy drop pods can't land within 2 cells of it. AA Batteries hit 70%; if one misses, another battery in range gets a shot. One missile at a time rarely gets through — <b>fire several in the same turn</b> to overwhelm the defenses.</p>
      <h4>Orbital strikes</h4>
      <p>A <b>Strike Uplink</b> charges for ${CONST.STRIKE_CHARGE} turns, then press <kbd>R</kbd> to call down a strike: ${CONST.STRIKE_DAMAGE} damage to the target and ${CONST.STRIKE_SPLASH} to everything around it. AA cannot touch it, but Shields absorb it — and every strike is detected, so the target gets a turn to spread out, shield or repair. Not available in missions 1–5.</p>
      <h4>Upgrades</h4>
      <p>Select one of your structures and press <kbd>U</kbd> to upgrade it once (about 75% of its price, +50% HP): ${Object.keys(UPGRADES).map(k => '<b>' + BUILDINGS[k].name + '</b> — ' + esc(UPGRADES[k].desc)).join('; ')}.</p>
      <h4>Counters</h4>
      <p>Missiles &rarr; countered by AA Batteries and Shields. &nbsp; Mechs &rarr; countered by Gun Pods, or by <b>garrison mechs</b>: drop a mech on your own island and it hunts invaders. &nbsp; Radar reveals targets and incoming fire. Missile impacts also reveal the area around them.</p>
      <h4>Structures</h4>
      <table><tr><th>Key</th><th>Name</th><th>Cost</th><th>HP</th><th>Effect</th></tr>${rows}</table>
      <h4>Controls</h4>
      <div class="keys">
        <div><kbd>1</kbd>–<kbd>0</kbd> select structure</div><div><kbd>Left click</kbd> place / target / select</div>
        <div><kbd>Q</kbd> fire missile &nbsp; <kbd>E</kbd> drop mech</div><div><kbd>R</kbd> orbital strike</div>
        <div><kbd>T</kbd> repair &nbsp; <kbd>U</kbd> upgrade &nbsp; <kbd>X</kbd> sell selected</div><div><kbd>Z</kbd> undo last action</div>
        <div><kbd>Space</kbd> end turn / skip playback</div><div><kbd>Tab</kbd> playback speed</div>
        <div><kbd>WASD</kbd>/arrows or right-drag: pan</div><div><kbd>Wheel</kbd> zoom &nbsp; <kbd>H</kbd> home &nbsp; <kbd>F</kbd> whole map</div>
        <div><kbd>Esc</kbd> cancel &nbsp; Touch: tap, drag to pan, pinch to zoom</div><div><kbd>M</kbd> mute &nbsp; <kbd>G</kbd> graphics quality &nbsp; <kbd>?</kbd> help</div>
      </div>
      <p style="text-align:center;margin-top:18px"><button class="bigbtn close">Got it</button></p>
    </div>`;
  }

  // ── Updates ───────────────────────────────────────────────
  function showGameUI(on) {
    for (const id of ['hud', 'orders', 'b-menu']) $(id).style.display = on ? '' : 'none';
    if (!on) { $('dock').classList.add('hidden'); $('selected').classList.remove('show'); $('objectives').style.display = 'none'; hideReport(); }
  }

  function setHUD(h) {
    $('h-cr').textContent = h.credits;
    $('h-cri').textContent = '+' + h.creditInc;
    $('h-en').textContent = h.energy + '/' + h.energyCap;
    $('h-eni').textContent = '+' + h.energyInc;
    const eb = $('h-enb');
    eb.style.width = (100 * h.energy / h.energyCap) + '%';
    eb.parentElement.classList.toggle('full', h.energy >= h.energyCap);
    $('h-turn').textContent = 'TURN ' + h.turn + ' / ' + h.maxTurns;
    $('hud-phase').textContent = h.phase;
    $('h-hq').textContent = h.hq.hp + ' / ' + h.hq.max;
    $('h-hqb').style.width = (100 * h.hq.hp / h.hq.max) + '%';
    // hot-seat Player 2 plays red: "your" colours follow the seat
    const mine = h.red ? 'var(--c-ai)' : 'var(--c-player)', theirs = h.red ? 'var(--c-player)' : 'var(--c-ai)';
    $('h-hql').style.color = $('h-hqb').style.background = mine;
    $('h-ehql').style.color = $('h-ehqb').style.background = theirs;
    $('h-ehq').textContent = h.enemyHq.known ? (h.enemyHq.hp + ' / ' + h.enemyHq.max) : ('~' + h.enemyHq.hp + ' / ' + h.enemyHq.max);
    $('h-ehqb').style.width = (100 * h.enemyHq.hp / h.enemyHq.max) + '%';
  }

  function setDock(visible) { $('dock').classList.toggle('hidden', !visible); }

  function setCards(list) {
    const box = $('cards');
    if (box.children.length !== list.length) {
      box.innerHTML = '';
      for (const c of list) {
        const d = el('div', { class: 'card', 'data-type': c.type }, `<span class="key">${c.key}</span><span class="cnt"></span>${icon(c.type)}<span class="nm">${esc(c.name)}</span><span class="cost">${c.cost}</span>`);
        d.addEventListener('click', () => H.onBuildSelect(c.type));
        d.addEventListener('mouseenter', e => H.onCardHover && H.onCardHover(c.type, e));
        d.addEventListener('mouseleave', () => hideTip());
        box.appendChild(d);
      }
    }
    list.forEach((c, i) => {
      const d = box.children[i];
      d.classList.toggle('sel', !!c.selected);
      d.classList.toggle('off', !c.enabled);
      d.querySelector('.cnt').textContent = c.count ? 'x' + c.count : '';
    });
  }

  function setActions(a) {
    const set = (id, o) => {
      const b = $(id);
      b.classList.toggle('off', !o.enabled);
      b.classList.toggle('sel', !!o.selected);
      b.title = o.reason || '';
    };
    set('b-fire', a.fire); set('b-drop', a.drop);
    $('fire-sub').textContent = a.fire.sub || '';
    $('drop-sub').textContent = a.drop.sub || '';
    $('fire-badge').textContent = a.fire.badge || '';
    $('drop-badge').textContent = a.drop.badge || '';
    $('b-strike').style.display = a.strike && a.strike.visible ? '' : 'none';
    if (a.strike && a.strike.visible) {
      set('b-strike', a.strike);
      $('b-strike').classList.toggle('ready', !!a.strike.ready);
      $('strike-sub').textContent = a.strike.sub || '';
      $('strike-badge').textContent = a.strike.badge || '';
    }
    $('b-end').classList.toggle('ready', !!a.endReady);
  }

  function setOrders(orders, incoming) {
    const box = $('orderlist');
    box.innerHTML = '';
    if (!orders.length && !incoming.length) { box.appendChild(el('div', { class: 'empty' }, 'No orders queued.')); return; }
    for (const m of incoming) {
      box.appendChild(el('div', { class: 'order incoming' + (m.strike ? ' strike' : '') }, `${icon(m.strike ? 'strike' : 'missile')}<span>${esc(m.text)}</span>`));
    }
    for (const o of orders) {
      const d = el('div', { class: 'order ' + o.kind }, `${icon(o.kind === 'drop' ? 'drop' : o.kind)}<span>${esc(o.text)}</span><span class="x" title="Cancel (refund)">&times;</span>`);
      d.querySelector('.x').addEventListener('click', () => H.onAction('cancel', o.id));
      d.addEventListener('mouseenter', () => H.onOrderHover && H.onOrderHover(o.id));
      d.addEventListener('mouseleave', () => H.onOrderHover && H.onOrderHover(null));
      box.appendChild(d);
    }
  }

  function log(text, cls) {
    const box = $('log');
    if (!box) return;
    box.appendChild(el('div', { class: cls || '' }, esc(text)));
    while (box.children.length > 200) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }
  function clearLog() { $('log').innerHTML = ''; }

  // Skirmish / two-player battle options, remembered per browser
  const skirmishOpts = (() => {
    const o = {};
    for (const k in SKIRMISH_OPTIONS) o[k] = SKIRMISH_OPTIONS[k].def;
    try {
      const saved = JSON.parse(localStorage.getItem('ra_skirmish')) || {};
      for (const k in o) if (SKIRMISH_OPTIONS[k].choices.some(c => c[0] === saved[k])) o[k] = saved[k];
    } catch (e) { /* defaults */ }
    return o;
  })();
  function paintOpts() {
    document.querySelectorAll('#m-opts button').forEach(b => b.classList.toggle('on', skirmishOpts[b.dataset.k] === +b.dataset.v));
  }
  function getSkirmishOptions() { return Object.assign({}, skirmishOpts); }
  function getLog() { return $('log').innerHTML; }
  function setLog(html) { const box = $('log'); box.innerHTML = html; box.scrollTop = box.scrollHeight; }

  function showHandoff(o) {
    const t = $('ho-title');
    t.textContent = o.title;
    t.style.color = o.side === CONST.SIDE_PLAYER ? 'var(--c-player)' : 'var(--c-ai)';
    $('ho-sub').textContent = o.sub;
    $('ho-go').textContent = o.button || 'I\'m ready';
    hideTip(); hideReport();
    $('handoff').classList.add('show');
  }
  function hideHandoff() { $('handoff').classList.remove('show'); }
  function isHandoffOpen() { return $('handoff').classList.contains('show'); }

  function showSelected(info) {
    const p = $('selected');
    if (!info) { p.classList.remove('show'); return; }
    const frac = info.hp / info.maxHp;
    const col = frac > 0.6 ? '#66ff66' : frac > 0.3 ? '#ffc030' : '#ff3b2f';
    let btns = '';
    if (info.own && info.type !== 'hq') {
      btns = `<div class="btns">
        <button class="sbtn ${info.repair.reason ? 'off' : ''}" id="s-rep" title="${esc(info.repair.reason || '')}">${icon('repair')} Repair ${info.repair.reason ? '' : '+' + info.repair.amount + ' (' + info.repair.cost + 'c)'} <kbd>T</kbd></button>
        <button class="sbtn" id="s-sell">${icon('sell')} Sell +${info.sellValue} <kbd>X</kbd></button></div>`;
    }
    const up = info.own && info.upgrade && UPGRADES[info.type] && info.upgrade.reason !== 'Already upgraded' ? info.upgrade : null;
    if (up) {
      const u = UPGRADES[info.type];
      btns += `<div class="btns"><button class="sbtn up ${up.reason ? 'off' : ''}" id="s-up" title="${esc(u.desc + (up.reason ? ' — ' + up.reason : ''))}">★ ${esc(u.name)} (${up.cost}c) <kbd>U</kbd></button></div>
        <div style="font-size:12px;color:var(--c-dim);margin-top:4px">Upgrade: ${esc(u.desc)}, +50% HP</div>`;
    }
    if (info.own && info.type === 'hq') {
      btns = `<div class="btns"><button class="sbtn ${info.repair.reason ? 'off' : ''}" id="s-rep" title="${esc(info.repair.reason || '')}">${icon('repair')} Repair ${info.repair.reason ? '— ' + esc(info.repair.reason) : '+' + info.repair.amount + ' (' + info.repair.cost + 'c)'} <kbd>T</kbd></button></div>`;
    }
    p.innerHTML = `<div class="side" style="color:${info.own ? 'var(--c-player)' : 'var(--c-ai)'}">${info.own ? 'Your structure' : (info.ghost ? 'Enemy — last known' : 'Enemy structure')}</div>
      <h3>${icon(info.type)} ${esc(info.name)}${info.level > 1 ? ' <span style="color:#ffc83c;font-size:14px">★ II</span>' : ''}</h3>
      <div class="hpb"><i style="width:${frac * 100}%;background:${col}"></i></div>
      <div class="mono" style="font-size:13px;color:var(--c-dim)">HP ${info.hp} / ${info.maxHp}${info.extra ? ' &middot; ' + esc(info.extra) : ''}</div>
      <div class="desc">${esc(info.desc)}</div>
      <ul>${info.stats.map(s => '<li>' + esc(s) + '</li>').join('')}</ul>${btns}`;
    p.classList.add('show');
    const rep = $('s-rep'), sell = $('s-sell'), upb = $('s-up');
    if (upb) upb.addEventListener('click', () => H.onAction('upgrade'));
    if (rep) rep.addEventListener('click', () => H.onAction('repair'));
    if (sell) sell.addEventListener('click', () => H.onAction('sell'));
  }

  function setObjectives(list) {
    const box = $('objectives');
    if (!list) { box.style.display = 'none'; return; }
    box.style.display = '';
    // one slim line over the strait: progress + the current objective
    const done = list.filter(o => o.done).length;
    const cur = list.find(o => !o.done);
    box.innerHTML = `<h4>Briefing ${done}/${list.length}</h4>` +
      (cur ? `<div class="obj cur"><b>▸</b><span>${cur.text}</span></div>` : '') + `<span class="x" id="obj-x" title="Hide briefing">&times;</span>`;
    $('obj-x').addEventListener('click', () => H.onAction('hideObjectives'));
  }

  function toast(text, kind) {
    const box = $('toasts');
    const t = el('div', { class: 'toast ' + (kind || '') }, esc(text));
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => t.remove(), 2300);
  }

  function showTip(html, x, y) {
    const t = $('tip');
    t.innerHTML = html;
    t.style.display = 'block';
    const w = t.offsetWidth, h = t.offsetHeight;
    let lx = x + 16, ly = y + 16;
    if (lx + w > window.innerWidth - 8) lx = x - w - 16;
    if (ly + h > window.innerHeight - 8) ly = y - h - 16;
    t.style.left = Math.max(8, lx) + 'px'; t.style.top = Math.max(8, ly) + 'px';
  }
  function hideTip() { $('tip').style.display = 'none'; }

  function banner(text, sub, red) {
    const b = $('banner');
    b.querySelector('.t').textContent = text;
    b.querySelector('.s').textContent = sub || '';
    b.className = red ? 'red' : '';
    void b.offsetWidth;
    b.classList.add('show');
  }

  function floatText(x, y, text, cls) {
    const f = el('div', { class: 'float ' + (cls || 'dmg') }, esc(text));
    f.style.left = x + 'px'; f.style.top = y + 'px';
    $('floats').appendChild(f);
    setTimeout(() => f.remove(), 1150);
  }

  function setCombatHint(on, speed) {
    $('combathint').classList.toggle('show', on);
    $('spd').textContent = (speed || 1) + 'x';
  }

  function showReport(r) {
    const p = $('report');
    const col = (title, color, s) => `<div><h5 style="color:${color}">${title}</h5>
      <div class="row"><span>Damage dealt</span><b>${s.dealt}</b></div>
      <div class="row"><span>Missiles through / arriving</span><b>${s.hits} / ${s.landing}</b></div>
      <div class="row"><span>Enemy missiles shot down</span><b>${s.intercepts}</b></div>
      <div class="row"><span>Mechs lost</span><b>${s.robotsLost}</b></div>
      <div class="lost">${s.lostNames.length ? 'Lost: ' + esc(s.lostNames.join(', ')) : 'No structures lost'}</div></div>`;
    p.innerHTML = `<h2>Turn ${r.turn} report</h2><div class="cols">${col('You', r.swap ? 'var(--c-ai)' : 'var(--c-player)', r.player)}${col('Enemy', r.swap ? 'var(--c-player)' : 'var(--c-ai)', r.ai)}</div>
      <div class="foot"><span>Next turn: <b style="color:var(--c-credit)">+${r.income.credits}c</b> <b style="color:var(--c-energy)">+${r.income.energy}e</b></span><span>&nbsp;</span></div>`;
    p.classList.add('show');
  }
  function hideReport() { $('report').classList.remove('show'); }

  function showMenu(on) {
    $('menu').classList.toggle('show', on);
    if (on) $('gameover').classList.remove('show');
  }
  function setContinue(label) {
    $('m-cont-wrap').style.display = label ? '' : 'none';
    $('m-cont-sub').textContent = label ? '— ' + label : '';
  }
  function setMusicChecked(on) { $('m-music').checked = on; }

  // Stylised commander bust (SVG), coloured per commander
  function portrait(c) {
    const L = c.look, id = 'p' + Math.random().toString(36).slice(2, 7);
    const gear = {
      beret: `<path d="M30 30 Q48 10 72 24 Q74 30 66 32 L32 34 Z" fill="#1d3b55" stroke="${L.color}" stroke-width="2"/><circle cx="62" cy="24" r="3" fill="${L.color}"/>`,
      patch: `<path d="M34 52 L52 47 L52 58 L36 60 Z" fill="#0b0e13"/><path d="M26 44 L74 52" stroke="#0b0e13" stroke-width="2.5"/>`,
      antenna: `<path d="M66 26 L76 6" stroke="${L.color}" stroke-width="2.5"/><circle cx="76" cy="6" r="3.5" fill="${L.visor}"/>`,
      crown: `<path d="M30 30 L36 16 L42 28 L50 12 L58 28 L64 16 L70 30 Z" fill="${L.color}" opacity=".85"/>`,
      none: ''
    }[L.gear] || '';
    return `<svg viewBox="0 0 100 100"><defs><radialGradient id="${id}" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="${L.color}" stop-opacity=".35"/><stop offset="1" stop-color="#0b0e13" stop-opacity="0"/></radialGradient></defs>
      <circle cx="50" cy="50" r="48" fill="#121a24" stroke="${L.color}" stroke-opacity=".6" stroke-width="2"/><circle cx="50" cy="50" r="46" fill="url(#${id})"/>
      <path d="M14 100 Q16 74 50 70 Q84 74 86 100 Z" fill="#2a3440" stroke="${L.color}" stroke-width="2"/>
      <path d="M38 70 L50 82 L62 70" fill="none" stroke="${L.color}" stroke-width="2"/>
      <path d="M28 56 Q26 26 50 24 Q74 26 72 56 Q70 72 50 74 Q30 72 28 56 Z" fill="#3a4654" stroke="#5c6b7a" stroke-width="1.5"/>
      <path d="M30 46 L70 46 L68 58 Q50 64 32 58 Z" fill="${L.visor}" opacity=".95"/>
      <path d="M33 50 L67 50" stroke="#fff" stroke-opacity=".7" stroke-width="1.5"/>
      <rect x="24" y="44" width="6" height="16" rx="2" fill="#55626f"/><rect x="70" y="44" width="6" height="16" rx="2" fill="#55626f"/>
      ${gear}</svg>`;
  }

  // missions: [{ id, name, enemy, state: 'locked'|'open'|'done' }]
  function setCampaign(missions) {
    const box = $('m-missions');
    box.innerHTML = '';
    for (const m of missions) {
      const c = COMMANDERS[m.enemy];
      const medals = m.medals && m.medals[0] ? m.medals : [true, false, false]; // cleared before medals existed
      const badge = m.state === 'done' ? `<span title="${medals.filter(Boolean).length} of 3 medals">${medals.map(on => `<span class="star${on ? ' on' : ''}">★</span>`).join('')}</span>` : m.state === 'locked' ? '🔒' : '';
      const d = el('div', { class: 'panel mission ' + m.state }, `<span class="badge">${badge}</span>
        <div class="num">MISSION ${m.id}</div><h4>${esc(m.name)}</h4><div class="vs">${portrait(c)}<span>vs ${esc(c.name)}</span></div>`);
      if (m.state !== 'locked') d.addEventListener('click', () => H.onMission(m.id));
      box.appendChild(d);
    }
  }

  function warnOverwrite(text) {
    for (const id of ['m-warn', 'br-warn']) { $(id).textContent = text || ''; $(id).classList.toggle('show', !!text); }
  }
  let briefingId = 0;
  function closeBriefing() { $('briefing').classList.remove('show'); H.onBriefingBack(); }
  function isBriefingOpen() { return $('briefing').classList.contains('show'); }
  function medalLabels(m) { return ['Win the mission', 'Win by turn ' + m.par, 'Keep your HQ at 50%+']; }
  const medalRow = (got, labels) => got.map((on, i) => `<div class="medal${on ? ' on' : ''}"><span class="star${on ? ' on' : ''}">★</span>${esc(labels[i])}</div>`).join('');
  function showBriefing(m, best) {
    briefingId = m.id;
    $('br-medals').innerHTML = medalRow(best || [false, false, false], medalLabels(m));
    const co = COMMANDERS.hale, foe = COMMANDERS[m.enemy];
    $('br-name').textContent = 'Mission ' + m.id + ': ' + m.name;
    $('br-sub').textContent = 'Opponent: ' + foe.name + ' · ' + CONST.DIFFICULTY[m.difficulty].name + ' tactics';
    $('br-co').innerHTML = portrait(co) + `<div><div class="who" style="color:${co.look.color}">${esc(co.name)}</div><div class="role">${esc(co.title)}</div><div class="say">${esc(m.brief)}</div></div>`;
    $('br-foe').innerHTML = portrait(foe) + `<div><div class="who" style="color:${foe.look.color}">${esc(foe.name)}</div><div class="role">${esc(foe.title)}</div><div class="say">“${esc(m.taunt)}”</div></div>`;
    $('menu').classList.remove('show');
    $('briefing').classList.add('show');
    $('briefing').scrollTop = 0;
  }

  function showGameOver(g) {
    $('go-next').style.display = g.next ? '' : 'none';
    $('go-again').textContent = g.again || 'Rematch';
    const q = $('go-quote');
    if (g.quote) { q.style.display = 'flex'; q.innerHTML = portrait(g.quote.who) + '<div><b>' + esc(g.quote.who.name) + ':</b> ' + esc(g.quote.text) + '</div>'; }
    else q.style.display = 'none';
    const t = $('go-title');
    t.textContent = g.title;
    t.className = g.kind;
    $('go-reason').textContent = g.reason;
    $('go-medals').innerHTML = g.medals ? medalRow(g.medals.got, g.medals.labels) + (g.medals.newBest ? '<div class="newbest">NEW MEDAL</div>' : '') : '';
    $('go-medals').style.display = g.medals ? '' : 'none';
    const cols = g.cols || ['You', 'Enemy'];
    $('go-stats').innerHTML = '<span class="h"></span><span class="h" style="color:var(--c-player)">' + esc(cols[0]) + '</span><span class="h" style="color:var(--c-ai)">' + esc(cols[1]) + '</span>' +
      g.rows.map(r => `<span>${esc(r[0])}</span><b>${r[1]}</b><b>${r[2]}</b>`).join('');
    $('gameover').classList.add('show');
  }
  function hideGameOver() { $('gameover').classList.remove('show'); }

  function showHelp(on) { $('help').classList.toggle('show', on); }
  function isHelpOpen() { return $('help').classList.contains('show'); }

  function setMuted(m) { $('b-mute').innerHTML = icon(m ? 'mute' : 'sound'); }
  function setVolume(v) { $('vol').value = v; }

  return {
    init, icon, esc, isCompact, portrait, setCampaign, medalLabels, showBriefing, closeBriefing, isBriefingOpen, warnOverwrite, showGameUI, setHUD, setDock, setCards, setActions, setOrders, log, clearLog, showSelected, setObjectives,
    getLog, setLog, getSkirmishOptions, showHandoff, hideHandoff, isHandoffOpen,
    toast, showTip, hideTip, banner, floatText, setCombatHint, showReport, hideReport, showMenu, setContinue, setMusicChecked,
    showGameOver, hideGameOver, showHelp, isHelpOpen, setMuted, setVolume
  };
})();
