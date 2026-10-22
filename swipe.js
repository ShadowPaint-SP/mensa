// Capture on the stable gesture surface immediately, not on a moving image/text
// child. Safari's implicit touch capture can otherwise cancel a drag mid-transfer.
export function horizontalSwipe(surface, {
  onStart = () => {}, onMove, onEnd, enabled = () => true,
  ignoreSelector = 'button,a,input,select,textarea,summary,details',
  captureOnStart = true
}) {
  let drag;
  let suppressClick = false;
  surface.addEventListener('dragstart', (event) => event.preventDefault());
  surface.addEventListener('pointerdown', (event) => {
    if (drag || !enabled() || !event.isPrimary || event.button !== 0 ||
        event.target.closest(ignoreSelector)) return;
    suppressClick = false;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0,
      lastX: event.clientX, lastTime: event.timeStamp, velocityX: 0, locked: false };
    if (captureOnStart) surface.setPointerCapture(event.pointerId);
    onStart();
  });
  surface.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.locked) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
      if (Math.abs(dy) > Math.abs(dx) * 1.25) {
        finish(event, true);
        return;
      }
      if (Math.abs(dx) < Math.abs(dy)) return;
      drag.locked = true;
      if (!captureOnStart) surface.setPointerCapture(event.pointerId);
    }
    if (event.cancelable) event.preventDefault();
    const elapsed = event.timeStamp - drag.lastTime;
    if (elapsed > 0) drag.velocityX = (event.clientX - drag.lastX) / elapsed;
    drag.lastX = event.clientX;
    drag.lastTime = event.timeStamp;
    drag.dx = dx;
    onMove(dx);
  });
  function finish(event, cancelled = false) {
    if (!drag || drag.id !== event.pointerId) return;
    const finished = drag;
    drag = undefined;
    suppressClick = finished.locked;
    const dx = !cancelled && finished.locked ? event.clientX - finished.x : 0;
    const velocityX = event.timeStamp - finished.lastTime < 100 ? finished.velocityX : 0;
    onEnd(dx, { cancelled, velocityX: cancelled ? 0 : velocityX });
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
  }
  surface.addEventListener('pointerup', (event) => finish(event));
  surface.addEventListener('pointercancel', (event) => finish(event, true));
  surface.addEventListener('lostpointercapture', (event) => {
    // Capture changes on nested elements bubble here; they are not our cancellation.
    if (event.target === surface) finish(event, true);
  });
  surface.addEventListener('click', (event) => {
    if (suppressClick && event.detail > 0) {
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    }
  }, true);
}
