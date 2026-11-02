/* GeoGuesser Bench: the harness section (#harness).
   1. The Planner-Worker-Compressor loop as an animated inline-SVG diagram (#hx-diagram), in one of two
      layouts chosen by the width it gets: "wide" (two rows) or "tall" (one column, the two paths back to
      the Planner on its left). Each step the Planner (Gemini 3 Flash) sends an instruction to the Worker
      (a fine-tuned Qwen2.5-VL-7B), which, given the current view, takes one atomic action in the environment;
      the new view goes to memory, whose history grows by one entry; the Compressor (Gemini 2.5 Flash-Lite)
      reads that history and writes a brief and a focus_hint for the Planner, which also receives key frames
      (dashed edges are image inputs: the current view and the key frames). After a few steps the Planner
      answers and the loop starts again. Packets move along the edges (round: text, square: images) and the
      active node lights up. requestAnimationFrame drives it
      only while it is on screen, the tab is visible and the viewer has not paused it. Under reduced motion
      it shows its static final state (every edge, no packet, a full memory) until the viewer presses Play.
      The model names come from GEOBENCH.leaderboard.compressor.roles.
   2. The Planner tokens without and with the Compressor (GEOBENCH.leaderboard.compressor), as bars that
      grow when their card comes into view, with the reduction and the task result. The raw-history bars
      in #hx-ctx (static markup in index.html) grow the same way. Under reduced motion every bar is drawn
      at its final length at once. */
