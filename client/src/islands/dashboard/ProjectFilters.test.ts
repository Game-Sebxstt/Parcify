// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectFilters, { SEARCH_DEBOUNCE_MS, type ProjectQuery } from './ProjectFilters.svelte';
import SelectionBar from './SelectionBar.svelte';

const INITIAL: ProjectQuery = { q: '', filter: 'all', sort: 'edited' };

describe('ProjectFilters', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('la búsqueda espera a que se deje de escribir y avisa una sola vez', async () => {
    const onchange = vi.fn();
    render(ProjectFilters, { value: INITIAL, onchange });
    const search = screen.getByRole('searchbox', { name: 'Buscar proyectos' });
    await fireEvent.input(search, { target: { value: 'pla' } });
    await fireEvent.input(search, { target: { value: 'plano ' } });
    expect(onchange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(onchange).toHaveBeenCalledTimes(1);
    expect(onchange).toHaveBeenCalledWith({ ...INITIAL, q: 'plano' });
  });

  it('Enter busca sin esperar', async () => {
    const onchange = vi.fn();
    render(ProjectFilters, { value: INITIAL, onchange });
    const search = screen.getByRole('searchbox', { name: 'Buscar proyectos' });
    await fireEvent.input(search, { target: { value: 'mapa' } });
    await fireEvent.keyDown(search, { key: 'Enter' });
    expect(onchange).toHaveBeenCalledWith({ ...INITIAL, q: 'mapa' });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(onchange).toHaveBeenCalledTimes(1);
  });

  it('los filtros son un grupo de opciones con la actual marcada', async () => {
    const onchange = vi.fn();
    render(ProjectFilters, { value: { ...INITIAL, filter: 'mine' }, onchange });
    expect(screen.getByRole('radiogroup', { name: 'Mostrar' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Míos' }).getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(screen.getByRole('radio', { name: 'Papelera' }));
    expect(onchange).toHaveBeenCalledWith({ ...INITIAL, filter: 'trash' });
  });

  it('el orden se elige con un desplegable con nombre que anuncia el valor', () => {
    const onchange = vi.fn();
    render(ProjectFilters, { value: INITIAL, onchange });
    const trigger = screen.getByRole('combobox', { name: 'Ordenar por: Última edición' });
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(document.querySelector('select')).toBeNull();
  });
});

describe('SelectionBar', () => {
  const handlers = () => ({
    onselectall: vi.fn(),
    onclear: vi.fn(),
    onduplicate: vi.fn(),
    ondelete: vi.fn(),
    onrestore: vi.fn(),
  });

  it('cuenta la selección y ofrece duplicar, mover a la papelera y seleccionar todos', async () => {
    const actions = handlers();
    render(SelectionBar, { count: 2, total: 5, trash: false, busy: false, ...actions });
    expect(screen.getByRole('toolbar', { name: 'Acciones de la selección' })).toBeTruthy();
    expect(screen.getByText('2 proyectos seleccionados')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Duplicar' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Mover a la papelera' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Seleccionar todos' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Quitar la selección' }));
    expect(actions.onduplicate).toHaveBeenCalledOnce();
    expect(actions.ondelete).toHaveBeenCalledOnce();
    expect(actions.onselectall).toHaveBeenCalledOnce();
    expect(actions.onclear).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Restaurar' })).toBeNull();
  });

  it('en la papelera solo restaura, y con todo seleccionado no ofrece seleccionar todos', async () => {
    const actions = handlers();
    render(SelectionBar, { count: 1, total: 1, trash: true, busy: false, ...actions });
    expect(screen.getByText('1 proyecto seleccionado')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Restaurar' }));
    expect(actions.onrestore).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Duplicar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Seleccionar todos' })).toBeNull();
  });
});
