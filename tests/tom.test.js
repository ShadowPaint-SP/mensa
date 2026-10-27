import { createMealCalendar } from '../calendar.js';

const output = document.querySelector('#output');
const frame = document.querySelector('#preview');
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const doc = () => frame.contentDocument;
const win = () => frame.contentWindow;
function assert(ok, label) { if (!ok) throw new Error(label); }
function pass(label) { output.textContent += `\nPASS: ${label}`; }
async function ready() {
  for (let i = 0; i < 300; i++) {
    if (doc()?.querySelector('.cafeteria-chip') &&
        doc().querySelector('#menus').getAttribute('aria-busy') === 'false') return;
    await wait();
  }
  throw Error('Menus did not finish loading');
}
try {
  const sample = { meal: { name: 'Pasta, Spinat; Käse\\Kräuter\nBEGIN:VALARM' },
    canteen: { name: 'Mensa Ä', address: 'Straße 1, Dresden' } };
  const calendarCases = [
    ['2026-01-15', '20260115T163000Z', '20260115T180000Z'],
    ['2026-07-15', '20260715T153000Z', '20260715T170000Z'],
    ['2026-03-28', '20260328T163000Z', '20260328T180000Z'],
    ['2026-03-29', '20260329T153000Z', '20260329T170000Z'],
    ['2026-10-24', '20261024T153000Z', '20261024T170000Z'],
    ['2026-10-25', '20261025T163000Z', '20261025T180000Z'],
    ['2028-02-29', '20280229T163000Z', '20280229T180000Z'],
    ['2026-12-31', '20261231T163000Z', '20261231T180000Z']
  ];
  for (const [date, start, end] of calendarCases) {
    const ics = createMealCalendar({ ...sample, date }, new Date('2026-01-01T00:00:00Z'));
    const unfolded = ics.replace(/\r\n /g, '');
    assert(unfolded.includes(`DTSTART:${start}\r\n`) && unfolded.includes(`DTEND:${end}\r\n`), 'Berlin 17:30–19:00 on ' + date);
    assert(unfolded.includes('DTSTAMP:20260101T000000Z\r\n'), 'Calendar creation timestamp');
    assert(unfolded.includes('SUMMARY:Pasta\\, Spinat\\; Käse\\\\Kräuter\\nBEGIN:VALARM\r\n'), 'Meal title escaped safely');
    assert(unfolded.includes('LOCATION:Mensa Ä\\, Straße 1\\, Dresden\r\n'), 'Cafeteria name and address');
    assert(!unfolded.includes('\r\nBEGIN:VALARM'), 'Text cannot inject calendar components');
    assert(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n') && ics.endsWith('END:VCALENDAR\r\n'), 'Standard calendar envelope');
  }
  const longTitle = 'Käse 🍝, Kräuter; '.repeat(20);
  const folded = createMealCalendar({ ...sample, meal: { name: longTitle }, date: '2026-07-15' });
  assert(folded.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75), 'Calendar lines folded at 75 UTF-8 octets');
  assert(folded.replace(/\r\n /g, '').includes('SUMMARY:' + longTitle.replace(/,/g, '\\,').replace(/;/g, '\\;') + '\r\n'), 'Unicode title preserved through folding');
  pass('Calendar format, safe title/location text, Unicode folding and Berlin summer/winter/DST times');

  const [html, css] = await Promise.all([
    fetch('../index.html').then((response) => response.text()),
    fetch('../styles.css').then((response) => response.text())
  ]);
  const fixture = `
    const NativeDate = window.Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : ['2026-12-31T11:00:00Z'])); }
      static now() { return new NativeDate('2026-12-31T11:00:00Z').getTime(); }
    };
    Object.defineProperty(window, 'localStorage', { value: {
      getItem() { return '[2]'; }, setItem() {}
    }});
    window.requests = [];
    window.activeRequests = 0;
    window.maxRequests = 0;
    window.failTuesday = true;
    window.testDelay = 10;
    window.calendarDownloads = [];
    URL.createObjectURL = (blob) => { window.calendarBlob = blob; return 'blob:calendar-test'; };
    URL.revokeObjectURL = () => {};
    const nativeClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      if (this.download.endsWith('.ics')) window.calendarDownloads.push({name:this.download,url:this.href});
      else nativeClick.call(this);
    };
    window.fetch = (url, {signal} = {}) => new Promise((resolve, reject) => {
      window.requests.push(url);
      window.activeRequests++;
      window.maxRequests = Math.max(window.maxRequests, window.activeRequests);
      let finished = false;
      const finish = () => {
        if (finished) return false;
        finished = true;
        window.activeRequests--;
        signal?.removeEventListener('abort', abort);
        return true;
      };
      const abort = () => {
        clearTimeout(timer);
        if (finish()) reject(new DOMException('Cancelled', 'AbortError'));
      };
      const timer = setTimeout(() => {
        if (!finish()) return;
        if (url.endsWith('/canteens')) {
          resolve(new Response(JSON.stringify([
            {id:1,name:'Selected A',address:'Campus'},
            {id:2,name:'Hidden B'},{id:3,name:'Selected C'}
          ]))); return;
        }
        const [, id, date] = url.match(/canteens\\/(\\d+)\\/days\\/([\\d-]+)\\/meals/);
        if (id === '3' && date === '2026-12-29' && window.failTuesday) {
          resolve(new Response('', {status:500})); return;
        }
        const meal = (suffix, category, notes = []) => ({
          id: Number(id)*100 + suffix, name: date + ' ' + category + (category.includes('vegan') ? ' (A1)' : ''),
          category, notes, prices:{Studierende:2.35,Bedienstete:4.90}
        });
        const meals = [meal(1,'Mittag')];
        if (id === '1' && new NativeDate(date+'T12:00:00Z').getUTCDay() !== 5) {
          meals.push(meal(2,'Abendangebot vegan',['Menü ist vegan']),meal(3,'Abendangebot Fleisch'));
        }
        resolve(new Response(JSON.stringify(meals)));
      }, window.testDelay);
      signal?.addEventListener('abort', abort, {once:true});
      if (signal?.aborted) abort();
    });
  `;
  frame.srcdoc = html.replace('<head>', `<head><base href="${new URL('../', location.href)}"><script>${fixture}<\/script>`)
    .replace('<link rel="stylesheet" href="./styles.css">', `<style>${css.replace(/^@import.*$/m, '')}</style>`);
  await ready();
  const toggle = doc().querySelector('#tom-view');
  const evening = doc().querySelector('#evening-switch');
  assert(!evening.checked, 'Initial midday setting');
  assert(!doc().querySelector('.meal-calendar-button'), 'Calendar buttons are limited to dated Tom-View meals');
  toggle.click();
  await ready();
  const days = [...doc().querySelectorAll('.tom-day')];
  assert(days.length === 5, 'Five weekdays in weekly view');
  assert(days[0].dataset.date === '2026-12-28' && days[4].dataset.date === '2027-01-01', 'Monday–Friday across year boundary');
  assert(win().requests.filter((url) => url.includes('/days/')).every((url) => {
    const date = url.match(/days\/([\d-]+)/)[1];
    return ![0, 6].includes(new Date(date + 'T12:00:00Z').getUTCDay());
  }), 'Weekend menus are not requested');
  assert(days[4].querySelector('.canteen-empty'), 'Unpublished Friday explicitly marked');
  assert(doc().querySelector('#results-summary').textContent.includes('1. Januar 2027'), 'Weekly summary ends on Friday');
  assert([...doc().querySelectorAll('#menus .meal-name')].every((name) => name.textContent.includes('Abendangebot')), 'Only evening menus displayed');
  assert(!win().requests.some((url) => url.includes('/canteens/2/')), 'Hidden cafeteria never requested');
  assert(win().maxRequests <= 4, 'At most four concurrent requests');
  assert(evening.checked && evening.disabled, 'Weekly view locks Abend selection');
  assert(doc().querySelector('#start-picker').hidden, 'Single-day picker unavailable for mixed-date view');
  assert(doc().querySelector('#start-slot').hidden && doc().querySelector('#start-slot').disabled,
    'Single-day slot machine unavailable for mixed-date view');
  const ids = [...doc().querySelectorAll('[id]')].map((node) => node.id);
  assert(new Set(ids).size === ids.length, 'Repeated cafeterias have unique accessible IDs');
  pass('Weekdays only, no weekend requests, year boundary, evening-only data, hidden cafeterias, concurrency and unique IDs');

  const firstCalendar = days[0].querySelector('.meal-calendar-button');
  assert(firstCalendar && firstCalendar.getAttribute('aria-label').includes('2026-12-28'), 'Calendar button labels the meal date');
  assert(firstCalendar.textContent === 'zum Kalender hinzufügen' && firstCalendar.querySelector('svg'), 'Visible calendar button with calendar icon');
  firstCalendar.click();
  const imported = (await win().calendarBlob.text()).replace(/\r\n /g, '');
  assert(win().calendarDownloads[0].name === 'mensa-2026-12-28.ics', 'Download uses the corresponding day');
  assert(win().calendarBlob.type === 'text/calendar;charset=utf-8', 'Calendar MIME type');
  assert(imported.includes('SUMMARY:2026-12-28 Abendangebot vegan (A1)\r\n'), 'Clicked meal is the event title');
  assert(imported.includes('LOCATION:Selected A\\, Campus\r\n'), 'Clicked cafeteria is event location');
  assert(imported.includes('DTSTART:20261228T163000Z\r\n') && imported.includes('DTEND:20261228T180000Z\r\n'), 'Clicked day uses 17:30–19:00 Berlin');
  assert(!doc().querySelector('.picker-detail').open, 'Calendar click does not open meal details');
  days[0].querySelector('.meal-details-button').click();
  const detailsDialog = doc().querySelector('.picker-detail');
  assert(detailsDialog.open && detailsDialog.querySelector('.meal-calendar-button'), 'Calendar button also available in full details');
  detailsDialog.querySelector('.meal-calendar-button').click();
  assert(win().calendarDownloads.length === 2 && detailsDialog.open, 'Details calendar download preserves dialog');
  detailsDialog.querySelector('.picker-close').click();
  pass('Calendar buttons download the selected meal/date/location without triggering card details');

  const failedDay = days[1];
  assert(failedDay.querySelector('.meal-count').textContent === 'Nicht verfügbar' ||
    [...failedDay.querySelectorAll('.meal-count')].some((node) => node.textContent === 'Nicht verfügbar'), 'Partial failure remains visible');
  win().failTuesday = false;
  const beforeRetry = win().requests.length;
  failedDay.querySelector('.canteen-empty button').click();
  await ready();
  assert(win().requests.length === beforeRetry + 1, 'Retry fetches only missing response; successful results cached');
  pass('Partial failures and retry without discarding successful days');

  const beforeCachedSwitch = win().requests.length;
  toggle.click();
  await ready();
  assert(!evening.disabled && !evening.checked, 'Leaving restores previous midday selection');
  assert(!doc().querySelector('.tom-day') && !doc().querySelector('#start-picker').hidden, 'Day view and picker restored');
  assert(!doc().querySelector('#start-slot').hidden && !doc().querySelector('#start-slot').disabled,
    'Slot machine restored with single-day meals');
  toggle.click();
  await ready();
  assert(win().requests.length === beforeCachedSwitch, 'Switching views reuses cached raw responses');
  doc().querySelector('#dietary-filter input[value="meat"]').click();
  doc().querySelector('#dietary-filter input[value="vegetarian"]').click();
  await ready();
  assert(doc().querySelectorAll('#menus .meal-name').length === 4 &&
    [...doc().querySelectorAll('#menus .meal-name')].every((node) => node.textContent.includes('vegan')), 'Dietary multiselect applies across week');
  const beforeExclusions = win().requests.length;
  doc().querySelector('#additive-options input[data-code="A1"]').click();
  await ready();
  assert(!doc().querySelector('#menus .meal-card') &&
    doc().querySelectorAll('.tom-day').length === 5, 'Additive exclusions apply to every day without hiding week headings');
  assert(doc().querySelector('#additive-options input[data-code="A1"]').checked, 'Excluded code stays available');
  doc().querySelector('#clear-additives').click();
  await ready();
  assert(doc().querySelectorAll('#menus .meal-name').length === 4, 'Reset restores filtered weekly meals');
  assert(win().requests.length === beforeExclusions, 'Weekly exclusions reuse cached raw responses');
  doc().querySelector('input[name="price-category"][value="employee"]').click();
  assert([...doc().querySelectorAll('#menus .meal-prices')].every((node) => node.textContent.includes('4,90')), 'Selected price applies across week');
  pass('Day-mode restoration, shared cache, dietary multiselect, additive exclusions and price selections');

  const next = doc().querySelector('#next-week');
  assert(next.getAttribute('aria-label') === 'Nächste Woche', 'Mobile arrows announce whole week');
  next.click();
  await ready();
  assert(doc().querySelector('.tom-day').dataset.date === '2027-01-04', 'Next arrow changes whole week on mobile');
  win().testDelay = 50;
  next.click();
  toggle.click();
  await ready();
  assert(!doc().querySelector('.tom-day'), 'Obsolete weekly requests do not overwrite day view');
  assert(win().maxRequests <= 4, 'Concurrency bound remains valid through cancellation');
  toggle.click();
  await ready();
  pass('Week navigation and rapid view changes cancel obsolete work');

  for (const width of [320, 390, 1200]) {
    frame.width = width;
    await wait(100);
    assert(doc().documentElement.scrollWidth <= width, 'No horizontal overflow at ' + width);
    assert(doc().querySelector('.meal-card').getBoundingClientRect().height === 420, 'Fixed-height cards at ' + width);
    const content = doc().querySelector('.meal-content');
    const calendar = content.querySelector('.meal-calendar-button');
    assert(calendar.getBoundingClientRect().bottom <= content.getBoundingClientRect().bottom, 'Calendar button fits inside fixed card at ' + width);
    assert(content.scrollHeight <= content.clientHeight + 1, 'Calendar action does not overflow card at ' + width);
  }
  doc().querySelector('#theme-toggle').click();
  assert(doc().documentElement.dataset.theme, 'Theme toggle still works');
  doc().querySelector('#toggle-all').click();
  await ready();
  assert(doc().querySelector('#results-summary').textContent === 'Keine Mensa ausgewählt', 'No selection empty state');
  pass('Responsive fixed cards, themes and empty cafeteria selection');
  output.textContent += '\n\nAll tests passed.';
  document.title = 'PASS — Tom-View regression tests';
} catch (error) {
  output.textContent += `\nFAIL: ${error.message}`;
  document.title = 'FAIL — Tom-View regression tests';
  console.error(error);
}
