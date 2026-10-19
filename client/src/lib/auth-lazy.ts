import type { AccountActions, AuthActions } from './auth.ts';

// El cliente de Better Auth pesa: estas versiones lo descargan en la primera llamada.
const load = () => import('./auth.ts');

function lazy<T extends Record<string, (...args: never[]) => Promise<unknown>>>(pick: (module: Awaited<ReturnType<typeof load>>) => T): T {
  return new Proxy({} as T, {
    get: (_target, key: string) =>
      async (...args: unknown[]) => {
        const actions = pick(await load()) as unknown as Record<string, (...input: unknown[]) => Promise<unknown>>;
        return actions[key]!(...args);
      },
  });
}

export const lazyAuthActions: AuthActions = lazy((module) => module.authActions);
export const lazyAccountActions: AccountActions = lazy((module) => module.accountActions);
