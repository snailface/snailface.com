// Makes the eye's pupil/iris follow the cursor or a touch point.
// Falls back to the ambient CSS "look around" animation (defined inside
// eye.svg) whenever the user isn't actively moving the mouse/finger.
//
// eye.svg is fetched and injected directly into the page (inline SVG)
// rather than embedded via <object>. Testing (see Cloud Four's SVG
// icon stress test) shows <object>/<iframe> embedding of SVG has
// dramatically worse rendering performance than inline SVG, because it
// creates a whole separate nested browsing context/document. That extra
// overhead, combined with this SVG's size (~950 paths), is a likely
// contributor to reports of the page crashing on mobile Safari. Inlining
// also lets this script touch the real DOM directly instead of going
// through object.contentDocument.
//
// eye.svg's internal <style> block scopes all of its selectors under
// #eye-svg so its (deliberately short, single-letter) class names like
// .B/.C/.D can't collide with anything elsewhere on the page now that
// they live in the same document instead of an isolated one.
//
// Perf note (v5): eye.svg's ~525 pupil elements are wrapped in a handful of
// .pupil-part-group <g>s, and the shared clip-path (.B) is hoisted onto those
// groups (plus onto <g class="B"> wrappers around large static runs) instead
// of sitting on every child. That cuts per-frame animated/clipped nodes from
// ~525 to ~22 and per-paint clip evaluations from ~925 to ~46 — the previous
// structure hung/crashed mobile browsers. Earlier versions of this script
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

  var container = document.querySelector(".background-image");
  if (!container) return;

  var MAX_X = 60;
  var MAX_Y = 45;
  var IDLE_DELAY = 2400;
  var CHASE_EASE = 0.18;
  var RELEASE_EASE = 0.12;

  fetch("/eye.svg?v=18")
    .then(function (res) {
      if (!res.ok) throw new Error("eye.svg fetch failed: " + res.status);
      return res.text();
    })
    .then(function (svgText) {
      container.innerHTML = svgText;
      var root = container.querySelector("svg");
      if (!root) return;
      // Make sure the injected SVG stays decorative/non-interactive to
      // assistive tech and doesn't intercept pointer events meant for the
      // page (matches the old <object aria-hidden tabindex="-1"> setup).
      root.setAttribute("aria-hidden", "true");
      root.setAttribute("focusable", "false");
      root.style.pointerEvents = "none";

      if (!reduceMotion) initInteraction(root);
    })
    .catch(function () {
      // If the fetch fails for any reason, fail quietly: the page still
      // works, it just won't have the eye graphic or its interaction.
    });

  function initInteraction(root) {
    var current = { x: 0, y: 0 };
    var target = { x: 0, y: 0 };
    var mode = "idle"; // "idle" | "active" | "releasing"
    var idleTimer = null;
    var raf = null;

    // Browsers automatically throttle/stop requestAnimationFrame in hidden
    // tabs, but CSS keyframe animations (the ambient "look around" loop)
    // keep running by default even when the tab is backgrounded or the
    // phone is locked. On mobile that's wasted CPU/battery for an effect
    // nobody can see. eye.svg has a scoped rule
    // (#eye-svg.page-hidden * { animation-play-state: paused }) that this
    // toggles via the Page Visibility API.
    document.addEventListener("visibilitychange", function () {
      root.classList.toggle("page-hidden", document.hidden);
      if (document.hidden && raf) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    });
    // visibilitychange doesn't fire for the initial state, so a tab that
    // loads in the background would otherwise run its animations unseen.
    root.classList.toggle("page-hidden", document.hidden);

    function setVar(name, value) {
      root.style.setProperty(name, value);
    }

    // Reads the offset the ambient CSS "look around" keyframes have
    // currently landed on, so switching into manual tracking can pick up
    // from there instead of snapping to (0,0) for one frame.
    function ambientOffset() {
      var el = root.querySelector(".pupil-part-group, .pupil-part");
      if (!el) return { x: 0, y: 0 };
      var t = getComputedStyle(el).transform;
      var m = t && t.match(/^matrix(3d)?\(([^)]+)\)$/);
      if (!m) return { x: 0, y: 0 };
      var v = m[2].split(",").map(Number);
      return m[1] ? { x: v[12] || 0, y: v[13] || 0 } : { x: v[4] || 0, y: v[5] || 0 };
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

      // Eyelid assembly (pink rim + veins + green scaly lid): one shared
      // offset so the rim can never pull away from the lid and reveal a
      // white gap between them. Amplitude stays under the black ink
      // linework's width so nothing visibly detaches from its outlines.
      setVar("--vlx", (nx * 4).toFixed(1) + "px");
      setVar("--vly", (ny * 3).toFixed(1) + "px");

      // Whole-face lean: shifts the entire SVG (fills AND the fused black
      // ink layer together) toward the gaze via the .background-image svg
      // transform in style.css. Registration-safe at any amplitude, so it
      // carries the bulk of the eyelid/outline motion.
      setVar("--fx", (nx * 6).toFixed(1) + "px");
      setVar("--fy", (ny * 4).toFixed(1) + "px");

      // The biggest lid scales additionally sway toward the gaze, each
      // pivoting about its own center, on top of the assembly offset —
      // kept small so the combined travel stays within the ink lines.
      setVar("--bwx", (nx * 3).toFixed(1) + "px");
      setVar("--bwy", (ny * 2).toFixed(1) + "px");
      setVar("--bwr", (nx * 1.2).toFixed(2) + "deg");
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
      if (mode === "idle") {
        var off = ambientOffset();
        current.x = off.x;
        current.y = off.y;
        apply();
        root.classList.add("manual-look");
      }
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
      var rect = container.getBoundingClientRect();
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

    // Pointer Events cover mouse, touch, and pen through one code path
    // instead of three separate listeners, so a hybrid device (e.g. a
    // touchscreen laptop) can't double-fire updates from both mouse and
    // touch for the same physical input.
    window.addEventListener(
      "pointermove",
      function (e) {
        updateFromPoint(e.clientX, e.clientY);
      },
      { passive: true }
    );

    window.addEventListener(
      "pointerdown",
      function (e) {
        updateFromPoint(e.clientX, e.clientY);
      },
      { passive: true }
    );

    // A real gaze relaxes as soon as it loses its target, not 2.4s later.
    // When the pointer actually leaves the page (vs. just holding still
    // over it), skip the idle wait and start releasing immediately.
    document.documentElement.addEventListener(
      "pointerleave",
      function () {
        clearTimeout(idleTimer);
        if (mode === "active") mode = "releasing";
      },
      { passive: true }
    );
  }
})();
