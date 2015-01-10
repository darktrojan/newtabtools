const EXPORTED_SYMBOLS = ["TileData", "SavedThumbs"];
const PREF = "extensions.newtabtools.tiledata";

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "FileUtils", "resource://gre/modules/FileUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "OS", "resource://gre/modules/osfile.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PageThumbs", "resource://gre/modules/PageThumbs.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PageThumbsStorage", "resource://gre/modules/PageThumbs.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Promise", "resource://gre/modules/Promise.jsm");

function notifyTileChanged(url, key) {
  let urlString = Components.classes["@mozilla.org/supports-string;1"]
    .createInstance(Components.interfaces.nsISupportsString);
  urlString.data = url;
  Services.obs.notifyObservers(urlString, "newtabtools-change", key);
}

let TileData = {
  _data: new Map(),
  get: function(url, key) {
    if (this._data.has(url)) {
      return this._data.get(url).get(key) || null;
    }
    return null;
  },
  set: function(url, key, value) {
    let urlData = this._data.get(url) || new Map();

    if (value === null) {
      urlData.delete(key);
      if (urlData.size == 0) {
        this._data.delete(url);
      }
    } else {
      urlData.set(key, value);
      if (!this._data.has(url)) {
        this._data.set(url, urlData);
      }
    }

    notifyTileChanged(url, key);
    this._setPref();
  },
  _getPref: function() {
    try {
      let value = Services.prefs.getCharPref(PREF);
      let json = JSON.parse(value);
      for (let [url, urlData] in Iterator(json)) {
        this._data.set(url, new Map(Iterator(urlData)));
      }
    } catch(e) {
      Components.utils.reportError(e);
    }
  },
  _setPref: function() {
    let obj = {};
    for (let [url, urlData] of this._data.entries()) {
      obj[url] = {};
      for (let [key, value] of urlData.entries()) {
        obj[url][key] = value;
      }
    }
    Services.prefs.setCharPref(PREF, JSON.stringify(obj));
  }
};
TileData._getPref();

let SavedThumbs = {
  _ready: false,
  _list: new Set(),
  getThumbnailURL: function(url) {
    let deferred = Promise.defer();
    this._readDir().then(() => {
      let leafName = this.getThumbnailLeafName(url);
      if (this.hasSavedThumb(url, leafName)) {
        let path = this.getThumbnailPath(url, leafName)
        deferred.resolve(Services.io.newFileURI(new FileUtils.File(path)).spec + "?" + Math.random());
      } else {
        deferred.resolve(PageThumbs.getThumbnailURL(url) + "&" + Math.random());
      }
    });
    return deferred.promise;
  },
  getThumbnailLeafName: function(url) {
    return PageThumbsStorage.getLeafNameForURL(url);
  },
  getThumbnailPath: function(url, leafName=this.getThumbnailLeafName(url)) {
    return OS.Path.join(OS.Constants.Path.profileDir, "newtab-savedthumbs", leafName);
  },
  // These functions assume _readDir has already been called.
  addSavedThumb: function(url, leafName=this.getThumbnailLeafName(url)) {
    this._list.add(leafName);
    notifyTileChanged(url, "thumbnail");
  },
  hasSavedThumb: function(url, leafName=this.getThumbnailLeafName(url)) {
    return this._list.has(leafName);
  },
  removeSavedThumb: function(url, leafName=this.getThumbnailLeafName(url)) {
    this._list.delete(leafName);
    notifyTileChanged(url, "thumbnail");
  },
  _readDir: function() {
    let deferred = Promise.defer();
    if (this.ready) {
      deferred.resolve();
    }
    let thumbDir = OS.Path.join(OS.Constants.Path.profileDir, "newtab-savedthumbs");
    let iterator = new OS.File.DirectoryIterator(thumbDir);
    iterator.forEach((entry) => {
      this._list.add(entry.name)
    }).then(() => {
      iterator.close();
      this.ready = true;
      deferred.resolve();
    });
    return deferred.promise;
  }
};
