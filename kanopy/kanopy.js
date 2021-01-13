"use strict";
var page = require('webpage').create(),
    system = require('system');

if (system.args.length < 3) {
    console.log('must specify username and password as arguments');
    phantom.exit();
}
var loginurl = "https://virginia.kanopystreaming.com/user/login";
var mrpageurl = "https://virginia.kanopystreaming.com/user/2049/mr";

var userid = system.args[1];
var pass = system.args[2];

function loginFillForm(status) {
    if (status === "success"){
        console.log('rendering page');
        page.render("../data/login_page.png");
        console.log('rendered page');
        console.log('set on load finished');
        page.onLoadFinished = loginResponse;
        console.log("userid = "+userid);

        page.evaluate(function(userid, pass){
            console.log('set parms');
            document.getElementById('edit-name').value = userid;
            document.getElementById('edit-pass').value = pass;
            // document.getElementById('edit-destination').value = "users/2049/mr";
            document.getElementById('user-login').submit();
        }, userid, pass)
    }
    else {
       console.log('page error');
    }
}

function loginResponse() {
    console.log('rendering page after submit');
    page.render("../data/after_submit.png");
    page.onLoadFinished = null;
    page.open(mrpageurl, dodownloadall);
}

function dodownloadall() {
    console.log('submitting download all request');
    page.render("../data/download_page.lng");
    page.evaluate(function(){
        document.getElementById('edit-dl-all').value = "Download+all+15,974+available+MARC+records";
        document.getElementById('ks-mr-tab').submit();
    });
    setTimeout(function() {
        var link = page.evaluate(function() {
            var modal = document.getElementById('big-request-modal');
            if (modal != null) {
                var linkList = modal.getElementsByTagName("a");
                if (linkList.length == 1) {
                    return(linkList[0].getAttribute("href"));
                }
                else {
                    return(modal.innerHTML);
                }
            }
            else {
                return("document = "+document.outerHTML);
            }
        })
        console.log(link);
        phantom.exit();
    }, 120000);
}

console.log('opening page: '+loginurl);
page.open(loginurl, loginFillForm);
