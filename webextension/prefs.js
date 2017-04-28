/* exported GridPrefs */
/* globals browser, newTabTools, Grid */
var GridPrefs = {
	_theme: 'light',
	_opacity: 80,
	_gridRows: 3,
	_gridColumns: 3,
	_gridMargin: ['small', 'small', 'small', 'small'],
	_gridSpacing: 'small',
	_titleSize: 'small',
	_locked: false,

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
			this._gridRows = prefs.rows;
		}
		if (Number.isInteger(prefs.columns) && prefs.columns >= 1 && prefs.columns <= 10) {
			this._gridColumns = prefs.columns;
		}
		if (Array.isArray(prefs.margin) && prefs.margin.length == 4) {
			this._gridMargin = prefs.margin;
		}
		if (['small', 'medium', 'large'].includes(prefs.spacing)) {
			this._gridSpacing = prefs.spacing;
		}
		if (['hidden', 'small', 'medium', 'large'].includes(prefs.titleSize)) {
			this._titleSize = prefs.titleSize;
		}
		if ('locked' in prefs) {
			this._locked = prefs.locked === true;
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
		newTabTools.updateUI(Object.keys(prefs));
		newTabTools.updateGridPrefs();
		Grid.refresh();
	},
	getPrefsFromOldExtension: function() {
		browser.runtime.sendMessage('prefs').then(function(result) {
			browser.storage.local.set(result);
		});
	},
	get theme() {
		return this._theme;
	},
	get opacity() {
		return this._opacity;
	},
	get gridRows() {
		return this._gridRows;
	},
	get gridColumns() {
		return this._gridColumns;
	},
	get gridMargin() {
		return this._gridMargin;
	},
	get gridSpacing() {
		return this._gridSpacing;
	},
	get titleSize() {
		return this._titleSize;
	},
	get gridLocked() {
		return this._locked;
	},
	set theme(value) {
		browser.storage.local.set({ theme: value });
	},
	set opacity(value) {
		browser.storage.local.set({ opacity: value });
	},
	set gridRows(value) {
		browser.storage.local.set({ rows: value });
	},
	set gridColumns(value) {
		browser.storage.local.set({ columns: value });
	},
	set gridMargin(value) {
		browser.storage.local.set({ margin: value });
	},
	set gridSpacing(value) {
		browser.storage.local.set({ spacing: value });
	},
	set titleSize(value) {
		browser.storage.local.set({ titleSize: value });
	},
	set gridLocked(value) {
		browser.storage.local.set({ locked: value });
	}
};
