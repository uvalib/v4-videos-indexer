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

const waitTillHTMLRendered = async (page, timeout = 30000) => {
  const checkDurationMsecs = 1500;
  const maxChecks = timeout / checkDurationMsecs;
  let lastHTMLSize = 0;
  let checkCounts = 1;
  let countStableSizeIterations = 0;
  const minStableSizeIterations = 3;
  await new Promise(resolve => setTimeout(resolve, checkDurationMsecs));

  while(checkCounts++ <= maxChecks){
    let html = await page.content();
    let currentHTMLSize = html.length;

    let bodyHTMLSize = await page.evaluate(() => document.body.innerHTML.length);

    console.log('last: ', lastHTMLSize, ' <> curr: ', currentHTMLSize, " body html size: ", bodyHTMLSize);

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
try {
  const browser = await puppeteer.launch({userDataDir:`${datadir}/.config`, headless: 'false' });
  const page = await browser.newPage();
  await page.setViewport({width: 1200, height: 1000})
  await Promise.all([
    page.goto('https://digitalcampus.swankmp.net/admin/login'),
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
  if (verbose) console.log('At login page');

  await page.type('input[formcontrolname=userName]', creds.username);
  await page.type('input[formcontrolname=password]', creds.password);

  await Promise.all([
    page.click('button[action=login]'),
  ]);
  await waitTillHTMLRendered(page);

  await page.screenshot({path: `${screenshot_dir}/loggedin.png`});
  if (verbose) console.log('At main admin page');

  await Promise.all([
    page.goto('https://digitalcampus.swankmp.net/admin/uva296909/licensed-content-manager'),
    await new Promise(resolve => setTimeout(resolve, 10000))
  ]);
  await waitTillHTMLRendered(page);

  await page.screenshot({path: `${screenshot_dir}/content.png`});
  if (verbose) console.log('At content page');

  if (verbose) console.log('title checkbox clicked');
  await Promise.all([
    page.click('mat-checkbox[id=mat-mdc-checkbox-1]'),
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
  fs.rename(filecsv, save_as_csv, function (err) {
    console.log(err);
    if (err) throw err;
  });
  if (verbose) console.log(`File Renamed to ${save_as_csv}`);

  var filemarc = `${save_dir}/${filename_marc}`;
  fs.rename(filemarc, save_as_marc, function (err) {
    console.log(err);
    if (err) throw err;
  });
  if (verbose) console.log(`File Renamed to ${save_as_marc}`);

  var ls = await page.evaluate(() => localStorage.Player_Device_Id);
  if (verbose) console.log("fetching Player_Device_Id");
  if (verbose) console.log(`${ls}`);
  fs.writeFileSync(`${save_dir}/localStorageId.json`, ls);

  browser.close();
} // end try
catch (err) {
  console.log("Error caught!!");
  //console.log(err);
  if (typeof myVar !== 'undefined' && browser != null) {
    browser.close();
  }
  process.exitCode = 1;
  console.log("Error re-thrown");
  throw(err);
} // end catch
};

getRecords().then( () => process.exit(0)).catch( (err) => { console.log(err); process.exit(1) });

