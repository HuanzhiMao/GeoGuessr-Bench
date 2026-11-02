/* GeoGuesser Bench real-trace console: types each logged tool call of a trace from a
   logged evaluation run (GEOBENCH.traces), then prints the final answer and the outcome.
   Pauses while the log is hovered or focused; with reduced motion the trace renders statically. */
(function () {
  "use strict";
  var U = window.GBP;
  if (!U) { return; }
  var el = U.el, clear = U.clear;
  var host = document.getElementById("traces");
  if (!host) { return; }
  var TR = (U.G.traces || []).filter(function (t) { return t && t.steps; });
  if (!TR.length) {
    host.appendChild(U.dataError("assets/data/traces.js"));
    return;
  }
  var reduce = U.reducedMotion();

  var BOILER = /^You are an agent competing in the GeoGuesser tournament\.\s*You are currently at a random start location\.\s*You have access to navigation tools to change your view\.\s*/;
  function shortQuestion(q) {
    var s = (q || "").replace(BOILER, "");
    var cut = s.indexOf("\n\n");
    return (cut > 0 ? s.slice(0, cut) : s).trim();
  }
  function taskName(t) {
    var base = U.TASK_LABEL[t.task] || t.task;
    return t.split ? base + " (" + U.TASK_LABEL[t.split] + ")" : base;
  }
  function outcomeTag(t) {
    var o = t.outcome || {};
    if (o.score !== undefined) { return U.fixed(o.score, 1) + " pts"; }
    if (t.ended === "step_limit") { return "step limit"; }
    if (t.ended === "abstain") { return "abstained"; }
    if (t.ended === "error") { return "error"; }
    return o.correct ? "correct" : "incorrect";
  }
  /* Coordinates from real traces are shown rounded to 0.1 degree (the data already is). */
  var COORD = /-?\d{1,3}\.\d{2,}/g;
  function roundCoords(s) { return s.replace(COORD, function (m) { return U.fixed(Math.round(parseFloat(m) * 10) / 10, 1); }); }
  /* A step is one model response (as on the rest of the page and in the paper's step counts):
     each tool-calling response, plus the final reply. */
  function nSteps(t) { return t.steps.length + (t.final ? 1 : 0); }
  function pad(n, w) { var s = String(n); while (s.length < w) { s = "0" + s; } return s; }

  /* ---------- Build the line script for one trace ---------- */
  function script(t) {
    var long = t.steps.length > 15;
    var T = { ch: long ? 5 : 15, res: long ? 50 : 150, gap: long ? 25 : 90 };
    var lines = [];
    var w = String(t.steps.length).length < 2 ? 2 : String(t.steps.length).length;
    lines.push({ segs: [{ text: "user", cls: "t-label t-key" }, { text: shortQuestion(t.question), cls: "t-strong" }], after: 320 });
    var first = true;
    t.steps.forEach(function (st, i) {
      (st.calls || []).forEach(function (call, j) {
        var res = st.results && st.results[j] !== undefined ? st.results[j] : "";
        var bad = /^error/i.test(res);
        var segs = [
          { text: (j === 0 ? pad(i + 1, w) : new Array(w + 1).join(" ")) + "  ", cls: "t-dim", step: j === 0 ? i + 1 : null },
          { text: call, cls: "t-call", typed: true, pause: T.res },
          { text: "  → " + (res || "(no result)"), cls: bad ? "t-bad" : (res === "view" ? "t-ok" : "t-dim") }
        ];
        lines.push({ cls: first ? "tl--gap" : null, segs: segs, after: T.gap });
        first = false;
      });
    });
    var isT1 = t.task === "precise_localization";
    var gapDone = false;
    function push(l) { if (!gapDone) { l.cls = "tl--gap"; gapDone = true; } lines.push(l); }
    if (t.final) {
      var ans = isT1 ? roundCoords(t.final.answer || "") : (t.final.answer || "");
      push({ segs: [{ text: "answer", cls: "t-label t-key", step: nSteps(t) }, { text: ans, cls: "t-strong" }].concat(isT1 ? [{ text: "   # coordinates rounded to 0.1°", cls: "t-dim" }] : []), after: 260 });
      if (t.final.context) {
        lines.push({ segs: [{ text: "context", cls: "t-label t-key" }, { text: isT1 ? roundCoords(t.final.context) : t.final.context, cls: "t-call" }], after: 260 });
      }
    } else if (t.ended === "step_limit") {
      push({ segs: [{ text: "# the harness stopped the episode at the step limit; the agent gave no answer", cls: "t-dim" }], after: 260 });
    } else if (t.ended === "error") {
      push({ segs: [{ text: "# the episode ended in an error", cls: "t-bad" }], after: 260 });
    }
    var o = t.outcome || {}, txt, cls;
    if (o.score !== undefined) {
      /* The score and distance are those logged for the full-precision reply; the answer above is rounded. */
      txt = U.fixed(o.score, 1) + " points · " + U.fixed(o.km, 1) + " km from the start (scored on the unrounded answer)";
      cls = "t-ok";
    } else if (o.correct) {
      txt = "correct";
      cls = "t-ok";
    } else {
      txt = "incorrect" + (t.ended === "step_limit" ? " · ended at the step limit without an answer" : (t.ended === "abstain" ? " · abstained" : ""));
      cls = "t-bad";
    }
    lines.push({ segs: [{ text: "result", cls: "t-label t-key" }, { text: txt, cls: cls }], after: 0 });
    return { lines: lines, T: T };
  }

  /* ---------- Skeleton ---------- */
  var chipBox = el("div", { class: "chips", role: "group", "aria-label": "Traces" });
  var chips = TR.map(function (t, i) {
    var b = el("button", { class: "chip", type: "button", "aria-pressed": "false", onclick: function () { choose(i); } }, [
      el("span", { class: "chip__sw", style: { "--c": U.TASK_COLOR[t.task] || "var(--muted)" }, "aria-hidden": "true" }),
      el("span", { class: "chip__main" }, [el("span", { text: t.model }), el("span", { class: "chip__sub", text: U.TASK_LABEL[t.task] || t.task })]),
      el("span", { class: "chip__tag", text: outcomeTag(t) })
    ]);
    chipBox.appendChild(b);
    return b;
  });
  var title = el("span", { class: "term__title" });
  var status = el("span", { class: "term__status" });
  var ctlBtn = el("button", { class: "term__btn", type: "button" });
  var body = el("div", { class: "term__body", tabindex: "0", role: "log", "aria-live": "off", "aria-label": "Logged tool calls" });
  var term = el("div", { class: "term" }, [el("div", { class: "term__bar" }, [title, status, ctlBtn]), body]);
  var note = el("p", { class: "note" });
  host.appendChild(chipBox);
  host.appendChild(term);
  host.appendChild(note);

  var ICON_PAUSE = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2h2.4v8H2.5zM7.1 2h2.4v8H7.1z" fill="currentColor"/></svg>';
  var ICON_PLAY = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>';
  var ICON_REPLAY = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 6a3.8 3.8 0 1 0 1.1-2.7M2 1.6v2.2h2.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ---------- Engine ---------- */
  var S = { i: 0, plan: null, li: 0, si: 0, ch: 0, line: null, segNode: null, timer: 0, running: false, done: true,
            hold: false, wait: false, userPaused: false, auto: !reduce, started: false, step: 0 };
  var cursor = el("span", { class: "t-cursor", "aria-hidden": "true" });

  function setStatus() {
    var t = TR[S.i];
    status.textContent = S.done ? nSteps(t) + " steps" : "step " + S.step + " / " + nSteps(t);
  }
  function paintCtl() {
    if (reduce) { ctlBtn.hidden = true; return; }
    var label, icon;
    if (S.done) { label = "Replay"; icon = ICON_REPLAY; }
    else if (S.userPaused) { label = "Play"; icon = ICON_PLAY; }
    else { label = "Pause"; icon = ICON_PAUSE; }
    ctlBtn.innerHTML = icon + "<span>" + label + "</span>";
    ctlBtn.setAttribute("aria-label", label + " the trace");
  }
  function header(t) {
    title.textContent = t.model + " · " + taskName(t);
    chips.forEach(function (c, j) { c.setAttribute("aria-pressed", j === S.i ? "true" : "false"); });
    var bits = [];
    if (t.note) { bits.push(t.note); }
    bits.push("Each line is a logged tool call and its status; “view” marks an image the logs didn’t keep.");
    note.textContent = bits.join(" ");
  }
  function lineNode(l) {
    var n = el("div", { class: "tl" + (l.cls ? " " + l.cls : "") });
    body.appendChild(n);
    return n;
  }
  function renderStatic() {
    stopTimer();
    var t = TR[S.i];
    S.plan = script(t);
    clear(body);
    S.plan.lines.forEach(function (l) {
      var n = lineNode(l);
      l.segs.forEach(function (sg) { n.appendChild(el("span", { class: sg.cls || null, text: sg.text })); });
    });
    S.done = true;
    S.running = false;
    header(t);
    setStatus();
    paintCtl();
  }
  function stopTimer() { if (S.timer) { window.clearTimeout(S.timer); S.timer = 0; } }
  function schedule(ms) { stopTimer(); S.timer = window.setTimeout(tick, ms); }
  function nearBottom() { return body.scrollHeight - body.scrollTop - body.clientHeight < 48; }
  function start(i) {
    stopTimer();
    S.i = i;
    var t = TR[i];
    S.plan = script(t);
    S.li = 0; S.si = 0; S.ch = 0; S.line = null; S.segNode = null; S.step = 0;
    S.done = false; S.running = true; S.userPaused = false;
    clear(body);
    body.scrollTop = 0;
    header(t);
    setStatus();
    paintCtl();
    schedule(200);
  }
  function finish() {
    S.done = true;
    S.running = false;
    if (cursor.parentNode) { cursor.parentNode.removeChild(cursor); }
    setStatus();
    paintCtl();
    if (S.auto && TR.length > 1) { queueNext(); }
  }
  function tick() {
    S.timer = 0;
    if (S.hold || S.userPaused || S.done) { return; }
    var stick = nearBottom();
    var lines = S.plan.lines;
    var l = lines[S.li];
    if (!l) { finish(); return; }
    if (!S.line) { S.line = lineNode(l); S.si = 0; S.ch = 0; S.segNode = null; }
    var sg = l.segs[S.si];
    if (!sg) {
      S.li += 1;
      S.line = null;
      if (stick) { body.scrollTop = body.scrollHeight; }
      schedule(l.after || 0);
      return;
    }
    if (!S.segNode) {
      S.segNode = el("span", { class: sg.cls || null });
      S.line.appendChild(S.segNode);
      if (sg.step) { S.step = sg.step; setStatus(); }
    }
    if (sg.typed) {
      S.ch += 1;
      S.segNode.textContent = sg.text.slice(0, S.ch);
      S.line.appendChild(cursor);
      if (S.ch < sg.text.length) {
        if (stick) { body.scrollTop = body.scrollHeight; }
        schedule(S.plan.T.ch);
        return;
      }
    } else {
      S.segNode.textContent = sg.text;
    }
    if (cursor.parentNode) { cursor.parentNode.removeChild(cursor); }
    S.si += 1;
    S.segNode = null;
    S.ch = 0;
    if (stick) { body.scrollTop = body.scrollHeight; }
    schedule(sg.pause || 0);
  }
  /* Auto-advance has its own timer so that hovering can defer it without losing it. */
  function queueNext() {
    if (S.nextTimer) { window.clearTimeout(S.nextTimer); }
    S.nextTimer = window.setTimeout(function () {
      S.nextTimer = 0;
      if (!S.auto) { return; }
      if (S.wait) { S.pendingNext = true; return; }
      start((S.i + 1) % TR.length);
    }, 4200);
  }
  function cancelNext() { if (S.nextTimer) { window.clearTimeout(S.nextTimer); S.nextTimer = 0; } S.pendingNext = false; }
  function resume() {
    if (S.done || S.userPaused || S.hold) { return; }
    if (!S.timer) { schedule(60); }
  }

  /* ---------- Interaction ---------- */
  function choose(i) {
    S.auto = false;
    cancelNext();
    if (reduce) { S.i = i; renderStatic(); return; }
    start(i);
  }
  /* The button always acts, even while a reading hold is still set (the pointer resting on the log). */
  ctlBtn.addEventListener("click", function () {
    S.auto = false;
    S.hold = false;
    cancelNext();
    if (S.done) { start(S.i); return; }
    S.userPaused = !S.userPaused;
    paintCtl();
    if (!S.userPaused) { resume(); } else { stopTimer(); }
  });
  /* Hovering or focusing the log holds the typing so it can be read. The control bar does not,
     so focus left on its button never holds it. The auto-advance waits while the pointer or
     focus is anywhere on the console, so it never swaps the trace under the button. */
  function holdOn() {
    S.hold = true;
    stopTimer();
  }
  function holdOff() {
    S.hold = false;
    resume();
  }
  function waitOn() {
    S.wait = true;
    if (S.nextTimer) { window.clearTimeout(S.nextTimer); S.nextTimer = 0; S.pendingNext = true; }
  }
  function waitOff() {
    S.wait = false;
    if (S.pendingNext && S.auto) { S.pendingNext = false; start((S.i + 1) % TR.length); }
  }
  /* Calls enter when the pointer or focus arrives on node, and leave once both have gone. */
  function presence(node, enter, leave) {
    node.addEventListener("mouseenter", enter);
    node.addEventListener("mouseleave", function () { if (!node.contains(document.activeElement)) { leave(); } });
    node.addEventListener("focusin", enter);
    node.addEventListener("focusout", function (e) { if (!node.contains(e.relatedTarget) && !node.matches(":hover")) { leave(); } });
  }
  presence(body, holdOn, holdOff);
  presence(term, waitOn, waitOff);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { holdOn(); waitOn(); } else { holdOff(); waitOff(); }
  });

  /* At rest the first trace is complete; the typing starts the first time the console is on screen. */
  S.i = 0;
  renderStatic();
  if (!reduce && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && !S.started) {
          S.started = true;
          if (S.auto) { start(S.i); }
        }
      });
    }, { threshold: 0.35 });
    io.observe(term);
  }
})();
