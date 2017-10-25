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
	switch (message.name) {
	case 'Tiles.isPinned':
		Tiles.ensureReady().then(() => {
			sendResponse(Tiles.isPinned(message.url));
		});
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

	case 'Thumbnails.capture':
		let today = getTZDateString();
		captureThumbnail(message.url, today);
		return;
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
						captureThumbnail(details.url, today);
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

function captureThumbnail(url, today) {
	chrome.tabs.captureVisibleTab(dataURL => {
		let img = new Image();
		img.onload = function() {
			let canvas1 = document.createElement('canvas');
			canvas1.width = Prefs.thumbnailSize;
			let context1 = canvas1.getContext('2d');
			let scale = canvas1.width / this.width;
			canvas1.height = Math.min(canvas1.width, scale * this.height);
			context1.imageSmoothingEnabled = true;
			context1.drawImage(this, 0, 0, canvas1.width, canvas1.height);
			canvas1.toBlob(function(blob) {
				db.transaction('thumbnails', 'readwrite').objectStore('thumbnails').put({
					url: url, image: blob, stored: today, used: today
				});
			});
		};
		img.onerror = console.error;
		img.src = dataURL;
	});
}

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
