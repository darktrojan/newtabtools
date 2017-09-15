/* exported Tiles, Blocked, Background */
/* globals chrome */
var Tiles = {
	_list: [],
	isPinned: function(url) {
		return this._list.includes(url);
	},
	getAllTiles: function() {
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.getAllTiles' }, ({ tiles, list }) => {
				this._list = list;
				resolve(tiles);
			});
		});
	},
	getTile: function(url) {
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.getTile', url }, resolve);
		});
	},
	putTile: function(tile) {
		if (!this._list.includes(tile.url)) {
			this._list.push(tile.url);
		}
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.putTile', tile }, function(id) {
				tile.id = id;
				resolve();
			});
		});
	},
	removeTile: function(tile) {
		let index = this._list.indexOf(tile.url);
		while (index > -1) {
			this._list.splice(index, 1);
			index = this._list.indexOf(tile.url);
		}
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.removeTile', tile }, resolve);
		});
	}
};

var Background = {
	getBackground: function() {
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Background.getBackground' }, resolve);
		});
	},
	setBackground: function(file) {
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Background.setBackground', file }, resolve);
		});
	},
};
