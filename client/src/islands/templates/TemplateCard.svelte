<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import type { TemplateSummary } from '../../shared/api/templates.js';
  import Button from '../../ui/Button.svelte';
  import TemplateReactions from './TemplateReactions.svelte';
  import TemplateThumb from './TemplateThumb.svelte';

  type Props = {
    template: TemplateSummary;
    byline: string;
    liking: boolean;
    using: boolean;
    // Mientras se crea un proyecto desde cualquier plantilla.
    busy: boolean;
    onpreview: () => void;
    onlike: () => void;
    onfavorite: () => void;
    onuse: () => void;
  };

  let { template, byline, liking, using, busy, onpreview, onlike, onfavorite, onuse }: Props = $props();
</script>

<li class="flex flex-col rounded-panel bg-surface-1 p-2 transition-colors duration-150 hover:bg-surface-2">
  <!-- El nombre ya abre la vista previa; la imagen es un atajo para el puntero. -->
  <button type="button" tabindex="-1" aria-hidden="true" onclick={onpreview} class="block cursor-zoom-in overflow-hidden rounded-[6px]">
    <TemplateThumb assetId={template.previewAssetId} class="aspect-[16/10] w-full" />
  </button>

  <div class="mt-2 flex items-start gap-1 pl-1">
    <div class="min-w-0 flex-1 py-0.5">
      <h3 class="truncate text-sm font-semibold">
        <button type="button" onclick={onpreview} class="max-w-full cursor-pointer truncate rounded-[4px] text-left hover:underline">
          {template.name}
        </button>
      </h3>
      <p class="truncate text-xs text-ink-muted">{byline}</p>
    </div>
    <TemplateReactions {template} {liking} {onlike} {onfavorite} />
  </div>

  <div class="mt-2 px-1 pb-1">
    <Button size="sm" loading={using} disabled={busy && !using} label={m.templates_use_named({ name: template.name })} onclick={onuse}>
      {m.templates_use()}
    </Button>
  </div>
</li>
