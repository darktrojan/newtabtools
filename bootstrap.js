/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at http://mozilla.org/MPL/2.0/.
*/
/* globals APP_STARTUP, APP_SHUTDOWN, ADDON_UNINSTALL, ADDON_UPGRADE, Components */
const { interfaces: Ci, manager: Cm, utils: Cu } = Components;

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

/* globals componentRegistrar, thumbDir, strings */
XPCOMUtils.defineLazyGetter(this, 'componentRegistrar', function() {
	return Cm.QueryInterface(Ci.nsIComponentRegistrar);
});
XPCOMUtils.defineLazyGetter(this, 'thumbDir', function() {
	return OS.Path.join(OS.Constants.Path.profileDir, 'newtab-savedthumbs');
});
XPCOMUtils.defineLazyGetter(this, 'strings', function() {
	return Services.strings.createBundle('chrome://newtabtools/locale/newTabTools.properties');
});

/* globals CustomizableUI, GridPrefs, NewTabToolsExporter, NewTabToolsLinks,
	NewTabURL, OS, PageThumbs, Task, TileData */
XPCOMUtils.defineLazyModuleGetter(this, 'CustomizableUI', 'resource:///modules/CustomizableUI.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'GridPrefs', 'chrome://newtabtools/content/newTabTools.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'NewTabToolsExporter', 'chrome://newtabtools/content/export.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'NewTabToolsLinks', 'chrome://newtabtools/content/newTabTools.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'NewTabURL', 'resource:///modules/NewTabURL.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'OS', 'resource://gre/modules/osfile.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'PageThumbs', 'resource://gre/modules/PageThumbs.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'Task', 'resource://gre/modules/Task.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'TileData', 'chrome://newtabtools/content/newTabTools.jsm');

/* globals idleService, annoService, aboutNewTabService */
XPCOMUtils.defineLazyServiceGetter(this, 'idleService', '@mozilla.org/widget/idleservice;1', 'nsIIdleService');
XPCOMUtils.defineLazyServiceGetter(this, 'annoService', '@mozilla.org/browser/annotation-service;1', 'nsIAnnotationService');
XPCOMUtils.defineLazyServiceGetter(this, 'aboutNewTabService', '@mozilla.org/browser/aboutnewtab-service;1', 'nsIAboutNewTabService');

let autocomplete = {};
let userPrefs = Services.prefs.getBranch(EXTENSION_PREFS);

/* exported install, uninstall, startup, shutdown */
function install() {
	// Clean up badly-set prefs from earlier versions
	for (let p of ['toolkit.pageThumbs.minWidth', 'toolkit.pageThumbs.minHeight']) {
		if (Services.prefs.getIntPref(p) === 0) {
			Services.prefs.clearUserPref(p);
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
function uninstall(params, reason) {
	if (reason == ADDON_UNINSTALL) {
		Services.prefs.deleteBranch(EXTENSION_PREFS);
		Services.prefs.clearUserPref('toolkit.pageThumbs.minWidth');
		Services.prefs.clearUserPref('toolkit.pageThumbs.minHeight');
	}
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

	if (reason == ADDON_UPGRADE) {
		for (let url of annoService.getPagesWithAnnotation('newtabtools/title')) {
			TileData.set(url.spec, 'title', annoService.getPageAnnotation(url, 'newtabtools/title'));
			annoService.removePageAnnotation(url, 'newtabtools/title');
		}
	}

	prefObserver.init();
	Services.obs.addObserver(notificationObserver, 'newtabtools-change', false);

	enumerateTabs(function(win) {
		win.location.reload();
	});

	let windowEnum = Services.wm.getEnumerator(BROWSER_WINDOW);
	while (windowEnum.hasMoreElements()) {
		windowObserver.paint(windowEnum.getNext());
	}
	Services.ww.registerNotification(windowObserver);

	Services.obs.addObserver(optionsObserver, 'addon-options-displayed', false);
	expirationFilter.init();
	messageListener.init();

	AddonManager.addAddonListener({
		// If we call reload in shutdown, the page override is
		// still in place, and we don't want that.
		onDisabled: function(addon) {
			AddonManager.removeAddonListener(this);
			if (addon.id == ADDON_ID) {
				enumerateTabs(function(win) {
					win.location.reload();
				});
			}
		}
	});

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

	CustomizableUI.createWidget({
		id: 'newtabtools-capture-thumb-widget',
		defaultArea: CustomizableUI.AREA_PANEL,
		label: strings.GetStringFromName('toolsmenu.captureThumbnail'),
		tooltiptext: strings.GetStringFromName('toolsmenu.captureThumbnail'),
		onCommand: function(event) {
			windowObserver.captureThumbnail(event.view);
		}
	});

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

	let windowEnum = Services.wm.getEnumerator(BROWSER_WINDOW);
	while (windowEnum.hasMoreElements()) {
		windowObserver.unpaint(windowEnum.getNext());
	}
	Services.ww.unregisterNotification(windowObserver);

	prefObserver.destroy();
	Services.obs.removeObserver(notificationObserver, 'newtabtools-change');

	Services.obs.removeObserver(optionsObserver, 'addon-options-displayed');
	Cu.unload('chrome://newtabtools/content/export.jsm');
	Cu.unload('chrome://newtabtools/content/newTabTools.jsm');

	expirationFilter.cleanup();
	messageListener.destroy();

	CustomizableUI.destroyWidget('newtabtools-capture-thumb-widget');

	try {
		idleService.removeIdleObserver(idleObserver, IDLE_TIMEOUT);
	} catch (e) { // might be already removed
	}

	componentRegistrar.unregisterFactory(
		autocomplete.HostsAutoCompleteSearch.prototype.classID,
		autocomplete.NSGetFactory(autocomplete.HostsAutoCompleteSearch.prototype.classID)
	);
}

function uiStartup(params, reason) {
	let overridden = false;
	let reset;
	if (Services.vc.compare(Services.appinfo.platformVersion, 44) >= 0) {
		overridden = aboutNewTabService.overridden;
		reset = aboutNewTabService.resetNewTabURL;
	} else {
		overridden = NewTabURL.overridden;
		reset = NewTabURL.reset;
	}

	if (overridden) {
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
						reset();
					}
				}]
			);
		}, reason == APP_STARTUP ? 1000 : 0);
	}

	Services.scriptloader.loadSubScript(params.resourceURI.spec + 'components/autocomplete.js', autocomplete);
	componentRegistrar.registerFactory(
		autocomplete.HostsAutoCompleteSearch.prototype.classID,
		'',
		autocomplete.HostsAutoCompleteSearch.prototype.contractID,
		autocomplete.NSGetFactory(autocomplete.HostsAutoCompleteSearch.prototype.classID)
	);
}

