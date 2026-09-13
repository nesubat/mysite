/* Runs synchronously in <head>, before first paint, so the load-reveal
   animation in styles.css never flashes unstyled content. */
document.documentElement.className += " js";
