(() => {
  // Keep FRAME behaving like a full-screen mobile app instead of a zoomable webpage.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(type => {
    document.addEventListener(type, event => event.preventDefault(), { passive: false });
  });

  let lastTouchEnd = 0;
  document.addEventListener('touchend', event => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) event.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
})();
