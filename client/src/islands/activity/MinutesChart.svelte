<script lang="ts">
  import { formatDate, formatNumber } from '../../lib/format.ts';
  import { m } from '../../paraglide/messages.js';
  import { labelEvery, niceScale, type DayBucket } from './chart.ts';

  type Props = { buckets: DayBucket[] };
  let { buckets }: Props = $props();

  const id = $props.id();
  const W = 720;
  const H = 200;
  const LEFT = 44;
  const RIGHT = 12;
  const TOP = 10;
  const BOTTOM = 26;
  const plotW = W - LEFT - RIGHT;
  const plotH = H - TOP - BOTTOM;

  const total = $derived(buckets.reduce((sum, bucket) => sum + bucket.total, 0));
  const peak = $derived(buckets.reduce((best, bucket) => (bucket.total > best.total ? bucket : best), buckets[0]!));
  const scale = $derived(niceScale(peak.total));
  const step = $derived(labelEvery(buckets.length));
  const withData = $derived(buckets.filter((bucket) => bucket.total > 0));

  const x = (index: number) => LEFT + (buckets.length === 1 ? plotW / 2 : (index / (buckets.length - 1)) * plotW);
  const y = (value: number) => TOP + plotH - (value / scale.max) * plotH;
  const path = $derived(buckets.map((bucket, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(bucket.total).toFixed(1)}`).join(''));
  const shortDay = (day: string) => formatDate(`${day}T00:00:00Z`, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const longDay = (day: string) => formatDate(`${day}T00:00:00Z`, { dateStyle: 'medium', timeZone: 'UTC' });
</script>

<section aria-labelledby="{id}-heading" class="flex flex-col gap-3">
  <h3 id="{id}-heading" class="text-base font-semibold">{m.activity_minutes_title()}</h3>
  {#if total === 0}
    <p class="text-sm text-ink-muted">{m.activity_minutes_none()}</p>
  {:else}
    <svg viewBox="0 0 {W} {H}" class="h-auto w-full" role="img" aria-labelledby="{id}-title {id}-desc">
      <title id="{id}-title">{m.activity_minutes_title()}</title>
      <desc id="{id}-desc">
        {m.activity_minutes_desc({ total: formatNumber(total), days: buckets.length, day: longDay(peak.day), max: formatNumber(peak.total) })}
      </desc>
      {#each scale.ticks as tick (tick)}
        <line x1={LEFT} x2={W - RIGHT} y1={y(tick)} y2={y(tick)} class="stroke-edge" stroke-opacity="0.4" stroke-width="1" />
        <text x={LEFT - 6} y={y(tick)} dy="0.32em" text-anchor="end" class="fill-ink-muted text-[11px] tabular">{formatNumber(tick)}</text>
      {/each}
      <path d={path} fill="none" class="stroke-sage" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      {#each buckets as bucket, index (bucket.day)}
        {#if bucket.total > 0}<circle cx={x(index)} cy={y(bucket.total)} r="3" class="fill-sage" />{/if}
        {#if index % step === 0 || index === buckets.length - 1}
          <text x={x(index)} y={H - 8} text-anchor="middle" class="fill-ink-muted text-[11px]">{shortDay(bucket.day)}</text>
        {/if}
      {/each}
    </svg>
    <details class="text-sm">
      <summary class="cursor-pointer text-ink-muted hover:text-ink">{m.activity_show_table()}</summary>
      <div class="mt-2 overflow-x-auto">
        <table class="w-full text-left tabular">
          <caption class="pb-2 text-left text-xs text-ink-muted">{m.activity_minutes_title()}. {m.activity_table_only_days()}</caption>
          <thead>
            <tr class="text-ink-muted">
              <th scope="col" class="py-1.5 pr-4 font-medium">{m.activity_day()}</th>
              <th scope="col" class="py-1.5 font-medium">{m.activity_minutes()}</th>
            </tr>
          </thead>
          <tbody>
            {#each withData as bucket (bucket.day)}
              <tr class="border-t border-petrol">
                <th scope="row" class="py-1.5 pr-4 font-normal">{longDay(bucket.day)}</th>
                <td class="py-1.5">{formatNumber(bucket.total)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </details>
  {/if}
</section>
