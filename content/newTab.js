/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at http://mozilla.org/MPL/2.0/.
*/

let { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "AddonManager", "resource://gre/modules/AddonManager.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "FileUtils", "resource://gre/modules/FileUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "NetUtil", "resource://gre/modules/NetUtil.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "SessionStore", "resource:///modules/sessionstore/SessionStore.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PlacesUtils", "resource://gre/modules/PlacesUtils.jsm");

XPCOMUtils.defineLazyServiceGetter(this, "faviconService", "@mozilla.org/browser/favicon-service;1", "mozIAsyncFavicons");
XPCOMUtils.defineLazyServiceGetter(this, "annoService", "@mozilla.org/browser/annotation-service;1", "nsIAnnotationService");

let newTabTools = {
  launcherOnClick: function(event) {
    switch (event.originalTarget.id) {
    case "downloads":
      newTabTools.browserWindow.BrowserDownloadsUI();
      break;
    case "bookmarks":
      newTabTools.browserWindow.PlacesCommandHook.showPlacesOrganizer("AllBookmarks");
      break;
    case "history":
      newTabTools.browserWindow.PlacesCommandHook.showPlacesOrganizer("History");
      break;
    case "addons":
      newTabTools.browserWindow.BrowserOpenAddonsMgr();
      break;
    case "sync":
      newTabTools.browserWindow.openPreferences("paneSync");
      break;
    case "settingsWin":
    case "settingsUnix":
      newTabTools.browserWindow.openPreferences();
      break;
    case "restorePreviousSession":
      SessionStore.restoreLastSession();
      break;
    }
  },
  get backgroundImageFile() {
    return FileUtils.getFile("ProfD", ["newtab-background"], true);
  },
  get backgroundImageURL() {
    return Services.io.newFileURI(this.backgroundImageFile);
  },
  refreshBackgroundImage: function() {
    if (this.backgroundImageFile.exists()) {
      this.page.style.backgroundImage =
        'url("' + this.backgroundImageURL.spec + '?' + this.backgroundImageFile.lastModifiedTime + '")';
      document.documentElement.classList.add("background");
    } else {
      this.page.style.backgroundImage = null;
      document.documentElement.classList.remove("background");
    }
  },
  configOnClick: function(event) {
    let id = event.originalTarget.id;
    let checked;
    let tileURL;
    switch (id) {
    case "config-pinURL":
      let link = this.pinURLInput.value;
      let linkURI = Services.io.newURI(link, null, null);
      event.originalTarget.disabled = true;
      PlacesUtils.promisePlaceInfo(linkURI).then(function(info) {
        newTabTools.pinURL(linkURI.spec, info.title);
        newTabTools.pinURLInput.value = "";
        event.originalTarget.disabled = false;
      }, function() {
        newTabTools.pinURL(linkURI.spec, "");
        newTabTools.pinURLInput.value = "";
        event.originalTarget.disabled = false;
      }).then(null, Cu.reportError);
      break;
    case "config-browseForFile":
    case "config-bg-browseForFile":
      let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      fp.init(window, document.title, Ci.nsIFilePicker.modeOpen);
      fp.appendFilters(Ci.nsIFilePicker.filterImages);
      if (fp.show() == Ci.nsIFilePicker.returnOK) {
        let input = id == "config-browseForFile" ? this.setThumbnailInput : this.setBackgroundInput;
        input.value = fp.fileURL.spec;
      }
      break;
    case "config-setThumbnail":
      this.setThumbnail(this.tileSelect.value, this.setThumbnailInput.value, function() {
        tileURL = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
        tileURL.data = this.tileSelect.value;
        Services.obs.notifyObservers(tileURL, "newtabtools-change", "thumbnail");
      }.bind(this));
      break;
    case "config-removeThumbnail":
      this.removeThumbnail(this.tileSelect.value);
      tileURL = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
      tileURL.data = this.tileSelect.value;
      Services.obs.notifyObservers(tileURL, "newtabtools-change", "thumbnail");
      break;
    case "config-containThumbs":
      checked = event.originalTarget.checked;
      this.prefs.setBoolPref("thumbs.contain", checked);
      break;
    case "config-overlapTitle":
      checked = event.originalTarget.checked;
      this.prefs.setBoolPref("thumbs.overlaptitle", checked);
      break;
    case "config-setTitle":
      this.setTitle(this.tileSelect.selectedIndex, this.setTitleInput.value);
      break;
    case "config-removeTitle":
      this.setTitle(this.tileSelect.selectedIndex, null);
      break;
    case "config-setBackground":
      if (this.setBackgroundInput.value) {
        let fos = FileUtils.openSafeFileOutputStream(this.backgroundImageFile);
        NetUtil.asyncFetch(this.setBackgroundInput.value, function(inputStream, status) {
          if (!Components.isSuccessCode(status)) {
            return;
          }
          NetUtil.asyncCopy(inputStream, fos, function (aResult) {
            FileUtils.closeSafeFileOutputStream(fos);
            Services.obs.notifyObservers(null, "newtabtools-change", "background");
          }.bind(this));
        }.bind(this));
      }
      break;
    case "config-removeBackground":
      if (this.backgroundImageFile.exists())
        this.backgroundImageFile.remove(true);
      Services.obs.notifyObservers(null, "newtabtools-change", "background");
      break;
    case "config-darkLauncher":
      checked = event.originalTarget.checked;
      this.prefs.setBoolPref("launcher.dark", checked);
      break;
    case "config-morePrefs":
      newTabTools.browserWindow.BrowserOpenAddonsMgr("addons://detail/newtabtools@darktrojan.net/preferences")
      break;
    case "config-donate":
      let url = "https://addons.mozilla.org/addon/new-tab-tools/about";
      newTabTools.browserWindow.openLinkIn(url, "current", {});
      break;
    }
  },
  onTileSelect: function() {
    this.setTitleInput.value = this.tileSelect.selectedItem.label;
  },
  toggleConfig: function() {
    this.configWrapper.classList.toggle("shown");
    this.configToggleButton.classList.toggle("shown");
    if (this.tileSelect.itemCount == 0)
      this.fillSelect();
  },
  fillSelect: function() {
    this.tileSelect.removeAllItems();
    for (let cell of gGrid.cells) {
      if (!cell.isEmpty()) {
        let title = cell.site._annoTitle || cell.site.title;
        let name = title || cell.site.url;
        let description = title ? cell.site.url : null;
        this.tileSelect.appendItem(name, cell.site.url, description);
      }
    }
    this.tileSelect.selectedIndex = 0;
    this.onTileSelect();
  },
  pinURL: function(link, title) {
    let sites = gGrid.sites;
    sites.unshift(null);
    gTransformation.rearrangeSites(sites);

    let pinnedSites = sites.filter(function (aSite) { return aSite && aSite.isPinned(); });
    pinnedSites.forEach(function (aSite) { aSite.pin(sites.indexOf(aSite)); }, this);

    gBlockedLinks.unblock(link);
    gPinnedLinks.pin({url: link, title: title}, 0);
    gUpdater.updateGrid(this.fillSelect.bind(this));
  },
  refreshThumbnail: function(aURL) {
    let newThumbnailURL = PageThumbs.getThumbnailURL(aURL) + "&" + Math.random();
    for (let cell of gGrid.cells) {
      if (cell.site.url == aURL) {
        let thumbnail = cell._node.querySelector("span.newtab-thumbnail");
        thumbnail.style.backgroundImage = 'url("' + newThumbnailURL + '")';
      }
    }
  },
  getFileForURL: function(aURL) {
    if ("getFilePathForURL" in PageThumbsStorage) {
      let path = PageThumbsStorage.getFilePathForURL(aURL);
      return FileUtils.File(path);
    } else {
      return PageThumbsStorage.getFileForURL(aURL);
    }
  },
  removeThumbnail: function(aURL) {
    let file = this.getFileForURL(aURL);
    if (file.exists()) {
      file.permissions = 0644;
      file.remove(true);
    }
  },
  setThumbnail: function(aURL, aSrc, aCallback) {
    this.removeThumbnail(aURL);

    let file = this.getFileForURL(aURL);
    let image = new Image();
    image.onload = function() {
      let [thumbnailWidth, thumbnailHeight] = PageThumbs._getThumbnailSize();
      let scale = Math.max(thumbnailWidth / image.width, thumbnailHeight / image.height);

      let canvas = PageThumbs._createCanvas();
      canvas.mozOpaque = false;
      canvas.width = image.width * scale;
      canvas.height = image.height * scale;
      let ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      canvas.mozFetchAsStream(function(aInputStream) {
        let outputStream = FileUtils.openSafeFileOutputStream(file);
        NetUtil.asyncCopy(aInputStream, outputStream, function(aSuccessful) {
          FileUtils.closeSafeFileOutputStream(outputStream);
          file.permissions = 0444;
          if (aCallback)
            aCallback(aSuccessful);
        });
      }, "image/png");
    }
    image.src = aSrc;
  },
  setTitle: function(aIndex, aTitle) {
    let cell = gGrid.cells[aIndex];
    let site = cell.site;
    let uri = Services.io.newURI(site.url, null, null);
    if (aTitle) {
      annoService.setPageAnnotation(uri, "newtabtools/title",
        this.setTitleInput.value, 0, annoService.EXPIRE_WITH_HISTORY);
      site._annoTitle = aTitle;
    } else {
      annoService.removePageAnnotation(uri, "newtabtools/title");
      this.setTitleInput.value = aTitle = site.title;
      delete site._annoTitle;
    }
    let titleElement = site.node.querySelector(".newtab-title");
    titleElement.lastChild.nodeValue = aTitle;
    this.tileSelect.selectedItem.label = aTitle;
  },
  updateUI: function() {
    let launcherPosition = this.prefs.getIntPref("launcher");
    if (launcherPosition) {
      let positionNames = ["top", "right", "bottom", "left"];
      document.documentElement.setAttribute("launcher", positionNames[launcherPosition - 1]);
    } else {
      document.documentElement.removeAttribute("launcher");
    }

    let launcherDark = this.prefs.getBoolPref("launcher.dark");
    this.launcher.classList[launcherDark ? "add" : "remove"]("dark");
    this.darkLauncherCheckbox.checked = launcherDark;

    let containThumbs = this.prefs.getBoolPref("thumbs.contain");
    document.documentElement.classList[containThumbs ? "add" : "remove"]("containThumbs");
    this.containThumbsCheckbox.checked = containThumbs;

    let overlapTitle = this.prefs.getBoolPref("thumbs.overlaptitle");
    document.documentElement.classList[overlapTitle ? "add" : "remove"]("overlapTitle");
    this.overlapTitleCheckbox.checked = overlapTitle;

    let hideButtons = this.prefs.getBoolPref("thumbs.hidebuttons");
    document.documentElement.classList[hideButtons ? "add" : "remove"]("hideButtons");

    let hideFavicons = this.prefs.getBoolPref("thumbs.hidefavicons");
    document.documentElement.classList[hideFavicons ? "add" : "remove"]("hideFavicons");

    let gridMargin = ["small", "small", "small", "small"];
    let prefGridMargin = this.prefs.getCharPref("grid.margin").split(" ", 4);
    if (prefGridMargin.length == 4) {
      gridMargin = prefGridMargin;
    }
    this.setGridMargin("top", gridMargin[0]);
    this.setGridMargin("right-top", gridMargin[1]);
    this.setGridMargin("right-bottom", gridMargin[1]);
    this.setGridMargin("bottom", gridMargin[2]);
    this.setGridMargin("left-bottom", gridMargin[3]);
    this.setGridMargin("left-top", gridMargin[3]);

    let gridSpacing = this.prefs.getCharPref("grid.spacing");
    document.documentElement.setAttribute("spacing", gridSpacing);
  },
  setGridMargin: function(aPiece, aSize) {
    let pieceElement = document.getElementById("newtab-margin-" + aPiece);
    pieceElement.classList.remove("medium");
    pieceElement.classList.remove("large");
    if (aSize == "medium" || aSize == "large") {
      pieceElement.classList.add(aSize);
    }
  },
  startRecent: function() {
    let tabContainer = this.browserWindow.gBrowser.tabContainer;
    let handler = this.refreshRecent.bind(this);
    tabContainer.addEventListener("TabOpen", handler, false);
    tabContainer.addEventListener("TabClose", handler, false);

    window.addEventListener("unload", function() {
      tabContainer.removeEventListener("TabOpen", handler, false);
      tabContainer.removeEventListener("TabClose", handler, false);
    }, false);
    handler();

    window.addEventListener("resize", this.trimRecent.bind(this));
    this.recentListOuter.addEventListener("overflow", this.trimRecent.bind(this));
  },
  refreshRecent: function(aEvent) {
    // Redefine this because this function is called before it is defined
    let HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

    if (aEvent && aEvent.originalTarget.linkedBrowser.contentWindow == window) {
      return;
    }

    if (!this.prefs.getBoolPref("recent.show")) {
      this.recentList.hidden = true;
      return;
    }

    for (let element of this.recentList.querySelectorAll("a")) {
      this.recentList.removeChild(element);
    }

    let added = 0;
    let undoItems = JSON.parse(SessionStore.getClosedTabData(this.browserWindow));
    for (let i = 0; i < undoItems.length; i++) {
      let item = undoItems[i];
      let index = i;
      let iconURL;
      let url;

      if (item.image) {
        iconURL = item.image;
        if (/^https?:/.test(iconURL)) {
          iconURL = "moz-anno:favicon:" + iconURL;
        }
      } else {
        iconURL = "chrome://mozapps/skin/places/defaultFavicon.png";
      }

      let tabData = item.state;
      let activeIndex = (tabData.index || tabData.entries.length) - 1;
      if (activeIndex >= 0 && tabData.entries[activeIndex]) {
        url = tabData.entries[activeIndex].url;
        if (url == "about:newtab" && tabData.entries.length == 1) {
          continue;
        }
      }

      let a = document.createElementNS(HTML_NAMESPACE, "a");
      a.href = url;
      a.className = "recent";
      a.title = (item.title == url ? item.title : item.title + "\n" + url);
      a.onclick = function() {
        newTabTools.browserWindow.undoCloseTab(index);
        return false;
      }
      let img = document.createElementNS(HTML_NAMESPACE, "img");
      img.className = "favicon";
      img.src = iconURL;
      a.appendChild(img);
      a.appendChild(document.createTextNode(item.title));
      this.recentList.appendChild(a);
      added++;
    }
    this.trimRecent();
    this.recentList.hidden = !added;
  },
  trimRecent: function() {
    let width = this.recentListOuter.clientWidth;
    let elements = document.querySelectorAll(".recent");
    let hiding = false;

    for (let recent of elements) {
      recent.style.display = null;
    }
    for (let recent of elements) {
      if (hiding || recent.offsetLeft + recent.offsetWidth > width) {
        recent.style.display = "none";
        hiding = true;
      }
    }
  },
  onVisible: function() {
    this.startRecent();

    let oldVersion = newTabTools.prefs.getIntPref("donationreminder");
    let currentVersion = newTabTools.prefs.getIntPref("version");
    if (oldVersion > 0 && oldVersion < 24) {
      setTimeout(function() {
        let notifyBox = newTabTools.browserWindow.getNotificationBox(window);
        let label = newTabTools.strings.formatStringFromName("newversion", [currentVersion], 1);
        let value = "newtabtools-donate";
        let buttons = [{
          label: newTabTools.strings.GetStringFromName("donate.label"),
          accessKey: newTabTools.strings.GetStringFromName("donate.accesskey"),
          popup: null,
          callback: function() {
            let url = "https://addons.mozilla.org/addon/new-tab-tools/about";
            newTabTools.browserWindow.openLinkIn(url, "current", {});
          }
        }];
        newTabTools.prefs.setIntPref("donationreminder", currentVersion);
        notifyBox.appendNotification(label, value, null, notifyBox.PRIORITY_INFO_LOW, buttons);
      }, 1000)
    }
    this.onVisible = function() {};
  }
};

{
  function getTopWindow() {
    return window.QueryInterface(Ci.nsIInterfaceRequestor)
                 .getInterface(Ci.nsIWebNavigation)
                 .QueryInterface(Ci.nsIDocShellTreeItem)
                 .rootTreeItem
                 .QueryInterface(Ci.nsIInterfaceRequestor)
                 .getInterface(Ci.nsIDOMWindow)
                 .wrappedJSObject;
  }

  XPCOMUtils.defineLazyGetter(newTabTools, "browserWindow", function() {
    return getTopWindow();
  });

  XPCOMUtils.defineLazyGetter(newTabTools, "prefs", function() {
    return Services.prefs.getBranch("extensions.newtabtools.");
  });

  XPCOMUtils.defineLazyGetter(newTabTools, "strings", function() {
    return Services.strings.createBundle("chrome://newtabtools/locale/newTabTools.properties");
  });

  let uiElements = {
    "page": "newtab-scrollbox",
    "launcher": "launcher",
    "darkLauncherCheckbox": "config-darkLauncher",
    "configToggleButton": "config-toggle",
    "configWrapper": "config-wrapper",
    "configInner": "config-inner",
    "pinURLInput": "config-pinURL-input",
    "tileSelect": "config-select",
    "setThumbnailInput": "config-thumb-input",
    "setTitleInput": "config-title-input",
    "setBackgroundInput": "config-bg-input",
    "containThumbsCheckbox": "config-containThumbs",
    "overlapTitleCheckbox": "config-overlapTitle",
    "recentList": "newtab-recent",
    "recentListOuter": "newtab-recent-outer"
  };
  for (let key in uiElements) {
    let value = uiElements[key];
    XPCOMUtils.defineLazyGetter(newTabTools, key, function() {
      return document.getElementById(value);
    });
  }

  if (Services.appinfo.OS == "WINNT") {
    document.getElementById("settingsUnix").style.display = "none";
  } else {
    document.getElementById("settingsWin").style.display = "none";
  }

  let configButton = newTabTools.configToggleButton;
  configButton.addEventListener("click", newTabTools.toggleConfig.bind(newTabTools), false);

  let configInner = newTabTools.configInner;
  configInner.addEventListener("click", newTabTools.configOnClick.bind(newTabTools), false);
  newTabTools.tileSelect.addEventListener("command", newTabTools.onTileSelect.bind(newTabTools), false);

  newTabTools.launcher.addEventListener("click", newTabTools.launcherOnClick, false);

  newTabTools.refreshBackgroundImage();
  newTabTools.updateUI();

  newTabTools.preloaded = getTopWindow().location != "chrome://browser/content/browser.xul";
  if (!newTabTools.preloaded) {
    newTabTools.onVisible();
  }

  window.addEventListener("load", function window_load() {
    window.removeEventListener("load", window_load, false);

    SessionStore.promiseInitialized.then(function() {
      if (SessionStore.canRestoreLastSession && !PrivateBrowsingUtils.isWindowPrivate(window)) {
        newTabTools.launcher.setAttribute("session", "true");
        Services.obs.addObserver({
          observe: function() {
            newTabTools.launcher.removeAttribute("session");
          },
          QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference])
        }, "sessionstore-last-session-cleared", true);
      }
    });

    gTransformation.oldGetNodePosition = gTransformation.getNodePosition;
    gTransformation.getNodePosition = function(aNode) {
      let {offsetLeft, offsetTop} = document.getElementById("newtab-vertical-margin");
      let position = this.oldGetNodePosition(aNode);
      position.left -= offsetLeft;
      position.top -= offsetTop;
      return position;
    };

    gDrag.oldStart = gDrag.start;
    gDrag.start = function(aSite, aEvent) {
      gDrag.oldStart(aSite, aEvent);
      let {offsetLeft, offsetTop} = document.getElementById("newtab-vertical-margin");
      this._offsetX += offsetLeft;
      this._offsetY += offsetTop;
    };

    gDrag.drag = function(aSite, aEvent) {
      // Get the viewport size.
      let {clientWidth, clientHeight} = document.documentElement;
      let {offsetLeft, offsetTop} = document.getElementById("newtab-vertical-margin");

      // We'll want a padding of 5px.
      let border = 5;

      // Enforce minimum constraints to keep the drag image inside the window.
      let left = Math.max(scrollX + aEvent.clientX - this._offsetX, border - offsetLeft);
      let top = Math.max(scrollY + aEvent.clientY - this._offsetY, border - offsetTop);

      // Enforce maximum constraints to keep the drag image inside the window.
      left = Math.min(left, scrollX + clientWidth - this.cellWidth - border - offsetLeft);
      top = Math.min(top, scrollY + clientHeight - this.cellHeight - border - offsetTop);

      // Update the drag image's position.
      gTransformation.setSitePosition(aSite, {left: left, top: top});
    };

    Site.prototype._oldRender = Site.prototype._render;
    Site.prototype._render = function() {
      this._oldRender();
      this._addTitleAndFavicon();
    };
    Site.prototype._addTitleAndFavicon = function() {
      let titleElement = this.node.querySelector(".newtab-title");
      let uri = Services.io.newURI(this.url, null, null);

      try {
        this._annoTitle = annoService.getPageAnnotation(uri, "newtabtools/title");
        titleElement.textContent = this._annoTitle;
      } catch(e) {
      }

      faviconService.getFaviconURLForPage(uri, function(aURI) {
        if (!aURI)
          return;

        let icon;
        if (titleElement.firstChild.nodeType == Node.ELEMENT_NODE) {
          // This shouldn't happen, but sometimes it does.
          icon = titleElement.firstChild;
        } else {
          icon = document.createElementNS(HTML_NAMESPACE, "img");
        }
        icon.src = "moz-anno:favicon:" + aURI.spec;
        icon.className = "favicon";
        titleElement.insertBefore(icon, titleElement.firstChild);
      });
    };

    gLinks.populateCache(function() {
      for (let cell of gGrid.cells) {
        if (cell.site)
          cell.site._addTitleAndFavicon();
      }
    }, false);

    gUndoDialog.oldHide = gUndoDialog.hide;
    gUndoDialog.hide = function() {
      gUndoDialog.oldHide();
      newTabTools.trimRecent();
    }
  }, false);
}
