// Logs into the Kanopy admin site and downloads the "All Records" MARC zip.
//
// usage: node kanopy_node_puppeteer.mjs [-v] --dir=<datadir> --file=<name to save the zip as>
// Credentials come from the KANOPY_USER / KANOPY_PASSWORD environment
// variables (--user= / --pass= still work for running by hand).
//
// Exits 0 on success. On failure exits 1 and leaves <datadir>/scrape_result
// naming the step that failed, plus a screenshot/HTML snapshot under
// <datadir>/screenshots. See ../common/scrape_helpers.mjs.

import puppeteer from 'puppeteer';
import fs from 'fs';
import {
  getArgs, createScrapeRun, runScrape, StepError, gotoPage, findElement, click,
  findFrameContainingText, findButtonInPanel, submitLoginAndVerify, prepareDownloads,
} from '../common/scrape_helpers.mjs';

const args = getArgs();
const datadir = args.dir ? args.dir : "./data";
const run = createScrapeRun({ provider: 'kanopy', datadir, verbose: !!args.v, maxMinutes: 15 });

const creds = {
    username: process.env.KANOPY_USER || args.user,
    password: process.env.KANOPY_PASSWORD || args.pass,
};
const save_dir = `${datadir}/tmp`;
const incoming_dir = `${datadir}/incoming_zip`;
const save_as_zip = `${incoming_dir}/${args.file}`;

const loginurl = "https://virginia.kanopy.com/login";
const landing = "https://virginia.kanopy.com";
const mrpageurl = "https://virginia.kanopy.com/user/2049/mr";

const PASSWORD_FIELD = 'input[type=password]';

runScrape(run, async () => {
  if (!creds.username || !creds.password) {
    throw new StepError('config', 'Kanopy credentials not provided (set KANOPY_USER and KANOPY_PASSWORD)');
  }
  if (!args.file) throw new StepError('config', 'No --file= given for the downloaded zip');

  const downloads = await run.step('launch-browser', async () => {
    run.browser = await puppeteer.launch({userDataDir:`${datadir}/.config`, headless: "true",
                               args: ['--no-sandbox',
                                      '--disable-setuid-sandbox',
                                      '--disable-web-security',
                                      '--disable-features=IsolateOrigins,site-per-process',
                                      '--allow-insecure-localhost'
                                     ]});
    run.page = await run.browser.newPage();
    await run.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36'
    );
    await run.page.setViewport({width: 1200, height: 1000});
    if (run.verbose) run.page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    return prepareDownloads(run.browser, save_dir);
  });
  const page = run.page;

  await run.step('open-login-page', async () => {
    await gotoPage(run, loginurl);
    await run.screenshot('login');
  });

  await run.step('fill-login-form', async () => {
    // If a stale session (persisted userDataDir) or a bot-check/rate-limit
    // page got served instead of the form, this fails here with a snapshot.
    const email = await findElement(page, {
      description: 'email/username field',
      selectors: ['input[type=email]', 'input[name=email]', 'input[autocomplete=username]', 'input[name=username]'],
    });
    await email.type(creds.username);
    const password = await findElement(page, { description: 'password field', selectors: [PASSWORD_FIELD] });
    await password.type(creds.password);
  });

  await run.step('submit-login', async () => {
    // button.login-button is Kanopy's current markup; matching the class
    // rather than title="Log In" is what fixed the last breakage (the title
    // changed case). Visible text is the fallback if the class changes.
    const loginButton = await findElement(page, {
      description: 'login button',
      selectors: ['button.login-button', 'form button[type=submit]'],
      texts: ['log in', 'login', 'sign in'],
      exact: true,
    });
    await submitLoginAndVerify(run, loginButton, PASSWORD_FIELD);
    await run.screenshot('loggedin');
  });

  await run.step('open-marc-records-page', async () => {
    await gotoPage(run, landing);
    await gotoPage(run, mrpageurl);
    await run.screenshot('marcpage');
  });

  // The MARC tool is rendered inside an iframe (currently #kadmin-iframe).
  // Rather than depend on that id, use whichever frame shows "All Records".
  const frame = await run.step('find-marc-records-panel', () =>
    findFrameContainingText(page, 'All Records', { preferSelector: '#kadmin-iframe', timeout: 45000 }));

  await run.step('click-generate-all-records', async () => {
    const generate = await findButtonInPanel(frame, 'All Records', ['generate'], { timeout: 30000 });
    await click(generate, 'Generate (All Records) button');
    await run.screenshot('marcpage1');
  });

  const zipPath = await run.step('download-zip', async () => {
    // The Download button appears (disabled) once generation starts and is
    // enabled when the zip is ready. exact:true so the "FAQ for Kanopy's
    // MARC Record Downloader" link can't be mistaken for it.
    const download = await findElement(frame, {
      description: '"Download" button',
      texts: ['download', 'download records', 'download marc records'],
      within: 'button, a, [role=button]',
      exact: true,
      enabled: true,
      timeout: 120000,
    });
    const pending = downloads.expect({ description: 'Kanopy zip download', startTimeout: 30000, timeout: 180000 });
    await click(download, 'Download button');
    return pending;
  });

  await run.step('save-zip', async () => {
    const size = fs.statSync(zipPath).size;
    console.log(`Kanopy file downloaded: ${zipPath} (${size} bytes)`);
    if (!zipPath.toLowerCase().endsWith('.zip')) throw new Error(`Downloaded file ${zipPath} is not a .zip`);
    if (size === 0) throw new Error(`Downloaded file ${zipPath} is empty`);
    fs.mkdirSync(incoming_dir, { recursive: true });
    fs.renameSync(zipPath, save_as_zip);
    console.log(`File Renamed to ${save_as_zip}`);
  });
});
