// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import Button from './Button.svelte';

const text = (value: string) => createRawSnippet(() => ({ render: () => `<span>${value}</span>` }));
const icon = createRawSnippet(() => ({ render: () => '<svg aria-hidden="true"></svg>' }));

describe('Button', () => {
  it('toma su nombre accesible del texto', () => {
    render(Button, { children: text('Nuevo proyecto') });
    expect(screen.getByRole('button', { name: 'Nuevo proyecto' })).toBeTruthy();
  });

  it('un botón de solo icono se nombra con label', () => {
    render(Button, { children: icon, iconOnly: true, label: 'Cerrar panel' });
    expect(screen.getByRole('button', { name: 'Cerrar panel' })).toBeTruthy();
  });

  it('mientras carga sigue nombrado, queda deshabilitado y marca aria-busy', () => {
    render(Button, { children: text('Guardar'), loading: true });
    const button = screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('con href es un enlace con el mismo nombre', () => {
    render(Button, { children: text('Entrar'), href: '/?acceso=entrar' });
    const link = screen.getByRole('link', { name: 'Entrar' });
    expect(link.getAttribute('href')).toBe('/?acceso=entrar');
  });

  it('por defecto es type="button" para no enviar formularios por accidente', () => {
    render(Button, { children: text('Cancelar') });
    expect(screen.getByRole('button', { name: 'Cancelar' }).getAttribute('type')).toBe('button');
  });
});
