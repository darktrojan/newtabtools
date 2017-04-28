/* exported initDB, getAllTiles, addTile, putTile, getBackground, setBackground, getTilesFromOldExtension */
/* globals Grid, browser, indexedDB */
var db;

function initDB() {
	return new Promise(function(resolve, reject) {
		let request = indexedDB.open('newTabTools', 5);

		request.onsuccess = function(event) {
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
		};
	});
}

function getAllTiles() {
	return new Promise(function(resolve) {
		db.transaction('tiles').objectStore('tiles').getAll().onsuccess = function() {
			let links = [];
			for (let t of this.result) {
				links[t.position] = t;
			}

			resolve(links);
		};
	});
}

function addTile(url, title) {
	return new Promise(function(resolve) {
		let tile = { url, title };
		db.transaction('tiles', 'readwrite').objectStore('tiles').add(tile).onsuccess = function() {
			tile.id = this.result;
			resolve(tile);
		};
	});
}

function putTile(tile) {
	db.transaction('tiles', 'readwrite').objectStore('tiles').put(tile);
}

function getBackground() {
	return new Promise(function(resolve) {
		db.transaction('background').objectStore('background').getAll().onsuccess = function() {
			if (this.result[0]) {
				resolve(this.result[0]);
			}
			resolve(null);
		};
	});
}

function setBackground(file) {
	return new Promise(function(resolve) {
		let backgroundOS = db.transaction('background', 'readwrite').objectStore('background');
		backgroundOS.clear().onsuccess = function() {
			if (file) {
				backgroundOS.add(file).onsuccess = function() {
					resolve();
				};
			} else {
				resolve();
			}
		};
	});
}

function getTilesFromOldExtension() {
	browser.runtime.sendMessage('whatever').then(function(result) {
		let t = db.transaction('tiles', 'readwrite');
		t.oncomplete = function() {
			Grid.refresh();
		};

		let os = t.objectStore('tiles');
		os.clear();
		for (let tile of result) {
			os.add(tile);
		}
	});
}
