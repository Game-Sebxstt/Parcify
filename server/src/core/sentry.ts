import type * as SentryNode from '@sentry/node';
import type { Breadcrumb, ErrorEvent, NodeOptions } from '@sentry/node';
import type { Config } from './config.js';

type SentryModule = typeof SentryNode;
type DataCollection = NonNullable<NodeOptions['dataCollection']>;

// Ni usuario, ni cookies, ni cabeceras, ni cuerpos, ni query, ni variables locales, ni prompts.
export const NO_PERSONAL_DATA: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

// Solo se carga con SENTRY_DSN: sin él, el SDK ni se importa.
let sentry: SentryModule | null = null;

// Cabeceras que pueden llevar credenciales o la IP real del cliente.
const SECRET_HEADERS = /^(cookie|set-cookie|authorization|proxy-authorization|x-parcify-client-ip|x-forwarded-for|x-real-ip)$/i;

// La query y el fragmento pueden llevar tokens (enlaces de invitación, claves de proveedores).
function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (!breadcrumb.data) return breadcrumb;
  const data: Record<string, unknown> = { ...breadcrumb.data };
  if (typeof data.url === 'string') data.url = withoutQuery(data.url);
  for (const key of Object.keys(data)) if (/query|fragment|body|header|cookie/i.test(key)) delete data[key];
  return { ...breadcrumb, data };
}

// Lo que sale hacia Sentry no lleva cookies, cabeceras de credenciales, cuerpos ni query.
export function scrubEvent<T extends ErrorEvent>(event: T): T {
  const request = event.request;
  if (request) {
    delete request.cookies;
    delete request.data;
    delete request.query_string;
    delete request.env;
    if (request.url) request.url = withoutQuery(request.url);
    if (request.headers) {
      request.headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !SECRET_HEADERS.test(name)));
    }
  }
  if (event.user) event.user = event.user.id === undefined ? {} : { id: event.user.id };
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  return event;
}

export async function initSentry(config: Pick<Config, 'sentryDsn' | 'nodeEnv' | 'service' | 'instanceId'>): Promise<boolean> {
  if (!config.sentryDsn || sentry) return sentry !== null;
  const module = await import('@sentry/node');
  module.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    serverName: config.instanceId,
    // En el SDK 11, `dataCollection` sustituye a `sendDefaultPii`: por defecto lo recoge casi todo.
    dataCollection: NO_PERSONAL_DATA,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    initialScope: { tags: { service: config.service } },
  });
  sentry = module;
  return true;
}

// Sin Sentry no hace nada: el error ya está en el log.
export function captureError(error: unknown, tags?: Record<string, string>): void {
  sentry?.captureException(error, tags ? { tags } : undefined);
}

// Envía lo pendiente antes de salir, sin apagar el cliente: un error durante el cierre aún se captura.
export async function flushSentry(): Promise<void> {
  await sentry?.flush(2_000);
}
