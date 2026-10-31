<script lang="ts">
  import MessageSquare from '@lucide/svelte/icons/message-square';
  import type { Engine } from '../../../engine/index.ts';
  import type { AiFeatures } from '../../../lib/ai.ts';
  import type { CollabSession, ConnectionStatus } from '../../../lib/collab.ts';
  import { getEditorLayout } from '../../../lib/editor-layout.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
  import type { ProjectRole } from '../../../shared/permissions.js';
  import FloatingWindow from '../../../ui/FloatingWindow.svelte';
  import type { WindowRect } from '../../../ui/floating-window.svelte.ts';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Sheet from '../../../ui/Sheet.svelte';
  import type AiPanelComponent from '../ai/AiPanel.svelte';
  import Button from '../../../ui/Button.svelte';
  import ChatPanel from './ChatPanel.svelte';

  type Props = {
    projectId: string;
    session: CollabSession;
    me: { id: string; name: string; avatarAssetId: string | null };
    role: ProjectRole;
    status: ConnectionStatus;
    typingNames: string[];
    unread: number;
    // Presentando o con la interfaz oculta: no se ve, pero el chat sigue contando y recibiendo.
    hidden: boolean;
    defaultRect: () => WindowRect;
    pillAt: { right: number; bottom: number };
    returnFocus: () => HTMLElement | null;
    // La pestaña IA solo existe si hay funciones de IA y permiso para usarlas.
    aiAvailable: boolean;
    AiPanel: typeof AiPanelComponent | null;
    aiFeatures: AiFeatures | null;
    engine: Engine | null;
    readOnly: boolean;
    aiAttachment: { assetId: string; name: string; n: number } | null;
    // El panel de IA se descarga al elegir su pestaña (lo hace el editor); si falla, se reintenta solo con el botón.
    aiFailed: boolean;
    onretryai: () => void;
    ontyping: (typing: boolean) => void;
    onunread: (count: number) => void;
    // Móvil: una hoja inferior (50 % y 92 %) en lugar de la ventana flotante.
    mobile?: boolean;
    // Alto de la hoja en pantalla, para que la cámara la evite.
    height?: number;
  };

  let {
    mobile = false,
    height = $bindable(0),
    projectId,
    session,
    me,
    role,
    status,
    typingNames,
    unread,
    hidden,
    defaultRect,
    pillAt,
    returnFocus,
    aiAvailable,
    AiPanel,
    aiFeatures,
    engine,
    readOnly,
    aiAttachment,
    aiFailed,
    onretryai,
    ontyping,
    onunread,
  }: Props = $props();

  const layout = getEditorLayout();
  let floating = $state<ReturnType<typeof FloatingWindow> | null>(null);

  // Sin IA disponible se queda en Equipo, aunque la última vez se dejara en IA.
  const tab = $derived(layout.conversation.tab === 'ai' && aiAvailable ? 'ai' : 'team');
  const visible = $derived(layout.conversation.open && !layout.conversation.minimized && !hidden);
  const tabs = $derived([
    { value: 'team', label: m.editor_conversation_tab_team() },
    { value: 'ai', label: m.editor_conversation_tab_ai() },
  ]);

  // En la hoja, el foco va a su cabecera al abrirse.
  export function focus() {
    if (mobile) return;
    return floating?.focus();
  }

  function pickTab(next: string) {
    layout.conversation.tab = next === 'ai' ? 'ai' : 'team';
  }

  // El chat y la IA se montan una sola vez, en un contenedor oculto, y la hoja o la ventana flotante lo toman prestado.
  // Así siguen montados con la hoja cerrada (cuentan los no leídos y reciben en vivo) y al cruzar los 640 px no se
  // pierden el borrador, los adjuntos ni una respuesta de IA en curso.
  let holder = $state<HTMLElement | null>(null);
  let content = $state<HTMLElement | null>(null);

  function adopt(node: HTMLElement) {
    const moved = content;
    if (moved) node.appendChild(moved);
    return () => {
      // Al cambiar de hoja a ventana, la nueva puede tomarlo antes de que la vieja lo suelte: solo lo devuelve quien lo tiene.
      // Solo esta función mueve `content`, y Svelte no pinta nada entre él y su contenedor: vuelve a su sitio intacto.
      // eslint-disable-next-line svelte/no-dom-manipulating
      if (moved && holder && moved.parentNode === node) holder.appendChild(moved);
    };
  }
