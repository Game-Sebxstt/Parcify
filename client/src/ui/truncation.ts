import type { Attachment } from 'svelte/attachments';

// Avisa de si el texto de un elemento con `truncate` se corta: al montar, al cambiar de ancho y al cambiar el texto
// (`text` solo está para que el adjunto se vuelva a crear cuando cambia).
export function watchTruncation(text: string, onchange: (truncated: boolean) => void): Attachment<HTMLElement> {
  void text;
  return (node) => {
    const check = () => onchange(node.scrollWidth > node.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(node);
    return () => observer.disconnect();
  };
}
