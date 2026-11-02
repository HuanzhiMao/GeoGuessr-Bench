/* GeoGuesser Bench move demo (Demo section, #environment, under the API test). The eight move tools on a
   schematic street map, drawn like a town plan but not a real place: blocks as scenery, streets as white
   strokes with panoramas (dots) along them and a turning bulb where a street ends, and the agent (the yellow
   marker) with its 90° view, facing north as benchmark episodes start. A key names the two symbols. Each press
   of a move button is one call of that tool. The call draws that direction's 45° sector from the agent, the
   environment's cone (the bearing ± 22.5°, north wrapping round 0°): if a link of the current panorama lies
   in it, the agent glides along the link to that neighbour, leaving a trail, and the call returns
   {"status": "success"}; if none does, the call fails ("no link"), the sector turns red and hatched, short of
   anything else drawn in it, and the agent stays. A move changes only the panorama, so the view keeps its
   heading. Calls and results show as white chips, as in the API test above. The map is a drawing, not data:
   link headings follow from the drawing, no panorama has two links in one sector, and agents never see a map,
   only views. For screen readers the map's label names the links where the agent stands, and the viewer's own
   calls are announced with them. A tour that uses all eight directions, two of them failing, plays while the
   map is at least 30% on screen in a visible tab, and stops at the first press of a move button; under reduced
   motion nothing plays by itself and every change is instant. For tests, the map root carries the agent's
   panorama (data-at), the last result (data-result: "ok" or "error", empty at the start) and the number of
   calls (data-calls). */
