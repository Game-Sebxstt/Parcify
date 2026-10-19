import DOMPurify from 'dompurify';
import { Marked } from 'marked';

// Lista blanca para las respuestas de la IA: texto con formato y enlaces https. Sin imágenes, sin HTML propio,
// sin atributos de evento ni estilos.
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'strong', 'em', 'b', 'i', 'del', 's', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
];
const ALLOWED_ATTR = ['href'];
const HTTPS = /^https:\/\//i;

const marked = new Marked({ gfm: true, breaks: true, async: false });

let purifier: ReturnType<typeof DOMPurify> | null = null;

function sanitizer(): ReturnType<typeof DOMPurify> {
  if (purifier) return purifier;
  const instance = DOMPurify(window);
  instance.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName !== 'A') return;
    const href = node.getAttribute('href') ?? '';
    if (!HTTPS.test(href)) {
      // Un enlace que no es https se queda en su texto.
      node.replaceWith(...Array.from(node.childNodes));
      return;
    }
    node.setAttribute('rel', 'noopener noreferrer');
    node.setAttribute('target', '_blank');
  });
  purifier = instance;
  return instance;
}

// Markdown de la IA → HTML seguro para {@html}.
export function renderMarkdown(source: string): string {
  const html = marked.parse(source) as string;
  return sanitizer().sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: HTTPS,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    KEEP_CONTENT: true,
  }) as string;
}
