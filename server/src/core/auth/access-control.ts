import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access';

export const statements = {
  ...defaultStatements,
  project: ['create', 'delete'],
  template: ['publish', 'delete'],
  ai: ['viewUsage'],
} as const;

export const ac = createAccessControl(statements);

export const roles = {
  owner: ac.newRole({
    ...ownerAc.statements,
    project: ['create', 'delete'],
    template: ['publish', 'delete'],
    ai: ['viewUsage'],
  }),
  admin: ac.newRole({
    ...adminAc.statements,
    project: ['create', 'delete'],
    template: ['publish', 'delete'],
    ai: ['viewUsage'],
  }),
  // Publicar plantilla exige además ser admin del proyecto; eso lo comprueba el servicio.
  member: ac.newRole({
    ...memberAc.statements,
    project: ['create'],
    template: ['publish'],
    ai: [],
  }),
};
