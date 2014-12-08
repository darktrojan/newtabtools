const EXPORTED_SYMBOLS = ["NewTabToolsExporter"];

const PR_RDWR = 0x04;
const PR_CREATE_FILE = 0x08;
const PR_TRUNCATE = 0x20;

Components.utils.import("resource://gre/modules/FileUtils.jsm");
Components.utils.import("resource://gre/modules/NewTabUtils.jsm");
Components.utils.import("resource://gre/modules/PageThumbs.jsm");
Components.utils.import("resource://gre/modules/Promise.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyServiceGetter(this, "annoService", "@mozilla.org/browser/annotation-service;1", Components.interfaces.nsIAnnotationService);
XPCOMUtils.defineLazyGetter(this, "strings", function() {
	return Services.strings.createBundle("chrome://newtabtools/locale/export.properties");
});

let NewTabToolsExporter = {
	doExport: function doExport() {
		exportShowOptionDialog()
			.then(exportShowFilePicker)
			.then(exportSave)
			.then(null, Components.utils.reportError);
	},
	doImport: function doImport() {
		importShowFilePicker()
			.then(importLoad)
			.then(importSave)
			.then(null, Components.utils.reportError);
	}
};

function getWindow() {
	return Services.wm.getMostRecentWindow("navigator:browser");
}

function exportShowOptionDialog() {
	let deferred = Promise.defer();

	let returnValues = {
		cancelled: true
	};
	let done = function() {
		if (returnValues.cancelled) {
			deferred.reject("New Tab Tools export cancelled.");
		} else {
			deferred.resolve(returnValues);
		}
	};

	let dialog = getWindow().openDialog("chrome://newtabtools/content/exportDialog.xul", "newtabtools-export", "centerscreen", returnValues, done);
	return deferred.promise;
}

function exportShowFilePicker(aReturnValues) {
	let deferred = Promise.defer();

	let picker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
	picker.init(getWindow(), strings.GetStringFromName("picker.title.export"), Components.interfaces.nsIFilePicker.modeSave);
	picker.appendFilter(strings.GetStringFromName("picker.filter"), "*.zip");
	picker.defaultExtension = "zip";
	picker.defaultString = "newtabtools.zip";
	picker.open(function(aResult) {
		if (aResult == Components.interfaces.nsIFilePicker.returnCancel) {
			deferred.reject("New Tab Tools export cancelled.");
		} else {
			aReturnValues.file = picker.file;
			deferred.resolve(aReturnValues);
		}
	});

	return deferred.promise;
}

function exportSave(aReturnValues) {
	let zipWriter = Components.classes["@mozilla.org/zipwriter;1"].createInstance(Components.interfaces.nsIZipWriter);
	zipWriter.open(aReturnValues.file, PR_RDWR | PR_CREATE_FILE | PR_TRUNCATE);

	{
		let annos = [];
		for (let [name, enabled] of Iterator(aReturnValues.options.annos)) {
			if (enabled) {
				annos.push("newtabtools/" + name);
			}
		}
		let pages = {};
		for (let a of annos) {
			pages[a] = {};
			for (let p of annoService.getPagesWithAnnotation(a)) {
					pages[a][p.spec] = annoService.getPageAnnotation(p, a);
			}
		}

		let stream = Components.classes["@mozilla.org/io/string-input-stream;1"].createInstance(Components.interfaces.nsIStringInputStream);
		let data = JSON.stringify(pages);
		stream.setData(data, data.length);
		zipWriter.addEntryStream("annos.json", Date.now() * 1000, Components.interfaces.nsIZipWriter.COMPRESSION_DEFAULT, stream, false);
	}
	{
		let keys = []
		for (let [name, enabled] of Iterator(aReturnValues.options.prefs)) {
			if (enabled) {
				switch (name) {
				case "gridsize":
					keys.push("extensions.newtabtools.columns", "extensions.newtabtools.rows");
					break;
				case "gridmargin":
					keys.push("extensions.newtabtools.grid.margin", "extensions.newtabtools.grid.spacing");
					break;
				case "thumbs.position":
					keys.push("extensions.newtabtools.thumbs.contain");
					break;
				case "blocked":
				case "pinned":
					keys.push("browser.newtabpage." + name);
					break;
				case "launcher":
				case "recent.show":
				case "theme":
				case "thumbs.hidebuttons":
				case "thumbs.hidefavicons":
					keys.push("extensions.newtabtools." + name);
					break;
				}
			}
		}
		let prefs = {};
		for (let k of keys) {
			switch (Services.prefs.getPrefType(k)) {
			case Components.interfaces.nsIPrefBranch.PREF_STRING:
				prefs[k] = Services.prefs.getCharPref(k);
				break;
			case Components.interfaces.nsIPrefBranch.PREF_INT:
				prefs[k] = Services.prefs.getIntPref(k);
				break;
			case Components.interfaces.nsIPrefBranch.PREF_BOOL:
				prefs[k] = Services.prefs.getBoolPref(k);
				break;
			}
		}

		let stream = Components.classes["@mozilla.org/io/string-input-stream;1"].createInstance(Components.interfaces.nsIStringInputStream);
		let data = JSON.stringify(prefs);
		stream.setData(data, data.length);
		zipWriter.addEntryStream("prefs.json", Date.now() * 1000, Components.interfaces.nsIZipWriter.COMPRESSION_DEFAULT, stream, false);
	}
	if (aReturnValues.options.tiles.thumbs) {
		zipWriter.addEntryDirectory("thumbnails/", Date.now() * 1000, false);

		let count = Math.floor(Services.prefs.getIntPref("extensions.newtabtools.columns") * Services.prefs.getIntPref("extensions.newtabtools.rows") * 1.5);

		for (let l of NewTabUtils.links.getLinks().slice(0, count)) {
			let f = new FileUtils.File(PageThumbsStorage.getFilePathForURL(l.url));
			if (f.exists() && !f.isWritable()) {
				if (zipWriter.hasEntry("thumbnails/" + f.leafName)) {
					zipWriter.removeEntry("thumbnails/" + f.leafName, false);
				}
				zipWriter.addEntryFile("thumbnails/" + f.leafName, Components.interfaces.nsIZipWriter.COMPRESSION_DEFAULT, f, false);
			}
		}
	}
	if (aReturnValues.options.page.background) {
		let backgroundFile = FileUtils.getFile("ProfD", ["newtab-background"]);
		if (backgroundFile.exists()) {
			zipWriter.addEntryFile("newtab-background", Components.interfaces.nsIZipWriter.COMPRESSION_DEFAULT, backgroundFile, false);
		}
	}

	zipWriter.close();
}

function importShowFilePicker() {
	let deferred = Promise.defer();

	let picker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
	picker.init(getWindow(), strings.GetStringFromName("picker.title.import"), Components.interfaces.nsIFilePicker.modeOpen);
	picker.appendFilter(strings.GetStringFromName("picker.filter"), "*.zip");
	picker.defaultExtension = "zip";
	picker.open(function(aResult) {
		if (aResult == Components.interfaces.nsIFilePicker.returnCancel) {
			deferred.reject("New Tab Tools import cancelled.");
		} else {
			deferred.resolve(picker.file);
		}
	});

	return deferred.promise;
}

function importLoad(aFile) {
	let deferred = Promise.defer();

	let returnValues = {
		importing: true,
		cancelled: true,
		file: aFile
	};

	let zipReader = Components.classes["@mozilla.org/libjar/zip-reader;1"].createInstance(Components.interfaces.nsIZipReader);
	try {
		zipReader.open(aFile);

		{
			returnValues.annos = readZippedJSON(zipReader, "annos.json");
			returnValues.prefs = readZippedJSON(zipReader, "prefs.json");
		}
		{
			let thumbnails = [];
			let enumerator = zipReader.findEntries("thumbnails/*");
			while (enumerator.hasMore()) {
				let e = enumerator.getNext();
				if (e != "thumbnails/") {
					thumbnails.push(e);
				}
			}
			returnValues.thumbnails = thumbnails;
		}
		{
			returnValues.hasBackgroundImage = zipReader.hasEntry("newtab-background");
		}

	} finally {
		zipReader.close();
	}

	let done = function() {
		if (returnValues.cancelled) {
			deferred.reject("New Tab Tools import cancelled.");
		} else {
			deferred.resolve(returnValues);
		}
	};

	let dialog = getWindow().openDialog("chrome://newtabtools/content/exportDialog.xul", "newtabtools-export", "centerscreen", returnValues, done);
	return deferred.promise;
}

function readZippedJSON(aZipReader, aFilePath) {
	if (aZipReader.hasEntry(aFilePath)) {
		let stream = aZipReader.getInputStream(aFilePath);
		let scriptableStream = Components.classes["@mozilla.org/scriptableinputstream;1"].createInstance(Components.interfaces.nsIScriptableInputStream);
		scriptableStream.init(stream);

		let data = scriptableStream.read(scriptableStream.available());
		return JSON.parse(data);
	}
	return {};
}

function importSave(aReturnValues) {
	let zipReader = Components.classes["@mozilla.org/libjar/zip-reader;1"].createInstance(Components.interfaces.nsIZipReader);
	try {
		zipReader.open(aReturnValues.file);

		{
			for (let [name, enabled] of Iterator(aReturnValues.options.annos)) {
				// can't be enabled and not in aReturnValues.annos, but check anyway
				if (!enabled || !(name in aReturnValues.annos)) {
					continue;
				}
				let data = aReturnValues.annos[name];
				for (let [page, value] of Iterator(data)) {
					try {
						let uri = Services.io.newURI(page, null, null);
						annoService.setPageAnnotation(uri, name, value, 0, annoService.EXPIRE_WITH_HISTORY);
					} catch(e) {
						Components.utils.reportError(e);
					}
				}
			}
		}
		{
			function copyPref(aName) {
				let value = aReturnValues.prefs[aName];
				try {
					switch (typeof value) {
					case "string":
						Services.prefs.setCharPref(aName, value);
						break;
					case "number":
						Services.prefs.setIntPref(aName, value);
						break;
					case "boolean":
						Services.prefs.setBoolPref(aName, value);
						break;
					}
				} catch(e) {
					Components.utils.reportError(e);
				}
			}

			for (let [name, enabled] of Iterator(aReturnValues.options.prefs)) {
				if (!enabled) {
					continue;
				}
				if (name == "gridsize") {
					copyPref("extensions.newtabtools.columns");
					copyPref("extensions.newtabtools.rows");
				} else if (name == "gridmargin") {
					copyPref("extensions.newtabtools.grid.margin");
					copyPref("extensions.newtabtools.grid.spacing");
				} else if (name == "thumbs.position") {
					copyPref("extensions.newtabtools.thumbs.contain");
				} else if (("browser.newtabpage." + name) in aReturnValues.prefs) {
					copyPref("browser.newtabpage." + name);
				} else if (("extensions.newtabtools." + name) in aReturnValues.prefs) {
					copyPref("extensions.newtabtools." + name);
				}
			}
		}
		if (aReturnValues.options.tiles.thumbs) {
			let thumbsDirectory = new FileUtils.File(PageThumbsStorage.path);
			for (let file of aReturnValues.thumbnails) {
				let thumbFile = thumbsDirectory.clone();
				thumbFile.append(file.substring(11)); // length of "thumbnails/"
				zipReader.extract(file, thumbFile);
			}
		}
		// can't be enabled and not exist, but check anyway
		if (aReturnValues.options.page.background && aReturnValues.hasBackgroundImage) {
			zipReader.extract("newtab-background", FileUtils.getFile("ProfD", ["newtab-background"]));
		}
	} finally {
		zipReader.close();
	}
}
