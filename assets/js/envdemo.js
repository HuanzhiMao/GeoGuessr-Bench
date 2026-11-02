/* GeoGuesser Bench environment demo (Demo section, #environment). Plays the offline environment's
   scripted API test (GEOBENCH.episodes, kind "env_tour") step by step, like a GIF, while it is on
   screen. Each view carries the tool calls that produced it as code chips; the pad of camera tools
   lights the tools of the current step, and a used tool jumps to the next step that uses it. The
   test's two moves show as call chips only: the move tools have their own demo on a schematic map
   under this one (movedemo.js), which playback never moves: the caption line keeps the height of the
   longest caption. No auto-advance under reduced motion; playback pauses off screen and
   in a hidden tab. The test logged no camera poses and its place is withheld, so nothing here shows
   headings, angles, a place name or coordinates. */
(function () {
  "use strict";
  var U = window.GBP;
  if (!U) { return; }
  var el = U.el, clear = U.clear;
  var host = document.getElementById("envdemo");
  if (!host) { return; }
  var EP = U.episodeById("env-walkthrough");
  if (!EP || EP.kind !== "env_tour") {
    EP = U.allEpisodes().filter(function (e) { return e && e.kind === "env_tour"; })[0] || null;
  }
  var FR = EP && EP.frames ? EP.frames.filter(function (f) { return f && f.src; }) : [];
  if (!FR.length) {
    host.appendChild(U.dataError("assets/data/episodes.js"));
    return;
  }
  var N = FR.length;
  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function motionOK() { return !(mq && mq.matches); }

  /* Timing: one view per DWELL ms, a longer hold on the last view before the loop restarts. */
  var DWELL = 2000, LAST_DWELL = 3200, FX_MS = 420;

  /* ---------- Tools and the steps that use them ---------- */
  function toolOf(call) { return String(call).replace(/\(.*$/, "").trim(); }
  function toolsAt(i) { return (FR[i].calls || []).map(toolOf); }
  var uses = {};
  FR.forEach(function (fr, i) {
    toolsAt(i).forEach(function (t) {
      uses[t] = uses[t] || [];
      if (uses[t].indexOf(i) < 0) { uses[t].push(i); }
    });
  });
  function isMove(t) { return /^move_/.test(t); }

  function list(nums) {
    var s = nums.map(function (n) { return String(n + 1); });
    return s.length < 2 ? s.join("") : s.slice(0, -1).join(", ") + " and " + s[s.length - 1];
  }
  /* "scroll_right" with a break opportunity after the underscore, for narrow screens. */
  function nameNodes(name) {
    var cut = name.indexOf("_");
    return cut < 0 ? [name] : [name.slice(0, cut + 1), el("wbr"), name.slice(cut + 1)];
  }
  var toolEls = {};
  /* The label sits in one span: in a flex button, Firefox makes each text run its own item and never wraps it. */
  function tool(name) {
    var steps = uses[name];
    var node;
    if (steps && steps.length) {
      node = el("button", {
        class: "envtool", type: "button", "data-tool": name,
        "aria-label": name + ", used at step" + (steps.length > 1 ? "s " : " ") + list(steps),
        onclick: function () { go(nextUse(name), true); }
      }, el("span", null, nameNodes(name)));
    } else {
      /* A tool the test never uses is a label, not a button. The shipped test uses all seven camera tools, so this
         is a fallback for other walkthrough data (qa_page.py checks that only the used tools are buttons). */
      node = el("span", { class: "envtool is-unused", "data-tool": name, title: "Not used in this test" },
        [el("span", null, nameNodes(name)), el("span", { class: "sr-only", text: " (not used in this test)" })]);
    }
    toolEls[name] = node;
    return node;
  }
  function nextUse(name) {
    var s = uses[name] || [];
    for (var k = 0; k < s.length; k++) { if (s[k] > state.want) { return s[k]; } }
    return s.length ? s[0] : state.want;
  }

  /* ---------- Player ---------- */
  function mkImg() { return el("img", { alt: "", decoding: "async", hidden: true }); }
  var imgA = mkImg(), imgB = mkImg();
  imgA.hidden = false;
  imgA.className = "is-front";
  var callBox = el("div", { class: "envframe__calls", "aria-hidden": "true" });
  var flash = el("span", { class: "envframe__flash", "aria-hidden": "true" });
  var frame = el("div", { class: "envframe" }, [imgA, imgB, flash, callBox]);
  var caption = el("p", { class: "envmeta__cap" });
  /* Every step's caption, hidden, in the current one's cell: the line is always as tall as the longest caption,
     so it keeps one height as the test plays and the move demo under it never moves (nor its keys from under a
     resting pointer). */
  var caps = el("div", { class: "envmeta__caps" }, [caption].concat(FR.map(function (fr, i) {
    return el("span", { class: "envmeta__sizer", "aria-hidden": "true", text: captionText(i) });
  })));
  var credit = el("p", { class: "envmeta__credit", text: EP.attribution || "Imagery: Google Street View" });
  var ICON_PREV = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2.5 4.5 7 9 11.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_NEXT = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M5 2.5 9.5 7 5 11.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_PLAY = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M4 2.2v9.6L11.6 7z" fill="currentColor"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 2.5h2.6v9H3.5zM7.9 2.5h2.6v9H7.9z" fill="currentColor"/></svg>';
  var prevBtn = el("button", { class: "ctrl", type: "button", "aria-label": "Previous step" });
  prevBtn.innerHTML = ICON_PREV;
  var nextBtn = el("button", { class: "ctrl", type: "button", "aria-label": "Next step" });
  nextBtn.innerHTML = ICON_NEXT;
  var playBtn = el("button", { class: "ctrl ctrl--primary envplay", type: "button" });
  /* One segment per step; mouse shortcuts only (the arrow keys, Previous and Next reach every step). */
  var segs = FR.map(function (fr, i) {
    return el("button", { type: "button", tabindex: "-1", "aria-label": "Step " + (i + 1), onclick: function () { go(i, true); } }, el("i"));
  });
  var steps = el("div", { class: "envsteps" }, segs);
  var count = el("span", { class: "envcount", "aria-hidden": "true" });
  var controls = el("div", { class: "envcontrols" }, [prevBtn, playBtn, nextBtn, steps, count]);
  var live = el("p", { class: "sr-only", "aria-live": "polite" });
  var player = el("div", { class: "envplayer", tabindex: "0", role: "group",
    "aria-label": "Environment demo, " + N + " steps. Use the left and right arrow keys to step through it." },
    [frame, el("div", { class: "envmeta" }, [caps, credit]), controls, live]);

  /* ---------- Tool pad: the camera tools (the move tools are on the map below, movedemo.js) ---------- */
  var dpad = el("div", { class: "envdpad" }, [
    tool("scroll_up"), tool("scroll_left"), tool("capture_view"), tool("scroll_right"), tool("scroll_down")
  ]);
  var zoom = el("div", { class: "envzoom" }, [tool("zoom_in"), tool("zoom_out")]);
  var pad = el("div", { class: "envpad", role: "group", "aria-label": "Camera tools" }, [
    el("p", { class: "label", text: "Camera tools · select one to jump to it" }),
    el("div", { class: "envcam" }, [dpad, zoom])
  ]);

  host.appendChild(player);
  host.appendChild(pad);

  /* ---------- Rendering ---------- */
  /* i: the step on screen; want: the step last asked for (it differs while a frame decodes). */
  var state = { i: 0, want: 0, playing: motionOK(), visible: false, timer: 0, token: 0, front: imgA, back: imgB };
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function captionText(i) {
    var c = String(FR[i].caption || "").replace(/^Step\s+\d+\s*:\s*/i, "");
    return c ? c.charAt(0).toUpperCase() + c.slice(1) : "";
  }
  function callsText(i) { var c = FR[i].calls || []; return c.length ? c.join(", ") : "start view"; }
  function altText(i) {
    var c = FR[i].calls || [];
    return "Street View rendering at step " + (i + 1) + " of " + N + (c.length ? ", after " + c.join(" and ") : ", the start view") + ".";
  }
  function restart(node, cls) {
    node.classList.remove(cls);
    void node.getBoundingClientRect();
    node.classList.add(cls);
  }

  function render(arrived) {
    var i = state.i, fr = FR[i], tools = toolsAt(i);
    clear(callBox);
    if (fr.calls && fr.calls.length) { fr.calls.forEach(function (c) { callBox.appendChild(el("code", { text: c })); }); }
    else { callBox.appendChild(el("span", { class: "is-start", text: "start view" })); }
    caption.textContent = captionText(i);
    segs.forEach(function (s, j) {
      s.classList.toggle("is-done", j < i);
      s.classList.toggle("is-now", j === i);
      if (j === i) { s.setAttribute("aria-current", "step"); } else { s.removeAttribute("aria-current"); }
    });
    count.textContent = pad2(i + 1) + " / " + pad2(N);
    Object.keys(toolEls).forEach(function (t) { toolEls[t].classList.toggle("is-lit", tools.indexOf(t) >= 0); });
    if (arrived && motionOK() && tools.indexOf("capture_view") >= 0) { restart(flash, "is-on"); }
    /* aria-disabled, not disabled: the buttons keep focus while autoplay reaches either end. */
    prevBtn.setAttribute("aria-disabled", i === 0 ? "true" : "false");
    nextBtn.setAttribute("aria-disabled", i === N - 1 ? "true" : "false");
    if (arrived) {
      var cap = captionText(i);
      live.textContent = "Step " + (i + 1) + " of " + N + ". " + callsText(i) + "." + (cap ? " " + cap + "." : "");
    }
  }

  /* The motion cue for arriving at view i from view `from`: the direction the scene moves for a turn
     or a tilt, a scale for a zoom, a crossfade for a move or a jump, none for a capture. */
  function effect(from, i) {
    if (!motionOK() || from === i) { return ""; }
    if (i !== from + 1) { return "fade"; }
    var t = toolsAt(i);
    if (t.some(isMove)) { return "fade"; }
    if (t.indexOf("scroll_right") >= 0) { return "right"; }
    if (t.indexOf("scroll_left") >= 0) { return "left"; }
    if (t.indexOf("scroll_up") >= 0) { return "up"; }
    if (t.indexOf("scroll_down") >= 0) { return "down"; }
    if (t.indexOf("zoom_in") >= 0) { return "zin"; }
    if (t.indexOf("zoom_out") >= 0) { return "zout"; }
    return "";
  }

  function show(i, fx) {
    var my = ++state.token;
    state.want = i;
    clearTimer();
    var fr = FR[i];
    var incoming = state.back, outgoing = state.front;
    /* The front image may still be fading in over the back one, which is hidden and re-pointed now: end the fade first. */
    outgoing.className = "is-front";
    incoming.hidden = true;
    incoming.className = "";
    incoming.width = fr.w;
    incoming.height = fr.h;
    incoming.alt = altText(i);
    incoming.src = fr.src;
    var ready = incoming.decode ? incoming.decode() : Promise.resolve();
    ready.then(null, function () { /* show it anyway */ }).then(function () {
      if (my !== state.token) { return; }
      incoming.hidden = false;
      incoming.className = "is-front" + (fx ? " fx-" + fx : "");
      outgoing.className = "is-under";
      state.front = incoming;
      state.back = outgoing;
      window.setTimeout(function () {
        if (my === state.token && state.back === outgoing) { outgoing.hidden = true; outgoing.className = ""; }
      }, fx ? FX_MS : 0);
      state.i = i;
      render(true);
      schedule();
    });
  }

  /* ---------- Playback ---------- */
  function clearTimer() { if (state.timer) { window.clearTimeout(state.timer); state.timer = 0; } }
  function running() { return state.playing && state.visible && !document.hidden && loaded; }
  function schedule() {
    clearTimer();
    var wait = state.i === N - 1 ? LAST_DWELL : DWELL;
    host.style.setProperty("--dwell", wait + "ms");
    host.classList.toggle("is-playing", running());
    if (!running()) { return; }
    state.timer = window.setTimeout(function () {
      state.timer = 0;
      var from = state.i, to = (state.i + 1) % N;
      show(to, to === 0 ? (motionOK() ? "fade" : "") : effect(from, to));
    }, wait);
  }
  function paintPlay() {
    playBtn.innerHTML = (state.playing ? ICON_PAUSE : ICON_PLAY) + "<span>" + (state.playing ? "Pause" : "Play") + "</span>";
    /* Announce steps only while the viewer drives them, not every two seconds during playback. */
    live.setAttribute("aria-live", state.playing ? "off" : "polite");
  }
  function setPlaying(p) {
    state.playing = !!p;
    paintPlay();
    schedule();
  }
  function go(i, user) {
    i = Math.max(0, Math.min(N - 1, i));
    if (user) { setPlaying(false); }
    show(i, effect(state.i, i));
  }

  prevBtn.addEventListener("click", function () { if (prevBtn.getAttribute("aria-disabled") !== "true") { go(state.want - 1, true); } });
  nextBtn.addEventListener("click", function () { if (nextBtn.getAttribute("aria-disabled") !== "true") { go(state.want + 1, true); } });
  playBtn.addEventListener("click", function () { setPlaying(!state.playing); });
  player.addEventListener("keydown", function (e) {
    var k = e.key;
    if (k === "ArrowRight") { e.preventDefault(); go(state.want + 1, true); }
    else if (k === "ArrowLeft") { e.preventDefault(); go(state.want - 1, true); }
    else if (k === "Home") { e.preventDefault(); go(0, true); }
    else if (k === "End") { e.preventDefault(); go(N - 1, true); }
    else if ((k === " " || k === "Spacebar") && e.target === player) { e.preventDefault(); setPlaying(!state.playing); }
  });
  document.addEventListener("visibilitychange", schedule);
  if (mq) {
    var onMotion = function () { if (mq.matches && state.playing) { setPlaying(false); } };
    if (mq.addEventListener) { mq.addEventListener("change", onMotion); } else if (mq.addListener) { mq.addListener(onMotion); }
  }

  /* Load the first view once the demo is near the screen (the page opens on the hero), then
     warm the cache for the rest so playback never waits; play only while it is in view. */
  var requested = false, loaded = false;
  function load() {
    if (requested) { return; }
    requested = true;
    imgA.width = FR[0].w;
    imgA.height = FR[0].h;
    imgA.alt = altText(0);
    imgA.src = FR[0].src;
    FR.forEach(function (fr) { var im = new Image(); im.src = fr.src; });
    /* Playback starts once the first view is on screen. */
    var first = imgA.decode ? imgA.decode() : Promise.resolve();
    function ready() { loaded = true; schedule(); }
    first.then(ready, ready);
  }
  if ("IntersectionObserver" in window) {
    var nearObs = new IntersectionObserver(function (entries) {
      if (entries.some(function (en) { return en.isIntersecting; })) { nearObs.disconnect(); load(); }
    }, { rootMargin: "600px 0px" });
    nearObs.observe(host);
    new IntersectionObserver(function (entries) {
      var v = entries[entries.length - 1].intersectionRatio >= 0.3;
      if (v !== state.visible) { state.visible = v; schedule(); }
    }, { threshold: [0, 0.3, 0.6, 1] }).observe(frame);
  } else {
    state.visible = true;
    load();
  }

  paintPlay();
  render(false);
})();
