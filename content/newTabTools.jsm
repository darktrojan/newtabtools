const EXPORTED_SYMBOLS = ["TileData"];
const PREF = "extensions.newtabtools.tiledata";

Components.utils.import("resource://gre/modules/Services.jsm");

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

    this._notifyTileChanged(url, key);
    this._setPref();
  },
  _notifyTileChanged: function(url, key) {
    let urlString = Components.classes["@mozilla.org/supports-string;1"]
      .createInstance(Components.interfaces.nsISupportsString);
    urlString.data = url;
    Services.obs.notifyObservers(urlString, "newtabtools-change", key);
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
