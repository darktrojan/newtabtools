/* exported NewTabToolsExporter */
this.EXPORTED_SYMBOLS = ['NewTabToolsExporter'];

const PR_RDWR = 0x04;
const PR_CREATE_FILE = 0x08;
const PR_TRUNCATE = 0x20;

/* globals Components, FileUtils, Services, XPCOMUtils, Iterator, -name */
let { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import('resource://gre/modules/FileUtils.jsm');
Cu.import('resource://gre/modules/Services.jsm');
Cu.import('resource://gre/modules/XPCOMUtils.jsm');

/* globals picker, strings, OS, Preferences, SavedThumbs, TileData */
XPCOMUtils.defineLazyGetter(this, 'picker', function() {
	let p = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
	p.displayDirectory = Services.dirsvc.get('Home', Ci.nsIFile);
	return p;
});
XPCOMUtils.defineLazyGetter(this, 'strings', function() {
	return Services.strings.createBundle('chrome://newtabtools/locale/export.properties');
});
XPCOMUtils.defineLazyModuleGetter(this, 'OS', 'resource://gre/modules/osfile.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'Preferences', 'resource://gre/modules/Preferences.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'SavedThumbs', 'chrome://newtabtools/content/newTabTools.jsm');
XPCOMUtils.defineLazyModuleGetter(this, 'TileData', 'chrome://newtabtools/content/newTabTools.jsm');

let NewTabToolsExporter = {
	doExport: function doExport() {
		exportShowOptionDialog()
			.then(exportShowFilePicker)
			.then(exportSave)
			.then(null, Cu.reportError);
	},
	doImport: function doImport() {
		importShowFilePicker()
			.then(importLoad)
			.then(importSave)
			.then(null, Cu.reportError);
	}
};

function getWindow() {
	return Services.wm.getMostRecentWindow('navigator:browser');
}

function exportShowOptionDialog() {
	return new Promise(function(resolve, reject) {
		let returnValues = {
			cancelled: true
		};
		let done = function() {
			if (returnValues.cancelled) {
				reject('New Tab Tools export cancelled.');
			} else {
				resolve(returnValues);
			}
		};

		getWindow().openDialog(
			'chrome://newtabtools/content/exportDialog.xul',
			'newtabtools-export', 'centerscreen', returnValues, done
		);
	});
}

function exportShowFilePicker(returnValues) {
	return new Promise(function(resolve, reject) {
		picker.init(getWindow(), strings.GetStringFromName('picker.title.export'), Ci.nsIFilePicker.modeSave);
		picker.appendFilter(strings.GetStringFromName('picker.filter'), '*.zip');
		picker.defaultExtension = 'zip';
		picker.defaultString = 'newtabtools.zip';
		picker.open(function(result) {
			if (result == Ci.nsIFilePicker.returnCancel) {
				reject('New Tab Tools export cancelled.');
			} else {
				picker.displayDirectory = picker.file.parent;
				returnValues.file = picker.file;
				resolve(returnValues);
			}
		});
	});
}

function exportSave(returnValues) {
	return new Promise(function(resolve) {
		let zipWriter = Cc['@mozilla.org/zipwriter;1'].createInstance(Ci.nsIZipWriter);
		zipWriter.open(returnValues.file, PR_RDWR | PR_CREATE_FILE | PR_TRUNCATE);

		let keys = [];
		for (let [name, enabled] of Iterator(returnValues.options.prefs)) {
			if (enabled) {
				switch (name) {
				case 'gridsize':
					keys.push('extensions.newtabtools.columns', 'extensions.newtabtools.rows');
					break;
				case 'gridmargin':
					keys.push(
						'extensions.newtabtools.grid.margin',
						'extensions.newtabtools.grid.spacing',
						'extensions.newtabtools.thumbs.titlesize'
					);
					break;
				case 'thumbs.position':
					keys.push('extensions.newtabtools.thumbs.contain');
					break;
				case 'blocked':
				case 'pinned':
					keys.push('browser.newtabpage.' + name);
					break;
				case 'launcher':
				case 'recent.show':
				case 'theme':
				case 'thumbs.hidebuttons':
				case 'thumbs.hidefavicons':
				case 'tiledata':
				case 'historytiles.show':
				case 'foreground.opacity':
					keys.push('extensions.newtabtools.' + name);
					break;
				}
			}
		}
		let prefs = {};
		for (let k of keys) {
			switch (Services.prefs.getPrefType(k)) {
			case Ci.nsIPrefBranch.PREF_STRING:
				prefs[k] = Preferences.get(k);
				break;
			case Ci.nsIPrefBranch.PREF_INT:
				prefs[k] = Services.prefs.getIntPref(k);
				break;
			case Ci.nsIPrefBranch.PREF_BOOL:
				prefs[k] = Services.prefs.getBoolPref(k);
				break;
			}
		}

		let converter = Cc['@mozilla.org/intl/scriptableunicodeconverter'].createInstance(Ci.nsIScriptableUnicodeConverter);
		converter.charset = 'UTF-8';
		let stream = converter.convertToInputStream(JSON.stringify(prefs));

		zipWriter.addEntryStream('prefs.json', Date.now() * 1000, Ci.nsIZipWriter.COMPRESSION_DEFAULT, stream, false);

		if (returnValues.options.page.background) {
			let backgroundFile = FileUtils.getFile('ProfD', ['newtab-background']);
			if (backgroundFile.exists()) {
				zipWriter.addEntryFile('newtab-background', Ci.nsIZipWriter.COMPRESSION_DEFAULT, backgroundFile, false);
			}
		}
		if (returnValues.options.tiles.thumbs) {
			zipWriter.addEntryDirectory('thumbnails/', Date.now() * 1000, false);

			let thumbDir = SavedThumbs.thumbnailDirectory;
			let iterator = new OS.File.DirectoryIterator(thumbDir);
			iterator.forEach((entry) => {
				let f = new FileUtils.File(entry.path);
				if (zipWriter.hasEntry('thumbnails/' + entry.name)) {
					zipWriter.removeEntry('thumbnails/' + entry.name, false);
				}
				zipWriter.addEntryFile('thumbnails/' + entry.name, Ci.nsIZipWriter.COMPRESSION_DEFAULT, f, false);
			}).then(() => {
				iterator.close();
				finish();
			});
		} else {
			finish();
		}

		function finish() {
			zipWriter.close();
			resolve();
		}
	});
}

function importShowFilePicker() {
	return new Promise(function(resolve, reject) {
		picker.init(getWindow(), strings.GetStringFromName('picker.title.import'), Ci.nsIFilePicker.modeOpen);
		picker.appendFilter(strings.GetStringFromName('picker.filter'), '*.zip');
		picker.defaultExtension = 'zip';
		picker.open(function(result) {
			if (result == Ci.nsIFilePicker.returnCancel) {
				reject('New Tab Tools import cancelled.');
			} else {
				picker.displayDirectory = picker.file.parent;
				resolve(picker.file);
			}
		});
	});
}

function importLoad(file) {
	return new Promise(function(resolve, reject) {
		let returnValues = {
			importing: true,
			cancelled: true,
			file: file
		};

		let zipReader = Cc['@mozilla.org/libjar/zip-reader;1'].createInstance(Ci.nsIZipReader);
		try {
			zipReader.open(file);

			returnValues.annos = readZippedJSON(zipReader, 'annos.json');
			returnValues.prefs = readZippedJSON(zipReader, 'prefs.json');

			let thumbnails = [];
			let enumerator = zipReader.findEntries('thumbnails/*');
			while (enumerator.hasMore()) {
				let e = enumerator.getNext();
				if (e != 'thumbnails/') {
					thumbnails.push(e);
				}
			}
			returnValues.thumbnails = thumbnails;
			returnValues.hasBackgroundImage = zipReader.hasEntry('newtab-background');
		} finally {
			zipReader.close();
		}

		let done = function() {
			if (returnValues.cancelled) {
				reject('New Tab Tools import cancelled.');
			} else {
				resolve(returnValues);
			}
		};

		getWindow().openDialog(
			'chrome://newtabtools/content/exportDialog.xul',
			'newtabtools-export', 'centerscreen', returnValues, done
		);
	});
}

function readZippedJSON(zipReader, filePath) {
	if (zipReader.hasEntry(filePath)) {
		let stream = zipReader.getInputStream(filePath);

		let utf8Stream = Cc['@mozilla.org/intl/converter-input-stream;1'].createInstance(Ci.nsIConverterInputStream);
		utf8Stream.init(stream, 'UTF-8', 8192, Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
		let data = {};
		utf8Stream.readString(8192, data);

		return JSON.parse(data.value);
	}
	return {};
}

function importSave(returnValues) {
	function copyPref(name) {
		let value = returnValues.prefs[name];
		try {
			switch (typeof value) {
			case 'string':
				Preferences.set(name, value);
				break;
			case 'number':
				Services.prefs.setIntPref(name, value);
				break;
			case 'boolean':
				Services.prefs.setBoolPref(name, value);
				break;
			}
		} catch (e) {
			Cu.reportError(e);
		}
	}

	let zipReader = Cc['@mozilla.org/libjar/zip-reader;1'].createInstance(Ci.nsIZipReader);
	try {
		zipReader.open(returnValues.file);

		for (let [name, enabled] of Iterator(returnValues.options.prefs)) {
			if (!enabled) {
				continue;
			}
			if (name == 'gridsize') {
				copyPref('extensions.newtabtools.columns');
				copyPref('extensions.newtabtools.rows');
			} else if (name == 'gridmargin') {
				copyPref('extensions.newtabtools.grid.margin');
				copyPref('extensions.newtabtools.grid.spacing');
				copyPref('extensions.newtabtools.thumbs.titlesize');
			} else if (name == 'thumbs.position') {
				copyPref('extensions.newtabtools.thumbs.contain');
			} else if (name == 'tiledata') {
				if (returnValues.annos['newtabtools/title']) {
					let data = returnValues.annos['newtabtools/title'];
					for (let [url, value] of Iterator(data)) {
						TileData.set(url, 'title', value);
					}
				} else if (returnValues.prefs['extensions.newtabtools.tiledata']) {
					let data = JSON.parse(returnValues.prefs['extensions.newtabtools.tiledata']);
					for (let [url, urlData] of Iterator(data)) {
						for (let [key, value] of Iterator(urlData)) {
							TileData.set(url, key, value);
						}
					}
				}
			} else if (('browser.newtabpage.' + name) in returnValues.prefs) {
				copyPref('browser.newtabpage.' + name);
			} else if (('extensions.newtabtools.' + name) in returnValues.prefs) {
				copyPref('extensions.newtabtools.' + name);
			}
		}

		if (returnValues.options.tiles.thumbs) {
			let thumbsDirectory = new FileUtils.File(SavedThumbs.thumbnailDirectory);
			for (let file of returnValues.thumbnails) {
				let thumbFile = thumbsDirectory.clone();
				thumbFile.append(file.substring(11)); // length of "thumbnails/"
				zipReader.extract(file, thumbFile);
			}
		}
		// can't be enabled and not exist, but check anyway
		if (returnValues.options.page.background && returnValues.hasBackgroundImage) {
			zipReader.extract('newtab-background', FileUtils.getFile('ProfD', ['newtab-background']));
		}
	} finally {
		zipReader.close();
	}
}
