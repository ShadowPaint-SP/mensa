import { createMealPicker } from './meal-picker.js';
import { createMealSlot } from './meal-slot.js';
import { horizontalSwipe } from './swipe.js';
import { isVeganMeal, isVegetarianMeal, mealTitleCodes, matchesMealFilters } from './meal-filters.js';
import { downloadMealCalendar } from './calendar.js';

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

let eveningOnly = initialSelection.evening;
let tomView = true; // Tom-View ist Standard: die kontinuierliche Ansicht ist die Startseite
let tomWeekMode = false;
const weekMode = () => tomView && tomWeekMode;
const dietaryLabels = { meat: 'Fleisch/Fisch', vegetarian: 'Vegetarisch', vegan: 'Vegan' };
const dietarySelection = new Set(Object.keys(dietaryLabels));
const excludedCodes = new Set();
let codeLabels = new Map();
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
  $('previous-week').setAttribute('aria-label', mobileMeals.matches && !weekMode() ? 'Vorheriger Wochentag' : 'Vorherige Woche');
  $('next-week').setAttribute('aria-label', mobileMeals.matches && !weekMode() ? 'Nächster Wochentag' : 'Nächste Woche');
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
  $('menu-heading').textContent = tomView ? 'Tom-View: Gerichte' : selectedDate === today ? 'Gerichte heute' : 'Gerichte';
}

function changeDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(asDate(iso).getTime())) return;
  selectedDate = weekdayOnOrAfter(iso);
  if (mobileDayStart && (selectedDate < mobileDayStart || selectedDate > shiftWeekdays(mobileDayStart, 4))) mobileDayStart = undefined;
  renderDays();
  if (canteens.length) loadMenus();
}

