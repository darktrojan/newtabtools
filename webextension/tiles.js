var db;

function initDB() {
	return new Promise(function(resolve, reject) {
		let request = indexedDB.open('newTabTools', 9);

		request.onsuccess = function(/*event*/) {
			// console.log(event.type, event);
			db = this.result;
			resolve();
		};

		request.onblocked = request.onerror = function(event) {
			reject(event);
		};

		request.onupgradeneeded = function(/*event*/) {
			// console.log(event.type, event);
			db = this.result;

			if (!db.objectStoreNames.contains('tiles')) {
				db.createObjectStore('tiles', { autoIncrement: true, keyPath: 'id' });
			}
			if (!this.transaction.objectStore('tiles').indexNames.contains('url')) {
				this.transaction.objectStore('tiles').createIndex('url', 'url');
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
		};
	});
}

function waitForDB() {
	return new Promise(function(resolve, reject) {
		if (db) {
			if (db == 'broken') {
				reject('Database connection failed.');
			} else {
				resolve();
			}
			return;
		}

		initDB.waitingQueue = initDB.waitingQueue || [];
		initDB.waitingQueue.push({resolve, reject});
	});
}

/* exported initDB, Tiles, Background */
/* globals Blocked, Filters, Prefs, chrome, db */
var Tiles = {
	_cache: [],
	_list: [],
	isPinned: function(url) {
		return this._list.includes(url);
	},
	getAllTiles: function() {
		let count = Prefs.rows * Prefs.columns;
		return new Promise(function(resolve) {
			db.transaction('tiles').objectStore('tiles').getAll().onsuccess = function() {
				let links = [];
				let urlMap = new Map();
				Tiles._list.length = 0;

				for (let t of this.result) {
					if ('position' in t) {
						if (Tiles._list.includes(t.url)) {
							console.error('This URL appears twice: ' + t.url);
							continue;
						}
						links[t.position] = t;
						Tiles._list.push(t.url);
					}
					urlMap.set(t.url, t);
				}

				if (!Prefs.history) {
					Tiles._cache = links.map(l => l.url);
					resolve(links.slice(0, count));
					return;
				}

				// chrome.topSites.get({ providers: ['places'] }, r => {
				chrome.topSites.get(r => {
					let urls = Tiles._list.slice();
					let filters = Filters.getList();
					let dotFilters = Object.keys(filters).filter(f => f[0] == '.');
					let remaining = r.filter(s => {
						if (Blocked.isBlocked(s.url)) {
							return false;
						}
						let url = new URL(s.url);
						if (!['http:', 'https:', 'ftp:'].includes(url.protocol)) {
							return false;
						}

						let isNew = !urls.includes(s.url);
						if (isNew) {
							let match = url.host in filters ? url.host : dotFilters.find(
								f => url.host == f.substring(1) || url.host.endsWith(f)
							);
							if (match) {
								if (filters[match] === 0) {
									return false;
								}
								filters[match]--;
							}
							urls.push(s.url);
						} else {
							// If we pin a tile we've never visited, it has no title.
							let t = urlMap.get(s.url);
							if (t && !('title' in t)) {
								t.title = s.title;
							}
						}
						return isNew;
					});

					// Add some extras for thumbnail generation of tiles that might get promoted.
					let extraCount = count + 10;
					for (let i = 0; i < extraCount && remaining.length > 0; i++) {
						if (!links[i]) {
							let next = remaining.shift();
							if (next) {
								let mapData = urlMap.get(next.url);
								if (mapData) {
									for (let key of Object.keys(mapData)) {
										next[key] = mapData[key];
									}
								}
								links[i] = next;
							} else {
								break;
							}
						}
					}

					Tiles._cache = links.map(l => l.url);
					resolve(links.slice(0, count));
				});
			};
		});
	},
	getTile: function(url) {
		return new Promise(function(resolve, reject) {
			let op = db.transaction('tiles').objectStore('tiles').index('url').get(url);
			op.onsuccess = () => resolve(op.result || null);
			op.onerror = reject;
		});
	},
	putTile: function(tile) {
		if (!this._list.includes(tile.url)) {
			this._list.push(tile.url);
		}
		return new Promise(function(resolve, reject) {
			let op = db.transaction('tiles', 'readwrite').objectStore('tiles').put(tile);
			op.onsuccess = () => resolve(op.result);
			op.onerror = reject;
		});
	},
	removeTile: function(tile) {
		let index = this._list.indexOf(tile.url);
		while (index > -1) {
			this._list.splice(index, 1);
			index = this._list.indexOf(tile.url);
		}
		return new Promise(function(resolve, reject) {
			let op = db.transaction('tiles', 'readwrite').objectStore('tiles').delete(tile.id);
			op.onsuccess = () => resolve();
			op.onerror = reject;
		});
	},
	pinTile: function(title, url) {
		if (this.isPinned(url)) {
			return Promise.resolve();
		}
		return new Promise(function(resolve) {
			db.transaction('tiles').objectStore('tiles').getAll().onsuccess = function() {
				let p = 0;
				for (let tile of this.result.filter(t => 'position' in t).sort((a, b) => a.position - b.position)) {
					if (p != tile.position) {
						break;
					}
					p++;
				}
				Tiles.putTile({title, url, position: p}).then(resolve);
			};
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
	}
};
