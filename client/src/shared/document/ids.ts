const ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

export const NODE_ID_LENGTH = 21;

// Mismo formato que nanoid, sin depender del paquete para que funcione igual en Node y en el navegador.
export function newNodeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(NODE_ID_LENGTH));
  let id = '';
  for (const byte of bytes) id += ALPHABET[byte & 63];
  return id;
}
