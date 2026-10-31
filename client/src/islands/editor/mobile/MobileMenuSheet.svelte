<script lang="ts" module>
  export type MobileMenuEntry = 'layers' | 'animations' | 'timeline' | 'versions' | 'chat' | 'gallery' | 'export' | 'share' | 'present' | 'publish' | 'download';
</script>

<script lang="ts">
  import Download from '@lucide/svelte/icons/download';
  import Film from '@lucide/svelte/icons/film';
  import History from '@lucide/svelte/icons/history';
  import ImageDown from '@lucide/svelte/icons/image-down';
  import Images from '@lucide/svelte/icons/images';
  import Layers from '@lucide/svelte/icons/layers';
  import LayoutTemplate from '@lucide/svelte/icons/layout-template';
  import ListVideo from '@lucide/svelte/icons/list-video';
  import MessageSquare from '@lucide/svelte/icons/message-square';
  import Play from '@lucide/svelte/icons/play';
  import UserPlus from '@lucide/svelte/icons/user-plus';
  import { m } from '../../../paraglide/messages.js';
  import type { MenuIcon } from '../../../ui/DropdownMenu.svelte';
  import Sheet from '../../../ui/Sheet.svelte';

  type Props = {
    open?: boolean;
    canShare: boolean;
    canPublish: boolean;
    chatUnread: number;
    downloading: boolean;
    // Elegir una entrada cierra el menú; quien lo monta abre lo elegido.
    onselect: (entry: MobileMenuEntry) => void;
    onOpenChange?: (open: boolean) => void;
    // Alto de la hoja en pantalla.
    height?: number;
  };

  let { open = $bindable(false), canShare, canPublish, chatUnread, downloading, onselect, onOpenChange, height = $bindable(0) }: Props = $props();

  type Row = { id: MobileMenuEntry; label: string; icon: MenuIcon; disabled?: boolean };

  const sections = $derived.by((): Row[][] => [
    [
      { id: 'layers', label: m.editor_mobile_layers(), icon: Layers },
      { id: 'animations', label: m.editor_mobile_animations(), icon: ListVideo },
      { id: 'timeline', label: m.editor_mobile_timeline(), icon: Film },
      { id: 'versions', label: m.editor_mobile_versions(), icon: History },
      { id: 'chat', label: chatUnread ? m.editor_mobile_chat_unread({ count: chatUnread }) : m.editor_mobile_chat(), icon: MessageSquare },
      { id: 'gallery', label: m.editor_mobile_gallery(), icon: Images },
    ],
    [
      { id: 'export', label: m.editor_mobile_export(), icon: ImageDown },
      ...(canShare ? [{ id: 'share', label: m.editor_mobile_share(), icon: UserPlus } satisfies Row] : []),
      { id: 'present', label: m.editor_mobile_present(), icon: Play },
      ...(canPublish ? [{ id: 'publish', label: m.editor_mobile_publish(), icon: LayoutTemplate } satisfies Row] : []),
      { id: 'download', label: m.editor_mobile_download(), icon: Download, disabled: downloading },
    ],
  ]);

  function choose(id: MobileMenuEntry) {
    open = false;
    onOpenChange?.(false);
    onselect(id);
  }
</script>

<Sheet bind:open bind:height title={m.editor_mobile_menu_title()} modal={false} testid="mobile-menu-sheet" {onOpenChange}>
  <nav aria-label={m.editor_mobile_menu_title()} class="flex flex-col px-2 pb-2">
    {#each sections as rows, index (index)}
      <ul class="flex flex-col border-t border-edge/25 py-1 first:border-t-0">
        {#each rows as row (row.id)}
          {@const Icon = row.icon}
          <li>
            <button
              type="button"
              disabled={row.disabled}
              onclick={() => choose(row.id)}
              class="flex h-12 w-full cursor-pointer items-center gap-3 rounded-card px-3 text-left text-sm text-ink hover:bg-surface-2 disabled:cursor-wait disabled:opacity-60"
              data-entry={row.id}
            >
              <span aria-hidden="true" class="inline-flex shrink-0 text-ink-muted"><Icon size={20} /></span>
              <span class="min-w-0 flex-1 truncate">{row.label}</span>
              {#if row.id === 'chat' && chatUnread}
                <span aria-hidden="true" class="min-w-5 rounded-full bg-coral px-1.5 text-center text-2xs leading-5 font-semibold text-coral-ink tabular">
                  {chatUnread > 99 ? '99+' : chatUnread}
                </span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/each}
  </nav>
</Sheet>
