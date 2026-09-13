/* ---------------------------------------------------------------
   Sujan Basnet — personal site
   Three small jobs: the reveal on load, the footer year, and
   keeping the section index in step with where the page is.
   --------------------------------------------------------------- */

(function () {
  "use strict";

  /* --- the one load reveal ------------------------------------- */
  requestAnimationFrame(function () {
    document.documentElement.classList.add("ready");
  });

  /* --- footer year --------------------------------------------- */
  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  /* --- section index ------------------------------------------- */
  var nav = document.querySelector(".index");
  if (!nav) return;

  var links = Array.prototype.slice.call(nav.querySelectorAll("a"));
  var sections = links
    .map(function (a) { return document.querySelector(a.getAttribute("href")); })
    .filter(Boolean);

  if (!sections.length) return;

  var current = null;

  function markActive(id) {
    if (id === current) return;
    current = id;
    links.forEach(function (a) {
      var on = a.getAttribute("href") === "#" + id;
      if (on) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
      if (on) keepInView(a);
    });
  }

  /* On narrow screens the index scrolls sideways, so the active
     item is nudged into view instead of hiding off the edge. */
  function keepInView(link) {
    if (nav.scrollWidth <= nav.clientWidth) return;
    var navBox = nav.getBoundingClientRect();
    var box = link.getBoundingClientRect();
    if (box.left < navBox.left + 8) {
      nav.scrollLeft += box.left - navBox.left - 16;
    } else if (box.right > navBox.right - 8) {
      nav.scrollLeft += box.right - navBox.right + 16;
    }
  }

  if (!("IntersectionObserver" in window)) {
    markActive(sections[0].id);
    return;
  }

  /* Track the topmost section that has crossed into the upper
     part of the viewport, which matches what a reader is looking at
     better than simply taking whatever is most visible. */
  var seen = {};

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      seen[entry.target.id] = entry.isIntersecting;
    });

    var active = null;
    for (var i = 0; i < sections.length; i++) {
      if (seen[sections[i].id]) { active = sections[i].id; break; }
    }
    if (!active) {
      // Between bands: fall back to the last one scrolled past.
      for (var j = sections.length - 1; j >= 0; j--) {
        if (sections[j].getBoundingClientRect().top < window.innerHeight * 0.4) {
          active = sections[j].id;
          break;
        }
      }
    }
    if (active) markActive(active);
  }, {
    rootMargin: "-25% 0px -55% 0px",
    threshold: 0
  });

  sections.forEach(function (s) { observer.observe(s); });
})();