(function () {
  "use strict";
  var U = window.GBP;
  if (!U) { return; }
  var el = U.el, svg = U.svg, clear = U.clear, fixed = U.fixed;
  var LB = U.G && U.G.leaderboard ? U.G.leaderboard : null;
  var C = LB && LB.compressor ? LB.compressor : null;
  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reduced() { return !!(mq && mq.matches); }
  var hasIO = "IntersectionObserver" in window;

  /* ---------- Bars that grow when they come into view ---------- */
  /* Bars are drawn at full length by default (also without this script); .hx-wait holds them at zero until
     their block comes into view, and .is-in marks a block shown. */
  var growers = [];
  function reveal(node) { node.classList.remove("hx-wait"); node.classList.add("is-in"); }
  function growOnView(node) {
    if (!node) { return; }
    growers.push(node);
    if (reduced() || !hasIO) { reveal(node); return; }
    node.classList.add("hx-wait");
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (en) { return en.isIntersecting; })) { io.disconnect(); reveal(node); }
    }, { threshold: 0, rootMargin: "0px 0px -12% 0px" });
    io.observe(node);
  }
  growOnView(document.querySelector("#hx-ctx .hx-grow"));

  /* ---------- Planner tokens without and with the Compressor ---------- */
  (function () {
    var host = document.getElementById("hx-tokens");
    if (!host) { return; }
    if (!C || !C.rows || !C.rows.length) { host.appendChild(U.dataError("assets/data/leaderboard.js")); return; }
    var dg = C.digits || { tokens_m: 2, reduction_pct: 1, result_pct: 2, result_score: 0 };
    var max = Math.max.apply(null, C.rows.map(function (r) { return Math.max(r.baseline_m, r.compressor_m); }));
    function tokens(v) { return fixed(v, dg.tokens_m) + "M"; }
    function result(r, v) { return r.result_unit === "pct" ? fixed(v, dg.result_pct) + "%" : fixed(v, dg.result_score); }
    function bar(kind, v, who) {
      return el("div", { class: "hx-bar hx-bar--" + kind, "data-value": String(v) },
        el("span", { class: "hx-bar__fill", style: { "--f": (v / max * 100).toFixed(2) + "%" } },
          el("span", { class: "hx-bar__v" }, [el("span", { class: "sr-only", text: who + ": " }), tokens(v)])));
    }
    host.appendChild(el("div", { class: "hx-tokens__head" }, [
      el("p", { class: "label", text: "Planner tokens" }),
      el("div", { class: "hbar-legend" }, [
        el("span", null, [el("i", { style: { "--c": "var(--hatch)" } }), "Without Compressor"]),
        el("span", null, [el("i", { style: { "--c": "var(--accent)" } }), "With Compressor"])
      ])
    ]));
    var grid = el("div", { class: "hx-tasks" });
    C.rows.forEach(function (r) {
      var card = el("div", { class: "hx-task" + (reduced() || !hasIO ? "" : " hx-wait"), "data-task": r.task, style: { "--c": U.TASK_COLOR[r.task] || "var(--muted)" } }, [
        el("div", { class: "hx-task__top" }, [
          el("h3", { class: "hx-task__name", text: r.label }),
          el("p", { class: "hx-task__cut" }, [
            U.MINUS + fixed(r.reduction_pct, dg.reduction_pct) + "%",
            el("span", { class: "sr-only", text: " Planner tokens" })
          ])
        ]),
        el("div", { class: "hx-bars" }, [bar("base", r.baseline_m, "Without Compressor"), bar("with", r.compressor_m, "With Compressor")]),
        el("p", { class: "hx-task__res" }, [
          el("span", { text: r.result_unit === "pct" ? "Accuracy" : "Score" }),
          " " + result(r, r.result_baseline) + " → " + result(r, r.result_compressor)
        ])
      ]);
      grid.appendChild(card);
    });
    host.appendChild(grid);
    Array.prototype.forEach.call(grid.children, growOnView);
  })();

  /* ---------- The loop ---------- */
  var host = document.getElementById("hx-diagram");
  if (!host) { return; }
  var roles = (C && C.roles) || {};
  function role(k, fallback) { return String(roles[k] || fallback).replace(/^an?\s+/i, ""); }
  var NODES = {
    planner: { title: "Planner", sub: role("planner", "Gemini 3 Flash") },
    worker: { title: "Worker", sub: role("worker", "fine-tuned Qwen2.5-VL-7B") },
    environment: { title: "Environment", sub: "offline Street View" },
    memory: { title: "Memory" },
    compressor: { title: "Compressor", sub: role("compressor", "Gemini 2.5 Flash-Lite") },
    answer: { pill: "answer" }
  };
  /* Each edge's sender, which stays lit while its packet travels; edge labels as lines of parts, where
     {code: ...} is set in the mono face (LABEL_2: the tall layout's two-line label). */
  var FROM = { pw: "planner", we: "worker", ew: "environment", em: "environment", mc: "memory", cp: "compressor", mp: "memory", pa: "planner" };
  var LABEL = {
    pw: [["instruction"]], we: [["atomic action"]], em: [["new view"]], mc: [["history"]],
    cp: [[{ code: "brief" }, " + ", { code: "focus_hint" }]], mp: [["key frames"]]
  };
  var LABEL_2 = { cp: [[{ code: "brief" }, " +"], [{ code: "focus_hint" }]] };
  var IMAGE = { em: true, ew: true, mp: true };   /* square packets: views and key frames */
  /* Boxes are [x, y, w, h]; edge points run from the sender's border to the receiver's. */
  var LAYOUTS = {
    wide: {
      name: "wide", w: 720, h: 284,
      box: { planner: [20, 46, 176, 60], worker: [524, 46, 176, 60], environment: [524, 212, 176, 60],
             memory: [272, 212, 176, 60], compressor: [20, 212, 176, 60], answer: [78, 6, 60, 20] },
      edge: {
        pa: { pts: [[108, 46], [108, 26]] },
        pw: { pts: [[196, 76], [524, 76]], at: [360, 67, "middle"] },
        we: { pts: [[612, 106], [612, 212]], at: [622, 163, "start"] },
        ew: { pts: [[560, 212], [560, 106]], dash: true },
        em: { pts: [[524, 242], [448, 242]], at: [486, 233, "middle"] },
        mc: { pts: [[272, 242], [196, 242]], at: [234, 233, "middle"] },
        cp: { pts: [[108, 212], [108, 106]], at: [118, 182, "start"] },
        mp: { pts: [[360, 212], [360, 142], [168, 142], [168, 106]], dash: true, at: [264, 133, "middle"] }
      }
    },
    /* The two paths back to the Planner run up the left: the brief on the outside, the key frames inside. */
    tall: {
      name: "tall", w: 340, h: 482,
      box: { planner: [108, 46, 220, 56], worker: [108, 138, 220, 56], environment: [108, 230, 220, 56],
             memory: [108, 322, 220, 56], compressor: [108, 414, 220, 56], answer: [188, 6, 60, 20] },
      edge: {
        pa: { pts: [[218, 46], [218, 26]] },
        pw: { pts: [[218, 102], [218, 138]], at: [228, 124, "start"] },
        we: { pts: [[218, 194], [218, 230]], at: [228, 216, "start"] },
        ew: { pts: [[160, 230], [160, 194]], dash: true },
        em: { pts: [[218, 286], [218, 322]], at: [228, 308, "start"] },
        mc: { pts: [[218, 378], [218, 414]], at: [228, 400, "start"] },
        cp: { pts: [[108, 442], [24, 442], [24, 66], [108, 66]], at: [66, 421, "middle"], two: true },
        mp: { pts: [[108, 350], [66, 350], [66, 86], [108, 86]], dash: true, at: [66, 216, "middle"] }
      }
    }
  };
  var ARIA = "Animated diagram of the harness loop. The Planner (" + NODES.planner.sub + ") sends an instruction to the Worker (" +
    NODES.worker.sub + "), which sees the current view and takes one atomic action in the environment. The new view goes to memory, and the Compressor (" +
    NODES.compressor.sub + ") reads the history and writes a brief and a focus_hint for the Planner, which also receives key frames, until it answers.";

  /* One step of the loop, then, after the last step, the Planner's answer and a fresh memory. A node holds for
     d ms; a packet takes longer on a longer edge (see dur), so packets move at similar speeds in both layouts. */
  var STEPS = 8;
  var STEP = [
    { node: "planner", d: 380 },
    { edges: ["pw", "ew"] },
    { node: "worker", d: 240 },
    { edges: ["we"] },
    { node: "environment", d: 240 },
    { edges: ["em"], tick: true },
    { node: "memory", d: 280 },
    { edges: ["mc"], read: true },
    { node: "compressor", d: 440 },
    { edges: ["cp", "mp"], brief: true }
  ];
  var END = [
    { node: "planner", d: 380 },
    { edges: ["pa"] },
    { node: "answer", d: 1500 },
    { node: null, d: 700, clear: true }
  ];

  /* ---------- Geometry ---------- */
  var HEAD = 8, HEAD_W = 4.5, CORNER = 10;
  function dist(a, b) { return Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function pathD(pts) {
    var d = "M" + r1(pts[0][0]) + " " + r1(pts[0][1]);
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i];
      if (i < pts.length - 1) {
        var a = pts[i - 1], b = pts[i + 1];
        var l1 = dist(a, p), l2 = dist(p, b), k = Math.min(CORNER, l1 / 2, l2 / 2);
        var p1 = [p[0] + (a[0] - p[0]) * k / l1, p[1] + (a[1] - p[1]) * k / l1];
        var p2 = [p[0] + (b[0] - p[0]) * k / l2, p[1] + (b[1] - p[1]) * k / l2];
        d += "L" + r1(p1[0]) + " " + r1(p1[1]) + "Q" + r1(p[0]) + " " + r1(p[1]) + " " + r1(p2[0]) + " " + r1(p2[1]);
      } else {
        d += "L" + r1(p[0]) + " " + r1(p[1]);
      }
    }
    return d;
  }
  /* The line stops inside its arrowhead, so its end never shows past the tip. */
  function lineD(pts) {
    var b = pts[pts.length - 1], a = pts[pts.length - 2], l = dist(a, b);
    var back = Math.min(HEAD - 1, l);
    var end = [b[0] - (b[0] - a[0]) / l * back, b[1] - (b[1] - a[1]) / l * back];
    return pathD(pts.slice(0, -1).concat([end]));
  }
  function headD(pts) {
    var b = pts[pts.length - 1], a = pts[pts.length - 2], l = dist(a, b);
    var ux = (b[0] - a[0]) / l, uy = (b[1] - a[1]) / l;
    var bx = b[0] - ux * HEAD, by = b[1] - uy * HEAD;
    return "M" + r1(b[0]) + " " + r1(b[1]) + "L" + r1(bx - uy * HEAD_W) + " " + r1(by + ux * HEAD_W) +
      "L" + r1(bx + uy * HEAD_W) + " " + r1(by - ux * HEAD_W) + "Z";
  }
  function pointAt(pts, f) {
    var total = 0, i;
    for (i = 1; i < pts.length; i++) { total += dist(pts[i - 1], pts[i]); }
    var want = f * total;
    for (i = 1; i < pts.length; i++) {
      var l = dist(pts[i - 1], pts[i]);
      if (want <= l || i === pts.length - 1) {
        var k = l ? Math.max(0, Math.min(1, want / l)) : 0;
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
      }
      want -= l;
    }
    return pts[pts.length - 1];
  }
  function ease(f) { return f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2; }

  /* ---------- Drawing ---------- */
  var stage = el("div", { class: "hx-stage" });
  var playBtn = el("button", { class: "ctrl hx-play", type: "button", "aria-controls": "hx-diagram" });
  host.appendChild(stage);
  host.appendChild(el("div", { class: "hx-controls" }, [playBtn]));
  var brief = document.querySelector("#hx-ctx .hx-brief");
  var R = null;   /* the drawn layout: { L, nodes, edges, packets, ticks } */

  function label(parts, x, y) {
    var t = svg("text", { class: "hx-label", x: x, y: y });
    parts.forEach(function (p) {
      if (typeof p === "string") { t.appendChild(svg("tspan", null, p)); }
      else { t.appendChild(svg("tspan", { class: "hx-code" }, p.code)); }
    });
    return t;
  }
  function draw() {
    var w = stage.clientWidth || host.clientWidth || 720;
    var L = w >= 640 ? LAYOUTS.wide : LAYOUTS.tall;
    if (R && R.L === L) { return; }
    clear(stage);
    var root = svg("svg", { class: "hx-svg hx-svg--" + L.name, width: L.w, height: L.h, viewBox: "0 0 " + L.w + " " + L.h,
      role: "img", "aria-label": ARIA, focusable: "false" });
    var refs = { L: L, nodes: {}, edges: {}, packets: {}, ticks: [] };
    var edgeLayer = svg("g", { class: "hx-edges" }), nodeLayer = svg("g", { class: "hx-nodes" }), packetLayer = svg("g", { class: "hx-packets" });
    Object.keys(L.edge).forEach(function (id) {
      var e = L.edge[id];
      var g = svg("g", { class: "hx-edge" + (e.dash ? " hx-edge--img" : ""), "data-edge": id });
      g.appendChild(svg("path", { class: "hx-line", d: lineD(e.pts) }));
      g.appendChild(svg("path", { class: "hx-head", d: headD(e.pts) }));
      if (e.at) {
        var lines = (e.two && LABEL_2[id]) || LABEL[id] || [];
        var lh = 14, y0 = e.at[1] - (lines.length - 1) * lh / 2;
        lines.forEach(function (parts, k) {
          var t = label(parts, e.at[0], r1(y0 + k * lh));
          t.setAttribute("text-anchor", e.at[2]);
          g.appendChild(t);
        });
      }
      edgeLayer.appendChild(g);
      refs.edges[id] = { g: g, pts: e.pts };
      var pk = IMAGE[id]
        ? svg("rect", { class: "hx-packet", x: -5, y: -5, width: 10, height: 10, rx: 2, "data-packet": id, visibility: "hidden" })
        : svg("circle", { class: "hx-packet", r: 5.5, "data-packet": id, visibility: "hidden" });
      packetLayer.appendChild(pk);
      refs.packets[id] = pk;
    });
    Object.keys(L.box).forEach(function (id) {
      var b = L.box[id], info = NODES[id], cx = b[0] + b[2] / 2;
      var g = svg("g", { class: "hx-node hx-node--" + id, "data-node": id });
      var rx = info.pill ? b[3] / 2 : 10;
      g.appendChild(svg("rect", { class: "hx-halo", x: b[0], y: b[1], width: b[2], height: b[3], rx: rx }));
      g.appendChild(svg("rect", { class: "hx-box", x: b[0], y: b[1], width: b[2], height: b[3], rx: rx }));
      if (info.pill) {
        g.appendChild(svg("text", { class: "hx-pill", x: cx, y: b[1] + b[3] / 2 + 4, "text-anchor": "middle" }, info.pill));
      } else {
        var tall = b[3] >= 60;
        g.appendChild(svg("text", { class: "hx-title", x: cx, y: b[1] + (tall ? 26 : 24), "text-anchor": "middle" }, info.title));
        if (id === "memory") {
          /* One tick per step of history: the raw history grows every step. */
          var TW = 8, GAP = 4, TH = 12;
          var x0 = cx - (STEPS * (TW + GAP) - GAP) / 2, y = b[1] + (tall ? 36 : 33);
          var tg = svg("g", { class: "hx-ticks" });
          for (var k = 0; k < STEPS; k++) {
            var tk = svg("rect", { class: "hx-tick", x: x0 + k * (TW + GAP), y: y, width: TW, height: TH, rx: 1.5 });
            tg.appendChild(tk);
            refs.ticks.push(tk);
          }
          g.appendChild(tg);
        } else {
          g.appendChild(svg("text", { class: "hx-sub", x: cx, y: b[1] + (tall ? 45 : 42), "text-anchor": "middle" }, info.sub));
        }
      }
      nodeLayer.appendChild(g);
      refs.nodes[id] = g;
    });
    root.appendChild(edgeLayer);
    root.appendChild(nodeLayer);
    root.appendChild(packetLayer);
    stage.appendChild(root);
    R = refs;
    paintAll();
  }

  /* ---------- State and painting ---------- */
  /* clock: the ms played so far; data-clock shows it in tenths of a second, so a check can tell a running loop
     from a frozen one. */
  var S = { seq: STEP, si: 0, t: 0, step: 1, ticks: 0, playing: !reduced(), still: reduced(), visible: !hasIO, fresh: -1, clock: 0 };
  var raf = 0, last = 0, newTimer = 0, briefTimer = 0, shownClock = -1;
  function seg() { return S.seq[S.si]; }
  function edgeLen(id) {
    var pts = R && R.edges[id] ? R.edges[id].pts : null, s = 0;
    if (!pts) { return 100; }
    for (var i = 1; i < pts.length; i++) { s += dist(pts[i - 1], pts[i]); }
    return s;
  }
  /* A node's hold, or a packet's trip: 420 ms plus 0.9 ms per px of its longest edge, within 480-900 ms. */
  function dur(s) {
    if (!s.edges) { return s.d; }
    var len = Math.max.apply(null, s.edges.map(edgeLen));
    return Math.max(480, Math.min(900, 420 + 0.9 * len));
  }
  function running() { return S.playing && S.visible && !document.hidden; }
  function litNode() {
    if (S.still) { return null; }
    var s = seg();
    return s.node !== undefined ? s.node : FROM[s.edges[0]];
  }
  function litEdges() { return S.still || !seg().edges ? [] : seg().edges; }
  function setFlag(node, cls, on) { if (node) { node.classList.toggle(cls, !!on); } }
  function restart(node, cls) {
    if (!node) { return; }
    node.classList.remove(cls);
    void node.getBoundingClientRect();
    node.classList.add(cls);
  }
  function paintClasses() {
    if (!R) { return; }
    var n = litNode(), e = litEdges(), s = seg();
    Object.keys(R.nodes).forEach(function (id) { setFlag(R.nodes[id], "is-on", id === n); });
    Object.keys(R.edges).forEach(function (id) { setFlag(R.edges[id].g, "is-on", e.indexOf(id) >= 0); });
    setFlag(R.nodes.memory, "is-read", !S.still && !!s.read);
    setFlag(R.nodes.memory, "is-clearing", !S.still && !!s.clear);
    var shown = S.still ? STEPS : S.ticks;
    R.ticks.forEach(function (tk, k) {
      tk.setAttribute("visibility", k < shown ? "visible" : "hidden");
      setFlag(tk, "is-new", !S.still && k === S.fresh);
    });
    host.setAttribute("data-seg", (S.seq === STEP ? "step" : "end") + ":" + S.si);
    host.setAttribute("data-step", String(S.step));
    host.setAttribute("data-ticks", String(shown));
    host.setAttribute("data-still", S.still ? "true" : "false");
  }
  function paintPackets() {
    if (!R) { return; }
    var e = litEdges(), f = ease(Math.min(1, S.t / dur(seg())));
    Object.keys(R.packets).forEach(function (id) {
      var pk = R.packets[id];
      if (e.indexOf(id) < 0) { pk.setAttribute("visibility", "hidden"); return; }
      var p = pointAt(R.edges[id].pts, f);
      pk.setAttribute("transform", "translate(" + r1(p[0]) + " " + r1(p[1]) + ")");
      pk.setAttribute("visibility", "visible");
    });
  }
  function paintAll() { paintClasses(); paintPackets(); }
  function paintRun() {
    host.setAttribute("data-playing", S.playing ? "true" : "false");
    host.setAttribute("data-running", running() ? "true" : "false");
    paintClock();
  }
  function paintClock() {
    var c = Math.floor(S.clock / 100);
    if (c !== shownClock) { shownClock = c; host.setAttribute("data-clock", String(c)); }
  }
  var ICON_PLAY = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4 2.2v9.6L11.6 7z" fill="currentColor"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 2.5h2.6v9H3.5zM7.9 2.5h2.6v9H7.9z" fill="currentColor"/></svg>';
  function paintPlay() {
    var word = S.playing ? "Pause" : "Play";
    playBtn.innerHTML = (S.playing ? ICON_PAUSE : ICON_PLAY) + "<span>" + word + "</span>";
    playBtn.setAttribute("aria-label", word + " the harness animation");
    paintRun();
  }

  /* ---------- Timeline ---------- */
  function enter(s) {
    if (s.node && R && R.nodes[s.node]) { restart(R.nodes[s.node], "is-pulse"); }
    if (s.brief && brief) {
      restart(brief, "is-fresh");
      window.clearTimeout(briefTimer);
      briefTimer = window.setTimeout(function () { brief.classList.remove("is-fresh"); }, 900);
    }
  }
  function leave(s) {
    if (s.tick) {
      S.ticks = Math.min(STEPS, S.ticks + 1);
      S.fresh = S.ticks - 1;
      window.clearTimeout(newTimer);
      newTimer = window.setTimeout(function () { S.fresh = -1; paintClasses(); }, 700);
    }
    if (s.clear) { S.ticks = 0; S.fresh = -1; }
  }
  function advance(dt) {
    S.t += dt;
    S.clock += dt;
    var guard = 0, changed = false;
    while (S.t >= dur(seg()) && guard++ < 40) {
      S.t -= dur(seg());
      leave(seg());
      S.si += 1;
      if (S.si >= S.seq.length) {
        S.si = 0;
        if (S.seq === STEP) {
          if (S.step >= STEPS) { S.seq = END; } else { S.step += 1; }
        } else { S.seq = STEP; S.step = 1; }
      }
      enter(seg());
      changed = true;
    }
    if (changed) { paintClasses(); }
  }
  function reset() {
    S.seq = STEP; S.si = 0; S.t = 0; S.step = 1; S.ticks = 0; S.fresh = -1;
    enter(seg());
  }
  function frame(now) {
    raf = 0;
    if (!running()) { last = 0; paintRun(); return; }
    var dt = last ? Math.min(80, now - last) : 0;
    last = now;
    advance(dt);
    paintPackets();
    paintClock();
    raf = window.requestAnimationFrame(frame);
  }
  function kick() {
    if (running()) {
      if (!raf) { last = 0; raf = window.requestAnimationFrame(frame); }
    } else if (raf) {
      window.cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    }
    paintRun();
  }
  function setPlaying(p) {
    S.playing = !!p;
    /* From the static final state, Play starts a fresh episode. */
    if (S.playing && S.still) { S.still = false; reset(); paintAll(); }
    paintPlay();
    kick();
  }
  playBtn.addEventListener("click", function () { setPlaying(!S.playing); });
  document.addEventListener("visibilitychange", kick);
  if (mq) {
    var onMotion = function () {
      if (!mq.matches) { return; }
      growers.forEach(function (n) { n.classList.add("is-in"); });
      S.still = true;
      setPlaying(false);
      paintAll();
    };
    if (mq.addEventListener) { mq.addEventListener("change", onMotion); } else if (mq.addListener) { mq.addListener(onMotion); }
  }
  if (hasIO) {
    new IntersectionObserver(function (entries) {
      var v = entries[entries.length - 1].intersectionRatio >= 0.3;
      if (v !== S.visible) { S.visible = v; kick(); }
    }, { threshold: [0, 0.3, 0.6, 1] }).observe(stage);
  }

  draw();
  if (!S.still) { enter(seg()); }
  paintAll();
  paintPlay();
  kick();
  U.onResize(draw);
})();
