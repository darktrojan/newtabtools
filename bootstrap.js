/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at http://mozilla.org/MPL/2.0/.
*/
/* globals APP_STARTUP, APP_SHUTDOWN, Components */
const { utils: Cu } = Components;

const EXTENSION_PREFS = 'extensions.newtabtools.';

const BROWSER_WINDOW = 'navigator:browser';
const IDLE_TIMEOUT = 10;

/* globals Services, NewTabUtils, XPCOMUtils */
Cu.import('resource://gre/modules/Services.jsm');
Cu.import('resource://gre/modules/NewTabUtils.jsm');
Cu.import('resource://gre/modules/XPCOMUtils.jsm');

/* globals strings */
XPCOMUtils.defineLazyGetter(this, 'strings', function() {
	return Services.strings.createBundle('chrome://newtabtools/locale/newTabTools.properties');
});

/* globals FileUtils, OS, PageThumbs, SavedThumbs, Task, TileData */
XPCOMUtils.defineLazyModuleGetter(this, 'FileUtils', 'resource://gre/modules/FileUtils.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'OS', 'resource://gre/modules/osfile.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'PageThumbs', 'resource://gre/modules/PageThumbs.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'SavedThumbs', 'chrome://newtabtools/content/newTabTools.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'Task', 'resource://gre/modules/Task.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'TileData', 'chrome://newtabtools/content/newTabTools.jsm');

/* globals idleService */
XPCOMUtils.defineLazyServiceGetter(this, 'idleService', '@mozilla.org/widget/idleservice;1', 'nsIIdleService');

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
	defaultPrefs.setIntPref('donationreminder', 0);
	defaultPrefs.setCharPref('grid.margin', 'small small small small');
	defaultPrefs.setCharPref('grid.spacing', 'small');
	defaultPrefs.setBoolPref('historytiles.show', true);
	defaultPrefs.setIntPref('launcher', 3);
	defaultPrefs.setBoolPref('locked', false);
	defaultPrefs.setBoolPref('optionspointershown', false);
	defaultPrefs.setBoolPref('recent.show', true);
	defaultPrefs.setCharPref('theme', 'light');
	defaultPrefs.setIntPref('thumbs.prefs.delay', 1);
	defaultPrefs.setBoolPref('thumbs.contain', false);
	defaultPrefs.setBoolPref('thumbs.hidebuttons', false);
	defaultPrefs.setBoolPref('thumbs.hidefavicons', false);
	defaultPrefs.setCharPref('thumbs.titlesize', 'small');
	defaultPrefs.setCharPref('tiledata', '{}');

	if (userPrefs.prefHasUserValue('version')) {
		// Truncate version numbers to floats
		let oldVersion = parseFloat(userPrefs.getCharPref('version'), 10);
		let currentVersion = parseFloat(params.version, 10);
		let lastReminder = userPrefs.getIntPref('donationreminder') * 1000;
		let shouldRemind = Date.now() - lastReminder > 604800000;

		if (Services.vc.compare(oldVersion, currentVersion) == -1) {
			userPrefs.setBoolPref('optionspointershown', true);
			if (lastReminder === 0) {
				// Skip reminder the first time
				userPrefs.setIntPref('donationreminder', Date.now() / 1000);
			} else if (shouldRemind) {
				idleService.addIdleObserver(idleObserver, IDLE_TIMEOUT);
			}
		}
	}
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

	try {
		idleService.removeIdleObserver(idleObserver, IDLE_TIMEOUT);
	} catch (e) { // might be already removed
	}
}

function uiStartup(params) {
	params.webExtension.startup().then(function({ browser }) {
		Cu.importGlobalProperties(['fetch']);

		browser.runtime.onMessage.addListener(function(message, sender, sendReply) {
			if (typeof message == 'object' && message.action == 'thumbnails') {
				thumbnailHandler.getThumbnails(message.urls).then(sendReply);
				return true;
			}

			switch (message) {
			case 'tiles':
				Task.spawn(function*() {
					yield SavedThumbs._readDir();

					let links = [];
					let position = -1;
					for (let link of NewTabUtils.pinnedLinks.links) {
						position++;

						if (!link) {
							continue;
						}

						let data = {
							url: link.url,
							title: TileData.get(link.url, 'title') || link.title,
							position: position
						};
						let backgroundColor = TileData.get(link.url, 'backgroundColor');
						if (backgroundColor) {
							data.backgroundColor = backgroundColor;
						}

						if (SavedThumbs.hasSavedThumb(link.url)) {
							let backgroundURL = yield SavedThumbs.getThumbnailURL(link.url);
							let response = yield fetch(backgroundURL);
							let blob = yield response.blob();
							data.image = blob;
						}

						links.push(data);
					}

					sendReply(links);
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
				NewTabUtils.links.populateProviderCache(NewTabUtils.placesProvider, function() {
					sendReply(NewTabUtils.getProviderLinks(NewTabUtils.placesProvider).map(link => {
						return {
							url: link.url,
							title: link.title,
						};
					}));
				});
				return true;
			}
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

var idleObserver = {
	observe: function(service, state) {
		if (state != 'idle') {
			return;
		}
		idleService.removeIdleObserver(this, IDLE_TIMEOUT);

		let version = userPrefs.getCharPref('version');
		let recentWindow = Services.wm.getMostRecentWindow(BROWSER_WINDOW);
		let notificationBox = recentWindow.document.getElementById('global-notificationbox');
		let message = strings.formatStringFromName('newversion', [version], 1);
		let changeLogLabel = strings.GetStringFromName('changelog.label');
		let changeLogAccessKey = strings.GetStringFromName('changelog.accesskey');
		let donateLabel = strings.GetStringFromName('donate.label');
		let donateAccessKey = strings.GetStringFromName('donate.accesskey');

		notificationBox.appendNotification(
			message, 'newtabtools-donate', 'chrome://newtabtools/content/icon16.png',
			notificationBox.PRIORITY_INFO_MEDIUM, [{
				label: changeLogLabel,
				accessKey: changeLogAccessKey,
				callback: function() {
					recentWindow.switchToTabHavingURI(
						'https://addons.mozilla.org/addon/new-tab-tools/versions/' + version, true
					);
				}
			}, {
				label: donateLabel,
				accessKey: donateAccessKey,
				callback: function() {
					recentWindow.switchToTabHavingURI(
						'https://darktrojan.github.io/donate.html?newtabtools', true
					);
				}
			}]
		);

		userPrefs.setIntPref('donationreminder', Date.now() / 1000);
	}
};
