// DOM utilities — shared helpers for safe DOM access across all modules.
// Prevents the "header not in DOM yet" class of bugs by providing
// a unified way to wait for elements and safely interact with the DOM.

(function () {
  'use strict';

  // ── waitFor(selector, callback) ──────────────────────────────────
  // Waits for an element matching selector to appear in the DOM,
  // then calls the callback with the element. Uses a MutationObserver
  // so it works even when elements are rendered by other scripts.
  //
  // Returns a cleanup function to stop observing.
  //
  // Usage:
  //   var cleanup = PNPL.waitFor('.site-header .inner', function(el) {
  //     // el is the matched element
  //     el.appendChild(myButton);
  //   });
  //   // Later: cleanup();

  function waitFor(selector, callback, options) {
    options = options || {};
    var maxWait = options.timeout || 10000; // 10s default
    var intervalMs = options.pollInterval || 100;

    // Check immediately
    var el = document.querySelector(selector);
    if (el) {
      callback(el);
      return function () {}; // No-op cleanup
    }

    // Use MutationObserver for efficiency
    var observer = new MutationObserver(function () {
      var found = document.querySelector(selector);
      if (found) {
        observer.disconnect();
        clearTimeout(timer);
        callback(found);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Fallback: poll with interval in case observer misses something
    var timer = setTimeout(function () {
      observer.disconnect();
      var fallback = document.querySelector(selector);
      if (fallback) {
        callback(fallback);
      } else {
        console.warn('[PNPL waitFor] Timed out waiting for "' + selector + '"');
      }
    }, maxWait);

    // Return cleanup function
    return function () {
      observer.disconnect();
      clearTimeout(timer);
    };
  }

  // ── safeCanvasOperation(fn) ──────────────────────────────────────
  // Wraps a canvas pixel-reading operation in a try/catch that
  // silently handles SecurityError (tainted canvas from cross-origin
  // images). Returns the result on success, or the provided default
  // value on failure.
  //
  // Usage:
  //   var tone = PNPL.safeCanvasOperation(function() {
  //     return ctx.getImageData(0, 0, 8, 8).data;
  //   }, null);
  //
  //   // Or with a default:
  //   var tone = PNPL.safeCanvasOperation(function() {
  //     return computeTone();
  //   }, 'rgb(0, 0, 0)');

  function safeCanvasOperation(fn, defaultValue) {
    try {
      return fn();
    } catch (err) {
      // SecurityError (tainted canvas) is the most common failure
      if (err.name === 'SecurityError' || err.code === 18) {
        return defaultValue;
      }
      // Re-throw unexpected errors
      throw err;
    }
  }

  // ── Expose on window.PNPL ────────────────────────────────────────
  // PNPL may not exist yet (app.js loads after this). Attach to whatever
  // is there, or set up a one-time listener for when PNPL appears.
  if (window.PNPL) {
    window.PNPL.waitFor = waitFor;
    window.PNPL.safeCanvasOperation = safeCanvasOperation;
  } else {
    // PNPL hasn't been defined yet — wait for it
    var pnplCheck = setInterval(function () {
      if (window.PNPL) {
        clearInterval(pnplCheck);
        window.PNPL.waitFor = waitFor;
        window.PNPL.safeCanvasOperation = safeCanvasOperation;
      }
    }, 50);
    // Safety timeout: give up after 5 seconds
    setTimeout(function () {
      clearInterval(pnplCheck);
    }, 5000);
  }
})();
