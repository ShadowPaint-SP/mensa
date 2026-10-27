import { createMealPicker } from './meal-picker.js';
import { horizontalSwipe } from './swipe.js';

const API = 'https://api.studentenwerk-dresden.de/openmensa/v2';
const STORAGE_KEY = 'mensa-hidden-canteens-v1';
const $ = (id) => document.getElementById(id);
const dateFormat = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
const money = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
function initialMenuSelection(date) {
  const parts = Object.fromEntries(dateFormat.formatToParts(date).map(({ type, value }) => [type, value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const timeParts = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23' }).formatToParts(date);
  const hour = Number(timeParts.find(({ type }) => type === 'hour').value);
  return { today, date: weekdayOnOrAfter(hour >= 19 ? shiftDate(today, 1) : today), evening: hour >= 15 && hour < 19 };
}
const initialSelection = initialMenuSelection(new Date());
const today = initialSelection.today;

function isEveningMeal(meal) {
  // The API currently puts this prefix in category, while the reference site
  // displays it before the name. Accept either field, but not incidental mentions.
  return [meal.category, meal.name].some((value) => typeof value === 'string' && /^\s*Abendangebot\b/i.test(value));
}

function isVeganMeal(meal) {
  return Array.isArray(meal.notes) && meal.notes.some((note) => typeof note === 'string' && /^Menü ist vegan$/i.test(note.trim()));
}

function isVegetarianMeal(meal) {
  return isVeganMeal(meal) || (Array.isArray(meal.notes) &&
    meal.notes.some((note) => typeof note === 'string' && /^Menü ist vegetarisch$/i.test(note.trim())));
}

const dietaryFilters = {
  vegan: { label: 'vegan', matches: isVeganMeal },
  vegetarian: { label: 'vegetarisch', matches: isVegetarianMeal },
};

function matchesDietarySelection(meal, selection) {
  return Object.entries(selection).every(([type, mode]) =>
    mode === 'all' || dietaryFilters[type].matches(meal) === (mode === 'only')
  );
}

let eveningOnly = initialSelection.evening;
const dietarySelection = { vegan: 'all', vegetarian: 'all' };
let priceCategory = 'student';
const priceCategories = {
  student: { label: 'Student', keys: ['Studierende', 'students'] },
  employee: { label: 'Bediensteter', keys: ['Bedienstete', 'employees'] },
  guest: { label: 'Gäste', keys: ['Gäste', 'others'] },
};
const priceSources = new WeakMap();
let selectedDate = initialSelection.date;
let canteens = [];
let hidden = new Set();
let requestVersion = 0;
let listController;
const menuCache = new Map();
const mobileMeals = matchMedia('(max-width: 560px)');
let mobileDayStart;
let dayAnimations = [];

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (Array.isArray(saved)) hidden = new Set(saved.filter(Number.isInteger));
} catch { /* Browsing without storage is supported. */ }

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function asDate(iso) { return new Date(`${iso}T12:00:00Z`); }
function isoDate(date) { return date.toISOString().slice(0, 10); }
function shiftDate(iso, days) {
  const date = asDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function weekdayOnOrAfter(iso) {
  const day = asDate(iso).getUTCDay();
  return day === 6 ? shiftDate(iso, 2) : day === 0 ? shiftDate(iso, 1) : iso;
}

function shiftWeekdays(iso, days) {
  const direction = Math.sign(days);
  let remaining = Math.abs(days);
  while (remaining > 0) {
    iso = shiftDate(iso, direction);
    const weekday = asDate(iso).getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining--;
  }
  return iso;
}

function renderDays() {
  dayAnimations.forEach((animation) => animation.cancel());
  dayAnimations = [];
  $('day-viewport').querySelectorAll('.day-snapshot').forEach((snapshot) => snapshot.remove());
  $('week-days').style.transform = '';
  $('date-input').value = selectedDate;
  const weekday = (asDate(selectedDate).getUTCDay() + 6) % 7;
  const monday = shiftDate(selectedDate, -weekday);
  const dayCount = 5;
  // Initialize around the selected date; browsing the strip does not select a day.
  if (!mobileDayStart) mobileDayStart = monday;
  const start = mobileMeals.matches ? mobileDayStart : monday;
  $('previous-week').setAttribute('aria-label', mobileMeals.matches ? 'Vorheriger Wochentag' : 'Vorherige Woche');
  $('next-week').setAttribute('aria-label', mobileMeals.matches ? 'Nächster Wochentag' : 'Nächste Woche');
  $('week-days').replaceChildren();
  for (let i = 0; i < dayCount; i++) {
    const iso = shiftWeekdays(start, i);
    const date = asDate(iso);
    const button = element('button', `day-button${iso === today ? ' is-today' : ''}`);
    button.type = 'button';
    button.dataset.date = iso;
    button.setAttribute('aria-pressed', String(iso === selectedDate));
    button.setAttribute('aria-label', date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }));
    button.append(element('span', '', iso === today ? 'Heute' : ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][date.getUTCDay()]));
    button.append(element('strong', '', date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })));
    button.addEventListener('click', () => changeDate(iso));
    $('week-days').append(button);
  }
  $('menu-heading').textContent = selectedDate === today ? 'Gerichte heute' : 'Gerichte';
}

function changeDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(asDate(iso).getTime())) return;
  selectedDate = weekdayOnOrAfter(iso);
  if (mobileDayStart && (selectedDate < mobileDayStart || selectedDate > shiftWeekdays(mobileDayStart, 4))) mobileDayStart = undefined;
  renderDays();
  if (canteens.length) loadMenus();
}

function navigateDays(offset, dragOffset = 0) {
  if (!mobileMeals.matches) {
    changeDate(shiftDate(selectedDate, offset));
    return;
  }
  const grid = $('week-days');
  const oldPage = grid.cloneNode(true);
  oldPage.removeAttribute('id');
  oldPage.classList.add('day-snapshot');
  oldPage.inert = true;
  oldPage.setAttribute('aria-hidden', 'true');
  mobileDayStart = shiftWeekdays(mobileDayStart, offset);
  renderDays();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const width = $('day-viewport').clientWidth;
  const direction = offset > 0 ? 1 : -1;
  $('day-viewport').append(oldPage);
  const options = { duration: 320, easing: 'cubic-bezier(.22,.68,.18,1)' };
  const animations = [
    oldPage.animate([
      { transform: `translateX(${dragOffset}px)` },
      { transform: `translateX(${-direction * width}px)` }
    ], options),
    grid.animate([
      { transform: `translateX(${direction * width + dragOffset}px)` },
      { transform: 'translateX(0)' }
    ], options)
  ];
  dayAnimations = animations;
  Promise.all(animations.map((animation) => animation.finished.catch(() => {}))).then(() => {
    oldPage.remove();
    if (dayAnimations === animations) dayAnimations = [];
  });
}

horizontalSwipe($('day-viewport'), {
  enabled: () => mobileMeals.matches && !dayAnimations.length,
  ignoreSelector: 'a,input,select,textarea,summary,details',
  // Preserve native taps on date buttons; capture only after a horizontal drag.
  captureOnStart: false,
  onMove(dx) {
    if (mobileMeals.matches) $('week-days').style.transform = `translateX(${dx}px)`;
  },
  onEnd(dx, { cancelled, velocityX = 0 }) {
    const grid = $('week-days');
    const offset = new DOMMatrixReadOnly(getComputedStyle(grid).transform).m41;
    if (!mobileMeals.matches) { grid.style.transform = ''; return; }
    if (!cancelled && (Math.abs(dx) >= Math.min(65, $('day-viewport').clientWidth * .2) ||
        (Math.abs(dx) > 20 && Math.abs(velocityX) > .5 && dx * velocityX > 0))) {
      navigateDays(dx < 0 ? 5 : -5, offset);
    } else {
      grid.style.transform = '';
      if (offset && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const animation = grid.animate([{ transform: `translateX(${offset}px)` }, { transform: 'translateX(0)' }], { duration: 180, easing: 'ease-out' });
        dayAnimations = [animation];
        animation.finished.catch(() => {}).then(() => {
          if (dayAnimations[0] === animation) dayAnimations = [];
        });
      }
    }
  }
});

function saveSelection() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...hidden])); } catch { /* Optional preference only. */ }
}

function updateFilters() {
  const count = canteens.filter((canteen) => !hidden.has(canteen.id)).length;
  $('selection-count').textContent = `${count} / ${canteens.length}`;
  $('toggle-all').disabled = false;
  $('toggle-all').textContent = count ? 'Alle abwählen' : 'Alle auswählen';
  for (const button of $('cafeteria-options').children) {
    button.setAttribute('aria-pressed', String(!hidden.has(Number(button.dataset.id))));
  }
}

