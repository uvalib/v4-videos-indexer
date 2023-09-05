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
  const checkDurationMsecs = 1000;
  const maxChecks = timeout / checkDurationMsecs;
  let lastHTMLSize = 0;
  let checkCounts = 1;
  let countStableSizeIterations = 0;
  const minStableSizeIterations = 3;

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
    await page.waitForTimeout(checkDurationMsecs);
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
const filename_zip = 'Kanopy_MARC_Records__additions__virginia.zip'; // args.marc
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
  const browser = await puppeteer.launch({userDataDir:`${datadir}/.config`, headless: "true" });
  const page = await browser.newPage();
  await page.setViewport({width: 1200, height: 1000})
  await Promise.all([
    page.goto(loginurl),
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.waitForTimeout(500)
  ]);
  await waitTillHTMLRendered(page);
  await page.screenshot({path: `${screenshot_dir}/login.png`});
  if (verbose) console.log('At login page');

  await page.type('input[type=email]', creds.username);
  await page.type('input[type=password]', creds.password);
  await Promise.all([
    page.click('button[title="Log In"]'),
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.waitForTimeout(5000)
  ]);
  await waitTillHTMLRendered(page);
  await page.screenshot({path: `${screenshot_dir}/loggedin.png`});
  if (verbose) console.log('At main admin page');

  await Promise.all([
    page.goto(landing),
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.waitForTimeout(500)
  ]);
  await waitTillHTMLRendered(page);

  await Promise.all([
    page.goto('https://digitalcampus.swankmp.net/admin/uva296909/licensed-content-manager'),
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.waitForTimeout(500)
  ]);
  await waitTillHTMLRendered(page);

  await page.screenshot({path: `${screenshot_dir}/main.png`});
  if (verbose) console.log('At main page');

  await Promise.all([
    page.goto(mrpageurl),
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.waitForTimeout(500)
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
  // #edit-dl-all
  await Promise.all([
    page.click('input#edit-dl-all'),
    page.waitForSelector('a.button:nth-child(2)', {visible: true}),
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.waitForTimeout(1500)
  ]);
  await waitTillHTMLRendered(page);

  await page.screenshot({path: `${screenshot_dir}/marcpage2.png`});
  if (verbose) console.log('At marc download page w/button');

      var filepath = `${save_dir}/${filename_zip}`;
  // Download and wait for download
  await Promise.all([
    // click the big orange button
    page.click('a.button:nth-child(2)'),
    checkExistsWithTimeout(filepath, 25000, page, "download_zip")
  ]);

  console.log('Kanopy Zip file downloaded');

  var filezip = `${save_dir}/${filename_zip}`;
  fs.rename(filezip, save_as_zip, function (err) {
    if (err) throw err;
    if (verbose) console.log(`File Renamed to ${save_as_zip}`);
  });

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
}
};

getRecords().then( () => process.exit(0)).catch( (err) => { console.log(err); process.exit(1) });

