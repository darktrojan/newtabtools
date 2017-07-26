/* exported initDB, Tiles, Background */
/* globals Blocked, Prefs, browser, db */
var Tiles = {
	_list: [],
	getAllTiles: function(count) {
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
					resolve(links);
					return;
				}

				// browser.topSites.get({ providers: ['places'] }).then(r => {
				browser.runtime.sendMessage('topSites').then(r => {
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

					resolve(links);
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
