/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at http://mozilla.org/MPL/2.0/.
*/
/* globals APP_STARTUP, APP_SHUTDOWN, ADDON_UNINSTALL, ADDON_UPGRADE, Components */
const { interfaces: Ci, utils: Cu } = Components;

const ADDON_ID = 'newtabtools@darktrojan.net';
const EXTENSION_PREFS = 'extensions.newtabtools.';

const BROWSER_WINDOW = 'navigator:browser';
const IDLE_TIMEOUT = 10;
const XULNS = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';

/* globals Services, NewTabUtils, AddonManager, XPCOMUtils */
Cu.import('resource://gre/modules/Services.jsm');
Cu.import('resource://gre/modules/NewTabUtils.jsm');
Cu.import('resource://gre/modules/AddonManager.jsm');
Cu.import('resource://gre/modules/XPCOMUtils.jsm');

/* globals thumbDir, strings */
XPCOMUtils.defineLazyGetter(this, 'thumbDir', function() {
	return OS.Path.join(OS.Constants.Path.profileDir, 'newtab-savedthumbs');
});
XPCOMUtils.defineLazyGetter(this, 'strings', function() {
	return Services.strings.createBundle('chrome://newtabtools/locale/newTabTools.properties');
});

/* globals BackgroundImage, NewTabToolsExporter, NewTabURL, OS, PageThumbs, Task, TileData */
XPCOMUtils.defineLazyModuleGetter(this, 'BackgroundImage', 'chrome://newtabtools/content/newTabTools.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'NewTabToolsExporter', 'chrome://newtabtools/content/export.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'NewTabURL', 'resource:///modules/NewTabURL.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'OS', 'resource://gre/modules/osfile.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'PageThumbs', 'resource://gre/modules/PageThumbs.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'Task', 'resource://gre/modules/Task.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'TileData', 'chrome://newtabtools/content/newTabTools.jsm');

/* globals idleService, annoService */
XPCOMUtils.defineLazyServiceGetter(this, 'idleService', '@mozilla.org/widget/idleservice;1', 'nsIIdleService');
XPCOMUtils.defineLazyServiceGetter(this, 'annoService', '@mozilla.org/browser/annotation-service;1', 'nsIAnnotationService');

let browserPrefs = Services.prefs.getBranch('browser.newtabpage.');
let userPrefs = Services.prefs.getBranch(EXTENSION_PREFS);

let prefObserver, notificationObserver, windowObserver, optionsObserver, expirationFilter, idleObserver;

/* exported install, uninstall, startup, shutdown */
function install(aParams, aReason) {
	if (aReason == ADDON_UPGRADE) {
		let showRecent = true;
		if (userPrefs.prefHasUserValue('recent.count')) {
			showRecent = userPrefs.getIntPref('recent.count') !== 0;
			userPrefs.deleteBranch('recent.count');
			userPrefs.setBoolPref('recent.show', showRecent);
		}
		if (browserPrefs.prefHasUserValue('rows') && !userPrefs.prefHasUserValue('rows')) {
			userPrefs.setIntPref('rows', browserPrefs.getIntPref('rows'));
		}
		if (browserPrefs.prefHasUserValue('columns') && !userPrefs.prefHasUserValue('columns')) {
			userPrefs.setIntPref('columns', browserPrefs.getIntPref('columns'));
		}
	}

	Services.tm.currentThread.dispatch(function() {
		Task.spawn(function*() {
			if (yield OS.File.exists(thumbDir)) {
				let stat = yield OS.File.stat(thumbDir);
				if (!stat.isDir) {
					yield OS.File.remove(thumbDir);
					yield OS.File.makeDir(thumbDir);
				}
			} else {
				yield OS.File.makeDir(thumbDir);
			}
		});
	}, Ci.nsIThread.DISPATCH_NORMAL);

	if (userPrefs.getPrefType('version') == Ci.nsIPrefBranch.PREF_INT) {
		let version = userPrefs.getIntPref('version');
		userPrefs.clearUserPref('version');
		userPrefs.setCharPref('version', version);
	}
}
function uninstall(aParams, aReason) {
	if (aReason == ADDON_UNINSTALL) {
		Services.prefs.deleteBranch(EXTENSION_PREFS);
	}
}
function startup(aParams, aReason) {
	let defaultPrefs = Services.prefs.getDefaultBranch(EXTENSION_PREFS);
	defaultPrefs.setIntPref('rows', 3);
	defaultPrefs.setIntPref('columns', 3);
	defaultPrefs.setIntPref('donationreminder', 0);
	defaultPrefs.setCharPref('grid.margin', 'small small small small');
	defaultPrefs.setCharPref('grid.spacing', 'small');
	defaultPrefs.setIntPref('launcher', 3);
	defaultPrefs.setBoolPref('optionspointershown', false);
	defaultPrefs.setBoolPref('recent.show', true);
	defaultPrefs.setCharPref('theme', 'light');
	defaultPrefs.setBoolPref('thumbs.contain', false);
	defaultPrefs.setBoolPref('thumbs.hidebuttons', false);
	defaultPrefs.setBoolPref('thumbs.hidefavicons', false);
	defaultPrefs.setCharPref('thumbs.titlesize', 'small');
	defaultPrefs.setCharPref('tiledata', '{}');

	if (aReason == ADDON_UPGRADE) {
		for (let url of annoService.getPagesWithAnnotation('newtabtools/title')) {
			TileData.set(url.spec, 'title', annoService.getPageAnnotation(url, 'newtabtools/title'));
			annoService.removePageAnnotation(url, 'newtabtools/title');
		}
	}

	NewTabUtils.links._oldGetLinks = NewTabUtils.links.getLinks;
	NewTabUtils.links.getLinks = function Links_getLinks() {
		let pinnedLinks = Array.slice(NewTabUtils.pinnedLinks.links);
		let links = this._getMergedProviderLinks();

		// Filter blocked and pinned links.
		links = links.filter(function(link) {
			return link.type == 'history' &&
				!NewTabUtils.blockedLinks.isBlocked(link) &&
				!NewTabUtils.pinnedLinks.isPinned(link);
		});

		if (userPrefs.prefHasUserValue('filter')) {
			let countPref = userPrefs.getCharPref('filter');
			let counts = JSON.parse(countPref);
			links = links.filter(function(aItem) {
				let match = /^https?:\/\/([^\/]+)\//.exec(aItem.url);
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
		for (let i = 0; i < pinnedLinks.length && links.length; i++)
			if (!pinnedLinks[i])
				pinnedLinks[i] = links.shift();

		// Append the remaining links if any.
		if (links.length)
			pinnedLinks = pinnedLinks.concat(links);

		return pinnedLinks;
	};

	userPrefs.addObserver('', prefObserver, false);
	Services.obs.addObserver(notificationObserver, 'newtabtools-change', false);

	enumerateTabs(function(aWindow) {
		aWindow.location.reload();
	});

	let windowEnum = Services.wm.getEnumerator(BROWSER_WINDOW);
	while (windowEnum.hasMoreElements()) {
		windowObserver.paint(windowEnum.getNext());
	}
	Services.ww.registerNotification(windowObserver);

	Services.obs.addObserver(optionsObserver, 'addon-options-displayed', false);
	expirationFilter.init();

	AddonManager.addAddonListener({
		// If we call reload in shutdown, the page override is
		// still in place, and we don't want that.
		onDisabled: function(aAddon) {
			AddonManager.removeAddonListener(this);
			if (aAddon.id == ADDON_ID) {
				enumerateTabs(function(aWindow) {
					aWindow.location.reload();
				});
			}
		}
	});

	if (userPrefs.prefHasUserValue('version')) {
		// Truncate version numbers to floats
		let oldVersion = parseFloat(userPrefs.getCharPref('version'), 10);
		let currentVersion = parseFloat(aParams.version, 10);
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
	userPrefs.setCharPref('version', aParams.version);

	if (aReason == APP_STARTUP) {
		Services.obs.addObserver({
			observe: function() {
				Services.obs.removeObserver(this, 'browser-delayed-startup-finished');
				uiStartup(aParams, aReason);
			}
		}, 'browser-delayed-startup-finished', false);
	} else {
		uiStartup(aParams, aReason);
	}
}
function shutdown(aParams, aReason) {
	if (aReason == APP_SHUTDOWN) {
		return;
	}

	NewTabUtils.links.getLinks = NewTabUtils.links._oldGetLinks;
	delete NewTabUtils.links._oldGetLinks;

	let windowEnum = Services.wm.getEnumerator(BROWSER_WINDOW);
	while (windowEnum.hasMoreElements()) {
		windowObserver.unpaint(windowEnum.getNext());
	}
	Services.ww.unregisterNotification(windowObserver);

	userPrefs.removeObserver('', prefObserver);
	Services.obs.removeObserver(notificationObserver, 'newtabtools-change');

	Services.obs.removeObserver(optionsObserver, 'addon-options-displayed');
	Cu.unload('chrome://newtabtools/content/export.jsm');
	Cu.unload('chrome://newtabtools/content/newTabTools.jsm');

	expirationFilter.cleanup();

	try {
		idleService.removeIdleObserver(idleObserver, IDLE_TIMEOUT);
	} catch (e) { // might be already removed
	}
}

function uiStartup(aParams, aReason) {
	if (NewTabURL.overridden) {
		let recentWindow = Services.wm.getMostRecentWindow(BROWSER_WINDOW);

		recentWindow.setTimeout(function() {
			let notificationBox = recentWindow.document.getElementById('global-notificationbox');
			let message = strings.GetStringFromName('prefschange');
			let label = strings.GetStringFromName('change.label');
			let accessKey = strings.GetStringFromName('change.accesskey');

			notificationBox.appendNotification(
				message, 'newtabtools-urlchange', 'chrome://newtabtools/content/icon16.png',
				notificationBox.PRIORITY_INFO_MEDIUM, [{
					label: label,
					accessKey: accessKey,
					callback: function() {
						NewTabURL.reset();
					}
				}]
			);
		}, aReason == APP_STARTUP ? 1000 : 0);
	}
}

prefObserver = {
	observe: function(aSubject, aTopic, aData) {
		switch (aData) {
		case 'grid.margin':
		case 'grid.spacing':
		case 'launcher':
		case 'theme':
		case 'thumbs.contain':
		case 'thumbs.hidebuttons':
		case 'thumbs.hidefavicons':
		case 'thumbs.titlesize':
			enumerateTabs(function(aWindow) {
				aWindow.newTabTools.updateUI();
			});
			break;
		case 'recent.show':
			enumerateTabs(function(aWindow) {
				aWindow.newTabTools.refreshRecent();
			});
			break;
		case 'columns':
		case 'rows':
		case 'filter':
			enumerateTabs(function(aWindow) {
				aWindow.gGrid.refresh();
			});
			break;
		}
	}
};

notificationObserver = {
	observe: function(aSubject, aTopic, aData) {
		switch (aData) {
		case 'background':
			enumerateTabs(function(aWindow) {
				aWindow.newTabTools.refreshBackgroundImage();
			});
			break;
		case 'backgroundColor':
		case 'thumbnail':
		case 'title':
			enumerateTabs(function(aWindow) {
				aSubject.QueryInterface(Ci.nsISupportsString);
				aWindow.newTabTools.onTileChanged(aSubject.data, aData);
			});
			break;
		}
	}
};

windowObserver = {
	observe: function(aSubject) {
		aSubject.addEventListener('load', function() {
			windowObserver.paint(aSubject);
		}, false);
	},
	paint: function(aWindow) {
		if (aWindow.location == 'chrome://browser/content/browser.xul') {
			let doc = aWindow.document;
			doc.addEventListener('TabOpen', this.onTabOpen, false);

			let menu = doc.getElementById('contentAreaContextMenu');
			menu.addEventListener('popupshowing', this.onPopupShowing);

			let before = doc.getElementById('context-sep-open').nextElementSibling;

			let menuseparator = doc.createElementNS(XULNS, 'menuseparator');
			menuseparator.id = 'newtabtools-separator';
			menuseparator.className = 'newtabtools-item';
			menu.insertBefore(menuseparator, before);
			before = menuseparator;

			for (let action of ['block', 'unpin', 'pin', 'edit']) {
				let menuitem = doc.createElementNS(XULNS, 'menuitem');
				menuitem.id = 'newtabtools-' + action + 'tile';
				menuitem.className = 'newtabtools-item';
				menuitem.setAttribute('label', strings.GetStringFromName('contextmenu.' + action));
				menuitem.addEventListener('command', this.onEditItemClicked);
				menu.insertBefore(menuitem, before);
				before = menuitem;
			}

			for (let action of ['options']) {
				let menuitem = doc.createElementNS(XULNS, 'menuitem');
				menuitem.id = 'newtabtools-' + action;
				menuitem.className = 'newtabtools-page';
				menuitem.setAttribute('label', strings.GetStringFromName(
					'contextmenu.' + action + (Services.appinfo.OS == 'WINNT' ? 'Windows' : 'Unix')
				));
				menuitem.addEventListener('command', this.onEditItemClicked);
				menu.insertBefore(menuitem, before);
				before = menuitem;
			}
		}
	},
	unpaint: function(aWindow) {
		if (aWindow.location == 'chrome://browser/content/browser.xul') {
			let doc = aWindow.document;
			doc.removeEventListener('TabOpen', this.onTabOpen, false);

			let menu = doc.getElementById('contentAreaContextMenu');
			menu.removeEventListener('popupshowing', this.onPopupShowing);
			for (let item of menu.querySelectorAll('.newtabtools-item, .newtabtools-page')) {
				item.remove();
			}
		}
	},
	onTabOpen: function(aEvent) {
		let browser = aEvent.target.linkedBrowser;
		if (browser.currentURI.spec == 'about:newtab') {
			browser.contentWindow.newTabTools.onVisible();
		}
	},
	onEditItemClicked: function(aEvent) {
		let doc = aEvent.view.document;
		let target = windowObserver.findCellTarget(doc);

		switch (aEvent.target.id) {
		case 'newtabtools-edittile':
			let win = target.ownerDocument.defaultView;
			let index = 0;
			while (target.previousElementSibling) {
				target = target.previousElementSibling;
				index++;
			}
			target = target.parentNode;
			while (target.previousElementSibling) {
				target = target.previousElementSibling;
				index += target.childElementCount;
			}

			win.newTabTools.toggleOptions();
			win.newTabTools.selectedSiteIndex = index;
			break;

		case 'newtabtools-pintile':
			target._newtabCell.site.pin();
			break;
		case 'newtabtools-unpintile':
			target._newtabCell.site.unpin();
			break;
		case 'newtabtools-blocktile':
			target._newtabCell.site.block();
			break;
		case 'newtabtools-options':
			doc.popupNode.ownerDocument.defaultView.newTabTools.toggleOptions();
			break;
		}
	},
	onPopupShowing: function(aEvent) {
		let doc = aEvent.view.document;
		let target = windowObserver.findCellTarget(doc);

		let menu = doc.getElementById('contentAreaContextMenu');
		for (let item of menu.querySelectorAll('.newtabtools-item')) {
			item.hidden = !target;
		}
		for (let item of menu.querySelectorAll('.newtabtools-page')) {
			item.hidden = (
				!!target ||
				!doc.popupNode ||
				doc.popupNode.ownerDocument.location.href != 'about:newtab' ||
				!doc.popupNode.ownerDocument.documentElement.hasAttribute('options-hidden')
			);
			if (!item.hidden) {
				menu.querySelector('#newtabtools-separator').hidden = false;
			}
		}

		if (target) {
			let pinned = target._newtabCell.site.isPinned();
			if (pinned) {
				doc.getElementById('newtabtools-pintile').hidden = true;
			} else {
				doc.getElementById('newtabtools-unpintile').hidden = true;
			}
		}
	},
	findCellTarget: function(aDocument) {
		// This probably isn't going to work once about:newtab is put in a content process.
		let target = aDocument.popupNode;
		if (!target || target.ownerDocument.location.href != 'about:newtab') {
			return null;
		}

		while (target && target.classList && !target.classList.contains('newtab-cell')) {
			target = target.parentNode;
		}
		return (target && target.classList && target.classList.contains('newtab-cell')) ? target : null;
	}
};

function enumerateTabs(aCallback) {
	for (let page of NewTabUtils.allPages._pages) {
		try {
			let global = Cu.getGlobalForObject(page);
			aCallback(global);
		} catch (e) {
			Cu.reportError(e);
		}
	}
}

optionsObserver = {
	observe: function(aDocument, aTopic, aData) {
		switch (aTopic) {
		case 'addon-options-displayed':
			if (aData != ADDON_ID) {
				return;
			}

			if (!BackgroundImage.modeIsSingle) {
				aDocument.querySelector('setting[pref="extensions.newtabtools.theme"]').style.visibility = 'collapse';
				aDocument.querySelector('setting[pref="extensions.newtabtools.rows"]').setAttribute('first-row', 'true');
			}

			aDocument.getElementById('newtabtools.export').addEventListener('command', () => {
				NewTabToolsExporter.doExport();
			});
			aDocument.getElementById('newtabtools.import').addEventListener('command', () => {
				NewTabToolsExporter.doImport();
			});
		}
	},
};

expirationFilter = {
	init: function() {
		PageThumbs.addExpirationFilter(this);
	},

	cleanup: function() {
		PageThumbs.removeExpirationFilter(this);
	},

	filterForThumbnailExpiration: function(aCallback) {
		let columns = userPrefs.getIntPref('columns');
		let rows = userPrefs.getIntPref('rows');
		let count = columns * rows + 10;

		if (count <= 25) {
			aCallback([]);
			return;
		}

		NewTabUtils.links.populateCache(function() {
			let urls = [];

			// Add all URLs to the list that we want to keep thumbnails for.
			for (let link of NewTabUtils.links.getLinks().slice(25, count)) {
				if (link && link.url)
				urls.push(link.url);
			}

			aCallback(urls);
		});
	}
};

idleObserver = {
	observe: function(service, state) {
		if (state != 'idle') {
			return;
		}
		idleService.removeIdleObserver(this, IDLE_TIMEOUT);

		let version = parseFloat(userPrefs.getCharPref('version'), 10);
		let recentWindow = Services.wm.getMostRecentWindow(BROWSER_WINDOW);
		let browser = recentWindow.gBrowser;
		let notificationBox = recentWindow.document.getElementById('global-notificationbox');
		let message = strings.formatStringFromName('newversion', [version], 1);
		let label = strings.GetStringFromName('donate.label');
		let accessKey = strings.GetStringFromName('donate.accesskey');

		notificationBox.appendNotification(message, 'newtabtools-donate', 'chrome://newtabtools/content/icon16.png', notificationBox.PRIORITY_INFO_MEDIUM, [{
			label: label,
			accessKey: accessKey,
			callback: function() {
				browser.selectedTab = browser.addTab('https://addons.mozilla.org/addon/new-tab-tools/contribute/installed/');
			}
		}]);

		userPrefs.setIntPref('donationreminder', Date.now() / 1000);
	}
};
