/* globals Components, XPCOMUtils, PlacesUtils */
Components.utils.import('resource://gre/modules/XPCOMUtils.jsm');
Components.utils.import('resource://gre/modules/PlacesUtils.jsm');

const nsIAutoCompleteResult = Components.interfaces.nsIAutoCompleteResult;

function HostsAutoCompleteResult(searchString, results) {
	this._searchString = searchString;
	this._results = results;
}
HostsAutoCompleteResult.prototype = {
	get searchString() {
		return this._searchString;
	},
	get searchResult() {
		return this.matchCount > 0 ? nsIAutoCompleteResult.RESULT_SUCCESS : nsIAutoCompleteResult.RESULT_NOMATCH;
	},
	get defaultIndex() {
		return 0;
	},
	get errorDescription() {
		return '';
	},
	get matchCount() {
		return this._results.length;
	},
	get typeAheadResult() {
		return false;
	},
	getValueAt: function(index) {
		return this._results[index];
	},
	getLabelAt: function(index) {
		return this.getValueAt(index);
	},
	getCommentAt: function() {
		return null;
	},
	getStyleAt: function() {
		return null;
	},
	getImageAt: function() {
		return null;
	},
	getFinalCompleteValueAt: function(index) {
		return this.getValueAt(index);
	},
	removeValueAt: function(index) {
		this._results.splice(index, 1);
	},
	QueryInterface: XPCOMUtils.generateQI([nsIAutoCompleteResult])
};

function HostsAutoCompleteSearch() {
	XPCOMUtils.defineLazyGetter(this, '_allHosts', function() {
		let hosts = new Set();
		let db = PlacesUtils.history.QueryInterface(Components.interfaces.nsPIPlacesDatabase).DBConnection;
		let stmt = db.createStatement(
			'SELECT host FROM moz_hosts WHERE frecency > 0 ORDER BY frecency DESC'
		);
		try {
			while (stmt.executeStep()) {
				hosts.add(stmt.row.host);
			}
		}
		finally {
			stmt.finalize();
		}
		return Array.from(hosts);
	});
}
HostsAutoCompleteSearch.prototype = {
	startSearch: function(searchString, searchParam, result, listener) {
		let results = searchString.length ? this._allHosts.filter(function(host) {
			return host.indexOf(searchString) >= 0;
		}) : [];
		let newResult = new HostsAutoCompleteResult(searchString, results);
		listener.onSearchResult(this, newResult);
	},

	stopSearch: function() {
	},

	classID: Components.ID('2ce55b99-e9e1-4d51-acc9-e46c1d4dadfb'),
	contractID: '@mozilla.org/autocomplete/search;1?name=newtabtools-hosts',
	QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIAutoCompleteSearch])
};

this.NSGetFactory = XPCOMUtils.generateNSGetFactory([HostsAutoCompleteSearch]);
