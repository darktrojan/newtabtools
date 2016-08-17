/* exported EXPORTED_SYMBOLS, NewTabToolsLinks, GridPrefs, TileData, SavedThumbs, ThumbnailPrefs */
var EXPORTED_SYMBOLS = ['NewTabToolsLinks', 'GridPrefs', 'TileData', 'SavedThumbs', 'ThumbnailPrefs'];

/* globals Components, Services, XPCOMUtils, Iterator */
var { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import('resource://gre/modules/Services.jsm');
Cu.import('resource://gre/modules/XPCOMUtils.jsm');

/* globals BackgroundPageThumbs, FileUtils, NewTabUtils, OS, PageThumbs, PageThumbsStorage */
XPCOMUtils.defineLazyModuleGetter(this, 'BackgroundPageThumbs', 'resource://gre/modules/BackgroundPageThumbs.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'FileUtils', 'resource://gre/modules/FileUtils.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'NewTabUtils', 'resource://gre/modules/NewTabUtils.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'OS', 'resource://gre/modules/osfile.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'PageThumbs', 'resource://gre/modules/PageThumbs.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'PageThumbsStorage', 'resource://gre/modules/PageThumbs.jsm');

var NewTabToolsLinks = {
	PREF_HISTORY: 'extensions.newtabtools.historytiles.show',
	PREF_FILTER: 'extensions.newtabtools.filter',
	getLinks: function() {
		if (this._getLinksCache) {
			return this._getLinksCache;
		}

		let finalLinks = Array.slice(NewTabUtils.pinnedLinks.links);
		if (!Services.prefs.getBoolPref(this.PREF_HISTORY)) {
			this._getLinksCache = finalLinks;
			return finalLinks;
		}

		let historyLinks = NewTabUtils.links._getMergedProviderLinks();

		// Filter blocked and pinned links.
		historyLinks = historyLinks.filter(function(link) {
			return link.type == 'history' &&
				!NewTabUtils.blockedLinks.isBlocked(link) &&
				!NewTabUtils.pinnedLinks.isPinned(link);
		});

		if (Services.prefs.prefHasUserValue(this.PREF_FILTER)) {
			let countPref = Services.prefs.getCharPref(this.PREF_FILTER);
			let counts = JSON.parse(countPref);
			historyLinks = historyLinks.filter(function(item) {
				let match = /^https?:\/\/([^\/]+)\//.exec(item.url);
				if (!match)
					return true;
				if (match[1] in counts) {
					if (counts[match[1]]) {
						counts[match[1]]--;
						return true;
					}
					return false;
				}
				return true;
			});
		}

		// Try to fill the gaps between pinned links.
		for (let i = 0; i < finalLinks.length && historyLinks.length; i++)
			if (!finalLinks[i])
				finalLinks[i] = historyLinks.shift();

		// Append the remaining links if any.
		if (historyLinks.length)
			finalLinks = finalLinks.concat(historyLinks);

		this._getLinksCache = finalLinks;
		return finalLinks;
	},
	clearCache: function() {
		this._getLinksCache = null;
	}
};

var GridPrefs = {
	PREF_ROWS: 'extensions.newtabtools.rows',
	PREF_COLUMNS: 'extensions.newtabtools.columns',
	PREF_LOCKED: 'extensions.newtabtools.locked',

	_gridRows: null,
	get gridRows() {
		if (!this._gridRows) {
			this._gridRows = Math.max(1, Services.prefs.getIntPref(GridPrefs.PREF_ROWS));
		}
		return this._gridRows;
	},
	_gridColumns: null,
	get gridColumns() {
		if (!this._gridColumns) {
			this._gridColumns = Math.max(1, Services.prefs.getIntPref(GridPrefs.PREF_COLUMNS));
		}
		return this._gridColumns;
	},
	_gridLocked: false,
	get gridLocked() {
		return this._gridLocked;
	},
	init: function GridPrefs_init() {
		Services.prefs.addObserver(GridPrefs.PREF_ROWS, this, true);
		Services.prefs.addObserver(GridPrefs.PREF_COLUMNS, this, true);
		this._gridLocked = Services.prefs.getBoolPref(GridPrefs.PREF_LOCKED);
		Services.prefs.addObserver(GridPrefs.PREF_LOCKED, this, true);
	},
	observe: function GridPrefs_observe(subject, topic, data) {
		if (data == GridPrefs.PREF_ROWS) {
			this._gridRows = null;
		} else if (data == GridPrefs.PREF_COLUMNS) {
			this._gridColumns = null;
		} else {
			this._gridLocked = Services.prefs.getBoolPref(GridPrefs.PREF_LOCKED);
		}
	},
	QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference]),
};
GridPrefs.init();

function notifyTileChanged(url, key) {
	let urlString = Cc['@mozilla.org/supports-string;1'].createInstance(Ci.nsISupportsString);
	urlString.data = url;
	Services.obs.notifyObservers(urlString, 'newtabtools-change', key);
}

var TileData = {
	PREF: 'extensions.newtabtools.tiledata',
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
			Cu.reportError(e);
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

var SavedThumbs = {
	_ready: false,
	_list: new Set(),
	getThumbnailURL: function(url) {
		return this._readDir().then(() => {
			let leafName = this.getThumbnailLeafName(url);
			if (this.hasSavedThumb(url, leafName)) {
				let path = this.getThumbnailPath(url, leafName);
				return Services.io.newFileURI(new FileUtils.File(path)).spec + '?' + Math.random();
			} else {
				return PageThumbs.getThumbnailURL(url) + '&' + Math.random();
			}
		});
	},
	get thumbnailDirectory() {
		return OS.Path.join(OS.Constants.Path.profileDir, 'newtab-savedthumbs');
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
		notifyTileChanged(url, 'thumbnail');
	},
	hasSavedThumb: function(url, leafName=this.getThumbnailLeafName(url)) {
		return this._list.has(leafName);
	},
	removeSavedThumb: function(url, leafName=this.getThumbnailLeafName(url)) {
		this._list.delete(leafName);
		notifyTileChanged(url, 'thumbnail');
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
						notifyTileChanged(url, 'thumbnail');
						resolve();
					}
				});
			}, reject);
		});
	}
};

var ThumbnailPrefs = {
	PREF_WIDTH: 'toolkit.pageThumbs.minWidth',
	PREF_HEIGHT: 'toolkit.pageThumbs.minHeight',
	PREF_DELAY: 'extensions.newtabtools.thumbs.prefs.delay',

	hasBeenSet: false,
	setOnce: function(width, height) {
		if (this.hasBeenSet || this.delay < 0) {
			return;
		}
		this.hasBeenSet = true;

		Services.prefs.setIntPref(this.PREF_WIDTH, width);
		Services.prefs.setIntPref(this.PREF_HEIGHT, height);
		Services.ppmm.broadcastAsyncMessage('NewTabTools:uncacheThumbnailPrefs');
	},
	observe: function() {
		this.delay = Services.prefs.getIntPref(ThumbnailPrefs.PREF_DELAY);
	},
	QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference]),
};
XPCOMUtils.defineLazyGetter(ThumbnailPrefs, 'delay', function() {
	Services.prefs.addObserver(ThumbnailPrefs.PREF_DELAY, ThumbnailPrefs, true);
	return Services.prefs.getIntPref(ThumbnailPrefs.PREF_DELAY);
});
