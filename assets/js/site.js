/* GeoGuesser Bench project page: links, shared helpers, theme, navigation, tabs,
   hero video, headline figures and the BibTeX copy button.
   LINKS is the one place to fill in the hero's three buttons. A URL makes its button a link that
   opens in a new tab; an empty one keeps the same button, without a link and marked "soon". */
var LINKS = {
  arxiv: "",        /* arXiv abstract page, e.g. "https://arxiv.org/abs/XXXX.XXXXX" */
  code: "https://github.com/HuanzhiMao/gorilla",                              /* benchmark and harness repository */
  environment: "https://github.com/HuanzhiMao/GeoGuessr-StreetView-Server"   /* offline environment repository */
};

(function () {
  "use strict";

  var G = window.GEOBENCH || {};
  var root = document.documentElement;
  var mqReduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  /* ---------- DOM helpers ---------- */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    setAttrs(node, attrs);
    append(node, children);
    return node;
  }
  var SVGNS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, children) {
    var node = document.createElementNS(SVGNS, tag);
    setAttrs(node, attrs);
    append(node, children);
    return node;
  }
  function setAttrs(node, attrs) {
    if (!attrs) { return; }
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) { return; }
      if (k === "text") { node.textContent = v; }
      else if (k === "class") { node.setAttribute("class", v); }
      else if (k === "style" && typeof v === "object") {
        Object.keys(v).forEach(function (p) { node.style.setProperty(p, v[p]); });
      }
      else if (k.slice(0, 2) === "on" && typeof v === "function") { node.addEventListener(k.slice(2), v); }
      else { node.setAttribute(k, v === true ? "" : String(v)); }
    });
  }
  function append(node, children) {
    if (children === null || children === undefined) { return; }
    if (!Array.isArray(children)) { children = [children]; }
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false) { return; }
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
  }
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function clear(node) { while (node && node.firstChild) { node.removeChild(node.firstChild); } return node; }

  /* ---------- Number formatting (keeps the paper's precision) ---------- */
  var MINUS = "−";
  function fixed(v, d) {
    if (v === null || v === undefined || isNaN(v)) { return "—"; }
    var s = Number(v).toFixed(d);
    if (/^-0(\.0+)?$/.test(s)) { s = s.slice(1); }
    return s.replace("-", MINUS);
  }
  function grouped(v, d) {
    if (v === null || v === undefined || isNaN(v)) { return "—"; }
    var s = Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    return s.replace("-", MINUS);
  }
  function signed(v, d) {
    var r = Number(Number(v).toFixed(d));
    if (r === 0) { return fixed(0, d); }
    return (r > 0 ? "+" : MINUS) + Math.abs(r).toFixed(d);
  }
  function clock(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  /* ---------- Colors by role ---------- */
  var TASK_COLOR = {
    competition: "var(--t1)", synthetic: "var(--t1)", precise_localization: "var(--t1)",
    place_naming: "var(--t2)", navigation: "var(--t3)", navigation_challenge: "var(--t3)"
  };
  var TASK_LABEL = {
    precise_localization: "Precise Localization", competition: "Competition", synthetic: "Synthetic",
    place_naming: "Place Naming", navigation: "Navigation Challenge", navigation_challenge: "Navigation Challenge"
  };

  /* ---------- Motion, resize, tooltip ---------- */
  function reducedMotion() { return !!(mqReduce && mqReduce.matches); }
  var resizeFns = [];
  var lastW = window.innerWidth, resizeRaf = 0;
  function onResize(fn) { resizeFns.push(fn); }
  window.addEventListener("resize", function () {
    if (resizeRaf) { return; }
    resizeRaf = window.requestAnimationFrame(function () {
      resizeRaf = 0;
      if (window.innerWidth === lastW) { return; }
      lastW = window.innerWidth;
      resizeFns.forEach(function (fn) { try { fn(); } catch (e) { if (window.console) { console.error(e); } } });
    });
  });

  function makeTip(container) {
    var tip = el("div", { class: "tip", "aria-hidden": "true", hidden: true });
    container.appendChild(tip);
    return {
      show: function (x, y, value, lines) {
        clear(tip);
        tip.appendChild(el("b", { text: value }));
        (lines || []).forEach(function (l) { tip.appendChild(el("span", { text: l })); });
        tip.hidden = false;
        var w = container.clientWidth;
        var tw = tip.offsetWidth || 180;
        var left = Math.min(Math.max(x, tw / 2 + 4), Math.max(tw / 2 + 4, w - tw / 2 - 4));
        tip.style.left = left + "px";
        tip.style.top = y + "px";
        if (y - tip.offsetHeight - 14 < 0) { tip.style.transform = "translate(-50%, 14px)"; }
        else { tip.style.transform = ""; }
      },
      hide: function () { tip.hidden = true; }
    };
  }

  function dataError(file) {
    return el("p", { class: "data-error", role: "alert" }, [
      "This part of the page could not load its data (", el("code", { text: file }), ")."
    ]);
  }

  function simpleTable(caption, head, rows, opts) {
    opts = opts || {};
    var table = el("table", { class: "lb" + (opts.cls ? " " + opts.cls : "") });
    table.appendChild(el("caption", { class: "sr-only", text: caption }));
    var thead = el("thead"), tr = el("tr");
    head.forEach(function (h, i) {
      tr.appendChild(el("th", { scope: "col", class: (opts.align && opts.align[i] === "r") ? "c-zero" : null, text: h }));
    });
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = el("tbody");
    rows.forEach(function (r) {
      var row = el("tr");
      r.forEach(function (c, i) {
        var cell = el(i === 0 ? "th" : "td", { scope: i === 0 ? "row" : null, class: (opts.align && opts.align[i] === "r") ? "c-zero" : null });
        append(cell, c);
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    return el("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": caption }, table);
  }

  /* ---------- Episode helpers ---------- */
  function allEpisodes() { return (G.episodes || []).concat(G.replays || []); }
  function episodeById(id) {
    var list = allEpisodes();
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
    return null;
  }
  function firstFrame(ep) { return ep && ep.frames && ep.frames.length ? ep.frames[0].src : ""; }

  window.GBP = {
    G: G, el: el, svg: svg, $: $, $all: $all, clear: clear, append: append,
    fixed: fixed, grouped: grouped, signed: signed, clock: clock, MINUS: MINUS,
    TASK_COLOR: TASK_COLOR, TASK_LABEL: TASK_LABEL,
    reducedMotion: reducedMotion, onResize: onResize, makeTip: makeTip, dataError: dataError,
    simpleTable: simpleTable, allEpisodes: allEpisodes, episodeById: episodeById,
    firstFrame: firstFrame, LINKS: LINKS
  };

  /* ---------- Theme toggle: system -> light -> dark -> system ---------- */
  var THEME_KEY = "geobench-theme";
  var ICONS = {
    system: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" fill="currentColor"/><g stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.05 3.05l1.13 1.13M11.82 11.82l1.13 1.13M3.05 12.95l1.13-1.13M11.82 4.18l1.13-1.13"/></g></svg>',
    dark: '<svg viewBox="0 0 16 16"><path d="M13.6 10.2A6 6 0 0 1 5.8 2.4a6 6 0 1 0 7.8 7.8z" fill="currentColor"/></svg>'
  };
  var NEXT = { system: "light", light: "dark", dark: "system" };
  var NAMES = { system: "Auto", light: "Light", dark: "Dark" };
  var DESCR = { system: "follows system", light: "light", dark: "dark" };
  function themeMode() {
    var a = root.getAttribute("data-theme");
    return a === "light" || a === "dark" ? a : "system";
  }
  function paintThemeButton() {
    var btn = document.getElementById("theme-toggle");
    if (!btn) { return; }
    var mode = themeMode();
    var icon = btn.querySelector(".theme-btn__icon");
    if (icon) { icon.innerHTML = ICONS[mode]; }
    var label = btn.querySelector(".theme-btn__label");
    if (label) { label.textContent = NAMES[mode]; }
    btn.setAttribute("aria-label", "Color theme: " + DESCR[mode] + ". Switch to " + DESCR[NEXT[mode]] + ".");
    btn.title = "Theme: " + NAMES[mode];
  }
  /* Browser chrome colour: the two theme-color metas follow the system scheme; a forced theme
     sets both to its own background. */
  var THEME_BG = { light: "#FFFFFF", dark: "#131314" };
  var themeMetas = $all('meta[name="theme-color"]').map(function (m) { return { el: m, content: m.getAttribute("content") }; });
  function paintThemeColor(mode) {
    themeMetas.forEach(function (m) { m.el.setAttribute("content", mode === "system" ? m.content : THEME_BG[mode]); });
  }
  function setTheme(mode) {
    if (mode === "system") { root.removeAttribute("data-theme"); } else { root.setAttribute("data-theme", mode); }
    try {
      if (mode === "system") { window.localStorage.removeItem(THEME_KEY); } else { window.localStorage.setItem(THEME_KEY, mode); }
    } catch (e) { /* storage unavailable: the choice lasts for this page view */ }
    paintThemeButton();
    paintThemeColor(mode);
  }
  (function () {
    var btn = document.getElementById("theme-toggle");
    if (!btn) { return; }
    btn.addEventListener("click", function () { setTheme(NEXT[themeMode()]); });
    paintThemeButton();
    paintThemeColor(themeMode());
  })();

  /* ---------- Link buttons: arXiv, Code, Environment (URLs in LINKS) ---------- */
  (function () {
    var host = document.getElementById("link-pills");
    if (!host) { return; }
    var PILLS = [
      { key: "arxiv", label: "arXiv", title: "arXiv", icon: '<svg viewBox="0 0 16 16"><path d="M4 1.5h5.5L13 5v9.5H4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9.3 1.7V5.2h3.5M6 8.2h5M6 10.7h5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>' },
      { key: "code", label: "Code", title: "Code", icon: '<svg viewBox="0 0 16 16"><path d="M5.5 4 1.8 8l3.7 4M10.5 4l3.7 4-3.7 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
      { key: "environment", label: "Environment", title: "Offline environment", icon: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 3.6 9.6 8 8 12.4 6.4 8z" fill="currentColor"/></svg>' }
    ];
    PILLS.forEach(function (p) {
      var href = LINKS[p.key];
      var icon = el("span", { "aria-hidden": "true", style: { display: "inline-flex" } });
      icon.innerHTML = p.icon;
      if (href) {
        host.appendChild(el("a", { class: "pill", href: href, target: "_blank", rel: "noopener", title: p.title }, [icon, p.label]));
        return;
      }
      /* No URL yet: the same button without an href, so it cannot navigate. */
      host.appendChild(el("a", { class: "pill", role: "link", "aria-disabled": "true", title: "Link coming soon" }, [
        icon, p.label, el("span", { class: "pill__soon", text: "soon" })
      ]));
    });
  })();

  /* ---------- Sticky nav: highlight the section in view ---------- */
  (function () {
    var links = $all(".topnav a[data-nav]");
    var nav = $(".topnav");
    var sections = $all("main section[data-nav]");
    if (!links.length || !sections.length) { return; }
    var current = null, raf = 0;
    function update() {
      raf = 0;
      var line = (document.querySelector(".topbar") || { offsetHeight: 58 }).offsetHeight + window.innerHeight * 0.3;
      var active = null;
      sections.forEach(function (s) { if (s.getBoundingClientRect().top <= line) { active = s.getAttribute("data-nav"); } });
      if ((window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 4) { active = "citation"; }
      if (active === current) { return; }
      current = active;
      if (!active && nav) { nav.scrollLeft = 0; }
      links.forEach(function (a) {
        if (a.getAttribute("data-nav") === active) {
          a.setAttribute("aria-current", "true");
          if (nav && nav.scrollWidth > nav.clientWidth) {
            /* .topnav is position: relative, so offsetLeft is measured inside the scroller; the
               last 22 px sit under the fade mask. */
            var x0 = a.offsetLeft, x1 = a.offsetLeft + a.offsetWidth;
            if (x0 < nav.scrollLeft || x1 > nav.scrollLeft + nav.clientWidth - 22) { nav.scrollLeft = Math.max(0, x0 - 12); }
          }
        } else { a.removeAttribute("aria-current"); }
      });
    }
    window.addEventListener("scroll", function () { if (!raf) { raf = window.requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener("resize", function () { if (!raf) { raf = window.requestAnimationFrame(update); } });
    update();
  })();

  /* ---------- Tabs (ARIA tabs with automatic activation) ---------- */
  /* Each tab shows its own panel and hides the others. A list with data-tabs is wired by the script it
     names instead (the viewer's task tabs share one panel, which this would hide). */
  (function () {
    $all('[role="tablist"]').forEach(function (list) {
      if (list.hasAttribute("data-tabs")) { return; }
      var tabs = $all('[role="tab"]', list);
      function select(tab, focus) {
        tabs.forEach(function (t) {
          var on = t === tab;
          t.setAttribute("aria-selected", on ? "true" : "false");
          t.tabIndex = on ? 0 : -1;
          var panel = document.getElementById(t.getAttribute("aria-controls"));
          if (panel) { panel.hidden = !on; }
        });
        if (focus) { tab.focus(); }
        list.dispatchEvent(new CustomEvent("tabchange", { detail: { id: tab.id } }));
      }
      tabs.forEach(function (t, i) {
        t.addEventListener("click", function () { select(t, false); });
        t.addEventListener("keydown", function (e) {
          var j = null;
          if (e.key === "ArrowRight") { j = (i + 1) % tabs.length; }
          else if (e.key === "ArrowLeft") { j = (i - 1 + tabs.length) % tabs.length; }
          else if (e.key === "Home") { j = 0; }
          else if (e.key === "End") { j = tabs.length - 1; }
          if (j !== null) { e.preventDefault(); select(tabs[j], true); }
        });
      });
    });
  })();

  /* ---------- Headline figures (computed from the leaderboard data) ---------- */
  (function () {
    var host = document.getElementById("stats");
    var lb = G.leaderboard;
    if (!host) { return; }
    if (!lb) { host.appendChild(dataError("assets/data/leaderboard.js")); return; }
    function best(key) {
      var b = null;
      lb.models.forEach(function (m) { if (!b || m.main[key].value > b.main[key].value) { b = m; } });
      return b;
    }
    var c = lb.meta.counts;
    var bc = best("competition"), bp = best("place_naming"), bn = best("navigation");
    var human = lb.human && lb.human.competition ? lb.human.competition.value : null;
    var items = [
      { v: String(c.total), small: "tasks", d: "across 3 task types" },
      { v: String(lb.models.length), small: "VLMs", d: "evaluated with a " + lb.meta.step_budget + "-step budget" },
      { v: fixed(bc.main.competition.value, 1), small: "vs " + fixed(human, 1), d: "GeoGuessr points: best agent vs experts" },
      { v: fixed(bp.main.place_naming.value, 1) + "%", small: "/ " + fixed(bn.main.navigation.value, 1) + "%", d: "best accuracy: Place Naming / Navigation Challenge" }
    ];
    items.forEach(function (it) {
      host.appendChild(el("div", { class: "stat" }, [
        el("dt", { text: it.d }),
        el("dd", null, [it.v, el("small", { text: " " + it.small })])
      ]));
    });
  })();

  /* ---------- Hero video in the Street View viewport ---------- */
  (function () {
    var video = document.getElementById("hero-video");
    if (!video) { return; }
    var V = G.videos || null;
    var hero = V && V.hero ? V.hero : null;
    var eps = allEpisodes();
    var reduce = reducedMotion();
    var chaptersHost = document.getElementById("hero-chapters");
    var labelEl = document.getElementById("hero-chapter-label");
    var fallback = document.getElementById("hero-fallback");

    /* Poster. The hero's own poster is its first frame, flat white, so autoplay
       starts without a jump. Where the video will not play by itself (reduced motion, or a
       browser that blocks autoplay) a representative still shows instead: the Precise
       Localization clip's poster, else a 16:9 episode frame. */
    var STILL_ID = "type1-tepoztlan";
    var STILL_SRC = "assets/video/" + STILL_ID + ".jpg";
    var still = V && V[STILL_ID] && V[STILL_ID].poster ? V[STILL_ID].poster : null;
    var stillPoster = still || firstFrame(episodeById("env-walkthrough")) || firstFrame(eps[0]);
    var heroPoster = hero && hero.poster ? hero.poster : null;
    video.poster = heroPoster && !reduce ? heroPoster : stillPoster;
    if (!still) {
      /* Without videos.js, use the clip's poster if it exists. */
      var probe = new Image();
      probe.onload = function () { stillPoster = STILL_SRC; if (!heroPoster || reduce) { video.poster = STILL_SRC; } };
      probe.src = STILL_SRC;
    }
    function showStill() { if (video.paused) { video.poster = stillPoster; } }
    if (hero && hero.width && hero.height) {
      video.width = hero.width;
      video.height = hero.height;
    }

    var chapters = hero && Array.isArray(hero.chapters) ? hero.chapters.slice().sort(function (a, b) { return a.start - b.start; }) : [];
    var chips = [];
    function chapterAt(t) {
      var c = null;
      chapters.forEach(function (ch) { if (ch.start <= t + 0.05) { c = ch; } });
      return c || chapters[0] || null;
    }
    /* The chips (and a label, where the page has one) name the task only; the answer appears at the end
       of each chapter, inside the video. */
    function paintChapter(ch) {
      if (labelEl) { labelEl.textContent = ch ? ch.label : "Demo"; }
      chips.forEach(function (b) {
        if (ch && b.getAttribute("data-id") === ch.id) { b.setAttribute("aria-current", "true"); } else { b.removeAttribute("aria-current"); }
      });
    }

    var failed = false;
    function showFallback() {
      if (failed) { return; }
      failed = true;
      video.removeAttribute("controls");
      video.poster = stillPoster;
      fallback.hidden = false;
      clear(chaptersHost);
      chaptersHost.hidden = false;
      chaptersHost.setAttribute("aria-label", "Open an example episode in the viewer");
      chips = [];
      /* Without the video, chapter chips open the same episodes in the viewer (the environment
         walkthrough has its own demo, not a viewer entry). */
      (G.episodes || []).filter(function (ep) { return ep.kind !== "env_tour"; }).forEach(function (ep) {
        chaptersHost.appendChild(el("a", { class: "chapter", href: "#demo", "data-episode": ep.id, onclick: function () {
          document.dispatchEvent(new CustomEvent("geobench:open-episode", { detail: { id: ep.id } }));
        } }, [ep.title]));
      });
      if (labelEl) { labelEl.textContent = "Example episodes"; }
    }

    if (chapters.length) {
      chapters.forEach(function (ch) {
        var b = el("button", { class: "chapter", type: "button", "data-id": ch.id, onclick: function () {
          try { video.currentTime = ch.start + 0.01; } catch (e) { /* not seekable yet */ }
          paintChapter(ch);
          if (video.paused && !reduce) { var p = video.play(); if (p && p.catch) { p.catch(function () {}); } }
        } }, [el("span", { class: "chapter__t", text: clock(ch.start) }), ch.label]);
        chips.push(b);
        chaptersHost.appendChild(b);
      });
      paintChapter(chapters[0]);
    } else {
      chaptersHost.hidden = true;
    }

    video.addEventListener("timeupdate", function () { if (chapters.length) { paintChapter(chapterAt(video.currentTime)); } });
    video.addEventListener("error", showFallback);

    var source = el("source", { src: hero && hero.mp4 ? hero.mp4 : "assets/video/hero.mp4", type: "video/mp4" });
    source.addEventListener("error", showFallback);
    video.appendChild(source);
    if (!reduce) {
      video.autoplay = true;
      video.setAttribute("autoplay", "");
    }
    video.load();
    if (!reduce) {
      /* If the browser refuses to autoplay, show the still instead of the flat first frame. */
      var first = video.play();
      if (first && first.catch) { first.catch(function (err) { if (err && err.name === "NotAllowedError") { showStill(); } }); }
    }

    /* Pause while the viewport is off screen; resume only if we paused it. */
    if ("IntersectionObserver" in window && !reduce) {
      var pausedByUs = false;
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (failed) { return; }
          if (!en.isIntersecting && !video.paused) { pausedByUs = true; video.pause(); }
          else if (en.isIntersecting && pausedByUs) { pausedByUs = false; var p = video.play(); if (p && p.catch) { p.catch(function () {}); } }
        });
      }, { threshold: 0.15 }).observe(video);
    }
  })();

  /* ---------- BibTeX copy with a selection fallback ---------- */
  (function () {
    var btn = document.getElementById("bib-copy");
    var pre = document.getElementById("bibtex");
    var status = document.getElementById("bib-status");
    if (!btn || !pre) { return; }
    function selectText() {
      var range = document.createRange();
      range.selectNodeContents(pre);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    function done(ok) {
      btn.textContent = ok ? "Copied" : "Copy BibTeX";
      status.textContent = ok ? "BibTeX copied to the clipboard." : "Your browser blocked clipboard access. The entry is selected; press Ctrl+C (or ⌘C) to copy it.";
      if (ok) { window.setTimeout(function () { btn.textContent = "Copy BibTeX"; }, 2200); }
    }
    function fallback() {
      selectText();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      done(ok);
    }
    btn.addEventListener("click", function () {
      /* Copy the entry itself, not the comment line above it. */
      var text = pre.textContent;
      var at = text.indexOf("@");
      if (at > 0) { text = text.slice(at); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
      } else { fallback(); }
    });
  })();
})();
