const output = document.querySelector('#output');
const frame = document.querySelector('#preview');
const wait = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(ok, label) { if (!ok) throw new Error(label); }
function pass(label) { output.textContent += `\nPASS: ${label}`; }

try {
  const [html, css] = await Promise.all([
    fetch('../index.html').then((response) => response.text()),
    fetch('../styles.css').then((response) => response.text())
  ]);
  const fixtures = `
    const NativeDate = Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : ['2026-10-22T10:00:00Z'])); }
    };
    Object.defineProperty(window, 'localStorage', { value: {getItem(){return '[2]'},setItem(){}} });
    window.slotRandom = 0;
    Math.random = () => window.slotRandom;
    const imageSource = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      get: imageSource.get,
      set(value) {
        imageSource.set.call(this, 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#a0d7b8"/><circle cx="400" cy="300" r="160" fill="#da321c"/></svg>'));
      }
    });
    window.slotReduced = false;
    const motionListeners = new Set();
    window.slotSetReduced = (value) => {
      window.slotReduced = value;
      motionListeners.forEach((listener) => listener());
    };
    const realMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => query === '(prefers-reduced-motion: reduce)'
      ? {get matches(){return window.slotReduced},addEventListener(type,listener){motionListeners.add(listener)}}
      : realMatchMedia(query);
    window.slotRequests = [];
    window.fetch = async (url) => {
      window.slotRequests.push(url);
      const meal = (id, note) => ({id,name:'Meal '+id+(id===2?' (A1)':''),category:'Tagesgericht',image:'https://fixture.invalid/meal-'+id+'.svg',
        notes:note?[note]:[],prices:{Studierende:2.35,Bedienstete:4.9}});
      return new Response(JSON.stringify(url.endsWith('/canteens')
        ? [{id:1,name:'Cafeteria A'},{id:2,name:'Hidden cafeteria'},{id:3,name:'Cafeteria B'}]
        : url.includes('/canteens/1/')
          ? [meal(1,'Menü ist vegan'),meal(2,'Menü ist vegetarisch'),meal(3),
             {...meal(5,'Menü ist vegan'),category:'Abendangebot'}]
          : [meal(4,'Menü ist vegan')]
      ),{headers:{'Content-Type':'application/json'}});
    };
  `;
  frame.srcdoc = html.replace('<head>', `<head><base href="${new URL('../', location.href)}"><script>${fixtures}<\/script>`)
    .replace('<link rel="stylesheet" href="./styles.css">', `<style>${css.replace(/^@import.*$/m, '')}</style>`);
  const doc = () => frame.contentDocument;
  const win = () => frame.contentWindow;
  for (let i = 0; i < 200; i++) {
    if (doc()?.querySelector('#results-summary')?.textContent.includes('Gerichte')) break;
    await wait();
  }
  assert(doc().querySelector('#results-summary')?.textContent.includes('Gerichte'), 'App initialized in the default Tom-View');
  doc().querySelector('#tom-view').click();
  for (let i = 0; i < 200; i++) {
    if (doc()?.querySelector('#start-slot')?.disabled === false) break;
    await wait();
  }
  const button = doc().querySelector('#start-slot');
  assert(button && !button.disabled, 'Slot button enabled after menus load');
  assert(!win().slotRequests.some((url) => url.includes('/canteens/2/')), 'Hidden cafeteria never queried');
  const dialog = doc().querySelector('#meal-slot');
  const lever = dialog.querySelector('.slot-lever');
  const track = dialog.querySelector('.slot-track');
  const close = dialog.querySelector('.slot-close');
  const name = () => track.querySelector('.meal-name')?.textContent;
  const endSpin = async () => {
    track.getAnimations().forEach((animation) => animation.finish());
    await wait();
  };
  button.click();
  assert(dialog.open && doc().activeElement === lever, 'Modal opens with keyboard focus on handle');
  assert(dialog.querySelector('.slot-context').textContent.includes('4 passende Gerichte'), 'All selected cafeterias included');
  assert(track.children[0].inert, 'Unselected preview cannot receive focus');
  const requestsBeforeSpin = win().slotRequests.length;
  lever.click();
  assert(lever.disabled && track.getAttribute('aria-busy') === 'true', 'Repeated pulls disabled during animation');
  assert(track.children.length === 19, 'Reel contains a bounded animation sequence');
  assert([...track.children].every((node) => node.inert && node.getAttribute('aria-hidden') === 'true'), 'Spinning entries hidden from keyboard and screen reader');
  assert([...track.children].every((node) =>
    win().getComputedStyle(node.querySelector('.meal-content')).display === 'none' &&
    win().getComputedStyle(node.querySelector('.slot-canteen')).display === 'none'
  ), 'Spinning reel hides meal descriptions and cafeteria headings');
  assert(track.querySelector('.meal-photo').getBoundingClientRect().height === track.children[0].getBoundingClientRect().height, 'Photos fill each spinning reel entry');
  const landingPhoto = track.lastElementChild.querySelector('img');
  const photoSize = landingPhoto.getBoundingClientRect();
  assert(win().getComputedStyle(landingPhoto).objectFit === 'contain', 'Spinning picture is not cropped');
  const knobAnimation = lever.querySelector('.slot-knob').getAnimations()[0];
  const stemAnimation = lever.querySelector('.slot-stem').getAnimations()[0];
  knobAnimation.pause();
  stemAnimation.pause();
  knobAnimation.currentTime = stemAnimation.currentTime = 330;
  assert(new (win().DOMMatrixReadOnly)(win().getComputedStyle(lever.querySelector('.slot-knob')).transform).m42 > 50, 'Handle knob pulls downward instead of flipping');
  assert(new (win().DOMMatrixReadOnly)(win().getComputedStyle(lever.querySelector('.slot-stem')).transform).m22 < .6, 'Handle shaft contracts toward its fixed base');
  assert(!dialog.querySelector('.slot-confetti'), 'No confetti before result is selected');
  const animation = track.getAnimations()[0];
  assert(animation?.effect.getTiming().duration === 2800, 'Slot has decelerating reel animation');
  animation.pause();
  animation.currentTime = 1400;
  const y = new (win().DOMMatrixReadOnly)(win().getComputedStyle(track).transform).m42;
  const distance = track.children[0].getBoundingClientRect().height * 18;
  assert(y < 0 && y > -distance, 'Reel moves vertically during spin');
  await endSpin();
  assert(name() === 'Meal 1' && !lever.disabled && track.children.length === 1, 'First random bucket selects first meal and cleans up reel');
  assert(!track.children[0].inert && track.getAttribute('aria-busy') === 'false', 'Result becomes accessible');
  assert(dialog.querySelector('.slot-status').textContent.includes('Cafeteria A'), 'Result identifies cafeteria');
  assert(win().getComputedStyle(track.querySelector('.meal-content')).display !== 'none', 'Descriptions revealed after reel stops');
  assert(track.querySelector('img') === landingPhoto, 'Landing photo is retained without replacement');
  assert(landingPhoto.getBoundingClientRect().height === photoSize.height &&
    landingPhoto.getBoundingClientRect().width === photoSize.width, 'Picture size is unchanged by description reveal');
  assert(win().getComputedStyle(landingPhoto).objectFit === 'contain', 'Selected picture remains uncropped');
  const description = track.querySelector('.meal-content');
  assert(win().getComputedStyle(description).position === 'absolute', 'Description overlays picture rather than shrinking it');
  const revealAnimation = description.getAnimations()[0];
  assert(revealAnimation, 'Description slides in after selection');
  revealAnimation.pause();
  revealAnimation.currentTime = 100;
  const slide = new (win().DOMMatrixReadOnly)(win().getComputedStyle(description).transform).m42;
  assert(slide > 0 && slide < description.getBoundingClientRect().height, 'Description reveal interpolates upward');
  revealAnimation.finish();
  const confetti = dialog.querySelector('.slot-confetti');
  assert(confetti?.children.length === 42 && confetti.inert && confetti.getAttribute('aria-hidden') === 'true', 'Result triggers bounded decorative confetti');
  assert(confetti.children[0].style.left === '3%' && confetti.children[1].style.left === '97%', 'Confetti launches from both sides');
  const leftFrames = confetti.children[0].getAnimations()[0].effect.getKeyframes();
  assert(leftFrames.length === 17 && leftFrames[4].transform.includes('-'), 'Confetti uses a sampled upward-and-falling trajectory');
  assert(win().getComputedStyle(confetti).pointerEvents === 'none', 'Confetti cannot block meal or handle interaction');
  const particle = confetti.firstElementChild;
  const particleAnimation = particle.getAnimations()[0];
  particleAnimation.pause();
  particleAnimation.currentTime = particleAnimation.effect.getTiming().duration * .5 + particleAnimation.effect.getTiming().delay;
  assert(Number(win().getComputedStyle(particle).opacity) > 0, 'Confetti is visible during burst');
  [...confetti.children].forEach((piece) => piece.getAnimations().forEach((effect) => effect.finish()));
  await wait();
  assert(!dialog.querySelector('.slot-confetti'), 'Confetti removes particles and overlay after completion');
  pass('Mechanical handle pull, unchanged uncropped picture, sliding overlay and two-sided confetti with cleanup');
  win().slotRandom = .99999;
  lever.click();
  await endSpin();
  assert(name() === 'Meal 4' && track.querySelector('.slot-canteen').textContent === 'Cafeteria B', 'Last random bucket includes another selected cafeteria');
  win().slotSetReduced(true);
  assert(track.getAnimations().length === 0, 'Changing motion preference after a result cannot restart an old spin');
  assert(!dialog.querySelector('.slot-confetti'), 'Reduced-motion preference cancels an active confetti burst');
  win().slotSetReduced(false);
  lever.click();
  win().slotSetReduced(true);
  await wait();
  assert(!lever.disabled && name() === 'Meal 4', 'Enabling reduced motion ends an active spin safely');
  assert(!dialog.querySelector('.slot-confetti'), 'Finishing with reduced motion does not celebrate with animation');
  win().slotSetReduced(false);
  assert(win().slotRequests.length === requestsBeforeSpin, 'Spinning uses loaded meals without API requests');
  pass('Handle, vertical animation, selection across cafeterias, keyboard focus, repeated-pull guard and no extra requests');

  const winnerCard = track.querySelector('.meal-card');
  winnerCard.focus();
  winnerCard.dispatchEvent(new (win()).KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert(doc().querySelector('.picker-detail').open, 'Winner supports full meal details');
  doc().querySelector('.picker-detail .picker-close').click();
  close.click();
  await wait();
  doc().querySelector('input[name="price-category"][value="employee"]').click();
  button.click();
  win().slotReduced = true;
  lever.click();
  assert(name() === 'Meal 4' && !lever.disabled && track.getAnimations().length === 0, 'Reduced motion skips automatic animation');
  assert(!dialog.querySelector('.slot-confetti'), 'Reduced motion skips confetti');
  assert(track.querySelector('.meal-prices').textContent.includes('4,90'), 'Winner uses selected price');
  close.click();
  await wait();
  const requestsBeforeExclusion = win().slotRequests.length;
  doc().querySelector('#additive-options input[data-code="A1"]').click();
  await wait();
  button.click();
  assert(dialog.querySelector('.slot-context').textContent.includes('3 passende Gerichte'), 'Title-code exclusions narrow random pool');
  win().slotRandom = .4;
  lever.click();
  assert(name() === 'Meal 3', 'Excluded title code cannot be selected');
  close.click();
  await wait();
  doc().querySelector('#clear-additives').click();
  await wait();
  assert(win().slotRequests.length === requestsBeforeExclusion, 'Exclusions and reset do not request menus');
  win().slotRandom = .99999;
  doc().querySelector('#dietary-filter input[value="meat"]').click();
  doc().querySelector('#dietary-filter input[value="vegetarian"]').click();
  await wait();
  button.click();
  assert(dialog.querySelector('.slot-context').textContent.includes('2 passende Gerichte'), 'Diet filter narrows the random pool');
  lever.click();
  assert(name() === 'Meal 4', 'Filtered winner is vegan');
  close.click();
  await wait();
  doc().querySelector('#evening-switch').click();
  await wait();
  button.click();
  assert(dialog.querySelector('.slot-context').textContent.includes('1 passende Gerichte'), 'Period and diet filters combine');
  lever.click();
  assert(name() === 'Meal 5', 'Single matching meal works');
  pass('Meal details, selected prices, reduced motion, additive/dietary/period filters and single-meal selection');

  win().slotReduced = false;
  lever.click();
  const cancelledAnimation = track.getAnimations()[0];
  close.click();
  await wait();
  assert(cancelledAnimation.playState === 'idle' && !doc().body.classList.contains('picker-open'), 'Closing cancels pending spin and unlocks page');
  assert(!dialog.querySelector('.slot-confetti'), 'Closing a cancelled spin does not leave celebration effects');
  button.click();
  lever.click();
  const obsoleteAnimation = track.getAnimations()[0];
  doc().querySelector('#date-input').value = '2026-10-23';
  doc().querySelector('#date-input').dispatchEvent(new (win().Event)('change'));
  await wait();
  assert(!dialog.open && obsoleteAnimation.playState === 'idle', 'Changing date aborts stale selection');
  button.click();
  assert(dialog.querySelector('.slot-context').textContent.includes('23.'), 'New selection uses changed date');
  close.click();
  await wait();
  doc().querySelector('#toggle-all').click();
  await wait();
  assert(button.disabled, 'No selected cafeterias disables machine');
  pass('Cancellation, stale-result protection, date changes and empty selections');

  doc().querySelector('#toggle-all').click();
  await wait();
  win().slotReduced = true;
  for (const [width, height] of [[1200,900],[390,844],[320,568],[667,375]]) {
    frame.width = width;
    frame.height = height;
    await wait();
    button.click();
    lever.click();
    assert(dialog.scrollWidth <= dialog.clientWidth + 1, `No machine overflow at ${width}×${height}`);
    const content = track.querySelector('.meal-content');
    assert(content.scrollHeight <= content.clientHeight + 1, `Result text fits at ${width}×${height}`);
    close.click();
    await wait();
  }
  doc().documentElement.dataset.theme = 'dark';
  button.click();
  assert(win().getComputedStyle(dialog).backgroundColor !== 'rgb(255, 255, 255)', 'Slot supports dark theme');
  close.click();
  pass('Desktop, phone, compact/landscape layouts and dark mode');
  output.textContent += '\n\nAll tests passed. Physical-device testing remains a separate check.';
  document.title = 'PASS — Slot regression tests';
} catch (error) {
  output.textContent += `\nFAIL: ${error.message}`;
  document.title = 'FAIL — Slot regression tests';
  console.error(error);
}
