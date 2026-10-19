<script lang="ts">
  import { untrack } from 'svelte';
  import { ApiError, browser } from '../../lib/api.ts';
  import { publishTemplate } from '../../lib/templates.ts';
  import { m } from '../../paraglide/messages.js';
  import Button from '../../ui/Button.svelte';
  import Dialog from '../../ui/Dialog.svelte';
  import Field from '../../ui/Field.svelte';
  import Input from '../../ui/Input.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';

  type Props = {
    open: boolean;
    projectId: string;
    projectName: string;
    workspaceSlug: string;
    workspaceName: string;
    // Sube antes la vista previa pendiente para que la plantilla salga con la imagen actual.
    beforePublish: () => Promise<void>;
  };

  let { open = $bindable(false), projectId, projectName, workspaceSlug, workspaceName, beforePublish }: Props = $props();

  const DESCRIPTION_MAX = 500;

  let name = $state('');
  let description = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  $effect(() => {
    if (!open) return;
    untrack(() => {
      name = projectName;
      description = '';
      error = null;
    });
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      error = m.dashboard_name_required();
      return;
    }
    busy = true;
    error = null;
    try {
      await beforePublish();
      const text = description.trim();
      await publishTemplate(projectId, text ? { name: trimmed, description: text } : { name: trimmed });
      open = false;
      showToast({
        message: m.publish_template_done({ space: workspaceName }),
        tone: 'success',
        action: { label: m.publish_template_view(), run: () => browser.assign(`/app/e/${workspaceSlug}?vista=plantillas`) },
      });
    } catch (cause) {
      // Sin red o con demasiadas peticiones, apiFetch ya avisó.
      const notified = cause instanceof ApiError && (cause.code === 'NETWORK' || cause.code === 'RATE_LIMITED');
      if (!notified) error = cause instanceof ApiError ? cause.message : m.error_internal();
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open title={m.publish_template_title()} description={m.publish_template_body({ space: workspaceName })}>
  <form onsubmit={submit} class="flex flex-col gap-5" novalidate>
    <Field label={m.publish_template_name()} {error}>
      {#snippet children(control)}
        <Input id={control.id} describedBy={control.describedBy} invalid={control.invalid} bind:value={name} maxlength={80} autocomplete="off" />
      {/snippet}
    </Field>
    <Field label={m.publish_template_description()} hint={m.publish_template_description_hint({ max: DESCRIPTION_MAX })}>
      {#snippet children(control)}
        <textarea
          id={control.id}
          aria-describedby={control.describedBy}
          bind:value={description}
          rows="3"
          maxlength={DESCRIPTION_MAX}
          class="w-full resize-y rounded-panel border border-edge bg-surface-2 px-3.5 py-2.5 text-base text-ink hover:border-ink-muted focus-visible:border-coral"
        ></textarea>
      {/snippet}
    </Field>
    <div class="flex justify-end gap-2">
      <Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
      <Button type="submit" variant="primary" loading={busy}>{busy ? m.publish_template_busy() : m.publish_template_submit()}</Button>
    </div>
  </form>
</Dialog>