function renderFilters() {
  $('cafeteria-options').replaceChildren();
  canteens.forEach((canteen) => {
    const button = element('button', 'cafeteria-chip', canteen.name);
    button.type = 'button';
    button.dataset.id = canteen.id;
    button.addEventListener('click', () => {
      hidden.has(canteen.id) ? hidden.delete(canteen.id) : hidden.add(canteen.id);
      saveSelection();
      updateFilters();
      loadMenus();
    });
    $('cafeteria-options').append(button);
  });
  updateFilters();
}

async function fetchArray(url, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 20000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`API: ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Ungültige API-Antwort');
    return { data, next: response.headers.get('Link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function message(title, text, retry) {
  const box = element('div', 'message');
  box.append(element('h3', '', title), element('p', '', text));
  if (retry) {
    const button = element('button', 'retry-button', 'Erneut versuchen');
    button.addEventListener('click', retry);
    box.append(button);
  }
  return box;
}

function photoPlaceholder() {
  const placeholder = element('div', 'no-photo');
  // This is a decorative plate, not a substitute meal photograph.
  placeholder.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="21"/><circle cx="32" cy="32" r="15"/><path d="M3 13v13q0 5 5 5V52M8 13v13m5-13v13q0 5-5 5M59 13q-8 12-3 21h3m0-21v39"/></svg>';
  placeholder.append(element('span', '', 'Kein Foto verfügbar'));
  return placeholder;
}

function renderMealPrice(container, prices) {
  const category = priceCategories[priceCategory];
  const price = category.keys.map((key) => prices?.[key]).find((value) => typeof value === 'number' && Number.isFinite(value));
  container.replaceChildren();
  if (price === undefined) {
    container.append(element('span', 'other-price', 'Keine Preisangabe'));
  } else {
    const value = element('span', 'selected-price', money.format(price));
    value.append(element('span', 'price-label', category.label));
    container.append(value);
  }
}

const detailDialog = element('dialog', 'meal-picker picker-detail');
detailDialog.setAttribute('aria-label', 'Gericht und Allergene');
document.body.append(detailDialog);

function showMealDetails(meal) {
  const close = element('button', 'picker-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Details schließen');
  close.addEventListener('click', () => detailDialog.close());
  detailDialog.replaceChildren(close, mealCard(meal, { full: true }));
  detailDialog.showModal();
}

function mealCard(meal, { full = false } = {}) {
  const card = element('article', full ? 'meal-card' : 'meal-card meal-preview');
  const photo = element('div', 'meal-photo');
  const notes = Array.isArray(meal.notes) ? meal.notes.filter((note) => typeof note === 'string') : [];
  let imageUrl;
  try {
    const url = new URL(meal.image, 'https://api.studentenwerk-dresden.de');
    if (meal.image && url.protocol === 'https:' && !url.pathname.includes('lieber-mensen-gehen')) imageUrl = url.href;
  } catch { /* Missing or malformed images use the same honest placeholder. */ }
  if (imageUrl) {
    const image = element('img');
    image.src = imageUrl;
    image.alt = meal.name;
    image.loading = full ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => image.replaceWith(photoPlaceholder()), { once: true });
    photo.append(image);
  } else photo.append(photoPlaceholder());
  const vegan = isVeganMeal(meal);
  const vegetarian = isVegetarianMeal(meal);
  if (vegan || vegetarian) photo.append(element('span', `diet-badge${vegan ? '' : ' vegetarian'}`, vegan ? '♧ Vegan' : '♧ Vegetarisch'));
  if (meal.soldout) photo.append(element('span', 'sold-out', 'Ausverkauft'));
  const content = element('div', 'meal-content');
  content.setAttribute('role', 'region');
  content.setAttribute('aria-label', `Details: ${meal.name || 'Gericht'}`);
  content.append(element('p', 'meal-category', meal.category || 'Tagesgericht'));
  content.append(element('h4', 'meal-name', meal.name || 'Gericht ohne Bezeichnung'));
  const prices = element('div', 'meal-prices');
  priceSources.set(prices, meal.prices);
  renderMealPrice(prices, meal.prices);
  content.append(prices);
  if (full && notes.length) {
    const details = element('details', 'meal-notes');
    details.open = true;
    details.append(element('summary', '', 'Zutaten, Allergene & Hinweise'));
    const list = element('ul');
    notes.forEach((note) => list.append(element('li', '', note)));
    details.append(list);
    content.append(details);
  }
  if (!full) {
    const details = element('button', 'text-button meal-details-button', 'Gericht & Allergene');
    details.type = 'button';
    details.addEventListener('click', () => showMealDetails(meal));
    content.append(details);
    card.addEventListener('click', (event) => {
      if (event.target.closest('button,a,input,select,textarea,summary,details')) return;
      showMealDetails(meal);
    });
  }
  card.append(photo, content);
  return card;
}

function canteenSection(canteen, result) {
  const section = element('section', 'canteen-section');
  const heading = element('div', 'canteen-heading');
  const info = element('div');
  const title = element('div', 'canteen-title');
  const name = element('h3', '', canteen.name);
  name.id = `canteen-${canteen.id}`;
  section.setAttribute('aria-labelledby', name.id);
  title.append(name);
  if (typeof canteen.address === 'string' && canteen.address.trim()) {
    const route = element('a', 'canteen-route');
    route.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 3-7 18-4-7-7-4 18-7Z"/></svg>';
    route.append(element('span', '', 'Route'));
    const appleMaps = /iPhone/i.test(navigator.userAgent);
    const url = new URL(appleMaps ? 'https://maps.apple.com/' : 'https://www.google.com/maps/dir/');
    if (appleMaps) {
      url.searchParams.set('daddr', canteen.address.trim());
    } else {
      url.searchParams.set('api', '1');
      url.searchParams.set('destination', canteen.address.trim());
    }
    route.href = url.href;
    route.target = '_blank';
    route.rel = 'noopener noreferrer';
    route.setAttribute('aria-label', `Route zu ${canteen.name} in ${appleMaps ? 'Apple Maps' : 'Google Maps'} (neuer Tab)`);
    title.append(route);
  }
  info.append(title);
  heading.append(info, element('span', 'meal-count', result.error ? 'Nicht verfügbar' : `${result.meals.length} Gerichte`));
  section.append(heading);
  if (result.error) {
    const empty = element('div', 'canteen-empty', 'Dieser Speiseplan konnte nicht geladen werden. ');
    const retry = element('button', 'text-button', 'Erneut versuchen');
    retry.addEventListener('click', () => loadMenus());
    empty.append(retry);
    section.append(empty);
  } else if (!result.meals.length) {
    section.append(element('div', 'canteen-empty', 'Für diesen Tag sind keine Gerichte veröffentlicht. Die Mensa ist möglicherweise geschlossen.'));
  } else {
    const viewport = element('div', `meal-viewport${result.meals.length > 3 ? ' is-paginated' : ''}`);
    viewport.id = `meals-${canteen.id}`;
    const track = element('div', 'meal-track');
    viewport.append(track);
    section.append(viewport);
    let pageSize = mobileMeals.matches ? 1 : 3;
    const pages = [];
    function buildPages() {
      pages.length = 0;
      track.replaceChildren();
      for (let start = 0; start < result.meals.length; start += pageSize) {
        const group = element('div', 'meal-grid meal-page');
        group.append(...result.meals.slice(start, start + pageSize).map((meal) => mealCard(meal)));
        pages.push(group);
        track.append(group);
      }
    }
    buildPages();
    let page = 0;
    const navigation = element('div', 'meal-navigation');
    const previous = element('button', 'meal-arrow', '‹');
    const next = element('button', 'meal-arrow', '›');
    const status = element('span', 'meal-page-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-atomic', 'true');
    previous.type = next.type = 'button';
    previous.setAttribute('aria-label', `${canteen.name}: vorherige Gerichte`);
    next.setAttribute('aria-label', `${canteen.name}: nächste Gerichte`);
    previous.setAttribute('aria-controls', viewport.id);
    next.setAttribute('aria-controls', viewport.id);
    function renderPage() {
      const start = page * pageSize;
      track.style.transform = `translateX(-${page * 100}%)`;
      pages.forEach((group, index) => {
        group.inert = index !== page;
        group.setAttribute('aria-hidden', String(index !== page));
      });
      status.textContent = `${start + 1}–${Math.min(start + pageSize, result.meals.length)} von ${result.meals.length}`;
      previous.disabled = page === 0;
      next.disabled = start + pageSize >= result.meals.length;
    }
    previous.addEventListener('click', () => {
      if (page > 0) { page--; renderPage(); }
    });
    next.addEventListener('click', () => {
      if ((page + 1) * pageSize < result.meals.length) { page++; renderPage(); }
    });
    let dragOrigin = 0;
    horizontalSwipe(viewport, {
      enabled: () => mobileMeals.matches,
      // A tap should reach the card; capture only once it becomes a swipe.
      captureOnStart: false,
      onStart() {
        // Freeze an in-progress slide at its visual position before following the finger.
        dragOrigin = new DOMMatrixReadOnly(getComputedStyle(track).transform).m41;
        track.classList.add('is-dragging');
        track.style.transform = `translate3d(${dragOrigin}px,0,0)`;
      },
      onMove(dx) {
        if (!mobileMeals.matches) return;
        track.classList.add('is-dragging');
        const atEdge = (page === 0 && dx > 0) || (page === pages.length - 1 && dx < 0);
        const offset = atEdge ? dx * .2 : dx;
        track.style.transform = `translate3d(${dragOrigin + offset}px,0,0)`;
      },
      onEnd(dx, { velocityX = 0 } = {}) {
        track.classList.remove('is-dragging');
        if (!mobileMeals.matches) return;
        if (Math.abs(dx) >= Math.min(65, viewport.clientWidth * .2) ||
            (Math.abs(dx) > 20 && Math.abs(velocityX) > .5 && dx * velocityX > 0)) {
          page = Math.max(0, Math.min(pages.length - 1, page + (dx < 0 ? 1 : -1)));
        }
        renderPage();
      }
    });
    section.addEventListener('meal-layout-change', () => {
      const firstMeal = page * pageSize;
      pageSize = mobileMeals.matches ? 1 : 3;
      page = Math.floor(firstMeal / pageSize);
      buildPages();
      renderPage();
    });
    renderPage();
    if (result.meals.length > 1) {
      navigation.append(previous, status, next);
      navigation.hidden = result.meals.length <= pageSize;
      section.append(navigation);
    }
    section.addEventListener('meal-layout-change', () => {
      navigation.hidden = result.meals.length <= pageSize;
    });
  }
  return section;
}

const mealPicker = createMealPicker({
  button: $('start-picker'),
  dialog: $('meal-picker'),
  renderCard: mealCard
});

async function loadMenus() {
  if (detailDialog.open) detailDialog.close();
  mealPicker.setMeals([]);
  const version = ++requestVersion;
  listController?.abort();
  listController = new AbortController();
  const { signal } = listController;
  const visible = canteens.filter((canteen) => !hidden.has(canteen.id));
  const container = $('menus');
  container.replaceChildren();
  if (!visible.length) {
    container.setAttribute('aria-busy', 'false');
    $('results-summary').textContent = 'Keine Mensa ausgewählt';
    container.append(message('Keine Mensa ausgewählt', 'Wähle oben mindestens eine Mensa aus, um ihren Speiseplan zu sehen.'));
    return;
  }
  container.setAttribute('aria-busy', 'true');
  $('results-summary').textContent = 'Speisepläne werden geladen …';
  const loading = element('div', 'meal-grid');
  loading.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) loading.append(element('div', 'skeleton'));
  container.append(loading);
  const date = selectedDate;
  const evening = eveningOnly;
  const diet = { ...dietarySelection };
  // Limit concurrent API requests, while preserving the official cafeteria order.
  const results = new Array(visible.length);
  let cursor = 0;
  async function worker() {
    while (cursor < visible.length && !signal.aborted) {
      const index = cursor++;
      const key = `${visible[index].id}/${date}`;
      const cached = menuCache.get(key);
      try {
        let meals = cached && Date.now() - cached.time < 300000 ? cached.meals : null;
        if (!meals) {
          meals = (await fetchArray(`${API}/canteens/${visible[index].id}/days/${date}/meals`, signal)).data;
          menuCache.set(key, { meals, time: Date.now() });
        }
        results[index] = { meals: meals.filter((meal) => isEveningMeal(meal) === evening && matchesDietarySelection(meal, diet)) };
      } catch (error) {
        if (signal.aborted) return;
        results[index] = { meals: [], error: true };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, visible.length) }, worker));
  if (version !== requestVersion) return;
  const available = visible.map((canteen, i) => ({ canteen, result: results[i] }))
    .filter(({ result }) => result.error || result.meals.length);
  container.replaceChildren(...available.map(({ canteen, result }) => canteenSection(canteen, result)));
  if (!available.length) {
    container.append(message(
      evening ? 'Keine passenden Abendangebote' : 'Keine passenden Mittagsgerichte',
      'Für die ausgewählten Mensen und diesen Tag sind keine passenden Gerichte veröffentlicht. Ändere die Filter, den Tag oder die Mensa-Auswahl.'
    ));
  }
  container.setAttribute('aria-busy', 'false');
  const total = results.reduce((sum, result) => sum + result.meals.length, 0);
  const errors = results.filter((result) => result.error).length;
  const dateLabel = asDate(date).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const dietarySummary = Object.entries(diet).filter(([, mode]) => mode !== 'all')
    .map(([type, mode]) => mode === 'only' ? `Nur ${dietaryFilters[type].label}` : `${dietaryFilters[type].label} ausgeblendet`);
  $('results-summary').textContent = [dateLabel, evening ? 'Abend' : 'Mittag', ...dietarySummary,
    `${available.length} Mensen`, `${total} Gerichte`, ...(errors ? [`${errors} nicht abrufbar`] : [])].join(' · ');
  mealPicker.setMeals(visible.flatMap((canteen, i) =>
    results[i].meals.map((meal) => ({ meal, canteen }))
  ), { dateLabel, unavailableCount: errors });
}

async function init() {
  renderDays();
  try {
    let url = `${API}/canteens`;
    const all = [];
    const visited = new Set();
    while (url && !visited.has(url)) {
      if (!url.startsWith(`${API}/`)) throw new Error('Unerwarteter API-Link');
      visited.add(url);
      const page = await fetchArray(url);
      all.push(...page.data);
      url = page.next;
    }
    canteens = all.filter((canteen) => Number.isInteger(canteen.id) && typeof canteen.name === 'string');
    if (!canteens.length) throw new Error('Keine Mensen verfügbar');
    renderFilters();
    await loadMenus();
  } catch {
    $('cafeteria-options').replaceChildren(element('span', 'filter-loading', 'Mensen zurzeit nicht verfügbar.'));
    $('results-summary').textContent = 'Die Verbindung zur Speiseplan-API ist fehlgeschlagen.';
    $('menus').setAttribute('aria-busy', 'false');
    $('menus').replaceChildren(message('Speiseplan nicht erreichbar', 'Bitte prüfe deine Internetverbindung und versuche es noch einmal.', init));
  }
}

$('price-category').addEventListener('change', (event) => {
  const value = event.target.value;
  if (!Object.hasOwn(priceCategories, value)) return;
  priceCategory = value;
  document.querySelectorAll('.meal-prices').forEach((container) => {
    renderMealPrice(container, priceSources.get(container));
  });
});
for (const type of Object.keys(dietaryFilters)) {
  $(`${type}-filter`).addEventListener('change', (event) => {
    if (!['all', 'only', 'hide'].includes(event.target.value)) return;
    dietarySelection[type] = event.target.value;
    if (canteens.length) loadMenus();
  });
}
$('evening-switch').checked = eveningOnly;
$('evening-switch').addEventListener('change', (event) => {
  eveningOnly = event.target.checked;
  if (canteens.length) loadMenus();
});
$('date-input').addEventListener('change', (event) => changeDate(event.target.value));
$('previous-week').addEventListener('click', () => navigateDays(mobileMeals.matches ? -1 : -7));
$('next-week').addEventListener('click', () => navigateDays(mobileMeals.matches ? 1 : 7));
mobileMeals.addEventListener('change', () => {
  mobileDayStart = undefined;
  renderDays();
  document.querySelectorAll('#menus .canteen-section').forEach((section) =>
    section.dispatchEvent(new Event('meal-layout-change'))
  );
});
$('toggle-all').addEventListener('click', () => {
  const anySelected = canteens.some((canteen) => !hidden.has(canteen.id));
  canteens.forEach((canteen) => anySelected ? hidden.add(canteen.id) : hidden.delete(canteen.id));
  saveSelection();
  updateFilters();
  loadMenus();
});
init();
