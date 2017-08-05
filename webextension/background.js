/* globals Prefs, Tiles, Background, browser, indexedDB, IDBKeyRange */
Promise.all([
	Prefs.init(),
	initDB()
]).then(function() {
	if (initDB.waitingQueue) {
		for (let waitingResolve of initDB.waitingQueue) {
			waitingResolve.call();
		}
		delete initDB.waitingQueue;
	}

	if (isFirstRun) {
		return Promise.all([
			Tiles.getTilesFromOldExtension(),
			Background.getBackgroundFromOldExtension(),
			Prefs.getPrefsFromOldExtension()
		]);
	}
});

var db;
var isFirstRun = false;

function initDB() {
	return new Promise(function(resolve, reject) {
		let request = indexedDB.open('newTabTools', 8);

		request.onsuccess = function(/*event*/) {
			// console.log(event.type, event);
			db = this.result;
			resolve();
		};

		request.onerror = function(event) {
			console.error(event.type, event);
			reject();
		};

		request.onupgradeneeded = function(event) {
			// console.log(event.type, event);
			db = this.result;

			if (!db.objectStoreNames.contains('tiles')) {
				db.createObjectStore('tiles', { autoIncrement: true, keyPath: 'id' });
			}

			if (!db.objectStoreNames.contains('background')) {
				db.createObjectStore('background', { autoIncrement: true });
			}

			if (!db.objectStoreNames.contains('thumbnails')) {
				db.createObjectStore('thumbnails', { keyPath: 'url' });
			}
			if (!this.transaction.objectStore('thumbnails').indexNames.contains('used')) {
				this.transaction.objectStore('thumbnails').createIndex('used', 'used');
			}

			if (event.oldVersion < 5) {
				isFirstRun = true;
			}
		};
	});
}

function waitForDB() {
	return new Promise(function(resolve) {
		if (db) {
			resolve();
			return;
		}

		initDB.waitingQueue = initDB.waitingQueue || [];
		initDB.waitingQueue.push(resolve);
	});
}

Date.prototype.toTZDateString = function() {
	return [this.getFullYear(), this.getMonth() + 1, this.getDate()].map(p => p.toString().padStart(2, '0')).join('-');
};

browser.runtime.onMessage.addListener(function(message, sender, sendResponse) {
	let today = new Date().toTZDateString();

	switch (message.name) {
	case 'Tiles.getAllTiles':
		waitForDB().then(function() {
			return Tiles.getAllTiles();
		}).then(function(tiles) {
			sendResponse({ tiles, list: Tiles._list });
		});
		return true;
	case 'Tiles.putTile':
		Tiles.putTile(message.tile).then(sendResponse);
		return true;
	case 'Tiles.removeTile':
		Tiles.removeTile(message.tile).then(sendResponse);
		return true;

	case 'Background.getBackground':
		waitForDB().then(function() {
			return Background.getBackground();
		}).then(sendResponse);
		return true;
	case 'Background.setBackground':
		Background.setBackground(message.file).then(sendResponse);
		return true;

	case 'Thumbnails.save':
		let {url, image} = message;
		db.transaction('thumbnails', 'readwrite').objectStore('thumbnails').put({
			url, image, stored: today, used: today
		});
		return;
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
	}
});

browser.webNavigation.onCompleted.addListener(function(details) {
	// We might not have called getAllTiles yet.
	let promise = Tiles._cache.length > 0 ? Promise.resolve(null) : Tiles.getAllTiles();
	promise.then(function() {
		if (details.frameId === 0 && Tiles._cache.includes(details.url)) {
			db.transaction('thumbnails').objectStore('thumbnails').get(details.url).onsuccess = function() {
				let today = new Date().toTZDateString();
				if (!this.result || this.result.stored < today) {
					browser.tabs.executeScript(details.tabId, {file: 'thumbnail.js'});
				}
			};
		}
	});
});

function cleanupThumbnails() {
	let expiry = new Date(Date.now() - 1209600000).toTZDateString(); // ms in two weeks.
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
		browser.idle.onStateChanged.removeListener(idleListener);
		cleanupThumbnails();
	}
}

browser.idle.onStateChanged.addListener(idleListener);
