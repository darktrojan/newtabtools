let newTabTools = {
  /*get domStorage() {
    let uri = Services.io.newURI("about:newtab", null, null);
    let principal = Services.scriptSecurityManager.getCodebasePrincipal(uri);

    let sm = Services.domStorageManager;
    let storage = sm.getLocalStorageForPrincipal(principal, "");

    // Cache this value, overwrite the getter.
    let descriptor = {value: storage, enumerable: true};
    Object.defineProperty(this, "domStorage", descriptor);

    return storage;
  },*/
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
  configOnClick: function(event) {
    switch (event.originalTarget.id) {
    case "config-browseForFile":
      let fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      fp.init(window, document.title, Ci.nsIFilePicker.modeOpen);
      fp.appendFilters(Ci.nsIFilePicker.filterImages);
      if (fp.show() == Ci.nsIFilePicker.returnOK)
        this.setThumbnailInput.value = fp.fileURL.spec;
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
      let name = cell.site.title || cell.site.url;
      let description = !cell.site.title ? null : cell.site.url;
      this.tileSelect.appendItem(name, cell.site.url, description);
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

  let rows = Services.prefs.getIntPref("extensions.newtabtools.rows");
  let columns = Services.prefs.getIntPref("extensions.newtabtools.columns");
  let HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

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

  let configButton = newTabTools.configToggleButton;
  configButton.addEventListener("click", newTabTools.toggleConfig.bind(newTabTools), false);

  let configInner = document.getElementById("config-inner");
  configInner.addEventListener("click", newTabTools.configOnClick.bind(newTabTools), false);

  let showLauncher = Services.prefs.getIntPref("extensions.newtabtools.launcher");
  let launcher = document.getElementById("launcher");
  if (showLauncher == 3) {
    launcher.addEventListener("click", newTabTools.launcherOnClick, false);
    document.documentElement.classList.add("launcherBottom");
  }
}
