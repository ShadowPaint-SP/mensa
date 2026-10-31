// Drives the browser regression pages over the Chrome DevTools Protocol and
// turns their on-page PASS/FAIL output into a process exit code.
//
// Usage: node browser-tests.mjs <base-url> <page>...
// Environment: CDP_PORT (default 9222), TIMEOUT_MS per page (default 120000).
// Requires a Chromium already listening on CDP_PORT; see browser-tests.sh.

const cdpPort = process.env.CDP_PORT ?? '9222';
const timeoutMs = Number(process.env.TIMEOUT_MS ?? 120000);
const [base, ...pages] = process.argv.slice(2);
if (!base || pages.length === 0) {
  console.error('usage: node browser-tests.mjs <base-url> <page>...');
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function browserEndpoint() {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(`Chromium did not expose CDP on port ${cdpPort}: ${lastError}`);
}

const ws = new WebSocket(await browserEndpoint());
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const listeners = new Set();
let browserClosed = false;
ws.addEventListener('close', () => {
  browserClosed = true;
  for (const { reject } of pending.values()) reject(new Error('CDP connection closed'));
  pending.clear();
});
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(`${message.method}: ${message.error.message}`));
    else resolve(message.result);
  } else if (message.method) {
    for (const listener of listeners) listener(message);
  }
});

function send(method, params = {}, sessionId) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);

let consoleErrors = [];
listeners.add((message) => {
  if (message.sessionId !== sessionId) return;
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(message.params.exceptionDetails.text);
  } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
  }
});

async function pageState() {
  const { result } = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      title: document.title,
      output: document.querySelector('#output')?.textContent ?? ''
    })`,
    returnByValue: true
  }, sessionId);
  return JSON.parse(result.value);
}

let failed = false;
for (const page of pages) {
  if (browserClosed) {
    failed = true;
    break;
  }
  consoleErrors = [];
  const url = new URL(page, base).href;
  console.log(`\n── ${page} ──`);
  await send('Page.navigate', { url }, sessionId);

  const deadline = Date.now() + timeoutMs;
  let state = { title: '', output: '' };
  while (Date.now() < deadline) {
    if (browserClosed) { failed = true; break; }
    try {
      state = await pageState();
    } catch {
      // Execution context is replaced while the page navigates.
    }
    if (/^(PASS|FAIL)\b/.test(state.title)) break;
    await sleep(250);
  }

  const finished = /^(PASS|FAIL)\b/.test(state.title);
  if (state.output.trim()) console.log(state.output.trim());
  if (browserClosed) {
    console.log('ERROR: Chromium or its CDP connection died');
    failed = true;
    break;
  }
  if (!finished) {
    console.log(`TIMEOUT: ${page} did not finish within ${timeoutMs} ms`);
    failed = true;
  } else if (state.title.startsWith('FAIL') || /(^|\n)FAIL: /.test(state.output)) {
    failed = true;
  }
  if (consoleErrors.length) {
    console.log('Console errors:');
    for (const error of consoleErrors) console.log(`  ${error}`);
  }
}

ws.close();
console.log(failed ? '\nBrowser regression tests FAILED' : '\nBrowser regression tests passed');
process.exit(failed ? 1 : 0);
