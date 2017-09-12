/* globals Prefs, Tiles, chrome, IDBKeyRange, db, initDB, waitForDB */
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

function getTZDateString(date=new Date()) {
	return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(p => p.toString().padStart(2, '0')).join('-');
}

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
	let today = getTZDateString();

	switch (message.name) {
	case 'Tiles.isPinned':
		sendResponse(Tiles.isPinned(message.url));
		return;
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
	}
});

chrome.webNavigation.onCompleted.addListener(function(details) {
	if (!['http:', 'https:', 'ftp:'].includes(new URL(details.url).protocol)) {
		return;
	}

	chrome.pageAction.show(details.tabId);

	// We might not have called getAllTiles yet.
	let promise = Tiles._cache.length > 0 ? Promise.resolve(null) : waitForDB().then(Tiles.getAllTiles);
	promise.then(function() {
		if (details.frameId === 0 && Tiles._cache.includes(details.url)) {
			chrome.tabs.get(details.tabId, function(tab) {
				if (tab.incognito) {
					return;
				}
				let objectStore = db.transaction('thumbnails', 'readwrite').objectStore('thumbnails');
				objectStore.get(details.url).onsuccess = function() {
					let today = getTZDateString();
					if (!this.result || this.result.stored < today) {
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
									objectStore.put({
										url: details.url, image: blob, stored: today, used: today
									});
								});
							};
							img.onerror = console.error;
							img.src = dataURL;
						});
					}
				};
			});
		}
	}).catch(console.error);
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

function compareVersions(a, b) {
	function splitApart(name) {
		var parts = [];
		var lastIsDigit = false;
		var part = '';
		for (let c of name.toString()) {
			let currentIsDigit = c >= '0' && c <= '9';
			if (c == '.' || lastIsDigit != currentIsDigit) {
				if (part) {
					parts.push(lastIsDigit ? parseInt(part, 10) : part);
				}
				part = c == '.' ? '' : c;
			} else {
				part += c;
			}
			lastIsDigit = currentIsDigit;
		}
		if (part) {
			parts.push(lastIsDigit ? parseInt(part, 10) : part);
		}
		return parts;
	}
	function compareParts(x, y) {
		let xType = typeof x;
		let yType = typeof y;

		switch (xType) {
		case yType:
			return x == y ? 0 : (x < y ? -1 : 1);
		case 'string':
			return -1;
		case 'undefined':
			return yType == 'number' ? (y === 0 ? 0 : -1) : 1;
		case 'number':
			return x === 0 && yType == 'undefined' ? 0 : 1;
		}
	}
	let aParts = splitApart(a);
	let bParts = splitApart(b);
	for (let i = 0; i <= aParts.length || i <= bParts.length; i++) {
		let comparison = compareParts(aParts[i], bParts[i]);
		if (comparison !== 0) {
			return comparison;
		}
	}
	return 0;
}