(function () {
  "use strict";
  var U = window.GBP;
  if (!U) { return; }
  var el = U.el, svg = U.svg, clear = U.clear;
  var host = document.getElementById("movedemo");
  if (!host) { return; }
  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function motionOK() { return !(mq && mq.matches); }
  /* Hover previews only where a pointer can hover (a tap would leave one behind). */
  var canHover = !!(window.matchMedia && window.matchMedia("(hover: hover)").matches);

  /* Timing: one tour call per STEP ms, a pause on the start before the first call, a hold on the last
     state before the tour goes round again; then each call's motion. */
  var STEP = 1900, FIRST = 900, LAST = 2800;
  var SWEEP_MS = 200, GLIDE_MS = 680, BUMP_MS = 360, FADE_MS = 420;

  /* ---------- The eight tools and their 45° sectors ---------- */
  var DIRS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"].map(function (w, i) {
    return { id: ["n", "ne", "e", "se", "s", "sw", "w", "nw"][i], word: w, tool: "move_" + w, deg: 45 * i };
  });
  var DIR = {};
  DIRS.forEach(function (d) { DIR[d.id] = d; });
  /* The sector of a heading (degrees clockwise from north): [bearing − 22.5, bearing + 22.5). */
  function sectorOf(h) { return DIRS[Math.floor(((((h + 22.5) % 360) + 360) % 360) / 45) % 8]; }

  /* ---------- The schematic network (a 640 x 360 map, north up) ---------- */
  /* Panoramas, and streets as runs of panoramas: each pair of neighbours on a street is a link. */
  var NODES = {
    s: [240, 240], a: [320, 240], b: [376, 184], c: [376, 104], d: [296, 104], e: [240, 160], g: [296, 296],
    w1: [160, 240], w2: [80, 240], a2: [400, 240], a3: [480, 240], a4: [560, 240],
    l1: [160, 160], l2: [160, 80], c2: [456, 104], c3: [536, 104], m: [468, 172], n1: [548, 172],
    r1: [536, 296], r2: [616, 296]
  };
  var STREETS = [
    ["w2", "w1", "s", "a", "a2", "a3", "a4"], ["s", "e", "d", "c", "b", "a"], ["s", "g"], ["w1", "l1", "l2"],
    ["l1", "e"], ["c", "c2", "c3"], ["a3", "m", "c2"], ["a4", "n1", "c3"], ["a3", "r1", "r2"]
  ];
  var START = "s";
  /* The tour: east, then north fails (the street runs east–west there), round the block back to the start,
     down the lane to its dead end, where southeast fails, and back. It ends where it starts. */
  var TOUR = ["e", "n", "ne", "n", "w", "sw", "s", "se", "se", "nw"];
  /* Scenery only: town blocks, each at least 16 from every street's centre line and every panorama. They fill
     the network's faces and wrap round it, closing every dead end; the blocks round the network are cut apart
     by hairlines that meet a street half way between two panoramas, so no gap reads as a street. */
  var BLOCKS = [
    "261.2,223.6 256.4,218.8 256.4,171.6 259.8,163.4 299.4,123.8 307.6,120.4 354.8,120.4 359.6,125.2 359.6,172.4 356.2,180.6 316.6,220.2 308.4,223.6",
    "181.2,223.6 176.4,218.8 176.4,181.2 181.2,176.4 218.8,176.4 223.6,181.2 223.6,218.8 218.8,223.6",
    "364.4,223.6 363,220.2 392.4,190.8 392.4,125.2 397.2,120.4 437.4,120.4 443.1,125.1 459.6,218.9 455.7,223.6",
    "498.6,223.6 492.9,218.9 476.4,125.1 480.3,120.4 517.4,120.4 523.1,125.1 539.6,218.9 535.7,223.6",
    "-60,-60 334.5,-60 334.5,87.6 289.2,87.6 237.4,139.4 227.2,143.6 182.4,143.6 176.4,137.6 176.4,73.2 166.8,63.6 153.2,63.6 143.6,73.2 143.6,118.5 -60,118.5",
    "700,-60 700,204.5 570.4,204.5 549.8,87.6 337.5,87.6 337.5,-60",
    "438.5,420 -60,420 -60,121.5 143.6,121.5 143.6,217.6 137.6,223.6 73.2,223.6 63.6,233.2 63.6,246.8 73.2,256.4 227.2,256.4 237.4,260.6 289.2,312.4 302.8,312.4 312.4,302.8 312.4,289.2 283.8,260.6 285.6,256.4 438.5,256.4",
    "700,420 441.5,420 441.5,256.4 467.2,256.4 477.4,260.6 529.2,312.4 622.8,312.4 632.4,302.8 632.4,289.2 622.8,279.6 548.8,279.6 538.6,275.4 523.8,260.6 525.6,256.4 579.5,256.4 570.9,207.5 700,207.5"
  ];

  /* A link's heading is the bearing from its panorama to the neighbour. Like the environment, a move
     takes the first link in its sector; this network has at most one per sector. */
  function bearing(p, q) { return (Math.atan2(q[0] - p[0], p[1] - q[1]) * 180 / Math.PI + 360) % 360; }
  var LINKS = {};
  Object.keys(NODES).forEach(function (k) { LINKS[k] = {}; });
  function link(p, q) {
    var sec = sectorOf(bearing(NODES[p], NODES[q])).id;
    if (!LINKS[p][sec]) { LINKS[p][sec] = q; }
  }
  STREETS.forEach(function (st) {
    for (var i = 1; i < st.length; i++) { link(st[i - 1], st[i]); link(st[i], st[i - 1]); }
  });
  /* A dead end: a panorama with one link. */
  function deadEnd(k) { return Object.keys(LINKS[k]).length === 1; }
  /* For screen readers: the links of a panorama as compass words, in compass order ("east and west"). */
  function linksText(at) {
    var w = DIRS.filter(function (d) { return LINKS[at][d.id]; }).map(function (d) { return d.word; });
    return "Links here: " + (w.length > 1 ? w.slice(0, -1).join(", ") + " and " + w[w.length - 1] : w.join("")) + ".";
  }

  /* ---------- Geometry ---------- */
  var R = 64, VIEW_R = 42;   /* the sector's radius (a link is about 80 long) and the view's */
  var DOT_R = 4, BULB_R = 11.2, GAP = 4;   /* a panorama's dot, a dead end's bulb; a failed sector's clearance */
  function f(v) { return String(Math.round(v * 10) / 10); }
  function polar(deg, r) { var t = deg * Math.PI / 180; return [r * Math.sin(t), -r * Math.cos(t)]; }
  /* A wedge from (0, 0): `span` degrees centred on bearing `deg`, out to radius r, or between r0 and r. */
  function wedge(deg, span, r, r0) {
    var a = polar(deg - span / 2, r), b = polar(deg + span / 2, r);
    var arc = "A" + f(r) + " " + f(r) + " 0 0 1 " + f(b[0]) + " " + f(b[1]);
    if (!r0) { return "M0 0L" + f(a[0]) + " " + f(a[1]) + arc + "Z"; }
    var c = polar(deg + span / 2, r0), d = polar(deg - span / 2, r0);
    return "M" + f(a[0]) + " " + f(a[1]) + arc + "L" + f(c[0]) + " " + f(c[1]) +
      "A" + f(r0) + " " + f(r0) + " 0 0 0 " + f(d[0]) + " " + f(d[1]) + "Z";
  }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(2 - 2 * t, 2) / 2; }
  function place(node, x, y) { node.setAttribute("transform", "translate(" + f(x) + " " + f(y) + ")"); }

  /* ---------- Map ---------- */
  var map = svg("svg", {
    class: "mvmap__svg", viewBox: "0 0 640 360", role: "img", focusable: "false",
    "aria-label": "Schematic street map. " + linksText(START)
  });
  /* The hatch of a failed sector (the move pad's dial uses it too), and the gradients of the map's edges: the
     town runs on past them, so its blocks fade to the ground there (every street ends inside, at a panorama). */
  var defs = svg("defs", null, svg("pattern", { id: "mv-hatch", width: 7, height: 7, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
    svg("rect", { class: "mv-hatch", width: 2.2, height: 7 })));
  var fades = svg("g", { class: "mv-fades" });
  [["l", 0, 0, 36, 360, [0, 0, 1, 0]], ["r", 604, 0, 36, 360, [1, 0, 0, 0]],
   ["t", 0, 0, 640, 36, [0, 0, 0, 1]], ["b", 0, 324, 640, 36, [0, 1, 0, 0]]].forEach(function (e) {
    defs.appendChild(svg("linearGradient", { id: "mv-fade-" + e[0], x1: e[5][0], y1: e[5][1], x2: e[5][2], y2: e[5][3] }, [
      svg("stop", { offset: 0, class: "mv-fade-a" }), svg("stop", { offset: 1, class: "mv-fade-b" })
    ]));
    fades.appendChild(svg("rect", { x: e[1], y: e[2], width: e[3], height: e[4], fill: "url(#mv-fade-" + e[0] + ")" }));
  });
  /* Streets: one white stroke per street; a dead end (a panorama with one link) closes in a turning bulb, so
     a failed move there never contradicts the drawing. */
  var roads = svg("g", { class: "mv-roads" });
  var edges = svg("g", { class: "mv-road-edges" });
  STREETS.forEach(function (st) {
    var pts = st.map(function (k) { return NODES[k].join(","); }).join(" ");
    edges.appendChild(svg("polyline", { points: pts }));
    roads.appendChild(svg("polyline", { points: pts }));
  });
  Object.keys(NODES).forEach(function (k) {
    if (deadEnd(k)) {
      edges.appendChild(svg("circle", { cx: NODES[k][0], cy: NODES[k][1], r: BULB_R + 1.4 }));
      roads.appendChild(svg("circle", { cx: NODES[k][0], cy: NODES[k][1], r: BULB_R }));
    }
  });
  [defs, svg("rect", { class: "mv-ground", width: 640, height: 360 }),
   svg("g", { class: "mv-blocks" }, BLOCKS.map(function (p) { return svg("polygon", { points: p }); })),
   fades, edges, roads].forEach(function (n) { map.appendChild(n); });
  var trail = svg("g", { class: "mv-trail" });
  map.appendChild(trail);
  /* Round the agent: a ring ticked at the eight sector boundaries, the 90° view and a hover preview. */
  var bezel = svg("g", { class: "mv-bezel" }, [svg("circle", { r: R })].concat(DIRS.map(function (d) {
    var a = polar(d.deg + 22.5, R - 6), b = polar(d.deg + 22.5, R + 6);
    return svg("line", { x1: f(a[0]), y1: f(a[1]), x2: f(b[0]), y2: f(b[1]) });
  })));
  var view = svg("path", { class: "mv-view", d: wedge(0, 90, VIEW_R) });
  var preview = svg("path", { class: "mv-preview", visibility: "hidden" });
  var rig = svg("g", { class: "mv-rig" }, [bezel, view, preview]);
  map.appendChild(rig);
  /* The last call's sector, over the view's tint, under the panoramas (so the neighbour shows in it). */
  var sectorShape = svg("path");
  var sector = svg("g", { class: "mv-sector", visibility: "hidden" }, sectorShape);
  map.appendChild(sector);
  /* The view's outline over the sector: where a failed sector meets the view, its red hatch and the yellow
     outline each stay whole. */
  var viewEdge = svg("path", { class: "mv-view-edge", d: wedge(0, 90, VIEW_R) });
  var lens = svg("g", { class: "mv-lens" }, viewEdge);
  map.appendChild(lens);
  var dots = svg("g", { class: "mv-nodes" });
  Object.keys(NODES).forEach(function (k) {
    dots.appendChild(svg("circle", { "data-node": k, cx: NODES[k][0], cy: NODES[k][1], r: DOT_R }));
  });
  map.appendChild(dots);
  var agent = svg("circle", { class: "mv-agent", r: 8.5 });
  map.appendChild(agent);
  function moveTo(x, y) { place(rig, x, y); place(lens, x, y); place(agent, x, y); }

  var north = el("span", { class: "mvmap__north", "aria-hidden": "true" });
  north.innerHTML = '<svg viewBox="0 0 10 12"><path d="M5 0 9.6 12 5 9.2.4 12z" fill="currentColor"/></svg><b>N</b>';
  /* A key to the two symbols, drawn as on the map: on the map's bottom-left corner, which nothing the agent
     draws from any panorama reaches, or on phones in the line under the map. Hidden from screen readers, which
     get the links from the map's label instead. */
  var KEY = '<span><svg viewBox="0 0 10 10"><circle class="mvkey__dot" cx="5" cy="5" r="3.4"/></svg>panorama</span>' +
    '<span><svg viewBox="0 0 16 12"><path class="mvkey__view" d="M8 10.5 2.7 5.2A7.5 7.5 0 0 1 13.3 5.2Z"/>' +
    '<circle class="mvkey__agent" cx="8" cy="10.5" r="2.4"/></svg>agent’s view</span>';
  function keyNode() {
    var k = el("span", { class: "mvkey", "aria-hidden": "true" });
    k.innerHTML = KEY;
    return k;
  }
  /* The map root: what the tests read. */
  var root = el("div", { class: "mvmap", "data-at": START, "data-heading": "0", "data-result": "", "data-calls": "0" }, [map, north, keyNode()]);

  /* ---------- Player: call chips, controls, the schematic note ---------- */
  var ICON_PLAY = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4 2.2v9.6L11.6 7z" fill="currentColor"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 2.5h2.6v9H3.5zM7.9 2.5h2.6v9H7.9z" fill="currentColor"/></svg>';
  var ICON_RESET = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2.6 7a4.4 4.4 0 1 0 1.3-3.1M3.4 1.6v2.7h2.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var calls = el("div", { class: "mvcalls", "aria-hidden": "true" });
  var playBtn = el("button", { class: "ctrl ctrl--primary mvplay", type: "button" });
  var resetBtn = el("button", { class: "ctrl", type: "button" });
  resetBtn.innerHTML = ICON_RESET + "<span>Reset</span>";
  var live = el("p", { class: "sr-only", "aria-live": "polite" });
  /* The chips sit over the map's top-left corner, or on phones in a slot right under it; then the line with
     the map's caption, where the view above has its credit (and on phones the key). */
  var player = el("div", { class: "mvplayer", role: "group", "aria-label": "Move tools on a schematic map" }, [
    root, calls,
    el("div", { class: "mvline" }, [keyNode(), el("p", { class: "mvnote", text: "Schematic map · agents never see a map, only views" })]),
    el("div", { class: "mvcontrols" }, [playBtn, resetBtn]), live
  ]);

  /* ---------- Move pad: the eight tools as a compass round a dial of their sectors ---------- */
  /* "move_northwest" with a break opportunity after the underscore, for narrow screens. */
  function nameNodes(name) {
    var cut = name.indexOf("_");
    return [name.slice(0, cut + 1), el("wbr"), name.slice(cut + 1)];
  }
  var dial = svg("svg", { class: "mvdial", viewBox: "-52 -52 104 104", "aria-hidden": "true", focusable: "false" });
  var keys = {}, wedges = {};
  DIRS.forEach(function (d) {
    wedges[d.id] = svg("path", { class: "mvdial__sec", "data-dir": d.id, d: wedge(d.deg, 41, 50, 15) });
    dial.appendChild(wedges[d.id]);
  });
  dial.appendChild(svg("circle", { class: "mvdial__hub", r: 7 }));
  var keyList = DIRS.map(function (d) {
    var b = el("button", { class: "envtool mvtool", type: "button", "data-tool": d.tool, "data-dir": d.id }, el("span", null, nameNodes(d.tool)));
    b.addEventListener("click", function () { press(d.id); });
    b.addEventListener("mouseenter", function () { if (canHover) { previewOn(d.id); } });
    b.addEventListener("mouseleave", function () { unhush(d.id); });
    b.addEventListener("focus", function () { if (focusVisible(b)) { previewOn(d.id); } });
    b.addEventListener("blur", function () { unhush(d.id); });
    keys[d.id] = b;
    return b;
  });
  var pad = el("div", { class: "envpad mvpad", role: "group", "aria-label": "Move tools" }, [
    el("p", { class: "label", text: "Move tools · one 45° sector each" }),
    el("div", { class: "mvrose" }, keyList.concat([dial]))
  ]);

  host.appendChild(player);
  host.appendChild(pad);

  /* ---------- Motion: a call's phases, run in order; finish() completes the rest at once ---------- */
  var job = null;
  function run(phases) {
    finish();
    var j = { phases: phases, i: 0, t0: -1, raf: 0 };
    job = j;
    if (!motionOK()) { finish(); return; }
    function tick(now) {
      if (job !== j) { return; }
      var ph = j.phases[j.i];
      if (j.t0 < 0) { j.t0 = now; }
      var t = ph.ms > 0 ? Math.min(1, (now - j.t0) / ph.ms) : 1;
      ph.step(t);
      if (t >= 1) {
        j.i += 1;
        j.t0 = -1;
        if (j.i >= j.phases.length) { job = null; return; }
      }
      j.raf = window.requestAnimationFrame(tick);
    }
    j.raf = window.requestAnimationFrame(tick);
  }
  function finish() {
    var j = job;
    if (!j) { return; }
    job = null;
    window.cancelAnimationFrame(j.raf);
    for (var k = j.i; k < j.phases.length; k++) { j.phases[k].step(1); }
  }

  /* ---------- Calls ---------- */
  var state = { at: START, heading: 0, calls: 0, playing: motionOK(), visible: false, timer: 0, next: 0, dirty: false };
  function chip(tag, cls, text) { return el(tag, { class: cls, text: text }); }
  function chips(list) { clear(calls); list.forEach(function (c) { calls.appendChild(c); }); }
  function setResult(r) { root.setAttribute("data-result", r); host.setAttribute("data-result", r); }
  /* The agent's panorama, for the tests and for screen readers (the map's label names its links). */
  function setAt(at) {
    state.at = at;
    root.setAttribute("data-at", at);
    map.setAttribute("aria-label", "Schematic street map. " + linksText(at));
  }
  function light(id, ok) {
    DIRS.forEach(function (d) {
      var on = d.id === id;
      keys[d.id].classList.toggle("is-lit", on && ok);
      keys[d.id].classList.toggle("is-err", on && !ok);
      wedges[d.id].classList.toggle("is-ok", on && ok);
      wedges[d.id].classList.toggle("is-err", on && !ok);
    });
  }

  /* How far a failed call's sector reaches from panorama `at`: to the ring, or GAP short of the first thing drawn
     in it that is not linked here (another panorama's dot or bulb, a street that does not start here, at its full
     stroke width), so it never seems to hold a way on. Each such shape is convex, so the sector first meets it at
     its nearest point, if that lies in the sector, or else where one of the sector's edges enters it. The agent's
     own streets lie in other sectors and only graze this one beside the agent. */
  function nearest(x, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    var t = L ? Math.max(0, Math.min(1, ((x[0] - a[0]) * dx + (x[1] - a[1]) * dy) / L)) : 0;
    return [a[0] + t * dx, a[1] + t * dy];
  }
  function dist(p, q) { return Math.sqrt((q[0] - p[0]) * (q[0] - p[0]) + (q[1] - p[1]) * (q[1] - p[1])); }
  function reachOf(at, deg) {
    var p = NODES[at], half = (parseFloat(window.getComputedStyle(roads.firstChild).strokeWidth) || 0) / 2;
    var shapes = [], best = R + GAP;
    STREETS.forEach(function (st) {
      for (var i = 1; i < st.length; i++) {
        if (st[i - 1] !== at && st[i] !== at) { shapes.push([NODES[st[i - 1]], NODES[st[i]], half]); }
      }
    });
    Object.keys(NODES).forEach(function (k) {
      if (k !== at) { shapes.push([NODES[k], NODES[k], deadEnd(k) ? BULB_R : DOT_R]); }
    });
    shapes.forEach(function (o) {
      var c = nearest(p, o[0], o[1]);
      if (Math.abs(((bearing(p, c) - deg) % 360 + 540) % 360 - 180) <= 22.5) { best = Math.min(best, dist(p, c) - o[2]); }
      [deg - 22.5, deg + 22.5].forEach(function (e) {
        var u = polar(e, 1);
        for (var t = 0; t < best; t += 0.25) {
          var x = [p[0] + u[0] * t, p[1] + u[1] * t];
          if (dist(x, nearest(x, o[0], o[1])) < o[2]) { best = t; return; }
        }
      });
    });
    return Math.min(R, best - GAP);
  }

  /* One call: the environment's answer is immediate (the state and data-* change at once); the drawing
     follows. The sector grows from the agent; then the agent glides along the link (the trail drawn
     behind it), the result chip appears and the sector fades back; or the agent bumps against the empty
     sector, which stays, and the error chip appears. */
  function call(id, user) {
    finish();
    var d = DIR[id], from = state.at, to = LINKS[from][id] || null;
    var p = NODES[from], q = to ? NODES[to] : p, reach = to ? R : reachOf(from, d.deg);
    state.calls += 1;
    setAt(to || from);
    root.setAttribute("data-calls", String(state.calls));
    setResult(to ? "ok" : "error");
    var callChip = chip("code", null, d.tool + "()");
    var resultChip = to ? chip("span", "is-ok", '{"status": "success"}') : chip("span", "is-err", "error · no link " + d.word);
    chips([callChip]);
    light(id, !!to);
    place(sector, p[0], p[1]);
    sector.setAttribute("class", "mv-sector " + (to ? "is-ok" : "is-err"));
    sector.setAttribute("visibility", "visible");
    /* The viewer's own calls are announced with the links where the agent now stands. */
    if (user) {
      live.textContent = d.tool + ": " + (to ? "success, still facing north." : "error, no link " + d.word + ".") + " " + linksText(state.at);
    }
    var phases = [{ ms: SWEEP_MS, step: function (t) {
      sectorShape.setAttribute("d", wedge(d.deg, 45, reach * (0.3 + 0.7 * easeOut(t))));
      sector.style.opacity = String(0.3 + 0.7 * t);
    } }];
    var result = { ms: 0, step: function () { chips([callChip, resultChip]); } };
    if (to) {
      var len = Math.sqrt((q[0] - p[0]) * (q[0] - p[0]) + (q[1] - p[1]) * (q[1] - p[1]));
      var seg = svg("line", { x1: p[0], y1: p[1], x2: q[0], y2: q[1], "stroke-dasharray": f(len), "stroke-dashoffset": f(len) });
      trail.appendChild(seg);
      phases.push({ ms: GLIDE_MS, step: function (t) {
        var k = easeInOut(t);
        moveTo(p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k);
        seg.setAttribute("stroke-dashoffset", f(len * (1 - k)));
      } }, result, { ms: SWEEP_MS, step: function (t) { sector.style.opacity = String(1 - 0.6 * t); } });
    } else {
      var u = polar(d.deg, 1);
      phases.push({ ms: BUMP_MS, step: function (t) {
        var k = t < 1 ? 9 * Math.sin(Math.PI * t) : 0;
        moveTo(p[0] + u[0] * k, p[1] + u[1] * k);
      } }, result);
    }
    run(phases);
  }

  /* Back to the start: the agent on its first panorama, facing north, no trail, no sector, no result. */
  function resetState() {
    var p = NODES[START];
    setAt(START);
    state.calls = 0;
    state.next = 0;
    state.dirty = false;
    root.setAttribute("data-calls", "0");
    setResult("");
    clear(trail);
    trail.style.opacity = "";
    sector.style.opacity = "";
    sector.setAttribute("visibility", "hidden");
    moveTo(p[0], p[1]);
    view.setAttribute("transform", "rotate(" + state.heading + ")");
    viewEdge.setAttribute("transform", "rotate(" + state.heading + ")");
    light(null, false);
    chips([chip("span", "is-start", "start · facing north")]);
  }
  function reset() { finish(); resetState(); }

  /* A hover or keyboard focus on a tool outlines its sector at the agent and on the dial. A pressed key's
     outline stays off until the pointer leaves it or focus moves, so its call's own sector is what shows. */
  var hushed = null;
  function previewOn(id) {
    if (hushed === id) { return; }
    preview.setAttribute("d", wedge(DIR[id].deg, 45, R));
    preview.setAttribute("visibility", "visible");
    DIRS.forEach(function (d) { wedges[d.id].classList.toggle("is-preview", d.id === id); });
  }
  function previewOff() {
    preview.setAttribute("visibility", "hidden");
    DIRS.forEach(function (d) { wedges[d.id].classList.remove("is-preview"); });
  }
  function unhush(id) {
    if (hushed === id) { hushed = null; }
    previewOff();
  }
  function focusVisible(b) { try { return b.matches(":focus-visible"); } catch (e) { return true; } }

  /* ---------- Tour ---------- */
  function clearTimer() { if (state.timer) { window.clearTimeout(state.timer); state.timer = 0; } }
  function running() { return state.playing && state.visible && !document.hidden; }
  function schedule() {
    clearTimer();
    host.classList.toggle("is-playing", running());
    if (!running()) { return; }
    var end = state.next >= TOUR.length;
    state.timer = window.setTimeout(function () {
      state.timer = 0;
      if (end) { again(); return; }
      call(TOUR[state.next], false);
      state.next += 1;
      schedule();
    }, end ? LAST : (state.next === 0 ? FIRST : STEP));
  }
  /* The tour ends on the start: the trail and the last sector fade, and it goes round again. */
  function again() {
    state.next = 0;
    run([
      { ms: FADE_MS, step: function (t) { trail.style.opacity = String(1 - t); sector.style.opacity = String(1 - t); } },
      { ms: 0, step: resetState }
    ]);
    schedule();
  }
  function paintPlay() {
    playBtn.innerHTML = (state.playing ? ICON_PAUSE : ICON_PLAY) + "<span>" + (state.playing ? "Pause" : "Play") + "</span>";
    /* Announce calls only while the viewer makes them, not every two seconds during the tour. */
    live.setAttribute("aria-live", state.playing ? "off" : "polite");
  }
  function setPlaying(p) {
    state.playing = !!p;
    /* After the viewer's own moves, the tour starts again from the start. */
    if (state.playing && state.dirty) { reset(); }
    paintPlay();
    schedule();
  }
  /* A press of a move tool stops the tour and makes one call. Motion still running finishes first: at the end of a
     lap that resets the tour, which must not undo the viewer's call (Play then starts the tour from the start). */
  function press(id) {
    if (state.playing) { setPlaying(false); }
    finish();
    state.dirty = true;
    hushed = id;
    previewOff();
    call(id, true);
  }

  playBtn.addEventListener("click", function () { setPlaying(!state.playing); });
  resetBtn.addEventListener("click", function () {
    reset();
    if (!state.playing) { live.textContent = "Back at the start, facing north. " + linksText(START); }
    schedule();
  });
  document.addEventListener("visibilitychange", schedule);
  if (mq) {
    var onMotion = function () { if (mq.matches && state.playing) { setPlaying(false); } };
    if (mq.addEventListener) { mq.addEventListener("change", onMotion); } else if (mq.addListener) { mq.addListener(onMotion); }
  }
  /* Play only while at least 30% of the map is on screen. */
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      var v = entries[entries.length - 1].intersectionRatio >= 0.3;
      if (v !== state.visible) { state.visible = v; schedule(); }
    }, { threshold: [0, 0.3, 0.6, 1] }).observe(root);
  } else {
    state.visible = true;
  }

  paintPlay();
  resetState();
  schedule();
})();
