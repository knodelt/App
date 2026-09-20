(() => {
  const LOCK_X_AT = 12;
  const LOCK_Y_AT = 28;
  const X_RELEASE = 88;
  const Y_RELEASE = 120;
  const Y_INTENT_RATIO = 1.8;

  function injectStyles() {
    if (document.querySelector('#frameSwipeGuidanceStyles')) return;
    const style = document.createElement('style');
    style.id = 'frameSwipeGuidanceStyles';
    style.textContent = `
      .swipe-card.guided-x {
        box-shadow: var(--shadow), inset 0 0 0 1px rgba(255,255,255,.055);
      }
      .swipe-card.guided-y {
        box-shadow: var(--shadow), inset 0 0 0 1px rgba(214,179,106,.22);
      }
      .swipe-card.guided-x .swipe-stamp.save { opacity:0 !important; }
      .swipe-card.guided-y .swipe-stamp.like,
      .swipe-card.guided-y .swipe-stamp.dislike { opacity:0 !important; }

      /* Direction feedback belongs in the center of the artwork, not at the edge. */
      .swipe-card .swipe-stamp {
        top:26% !important;
        left:50% !important;
        right:auto !important;
        z-index:20 !important;
        min-width:150px;
        padding:14px 20px !important;
        transform:translate(-50%,-50%) scale(.94) rotate(0deg) !important;
        text-align:center;
        border-width:2px !important;
        border-radius:16px !important;
        background:rgba(6,6,9,.42) !important;
        -webkit-backdrop-filter:blur(12px) saturate(1.15);
        backdrop-filter:blur(12px) saturate(1.15);
        box-shadow:0 18px 48px rgba(0,0,0,.42);
        font-family:Manrope,system-ui,sans-serif !important;
        font-size:26px !important;
        line-height:1 !important;
        font-weight:800 !important;
        letter-spacing:.08em !important;
        pointer-events:none;
      }
      .swipe-card .swipe-stamp.like {
        color:#a7e96f !important;
        border-color:rgba(167,233,111,.92) !important;
        transform:translate(-50%,-50%) scale(.94) rotate(-4deg) !important;
      }
      .swipe-card .swipe-stamp.dislike {
        color:#ff6f87 !important;
        border-color:rgba(255,111,135,.92) !important;
        transform:translate(-50%,-50%) scale(.94) rotate(4deg) !important;
      }
      .swipe-card .swipe-stamp.save {
        color:#ffd06a !important;
        border-color:rgba(255,208,106,.88) !important;
        font-size:22px !important;
      }
      .gesture-hint strong { color:#8d887f; font-weight:600; }

      @media (max-width:380px) {
        .swipe-card .swipe-stamp {
          top:24% !important;
          min-width:132px;
          padding:12px 16px !important;
          font-size:23px !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function clearGuidance(card) {
    card?.classList.remove('guided-x', 'guided-y');
  }

  function resetCard(card) {
    if (!card) return;
    clearGuidance(card);
    card.style.transform = '';
    card.querySelectorAll('.swipe-stamp').forEach(stamp => { stamp.style.opacity = 0; });
  }

  function lockAxis(axis) {
    if (!drag || drag.axis) return;
    drag.axis = axis;
    drag.card.classList.toggle('guided-x', axis === 'x');
    drag.card.classList.toggle('guided-y', axis === 'y');
    try { navigator.vibrate?.(7); } catch {}
  }

  window.startDrag = function guidedStartDrag(e) {
    const card = e.currentTarget;
    if (card.classList.contains('detail-open')) return;
    if (typeof e.button === 'number' && e.button !== 0) return;
    try { card.setPointerCapture(e.pointerId); } catch {}
    card.classList.add('dragging');
    clearGuidance(card);
    drag = {
      card,
      x:e.clientX,
      y:e.clientY,
      dx:0,
      dy:0,
      rawDx:0,
      rawDy:0,
      axis:null
    };
  };

  window.moveDrag = function guidedMoveDrag(e) {
    if (!drag) return;

    const rawDx = e.clientX - drag.x;
    const rawDy = e.clientY - drag.y;
    const absX = Math.abs(rawDx);
    const absY = Math.abs(rawDy);
    drag.rawDx = rawDx;
    drag.rawDy = rawDy;

    if (!drag.axis) {
      // Horizontal wins early and generously. This is the default rail.
      if (absX >= LOCK_X_AT && absX >= absY * .85) {
        lockAxis('x');
      }
      // Saving requires a clearly intentional, mostly vertical upward gesture.
      else if (rawDy < 0 && absY >= LOCK_Y_AT && absY >= absX * Y_INTENT_RATIO) {
        lockAxis('y');
      }
    }

    const like = drag.card.querySelector('.swipe-stamp.like');
    const dislike = drag.card.querySelector('.swipe-stamp.dislike');
    const save = drag.card.querySelector('.swipe-stamp.save');

    if (drag.axis === 'x') {
      drag.dx = rawDx;
      drag.dy = 0;
      const rotate = rawDx * .045;
      drag.card.style.transform = `translate3d(${rawDx}px, 0, 0) rotate(${rotate}deg)`;
      const xStrength = Math.min(1, Math.max(0, (absX - 4) / 30));
      like.style.opacity = rawDx < 0 ? (0.24 + xStrength * 0.76) : 0;
      dislike.style.opacity = rawDx > 0 ? (0.24 + xStrength * 0.76) : 0;
      save.style.opacity = 0;
      return;
    }

    if (drag.axis === 'y') {
      const guidedY = Math.min(0, rawDy);
      drag.dx = 0;
      drag.dy = guidedY;
      drag.card.style.transform = `translate3d(0, ${guidedY}px, 0) scale(${Math.max(.965, 1 - Math.abs(guidedY) / 2600)})`;
      like.style.opacity = 0;
      dislike.style.opacity = 0;
      save.style.opacity = Math.min(1, Math.max(0, (Math.abs(guidedY) - 20) / 90));
      return;
    }

    // Before intent is locked, make the card feel attached to a horizontal rail.
    const previewX = rawDx * .72;
    const resistedY = rawDy < 0 ? Math.max(rawDy * .16, -8) : 0;
    drag.dx = previewX;
    drag.dy = resistedY;
    drag.card.style.transform = `translate3d(${previewX}px, ${resistedY}px, 0) rotate(${previewX * .025}deg)`;
    const previewStrength = Math.min(.72, Math.max(0, (absX - 4) / 28));
    like.style.opacity = rawDx < -5 ? (0.18 + previewStrength) : 0;
    dislike.style.opacity = rawDx > 5 ? (0.18 + previewStrength) : 0;
    save.style.opacity = 0;
  };

  window.endDrag = function guidedEndDrag() {
    if (!drag) return;
    const current = drag;
    drag = null;

    const { card, axis, rawDx = 0, rawDy = 0 } = current;
    card.classList.remove('dragging');

    if (axis === 'x') {
      clearGuidance(card);
      if (rawDx <= -X_RELEASE) return animateSwipe('like', card);
      if (rawDx >= X_RELEASE) return animateSwipe('dislike', card);
      return resetCard(card);
    }

    if (axis === 'y') {
      clearGuidance(card);
      if (rawDy <= -Y_RELEASE) return animateSwipe('save', card);
      return resetCard(card);
    }

    // Fast horizontal flicks still work even if they ended before the lock threshold.
    if (rawDx <= -X_RELEASE && Math.abs(rawDx) > Math.abs(rawDy)) return animateSwipe('like', card);
    if (rawDx >= X_RELEASE && Math.abs(rawDx) > Math.abs(rawDy)) return animateSwipe('dislike', card);

    // Emergency vertical fallback stays deliberately strict.
    if (rawDy <= -135 && Math.abs(rawDy) >= Math.abs(rawDx) * 2) return animateSwipe('save', card);
    resetCard(card);
  };

  injectStyles();

  const hint = document.querySelector('.gesture-hint');
  if (hint) hint.innerHTML = 'Tippen = Bild · <strong>← Super · → Mist</strong> · ↑ Merken · halten = Infos';

  // Rebuild once so the current top card receives the new handlers too.
  if (typeof renderDeck === 'function') renderDeck();
})();