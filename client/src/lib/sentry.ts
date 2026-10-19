import type { Breadcrumb, ErrorEvent } from '@sentry/browser';

// La query y el fragmento pueden llevar tokens (el de una invitación va en el fragmento).
function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (!breadcrumb.data) return breadcrumb;
  const data: Record<string, unknown> = { ...breadcrumb.data };
  for (const key of ['url', 'from', 'to']) {
    const value = data[key];
    if (typeof value === 'string') data[key] = withoutQuery(value);
  }
  for (const key of Object.keys(data)) if (/query|fragment|body|header|cookie/i.test(key)) delete data[key];
  return { ...breadcrumb, data };
}

// Lo que sale hacia Sentry no lleva cookies, cabeceras, cuerpos, query ni datos del usuario salvo su id.
export function scrubEvent<T extends ErrorEvent>(event: T): T {
  const request = event.request;
  if (request) {
    delete request.cookies;
    delete request.data;
    delete request.query_string;
    delete request.env;
    if (request.url) request.url = withoutQuery(request.url);
    if (request.headers) {
      request.headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => name.toLowerCase() === 'user-agent'));
    }
  }
  if (event.user) event.user = event.user.id === undefined ? {} : { id: event.user.id };
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  return event;
}

let started = false;

// Solo con PUBLIC_SENTRY_DSN en el build: sin él, el SDK no se descarga.
export async function initSentry(): Promise<boolean> {
  const dsn = import.meta.env.PUBLIC_SENTRY_DSN;
  if (!dsn || started) return started;
  started = true;
  const Sentry = await import('@sentry/browser');
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // En el SDK 11, `dataCollection` sustituye a `sendDefaultPii`: por defecto lo recoge casi todo.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      stackFrameVariables: false,
    },
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
  return true;
}
