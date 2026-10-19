// Sin ellas, astro.config.ts cae a los orígenes de localhost.
const REQUIRED = ['PUBLIC_API_ORIGIN', 'PUBLIC_COLLAB_ORIGIN', 'PUBLIC_SITE_ORIGIN', 'PUBLIC_STORAGE_ORIGIN'] as const;

const problems: string[] = [];
for (const name of REQUIRED) {
  const value = process.env[name]?.trim();
  if (!value) {
    problems.push(`${name}: es obligatoria en el build de la imagen`);
    continue;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    problems.push(`${name}: no es una URL válida`);
    continue;
  }
  if (!/^https?:$/.test(url.protocol) || url.origin !== value.replace(/\/$/, '')) {
    problems.push(`${name}: debe ser un origen http(s) sin ruta (p. ej. https://api.parcify.app)`);
  }
  // up.railway.app está en la Public Suffix List: cada servicio sería un sitio distinto y la cookie no viajaría.
  if (url.hostname.endsWith('.up.railway.app') && name !== 'PUBLIC_STORAGE_ORIGIN') {
    problems.push(`${name}: los dominios *.up.railway.app no sirven; usa un dominio propio compartido`);
  }
}

const dsn = process.env.PUBLIC_SENTRY_DSN?.trim();
if (dsn && !URL.canParse(dsn)) problems.push('PUBLIC_SENTRY_DSN: no es una URL válida');

if (problems.length > 0) {
  console.error(`Variables PUBLIC_* inválidas:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('Variables PUBLIC_* correctas');
