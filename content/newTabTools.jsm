const EXPORTED_SYMBOLS = ["TileData"];
const PREF = "extensions.newtabtools.tiledata";

Components.utils.import("resource://gre/modules/Services.jsm");

let data = new Map();
try {
  let value = Services.prefs.getCharPref(PREF);
  let json = JSON.parse(value);
  for (let [url, urlData] in Iterator(json)) {
    data.set(url, new Map(Iterator(urlData)));
  }
} catch(e) {
  Components.utils.reportError(e);
}

let TileData = {
  get: function(url, key) {
    if (data.has(url)) {
      return data.get(url).get(key) || null;
    }
    return null;
  },
  set: function(url, key, value) {
    let urlData = data.get(url) || new Map();

    if (value === null) {
      urlData.delete(key);
      if (urlData.size == 0) {
        data.delete(url);
      }
    } else {
      urlData.set(key, value);
      if (!data.has(url)) {
        data.set(url, urlData);
      }
    }

    setPref();
  }
};

function setPref() {
  let obj = {};
  for (let [url, urlData] of data.entries()) {
    obj[url] = {};
    for (let [key, value] of urlData.entries()) {
      obj[url][key] = value;
    }
  }
  Services.prefs.setCharPref(PREF, JSON.stringify(obj));
}

