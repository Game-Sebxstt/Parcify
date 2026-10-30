// Búsqueda de la URL actual, compartida entre las islas de una página: la barra lateral marca la vista activa aunque
// la página la cambie con history.replaceState (pestañas de un espacio, filtro de papelera).
export const appLocation = $state({ search: '' });

export function syncAppLocation() {
  appLocation.search = window.location.search;
}

export function replaceAppUrl(url: URL) {
  history.replaceState(history.state, '', `${url.pathname}${url.search}`);
  appLocation.search = url.search;
}
