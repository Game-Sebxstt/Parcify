import type { Attachment } from 'svelte/attachments';

// Avisa de si el texto de un elemento con `truncate` se corta: al montar, al cambiar de ancho y al cambiar el texto
// (`text` solo está para que el adjunto se vuelva a crear cuando cambia).
export function watchTruncation(text: string, onchange: (truncated: boolean) => void): Attachment<HTMLElement> {
  void text;
  return (node) => {
    let live = true;
    const check = () => {
      if (live) onchange(node.scrollWidth > node.clientWidth);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(node);
    // La fuente web cambia el ancho del texto pero no el de la caja, así que el observador no salta.
    void document.fonts?.ready.then(check);
    return () => {
      live = false;
      observer.disconnect();
    };
  };
}
