/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* import-globals-from export.js */
/* import-globals-from prefs.js */

Promise.all([
	Prefs.init(),
	initDB()
]).then(function() {
	if (initDB.waitingQueue) {
		for (let waiting of initDB.waitingQueue) {
			waiting.resolve.call();
		}
		delete initDB.waitingQueue;
	}

	let previousVersion = Prefs.version;
	chrome.management.getSelf(function({version: currentVersion}) {
		if (previousVersion != currentVersion) {
			Prefs.version = currentVersion;
			if (previousVersion != -1 &&
					compareVersions(currentVersion, previousVersion) > 0 &&
					(currentVersion.includes('b') || parseFloat(currentVersion, 10) != parseFloat(previousVersion, 10))) {
				Prefs.versionLastUpdate = new Date();
			}
		}
	});
}).catch(function(event) {
	console.error(event);
	db = 'broken';
	if (initDB.waitingQueue) {
		for (let waiting of initDB.waitingQueue) {
			waiting.reject.call();
		}
		delete initDB.waitingQueue;
	}
});

const NEW_TAB_URL = chrome.runtime.getURL('newTab.xhtml');

function getTZDateString(date = new Date()) {
	return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(p => p.toString().padStart(2, '0')).join('-');
}

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
	let today = getTZDateString();

	switch (message.name) {
	case 'Tiles.isPinned':
		Tiles.ensureReady().then(() => {
			sendResponse(Tiles.isPinned(message.url));
		});
		return true;
	case 'Tiles.getAllTiles':
		waitForDB().then(function() {
			return Tiles.getAllTiles();
		}).then(function(tiles) {
			sendResponse({ tiles, list: Tiles._list });
		}).catch(function(event) {
			console.error(event);
			sendResponse(null);
		});
		return true;
	case 'Tiles.getTile':
		Tiles.getTile(message.url).then(sendResponse, console.error);
		return true;
	case 'Tiles.putTile':
		Tiles.putTile(message.tile).then(sendResponse, console.error);
		return true;
	case 'Tiles.removeTile':
		Tiles.removeTile(message.tile).then(sendResponse, console.error);
		return true;
	case 'Tiles.pinTile':
		Tiles.pinTile(message.title, message.url).then(function(id) {
			for (let view of chrome.extension.getViews()) {
				if (view.location.pathname == '/newTab.xhtml') {
					view.Updater.updateGrid();
				}
			}
			sendResponse(id);
		}, console.error);
		return true;

	case 'Background.getBackground':
		waitForDB().then(function() {
			return Background.getBackground();
		}).then(sendResponse).catch(function(event) {
			console.error(event);
			sendResponse(null);
		});
		return true;
	case 'Background.setBackground':
		Background.setBackground(message.file).then(sendResponse);
		return true;

	case 'Thumbnails.save':
		let {url, image} = message;
		if (url && image) {
			db.transaction('thumbnails', 'readwrite').objectStore('thumbnails').put({
				url,
				image,
				stored: today,
				used: today
			});
		}
		return false;
	case 'Thumbnails.get':
		let map = new Map();
		db.transaction('thumbnails', 'readwrite').objectStore('thumbnails').openCursor().onsuccess = function() {
			let cursor = this.result;
			if (cursor) {
				let thumb = cursor.value;
				if (message.urls.includes(thumb.url)) {
					map.set(thumb.url, thumb.image);
					if (thumb.used != today) {
						thumb.used = today;
						cursor.update(thumb);
					}
				}
				cursor.continue();
			} else {
				sendResponse(map);
			}
		};
		return true;

	case 'Export:backup':
		makeZip().then(sendResponse());
		return true;
	case 'Import:restore':
		readZip(message.file).then(sendResponse());
		return true;
	}
	return false;
});

chrome.webNavigation.onCompleted.addListener(function(details) {
	if (details.frameId !== 0) {
		return;
	}

	if (!['http:', 'https:', 'ftp:'].includes(new URL(details.url).protocol)) {
		chrome.browserAction.disable(details.tabId);
		return;
	}

	chrome.browserAction.enable(details.tabId);

	// We might not have called getAllTiles yet.
	Tiles.ensureReady().then(function({cache}) {
		if (cache.includes(details.url)) {
			chrome.tabs.get(details.tabId, function(tab) {
				if (tab.incognito) {
					return;
				}
				db.transaction('thumbnails').objectStore('thumbnails').get(details.url).onsuccess = function() {
					let today = getTZDateString();
					if (!this.result || this.result.stored < today) {
						chrome.tabs.executeScript(details.tabId, {file: 'thumbnail.js'});
					}
				};
			});
		}
	}).catch(console.error);
});

chrome.tabs.query({}, function(tabs) {
	for (let tab of tabs) {
		if (tab.url == NEW_TAB_URL) {
			chrome.tabs.reload(tab.id);
		} else if (!['http:', 'https:', 'ftp:'].includes(new URL(tab.url).protocol)) {
			chrome.browserAction.disable(tab.id);
		} else {
			chrome.browserAction.enable(tab.id);
		}
	}
});

function cleanupThumbnails() {
	let expiry = getTZDateString(new Date(Date.now() - 1209600000)); // ms in two weeks.
	let index = db.transaction('thumbnails', 'readwrite').objectStore('thumbnails').index('used');
	let keyRange = IDBKeyRange.upperBound(expiry);

	index.openCursor(keyRange).onsuccess = function() {
		let cursor = this.result;
		if (cursor) {
			cursor.delete();
			cursor.continue();
		}
	};
}

function idleListener(state) {
	if (state == 'idle') {
		chrome.idle.onStateChanged.removeListener(idleListener);
		cleanupThumbnails();
	}
}

chrome.idle.onStateChanged.addListener(idleListener);
