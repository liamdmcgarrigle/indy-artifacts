/*
 * Runs inside every sandboxed artifact frame. The frame has an opaque origin, so
 * this is the only channel it has to the page around it: it reports its height
 * so the parent can size the iframe, and when the parent turns comment picking
 * on it reports the element the operator clicked.
 */
(function () {
  "use strict";

  var lastHeight = 0;

  function measure() {
    var doc = document.documentElement;
    var body = document.body;
    var height = Math.max(
      doc ? doc.scrollHeight : 0,
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
    );
    if (!height || Math.abs(height - lastHeight) < 2) return;
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
    measure();
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "art:pick") setPicking(data.on === true);
    else if (data.type === "art:scheme") applyScheme(data.scheme);
    else if (data.type === "art:measure") {
      lastHeight = 0;
      measure();
    }
  });

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setPicking(false);
  });

  if (window.ResizeObserver) {
    try {
      new ResizeObserver(measure).observe(document.documentElement);
    } catch (e) {
      /* older engine */
    }
  }
  window.addEventListener("load", measure);
  document.addEventListener("DOMContentLoaded", measure);
  setTimeout(measure, 50);
  setTimeout(measure, 400);
  setInterval(measure, 1500);
})();
