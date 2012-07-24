/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at http://mozilla.org/MPL/2.0/.
*/
Components.utils.import("resource://gre/modules/Services.jsm");

function install(params, aReason) {
}
function uninstall(params, aReason) {
  if (aReason == ADDON_UNINSTALL) {
    Services.prefs.deleteBranch("extensions.newtabtools.");
  }
}
function startup(params, aReason) {
  let defaultPrefs = Services.prefs.getDefaultBranch("extensions.newtabtools.");
  defaultPrefs.setIntPref("rows", 3);
  defaultPrefs.setIntPref("columns", 3);
  defaultPrefs.setIntPref("launcher", 3);
}
function shutdown(params, aReason) {
}
