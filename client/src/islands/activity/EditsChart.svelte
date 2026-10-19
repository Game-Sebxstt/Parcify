<script lang="ts">
  import { formatDate, formatNumber } from '../../lib/format.ts';
  import { m } from '../../paraglide/messages.js';
  import { labelEvery, niceScale, type DayBucket } from './chart.ts';
  import type { Person } from './people.ts';

  type Props = { buckets: DayBucket[]; people: Person[] };
  let { buckets, people }: Props = $props();

  const id = $props.id();
  const W = 720;
  const H = 240;
  const LEFT = 44;
  const RIGHT = 8;
  const TOP = 10;
  const BOTTOM = 26;
  const plotW = W - LEFT - RIGHT;
  const plotH = H - TOP - BOTTOM;

  const byId = $derived(new Map(people.map((person) => [person.id, person])));
  const total = $derived(buckets.reduce((sum, bucket) => sum + bucket.total, 0));
  const peak = $derived(buckets.reduce((best, bucket) => (bucket.total > best.total ? bucket : best), buckets[0]!));
  const scale = $derived(niceScale(peak.total));
  const band = $derived(plotW / buckets.length);
  const barW = $derived(Math.max(1, band * 0.7));
  const step = $derived(labelEvery(buckets.length));
  const withData = $derived(buckets.filter((bucket) => bucket.total > 0));
  const shown = $derived(people.filter((person) => withData.some((bucket) => bucket.parts.some((part) => part.userId === person.id))));

  const y = (value: number) => TOP + plotH - (value / scale.max) * plotH;
  const shortDay = (day: string) => formatDate(`${day}T00:00:00Z`, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const longDay = (day: string) => formatDate(`${day}T00:00:00Z`, { dateStyle: 'medium', timeZone: 'UTC' });
</script>

<section aria-labelledby="{id}-heading" class="flex flex-col gap-3">
  <h3 id="{id}-heading" class="text-base font-semibold">{m.activity_edits_title()}</h3>
  {#if total === 0}
    <p class="text-sm text-ink-muted">{m.activity_edits_none()}</p>
  {:else}
    <svg viewBox="0 0 {W} {H}" class="h-auto w-full" role="img" aria-labelledby="{id}-title {id}-desc">
      <title id="{id}-title">{m.activity_edits_title()}</title>
      <desc id="{id}-desc">
        {m.activity_edits_desc({ total: formatNumber(total), days: buckets.length, day: longDay(peak.day), max: formatNumber(peak.total) })}
      </desc>
      {#each scale.ticks as tick (tick)}
        <line x1={LEFT} x2={W - RIGHT} y1={y(tick)} y2={y(tick)} class="stroke-edge" stroke-opacity="0.4" stroke-width="1" />
        <text x={LEFT - 6} y={y(tick)} dy="0.32em" text-anchor="end" class="fill-ink-muted text-[11px] tabular">{formatNumber(tick)}</text>
      {/each}
      {#each buckets as bucket, index (bucket.day)}
        {@const x = LEFT + index * band + (band - barW) / 2}
        {#each bucket.parts as part, partIndex (part.userId)}
          {@const below = bucket.parts.slice(0, partIndex).reduce((sum, item) => sum + item.value, 0)}
          <rect x={x} y={y(below + part.value)} width={barW} height={y(below) - y(below + part.value)} fill={byId.get(part.userId)?.color} />
        {/each}
        {#if index % step === 0 || index === buckets.length - 1}
          <text x={x + barW / 2} y={H - 8} text-anchor="middle" class="fill-ink-muted text-[11px]">{shortDay(bucket.day)}</text>
        {/if}
      {/each}
    </svg>
    <ul class="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label={m.activity_people_title()}>
      {#each shown as person (person.id)}
        <li class="flex items-center gap-2">
          <span class="size-3 rounded-sm" style="background-color: {person.color}" aria-hidden="true"></span>
          {person.name}
        </li>
      {/each}
    </ul>
    <details class="text-sm">
      <summary class="cursor-pointer text-ink-muted hover:text-ink">{m.activity_show_table()}</summary>
      <div class="mt-2 overflow-x-auto">
        <table class="w-full text-left tabular">
          <caption class="pb-2 text-left text-xs text-ink-muted">{m.activity_edits_title()}. {m.activity_table_only_days()}</caption>
          <thead>
            <tr class="text-ink-muted">
              <th scope="col" class="py-1.5 pr-4 font-medium">{m.activity_day()}</th>
              {#each shown as person (person.id)}<th scope="col" class="py-1.5 pr-4 font-medium">{person.name}</th>{/each}
              <th scope="col" class="py-1.5 font-medium">{m.activity_total()}</th>
            </tr>
          </thead>
          <tbody>
            {#each withData as bucket (bucket.day)}
              <tr class="border-t border-petrol">
                <th scope="row" class="py-1.5 pr-4 font-normal">{longDay(bucket.day)}</th>
                {#each shown as person (person.id)}
                  <td class="py-1.5 pr-4">{formatNumber(bucket.parts.find((part) => part.userId === person.id)?.value ?? 0)}</td>
                {/each}
                <td class="py-1.5 font-semibold">{formatNumber(bucket.total)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </details>
  {/if}
</section>
