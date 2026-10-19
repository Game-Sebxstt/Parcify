import { expect, test } from '@playwright/test';
import { createVerifiedAccount } from './helpers/account.ts';
import { readWorkspaceInviteLink } from './helpers/invite.ts';

test('invitación al espacio de principio a fin desde la pestaña de miembros', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const label = `ws-invite-${test.info().project.name}`;
  const ana = await createVerifiedAccount(page.request, `${label}-a`, 'Ana Invita');
  const beaContext = await browser.newContext();
  const bea = await beaContext.newPage();
  const beaAccount = await createVerifiedAccount(bea.request, `${label}-b`, 'Bea Invitada');
  const carlaContext = await browser.newContext();
  const carla = await carlaContext.newPage();
  const carlaAccount = await createVerifiedAccount(carla.request, `${label}-c`, 'Carla Ajena');

  await page.goto(`/app/e/${ana.workspaceSlug}?vista=miembros`);
  const invite = page.getByRole('region', { name: 'Invitar al espacio' });
  await invite.getByLabel('Email').fill(beaAccount.email);
  await invite.getByLabel('Rol').selectOption({ label: 'Miembro' });
  await invite.getByRole('button', { name: 'Enviar invitación' }).click();
  await expect(page.getByText(`Invitación enviada a ${beaAccount.email}.`)).toBeVisible();
  await expect(invite.getByTestId('pending-invitation')).toContainText(beaAccount.email);

  const link = await readWorkspaceInviteLink(page.request, beaAccount.email);

  // Con otra cuenta, la invitación no existe y se ofrece entrar con otra.
  await carla.goto(link);
  await expect(carla.getByTestId('invite-error')).toHaveText(
    `No encontramos esta invitación para la cuenta con la que entraste (${carlaAccount.email}).`,
  );
  await expect(carla.getByRole('button', { name: 'Entrar con otra cuenta' })).toBeVisible();

  await bea.goto(link);
  await expect(bea.getByTestId('invite-message')).toHaveText(/^Ana Invita te invita a unirte a .+ como miembro\.$/);
  await bea.getByRole('button', { name: 'Aceptar' }).click();
  await expect(bea).toHaveURL(`/app/e/${ana.workspaceSlug}`);

  // Ana ve a Bea entre los miembros y la invitación deja de estar pendiente.
  await page.reload();
  await expect(page.getByRole('list', { name: 'Miembros' }).getByRole('listitem').filter({ hasText: 'Bea Invitada' })).toBeVisible();
  await expect(page.getByTestId('pending-invitation')).toHaveCount(0);

  // Volver a abrir el enlace ya aceptado lleva al espacio.
  await bea.goto(link);
  await expect(bea.getByText('Esta invitación ya se aceptó, se rechazó o se anuló.')).toBeVisible();
  await expect(bea.getByRole('link', { name: 'Ir al espacio' })).toHaveAttribute('href', `/app/e/${ana.workspaceSlug}`);

  await beaContext.close();
  await carlaContext.close();
});
