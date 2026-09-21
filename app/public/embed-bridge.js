/*
 * Runs inside every sandboxed artifact frame. The frame has an opaque origin, so
 * this is the only channel it has to the page around it: it reports its height
 * so the parent can size the iframe, and when the parent turns comment picking
 * on it reports the element the operator clicked.
 */
(function () {
  "use strict";

  var lastHeight = 0;

  /* Elements that occupy no space but would still be measured. */
  var WEIGHTLESS = { SCRIPT: 1, STYLE: 1, LINK: 1, TEMPLATE: 1, NOSCRIPT: 1 };

  /**
   * The height of what is drawn, which is not the height of the document.
   * documentElement.scrollHeight is never less than the viewport, and the
   * viewport here IS the iframe we are trying to size: measuring it pins the
   * frame at whatever height it already has, so a frame can only ever grow. A
   * 100px diagram in a frame that opened at 400px stays in a 400px frame.
   *
   * Walking the body's own children and taking the lowest edge measures the
   * content, which lets a frame shrink to fit as well as grow.
   */
  function contentHeight() {
    var body = document.body;
    if (!body) return 0;
    var offset = window.pageYOffset || 0;
    var kids = body.children;
    var bottom = 0;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (WEIGHTLESS[el.tagName]) continue;
      var rect = el.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      var edge = rect.bottom + offset + (parseFloat(getComputedStyle(el).marginBottom) || 0);
      if (edge > bottom) bottom = edge;
    }
    if (!bottom) return 0;
    var style = getComputedStyle(body);
    bottom += parseFloat(style.paddingBottom) || 0;
    bottom += parseFloat(style.marginBottom) || 0;
    return Math.ceil(bottom);
  }

  /**
   * `force` repeats the current height even when it has not changed. A frame
   * can finish loading before the page around it has hydrated and started
   * listening, and a height reported into that gap is simply lost — the frame
   * then keeps its placeholder size forever, because nothing changes again.
   */
  function measure(force) {
    // body.scrollHeight is the fallback for a document whose children are all
    // positioned out of flow; it tracks content rather than the viewport.
    var height = contentHeight() || (document.body ? document.body.scrollHeight : 0);
    if (!height) return;
    if (!force && Math.abs(height - lastHeight) < 2) return;
    lastHeight = height;
    try {
      parent.postMessage({ type: "art:height", px: height }, "*");
    } catch (e) {
      /* the parent went away */
    }
  }

  function selectorFor(el) {
    if (!el || el === document.body || el === document.documentElement) return "body";
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth < 6) {
      var part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(part + "#" + CSS.escape(node.id));
        break;
      }
      var parentNode = node.parentNode;
      if (parentNode) {
        var siblings = [];
        for (var i = 0; i < parentNode.children.length; i++) {
          if (parentNode.children[i].tagName === node.tagName) siblings.push(parentNode.children[i]);
        }
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = node.parentNode;
      depth++;
    }
    return parts.join(" > ") || "body";
  }

  var picking = false;
  var hovered = null;

  function clearHover() {
    if (hovered) hovered.style.outline = hovered.__artPrevOutline || "";
    hovered = null;
  }

  function onMove(event) {
    if (!picking) return;
    var el = event.target;
    if (el === hovered) return;
    clearHover();
    if (el && el.nodeType === 1 && el !== document.body) {
      hovered = el;
      hovered.__artPrevOutline = el.style.outline;
      el.style.outline = "2px solid var(--art-accent, #2563EB)";
    }
  }

  function onClick(event) {
    if (!picking) return;
    event.preventDefault();
    event.stopPropagation();
    var el = event.target;
    var rect = el.getBoundingClientRect();
    var text = (el.innerText || el.textContent || "").trim().slice(0, 300);
    setPicking(false);
    parent.postMessage(
      {
        type: "art:picked",
        selector: selectorFor(el),
        text: text,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        point: {
          x: rect.width ? (event.clientX - rect.left) / rect.width : 0.5,
          y: rect.height ? (event.clientY - rect.top) / rect.height : 0.5,
        },
      },
      "*",
    );
  }

  function setPicking(on) {
    picking = on;
    document.documentElement.style.cursor = on ? "crosshair" : "";
    if (!on) clearHover();
  }

  function applyScheme(scheme) {
    document.documentElement.setAttribute("data-scheme", scheme === "dark" ? "dark" : "light");
    measure(true);
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "art:pick") setPicking(data.on === true);
    else if (data.type === "art:scheme") applyScheme(data.scheme);
    else if (data.type === "art:measure") measure(true);
  });

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setPicking(false);
  });

  if (window.ResizeObserver) {
    try {
      // The body, not documentElement: documentElement is the frame viewport,
      // which changes only because we asked the parent to resize it.
      var observer = new ResizeObserver(function () {
        measure();
      });
      var watch = function () {
        if (document.body) observer.observe(document.body);
      };
      watch();
      document.addEventListener("DOMContentLoaded", watch);
    } catch (e) {
      /* older engine */
    }
  }
  var announce = function () {
    measure(true);
  };

  // The first few reports are repeated whether or not the height changed, to
  // outlast a parent that is still hydrating; after that a report costs
  // nothing unless the content actually moved.
  var repeats = 8;
  window.addEventListener("load", announce);
  document.addEventListener("DOMContentLoaded", announce);
  setTimeout(announce, 50);
  setTimeout(announce, 400);
  setInterval(function () {
    measure(repeats-- > 0);
  }, 1500);
})();
