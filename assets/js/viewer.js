/* GeoGuesser Bench episode viewer: steps through GEOBENCH.episodes (and GEOBENCH.replays)
   view by view, with clue boxes in each frame's own pixel space, the call log, the question,
   and the answer card at the last view. A compass heading tape and pose line appear only for
   frames whose data records a camera pose (none of the Figure 1 examples do). The environment
   walkthrough (kind "env_tour") has its own player, envdemo.js, so the viewer leaves it out.
   Episodes are picked with the task tabs above the viewer, static HTML in index.html that this
   module wires as ARIA tabs (roving tabindex; the arrow keys, Home and End select). The three tabs
   share one panel, #viewer-panel: a tab shows the example whose ep.task is its data-task. Episodes
   no tab opens (replays) follow as chips; showing one selects the tab of its task, as does the
   hero's geobench:open-episode event. */
(function () {
  "use strict";
  var U = window.GBP;
  if (!U) { return; }
  var el = U.el, svg = U.svg, clear = U.clear;
  var host = document.getElementById("viewer");
  if (!host) { return; }
  var G = U.G;
  var EPS = U.allEpisodes().filter(function (e) { return e && e.kind !== "env_tour" && e.frames && e.frames.length; });
  if (!EPS.length) {
    host.appendChild(U.dataError("assets/data/episodes.js"));
    return;
  }

  var state = { e: 0, f: 0, playing: false, timer: 0, full: false };
  var POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  var CARD = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  function norm(d) { return ((d % 360) + 360) % 360; }
  function point16(d) { return POINTS[Math.round(norm(d) / 22.5) % 16]; }
  function signedDeg(v) { return (v < 0 ? U.MINUS : "") + Math.abs(v) + "°"; }
  function taskColor(ep) {
    return U.TASK_COLOR[ep.task] || "var(--muted)";
  }
  function tagText(ep) {
    if (ep.kind === "illustrative") { return "Illustrative"; }
    if (ep.kind === "replay") { return "Replay"; }
    return "";
  }
  function chipLabel(ep) {
    if (ep.kind === "illustrative" && ep.task) { return U.TASK_LABEL[ep.task]; }
    return ep.title || ep.id;
  }

  /* ---------- Task tabs and extra chips ---------- */
  var tablist = host.querySelector('[role="tablist"]');
  var panel = document.getElementById("viewer-panel") || host.appendChild(el("div", { class: "viewer__panel", id: "viewer-panel" }));
  /* A tab opens the first episode of its task, an illustrative one before a replay. */
  function exampleOf(task) {
    var best = -1;
    EPS.forEach(function (e, i) {
      if (e.task === task && (best < 0 || (EPS[best].kind === "replay" && e.kind !== "replay"))) { best = i; }
    });
    return best;
  }
  var tabs = (tablist ? U.$all('[role="tab"]', tablist) : []).map(function (b) {
    var t = { el: b, task: b.getAttribute("data-task"), name: b.getAttribute("aria-labelledby") || b.id };
    t.ep = exampleOf(t.task);
    if (t.ep < 0) { b.setAttribute("aria-disabled", "true"); }
    return t;
  });
  var usable = tabs.filter(function (t) { return t.ep >= 0; });
  function tabFor(i) {
    for (var k = 0; k < usable.length; k++) { if (usable[k].ep === i) { return usable[k]; } }
    return null;
  }
  /* Episodes no tab opens (replays; every episode if the tabs are missing) keep the earlier chips. */
  var extras = [];
  EPS.forEach(function (e, i) { if (!tabFor(i)) { extras.push(i); } });
  var chips = extras.map(function (i) {
    var e = EPS[i];
    return el("button", { class: "chip", type: "button", "aria-pressed": "false", id: "viewer-ep-" + e.id, "data-id": e.id, onclick: function () { selectEpisode(i, true); } }, [
      el("span", { class: "chip__sw", style: { "--c": taskColor(e) }, "aria-hidden": "true" }),
      chipLabel(e),
      el("span", { class: "chip__tag", text: tagText(e) })
    ]);
  });
  if (chips.length) {
    host.insertBefore(el("div", { class: "chips", role: "group", "aria-label": usable.length ? "More episodes" : "Episodes" }, chips), panel);
  }

  /* ---------- Skeleton ---------- */
  var img = el("img", { alt: "", decoding: "async", loading: "lazy" });
  var boxes = svg("svg", { class: "boxes", "aria-hidden": "true", preserveAspectRatio: "none" });
  var badge = el("span", { class: "frame__badge" });
  var frameBox = el("div", { class: "frame" }, [img, boxes, badge]);
  /* Attribution sits under the image, so it never covers the imagery's own marks or a clue box. */
  var credit = el("p", { class: "frame__credit", text: "Imagery: Google Street View" });
  var tape = el("div", { class: "tape", "aria-hidden": "true" });
  var pose = el("p", { class: "pose" });
  var clueNotes = el("div", { class: "clue-notes" });
  var ICON_PREV = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2.5 4.5 7 9 11.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_NEXT = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M5 2.5 9.5 7 5 11.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_PLAY = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4 2.2v9.6L11.6 7z" fill="currentColor"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 2.5h2.6v9H3.5zM7.9 2.5h2.6v9H7.9z" fill="currentColor"/></svg>';
  var prevBtn = el("button", { class: "ctrl", type: "button", "aria-label": "Previous view" });
  prevBtn.innerHTML = ICON_PREV;
  var nextBtn = el("button", { class: "ctrl", type: "button", "aria-label": "Next view" });
  nextBtn.innerHTML = ICON_NEXT;
  var playBtn = el("button", { class: "ctrl ctrl--primary", type: "button" });
  var range = el("input", { class: "range", type: "range", min: "1", max: "1", step: "1", value: "1", id: "viewer-range", "aria-label": "View" });
  var controls = el("div", { class: "controls" }, [prevBtn, playBtn, nextBtn, range]);
  var caption = el("p", { class: "frame-caption" });
  var live = el("p", { class: "sr-only", "aria-live": "polite" });
  var stage = el("div", { class: "stage", tabindex: "0", role: "group", "aria-label": "Episode views. Use the left and right arrow keys to step through them." }, [frameBox, credit, tape, pose, clueNotes, controls, caption, live]);

  var qCard = el("div", { class: "card" });
  var logCard = el("div", { class: "card" });
  var logList = el("ol", { class: "log" });
  logCard.appendChild(el("p", { class: "label", text: "Calls behind each view" }));
  logCard.appendChild(logList);
  var ansCard = el("div", { class: "card answer" });
  var side = el("div", { class: "side" }, [qCard, logCard, ansCard]);

  var provenance = el("p", { class: "provenance" });
  var downloads = el("p", { class: "downloads" });

  panel.appendChild(el("div", { class: "viewer__grid" }, [stage, side]));
  panel.appendChild(provenance);
  panel.appendChild(downloads);

  /* ---------- Rendering ---------- */
  function ep() { return EPS[state.e]; }
  function frame() { return ep().frames[state.f]; }

  function renderQuestion() {
    var e = ep();
    clear(qCard);
    qCard.appendChild(el("p", { class: "label", text: "Question" }));
    var shortQ = e.question_short || e.question || "";
    qCard.appendChild(el("p", { class: "q__short", text: shortQ }));
    if (e.question && e.question !== shortQ) {
      var pre = el("pre", { class: "q__full", id: "viewer-full-prompt", hidden: !state.full, text: e.question });
      var btn = el("button", { class: "linkbtn", type: "button", "aria-expanded": state.full ? "true" : "false", "aria-controls": "viewer-full-prompt", text: state.full ? "Hide the full prompt" : "Show the full prompt" });
      btn.addEventListener("click", function () {
        state.full = !state.full;
        pre.hidden = !state.full;
        btn.setAttribute("aria-expanded", state.full ? "true" : "false");
        btn.textContent = state.full ? "Hide the full prompt" : "Show the full prompt";
      });
      qCard.appendChild(el("p", { class: "q__actions" }, btn));
      qCard.appendChild(pre);
    }
    if (e.question_note) { qCard.appendChild(el("p", { class: "q__note", text: e.question_note })); }
    if (e.kind === "replay" && e.model) {
      qCard.appendChild(el("p", { class: "q__note", text: e.model.name + (e.model.run ? ", " + e.model.run : "") }));
    }
  }

  function renderLog() {
    clear(logList);
    ep().frames.forEach(function (fr, i) {
      var calls = fr.calls && fr.calls.length ? fr.calls.join("  ·  ") : null;
      var b = el("button", { type: "button", onclick: function () { go(i, true); } }, [
        el("span", { class: "log__n", text: (i + 1 < 10 ? "0" : "") + (i + 1) }),
        el("span", { class: "log__calls" }, calls ? calls : el("i", { text: i === 0 ? "start view" : "no new call" }))
      ]);
      logList.appendChild(el("li", null, b));
    });
  }

  function minimap(loc, label) {
    var W = G.world;
    if (!W || !W.path || !loc) { return null; }
    var vb = (W.viewBox_paper_crop || W.viewBox || "-180 -90 360 180");
    var s = svg("svg", { viewBox: vb, role: "img", "aria-label": label });
    var grat = svg("g", { class: "graticule" });
    for (var x = -150; x <= 150; x += 30) { grat.appendChild(svg("line", { x1: x, y1: -90, x2: x, y2: 90 })); }
    for (var y = -60; y <= 60; y += 30) { grat.appendChild(svg("line", { x1: -180, y1: y, x2: 180, y2: y })); }
    s.appendChild(grat);
    s.appendChild(svg("path", { class: "land", d: W.path }));
    s.appendChild(svg("circle", { class: "pin-halo", cx: loc.lng, cy: -loc.lat, r: 9 }));
    s.appendChild(svg("circle", { class: "pin", cx: loc.lng, cy: -loc.lat, r: 3.6, "vector-effect": "non-scaling-stroke" }));
    return el("div", { class: "minimap" }, s);
  }

  function renderAnswer() {
    var e = ep();
    var last = state.f === e.frames.length - 1;
    clear(ansCard);
    ansCard.hidden = false;
    ansCard.classList.remove("answer--pending");
    if (!e.answer && !e.result) { ansCard.hidden = true; return; }
    if (!last) {
      ansCard.classList.add("answer--pending");
      ansCard.appendChild(el("span", { text: "Answer at view " + e.frames.length + "." }));
      ansCard.appendChild(el("button", { class: "linkbtn", type: "button", text: "Jump to the answer", onclick: function () { go(e.frames.length - 1, true); } }));
      return;
    }
    if (e.answer) {
      ansCard.appendChild(el("p", { class: "label", text: e.answer.label || "Answer" }));
      ansCard.appendChild(el("p", { class: "answer__text", text: e.answer.text }));
    }
    if (e.result) {
      var r = e.result, bits = [];
      if (r.score !== undefined) { bits.push(U.fixed(r.score, 1) + " points"); }
      if (r.km !== undefined) { bits.push(U.fixed(r.km, 1) + " km"); }
      if (r.correct !== undefined) { bits.push(r.correct ? "correct" : "incorrect"); }
      if (bits.length) { ansCard.appendChild(el("p", { class: "answer__ref", text: "Result: " + bits.join(", ") })); }
    }
    if (e.location && e.location.name) {
      ansCard.appendChild(el("p", { class: "answer__meta", text: e.location.name }));
    }
    if (e.location && e.task === "precise_localization") {
      var m = minimap(e.location, "World map with a marker at " + (e.location.name || "the answer"));
      if (m) { ansCard.appendChild(m); }
    }
  }

  function renderTape(p) {
    clear(tape);
    if (!p || p.heading === null || p.heading === undefined) { tape.hidden = true; return; }
    tape.hidden = false;
    var W = Math.max(200, Math.round(tape.clientWidth || 600)), H = 44, span = 180;
    var k = W / span, cx = W / 2;
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H });
    if (p.fov) {
      var fw = Math.min(W, p.fov * k);
      s.appendChild(svg("rect", { class: "fov", x: cx - fw / 2, y: 0, width: fw, height: H }));
      s.appendChild(svg("line", { class: "fov-edge", x1: cx - fw / 2, y1: 0, x2: cx - fw / 2, y2: H }));
      s.appendChild(svg("line", { class: "fov-edge", x1: cx + fw / 2, y1: 0, x2: cx + fw / 2, y2: H }));
    }
    var start = Math.ceil((p.heading - span / 2) / 15) * 15;
    for (var d = start; d <= p.heading + span / 2; d += 15) {
      var x = cx + (d - p.heading) * k;
      var n = norm(d);
      var major = n % 45 === 0;
      s.appendChild(svg("line", { class: "tick" + (major ? " tick--major" : ""), x1: x, y1: H - (major ? 15 : 8), x2: x, y2: H }));
      if (major) { s.appendChild(svg("text", { class: "card", x: x, y: 17, "text-anchor": "middle" }, CARD[n / 45])); }
      else if (n % 30 === 0 && k * 15 > 26) { s.appendChild(svg("text", { x: x, y: 16, "text-anchor": "middle" }, String(n))); }
    }
    s.appendChild(svg("path", { class: "needle", d: "M" + (cx - 6) + " 0 L" + (cx + 6) + " 0 L" + cx + " 9 Z" }));
    tape.appendChild(s);
  }

  function renderBoxes(fr) {
    clear(boxes);
    boxes.setAttribute("viewBox", "0 0 " + fr.w + " " + fr.h);
    (fr.clues || []).forEach(function (c) {
      var b = c.box, x = b[0], y = b[1], w = b[2] - b[0], h = b[3] - b[1];
      boxes.appendChild(svg("rect", { class: "halo", x: x, y: y, width: w, height: h, "vector-effect": "non-scaling-stroke" }));
      boxes.appendChild(svg("rect", { class: c.kind === "natural" ? "natural" : "human", x: x, y: y, width: w, height: h, "vector-effect": "non-scaling-stroke" }));
    });
  }

  function renderFrame() {
    var e = ep(), fr = frame(), n = e.frames.length, i = state.f;
    img.src = fr.src;
    img.width = fr.w;
    img.height = fr.h;
    var callsText = fr.calls && fr.calls.length ? fr.calls.join(", ") : "start view";
    img.alt = "View " + (i + 1) + " of " + n + (fr.caption ? ": " + fr.caption : "") + ". Calls: " + callsText + ".";
    renderBoxes(fr);
    clear(badge);
    U.append(badge, [el("b", { text: "View " + (i + 1) }), " / " + n]);

    /* Pose line and tape: only for frames whose data records a camera pose. */
    var p = fr.pose;
    renderTape(p);
    clear(pose);
    if (p) {
      var bits = [];
      if (p.heading !== null && p.heading !== undefined) { bits.push(el("span", null, ["heading ", el("b", { text: norm(p.heading) + "° " + point16(p.heading) })])); }
      if (p.pitch !== null && p.pitch !== undefined) { bits.push(el("span", null, ["pitch ", el("b", { text: signedDeg(p.pitch) })])); }
      if (p.fov) { bits.push(el("span", null, ["field of view ", el("b", { text: p.fov + "°" })])); }
      var moved = (fr.calls || []).some(function (c) { return /^move_/.test(c); });
      if (moved) { bits.push(el("span", null, el("b", { text: "moved to an adjacent panorama" }))); }
      U.append(pose, bits);
    }
    pose.hidden = !pose.firstChild;

    clear(clueNotes);
    if (fr.notes && fr.notes.length) {
      clueNotes.appendChild(el("span", { class: "lab", text: "Clues in view:" }));
      fr.notes.forEach(function (nt) {
        clueNotes.appendChild(el("span", { class: "k " + (nt.kind === "natural" ? "k--natural" : "k--human"), text: nt.text + (nt.kind === "natural" ? " (natural)" : " (human-made)") }));
      });
    }
    caption.textContent = fr.caption || "";

    /* Keep keyboard focus on a usable control when the focused button becomes disabled. */
    var focused = document.activeElement;
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === n - 1;
    if (focused === prevBtn && prevBtn.disabled) { (nextBtn.disabled ? stage : nextBtn).focus(); }
    else if (focused === nextBtn && nextBtn.disabled) { (prevBtn.disabled ? stage : prevBtn).focus(); }
    range.max = String(n);
    range.value = String(i + 1);
    range.setAttribute("aria-valuetext", "View " + (i + 1) + " of " + n);
    U.$all("button", logList).forEach(function (b, j) {
      if (j === i) {
        b.setAttribute("aria-current", "step");
        var top = b.offsetTop - logList.offsetTop;
        if (top < logList.scrollTop || top + b.offsetHeight > logList.scrollTop + logList.clientHeight) { logList.scrollTop = Math.max(0, top - 8); }
      } else { b.removeAttribute("aria-current"); }
    });
    renderAnswer();
    live.textContent = "View " + (i + 1) + " of " + n + ". " + callsText + "." + (fr.notes && fr.notes.length ? " Clues: " + fr.notes.map(function (x) { return x.text; }).join(", ") + "." : "");
    paintPlay();
  }

  /* The selected tab is the one whose example is on view, else the tab of the episode's task (a
     replay); the panel takes its name from that tab and a pressed chip. */
  function paintSelector() {
    var e = ep(), on = tabFor(state.e);
    usable.forEach(function (t) { if (!on && t.task === e.task) { on = t; } });
    var tabStop = on || usable[0] || null;
    tabs.forEach(function (t) {
      t.el.setAttribute("aria-selected", t === on ? "true" : "false");
      t.el.tabIndex = t === tabStop ? 0 : -1;
    });
    var names = on ? [on.name] : [];
    chips.forEach(function (c, j) {
      var pressed = extras[j] === state.e;
      c.setAttribute("aria-pressed", pressed ? "true" : "false");
      if (pressed) { names.push(c.id); }
    });
    if (names.length) { panel.setAttribute("aria-labelledby", names.join(" ")); } else { panel.removeAttribute("aria-labelledby"); }
    panel.setAttribute("data-episode", e.id);
  }

  function renderEpisode() {
    var e = ep();
    paintSelector();
    var f0 = e.frames[0];
    frameBox.style.aspectRatio = f0.w + " / " + f0.h;
    frameBox.classList.toggle("frame--square", f0.w === f0.h);
    state.full = false;
    renderQuestion();
    renderLog();
    /* Provenance: a short "Label: statement" from the data gets its label in bold; any other
       wording gets a bold label by kind. */
    clear(provenance);
    var prov = e.provenance || "";
    var pm = /^([^:.]{2,40}):\s+(.+)$/.exec(prov);
    var head = pm ? pm[1] + ":" : (e.kind === "replay" ? "Replay." : "Illustrative episode.");
    provenance.appendChild(el("b", { text: head + " " }));
    provenance.appendChild(document.createTextNode(pm ? pm[2] : prov));
    clear(downloads);
    var V = G.videos && G.videos[e.id];
    if (V && V.mp4) {
      downloads.appendChild(el("a", { href: V.mp4, download: "", text: "Download this episode as MP4" + (V.duration ? " (" + U.clock(V.duration) + ")" : "") }));
    }
    downloads.hidden = !downloads.firstChild;
    /* Rows that no view of this episode uses are hidden, so they leave no gap; rows that some
       views use keep their height, so the controls do not jump while stepping. */
    clueNotes.hidden = !e.frames.some(function (fr) { return fr.notes && fr.notes.length; });
    caption.hidden = !e.frames.some(function (fr) { return !!fr.caption; });
    preload();
    renderFrame();
  }
  /* Preload the current episode's frames so stepping is instant, but only once the viewer is
     near the screen (the page opens on the hero). */
  var near = !("IntersectionObserver" in window);
  function preload() {
    if (!near) { return; }
    ep().frames.forEach(function (fr) { var im = new Image(); im.src = fr.src; });
  }
  if (!near) {
    var nearObs = new IntersectionObserver(function (entries) {
      if (entries.some(function (en) { return en.isIntersecting; })) {
        near = true;
        nearObs.disconnect();
        preload();
      }
    }, { rootMargin: "600px 0px" });
    nearObs.observe(host);
  }

  /* ---------- Navigation and playback ---------- */
  function go(i, user) {
    var n = ep().frames.length;
    state.f = Math.max(0, Math.min(n - 1, i));
    if (user) { stop(); }
    renderFrame();
  }
  function selectEpisode(i, user) {
    if (user) { stop(); }
    state.e = i;
    state.f = 0;
    renderEpisode();
  }
  function paintPlay() {
    playBtn.innerHTML = (state.playing ? ICON_PAUSE : ICON_PLAY) + "<span>" + (state.playing ? "Pause" : "Play") + "</span>";
    playBtn.setAttribute("aria-label", state.playing ? "Pause" : "Play the views in order");
    /* Announce views only while the viewer drives them, not each one during playback. */
    live.setAttribute("aria-live", state.playing ? "off" : "polite");
  }
  function stop() {
    state.playing = false;
    if (state.timer) { window.clearInterval(state.timer); state.timer = 0; }
    paintPlay();
  }
  function play() {
    var n = ep().frames.length;
    if (state.f >= n - 1) { state.f = 0; renderFrame(); }
    state.playing = true;
    paintPlay();
    var delay = ep().frames.length > 8 ? 1700 : 2400;
    state.timer = window.setInterval(function () {
      if (state.f >= ep().frames.length - 1) { stop(); return; }
      state.f += 1;
      renderFrame();
      if (state.f >= ep().frames.length - 1) { stop(); }
    }, delay);
  }
  prevBtn.addEventListener("click", function () { go(state.f - 1, true); });
  nextBtn.addEventListener("click", function () { go(state.f + 1, true); });
  playBtn.addEventListener("click", function () { if (state.playing) { stop(); } else { play(); } });
  range.addEventListener("input", function () { go(parseInt(range.value, 10) - 1, true); });
  stage.addEventListener("keydown", function (e) {
    if (e.target === range) { return; }
    var k = e.key;
    if (k === "ArrowRight") { e.preventDefault(); go(state.f + 1, true); }
    else if (k === "ArrowLeft") { e.preventDefault(); go(state.f - 1, true); }
    else if (k === "Home") { e.preventDefault(); go(0, true); }
    else if (k === "End") { e.preventDefault(); go(ep().frames.length - 1, true); }
    else if ((k === " " || k === "Spacebar") && e.target === stage) { e.preventDefault(); if (state.playing) { stop(); } else { play(); } }
  });
  /* Tabs: a click or a key selects (automatic activation); the selected tab's own example is not reloaded,
     so it keeps its view. The arrow keys wrap and skip a tab without an example. */
  function pickTab(t, focus) {
    if (t.ep >= 0 && t.ep !== state.e) { selectEpisode(t.ep, true); }
    if (focus) { t.el.focus(); }
  }
  tabs.forEach(function (t) {
    t.el.addEventListener("click", function () { pickTab(t, false); });
    t.el.addEventListener("keydown", function (ev) {
      var k = usable.indexOf(t), n = usable.length, j = null;
      if (k < 0) { return; }
      if (ev.key === "ArrowRight") { j = (k + 1) % n; }
      else if (ev.key === "ArrowLeft") { j = (k - 1 + n) % n; }
      else if (ev.key === "Home") { j = 0; }
      else if (ev.key === "End") { j = n - 1; }
      if (j !== null) { ev.preventDefault(); pickTab(usable[j], true); }
    });
  });
  /* The hero's chapter links (without the video) open an episode here; focus stays where it is. */
  document.addEventListener("geobench:open-episode", function (ev) {
    var id = ev.detail && ev.detail.id;
    for (var i = 0; i < EPS.length; i++) { if (EPS[i].id === id) { selectEpisode(i, true); return; } }
  });
  U.onResize(function () { renderTape(frame().pose); });

  /* Start on the tab the page marks selected. */
  usable.forEach(function (t) { if (t.el.getAttribute("aria-selected") === "true") { state.e = t.ep; } });
  if (!tabFor(state.e) && usable.length) { state.e = usable[0].ep; }
  renderEpisode();
})();
