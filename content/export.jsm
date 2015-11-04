/* exported NewTabToolsExporter */
this.EXPORTED_SYMBOLS = ["NewTabToolsExporter"];

const PR_RDWR = 0x04;
const PR_CREATE_FILE = 0x08;
const PR_TRUNCATE = 0x20;

/* globals Components, FileUtils, Services, XPCOMUtils, Iterator, -name */
let { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

/* globals strings, OS, SavedThumbs, TileData */
XPCOMUtils.defineLazyGetter(this, "strings", function() {
	return Services.strings.createBundle("chrome://newtabtools/locale/export.properties");
});
XPCOMUtils.defineLazyModuleGetter(this, "OS", "resource://gre/modules/osfile.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "SavedThumbs", "chrome://newtabtools/content/newTabTools.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "TileData", "chrome://newtabtools/content/newTabTools.jsm");

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
	return Services.wm.getMostRecentWindow("navigator:browser");
}

function exportShowOptionDialog() {
	return new Promise(function(resolve, reject) {
		let returnValues = {
			cancelled: true
		};
		let done = function() {
			if (returnValues.cancelled) {
				reject("New Tab Tools export cancelled.");
			} else {
				resolve(returnValues);
			}
		};

		getWindow().openDialog(
			"chrome://newtabtools/content/exportDialog.xul",
			"newtabtools-export", "centerscreen", returnValues, done
		);
	});
}

function exportShowFilePicker(aReturnValues) {
	return new Promise(function(resolve, reject) {
		let picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
		picker.init(getWindow(), strings.GetStringFromName("picker.title.export"), Ci.nsIFilePicker.modeSave);
		picker.appendFilter(strings.GetStringFromName("picker.filter"), "*.zip");
		picker.defaultExtension = "zip";
		picker.defaultString = "newtabtools.zip";
		picker.open(function(aResult) {
			if (aResult == Ci.nsIFilePicker.returnCancel) {
				reject("New Tab Tools export cancelled.");
			} else {
				aReturnValues.file = picker.file;
				resolve(aReturnValues);
			}
		});
	});
}

function exportSave(aReturnValues) {
	return new Promise(function(resolve) {
		let zipWriter = Cc["@mozilla.org/zipwriter;1"].createInstance(Ci.nsIZipWriter);
		zipWriter.open(aReturnValues.file, PR_RDWR | PR_CREATE_FILE | PR_TRUNCATE);

		let keys = [];
		for (let [name, enabled] of Iterator(aReturnValues.options.prefs)) {
			if (enabled) {
				switch (name) {
				case "gridsize":
					keys.push("extensions.newtabtools.columns", "extensions.newtabtools.rows");
					break;
				case "gridmargin":
					keys.push(
						"extensions.newtabtools.grid.margin",
						"extensions.newtabtools.grid.spacing",
						"extensions.newtabtools.thumbs.titlesize"
					);
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
				case "tiledata":
					keys.push("extensions.newtabtools." + name);
					break;
				}
			}
		}
		let prefs = {};
		for (let k of keys) {
			switch (Services.prefs.getPrefType(k)) {
			case Ci.nsIPrefBranch.PREF_STRING:
				prefs[k] = Services.prefs.getCharPref(k);
				break;
			case Ci.nsIPrefBranch.PREF_INT:
				prefs[k] = Services.prefs.getIntPref(k);
				break;
			case Ci.nsIPrefBranch.PREF_BOOL:
				prefs[k] = Services.prefs.getBoolPref(k);
				break;
			}
		}

		let stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
		let data = JSON.stringify(prefs);
		stream.setData(data, data.length);
		zipWriter.addEntryStream("prefs.json", Date.now() * 1000, Ci.nsIZipWriter.COMPRESSION_DEFAULT, stream, false);

		if (aReturnValues.options.page.background) {
			let backgroundFile = FileUtils.getFile("ProfD", ["newtab-background"]);
			if (backgroundFile.exists()) {
				zipWriter.addEntryFile("newtab-background", Ci.nsIZipWriter.COMPRESSION_DEFAULT, backgroundFile, false);
			}
		}
		if (aReturnValues.options.tiles.thumbs) {
			zipWriter.addEntryDirectory("thumbnails/", Date.now() * 1000, false);

			let thumbDir = SavedThumbs.thumbnailDirectory;
			let iterator = new OS.File.DirectoryIterator(thumbDir);
			iterator.forEach((entry) => {
				let f = new FileUtils.File(entry.path);
				if (zipWriter.hasEntry("thumbnails/" + entry.name)) {
					zipWriter.removeEntry("thumbnails/" + entry.name, false);
				}
				zipWriter.addEntryFile("thumbnails/" + entry.name, Ci.nsIZipWriter.COMPRESSION_DEFAULT, f, false);
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
		let picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
		picker.init(getWindow(), strings.GetStringFromName("picker.title.import"), Ci.nsIFilePicker.modeOpen);
		picker.appendFilter(strings.GetStringFromName("picker.filter"), "*.zip");
		picker.defaultExtension = "zip";
		picker.open(function(aResult) {
			if (aResult == Ci.nsIFilePicker.returnCancel) {
				reject("New Tab Tools import cancelled.");
			} else {
				resolve(picker.file);
			}
		});
	});
}

function importLoad(aFile) {
	return new Promise(function(resolve, reject) {
		let returnValues = {
			importing: true,
			cancelled: true,
			file: aFile
		};

		let zipReader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(Ci.nsIZipReader);
		try {
			zipReader.open(aFile);

			returnValues.annos = readZippedJSON(zipReader, "annos.json");
			returnValues.prefs = readZippedJSON(zipReader, "prefs.json");

			let thumbnails = [];
			let enumerator = zipReader.findEntries("thumbnails/*");
			while (enumerator.hasMore()) {
				let e = enumerator.getNext();
				if (e != "thumbnails/") {
					thumbnails.push(e);
				}
			}
			returnValues.thumbnails = thumbnails;
			returnValues.hasBackgroundImage = zipReader.hasEntry("newtab-background");
		} finally {
			zipReader.close();
		}

		let done = function() {
			if (returnValues.cancelled) {
				reject("New Tab Tools import cancelled.");
			} else {
				resolve(returnValues);
			}
		};

		getWindow().openDialog(
			"chrome://newtabtools/content/exportDialog.xul",
			"newtabtools-export", "centerscreen", returnValues, done
		);
	});
}

function readZippedJSON(aZipReader, aFilePath) {
	if (aZipReader.hasEntry(aFilePath)) {
		let stream = aZipReader.getInputStream(aFilePath);
		let scriptableStream = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(Ci.nsIScriptableInputStream);
		scriptableStream.init(stream);

		let data = scriptableStream.read(scriptableStream.available());
		return JSON.parse(data);
	}
	return {};
}

function importSave(aReturnValues) {
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
		} catch (e) {
			Cu.reportError(e);
		}
	}

	let zipReader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(Ci.nsIZipReader);
	try {
		zipReader.open(aReturnValues.file);

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
				copyPref("extensions.newtabtools.thumbs.titlesize");
			} else if (name == "thumbs.position") {
				copyPref("extensions.newtabtools.thumbs.contain");
			} else if (name == "tiledata") {
				if (aReturnValues.annos["newtabtools/title"]) {
					let data = aReturnValues.annos["newtabtools/title"];
					for (let [url, value] of Iterator(data)) {
						TileData.set(url, "title", value);
					}
				} else if (aReturnValues.prefs["extensions.newtabtools.tiledata"]) {
					let data = JSON.parse(aReturnValues.prefs["extensions.newtabtools.tiledata"]);
					for (let [url, urlData] of Iterator(data)) {
						for (let [key, value] of Iterator(urlData)) {
							TileData.set(url, key, value);
						}
					}
				}
			} else if (("browser.newtabpage." + name) in aReturnValues.prefs) {
				copyPref("browser.newtabpage." + name);
			} else if (("extensions.newtabtools." + name) in aReturnValues.prefs) {
				copyPref("extensions.newtabtools." + name);
			}
		}

		if (aReturnValues.options.tiles.thumbs) {
			let thumbsDirectory = new FileUtils.File(SavedThumbs.thumbnailDirectory);
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
