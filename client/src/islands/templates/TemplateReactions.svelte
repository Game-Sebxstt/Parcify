<script lang="ts">
  import Heart from '@lucide/svelte/icons/heart';
  import Star from '@lucide/svelte/icons/star';
  import { formatNumber } from '../../lib/format.ts';
  import { m } from '../../paraglide/messages.js';
  import type { TemplateSummary } from '../../shared/api/templates.js';

  type Props = {
    template: TemplateSummary;
    liking: boolean;
    onlike: () => void;
    onfavorite: () => void;
  };

  let { template, liking, onlike, onfavorite }: Props = $props();
</script>

<div class="flex shrink-0 items-center">
  <button
    type="button"
    aria-pressed={template.liked}
    aria-label={m.templates_like({ name: template.name, count: template.likesCount })}
    aria-busy={liking || undefined}
    disabled={liking}
    onclick={onlike}
    class={[
      'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-sm hover:bg-surface-2 disabled:cursor-wait',
      template.liked ? 'text-ink' : 'text-ink-muted hover:text-ink',
    ].join(' ')}
  >
    <Heart size={16} aria-hidden="true" fill={template.liked ? 'currentColor' : 'none'} />
    <span class="tabular" aria-hidden="true">{formatNumber(template.likesCount)}</span>
  </button>
  <button
    type="button"
    aria-pressed={template.favorite}
    aria-label={template.favorite ? m.templates_unfavorite({ name: template.name }) : m.templates_favorite({ name: template.name })}
    onclick={onfavorite}
    class={[
      'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-surface-2',
      template.favorite ? 'text-ink' : 'text-ink-muted hover:text-ink',
    ].join(' ')}
  >
    <Star size={16} aria-hidden="true" fill={template.favorite ? 'currentColor' : 'none'} />
  </button>
</div>
