<script lang="ts">
  import { onMount, tick, type Component } from 'svelte';
  import type { AuthStep } from './auth/context.ts';

  // El overlay de acceso (Better Auth, validación, pasos) solo se descarga cuando alguien lo va a usar:
  // la página pública no paga ese JS en la primera carga.
  type OverlayInstance = { open: (step?: AuthStep, from?: HTMLElement | null) => void };

  let Overlay = $state<Component<Record<string, never>, OverlayInstance> | null>(null);
  let overlay = $state<OverlayInstance | null>(null);
  let loading: Promise<void> | null = null;

  const STEPS: Record<string, AuthStep> = { entrar: 'sign-in', crear: 'sign-up' };

  function load(): Promise<void> {
    loading ??= import('./AuthOverlay.svelte').then((module) => {
      Overlay = module.default as unknown as Component<Record<string, never>, OverlayInstance>;
    });
    return loading;
  }

  function trigger(target: EventTarget | null) {
    return (target as Element | null)?.closest?.<HTMLElement>('[data-auth-open]') ?? null;
  }

  // Desde que el overlay está montado, él mismo atiende los clics en [data-auth-open].
  async function handleClick(event: MouseEvent) {
    if (overlay || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const link = trigger(event.target);
    const step = STEPS[link?.dataset.authOpen ?? ''];
    if (!link || !step) return;
    event.preventDefault();
    await load();
    await tick();
    // Tras el await, el overlay ya está montado (TS no lo sabe por el return de arriba).
    (overlay as OverlayInstance | null)?.open(step, link);
  }

  function preload(event: Event) {
    if (trigger(event.target)) void load();
  }

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    if (STEPS[params.get('acceso') ?? ''] || params.get('error') === 'google') void load();
    const onClick = (event: MouseEvent) => void handleClick(event);
    document.addEventListener('click', onClick);
    document.addEventListener('pointerover', preload, { passive: true });
    document.addEventListener('focusin', preload);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('pointerover', preload);
      document.removeEventListener('focusin', preload);
    };
  });
</script>

{#if Overlay}
  <Overlay bind:this={overlay} />
{/if}
