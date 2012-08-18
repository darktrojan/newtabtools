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
  get page() {
    return document.getElementById("newtab-scrollbox");
  },
  get backgroundImageFile() {
    return FileUtils.getFile("ProfD", ["newtab-background"], true);
  },
  get backgroundImageURL() {
    Components.utils.import("resource://gre/modules/Services.jsm");
    return Services.io.newFileURI(this.backgroundImageFile);
  },
  get launcher() {
    return document.getElementById("launcher");
  },
  get darkLauncherCheckbox() {
    return document.getElementById("config-darkLauncher");
  },
  refreshBackgroundImage: function() {
    if (this.backgroundImageFile.exists()) {
      this.page.style.backgroundImage =
        'url("' + this.backgroundImageURL.spec + '?' + Math.random() + '")';
      document.documentElement.classList.add("background");
    } else {
      this.page.style.backgroundImage = null;
      document.documentElement.classList.remove("background");
    }
  },
  get configToggleButton() {
    return document.getElementById("config-toggle");
  },
  get configWrapper() {
    return document.getElementById("config-wrapper");
  },
  get tileSelect() {
    return document.getElementById("config-select");
  },
  get setThumbnailInput() {
    return document.getElementById("config-input");
  },
  get setBackgroundInput() {
    return document.getElementById("config-bg-input");
  },
  get containThumbsCheckbox() {
    return document.getElementById("config-containThumbs");
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
      Services.prefs.setBoolPref("extensions.newtabtools.thumbs.contain", checked);
      if (checked) {
        document.documentElement.classList.add("containThumbs");
      } else {
        document.documentElement.classList.remove("containThumbs");
      }
      break;
    case "config-setBackground":
      let fos = FileUtils.openSafeFileOutputStream(this.backgroundImageFile);
      NetUtil.asyncFetch(this.setBackgroundInput.value, function(inputStream, status) {
        if (!Components.isSuccessCode(status)) {
          return;
        }
        NetUtil.asyncCopy(inputStream, fos, function (aResult) {
          FileUtils.closeSafeFileOutputStream(fos);
          this.refreshBackgroundImage();
        }.bind(this));
      }.bind(this));
      break;
    case "config-removeBackground":
      this.backgroundImageFile.remove(true);
      this.refreshBackgroundImage();
      break;
    case "config-darkLauncher":
      checked = event.originalTarget.checked;
      Services.prefs.setBoolPref("extensions.newtabtools.launcher.dark", checked);
      if (checked) {
        this.launcher.classList.add("dark");
      } else {
        this.launcher.classList.remove("dark");
      }
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
    if ('PageThumbsStorage' in window) {
      let file = PageThumbsStorage.getFileForURL(aURL);
      if (file.exists()) {
        file.permissions = 0644;
        file.remove(true);
      }
      return;
    }

    PageThumbsCache.getWriteEntry(aURL, function (aEntry) {
      if (!aEntry)
        return;

      aEntry.doom();
    });
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
        if ('PageThumbsStorage' in window) {
          PageThumbsStorage.write(aURL, aInputStream, function(aSuccessful) {
            let file = PageThumbsStorage.getFileForURL(aURL);
            file.permissions = 0444;
            if (aCallback)
              aCallback(aSuccessful);
          });
          return;
        }

        PageThumbsCache.getWriteEntry(aURL, function (aEntry) {
          if (!aEntry) {
            if (aCallback)
              aCallback(false);
            return;
          }

          let outputStream = aEntry.openOutputStream(0);

          // Write the image data to the cache entry.
          NetUtil.asyncCopy(aInputStream, outputStream, function (aResult) {
            let success = Components.isSuccessCode(aResult);
            if (success)
              aEntry.markValid();
            aEntry.close();

            if (aCallback)
              aCallback(success);
          });
        });
      }, "image/png");
    }
    image.src = aSrc;
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

  newTabTools.refreshBackgroundImage();

  let rows = Services.prefs.getIntPref("extensions.newtabtools.rows");
  let columns = Services.prefs.getIntPref("extensions.newtabtools.columns");
  let HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

  if (Services.prefs.getPrefType("browser.newtabpage.rows") ==
      Components.interfaces.nsIPrefBranch.PREF_INVALID) {
    let grid = document.getElementById("newtab-grid");
    for (let i = 0; i < rows; i++) {
      let row = document.createElementNS(HTML_NAMESPACE, "div");
      row.className = "newtab-row";
      for (let j = 0; j < columns; j++) {
        let cell = document.createElementNS(HTML_NAMESPACE, "div");
        cell.className = "newtab-cell";
        row.appendChild(cell);
      }
      grid.appendChild(row);
    }
  }

  let configButton = newTabTools.configToggleButton;
  configButton.addEventListener("click", newTabTools.toggleConfig.bind(newTabTools), false);

  let configInner = document.getElementById("config-inner");
  configInner.addEventListener("click", newTabTools.configOnClick.bind(newTabTools), false);

  let showLauncher = Services.prefs.getIntPref("extensions.newtabtools.launcher");
  if (showLauncher == 3) {
    newTabTools.launcher.addEventListener("click", newTabTools.launcherOnClick, false);
    document.documentElement.classList.add("launcherBottom");
    if (Services.prefs.getBoolPref("extensions.newtabtools.launcher.dark")) {
      newTabTools.launcher.classList.add("dark");
      newTabTools.darkLauncherCheckbox.checked = true;
    }
  }

  if (Services.prefs.getBoolPref("extensions.newtabtools.thumbs.contain")) {
    document.documentElement.classList.add("containThumbs");
    newTabTools.containThumbsCheckbox.checked = true;
  }
}
