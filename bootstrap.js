/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at http://mozilla.org/MPL/2.0/.
*/

const Ci = Components.interfaces;
const Cu = Components.utils;

const BROWSER_PREFS = "browser.newtabpage.";
const EXTENSION_PREFS = "extensions.newtabtools.";

Cu.import("resource://gre/modules/Services.jsm");

let browserPrefs;
let extensionPrefs;
let copiedPrefs = ["rows", "columns"];
let prefsObserver = {
  observe: function(aSubject, aTopic, aData) {
    if (copiedPrefs.indexOf(aData) >= 0) {
      try {
        let value = extensionPrefs.getIntPref(aData);
        browserPrefs.setIntPref(aData, value);
      } catch(ex) {
        browserPrefs.clearUserPref(aData);
      }
    }
  }
};

function install(aParams, aReason) {
}
function uninstall(aParams, aReason) {
  if (aReason == ADDON_UNINSTALL) {
    Services.prefs.deleteBranch(EXTENSION_PREFS);
  }
}
function startup(aParams, aReason) {
  let defaultPrefs = Services.prefs.getDefaultBranch(EXTENSION_PREFS);
  defaultPrefs.setIntPref("rows", 3);
  defaultPrefs.setIntPref("columns", 3);
  defaultPrefs.setIntPref("launcher", 3);
  defaultPrefs.setBoolPref("launcher.dark", false);
  defaultPrefs.setBoolPref("thumbs.contain", false);
  defaultPrefs.setBoolPref("thumbs.hidebuttons", false);

  if (Services.prefs.getPrefType(BROWSER_PREFS + "rows") == Ci.nsIPrefBranch.PREF_INT) {
    browserPrefs = Services.prefs.getBranch(BROWSER_PREFS);
    extensionPrefs = Services.prefs.getBranch(EXTENSION_PREFS);

    for (let copiedPref of copiedPrefs) {
      if (extensionPrefs.prefHasUserValue(copiedPref)) {
        browserPrefs.setIntPref(copiedPref, extensionPrefs.getIntPref(copiedPref));
      } else if (browserPrefs.prefHasUserValue(copiedPref)) {
        extensionPrefs.setIntPref(copiedPref, browserPrefs.getIntPref(copiedPref));
      }
    }
    extensionPrefs.addObserver("", prefsObserver, false);
  }
}
function shutdown(aParams, aReason) {
  extensionPrefs.removeObserver(EXTENSION_PREFS, prefsObserver)
}
