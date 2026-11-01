const output = document.querySelector('#output');
const frame = document.querySelector('#preview');
const wait = () => new Promise((resolve) => setTimeout(resolve, 30));
function assert(ok, label) { if (!ok) throw new Error(label); }
function pass(label) { output.textContent += `\nPASS: ${label}`; }

try {
  const [html, css] = await Promise.all([
    fetch('../index.html').then((response) => response.text()),
    fetch('../styles.css').then((response) => response.text())
  ]);
  async function load({ dark = false, saved = null, blocked = false } = {}) {
    const old = frame.contentDocument;
    const fixture = `
      let saved = ${JSON.stringify(saved)};
      window.themeStored = () => saved;
      Object.defineProperty(window, 'localStorage', { value: {
        getItem() { if (${blocked}) throw Error('Blocked'); return saved; },
        setItem(key, value) { if (${blocked}) throw Error('Blocked'); saved = value; }
      }});
      const listeners = new Set();
      const media = { matches: ${dark}, addEventListener(type, listener) { listeners.add(listener); } };
      window.matchMedia = () => media;
      window.changeSystemTheme = (dark) => { media.matches = dark; listeners.forEach(listener => listener()); };
    `;
    frame.srcdoc = html.replace('<head>', `<head><base href="${new URL('../', location.href)}"><script>${fixture}<\/script>`)
      .replace('<script type="module" src="./app.js"></script>', '')
      .replace('<link rel="stylesheet" href="./styles.css">', `<style>${css.replace(/^@import.*$/m, '')}</style>`);
    for (let i = 0; i < 200; i++) {
      if (frame.contentDocument !== old && frame.contentDocument?.readyState === 'complete') return;
      await wait();
    }
    throw Error('Theme fixture timed out');
  }
  const doc = () => frame.contentDocument;
  const win = () => frame.contentWindow;
  const button = () => doc().querySelector('#theme-toggle');
  function expectTheme(theme) {
    assert(doc().documentElement.dataset.theme === theme, `Active ${theme} theme`);
    assert(button().getAttribute('aria-pressed') === String(theme === 'dark'), 'Accessible pressed state');
    assert(doc().querySelector('meta[name="theme-color"]').content === (theme === 'dark' ? '#0b1220' : '#ffffff'), 'Browser theme color');
    assert(win().getComputedStyle(doc().documentElement).colorScheme === theme, 'Native control color scheme');
  }
  for (const [dark, saved, expected] of [
    [false, null, 'light'], [true, null, 'dark'],
    [true, 'light', 'light'], [false, 'dark', 'dark'], [true, 'invalid', 'dark']
  ]) {
    await load({ dark, saved });
    expectTheme(expected);
  }
  pass('Browser light/dark defaults, saved overrides and invalid saved values');

  await load();
  win().changeSystemTheme(true);
  expectTheme('dark');
  button().click();
  expectTheme('light');
  assert(win().themeStored() === 'light', 'Manual preference saved');
  win().changeSystemTheme(false);
  win().changeSystemTheme(true);
  expectTheme('light');
  button().click();
  expectTheme('dark');
  assert(win().themeStored() === 'dark', 'Dark preference saved');
  pass('Live system changes before override; toggle persists and takes precedence');

  win().dispatchEvent(new (win().StorageEvent)('storage', { key: 'mensa-theme-v1', newValue: 'light' }));
  expectTheme('light');
  win().dispatchEvent(new (win().StorageEvent)('storage', { key: 'mensa-theme-v1', newValue: null }));
  expectTheme('dark');
  win().changeSystemTheme(false);
  expectTheme('light');
  pass('Cross-tab preference updates and reset to system');

  await load({ dark: true, blocked: true });
  expectTheme('dark');
  button().click();
  expectTheme('light');
  pass('Blocked storage does not prevent initialization or toggling');

  function rgb(value) { return value.match(/[\d.]+/g).slice(0, 3).map(Number); }
  function luminance(color) {
    return rgb(color).map((v) => {
      const c = v / 255;
      return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
    }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  }
  function contrast(node) {
    const style = win().getComputedStyle(node);
    let background = node;
    while (background.parentElement && win().getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)') {
      background = background.parentElement;
    }
    const values = [luminance(style.color), luminance(win().getComputedStyle(background).backgroundColor)].sort((a, b) => b - a);
    assert((values[0] + .05) / (values[1] + .05) >= 4.5,
      `Text contrast: ${node.className || node.tagName} (${style.color} on ${style.backgroundColor})`);
  }
  for (const theme of ['light', 'dark']) {
    await load({ saved: theme });
    const card = doc().createElement('article');
    card.className = 'meal-card';
    card.innerHTML = '<div class="meal-photo"><span class="diet-badge" role="img" aria-label="Vegan"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 3C9 2 3 7 5 14c2 7 14 6 15-11Z"/></svg></span></div><div class="meal-content"><h4 class="meal-name">Testgericht</h4></div>';
    doc().querySelector('#menus').append(card);
    const day = doc().createElement('button');
    day.className = 'day-button';
    day.setAttribute('aria-pressed', 'true');
    day.textContent = 'Heute';
    doc().querySelector('#week-days').append(day);
    for (const node of [doc().body, card, day, card.querySelector('.diet-badge'),
      doc().querySelector('.price-category span')]) contrast(node);
    for (const options of doc().querySelectorAll('.dietary-options')) {
      for (const input of options.querySelectorAll('input')) {
        for (let i = 0; i < 2; i++) {
          input.click();
          input.nextElementSibling.getAnimations().forEach((animation) => animation.finish());
          contrast(input.nextElementSibling);
        }
      }
    }
    assert(card.getBoundingClientRect().height === 420, 'Theme preserves fixed card height');
    const dialog = doc().createElement('dialog');
    dialog.className = 'meal-picker picker-detail';
    dialog.innerHTML = '<button class="picker-close" type="button">×</button><article class="meal-card"><div class="meal-content"><h4 class="meal-name">Testgericht</h4></div></article>';
    doc().body.append(dialog);
    dialog.showModal();
    contrast(dialog);
    assert(win().getComputedStyle(dialog).backgroundColor === win().getComputedStyle(card).backgroundColor, 'Dialog and cards use themed surfaces');
    dialog.close();
    dialog.remove();
    frame.width = 320;
    await wait();
    assert(doc().documentElement.scrollWidth <= 320, 'No horizontal overflow at 320px');
    assert(button().getBoundingClientRect().right <= 320, 'Toggle fits mobile header');
    frame.width = 390;
  }
  pass('Light/dark text contrast, dietary filter states, cards, dialogs, native inputs and compact mobile header');
  output.textContent += '\n\nAll tests passed.';
  document.title = 'PASS — Theme regression tests';
} catch (error) {
  output.textContent += `\nFAIL: ${error.message}`;
  document.title = 'FAIL — Theme regression tests';
  console.error(error);
}
