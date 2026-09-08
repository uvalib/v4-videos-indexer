import puppeteer from 'puppeteer';
import fs from 'fs';
import dateFormat from  'dateformat';

var nowstr = dateFormat(new Date(), "yyyymmdd");

function getArgs () {
  const args = {};
  process.argv
    .slice(2, process.argv.length)
    .forEach( arg => {
      // long arg
      if (arg.slice(0,2) === '--') {
        const longArg = arg.split('=');
        const longArgFlag = longArg[0].slice(2,longArg[0].length);
        const longArgValue = longArg.length > 1 ? longArg[1] : true;
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

// Dumps a URL/screenshot/HTML snapshot for post-mortem debugging.
// Wrapped so a diagnostics failure never masks the real error.
async function logDiagnostics(page, label) {
  const stamp = Date.now();
  try {
    const url = page.url();
    console.log(`DIAG[${label}] url = ${url}`);
    await page.screenshot({ path: `${screenshot_dir}/diag_${label}_${stamp}.png` }).catch(() => {});
    const html = await page.content().catch(() => '<content() failed>');
    fs.writeFileSync(`${screenshot_dir}/diag_${label}_${stamp}.html`, html);
    console.log(`DIAG[${label}] snapshot written: diag_${label}_${stamp}.{png,html}`);
  } catch (diagErr) {
    console.log(`DIAG[${label}] failed to collect diagnostics:`, diagErr.message);
  }
}

const waitTillHTMLRendered = async (page, timeout = 30000) => {
  const checkDurationMsecs = 1500;
  const maxChecks = timeout / checkDurationMsecs;
  let lastHTMLSize = 0;
  let checkCounts = 1;
  let countStableSizeIterations = 0;
  const minStableSizeIterations = 3;
  await new Promise(resolve => setTimeout(resolve, checkDurationMsecs));

  while(checkCounts++ <= maxChecks){
    let currentHTMLSize;
    let bodyHTMLSize;

    try {
      let html = await page.content();
      currentHTMLSize = html.length;

      bodyHTMLSize = await page.evaluate(() => (document.body && document.body.innerHTML) ? document.body.innerHTML.length : 0);
    } catch (transientErr) {
      // "Execution context was destroyed" / null document.body both mean the
      // page is mid-navigation (another redirect fired after the one Puppeteer
      // already waited for). Treat this as "still loading", not fatal: reset
      // the stability counter and try again on the next tick instead of throwing.
      console.log(`waitTillHTMLRendered: transient error (${transientErr.message}), retrying...`);
      countStableSizeIterations = 0;
      lastHTMLSize = 0;
      await new Promise(resolve => setTimeout(resolve, checkDurationMsecs));
      continue;
    }

    console.log('last: ', lastHTMLSize, ' <> curr: ', currentHTMLSize, " body html size: ", bodyHTMLSize, " url: ", page.url());

    if(lastHTMLSize != 0 && currentHTMLSize == lastHTMLSize)
      countStableSizeIterations++;
    else
      countStableSizeIterations = 0; //reset the counter

    if(countStableSizeIterations >= minStableSizeIterations) {
      console.log("Page rendered fully..");
      break;
    }

    lastHTMLSize = currentHTMLSize;
    await new Promise(resolve => setTimeout(resolve, checkDurationMsecs));
  }
};

function checkExistsWithTimeout(path, timeout, page, screenshotName) {
  return new Promise((resolve, reject) => {
    const timeoutTimerId = setTimeout(handleTimeout, timeout)
    const interval = timeout / 6
    var iterationCnt = 0
    let intervalTimerId

    function handleTimeout() {
      clearTimeout(timeoutTimerId)

      const error = new Error('path check timed out')
      error.name = 'PATH_CHECK_TIMED_OUT'
      reject(error)
    }

    function handleInterval() {
      fs.access(path, (err) => {
        if(err) {
          if (verbose) console.log(`path ${path} doesn't exist yet ( try: ${iterationCnt++} ), waiting...`);
          intervalTimerId = setTimeout(handleInterval, interval)
          if (screenshotName != "")
              page.screenshot({path: `${screenshot_dir}/${screenshotName}_${iterationCnt}.png`});
        }
        else {
          if (verbose) console.log(`path ${path} exists - Yay!`);
          clearTimeout(timeoutTimerId)
          resolve(path)
        }
      })
    }

    intervalTimerId = setTimeout(handleInterval, interval)
  })
}

const args = getArgs();
const verbose = args.v ? true : false;
if (verbose) console.log(args);
const creds = {
    username: args.user,
    password: args.pass
};
const datadir = args.dir ? args.dir : "./data";
if (verbose) console.log(creds);
const filename_csv = "digcampus_export.csv"; // args.csv;
const filename_marc = `marc_record_export-${nowstr}.mrc`; // args.marc
const save_dir = `${datadir}/tmp`;
const screenshot_dir = `${datadir}/screenshots`;
const save_as_csv = `${datadir}/incoming/${args.csv}`;
const save_as_marc = `${datadir}/incoming/${args.marc}`;

async function getRecords() {
let browser, page; // hoisted so the catch block below can actually see & close them
try {
  browser = await puppeteer.launch({userDataDir:`${datadir}/.config`, headless: 'true', args: ['--no-sandbox', '--disable-setuid-sandbox']});
  page = await browser.newPage();
  await page.setViewport({width: 1200, height: 1000})
  await Promise.all([
    page.goto('https://digitalcampus-swankmp-net.proxy1.library.virginia.edu/admin/uva296909/dashboard'),
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
  ]);
  var localStorageVal = '';
  // Check that the file exists locally
  if(!fs.existsSync(`${save_dir}/localStorageId.json`)) {
    console.log("localStorageId File not found, proceeding without it");
  }
  else { 
    localStorageVal = fs.readFileSync(`${save_dir}/localStorageId.json`, 'UTF8');
    localStorageVal = localStorageVal.replace(/\"/g, "");
  }
  if (localStorageVal != '') {
    await page.evaluate(localStorageVal => {
        localStorage.setItem('Player_Device_Id', localStorageVal);
      }, localStorageVal);
    if (verbose) console.log(`localStorageId set to ${localStorageVal}`);
  }

  await Promise.all([
    page.goto('https://digitalcampus.swankmp.net/admin/uva296909/login'),
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
  ]);

  await page.screenshot({path: `${screenshot_dir}/login.png`});
  if (verbose) console.log('At login page, url =', page.url());

  // Verify the login form is actually present before assuming so. If a
  // stale session (persisted userDataDir) or an unexpected page got served
  // instead, this fails fast with the real URL + a snapshot, instead of
  // throwing an opaque "no selector" error deep in page.type().
  const userField = await page.waitForSelector('input[formcontrolname=userName]', { timeout: 15000 }).catch(() => null);
  if (!userField) {
    await logDiagnostics(page, 'no_login_field');
    throw new Error(`Login form not found at ${page.url()} - possibly already logged in (stale session) or served a different page. See diag_no_login_field snapshot.`);
  }

  await page.type('input[formcontrolname=userName]', creds.username);
  await page.type('input[formcontrolname=password]', creds.password);

  // Pair the click with a navigation wait: without this, the script raced
  // straight into waitTillHTMLRendered before the post-login redirect
  // landed, which is what caused "execution context destroyed" crashes in
  // the kanopy script under the same pattern.
  await Promise.all([
    page.click('button[action=login]'),
    page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}),
  ]);
  await waitTillHTMLRendered(page);

  await page.screenshot({path: `${screenshot_dir}/loggedin.png`});
  if (verbose) console.log('At main admin page, url =', page.url());

  await Promise.all([
    page.goto('https://digitalcampus.swankmp.net/admin/uva296909/licensed-content-manager'),
    page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}),
  ]);
  await waitTillHTMLRendered(page);

  await page.screenshot({path: `${screenshot_dir}/content.png`});
  if (verbose) console.log('At content page, url =', page.url());

  if (verbose) console.log('title checkbox id=mat-mdc-checkbox-0 clicked');
  await Promise.all([
    page.click('mat-checkbox[id=mat-mdc-checkbox-0]'),
    await new Promise(resolve => setTimeout(resolve, 500))
  ]);

  await page.screenshot({path: `${screenshot_dir}/content2.png`});

  if (verbose) console.log('menu dropdown button clicked');
  await Promise.all([
    page.click('button[aria-haspopup="menu"]'),
    await new Promise(resolve => setTimeout(resolve, 500))
  ]);
  await page.screenshot({path: `${screenshot_dir}/content3.png`});

  if (verbose) console.log(`saving CSV to dir ${save_dir}`);

  const client = await page.target().createCDPSession()
  await client.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: `${save_dir}`,
            });

  // Download and wait for download
  var filepath = `${save_dir}/${filename_csv}`;

  if (verbose) console.log('menu button for titles info clicked'),
  await Promise.all([
    page.click('#mat-menu-panel-0 > div > button:nth-child(1)'),
    checkExistsWithTimeout(filepath, 10000, page, "")
  ]);
  console.log('CSV file downloaded');

  if (verbose) console.log('menu dropdown button clicked');
  await Promise.all([
    page.click('button[aria-haspopup="menu"]'),
    await new Promise(resolve => setTimeout(resolve, 500))
  ]);
  await page.screenshot({path:  `${screenshot_dir}/content4.png`});

  // Start download and wait for download to start
  if (verbose) console.log('menu button for MARC records clicked');

  if (verbose) console.log(`saving MARC file to dir ${save_dir}`);

  var filepath = `${save_dir}/${filename_marc}`;
  await Promise.all([
    page.click('#mat-menu-panel-0 > div > button:nth-child(2)'),
    checkExistsWithTimeout(filepath, 90000, page, "download_marc")
  ]);
  console.log('MARC file downloaded');

  var filecsv = `${save_dir}/${filename_csv}`;
  try {
    fs.renameSync(filecsv, save_as_csv);
    if (verbose) console.log(`File Renamed to ${save_as_csv}`);
  } catch (err) {
    console.log(err);
    throw err;
  }

  var filemarc = `${save_dir}/${filename_marc}`;
  try {
    fs.renameSync(filemarc, save_as_marc);
    if (verbose) console.log(`File Renamed to ${save_as_marc}`);
  } catch (err) {
    console.log(err);
    throw err;
  }

  var ls = await page.evaluate(() => localStorage.Player_Device_Id);
  if (verbose) console.log("fetching Player_Device_Id");
  if (verbose) console.log(`${ls}`);
  fs.writeFileSync(`${save_dir}/localStorageId.json`, ls);

  // Properly close the browser
  const pages = await browser.pages();
  for (let i = 0; i < pages.length; i++) {
    console.log("closing page");
    await pages[i].close();
    console.log("page closed");
  }
  console.log("all pages closed");
  await browser.close();
} // end try
catch (err) {
  console.log("Error caught!!:", err.message);
  if (page != null) {
    await logDiagnostics(page, 'fatal_error');
  }
  if (browser != null) {
    const pages = await browser.pages();
    for (let i = 0; i < pages.length; i++) {
      console.log("closing page");
      await pages[i].close();
      console.log("page closed");
    }
    console.log("all pages closed");
    await browser.close();
  }
  process.exitCode = 1;
  console.log("Error re-thrown");
  throw(err);
} // end catch
};

getRecords().then( () => process.exit(0)).catch( (err) => { console.log(err); process.exit(1) });

