<script lang="ts">
  import { ApiError, apiFetch, invalidateCache } from '../../lib/api.ts';
  import { assetUrl, SMALL_IMAGE_ACCEPT, uploadSmallImage } from '../../lib/assets.ts';
  import { session } from '../../lib/session.svelte.ts';
  import { m } from '../../paraglide/messages.js';
  import { MeResponseSchema, type MeResponse } from '../../shared/api/me.js';
  import Avatar from '../../ui/Avatar.svelte';
  import Button from '../../ui/Button.svelte';
  import Field from '../../ui/Field.svelte';
  import Input from '../../ui/Input.svelte';
  import { showToast } from '../../ui/toast.svelte.ts';
  import { nameError } from '../auth/validate.ts';

  const BIO_MAX = 280;

  type Props = { me: MeResponse };
  let { me }: Props = $props();

  let name = $derived(me.user.name);
  let bio = $derived(me.user.bio ?? '');
  let errors = $state<{ name: string | null; bio: string | null }>({ name: null, bio: null });
  let saving = $state(false);
  let uploading = $state(false);
  let avatar = $state<string | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  $effect(() => {
    const id = me.user.avatarAssetId;
    avatar = null;
    if (id) void assetUrl(id, 'medium').then((url) => (avatar = url));
  });

  const dirty = $derived(name.trim() !== me.user.name || bio.trim() !== (me.user.bio ?? ''));

  async function patch(body: Record<string, unknown>) {
    const updated = await apiFetch('/v1/me', { method: 'PATCH', body, schema: MeResponseSchema });
    invalidateCache('me');
    session.me = updated;
    return updated;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    errors = { name: nameError(name), bio: bio.length > BIO_MAX ? m.settings_bio_too_long({ max: BIO_MAX }) : null };
    if (errors.name || errors.bio) return;
    saving = true;
    try {
      await patch({ name: name.trim(), bio: bio.trim() === '' ? null : bio.trim() });
      showToast({ message: m.settings_profile_saved(), tone: 'success' });
    } catch (error) {
      errors = { ...errors, name: error instanceof ApiError ? error.message : m.error_internal() };
    } finally {
      saving = false;
    }
  }

  async function choose(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    uploading = true;
    try {
      const asset = await uploadSmallImage(file, { purpose: 'avatar' });
      await patch({ avatarAssetId: asset.id });
      showToast({ message: m.settings_avatar_saved(), tone: 'success' });
    } catch (error) {
      showToast({ message: error instanceof ApiError ? error.message : m.error_internal(), tone: 'error' });
    } finally {
      uploading = false;
    }
  }

  async function removeAvatar() {
    try {
      await patch({ avatarAssetId: null });
    } catch (error) {
      showToast({ message: error instanceof ApiError ? error.message : m.error_internal(), tone: 'error' });
    }
  }
</script>

<section aria-labelledby="profile-heading" class="rounded-panel bg-surface-1 p-5 sm:p-6">
  <h2 id="profile-heading" class="text-lg font-semibold">{m.settings_profile()}</h2>
  <div class="mt-4 flex flex-wrap items-center gap-3">
    <Avatar name={me.user.name} src={avatar} size="lg" />
    <input
      bind:this={fileInput}
      type="file"
      accept={SMALL_IMAGE_ACCEPT}
      class="sr-only"
      tabindex="-1"
      aria-hidden="true"
      data-testid="avatar-input"
      onchange={choose}
    />
    <Button loading={uploading} onclick={() => fileInput?.click()}>{m.settings_avatar_change()}</Button>
    {#if me.user.avatarAssetId}
      <Button variant="ghost" onclick={() => void removeAvatar()}>{m.settings_avatar_remove()}</Button>
    {/if}
    <p class="w-full text-xs text-ink-muted">{m.settings_avatar_hint()}</p>
  </div>
  <form class="mt-5 flex flex-col gap-4" onsubmit={save} novalidate>
    <Field label={m.auth_field_name()} error={errors.name}>
      {#snippet children(control)}
        <Input id={control.id} describedBy={control.describedBy} invalid={control.invalid} bind:value={name} maxlength={80} autocomplete="name" />
      {/snippet}
    </Field>
    <Field label={m.settings_bio()} hint={m.settings_bio_hint({ max: BIO_MAX })} error={errors.bio}>
      {#snippet children(control)}
        <textarea
          id={control.id}
          aria-describedby={control.describedBy}
          aria-invalid={control.invalid || undefined}
          bind:value={bio}
          rows="3"
          maxlength={BIO_MAX}
          class="w-full resize-y rounded-panel border border-edge bg-surface-2 px-3.5 py-2.5 text-base text-ink hover:border-ink-muted focus-visible:border-coral aria-invalid:border-danger"
        ></textarea>
      {/snippet}
    </Field>
    <div><Button type="submit" loading={saving} disabled={!dirty}>{m.common_save()}</Button></div>
  </form>
</section>
