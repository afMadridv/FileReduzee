// Pestañas Comprimir / Convertir. Patrón WAI-ARIA de tabs: flechas para
// moverse, Inicio/Fin a los extremos, y el hash de la URL (#convertir) para
// poder enlazar directo a una pestaña.

const tabs = [...document.querySelectorAll('[role="tab"]')];

function select(tab, { focus = false, updateHash = true } = {}) {
  tabs.forEach((t) => {
    const active = t === tab;
    t.setAttribute('aria-selected', String(active));
    t.tabIndex = active ? 0 : -1;
    t.classList.toggle('is-active', active);
    document.getElementById(t.getAttribute('aria-controls')).hidden = !active;
  });
  if (focus) tab.focus();
  if (updateHash) history.replaceState(null, '', `#${tab.dataset.tab}`);
}

tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => select(tab));
  tab.addEventListener('keydown', (e) => {
    const moves = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    select(tabs[(moves[e.key] + tabs.length) % tabs.length], { focus: true });
  });
});

function fromHash() {
  const wanted = tabs.find((t) => `#${t.dataset.tab}` === location.hash) ?? tabs[0];
  select(wanted, { updateHash: false });
}

window.addEventListener('hashchange', fromHash);
fromHash();