function navigateDays(offset, dragOffset = 0) {
  if (!mobileMeals.matches || weekMode()) {
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
      navigateDays(dx < 0 ? (weekMode() ? 7 : 5) : (weekMode() ? -7 : -5), offset);
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

function showMealDetails(meal, calendarEntry) {
  const close = element('button', 'picker-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Details schließen');
  close.addEventListener('click', () => detailDialog.close());
  detailDialog.replaceChildren(close, mealCard(meal, { full: true, calendarEntry }));
  detailDialog.showModal();
}

function mealCard(meal, { full = false, calendarEntry, label = '' } = {}) {
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
  if (label) content.append(element('p', 'meal-label', label));
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
    card.tabIndex = 0;
    card.addEventListener('keydown', (event) => {
      if (event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      showMealDetails(meal, calendarEntry);
    });
    card.addEventListener('click', (event) => {
      if (event.target.closest('button,a,input,select,textarea,summary,details')) return;
      showMealDetails(meal, calendarEntry);
    });
  }
  if (calendarEntry) {
    const calendar = element('button', 'meal-calendar-button');
    calendar.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16m8 3v4m-2-2h4"/></svg>';
    calendar.append(element('span', '', 'zum Kalender hinzufügen'));
    calendar.type = 'button';
    calendar.setAttribute('aria-label', `zum Kalender hinzufügen: ${meal.name}, am ${calendarEntry.date} von 17:30 bis 19:00 Uhr`);
    calendar.title = '17:30–19:00 Uhr · Europe/Berlin · Kalendertermin (.ics) herunterladen';
    calendar.addEventListener('click', () => downloadMealCalendar(calendarEntry));
    content.append(calendar);
  }
  card.append(photo, content);
  return card;
}

function canteenSection(canteen, result, date) {
  const section = element('section', 'canteen-section');
  const identity = `${canteen.id}${date ? `-${date}` : ''}`;
  if (date) section.dataset.date = date;
  const heading = element('div', 'canteen-heading');
  const info = element('div');
  const title = element('div', 'canteen-title');
  const name = element(date ? 'h4' : 'h3', '', canteen.name);
  name.id = `canteen-${identity}`;
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
    viewport.id = `meals-${identity}`;
    const track = element('div', 'meal-track');
    viewport.append(track);
    section.append(viewport);
    let pageSize = mobileMeals.matches ? 2 : 3;
    const pages = [];
    function buildPages() {
      pages.length = 0;
      track.replaceChildren();
      for (let start = 0; start < result.meals.length; start += pageSize) {
        const group = element('div', 'meal-grid meal-page');
        group.append(...result.meals.slice(start, start + pageSize).map((meal) =>
          mealCard(meal, { calendarEntry: date ? { meal, canteen, date } : undefined })));
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
      pageSize = mobileMeals.matches ? 2 : 3;
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
const mealSlot = createMealSlot({
  button: $('start-slot'),
  dialog: $('meal-slot'),
  renderCard: mealCard
});

function renderAdditiveOptions(meals) {
  const options = new Map();
  for (const meal of meals) {
    for (const code of mealTitleCodes(meal)) options.set(code, code);
  }
  for (const meal of meals) {
    if (!Array.isArray(meal.notes)) continue;
    for (const note of meal.notes) {
      if (typeof note !== 'string') continue;
      const match = note.match(/^(.+?)\s*\(([A-Z]\d*|\d+)\)\s*$/i);
      if (match && options.has(match[2].toUpperCase())) {
        options.set(match[2].toUpperCase(), match[1].trim());
      }
    }
  }
  // Keep excluded codes available even when another date/cafeteria has no dishes
  // carrying them, so a user can always undo an exclusion.
  for (const code of excludedCodes) {
    if (!options.has(code)) options.set(code, codeLabels.get(code) || code);
  }
  codeLabels = options;
  const focusedCode = document.activeElement?.dataset.code;
  const container = $('additive-options');
  container.replaceChildren(element('legend', 'sr-only', 'Gerichte mit diesen Codes ausblenden'));
  for (const [code, description] of [...options].sort(([a], [b]) =>
    a.localeCompare(b, 'de', { numeric: true }))) {
    const label = element('label', 'additive-option');
    const input = element('input');
    input.type = 'checkbox';
    input.dataset.code = code;
    input.checked = excludedCodes.has(code);
    label.append(input, element('span', '', description === code ? code : `${code} · ${description}`));
    container.append(label);
    if (focusedCode === code) input.focus({ preventScroll: true });
  }
  if (!options.size) container.append(element('p', 'filter-loading', 'Keine Codes in den verfügbaren Gerichtstiteln.'));
  $('additive-count').textContent = excludedCodes.size ? `${excludedCodes.size} ausgeblendet` : 'Keine ausgeblendet';
  $('clear-additives').disabled = !excludedCodes.size;
}

function tomStream(entries, { weekly }) {
  const section = element('section', `tom-stream${weekly ? ' is-week' : ''}`);
  const errors = entries.filter(({ result }) => result.error).length;
  if (errors) {
    const note = element('div', 'canteen-empty',
      `${errors} ${errors === 1 ? 'Speiseplan konnte' : 'Speisepläne konnten'} nicht geladen werden. `);
    const retry = element('button', 'text-button', 'Erneut versuchen');
    retry.addEventListener('click', () => loadMenus());
    note.append(retry);
    section.append(note);
  }
  const cards = [];
  for (const { date, canteen, result } of entries) {
    if (result.error || !result.meals.length) continue;
    const label = weekly
      ? `${asDate(date).toLocaleDateString('de-DE',
          { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })} · ${canteen.name}`
      : canteen.name;
    result.meals.forEach((meal) => cards.push(mealCard(meal, {
      calendarEntry: weekly ? { meal, canteen, date } : undefined,
      label
    })));
  }
  const grid = element('div', 'meal-grid');
  grid.append(...cards);
  section.append(grid);
  if (!cards.length && !errors) {
    section.append(message(weekly || eveningOnly ? 'Keine passenden Abendangebote' : 'Keine passenden Mittagsgerichte',
      weekly
        ? 'Für die ausgewählten Mensen und diese Woche sind keine passenden Abendgerichte veröffentlicht. Ändere die Filter oder die Mensa-Auswahl.'
        : 'Für die ausgewählten Mensen und diesen Tag sind keine passenden Gerichte veröffentlicht. Ändere die Filter oder die Mensa-Auswahl.'));
  }
  return section;
}

async function loadMenus() {
  if (detailDialog.open) detailDialog.close();
  mealPicker.setMeals([]);
  mealSlot.setMeals([]);
  const version = ++requestVersion;
  listController?.abort();
  listController = new AbortController();
  const { signal } = listController;
  const visible = canteens.filter((canteen) => !hidden.has(canteen.id));
  const container = $('menus');
  container.replaceChildren();
  if (!visible.length) {
    renderAdditiveOptions([]);
    container.setAttribute('aria-busy', 'false');
    $('results-summary').textContent = 'Keine Mensa ausgewählt';
    container.append(message('Keine Mensa ausgewählt', 'Wähle oben mindestens eine Mensa aus, um ihren Speiseplan zu sehen.'));
    return;
  }
  container.setAttribute('aria-busy', 'true');
  $('results-summary').textContent = 'Speisepläne werden geladen …';
  const loading = element('div', 'meal-grid');
  loading.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < (tomView ? 5 : 3); i++) loading.append(element('div', 'skeleton'));
  container.append(loading);
  const date = selectedDate;
  const weekly = weekMode();
  const monday = shiftDate(date, -((asDate(date).getUTCDay() + 6) % 7));
  const dates = weekly ? Array.from({ length: 5 }, (_, i) => shiftDate(monday, i)) : [date];
  const evening = weekly || eveningOnly;
  const diet = new Set(dietarySelection);
  const exclusions = new Set(excludedCodes);
  const tasks = dates.flatMap((date) => visible.map((canteen) => ({ date, canteen })));
  // Limit concurrent API requests, while preserving the official cafeteria order.
  const results = new Array(tasks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length && !signal.aborted) {
      const index = cursor++;
      const { canteen, date } = tasks[index];
      const key = `${canteen.id}/${date}`;
      const cached = menuCache.get(key);
      try {
        let meals = cached && Date.now() - cached.time < 300000 ? cached.meals : null;
        if (!meals) {
          meals = (await fetchArray(`${API}/canteens/${canteen.id}/days/${date}/meals`, signal)).data;
          menuCache.set(key, { meals, time: Date.now() });
        }
        results[index] = { meals };
      } catch (error) {
        if (signal.aborted) return;
        results[index] = { meals: [], error: true };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, worker));
  if (version !== requestVersion) return;
  renderAdditiveOptions(results.flatMap((result) => result.meals));
  results.forEach((result) => {
    result.meals = result.meals.filter((meal) =>
      isEveningMeal(meal) === evening && matchesMealFilters(meal, diet, exclusions));
  });
  const entries = tasks.map((task, i) => ({ ...task, result: results[i] }));
  const available = entries.filter(({ result }) => result.error || result.meals.length);
  if (tomView) {
    container.replaceChildren(tomStream(available, { weekly }));
  } else {
    container.replaceChildren(...available.map(({ canteen, result }) => canteenSection(canteen, result)));
  }
  if (!tomView && !available.length) {
    container.append(message(
      !diet.size ? 'Keine Ernährungsart ausgewählt' : evening ? 'Keine passenden Abendangebote' : 'Keine passenden Mittagsgerichte',
      !diet.size ? 'Wähle mindestens eine Ernährungsart aus.' : 'Für die ausgewählten Mensen und diesen Tag sind keine passenden Gerichte veröffentlicht. Ändere die Filter, den Tag oder die Mensa-Auswahl.'
    ));
  }
  container.setAttribute('aria-busy', 'false');
  const total = results.reduce((sum, result) => sum + result.meals.length, 0);
  const errors = results.filter((result) => result.error).length;
  const dateLabel = weekly
    ? `${asDate(monday).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', timeZone: 'UTC' })} – ${asDate(dates[dates.length - 1]).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`
    : asDate(date).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const dietarySummary = diet.size === 3 ? [] : [diet.size ? [...diet].map((type) => dietaryLabels[type]).join(', ') : 'Keine Ernährungsart ausgewählt'];
  $('results-summary').textContent = [...(weekly ? ['Tom-View'] : []), dateLabel, evening ? 'Abend' : 'Mittag', ...dietarySummary,
    ...(exclusions.size ? [`Ausgeblendet: ${[...exclusions].join(', ')}`] : []),
    `${new Set(available.map(({ canteen }) => canteen.id)).size} Mensen`, `${total} Gerichte`, ...(errors ? [`${errors} nicht abrufbar`] : [])].join(' · ');
  if (!tomView) {
    const selectableMeals = entries.flatMap(({ canteen, result }) =>
      result.meals.map((meal) => ({ meal, canteen }))
    );
    const selectionContext = { dateLabel, unavailableCount: errors };
    mealPicker.setMeals(selectableMeals, selectionContext);
    mealSlot.setMeals(selectableMeals, selectionContext);
  }
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
$('dietary-filter').addEventListener('change', (event) => {
  const { value, checked } = event.target;
  if (!Object.hasOwn(dietaryLabels, value)) return;
  checked ? dietarySelection.add(value) : dietarySelection.delete(value);
  if (canteens.length) loadMenus();
});
$('additive-options').addEventListener('change', (event) => {
  const { code } = event.target.dataset;
  if (!codeLabels.has(code)) return;
  event.target.checked ? excludedCodes.add(code) : excludedCodes.delete(code);
  if (canteens.length) loadMenus();
});
$('clear-additives').addEventListener('click', () => {
  excludedCodes.clear();
  if (canteens.length) loadMenus();
});
$('evening-switch').checked = eveningOnly;
$('evening-switch').addEventListener('change', (event) => {
  eveningOnly = event.target.checked;
  if (canteens.length) loadMenus();
});
$('tom-view').addEventListener('click', () => {
  tomView = !tomView;
  $('tom-view').setAttribute('aria-pressed', String(tomView));
  if (tomView) tomWeekMode = false;
  $('tom-layout-week').checked = tomWeekMode;
  $('evening-switch').disabled = weekMode();
  $('evening-switch').checked = weekMode() || eveningOnly;
  $('start-picker').hidden = tomView;
  $('start-slot').hidden = tomView;
  $('tom-layout').hidden = !tomView;
  mobileDayStart = undefined;
  renderDays();
  if (canteens.length) loadMenus();
});
$('tom-layout-week').addEventListener('change', (event) => {
  if (!tomView) return;
  tomWeekMode = event.target.checked;
  $('evening-switch').disabled = weekMode();
  $('evening-switch').checked = weekMode() || eveningOnly;
  mobileDayStart = undefined;
  renderDays();
  if (canteens.length) loadMenus();
});
$('date-input').addEventListener('change', (event) => changeDate(event.target.value));
$('previous-week').addEventListener('click', () => navigateDays(mobileMeals.matches && !weekMode() ? -1 : -7));
$('next-week').addEventListener('click', () => navigateDays(mobileMeals.matches && !weekMode() ? 1 : 7));
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
