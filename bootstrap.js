/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at http://mozilla.org/MPL/2.0/.
*/

const Cu = Components.utils;

const EXTENSION_PREFS = "extensions.newtabtools.";

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/NewTabUtils.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");

function install(aParams, aReason) {
}
function uninstall(aParams, aReason) {
  if (aReason == ADDON_UNINSTALL) {
    Services.prefs.deleteBranch(EXTENSION_PREFS);
  }
}
function startup(aParams, aReason) {
  let defaultPrefs = Services.prefs.getDefaultBranch(EXTENSION_PREFS);
  defaultPrefs.setIntPref("launcher", 3);
  defaultPrefs.setBoolPref("launcher.dark", false);
  defaultPrefs.setBoolPref("thumbs.contain", false);
  defaultPrefs.setBoolPref("thumbs.hidebuttons", false);

  userPrefs = Services.prefs.getBranch(EXTENSION_PREFS);
  userPrefs.setIntPref("version", parseInt(aParams.version));
  if (!userPrefs.prefHasUserValue("donationreminder")) {
    userPrefs.setIntPref("donationreminder", aReason == ADDON_UPGRADE ? 1 : 0);
  }
  userPrefs.addObserver("", prefObserver, false);

  reloadTabs();

  AddonManager.addAddonListener({
    // If we call reloadTabs in shutdown, the page override is
    // still in place, and we don't want that.
    onDisabled: function(aAddon) {
      AddonManager.removeAddonListener(this);
      if (aAddon.id == "newtabtools@darktrojan.net") {
        reloadTabs();
      }
    }
  });
}
function shutdown(aParams, aReason) {
  if (aReason == APP_SHUTDOWN) {
    return;
  }

  userPrefs.removeObserver("", prefObserver);
}

let userPrefs;
let prefObserver = {
  observe: function(aSubject, aTopic, aData) {
    switch (aData) {
    case "launcher":
    case "launcher.dark":
    case "thumbs.hidebuttons":
      NewTabUtils.allPages.update();
      break;
    }
  }
}

function reloadTabs() {
  let windowEnum = Services.wm.getEnumerator("navigator:browser");
  while (windowEnum.hasMoreElements()) {
    let browserWindow = windowEnum.getNext();
    for (let browser of browserWindow.gBrowser.browsers) {
      if (browser.contentWindow.location.href == "about:newtab") {
        browser.contentWindow.location.reload();
      }
    }
  }
}
