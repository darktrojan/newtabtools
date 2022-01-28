/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/* exported Prefs, Blocked, Filters */
/* globals Grid, newTabTools, Updater */

var Prefs = {
	_theme: 'light',
	_themeAuto: false,
	_opacity: 80,
	_rows: 3,
	_columns: 3,
	_margin: ['small', 'small', 'small', 'small'],
	_spacing: 'small',
	_titleSize: 'small',
	_locked: false,
	_history: true,
	_recent: true,
	_thumbnailSize: 600,
	_version: -1,
	_versionLastUpdate: new Date(0),
	_versionLastAck: new Date(0),

	init() {
		chrome.storage.local.remove(['toolbarIcon']);

		let names = [
			'theme',
			'themeAuto',
			'opacity',
			'rows',
			'columns',
			'margin',
			'spacing',
			'titleSize',
			'locked',
			'history',
			'recent',
			'thumbnailSize',
			'version'
		];

		for (let n of names) {
			this.__defineGetter__(n, () => this['_' + n]);
			this.__defineSetter__(n, function(value) {
				let obj = {};
				obj[n] = value;
				chrome.storage.local.set(obj);
			});
		}

		return new Promise(resolve => {
			chrome.storage.local.get(prefs => {
				this.parsePrefs(prefs);
				chrome.storage.onChanged.addListener(this.prefsChanged.bind(this));
				resolve();
			});
		});
	},
	parsePrefs(prefs) {
		if (['light', 'dark'].includes(prefs.theme)) {
			this._theme = prefs.theme;
		}
		if ('themeAuto' in prefs) {
			this._themeAuto = prefs.themeAuto !== false;
		}
		if (Number.isInteger(prefs.opacity) && prefs.opacity >= 0 && prefs.opacity <= 100) {
			this._opacity = prefs.opacity;
		}
		if (Number.isInteger(prefs.rows) && prefs.rows >= 1 && prefs.rows <= 20) {
			this._rows = prefs.rows;
		}
		if (Number.isInteger(prefs.columns) && prefs.columns >= 1 && prefs.columns <= 20) {
			this._columns = prefs.columns;
		}
		if (Array.isArray(prefs.margin) && prefs.margin.length == 4) {
			this._margin = prefs.margin;
		}
		if (['small', 'medium', 'large'].includes(prefs.spacing)) {
			this._spacing = prefs.spacing;
		}
		if (['hidden', 'small', 'medium', 'large'].includes(prefs.titleSize)) {
			this._titleSize = prefs.titleSize;
		}
		if ('locked' in prefs) {
			this._locked = prefs.locked === true;
		}
		if ('history' in prefs) {
			this._history = prefs.history !== false;
		}
		if ('recent' in prefs) {
			this._recent = prefs.recent !== false;
		}
		if (Number.isInteger(prefs.thumbnailSize)) {
			this._thumbnailSize = prefs.thumbnailSize;
		}
		if (Array.isArray(prefs.blocked)) {
			Blocked._list = prefs.blocked;
		}
		if ('filters' in prefs && typeof prefs.filters == 'object') {
			Filters._list = prefs.filters;
		}
		if ('version' in prefs && typeof prefs.version == 'number' || typeof prefs.version == 'string') {
			this._version = prefs.version;
		}
		if ('versionLastUpdate' in prefs) {
			this._versionLastUpdate = new Date(prefs.versionLastUpdate);
		}
		if ('versionLastAck' in prefs) {
			this._versionLastAck = new Date(prefs.versionLastAck);
		}
	},
	prefsChanged(changes) {
		let prefs = Object.create(null);
		for (let [name, change] of Object.entries(changes)) {
			if (change.newValue != change.oldValue) {
				prefs[name] = change.newValue;
			}
		}

		let keys = Object.keys(prefs);
		if (keys.length === 0) {
			return;
		}

		this.parsePrefs(prefs);

		if (keys.length == 1 && keys[0] == 'thumbnailSize') {
			return;
		}

		if ('newTabTools' in window) {
			newTabTools.updateUI(keys);
			if (keys.includes('rows') || keys.includes('columns')) {
				Grid.refresh().then(newTabTools.resizeOptionsThumbnail.bind(newTabTools));
			} else if (keys.includes('history')) {
				Updater.updateGrid();
			}
		}
	},
	get versionLastAck() {
		return this._versionLastAck;
	},
	set versionLastAck(value) {
		chrome.storage.local.set({ versionLastAck: value.toJSON() });
	},
	get versionLastUpdate() {
		return this._versionLastUpdate;
	},
	set versionLastUpdate(value) {
		// Make sure this is up to date for synchronous code.
		this._versionLastUpdate = value;
		chrome.storage.local.set({ versionLastUpdate: value.toJSON() });
	}
};

var Blocked = {
	_list: [],
	_saveList() {
		return new Promise(resolve => {
			chrome.storage.local.set({ 'blocked': this._list }, resolve);
		});
	},
	block(url) {
		this._list.push(url);
		return this._saveList();
	},
	unblock(url) {
		let index = this._list.indexOf(url);
		if (index >= 0) {
			this._list.splice(index, 1);
		}
		return this._saveList();
	},
	isBlocked(url) {
		return this._list.includes(url);
	},
	clear() {
		this._list.length = 0;
		return this._saveList();
	}
};

var Filters = {
	_list: Object.create(null),
	_saveList() {
		chrome.storage.local.set({ 'filters': this._list });
	},
	getList() {
		let copy = Object.create(null);
		for (let k of Object.keys(this._list)) {
			copy[k] = this._list[k];
		}
		return copy;
	},
	setFilter(host, limit) {
		if (limit == -1) {
			delete this._list[host];
		} else {
			this._list[host] = limit;
		}
		this._saveList();
	},
	clear() {
		this._list = Object.create(null);
		this._saveList();
	}
};
