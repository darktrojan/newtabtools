/* exported Blocked, Prefs */
/* globals browser, newTabTools, Grid, Updater */
var Prefs = {
	_theme: 'light',
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
	_version: 0,
	_versionLastUpdate: new Date(0),
	_versionLastAck: new Date(0),

	init: function() {
		let names = [
			'theme',
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
			'version',
			'versionLastAck'
		];

		for (let n of names) {
			this.__defineGetter__(n, () => { // jshint ignore:line
				return this['_' + n];
			});
			this.__defineSetter__(n, function(value) { // jshint ignore:line
				let obj = {};
				obj[n] = value;
				browser.storage.local.set(obj);
			});
		}

		return browser.storage.local.get().then(prefs => {
			this.parsePrefs(prefs);
			browser.storage.onChanged.addListener(this.prefsChanged.bind(this));
		});
	},
	parsePrefs: function(prefs) {
		if (['light', 'dark'].includes(prefs.theme)) {
			this._theme = prefs.theme;
		}
		if (Number.isInteger(prefs.opacity) && prefs.opacity >= 0 && prefs.opacity <= 100) {
			this._opacity = prefs.opacity;
		}
		if (Number.isInteger(prefs.rows) && prefs.rows >= 1 && prefs.rows <= 10) {
			this._rows = prefs.rows;
		}
		if (Number.isInteger(prefs.columns) && prefs.columns >= 1 && prefs.columns <= 10) {
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
		if ('version' in prefs && typeof prefs.version == 'number') {
			this._version = prefs.version;
		}
		if ('versionLastUpdate' in prefs) {
			this._versionLastUpdate = new Date(prefs.versionLastUpdate);
		}
		if ('versionLastAck' in prefs) {
			this._versionLastAck = new Date(prefs.versionLastAck);
		}
	},
	prefsChanged: function(changes) {
		let prefs = Object.create(null);
		for (let [name, change] of Object.entries(changes)) {
			if (change.newValue != change.oldValue) {
				prefs[name] = change.newValue;
			}
		}

		this.parsePrefs(prefs);

		if ('newTabTools' in window) {
			let keys = Object.keys(prefs);
			newTabTools.updateUI(keys);
			if (keys.includes('rows') || keys.includes('columns')) {
				Grid.refresh();
			} else if (keys.includes('history')) {
				Updater.updateGrid();
			}
		}
	},
	get versionLastUpdate() {
		return this._versionLastUpdate;
	},
	set versionLastUpdate(value) {
		// Make sure this is up to date for synchronous code.
		this._versionLastUpdate = value;
		browser.storage.local.set({ versionLastUpdate: value });
	}
};

var Blocked = {
	_list: [],
	_saveList: function() {
		browser.storage.local.set({ 'blocked': this._list });
	},
	block: function(url) {
		this._list.push(url);
		this._saveList();
	},
	unblock: function(url) {
		let index = this._list.indexOf(url);
		if (index >= 0) {
			this._list.splice(index, 1);
		}
		this._saveList();
	},
	isBlocked: function(url) {
		return this._list.includes(url);
	},
	clear: function() {
		this._list.length = 0;
		this._saveList();
	}
};
