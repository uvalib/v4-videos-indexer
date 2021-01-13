"use strict";
var page = require ('webpage').create (),
    system = require('system');

if (system.args.length < 3) {
    console.log('must specify username and password as arguments');
    phantom.exit();
}
var loginurl = "https://digitalcampus.swankmp.net/uva296909/Admin/login";
var contentmanager  = "https://digitalcampus.swankmp.net/uva296909/Admin#/ContentManager";

var userid = system.args[1];
var pass = system.args[2];

function loginFillForm(status) {
    if (status === "success"){
        console.log('rendering page');
        page.render("../data/swank_login_page.png");
        console.log('rendered page');
        console.log('set on load finished');
        page.onLoadFinished = loginResponse;
        console.log("userid = "+userid);

        page.evaluate(function(userid, pass){
            console.log('set parms');
            document.getElementById('Username').value = userid;
            document.getElementById('Password').value = pass;
            document.getElementsByClassName('login-form')[0].submit();
        }, userid, pass)
    }
    else {
       console.log('page error');
    }
}

function loginResponse() {
    console.log('rendering page after submit');
    page.render("../data/swank_after_submit.png");
    page.onLoadFinished = null;
    page.open(contentmanager, dodownloadall);
}

function dodownloadall() {
    console.log('submitting download all request');
    page.render("../data/swank_contentmanager_page.png");
    console.log('exiting');
        phantom.exit();
}

console.log('opening page: '+loginurl);
page.open(loginurl, loginFillForm);
