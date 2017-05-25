/* exported Tiles, Blocked, Background */
/* globals browser */
var Tiles = {
	_list: [],
	isPinned: function(url) {
		return this._list.includes(url);
	},
	getAllTiles: function(count) {
		return browser.runtime.sendMessage({ name: 'Tiles.getAllTiles', count }).then(({ tiles, list }) => {
			this._list = list;
			return tiles;
		});
	},
	putTile: function(tile) {
		this._list.push(tile.url);
		return browser.runtime.sendMessage({ name: 'Tiles.putTile', tile });
	},
	removeTile: function(tile) {
		let index = this._list.indexOf(tile.url);
		if (index > -1) {
			this._list.splice(index, 1);
		}
		return browser.runtime.sendMessage({ name: 'Tiles.removeTile', tile });
	}
};

var Blocked = {
	block: function(url) {
		return browser.runtime.sendMessage({ name: 'Blocked.block', url });
	},
	unblock: function(url) {
		return browser.runtime.sendMessage({ name: 'Blocked.unblock', url });
	},
	isBlocked: function(url) {
		return browser.runtime.sendMessage({ name: 'Blocked.isBlocked', url });
	},
	clear: function() {
		return browser.runtime.sendMessage({ name: 'Blocked.clear' });
	}
};

var Background = {
	getBackground: function() {
		return browser.runtime.sendMessage({ name: 'Background.getBackground' });
	},
	setBackground: function(file) {
		return browser.runtime.sendMessage({ name: 'Background.setBackground', file });
	},
};
