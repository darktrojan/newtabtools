/* exported EXPORTED_SYMBOLS, NewTabToolsDataCollector */
var EXPORTED_SYMBOLS = ['NewTabToolsDataCollector'];

/* globals Components, Services, XPCOMUtils */
Components.utils.import('resource://gre/modules/Services.jsm');
Components.utils.import('resource://gre/modules/XPCOMUtils.jsm');

/* globals BackgroundImage, Preferences, SavedThumbs, TileData */
XPCOMUtils.defineLazyModuleGetter(this, 'BackgroundImage', 'chrome://newtabtools/content/newTabTools.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'Preferences', 'resource://gre/modules/Preferences.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'SavedThumbs', 'chrome://newtabtools/content/newTabTools.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'TileData', 'chrome://newtabtools/content/newTabTools.jsm');

/* globals idleService */
XPCOMUtils.defineLazyServiceGetter(this, 'idleService', '@mozilla.org/widget/idleservice;1', 'nsIIdleService');

var collectionURL = 'https://www.darktrojan.net/data-collection/experiment1.php';
var activeFrom = Date.UTC(2016, 0, 1);
var activeUntil = Date.UTC(2016, 1, 1);
var prefs = Services.prefs.getBranch('extensions.newtabtools.datacollection.');

var NewTabToolsDataCollector = {
	get active() {
		return prefs.getBoolPref('optin') && Date.now() < activeUntil;
	},
	get shouldReport() {
		return !prefs.prefHasUserValue('lastreport') ||
			prefs.getIntPref('lastreport') * 1000 < activeFrom;
	},
	initReport: function() {
		idleService.addIdleObserver(idleObserver, idleObserver.timeout);
	}
};

function gatherData() {
	let data = new Services.appShell.hiddenDOMWindow.FormData();
	let prefs = [
		'columns',
		'foreground.opacity',
		'grid.margin',
		'grid.spacing',
		'launcher',
		'recent.show',
		'rows',
		'theme',
		'thumbs.contain',
		'thumbs.hidebuttons',
		'thumbs.hidefavicons',
		'thumbs.titlesize'
	];
	for (let p of prefs) {
		data.set(
			'pref' + p.replace(/(^|\.)([a-z])/g, (...m) => m[2].toUpperCase()),
			Preferences.get('extensions.newtabtools.' + p)
		);
	}

	let tileDataData = [...TileData._data].reduce((previous, current) => {
		if (current[1].has('backgroundColor')) {
			previous.backgroundColor++;
		}
		if (current[1].has('title')) {
			previous.title++;
		}
		return previous;
	}, { backgroundColor: 0, title: 0 });
	data.set('tileBackgroundColor', tileDataData.backgroundColor);
	data.set('tileTitle', tileDataData.title);
	data.set('backgroundMode', BackgroundImage.mode);
	data.set('customThumbnails', SavedThumbs._list.size);
	return data;
}

function report() {
	if (!NewTabToolsDataCollector.active || !NewTabToolsDataCollector.shouldReport) {
		return;
	}

	Services.appShell.hiddenDOMWindow.fetch(collectionURL, {
		method: 'POST',
		body: gatherData()
	});
	prefs.setIntPref('lastreport', Math.floor(Date.now() / 1000));
}

var idleObserver = {
	timeout: 60,
	observe: function(service, state) {
		if (state != 'idle') {
			return;
		}
		idleService.removeIdleObserver(this, this.timeout);
		report();
	}
};
