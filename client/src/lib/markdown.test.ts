// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown.ts';

function dom(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('renderMarkdown', () => {
  it('conserva el formato y abre los enlaces https en otra pestaña sin opener', () => {
    const root = dom(renderMarkdown('# Título\n\n**negrita**, `código` y [docs](https://parcify.app/ayuda)\n\n- uno\n- dos'));
    expect(root.querySelector('h1')?.textContent).toBe('Título');
    expect(root.querySelector('strong')?.textContent).toBe('negrita');
    expect(root.querySelectorAll('li')).toHaveLength(2);
    const link = root.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://parcify.app/ayuda');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('elimina imágenes, HTML con eventos y scripts', () => {
    const html = renderMarkdown(
      '![x](https://evil.example/a.png)\n\n<img src=x onerror="alert(1)">\n\n<p onclick="alert(2)" style="color:red">hola</p>\n\n<script>alert(3)</script><svg onload="alert(4)"></svg><iframe src="https://evil.example"></iframe>',
    );
    const root = dom(html);
    expect(root.querySelector('img, script, svg, iframe, style')).toBeNull();
    expect(html).not.toMatch(/on\w+=/i);
    expect(html).not.toContain('style=');
    expect(root.textContent).toContain('hola');
  });

  it('deja como texto los enlaces que no son https', () => {
    const root = dom(
      renderMarkdown('[a](javascript:alert(1)) [b](http://inseguro.example) [c](data:text/html,<b>x</b>) [d](//evil.example) <a href="vbscript:x">e</a>'),
    );
    expect(root.querySelectorAll('a')).toHaveLength(0);
    for (const text of ['a', 'b', 'c', 'd', 'e']) expect(root.textContent).toContain(text);
  });
});
