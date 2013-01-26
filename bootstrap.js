/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at http://mozilla.org/MPL/2.0/.
*/

const Cu = Components.utils;

const EXTENSION_PREFS = "extensions.newtabtools.";

Cu.import("resource://gre/modules/Services.jsm");

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
}
function shutdown(aParams, aReason) {
}
