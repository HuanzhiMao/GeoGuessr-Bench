/* GeoGuesser Bench charts: score curve, start-location map, knowing-vs-looking scatter,
   zero-score shares, retention under cropped views, coverage and failure modes (the
   harness section has its own script, harness.js). Charts render at their container's pixel width (so text stays at
   true size) and redraw on resize and when their Findings item opens (onOpen); all text
   takes theme tokens through CSS classes. */
(function () {
  "use strict";
  var U = window.GBP;
  if (!U) { return; }
  var el = U.el, svg = U.svg, clear = U.clear, fixed = U.fixed;
  var G = U.G;
  var LB = G.leaderboard;
  var FIG = G.figures || {};

  function width(node, fallback) { return Math.max(1, Math.round(node.clientWidth || fallback || 640)); }
  /* Use the SVG's own coordinate system when CSS or browser zoom changes its rendered size. */
  function svgPoint(root, ev, W, H) {
    var matrix = root.getScreenCTM();
    if (matrix) {
      var point = root.createSVGPoint();
      point.x = ev.clientX; point.y = ev.clientY;
      return point.matrixTransform(matrix.inverse());
    }
    var rect = root.getBoundingClientRect();
    return { x: (ev.clientX - rect.left) * W / (rect.width || W), y: (ev.clientY - rect.top) * H / (rect.height || H) };
  }
  /* Keep measured labels inside their SVG without shrinking their readable text size. */
  function containLabels(root, W) {
    if (!root.getBoundingClientRect().width) { return; }
    U.$all("text", root).forEach(function (label) {
      var box, offset = 0;
      try { box = label.getBBox(); } catch (e) { return; }
      if (!box.width) { return; }
      if (box.x < 4) { offset = 4 - box.x; }
      else if (box.x + box.width > W - 4) { offset = W - 4 - box.x - box.width; }
      if (offset) { label.setAttribute("x", parseFloat(label.getAttribute("x")) + offset); }
    });
  }
  /* Web fonts may replace the fallback after the first draw and change label widths. */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      U.$all("#score-curve > svg, #knowing-scatter > svg").forEach(function (root) {
        containLabels(root, root.viewBox.baseVal.width);
      });
    });
  }
  function figure(key, opts) {
    opts = opts || {};
    var f = FIG[key];
    if (!f) { return null; }
    var img = el("img", { src: f.src, width: f.w, height: f.h, alt: f.alt || "", loading: "lazy", decoding: "async" });
    if (f.srcset) { img.setAttribute("srcset", f.srcset); img.setAttribute("sizes", opts.sizes || "(min-width: 1000px) 640px, 100vw"); }
    if (f.max_width && opts.cap !== false) { img.style.maxWidth = f.max_width + "px"; }
    var wrap = el("figure", { class: opts.photo ? "photo" : "plate" }, img);
    /* Line figures with small labels: on phones they keep a readable width and scroll sideways. */
    var hint = null;
    if (opts.zoom) {
      wrap.classList.add("plate--zoom");
      img.style.setProperty("--zoom-w", opts.zoom + "px");
      hint = el("p", { class: "fig-hint", text: "Scroll the figure sideways to see all of it." });
    }
    /* The caption: the page's own one-line text when given (opts.caption, after an optional bold
       opts.lead), else the data's caption with its title (its first sentence) in bold. The credit
       always follows. */
    var cap;
    if (opts.caption) {
      cap = el("p", { class: "figcap" }, [
        opts.lead ? el("b", { text: opts.lead + " " }) : null,
        opts.caption,
        f.credit ? " " + f.credit + "." : ""
      ]);
    } else {
      var text = (f.caption || "").replace(/^\s*/, "");
      var title = f.title && text.indexOf(f.title) === 0 ? f.title : "";
      cap = el("p", { class: "figcap" }, [
        title ? el("b", { text: title + " " }) : null,
        text.slice(title.length).replace(/^\s*/, ""),
        f.credit ? " " + f.credit + "." : ""
      ]);
    }
    return { fig: hint ? el("div", { class: "fig-zoom" }, [hint, wrap]) : wrap, cap: cap };
  }
  /* Findings are <details> items, closed by default. A chart inside a closed item has no layout width
     (it is drawn at the fallback width), so fn draws it again, at its container's width, when the
     item opens. */
  function onOpen(host, fn) {
    var item = host && host.closest ? host.closest("details") : null;
    if (item) { item.addEventListener("toggle", function () { if (item.open) { fn(); } }); }
  }

  /* =====================================================================
     Score curve: S(d) = 5000 exp(-10 d / D), log-scaled distance axis
     ===================================================================== */
  (function () {
    var host = document.getElementById("score-curve");
    var slider = document.getElementById("score-slider");
    var out = document.getElementById("score-out");
    if (!host || !slider) { return; }
    var Dkm = (LB && LB.meta.score_formula && LB.meta.score_formula.D_km) || 14916.862;
    var MAX = (LB && LB.meta.score_max) || 5000;
    function S(d) { return MAX * Math.exp(-10 * d / Dkm); }
    var X0 = -1, X1 = Math.log10(20000);
    var marks = [];
    if (LB && LB.human && LB.human.competition) {
      marks.push({ d: LB.human.competition.km, s: LB.human.competition.value, label: "Expert reference", cls: "ref-dot--human" });
    }
    if (LB) {
      var best = null;
      LB.models.forEach(function (m) { if (!best || m.main.competition.value > best.main.competition.value) { best = m; } });
      if (best) { marks.push({ d: best.main.competition.km, s: best.main.competition.value, label: "Best agent", cls: "ref-dot--agent", who: best.name }); }
    }
    var cursorLine, cursorDot, geom;
    function fmtKm(d) { return d < 100 ? U.grouped(d, 1) : U.grouped(Math.round(d), 0); }
    function update() {
      var lx = parseFloat(slider.value);
      var d = Math.pow(10, lx);
      var s = S(d);
      out.textContent = fmtKm(d) + " km → " + U.grouped(s, 1) + " points";
      slider.setAttribute("aria-valuetext", fmtKm(d) + " kilometres, " + U.grouped(s, 1) + " points");
      if (geom) {
        var x = geom.x(lx), y = geom.y(s);
        cursorLine.setAttribute("x1", x); cursorLine.setAttribute("x2", x);
        cursorLine.setAttribute("y1", geom.y(0)); cursorLine.setAttribute("y2", y);
        cursorDot.setAttribute("cx", x); cursorDot.setAttribute("cy", y);
      }
    }
    function draw() {
      clear(host);
      var W = width(host, 560);
      var narrow = W < 420;
      var H = Math.round(Math.max(240, Math.min(340, W * 0.56)));
      var m = { l: 50, r: 14, t: 26, b: 46 };
      var pw = W - m.l - m.r, ph = H - m.t - m.b;
      function x(lx) { return m.l + (lx - X0) / (X1 - X0) * pw; }
      function y(s) { return m.t + (1 - s / MAX) * ph; }
      geom = { x: x, y: y };
      var root = svg("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Score against distance on a log scale: 5000 points at zero distance, halving about every 1,034 km." });
      var grid = svg("g", { class: "grid" });
      [0, 1000, 2000, 3000, 4000, 5000].forEach(function (v) {
        grid.appendChild(svg("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
        root.appendChild(svg("text", { x: m.l - 8, y: y(v) + 4, "text-anchor": "end", class: "num" }, U.grouped(v, 0)));
      });
      [-1, 0, 1, 2, 3, 4].forEach(function (p) {
        grid.appendChild(svg("line", { x1: x(p), x2: x(p), y1: m.t, y2: m.t + ph }));
        var lab = p < 0 ? "0.1" : U.grouped(Math.pow(10, p), 0);
        if (narrow && p >= 3) { lab = Math.pow(10, p - 3) + "k"; }
        root.appendChild(svg("text", { x: x(p), y: m.t + ph + 17, "text-anchor": p === -1 ? "start" : (p === 4 ? "end" : "middle") }, lab));
      });
      root.insertBefore(grid, root.firstChild);
      root.appendChild(svg("line", { class: "baseline", x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }));
      root.appendChild(svg("text", { class: "axis-title", x: narrow ? W / 2 : m.l + pw / 2, y: H - 6, "text-anchor": "middle" },
        narrow ? "Distance (km, log scale)" : "Distance from the answer (km, log scale)"));
      root.appendChild(svg("text", { class: "axis-title", x: m.l - 8, y: 12, "text-anchor": "start" }, "GeoGuessr points"));
      var N = 260, dPath = "", aPath = "";
      for (var i = 0; i <= N; i++) {
        var lx = X0 + (X1 - X0) * i / N;
        var px = x(lx), py = y(S(Math.pow(10, lx)));
        dPath += (i ? "L" : "M") + px.toFixed(1) + " " + py.toFixed(1);
      }
      aPath = dPath + "L" + x(X1).toFixed(1) + " " + y(0).toFixed(1) + "L" + x(X0).toFixed(1) + " " + y(0).toFixed(1) + "Z";
      root.appendChild(svg("path", { class: "curve-area", d: aPath }));
      root.appendChild(svg("path", { class: "curve", d: dPath }));
      cursorLine = svg("line", { class: "cursor-line" });
      root.appendChild(cursorLine);
      marks.forEach(function (mk) {
        var cx = x(Math.log10(mk.d)), cy = y(mk.s);
        root.appendChild(svg("circle", { class: "ref-dot " + mk.cls, cx: cx, cy: cy, r: 5 }));
        /* Expert label sits below-left of its dot (the curve runs above it there); the
           agent label sits to the right, above the falling curve. */
        if (mk.cls === "ref-dot--human") { root.appendChild(svg("text", { class: "lbl", x: cx - 9, y: cy + 15, "text-anchor": "end" }, mk.label)); }
        else { root.appendChild(svg("text", { class: "lbl", x: cx + 9, y: cy - 5, "text-anchor": "start" }, mk.label)); }
      });
      cursorDot = svg("circle", { class: "cursor-dot", cx: 0, cy: 0, r: 6 });
      root.appendChild(cursorDot);
      /* Drag on the plot to move the distance. */
      var hit = svg("rect", { x: m.l, y: m.t, width: pw, height: ph, fill: "transparent", style: "cursor: ew-resize; touch-action: pan-y" });
      function fromEvent(ev) {
        var point = svgPoint(root, ev, W, H);
        var px = Math.max(m.l, Math.min(W - m.r, point.x));
        var lx = X0 + (px - m.l) / pw * (X1 - X0);
        slider.value = String(Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), lx)));
        update();
      }
      var dragging = false;
      hit.addEventListener("pointerdown", function (ev) { dragging = true; try { hit.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ } fromEvent(ev); });
      hit.addEventListener("pointermove", function (ev) { if (dragging) { fromEvent(ev); } });
      hit.addEventListener("pointerup", function () { dragging = false; });
      hit.addEventListener("pointercancel", function () { dragging = false; });
      root.appendChild(hit);
      host.appendChild(root);
      containLabels(root, W);
      update();
    }
    /* Start at the halving distance D ln 2 / 10 (2,500 points). step="any" keeps it exact;
       the arrow keys move a twentieth of a decade, Page Up/Down half a decade. */
    slider.value = String(Math.log10(Dkm * Math.LN2 / 10));
    slider.addEventListener("input", update);
    slider.addEventListener("keydown", function (e) {
      var dv = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05, PageUp: 0.5, PageDown: -0.5 }[e.key];
      var lo = parseFloat(slider.min), hi = parseFloat(slider.max);
      if (e.key === "Home") { dv = lo - parseFloat(slider.value); }
      if (e.key === "End") { dv = hi - parseFloat(slider.value); }
      if (dv === undefined) { return; }
      e.preventDefault();
      slider.value = String(Math.max(lo, Math.min(hi, parseFloat(slider.value) + dv)));
      update();
    });
    draw();
    U.onResize(draw);
    var card = host.parentNode;
    var key = el("p", { class: "figcap" });
    marks.forEach(function (mk, i) {
      if (i) { key.appendChild(document.createTextNode(" ")); }
      key.appendChild(el("b", { text: mk.label + (mk.who ? ", " + mk.who : "") + ": " }));
      key.appendChild(document.createTextNode(U.fixed(mk.s, 1) + " points" + (i ? "" : " on Competition") + " (" + (i ? "" : "score-equivalent ") + U.fixed(mk.d, 1) + " km)."));
    });
    if (marks.length) { card.appendChild(key); }
  })();

  /* =====================================================================
     Start-location map (full-precision coordinates, no entry ids)
     ===================================================================== */
  (function () {
    var host = document.getElementById("location-map");
    if (!host) { return; }
    var W0 = G.world, L = G.locations;
    if (!W0 || !W0.path || !L || !L.length) {
      var f = figure("global_distribution");
      if (f) { host.appendChild(f.fig); host.appendChild(f.cap); }
      else { host.appendChild(U.dataError("assets/data/world.js")); }
      return;
    }
    var SPLITS = [
      { key: "competition", label: "Competition", cls: "dot-c", shape: "circle" },
      { key: "synthetic", label: "Synthetic", cls: "dot-s", shape: "ring" },
      { key: "place_naming", label: "Place Naming", cls: "dot-p", shape: "square" },
      { key: "navigation", label: "Navigation Challenge", cls: "dot-n", shape: "triangle" }
    ];
    var counts = {};
    L.forEach(function (p) { counts[p.split] = (counts[p.split] || 0) + 1; });
    var active = null;
    var legend = el("div", { class: "legend chips", role: "group", "aria-label": "Highlight a split" });
    function shape(s, cx, cy, r) {
      if (s.shape === "square") { return svg("rect", { class: s.cls, x: cx - r * 0.9, y: cy - r * 0.9, width: r * 1.8, height: r * 1.8 }); }
      if (s.shape === "triangle") { return svg("path", { class: s.cls, d: "M" + cx + " " + (cy - r * 1.15) + "L" + (cx + r * 1.05) + " " + (cy + r * 0.75) + "L" + (cx - r * 1.05) + " " + (cy + r * 0.75) + "Z" }); }
      return svg("circle", { class: s.cls, cx: cx, cy: cy, r: s.shape === "ring" ? r * 0.85 : r });
    }
    function icon(s) {
      var ic = svg("svg", { viewBox: "-7 -7 14 14", "aria-hidden": "true" });
      ic.appendChild(shape(s, 0, 0, 4.6));
      return ic;
    }
    var buttons = [];
    var allBtn = el("button", { class: "chip", type: "button", "aria-pressed": "true", onclick: function () { setActive(null); } }, ["All splits", el("span", { class: "n", text: String(L.length) })]);
    legend.appendChild(allBtn);
    SPLITS.forEach(function (s) {
      var b = el("button", { class: "chip", type: "button", "aria-pressed": "false", onclick: function () { setActive(active === s.key ? null : s.key); } }, [
        icon(s), s.label, el("span", { class: "n", text: String(counts[s.key] || 0) })
      ]);
      b.setAttribute("data-split", s.key);
      buttons.push(b);
      legend.appendChild(b);
    });
    /* The subsection's one-line caption describes the map; the legend chips name each shape. */
    var card = el("div", { class: "mapcard" });
    host.appendChild(legend);
    host.appendChild(card);
    var groups = {};
    function setActive(k) {
      active = k;
      allBtn.setAttribute("aria-pressed", k ? "false" : "true");
      buttons.forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-split") === k ? "true" : "false"); });
      Object.keys(groups).forEach(function (g) { groups[g].classList.toggle("is-dim", !!k && g !== k); });
    }
    function draw() {
      clear(card);
      var crop = (W0.viewBox_paper_crop || "-180 -84 360 142").split(/\s+/).map(Number);
      var lon0 = crop[0], top = -crop[1], spanX = crop[2], spanY = crop[3];
      var Wpx = width(card, 900);
      var k = Wpx / spanX, Hpx = Math.round(spanY * k);
      var root = svg("svg", { width: Wpx, height: Hpx, viewBox: "0 0 " + Wpx + " " + Hpx, role: "group", "aria-label": "World map of the 282 starting locations, colored and shaped by split. Each marker opens nearby Google Street View in a new tab." });
      var g0 = svg("g", { transform: "translate(" + (-lon0 * k).toFixed(3) + " " + (top * k).toFixed(3) + ") scale(" + k.toFixed(5) + ")" });
      var grat = svg("g", { class: "graticule" });
      for (var gx = -150; gx <= 150; gx += 30) { grat.appendChild(svg("line", { x1: gx, y1: -90, x2: gx, y2: 90 })); }
      for (var gy = -60; gy <= 60; gy += 30) { grat.appendChild(svg("line", { x1: -180, y1: gy, x2: 180, y2: gy })); }
      g0.appendChild(grat);
      g0.appendChild(svg("path", { class: "land", d: W0.path, "vector-effect": "non-scaling-stroke" }));
      root.appendChild(g0);
      var r = Math.max(2.6, Math.min(4.2, Wpx / 230));
      groups = {};
      ["navigation", "place_naming", "synthetic", "competition"].forEach(function (key) {
        var s = SPLITS.filter(function (q) { return q.key === key; })[0];
        var g = svg("g", { "data-split": key });
        L.forEach(function (p) {
          if (p.split !== key) { return; }
          var cx = (p.lng - lon0) * k, cy = (top - p.lat) * k;
          var streetview = p.streetview;
          var viewpoint = streetview ? streetview.lat + "," + streetview.lng : p.lat + "," + p.lng;
          var label = s.label + ": " + fixed(Math.abs(p.lat), 5) + "°" + (p.lat < 0 ? "S" : "N") + ", " + fixed(Math.abs(p.lng), 5) + "°" + (p.lng < 0 ? "W" : "E") + ". Open Google Street View near this location (new tab).";
          var link = svg("a", {
            class: "map-location",
            /* A resolved panorama avoids a fresh coordinate search; camera coordinates are the fallback if its ID changes. */
            href: "https://www.google.com/maps/@?api=1&map_action=pano" + (streetview ? "&pano=" + encodeURIComponent(streetview.pano) : "") + "&viewpoint=" + encodeURIComponent(viewpoint),
            target: "_blank", rel: "noopener noreferrer", "aria-label": label
          });
          link.appendChild(svg("title", {}, label));
          link.appendChild(svg("circle", { class: "map-location__halo", cx: cx, cy: cy, r: r + 4, "aria-hidden": "true" }));
          link.appendChild(shape(s, cx, cy, r));
          g.appendChild(link);
        });
        groups[key] = g;
        root.appendChild(g);
      });
      card.appendChild(root);
      setActive(active);
    }
    draw();
    U.onResize(draw);
  })();

  /* =====================================================================
     Coverage: the panorama figure, with a one-line caption (the finding's
     text carries the numbers, from Section 5.3 and the coverage appendix);
     it needs only figures.js, so it comes before the leaderboard check
     ===================================================================== */
  (function () {
    var host = document.getElementById("coverage-visual");
    if (!host) { return; }
    var f = figure("coverage_panorama", { photo: true, sizes: "(min-width: 1000px) 680px, 100vw",
      caption: "Bright: viewed in one no-movement episode; dark: never viewed." });
    if (f) { host.appendChild(f.fig); host.appendChild(f.cap); } else { host.appendChild(U.dataError("assets/data/figures.js")); }
  })();

  if (!LB) {
    ["knowing-scatter", "zero-bars", "retention-bars", "fm-visual"].forEach(function (id) {
      var n = document.getElementById(id);
      if (n) { n.appendChild(U.dataError("assets/data/leaderboard.js")); }
    });
    return;
  }
  var MODELS = LB.models.slice().sort(function (a, b) { return a.paper_order - b.paper_order; });
  var COLS = {};
  LB.columns.forEach(function (c) { COLS[c.key] = c; });
  function mean2(m) { return (m.main.competition.value + m.main.synthetic.value) / 2; }

  /* =====================================================================
     Knowing vs looking: mean Precise Localization score vs Navigation Challenge
     ===================================================================== */
  (function () {
    var host = document.getElementById("knowing-scatter");
    if (!host) { return; }
    var HL = { "gpt-5-4": { sub: "3rd on Synthetic, tied 18th here", pos: "left" }, "claude-fable-5": { sub: "tied 1st here, 11th on Competition", pos: "above" } };
    var pts = MODELS.map(function (m) { return { m: m, x: mean2(m), y: m.main.navigation.value }; });
    var tip = U.makeTip(host);
    var ymax = Math.max(40, Math.ceil(Math.max.apply(null, pts.map(function (p) { return p.y; })) / 10) * 10);
    function draw() {
      U.$all("svg", host).forEach(function (n) { n.parentNode.removeChild(n); });
      tip.hide();
      var W = width(host, 560);
      var H = Math.round(Math.max(270, Math.min(380, W * 0.66)));
      /* Phones: more room under the axis title for the label above Claude Fable 5's dot, and a
         shorter x-axis title that fits the plot's width. */
      var narrow = W < 520;
      var m = { l: 44, r: 14, t: narrow ? 36 : 24, b: narrow ? 60 : 46 };
      var pw = W - m.l - m.r, ph = H - m.t - m.b;
      function x(v) { return m.l + v / 5000 * pw; }
      function y(v) { return m.t + (1 - v / ymax) * ph; }
      var root = svg("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "group", "aria-label": "Scatter plot of " + pts.length + " models: mean Precise Localization score against Navigation Challenge accuracy" });
      var grid = svg("g", { class: "grid" });
      for (var v = 0; v <= 5000; v += 1000) {
        grid.appendChild(svg("line", { x1: x(v), x2: x(v), y1: m.t, y2: m.t + ph }));
        /* Phones: every other tick label, so "4,000" and "5,000" do not run together. */
        if (narrow && v % 2000 !== 0) { continue; }
        root.appendChild(svg("text", { x: x(v), y: m.t + ph + 17, "text-anchor": v === 0 ? "start" : (v === 5000 ? "end" : "middle") }, U.grouped(v, 0)));
      }
      for (var t = 0; t <= ymax; t += 10) {
        grid.appendChild(svg("line", { x1: m.l, x2: m.l + pw, y1: y(t), y2: y(t) }));
        root.appendChild(svg("text", { x: m.l - 8, y: y(t) + 4, "text-anchor": "end" }, t + "%"));
      }
      root.appendChild(grid);
      root.appendChild(svg("line", { class: "baseline", x1: m.l, x2: m.l + pw, y1: y(0), y2: y(0) }));
      if (narrow) {
        root.appendChild(svg("text", { class: "axis-title", x: W / 2, y: H - 22, "text-anchor": "middle" }, "Mean Precise Localization score"));
        root.appendChild(svg("text", { class: "axis-title", x: W / 2, y: H - 6, "text-anchor": "middle" }, "(Competition and Synthetic)"));
      } else {
        root.appendChild(svg("text", { class: "axis-title", x: m.l + pw / 2, y: H - 6, "text-anchor": "middle" }, "Mean Precise Localization score (Competition and Synthetic)"));
      }
      root.appendChild(svg("text", { class: "axis-title", x: m.l - 8, y: 12 }, "Navigation Challenge accuracy"));
      var layer = svg("g");
      var hot = null;
      function show(p, node) {
        if (hot) { hot.classList.remove("is-hot"); }
        hot = node; node.classList.add("is-hot");
        tip.show(x(p.x), y(p.y), p.m.name, [
          "Mean Precise Localization score " + fixed(p.x, 2),
          "Navigation Challenge " + fixed(p.y, 2) + "%",
          "Ranks: Competition " + rankText(p.m, "competition") + ", Synthetic " + rankText(p.m, "synthetic") + ", Navigation " + rankText(p.m, "navigation")
        ]);
      }
      function hide() { if (hot) { hot.classList.remove("is-hot"); hot = null; } tip.hide(); }
      var nodes = [];
      pts.slice().sort(function (a, b) { return (HL[a.m.id] ? 1 : 0) - (HL[b.m.id] ? 1 : 0); }).forEach(function (p) {
        var cx = x(p.x), cy = y(p.y);
        var hitc = svg("circle", { class: "hit", cx: cx, cy: cy, r: 12, tabindex: "-1", role: "img",
          "aria-label": p.m.name + ": mean Precise Localization score " + fixed(p.x, 2) + ", Navigation Challenge accuracy " + fixed(p.y, 2) + "%" });
        var dot = svg("circle", { class: "pt" + (HL[p.m.id] ? " pt--hl" : ""), cx: cx, cy: cy, r: HL[p.m.id] ? 6 : 5 });
        hitc.addEventListener("focus", function () { show(p, dot); });
        hitc.addEventListener("blur", hide);
        layer.appendChild(hitc);
        layer.appendChild(dot);
        nodes.push({ p: p, dot: dot, hit: hitc, cx: cx, cy: cy });
      });
      /* One tab stop for the plot; the arrow keys move between dots from left to right. */
      var order = nodes.slice().sort(function (a, b) { return a.cx - b.cx || b.cy - a.cy; });
      order[0].hit.setAttribute("tabindex", "0");
      order.forEach(function (n, i) {
        n.hit.addEventListener("keydown", function (ev) {
          var j = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: order.length - 1 }[ev.key];
          if (j === undefined) { return; }
          ev.preventDefault();
          j = Math.max(0, Math.min(order.length - 1, j));
          order.forEach(function (o) { o.hit.setAttribute("tabindex", "-1"); });
          order[j].hit.setAttribute("tabindex", "0");
          order[j].hit.focus();
        });
      });
      root.appendChild(layer);
      /* Direct labels for the two models the paper discusses. */
      pts.forEach(function (p) {
        var h = HL[p.m.id];
        if (!h) { return; }
        var cx = x(p.x), cy = y(p.y);
        if (h.pos === "above") {
          root.appendChild(svg("text", { class: "lbl", x: cx, y: cy - 24, "text-anchor": "middle" }, p.m.name));
          root.appendChild(svg("text", { class: "lbl-sub", x: cx, y: cy - 10, "text-anchor": "middle" }, h.sub));
        } else {
          root.appendChild(svg("text", { class: "lbl", x: cx - 11, y: cy + 4, "text-anchor": "end" }, p.m.name));
          /* On phones this line would cover a neighbouring dot; the finding's text says the same. */
          if (!narrow) { root.appendChild(svg("text", { class: "lbl-sub", x: cx - 11, y: cy + 19, "text-anchor": "end" }, h.sub)); }
        }
      });
      root.appendChild(svg("text", { class: "lbl-sub", x: m.l + pw, y: m.t + ph - 8, "text-anchor": "end" }, "Spearman ρ = 0.39 for each split"));
      /* Nearest-point hover: the pointer only has to be closest. */
      root.addEventListener("pointermove", function (ev) {
        var point = svgPoint(root, ev, W, H);
        var px = point.x, py = point.y;
        var best = null, bd = 30 * 30;
        nodes.forEach(function (n) { var d = (n.cx - px) * (n.cx - px) + (n.cy - py) * (n.cy - py); if (d < bd) { bd = d; best = n; } });
        if (best) { show(best.p, best.dot); } else { hide(); }
      });
      root.addEventListener("pointerleave", hide);
      host.insertBefore(root, host.firstChild);
      containLabels(root, W);
    }
    /* Rank as the paper words it: the best position held, with "tied" when other models share
       the value (the paper's "ties for 18th"). Counted from the Table 1 values. */
    function rankText(m, key) {
      var v = m.main[key].value, higher = 0, same = 0;
      MODELS.forEach(function (o) { var w = o.main[key].value; if (w > v) { higher += 1; } else if (w === v) { same += 1; } });
      return (same > 1 ? "tied " : "") + (higher + 1);
    }
    draw();
    U.onResize(draw);
    onOpen(host, draw);

    var details = document.getElementById("knowing-table");
    if (details) {
      details.appendChild(U.simpleTable("Mean Precise Localization score and Navigation Challenge accuracy for each model",
        ["Model", "Competition", "Synthetic", "Mean", "Navigation Challenge"],
        pts.map(function (p) {
          return [p.m.name, fixed(p.m.main.competition.value, 1), fixed(p.m.main.synthetic.value, 1), fixed(p.x, 2), fixed(p.y, 2) + "%"];
        }), { align: ["l", "r", "r", "r", "r"] }));
    }
  })();

  /* =====================================================================
     Failing to commit: pooled zero-score shares by cause (from Table 8)
     ===================================================================== */
  (function () {
    var host = document.getElementById("zero-bars");
    if (!host) { return; }
    var n = MODELS.length;
    var SEG = [
      { key: "step", label: "Ended at the step limit", color: "var(--zero-step)", ink: "var(--zero-step-ink)" },
      { key: "abst", label: "Abstained", color: "var(--zero-abst)", ink: "var(--zero-abst-ink)" },
      { key: "other", label: "Other zero (errors, no reply)", color: "var(--zero-other)", ink: "var(--zero-other-ink)" },
      { key: "nonzero", label: "Scored above zero", color: null, ink: null }
    ];
    var rows = [["competition", "Competition"], ["synthetic", "Synthetic"]].map(function (s) {
      var N = COLS[s[0]].n * n, z = 0, st = 0, ab = 0;
      MODELS.forEach(function (m) { z += m.zero[s[0]].zero; st += m.zero[s[0]].step; ab += m.zero[s[0]].abst; });
      return { key: s[0], label: s[1], N: N, zero: z, v: { step: st, abst: ab, other: z - st - ab, nonzero: N - z } };
    });
    var legend = el("div", { class: "hbar-legend" });
    SEG.forEach(function (s) {
      legend.appendChild(el("span", null, [el("i", { class: s.color ? null : "track", style: s.color ? { "--c": s.color } : null }), s.label]));
    });
    host.appendChild(legend);
    rows.forEach(function (r) {
      var head = el("p", { class: "note", style: { "margin-top": "14px", color: "var(--ink)" } }, [
        el("strong", { text: r.label + " " }),
        el("span", { class: "muted", text: U.grouped(r.N, 0) + " episodes, " + fixed(100 * r.zero / r.N, 1) + "% score zero" })
      ]);
      var barRow = el("div", { role: "img", "aria-label": r.label + ": " + SEG.map(function (s) { return s.label + " " + fixed(100 * r.v[s.key] / r.N, 1) + "%"; }).join(", "),
        style: { display: "flex", gap: "2px", height: "28px", "margin-top": "6px", "border-radius": "0 4px 4px 0", overflow: "hidden" } });
      SEG.forEach(function (s) {
        var share = r.v[s.key] / r.N;
        var seg = el("div", { style: {
          flex: "0 0 calc(" + (share * 100).toFixed(3) + "% - 2px)",
          background: s.color || "var(--surface-2)",
          "box-shadow": s.color ? "none" : "inset 0 0 0 1px var(--line)",
          display: "flex", "align-items": "center", "padding-left": "7px",
          "font-size": "12px", "font-weight": "700", "white-space": "nowrap", overflow: "hidden",
          color: s.ink || "var(--ink)", "font-variant-numeric": "tabular-nums"
        } });
        seg.setAttribute("data-share", share.toFixed(4));
        seg.setAttribute("data-label", fixed(100 * share, 1) + "%");
        barRow.appendChild(seg);
      });
      host.appendChild(head);
      host.appendChild(barRow);
    });
    /* In-segment labels only where they fit with padding (measured after layout). */
    function labels() {
      U.$all("[data-share]", host).forEach(function (seg) {
        seg.textContent = "";
        var t = seg.getAttribute("data-label");
        if (seg.clientWidth >= t.length * 7.4 + 14) { seg.textContent = t; }
      });
    }
    labels();
    U.onResize(labels);
    onOpen(host, labels);
    var details = document.getElementById("zero-table");
    if (details) {
      details.appendChild(U.simpleTable("Zero-score episodes pooled over all models, by cause",
        ["Split", "Episodes", "Step limit", "Abstained", "Other zero", "Scored above zero"],
        rows.map(function (r) {
          function c(k) { return U.grouped(r.v[k], 0) + " (" + fixed(100 * r.v[k] / r.N, 1) + "%)"; }
          return [r.label, U.grouped(r.N, 0), c("step"), c("abst"), c("other"), c("nonzero")];
        }), { align: ["l", "r", "r", "r", "r", "r"] }));
    }
  })();

  /* =====================================================================
     Robustness: retention under top/bottom-half crops, computed from Tables 1
     and 3 (the data builder stops unless these reproduce the paper's figures)
     ===================================================================== */
  (function () {
    var host = document.getElementById("retention-bars");
    if (!host) { return; }
    var rows = MODELS.filter(function (m) { return m.retention !== null && m.retention !== undefined; })
      .sort(function (a, b) { return b.retention - a.retention; });
    if (!rows.length) {
      var card = host.closest(".finding__visual");
      if (card) { card.hidden = true; }
      return;
    }
    var mainRank = rows.slice().sort(function (a, b) { return mean2(b) - mean2(a); }).map(function (m) { return m.id; });
    var list = el("div", { role: "list", "aria-label": "Retention by model", style: { display: "grid", gap: "6px" } });
    var TRACKS = "minmax(0, 152px) minmax(0, 1fr) 54px";   /* px, so header and rows line up */
    var gridRows = [], modelLabels = [];
    var retentionTitle = el("span", { text: "Share of main-setting score kept with half views" });
    var head = el("div", { "aria-hidden": "true", style: { display: "grid", "grid-template-columns": TRACKS, gap: "10px", "font-size": "11.5px", color: "var(--muted)", "font-weight": "600" } }, [
      el("span", { text: "Model" }), retentionTitle, el("span", { style: { "text-align": "right" }, text: "Main" })
    ]);
    gridRows.push(head);
    list.appendChild(head);
    rows.forEach(function (m) {
      var pct = Math.round(m.retention * 100);
      var emph = m.id === "claude-opus-4-8" || m.id === "gemini-3-1-pro";   /* the two the text names */
      var modelLabel = el("span", { style: { "font-size": "13px", "font-weight": emph ? "800" : "600", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }, title: m.name, text: m.name });
      modelLabels.push(modelLabel);
      var rowEl = el("div", { role: "listitem", style: { display: "grid", "grid-template-columns": TRACKS, gap: "10px", "align-items": "center" } }, [
        modelLabel,
        el("span", { style: { display: "flex", "align-items": "center", gap: "8px", "min-width": "0" } }, [
          el("span", { class: "bar", style: { flex: "1 1 auto", "min-width": "0", height: "12px" }, "aria-hidden": "true" }, el("i", { style: { width: (m.retention * 100).toFixed(2) + "%", "--c": "var(--t1)" } })),
          el("span", { class: "num", style: { "font-size": "13px", "font-weight": "700", flex: "0 0 3em", "text-align": "right" }, text: pct + "%" })
        ]),
        el("span", { class: "num muted", style: { "font-size": "12px", "text-align": "right" }, title: "Mean main-setting Precise Localization score, rank " + (mainRank.indexOf(m.id) + 1) + " of " + rows.length, text: String(Math.round(mean2(m))) })
      ]);
      rowEl.setAttribute("aria-label", m.name + ": keeps " + pct + "% of its main-setting score; mean main-setting score " + Math.round(mean2(m)));
      gridRows.push(rowEl);
      list.appendChild(rowEl);
    });
    host.appendChild(list);
    function layout() {
      var narrow = width(host) < 420;
      gridRows.forEach(function (row) {
        row.style.gridTemplateColumns = narrow ? "minmax(0, 1.2fr) minmax(64px, 1fr) 40px" : TRACKS;
        row.style.gap = narrow ? "8px" : "10px";
      });
      modelLabels.forEach(function (label) { label.style.whiteSpace = narrow ? "normal" : "nowrap"; label.style.overflowWrap = narrow ? "anywhere" : "normal"; });
      retentionTitle.textContent = narrow ? "Score retained" : "Share of main-setting score kept with half views";
    }
    layout();
    U.onResize(layout);
    onOpen(host, layout);
    var details = document.getElementById("retention-table");
    if (details) {
      details.appendChild(U.simpleTable("Retention under top and bottom half views",
        ["Model", "Main C", "Main S", "Top C", "Top S", "Bottom C", "Bottom S", "Retention"],
        rows.map(function (m) {
          var a = m.ablations;
          return [m.name, fixed(m.main.competition.value, 1), fixed(m.main.synthetic.value, 1), fixed(a.top_half.c, 0), fixed(a.top_half.s, 0), fixed(a.bottom_half.c, 0), fixed(a.bottom_half.s, 0), fixed(m.retention * 100, 1) + "%"];
        }), { align: ["l", "r", "r", "r", "r", "r", "r", "r"] }));
    }
  })();

  /* =====================================================================
     Failure modes: shares by task, counts by model
     ===================================================================== */
  (function () {
    var FM = LB.failure_modes;
    var host = document.getElementById("fm-visual");
    if (!FM || !host) { return; }
    /* Table 2 as the paper prints it: shares of failed episodes, at its precision. */
    var fmCols = [["fm1", "FM1 vision"], ["fm2", "FM2 navigation"], ["fm3", "FM3 tool use"]];
    var dg = FM.by_task_digits === undefined ? 3 : FM.by_task_digits;
    var title = (LB.meta.titles && LB.meta.titles.fm_by_task) || "Failure modes by task";
    var table = el("table", { class: "lb fm-table" });
    table.appendChild(el("caption", { class: "sr-only", text: title + ": share of failed episodes with each mode" }));
    var thr = el("tr", null, [el("th", { scope: "col", text: "Task" })]);
    fmCols.forEach(function (c) { thr.appendChild(el("th", { scope: "col", text: c[1] })); });
    table.appendChild(el("thead", null, thr));
    var tb = el("tbody");
    FM.by_task.forEach(function (r) {
      var tr = el("tr", null, el("th", { scope: "row", style: { "font-weight": "700", color: "var(--ink)" }, text: r.label }));
      fmCols.forEach(function (c) {
        var v = r[c[0]];
        var isTop = (r.most_common || []).indexOf(c[0]) >= 0;
        tr.appendChild(el("td", null, el("div", { class: "share" }, [
          el("div", { class: "bar", "aria-hidden": "true" }, el("i", { style: { width: (v * 100).toFixed(1) + "%", "--c": isTop ? "var(--fill)" : "var(--hatch)" } })),
          el("span", { class: "v" + (isTop ? " is-best" : ""), text: fixed(v, dg) }),
          isTop ? el("span", { class: "sr-only", text: " (most common)" }) : null
        ])));
      });
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    host.appendChild(el("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": title }, table));
    host.appendChild(el("p", { class: "figcap" }, [
      el("b", { text: "By task. " }),
      "Share of failed episodes with each mode; an episode can have several."
    ]));
    var f = figure("fm_counts_by_model", { cap: true, zoom: 560, lead: "By model.",
      caption: "Episodes with each mode; n is the number of failed episodes." });
    if (f) {
      host.appendChild(f.fig);
      host.appendChild(f.cap);
    } else { host.appendChild(U.dataError("assets/data/figures.js")); }
  })();
  /* The harness section (#harness: the Planner-Worker-Compressor diagram and the Compressor's token
     savings) is drawn by assets/js/harness.js. */
})();
