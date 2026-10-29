// Logs into the Swank Digital Campus admin site and exports, for all
// licensed titles, the title-details CSV and the MARC records file.
//
// usage: node swank_node_puppeteer.mjs [-v] --dir=<datadir> --csv=<csv name> --marc=<mrc name>
// Credentials come from the SWANK_USER / SWANK_PASSWORD environment
// variables (--user= / --pass= still work for running by hand).
//
// Exits 0 on success. On failure exits 1 and leaves <datadir>/scrape_result
// naming the step that failed, plus a screenshot/HTML snapshot under
// <datadir>/screenshots. See ../common/scrape_helpers.mjs.

import puppeteer from 'puppeteer';
import fs from 'fs';
import {
  getArgs, createScrapeRun, runScrape, StepError, gotoPage, findElement, click,
  submitLoginAndVerify, prepareDownloads,
} from '../common/scrape_helpers.mjs';

const args = getArgs();
const datadir = args.dir ? args.dir : "./data";
const run = createScrapeRun({ provider: 'swank', datadir, verbose: !!args.v, maxMinutes: 15 });

const creds = {
    username: process.env.SWANK_USER || args.user,
    password: process.env.SWANK_PASSWORD || args.pass,
};
const save_dir = `${datadir}/tmp`;
const save_as_csv = `${datadir}/incoming/${args.csv}`;
const save_as_marc = `${datadir}/incoming/${args.marc}`;

const dashboardurl = 'https://digitalcampus-swankmp-net.proxy1.library.virginia.edu/admin/uva296909/dashboard';
const loginurl = 'https://digitalcampus.swankmp.net/admin/uva296909/login';
const contenturl = 'https://digitalcampus.swankmp.net/admin/uva296909/licensed-content-manager';

const PASSWORD_FIELD = 'input[formcontrolname=password], input[type=password]';

// Reads the "Selected: 479" counter shown next to the Content Manager title.
async function selectedCount(page) {
  return page.evaluate(() => {
    const m = (document.body?.innerText || '').match(/Selected:\s*([\d,]+)/i);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
  }).catch(() => 0);
}

// Opens the "Export N Selected" dropdown and clicks the menu item matching
// `itemTexts`. `legacySelector` is the old positional selector, kept as a
// last resort.
async function chooseExportMenuItem(page, itemTexts, legacySelector) {
  const menuButton = await findElement(page, {
    description: '"Export N Selected" menu button',
    texts: ['export'],
    within: 'button[aria-haspopup], button',
    selectors: ['button[aria-haspopup="menu"]'],
    preferText: true,
  });
  await click(menuButton, 'export menu button');
  const item = await findElement(page, {
    description: `"${itemTexts[0]}" menu item`,
    texts: itemTexts,
    within: '[role=menuitem], [role=menu] button, .mat-mdc-menu-panel button',
    selectors: [legacySelector],
    preferText: true,
  });
  return item;
}

