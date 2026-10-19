<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import type { TemplateSummary } from '../../shared/api/templates.js';
  import Button from '../../ui/Button.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import TemplateReactions from './TemplateReactions.svelte';
  import TemplateThumb from './TemplateThumb.svelte';

  type Props = {
    open: boolean;
    template: TemplateSummary | null;
    byline: string;
    liking: boolean;
    using: boolean;
    onlike: () => void;
    onfavorite: () => void;
    onuse: () => void;
    onclose: () => void;
  };

  let { open = $bindable(false), template, byline, liking, using, onlike, onfavorite, onuse, onclose }: Props = $props();
</script>

<Dialog bind:open title={template?.name ?? m.templates_preview_title()} size="lg" onOpenChange={(next) => !next && onclose()}>
  {#if template}
    <div class="flex flex-col gap-4">
      <TemplateThumb
        assetId={template.previewAssetId}
        variant="medium"
        alt={m.templates_preview_alt({ name: template.name })}
        fit="contain"
        class="h-[min(60dvh,32rem)] rounded-[6px]"
      />
      <div class="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div class="min-w-0 flex-1 basis-64">
          <p class="text-sm text-ink-muted">{byline}</p>
          {#if template.description}
            <p class="mt-2 text-sm whitespace-pre-line">{template.description}</p>
          {/if}
        </div>
        <TemplateReactions {template} {liking} {onlike} {onfavorite} />
        <Button variant="primary" loading={using} onclick={onuse}>{m.templates_use()}</Button>
      </div>
    </div>
  {/if}
</Dialog>
