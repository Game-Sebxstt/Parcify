<script lang="ts">
  import type { z } from 'zod';
  import { ApiError, apiFetch, browser } from '../../lib/api.ts';
  import { assetUrl, SMALL_IMAGE_ACCEPT, uploadSmallImage } from '../../lib/assets.ts';
  import { loadWorkspaces } from '../../lib/workspaces.svelte.ts';
  import { m } from '../../paraglide/messages.js';
  import { WorkspaceDetailSchema } from '../../shared/api/workspaces.js';
  import Avatar from '../../ui/Avatar.svelte';
  import Button from '../../ui/Button.svelte';
  import Field from '../../ui/Field.svelte';
  import Input from '../../ui/Input.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import ConfirmDialog from './ConfirmDialog.svelte';

  type Detail = z.infer<typeof WorkspaceDetailSchema>;
  type Props = { workspace: Detail; onupdated: (detail: Detail) => void };
  let { workspace, onupdated }: Props = $props();

  let name = $derived(workspace.name);
  let nameError = $state<string | null>(null);
  let saving = $state(false);
  let uploading = $state(false);
  let logo = $state<string | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let confirmOpen = $state(false);
  let deleting = $state(false);

  $effect(() => {
    const id = workspace.logoAssetId;
    logo = null;
    if (id) void assetUrl(id).then((url) => (logo = url));
  });

  const path = $derived(`/v1/workspaces/${encodeURIComponent(workspace.slug)}`);

  async function patch(body: { name?: string; logoAssetId?: string | null }) {
    const detail = await apiFetch(path, { method: 'PATCH', body, schema: WorkspaceDetailSchema });
    onupdated(detail);
    await loadWorkspaces({ force: true });
    return detail;
  }

  async function saveName(event: SubmitEvent) {
    event.preventDefault();
    const next = name.trim();
    if (!next) {
      nameError = m.dashboard_name_required();
      return;
    }
    saving = true;
    nameError = null;
    try {
      await patch({ name: next });
      showToast({ message: m.workspace_saved(), tone: 'success' });
    } catch (error) {
      nameError = error instanceof ApiError ? error.message : m.error_internal();
    } finally {
      saving = false;
    }
  }

  async function chooseLogo(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    uploading = true;
    try {
      const asset = await uploadSmallImage(file, { purpose: 'logo', workspaceSlug: workspace.slug });
      await patch({ logoAssetId: asset.id });
      showToast({ message: m.workspace_logo_saved(), tone: 'success' });
    } catch (error) {
      showToast({ message: error instanceof ApiError ? error.message : m.error_internal(), tone: 'error' });
    } finally {
      uploading = false;
    }
  }

  async function removeLogo() {
    try {
      await patch({ logoAssetId: null });
    } catch (error) {
      showToast({ message: error instanceof ApiError ? error.message : m.error_internal(), tone: 'error' });
    }
  }

  async function trash() {
    deleting = true;
    try {
      await apiFetch(path, { method: 'DELETE' });
      await loadWorkspaces({ force: true });
      browser.assign('/app');
    } catch (error) {
      showToast({ message: error instanceof ApiError ? error.message : m.error_internal(), tone: 'error' });
      deleting = false;
    }
  }
</script>

<div class="flex max-w-2xl flex-col gap-4">
  <section aria-labelledby="ws-name" class="rounded-panel bg-surface-1 p-5">
    <h2 id="ws-name" class="text-lg font-semibold">{m.workspace_settings_name()}</h2>
    <form class="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start" onsubmit={saveName} novalidate>
      <div class="flex-1">
        <Field label={m.workspace_name_label()} error={nameError}>
          {#snippet children(control)}
            <Input id={control.id} describedBy={control.describedBy} invalid={control.invalid} bind:value={name} maxlength={80} />
          {/snippet}
        </Field>
      </div>
      <Button type="submit" class="sm:mt-7" loading={saving} disabled={name.trim() === workspace.name}>{m.common_save()}</Button>
    </form>
  </section>

  <section aria-labelledby="ws-logo" class="rounded-panel bg-surface-1 p-5">
    <h2 id="ws-logo" class="text-lg font-semibold">{m.workspace_logo_title()}</h2>
    <p class="mt-1 text-sm text-ink-muted">{m.workspace_logo_hint()}</p>
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <Avatar name={workspace.name} src={logo} size="lg" />
      <input bind:this={fileInput} type="file" accept={SMALL_IMAGE_ACCEPT} class="sr-only" tabindex="-1" aria-hidden="true" onchange={chooseLogo} />
      <Button loading={uploading} onclick={() => fileInput?.click()}>{m.workspace_logo_change()}</Button>
      {#if workspace.logoAssetId}
        <Button variant="ghost" onclick={() => void removeLogo()}>{m.workspace_logo_remove()}</Button>
      {/if}
    </div>
  </section>

  {#if workspace.role === 'owner' && !workspace.personal}
    <section aria-labelledby="ws-delete" class="rounded-panel bg-surface-1 p-5">
      <h2 id="ws-delete" class="text-lg font-semibold">{m.workspace_delete_title()}</h2>
      <p class="mt-1 text-sm text-ink-muted">{m.workspace_delete_body()}</p>
      <div class="mt-4">
        <Button variant="danger" onclick={() => (confirmOpen = true)}>{m.workspace_delete_action()}</Button>
      </div>
    </section>
  {/if}
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  title={m.workspace_delete_confirm({ name: workspace.name })}
  description={m.workspace_delete_body()}
  confirmLabel={m.workspace_delete_action()}
  danger
  busy={deleting}
  onconfirm={() => void trash()}
/>
