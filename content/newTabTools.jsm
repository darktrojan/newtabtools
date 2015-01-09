const EXPORTED_SYMBOLS = ["TileData"];
const PREF = "extensions.newtabtools.tiledata";

Components.utils.import("resource://gre/modules/Services.jsm");

let data;
try {
  let value = Services.prefs.getCharPref(PREF);
  let json = JSON.parse(value);
  data = new Map(Iterator(json));
} catch(e) {
  Components.utils.reportError(e);
  data = new Map();
}

let TileData = {
  get: function(url, key) {
    try {
    if (data.has(url)) {
      return data.get(url)[key] || null;
    }
    return null;
  } catch(e) { Components.utils.reportError(e)}
  },
  set: function(url, key, value) {
    let siteData = data.get(url) || {};

    if (value === null) {
      delete siteData[key];
      if (siteData.length == 0) {
        data.delete(url);
      }
    } else {
      siteData[key] = value;
      if (!data.has(url)) {
        data.set(url, siteData);
      }
    }

    setPref();
  }
};

function setPref() {
  let obj = {};
  for (let [url, siteData] of data.entries()) {
    obj[url] = siteData;
  }
  Services.prefs.setCharPref(PREF, JSON.stringify(obj));
}

