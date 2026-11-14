/**
 * Android 12 Edge Overscroll Stretch Engine
 * 當容器滾動到頂部繼續下拉，或到底部繼續上推時，觸發邊緣物理拉伸 (scaleY) 並在放手後彈性回彈。
 * 建議將 targetEl 指向主內容容器（如 #app-shell）；歸位後自動清除 transform 以免影響 fixed/sticky 定位。
 */
export function attachAndroidEdgeStretch(
  scrollEl = document.scrollingElement || document.documentElement,
  targetEl = document.querySelector('#app-shell, main') || document.body
) {
  let startY = 0;
  let stretch = 0;
  let activeEdge = null; // 'top' | 'bottom' | null

  const applyStretch = (val, edge) => {
    if (!edge || val <= 0.001) {
      targetEl.style.transition = 'transform 0.36s cubic-bezier(0.22, 1, 0.36, 1)';
      targetEl.style.transform = 'scaleY(1)';
      const onEnd = (ev) => {
        if (ev.propertyName === 'transform' && !activeEdge) {
          targetEl.style.transform = '';
          targetEl.style.transition = '';
          targetEl.style.transformOrigin = '';
          targetEl.removeEventListener('transitionend', onEnd);
        }
      };
      targetEl.addEventListener('transitionend', onEnd);
      return;
    }
    targetEl.style.transition = 'none';
    targetEl.style.transformOrigin = edge === 'top' ? 'top center' : 'bottom center';
    const scale = 1 + Math.min(0.055, val * 0.00028);
    targetEl.style.transform = `scaleY(${scale.toFixed(4)})`;
  };

  window.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    stretch = 0;
    activeEdge = null;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - startY;
    const atTop = scrollEl.scrollTop <= 1;
    const atBottom = scrollEl.scrollTop + window.innerHeight >= scrollEl.scrollHeight - 2;

    if (atTop && dy > 0) {
      activeEdge = 'top';
      stretch = Math.sqrt(dy) * 14;
      applyStretch(stretch, 'top');
    } else if (atBottom && dy < 0) {
      activeEdge = 'bottom';
      stretch = Math.sqrt(-dy) * 14;
      applyStretch(stretch, 'bottom');
    } else if (activeEdge) {
      activeEdge = null;
      applyStretch(0, null);
    }
  }, { passive: true });

  const release = () => {
    if (activeEdge || stretch > 0) {
      activeEdge = null;
      stretch = 0;
      applyStretch(0, null);
    }
  };
  window.addEventListener('touchend', release, { passive: true });
  window.addEventListener('touchcancel', release, { passive: true });
}
