/* exported EXPORTED_SYMBOLS, NewTabToolsDataCollector */
var EXPORTED_SYMBOLS = ['NewTabToolsDataCollector'];

/* globals Components, Services, XPCOMUtils */
Components.utils.import('resource://gre/modules/Services.jsm');
Components.utils.import('resource://gre/modules/XPCOMUtils.jsm');

/* globals Preferences, OS, Task */
XPCOMUtils.defineLazyModuleGetter(this, 'Preferences', 'resource://gre/modules/Preferences.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'OS', 'resource://gre/modules/osfile.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'Task', 'resource://gre/modules/Task.jsm');

/* globals idleService */
XPCOMUtils.defineLazyServiceGetter(this, 'idleService', '@mozilla.org/widget/idleservice;1', 'nsIIdleService');

var collectionURL = 'https://www.darktrojan.net/data-collection/experiment2.php';
var activeFrom = Date.UTC(2016, 1, 1);
var activeUntil = Date.UTC(2016, 2, 1);
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

var gatherData = Task.async(function*() {
	let data = new Services.appShell.hiddenDOMWindow.FormData();
	let prefs = [
		'columns',
		'foreground.opacity',
		'rows',
		'theme',
		'thumbs.prefs.delay'
	];
	for (let p of prefs) {
		data.set(
			'pref' + p.replace(/(^|\.)([a-z])/g, (...m) => m[2].toUpperCase()),
			Preferences.get('extensions.newtabtools.' + p)
		);
	}
	data.set('thumbsHeight', Preferences.get('toolkit.pageThumbs.minHeight'));
	data.set('thumbsWidth', Preferences.get('toolkit.pageThumbs.minWidth'));

	data.set(
		'backgroundFileExists',
		yield OS.File.exists(OS.Path.join(OS.Constants.Path.profileDir, 'newtab-background'))
	);

	let chromeRegistry = Components.classes['@mozilla.org/chrome/chrome-registry;1']
		.getService(Components.interfaces.nsIXULChromeRegistry);
	data.set('firefoxLocale', chromeRegistry.getSelectedLocale('browser'));
	data.set('firefoxVersion', parseInt(Services.appinfo.version, 10));

	return data;
});

function report() {
	if (!NewTabToolsDataCollector.active || !NewTabToolsDataCollector.shouldReport) {
		return;
	}

	gatherData().then(function(data) {
		Services.appShell.hiddenDOMWindow.fetch(collectionURL, {
			method: 'POST',
			body: data
		});
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
