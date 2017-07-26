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
		let request = indexedDB.open('newTabTools', 5);

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

			// if (db.objectStoreNames.contains('tiles')) {
			// 	db.deleteObjectStore('tiles');
			// }

			db.createObjectStore('tiles', { autoIncrement: true, keyPath: 'id' });

			// if (db.objectStoreNames.contains('backgrounds')) {
			// 	db.deleteObjectStore('backgrounds');
			// }

			db.createObjectStore('background', { autoIncrement: true });

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
	}
});
