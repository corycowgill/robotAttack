// ============================================================
// Iron Strait — DOM user interface
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
    pause: '<path d="M8 5v14M16 5v14"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
    mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    log: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    decoy: '<path d="M6 20V11a6 6 0 0 1 12 0v9l-2-1.5L14 20l-2-1.5L10 20l-2-1.5z"/><path d="M9.5 11h.01M14.5 11h.01"/>',
    mine: '<path d="M4 18h16"/><ellipse cx="12" cy="15" rx="6" ry="2.5"/><path d="M12 12.5V9M9 10.5 7.5 8M15 10.5 16.5 8"/>',
    factory: '<path d="M3 21V10l5 3v-3l5 3v-3l5 3V4h3v17z"/><path d="M7 17h2M12 17h2M17 17h2"/>',
    base: '<path d="M4 20h16"/><path d="M6 20v-6a6 6 0 0 1 12 0v6"/><path d="M12 8V3l4 1.5L12 6"/><path d="M10 20v-3h4v3"/>',
    uplink: '<path d="M7 21l3-9h4l3 9"/><path d="M8.5 17h7"/><ellipse cx="12" cy="7" rx="6" ry="2"/><circle cx="12" cy="7" r="1"/><path d="M12 5V2"/>',
    strike: '<path d="M12 2v7"/><path d="M9 4l3 5 3-5"/><circle cx="12" cy="16" r="5"/><circle cx="12" cy="16" r="1.5"/><path d="M12 9v2M5 16h2M17 16h2"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    credits: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M3 11h18"/>',
    energy: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    swords: '<path d="M4 4l10 10M14 14l2 4 2-2-4-2M20 4L10 14M10 14l-2 4-2-2 4-2"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'
  };
  function icon(name, cls) {
    return '<svg class="ico ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICON[name] || '') + '</svg>';
  }

  const CSS = `
  /* Iron Strait palette: Command Navy #07111C, Steel Blue #172B3B, Friendly Cyan #2EC4FF, Hostile Orange #FF7A3D, Alert Red #FF4422, Armor Silver #D4DEE6 */
  :root { --c-navy: #07111c; --c-steel: #172b3b; --c-silver: #d4dee6; --c-hostile: #ff7a3d;
    --c-bg: rgba(7,17,28,.86); --c-bg2: rgba(20,36,50,.92); --c-line: rgba(120,165,205,.2); --c-text: #d4dee6; --c-dim: #7f93a6;
    --c-player: #2ec4ff; --c-ai: #ff4422; --c-credit: #66ff99; --c-energy: #ffd23f; --c-shield: #9d7cff; --c-warn: #ffb000; --c-bad: #ff4a3d; }
  #ui { position: fixed; inset: 0; pointer-events: none; font-family: 'Rajdhani', 'Segoe UI', system-ui, sans-serif; color: var(--c-text); z-index: 10; user-select: none; }
  #ui * { box-sizing: border-box; }
  /* Inter for running text; Rajdhani / Oxanium stay on headings, buttons and the HUD */
  #log, .speaker .say, #help p, #help li, .diff p, #selected .desc, #go-reason, #go-tip, .warnline, #objectives .obj span, #comms .line, .navbtn small { font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; letter-spacing: 0; }
  #log { font-size: 12.5px; } .speaker .say { font-size: 14px; }
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
  #hud .bar.notched { position: relative; }
  #hud .bar.notched::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(90deg, transparent 0 calc(var(--notch) - 1px), rgba(10,14,20,.9) calc(var(--notch) - 1px) var(--notch)); }
  #hud .segs { display: flex; gap: 3px; margin-top: 6px; }
  #hud .segs span { flex: 1; height: 4px; border-radius: 2px; background: rgba(255,255,255,.1); overflow: hidden; }
  #hud .segs span.hq { flex: 1.4; }
  #hud .segs span.dead { background: repeating-linear-gradient(135deg, rgba(255,80,60,.35) 0 3px, transparent 3px 6px); }
  #hud .segs i { display: block; height: 100%; transition: width .35s, background .35s; }
  body.compact #hud .segs { margin-top: 2px; } body.compact #hud .segs span { height: 3px; }
  #hud .bar > i { display: block; height: 100%; border-radius: 3px; transition: width .35s; }
  #hud-turn { text-align: center; min-width: 150px !important; }
  #hud-turn .val { font-size: 20px; letter-spacing: .08em; }
  #hud-turn.late .val { color: var(--c-warn); text-shadow: 0 0 10px rgba(255,176,0,.5); }   /* last turns before the limit */
  #hud-turn.late .val { animation: clockPulse .9s ease-in-out infinite alternate; }
  @keyframes clockPulse { to { color: #ff5a44; text-shadow: 0 0 16px rgba(255,70,40,.8); } }
  #hud-phase { font-size: 12px; letter-spacing: .2em; text-transform: uppercase; color: var(--c-warn); }
  .hq-cell { min-width: 150px !important; }
  #hud .full { animation: pulse 1s infinite; }
  @keyframes pulse { 50% { opacity: .45; } }

  /* top-right buttons */
  #sysbtns { position: absolute; top: 12px; right: 12px; display: flex; gap: 6px; }
  .iconbtn { width: 38px; height: 38px; display: grid; place-items: center; cursor: pointer; color: var(--c-text); }
  .iconbtn:hover { color: #fff; border-color: rgba(46,196,255,.6); }
  #vol { width: 90px; }

  /* Build bar */
  #dock { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; align-items: flex-end; transition: transform .35s, opacity .35s; max-width: calc(100vw - 16px); }
  #dock.hidden { transform: translate(-50%, 140%); opacity: 0; }
  #cards { display: flex; gap: 6px; padding: 8px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
  #crews { position: absolute; left: 6px; bottom: calc(100% + 6px); font: 600 11px/1 var(--mono, monospace); letter-spacing: .08em; color: #9fb3c4;
    background: rgba(8,14,20,.72); border: 1px solid rgba(120,160,190,.25); border-radius: 4px; padding: 4px 7px; pointer-events: none; display: none; }
  #crews.on { display: block; } #crews b { color: #5fd4ff; font-weight: 700; } #crews .q { color: #ffb347; }
  .card { flex: 0 1 clamp(64px, 5.7vw, 92px); min-width: 54px; height: clamp(76px, 5.9vw, 92px); border-radius: 8px; border: 1px solid var(--c-line); background: var(--c-bg2); cursor: pointer; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; transition: transform .12s, border-color .12s, background .12s; }
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
  .abtn.strike .ico { color: #3dffc8; } .abtn.strike .badge { top: 4px; right: 5px; font-size: 10px; letter-spacing: .06em; padding: 1px 4px; border-radius: 3px; background: rgba(5,10,16,.7); } .abtn.strike.sel { border-color: #3dffc8; background: rgba(61,255,200,.14); }
  .abtn.strike.ready:not(.off) { border-color: rgba(61,255,200,.7); animation: glowStrike 1.2s infinite; }
  @keyframes glowStrike { 50% { box-shadow: 0 0 18px rgba(61,255,200,.55); } }
  .order.strike .ico { color: #3dffc8; }
  .order.incoming.strike .ico { color: #ff5a3d; }
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
  #log { -webkit-mask-image: linear-gradient(transparent, #000 14px); mask-image: linear-gradient(transparent, #000 14px); flex: 1; overflow-y: auto; padding: 6px 10px 10px; font-size: 13px; line-height: 1.35; min-height: 60px; max-height: 32vh; }
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
  #tip b { font-size: 16px; } #tip .k { color: var(--c-dim); font-size: 13px; } #tip .bad { color: var(--c-bad); } #tip .good { color: var(--c-credit); } #tip .cnt { color: var(--c-warn); font-size: 13px; }
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
  .hintbtn { background: none; border: 0; color: inherit; font: inherit; cursor: pointer; padding: 2px 4px; border-radius: 4px; }
  .hintbtn:hover { color: var(--c-text); background: rgba(255,255,255,.06); }
  body.compact .hintbtn kbd { display: none; }
  #settings .menu-box { width: min(520px, 94vw); padding: 24px 26px; text-align: left; }
  #settings h2 { margin: 0 0 14px; letter-spacing: .14em; }
  .setrow { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 9px 0; border-bottom: 1px solid var(--c-line); font-size: 15px; }
  .setrow:last-of-type { border-bottom: 0; }
  .sethead { margin: 14px 0 2px; font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: var(--c-dim); font-weight: 600; }
  #settings h2 + .sethead { margin-top: 0; }
  #settings .menu-box { max-height: 92vh; overflow-y: auto; }
  /* Done stays reachable while the list scrolls */
  #settings .set-done-row { position: sticky; bottom: -24px; text-align: center; margin: 16px -26px -24px; padding: 12px 0 16px; background: linear-gradient(rgba(12,18,25,0), rgba(12,18,25,.98) 35%); }
  body.compact #settings .set-done-row { bottom: -12px; margin: 10px -16px -12px; padding: 8px 0 10px; }
  .setpair { display: flex; align-items: center; gap: 12px; }
  .setpair input[type=range] { width: min(120px, 24vw); }
  .setrow small { display: block; font-size: 12px; color: var(--c-dim); }
  .setrow input[type=range] { width: min(200px, 40vw); }
  /* Sliders: thin track filled up to the thumb (--p is set from JS) */
  input[type=range] { -webkit-appearance: none; appearance: none; height: 22px; background: transparent; cursor: pointer; --p: 50%; }
  input[type=range]::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: linear-gradient(90deg, var(--c-player) var(--p), rgba(255,255,255,.14) var(--p)); }
  input[type=range]::-moz-range-track { height: 4px; border-radius: 2px; background: rgba(255,255,255,.14); }
  input[type=range]::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--c-player); }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; margin-top: -5px; border-radius: 50%; background: #e8f6ff; border: 2px solid var(--c-player); box-shadow: 0 0 8px rgba(46,196,255,.55); }
  input[type=range]::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: #e8f6ff; border: 2px solid var(--c-player); box-shadow: 0 0 8px rgba(46,196,255,.55); }
  input[type=range]:focus-visible { outline: 2px solid var(--c-player); outline-offset: 2px; border-radius: 4px; }
  body.compact #settings .menu-box { padding: 12px 16px; } body.compact .setrow { padding: 5px 0; font-size: 13px; }

  /* Report */
  /* Real-time attack panel: pick which loaded silos, mechs and strike go */
  #attack { position: absolute; left: 50%; bottom: 128px; transform: translateX(-50%); width: min(580px, 94vw); padding: 12px 16px; display: none; z-index: 4; }
  #attack.show { display: block; animation: tin .2s ease-out; }
  /* wide screens: dock it over your own island so the enemy island stays clear to click */
  @media (min-width: 1000px) { body:not(.compact) #attack { left: 12px; transform: none; width: min(520px, 42vw); } }
  #attack .ah { font-size: 15px; margin-bottom: 8px; } #attack .ah b { letter-spacing: .14em; color: var(--c-warn); } #attack .ah .k { float: right; color: var(--c-dim); font-size: 12px; margin-top: 2px; }
  #attack .arow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 5px 0; }
  #attack .al { width: 64px; font-size: 11px; color: var(--c-dim); text-transform: uppercase; letter-spacing: .1em; }
  #attack .none { font-size: 12px; color: var(--c-dim); }
  #attack .ach { display: flex; align-items: center; gap: 6px; padding: 5px 9px; border-radius: 7px; border: 1px solid var(--c-line); background: rgba(255,255,255,.04); color: #c5d2de; font: inherit; font-size: 13px; cursor: pointer; }
  #attack .ach svg { width: 16px; height: 16px; } #attack .ach small { color: var(--c-dim); font-size: 11px; }
  #attack .ach.on { border-color: var(--c-warn); background: rgba(255,176,0,.16); color: #fff; } #attack .ach.on span { color: #fff; } #attack .ach.on small { color: #ffd98a; }
  #attack .ach.wait { opacity: .45; cursor: default; }
  #attack .arow.kit { margin: 2px 0 8px; } #attack .arow.kit .seg { display: inline-flex; border: 1px solid var(--c-line); border-radius: 6px; overflow: hidden; }
  #attack .akit { padding: 4px 10px; border: 0; border-right: 1px solid var(--c-line); background: rgba(255,255,255,.03); color: #b9c8d6; font: 600 13px 'Rajdhani', sans-serif; letter-spacing: .06em; cursor: pointer; }
  #attack .akit:last-child { border-right: 0; } #attack .akit small { color: var(--c-energy); opacity: .75; font-size: 11px; }
  #attack .akit.on { background: rgba(46,196,255,.22); color: #fff; box-shadow: inset 0 -2px 0 var(--c-player); }
  #attack .kdesc { flex: 1 1 100%; padding-left: 70px; font: 400 11.5px 'Inter', sans-serif; color: var(--c-dim); }
  body.compact #attack .kdesc { display: none; } body.compact #attack .akit { padding: 4px 7px; font-size: 12px; }
  #attack .aodds { font-size: 12px; color: var(--c-dim); margin: 6px 0 8px; } #attack .aodds .good { color: var(--c-credit); }
  #attack .afoot { display: flex; align-items: center; gap: 10px; font-size: 13px; }
  #attack .afoot .cost { margin-right: auto; } #attack .afoot .bad { color: var(--c-bad); }
  #attack .afoot button { padding: 7px 16px; font-size: 14px; }
  #attack .afoot button[disabled] { opacity: .45; cursor: default; }
  body.compact #attack { bottom: 66px; padding: 8px 10px; } body.compact #attack button kbd { display: none; }
  /* phone landscape: a column over your own island (left), so the enemy island stays tappable */
  @media (orientation: landscape) { body.compact #attack { left: calc(var(--safe-l, 0px) + 6px); transform: none; width: min(330px, 42vw); top: 44px; bottom: 66px; overflow-y: auto; } body.compact #attack .afoot { flex-wrap: wrap; } body.compact #attack .afoot .cost { flex-basis: 100%; } } body.compact #attack .ah .k { display: none; } body.compact #attack .ach small { display: none; }
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
  /* ── Logo (title screen + menu header) ── */
  .logo { position: relative; display: inline-block; text-align: center; user-select: none; }
  /* IRON STRAIT: heavy, tightly kerned, brushed-steel letters with restrained weathering */
  .logo-main { position: relative; font-family: 'Oxanium', 'Russo One', 'Rajdhani', system-ui, sans-serif; font-weight: 800; font-size: clamp(40px, min(8.6vw, 15vh), 136px); letter-spacing: .015em; line-height: .95; white-space: nowrap; font-style: italic;
    filter: drop-shadow(0 2px 0 #0b1a26) drop-shadow(0 3px 0 #04090f) drop-shadow(0 10px 18px rgba(0,0,0,.7)); }
  .logo-main .ch { display: inline-block; padding: 0 .015em;
    background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='w'><feTurbulence type='fractalNoise' baseFrequency='.55' numOctaves='2' seed='7'/><feColorMatrix values='0 0 0 0 .1  0 0 0 0 .12  0 0 0 0 .14  0 0 0 -2.6 1.1'/></filter><rect width='220' height='220' filter='url(%23w)'/></svg>"),
      linear-gradient(176deg, #ffffff 0%, #eef3f6 22%, #c3ced7 44%, #7d8a96 50%, #a9b6c1 56%, #e4ebf0 80%, #b9c5cf 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-stroke: 1px rgba(232,240,246,.45); }
  .logo-main .sp { display: inline-block; width: .28em; }
  /* the strait emblem: two coasts, the channel between them and a missile arcing across */
  .emblem { display: block; width: clamp(150px, 19vw, 290px); margin: 0 auto -.2em; overflow: visible; filter: drop-shadow(0 4px 10px rgba(0,0,0,.6)); }
  .emblem .land { fill: url(#emb-steel); stroke-width: 2.4; stroke-linejoin: round; } .emblem .land.us { stroke: #2ec4ff; } .emblem .land.them { stroke: #ff7a3d; }
  .emblem .water { stroke: #2ec4ff; stroke-opacity: .35; stroke-width: 1.2; fill: none; }
  .emblem .arc { fill: none; stroke: url(#emb-trail); stroke-width: 3.4; stroke-linecap: round; stroke-dasharray: 150; stroke-dashoffset: 0; }
  .emblem .head { fill: #fff3d6; } .emblem .boom { fill: none; stroke: #ff7a3d; stroke-width: 1.6; opacity: .9; }
  .emblem .bunker { fill: #0b1824; } .emblem .head { filter: drop-shadow(0 0 3px #ffb070); }
  .logo.reveal .emblem .land.us { animation: embL .7s .35s cubic-bezier(.2,.8,.2,1) both; }
  .logo.reveal .emblem .land.them { animation: embR .7s .35s cubic-bezier(.2,.8,.2,1) both; }
  .logo.reveal .emblem .arc { animation: embArc .8s .95s ease-in both; }
  .logo.reveal .emblem .head { animation: fadeIn .2s 1.65s both; opacity: 0; }
  .logo.reveal .emblem .boom { transform-origin: 160px 37px; animation: embBoom .7s 1.7s ease-out both; }
  @keyframes embL { from { transform: translateX(-26px); opacity: 0; } }
  @keyframes embR { from { transform: translateX(26px); opacity: 0; } }
  @keyframes embArc { from { stroke-dashoffset: 150; } }
  @keyframes embBoom { 0% { transform: scale(.2); opacity: 0; } 30% { opacity: 1; } 100% { transform: scale(1.6); opacity: 0; } }
  .logo.reveal.skip .emblem * { animation-duration: .01s !important; animation-delay: 0s !important; }
  .logo-main::after { content: attr(data-text); position: absolute; inset: 0; letter-spacing: inherit; pointer-events: none;
    background: linear-gradient(105deg, transparent 42%, rgba(255,255,255,.95) 50%, transparent 58%) no-repeat; background-size: 260% 100%; background-position: 160% 0;
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  .logo.sweep .logo-main::after { animation: logoSweep 4.5s 0.2s ease-in-out infinite; }
  .logo.reveal.sweep .logo-main::after { animation-delay: 2.7s; }   /* never sweep over letters that haven't landed */
  .logo.reveal.sweep.skip .logo-main::after { animation-delay: .4s; }
  @keyframes logoSweep { 0% { background-position: 160% 0; } 45%, 100% { background-position: -60% 0; } }
  .logo-sub { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: .5em; font-size: clamp(12px, 1.45vw, 20px); font-weight: 700; letter-spacing: .5em; color: var(--c-silver); text-shadow: 0 2px 6px #000; }
  .logo-sub i { display: block; height: 2px; width: clamp(40px, 9vw, 130px); background: linear-gradient(90deg, transparent, #2ec4ff); box-shadow: 0 0 8px rgba(46,196,255,.6); }
  .logo-sub i:last-child { transform: scaleX(-1); }
  /* reveal animation (title screen) */
  .logo.reveal .logo-main .ch { opacity: 0; transform: translateY(-.5em) scale(1.35); filter: blur(10px); animation: chIn .55s cubic-bezier(.2,.9,.25,1.15) forwards; animation-delay: calc(1.1s + var(--i) * 55ms); }
  @keyframes chIn { to { opacity: 1; transform: none; filter: none; } }
  .logo.reveal .logo-main::before { content: ''; position: absolute; inset: -20% -6%; background: radial-gradient(ellipse at center, rgba(255,214,170,.85), transparent 62%); opacity: 0; animation: logoFlash .7s 1.95s ease-out; pointer-events: none; }
  @keyframes logoFlash { 0% { opacity: 0; } 15% { opacity: .85; } 100% { opacity: 0; } }
  .logo.reveal .logo-sub { opacity: 0; animation: fadeIn .6s 2.25s forwards; }
  .logo.reveal .logo-sub i { transform: scaleX(0); animation: lineOut .7s 2.3s cubic-bezier(.2,.8,.2,1) forwards; }
  .logo.reveal .logo-sub i:last-child { animation-name: lineOutR; }
  @keyframes lineOut { from { transform: scaleX(0); transform-origin: right; } to { transform: scaleX(1); transform-origin: right; } }
  @keyframes lineOutR { from { transform: scaleX(0) scaleX(-1); } to { transform: scaleX(-1); } }
  @keyframes fadeIn { to { opacity: 1; } }
  .logo.reveal.skip .logo-main .ch, .logo.reveal.skip .logo-sub, .logo.reveal.skip .logo-sub i { animation-delay: 0s !important; animation-duration: .01s !important; }
  .logo.reveal.skip .logo-main::before { animation: none; }
  /* title screen */
  #splash { background: radial-gradient(ellipse at 50% 42%, rgba(5,8,12,0) 30%, rgba(5,8,12,.7) 100%); flex-direction: column; cursor: pointer; z-index: 25; }
  #splash .bars::before, #splash .bars::after { content: ''; position: absolute; left: 0; right: 0; height: 11vh; background: #000; transition: transform .8s cubic-bezier(.6,0,.2,1); z-index: 1; }
  #splash .bars::before { top: 0; } #splash .bars::after { bottom: 0; }
  #splash.out .bars::before { transform: translateY(-100%); } #splash.out .bars::after { transform: translateY(100%); }
  #splash .black { position: absolute; inset: 0; background: #000; animation: blackOut 1.4s .1s ease-out forwards; pointer-events: none; z-index: 2; }
  #splash.skip .black { animation-duration: .2s; animation-delay: 0s; }
  @keyframes blackOut { to { opacity: 0; visibility: hidden; } }
  #splash .press { margin-top: clamp(26px, 7vh, 70px); padding: 8px 26px 8px 34px; font-size: clamp(15px, 1.8vw, 22px); font-weight: 700; letter-spacing: .5em; color: #e8f6ff; opacity: 0; animation: fadeIn .6s 3s forwards;
    text-shadow: 0 0 12px rgba(46,196,255,.6), 0 2px 4px #000; background: radial-gradient(ellipse at center, rgba(3,8,14,.62), transparent 70%); }
  #splash .press span { display: inline-block; animation: pressPulse 1.6s 3.6s ease-in-out infinite; }
  #splash.skip .press { animation-delay: .1s; } #splash.skip .press span { animation-delay: .5s; }
  @keyframes pressPulse { 50% { opacity: .35; } }
  #splash .foot { position: absolute; bottom: calc(11vh + 14px); left: 0; right: 0; text-align: center; font-size: 12px; letter-spacing: .32em; text-transform: uppercase; color: rgba(200,225,240,.55); opacity: 0; animation: fadeIn 1s 3.4s forwards; z-index: 3; }
  #splash.skip .foot { animation-delay: .2s; }
  #splash.out { opacity: 0; transition: opacity .7s .35s; pointer-events: none; }
  #splash.out .logo { transform: scale(1.06); transition: transform 1s ease-out; }
  /* menu header + entrance */
  .title { margin-bottom: 4px; } .title .logo-main { font-size: clamp(42px, min(7.4vw, 13vh), 116px); }
  #menu.enter .menu-box > * { opacity: 0; transform: translateY(18px); animation: menuIn .55s cubic-bezier(.2,.8,.2,1) forwards; }
  #menu.enter .menu-box > *:nth-child(1) { animation-delay: .05s; } #menu.enter .menu-box > *:nth-child(2) { animation-delay: .12s; }
  #menu.enter .menu-box > *:nth-child(3) { animation-delay: .18s; } #menu.enter .menu-box > *:nth-child(4) { animation-delay: .22s; }
  #menu.enter .menu-box > *:nth-child(5) { animation-delay: .26s; } #menu.enter .menu-box > *:nth-child(6) { animation-delay: .3s; }
  #menu.enter .menu-box > *:nth-child(7) { animation-delay: .36s; } #menu.enter .menu-box > *:nth-child(n+8) { animation-delay: .42s; }
  @keyframes menuIn { to { opacity: 1; transform: none; } }
  #menu { background: linear-gradient(180deg, rgba(5,8,12,.35) 0%, rgba(5,8,12,.55) 35%, rgba(5,8,12,.86) 100%); align-items: flex-start; overflow-y: auto; }
  #menu .menu-box { margin: auto; padding: 18px 0 22px; }  /* centred when it fits, scrollable (never clipped) when it doesn't */
  @media (max-width: 700px) { #menu .menu-box { padding-top: 58px; } }  /* clear of the corner buttons */
  /* ── main menu: landing (home) and the campaign / skirmish pick views ── */
  #menu { background: linear-gradient(180deg, rgba(7,17,28,.25) 0%, rgba(7,17,28,.45) 40%, rgba(7,17,28,.88) 100%); }
  #menu { isolation: isolate; z-index: 0; }   /* keep the menu's own layers inside it, under later screens (settings, help) */
  #menu .menu-box { position: relative; z-index: 1; }
  #menu[data-view="home"] .pick, #menu:not([data-view="home"]) .home { display: none; }
  #menu[data-view="campaign"] .v-sk, #menu[data-view="skirmish"] .v-camp { display: none !important; }
  #menu .home { display: flex; flex-direction: column; align-items: center; }
  @media (min-width: 1100px) { #menu .home { transform: translateX(min(8vw, 130px)); } }   /* the key art owns the left */
  .tagline { margin: 14px 0 26px; font: 700 clamp(13px, 1.5vw, 19px) 'Rajdhani', sans-serif; letter-spacing: .55em; text-transform: uppercase; color: var(--c-silver); text-shadow: 0 2px 6px #000; padding-left: .55em; }
  .tagline b { color: var(--c-player); font-weight: 700; }
  .mainnav { display: flex; flex-direction: column; gap: 10px; width: min(420px, 90vw); }
  .navbtn { position: relative; display: grid; grid-template-columns: auto 1fr auto; align-items: center; column-gap: 14px; text-align: left; width: 100%;
    padding: 12px 18px; border-radius: 4px; cursor: pointer; font: 700 20px 'Rajdhani', sans-serif; letter-spacing: .16em; text-transform: uppercase; color: var(--c-silver);
    background: linear-gradient(180deg, rgba(23,43,59,.92), rgba(7,17,28,.92)); border: 1px solid rgba(212,222,230,.18);
    clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px); transition: border-color .15s, background .15s, transform .15s, color .15s; }
  .navbtn .ico { width: 22px; height: 22px; color: var(--c-player); grid-row: span 2; }
  .navbtn small { grid-column: 2; font-size: 12px; font-weight: 500; text-transform: none; color: var(--c-dim); margin-top: 2px; }
  .navbtn .vs { grid-column: 3; grid-row: 1 / span 2; font-size: 12px; letter-spacing: .08em; color: var(--c-dim); text-align: right; }
  .navbtn .vs b { display: block; font-size: 18px; color: var(--c-warn); letter-spacing: .04em; }
  .navbtn em { font-style: normal; font-size: 13px; letter-spacing: .1em; color: var(--c-warn); margin-left: 6px; }
  .navbtn:hover, .navbtn:focus-visible { border-color: rgba(46,196,255,.75); color: #fff; background: linear-gradient(180deg, rgba(30,62,84,.95), rgba(10,24,38,.95)); transform: translateX(4px); outline: none; }
  .navbtn::before { content: ''; position: absolute; left: 0; top: 10px; bottom: 10px; width: 3px; background: var(--c-player); opacity: 0; transition: opacity .15s; }
  .navbtn:hover::before, .navbtn:focus-visible::before, .navbtn.primary::before { opacity: 1; }
  .navbtn.primary { padding: 16px 20px; font-size: 24px; border-color: rgba(46,196,255,.65); box-shadow: inset 0 0 0 1px rgba(46,196,255,.15), 0 0 24px rgba(46,196,255,.18);
    background: linear-gradient(180deg, rgba(22,70,100,.95), rgba(8,30,48,.95)); }
  .navrow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 4px; }
  .navbtn.small { display: block; text-align: center; padding: 9px 6px; font-size: 13px; letter-spacing: .06em; white-space: nowrap; }
  .navbtn.small:hover, .navbtn.small:focus-visible { transform: translateY(-2px); }
  .mission:focus-visible, .diff:focus-visible { outline: 2px solid rgba(46,196,255,.85); outline-offset: 2px; }
  #menu .home .menu-foot { margin-top: 18px; }
  #menu[data-view="campaign"] .missions { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  #menu[data-view="campaign"] .mission { padding: 14px 14px 16px; } #menu[data-view="campaign"] .mission h4 { font-size: 20px; margin: 4px 0 10px; }
  #menu[data-view="campaign"] .mission .vs { font-size: 13px; gap: 10px; } #menu[data-view="campaign"] .mission .vs svg { width: 56px; height: 56px; }
  @media (max-width: 900px) { #menu[data-view="campaign"] .missions { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .pickbar { display: grid; grid-template-columns: 120px 1fr 120px; align-items: center; margin: 4px 0 18px; }
  .pickbar .back { width: auto; }
  .pick-title { text-align: center; font: 700 22px 'Oxanium', 'Rajdhani', sans-serif; letter-spacing: .32em; text-transform: uppercase; color: var(--c-silver); }
  /* key art (commanders) on the left, haze, missile trails and a radar scope over the live backdrop */
  .menu-fx { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 0; }
  .keyart { position: absolute; left: 0; top: 0; bottom: 0; width: min(46.3vh, 34vw); background: url('assets/brand/commanders.webp') left center / cover no-repeat;
    -webkit-mask-image: linear-gradient(90deg, #000 58%, transparent), linear-gradient(0deg, transparent, #000 18%); mask-image: linear-gradient(90deg, #000 58%, transparent);
    opacity: 0; animation: fadeIn 1.2s .2s forwards; }
  #menu:not([data-view="home"]) .keyart { opacity: .22 !important; transition: opacity .4s; }
  .haze { position: absolute; inset: -10% -30%; background: radial-gradient(ellipse 40% 30% at 30% 70%, rgba(120,150,175,.12), transparent 70%), radial-gradient(ellipse 35% 25% at 75% 60%, rgba(255,122,61,.07), transparent 70%);
    animation: hazeDrift 38s linear infinite alternate; }
  @keyframes hazeDrift { to { transform: translateX(14%); } }
  .trails { position: absolute; right: 0; top: 4%; width: 62%; height: 46%; opacity: .8; }
  .trails path { fill: none; stroke: #ffd2a0; stroke-width: 2.2; stroke-linecap: round; stroke-dasharray: 60 1400; stroke-dashoffset: 60; filter: drop-shadow(0 0 6px #ff7a3d);
    animation: trail 7s linear infinite; }
  .trails path:nth-child(2) { animation-delay: 2.6s; animation-duration: 8.5s; } .trails path:nth-child(3) { animation-delay: 5s; animation-duration: 6.5s; }
  @keyframes trail { 0% { stroke-dashoffset: 60; opacity: 0; } 6% { opacity: 1; } 70% { opacity: 1; } 100% { stroke-dashoffset: -1300; opacity: 0; } }
  .radar { position: absolute; right: 22px; bottom: 22px; width: 132px; height: 132px; border-radius: 50%; border: 1px solid rgba(46,196,255,.45);
    background: radial-gradient(circle, transparent 32%, rgba(46,196,255,.18) 33%, transparent 34%, transparent 65%, rgba(46,196,255,.18) 66%, transparent 67%), rgba(7,17,28,.55);
    box-shadow: 0 0 18px rgba(46,196,255,.15), inset 0 0 20px rgba(46,196,255,.08); }
  .radar::before, .radar::after { content: ''; position: absolute; background: rgba(46,196,255,.2); } .radar::before { left: 50%; top: 4%; bottom: 4%; width: 1px; } .radar::after { top: 50%; left: 4%; right: 4%; height: 1px; }
  .radar .sweep { position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(from 0deg, rgba(46,196,255,.45), rgba(46,196,255,0) 22%); animation: sweep 4s linear infinite; }
  @keyframes sweep { to { transform: rotate(360deg); } }
  .radar i { position: absolute; width: 5px; height: 5px; border-radius: 50%; background: #2ec4ff; box-shadow: 0 0 6px #2ec4ff; animation: blip 4s ease-out infinite; }
  .radar i.foe { background: #ff7a3d; box-shadow: 0 0 6px #ff7a3d; animation-delay: 1.6s; }
  @keyframes blip { 0%, 100% { opacity: .25; } 10% { opacity: 1; } }
  .radar span { position: absolute; top: calc(100% + 6px); right: 0; white-space: nowrap; font: 600 10px 'Share Tech Mono', monospace; letter-spacing: .18em; color: rgba(46,196,255,.7); }
  @media (max-width: 900px), (max-height: 520px) { .keyart, .radar { display: none; } .trails { width: 100%; } }
  @media (prefers-reduced-motion: reduce) { .trails path, .radar .sweep, .radar i, .haze { animation: none; } .trails { display: none; } }
  body.compact .navbtn { padding: 9px 14px; font-size: 16px; } body.compact .navbtn.primary { padding: 11px 14px; font-size: 18px; } body.compact .navbtn small { display: none; }
  body.compact .navbtn.small { font-size: 12px; letter-spacing: .03em; white-space: normal; padding: 8px 4px; }
  body.compact .mainnav { gap: 6px; } body.compact .tagline { margin: 8px 0 12px; font-size: 11px; letter-spacing: .35em; }
  body.splash-on #sysbtns, body.splash-on #hud { visibility: hidden; }
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
  .mission .vs svg { width: 34px; height: 34px; flex: none; }
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
  .speaker svg { width: 116px; height: 116px; flex: none; }
  .speaker .who { font-weight: 700; font-size: 18px; } .speaker .role { font-size: 12px; color: var(--c-dim); letter-spacing: .1em; text-transform: uppercase; margin-bottom: 6px; }
  .speaker .say { font-size: 15px; line-height: 1.4; color: #d3dee9; }
  .speaker.enemy .say { color: #ffb4a6; font-style: italic; }
  #gameover { align-items: flex-start; overflow-y: auto; }
  #gameover .menu-box { width: min(660px, 94vw); padding: 28px; margin: auto; }  /* centred when it fits, scrollable when it doesn't */
  @media (max-height: 760px) { #gameover .menu-box { padding: 16px 22px; } }
  /* the buttons stay on screen while a long debrief scrolls */
  #gameover .go-btns { position: sticky; bottom: 0; padding: 10px 0 6px; background: linear-gradient(rgba(10,15,22,0), rgba(10,15,22,.97) 30%); }
  .opts { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 18px; margin: 0 0 12px; }
  .opt { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--c-dim); letter-spacing: .06em; }
  .opt .seg { display: flex; border: 1px solid var(--c-line); border-radius: 6px; overflow: hidden; }
  .opt button { background: var(--c-bg2); color: var(--c-text); border: 0; border-right: 1px solid var(--c-line); padding: 5px 10px; font: inherit; font-weight: 700; font-size: 13px; cursor: pointer; }
  .opt button:last-child { border-right: 0; }
  .opt button.on { background: rgba(46,196,255,.22); color: #fff; }
  body.compact .opts { gap: 6px 10px; margin-bottom: 8px; } body.compact .opt { font-size: 11px; } body.compact .opt button { padding: 4px 7px; font-size: 11px; }
  .hotseat { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 12px; padding: 12px 16px; cursor: pointer; text-align: left; transition: transform .15s, border-color .15s; }
  .hotseat:hover { transform: translateY(-3px); border-color: rgba(46,196,255,.7); }
  .hotseat.daily { border-color: rgba(255,207,74,.35); } .hotseat.daily h3 { color: #ffcf4a; } .hotseat.daily h3 span { color: var(--c-dim); font-size: 13px; letter-spacing: .1em; margin-left: 6px; }
  .hotseat.daily .vs { font-size: 15px; color: var(--c-dim); text-align: right; } .hotseat.daily .vs b, .hotseat.daily .vs b:last-child { color: #ffcf4a; font-size: 20px; display: block; }
  /* post-battle chart: two small multiples (different scales never share an axis) */
  #go-chart { margin: 4px 0 14px; }
  #go-chart .legend { display: flex; justify-content: center; gap: 16px; font-size: 12px; color: var(--c-dim); margin-bottom: 4px; }
  #go-chart .legend i { display: inline-block; width: 14px; height: 2px; vertical-align: middle; margin-right: 5px; border-radius: 2px; }
  #go-chart .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  #go-chart figure { margin: 0; position: relative; }
  #go-chart figcaption { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--c-dim); margin-bottom: 2px; }
  #go-chart svg { width: 100%; height: auto; display: block; overflow: visible; }
  #go-chart .tipbox { position: absolute; pointer-events: none; background: var(--c-bg2); border: 1px solid var(--c-line); border-radius: 4px; padding: 4px 7px; font-size: 11px; color: var(--c-text); white-space: nowrap; display: none; }
  body.compact #go-chart .charts { gap: 8px; } body.compact #go-chart figcaption { font-size: 10px; }
  #go-daily { text-align: center; margin: 4px 0 12px; font-size: 15px; color: var(--c-dim); letter-spacing: .08em; }
  #go-daily b { color: #ffcf4a; font-size: 26px; letter-spacing: .04em; margin: 0 6px; }
  #achievements .menu-box { width: min(640px, 94vw); padding: 24px 26px; text-align: left; max-height: 90vh; overflow-y: auto; }
  .achs { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; margin: 14px 0; }
  .ach { padding: 10px 12px; border: 1px solid var(--c-line); border-radius: 6px; opacity: .45; }
  .ach.got { opacity: 1; border-color: rgba(255,207,74,.5); background: rgba(255,207,74,.06); }
  .ach b { display: block; font-size: 15px; } .ach.got b::before { content: '🏆 '; } .ach span { font-size: 12px; color: var(--c-dim); }
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
  #go-tip { margin: -10px auto 16px; max-width: 520px; font-size: 14px; color: var(--c-warn); }
  #go-tip:empty { display: none; }
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
  #help .credits { font-size: 12.5px; color: #8fa1b3; }
  #help .credits a { color: inherit; }
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
  .abtn.nudge, .card.nudge { animation: firenudge 1.1s ease-in-out infinite alternate; }
  @keyframes firenudge { from { box-shadow: 0 0 0 rgba(255,176,0,0); } to { box-shadow: 0 0 16px rgba(255,176,0,.75); border-color: var(--c-warn); } }
  /* colour grade for a colder, grittier war: a touch less colour, a touch more contrast */
  /* colour grade: CSS on Medium; done in the post shader on High (with film grain); off on Low */
  body[data-fx="css"] #game-canvas { filter: saturate(.84) contrast(1.08) brightness(.98); }
  #grain { position: absolute; inset: -50%; pointer-events: none; opacity: .07; mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>");
    animation: grainShift .5s steps(4) infinite; }
  @keyframes grainShift { 0% { transform: translate(0,0); } 25% { transform: translate(-3%,2%); } 50% { transform: translate(2%,-3%); } 75% { transform: translate(-2%,-1%); } }
  @media (prefers-reduced-motion: reduce) { #grain { animation: none; } }
  body.splash-on #grain, body:not([data-fx="grain"]) #grain { display: none; }
  #vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse 75% 70% at 50% 48%, transparent 55%, rgba(2,5,9,.42) 100%); }
  body.splash-on #vignette { display: none; }
  #danger { position: absolute; inset: 0; pointer-events: none; --dg: 0; opacity: var(--dg); transition: opacity .35s;
    box-shadow: inset 0 0 160px 30px rgba(255,40,24,.55), inset 0 0 40px 4px rgba(255,60,30,.35); }
  /* enemy commander on the radio: a portrait card that slides in for a few seconds */
  #comms { position: absolute; left: 12px; top: 96px; display: flex; gap: 10px; align-items: center; max-width: min(380px, 60vw); padding: 8px 14px 8px 8px; pointer-events: none; z-index: 3;
    opacity: 0; transform: translateX(-30px); transition: opacity .3s, transform .3s; border-left: 3px solid var(--cc, var(--c-ai)); }
  #comms.show { opacity: 1; transform: none; }
  #comms svg { width: 64px; height: 64px; flex: none; }
  #comms .who { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--cc, var(--c-ai)); }
  #comms .line { font-size: 15px; line-height: 1.3; color: #e8eef4; }
  body.compact #comms { top: 46px; max-width: 70vw; } body.compact #comms svg { width: 38px; height: 38px; } body.compact #comms .line { font-size: 13px; }
  #flash { position: absolute; inset: 0; pointer-events: none; z-index: 1; background: #dfe9ff; opacity: 0; }
  #flash.go { animation: boltFlash .45s ease-out; }
  @keyframes boltFlash { 0% { opacity: .55; } 12% { opacity: .1; } 22% { opacity: .4; } 100% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { #flash.go { animation: none; } }
  #danger.pulse { animation: dangerPulse .7s ease-in-out infinite alternate; }
  @keyframes dangerPulse { from { filter: brightness(.55); } to { filter: brightness(1.25); } }
  @media (prefers-reduced-motion: reduce) { #danger.pulse { animation: none; } }
  #b-log { display: none; position: relative; }
  #b-log.alert { border-color: var(--c-bad); animation: logpulse 1s ease-in-out infinite alternate; }
  #b-log.alert::after { content: attr(data-n); position: absolute; top: -5px; right: -5px; min-width: 16px; height: 16px; border-radius: 8px; background: var(--c-bad); color: #fff; font-size: 11px; font-weight: 700; display: grid; place-items: center; }
  @keyframes logpulse { to { box-shadow: 0 0 12px rgba(255,80,60,.8); } }
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
  body.compact .card { flex: none; min-width: 0; width: 52px; height: 56px; border-radius: 6px; gap: 1px; }
  body.compact .card .ico { width: 20px; height: 20px; }
  body.compact .card .nm { font-size: 8.5px; letter-spacing: 0; }
  body.compact .card .cost { font-size: 10px; }
  body.compact .card .key, body.compact .card .cnt { display: none; }
  body.compact #actions { padding: 4px; gap: 4px; }
  body.compact .abtn { min-width: 58px !important; height: 56px; font-size: 10px; gap: 1px; border-radius: 6px; }
  body.compact .abtn .ico { width: 20px; height: 20px; }
  body.compact .abtn small, body.compact .abtn .badge { display: none; }
  body.compact #selected .uphint { display: none; }
  body.compact #selected { right: calc(var(--safe-r) + 6px); bottom: 70px; width: min(226px, 36vw); max-height: calc(100% - 120px); padding: 8px 10px; }
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
  body.compact .title .logo-main { font-size: 34px; } body.compact .title .logo-sub { font-size: 10px; margin-top: .3em; }
  body.compact #splash { align-items: center; justify-content: center; padding: 0; overflow: hidden; }
  body.compact #splash .bars::before, body.compact #splash .bars::after { height: 7vh; } body.compact #splash .foot { bottom: calc(7vh + 8px); font-size: 10px; } body.compact .tag { margin: 8px 0 12px; font-size: 10px; letter-spacing: .18em; }
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
    body.compact .hq-cell .val::before { content: attr(data-tag); font-size: 9px; letter-spacing: .06em; text-transform: uppercase; margin-right: 3px; vertical-align: 2px; opacity: .8; }
    body.compact #h-hq::before { color: var(--c-player); } body.compact #h-ehq::before { color: var(--c-ai); }
    body.compact #sysbtns { top: 46px; }
    body.compact #objectives { top: 88px; max-width: calc(100vw - 16px); }
    body.compact #toasts { top: 120px; }
    body.compact #cards { max-width: calc(100vw - 200px); }
  }
  /* phone portrait: stack the dock, every build card visible in two rows of six above the attack buttons */
  @media (max-width: 600px) and (orientation: portrait) {
    body.compact #dock { flex-direction: column; align-items: stretch; gap: 4px; left: calc(var(--safe-l) + 4px); right: calc(var(--safe-r) + 4px); transform: none; max-width: none; }
    body.compact #cards { max-width: none; flex-wrap: wrap; overflow: visible; justify-content: center; }
    body.compact .card { width: calc((100vw - var(--safe-l) - var(--safe-r) - 8px - 12px - 26px) / 6); height: 50px; }
    body.compact #actions { justify-content: center; }
    body.compact .abtn { flex: 1 1 0; height: 48px; }
  }

  @media (max-height: 820px) { #selected .desc { display: none; } #selected ul { font-size: 12px; } #selected h3 { font-size: 17px; } #selected { padding: 10px 12px; max-height: max(110px, calc(100vh - 480px)); } #orders { max-height: max(150px, calc(100vh - 410px)); } }
  /* very short windows: the orders and log panel opens from a button instead */
  @media (max-height: 540px) { body:not(.compact) #orders { display: none; z-index: 4; max-height: calc(100vh - 210px); } body:not(.compact) #orders.open { display: flex; } body:not(.compact) #b-log { display: grid; } }
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
      <div class="cell hq-cell"><div class="lbl" id="h-hql" style="color:var(--c-player)">Your HQ</div><div class="val" id="h-hq" data-tag="You">200</div><div class="bar"><i id="h-hqb" style="background:var(--c-player)"></i></div><div class="segs" id="h-hqs"></div></div>
      <div class="cell hq-cell"><div class="lbl" id="h-ehql" style="color:var(--c-ai)">Enemy HQ</div><div class="val" id="h-ehq" data-tag="Foe">200</div><div class="bar"><i id="h-ehqb" style="background:var(--c-ai)"></i></div><div class="segs" id="h-ehqs"></div></div>
    `));

    root.appendChild(el('div', { id: 'sysbtns', class: 'pi' }, `
      <div class="panel" style="display:flex;align-items:center;padding:0 10px;gap:6px" title="Master volume"><input id="vol" type="range" min="0" max="1" step="0.05"></div>
      <div class="panel iconbtn" id="b-mute" title="Mute (M)">${icon('sound')}</div>
      <div class="panel iconbtn" id="b-log" title="Orders & battle log">${icon('log')}</div>
      <div class="panel iconbtn" id="b-settings" title="Settings">${icon('gear')}</div>
      <div class="panel iconbtn" id="b-help" title="How to play (?)">${icon('help')}</div>
      <div class="panel iconbtn" id="b-menu" title="Save &amp; return to menu" style="display:none">${icon('menu')}</div>
    `));

    root.appendChild(el('div', { id: 'objectives', class: 'panel pi', style: 'display:none' }));
    root.appendChild(el('div', { id: 'orders', class: 'panel pi', style: 'display:none' }, `
      <div class="ph"><span id="ord-title">Orders this turn</span><button class="sbtn" id="b-undo" title="Undo last action (Z)" style="flex:none;padding:3px 8px;font-size:12px">${icon('undo')} Undo <kbd>Z</kbd></button></div>
      <div id="orderlist"></div>
      <div class="ph"><span>Battle log</span></div>
      <div id="log"></div>
    `));
    root.appendChild(el('div', { id: 'selected', class: 'panel pi' }));

    root.appendChild(el('div', { id: 'dock', class: 'hidden pi' }, `
      <div id="crews" aria-live="polite"></div>
      <div id="cards" class="panel"></div>
      <div id="actions" class="panel">
        <button class="abtn fire" id="b-fire">${icon('missile')}<span>Fire Missile</span><small><kbd>Q</kbd> <span id="fire-sub"></span></small><span class="badge" id="fire-badge"></span></button>
        <button class="abtn drop" id="b-drop">${icon('drop')}<span>Drop Mech</span><small><kbd>E</kbd> <span id="drop-sub"></span></small><span class="badge" id="drop-badge"></span></button>
        <button class="abtn strike" id="b-strike" style="display:none">${icon('strike')}<span>Orbital Strike</span><small><kbd>R</kbd> <span id="strike-sub"></span></small><span class="badge" id="strike-badge"></span></button>
        <button class="abtn end" id="b-end">${icon('end')}<span>End Turn</span><small><kbd>Space</kbd></small></button>
      </div>
    `));
    root.appendChild(el('div', { id: 'combathint', class: 'panel pi' }, `<button class="hintbtn" id="ch-skip"><kbd>Space</kbd> skip</button><button class="hintbtn" id="ch-speed"><kbd>Tab</kbd> speed <b id="spd">1x</b></button>`));
    root.appendChild(el('div', { id: 'toasts' }));
    root.appendChild(el('div', { id: 'tip', class: 'panel' }));
    root.appendChild(el('div', { id: 'banner' }, '<div class="t"></div><div class="s"></div>'));
    root.insertBefore(el('div', { id: 'danger' }), root.firstChild);   // under the HUD and panels, over the map
    root.insertBefore(el('div', { id: 'vignette' }), root.firstChild);   // a soft dark frame around the battlefield
    root.insertBefore(el('div', { id: 'grain' }), root.firstChild);      // faint film grain over the battlefield
    root.appendChild(el('div', { id: 'flash' }));
    root.appendChild(el('div', { id: 'comms', class: 'panel' }));
    root.appendChild(el('div', { id: 'floats', style: 'position:absolute;inset:0;overflow:hidden' }));
    root.appendChild(el('div', { id: 'report', class: 'panel' }));
    root.appendChild(el('div', { id: 'attack', class: 'panel pi' }));
    $('attack').addEventListener('click', e => {
      const kit = e.target.closest('.akit');
      if (kit) { H.onAttack('kit', kit.dataset.kit, kit.dataset.v); return; }
      const chip = e.target.closest('.ach');
      if (chip && !chip.classList.contains('wait')) { H.onAttack('toggle', chip.dataset.kind, +chip.dataset.cell); return; }
      if (e.target.closest('#at-go')) H.onAttack('launch');
      if (e.target.closest('#at-x')) H.onAttack('cancel');
    });

    // Menu
    const diffs = Object.keys(CONST.DIFFICULTY).map((k, i) => `
      <div class="panel diff d${i + 1}" data-diff="${k}" tabindex="0" role="button"><div class="lvl">${'◆'.repeat(i + 1)}${'◇'.repeat(2 - i)}</div><h3>${CONST.DIFFICULTY[k].name}</h3><p>${esc(CONST.DIFFICULTY[k].desc)}</p></div>`).join('');
    root.appendChild(el('div', { id: 'menu', class: 'screen', 'data-view': 'home' }, `
      <div class="menu-fx" aria-hidden="true">
        <div class="keyart"></div><div class="haze"></div>
        <svg class="trails" viewBox="0 0 1000 400" preserveAspectRatio="none">
          <path d="M80 380 Q420 -40 980 170"/><path d="M200 400 Q560 40 1000 260"/><path d="M40 330 Q380 60 760 120"/>
        </svg>
        <div class="radar"><div class="sweep"></div><i style="left:62%;top:30%"></i><i style="left:30%;top:58%"></i><i class="foe" style="left:70%;top:66%"></i><span>STRAIT SURVEILLANCE &middot; LIVE</span></div>
      </div>
      <div class="menu-box">
        <div class="home">
          <div class="title">${logoHTML()}</div>
          <div class="tagline">Build <b>&middot;</b> Strike <b>&middot;</b> Dominate</div>
          <div id="m-cont-wrap" style="display:none;margin:0 0 14px"><button class="bigbtn" id="m-continue">Continue <span id="m-cont-sub" style="font-size:14px;opacity:.75;letter-spacing:.04em"></span></button></div>
          <div id="m-warn" class="warnline"></div>
          <nav class="mainnav">
            <button class="navbtn primary" id="m-go-campaign">${icon('play')}<span>Campaign</span><small>Seven missions against six commanders</small></button>
            <button class="navbtn" id="m-go-skirmish">${icon('swords')}<span>Skirmish</span><small>Random islands, your rules</small></button>
            <button class="navbtn daily" id="m-daily">${icon('target')}<span>Daily Operation <em id="dl-date"></em></span><small id="dl-desc"></small><b class="vs" id="dl-best"></b></button>
            <div class="navrow">
              <button class="navbtn small" id="m-help">How to Play</button>
              <button class="navbtn small" id="m-settings">Settings</button>
              <button class="navbtn small" id="m-ach">Achievements <span id="ach-count"></span></button>
            </div>
          </nav>
          <div class="menu-foot">
            <label class="chk"><input type="checkbox" id="m-tut" checked> Show tutorial objectives</label>
            <label class="chk"><input type="checkbox" id="m-music" checked> Music</label>
          </div>
        </div>
        <div class="pick">
          <div class="pickbar"><button class="navbtn small back" id="m-back">&#9664; Back</button><div class="pick-title"><span class="v-camp">Campaign</span><span class="v-sk">Skirmish &mdash; random islands</span></div><span class="pick-sp"></span></div>
          <div class="v-camp"><div class="missions" id="m-missions"></div></div>
          <div class="v-sk">
            <div class="opts" id="m-opts">${Object.keys(SKIRMISH_OPTIONS).map(k => `<div class="opt"><span data-l="${k}">${esc(SKIRMISH_OPTIONS[k].label)}</span><div class="seg">${SKIRMISH_OPTIONS[k].choices.map(c => `<button data-k="${k}" data-v="${c[0]}"${k === 'style' ? ` title="${esc(AI_STYLE_INFO[c[0]].desc)}"` : ''}>${esc(c[1])}</button>`).join('')}</div></div>`).join('')}</div>
            <div class="diffs">${diffs}</div>
          </div>
        </div>
      </div>`));

    root.appendChild(el('div', { id: 'gameover', class: 'screen' }, `
      <div class="menu-box panel">
        <div id="go-title">VICTORY</div>
        <div id="go-reason"></div>
        <div id="go-tip"></div>
        <div id="go-medals" class="medals"></div>
        <div id="go-daily"></div>
        <div id="go-chart"></div>
        <div id="go-quote"></div>
        <div id="go-stats"></div>
        <div class="go-btns"><button class="bigbtn" id="go-next" style="display:none">Next Mission</button><button class="bigbtn" id="go-again">Rematch</button><button class="bigbtn alt" id="go-menu">Main Menu</button></div>
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

    root.appendChild(el('div', { id: 'splash', class: 'screen' }));
    root.appendChild(el('div', { id: 'achievements', class: 'screen' }, `<div class="menu-box panel"><h2>ACHIEVEMENTS</h2><div class="achs" id="ach-list"></div><p style="text-align:center;margin:0"><button class="bigbtn" id="ach-done">Close</button></p></div>`));

    const seg = (key, choices) => `<div class="opt"><div class="seg">${choices.map(c => `<button data-set="${key}" data-v="${c[0]}">${c[1]}</button>`).join('')}</div></div>`;
    root.appendChild(el('div', { id: 'settings', class: 'screen' }, `
      <div class="menu-box panel">
        <h2>SETTINGS</h2>
        <h3 class="sethead">Audio</h3>
        <div class="setrow"><span>Master volume</span><input type="range" min="0" max="1" step="0.05" data-set="vol"></div>
        <div class="setrow"><span>Music</span><span class="setpair">${seg('musicOn', [[1, 'On'], [0, 'Off']])}<input type="range" min="0" max="1" step="0.05" data-set="music"></span></div>
        <div class="setrow"><span>Sound effects<small>Explosions, weapons, mechs</small></span><input type="range" min="0" max="1" step="0.05" data-set="sfx"></div>
        <div class="setrow"><span>Interface<small>Clicks, alerts, order confirmations</small></span><input type="range" min="0" max="1" step="0.05" data-set="ui"></div>
        <div class="setrow"><span>Ambience<small>Surf, wind and distant battle</small></span><input type="range" min="0" max="1" step="0.05" data-set="amb"></div>
        <div class="setrow"><span>Sound style<small>Studio: recorded score and effects. Retro: synthesized chiptune-style</small></span>${seg('style', [['studio', 'Studio'], ['retro', 'Retro']])}</div>
        <div class="setrow"><span>In background<small>When the game's tab or app is hidden</small></span>${seg('bgMute', [[1, 'Mute'], [0, 'Keep playing']])}</div>
        <h3 class="sethead">Game</h3>
        <div class="setrow"><span>Graphics<small>Auto lowers detail if the frame rate drops</small></span>${seg('quality', [['auto', 'Auto'], [0, 'Low'], [1, 'Medium'], [2, 'High']])}</div>
        <div class="setrow"><span>Real-time pace<small>How fast the battle clock runs. Slow gives you more time to think</small></span>${seg('pace', [[0.75, 'Slow'], [1, 'Normal'], [1.5, 'Fast']])}</div>
        <div class="setrow"><span>Camera shake</span>${seg('shake', [[1, 'On'], [0, 'Off']])}</div>
        <div class="setrow"><span>Mech arrows<small>Where visible mechs are heading</small></span>${seg('intents', [[1, 'On'], [0, 'Off']])}</div>
        <p class="set-done-row"><button class="bigbtn" id="set-done">Done</button></p>
      </div>`));

    root.appendChild(el('div', { id: 'handoff', class: 'screen' }, `
      <div class="menu-box panel"><h2 id="ho-title"></h2><p id="ho-sub"></p><button class="bigbtn" id="ho-go">I'm ready</button></div>`));

    // Wire events (stopPropagation is not needed: input lives on the canvas only)
    root.querySelectorAll('.diff').forEach(d => {
      d.addEventListener('click', () => H.onStart(d.dataset.diff, $('m-tut').checked));
      d.addEventListener('mouseenter', () => H.onHover && H.onHover());
    });
    $('m-help').addEventListener('click', () => showHelp(true));
    $('menu').addEventListener('keydown', e => { if ((e.code === 'Enter' || e.code === 'Space') && e.target.matches('.mission, .diff')) { e.preventDefault(); e.stopPropagation(); e.target.click(); } });
    $('m-go-campaign').addEventListener('click', () => menuView('campaign'));
    $('m-go-skirmish').addEventListener('click', () => menuView('skirmish'));
    $('m-back').addEventListener('click', () => menuView('home'));
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
    $('b-settings').addEventListener('click', () => H.onSettings());
    $('m-settings').addEventListener('click', () => H.onSettings());
    $('m-daily').addEventListener('click', () => H.onDaily());
    $('m-ach').addEventListener('click', () => H.onAchievements());
    $('ach-done').addEventListener('click', () => $('achievements').classList.remove('show'));
    $('achievements').addEventListener('click', e => { if (e.target.id === 'achievements') $('achievements').classList.remove('show'); });
    $('set-done').addEventListener('click', () => showSettings(null));
    $('settings').addEventListener('click', e => { if (e.target.id === 'settings') showSettings(null); });
    root.querySelectorAll('#settings [data-set]').forEach(c => {
      const ev = c.tagName === 'INPUT' ? 'input' : 'click';
      c.addEventListener(ev, () => {
        const v = c.tagName === 'INPUT' ? +c.value : (isNaN(+c.dataset.v) ? c.dataset.v : +c.dataset.v);
        H.onSetting(c.dataset.set, v);
      });
    });
    $('ch-skip').addEventListener('click', () => H.onAction('end'));
    $('ch-speed').addEventListener('click', () => H.onSpeed());
    $('b-log').addEventListener('click', () => { $('orders').classList.toggle('open'); $('log').scrollTop = $('log').scrollHeight; });
    root.appendChild(el('div', { id: 'rotate' }, `<div class="phone"></div><div><b>Rotate your phone</b><br><span style="color:var(--c-dim);font-size:15px">Iron Strait plays best in landscape.</span></div><button class="bigbtn alt" id="rot-ok">Play anyway</button>`));
    $('rot-ok').addEventListener('click', () => { rotateDismissed = true; layout(); });
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', () => setTimeout(layout, 250));
    layout();
    $('b-menu').addEventListener('click', () => H.onAction('menu'));
    $('vol').addEventListener('input', e => H.onVolume(+e.target.value));
    root.addEventListener('input', e => { if (e.target.type === 'range') fillRange(e.target); });
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
      return `<tr><td><kbd>${b.key}</kbd></td><td><b>${b.name}</b></td><td>${b.cost}</td><td>${b.hp || "—"}</td><td>${esc(b.desc)}</td></tr>`;
    }).join('');
    return `<div class="menu-box panel">
      <h2>How to play</h2>
      <p><b>Goal:</b> destroy every enemy base: the <b style="color:var(--c-ai)">Command Center</b> and its ${RT.BASES_PER_SIDE} outer <b>Bases</b>, all marked on the right side of the map. Lose all of yours and you lose. When the ${Math.round(CONST.MAX_TURNS * RT.CLOCK_PER_TURN / 60)}-minute clock runs out, the side with more base health left wins.</p>
      <h4>Real-time battle</h4>
      <ul>
        <li><b>Destroy every enemy base.</b> Each side has its Command Center and ${RT.BASES_PER_SIDE} more Bases, all marked on the map (decoys may pose as one). Lose all yours and the war is lost. Bases can't be repaired.</li>
        <li><b>Resources flow every second.</b> Build, repair and upgrade at any moment, and the enemy does the same.</li>
        <li><b>Construction takes time.</b> A new structure is a building site (cyan bar) and does nothing until it's finished: a depot takes ${RT.BUILD_TIME.depot}s, a silo ${RT.BUILD_TIME.silo}s, and only ${RT.BUILD_CREWS} sites go up at once (the rest queue in the order placed). Each <b>Factory</b> <kbd>B</kbd> makes construction ${Math.round(RT.FACTORY_BUILD_BOOST * 100)}% faster and silo reloads and mech production ${Math.round(RT.FACTORY_RELOAD_BOOST * 100)}% faster (max 3; upgraded, one counts as two).</li>
        <li><b>Attack whenever you're ready.</b> Silos reload in ${RT.SILO_RELOAD}s. Press <kbd>Q</kbd>, <kbd>E</kbd> or <kbd>R</kbd>: <b>time stops</b> while you click a target for each missile (up to ${RT.MAX_MISSILES_PER_ATTACK}), the 5×5 box the mechs land in, and the strike's target. <kbd>Enter</kbd> launches.</li>
        <li><b>Every launch is announced.</b> Enemy missiles show up with a countdown in the <i>In the air</i> list. Radar (or being near your HQ) shows what they're aimed at. You have about ${RT.MISSILE_FLIGHT}s to repair, raise a shield or build AA.</li>
        <li><b>You can only build</b> within ${CONST.BUILD_RADIUS} cells of your existing structures.</li>
        <li><b>Pick your kit in the attack panel.</b> Warheads: ${Object.values(RT.WARHEADS).map(w => '<b>' + w.name + '</b> (' + w.energy + 'e) ' + esc(w.desc.toLowerCase())).join('; ')}. Mech loadouts: ${Object.values(RT.LOADOUTS).map(l => '<b>' + l.name + '</b> (' + l.energy + 'e) ' + esc(l.desc.toLowerCase())).join('; ')}.</li>
        <li><b>AA reloads between shots</b> (${RT.AA_RELOAD}s). A salvo with more missiles than the defence has shots gets through. A Radar guides the batteries in its range (+${Math.round(RT.RADAR_AA_BOOST * 100)}% to hit).</li>
        <li><b>Mechs ride a dropship</b> behind the missiles, up to ${RT.MECHS_PER_SHIP} per ship. AA can shoot it down: it takes ${RT.SHIP_HULL} hits, plus 1 per extra mech. Mechs that land fight inside their 5×5 box for ${RT.MECH_TIME}s (sentry turrets and mechs first, or a base close by), then fly home. A new mech is ready ${RT.HANGAR_RELOAD}s later. Mechs waiting in your hangars scramble to defend when raiders land.</li>
        <li><kbd>Space</kbd> pauses: you can look around, but orders wait until you resume. Settings has a <b>Real-time pace</b> option if you want more (or less) time to think.</li>
      </ul>
      <h4>Defenses</h4>
      <p>Every Command Center has a point-defense gun that hits ${Math.round(BUILDINGS.hq.hitChance * RT.AA_HIT_MUL * 100)}% of missiles aimed within 2 cells, plus a close-defense gun against mechs, and enemy drop pods can't land within 2 cells of it. AA Batteries hit ${Math.round(BUILDINGS.aa.hitChance * RT.AA_HIT_MUL * 100)}% (upgraded ${Math.round(UPGRADES.aa.hitChance * RT.AA_HIT_MUL * 100)}%), never more than ${Math.round(RT.AA_MAX_CHANCE * 100)}% even with radar; if one misses, another battery in range gets a shot. <b>Fire several missiles together</b> to overwhelm the defenses while they reload.</p>
      <h4>Orbital strikes</h4>
      <p>A <b>Strike Uplink</b> charges for ${RT.STRIKE_CHARGE_TIME}s, then press <kbd>R</kbd> to call down a strike: ${CONST.STRIKE_DAMAGE} damage to the target and ${Math.round(CONST.STRIKE_SPLASH * RT.STRIKE_SPLASH_MUL)} to everything around it. AA cannot touch it, but Shields absorb it, and every strike is detected, so the target has a few seconds to shield or repair. Not available in missions 1–5.</p>
      <h4>Upgrades</h4>
      <p>Select one of your structures and press <kbd>U</kbd> to upgrade it once (about 75% of its price, +50% HP): ${Object.keys(UPGRADES).map(k => '<b>' + BUILDINGS[k].name + '</b> — ' + esc(UPGRADES[k].desc)).join('; ')}.</p>
      <h4>Counters</h4>
      <p>Missiles &rarr; countered by AA Batteries and Shields. &nbsp; Mechs &rarr; countered by Sentry Turrets, or by <b>garrison mechs</b>: drop a mech on your own island and it hunts invaders. &nbsp; Radar reveals targets and incoming fire. Missile impacts also reveal the area around them.</p>
      <h4>Structures</h4>
      <table><tr><th>Key</th><th>Name</th><th>Cost</th><th>HP</th><th>Effect</th></tr>${rows}</table>
      <h4>Controls</h4>
      <div class="keys">
        <div><kbd>1</kbd>–<kbd>0</kbd> select structure &nbsp; <kbd>N</kbd> minefield &nbsp; <kbd>B</kbd> factory</div><div><kbd>Left click</kbd> place / target / select</div>
        <div><kbd>Q</kbd> fire missile &nbsp; <kbd>E</kbd> drop mech</div><div><kbd>R</kbd> orbital strike</div>
        <div><kbd>T</kbd> repair &nbsp; <kbd>U</kbd> upgrade &nbsp; <kbd>X</kbd> sell selected</div><div><kbd>Z</kbd> undo last action</div>
        <div><kbd>Space</kbd> pause / resume</div><div><kbd>Enter</kbd> launch the planned attack</div>
        <div><kbd>WASD</kbd>/arrows or right-drag: pan</div><div><kbd>Wheel</kbd> zoom &nbsp; <kbd>H</kbd> home &nbsp; <kbd>F</kbd> whole map &nbsp; <kbd>J</kbd> latest alert</div>
        <div><kbd>Esc</kbd> cancel &nbsp; Touch: tap, drag to pan, pinch to zoom</div><div><kbd>M</kbd> mute &nbsp; <kbd>G</kbd> graphics quality &nbsp; <kbd>?</kbd> help</div>
      </div>
      <h4>Credits</h4>
      <p class="credits">Iron Strait is an original game. Code &copy; 2026 Cory Cowgill, MIT License.
        3D engine: <a href="https://threejs.org" target="_blank" rel="noopener">three.js</a> r128 (MIT).
        Fonts: Oxanium, Rajdhani, Inter, Russo One and Share Tech Mono (SIL Open Font License 1.1).
        Music and sound effects generated with Stable Audio &mdash; Powered by Stability AI.
        Not affiliated with, endorsed by, or connected to any other game, developer or publisher; all trademarks belong to their respective owners.</p>
      <p style="text-align:center;margin-top:18px"><button class="bigbtn close">Got it</button></p>
    </div>`;
  }

  // ── Updates ───────────────────────────────────────────────
  function showGameUI(on) {
    for (const id of ['hud', 'orders', 'b-menu']) $(id).style.display = on ? '' : 'none';
    if (!on) { $('dock').classList.add('hidden'); $('selected').classList.remove('show'); $('objectives').style.display = 'none'; hideReport(); }
  }

  function setHUD(h) {
    $('h-cr').textContent = Math.floor(h.credits);
    $('h-cri').textContent = '+' + h.creditInc;
    $('h-en').textContent = Math.floor(h.energy) + '/' + h.energyCap;
    $('h-eni').textContent = '+' + h.energyInc;
    const eb = $('h-enb');
    eb.style.width = (100 * h.energy / h.energyCap) + '%';
    eb.parentElement.classList.toggle('full', h.energy >= h.energyCap);
    // a notch every missile's worth of energy: how many missiles the bar can pay for at a glance
    eb.parentElement.classList.add('notched');
    eb.parentElement.style.setProperty('--notch', (100 * CONST.MISSILE_ENERGY / h.energyCap) + '%');
    if (h.clock) {
      // real time: a battle clock instead of the turn counter
      $('h-turn').textContent = h.clock;
      $('hud-turn').classList.toggle('late', !!h.late);
      $('hud-turn').title = h.late ? 'Time nearly up: the healthier HQ wins when the clock runs out' : '';
    } else {
      $('h-turn').textContent = 'TURN ' + h.turn + ' / ' + h.maxTurns;
      $('hud-turn').classList.toggle('late', h.maxTurns - h.turn < 5);
      $('hud-turn').title = h.maxTurns - h.turn < 5 ? 'Turn limit close: the healthier HQ wins at turn ' + h.maxTurns : '';
    }
    $('hud-phase').textContent = h.phase;
    $('h-hq').textContent = Math.ceil(h.hq.hp) + ' / ' + h.hq.max;
    $('h-hqb').style.width = (100 * h.hq.hp / h.hq.max) + '%';
    // hot-seat Player 2 plays red: "your" colours follow the seat
    const mine = h.red ? 'var(--c-ai)' : 'var(--c-player)', theirs = h.red ? 'var(--c-player)' : 'var(--c-ai)';
    $('h-hql').style.color = $('h-hqb').style.background = mine;
    // real time: the HQ bars cover every base (Command Center included)
    $('h-hql').textContent = h.hqLabel || 'Your HQ';
    $('h-ehql').textContent = h.enemyLabel || 'Enemy HQ';
    $('h-ehql').style.color = $('h-ehqb').style.background = theirs;
    $('h-ehq').textContent = (h.enemyHq.known ? '' : '~') + Math.ceil(h.enemyHq.hp) + ' / ' + h.enemyHq.max;
    $('h-ehqb').style.width = (100 * h.enemyHq.hp / h.enemyHq.max) + '%';
    // real time: a segment per base instead of one total, so a base about to fall stands out
    paintSegs('h-hqs', 'h-hqb', h.hq.segs, mine);
    paintSegs('h-ehqs', 'h-ehqb', h.enemyHq.segs, theirs);
  }
  function paintSegs(id, barId, segs, col) {
    const box = $(id), bar = $(barId).parentNode;
    box.style.display = segs ? '' : 'none';
    bar.style.display = segs ? 'none' : '';
    if (!segs) return;
    if (box.children.length !== segs.length) box.innerHTML = segs.map(() => '<span><i></i></span>').join('');
    segs.forEach((s, i) => {
      const sp = box.children[i], fill = sp.firstChild;
      sp.classList.toggle('hq', s.hq); sp.classList.toggle('dead', s.f <= 0);
      fill.style.width = (100 * Math.max(0, s.f)) + '%';
      fill.style.background = s.f < 0.34 ? 'var(--c-bad)' : col;
    });
  }

  function setDock(visible) { $('dock').classList.toggle('hidden', !visible); }

  // Build crews: how many are busy, and how many sites are waiting for one
  function setCrews(busy, total, queued) {
    const box = $('crews');
    if (!box) return;
    box.classList.toggle('on', busy > 0);
    if (!busy) return;
    const dots = Array.from({ length: total }, (_, i) => i < busy ? '●' : '○').join('');
    box.innerHTML = 'BUILD CREWS <b>' + dots + '</b>' + (queued ? ' <span class="q">· ' + queued + ' queued</span>' : '');
  }
  function setCards(list) {
    const box = $('cards');
    if (box.children.length !== list.length) {
      box.innerHTML = '';
      for (const c of list) {
        const d = el('div', { class: 'card', 'data-type': c.type }, `<span class="key">${c.key}</span><span class="cnt"></span>${icon(c.type)}<span class="nm">${esc(c.name)}</span><span class="cost">${c.cost}</span>`);
        d.addEventListener('click', () => H.onBuildSelect(c.type));
        d.addEventListener('mouseenter', e => { if (canHover()) H.onCardHover && H.onCardHover(c.type, e); });
        d.addEventListener('mouseleave', () => hideTip());
        box.appendChild(d);
      }
    }
    list.forEach((c, i) => {
      const d = box.children[i];
      d.classList.toggle('sel', !!c.selected);
      d.classList.toggle('off', !c.enabled);
      d.classList.toggle('nudge', !!c.hint);
      d.querySelector('.cnt').textContent = c.count ? (c.max ? c.count + '/' + c.max : 'x' + c.count) : '';
      d.querySelector('.cost').textContent = c.cost;   // depots get pricier as you build them
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
    $('b-fire').classList.toggle('nudge', !!a.fire.nudge);
    $('fire-sub').textContent = a.fire.sub || '';
    $('drop-sub').textContent = a.drop.sub || '';
    $('fire-badge').textContent = a.fire.badge || '';
    $('drop-badge').textContent = a.drop.badge || '';
    $('fire-badge').title = a.fire.badge ? 'Silos ready to launch / silos built' : '';
    $('drop-badge').title = a.drop.badge ? 'Hangars ready to drop / hangars built' : '';
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
    // the log button (when the panel is folded away) shows how many enemy waves are inbound
    const b = $('b-log'); b.classList.toggle('alert', incoming.length > 0); b.dataset.n = incoming.length || '';
    if (!orders.length && !incoming.length) { box.appendChild(el('div', { class: 'empty' }, liveMode ? 'Nothing in the air.' : 'No orders queued.')); return; }
    for (const m of incoming) {
      box.appendChild(el('div', { class: 'order incoming' + (m.strike ? ' strike' : '') }, `${icon(m.strike ? 'strike' : 'missile')}<span>${esc(m.text)}</span>`));
    }
    for (const o of orders) {
      const d = el('div', { class: 'order ' + o.kind }, `${icon(o.kind === 'drop' ? 'drop' : o.kind)}<span>${esc(o.text)}</span>${o.noCancel ? '' : '<span class="x" title="Cancel (refund)">&times;</span>'}`);
      if (!o.noCancel) d.querySelector('.x').addEventListener('click', () => H.onAction('cancel', o.id));
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
  // touch screens fire mouseenter on tap, which would leave hover-only tooltips stuck open
  const canHover = () => matchMedia('(hover: hover)').matches;

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
    // real time measures the battle on the clock (two-player games are always turn by turn)
    const live = true;   // every battle is real time
    const l = document.querySelector('#m-opts [data-l="turns"]');
    if (l) l.textContent = live ? 'Battle clock' : SKIRMISH_OPTIONS.turns.label;
    document.querySelectorAll('#m-opts button[data-k="turns"]').forEach(b => {
      const n = +b.dataset.v;
      b.textContent = live ? (n * RT.CLOCK_PER_TURN / 60) + ' min' : n;
      b.title = (n * RT.CLOCK_PER_TURN / 60) + ' minutes on the battle clock';
    });
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

  // the structure panel sits under the log on wide screens: shrink the log to end above it
  function fitLogAbove(sel) {
    const o = $('orders');
    if (!o) return;
    if (!sel || document.body.classList.contains('compact')) { o.style.maxHeight = ''; return; }
    requestAnimationFrame(() => {
      const top = sel.getBoundingClientRect().top, ot = o.getBoundingClientRect().top;
      if (top > ot + 120) o.style.maxHeight = Math.floor(top - ot - 10) + 'px';
    });
  }
  function showSelected(info) {
    const p = $('selected');
    if (!info) { p.classList.remove('show'); fitLogAbove(null); return; }
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
        <div class="uphint" style="font-size:12px;color:var(--c-dim);margin-top:4px">Upgrade: ${esc(u.desc)}, +50% HP</div>`;
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
    fitLogAbove(p);
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
    // the step on screen and how many there are (steps finished early are skipped, not counted ahead)
    const cur = list.find(o => !o.done);
    box.innerHTML = `<h4>Briefing ${cur ? list.indexOf(cur) + 1 : list.length}/${list.length}</h4>` +
      (cur ? `<div class="obj cur"><b>▸</b><span>${cur.text}</span></div>` : '') + `<span class="x" id="obj-x" title="Hide briefing">&times;</span>`;
    $('obj-x').addEventListener('click', () => H.onAction('hideObjectives'));
  }

  function toast(text, kind) {
    const box = $('toasts');
    for (const o of [...box.children]) if (o.textContent === text) o.remove(); // no duplicate stacking
    const t = el('div', { class: 'toast ' + (kind || '') }, esc(text));
    // longer messages stay up long enough to read
    const life = Math.min(6000, 2300 + Math.max(0, text.length - 40) * 45);
    t.style.animation = 'tin .2s ease-out, tout .4s ease-in ' + ((life - 500) / 1000) + 's forwards';
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => t.remove(), life);
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

  function banner(text, sub, red, secs) {
    const b = $('banner');
    b.querySelector('.t').textContent = text;
    b.querySelector('.s').textContent = sub || '';
    b.className = red ? 'red' : '';
    b.style.animationDuration = (secs || 1.7) + 's';   // longer for lines meant to be read
    void b.offsetWidth;
    b.classList.add('show');
  }

  function floatText(x, y, text, cls) {
    const f = el('div', { class: 'float ' + (cls || 'dmg') }, esc(text));
    f.style.left = x + 'px'; f.style.top = y + 'px';
    $('floats').appendChild(f);
    setTimeout(() => f.remove(), 1150);
  }

  // enemy commander on the radio: portrait, name and line for a few seconds
  let commsTimer = 0;
  function comms(c, line) {
    const box = $('comms');
    box.style.setProperty('--cc', c.look.color);
    box.innerHTML = portrait(c) + `<div><div class="who">${esc(c.name)} · radio</div><div class="line">“${esc(line)}”</div></div>`;
    box.classList.add('show');
    clearTimeout(commsTimer);
    commsTimer = setTimeout(() => box.classList.remove('show'), 4200);
  }
  // storms: a lightning flash over the whole screen
  function flashScreen() { const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
  // red at the screen edges: incoming fire about to land (pulsing) or bases badly hurt (steady)
  function setDanger(level, pulse) {
    const d = $('danger');
    d.style.setProperty('--dg', Math.max(0, Math.min(1, level)).toFixed(2));
    d.classList.toggle('pulse', !!pulse && level > 0);
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
      <div class="foot"><span>Next turn: <b style="color:var(--c-credit)">+${r.income.credits}c</b> <b style="color:var(--c-energy)">+${r.income.energy}e</b></span><span>${r.intel ? esc(r.intel) : '&nbsp;'}</span></div>`;
    p.classList.add('show');
  }
  function hideReport() { $('report').classList.remove('show'); }

  // d: { target, silos: [{cell,label,status,ready,on}], hangars: [...], strike: {...}|null, cost, energy, reason, odds }
  // The panel's structure is rebuilt only when its launchers change; countdowns, toggles and
  // costs update in place, so a click never lands on a button that is being replaced.
  let attackShape = '';
  function showAttack(d) {
    const p = $('attack');
    const chip = (kind, it) => `<button class="ach" data-kind="${kind}" data-cell="${it.cell}">${icon(kind === 'silo' ? 'missile' : kind === 'hangar' ? 'drop' : 'strike')}<span>${esc(it.label)}</span><small></small></button>`;
    const row = (label, kind, list, none) => `<div class="arow"><span class="al">${label}</span>${list.length ? list.map(x => chip(kind, x)).join('') : '<span class="none">' + none + '</span>'}</div>`;
    const kitRow = (label, kit, list) => `<div class="arow kit"><span class="al">${label}</span><div class="seg">${(list || []).map(k => `<button class="akit" data-kit="${kit}" data-v="${k.key}" title="${esc(k.desc)}">${esc(k.name)} <small>${k.energy}e</small></button>`).join('')}</div><span class="kdesc" data-kit="${kit}"></span></div>`;
    const shape = JSON.stringify([d.silos.map(x => x.cell + x.label), d.hangars.map(x => x.cell + x.label), !!d.strike]);
    if (shape !== attackShape) {
      attackShape = shape;
      p.innerHTML = `<div class="ah"><b>ATTACK</b> &rarr; <span class="tg"></span><span class="k">Esc cancels</span></div>`
        + row('Missiles', 'silo', d.silos, 'No silos built')
        + (d.silos.length ? kitRow('Warhead', 'warhead', d.warheads) : '')
        + row('Mechs', 'hangar', d.hangars, 'No hangars built')
        + (d.hangars.length ? kitRow('Loadout', 'loadout', d.loadouts) : '')
        + (d.strike ? row('Orbital', 'strike', [d.strike], '') : '')
        + `<div class="aodds"></div>`
        + `<div class="afoot"><span class="cost"></span><span class="bad"></span>`
        + `<button class="bigbtn" id="at-go">Launch <kbd>Enter</kbd></button><button class="bigbtn alt" id="at-x">Cancel</button></div>`;
    }
    const items = { silo: d.silos, hangar: d.hangars, strike: d.strike ? [d.strike] : [] };
    p.querySelectorAll('.ach').forEach(b => {
      const it = items[b.dataset.kind].find(x => String(x.cell) === b.dataset.cell);
      if (!it) return;
      b.classList.toggle('on', !!it.on);
      b.classList.toggle('wait', !it.ready);
      const st = b.querySelector('small');
      if (st.textContent !== it.status) st.textContent = it.status;
    });
    p.querySelectorAll('.akit').forEach(b => { const list = b.dataset.kit === 'warhead' ? d.warheads : d.loadouts; const k = list && list.find(x => x.key === b.dataset.v); b.classList.toggle('on', !!(k && k.on)); });
    p.querySelectorAll('.kdesc').forEach(el => { const list = el.dataset.kit === 'warhead' ? d.warheads : d.loadouts; const k = list && list.find(x => x.on); const t = k ? k.desc : ''; if (el.textContent !== t) el.textContent = t; });
    p.querySelector('.tg').textContent = d.target;
    const odds = p.querySelector('.aodds');
    if (odds.innerHTML !== (d.odds || '')) odds.innerHTML = d.odds || '';
    p.querySelector('.cost').innerHTML = `Cost <b style="color:var(--c-energy)">${d.cost}e</b> of ${d.energy}e`;
    p.querySelector('.afoot .bad').textContent = d.reason || '';
    const go = $('at-go');
    if (go.disabled !== !!d.reason) go.disabled = !!d.reason;
    p.classList.add('show');
  }
  function hideAttack() { $('attack').classList.remove('show'); attackShape = ''; }
  function isAttackOpen() { return $('attack').classList.contains('show'); }
  // the End Turn button doubles as Pause in a real-time battle
  function setEndLabel(text) {
    const b = $('b-end');
    if (!b) return;
    b.querySelector('span').textContent = text;
    const ico = b.querySelector('svg');
    if (ico) ico.outerHTML = icon(text === 'Pause' ? 'pause' : 'end');
  }
  // real time: the orders panel lists flights in the air, and there is no undo
  let liveMode = false;
  function setLiveMode(on) {
    liveMode = !!on;
    $('ord-title').textContent = on ? 'In the air' : 'Orders this turn';
    $('b-undo').style.display = on ? 'none' : '';
  }

  // view: 'home' (landing) | 'campaign' | 'skirmish'; omitted keeps the current one
  function showMenu(on, enter, view) {
    $('menu').classList.toggle('show', on);
    $('menu').classList.toggle('enter', !!(on && enter));
    if (on) { $('gameover').classList.remove('show'); if (view) menuView(view, true); }
  }
  function menuView(view, quiet) {
    const m = $('menu');
    m.dataset.view = view;
    m.scrollTop = 0;
    if (!quiet && H.onHover) H.onHover();
    // keyboard users land on the first control of the view
    if (!matchMedia('(pointer: coarse)').matches) requestAnimationFrame(() => {
      const first = m.querySelector(view === 'home' ? '#m-go-campaign' : view === 'campaign' ? '.mission:not(.locked)' : '.diff');
      if (first && m.classList.contains('show')) first.focus({ preventScroll: true });
    });
  }
  function isMenuOpen() { return $('menu').classList.contains('show'); }
  // arrow keys walk the visible menu controls; Esc goes back to the landing screen
  function menuKey(e) {
    if (!isMenuOpen()) return false;
    const m = $('menu');
    if (e.code === 'Escape' && m.dataset.view !== 'home') { menuView('home'); return true; }
    if (!/^Arrow(Up|Down|Left|Right)$/.test(e.code)) return false;
    const items = [...m.querySelectorAll('.navbtn, .mission:not(.locked), .diff, .opt button')].filter(x => x.offsetParent !== null);
    if (!items.length) return false;
    const i = items.indexOf(document.activeElement), back = e.code === 'ArrowUp' || e.code === 'ArrowLeft';
    const next = items[i < 0 ? 0 : (i + (back ? -1 : 1) + items.length) % items.length];
    next.focus({ preventScroll: false });
    e.preventDefault();
    return true;
  }

  // Title screen: cinematic logo reveal over the backdrop battle, then "press start"
  function logoHTML(cls) {
    let i = 0;
    const word = w => [...w].map(c => `<span class="ch" style="--i:${i++}">${c}</span>`).join('');
    return `<div class="logo ${cls || ''}">${emblemSVG()}<div class="logo-main" data-text="IRON STRAIT">${word('IRON')}<span class="sp"></span>${word('STRAIT')}</div>
      <div class="logo-sub"><i></i><span>REAL-TIME STRATEGY</span><i></i></div></div>`;
  }
  // Two coasts (ours cyan-edged, theirs orange-edged), the channel between them and a missile
  // arcing across: reads at icon size as well as on the title screen
  function emblemSVG() {
    return `<svg class="emblem" viewBox="0 0 200 76" aria-hidden="true"><defs>
      <linearGradient id="emb-steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fb0be"/><stop offset=".18" stop-color="#5b7286"/><stop offset="1" stop-color="#172b3b"/></linearGradient>
      <linearGradient id="emb-trail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff7a3d" stop-opacity="0"/><stop offset=".55" stop-color="#ff7a3d"/><stop offset="1" stop-color="#ffe2b0"/></linearGradient></defs>
      <path class="land us" d="M2 74 L2 46 L14 42 L22 44 L34 38 L48 41 L60 39 L70 44 L78 52 L84 61 L81 74 Z"/>
      <path class="land them" d="M198 74 L198 44 L186 40 L176 43 L164 37 L150 40 L138 38 L128 44 L121 52 L116 61 L119 74 Z"/>
      <path class="bunker" d="M18 43 h12 v-6 h-12z M50 40 h8 v-5 h-8z"/><path class="bunker" d="M144 39 h12 v-6 h-12z M170 41 h8 v-5 h-8z"/>
      <path class="water" d="M86 60 Q100 56 114 60 M84 67 Q100 63 116 67 M88 73 Q100 70 112 73"/>
      <path class="arc" d="M40 38 Q100 -18 160 37"/>
      <circle class="head" cx="160" cy="37" r="2.6"/><circle class="boom" cx="160" cy="37" r="7"/></svg>`;
  }
  function showSplash(fast, onStart) {
    const sp = $('splash');
    const touch = matchMedia('(pointer: coarse)').matches;
    sp.innerHTML = `<div class="black"></div><div class="bars"></div>${logoHTML('reveal sweep' + (fast ? ' skip' : ''))}
      <div class="press"><span>${touch ? 'TAP TO START' : 'PRESS START'}</span></div>
      <div class="foot">Build &middot; Strike &middot; Dominate</div>`;
    sp.className = 'screen show' + (fast ? ' skip' : '');
    document.body.classList.add('splash-on');
    const t0 = performance.now();
    const go = e => {
      if (e && e.type === 'keydown') {
        if (e.repeat || e.metaKey || e.ctrlKey) return;
        e.stopPropagation(); e.preventDefault(); // the title screen owns the keyboard
      }
      // a click during the reveal skips to its end; the next one starts
      if (!fast && performance.now() - t0 < 2600 && !sp.classList.contains('skip')) {
        sp.classList.add('skip'); sp.querySelector('.logo').classList.add('skip'); return;
      }
      window.removeEventListener('keydown', go, true);
      sp.removeEventListener('click', go);
      sp.classList.add('out');
      document.body.classList.remove('splash-on');
      setTimeout(() => { sp.className = 'screen'; sp.innerHTML = ''; }, 1200);
      onStart();
    };
    sp.addEventListener('click', go);
    window.addEventListener('keydown', go, true);
  }
  function isSplashOpen() { return $('splash').classList.contains('show') && !$('splash').classList.contains('out'); }
  function setContinue(label) {
    $('m-cont-wrap').style.display = label ? '' : 'none';
    $('m-cont-sub').textContent = label ? '— ' + label : '';
  }
  function setMusicChecked(on) { $('m-music').checked = on; }

  // Stylised commander bust (SVG), coloured per commander
  function portrait(c) {
    const L = c.look, id = 'p' + Math.random().toString(36).slice(2, 7);
    const ph = photo(c, id);
    if (ph) return `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#121a24"/>${ph}</svg>`;
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
  // generated character art, clipped to the portrait's circle, over the drawn one
  // fetch the portrait images once, early, so dialogs never pop them in late
  if (typeof PORTRAITS !== 'undefined' && typeof window !== 'undefined') setTimeout(() => PORTRAITS.forEach(k => { const im = new Image(); im.src = 'assets/portraits/' + k + '.webp'; }), 1500);
  function photo(c, id) {
    if (typeof PORTRAITS === 'undefined' || typeof COMMANDERS === 'undefined') return '';
    const key = Object.keys(COMMANDERS).find(k => COMMANDERS[k] === c);
    if (!key || !PORTRAITS.includes(key)) return '';
    return `<clipPath id="${id}c"><circle cx="50" cy="50" r="46"/></clipPath>` +
      `<image href="assets/portraits/${key}.webp" x="4" y="4" width="92" height="92" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id}c)"/>` +
      `<circle cx="50" cy="50" r="46" fill="none" stroke="${c.look.color}" stroke-opacity=".7" stroke-width="2.5"/>`;
  }

  // missions: [{ id, name, enemy, state: 'locked'|'open'|'done' }]
  function setCampaign(missions) {
    const box = $('m-missions');
    box.innerHTML = '';
    for (const m of missions) {
      const c = COMMANDERS[m.enemy];
      const medals = m.medals && m.medals[0] ? m.medals : [true, false, false]; // cleared before medals existed
      const badge = m.state === 'done' ? `<span title="${medals.filter(Boolean).length} of 3 medals">${medals.map(on => `<span class="star${on ? ' on' : ''}">★</span>`).join('')}</span>` : m.state === 'locked' ? '🔒' : '';
      const d = el('div', Object.assign({ class: 'panel mission ' + m.state }, m.state !== 'locked' ? { tabindex: '0', role: 'button' } : {}), `<span class="badge">${badge}</span>
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
  // campaign missions are real-time battles: par turns become clock time
  function medalLabels(m) {
    const sec = m.par * RT.CLOCK_PER_TURN;
    return ['Win the mission', 'Win within ' + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'), 'Keep your HQ at 50%+'];
  }
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
    $('go-tip').textContent = g.tip ? 'Debrief: ' + g.tip : '';
    $('go-medals').innerHTML = g.medals ? medalRow(g.medals.got, g.medals.labels) + (g.medals.newBest ? '<div class="newbest">NEW MEDAL</div>' : '') : '';
    $('go-medals').style.display = g.medals ? '' : 'none';
    $('go-daily').innerHTML = g.daily ? `Daily score <b>${g.daily.score}</b> ${g.daily.newBest ? '— new best!' : '· best ' + g.daily.best}` : '';
    $('go-daily').style.display = g.daily ? '' : 'none';
    chartClock = g.clockStep || 0;
    renderBattleChart(g.history || [], g.cols || ['You', 'Enemy']);
    const cols = g.cols || ['You', 'Enemy'];
    $('go-stats').innerHTML = '<span class="h"></span><span class="h" style="color:var(--c-player)">' + esc(cols[0]) + '</span><span class="h" style="color:var(--c-ai)">' + esc(cols[1]) + '</span>' +
      g.rows.map(r => `<span>${esc(r[0])}</span><b>${r[1]}</b><b>${r[2]}</b>`).join('');
    $('gameover').classList.add('show');
  }
  // Battle history as two small line charts (HQ health %, structures), shared legend,
  // direct end labels, hover crosshair + tooltip. Colours: validated pair on the dark panel.
  const SERIES_COL = { player: '#1898d0', ai: '#ef4a2d' };
  // real-time games record history every few seconds: label the axis with the battle clock
  let chartClock = 0;
  const tLabel = t => chartClock ? Math.floor(t * chartClock / 60) + ':' + String(Math.floor(t * chartClock % 60)).padStart(2, '0') : String(t);
  function renderBattleChart(hist, names) {
    const box = $('go-chart');
    if (hist.length < 2) { box.innerHTML = ''; box.style.display = 'none'; return; }
    box.style.display = '';
    const legend = `<div class="legend"><span><i style="background:${SERIES_COL.player}"></i>${esc(names[0])}</span><span><i style="background:${SERIES_COL.ai}"></i>${esc(names[1])}</span></div>`;
    box.innerHTML = legend + '<div class="charts">' + lineChart(chartClock ? 'Base health (all bases)' : 'Command Center health', hist, h => h.hq, 100, '%', names) + lineChart('Structures standing', hist, h => h.n, null, '', names) + '</div>';
    box.querySelectorAll('figure').forEach(f => wireChartHover(f, hist, names));
  }
  function lineChart(title, hist, get, fixedMax, unit, names) {
    const W = 280, H = 120, L = 26, R = 34, T = 8, B = 18;
    const maxT = hist[hist.length - 1].t, minT = hist[0].t;
    const vals = hist.flatMap(h => [get(h.player), get(h.ai)]);
    const maxY = fixedMax || Math.max(4, Math.ceil(Math.max(...vals) / 4) * 4);
    const x = t => L + (W - L - R) * (maxT === minT ? 0 : (t - minT) / (maxT - minT));
    const y = v => T + (H - T - B) * (1 - v / maxY);
    const grid = [0, 0.5, 1].map(k => `<line x1="${L}" x2="${W - R}" y1="${y(maxY * k)}" y2="${y(maxY * k)}" stroke="rgba(150,180,210,.14)" stroke-width="1"/><text x="${L - 5}" y="${y(maxY * k) + 3}" text-anchor="end" font-size="9" fill="#7d8fa3">${Math.round(maxY * k)}${unit}</text>`).join('');
    const step = Math.max(1, Math.ceil((maxT - minT) / 6));
    const ticks = hist.filter(h => (h.t - minT) % step === 0 || h.t === maxT).map(h => `<text x="${x(h.t)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="#7d8fa3">${tLabel(h.t)}</text>`).join('');
    const line = side => {
      const pts = hist.map(h => x(h.t).toFixed(1) + ',' + y(get(h[side])).toFixed(1)).join(' ');
      const last = hist[hist.length - 1], lx = x(last.t), ly = y(get(last[side]));
      return `<polyline points="${pts}" fill="none" stroke="${SERIES_COL[side]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${lx}" cy="${ly}" r="4" fill="${SERIES_COL[side]}" stroke="#0e141c" stroke-width="2"/>`;
    };
    // end labels in text ink (identity is carried by the line), nudged apart if they collide
    const last = hist[hist.length - 1];
    let ya = y(get(last.player)), yb = y(get(last.ai));
    if (Math.abs(ya - yb) < 11) { const m = (ya + yb) / 2, up = ya <= yb; ya = m + (up ? -6 : 6); yb = m + (up ? 6 : -6); }
    const labels = `<text x="${W - R + 7}" y="${ya + 3}" font-size="10" fill="#d8e3ee">${get(last.player)}${unit}</text><text x="${W - R + 7}" y="${yb + 3}" font-size="10" fill="#d8e3ee">${get(last.ai)}${unit}</text>`;
    return `<figure data-unit="${unit}" data-max="${maxY}"><figcaption>${esc(title)}</figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} by turn: ${esc(names[0])} ends at ${get(last.player)}${unit}, ${esc(names[1])} at ${get(last.ai)}${unit}">
        ${grid}${ticks}${line('ai')}${line('player')}${labels}
        <line class="xhair" y1="${T}" y2="${H - B}" stroke="rgba(216,227,238,.4)" stroke-width="1" style="display:none"/>
        <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" class="hit"/>
      </svg><div class="tipbox"></div></figure>`;
  }
  function wireChartHover(fig, hist, names) {
    const svg = fig.querySelector('svg'), hit = fig.querySelector('.hit'), xh = fig.querySelector('.xhair'), tip = fig.querySelector('.tipbox');
    const isHq = fig.dataset.unit === '%';
    const get = h => isHq ? h.hq : h.n, unit = fig.dataset.unit;
    const move = e => {
      const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
      const px = (e.clientX - r.left) / r.width * vb.width;
      const L = 26, R = 34, minT = hist[0].t, maxT = hist[hist.length - 1].t;
      const t = Math.round(minT + (px - L) / (vb.width - L - R) * (maxT - minT));
      const h = hist.reduce((a, b) => Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a);
      const sx = L + (vb.width - L - R) * (maxT === minT ? 0 : (h.t - minT) / (maxT - minT));
      xh.setAttribute('x1', sx); xh.setAttribute('x2', sx); xh.style.display = '';
      tip.innerHTML = `${chartClock ? tLabel(h.t) : 'Turn ' + h.t}<br><span style="color:${SERIES_COL.player}">●</span> ${esc(names[0])} ${get(h.player)}${unit} · <span style="color:${SERIES_COL.ai}">●</span> ${esc(names[1])} ${get(h.ai)}${unit}`;
      tip.style.display = 'block';
      const fx = sx / vb.width * r.width;
      tip.style.left = Math.min(r.width - tip.offsetWidth, Math.max(0, fx - tip.offsetWidth / 2)) + 'px';
      tip.style.top = '-6px';
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { xh.style.display = 'none'; tip.style.display = 'none'; });
  }

  function hideGameOver() { $('gameover').classList.remove('show'); }

  function showHelp(on) { $('help').classList.toggle('show', on); }
  // values: { vol, musicOn, music, sfx, ui, amb, style, bgMute, quality, speed, shake, intents }; null closes
  function showSettings(values) {
    if (!values) { $('settings').classList.remove('show'); return; }
    paintSettings(values);
    $('settings').classList.add('show');
  }
  function paintSettings(v) {
    document.querySelectorAll('#settings [data-set]').forEach(c => {
      const cur = v[c.dataset.set];
      if (c.tagName === 'INPUT') { c.value = cur; fillRange(c); }
      else c.classList.toggle('on', String(cur) === c.dataset.v);
    });
  }
  function isSettingsOpen() { return $('settings').classList.contains('show'); }
  function setDaily(d) {
    $('dl-date').textContent = d.date;
    $('dl-desc').textContent = d.twist + ' vs ' + d.opponent + ' · same battle for everyone today';
    $('dl-best').innerHTML = d.best ? 'Best <b>' + d.best + '</b>' : 'Not played';
  }
  function setAchCount(n, total) { $('ach-count').textContent = '(' + n + '/' + total + ')'; }
  function showAchievements(list) {
    $('ach-list').innerHTML = list.map(a => `<div class="ach${a.got ? ' got' : ''}"><b>${esc(a.name)}</b><span>${esc(a.desc)}</span></div>`).join('');
    $('achievements').classList.add('show');
  }
  function isHelpOpen() { return $('help').classList.contains('show'); }

  function setMuted(m) { $('b-mute').innerHTML = icon(m ? 'mute' : 'sound'); }
  function setVolume(v) { $('vol').value = v; fillRange($('vol')); }
  function fillRange(r) { r.style.setProperty('--p', (100 * (r.value - r.min) / ((r.max - r.min) || 1)) + '%'); }

  return {
    init, icon, esc, isCompact, portrait, setCampaign, medalLabels, showBriefing, closeBriefing, isBriefingOpen, warnOverwrite, showGameUI, setHUD, setDock, setCards, setCrews, setActions, setOrders, log, clearLog, showSelected, setObjectives,
    showSettings, paintSettings, isSettingsOpen, setDaily, setAchCount, showAchievements, getLog, setLog, getSkirmishOptions, showSplash, isSplashOpen, isMenuOpen, menuView, menuKey, showHandoff, hideHandoff, isHandoffOpen,
    toast, showTip, hideTip, banner, floatText, setCombatHint, setDanger, flashScreen, comms, showReport, hideReport, showAttack, hideAttack, isAttackOpen, setEndLabel, setLiveMode, showMenu, setContinue, setMusicChecked,
    showGameOver, hideGameOver, showHelp, isHelpOpen, setMuted, setVolume
  };
})();
