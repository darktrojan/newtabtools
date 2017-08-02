/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at http://mozilla.org/MPL/2.0/.
*/
/* globals APP_STARTUP, APP_SHUTDOWN, Components */
const { utils: Cu } = Components;

const EXTENSION_PREFS = 'extensions.newtabtools.';

/* globals Services, NewTabUtils, XPCOMUtils */
Cu.import('resource://gre/modules/Services.jsm');
Cu.import('resource://gre/modules/NewTabUtils.jsm');
Cu.import('resource://gre/modules/XPCOMUtils.jsm');

/* globals FileUtils, OS, PageThumbs, SavedThumbs, Task, TileData */
XPCOMUtils.defineLazyModuleGetter(this, 'FileUtils', 'resource://gre/modules/FileUtils.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'OS', 'resource://gre/modules/osfile.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'PageThumbs', 'resource://gre/modules/PageThumbs.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'SavedThumbs', 'chrome://newtabtools/content/newTabTools.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'Task', 'resource://gre/modules/Task.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'TileData', 'chrome://newtabtools/content/newTabTools.jsm');

let userPrefs = Services.prefs.getBranch(EXTENSION_PREFS);

/* exported install, uninstall, startup, shutdown */
function install() {
}
function uninstall() {
}
function startup(params, reason) {
	let defaultPrefs = Services.prefs.getDefaultBranch(EXTENSION_PREFS);
	defaultPrefs.setIntPref('foreground.opacity', 80);
	defaultPrefs.setIntPref('rows', 3);
	defaultPrefs.setIntPref('columns', 3);
	defaultPrefs.setCharPref('grid.margin', 'small small small small');
	defaultPrefs.setCharPref('grid.spacing', 'small');
	defaultPrefs.setBoolPref('historytiles.show', true);
	defaultPrefs.setBoolPref('locked', false);
	defaultPrefs.setBoolPref('recent.show', true);
	defaultPrefs.setCharPref('theme', 'light');
	defaultPrefs.setCharPref('thumbs.titlesize', 'small');
	defaultPrefs.setCharPref('tiledata', '{}');

	userPrefs.setCharPref('version', params.version);

	if (reason == APP_STARTUP) {
		Services.obs.addObserver({
			observe: function() {
				Services.obs.removeObserver(this, 'browser-delayed-startup-finished');
				uiStartup(params, reason);
			}
		}, 'browser-delayed-startup-finished', false);
	} else {
		uiStartup(params, reason);
	}
}
function shutdown(params, reason) {
	if (reason == APP_SHUTDOWN) {
		return;
	}

	Cu.unload('chrome://newtabtools/content/newTabTools.jsm');
	expirationFilter.cleanup();
	messageListener.destroy();
}

function uiStartup(params) {
	params.webExtension.startup().then(function({ browser }) {
		Cu.importGlobalProperties(['fetch']);

		browser.runtime.onMessage.addListener(function(message, sender, sendReply) {
			if (typeof message == 'object') {
				switch (message.action) {
				case 'thumbnails':
					thumbnailHandler.getThumbnails(message.urls).then(sendReply);
					return true;
				case 'expirationFilter':
					expirationFilter.init(message.count);
					return;
				}
			}

			switch (message) {
			case 'tiles':
				Task.spawn(function*() {
					yield SavedThumbs._readDir();
					let urlMap = new Map();

					for (let link of yield getTopSites()) {
						let save = false;
						delete link.title;

						let title = TileData.get(link.url, 'title');
						if (title) {
							link.title = title;
							save = true;
						}

						let backgroundColor = TileData.get(link.url, 'backgroundColor');
						if (backgroundColor) {
							link.backgroundColor = backgroundColor;
							save = true;
						}

						if (SavedThumbs.hasSavedThumb(link.url)) {
							let backgroundURL = yield SavedThumbs.getThumbnailURL(link.url);
							let response = yield fetch(backgroundURL);
							let blob = yield response.blob();
							link.image = blob;
							save = true;
						}

						if (save) {
							urlMap.set(link.url, link);
						}
					}

					let position = -1;
					for (let link of NewTabUtils.pinnedLinks.links) {
						position++;

						if (!link) {
							continue;
						}

						if (!urlMap.has(link.url)) {
							urlMap.set(link.url, {
								url: link.url
							});
						}

						let mapData = urlMap.get(link.url);
						mapData.position = position;
						if (!mapData.title && link.title != link.url) {
							mapData.title = link.title;
						}
					}

					sendReply([...urlMap.values()]);
				});
				return true;

			case 'background':
				Task.spawn(function*() {
					let backgroundImageFile = FileUtils.getFile('ProfD', ['newtab-background'], true);
					if (!backgroundImageFile.exists()) {
						sendReply(null);
						return;
					}

					let backgroundImageURL = Services.io.newFileURI(backgroundImageFile);
					let response = yield fetch(backgroundImageURL.spec);
					let blob = yield response.blob();

					sendReply(blob);
				});
				return true;

			case 'prefs':
				let prefs = {};
				prefs.theme = userPrefs.getCharPref('theme');
				prefs.opacity = userPrefs.getIntPref('foreground.opacity');
				prefs.rows = userPrefs.getIntPref('rows');
				prefs.columns = userPrefs.getIntPref('columns');
				prefs.margin = userPrefs.getCharPref('grid.margin').split(' ');
				prefs.spacing = userPrefs.getCharPref('grid.spacing');
				prefs.titleSize = userPrefs.getCharPref('thumbs.titlesize');
				prefs.locked = userPrefs.getBoolPref('locked');
				prefs.history = userPrefs.getBoolPref('historytiles.show');
				prefs.recent = userPrefs.getBoolPref('recent.show');

				sendReply(prefs);
				return;

			case 'topSites':
				getTopSites().then(sendReply);
				return true;
			}
		});

		messageListener.init();
	});
}
function getTopSites() {
	return new Promise(function(resolve) {
		NewTabUtils.links.populateProviderCache(NewTabUtils.placesProvider, function() {
			resolve(NewTabUtils.getProviderLinks(NewTabUtils.placesProvider).map(link => {
				return {
					url: link.url,
					title: link.title,
				};
			}));
		});
	});
}

var thumbnailHandler = {
	_cache: new Map(),

	getThumbnail: function(url) {
		if (thumbnailHandler._cache.has(url)) {
			return Promise.resolve(thumbnailHandler._cache.get(url));
		}

		return Task.spawn(function*() {
			let path = PageThumbs.getThumbnailPath(url);
			let exists = yield OS.File.exists(path);
			if (!exists) {
				thumbnailHandler._cache.set(url, null);
				return null;
			}

			let r = yield fetch(PageThumbs.getThumbnailURL(url));
			let b = yield r.blob();
			thumbnailHandler._cache.set(url, b);
			return b;
		});
	},
	getThumbnails: function(urls) {
		let result = new Map();
		return Promise.all(urls.map(u => {
			return thumbnailHandler.getThumbnail(u).then(tu => {
				if (tu) {
					result.set(u, tu);
				}
			});
		})).then(() => result);
	}
};

var expirationFilter = {
	added: false,
	count: -1,

	init: function(count) {
		if (!this.added) {
			this.count = count;
			this.added = true;
			PageThumbs.addExpirationFilter(this);
		}
	},

	cleanup: function() {
		if (this.added) {
			this.added = false;
			PageThumbs.removeExpirationFilter(this);
		}
	},

	filterForThumbnailExpiration: function(callback) {
		NewTabUtils.links.populateCache(function() {
			// Add all URLs to the list that we want to keep thumbnails for.
			callback(getTopSites().slice(0, this.count).map(s => s.url));
		});
	}
};

var messageListener = {
	// Work around bug 1051238.
	_processScriptURL: 'chrome://newtabtools/content/process.js?' + Math.random(),
	init: function() {
		Services.ppmm.loadProcessScript(this._processScriptURL, true);
		Services.ppmm.broadcastAsyncMessage('NewTabTools:enable');
	},
	destroy: function() {
		Services.ppmm.removeDelayedProcessScript(this._processScriptURL, true);
		Services.ppmm.broadcastAsyncMessage('NewTabTools:disable');
	}
};
