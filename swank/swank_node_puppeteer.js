const puppeteer = require('puppeteer');
const fs = require('fs');
var dateFormat = require('dateformat');
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
  const browser = await puppeteer.launch({userDataDir:`${datadir}/.config`});
  const page = await browser.newPage();
  await page.setViewport({width: 1200, height: 1000})
  await Promise.all([
    page.goto('https://digitalcampus.swankmp.net/admin/uva296909/login'),
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
  ]);
  await page.screenshot({path: `${screenshot_dir}/login.png`});
  if (verbose) console.log('At login page');

  await page.type('input[id=userName]', creds.username);
  await page.type('input[id=mat-input-1]', creds.password);
  await Promise.all([
    page.click('button[action=login]'),
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
  ]);
  await page.screenshot({path: `${screenshot_dir}/loggedin.png`});
  if (verbose) console.log('At main admin page');

  await Promise.all([
    page.goto('https://digitalcampus.swankmp.net/admin/uva296909/licensed-content-manager'),
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
  ]);
  await page.screenshot({path: `${screenshot_dir}/content.png`});
  if (verbose) console.log('At content page');

  if (verbose) console.log('title checkbox clicked');
  await Promise.all([
    page.click('mat-checkbox[id=mat-checkbox-1]'),
    page.waitForTimeout(500)
  ]);

  await page.screenshot({path: `${screenshot_dir}/content2.png`});

  if (verbose) console.log('menu dropdown button clicked');
  await Promise.all([
    page.click('button.mat-menu-trigger'),
    page.waitForTimeout(500)
  ]);
  await page.screenshot({path: `${screenshot_dir}/content3.png`});

  await page._client.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: `${save_dir}`,
            }); 

  // Download and wait for download
  if (verbose) console.log('menu button for titles info clicked'),
  await Promise.all([
    page.click('button.mat-menu-item:nth-child(1)'),
    page.waitForTimeout(5000),
    // Event on all responses
    page.on('response', function getResponse(response) {
      //console.log(response);
      filepath = `${save_dir}/${filename_csv}`;
      // If response has a file on it
      if (response._headers['content-disposition'].includes('attachment') && 
          response._headers['content-disposition'].includes(`filename=${filename_csv}`)) {
        // Get the size
        if (verbose) console.log('Size csv  header: ', response._headers['content-length']);
        // Watch event on download folder or file

        fs.watchFile(filepath, function watch(curr, prev) {
          // If current size eq to size from response then close
          if (parseInt(curr.size) === parseInt(response._headers['content-length'])) {
            fs.unwatchFile(filepath, watch);
            page.removeListener("response", getResponse);
          }
        });
        console.log('CSV file downloaded');
      }
      else {
        if (verbose) console.log("headers don't contain attachment with correct name");
        if (verbose) console.log(response._headers);
        console.log('CSV file download failed');
      }
    })
  ]);


  if (verbose) console.log('menu dropdown button clicked');
  await Promise.all([
    page.click('button.mat-menu-trigger'),
    page.waitForTimeout(500)
  ]);
  await page.screenshot({path:  `${screenshot_dir}/content4.png`});

  // Start download and wait for download to start
  if (verbose) console.log('menu button for MARC records clicked');

  await Promise.all([
    page.click('button.mat-menu-item:nth-child(2)'),
    page.waitForTimeout(15000),

  // Wait for download to complete
  // Event on all responses
    page.on('response', function getResponse(response) {
      if (verbose) console.log(response._headers);
      filepath = `${save_dir}/${filename_marc}`;
      if (verbose) console.log(`expecting file ${filename_marc}`);
      // If response has a file on it
      if (response._headers['content-disposition'].includes('attachment') &&
          response._headers['content-disposition'].includes(`filename=${filename_marc}`)) {
        // Get the size
        if (verbose) console.log('Size MARC header: ', response._headers['content-length']);
        if (response._headers['content-length'] !== undefined) {
          // Watch event on download folder or file
          fs.watchFile(filepath, function watch(curr, prev) {
            // If current size eq to size from response then close
            if (parseInt(curr.size) === parseInt(response._headers['content-length'])) {
              fs.unwatchFile(filepath, watch);
              page.removeListener('response', getResponse);
            }
          });
        }
        else {
          fs.watchFile(filepath, function watch(curr, prev) {
            // If current size eq to size from response then close
            if (parseInt(curr.size) !== 0 && parseInt(curr.size) === parseInt(prev.size)) {
              fs.unwatchFile(filepath, watch);
              page.removeListener('response', getResponse);
            }
            else {
              if (verbose) console.log(' -- snooze -- ');
              page.waitForTimeout(3000);
            }
          });
        }
        console.log('MARC file downloaded');
      }
      else {
        if (verbose) console.log("headers don't contain attachment with correct name");
        if (verbose) console.log(response._headers);
        console.log('MARC file download failed');
        page.removeListener('response', getResponse);
      }
    })
  ]);

  var filecsv = `${save_dir}/${filename_csv}`;
  fs.rename(filecsv, save_as_csv, function (err) {
    if (err) throw err;
    if (verbose) console.log(`File Renamed to ${save_as_csv}`);
  }); 

  var filemarc = `${save_dir}/${filename_marc}`;
  fs.rename(filemarc, save_as_marc, function (err) {
    if (err) throw err;
    if (verbose) console.log(`File Renamed to ${save_as_marc}`);
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
} // end catch
};

getRecords().then( () => process.exit(0)).catch( (err) => { console.log(err); process.exit(1) });

