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
	_version: 0,
	_versionLastUpdate: new Date(0),
	_versionLastAck: new Date(0),

	init: function() {
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
		if (Array.isArray(prefs.blocked)) {
			Blocked._list = prefs.blocked;
		}
		if ('version' in prefs && typeof prefs.version == 'number') {
			this._version = prefs.version;
		}
		if ('versionLastUpdate' in prefs) {
			this._versionLastUpdate = prefs.versionLastUpdate;
		}
		if ('versionLastAck' in prefs) {
			this._versionLastAck = prefs.versionLastAck;
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
	getPrefsFromOldExtension: function() {
		return browser.runtime.sendMessage('prefs').then(function(result) {
			return browser.storage.local.set(result);
		});
	},
	get theme() {
		return this._theme;
	},
	get opacity() {
		return this._opacity;
	},
	get rows() {
		return this._rows;
	},
	get columns() {
		return this._columns;
	},
	get margin() {
		return this._margin;
	},
	get spacing() {
		return this._spacing;
	},
	get titleSize() {
		return this._titleSize;
	},
	get locked() {
		return this._locked;
	},
	get history() {
		return this._history;
	},
	get recent() {
		return this._recent;
	},
	get version() {
		return this._version;
	},
	get versionLastUpdate() {
		return this._versionLastUpdate;
	},
	get versionLastAck() {
		return this._versionLastAck;
	},
	set theme(value) {
		browser.storage.local.set({ theme: value });
	},
	set opacity(value) {
		browser.storage.local.set({ opacity: value });
	},
	set rows(value) {
		browser.storage.local.set({ rows: value });
	},
	set columns(value) {
		browser.storage.local.set({ columns: value });
	},
	set margin(value) {
		browser.storage.local.set({ margin: value });
	},
	set spacing(value) {
		browser.storage.local.set({ spacing: value });
	},
	set titleSize(value) {
		browser.storage.local.set({ titleSize: value });
	},
	set locked(value) {
		browser.storage.local.set({ locked: value });
	},
	set history(value) {
		browser.storage.local.set({ history: value });
	},
	set recent(value) {
		browser.storage.local.set({ recent: value });
	},
	set version(value) {
		browser.storage.local.set({ version: value });
	},
	set versionLastUpdate(value) {
		// Make sure this is up to date for synchronous code.
		this._versionLastUpdate = value;
		browser.storage.local.set({ versionLastUpdate: value });
	},
	set versionLastAck(value) {
		browser.storage.local.set({ versionLastAck: value });
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
