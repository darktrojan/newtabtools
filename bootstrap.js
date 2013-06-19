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
  if (aReason == ADDON_UPGRADE) {
    Services.prefs.deleteBranch(EXTENSION_PREFS + "rows");
    Services.prefs.deleteBranch(EXTENSION_PREFS + "columns");
  }
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
  defaultPrefs.setIntPref("recent.count", 5);
  defaultPrefs.setBoolPref("thumbs.contain", false);
  defaultPrefs.setBoolPref("thumbs.hidebuttons", false);
  defaultPrefs.setBoolPref("thumbs.hidefavicons", false);

  userPrefs = Services.prefs.getBranch(EXTENSION_PREFS);
  userPrefs.setIntPref("version", parseInt(aParams.version));
  if (!userPrefs.prefHasUserValue("donationreminder")) {
    userPrefs.setIntPref("donationreminder", aReason == ADDON_UPGRADE ? 1 : 0);
  }
  userPrefs.addObserver("", prefObserver, false);
  Services.obs.addObserver(notificationObserver, "newtabtools-change", false);

  enumerateTabs(function(aWindow) {
    aWindow.location.reload();
  });

  let windowEnum = Services.wm.getEnumerator("navigator:browser");
  while (windowEnum.hasMoreElements()) {
    windowObserver.paint(windowEnum.getNext());
  }
  Services.ww.registerNotification(windowObserver);

  // Flipping this pref reloads the preloaded page. Ugly but effective.
  if (Services.prefs.getBoolPref("browser.newtab.preload")) {
    Services.prefs.setBoolPref("browser.newtab.preload", false);
    Services.prefs.setBoolPref("browser.newtab.preload", true);
  }

  AddonManager.addAddonListener({
    // If we call reload in shutdown, the page override is
    // still in place, and we don't want that.
    onDisabled: function(aAddon) {
      AddonManager.removeAddonListener(this);
      if (aAddon.id == "newtabtools@darktrojan.net") {
        enumerateTabs(function(aWindow) {
          aWindow.location.reload();
        });
      }

      // Flipping this pref reloads the preloaded page. Ugly but effective.
      if (Services.prefs.getBoolPref("browser.newtab.preload")) {
        Services.prefs.setBoolPref("browser.newtab.preload", false);
        Services.prefs.setBoolPref("browser.newtab.preload", true);
      }
    }
  });
}
function shutdown(aParams, aReason) {
  if (aReason == APP_SHUTDOWN) {
    return;
  }

  let windowEnum = Services.wm.getEnumerator("navigator:browser");
  while (windowEnum.hasMoreElements()) {
    windowObserver.unpaint(windowEnum.getNext());
  }
  Services.ww.unregisterNotification(windowObserver);

  userPrefs.removeObserver("", prefObserver);
  Services.obs.removeObserver(notificationObserver, "newtabtools-change");
}

let userPrefs;
let prefObserver = {
  observe: function(aSubject, aTopic, aData) {
    switch (aData) {
    case "launcher":
    case "launcher.dark":
    case "thumbs.contain":
    case "thumbs.hidebuttons":
    case "thumbs.hidefavicons":
      enumerateTabs(function(aWindow) {
        aWindow.newTabTools.updateUI();
      });
      break;
    case "recent.count":
      enumerateTabs(function(aWindow) {
        aWindow.newTabTools.refreshRecent();
      });
    }
  }
};

let notificationObserver = {
  observe: function(aSubject, aTopic, aData) {
    switch (aData) {
    case "background":
      enumerateTabs(function(aWindow) {
        aWindow.newTabTools.refreshBackgroundImage();
      });
      break;
    }
  }
};

let windowObserver = {
  observe: function(aSubject, aTopic, aData) {
    aSubject.addEventListener("load", function() {
      windowObserver.paint(aSubject);
    }, false);
  },
  paint: function(aWindow) {
    if (aWindow.location == "chrome://browser/content/browser.xul") {
      aWindow.document.addEventListener("TabSelect", this.onTabSelect, false);
    }
  },
  unpaint: function(aWindow) {
    if (aWindow.location == "chrome://browser/content/browser.xul") {
      aWindow.document.removeEventListener("TabSelect", this.onTabSelect, false);
    }
  },
  onTabSelect: function(aEvent) {
    let browser = aEvent.target.linkedBrowser;
    if (browser.currentURI.spec == "about:newtab") {
      browser.contentWindow.newTabTools.onVisible();
    }
  }
};

function enumerateTabs(aCallback) {
  let windowEnum = Services.wm.getEnumerator("navigator:browser");
  while (windowEnum.hasMoreElements()) {
    let browserWindow = windowEnum.getNext();
    for (let browser of browserWindow.gBrowser.browsers) {
      if (browser.contentWindow.location.href == "about:newtab") {
        aCallback(browser.contentWindow);
      }
    }
  }
}
