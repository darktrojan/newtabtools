/* globals Prefs, Tiles, Background, browser, indexedDB */
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
}).then(function() {
	browser.runtime.sendMessage({
		action: 'expirationFilter',
		count: Prefs.rows * Prefs.columns + 10
	});
});

var db;
var isFirstRun = false;

function initDB() {
	return new Promise(function(resolve, reject) {
		let request = indexedDB.open('newTabTools', 7);

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
			console.log(event.type, event);
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

browser.runtime.onMessage.addListener(function(message, sender, sendResponse) {
	switch (message.name) {
	case 'Tiles.getAllTiles':
		waitForDB().then(function() {
			return Tiles.getAllTiles(message.count);
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
		let today = new Date().toJSON().substring(0, 10);
		db.transaction('thumbnails', 'readwrite').objectStore('thumbnails').put({
			url, image, stored: today, used: today
		});
		return;
	case 'Thumbnails.get':
		// TODO cache the shit out of this
		db.transaction('thumbnails').objectStore('thumbnails').getAll().onsuccess = function() {
			let map = new Map();
			for (let thumb of this.result) {
				if (message.urls.includes(thumb.url)) {
					map.set(thumb.url, thumb.image);
				}
			}
			sendResponse(map);
		};
		return true;
	}
});

browser.webNavigation.onCompleted.addListener(function(details) {
	if (details.frameId === 0 && Tiles._cache.includes(details.url)) { // TODO: wrong list // TODO check when last was stored
		browser.tabs.executeScript(details.tabId, {file: 'thumbnail.js'});
	}
});

// TODO cleanup the old thumbnails
