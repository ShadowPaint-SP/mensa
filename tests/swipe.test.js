import { dietaryCategory, mealTitleCodes, matchesMealFilters } from '../meal-filters.js';

const output = document.querySelector('#output');
const frame = document.querySelector('#preview');
const wait = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(condition, label) {
  if (!condition) throw new Error(label);
}
function pass(label) { output.textContent += `\nPASS: ${label}`; }

try {
  assert([...mealTitleCodes({ name: 'Pasta (A, A1, D) (2; 27) (A) (Z9)' })].join(',') === 'A,A1,D,2,27,Z9',
    'Code parser deduplicates complete letter/numeric lists and supports unknown provider codes');
  assert(!mealTitleCodes({ name: 'Vitamin A mit Reis (200 g) (nach Wahl) (-) ()' }).size,
    'Code parser ignores prose, quantities, empty lists and uncoded letters');
  assert(!mealTitleCodes({ name: null }).size, 'Missing title is safe');
  assert(dietaryCategory({ notes: ['Menü ist vegetarisch', 'Menü ist vegan'] }) === 'vegan',
    'Vegan classification takes priority');
  assert(dietaryCategory({ notes: [' Menü ist vegetarisch '] }) === 'vegetarian' &&
    dietaryCategory({ notes: [null, 'Menü ist vegan möglich'] }) === 'meat', 'Exact provider dietary labels only');
  assert(matchesMealFilters({ name: 'Pasta (A1)', notes: ['Menü ist vegan'] }, new Set(['vegan']), new Set(['A'])),
    'Pure filter uses whole codes, not substrings');
  pass('Provider classification and title-code parser boundary cases');
  const [html, css] = await Promise.all([
    fetch('../index.html').then((response) => response.text()),
    fetch('../styles.css').then((response) => response.text())
  ]);
  const fixtures = `
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 14)', configurable: true });
    const NativeDate = window.Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : ['2026-10-22T10:00:00Z'])); }
      static now() { return new NativeDate('2026-10-22T10:00:00Z').getTime(); }
    };
    Object.defineProperty(window, 'localStorage', { value: {
      getItem() { return '[2]'; }, setItem() {}
    }});
    window.testRequests = [];
    window.fetch = async (url) => {
      window.testRequests.push(url);
      const meal = (id) => ({
        id, name: id === 1 ? 'Long meal description '.repeat(100) : 'Meal ' + id,
        notes: ['Menü ist vegan', ...Array(30).fill('Allergen note')],
        category: 'Tagesgericht', prices: {Studierende: 2.35, Bedienstete: 4.9}
      });
      const evening = (id, vegan) => ({
        ...meal(id), name: 'Abendangebot: Meal ' + id + ({90:' (A, A1, 2)',91:' (D)',92:' (A1, G)'}[id] || ''),
        notes: vegan ? ['Menü ist vegan'] : []
      });
      const data = url.endsWith('/canteens')
        ? [{id:1,name:'Selected A',address:'Bergstraße 51, 01069 Dresden'},{id:2,name:'Hidden B'},{id:3,name:'Selected C'}]
        : url.includes('/canteens/1/') ? [
          meal(1),meal(2),meal(3),meal(4),{...evening(90,true),notes:['Menü ist vegan','Glutenhaltiges Getreide (A)','Weizen (A1)','mit Konservierungsstoff (2)']},
          {...evening(91,false),notes:[null,42,'Menü ist vegan möglich']},
          {...evening(92,false),notes:[' Menü ist vegetarisch ']}
        ] : [meal(5)];
      return new Response(JSON.stringify(data), {status:200,headers:{'Content-Type':'application/json'}});
    };
  `;
  frame.srcdoc = html.replace('<head>', `<head><base href="${new URL('../', location.href)}"><script>${fixtures}<\/script>`)
    .replace('<link rel="stylesheet" href="./styles.css">', `<style>${css.replace(/^@import.*$/m, '')}</style>`);
  const doc = () => frame.contentDocument;
  for (let i = 0; i < 200; i++) {
    if (doc()?.querySelector('#start-picker')?.disabled === false) break;
    await wait();
  }
  assert(doc().querySelector('#start-picker')?.disabled === false, 'App initialized');
  assert(doc().querySelectorAll('.day-button').length === 5, 'Mobile shows five date tabs');
  const todayTab = doc().querySelector('.day-button.is-today');
  assert(todayTab.getAttribute('aria-pressed') === 'true' &&
    frame.contentWindow.getComputedStyle(todayTab).borderTopColor === 'rgb(218, 50, 28)', 'Today accent border remains visible when selected');
  assert(!frame.contentWindow.testRequests.some((url) => url.includes('/canteens/2/')), 'Hidden cafeteria excluded');
  const route = doc().querySelector('.canteen-route');
  const routeURL = new URL(route.href);
  assert(route.textContent === 'Route' && route.target === '_blank', 'Route link replaces visible address');
  assert(route.querySelector('svg[aria-hidden="true"]'), 'Route has a decorative navigation icon');
  assert(!doc().querySelector('.canteen-number'), 'Cafeteria name icons removed');
  assert(frame.contentWindow.getComputedStyle(route).borderTopStyle === 'none', 'Route uses a subtle borderless style');
  assert(routeURL.origin === 'https://www.google.com' && routeURL.pathname === '/maps/dir/' &&
    routeURL.searchParams.get('api') === '1' &&
    routeURL.searchParams.get('destination') === 'Bergstraße 51, 01069 Dresden', 'Google Maps directions use exact API address');
  assert(!doc().querySelector('#menus').textContent.includes('Bergstraße'), 'Address is not displayed');
  assert(doc().querySelectorAll('.canteen-route').length === 1, 'Missing address does not produce an invalid route');
  pass('Route links use Google Maps directions; addresses hidden and unavailable destinations omitted');
  const viewport = doc().querySelector('.meal-viewport');
  const track = viewport.querySelector('.meal-track');
  const section = viewport.closest('.canteen-section');
  const status = section.querySelector('.meal-page-status');
  assert(track.children.length === 4 && track.children[0].children.length === 1, 'One mobile meal per page');
  const cardTop = section.querySelector('.meal-navigation').getBoundingClientRect().top;

  function pointer(target, type, x, y = 100) {
    return target.dispatchEvent(new frame.contentWindow.PointerEvent(type, {
      pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0,
      clientX: x, clientY: y, bubbles: true, cancelable: true
    }));
  }
  function begin(surface, target = surface) {
    // Synthetic events cannot establish native pointer capture. Emulate its state
    // explicitly, including the child capture-loss event that caused the regression.
    let captured = false;
    surface.setPointerCapture = () => { captured = true; };
    surface.hasPointerCapture = () => captured;
    surface.releasePointerCapture = () => { captured = false; };
    pointer(target, 'pointerdown', 150);
    assert(!captured, 'Card taps keep native targeting until a horizontal drag starts');
  }
  const translation = (target) => new frame.contentWindow.DOMMatrixReadOnly(
    frame.contentWindow.getComputedStyle(target).transform
  ).m41;
  const text = track.querySelector('.meal-name');
  begin(viewport, text);
  pointer(text, 'lostpointercapture', 150);
  pointer(viewport, 'pointermove', 110);
  assert(viewport.hasPointerCapture(7), 'Horizontal drag captures on the stable viewport');
  assert(Math.abs(translation(track) + 40) < 1, 'Track follows finger by 40px after child capture loss');
  pointer(viewport, 'pointermove', 50);
  assert(Math.abs(translation(track) + 100) < 1, 'Track follows finger by 100px before release');
  assert(status.textContent === '1–1 von 4', 'No premature page change');
  pointer(viewport, 'pointerup', 50);
  await wait(460);
  assert(status.textContent === '2–2 von 4', 'Release advances exactly one meal');
  track.querySelector('.meal-card').dispatchEvent(new frame.contentWindow.MouseEvent('click', {
    bubbles: true, cancelable: true, detail: 1
  }));
  assert(!doc().querySelector('.picker-detail').open, 'Swipe-generated click does not open details');
  assert(section.querySelector('.meal-navigation').getBoundingClientRect().top === cardTop, 'Stable navigation');
  begin(viewport);
  const origin = translation(track);
  pointer(viewport, 'pointermove', 230);
  assert(Math.abs(translation(track) - origin - 80) < 1, 'Reverse drag also tracks finger');
  pointer(viewport, 'pointerup', 230);
  await wait(460);
  assert(status.textContent === '1–1 von 4', 'Reverse swipe returns');
  begin(viewport);
  pointer(viewport, 'pointermove', 135);
  pointer(viewport, 'pointerup', 135);
  await wait(460);
  assert(status.textContent === '1–1 von 4', 'Short drag snaps back');
  begin(viewport);
  pointer(viewport, 'pointermove', 50);
  pointer(viewport, 'pointercancel', 50);
  await wait(460);
  assert(status.textContent === '1–1 von 4', 'Cancellation does not paginate');
  begin(viewport);
  pointer(viewport, 'pointermove', 145, 200);
  pointer(viewport, 'pointerup', 145, 200);
  assert(status.textContent === '1–1 von 4', 'Vertical scroll does not paginate');
  pass('Continuous carousel tracking, nested capture loss, reverse, release, cancellation, vertical scrolling');

  const content = track.querySelector('.meal-content');
  assert(frame.contentWindow.getComputedStyle(content).overflowY === 'hidden', 'Browse cards are not scroll containers');
  assert(content.scrollHeight <= content.clientHeight + 1, 'Preview fits inside card');
  content.querySelector('.meal-details-button').click();
  const detail = doc().querySelector('.picker-detail');
  assert(detail.open && detail.querySelector('.meal-name').textContent.length > 1000, 'Full description accessible');
  assert(detail.querySelectorAll('li').length === 31, 'All notes accessible');
  // Local image fixtures exercise intrinsic sizing without any external photo requests.
  for (const [width, height] of [[600, 900], [1200, 400]]) {
    const image = doc().createElement('img');
    image.alt = 'Test meal';
    image.src = 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#A0D7B8"/></svg>`
    );
    detail.querySelector('.meal-photo').replaceChildren(image);
    await image.decode();
    const rect = image.getBoundingClientRect();
    assert(Math.abs(rect.width / rect.height - width / height) < .01, 'Full photo preserves natural aspect ratio');
    assert(Math.abs(detail.querySelector('.meal-photo').getBoundingClientRect().height - rect.height) < 1, 'Full photo is not cropped by its container');
    assert(frame.contentWindow.getComputedStyle(image).transform === 'none', 'Details photo has no cropping hover zoom');
  }
  detail.querySelector('button').click();
  await wait();
  for (const target of [track.querySelector('.meal-photo'), content.querySelector('.meal-name'), track.querySelector('.meal-card')]) {
    target.click();
    assert(detail.open, 'Photo, text and card background open the details popup');
    detail.querySelector('.picker-close').click();
  }
  pass('Full uncropped portrait/landscape photos; card-wide details access; original details button preserved');

  const requestCount = frame.contentWindow.testRequests.length;
  const pageBeforePriceChange = status.textContent;
  const navBeforePriceChange = section.querySelector('.meal-navigation').getBoundingClientRect().top;
  assert(track.querySelector('.selected-price').textContent.includes('2,35'), 'Student price selected by default');
  doc().querySelector('input[name="price-category"][value="employee"]').click();
  assert([...track.querySelectorAll('.meal-prices')].every((price) =>
    price.children.length === 1 && price.textContent.includes('4,90') && price.textContent.includes('Bediensteter')
  ), 'Only employee price shown on each meal');
  assert(status.textContent === pageBeforePriceChange, 'Price change preserves current page');
  assert(section.querySelector('.meal-navigation').getBoundingClientRect().top === navBeforePriceChange, 'Price change keeps controls stationary');
  doc().querySelector('input[name="price-category"][value="guest"]').click();
  assert([...track.querySelectorAll('.meal-prices')].every((price) =>
    price.textContent === 'Keine Preisangabe'
  ), 'Missing guest price does not fall back to another category');
  assert(frame.contentWindow.testRequests.length === requestCount, 'Price changes require no API requests');
  doc().querySelector('input[name="price-category"][value="employee"]').click();
  pass('Exclusive category prices, missing-price state, stable pagination and no extra API requests');

  doc().querySelector('#start-picker').click();
  const body = doc().querySelector('#picker-body');
  const firstCard = body.querySelector('.meal-card');
  const nextPreview = body.querySelector('.picker-next-card');
  assert([...body.querySelectorAll('.meal-prices')].every((price) =>
    price.textContent.includes('4,90') && price.textContent.includes('Bediensteter')
  ), 'Picker and next-card preview use selected price category');
  assert(nextPreview?.querySelector('.meal-name').textContent === 'Meal 2', 'Actual next meal is already rendered');
  assert(nextPreview.inert && nextPreview.getAttribute('aria-hidden') === 'true', 'Preview cannot be voted or keyboard-focused');
  assert(nextPreview.getBoundingClientRect().top === firstCard.getBoundingClientRect().top, 'Next meal is positioned directly beneath current card');
  assert(frame.contentWindow.getComputedStyle(nextPreview).pointerEvents === 'none', 'Preview does not intercept dragging');
  firstCard.querySelector('.meal-photo').click();
  assert(detail.open, 'Voting-card tap also opens full details');
  detail.querySelector('.picker-close').click();
  begin(firstCard, firstCard.querySelector('.meal-name'));
  pointer(firstCard.querySelector('.meal-name'), 'lostpointercapture', 150);
  pointer(firstCard, 'pointermove', 210);
  assert(Math.abs(translation(firstCard) - 60) < 1, 'Voting card follows finger');
  pointer(firstCard, 'pointermove', 270);
  assert(Math.abs(translation(firstCard) - 120) < 1, 'Voting card tracks further finger movement');
  assert(nextPreview.getBoundingClientRect().left < firstCard.getBoundingClientRect().left, 'Next meal stays in place while current card moves away');
  pointer(firstCard, 'pointerup', 270);
  firstCard.dispatchEvent(new frame.contentWindow.MouseEvent('click', {
    bubbles: true, cancelable: true, detail: 1
  }));
  assert(!detail.open, 'Voting swipe does not open details');
  firstCard.getAnimations().forEach((animation) => animation.finish());
  await wait();
  assert(body.querySelector('.picker-progress').textContent === '2 von 5 · 1 geliked', 'Right swipe likes once');
  assert(body.querySelector('.picker-next-card .meal-name').textContent === 'Meal 3', 'Preview advances along with the deck');
  const nextCard = body.querySelector('.meal-card');
  begin(nextCard);
  pointer(nextCard, 'pointermove', 30);
  assert(Math.abs(translation(nextCard) + 120) < 1, 'Reject drag follows finger left');
  pointer(nextCard, 'pointerup', 30);
  nextCard.getAnimations().forEach((animation) => animation.finish());
  await wait();
  assert(body.querySelector('.picker-progress').textContent === '3 von 5 · 1 geliked', 'Left swipe rejects');
  pass('Continuous whole-card voting gestures and correct like/reject decisions');
  for (let i = 0; i < 2; i++) {
    const current = body.querySelector('.picker-current-card');
    body.querySelector('.picker-reject').click();
    current.getAnimations().forEach((animation) => animation.finish());
    await wait();
  }
  assert(body.querySelector('.picker-progress').textContent.startsWith('5 von 5'), 'Reached last meal');
  assert(!body.querySelector('.picker-next-card'), 'No phantom preview after final meal');
  pass('Next-meal preview is revealed during dragging, advances correctly, and ends at the last meal');

  doc().querySelector('#close-picker').click();
  await wait();
  doc().querySelector('#start-picker').click();
  for (const [width, height] of [[375, 667], [320, 568], [667, 375]]) {
    frame.width = width;
    frame.height = height;
    await wait(100);
    const dialog = doc().querySelector('#meal-picker');
    const region = body.querySelector('.meal-content');
    assert(region.scrollHeight <= region.clientHeight + 1, `Voting card fits ${width}×${height}`);
    assert(dialog.scrollHeight <= dialog.clientHeight + 1, `Voting dialog fits ${width}×${height}`);
  }
  pass('Voting card has no scrolling on compact phones or in landscape');
  doc().querySelector('#close-picker').click();
  frame.width = 1200;
  frame.height = 900;
  await wait(100);
  assert(track.children[0].children.length === 3, 'Desktop three-meal groups preserved');
  assert(doc().querySelectorAll('.day-button').length === 5, 'Desktop shows five weekday tabs');
  assert([...doc().querySelectorAll('.day-button')].every((day) =>
    ![0, 6].includes(new Date(day.dataset.date + 'T12:00:00Z').getUTCDay())), 'Desktop excludes weekends');
  pass('Desktop grouping preserved');
  frame.width = 390;
  frame.height = 844;
  await wait(100);
  assert(doc().querySelectorAll('.day-button').length === 5, 'Resizing restores five mobile date tabs');
  const reducedMotionRule = [...doc().styleSheets[0].cssRules].find(
    (rule) => rule.conditionText === '(prefers-reduced-motion: reduce)'
  );
  reducedMotionRule.media.mediaText = 'all';
  begin(viewport);
  const reducedOrigin = translation(track);
  pointer(viewport, 'pointermove', 90);
  assert(Math.abs(translation(track) - reducedOrigin + 60) < 1, 'Direct tracking also works with reduced motion');
  pointer(viewport, 'pointercancel', 90);
  assert(frame.contentWindow.getComputedStyle(track).transitionDuration === '0s', 'Reduced motion disables automatic transitions');
  pass('Reduced-motion mode preserves direct manipulation without automatic animation');

  Object.defineProperty(frame.contentWindow.navigator, 'userAgent', {
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', configurable: true
  });
  const eveningSwitch = doc().querySelector('#evening-switch');
  eveningSwitch.checked = true;
  eveningSwitch.dispatchEvent(new frame.contentWindow.Event('change'));
  await wait();
  const appleRoute = doc().querySelector('.canteen-route');
  const appleURL = new URL(appleRoute.href);
  assert(appleURL.origin === 'https://maps.apple.com' &&
    appleURL.searchParams.get('daddr') === 'Bergstraße 51, 01069 Dresden' &&
    appleRoute.getAttribute('aria-label').includes('Apple Maps'), 'iPhone route opens Apple Maps directions');
  pass('iPhone uses Apple Maps while Android uses Google Maps');
  assert(doc().querySelectorAll('.canteen-section').length === 1, 'Only cafeteria with evening meals remains');
  doc().querySelector('#start-picker').click();
  assert(body.querySelector('.picker-progress').textContent.startsWith('1 von 3'), 'Picker uses only evening meals');
  const eveningName = (id) => `Abendangebot: Meal ${id}${{90:' (A, A1, 2)',91:' (D)',92:' (A1, G)'}[id]}`;
  assert(body.querySelector('.meal-name').textContent === eveningName(90), 'Picker contains evening dish');
  doc().querySelector('#close-picker').click();
  assert(doc().querySelectorAll('#dietary-filter input:checked').length === 3, 'All three meal groups selected initially');
  assert(doc().querySelectorAll('#dietary-filter input[type="checkbox"] + span svg[aria-hidden="true"]').length === 3,
    'Each independently selectable meal group has a decorative icon');
  for (const input of doc().querySelectorAll('#dietary-filter input')) {
    assert(input.nextElementSibling.textContent.trim() === '', 'Dietary buttons display symbols only');
    assert(input.getAttribute('aria-label') === input.parentElement.title, 'Icon-only controls retain accessible names and tooltips');
  }
  const requestsBeforeDietChanges = frame.contentWindow.testRequests.length;
  const diets = [
    [[], []], [['meat'], [91]], [['vegetarian'], [92]], [['vegan'], [90]],
    [['meat','vegetarian'], [91,92]], [['meat','vegan'], [90,91]],
    [['vegetarian','vegan'], [90,92]], [['meat','vegetarian','vegan'], [90,91,92]]
  ];
  for (const [selected, ids] of diets) {
    for (const input of doc().querySelectorAll('#dietary-filter input')) {
      if (input.checked !== selected.includes(input.value)) input.click();
    }
    await wait();
    const mode = selected.join('/') || 'none';
    const names = [...doc().querySelectorAll('#menus .meal-name')].map((name) => name.textContent);
    assert(JSON.stringify(names) === JSON.stringify(ids.map(eveningName)), `Diet ${mode} filters the browser correctly`);
    assert(doc().querySelector('#evening-switch').checked, `Diet ${mode} preserves evening filter`);
    assert(doc().querySelector('input[name="price-category"]:checked').value === 'employee', `Diet ${mode} preserves price category`);
    if (ids.length) {
      doc().querySelector('#start-picker').click();
      assert(body.querySelector('.picker-progress').textContent.startsWith(`1 von ${ids.length}`), `Picker combines evening and ${mode} filters`);
      assert(body.querySelector('.meal-name').textContent === eveningName(ids[0]), `Picker starts with matching ${mode} meal`);
      doc().querySelector('#close-picker').click();
    } else {
      assert(doc().querySelector('#start-picker').disabled && doc().querySelector('#menus .message'), 'Empty selection disables picker with a clear message');
      assert(!doc().querySelector('#dietary-filter input:checked'), 'Empty selection is not silently reset');
    }
  }
  assert(frame.contentWindow.testRequests.length === requestsBeforeDietChanges, 'All dietary modes reuse cached raw menus');
  doc().querySelector('.additive-filter').open = true;
  const chooseCode = async (code) => {
    const input = doc().querySelector(`#additive-options input[data-code="${code}"]`);
    assert(input, `Code ${code} offered`);
    input.focus();
    input.click();
    await wait();
    assert(doc().activeElement.dataset.code === code, 'Code selection retains keyboard focus');
  };
  const currentNames = () => [...doc().querySelectorAll('#menus .meal-name')].map((node) => node.textContent);
  assert(doc().querySelector('#additive-options input[data-code="A"]').parentElement.textContent.includes('Glutenhaltiges Getreide'),
    'Code descriptions come from provider notes');
  await chooseCode('A');
  assert(JSON.stringify(currentNames()) === JSON.stringify([91,92].map(eveningName)), 'A exclusion does not match A1 by substring');
  await chooseCode('D');
  assert(JSON.stringify(currentNames()) === JSON.stringify([eveningName(92)]), 'Multiple code exclusions combine');
  doc().querySelector('#start-picker').click();
  assert(body.querySelector('.picker-progress').textContent.startsWith('1 von 1') &&
    body.querySelector('.meal-name').textContent === eveningName(92), 'Picker respects additive exclusions');
  doc().querySelector('#close-picker').click();
  await chooseCode('A1');
  assert(doc().querySelector('#start-picker').disabled, 'All excluded meals disables picker');
  doc().querySelector('#clear-additives').click();
  await wait();
  assert(currentNames().length === 3, 'Reset restores all meals');
  await chooseCode('2');
  assert(JSON.stringify(currentNames()) === JSON.stringify([91,92].map(eveningName)), 'Numeric additive codes supported');
  doc().querySelector('.cafeteria-chip[data-id="1"]').click();
  await wait();
  assert(doc().querySelector('#additive-options input[data-code="2"]').checked, 'Excluded code retained when cafeteria is hidden');
  doc().querySelector('#clear-additives').click();
  doc().querySelector('.cafeteria-chip[data-id="1"]').click();
  await wait();
  assert(frame.contentWindow.testRequests.length === requestsBeforeDietChanges, 'Additive changes reuse raw cached menus');
  for (const width of [320,390,768,1200]) {
    frame.width = width;
    await wait(100);
    assert(doc().documentElement.scrollWidth <= width, `Dietary controls fit ${width}px viewport`);
    const controls = [...doc().querySelectorAll('.quick-filters > fieldset,.quick-filters > .meal-period')];
    for (let i = 0; i < controls.length; i++) {
      for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i].getBoundingClientRect(), b = controls[j].getBoundingClientRect();
        assert(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `Filter controls do not overlap at ${width}px`);
      }
    }
  }
  frame.width = 390;
  await wait(100);
  doc().querySelector('.cafeteria-chip[data-id="1"]').click();
  await wait();
  assert(doc().querySelector('#start-picker').disabled, 'No picker meals after matching cafeteria is hidden');
  pass('All eight dietary multiselect combinations, exact/numeric additive exclusions, reset/focus, cached menus, responsive controls and picker/filter combinations');
  // Restore normal motion after the reduced-motion checks.
  reducedMotionRule.media.mediaText = '(prefers-reduced-motion: reduce)';
  const daySurface = doc().querySelector('#day-viewport');
  const dayGrid = doc().querySelector('#week-days');
  let dayCaptured = false;
  daySurface.setPointerCapture = () => { dayCaptured = true; };
  daySurface.hasPointerCapture = () => dayCaptured;
  daySurface.releasePointerCapture = () => { dayCaptured = false; };
  const firstDate = () => dayGrid.firstElementChild.dataset.date;
  const shiftISO = (iso, count) => {
    const date = new Date(iso + 'T12:00:00Z');
    for (let i = 0; i < Math.abs(count);) {
      date.setUTCDate(date.getUTCDate() + Math.sign(count));
      if (![0, 6].includes(date.getUTCDay())) i++;
    }
    return date.toISOString().slice(0, 10);
  };
  const settleDays = async () => {
    daySurface.getAnimations({ subtree: true }).forEach((animation) => animation.finish());
    await wait();
  };
  const originalFirst = firstDate();
  const originalSelection = doc().querySelector('#date-input').value;
  const requestsBeforeDateBrowsing = frame.contentWindow.testRequests.length;
  pointer(dayGrid.firstElementChild, 'pointerdown', 150);
  assert(!dayCaptured, 'Date tap does not capture pointer prematurely');
  pointer(daySurface, 'pointermove', 70);
  assert(dayCaptured && Math.abs(translation(dayGrid) + 80) < 1, 'Date strip follows finger and captures horizontal drag');
  pointer(daySurface, 'pointerup', 70);
  await settleDays();
  assert(firstDate() === shiftISO(originalFirst, 5), 'Left date swipe advances five weekdays');
  doc().querySelector('#next-week').click();
  await settleDays();
  assert(firstDate() === shiftISO(originalFirst, 6), 'Next arrow advances only one day');
  doc().querySelector('#previous-week').click();
  await settleDays();
  assert(firstDate() === shiftISO(originalFirst, 5), 'Previous arrow moves back one day');
  pointer(dayGrid.firstElementChild, 'pointerdown', 150);
  pointer(daySurface, 'pointermove', 230);
  pointer(daySurface, 'pointerup', 230);
  await settleDays();
  assert(firstDate() === originalFirst, 'Right date swipe returns five days');
  for (const kind of ['short', 'cancel', 'vertical']) {
    pointer(dayGrid.firstElementChild, 'pointerdown', 150);
    pointer(daySurface, 'pointermove', kind === 'short' ? 140 : kind === 'vertical' ? 145 : 70, kind === 'vertical' ? 200 : 100);
    pointer(daySurface, kind === 'cancel' ? 'pointercancel' : 'pointerup', kind === 'short' ? 140 : kind === 'vertical' ? 145 : 70, kind === 'vertical' ? 200 : 100);
    await settleDays();
    assert(firstDate() === originalFirst, `${kind} gesture does not change dates`);
  }
  assert(doc().querySelector('#date-input').value === originalSelection &&
    frame.contentWindow.testRequests.length === requestsBeforeDateBrowsing, 'Browsing date strip leaves menu selection and API requests unchanged');
  const tappedDate = dayGrid.firstElementChild.dataset.date;
  pointer(dayGrid.firstElementChild, 'pointerdown', 150);
  pointer(dayGrid.firstElementChild, 'pointerup', 150);
  dayGrid.firstElementChild.click();
  await wait();
  assert(doc().querySelector('#date-input').value === tappedDate, 'Date buttons remain tappable after swiping');
  pass('Date strip tracks finger; swipes move five weekdays, arrows one; taps, cancellation and vertical gestures preserved');
  const dateInput = doc().querySelector('#date-input');
  for (const date of ['2026-10-24', '2026-10-25', '2026-10-26']) {
    dateInput.value = date;
    dateInput.dispatchEvent(new frame.contentWindow.Event('change'));
    await wait();
    const days = doc().querySelectorAll('.day-button');
    assert(dateInput.value === '2026-10-26', 'Weekend selections advance to Monday');
    assert(days.length === 5, 'Five weekday tabs after weekend selection');
    assert([...days].every((day) => ![0, 6].includes(new Date(day.dataset.date + 'T12:00:00Z').getUTCDay())), 'No weekend tabs');
    assert([...days].filter((day) => day.getAttribute('aria-pressed') === 'true').length === 1, 'Selected weekday remains visible');
  }
  dateInput.value = '2026-10-23';
  dateInput.dispatchEvent(new frame.contentWindow.Event('change'));
  await wait();
  for (let i = 0; i < 5; i++) {
    doc().querySelector('#next-week').click();
    await settleDays();
  }
  assert(firstDate() === '2026-10-26', 'Mobile arrows skip Saturday and Sunday');
  assert([...dayGrid.children].every((day) =>
    ![0, 6].includes(new Date(day.dataset.date + 'T12:00:00Z').getUTCDay())), 'Mobile strip remains weekday-only across week boundary');
  doc().querySelector('#previous-week').click();
  await settleDays();
  assert(firstDate() === '2026-10-23', 'Reverse arrow skips back from Monday to Friday');
  pass('Weekday-only navigation, weekend date-picker normalization, forward/reverse weekend skipping');
  const defaultCases = [
    ['2026-01-15T13:59:59Z', '2026-01-15', false],
    ['2026-01-15T14:00:00Z', '2026-01-15', true],
    ['2026-01-15T17:59:59Z', '2026-01-15', true],
    ['2026-01-15T18:00:00Z', '2026-01-16', false],
    ['2026-07-15T12:59:59Z', '2026-07-15', false],
    ['2026-07-15T13:00:00Z', '2026-07-15', true],
    ['2026-07-15T16:59:59Z', '2026-07-15', true],
    ['2026-07-15T17:00:00Z', '2026-07-16', false],
    ['2026-12-31T18:00:00Z', '2027-01-01', false],
    ['2028-02-28T18:00:00Z', '2028-02-29', false],
    ['2026-03-28T18:00:00Z', '2026-03-30', false],
    ['2026-10-24T17:00:00Z', '2026-10-26', false],
    ['2026-01-16T18:00:00Z', '2026-01-19', false],
    ['2026-01-17T10:00:00Z', '2026-01-19', false],
    ['2026-01-18T10:00:00Z', '2026-01-19', false],
    ['2026-07-15T22:00:00Z', '2026-07-16', false]
  ];
  for (const [instant, expectedDate, expectedEvening] of defaultCases) {
    const previousDocument = doc();
    const timedFixtures = fixtures.replaceAll('2026-10-22T10:00:00Z', instant);
    frame.srcdoc = html.replace('<head>', `<head><base href="${new URL('../', location.href)}"><script>${timedFixtures}<\/script>`)
      .replace('<link rel="stylesheet" href="./styles.css">', `<style>${css.replace(/^@import.*$/m, '')}</style>`);
    for (let i = 0; i < 200; i++) {
      if (doc() !== previousDocument && doc()?.querySelector('.cafeteria-chip') &&
          doc().querySelector('#menus')?.getAttribute('aria-busy') === 'false') break;
      await wait();
    }
    assert(doc().querySelector('#date-input')?.value === expectedDate, `Default date at ${instant}`);
    assert(doc().querySelector('#evening-switch')?.checked === expectedEvening, `Default meal period at ${instant}`);
    assert(frame.contentWindow.testRequests.some((url) => url.includes(`/days/${expectedDate}/meals`)), `Requested menu date at ${instant}`);
  }
  pass('Berlin defaults at 15:00/19:00, winter/summer time, year/leap-day/DST/weekend rollover and midnight');
  output.textContent += '\n\nAll tests passed. Physical-device touch testing remains a separate check.';
  document.title = 'PASS — Swipe regression tests';
} catch (error) {
  output.textContent += `\nFAIL: ${error.message}`;
  document.title = 'FAIL — Swipe regression tests';
  console.error(error);
}
