/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at http://mozilla.org/MPL/2.0/.
*/

const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");

let prefs;
let copiedPrefs = ["rows", "columns"];
let prefsObserver = {
  observe: function(aSubject, aTopic, aData) {
    if (copiedPrefs.indexOf(aData) >= 0) {
      try {
        let value = aSubject.getIntPref(aData);
        Services.prefs.setIntPref("browser.newtabpage." + aData, value);
      } catch(ex) {
        Services.prefs.clearUserPref("browser.newtabpage" + aData);
      }
    }
  }
};

function install(aParams, aReason) {
}
function uninstall(aParams, aReason) {
  if (aReason == ADDON_UNINSTALL) {
    Services.prefs.deleteBranch("extensions.newtabtools.");
  }
}
function startup(aParams, aReason) {
  let defaultPrefs = Services.prefs.getDefaultBranch("extensions.newtabtools.");
  defaultPrefs.setIntPref("rows", 3);
  defaultPrefs.setIntPref("columns", 3);
  defaultPrefs.setIntPref("launcher", 3);
  defaultPrefs.setBoolPref("launcher.dark", false);
  defaultPrefs.setBoolPref("thumbs.contain", false);

  if (Services.prefs.getPrefType("browser.newtabpage.rows") == Ci.nsIPrefBranch.PREF_INT) {
    prefs = Services.prefs.getBranch("extensions.newtabtools.");
    for (let copiedPref of copiedPrefs) {
      if (prefs.prefHasUserValue(copiedPref) &&
          prefs.getPrefType(copiedPref) == Ci.nsIPrefBranch.PREF_INT) {
        Services.prefs.setIntPref("browser.newtabpage." + copiedPref, prefs.getIntPref(copiedPref));
      }
    }
    prefs.addObserver("", prefsObserver, false);
  }
}
function shutdown(aParams, aReason) {
  Services.prefs.removeObserver("extensions.newtabtools.", prefsObserver)
}
