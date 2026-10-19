import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';

// Imágenes de prueba generadas al vuelo: así no hay binarios en el repositorio.

export async function png(width = 64, height = 48, options: { alpha?: boolean; color?: string } = {}) {
  return sharp({
    create: {
      width,
      height,
      channels: options.alpha ? 4 : 3,
      background: options.color ?? (options.alpha ? { r: 200, g: 40, b: 40, alpha: 0.5 } : '#3366cc'),
    },
  })
    .png()
    .toBuffer();
}

export async function gif(width = 32, height = 32) {
  return sharp({ create: { width, height, channels: 3, background: '#22aa66' } }).gif().toBuffer();
}

// JPEG con EXIF y coordenadas GPS (IFD3).
export async function jpegWithGps() {
  return sharp({ create: { width: 80, height: 60, channels: 3, background: '#996633' } })
    .jpeg()
    .withExif({
      IFD0: { Copyright: 'Parcify pruebas', Make: 'Prueba' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '40/1 25/1 0/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '3/1 42/1 0/1',
      },
    })
    .toBuffer();
}

export function svg(): Buffer {
  return Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60">' +
      '<rect width="120" height="60" fill="#ff7a59"/><circle cx="60" cy="30" r="20" fill="#ffffff"/></svg>',
  );
}

export function htmlPretendingToBePng(): Buffer {
  return Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>');
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// PNG válido de 20.000 × 20.000 px que pesa unos cientos de bytes: 400 megapíxeles al decodificar.
export function decompressionBomb(): Buffer {
  const width = 20_000;
  const height = 20_000;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(1024))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
