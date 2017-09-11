/* exported initDB, Tiles, Background */
/* globals Blocked, Filters, Prefs, chrome, db */
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

				chrome.topSites.get({ providers: ['places'] }, r => {
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
							let match = url.host in filters ? url.host : dotFilters.find(f => {
								return url.host == f.substring(1) || url.host.endsWith(f);
							});
							if (match) {
								if (filters[match] === 0) {
									return false;
								}
								filters[match]--;
							}
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
		this._list.push(tile.url);
		return new Promise(function(resolve) {
			db.transaction('tiles', 'readwrite').objectStore('tiles').put(tile).onsuccess = function() {
				tile.id = this.result;
				resolve();
			};
		});
	},
	removeTile: function(tile) {
		let index = this._list.indexOf(tile.url);
		if (index > -1) {
			this._list.splice(index, 1);
		}
		return new Promise(function(resolve) {
			db.transaction('tiles', 'readwrite').objectStore('tiles').delete(tile.id).onsuccess = function() {
				resolve();
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
