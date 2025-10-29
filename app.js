// Configuración y estado
const API_BASE = 'https://pokeapi.co/api/v2';
const PAGE_SIZE = 24; // tamaño de lote
const IMG = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;

const state = {
  nextUrl: `${API_BASE}/pokemon?limit=${PAGE_SIZE}`,
  loading: false,
  cache: new Map(), // id|name -> data
  types: [],
  filters: {
    search: '',
    type: '',
    region: ''
  },
  observer: null
};

// Utilidades
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
const debounce = (fn, ms = 350) => {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};
const ariaBusy = (el, val) => el.setAttribute('aria-busy', String(val));

// Servicio de API
async function fetchJSON(url, init = {}, retries = 2) {
  try {
    const res = await fetch(url, { ...init });
    if (!res.ok) {
      if (res.status === 429 && retries > 0) { // rate limit
        await new Promise(r => setTimeout(r, 600));
        return fetchJSON(url, init, retries - 1);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error('Error fetchJSON:', err);
    throw err;
  }
}

async function getPokemonPage(url) {
  const data = await fetchJSON(url);
  const ids = data.results.map(r => Number(r.url.split('/').filter(Boolean).pop()));
  // Detalles en paralelo con caché
  const details = await Promise.all(ids.map(async (id) => {
    if (state.cache.has(id)) return state.cache.get(id);
    const d = await fetchJSON(`${API_BASE}/pokemon/${id}`);
    state.cache.set(id, d);
    state.cache.set(d.name, d);
    return d;
  }));
  return { next: data.next, results: details };
}

async function getTypes() {
  if (state.types.length) return state.types;
  const data = await fetchJSON(`${API_BASE}/type`);
  // Filtra tipos no oficiales si vinieran (como 'unknown', 'shadow')
  state.types = data.results
    .map(t => t.name)
    .filter(n => !['unknown', 'shadow'].includes(n))
    .sort((a, b) => a.localeCompare(b));
  return state.types;
}

async function getByType(typeName, offset = 0, limit = PAGE_SIZE) {
  const data = await fetchJSON(`${API_BASE}/type/${typeName}`);
  const slice = data.pokemon.slice(offset, offset + limit);
  const details = await Promise.all(slice.map(async ({ pokemon }) => {
    const id = Number(pokemon.url.split('/').filter(Boolean).pop());
    if (state.cache.has(id)) return state.cache.get(id);
    const d = await fetchJSON(`${API_BASE}/pokemon/${id}`);
    state.cache.set(id, d); state.cache.set(d.name, d);
    return d;
  }));
  const hasMore = offset + limit < data.pokemon.length;
  return { details, hasMore, total: data.pokemon.length };
}

// Render
function typePill(name) {
  const span = document.createElement('span');
  span.className = 'type-pill';
  span.textContent = name;
  span.dataset.type = name;
  return span;
}

function statItem(name, value) {
  const li = document.createElement('li');
  li.textContent = `${name}: ${value}`;
  return li;
}

function abilityItem(name, hidden) {
  const li = document.createElement('li');
  li.textContent = hidden ? `${name} (oculta)` : name;
  return li;
}

function createCard(p) {
  const tpl = $('#card-template');
  const node = tpl.content.firstElementChild.cloneNode(true);

  const id = p.id.toString().padStart(4, '0');
  const img = $('.card__img', node);
  const name = $('.card__name', node);
  const number = $('.card__id', node);
  const types = $('.card__types', node);
  const stats = $('.card__stats', node);
  const abilities = $('.card__abilities', node);

  img.src = IMG(p.id);
  img.alt = `Imagen oficial de ${p.name}`;
  name.textContent = p.name;
  number.textContent = `#${id}`;

  types.replaceChildren(...p.types.map(t => typePill(t.type.name)));

  stats.replaceChildren(...p.stats.map(s => statItem(s.stat.name, s.base_stat)));
  abilities.replaceChildren(...p.abilities.map(a => abilityItem(a.ability.name, a.is_hidden)));

  // Mejora de rendimiento: placeholder skeleton si se desea
  // img.addEventListener('load', () => node.classList.remove('skeleton'));

  return node;
}

function renderBatch(pokemonList, append = true) {
  const grid = $('#grid');
  const fragment = document.createDocumentFragment();
  pokemonList.forEach(p => fragment.appendChild(createCard(p)));
  if (append) grid.appendChild(fragment); else grid.replaceChildren(fragment);
}

function setStatus(msg) {
  const s = $('#status');
  s.textContent = msg;
}

// Carga incremental + filtros
let typeOffset = 0;
let typeHasMore = true;

async function loadNextPage({ reset = false } = {}) {
  if (state.loading) return;
  const grid = $('#grid');
  state.loading = true;
  ariaBusy(grid, true);
  setStatus('Cargando…');

  try {
    if (reset) {
      // Reset de estado de tipo
      typeOffset = 0;
      typeHasMore = true;
    }

    let details = [];
    if (state.filters.type) {
      if (!typeHasMore) return; // nada más que cargar
      const { details: d, hasMore } = await getByType(state.filters.type, typeOffset, PAGE_SIZE);
      details = d;
      typeOffset += PAGE_SIZE;
      typeHasMore = hasMore;
    } else {
      if (!state.nextUrl) return;
      const page = await getPokemonPage(state.nextUrl);
      state.nextUrl = page.next;
      details = page.results;
    }

    // Filtro de búsqueda en cliente (nombre o id)
    const q = state.filters.search.trim().toLowerCase();
    if (q) {
      details = details.filter(p => {
        const idMatch = /^\d+$/.test(q) ? p.id === Number(q) : false;
        const nameMatch = p.name.toLowerCase().includes(q);
        return idMatch || nameMatch;
      });
    }

    // Render
    if (reset) renderBatch(details, false); else renderBatch(details, true);

    setStatus(details.length ? `Mostrando ${$$('.card').length} Pokémon` : 'Sin resultados');
  } catch (err) {
    console.error(err);
    setStatus('Ocurrió un error al cargar. Intenta de nuevo.');
  } finally {
    state.loading = false;
    ariaBusy($('#grid'), false);
  }
}

// Inicialización UI
async function init() {
  // Poblar tipos
  const select = $('#type');
  const types = await getTypes();
  types.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    select.appendChild(opt);
  });

  // Observador para scroll infinito
  const sentinel = $('#sentinel');
  state.observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        loadNextPage();
      }
    }
  }, { rootMargin: '800px 0px 800px 0px' });
  state.observer.observe(sentinel);

  // Eventos de controles
  const onSearch = debounce(() => {
    state.filters.search = $('#search').value;
    // Reiniciar lista con filtros
    refreshList();
  }, 400);

  $('#search').addEventListener('input', onSearch);
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      state.filters.search = $('#search').value;
      refreshList();
    }
  });

  $('#type').addEventListener('change', async (e) => {
    state.filters.type = e.target.value;
    // Al cambiar tipo, “paginación” por tipo
    await refreshList();
  });

  // Primera carga
  await loadNextPage();
}

async function refreshList() {
  // Cuando hay filtros, reseteamos flujo:
  // - si hay tipo: reiniciar offsets de tipo y limpiar grid
  // - si NO hay tipo: limpiar grid y rehacer flujo desde inicio
  const grid = $('#grid');
  grid.replaceChildren(); // limpiar
  setStatus('Actualizando…');

  if (state.filters.type) {
    typeOffset = 0;
    typeHasMore = true;
    await loadNextPage({ reset: true });
  } else {
    // reset de navegación normal
    state.nextUrl = `${API_BASE}/pokemon?limit=${PAGE_SIZE}`;
    await loadNextPage({ reset: true });
  }
}

// Listo
init().catch(err => {
  console.error(err);
  setStatus('No se pudo iniciar la aplicación.');
});