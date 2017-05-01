/* exported initDB, getAllTiles, Tiles, Background */
/* globals Grid, browser, indexedDB */
var db;
var isFirstRun = false;

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

			if (event.oldVersion < 5) {
				isFirstRun = true;
			}
		};
	});
}

var Tiles = {
	getAllTiles: function() {
		return new Promise(function(resolve) {
			db.transaction('tiles').objectStore('tiles').getAll().onsuccess = function() {
				let links = [];
				for (let t of this.result) {
					links[t.position] = t;
				}

				resolve(links);
			};
		});
	},
	addTile: function(url, title) {
		return new Promise(function(resolve) {
			let tile = { url, title };
			db.transaction('tiles', 'readwrite').objectStore('tiles').add(tile).onsuccess = function() {
				tile.id = this.result;
				resolve(tile);
			};
		});
	},
	putTile: function(tile) {
		return new Promise(function(resolve) {
			db.transaction('tiles', 'readwrite').objectStore('tiles').put(tile).onsuccess = function() {
				resolve();
			};
		});
	},
	removeTile: function(id) {
		return new Promise(function(resolve) {
			db.transaction('tiles', 'readwrite').objectStore('tiles').delete(id).onsuccess = function() {
				resolve();
			};
		});
	},
	getTilesFromOldExtension: function() {
		return browser.runtime.sendMessage('tiles').then(function(result) {
			return new Promise(function(resolve) {
				let t = db.transaction('tiles', 'readwrite');
				t.oncomplete = function() {
					resolve();
				};

				let os = t.objectStore('tiles');
				os.clear();
				for (let tile of result) {
					os.add(tile);
				}
			});
		});
	}
};

var Background = {
	getBackground: function() {
		return new Promise(function(resolve) {
			db.transaction('background').objectStore('background').getAll().onsuccess = function() {
				if (this.result[0]) {
					resolve(this.result[0]);
				}
				resolve(null);
			};
		});
	},
	setBackground: function(file) {
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
	},
	getBackgroundFromOldExtension: function() {
		return browser.runtime.sendMessage('background').then(result => {
			return this.setBackground(result);
		});
	}
};
