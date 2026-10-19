// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import DialogHarness from '../../test/fixtures/DialogHarness.svelte';

async function openDialog() {
  render(DialogHarness);
  const trigger = screen.getByRole('button', { name: 'Renombrar' });
  trigger.focus();
  await fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'Renombrar proyecto' });
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  return { trigger, dialog };
}

describe('Dialog', () => {
  it('se anuncia con su título y su descripción', async () => {
    const { dialog } = await openDialog();
    expect(dialog).toHaveProperty('ariaModal', 'true');
    expect(screen.getByText('El nombre se ve en la lista de proyectos.').id).toBe(dialog.getAttribute('aria-describedby'));
  });

  it('atrapa el foco: si sale del diálogo, vuelve dentro', async () => {
    const { dialog } = await openDialog();
    const outside = screen.getByRole('button', { name: 'Fuera', hidden: true });
    outside.focus();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('al cerrar con Escape devuelve el foco al botón que lo abrió', async () => {
    const { trigger, dialog } = await openDialog();
    await fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('al cerrar con el botón Cerrar devuelve el foco al disparador', async () => {
    const { trigger } = await openDialog();
    await fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
