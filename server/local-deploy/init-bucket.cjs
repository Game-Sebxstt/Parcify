// Crea el bucket privado (si no existe) y le pone la regla CORS para el origen de la web.
const { S3Client, CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand } = require('@aws-sdk/client-s3');

const bucket = process.env.S3_BUCKET;
const origin = process.env.BUCKET_CORS_ORIGIN;
const client = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.BUCKET_INIT_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

async function ensureBucket() {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`El bucket ${bucket} ya existe`);
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 404) throw error;
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`Bucket ${bucket} creado`);
  }
}

async function main() {
  for (let attempt = 1; ; attempt++) {
    try {
      await ensureBucket();
      break;
    } catch (error) {
      if (attempt >= 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [origin],
            AllowedMethods: ['GET', 'HEAD', 'PUT'],
            AllowedHeaders: ['content-type', 'range'],
            ExposeHeaders: ['ETag', 'Content-Length', 'Content-Range'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  console.log(`CORS del bucket ${bucket} limitado a ${origin}`);
}

main().catch((error) => {
  console.error('No se pudo preparar el bucket:', error?.name ?? error);
  process.exit(1);
});
