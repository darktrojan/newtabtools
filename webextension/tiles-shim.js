/* exported Tiles, Blocked, Background */
/* globals browser */
var Tiles = {
	_list: [],
	isPinned: function(url) {
		return this._list.includes(url);
	},
	getAllTiles: function() {
		return browser.runtime.sendMessage({ name: 'Tiles.getAllTiles' }).then(({ tiles, list }) => {
			this._list = list;
			return tiles;
		});
	},
	putTile: function(tile) {
		if (!this._list.includes(tile.url)) {
			this._list.push(tile.url);
		}
		return browser.runtime.sendMessage({ name: 'Tiles.putTile', tile }).then(function(id) {
			tile.id = id;
		});
	},
	removeTile: function(tile) {
		let index = this._list.indexOf(tile.url);
		while (index > -1) {
			this._list.splice(index, 1);
			index = this._list.indexOf(tile.url);
		}
		return browser.runtime.sendMessage({ name: 'Tiles.removeTile', tile });
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
