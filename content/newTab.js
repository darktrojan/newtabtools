/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at http://mozilla.org/MPL/2.0/.
*/
/* globals Services, XPCOMUtils, FileUtils, NetUtil, SessionStore, OS, PageThumbs, PageThumbsStorage,
    PageThumbUtils, PlacesUtils, PrivateBrowsingUtils, SavedThumbs, TileData, HTML_NAMESPACE,
    gPinnedLinks, gBlockedLinks, gTransformation, gGridPrefs, gGrid, gDrag, gUpdater, gUndoDialog */

let { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "FileUtils", "resource://gre/modules/FileUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "NetUtil", "resource://gre/modules/NetUtil.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "SessionStore", "resource:///modules/sessionstore/SessionStore.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "OS", "resource://gre/modules/osfile.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PageThumbUtils", "resource://gre/modules/PageThumbUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PlacesUtils", "resource://gre/modules/PlacesUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "SavedThumbs", "chrome://newtabtools/content/newTabTools.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "TileData", "chrome://newtabtools/content/newTabTools.jsm");

XPCOMUtils.defineLazyServiceGetter(this, "faviconService", "@mozilla.org/browser/favicon-service;1", "mozIAsyncFavicons");

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
  get selectedSite() {
    return gGrid.sites[this._selectedSiteIndex];
  },
  optionsOnClick: function(event) {
    if (event.originalTarget.disabled) {
      return;
    }
    let id = event.originalTarget.id;
    switch (id) {
    case "options-pinURL":
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
    case "options-previous-row-tile":
      this.selectedSiteIndex = (this._selectedSiteIndex - gGridPrefs.gridColumns + gGrid.cells.length) % gGrid.cells.length;
      break;
    case "options-previous-tile":
    case "options-next-tile":
      let columns = gGridPrefs.gridColumns;
      let row = Math.floor(this._selectedSiteIndex / columns);
      let column = (this._selectedSiteIndex + (id == "options-previous-tile" ? -1 : 1) + columns) % columns;

      this.selectedSiteIndex = row * columns + column;
      break;
    case "options-next-row-tile":
      this.selectedSiteIndex = (this._selectedSiteIndex + gGridPrefs.gridColumns) % gGrid.cells.length;
      break;
    case "options-thumbnail-browse":
    case "options-bg-browse":
      let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      fp.init(window, document.title, Ci.nsIFilePicker.modeOpen);
      fp.appendFilters(Ci.nsIFilePicker.filterImages);
      if (fp.show() == Ci.nsIFilePicker.returnOK) {
        if (id == "options-thumbnail-browse") {
          this.setThumbnailInput.value = fp.fileURL.spec;
          newTabTools.setThumbnailButton.disabled = false;
        } else {
          this.setBackgroundInput.value = fp.fileURL.spec;
          newTabTools.setBackgroundButton.disabled = false;
        }
      }
      break;
    case "options-thumbnail-set":
      this.setThumbnail(this.selectedSite, this.setThumbnailInput.value);
      break;
    case "options-thumbnail-remove":
      this.setThumbnail(this.selectedSite, null);
      break;
    case "options-thumbnail-refresh":
      event.originalTarget.disabled = true;
      SavedThumbs.forceReloadThumbnail(this.selectedSite.url).then(function() {
        event.originalTarget.disabled = false;
      });
      break;
    case "options-bgcolor-displaybutton":
      this.setBgColourInput.click();
      break;
    case "options-bgcolor-set":
      TileData.set(this.selectedSite.url, "backgroundColor", this.setBgColourInput.value);
      this.siteThumbnail.style.backgroundColor = this.setBgColourInput.value;
      this.resetBgColourButton.disabled = false;
      break;
    case "options-bgcolor-reset":
      TileData.set(this.selectedSite.url, "backgroundColor", null);
      this.siteThumbnail.style.backgroundColor =
        this.setBgColourInput.value =
        this.setBgColourDisplay.style.backgroundColor = null;
      this.setBgColourButton.disabled =
        this.resetBgColourButton.disabled = true;
      break;
    case "options-title-set":
      this.setTitle(this.selectedSite, this.setTitleInput.value);
      break;
    case "options-title-reset":
      this.setTitle(this.selectedSite, null);
      break;
    case "options-bg-set":
      if (this.setBackgroundInput.value) {
        let fos = FileUtils.openSafeFileOutputStream(this.backgroundImageFile);
        NetUtil.asyncFetch(this.setBackgroundInput.value, function(inputStream, status) {
          if (!Components.isSuccessCode(status)) {
            return;
          }
          NetUtil.asyncCopy(inputStream, fos, function() {
            FileUtils.closeSafeFileOutputStream(fos);
            Services.obs.notifyObservers(null, "newtabtools-change", "background");
          }.bind(this));
        }.bind(this));
      }
      break;
    case "options-bg-remove":
      if (this.backgroundImageFile.exists())
        this.backgroundImageFile.remove(true);
      Services.obs.notifyObservers(null, "newtabtools-change", "background");
      break;
    case "options-donate":
      let url = "https://addons.mozilla.org/addon/new-tab-tools/about";
      newTabTools.browserWindow.openLinkIn(url, "current", {});
      break;
    }
  },
  pinURL: function(link, title) {
    let index = gGrid.sites.length - 1;
    for (var i = 0; i < gGrid.sites.length; i++) {
      let s = gGrid.sites[i];
      if (s && !s.isPinned()) {
        index = i;
        break;
      }
    }

    gBlockedLinks.unblock(link);
    gPinnedLinks.pin({url: link, title: title}, index);
    gUpdater.updateGrid();
  },
  onTileChanged: function(url, whatChanged) {
    for (let site of gGrid.sites) {
      if (site.url == url) {
        switch (whatChanged) {
        case "backgroundColor":
          site._querySelector(".newtab-thumbnail").style.backgroundColor = TileData.get(url, "backgroundColor");
          break;
        case "thumbnail":
          site.refreshThumbnail();
          this.selectedSiteIndex = this._selectedSiteIndex;
          break;
        case "title":
          site._addTitleAndFavicon();
          break;
        }
      }
    }
  },
  setThumbnail: function(site, src) {
    let leafName = SavedThumbs.getThumbnailLeafName(site.url);
    let path = SavedThumbs.getThumbnailPath(site.url, leafName);
    let file = FileUtils.File(path);
    let existed = SavedThumbs.hasSavedThumb(site.url, leafName);
    if (existed) {
      file.permissions = 0644;
      file.remove(true);
    }

    if (!src) {
      if (!existed) {
        path = PageThumbsStorage.getFilePathForURL(site.url);
        file = FileUtils.File(path);
        if (file.exists()) {
          file.permissions = 0644;
          file.remove(true);
        }
      }

      SavedThumbs.removeSavedThumb(site.url, leafName);
      this.removeThumbnailButton.blur();
      return;
    }

    let image = new Image();
    image.onload = function() {
      let [thumbnailWidth, thumbnailHeight] = "_getThumbnailSize" in PageThumbs ? PageThumbs._getThumbnailSize() : PageThumbUtils.getThumbnailSize();
      let scale = Math.max(thumbnailWidth / image.width, thumbnailHeight / image.height);

      let canvas = document.createElementNS(HTML_NAMESPACE, "canvas");
      canvas.mozOpaque = false;
      canvas.mozImageSmoothingEnabled = true;
      canvas.width = image.width * scale;
      canvas.height = image.height * scale;
      let ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      canvas.mozFetchAsStream(function(aInputStream) {
        let outputStream = FileUtils.openSafeFileOutputStream(file);
        NetUtil.asyncCopy(aInputStream, outputStream, function() {
          FileUtils.closeSafeFileOutputStream(outputStream);
          SavedThumbs.addSavedThumb(site.url, leafName);
        });
      }, "image/png");
    };
    image.src = src;
  },
  setTitle: function(site, title) {
    TileData.set(site.url, "title", title);
    this.resetTitleButton.disabled = !title;
    if (!title) {
      this.setTitleInput.value = site.title;
      this.resetTitleButton.blur();
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
      this.removeBackgroundButton.disabled = false;
    } else {
      this.page.style.backgroundImage = null;
      document.documentElement.classList.remove("background");
      this.removeBackgroundButton.disabled = true;
      this.removeBackgroundButton.blur();
    }
  },
  updateUI: function() {
    let launcherPosition = this.prefs.getIntPref("launcher");
    if (launcherPosition) {
      let positionNames = ["top", "right", "bottom", "left"];
      document.documentElement.setAttribute("launcher", positionNames[launcherPosition - 1]);
    } else {
      document.documentElement.removeAttribute("launcher");
    }

    let theme = this.prefs.getCharPref("theme");
    document.documentElement.setAttribute("theme", theme);

    let containThumbs = this.prefs.getBoolPref("thumbs.contain");
    document.documentElement.classList[containThumbs ? "add" : "remove"]("containThumbs");

    let hideButtons = this.prefs.getBoolPref("thumbs.hidebuttons");
    document.documentElement.classList[hideButtons ? "add" : "remove"]("hideButtons");

    let hideFavicons = this.prefs.getBoolPref("thumbs.hidefavicons");
    document.documentElement.classList[hideFavicons ? "add" : "remove"]("hideFavicons");

    let titleSize = this.prefs.getCharPref("thumbs.titlesize");
    document.documentElement.setAttribute("titlesize", titleSize);

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
      };
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
    if (!this.prefs.getBoolPref("optionspointershown")) {
      this.optionsTogglePointer.hidden = false;
      this.optionsTogglePointer.style.animationPlayState = "running";
    }
    this.onVisible = function() {};
  },
  set selectedSiteIndex(index) {
    this._selectedSiteIndex = index;
    let site = this.selectedSite;
    let disabled = site == null;

    this.browseThumbnailButton.disabled = disabled;
    this.setThumbnailInput.value = "";
    this.setThumbnailInput.disabled = disabled;
    this.setTitleInput.disabled = disabled;
    this.setTitleButton.disabled = disabled;

    if (disabled) {
      this.siteThumbnail.style.backgroundImage = null;
      this.removeThumbnailButton.disabled = true;
      this.siteURL.value = "";
      this.setTitleInput.value = "";
      this.resetTitleButton.disabled = true;
      return;
    }

    SavedThumbs.getThumbnailURL(site.url).then((thumbnail) => {
      this.siteThumbnail.style.backgroundImage = 'url("' + thumbnail + '")';
      if (thumbnail.startsWith("file:")) {
        this.removeThumbnailButton.disabled = false;
        this.captureThumbnailButton.disabled = true;
      } else {
        OS.File.exists(PageThumbsStorage.getFilePathForURL(site.url)).then((exists) => {
          this.removeThumbnailButton.disabled = !exists;
          this.captureThumbnailButton.disabled = false;
        });
      }
    });
    this.siteURL.value = site.url;
    let backgroundColor = TileData.get(site.url, "backgroundColor");
    this.siteThumbnail.style.backgroundColor =
      this.setBgColourInput.value =
      this.setBgColourDisplay.style.backgroundColor = backgroundColor;
    this.setBgColourButton.disabled =
      this.resetBgColourButton.disabled = !backgroundColor;
    let title = TileData.get(site.url, "title");
    this.setTitleInput.value = title || site.title || site.url;
    this.resetTitleButton.disabled = title === null;
  },
  toggleOptions: function() {
    if (document.documentElement.hasAttribute("options-hidden")) {
      this.optionsTogglePointer.hidden = true;
      this.prefs.setBoolPref("optionspointershown", true);
      document.documentElement.removeAttribute("options-hidden");
      this.selectedSiteIndex = 0;
    } else {
      this.hideOptions();
    }
  },
  hideOptions: function() {
    document.documentElement.setAttribute("options-hidden", "true");
  }
};

