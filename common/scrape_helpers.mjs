// Shared plumbing for the Kanopy and Swank Puppeteer scrapers.
//
// Neither vendor has an API for MARC exports, so these scripts drive the
// vendors' admin web UI the way a person would. That will always break when a
// vendor redesigns their site. The helpers here aim to:
//
//  1. tolerate small changes - elements are located by a list of candidate
//     CSS selectors and/or by their visible text / aria-label, rather than by
//     auto-generated ids or nth-child positions. When a fallback (rather than
//     the first-choice locator) is what matched, a SELECTOR_FALLBACK line is
//     logged so drift can be noticed before things break completely.
//
//  2. fail loudly and specifically - every part of the click-through is a
//     named step(). If a step throws, a screenshot + HTML snapshot is saved,
//     and a small key=value "scrape_result" file is written into the data
//     directory. The bash wrappers read that file and turn it into a
//     VIDEO_INDEXER_ALERT log line, which CloudWatch alarms on.
//
// This module deliberately imports no npm packages, so it resolves the same
// way regardless of where node_modules is linked.

import fs from 'fs';
import path from 'path';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export function getArgs() {
  const args = {};
  process.argv
    .slice(2, process.argv.length)
    .forEach( arg => {
      // long arg
      if (arg.slice(0,2) === '--') {
        const longArg = arg.split('=');
        const longArgFlag = longArg[0].slice(2,longArg[0].length);
        const longArgValue = longArg.length > 1 ? longArg.slice(1).join('=') : true;
        args[longArgFlag] = longArgValue;
      }
      // flags
      else if (arg[0] === '-') {
        const flags = arg.slice(1,arg.length).split('');
        flags.forEach(flag => {
          args[flag] = true;
        });
      }
    });
  return args;
}

// An error tagged with the name of the step that failed and where its
// diagnostics snapshot was written.
export class StepError extends Error {
  constructor(step, message, diagnostics = '') {
    super(message);
    this.name = 'StepError';
    this.step = step;
    this.diagnostics = diagnostics;
  }
}

