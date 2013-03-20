/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at http://mozilla.org/MPL/2.0/.
*/
Components.utils.import("resource://gre/modules/FileUtils.jsm");
Components.utils.import("resource://gre/modules/NetUtil.jsm");

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
    case "settings":
      newTabTools.browserWindow.openPreferences();
      break;
    }
  },
  get backgroundImageFile() {
    return FileUtils.getFile("ProfD", ["newtab-background"], true);
  },
  get backgroundImageURL() {
    Components.utils.import("resource://gre/modules/Services.jsm");
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
    switch (id) {
    case "config-browseForFile":
    case "config-bg-browseForFile":
      let fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      fp.init(window, document.title, Ci.nsIFilePicker.modeOpen);
      fp.appendFilters(Ci.nsIFilePicker.filterImages);
      if (fp.show() == Ci.nsIFilePicker.returnOK) {
        let input = id == "config-browseForFile" ? this.setThumbnailInput : this.setBackgroundInput;
        input.value = fp.fileURL.spec;
      }
      break;
    case "config-setThumbnail":
      this.setThumbnail(this.tileSelect.value, this.setThumbnailInput.value, function() {
        newTabTools.refreshThumbnail(this.tileSelect.value);
      }.bind(this));
      break;
    case "config-removeThumbnail":
      this.removeThumbnail(this.tileSelect.value);
      newTabTools.refreshThumbnail(this.tileSelect.value);
      break;
    case "config-containThumbs":
      checked = event.originalTarget.checked;
      this.prefs.setBoolPref("thumbs.contain", checked);
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
    }
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
        let name = cell.site.title || cell.site.url;
        let description = !cell.site.title ? null : cell.site.url;
        this.tileSelect.appendItem(name, cell.site.url, description);
      }
    }
    this.tileSelect.selectedIndex = 0;
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
  removeThumbnail: function(aURL) {
    let file = PageThumbsStorage.getFileForURL(aURL);
    if (file.exists()) {
      file.permissions = 0644;
      file.remove(true);
    }
  },
  setThumbnail: function(aURL, aSrc, aCallback) {
    this.removeThumbnail(aURL);

    let image = new Image();
    image.onload = function() {
      let sw = image.width;
      let sh = image.height;
      let [thumbnailWidth, thumbnailHeight] = PageThumbs._getThumbnailSize();
      let scale = Math.max(thumbnailWidth / sw, thumbnailHeight / sh);

      let canvas = PageThumbs._createCanvas();
      let ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);
      ctx.drawImage(image, 0, 0);

      canvas.mozFetchAsStream(function(aInputStream) {
        PageThumbsStorage.write(aURL, aInputStream, function(aSuccessful) {
          let file = PageThumbsStorage.getFileForURL(aURL);
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
      this.annoService.setPageAnnotation(uri, "newtabtools/title",
        this.setTitleInput.value, 0, this.annoService.EXPIRE_WITH_HISTORY);
    } else {
      this.annoService.removePageAnnotation(uri, "newtabtools/title");
      aTitle = site.title;
    }
    let titleElement = site.node.querySelector(".newtab-title");
    titleElement.lastChild.nodeValue = aTitle;
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

    let hideButtons = this.prefs.getBoolPref("thumbs.hidebuttons");
    document.documentElement.classList[hideButtons ? "add" : "remove"]("hideButtons");

    let hideFavicons = this.prefs.getBoolPref("thumbs.hidefavicons");
    document.documentElement.classList[hideFavicons ? "add" : "remove"]("hideFavicons");
  }
};

{
  Components.utils.import("resource://gre/modules/Services.jsm");
  Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

  XPCOMUtils.defineLazyGetter(newTabTools, "browserWindow", function() {
    return window.QueryInterface(Ci.nsIInterfaceRequestor)
                 .getInterface(Ci.nsIWebNavigation)
                 .QueryInterface(Ci.nsIDocShellTreeItem)
                 .rootTreeItem
                 .QueryInterface(Ci.nsIInterfaceRequestor)
                 .getInterface(Ci.nsIDOMWindow)
                 .wrappedJSObject;
  });

  XPCOMUtils.defineLazyGetter(newTabTools, "prefs", function() {
    return Services.prefs.getBranch("extensions.newtabtools.");
  });

  XPCOMUtils.defineLazyGetter(newTabTools, "faviconService", function() {
    return Components.classes["@mozilla.org/browser/favicon-service;1"]
                     .getService(Ci.mozIAsyncFavicons);
  });

  XPCOMUtils.defineLazyGetter(newTabTools, "annoService", function() {
    return Components.classes["@mozilla.org/browser/annotation-service;1"]
                     .getService(Components.interfaces.nsIAnnotationService);
  });

  let uiElements = {
    "page": "newtab-scrollbox",
    "launcher": "launcher",
    "darkLauncherCheckbox": "config-darkLauncher",
    "configToggleButton": "config-toggle",
    "configWrapper": "config-wrapper",
    "configInner": "config-inner",
    "tileSelect": "config-select",
    "setThumbnailInput": "config-thumb-input",
    "setTitleInput": "config-title-input",
    "setBackgroundInput": "config-bg-input",
    "containThumbsCheckbox": "config-containThumbs"
  };
  for (let key in uiElements) {
    let value = uiElements[key];
    XPCOMUtils.defineLazyGetter(newTabTools, key, function() {
      return document.getElementById(value);
    });
  }

  let configButton = newTabTools.configToggleButton;
  configButton.addEventListener("click", newTabTools.toggleConfig.bind(newTabTools), false);

  let configInner = newTabTools.configInner;
  configInner.addEventListener("click", newTabTools.configOnClick.bind(newTabTools), false);

  newTabTools.launcher.addEventListener("click", newTabTools.launcherOnClick, false);

  newTabTools.refreshBackgroundImage();
  newTabTools.updateUI();

  window.addEventListener("load", function window_load() {
    window.removeEventListener("load", window_load, false);

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
        let title = newTabTools.annoService.getPageAnnotation(uri, "newtabtools/title");
        titleElement.textContent = title;
      } catch(e) {
      }

      newTabTools.faviconService.getFaviconURLForPage(uri, function(aURI) {
        if (!aURI)
          return;

        let icon = document.createElementNS(HTML_NAMESPACE, "img");
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

    let oldVersion = newTabTools.prefs.getIntPref("donationreminder");
    let currentVersion = newTabTools.prefs.getIntPref("version");
    if (oldVersion > 0 && oldVersion < 7) {
      setTimeout(function() {
        let notifyBox = newTabTools.browserWindow.getNotificationBox(window);
        let label = "New Tab Tools has been updated to version " + currentVersion + ". " +
            "Please consider making a donation.";
        let value = "newtabtools-donate";
        let buttons = [{
          label: "Donate",
          accessKey: "D",
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

  }, false);
}