runScrape(run, async () => {
  if (!creds.username || !creds.password) {
    throw new StepError('config', 'Swank credentials not provided (set SWANK_USER and SWANK_PASSWORD)');
  }
  if (!args.csv || !args.marc) throw new StepError('config', 'Both --csv= and --marc= must be given');

  const downloads = await run.step('launch-browser', async () => {
    run.browser = await puppeteer.launch({userDataDir:`${datadir}/.config`, headless: 'true', args: ['--no-sandbox', '--disable-setuid-sandbox']});
    run.page = await run.browser.newPage();
    await run.page.setViewport({width: 1200, height: 1000});
    return prepareDownloads(run.browser, save_dir);
  });
  const page = run.page;

  await run.step('restore-device-id', async () => {
    await gotoPage(run, dashboardurl, { waitUntil: 'networkidle0' });
    // Swank limits the number of registered "devices"; reuse the id from the
    // previous run so each run doesn't register a new one.
    const idFile = `${save_dir}/localStorageId.json`;
    const localStorageVal = fs.existsSync(idFile) ? fs.readFileSync(idFile, 'UTF8').replace(/\"/g, "") : '';
    if (localStorageVal != '') {
      await page.evaluate(v => localStorage.setItem('Player_Device_Id', v), localStorageVal);
      run.vlog(`localStorageId set to ${localStorageVal}`);
    } else {
      console.log("localStorageId File not found, proceeding without it");
    }
  });

  await run.step('open-login-page', async () => {
    await gotoPage(run, loginurl, { waitUntil: 'networkidle0' });
    await run.screenshot('login');
  });

  await run.step('login', async () => {
    const userField = await findElement(page, {
      description: 'username field',
      selectors: ['input[formcontrolname=userName]', 'input[autocomplete=username]', 'input[name*=user i]', 'input[type=email]'],
    }).catch(() => null);
    if (!userField) {
      // The browser profile is persisted between runs, so an existing
      // session can skip straight past the form. Carry on; the content
      // page step below fails clearly if we're not actually logged in.
      if (!page.url().includes('/login')) {
        console.log(`No login form; already logged in? (at ${page.url()})`);
        return;
      }
      throw new Error(`Login form not found at ${page.url()}`);
    }
    await userField.type(creds.username);
    const password = await findElement(page, { description: 'password field', selectors: [PASSWORD_FIELD] });
    await password.type(creds.password);
    const loginButton = await findElement(page, {
      description: 'login button',
      selectors: ['button[action=login]', 'form button[type=submit]'],
      texts: ['login', 'log in', 'sign in'],
      exact: true,
    });
    await submitLoginAndVerify(run, loginButton, PASSWORD_FIELD);
    await run.screenshot('loggedin');
  });

  await run.step('open-content-manager', async () => {
    await gotoPage(run, contenturl, { waitUntil: 'networkidle0' });
    await run.screenshot('content');
    if (page.url().includes('/login')) throw new Error('Redirected back to the login page - not logged in');
  });

  await run.step('select-all-titles', async () => {
    // The header checkbox of the titles table selects every title. It used
    // to be found by its Angular-generated id (mat-mdc-checkbox-0), which
    // changes whenever another checkbox is added to the page.
    const selectAll = await findElement(page, {
      description: 'select-all checkbox',
      selectors: [
        'thead mat-checkbox', 'mat-header-row mat-checkbox', '[role=columnheader] mat-checkbox', 'th mat-checkbox',
        'mat-checkbox[id=mat-mdc-checkbox-0]', 'mat-checkbox',
      ],
      texts: ['select all'],
      timeout: 45000,
    });
    if (await selectedCount(page) === 0) {
      await click(selectAll, 'select-all checkbox');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (await selectedCount(page) === 0) {
      // Clicking the host element sometimes misses; try the inner input.
      const input = await selectAll.$('input[type=checkbox]');
      if (input) await input.evaluate(el => el.click());
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const n = await selectedCount(page);
    await run.screenshot('content2');
    if (n === 0) throw new Error('Clicked the select-all checkbox but "Selected:" count is still 0');
    console.log(`Selected ${n} titles`);
  });

  const csvPath = await run.step('export-title-details-csv', async () => {
    const item = await chooseExportMenuItem(page, ['export title details', 'title details'], '#mat-menu-panel-0 > div > button:nth-child(1)');
    await run.screenshot('content3');
    const pending = downloads.expect({ description: 'Swank title details CSV', startTimeout: 30000, timeout: 60000 });
    await click(item, 'Export Title Details');
    return pending;
  });
  console.log(`CSV file downloaded: ${csvPath}`);

  const marcPath = await run.step('export-marc-records', async () => {
    const item = await chooseExportMenuItem(page, ['export marc records', 'marc records'], '#mat-menu-panel-0 > div > button:nth-child(2)');
    await run.screenshot('content4');
    const pending = downloads.expect({ description: 'Swank MARC export', startTimeout: 30000, timeout: 180000 });
    await click(item, 'Export MARC Records');
    return pending;
  });
  console.log(`MARC file downloaded: ${marcPath} (${fs.statSync(marcPath).size} bytes)`);

  await run.step('save-files', async () => {
    if (!csvPath.toLowerCase().endsWith('.csv')) throw new Error(`Title details download ${csvPath} is not a .csv`);
    if (marcPath.toLowerCase().endsWith('.csv')) throw new Error(`MARC download ${marcPath} looks like a CSV - wrong menu item?`);
    fs.mkdirSync(`${datadir}/incoming`, { recursive: true });
    fs.renameSync(csvPath, save_as_csv);
    console.log(`File Renamed to ${save_as_csv}`);
    fs.renameSync(marcPath, save_as_marc);
    console.log(`File Renamed to ${save_as_marc}`);

    const ls = await page.evaluate(() => localStorage.Player_Device_Id);
    run.vlog(`saving Player_Device_Id ${ls}`);
    if (ls) fs.writeFileSync(`${save_dir}/localStorageId.json`, ls);
  });
});
