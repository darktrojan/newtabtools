/* exported BackgroundImage, TileData, SavedThumbs */
this.EXPORTED_SYMBOLS = ["BackgroundImage", "TileData", "SavedThumbs"];
const XHTMLNS = "http://www.w3.org/1999/xhtml";

/* globals Components, Services, XPCOMUtils, Iterator */
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

/* globals BackgroundPageThumbs, FileUtils, NewTabUtils, OS, PageThumbs, PageThumbsStorage */
XPCOMUtils.defineLazyModuleGetter(this, "BackgroundPageThumbs", "resource://gre/modules/BackgroundPageThumbs.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "FileUtils", "resource://gre/modules/FileUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "NewTabUtils", "resource://gre/modules/NewTabUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "OS", "resource://gre/modules/osfile.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PageThumbs", "resource://gre/modules/PageThumbs.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PageThumbsStorage", "resource://gre/modules/PageThumbs.jsm");

/* globals idleService */
XPCOMUtils.defineLazyServiceGetter(this, "idleService", "@mozilla.org/widget/idleservice;1", "nsIIdleService");

function notifyTileChanged(url, key) {
  let urlString = Components.classes["@mozilla.org/supports-string;1"]
    .createInstance(Components.interfaces.nsISupportsString);
  urlString.data = url;
  Services.obs.notifyObservers(urlString, "newtabtools-change", key);
}

let TileData = {
  PREF: "extensions.newtabtools.tiledata",
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
      let value = Services.prefs.getCharPref(TileData.PREF);
      let json = JSON.parse(value);
      for (let [url, urlData] in Iterator(json)) {
        this._data.set(url, new Map(Iterator(urlData)));
      }
    } catch (e) {
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
    Services.prefs.setCharPref(TileData.PREF, JSON.stringify(obj));
  }
};
TileData._getPref();

