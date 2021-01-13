"use strict";
var casper = require('casper').create();

if (casper.cli.args.length < 3) {
    casper.echo('must specify username and password and outputfilename as arguments');
    phantom.exit();
}
var loginurl = "https://virginia.kanopy.com/login";
var landing = "https://virginia.kanopy.com";
var mrpageurl = "https://virginia.kanopy.com/user/2049/mr";

var userid = casper.cli.args[0];
var pass = casper.cli.args[1];
var filename = casper.cli.args[2];

// print out all the messages in the headless browser context
casper.on('remote.message', function(msg) {
    this.log('remote message caught: ' + msg, 'debug');
});

// print out all page errors
casper.on("page.error", function(msg, trace) {
    this.log("Page Error: " + msg, 'error');
});


casper.log('opening page: '+loginurl, 'info');

// First step  Open the login page
casper.start(loginurl, function openLoginPage() {
    this.log(this.getTitle(), 'info');
    this.log("user id = "+ userid, 'info');
});

// Second step  Wait for login form to exist and then fill it in
casper.waitForSelector('form#user-login', function fillInForm(){
    this.page.render("../data/kanopy_login_page.png");
    this.fill('form#user-login', {
            'name' : userid,
            'pass' : pass
    }, false);
});

// Third step  Click the Login Button
casper.thenClick('#edit-submit', function clickLogin(){
    this.log('Login button clicked', 'info');
});

casper.then(function() {
    casper.wait(5000, function() { this.log('waiting 5000ms', 'info'); })
});

// Fourth step  Wait for Admin page to load
casper.waitForUrl(landing, function waitForAdminPage(){
    this.log(this.getTitle(), 'info');
    this.page.render("../data/kanopy_after_submit.png");
});

// Fifth step  Navigate to Marc Record download page
casper.thenOpen(mrpageurl, function openMarcRecordPage(){
    this.log(this.getTitle(), 'info');
    this.page.render("../data/kanopy_download_page.png");
});

// Sixth step  Click the Download All Button
casper.waitForSelector('input#edit-dl-all', function startDownload(){
    this.page.evaluate(function(){
        document.getElementById('edit-dl-all').value = "Download+all+available+MARC+records";
        document.getElementById('ks-mr-tab').submit();
    });

});

var href='';

// Seventh step  Wait for Sloooooow download process to complete, then download file
casper.waitForSelector('a[href*=download]', function waitForDownload(){
    var href = this.getElementAttribute('a[href*=download]', "href");
    this.log(href, 'info');
    casper.download(href, filename, "POST");
    }, null, 120000 );

// Now actually run all of the assembled steps.
casper.run();

