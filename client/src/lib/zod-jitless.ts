import { config } from 'zod';

// Zod compila sus esquemas con new Function() si puede; la CSP del worker no admite eval. Se configura antes de que
// se construya ningún esquema (zod lee jitless al construirlos).
config({ jitless: true });