let SavedThumbs = {
  _ready: false,
  _list: new Set(),
  getThumbnailURL: function(url) {
    return this._readDir().then(() => {
      let leafName = this.getThumbnailLeafName(url);
      if (this.hasSavedThumb(url, leafName)) {
        let path = this.getThumbnailPath(url, leafName);
        return Services.io.newFileURI(new FileUtils.File(path)).spec + "?" + Math.random();
      } else {
        return PageThumbs.getThumbnailURL(url) + "&" + Math.random();
      }
    });
  },
  get thumbnailDirectory() {
    return OS.Path.join(OS.Constants.Path.profileDir, "newtab-savedthumbs");
  },
  getThumbnailLeafName: function(url) {
    return PageThumbsStorage.getLeafNameForURL(url);
  },
  getThumbnailPath: function(url, leafName=this.getThumbnailLeafName(url)) {
    return OS.Path.join(this.thumbnailDirectory, leafName);
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
  _readDirPromises: [],
  _readDir: function() {
    return new Promise((resolve) => {
      if (this.ready) {
        resolve();
        return;
      }
      this._readDirPromises.push(resolve);
      if (this._readDirPromises.length == 1) {
        let thumbDir = OS.Path.join(this.thumbnailDirectory);
        let iterator = new OS.File.DirectoryIterator(thumbDir);
        iterator.forEach((entry) => {
          this._list.add(entry.name);
        }).then(() => {
          iterator.close();
          this.ready = true;
          this._readDirPromises.forEach((d) => d.call());
          delete this._readDirPromises;
        });
      }
    });
  },
  forceReloadThumbnail: function(url) {
    return new Promise((resolve, reject) => {
      let path = PageThumbsStorage.getFilePathForURL(url);
      OS.File.remove(path).then(function() {
        BackgroundPageThumbs.capture(url, {
          onDone: function() {
            notifyTileChanged(url, "thumbnail");
            resolve();
          }
        });
      }, reject);
    });
  }
};

let BackgroundImage = {
  MODE_SINGLE: 0, // old behaviour
  MODE_FOLDER_SHARED: 1, // pick one, use for all (could _change regularly)
  MODE_FOLDER_UNSHARED: 2, // new image each page
  PREF_DIRECTORY: "extensions.newtabtools.background.directory",
  PREF_INTERVAL: "extensions.newtabtools.background.changeinterval",
  PREF_MODE: "extensions.newtabtools.background.mode",
  IDLE_TIME: 3,
  _asleep: false,
  _list: [],
  _inited: false,
  _themeCache: new Map(),
  get modeIsSingle() {
    return this.mode != BackgroundImage.MODE_FOLDER_SHARED && this.mode != BackgroundImage.MODE_FOLDER_UNSHARED;
  },
  _init: function() {
    this.mode = BackgroundImage.MODE_SINGLE;
    this.changeInterval = 0;

    if (Services.prefs.getPrefType(BackgroundImage.PREF_DIRECTORY) == Services.prefs.PREF_STRING) {
      this._directory = Services.prefs.getCharPref(BackgroundImage.PREF_DIRECTORY);
    } else {
      return;
    }
    if (Services.prefs.getPrefType(BackgroundImage.PREF_MODE) == Services.prefs.PREF_INT) {
      this.mode = Services.prefs.getIntPref(BackgroundImage.PREF_MODE);
    }
    if (Services.prefs.getPrefType(BackgroundImage.PREF_INTERVAL) == Services.prefs.PREF_INT) {
      this.changeInterval = Services.prefs.getIntPref(BackgroundImage.PREF_INTERVAL);
    }
    if (this.modeIsSingle) {
      return;
    }

    if (this._inited) {
      return new Promise(function(resolve) {
        resolve();
      });
    }

    return this._entriesForDir(this._directory).then(() => {
      this._inited = true;
      this._list.sort();
      if (this.mode == BackgroundImage.MODE_FOLDER_SHARED) {
        this._change();
      }
    });
  },
  _entriesForDir: function(path) {
    let di = new OS.File.DirectoryIterator(path);
    let dirs = [];
    return di.forEach(e => {
      if (!e.isSymLink) {
        if (e.isDir)
          dirs.push(e.path);
        else if (/\.(jpe?g|png)/i.test(e.name))
          BackgroundImage._list.push(e.path);
      }
    }).then(() => {
      di.close();
      let dirPromises = [for (d of dirs) this._entriesForDir(d)];
      return Promise.all(dirPromises);
    });
  },
  _pick: function() {
    if (this._inited && this._list.length == 0) {
      return new Promise(function(resolve) {
        resolve(null, null);
      });
    }

    return this._init().then(() => {
      let index = Math.floor(Math.random() * this._list.length);
      let url = Services.io.newFileURI(new FileUtils.File(this._list[index])).spec;
      if (this._themeCache.has(url)) {
        return [url, this._themeCache.get(url)];
      }
      return this._selectTheme(url).then((theme) => {
        this._themeCache.set(url, theme);
        return [url, theme];
      });
    });
  },
  _change: function() {
    this._pick().then(([url, theme]) => {
      this.url = url;
      this.theme = theme;
      Services.obs.notifyObservers(null, "newtabtools-change", "background");

      this._startTimer();
    });
  },
  _startTimer: function(forceAwake = false) {
    if (this.changeInterval > 0) {
      if (!forceAwake && !NewTabUtils.allPages._pages.some(function(p) {
        return Components.utils.getGlobalForObject(p).document.visibilityState == "visible";
      })) {
        // If no new tab pages can be seen, stop changing the image.
        this._asleep = true;
        return;
      }

      if (this._timer) {
        // Only one time at once, please!
        this._timer.cancel();
      }
      this._timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
      this._timer.initWithCallback(this._delayedChange.bind(this), this.changeInterval * 60000, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
    }
  },
  wakeUp: function() {
    // This is called by newTabTools.onVisible
    if (this.mode == BackgroundImage.MODE_FOLDER_SHARED && this._asleep) {
      this._asleep = false;
      this._startTimer(true);
    }
  },
  observe: function(subject, topic) {
    if (topic == "idle") {
      idleService.removeIdleObserver(this, this.IDLE_TIME);
      this._change();
    }
  },
  _delayedChange: function() {
    if (idleService.idleTime > this.IDLE_TIME * 1000) {
      this._change();
    } else {
      idleService.addIdleObserver(this, this.IDLE_TIME);
    }
  },
  _selectTheme: function(url) {
    return new Promise(function(resolve) {
      let doc = Services.wm.getMostRecentWindow("navigator:browser").document;
      let c = doc.createElementNS(XHTMLNS, "canvas");
      c.width = c.height = 100;
      let x = c.getContext("2d");
      let i = doc.createElementNS(XHTMLNS, "img");
      i.onload = function() {
        try {
          x.drawImage(i, 0, 0, i.width, i.height, 0, 0, 100, 100);
          let d = x.getImageData(0, 0, 100, 100).data;
          let b = 0;
          let j = 0;
          for (; j < 19996; j++) {
            let v = d[j++] + d[j++] + d[j++];
            if (v >= 384) {
              b++;
            }
          }
          for (; j < 40000; j++) {
            let v = d[j++] + d[j++] + d[j++];
            if (v >= 384) {
              if (++b > 5000) {
                resolve("light");
                return;
              }
            }
          }
          resolve("dark");
        } catch (ex) {
          Components.utils.reportError(ex);
        }
      };
      i.src = url;
    });
  }
};
BackgroundImage._init();
