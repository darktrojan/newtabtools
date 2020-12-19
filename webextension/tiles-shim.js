/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/* exported Tiles, Background */

var Tiles = {
	_list: [],
	isPinned(url) {
		return this._list.includes(url);
	},
	getAllTiles() { // TODO: This is a silly name.
		return new Promise((resolve, reject) => {
			chrome.runtime.sendMessage({ name: 'Tiles.getAllTiles' }, response => {
				if (response === null) {
					reject();
					return;
				}
				let { tiles, list } = response;
				this._list = list;
				resolve(tiles);
			});
		});
	},
	getTile(url) {
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.getTile', url }, resolve);
		});
	},
	putTile(tile) {
		if (!this._list.includes(tile.url)) {
			this._list.push(tile.url);
		}
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Tiles.putTile', tile }, function(id) {
				tile.id = id;
				resolve(id);
			});
		});
	},
	removeTile(tile) {
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
	getBackground() {
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Background.getBackground' }, resolve);
		});
	},
	setBackground(file) {
		return new Promise(resolve => {
			chrome.runtime.sendMessage({ name: 'Background.setBackground', file }, resolve);
		});
	},
};