var prefObserver = {
	init: function() {
		userPrefs.addObserver('', this, false);
		Services.prefs.addObserver('browser.newtabpage.blocked', this, false);
		Services.prefs.addObserver('browser.newtabpage.pinned', this, false);
	},
	destroy: function() {
		userPrefs.removeObserver('', prefObserver);
		Services.prefs.removeObserver('browser.newtabpage.blocked', prefObserver);
		Services.prefs.removeObserver('browser.newtabpage.pinned', prefObserver);
	},
	observe: function(subject, topic, data) {
		switch (data) {
		case 'browser.newtabpage.blocked':
		case 'browser.newtabpage.pinned':
			NewTabToolsLinks.clearCache();
			break;
		case 'grid.margin':
		case 'grid.spacing':
		case 'launcher':
		case 'locked':
		case 'foreground.opacity':
		case 'theme':
		case 'thumbs.contain':
		case 'thumbs.hidebuttons':
		case 'thumbs.hidefavicons':
		case 'thumbs.titlesize':
			enumerateTabs(function(win) {
				win.newTabTools.updateUI();
			});
			break;
		case 'recent.show':
			enumerateTabs(function(win) {
				win.newTabTools.refreshRecent();
			});
			break;
		case 'columns':
		case 'rows':
			enumerateTabs(function(win) {
				win.Grid.refresh();
				win.newTabTools.updateGridPrefs();
			});
			break;
		case 'filter':
			NewTabToolsLinks.clearCache();
			enumerateTabs(function(win) {
				win.Updater.updateGrid();
			});
			break;
		case 'historytiles.show':
			NewTabToolsLinks.clearCache();
			enumerateTabs(function(win) {
				win.newTabTools.updateUI();
				win.Updater.fastUpdateGrid();
			});
			break;
		}
	}
};

