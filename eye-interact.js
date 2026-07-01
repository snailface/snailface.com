// Makes the eye's pupil/iris follow the cursor or a touch point.
// Falls back to the ambient CSS "look around" animation (defined inside
// eye.svg) whenever the user isn't actively moving the mouse/finger.
//
// Requires eye.svg to be embedded via <object> (not a CSS background-image),
// since that's the only way this script can reach into its DOM.
//
// Perf note: eye.svg has ~525 individually clip-path/masked elements sharing
// the pupil/bubble/vein animation classes. Earlier versions of this script
// wrote an inline `transform` to every one of those elements on every
// animation frame (~525 style writes x 60fps), which was heavy enough to
// hang/crash some browsers. Instead, this version sets a handful of CSS
// custom properties on the SVG root each frame; a small set of CSS rules in
// eye.svg (".manual-look .pupil-part" etc.) read those via var(), so the
// browser only has to recompute style for the elements that actually match,
// and the JS side only ever touches one element per frame.
(function () {
  "use strict";

  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;

  var obj = document.querySelector(".background-image object");
  if (!obj) return;

  var MAX_X = 60;
  var MAX_Y = 45;
  var IDLE_DELAY = 2400;
  var CHASE_EASE = 0.18;
  var RELEASE_EASE = 0.12;
  var started = false;

  function init() {
    if (started) return;
    var svgDoc = obj.contentDocument;
    if (!svgDoc || !svgDoc.documentElement) return;
    var pupilPartsCheck = svgDoc.querySelectorAll(".pupil-part");
    if (!pupilPartsCheck.length) return;
    started = true;

    var root = svgDoc.documentElement;

    var current = { x: 0, y: 0 };
    var target = { x: 0, y: 0 };
    var mode = "idle"; // "idle" | "active" | "releasing"
    var idleTimer = null;
    var raf = null;

    function setVar(name, value) {
      root.style.setProperty(name, value);
    }

    function apply() {
      var nx = current.x / MAX_X;
      var ny = current.y / MAX_Y;

      setVar("--lx", current.x.toFixed(1) + "px");
      setVar("--ly", current.y.toFixed(1) + "px");

      // Blue bubbles (upper-left): dodge as pupil approaches that corner.
      var bubbleAmt = Math.max(0, Math.min(1, (-nx + -ny) / 2));
      setVar("--blx", (-bubbleAmt * 18).toFixed(1) + "px");
      setVar("--bly", (-bubbleAmt * 14).toFixed(1) + "px");
      setVar("--bs", (1 - bubbleAmt * 0.1).toFixed(3));

      // White circle outlines (lower-right): dodge as pupil approaches that corner.
      var wcAmt = Math.max(0, Math.min(1, (nx + ny) / 2));
      setVar("--wlx", (wcAmt * 13).toFixed(1) + "px");
      setVar("--wly", (wcAmt * 10).toFixed(1) + "px");
      setVar("--ws", (1 - wcAmt * 0.08).toFixed(3));

      // Veins (either side): squeeze in the same left/right direction as the pupil.
      setVar("--vlx", (nx * 9).toFixed(1) + "px");
      setVar("--vs", (1 - Math.min(1, Math.abs(nx)) * 0.04).toFixed(3));
    }

    var FRAME_INTERVAL = 33; // ~30fps cap; plenty smooth for eye-tracking, half the work of 60fps
    var lastTick = 0;

    function tick(now) {
      if (now - lastTick < FRAME_INTERVAL) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastTick = now;

      if (mode === "active") {
        current.x += (target.x - current.x) * CHASE_EASE;
        current.y += (target.y - current.y) * CHASE_EASE;
        apply();
        raf = requestAnimationFrame(tick);
      } else if (mode === "releasing") {
        current.x += (0 - current.x) * RELEASE_EASE;
        current.y += (0 - current.y) * RELEASE_EASE;
        if (Math.abs(current.x) > 0.3 || Math.abs(current.y) > 0.3) {
          apply();
          raf = requestAnimationFrame(tick);
        } else {
          current.x = 0;
          current.y = 0;
          // Dropping the "manual-look" class hands control back to the
          // ambient CSS keyframes, which restart cleanly from 0% since the
          // per-element `animation` property is going from `none` back to
          // a live animation name (no per-element currentTime bookkeeping
          // needed, unlike the old inline-style approach).
          root.classList.remove("manual-look");
          mode = "idle";
          raf = null;
        }
      } else {
        raf = null;
      }
    }

    function enterActive() {
      if (mode === "idle") root.classList.add("manual-look");
      mode = "active";
      if (!raf) raf = requestAnimationFrame(tick);
    }

    function scheduleIdle() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () {
        if (mode === "active") mode = "releasing";
      }, IDLE_DELAY);
    }

    function updateFromPoint(clientX, clientY) {
      var rect = obj.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var nx = Math.max(-1, Math.min(1, (clientX - cx) / (rect.width * 0.32)));
      var ny = Math.max(-1, Math.min(1, (clientY - cy) / (rect.height * 0.32)));
      target.x = nx * MAX_X;
      target.y = ny * MAX_Y;
      enterActive();
      scheduleIdle();
    }

    window.addEventListener(
      "mousemove",
      function (e) {
        updateFromPoint(e.clientX, e.clientY);
      },
      { passive: true }
    );

    window.addEventListener(
      "touchmove",
      function (e) {
        var t = e.touches && e.touches[0];
        if (t) updateFromPoint(t.clientX, t.clientY);
      },
      { passive: true }
    );

    window.addEventListener(
      "touchstart",
      function (e) {
        var t = e.touches && e.touches[0];
        if (t) updateFromPoint(t.clientX, t.clientY);
      },
      { passive: true }
    );
  }

  obj.addEventListener("load", init);

  // Fallback: the <object>'s own load event can fire before this (deferred)
  // script attaches its listener, especially once eye.svg is cached. Poll
  // briefly until the embedded SVG is actually parseable.
  var pollAttempts = 0;
  (function poll() {
    if (started) return;
    init();
    if (started) return;
    pollAttempts++;
    if (pollAttempts > 100) return; // ~10s
    setTimeout(poll, 100);
  })();
})();
