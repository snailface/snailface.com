// Makes the eye's pupil/iris follow the cursor or a touch point.
// Falls back to the ambient CSS "look around" animation (defined inside
// eye.svg) whenever the user isn't actively moving the mouse/finger.
//
// Requires eye.svg to be embedded via <object> (not a CSS background-image),
// since that's the only way this script can reach into its DOM.
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
  var ANIM_PHASE_ZERO = 3400; // ms: matches eye.svg's shared animation-delay (0% keyframe)
  var started = false;

  function init() {
    if (started) return;
    var svgDoc = obj.contentDocument;
    if (!svgDoc || !svgDoc.documentElement) return;
    var pupilPartsCheck = svgDoc.querySelectorAll(".pupil-part");
    if (!pupilPartsCheck.length) return;
    started = true;

    var pupilParts = svgDoc.querySelectorAll(".pupil-part");
    var bubbles = svgDoc.querySelectorAll(".eye-bubble");
    var whiteCircles = svgDoc.querySelectorAll(".white-circle");
    var veins = svgDoc.querySelectorAll(".vein-react");
    if (!pupilParts.length) return;

    var groups = [pupilParts, bubbles, whiteCircles, veins];

    var current = { x: 0, y: 0 };
    var target = { x: 0, y: 0 };
    var mode = "idle"; // "idle" | "active" | "releasing"
    var idleTimer = null;
    var raf = null;

    function forEachGroup(fn) {
      for (var g = 0; g < groups.length; g++) {
        var list = groups[g];
        for (var i = 0; i < list.length; i++) fn(list[i], g);
      }
    }

    function setPaused(paused) {
      forEachGroup(function (el) {
        el.style.animationPlayState = paused ? "paused" : "running";
      });
    }

    function clearInline() {
      forEachGroup(function (el) {
        el.style.transform = "";
      });
    }

    function resetAnimPhase() {
      forEachGroup(function (el) {
        var anims = el.getAnimations ? el.getAnimations() : [];
        for (var k = 0; k < anims.length; k++) {
          anims[k].currentTime = ANIM_PHASE_ZERO;
        }
      });
    }

    function apply() {
      var nx = current.x / MAX_X;
      var ny = current.y / MAX_Y;

      var pupilT =
        "translate(" + current.x.toFixed(1) + "px," + current.y.toFixed(1) + "px)";
      for (var i = 0; i < pupilParts.length; i++) {
        pupilParts[i].style.transform = pupilT;
      }

      // Blue bubbles (upper-left): dodge as pupil approaches that corner.
      var bubbleAmt = Math.max(0, Math.min(1, (-nx + -ny) / 2));
      var bubbleT =
        "translate(" +
        (-bubbleAmt * 18).toFixed(1) +
        "px," +
        (-bubbleAmt * 14).toFixed(1) +
        "px) scale(" +
        (1 - bubbleAmt * 0.1).toFixed(3) +
        ")";
      for (var j = 0; j < bubbles.length; j++) bubbles[j].style.transform = bubbleT;

      // White circle outlines (lower-right): dodge as pupil approaches that corner.
      var wcAmt = Math.max(0, Math.min(1, (nx + ny) / 2));
      var wcT =
        "translate(" +
        (wcAmt * 13).toFixed(1) +
        "px," +
        (wcAmt * 10).toFixed(1) +
        "px) scale(" +
        (1 - wcAmt * 0.08).toFixed(3) +
        ")";
      for (var k = 0; k < whiteCircles.length; k++) whiteCircles[k].style.transform = wcT;

      // Veins (either side): squeeze in the same left/right direction as the pupil.
      var veinDx = nx * 9;
      var veinScale = 1 - Math.min(1, Math.abs(nx)) * 0.04;
      var veinT =
        "translate(" + veinDx.toFixed(1) + "px,0) scaleX(" + veinScale.toFixed(3) + ")";
      for (var m = 0; m < veins.length; m++) veins[m].style.transform = veinT;
    }

    function tick() {
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
          clearInline();
          resetAnimPhase();
          setPaused(false);
          mode = "idle";
          raf = null;
        }
      } else {
        raf = null;
      }
    }

    function enterActive() {
      if (mode === "idle") setPaused(true);
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
