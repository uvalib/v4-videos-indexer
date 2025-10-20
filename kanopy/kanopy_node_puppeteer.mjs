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
  const browser = await puppeteer.launch({userDataDir:`${datadir}/.config`, headless: "true", 
                             args: ['--no-sandbox', 
                                    '--disable-setuid-sandbox', 
                                    '--disable-web-security', 
                                    '--disable-features=IsolateOrigins,site-per-process', 
                                    '--allow-insecure-localhost' 
                                   ]});

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36'
  );
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
  if (verbose) console.log('At login page wolf 1');

  await Promise.all([
    page.click('button[title="Log In"]'),
    page.waitForNavigation({ waitUntil: 'networkidle2' })
  ]);
  if (verbose) console.log('At login page wolf 2');
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

  await waitTillHTMLRendered(page);

  // Listen to console messages from the page context
  page.on('console', msg => {
    console.log('PAGE LOG:', msg.text());  // Log the text of each console message
  });

  // Wait for the iframe to appear on the page
  await page.waitForSelector('#kadmin-iframe'); // Replace with the correct selector if needed

  // Locate the iframe using its ID
  const iframeElement = await page.$('#kadmin-iframe'); // Select the iframe by its ID
  if (!iframeElement) {
    throw new Error('Iframe not found!');
  }

  // Get the iframe's contentFrame
  const iframe = await iframeElement.contentFrame(); // Access the iframe's content
  if (!iframe) {
    throw new Error('Failed to get iframe contentFrame!');
  }

  const dynamicButtonId = await iframe.evaluate(() => {
    const h6s = Array.from(document.querySelectorAll('h6'));
    for (const h6 of h6s) {
      console.log('h6 found with text: '+h6.textContent);
      if (h6.textContent.includes('All Records')) {
        console.log('found h6 All Records');
        const h4 = h6.nextElementSibling;
        if (h4) console.log('found h6 All Records');
        const targetButton = h4?.nextElementSibling;
        if (targetButton) console.log('found button');
        if (targetButton && targetButton.tagName === 'BUTTON') {
          const uniqueId = 'dynamic-button-' + Date.now();
          targetButton.id = uniqueId;
          return uniqueId; // Return the unique ID
        }
      }
    }
  });

  if (dynamicButtonId) {
    console.log('Dynamically assigned button ID:', dynamicButtonId);
  
    // Use Puppeteer to click the button outside of evaluate
    const buttonHandle = await iframe.$(`#${dynamicButtonId}`); // Get the button handle using the dynamic ID
    if (buttonHandle) {
      await buttonHandle.click(); // Click the button
      console.log('Clicked the Generate All button successfully!');
    } else {
      console.log('Failed to find the Generate All button using the dynamic ID');
    }
  } else {
    console.log('Generate All button not found in the iframe');
  }
  await page.screenshot({path: `${screenshot_dir}/marcpage1.png`});
  if (verbose) console.log('At marc download page waiting for button');

  await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for 2000 milliseconds

  // Step 2: Locate and enable the "Download" button
  const buttonId = await iframe.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const downloadButton = buttons.find((btn) => btn.textContent.trim() === 'Download');
    if (downloadButton) {
      const uniqueId = 'unique-download-button';
      downloadButton.id = uniqueId;
      return uniqueId;
    }
    return null;
  });
  
  if (!buttonId) {
    console.log('Failed to find the "Download" button.');
  } else {
    console.log(`"Download" button found and assigned id: ${buttonId}`);
  }
  
  // Step 3: Wait for the button to become enabled
  if (buttonId) {
    console.log('Waiting for the "Download" button to become enabled...');
  
    await iframe.waitForFunction(
      (id) => {
        const btn = document.getElementById(id);
        if (!btn) return false;
  
        const ariaDisabled = btn.getAttribute('aria-disabled');
        const visuallyDisabled =
          btn.classList.contains('disabled') ||
          btn.classList.contains('is-disabled');

        return !btn.disabled && ariaDisabled !== 'true' && !visuallyDisabled;
      },
      { polling: 200, timeout: 30000 },
      buttonId
    );

    console.log('The "Download" button is now enabled.');

    var filepath_pattern = `${save_dir}/${filename_zip_pattern}`;
    var filepath= `${save_dir}/${filename_zip}`;
    var last_filename;

    // Step 4: Click the button
    const downloadButtonHandle = await iframe.$(`#${buttonId}`);
    if (downloadButtonHandle) {
      await downloadButtonHandle.click();
      console.log('Clicked the "Download" button.');
  
      // Step 5: Wait for the file to finish downloading
      console.log('Waiting for the file to finish downloading...');
      await checkExistsWithTimeout(filepath, 50000, page, "download_zip")
         .then((file) => {
             last_filename = file;
             if (verbose) console.log('Alphabetically last file:', last_filename);
         })
         .catch((err) => {
             console.error(err);
         })
    } else {
      console.error('Failed to select the button using the unique id.');
    }
  }

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

