import type { AuthActions } from '../../lib/auth.ts';

export type AuthStep = 'sign-in' | 'sign-up' | 'verify' | 'forgot' | 'reset';

// Lo que cada paso necesita del overlay: acciones, navegación entre pasos y salida con sesión.
export type StepContext = {
  actions: AuthActions;
  go: (step: AuthStep, notice?: string | null) => void;
  finish: (target: string) => void;
  returnTo: string | null;
};
