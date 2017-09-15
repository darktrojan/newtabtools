/* exported initDB, Tiles, Background */
/* globals Blocked, Prefs, browser, db */
var Tiles = {
	_cache: [],
	_list: [],
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
					} else {
						urlMap.set(t.url, t);
					}
				}

				if (!Prefs.history) {
					Tiles._cache = links.map(l => l.url);
					resolve(links.slice(0, count));
					return;
				}

				browser.topSites.get({ providers: ['places'] }).then(r => {
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
	getTilesFromOldExtension: function() {
		return browser.runtime.sendMessage('tiles').then(function(result) {
			return new Promise(function(resolve) {
				let os = db.transaction('tiles', 'readwrite').objectStore('tiles');
				os.clear().onsuccess = function addNextTile() {
					let nextTile = result.shift();
					if (nextTile) {
						os.add(nextTile).onsuccess = addNextTile;
					} else {
						resolve();
					}
				};
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
		return browser.runtime.sendMessage('background').then(result => this.setBackground(result));
	}
};