(function() {
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
    "optionsToggleButton": "options-toggle",
    "optionsTogglePointer": "options-toggle-pointer",
    "pinURLInput": "options-pinURL-input",
    "siteThumbnail": "options-thumbnail",
    "siteURL": "options-url",
    "browseThumbnailButton": "options-thumbnail-browse",
    "setThumbnailInput": "options-thumbnail-input",
    "setThumbnailButton": "options-thumbnail-set",
    "removeThumbnailButton": "options-thumbnail-remove",
    "captureThumbnailButton": "options-thumbnail-refresh",
    "setBgColourInput": "options-bgcolor-input",
    "setBgColourDisplay": "options-bgcolor-display",
    "setBgColourButton": "options-bgcolor-set",
    "resetBgColourButton": "options-bgcolor-reset",
    "setTitleInput": "options-title-input",
    "resetTitleButton": "options-title-reset",
    "setTitleButton": "options-title-set",
    "setBackgroundInput": "options-bg-input",
    "setBackgroundButton": "options-bg-set",
    "removeBackgroundButton": "options-bg-remove",
    "recentList": "newtab-recent",
    "recentListOuter": "newtab-recent-outer",
    "optionsBackground": "options-bg",
    "optionsPane": "options"
  };
  for (let key in uiElements) {
    let value = uiElements[key];
    XPCOMUtils.defineLazyGetter(newTabTools, key, () => document.getElementById(value));
  }

  if (Services.appinfo.OS == "WINNT") {
    document.getElementById("settingsUnix").style.display = "none";
    newTabTools.optionsToggleButton.title = document.getElementById("settingsWin").textContent;
  } else {
    document.getElementById("settingsWin").style.display = "none";
    newTabTools.optionsToggleButton.title = document.getElementById("settingsUnix").textContent;
  }

  newTabTools.optionsToggleButton.addEventListener("click", newTabTools.toggleOptions.bind(newTabTools), false);
  newTabTools.optionsPane.addEventListener("click", newTabTools.optionsOnClick.bind(newTabTools), false);
  newTabTools.launcher.addEventListener("click", newTabTools.launcherOnClick, false);
  newTabTools.setThumbnailInput.addEventListener("keyup", function() {
    newTabTools.setThumbnailButton.disabled = !/^(file|ftp|http|https):\/\//.exec(this.value);
  });
  newTabTools.setBgColourInput.addEventListener("change", function() {
    newTabTools.setBgColourDisplay.style.backgroundColor = this.value;
    newTabTools.setBgColourButton.disabled = false;
  });
  newTabTools.setBackgroundInput.addEventListener("keyup", function() {
    newTabTools.setBackgroundButton.disabled = !/^(file|ftp|http|https):\/\//.exec(this.value);
  });
  window.addEventListener("keypress", function(event) {
    if (event.keyCode == 27) {
      newTabTools.hideOptions();
    }
  });

  newTabTools.refreshBackgroundImage();
  newTabTools.updateUI();

  newTabTools.preloaded = document.visibilityState == "hidden";
  if (!newTabTools.preloaded) {
    newTabTools.onVisible();
  }

  window.addEventListener("load", function window_load() {
    window.removeEventListener("load", window_load, false);

    SessionStore.promiseInitialized.then(function() {
      if (SessionStore.canRestoreLastSession && !PrivateBrowsingUtils.isContentWindowPrivate(window)) {
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
      let left = Math.max(aEvent.clientX - this._offsetX, border - offsetLeft);
      let top = Math.max(aEvent.clientY - this._offsetY, border - offsetTop);

      // Enforce maximum constraints to keep the drag image inside the window.
      left = Math.min(left, clientWidth - this.cellWidth - border - offsetLeft);
      top = Math.min(top, clientHeight - this.cellHeight - border - offsetTop);

      // Update the drag image's position.
      gTransformation.setSitePosition(aSite, {left: left, top: top});
    };

    gUndoDialog.oldHide = gUndoDialog.hide;
    gUndoDialog.hide = function() {
      gUndoDialog.oldHide();
      newTabTools.trimRecent();
    };
  }, false);
})();
