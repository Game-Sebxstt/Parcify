import { createHash } from 'node:crypto';

// Se ejecuta en <head> antes de pintar: con la barra lateral plegada (AppShell guarda la preferencia), la página sale ya
// a 56 px en vez de saltar desde 240 al hidratar. Va en línea, así que la CSP lo admite por su hash (astro.config.ts).
export const SIDEBAR_BOOT =
  "try{if(JSON.parse(localStorage.getItem('parcify:sidebar')||'{}').collapsed===true)document.documentElement.dataset.sidebar='collapsed'}catch{}";

export const SIDEBAR_BOOT_HASH: `sha256-${string}` = `sha256-${createHash('sha256').update(SIDEBAR_BOOT).digest('base64')}`;
