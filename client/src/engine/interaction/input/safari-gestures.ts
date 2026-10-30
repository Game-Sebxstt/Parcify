import type { EditorCore } from '../../EditorCore.ts';
import type { GestureRouter } from './GestureRouter.ts';

// GestureEvent solo existe en Safari y no está en los tipos del DOM.
type SafariGestureEvent = Event & { scale: number; clientX: number; clientY: number };

// En Safari de macOS el pellizco del touchpad llega como gesturestart/change/end con la escala acumulada. En iOS y
// iPadOS llega por Pointer Events (maxTouchPoints > 0) y lo lleva el enrutador.
export function bindSafariGestures(container: HTMLElement, core: EditorCore, router: GestureRouter): () => void {
  if (typeof window === 'undefined' || !('GestureEvent' in window) || navigator.maxTouchPoints !== 0) return () => {};
  let zoom0 = 1;
  let center = { x: 0, y: 0 };

  const onStart = (event: Event) => {
    event.preventDefault();
    const gesture = event as SafariGestureEvent;
    const rect = container.getBoundingClientRect();
    zoom0 = core.camera.zoom;
    center = { x: gesture.clientX - rect.left, y: gesture.clientY - rect.top };
    router.stopInertia();
    router.gestureActive = true;
  };
  const onChange = (event: Event) => {
    event.preventDefault();
    const scale = (event as SafariGestureEvent).scale;
    if (!Number.isFinite(scale) || scale <= 0 || core.camera.zoom <= 0) return;
    core.stopFollowing();
    core.markUserCamera();
    core.camera.zoomAt(center.x, center.y, (zoom0 * scale) / core.camera.zoom);
    core.requestFrame();
  };
  const onEnd = (event: Event) => {
    event.preventDefault();
    router.gestureActive = false;
  };

  container.addEventListener('gesturestart', onStart);
  container.addEventListener('gesturechange', onChange);
  container.addEventListener('gestureend', onEnd);
  return () => {
    router.gestureActive = false;
    container.removeEventListener('gesturestart', onStart);
    container.removeEventListener('gesturechange', onChange);
    container.removeEventListener('gestureend', onEnd);
  };
}
