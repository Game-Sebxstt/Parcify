<script lang="ts">
  import { untrack } from 'svelte';
  import { ApiError, browser } from '../../lib/api.ts';
  import { createProject } from '../../lib/projects.ts';
  import { listTemplates } from '../../lib/templates.ts';
  import { m } from '../../paraglide/messages.js';
  import type { TemplateSummary } from '../../shared/api/templates.js';
  import Button from '../../ui/Button.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import Field from '../../ui/Field.svelte';
  import Input from '../../ui/Input.svelte';
  import Select from '../../ui/Select.svelte';
  import TemplateThumb from './TemplateThumb.svelte';

  type Space = { slug: string; name: string };
  type Props = {
    open: boolean;
    spaces: Space[];
    // Espacio elegido al abrir; si falta, el primero.
    initialSlug?: string;
  };

  let { open = $bindable(false), spaces, initialSlug }: Props = $props();

  const SHOWN = 6;
  const uid = $props.id();

  let name = $state('');
  let renamed = $state(false);
  let slug = $state('');
  let error = $state<string | null>(null);
  // 'blank' o el id de la plantilla que se está usando.
  let creating = $state<string | null>(null);
  let templates = $state<TemplateSummary[]>([]);
  let more = $state(false);
  let status = $state<'loading' | 'ready' | 'error'>('loading');

  // Solo al abrir: una recarga de la lista de espacios no borra lo escrito.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      name = m.dashboard_untitled();
      renamed = false;
      error = null;
      creating = null;
      slug = initialSlug ?? spaces[0]?.slug ?? '';
    });
  });

  $effect(() => {
    if (!open || !slug) return;
    const controller = new AbortController();
    status = 'loading';
    listTemplates(slug, { limit: SHOWN }, controller.signal).then(
      (page) => {
        templates = page.items;
        more = page.nextCursor !== null;
        status = 'ready';
      },
      (cause) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) status = 'error';
      },
    );
    return () => controller.abort();
  });

  // Desde una plantilla, el nombre por defecto es el de la plantilla salvo que se haya escrito otro.
  async function create(template: TemplateSummary | null) {
    const typed = name.trim();
    const finalName = template && !renamed ? template.name : typed;
    if (!finalName) {
      error = m.dashboard_name_required();
      return;
    }
    creating = template?.id ?? 'blank';
    error = null;
    try {
      const project = await createProject(slug, finalName, template?.id);
      browser.assign(`/p/${project.id}`);
    } catch (cause) {
      error = cause instanceof ApiError ? cause.message : m.error_internal();
      creating = null;
    }
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!creating) void create(null);
  }
</script>

<Dialog bind:open title={m.dashboard_new_project_title()}>
  <form onsubmit={submit} class="flex flex-col gap-5" novalidate>
    <Field label={m.dashboard_project_name()} {error}>
      {#snippet children(control)}
        <Input
          id={control.id}
          describedBy={control.describedBy}
          invalid={control.invalid}
          bind:value={name}
          oninput={() => (renamed = true)}
          maxlength={80}
          autocomplete="off"
          autofocus
        />
      {/snippet}
    </Field>

    {#if spaces.length > 1}
      <div class="flex flex-col gap-1.5">
        <label for="{uid}-space" class="text-sm font-medium">{m.dashboard_project_space()}</label>
        <Select
          id="{uid}-space"
          items={spaces.map((space) => ({ value: space.slug, label: space.name }))}
          bind:value={slug}
          label={m.dashboard_project_space()}
          size="lg"
        />
      </div>
    {/if}

    <section aria-labelledby="{uid}-templates" class="flex flex-col gap-2">
      <h3 id="{uid}-templates" class="text-sm font-medium">{m.new_project_from_template()}</h3>
      {#if status === 'loading'}
        <p role="status" class="text-sm text-ink-muted">{m.templates_loading()}</p>
      {:else if status === 'error'}
        <p class="text-sm text-ink-muted">{m.new_project_templates_error()}</p>
      {:else if templates.length === 0}
        <p class="text-sm text-ink-muted">{m.new_project_no_templates()}</p>
      {:else}
        <ul class="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {#each templates as template (template.id)}
            <li>
              <button
                type="button"
                disabled={creating !== null}
                aria-busy={creating === template.id || undefined}
                onclick={() => void create(template)}
                class="flex w-full cursor-pointer items-center gap-3 rounded-panel bg-surface-2 p-1.5 pr-3 text-left hover:bg-petrol disabled:cursor-not-allowed disabled:opacity-60"
              >
                <TemplateThumb assetId={template.previewAssetId} compact class="aspect-[16/10] w-16 shrink-0 rounded-[6px]" />
                <!-- El nombre accesible sale del contenido, así que contiene el nombre que se ve (WCAG 2.5.3). -->
                <span class="sr-only">{m.templates_use_named({ name: '' }).trim()}</span>
                <span class="min-w-0 flex-1 truncate text-sm font-semibold">{template.name}</span>
                <span aria-hidden="true" class="shrink-0 text-xs text-ink-muted">
                  {creating === template.id ? m.new_project_creating() : m.templates_use()}
                </span>
              </button>
            </li>
          {/each}
        </ul>
        {#if more}
          <a href="/app/e/{slug}?vista=plantillas" class="self-start rounded-[4px] text-sm font-semibold text-ink hover:underline">
            {m.new_project_all_templates()}
          </a>
        {/if}
      {/if}
    </section>

    <div class="flex justify-end gap-2">
      <Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
      <Button type="submit" variant="primary" loading={creating === 'blank'} disabled={creating !== null && creating !== 'blank'}>
        {m.new_project_blank()}
      </Button>
    </div>
  </form>
</Dialog>
