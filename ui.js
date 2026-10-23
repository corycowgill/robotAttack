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
  #hud .cell { padding: 8px 16px; display: flex; flex-direction: column; justify-content: center; border-right: 1px solid var(--c-line); min-width: 110px; }
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
  #dock { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; align-items: flex-end; transition: transform .35s, opacity .35s; }
  #dock.hidden { transform: translate(-50%, 140%); opacity: 0; }
  #cards { display: flex; gap: 6px; padding: 8px; }
  .card { width: 92px; height: 92px; border-radius: 8px; border: 1px solid var(--c-line); background: var(--c-bg2); cursor: pointer; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; transition: transform .12s, border-color .12s, background .12s; }
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
  .abtn { min-width: 112px; height: 92px; border-radius: 8px; border: 1px solid var(--c-line); background: var(--c-bg2); color: var(--c-text); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; font-family: inherit; font-size: 14px; font-weight: 700; letter-spacing: .04em; position: relative; transition: transform .12s, background .12s, border-color .12s; }
  .abtn .ico { width: 28px; height: 28px; }
  .abtn small { font-size: 12px; font-weight: 600; color: var(--c-dim); }
  .abtn:hover { transform: translateY(-3px); }
  .abtn.fire .ico { color: var(--c-warn); } .abtn.fire.sel { border-color: var(--c-warn); background: rgba(255,176,0,.15); }
  .abtn.drop .ico { color: var(--c-player); } .abtn.drop.sel { border-color: var(--c-player); background: rgba(46,196,255,.15); }
  .abtn.end { background: linear-gradient(180deg, rgba(46,196,255,.28), rgba(46,196,255,.12)); border-color: rgba(46,196,255,.6); min-width: 128px; }
  .abtn.end .ico { color: #fff; }
  .abtn.end.ready { animation: glow 1.4s infinite; }
  @keyframes glow { 50% { box-shadow: 0 0 22px rgba(46,196,255,.65); } }
  .abtn.off { opacity: .4; }
  .abtn .badge { position: absolute; top: 6px; right: 8px; font-size: 12px; color: var(--c-dim); }

  /* Side panels */
  #orders { position: absolute; right: 12px; top: 74px; width: 250px; max-height: calc(100vh - 220px); display: flex; flex-direction: column; overflow: hidden; }
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

  #selected { position: absolute; left: 12px; bottom: 120px; width: 280px; padding: 12px 14px; display: none; }
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

  #objectives { position: absolute; left: 12px; top: 74px; width: 250px; padding: 8px 10px; }
  #objectives h4 { margin: 0 0 6px; font-size: 12px; letter-spacing: .16em; text-transform: uppercase; color: var(--c-warn); display: flex; justify-content: space-between; }
  #objectives h4 span { cursor: pointer; color: var(--c-dim); }
  .obj { font-size: 13px; padding: 2px 0; display: flex; gap: 8px; color: #c5d2de; line-height: 1.25; }
  .obj b { color: var(--c-player); width: 16px; flex: none; }
  .obj.done { color: var(--c-dim); text-decoration: line-through; } .obj.done b { color: var(--c-credit); }
  .obj.cur { color: #fff; }

  /* Toast, tooltip, banner, floating text */
  #toasts { position: absolute; left: 50%; top: 84px; z-index: 2; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 6px; }
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
  #report { position: absolute; left: 50%; top: 84px; transform: translateX(-50%); width: 420px; padding: 14px 18px; display: none; pointer-events: none; }
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
  #gameover .menu-box { width: min(560px, 94vw); padding: 28px; }
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

  @media (max-width: 1100px) {
    .card { width: 74px; height: 80px; } .card .nm { font-size: 11px; } .abtn { min-width: 86px; height: 80px; }
    #orders { width: 220px; } #objectives { width: 240px; }
  }
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
      <div class="cell hq-cell"><div class="lbl" style="color:var(--c-player)">Your HQ</div><div class="val" id="h-hq">200</div><div class="bar"><i id="h-hqb" style="background:var(--c-player)"></i></div></div>
      <div class="cell hq-cell"><div class="lbl" style="color:var(--c-ai)">Enemy HQ</div><div class="val" id="h-ehq">200</div><div class="bar"><i id="h-ehqb" style="background:var(--c-ai)"></i></div></div>
    `));

    root.appendChild(el('div', { id: 'sysbtns', class: 'pi' }, `
      <div class="panel" style="display:flex;align-items:center;padding:0 10px;gap:6px" title="Master volume"><input id="vol" type="range" min="0" max="1" step="0.05"></div>
      <div class="panel iconbtn" id="b-mute" title="Mute (M)">${icon('sound')}</div>
      <div class="panel iconbtn" id="b-help" title="How to play (?)">${icon('help')}</div>
    `));

    root.appendChild(el('div', { id: 'objectives', class: 'panel pi', style: 'display:none' }));
    root.appendChild(el('div', { id: 'orders', class: 'panel pi', style: 'display:none' }, `
      <div class="ph"><span>Orders this turn</span><span class="lnk" id="b-undo" title="Undo last action (Z)" style="display:flex;align-items:center;gap:4px;text-decoration:none">${icon('undo')}<kbd>Z</kbd></span></div>
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
        <div class="tag">Build &middot; Strike &middot; Defend &mdash; choose your opponent</div>
        <div class="diffs">${diffs}</div>
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
        <div id="go-stats"></div>
        <button class="bigbtn" id="go-again">Rematch</button><button class="bigbtn alt" id="go-menu">Main Menu</button>
      </div>`));

    root.appendChild(el('div', { id: 'help', class: 'screen' }, helpHTML()));

    // Wire events (stopPropagation is not needed: input lives on the canvas only)
    root.querySelectorAll('.diff').forEach(d => {
      d.addEventListener('click', () => H.onStart(d.dataset.diff, $('m-tut').checked));
      d.addEventListener('mouseenter', () => H.onHover && H.onHover());
    });
    $('m-help').addEventListener('click', () => showHelp(true));
    $('m-music').addEventListener('change', e => H.onMusic && H.onMusic(e.target.checked));
    $('help').addEventListener('click', e => { if (e.target.id === 'help' || e.target.classList.contains('close')) showHelp(false); });
    $('go-again').addEventListener('click', () => H.onRematch());
    $('go-menu').addEventListener('click', () => H.onMenu());
    $('b-fire').addEventListener('click', () => H.onAction('fire'));
    $('b-drop').addEventListener('click', () => H.onAction('drop'));
    $('b-end').addEventListener('click', () => H.onAction('end'));
    $('b-undo').addEventListener('click', () => H.onAction('undo'));
    $('b-mute').addEventListener('click', () => H.onAction('mute'));
    $('b-help').addEventListener('click', () => showHelp(!isHelpOpen()));
    $('vol').addEventListener('input', e => H.onVolume(+e.target.value));
    root.addEventListener('mouseover', e => {
      const t = e.target.closest && e.target.closest('.card,.abtn,.sbtn,.diff,.bigbtn,.iconbtn');
      if (t && t !== lastHoverEl && H.onHover) H.onHover();
      lastHoverEl = t;
    });
  }
  let lastHoverEl = null;

  function helpHTML() {
    const rows = BUILD_ORDER.map(k => {
      const b = BUILDINGS[k];
      return `<tr><td><kbd>${b.key}</kbd></td><td><b>${b.name}</b></td><td>${b.cost}</td><td>${b.hp}</td><td>${esc(b.desc)}</td></tr>`;
    }).join('');
    return `<div class="menu-box panel">
      <h2>How to play</h2>
      <p><b>Goal:</b> destroy the enemy <b style="color:var(--c-ai)">Command Center</b> (always marked on the right side of the map) before yours falls. If both survive ${CONST.MAX_TURNS} turns, the healthier HQ wins.</p>
      <h4>Each turn</h4>
      <ol>
        <li><b>Plan.</b> Spend <span style="color:var(--c-credit)">credits</span> on buildings and repairs, and <span style="color:var(--c-energy)">energy</span> on missiles and mech drops. You can only build within ${CONST.BUILD_RADIUS} cells of your existing buildings.</li>
        <li><b>End turn.</b> Both sides' orders resolve at the same time: missiles launched <i>last</i> turn come down, AA intercepts, gun pods fire, mechs fight, drop pods land, and new missiles launch.</li>
        <li><b>React.</b> Missiles are in the air for a full turn. Red reticles show enemy missiles your Radar (or HQ) has detected — build AA, shields or repair before they land.</li>
      </ol>
      <h4>Counters</h4>
      <p>Missiles &rarr; countered by AA Batteries and Shields. &nbsp; Mechs &rarr; countered by Gun Pods. &nbsp; Radar reveals targets and incoming fire. Missile impacts also reveal the area around them.</p>
      <h4>Structures</h4>
      <table><tr><th>Key</th><th>Name</th><th>Cost</th><th>HP</th><th>Effect</th></tr>${rows}</table>
      <h4>Controls</h4>
      <div class="keys">
        <div><kbd>1</kbd>–<kbd>8</kbd> select structure</div><div><kbd>Left click</kbd> place / target / select</div>
        <div><kbd>Q</kbd> fire missile</div><div><kbd>E</kbd> drop mech</div>
        <div><kbd>T</kbd> repair selected &nbsp; <kbd>X</kbd> sell selected</div><div><kbd>Z</kbd> undo last action</div>
        <div><kbd>Space</kbd> end turn / skip playback</div><div><kbd>Tab</kbd> playback speed</div>
        <div><kbd>WASD</kbd>/arrows or right-drag: pan</div><div><kbd>Wheel</kbd> zoom &nbsp; <kbd>H</kbd> home &nbsp; <kbd>F</kbd> whole map</div>
        <div><kbd>Esc</kbd> cancel</div><div><kbd>M</kbd> mute &nbsp; <kbd>?</kbd> this help</div>
      </div>
      <p style="text-align:center;margin-top:18px"><button class="bigbtn close">Got it</button></p>
    </div>`;
  }

  // ── Updates ───────────────────────────────────────────────
  function showGameUI(on) {
    for (const id of ['hud', 'orders']) $(id).style.display = on ? '' : 'none';
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
    $('b-end').classList.toggle('ready', !!a.endReady);
  }

  function setOrders(orders, incoming) {
    const box = $('orderlist');
    box.innerHTML = '';
    if (!orders.length && !incoming.length) { box.appendChild(el('div', { class: 'empty' }, 'No orders queued.')); return; }
    for (const m of incoming) {
      box.appendChild(el('div', { class: 'order incoming' }, `${icon('missile')}<span>${esc(m.text)}</span>`));
    }
    for (const o of orders) {
      const d = el('div', { class: 'order ' + o.kind }, `${icon(o.kind === 'missile' ? 'missile' : 'drop')}<span>${esc(o.text)}</span><span class="x" title="Cancel (refund)">&times;</span>`);
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
    } else if (info.own) {
      btns = `<div class="btns"><button class="sbtn ${info.repair.reason ? 'off' : ''}" id="s-rep" title="${esc(info.repair.reason || '')}">${icon('repair')} Repair ${info.repair.reason ? '— ' + esc(info.repair.reason) : '+' + info.repair.amount + ' (' + info.repair.cost + 'c)'} <kbd>T</kbd></button></div>`;
    }
    p.innerHTML = `<div class="side" style="color:${info.own ? 'var(--c-player)' : 'var(--c-ai)'}">${info.own ? 'Your structure' : (info.ghost ? 'Enemy — last known' : 'Enemy structure')}</div>
      <h3>${icon(info.type)} ${esc(info.name)}</h3>
      <div class="hpb"><i style="width:${frac * 100}%;background:${col}"></i></div>
      <div class="mono" style="font-size:13px;color:var(--c-dim)">HP ${info.hp} / ${info.maxHp}${info.extra ? ' &middot; ' + esc(info.extra) : ''}</div>
      <div class="desc">${esc(info.desc)}</div>
      <ul>${info.stats.map(s => '<li>' + esc(s) + '</li>').join('')}</ul>${btns}`;
    p.classList.add('show');
    const rep = $('s-rep'), sell = $('s-sell');
    if (rep) rep.addEventListener('click', () => H.onAction('repair'));
    if (sell) sell.addEventListener('click', () => H.onAction('sell'));
  }

  function setObjectives(list) {
    const box = $('objectives');
    if (!list) { box.style.display = 'none'; return; }
    box.style.display = '';
    let cur = false;
    box.innerHTML = `<h4>Briefing <span id="obj-x" title="Hide">&times;</span></h4>` + list.map(o => {
      const isCur = !o.done && !cur;
      if (isCur) cur = true;
      return `<div class="obj ${o.done ? 'done' : ''} ${isCur ? 'cur' : ''}"><b>${o.done ? '✓' : isCur ? '▸' : '·'}</b><span>${o.text}</span></div>`;
    }).join('');
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
      <div class="row"><span>Missiles hit / launched</span><b>${s.hits} / ${s.landing}</b></div>
      <div class="row"><span>Intercepts</span><b>${s.intercepts}</b></div>
      <div class="row"><span>Mechs lost</span><b>${s.robotsLost}</b></div>
      <div class="lost">${s.lostNames.length ? 'Lost: ' + esc(s.lostNames.join(', ')) : 'No structures lost'}</div></div>`;
    p.innerHTML = `<h2>Turn ${r.turn} report</h2><div class="cols">${col('You', 'var(--c-player)', r.player)}${col('Enemy', 'var(--c-ai)', r.ai)}</div>
      <div class="foot"><span>Next turn: <b style="color:var(--c-credit)">+${r.income.credits}c</b> <b style="color:var(--c-energy)">+${r.income.energy}e</b></span><span>&nbsp;</span></div>`;
    p.classList.add('show');
  }
  function hideReport() { $('report').classList.remove('show'); }

  function showMenu(on) {
    $('menu').classList.toggle('show', on);
    if (on) $('gameover').classList.remove('show');
  }
  function setMusicChecked(on) { $('m-music').checked = on; }

  function showGameOver(g) {
    const t = $('go-title');
    t.textContent = g.title;
    t.className = g.kind;
    $('go-reason').textContent = g.reason;
    $('go-stats').innerHTML = '<span class="h"></span><span class="h" style="color:var(--c-player)">You</span><span class="h" style="color:var(--c-ai)">Enemy</span>' +
      g.rows.map(r => `<span>${esc(r[0])}</span><b>${r[1]}</b><b>${r[2]}</b>`).join('');
    $('gameover').classList.add('show');
  }
  function hideGameOver() { $('gameover').classList.remove('show'); }

  function showHelp(on) { $('help').classList.toggle('show', on); }
  function isHelpOpen() { return $('help').classList.contains('show'); }

  function setMuted(m) { $('b-mute').innerHTML = icon(m ? 'mute' : 'sound'); }
  function setVolume(v) { $('vol').value = v; }

  return {
    init, icon, esc, showGameUI, setHUD, setDock, setCards, setActions, setOrders, log, clearLog, showSelected, setObjectives,
    toast, showTip, hideTip, banner, floatText, setCombatHint, showReport, hideReport, showMenu, setMusicChecked,
    showGameOver, hideGameOver, showHelp, isHelpOpen, setMuted, setVolume
  };
})();
