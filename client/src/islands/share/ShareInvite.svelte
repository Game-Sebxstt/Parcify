<script lang="ts">
  import { inviteToProject, type ShareLinkRole } from '../../lib/sharing.ts';
  import { m } from '../../paraglide/messages.js';
  import { SHARE_LINK_ROLES } from '../../shared/api/share-links.js';
  import Button from '../../ui/Button.svelte';
  import Input from '../../ui/Input.svelte';
  import Select from '../../ui/Select.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import { emailError } from '../auth/validate.ts';
  import { PROJECT_ROLE_LABEL, SELECT_CLASS } from './roles.ts';

  type Props = { projectId: string; fail: (error: unknown) => void; oninvited: (kind: 'direct' | 'link') => void };
  let { projectId, fail, oninvited }: Props = $props();

  const uid = $props.id();
  let email = $state('');
  let role = $state<ShareLinkRole>('editor');
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    const address = email.trim();
    error = emailError(address);
    if (error) return;
    busy = true;
    try {
      const result = await inviteToProject(projectId, address, role);
      email = '';
      showToast({
        message: result.kind === 'direct' ? m.share_invite_direct({ name: result.member.name }) : m.share_invite_sent({ email: address }),
        tone: 'success',
      });
      oninvited(result.kind);
    } catch (cause) {
      fail(cause);
    } finally {
      busy = false;
    }
  }
</script>

<section aria-labelledby="{uid}-title" class="flex flex-col gap-3">
  <h3 id="{uid}-title" class="text-sm font-semibold">{m.share_invite_title()}</h3>
  <form onsubmit={submit} class="flex flex-col gap-2" novalidate>
    <div class="flex flex-wrap gap-2">
      <label class="sr-only" for="{uid}-email">{m.share_invite_email()}</label>
      <Input
        id="{uid}-email"
        type="email"
        autocomplete="off"
        placeholder="nombre@ejemplo.com"
        bind:value={email}
        invalid={Boolean(error)}
        describedBy="{uid}-hint {uid}-error"
        class="h-9 min-w-0 flex-1 text-sm"
      />
      <Select
        items={SHARE_LINK_ROLES.map((option) => ({ value: option, label: PROJECT_ROLE_LABEL[option]() }))}
        bind:value={() => role, (next) => (role = next as ShareLinkRole)}
        label={m.share_invite_role()}
        size="lg"
        class={SELECT_CLASS}
      />
      <Button type="submit" size="sm" variant="primary" class="h-9" loading={busy}>{m.share_invite_submit()}</Button>
    </div>
    <p id="{uid}-error" aria-live="polite" class="text-sm text-danger empty:hidden">{error ?? ''}</p>
    <p id="{uid}-hint" class="text-xs text-ink-muted">{m.share_invite_hint()}</p>
  </form>
</section>