</script>

{#snippet tabSwitch()}
  {#if aiAvailable}
    <SegmentedControl items={tabs} value={tab} label={m.editor_conversation_tabs()} size="sm" onValueChange={pickTab} testid="conversation-tabs" />
  {/if}
{/snippet}

{#snippet sheetTabs()}
  {#if aiAvailable}
    <div data-touch-density="touch">{@render tabSwitch()}</div>
  {/if}
{/snippet}

{#snippet body()}
  <!-- Montado siempre: cuenta los no leídos y recibe los mensajes en vivo aunque se vea la IA o la ventana esté cerrada. -->
  <div hidden={tab !== 'team'} class="flex min-h-0 min-w-0 flex-1 flex-col">
    <ChatPanel {projectId} {session} {me} {role} {status} {typingNames} open={visible && tab === 'team'} {ontyping} {onunread} {mobile} />
  </div>
  {#if AiPanel && aiAvailable && aiFeatures && engine}
    <!-- Una vez cargada, la IA sigue montada al cambiar de pestaña: no corta una respuesta en curso. -->
    <div hidden={tab !== 'ai'} class="flex min-h-0 min-w-0 flex-1 flex-col">
      <AiPanel {engine} {projectId} features={aiFeatures} {readOnly} attachment={aiAttachment} />
    </div>
  {:else if tab === 'ai' && aiFailed}
    <div class="flex flex-col items-start gap-2 p-3" role="alert" data-testid="ai-load-error">
      <p class="text-ink-muted">{m.editor_ai_load_error()}</p>
      <Button size="sm" variant="ghost" onclick={onretryai} data-testid="ai-load-retry">{m.common_retry()}</Button>
    </div>
  {:else if tab === 'ai'}
    <p class="p-3 text-ink-muted" role="status">{m.editor_ai_loading()}</p>
  {/if}
{/snippet}

<div bind:this={holder} hidden>
  <div bind:this={content} class="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="conversation-content">{@render body()}</div>
</div>

{#if mobile}
  <Sheet
    bind:open={() => visible, (value) => {
      if (!value) {
        layout.conversation.open = false;
        layout.conversation.minimized = false;
      }
    }}
    bind:height
    bind:level={() => layout.sheetLevels.conversation ?? 0, (value) => (layout.sheetLevels.conversation = value)}
    title={m.editor_chat_title()}
    heights={[0.5, 0.92]}
    modal={false}
    actions={sheetTabs}
    testid="conversation-sheet"
  >
    <div {@attach adopt} class="flex min-h-0 flex-1 flex-col"></div>
  </Sheet>
{:else}
<FloatingWindow
  bind:this={floating}
  bind:rect={layout.conversation.rect}
  bind:minimized={layout.conversation.minimized}
  title={m.editor_chat_title()}
  open={layout.conversation.open}
  {hidden}
  {defaultRect}
  minSize={{ w: 320, h: 360 }}
  {pillAt}
  icon={MessageSquare}
  badge={unread}
  badgeLabel={m.editor_chat_unread_count({ count: unread })}
  badgeTestid="chat-unread"
  closeLabel={m.editor_chat_close()}
  minimizeLabel={m.editor_chat_minimize()}
  restoreLabel={m.editor_chat_restore()}
  testid="conversation-window"
  header={tabSwitch}
  onclose={() => {
    layout.conversation.open = false;
    layout.conversation.minimized = false;
  }}
  {returnFocus}
>
  <div {@attach adopt} class="flex min-h-0 min-w-0 flex-1 flex-col"></div>
</FloatingWindow>
{/if}