var notificationObserver = {
	observe: function(subject, topic, data) {
		switch (data) {
		case 'background':
			enumerateTabs(function(win) {
				win.newTabTools.refreshBackgroundImage();
			});
			break;
		case 'backgroundColor':
		case 'thumbnail':
		case 'title':
			enumerateTabs(function(win) {
				subject.QueryInterface(Ci.nsISupportsString);
				win.newTabTools.onTileChanged(subject.data, data);
			});
			break;
		}
	}
};

var windowObserver = {
	ICON_CSS_PIDATA: 'href="chrome://newtabtools/content/browser.css" type="text/css"',
	observe: function(subject) {
		subject.addEventListener('load', function() {
			windowObserver.paint(subject);
		}, false);
	},
	paint: function(win) {
		if (win.location == 'chrome://browser/content/browser.xul') {
			let doc = win.document;
			doc.addEventListener('TabOpen', this.onTabOpen, false);

			let menu = doc.getElementById('contentAreaContextMenu');
			menu.addEventListener('popupshowing', this.onPopupShowing);

			let before = doc.getElementById('context-sep-open').nextElementSibling;

			let menuseparator = doc.createElementNS(XULNS, 'menuseparator');
			menuseparator.id = 'newtabtools-separator';
			menuseparator.className = 'newtabtools-item';
			menu.insertBefore(menuseparator, before);
			before = menuseparator;

			let menuitem;

			for (let action of ['block', 'unpin', 'pin', 'edit']) {
				menuitem = doc.createElementNS(XULNS, 'menuitem');
				menuitem.id = 'newtabtools-' + action + 'tile';
				menuitem.className = 'newtabtools-item';
				menuitem.setAttribute('label', strings.GetStringFromName('contextmenu.' + action));
				menuitem.addEventListener('command', this.onEditItemClicked);
				menu.insertBefore(menuitem, before);
				before = menuitem;
			}

			for (let action of ['options']) {
				menuitem = doc.createElementNS(XULNS, 'menuitem');
				menuitem.id = 'newtabtools-' + action;
				menuitem.className = 'newtabtools-page';
				menuitem.setAttribute('label', strings.GetStringFromName(
					'contextmenu.' + action + (Services.appinfo.OS == 'WINNT' ? 'Windows' : 'Unix')
				));
				menuitem.addEventListener('command', this.onEditItemClicked);
				menu.insertBefore(menuitem, before);
				before = menuitem;
			}

			NewTabUtils.links.populateCache(function() {
				win.gBrowserThumbnails.__oldTopSiteURLs = win.gBrowserThumbnails.__lookupGetter__('_topSiteURLs');
				win.gBrowserThumbnails.__defineGetter__('_topSiteURLs', function() {
					return NewTabToolsLinks.getLinks().reduce((urls, link) => {
						if (link)
							urls.push(link.url);
						return urls;
					}, []);
				});
			});

			menuitem = doc.createElementNS(XULNS, 'menuitem');
			menuitem.id = 'newtabtools-capture';
			menuitem.setAttribute('label', strings.GetStringFromName('toolsmenu.captureThumbnail'));
			menuitem.addEventListener('command', function() {
				windowObserver.captureThumbnail(win);
			});
			doc.getElementById('menu_ToolsPopup').appendChild(menuitem);

			let pi = doc.createProcessingInstruction('xml-stylesheet', this.ICON_CSS_PIDATA);
			doc.insertBefore(pi, doc.getElementById('main-window'));
		}
	},
	unpaint: function(win) {
		if (win.location == 'chrome://browser/content/browser.xul') {
			let doc = win.document;
			doc.removeEventListener('TabOpen', this.onTabOpen, false);

			let menu = doc.getElementById('contentAreaContextMenu');
			menu.removeEventListener('popupshowing', this.onPopupShowing);
			for (let item of menu.querySelectorAll('.newtabtools-item, .newtabtools-page')) {
				item.remove();
			}

			doc.getElementById('newtabtools-capture').remove();

			for (let node of doc.childNodes) {
				if (node.nodeType == doc.PROCESSING_INSTRUCTION_NODE && node.data == this.ICON_CSS_PIDATA) {
					doc.removeChild(node);
					break;
				}
			}

			win.gBrowserThumbnails.__defineGetter__('_topSiteURLs', win.gBrowserThumbnails.__oldTopSiteURLs);
			delete win.gBrowserThumbnails.__oldTopSiteURLs;
		}
	},
	onTabOpen: function(event) {
		let browser = event.target.linkedBrowser;
		if (browser.currentURI.spec == 'about:newtab') {
			browser.contentWindow.newTabTools.onVisible();
		}
	},
	onEditItemClicked: function(event) {
		let doc = event.view.document;
		let target = windowObserver.findCellTarget(doc);

		switch (event.target.id) {
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
	onPopupShowing: function(event) {
		let doc = event.view.document;
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
	findCellTarget: function(doc) {
		// This probably isn't going to work once about:newtab is put in a content process.
		let target = doc.popupNode;
		if (!target || !target.ownerDocument.location ||
				target.ownerDocument.location.href != 'about:newtab') {
			return null;
		}

		while (target && target.classList && !target.classList.contains('newtab-cell')) {
			target = target.parentNode;
		}
		return (
			target && target.classList &&
			target.classList.contains('newtab-cell') && !!target._newtabCell.site
		) ? target : null;
	},
	captureThumbnail: function(win) {
		PageThumbs.captureAndStore(win.gBrowser.selectedBrowser);
		win.gBrowser.selectedBrowser.animate({ opacity: [0, 1] }, 500);
		let audioURL = Services.vc.compare(Services.appinfo.version, '50') < 0 ?
			'resource://devtools/client/responsive.html/audio/camera-click.mp3' :
			'resource://devtools/client/themes/audio/shutter.wav';
		new win.Audio(audioURL).play();
	}
};

function enumerateTabs(callback) {
	for (let page of NewTabUtils.allPages._pages) {
		try {
			let global = Cu.getGlobalForObject(page);
			callback(global);
		} catch (e) {
			Cu.reportError(e);
		}
	}
}

var optionsObserver = {
	observe: function(doc, topic, data) {
		switch (topic) {
		case 'addon-options-displayed':
			if (data != ADDON_ID) {
				return;
			}

			doc.getElementById('newtabtools.export').addEventListener('command', () => {
				NewTabToolsExporter.doExport();
			});
			doc.getElementById('newtabtools.import').addEventListener('command', () => {
				NewTabToolsExporter.doImport();
			});
		}
	},
};

var expirationFilter = {
	init: function() {
		PageThumbs.addExpirationFilter(this);
	},

	cleanup: function() {
		PageThumbs.removeExpirationFilter(this);
	},

	filterForThumbnailExpiration: function(callback) {
		NewTabUtils.links.populateCache(function() {
			let count = GridPrefs.gridColumns * GridPrefs.gridRows + 10;
			let urls = [];

			// Add all URLs to the list that we want to keep thumbnails for.
			for (let link of NewTabToolsLinks.getLinks().slice(0, count)) {
				if (link && link.url)
					urls.push(link.url);
			}

			callback(urls);
		});
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
		let message = strings.formatStringFromName('newversion', [parseFloat(version, 10)], 1);
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
