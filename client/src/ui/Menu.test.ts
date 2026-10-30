// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import MenuHarness from '../../test/fixtures/MenuHarness.svelte';

async function openMenu() {
  render(MenuHarness);
  const trigger = screen.getByRole('button', { name: 'Acciones' });
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'Enter' });
  const menu = await screen.findByRole('menu');
  return { trigger, menu };
}

describe('Menu', () => {
  it('una entrada que lleva el foco a un campo lo conserva al cerrarse el menú', async () => {
    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Renombrar' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    const input = screen.getByRole('textbox', { name: 'Nombre de la página' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    await fireEvent.input(input, { target: { value: 'Portada' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Portada')).toBeTruthy();
  });

  it('al cerrar con Escape devuelve el foco al disparador', async () => {
    const { trigger, menu } = await openMenu();
    await fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
