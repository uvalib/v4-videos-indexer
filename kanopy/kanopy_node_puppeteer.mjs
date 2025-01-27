import puppeteer from 'puppeteer';
import fs from 'fs';
import dateFormat from  'dateformat';
import { glob } from 'glob';

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
  const checkDurationMsecs = 1000;
  const maxChecks = timeout / checkDurationMsecs;
  let lastHTMLSize = 0;
  let checkCounts = 1;
  let countStableSizeIterations = 0;
  const minStableSizeIterations = 3;
  await new Promise(resolve => setTimeout(resolve, checkDurationMsecs)); 


  while(checkCounts++ <= maxChecks){
    let html = await page.content();
    let currentHTMLSize = html.length;

    let bodyHTMLSize = await page.evaluate(() => {
      // Check if innerHTML exists and is not empty
      return document.body.innerHTML ? document.body.innerHTML.length : 0;
    });
    
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

function checkExistsByPatternWithTimeout(pathPattern, timeout, page, screenshotName) {
  return new Promise((resolve, reject) => {
    const timeoutTimerId = setTimeout(handleTimeout, timeout);
    const interval = timeout / 6;
    let iterationCnt = 0;
    let intervalTimerId;

    function handleTimeout() {
      clearTimeout(timeoutTimerId);
      const error = new Error('path check timed out');
      error.name = 'PATH_CHECK_TIMED_OUT';
      reject(error);
    }

    function handleInterval() {
        // Use an immediately invoked async function expression (IIFE) to run the async code
        // Resolve wildcard pathPattern using glob
        var matchedFiles;
        try {
          const files = glob.sync(pathPattern); // Synchronous version of glob
          if (files.length > 0) {
            console.log('Matched files:', files);
            matchedFiles = files;
          } else {
            console.log('No files matched.');
          }
        } catch (err) {
          console.error('Glob error:', err);
          clearTimeout(timeoutTimerId);
          reject(err);
          return;
        }

        if (matchedFiles == null || matchedFiles.length === 0) {
          // No files matched the pattern
          if (verbose) console.log(`path ${pathPattern} doesn't exist yet ( try: ${iterationCnt++} ), waiting...`);
          intervalTimerId = setTimeout(handleInterval, interval);

          if (screenshotName != "") {
            page.screenshot({ path: `${screenshot_dir}/${screenshotName}_${iterationCnt}.png` });
          }
        } else {
          // Sort files alphabetically and resolve with the last one
          const lastFile = matchedFiles.sort().pop();
          if (verbose) console.log(`path ${lastFile} exists - Yay!`);
          clearTimeout(timeoutTimerId);
          resolve(lastFile);
        }
    }

    intervalTimerId = setTimeout(handleInterval, interval);
  });
}


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
const filename_zip = 'Kanopy_MARC_Records_virginia_full.zip'; // args.marc
const filename_zip_pattern = 'Kanopy_MARC_Records__additions__virginia__*.zip'; // args.marc
const save_dir = `${datadir}/tmp`;
const incoming_dir = `${datadir}/incoming_zip`;
const screenshot_dir = `${datadir}/screenshots`;

const loginurl = "https://virginia.kanopy.com/login";
const landing = "https://virginia.kanopy.com";
const mrpageurl = "https://virginia.kanopy.com/user/2049/mr";
console.log(`screenshot dir = ${screenshot_dir}`);

const filename = args.file;
const save_as_zip = `${incoming_dir}/${args.file}`;

async function getRecords() {
try { 
  const browser = await puppeteer.launch({userDataDir:`${datadir}/.config`, headless: "true", args: ['--no-sandbox', '--disable-setuid-sandbox']});
  const page = await browser.newPage();
  await page.setViewport({width: 1200, height: 1000})
  await Promise.all([
    page.goto(loginurl),
    page.waitForNavigation({ waitUntil: 'networkidle2' })
  ]);
  await waitTillHTMLRendered(page);
  await page.screenshot({path: `${screenshot_dir}/login.png`});
  if (verbose) console.log('At login page');

  await page.type('input[type=email]', creds.username);
  await page.type('input[type=password]', creds.password);
  await Promise.all([
    page.click('button[title="Log In"]'),
    page.waitForNavigation({ waitUntil: 'networkidle2' })
  ]);
  await waitTillHTMLRendered(page);
  await page.screenshot({path: `${screenshot_dir}/loggedin.png`});
  if (verbose) console.log('At main admin page');

  await Promise.all([
    page.goto(landing),
    page.waitForNavigation({ waitUntil: 'networkidle2' })
  ]);
  await waitTillHTMLRendered(page);

  await Promise.all([
    page.goto('https://digitalcampus.swankmp.net/admin/uva296909/licensed-content-manager'),
    page.waitForNavigation({ waitUntil: 'networkidle2' })
  ]);
  await waitTillHTMLRendered(page);

  await page.screenshot({path: `${screenshot_dir}/main.png`});
  if (verbose) console.log('At main page');

  await Promise.all([
    page.goto(mrpageurl),
    page.waitForNavigation({ waitUntil: 'networkidle2' })
  ]);
  await waitTillHTMLRendered(page);

  await page.screenshot({path: `${screenshot_dir}/marcpage.png`});
  if (verbose) console.log('At marc download page');

  const client = await page.target().createCDPSession()
  await client.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: `${save_dir}`,
            });

  // Download and wait for download
  // Locate and click the button that follows an <h4>, which follows an <h6> containing "All Records"
  const buttonSelector = 'h6:has-text("All Records") + h4 + button';

  // Wait for the button to be visible (if necessary)
  await page.waitForSelector(buttonSelector);

  // Click the button
  await page.click(buttonSelector);

  // Wait for the "Download" button to appear in the dialog
  const downloadButtonSelector = 'button:has-text("Download")';
  await page.waitForSelector(downloadButtonSelector);

  // Wait for the "Download" button to become enabled
  await page.waitForFunction(
    (selector) => {
      const button = document.querySelector(selector);
      return button && !button.disabled;
    },
    {}, // Pass the download button selector as an argument
    downloadButtonSelector
  );

  await waitTillHTMLRendered(page);

  await page.screenshot({path: `${screenshot_dir}/marcpage2.png`});
  if (verbose) console.log('At marc download page w/button');

  var filepath_pattern = `${save_dir}/${filename_zip_pattern}`;
  var filepath= `${save_dir}/${filename_zip}`;
  var last_filename;
   // Download and wait for download
  await Promise.all([
     // Click the "Download" button
     await page.click(downloadButtonSelector),
     checkExistsWithTimeout(filepath, 50000, page, "download_zip")
        .then((file) => {
            last_filename = file;
            if (verbose) console.log('Alphabetically last file:', last_filename);
        })
        .catch((err) => {
            console.error(err);
        })
   ]);

  console.log('Kanopy Zip file downloaded');

  var filezip = `${last_filename}`;

  fs.rename(filezip, save_as_zip, function (err) {
    if (err) throw err;
    if (verbose) console.log(`File Renamed to ${save_as_zip}`);
  });

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
  console.log("Error caught!!");
  //console.log(err);
  if (typeof myVar !== 'undefined' && browser != null) {
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
}
};

getRecords().then( () => process.exit(0)).catch( (err) => { console.log(err); process.exit(1) });

