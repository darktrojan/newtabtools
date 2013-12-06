/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at http://mozilla.org/MPL/2.0/.
*/

const { interfaces: Ci, utils: Cu } = Components;

const EXTENSION_PREFS = "extensions.newtabtools.";

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/NewTabUtils.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");

function install(aParams, aReason) {
  if (aReason == ADDON_UPGRADE) {
    Services.prefs.deleteBranch(EXTENSION_PREFS + "rows");
    Services.prefs.deleteBranch(EXTENSION_PREFS + "columns");

    let showRecent = true;
    if (Services.prefs.prefHasUserValue(EXTENSION_PREFS + "recent.count")) {
      showRecent = Services.prefs.getIntPref(EXTENSION_PREFS + "recent.count") != 0;
      Services.prefs.deleteBranch(EXTENSION_PREFS + "recent.count");
      Services.prefs.setBoolPref(EXTENSION_PREFS + "recent.show", showRecent);
    }
  }
}
function uninstall(aParams, aReason) {
  if (aReason == ADDON_UNINSTALL) {
    Services.prefs.deleteBranch(EXTENSION_PREFS);
  }
}
function startup(aParams, aReason) {
  let defaultPrefs = Services.prefs.getDefaultBranch(EXTENSION_PREFS);
  defaultPrefs.setIntPref("donationreminder", 0);
  defaultPrefs.setCharPref("grid.margin", "small small small small");
  defaultPrefs.setCharPref("grid.spacing", "small");
  defaultPrefs.setIntPref("launcher", 3);
  defaultPrefs.setBoolPref("launcher.dark", false);
  defaultPrefs.setBoolPref("recent.show", true);
  defaultPrefs.setBoolPref("thumbs.contain", false);
  defaultPrefs.setBoolPref("thumbs.hidebuttons", false);
  defaultPrefs.setBoolPref("thumbs.hidefavicons", false);

  userPrefs = Services.prefs.getBranch(EXTENSION_PREFS);
  userPrefs.setIntPref("version", parseInt(aParams.version));

  NewTabUtils.links._oldGetLinks = NewTabUtils.links.getLinks;
  NewTabUtils.links.getLinks = function() {
    let list = NewTabUtils.links._oldGetLinks();
    if (userPrefs.prefHasUserValue("filter")) {
      let countPref = userPrefs.getCharPref("filter");
      let counts = JSON.parse(countPref);
      return list.filter(function(aItem) {
        if (NewTabUtils.pinnedLinks.isPinned(aItem))
          return true;
        let match = /^https?:\/\/([^\/]+)\//.exec(aItem.url);
        if (!match)
          return true;
        if (match[1] in counts) {
          if (counts[match[1]]) {
            counts[match[1]]--;
            return true;
          }
          return false;
        }
        return true;
      });
    } else {
      return list;
    }
  }

  if (userPrefs.getIntPref("donationreminder") == 0 && aReason == ADDON_UPGRADE) {
    userPrefs.setIntPref("donationreminder", 1);
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
    }
  });
}
function shutdown(aParams, aReason) {
  if (aReason == APP_SHUTDOWN) {
    return;
  }

  NewTabUtils.links.getLinks = NewTabUtils.links._oldGetLinks;
  delete NewTabUtils.links._oldGetLinks;

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
    case "grid.margin":
    case "grid.spacing":
    case "launcher":
    case "launcher.dark":
    case "thumbs.contain":
    case "thumbs.hidebuttons":
    case "thumbs.hidefavicons":
      enumerateTabs(function(aWindow) {
        aWindow.newTabTools.updateUI();
      });
      break;
    case "recent.show":
      enumerateTabs(function(aWindow) {
        aWindow.newTabTools.refreshRecent();
      });
    case "filter":
      enumerateTabs(function(aWindow) {
        aWindow.gGrid.refresh();
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
    case "thumbnail":
      enumerateTabs(function(aWindow) {
        let tileURL = aSubject.QueryInterface(Ci.nsISupportsString);
        aWindow.newTabTools.refreshThumbnail(aSubject.data);
      });
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
      aWindow.document.addEventListener("TabOpen", this.onTabOpen, false);
    }
  },
  unpaint: function(aWindow) {
    if (aWindow.location == "chrome://browser/content/browser.xul") {
      aWindow.document.removeEventListener("TabOpen", this.onTabOpen, false);
    }
  },
  onTabOpen: function(aEvent) {
    let browser = aEvent.target.linkedBrowser;
    if (browser.currentURI.spec == "about:newtab") {
      browser.contentWindow.newTabTools.onVisible();
    }
  }
};

function enumerateTabs(aCallback) {
  for (let page of NewTabUtils.allPages._pages) {
    try {
      let global = Cu.getGlobalForObject(page);
      aCallback(global);
    } catch(e) {
      Cu.reportError(e);
    }
  }
}
