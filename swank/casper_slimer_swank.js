"use strict";
var casper = require('casper').create({
    verbose: true,
    viewportSize: {
        width: 1280,
        height: 2000
    },
    logLevel: 'debug',
    pageSettings: {
        ignoreSslErrors: true,
        loadImages: true, // load images
        loadPlugins: true, // do not load NPAPI plugins (Flash, Silverlight, ...)
        webSecurityEnabled: false, // ajax
        userAgent: 'Mozilla/5.0 (Windows NT 6.2; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/29.0.1547.2 Safari/537.36'
    }
});

if (casper.cli.args.length < 4) {
    this.echo('must specify username and password and outputfilename as arguments');
    phantom.exit();
}
var loginurl = "https://digitalcampus.swankmp.net/uva296909/admin/Login";
var landing = "https://digitalcampus.swankmp.net/uva296909/Admin#/AppearanceSettings";
var mrpageurl = "https://digitalcampus.swankmp.net/uva296909/Admin#/ContentManager";

var userid = casper.cli.args[0];
var pass = casper.cli.args[1];
var filename = casper.cli.args[2];
var filename2 = casper.cli.args[3];

// print out all the messages in the headless browser context
casper.on('remote.message', function(msg) {
    this.log('remote message caught: ' + msg, 'debug');
});

// print out all page errors
casper.on("page.error", function(msg, trace) {
    if (msg.includes("Attempting to configurable attribute of unconfigurable property")){
        this.log("expected error: " + msg, 'debug');
    }
    else {
        this.log("Page Error: " + msg, 'error');
        this.log("trace : " + JSON.stringify(trace), 'error');
    }
});

casper.on("page.initialized", function(page) {
    page.evaluate(function() {
        delete window.callPhantom;
        delete window._phantom;
    });
});

casper.log('opening page: '+loginurl, 'info');

// First step  Open the login page
casper.start(loginurl, function openLoginPage() {
    this.log(this.getTitle(), 'info');
    this.log("user id = "+ userid, 'info');
});

casper.wait(40000, function() {
    this.log("I've waited for a second.", 'info');
    this.page.render("../data/swank_login_page_loading.png");
});

// Second step  Wait for login form to exist and then fill it in
casper.waitForSelector('input#userName', function fillInForm(){
    this.page.render("../data/swank_login_page.png");
    this.fillSelectors('form',  {
            'input#userName' : userid,
            'input#mat-input-3' : pass
    }, false);
    this.page.render("../data/swank_login_page_filled.png");
}, false, 20000);

// Third step  Click the Login Button
casper.thenClick('button[action=login]', function clickLogin(){
    this.log('Login button clicked', 'info');
});

// Fourth step  Wait for Admin page to load 
casper.waitForUrl(landing, function waitForAdminPage(){
    this.log(this.getTitle(), 'info');
    this.page.render("../data/swank_after_submit.png");
});

// Fifth step  Navigate to the content manager tab of Admin page
casper.thenOpen(mrpageurl, function goToContentManager(){
    this.log(this.getTitle(), 'info');
    this.page.render("../data/swank_content_manager.png");
});

// Sixth step  Wait for the list of available videos to load
casper.waitForSelector('tr.ng-scope', function waitForContentLoad(){
    this.page.render("../data/swank_content_manager_2.png");
    }, function _timeout() { 
    this.log("timeout ", 'warn');
    this.page.render("../data/swank_content_manager_2.png");
    } , 40000);

// Seventh step  Click the select all button
//<input type="checkbox" class="mat-checkbox-input cdk-visually-hidden" id="mat-checkbox-2-input" tabindex="0" aria-checked="true">
casper.thenClick('button[ng-click*=selectAll]', function selectAll(){
    this.log('selectAll button clicked', 'info');
});

var href='';

// Eighth step  Download the selected content details .csv file
casper.then(function downloadMetadata(){
    this.page.render("../data/swank_content_manager_3.png");
    var href = this.getElementAttribute('form#metadata', "action");
    var parm = this.getElementAttribute('input[name=watchLinkJson]', "value");
    this.log(href, 'debug');
    this.log(parm, 'debug');
    casper.download(href, filename, "POST", {
        watchLinkJson : parm
    });
});

// Ninth step  Download the selected MARC records
casper.then(function downloadMarcRecords(){
    var href2 = this.getElementAttribute('form#marcRecords', "action");
    var parm2 = this.getElementAttribute('input[name=filmIdList]', "value");
    this.log(href2, 'debug');
    this.log(parm2, 'debug');
    casper.download(href2, filename2, "POST", {
        filmIdList : parm2
    });
});

// Now actually run all of the assembled steps.
casper.run();

