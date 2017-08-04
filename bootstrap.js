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

/* globals FileUtils, SavedThumbs, Task, TileData */
XPCOMUtils.defineLazyModuleGetter(this, 'FileUtils', 'resource://gre/modules/FileUtils.jsm');
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
}

function uiStartup(params) {
	params.webExtension.startup().then(function({ browser }) {
		Cu.importGlobalProperties(['fetch']);

		browser.runtime.onMessage.addListener(function(message, sender, sendReply) {
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
			}
		});
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
