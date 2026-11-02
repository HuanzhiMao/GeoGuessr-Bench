/* GeoGuesser Bench leaderboard: Main results (Table 1), Ablations (Table 3),
   Steps & stopping (Tables 5 and 8). Every number comes from GEOBENCH.leaderboard,
   formatted with the precision the paper prints (columns[].digits, meta.digits). */
(function () {
  "use strict";
  var U = window.GBP;
  if (!U) { return; }
  var el = U.el, fixed = U.fixed;
  var G = U.G;
  var LB = G.leaderboard;
  var panels = {
    main: document.getElementById("lb-panel-main"),
    ablations: document.getElementById("lb-panel-ablations"),
    steps: document.getElementById("lb-panel-steps")
  };
  if (!panels.main) { return; }
  if (!LB || !LB.models) {
    Object.keys(panels).forEach(function (k) {
      if (panels[k]) { panels[k].appendChild(U.dataError("assets/data/leaderboard.js")); }
    });
    return;
  }

  var COLS = {};
  LB.columns.forEach(function (c) { COLS[c.key] = c; });
  var MODELS = LB.models.slice().sort(function (a, b) { return a.paper_order - b.paper_order; });
  var BY_ID = {};
  MODELS.forEach(function (m) { BY_ID[m.id] = m; });
  var D = LB.meta.digits || {};
  var BUDGET = LB.meta.step_budget || 40;

  var SORT_ICON = '<svg class="sort__icon" viewBox="0 0 10 12" aria-hidden="true"><path class="up" d="M5 0.8 8.6 5H1.4z" fill="currentColor"/><path class="down" d="M5 11.2 1.4 7h7.2z" fill="currentColor"/></svg>';

  /* ---------- Generic sortable table ----------
     columns: [{key, label, sub, group, cls, thCls, sticky, sortValue(row), dir, render(row), title}]
     groups:  {key: {label, unit, color}}
     pinned:  rows rendered first and never sorted (with renderPinned(row, col))
     foot:    optional function(col) -> cell content for a single tfoot row */
  function SortTable(opts) {
    var state = { key: opts.sort.key, dir: opts.sort.dir };
    var table = el("table", { class: "lb " + (opts.tableClass || "") });
    if (opts.caption) { table.appendChild(el("caption", { class: "sr-only", text: opts.caption })); }
    var thead = el("thead");
    var tbody = el("tbody");
    table.appendChild(thead);
    table.appendChild(tbody);
    var tfoot = null;
    var headCells = {};
    var hasGroups = opts.columns.some(function (c) { return !!c.group; });

    function sortButton(col) {
      var label = el("span", { class: "sort__label" }, [col.label, col.sub ? el("small", { text: col.sub }) : null]);
      var b = el("button", { class: "sort", type: "button", title: col.title || null }, [label]);
      b.insertAdjacentHTML("beforeend", SORT_ICON);
      b.addEventListener("click", function () {
        if (state.key === col.key) { state.dir = state.dir === "asc" ? "desc" : "asc"; }
        else { state.key = col.key; state.dir = col.dir || "desc"; }
        renderBody();
      });
      return b;
    }
    function headCell(col, extra) {
      var th = el("th", { scope: "col", class: [col.thCls || col.cls || "", col.sticky ? "sticky" : ""].join(" ").trim() || null });
      if (extra) { Object.keys(extra).forEach(function (k) { th.setAttribute(k, extra[k]); }); }
      th.appendChild(col.sortValue ? sortButton(col) : el("span", { text: col.label }));
      headCells[col.key] = th;
      return th;
    }
    var r1 = el("tr", { class: hasGroups ? "lb__groups" : null });
    var r2 = hasGroups ? el("tr") : null;
    var seenGroup = false;
    for (var i = 0; i < opts.columns.length; i++) {
      var col = opts.columns[i];
      if (!col.group) {
        if (seenGroup) {
          /* A column after the groups sits in the second header row (with an empty cell above it),
             so its sort button follows the grouped ones in the tab order, as it does on screen. */
          r1.appendChild(el("td", { class: "grp-gap" + (col.cls && /is-ruled/.test(col.cls) ? " is-ruled" : "") }));
          r2.appendChild(headCell(col));
        } else {
          r1.appendChild(headCell(col, hasGroups ? { rowspan: "2" } : null));
        }
        continue;
      }
      seenGroup = true;
      var span = 1;
      while (i + span < opts.columns.length && opts.columns[i + span].group === col.group) { span++; }
      var g = opts.groups[col.group] || { label: col.group };
      var gth = el("th", { scope: "colgroup", colspan: String(span), class: "grp" + (g.ruled ? " is-ruled" : "") }, [
        g.color ? el("span", { class: "grp__sw", style: { "--c": g.color }, "aria-hidden": "true" }) : null,
        g.label,
        g.unit ? el("span", { class: "grp__unit", text: g.unit }) : null
      ]);
      r1.appendChild(gth);
      for (var j = 0; j < span; j++) { r2.appendChild(headCell(opts.columns[i + j])); }
      i += span - 1;
    }
    thead.appendChild(r1);
    if (r2) { thead.appendChild(r2); }

    function cmp(a, b) {
      var col = null;
      opts.columns.forEach(function (c) { if (c.key === state.key) { col = c; } });
      var va = col.sortValue(a), vb = col.sortValue(b);
      var na = va === null || va === undefined, nb = vb === null || vb === undefined;
      if (na && nb) { return a.paper_order - b.paper_order; }
      if (na) { return 1; }
      if (nb) { return -1; }
      var d = typeof va === "string" ? va.localeCompare(vb) : va - vb;
      if (d === 0) { return (opts.tieBreak ? opts.tieBreak(a, b) : a.paper_order - b.paper_order); }
      return state.dir === "asc" ? d : -d;
    }
    function cell(tag, col, content) {
      var c = el(tag, { class: [col.cls || "", col.sticky ? "sticky" : ""].join(" ").trim() || null, scope: tag === "th" ? "row" : null });
      U.append(c, content);
      return c;
    }
    function renderBody() {
      U.clear(tbody);
      (opts.pinned || []).forEach(function (row) {
        var tr = el("tr", { class: opts.pinnedClass || null });
        opts.columns.forEach(function (col) {
          var content = opts.renderPinned ? opts.renderPinned(row, col) : null;
          tr.appendChild(cell(col.rowHeader ? "th" : "td", col, content === null || content === undefined ? el("span", { class: "dash", text: "—" }) : content));
        });
        tbody.appendChild(tr);
      });
      opts.rows.slice().sort(cmp).forEach(function (row) {
        var tr = el("tr");
        opts.columns.forEach(function (col) { tr.appendChild(cell(col.rowHeader ? "th" : "td", col, col.render(row))); });
        tbody.appendChild(tr);
      });
      Object.keys(headCells).forEach(function (k) {
        if (k === state.key) { headCells[k].setAttribute("aria-sort", state.dir === "asc" ? "ascending" : "descending"); }
        else { headCells[k].removeAttribute("aria-sort"); }
      });
      if (opts.onRender) { opts.onRender(); }
    }
    if (opts.foot) {
      tfoot = el("tfoot");
      var fr = el("tr", { class: "lb__human" });
      opts.columns.forEach(function (col) { fr.appendChild(cell(col.rowHeader ? "th" : "td", col, opts.foot(col))); });
      tfoot.appendChild(fr);
      table.appendChild(tfoot);
    }
    renderBody();
    var scroller = el("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": (opts.caption || "Table") + " (scrolls sideways)" }, table);
    return { el: scroller, rerender: renderBody, state: state };
  }

  /* ---------- Cell renderers ---------- */
  function modelCell(m) {
    return el("div", { class: "model" }, [
      /* A neutral dot: hue on this table means the task, never the provider. */
      el("span", { class: "model__dot", style: { "--c": "var(--ink)" }, "aria-hidden": "true" }),
      el("span", { class: "model__text" }, [
        el("span", { class: "model__name", text: m.name }),
        el("span", { class: "model__prov", text: m.provider })
      ])
    ]);
  }
  function bar(value, max, color, hatch) {
    var w = Math.max(0, Math.min(100, value / max * 100));
    return el("div", { class: "bar", "aria-hidden": "true" }, el("i", { class: hatch ? "hatch" : null, style: { width: w.toFixed(2) + "%", "--c": color } }));
  }
  function scoreCell(colKey, c, isBest, hatch) {
    var col = COLS[colKey];
    var dg = col.digits || { value: 1, se: 0, km: 1 };
    var top = el("div", { class: "cell__top" }, [
      el("b", { class: "v" + (isBest ? " is-best" : ""), text: fixed(c.value, dg.value) }),
      c.se !== undefined && c.se !== null ? el("span", { class: "se", text: "±" + fixed(c.se, dg.se) }) : null,
      isBest ? el("span", { class: "sr-only", text: " (best in column)" }) : null,
      c.km !== undefined && c.km !== null ? el("span", { class: "km", text: fixed(c.km, dg.km) + " km" }) : null
    ]);
    return el("div", { class: "cell cell--wide" }, [top, bar(c.value, col.max, U.TASK_COLOR[colKey], hatch)]);
  }
  function pctCell(colKey, c, isBest) {
    var col = COLS[colKey];
    var dg = col.digits || { value: 2, se: 1 };
    var top = el("div", { class: "cell__top" }, [
      el("b", { class: "v" + (isBest ? " is-best" : "") }, [fixed(c.value, dg.value), el("span", { class: "pct", text: "%" })]),
      el("span", { class: "se", text: "±" + fixed(c.se, dg.se) }),
      isBest ? el("span", { class: "sr-only", text: " (best in column)" }) : null
    ]);
    return el("div", { class: "cell" }, [top, bar(c.value, col.max, U.TASK_COLOR[colKey], false)]);
  }
  function rankCell(n) { return el("span", { class: "rank", text: String(n) }); }
  function avgRank(v) {
    /* Average of four mean ranks: exact at three decimals. */
    return el("span", { class: "avg", text: fixed(v, 3) });
  }
  function notes(parts) {
    var box = el("div", { class: "table-notes" });
    parts.forEach(function (p) { if (p) { box.appendChild(typeof p === "string" ? el("p", { text: p }) : p); } });
    return box;
  }
  function hint() { return el("p", { class: "scroll-hint", text: "Scroll the table sideways to see every column." }); }

  /* ---------- Main results ---------- */
  (function () {
    var host = panels.main;
    var human = LB.human;
    var nC = COLS.competition.n, nS = COLS.synthetic.n, nP = COLS.place_naming.n, nN = COLS.navigation.n;
    var columns = [
      { key: "rank", label: "#", cls: "col-rank", sticky: true, sortValue: function (m) { return m.paper_order; }, dir: "asc", render: function (m) { return rankCell(m.paper_order); }, title: "Rank by average rank" },
      { key: "model", label: "Model", cls: "col-model", sticky: true, rowHeader: true, sortValue: function (m) { return m.name.toLowerCase(); }, dir: "asc", render: modelCell },
      { key: "competition", group: "pl", label: "Competition", sub: "n = " + nC, cls: "num", sortValue: function (m) { return m.main.competition.value; }, render: function (m) { return scoreCell("competition", m.main.competition, m.best.indexOf("competition") >= 0); } },
      { key: "synthetic", group: "pl", label: "Synthetic", sub: "n = " + nS, cls: "num", sortValue: function (m) { return m.main.synthetic.value; }, render: function (m) { return scoreCell("synthetic", m.main.synthetic, m.best.indexOf("synthetic") >= 0); } },
      { key: "place_naming", group: "pn", label: "Accuracy", sub: "n = " + nP, cls: "num", sortValue: function (m) { return m.main.place_naming.value; }, render: function (m) { return pctCell("place_naming", m.main.place_naming, m.best.indexOf("place_naming") >= 0); } },
      { key: "navigation", group: "nc", label: "Accuracy", sub: "n = " + nN, cls: "num", sortValue: function (m) { return m.main.navigation.value; }, render: function (m) { return pctCell("navigation", m.main.navigation, m.best.indexOf("navigation") >= 0); } },
      { key: "avg", label: "Avg. rank", sub: "1 is best", cls: "num", sortValue: function (m) { return m.avg_rank; }, dir: "asc", render: function (m) { return avgRank(m.avg_rank); }, title: "Mean of the model's ranks in the four result columns" }
    ];
    var groups = {
      pl: { label: "Precise Localization", unit: "GeoGuessr points and score-equivalent km", color: "var(--t1)" },
      pn: { label: "Place Naming", unit: "%", color: "var(--t2)" },
      nc: { label: "Navigation Challenge", unit: "%", color: "var(--t3)" }
    };
    var t = SortTable({
      caption: "Results on GeoGuesser Bench: " + LB.models.length + " models and the human expert reference",
      columns: columns,
      groups: groups,
      rows: MODELS,
      sort: { key: "avg", dir: "asc" },
      pinned: human ? [human] : [],
      pinnedClass: "lb__human",
      renderPinned: function (h, col) {
        if (col.key === "rank") { return el("span", { class: "rank", text: "ref" }); }
        if (col.key === "model") {
          return el("div", { class: "model" }, [
            el("span", { class: "model__dot", style: { "--c": "var(--hatch)" }, "aria-hidden": "true" }),
            el("span", { class: "model__text" }, [
              el("span", { class: "model__name", text: h.name }),
              el("span", { class: "model__prov", text: "Better of two finalists per round" })
            ])
          ]);
        }
        if (col.key === "competition" && h.competition) { return scoreCell("competition", h.competition, false, true); }
        return null;
      }
    });
    host.appendChild(hint());
    host.appendChild(t.el);
    var main = (LB.meta.notes && LB.meta.notes.main) || "";
    host.appendChild(notes([
      main,
      "± values are standard errors. Headers sort the table.",
      human && human.note ? el("p", null, [el("strong", { text: "Human experts. " }), human.note]) : null
    ]));
  })();

  /* ---------- Ablations ---------- */
  (function () {
    var host = panels.ablations;
    var order = LB.ablation_order || [];
    var rows = order.map(function (id) { return BY_ID[id]; }).filter(function (m) { return m && m.ablations; });
    if (!rows.length) { host.appendChild(U.dataError("assets/data/leaderboard.js")); return; }
    var pos = {};
    order.forEach(function (id, i) { pos[id] = i + 1; });
    var ACOLS = LB.ablation_columns;
    var dg = D.ablations === undefined ? 0 : D.ablations;
    var mode = "raw";

    /* Paper's bold: best value per ablation column (ties all bold). */
    var bestVal = {};
    ACOLS.forEach(function (ac) {
      ["c", "s"].forEach(function (sp) {
        var k = ac.key + "." + sp;
        rows.forEach(function (m) {
          var v = m.ablations[ac.key][sp];
          if (v !== null && v !== undefined && (bestVal[k] === undefined || v > bestVal[k])) { bestVal[k] = v; }
        });
      });
    });
    /* Footnote markers from the caption. */
    var marks = {};
    var markNotes = [];
    var SYMBOLS = { gpt: "*", openrouter: "†" };
    rows.forEach(function (m) {
      (m.ablation_notes || []).forEach(function (n) {
        var sym = /OpenRouter/.test(n.text) ? SYMBOLS.openrouter : SYMBOLS.gpt;
        (n.split ? [n.split] : ["c", "s"]).forEach(function (sp) { marks[m.id + "|" + n.key + "." + sp] = sym; });
      });
    });
    var ABL_LABEL = {};
    ACOLS.forEach(function (ac) { ABL_LABEL[ac.key] = ac.label; });
    function andList(a) { return a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a[a.length - 1] : a[0]; }
    rows.forEach(function (m) {
      var routed = [];
      (m.ablation_notes || []).forEach(function (n) {
        if (/OpenRouter/.test(n.text)) {
          if (routed.indexOf(ABL_LABEL[n.key]) < 0) { routed.push(ABL_LABEL[n.key]); }
        } else {
          markNotes.push(SYMBOLS.gpt + " " + m.name + "’s " + n.text);
        }
      });
      if (routed.length) { markNotes.push(SYMBOLS.openrouter + " " + m.name + "’s " + andList(routed) + " runs used OpenRouter."); }
    });
    var SYM_ORDER = [SYMBOLS.gpt, SYMBOLS.openrouter];
    markNotes.sort(function (a, b) { return SYM_ORDER.indexOf(a.charAt(0)) - SYM_ORDER.indexOf(b.charAt(0)); });
    function mainVal(m, sp) { return sp === "c" ? m.main.competition.value : m.main.synthetic.value; }
    function ablCell(m, key, sp) {
      var v = m.ablations[key][sp];
      var mark = marks[m.id + "|" + key + "." + sp];
      if (v === null || v === undefined) { return el("span", { class: "dash", text: "—" }); }
      if (mode === "raw") {
        var isBest = v === bestVal[key + "." + sp];
        return el("span", null, [
          el("span", { class: "v" + (isBest ? " is-best" : ""), text: fixed(v, dg) }),
          isBest ? el("span", { class: "sr-only", text: " (best in column)" }) : null,
          mark ? el("span", { class: "fn", text: mark }) : null
        ]);
      }
      var d = v - mainVal(m, sp);
      var r = Math.round(d);
      var cls = r > 0 ? "delta-pos" : (r < 0 ? "delta-neg" : "delta-zero");
      return el("span", null, [el("span", { class: cls, text: U.signed(d, 0) }), mark ? el("span", { class: "fn", text: mark }) : null]);
    }
    function sortVal(key, sp) {
      return function (m) {
        var v = m.ablations[key][sp];
        if (v === null || v === undefined) { return null; }
        return mode === "raw" ? v : v - mainVal(m, sp);
      };
    }
    var columns = [
      { key: "rank", label: "#", cls: "col-rank", sticky: true, sortValue: function (m) { return pos[m.id]; }, dir: "asc", render: function (m) { return rankCell(pos[m.id]); }, title: "Average rank over the ablation columns" },
      { key: "model", label: "Model", cls: "col-model", sticky: true, rowHeader: true, sortValue: function (m) { return m.name.toLowerCase(); }, dir: "asc", render: modelCell },
      { key: "main.c", group: "main", label: "C", cls: "c-abl c-ref is-ruled", thCls: "c-abl c-ref is-ruled", sortValue: function (m) { return mainVal(m, "c"); }, render: function (m) { return el("span", { text: fixed(mainVal(m, "c"), COLS.competition.digits.value) }); } },
      { key: "main.s", group: "main", label: "S", cls: "c-abl c-ref", thCls: "c-abl c-ref", sortValue: function (m) { return mainVal(m, "s"); }, render: function (m) { return el("span", { text: fixed(mainVal(m, "s"), COLS.synthetic.digits.value) }); } }
    ];
    var groups = { main: { label: "Main setting", unit: "40 steps", ruled: true } };
    ACOLS.forEach(function (ac) {
      groups[ac.key] = { label: ac.label, ruled: true };
      ["c", "s"].forEach(function (sp, i) {
        columns.push({
          key: ac.key + "." + sp, group: ac.key, label: sp === "c" ? "C" : "S",
          cls: "c-abl" + (i === 0 ? " is-ruled" : ""), thCls: "c-abl" + (i === 0 ? " is-ruled" : ""),
          title: ac.label + ", " + (sp === "c" ? "Competition" : "Synthetic") + ": " + ac.desc,
          sortValue: sortVal(ac.key, sp), render: (function (k, s) { return function (m) { return ablCell(m, k, s); }; })(ac.key, sp)
        });
      });
    });
    var t = SortTable({
      caption: "Ablation results: mean GeoGuessr score per model on Competition (C) and Synthetic (S) under five single-factor conditions",
      columns: columns, groups: groups, rows: rows,
      sort: { key: "rank", dir: "asc" },
      tableClass: "lb--abl"
    });

    var rawBtn = el("button", { type: "button", "aria-pressed": "true", text: "Scores" });
    var deltaBtn = el("button", { type: "button", "aria-pressed": "false", text: "Change vs " + BUDGET + "-step main setting" });
    var modeNote = el("p", { class: "note" });
    function setMode(m) {
      mode = m;
      rawBtn.setAttribute("aria-pressed", m === "raw" ? "true" : "false");
      deltaBtn.setAttribute("aria-pressed", m === "delta" ? "true" : "false");
      modeNote.textContent = m === "raw"
        ? "Mean GeoGuessr score (0–5000); bold marks the best per column."
        : "Change from the model’s " + BUDGET + "-step main-setting score, in points; green is higher, red lower.";
      t.rerender();
    }
    rawBtn.addEventListener("click", function () { setMode("raw"); });
    deltaBtn.addEventListener("click", function () { setMode("delta"); });
    host.appendChild(el("div", { class: "toolbar" }, [el("div", { class: "seg", role: "group", "aria-label": "Show ablation cells as" }, [rawBtn, deltaBtn]), modeNote]));
    setMode("raw");
    host.appendChild(hint());
    host.appendChild(t.el);

    var defs = el("dl", { class: "defs" });
    ACOLS.forEach(function (ac) { defs.appendChild(el("dt", { text: ac.label })); defs.appendChild(el("dd", { text: ac.desc })); });
    host.appendChild(notes([
      (["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"][ACOLS.length - 1] || String(ACOLS.length)) + " single-factor changes on " + rows.length + " models, on Competition (C, n = " + COLS.competition.n + ") and Synthetic (S, n = " + COLS.synthetic.n + "). Rows follow average rank over the " + (ACOLS.length * 2) + " ablation columns.",
      defs,
      markNotes.length ? el("p", null, markNotes.join(" ")) : null
    ]));
  })();

  /* ---------- Steps & stopping ---------- */
  (function () {
    var host = panels.steps;
    var budget = BUDGET;
    var sd = D.steps === undefined ? 1 : D.steps;
    var stack = el("div", { class: "panel-stack" });
    host.appendChild(stack);

    /* Steps per episode */
    var splits = [["competition", "Competition"], ["synthetic", "Synthetic"], ["place_naming", "Place Naming"], ["navigation", "Navigation Challenge"]];
    var stepCols = [
      { key: "rank", label: "#", cls: "col-rank", sticky: true, sortValue: function (m) { return m.paper_order; }, dir: "asc", render: function (m) { return rankCell(m.paper_order); } },
      { key: "model", label: "Model", cls: "col-model", sticky: true, rowHeader: true, sortValue: function (m) { return m.name.toLowerCase(); }, dir: "asc", render: modelCell }
    ];
    splits.forEach(function (s) {
      stepCols.push({
        key: s[0], label: s[1], sub: "mean ± sd", cls: "num",
        sortValue: function (m) { return m.steps[s[0]] ? m.steps[s[0]].mean : null; },
        render: function (m) {
          var v = m.steps[s[0]];
          if (!v) { return el("span", { class: "dash", text: "—" }); }
          return el("div", { class: "steps-cell" }, [
            el("div", { class: "cell__top" }, [el("span", { class: "v", text: fixed(v.mean, sd) }), el("span", { class: "se", text: "±" + fixed(v.sd, sd) })]),
            bar(Math.min(v.mean, budget), budget, U.TASK_COLOR[s[0]], false)
          ]);
        }
      });
    });
    var t1 = SortTable({
      caption: "Average steps per episode, mean and standard deviation, per task split",
      columns: stepCols, rows: MODELS, sort: { key: "rank", dir: "asc" }
    });
    var stepsBlock = el("div", null, [
      el("h3", { text: "Steps per episode" }),
      el("p", { class: "note", text: "Mean ± standard deviation per completed episode; bars run to the " + budget + "-step budget." }),
      hint(), t1.el,
      notes([LB.meta.notes && LB.meta.notes.steps])
    ]);
    stack.appendChild(stepsBlock);

    /* Zero scores and stopping */
    var nC = COLS.competition.n, nS = COLS.synthetic.n;
    var zd = D.zero === undefined ? 0 : D.zero;
    function zeroCol(split, field, label, sub, ruled) {
      return {
        key: split + "." + field, group: split, label: label, sub: sub, cls: "c-zero num" + (ruled ? " is-ruled" : ""), thCls: "c-zero" + (ruled ? " is-ruled" : ""),
        sortValue: function (m) { return m.zero[split][field]; },
        dir: field === "median" ? "desc" : "desc",
        render: function (m) {
          var v = m.zero[split][field];
          return el("span", { class: field === "zero" ? "zero-n" : null, text: fixed(v, zd) });
        }
      };
    }
    var zeroCols = [
      { key: "rank", label: "#", cls: "col-rank", sticky: true, sortValue: function (m) { return m.paper_order; }, dir: "asc", render: function (m) { return rankCell(m.paper_order); } },
      { key: "model", label: "Model", cls: "col-model", sticky: true, rowHeader: true, sortValue: function (m) { return m.name.toLowerCase(); }, dir: "asc", render: modelCell },
      zeroCol("competition", "median", "Median", "score", true),
      zeroCol("competition", "zero", "Zero", "of " + nC),
      zeroCol("competition", "step", "Step", "limit"),
      zeroCol("competition", "abst", "Abstained", "before limit"),
      zeroCol("synthetic", "median", "Median", "score", true),
      zeroCol("synthetic", "zero", "Zero", "of " + nS),
      zeroCol("synthetic", "step", "Step", "limit"),
      zeroCol("synthetic", "abst", "Abstained", "before limit")
    ];
    ["place_naming", "navigation"].forEach(function (k, i) {
      zeroCols.push({
        key: "sl." + k, group: "sl", label: k === "place_naming" ? "Place Naming" : "Navigation Ch.", sub: "of " + COLS[k].n,
        cls: "c-zero num" + (i === 0 ? " is-ruled" : ""), thCls: "c-zero" + (i === 0 ? " is-ruled" : ""),
        sortValue: function (m) { return m.zero.step_limit[k]; },
        render: function (m) { return el("span", { text: fixed(m.zero.step_limit[k], zd) }); }
      });
    });
    /* Pooled row: sums over all models (the paper's 45.7% / 38.6% etc. come from these). */
    function pooled(split, field) {
      var s = 0;
      MODELS.forEach(function (m) { s += field === "sl" ? m.zero.step_limit[split] : m.zero[split][field]; });
      return s;
    }
    function pooledCell(split, field, n) {
      var s = pooled(split, field);
      var N = n * MODELS.length;
      return el("span", null, [el("span", { class: "zero-n", text: String(s) }), el("span", { class: "zero-of", text: " " + fixed(100 * s / N, 1) + "%" })]);
    }
    var t2 = SortTable({
      caption: "Precise Localization score distribution and failure causes, and step-limit counts for Place Naming and Navigation Challenge",
      columns: zeroCols,
      groups: {
        competition: { label: "Competition", unit: "episodes of " + nC, color: "var(--t1)", ruled: true },
        synthetic: { label: "Synthetic", unit: "episodes of " + nS, color: "var(--t1)", ruled: true },
        sl: { label: "Ends at step limit", unit: "of 80", ruled: true }
      },
      rows: MODELS, sort: { key: "rank", dir: "asc" },
      foot: function (col) {
        if (col.key === "rank") { return el("span", { class: "rank", text: "all" }); }
        if (col.key === "model") { return el("span", { class: "model__text" }, [el("span", { class: "model__name", text: "All " + MODELS.length + " models" }), el("span", { class: "model__prov", text: "Pooled; percent of all episodes" })]); }
        var m = /^(competition|synthetic)\.(zero|step|abst)$/.exec(col.key);
        if (m) { return pooledCell(m[1], m[2], m[1] === "competition" ? nC : nS); }
        var s = /^sl\.(.+)$/.exec(col.key);
        if (s) { return pooledCell(s[1], "sl", COLS[s[1]].n); }
        return el("span", { class: "dash", text: "—" });
      }
    });
    stack.appendChild(el("div", null, [
      el("h3", { text: "Zero scores and stopping" }),
      el("p", { class: "note", text: "Precise Localization episodes that score zero, and why. The last group counts Place Naming and Navigation Challenge episodes that ended at the step limit." }),
      hint(), t2.el,
      notes([LB.meta.notes && LB.meta.notes.zero])
    ]));
  })();
})();