// Keeps a value on one line and free of double quotes so it can be embedded
// in the scrape_result file and in a bash-emitted log line.
function oneLine(s, max = 300) {
  return String(s ?? '').replace(/[\r\n"]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Dumps a URL/screenshot/HTML snapshot for post-mortem debugging.
// Wrapped so a diagnostics failure never masks the real error.
// Returns the screenshot path (or '' if it couldn't be written).
export async function logDiagnostics(page, screenshot_dir, label) {
  const stamp = Date.now();
  const base = `${screenshot_dir}/diag_${label}_${stamp}`;
  try {
    console.log(`DIAG[${label}] url = ${page.url()}`);
    await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
    // Include every frame: the Kanopy MARC tool lives inside an iframe, and
    // the top-level page.content() alone doesn't show what was in it.
    let html = await page.content().catch(() => '<content() failed>');
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const fhtml = await frame.content().catch(() => '<frame content() failed>');
      html += `\n\n<!-- ===== frame: ${frame.url()} ===== -->\n${fhtml}`;
    }
    fs.writeFileSync(`${base}.html`, html);
    console.log(`DIAG[${label}] snapshot written: ${base}.{png,html}`);
    return `${base}.png`;
  } catch (diagErr) {
    console.log(`DIAG[${label}] failed to collect diagnostics:`, diagErr.message);
    return '';
  }
}

// Creates the per-run context: logging, named steps, and the result file.
//   provider    - 'kanopy' | 'swank', used in log lines
//   datadir     - the provider's data directory
//   maxMinutes  - hard ceiling for the whole run. A hung Chrome would
//                 otherwise hold the cron job's flock forever and silently
//                 stop every subsequent day's run.
export function createScrapeRun({ provider, datadir, verbose = false, maxMinutes = 15 }) {
  const screenshot_dir = `${datadir}/screenshots`;
  const result_file = `${datadir}/scrape_result`;
  fs.mkdirSync(screenshot_dir, { recursive: true });
  fs.rmSync(result_file, { force: true });

  const run = {
    provider, datadir, verbose, screenshot_dir, result_file, maxMinutes,
    browser: null,
    page: null,
    currentStep: 'startup',

    vlog(...msg) { if (verbose) console.log(...msg); },

    // Runs one named part of the click-through. Any error thrown inside is
    // converted into a StepError naming this step, with a diagnostics snapshot.
    async step(name, fn) {
      run.currentStep = name;
      console.log(`STEP ${name}: starting`);
      const t0 = Date.now();
      try {
        const result = await fn();
        console.log(`STEP ${name}: done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        return result;
      } catch (err) {
        if (err instanceof StepError) throw err;
        const diag = run.page ? await logDiagnostics(run.page, screenshot_dir, name) : '';
        throw new StepError(name, err.message, diag);
      }
    },

    async screenshot(name) {
      if (run.page) await run.page.screenshot({ path: `${screenshot_dir}/${name}.png` }).catch(() => {});
    },

    writeResult(status, step = '', error = '', diagnostics = '') {
      const lines = [
        `status=${status}`,
        `provider=${provider}`,
        `step=${oneLine(step, 80)}`,
        `error=${oneLine(error)}`,
        `diagnostics=${oneLine(diagnostics, 200)}`,
        `time=${new Date().toISOString()}`,
      ];
      try {
        fs.writeFileSync(result_file, lines.join('\n') + '\n');
      } catch (err) {
        console.log(`Failed to write ${result_file}: ${err.message}`);
      }
    },
  };
  return run;
}

async function closeBrowser(browser) {
  // browser.close() has been seen to hang when Chrome is wedged; don't let
  // that turn a clean failure into a hung job.
  await Promise.race([browser.close().catch(() => {}), sleep(15000)]);
}

// Runs the scrape body, records the outcome in the result file, closes the
// browser and exits the process with 0 (success) or 1 (failure).
export async function runScrape(run, body) {
  const watchdog = setTimeout(async () => {
    const msg = `Scrape exceeded ${run.maxMinutes} minute limit while in step "${run.currentStep}"`;
    console.log(`SCRAPE FAILED: ${msg}`);
    const diag = run.page ? await Promise.race([logDiagnostics(run.page, run.screenshot_dir, 'watchdog'), sleep(20000)]) : '';
    run.writeResult('failed', run.currentStep, msg, diag || '');
    process.exit(1);
  }, run.maxMinutes * 60 * 1000);

  let exitCode = 0;
  try {
    await body();
    run.writeResult('ok', run.currentStep);
    console.log(`SCRAPE OK (${run.provider})`);
  } catch (err) {
    exitCode = 1;
    const step = err.step || run.currentStep;
    let diag = err.diagnostics || '';
    if (!diag && run.page) diag = await logDiagnostics(run.page, run.screenshot_dir, `fatal_${step}`);
    console.log(`SCRAPE FAILED at step "${step}": ${err.message}`);
    run.writeResult('failed', step, err.message, diag);
  } finally {
    if (run.browser) await closeBrowser(run.browser);
    clearTimeout(watchdog);
  }
  process.exit(exitCode);
}

// Waits until the page's HTML stops changing size, i.e. client-side
// rendering has (probably) settled.
export async function waitTillHTMLRendered(page, timeout = 30000, checkDurationMsecs = 1000) {
  const maxChecks = timeout / checkDurationMsecs;
  let lastHTMLSize = 0;
  let checkCounts = 1;
  let countStableSizeIterations = 0;
  const minStableSizeIterations = 3;
  await sleep(checkDurationMsecs);

  while (checkCounts++ <= maxChecks) {
    let currentHTMLSize;
    try {
      currentHTMLSize = (await page.content()).length;
    } catch (transientErr) {
      // "Execution context was destroyed" means the page is mid-navigation
      // (another redirect fired). Treat it as "still loading", not fatal.
      console.log(`waitTillHTMLRendered: transient error (${transientErr.message}), retrying...`);
      countStableSizeIterations = 0;
      lastHTMLSize = 0;
      await sleep(checkDurationMsecs);
      continue;
    }

    if (lastHTMLSize != 0 && currentHTMLSize == lastHTMLSize)
      countStableSizeIterations++;
    else
      countStableSizeIterations = 0;

    if (countStableSizeIterations >= minStableSizeIterations) return;

    lastHTMLSize = currentHTMLSize;
    await sleep(checkDurationMsecs);
  }
  console.log(`waitTillHTMLRendered: page still changing after ${timeout}ms, continuing anyway (url: ${page.url()})`);
}

// Navigates and waits for rendering to settle. A networkidle timeout is not
// fatal (pages with long-polling never go idle); whatever the next step looks
// for will fail with a clear message if the page truly didn't load.
export async function gotoPage(run, url, { waitUntil = 'networkidle2', timeout = 60000 } = {}) {
  run.vlog(`goto ${url}`);
  try {
    await run.page.goto(url, { waitUntil, timeout });
  } catch (err) {
    if (err.name !== 'TimeoutError') throw new Error(`Could not load ${url}: ${err.message}`);
    console.log(`goto ${url}: ${waitUntil} not reached within ${timeout}ms, continuing`);
  }
  await waitTillHTMLRendered(run.page);
  run.vlog(`now at ${run.page.url()}`);
}

const CLICKABLE = 'button, a, [role=button], [role=menuitem], [role=tab], [role=checkbox], input[type=submit], input[type=button], mat-checkbox';

// In-page: finds the first visible element under `within` whose text,
// aria-label, title or value matches one of `texts`. Matching ignores case and
// whitespace. Exact matches beat substring matches, unless exact=true in which
// case substrings are never accepted.
function findByTextInPage(texts, within, exact) {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = el => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const labels = el => [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title'), el.value]
    .map(norm).filter(Boolean);
  const wanted = texts.map(norm);
  const els = Array.from(document.querySelectorAll(within)).filter(visible);
  for (const w of wanted) {
    const hit = els.find(el => labels(el).includes(w));
    if (hit) return hit;
  }
  if (exact) return null;
  for (const w of wanted) {
    const hit = els.find(el => labels(el).some(l => l.includes(w)));
    if (hit) return hit;
  }
  return null;
}

async function isEnabled(handle) {
  return handle.evaluate(el =>
    !el.disabled &&
    el.getAttribute('aria-disabled') !== 'true' &&
    !el.classList.contains('disabled') &&
    !el.classList.contains('is-disabled'));
}

function framesOf(target) {
  return typeof target.frames === 'function' ? target.frames() : [target];
}

// Locates an element, polling until `timeout`.
//   target      - a Page (all of its frames are searched) or a single Frame
//   selectors   - CSS selectors to try, in order of preference
//   texts       - visible text / aria-label values to look for among `within`
//   preferText  - try `texts` before `selectors`
//   exact       - only accept whole-label text matches
//   enabled     - also wait for the element to be enabled
//   description - human readable name used in log and error messages
// Returns the ElementHandle. Throws a descriptive error on timeout.
export async function findElement(target, {
  selectors = [], texts = [], within = CLICKABLE, preferText = false, exact = false,
  enabled = false, timeout = 15000, description = 'element',
} = {}) {
  const strategies = [
    ...selectors.map(sel => ({ how: `selector ${sel}`, find: frame => frame.$$(sel) })),
    ...(texts.length ? [{
      how: `text ${JSON.stringify(texts)}`,
      find: async frame => {
        const h = await frame.evaluateHandle(findByTextInPage, texts, within, exact);
        const el = h.asElement();
        if (!el) await h.dispose();
        return el ? [el] : [];
      },
    }] : []),
  ];
  if (preferText && texts.length) strategies.unshift(strategies.pop());

  const deadline = Date.now() + timeout;
  let foundButDisabled = false;
  while (true) {
    for (const [i, strategy] of strategies.entries()) {
      for (const frame of framesOf(target)) {
        let handles;
        try {
          handles = await strategy.find(frame);
        } catch {
          continue; // frame detached / mid-navigation; try again next round
        }
        for (const h of handles) {
          const visible = await h.isVisible().catch(() => false);
          if (!visible) continue;
          if (enabled && !(await isEnabled(h).catch(() => false))) {
            foundButDisabled = true;
            continue;
          }
          if (i > 0) console.log(`SELECTOR_FALLBACK: ${description} not found via ${strategies[0].how}; matched via ${strategy.how}`);
          else console.log(`found ${description} via ${strategy.how}`);
          return h;
        }
      }
    }
    if (Date.now() > deadline) break;
    await sleep(500);
  }
  const tried = strategies.map(s => s.how).join(' | ');
  if (foundButDisabled) throw new Error(`${description} found but never became enabled within ${timeout / 1000}s (tried: ${tried})`);
  throw new Error(`${description} not found within ${timeout / 1000}s (tried: ${tried})`);
}

// Clicks an element; falls back to a DOM click if Puppeteer's mouse click is
// refused (e.g. element covered by an overlay).
export async function click(handle, description = 'element') {
  try {
    await handle.click();
  } catch (err) {
    console.log(`click on ${description} failed (${err.message}), trying DOM click`);
    await handle.evaluate(el => el.click());
  }
}

// Finds the frame (top page or any iframe) whose visible text contains `text`.
// `preferSelector` names an iframe to check first.
export async function findFrameContainingText(page, text, { preferSelector, timeout = 30000 } = {}) {
  const wanted = text.toLowerCase();
  const deadline = Date.now() + timeout;
  while (true) {
    let frames = page.frames();
    if (preferSelector) {
      const el = await page.$(preferSelector).catch(() => null);
      const preferred = el ? await el.contentFrame().catch(() => null) : null;
      if (preferred) frames = [preferred, ...frames.filter(f => f !== preferred)];
    }
    for (const frame of frames) {
      const has = await frame.evaluate(w => (document.body?.innerText || '').toLowerCase().includes(w), wanted).catch(() => false);
      if (has) {
        console.log(`found "${text}" in frame ${frame.url()}`);
        return frame;
      }
    }
    if (Date.now() > deadline) break;
    await sleep(1000);
  }
  throw new Error(`No frame on ${page.url()} contains the text "${text}" within ${timeout / 1000}s`);
}

// Finds a button inside the panel labelled `heading`: locates the element
// whose own text is the heading, then walks up the DOM to the nearest
// ancestor that contains a button, and picks the button there whose label
// matches one of `buttonTexts` (or the only button, if just one).
// This survives the panel's markup being restructured (h6 -> div, extra
// wrappers, reordered children) as long as heading and button stay together.
export async function findButtonInPanel(frame, heading, buttonTexts, { timeout = 30000, description } = {}) {
  description = description || `"${buttonTexts[0]}" button in "${heading}" panel`;
  const deadline = Date.now() + timeout;
  while (true) {
    const h = await frame.evaluateHandle((heading, buttonTexts) => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const want = norm(heading);
      const wantBtn = buttonTexts.map(norm);
      const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const headings = Array.from(document.querySelectorAll('body *'))
        .filter(el => el.children.length === 0 && norm(el.textContent) === want && visible(el));
      for (const hd of headings) {
        for (let anc = hd.parentElement, depth = 0; anc && depth < 6; anc = anc.parentElement, depth++) {
          const buttons = Array.from(anc.querySelectorAll('button, [role=button]')).filter(visible);
          if (buttons.length === 0) continue;
          const match = buttons.find(b => wantBtn.some(t => norm(b.innerText || b.getAttribute('aria-label')).includes(t)));
          if (match) return match;
          if (buttons.length === 1) return buttons[0];
          break; // nearest ancestor with buttons didn't have the one we want
        }
      }
      return null;
    }, heading, buttonTexts).catch(() => null);
    const el = h?.asElement();
    if (el) {
      console.log(`found ${description}`);
      return el;
    }
    if (Date.now() > deadline) break;
    await sleep(1000);
  }
  throw new Error(`${description} not found within ${timeout / 1000}s`);
}

// Waits for an element matching `selector` to disappear, e.g. the password
// field after a successful login. Returns true if it went away.
export async function waitUntilGone(page, selector, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const visible = await page.$(selector)
      .then(h => h ? h.isVisible() : false)
      .catch(() => true); // mid-navigation; check again
    if (!visible) return true;
    await sleep(500);
  }
  return false;
}

// Collects any visible error/alert text on the page, to explain a failure
// such as rejected credentials.
export async function pageErrorText(page) {
  return page.evaluate(() => {
    const els = document.querySelectorAll('[role=alert], .error, .alert, mat-error, [class*="error" i], [class*="invalid" i]');
    return Array.from(els).map(e => (e.innerText || '').trim()).filter(Boolean).join(' / ').slice(0, 200);
  }).catch(() => '');
}

// Submits a login form and confirms the login actually worked, by waiting
// for the password field to go away. Without this check a rejected password
// shows up much later as some unrelated "element not found".
export async function submitLoginAndVerify(run, submitButton, passwordSelector, { timeout = 30000 } = {}) {
  await Promise.all([
    run.page.waitForNavigation({ waitUntil: 'networkidle2', timeout }).catch(() => {}),
    click(submitButton, 'login button'),
  ]);
  await waitTillHTMLRendered(run.page);
  if (!(await waitUntilGone(run.page, passwordSelector, 15000))) {
    const msg = await pageErrorText(run.page);
    throw new Error(`Still on the login form after submitting credentials (password changed? captcha?)${msg ? ` - page says: ${msg}` : ''}`);
  }
}

// Routes all downloads into `dir` and reports their progress via Chrome's
// own download events, so we know the real filename and when it has finished
// - instead of polling for a guessed filename.
export async function prepareDownloads(browser, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const session = await browser.target().createCDPSession();
  await session.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });

  const downloads = new Map(); // guid -> { filename, state, received }
  session.on('Browser.downloadWillBegin', e => {
    console.log(`download started: ${e.suggestedFilename}`);
    downloads.set(e.guid, { filename: e.suggestedFilename, state: 'inProgress', received: 0 });
  });
  session.on('Browser.downloadProgress', e => {
    const d = downloads.get(e.guid);
    if (!d) return;
    d.state = e.state;
    d.received = e.receivedBytes;
  });

  // Files already present in dir that aren't partial downloads.
  const completedFiles = () => new Set(fs.readdirSync(dir).filter(f => !f.endsWith('.crdownload')));

  return {
    // Call BEFORE the click that triggers the download, then await the
    // returned promise. Resolves with the downloaded file's full path.
    //   startTimeout - how long to wait for the download to begin at all
    //   timeout      - how long to wait for it to finish
    expect({ startTimeout = 30000, timeout = 180000, description = 'download' } = {}) {
      const knownGuids = new Set(downloads.keys());
      const filesBefore = completedFiles();
      const t0 = Date.now();
      return (async () => {
        let started = false;
        let lastSizes = new Map();
        while (true) {
          const elapsed = Date.now() - t0;
          for (const [guid, d] of downloads) {
            if (knownGuids.has(guid)) continue;
            started = true;
            if (d.state === 'completed') {
              const full = path.join(dir, d.filename);
              if (fs.existsSync(full)) return full;
              // Chrome may have renamed it to avoid a clash; fall through to the directory scan
            }
            if (d.state === 'canceled') throw new Error(`${description} was canceled by the browser (${d.filename})`);
          }
          // Backstop in case download events aren't delivered: a new,
          // non-partial file whose size has stopped changing.
          for (const f of completedFiles()) {
            if (filesBefore.has(f)) continue;
            started = true;
            const size = fs.statSync(path.join(dir, f)).size;
            if (size > 0 && lastSizes.get(f) === size) return path.join(dir, f);
            lastSizes.set(f, size);
          }
          if (!started && fs.readdirSync(dir).some(f => f.endsWith('.crdownload'))) started = true;
          if (!started && elapsed > startTimeout) throw new Error(`${description} never started within ${startTimeout / 1000}s of clicking (button did nothing?)`);
          if (elapsed > timeout) throw new Error(`${description} started but did not finish within ${timeout / 1000}s`);
          await sleep(1000);
        }
      })();
    },
  };
}
