/* exported initDB, getAllTiles, Tiles, Background, Prefs */
/* globals browser, indexedDB */
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
	_list: [],
	isPinned: function(url) {
		return this._list.includes(url);
	},
	getAllTiles: function(count) {
		return new Promise(function(resolve) {
			db.transaction('tiles').objectStore('tiles').getAll().onsuccess = function() {
				let links = [];
				Tiles._list.length = 0;
				for (let t of this.result) {
					links[t.position] = t;
					Tiles._list.push(t.url);
				}

				if (!Prefs.history) {
					resolve(links);
					return;
				}

				browser.topSites.get().then(r => {
					let urls = Tiles._list.slice();
					let remaining = r.filter(s => {
						if (Blocked.isBlocked(s.url)) {
							return false;
						}

						let isNew = !urls.includes(s.url);
						if (isNew) {
							urls.push(s.url);
						}
						return isNew;
					});

					for (let i = 0; i < count && remaining.length > 0; i++) {
						if (!links[i]) {
							links[i] = remaining.shift();
						}
					}

					resolve(links);
				});
			};
		});
	},
	putTile: function(tile) {
		return new Promise(function(resolve) {
			db.transaction('tiles', 'readwrite').objectStore('tiles').put(tile).onsuccess = function() {
				tile.id = this.result;
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

var Blocked = {
	_list: [],
	block: function(url) {
		this._list.push(url);
	},
	unblock: function(url) {
		let index = this._list.indexOf(url);
		if (index >= 0) {
			this._list.splice(index, 1);
		}
	},
	isBlocked: function(url) {
		return this._list.includes(url);
	},
	clear: function() {
		this._list.length = 0;
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
