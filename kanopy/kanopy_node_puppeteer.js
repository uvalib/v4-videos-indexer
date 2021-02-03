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
const filename_zip = `Kanopy_MARC_Records__additions__virginia.zip`; // args.marc
const save_dir = `${datadir}/tmp`;
const incoming_dir = `${datadir}/incoming_zip`;
const screenshot_dir = `${datadir}/screenshots`;

const loginurl = "https://virginia.kanopy.com/login";
const landing = "https://virginia.kanopy.com";
const mrpageurl = "https://virginia.kanopy.com/user/2049/mr";

const filename = args.file;
const save_as_zip = `${incoming_dir}/${args.file}`;

async function getRecords() {
  const browser = await puppeteer.launch({userDataDir:`${datadir}/.config'});
  const page = await browser.newPage();
  await page.setViewport({width: 1200, height: 1000})
  await Promise.all([
    page.goto(loginurl),
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
  ]);
  await page.screenshot({path: `${screenshot_dir}/login.png`});
  if (verbose) console.log('At login page');

  await page.type('input#edit-name', creds.username);
  await page.type('input#edit-pass', creds.password);
  await Promise.all([
    page.click('input#edit-submit'),
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
  ]);
  await page.screenshot({path: `${screenshot_dir}/loggedin.png`});
  if (verbose) console.log('At main admin page');

  await Promise.all([
    page.goto(landing),
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
  ]);
  await page.screenshot({path: `${screenshot_dir}/main.png`});
  if (verbose) console.log('At main page');

  await Promise.all([
    page.goto(mrpageurl),
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
  ]);
  await page.screenshot({path: `${screenshot_dir}/marcpage.png`});
  if (verbose) console.log('At marc download page');

  await page._client.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: `${save_dir}`,
            }); 

  // Download and wait for download
  // #edit-dl-all
  await Promise.all([
    page.click('input#edit-dl-all'),
    page.waitForSelector('a.button:nth-child(2)', {visible: true}),
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
  ]);
  await page.screenshot({path: `${screenshot_dir}/marcpage2.png`});
  if (verbose) console.log('At marc download page w/button');

  // Download and wait for download
  await Promise.all([
    // click the big orange button
    page.click('a.button:nth-child(2)'),
    page.waitForTimeout(25000),
    // Event on all responses
    page.on('response', function getResponse(response) {
      //if (verbose) console.log(response);
      filepath = `${save_dir}/${filename_zip}`;
      if (verbose) console.log(`expecting file ${filename_zip}`);
      // If response has a file on it
      // location: 'https://www.kanopy.com/sites/default/files/Kanopy_MARC_Records__additions__virginia.zip
      //  'content-type': 'application/zip',
      //  'content-length': '235459',

      if (response._headers['content-type'].includes('application/zip') &&
          response._headers['content-length'] !== undefined) {
        // Get the size
        if (verbose) console.log('Size zip header: ', response._headers['content-length']);
        if (response._headers['content-length'] !== undefined) {
          // Watch event on download folder or file
          filesize = parseInt(response._headers['content-length']);
          fs.watchFile(filepath, function watch(curr, prev) {
            // If current size eq to size from response then close
            if (parseInt(curr.size) === filesize) {
              fs.unwatchFile(filepath, watch);
              page.removeListener('response', getResponse);
            }
          });
        }
      }
    })
  ]);
  console.log('Kanopy Zip file downloaded');

  var filezip = `${save_dir}/${filename_zip}`;
  fs.rename(filezip, save_as_zip, function (err) {
    if (err) throw err;
    if (verbose) console.log(`File Renamed to ${save_as_zip}`);
  });

  browser.close();
}

getRecords();
