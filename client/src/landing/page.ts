const reduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reduceMotion === '1';

// Entradas de cada sección, una vez. Solo se ocultan las piezas que aún no se ven, así que sin JS
// o con el script tarde no queda nada escondido.
export function revealOnScroll() {
  if (reduced() || !('IntersectionObserver' in window)) return;
  const items = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
  const pending = items.filter((item) => item.getBoundingClientRect().top > window.innerHeight * 0.9);
  const order = new Map<Element, number>();
  for (const item of pending) {
    const section = item.closest('section, footer') ?? document.body;
    const index = order.get(section) ?? 0;
    order.set(section, index + 1);
    item.style.setProperty('--reveal-delay', `${Math.min(index, 6) * 75}ms`);
    item.classList.add('reveal-pending');
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.1 },
  );
  for (const item of pending) observer.observe(item);
}

// Pestañas de «En vivo»: señalar o enfocar una pestaña cambia la vista previa del cuadro.
export function bindIndexWithPreview() {
  const root = document.querySelector<HTMLElement>('[data-index]');
  if (!root) return;
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const plates = [...root.querySelectorAll<HTMLElement>('[data-preview]')];
  for (const plate of plates) plate.hidden = false;
  root.classList.add('is-enhanced');

  const select = (tab: HTMLButtonElement, focus = false) => {
    const id = tab.dataset.tab;
    for (const other of tabs) {
      const active = other === tab;
      other.setAttribute('aria-selected', String(active));
      other.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(other.getAttribute('aria-controls') ?? '');
      if (panel) panel.hidden = !active;
    }
    for (const plate of plates) plate.classList.toggle('is-on', plate.dataset.preview === id);
    if (focus) tab.focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') select(tab);
    });
    tab.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      select(tabs[(index + step + tabs.length) % tabs.length]!, true);
    });
  });
}
