/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* import-globals-from newTab.js */
/* import-globals-from prefs.js */

/* exported Page */
if (!('DOMRect' in window)) {
	window.DOMRect = function(left, top, width, height) {
		this.left = left;
		this.top = top;
		this.width = width;
		this.height = height;
		this.right = left + width;
		this.bottom = top + height;
	};
	DOMRect.prototype = {};
}

DOMRect.prototype.isEmpty = function() {
	return this.left >= this.right || this.top >= this.bottom;
};

DOMRect.prototype.intersect = function(other) {
	if (this.isEmpty() || other.isEmpty()) {
		return new DOMRect(0, 0, 0, 0);
	}

	let x1 = Math.max(this.left, other.left);
	let x2 = Math.min(this.right, other.right);
	let y1 = Math.max(this.top, other.top);
	let y2 = Math.min(this.bottom, other.bottom);
	// If width or height is 0, the intersection was empty.
	return new DOMRect(x1, y1, Math.max(0, x2 - x1), Math.max(0, y2 - y1));
};

var HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/**
 * This singleton allows to transform the grid by repositioning a site's node
 * in the DOM and by showing or hiding the node. It additionally provides
 * convenience methods to work with a site's DOM node.
 */
var Transformation = {
	/**
	   * Gets a DOM node's position.
	   * @param node The DOM node.
	   * @return A Rect instance with the position.
	   */
	getNodePosition(node) {
		let {left, top, width, height} = node.getBoundingClientRect();
		let {offsetLeft, offsetTop} = newTabTools.page.firstElementChild;
		return new DOMRect(left - offsetLeft, top - offsetTop, width, height);
	},

	/**
	   * Fades a given node from zero to full opacity.
	   * @param node The node to fade.
	   * @param callback The callback to call when finished.
	   */
	fadeNodeIn(node, callback) {
		this._setNodeOpacity(node, 1, function() {
			// Clear the style property.
			node.style.opacity = '';

			if (callback) {
				callback();
			}
		});
	},

	/**
	   * Fades a given node from full to zero opacity.
	   * @param node The node to fade.
	   * @param callback The callback to call when finished.
	   */
	fadeNodeOut(node, callback) {
		this._setNodeOpacity(node, 0, callback);
	},

	/**
	   * Fades a given site from zero to full opacity.
	   * @param site The site to fade.
	   * @param callback The callback to call when finished.
	   */
	showSite(site, callback) {
		this.fadeNodeIn(site.node, callback);
	},

	/**
	   * Fades a given site from full to zero opacity.
	   * @param site The site to fade.
	   * @param callback The callback to call when finished.
	   */
	hideSite(site, callback) {
		this.fadeNodeOut(site.node, callback);
	},

	/**
	   * Allows to set a site's position.
	   * @param site The site to re-position.
	   * @param position The desired position for the given site.
	   */
	setSitePosition(site, position) {
		let style = site.node.style;
		let {top, left} = position;

		style.top = top + 'px';
		style.left = left + 'px';
	},

	/**
	   * Freezes a site in its current position by positioning it absolute.
	   * @param site The site to freeze.
	   */
	freezeSitePosition(site) {
		if (this._isFrozen(site)) {
			return;
		}

		let first = Grid.cells[0].position;
		let style = site.node.style;
		style.width = first.width + 'px';
		style.height = first.height + 'px';

		site.node.setAttribute('frozen', 'true');
		site.index = site.cell.index;
		this.setSitePosition(site, Grid.cells[site.index].position);
	},

	/**
	   * Unfreezes a site by removing its absolute positioning.
	   * @param site The site to unfreeze.
	   */
	unfreezeSitePosition(site) {
		if (!this._isFrozen(site)) {
			return;
		}

		let style = site.node.style;
		style.left = style.top = style.width = style.height = '';
		site.node.removeAttribute('frozen');
		delete site.index;
	},

	/**
	   * Slides the given site to the target node's position.
	   * @param site The site to move.
	   * @param target The slide target.
	   * @param options Set of options (see below).
	   *        unfreeze - unfreeze the site after sliding
	   *        callback - the callback to call when finished
	   */
	slideSiteTo(site, target, options) {
		let self = this;
		let callback = options && options.callback;

		function finish() {
			if (options && options.unfreeze) {
				self.unfreezeSitePosition(site);
			}

			if (callback) {
				callback();
			}
		}

		let currentIndex = 'index' in site ? site.index : site.cell.index;

		// Nothing to do here if the positions already match.
		if (currentIndex == target.index) {
			finish();
		} else {
			this.setSitePosition(site, target.position);
			site.index = target.index;
			this._whenTransitionEnded(site.node, ['left', 'top'], finish);
		}
	},

	/**
	   * Rearranges a given array of sites and moves them to their new positions or
	   * fades in/out new/removed sites.
	   * @param sites An array of sites to rearrange.
	   * @param options Set of options (see below).
	   *        unfreeze - unfreeze the site after rearranging
	   *        callback - the callback to call when finished
	   */
	rearrangeSites(sites, options) {
		let batch = [];
		let cells = Grid.cells;
		let callback = options && options.callback;
		let unfreeze = options && options.unfreeze;

		sites.forEach(function(site, index) {
			// Do not re-arrange empty cells or the dragged site.
			if (!site || site == Drag.draggedSite) {
				return;
			}

			batch.push(new Promise(resolve => {
				if (!cells[index]) {
					// The site disappeared from the grid, hide it.
					this.hideSite(site, resolve);
				} else if (this._getNodeOpacity(site.node) != 1) {
					// The site disappeared before but is now back, show it.
					this.showSite(site, resolve);
				} else {
					// The site's position has changed, move it around.
					this._moveSite(site, index, {unfreeze, callback: resolve});
				}
			}));
		}, this);

		if (callback) {
			Promise.all(batch).then(callback);
		}
	},

	/**
	   * Listens for the 'transitionend' event on a given node and calls the given
	   * callback.
	   * @param node The node that is transitioned.
	   * @param properties The properties we'll wait to be transitioned.
	   * @param callback The callback to call when finished.
	   */
	_whenTransitionEnded(node, properties, callback) {
		let props = new Set(properties);
		node.addEventListener('transitionend', function onEnd(e) {
			if (props.has(e.propertyName)) {
				node.removeEventListener('transitionend', onEnd);
				callback();
			}
		});
	},

	/**
	   * Gets a given node's opacity value.
	   * @param node The node to get the opacity value from.
	   * @return The node's opacity value.
	   */
	_getNodeOpacity(node) {
		let cstyle = window.getComputedStyle(node);
		return cstyle.getPropertyValue('opacity');
	},

	/**
	   * Sets a given node's opacity.
	   * @param node The node to set the opacity value for.
	   * @param opacity The opacity value to set.
	   * @param callback The callback to call when finished.
	   */
	_setNodeOpacity(node, opacity, callback) {
		if (this._getNodeOpacity(node) == opacity) {
			if (callback) {
				callback();
			}
		} else {
			if (callback) {
				this._whenTransitionEnded(node, ['opacity'], callback);
			}

			node.style.opacity = opacity;
		}
	},

	/**
	   * Moves a site to the cell with the given index.
	   * @param site The site to move.
	   * @param index The target cell's index.
	   * @param options Options that are directly passed to slideSiteTo().
	   */
	_moveSite(site, index, options) {
		this.freezeSitePosition(site);
		requestAnimationFrame(function() {
			// Do this at the end of the event loop to ensure a CSS change happens.
			Transformation.slideSiteTo(site, Grid.cells[index], options);
		});
	},

	/**
	   * Checks whether a site is currently frozen.
	   * @param site The site to check.
	   * @return Whether the given site is frozen.
	   */
	_isFrozen(site) {
		return site.node.hasAttribute('frozen');
	}
};

/**
 * This singleton represents the whole 'New Tab Page' and takes care of
 * initializing all its components.
 */
var Page = {
	/**
	   * Initializes the page.
	   */
	init() {
		this._init();

		addEventListener('resize', Grid.cacheCellPositions);
	},

	/**
	   * Internally initializes the page. This runs only when/if the feature
	   * is/gets enabled.
	   */
	_init() {
		if (this._initialized) {
			return;
		}

		this._initialized = true;

		Grid.init();

		// Initialize the drop target shim.
		DropTargetShim.init();
	},

	/**
	   * Handles all page events.
	   */
	handleEvent(event) {
		switch (event.type) {
		case 'dragover':
			if (Drag.draggedSite) {
				event.preventDefault();
			}
			break;
		case 'drop':
			if (Drag.draggedSite) {
				event.preventDefault();
				event.stopPropagation();
			}
			break;
		}
	}
};

/**
 * This singleton represents the grid that contains all sites.
 */
var Grid = {
	/**
	   * The DOM node of the grid.
	   */
	_node: null,
	get node() { return this._node; },

	/**
	   * The cached DOM fragment for sites.
	   */
	_siteFragment: null,

	/**
	   * All cells contained in the grid.
	   */
	_cells: null,
	get cells() { return this._cells; },

	/**
	   * All sites contained in the grid's cells. Sites may be empty.
	   */
	get sites() { return this.cells.map(cell => cell.site); },

	// Tells whether the grid has already been initialized.
	get ready() { return !!this._node; },

	/**
	   * Initializes the grid.
	   * @param selector The query selector of the grid.
	   */
	init() {
		this._node = document.getElementById('newtab-grid');
		this._createSiteFragment();
		this._render();
	},

	/**
	   * Creates a new site in the grid.
	   * @param link The new site's link.
	   * @param cell The cell that will contain the new site.
	   * @return The newly created site.
	   */
	createSite(link, cell) {
		let node = cell.node;
		node.appendChild(this._siteFragment.cloneNode(true));
		return new Site(node.firstElementChild, link);
	},

	/**
	   * Refreshes the grid and re-creates all sites.
	   */
	refresh() {
		// Remove all sites.
		this.cells.forEach(function(cell) {
			let node = cell.node;
			let child = node.firstElementChild;

			if (child) {
				node.removeChild(child);
			}
		}, this);

		// Render the grid again.
		return this._render();
	},

	/**
	   * Locks the grid to block all pointer events.
	   */
	lock() {
		this.node.setAttribute('locked', 'true');
	},

	/**
	   * Unlocks the grid to allow all pointer events.
	   */
	unlock() {
		this.node.removeAttribute('locked');
	},

	/**
	   * Creates the newtab grid.
	   */
	_renderGrid() {
		let row = document.createElementNS(HTML_NAMESPACE, 'div');
		let cell = document.createElementNS(HTML_NAMESPACE, 'div');
		row.classList.add('newtab-row');
		cell.classList.add('newtab-cell');

		// Clear the grid
		this._node.innerHTML = '';

		// Creates the structure of one row
		for (let i = 0; i < Prefs.columns; i++) {
			row.appendChild(cell.cloneNode(true));
		}
		// Creates the grid
		for (let j = 0; j < Prefs.rows; j++) {
			this._node.appendChild(row.cloneNode(true));
		}

		// (Re-)initialize all cells.
		let cellElements = this.node.querySelectorAll('.newtab-cell');
		this._cells = [...cellElements].map(cell => new Cell(this, cell));

		requestAnimationFrame(this.cacheCellPositions);
	},

	cacheCellPositions() {
		for (let c of Grid.cells) {
			c.position = Transformation.getNodePosition(c.node);
		}

		let firstCell = Grid.cells[0].node;
		let size = Math.max(firstCell.offsetWidth, firstCell.offsetHeight, 150) * 2;
		if (size != Prefs.thumbnailSize) {
			Prefs.thumbnailSize = size;
		}
	},

	/**
	   * Creates the DOM fragment that is re-used when creating sites.
	   */
	_createSiteFragment() {
		this._siteFragment = document.getElementById('newtab-site').content.firstElementChild.cloneNode(true);
		this._siteFragment.querySelectorAll('[data-title]').forEach(n => {
			n.title = newTabTools.getString(n.dataset.title);
		});
	},

	/**
	   * Renders the sites, creates all sites and puts them into their cells.
	   */
	_renderSites() {
		let cells = this.cells;

		// Put sites into the cells.
		return Tiles.getAllTiles().then(links => {
			let length = Math.min(links.length, cells.length);

			for (let i = 0; i < length; i++) {
				if (links[i]) {
					this.createSite(links[i], cells[i]);
				}
			}
		}).then(function() {
			newTabTools.getThumbnails();
		}, function() {
			console.error('Failed to get tiles');
			newTabTools.page.style.display = 'none';

			let list = newTabTools.databaseError.querySelector('ul');

			let message = newTabTools.getString('database_error_cookies', '$1').split('$1');
			let item = document.createElementNS(HTML_NAMESPACE, 'li');
			let code = document.createElementNS(HTML_NAMESPACE, 'code');
			code.textContent = chrome.runtime.getURL('');
			item.appendChild(document.createTextNode(message[0]));
			item.appendChild(code);
			item.appendChild(document.createTextNode(message[1]));
			list.appendChild(item);

			message = newTabTools.getString('database_error_indexeddb').split('`');
			item = document.createElementNS(HTML_NAMESPACE, 'li');
			while (message.length) {
				let next = message.shift();
				item.appendChild(document.createTextNode(next));

				next = message.shift();
				if (next) {
					code = document.createElementNS(HTML_NAMESPACE, 'code');
					code.textContent = next;
					item.appendChild(code);
				}
			}
			list.appendChild(item);

			newTabTools.databaseError.style.display = 'block';
		});
	},

	/**
	   * Renders the grid.
	   */
	_render() {
		if (this._shouldRenderGrid()) {
			this._renderGrid();
		}

		return this._renderSites();
	},

	_shouldRenderGrid() {
		let rowsLength = this._node.querySelectorAll('.newtab-row').length;
		let cellsLength = this._node.querySelectorAll('.newtab-cell').length;

		return (rowsLength != Prefs.rows || cellsLength != (Prefs.rows * Prefs.columns));
	}
};

/**
 * This class manages a cell's DOM node (not the actually cell content, a site).
 * It's mostly read-only, i.e. all manipulation of both position and content
 * aren't handled here.
 */
function Cell(grid, node) {
	this._grid = grid;
	this._node = node;
	this._node._newtabCell = this;

	// Register drag-and-drop event handlers.
	['dragenter', 'dragover', 'dragexit', 'drop'].forEach(function(type) {
		this._node.addEventListener(type, this);
	}, this);
}

Cell.prototype = {
	/**
	   * The grid.
	   */
	_grid: null,

	/**
	   * The cell's DOM node.
	   */
	get node() { return this._node; },

	/**
	   * The cell's offset in the grid.
	   */
	get index() {
		let index = this._grid.cells.indexOf(this);

		// Cache this value, overwrite the getter.
		Object.defineProperty(this, 'index', {value: index, enumerable: true});

		return index;
	},

	/**
	   * The previous cell in the grid.
	   */
	get previousSibling() {
		let prev = this.node.previousElementSibling;
		prev = prev && prev._newtabCell;

		// Cache this value, overwrite the getter.
		Object.defineProperty(this, 'previousSibling', {value: prev, enumerable: true});

		return prev;
	},

	/**
	   * The next cell in the grid.
	   */
	get nextSibling() {
		let next = this.node.nextElementSibling;
		next = next && next._newtabCell;

		// Cache this value, overwrite the getter.
		Object.defineProperty(this, 'nextSibling', {value: next, enumerable: true});

		return next;
	},

	/**
	   * The site contained in the cell, if any.
	   */
	get site() {
		let firstChild = this.node.firstElementChild;
		return firstChild && firstChild._newtabSite;
	},

	/**
	   * Checks whether the cell contains a pinned site.
	   * @return Whether the cell contains a pinned site.
	   */
	containsPinnedSite() {
		let site = this.site;
		return site && site.isPinned;
	},

	/**
	   * Checks whether the cell contains a site (is empty).
	   * @return Whether the cell is empty.
	   */
	isEmpty() {
		return !this.site;
	},

	/**
	   * Handles all cell events.
	   */
	handleEvent(event) {
		if (!Drag.draggedSite) {
			return;
		}
		if (Prefs.locked) {
			return;
		}

		switch (event.type) {
		case 'dragenter':
			event.preventDefault();
			Drop.enter(this, event);
			break;
		case 'dragover':
			event.preventDefault();
			break;
		case 'dragexit':
			Drop.exit(this, event);
			break;
		case 'drop':
			event.preventDefault();
			if (!event.isTrusted) {
				Drop.drop(this, event);
			}
			break;
		}
	}
};

/**
 * This class represents a site that is contained in a cell and can be pinned,
 * moved around or deleted.
 */
function Site(node, link) {
	this._node = node;
	this._node._newtabSite = this;

	this._link = link;

	this._render();
	this._addEventHandlers();
}

Site.prototype = {
	/**
	   * The site's DOM node.
	   */
	get node() { return this._node; },

	/**
	   * The site's link.
	   */
	get link() { return this._link; },

	/**
	   * The url of the site's link.
	   */
	get url() { return this.link.url; },

	/**
	   * The title of the site's link.
	   */
	get title() { return this.link.title; },

	/**
	   * The site's parent cell.
	   */
	get cell() {
		let parentNode = this.node.parentNode;
		return parentNode && parentNode._newtabCell;
	},

	get thumbnail() {
		return this._querySelector('.newtab-thumbnail');
	},

	/**
	   * Pins the site on its current or a given index.
	   * @param index The pinned index (optional).
	   */
	pin(index) {
		if (typeof index == 'undefined') {
			index = this.cell.index;
		}

		this.updateAttributes(true);
		this._link.position = index;
		Tiles.putTile(this._link);
	},

	/**
	   * Unpins the site and calls the given callback when done.
	   */
	unpin() {
		if (this.isPinned) {
			this.updateAttributes(false);

			let op;
			if (Object.keys(this._link).some(k => !['id', 'title', 'url', 'position'].includes(k))) {
				delete this._link.position;
				op = Tiles.putTile(this._link);
			} else {
				op = Tiles.removeTile(this._link).then(() => {
					delete this._link.id;
					delete this._link.position;
				});
			}

			op.then(() => {
				Updater.updateGrid();
			});
		}
	},

	/**
	   * Checks whether this site is pinned.
	   * @return Whether this site is pinned.
	   */
	get isPinned() {
		return Tiles.isPinned(this._link.url);
	},

	/**
	   * Blocks the site (removes it from the grid) and calls the given callback
	   * when done.
	   */
	block() {
		if (!Blocked.isBlocked(this._link.url)) {
			UndoDialog.show(this);
			Blocked.block(this._link.url);

			(this.isPinned ? Tiles.removeTile(this._link) : Promise.resolve()).then(() => {
				Updater.updateGrid();
			});
		}
	},

	/**
	   * Gets the DOM node specified by the given query selector.
	   * @param selector The query selector.
	   * @return The DOM node we found.
	   */
	_querySelector(selector) {
		return this.node.querySelector(selector);
	},

	/**
	   * Updates attributes for all nodes which status depends on this site being
	   * pinned or unpinned.
	   * @param pinned Whether this site is now pinned or unpinned.
	   */
	updateAttributes(pinned) {
		let control = this._querySelector('.newtab-control-pin');

		if (pinned) {
			control.setAttribute('pinned', true);
			control.setAttribute('title', newTabTools.getString('tile_unpin'));
		} else {
			control.removeAttribute('pinned');
			control.setAttribute('title', newTabTools.getString('tile_pin'));
		}
	},

	/**
	   * Renders the site's data (fills the HTML fragment).
	   */
	_render() {
		if (this.isPinned) {
			this.updateAttributes(true);
		}
		// but still display whatever thumbnail might be available now.
		this.refreshThumbnail();
		this.addTitle();
	},

	addTitle() {
		let url = this.url;
		let title = this.title || url;
		let tooltip = title == url ? title : title + '\n' + url;

		let titleElement = this.node.querySelector('.newtab-title');
		titleElement.textContent = title;

		let link = this._querySelector('.newtab-link');
		link.setAttribute('title', tooltip);
		link.setAttribute('href', url);
	},

	/**
	   * Refreshes the thumbnail for the site.
	   */
	refreshThumbnail() {
		let thumbnail = this.thumbnail;
		thumbnail.style.backgroundColor = this.link.backgroundColor || null;
		if (this.link.image) {
			let thumbnailURL = URL.createObjectURL(this.link.image);
			thumbnail.style.backgroundImage = 'url("' + thumbnailURL + '")';
			if (this.link.imageIsThumbnail) {
				thumbnail.classList.remove('custom-thumbnail');
			} else {
				thumbnail.classList.add('custom-thumbnail');
			}
		} else {
			thumbnail.style.backgroundImage = null;
			thumbnail.classList.remove('custom-thumbnail');
		}
	},

	/**
	   * Adds event handlers for the site and its buttons.
	   */
	_addEventHandlers() {
		// Register drag-and-drop event handlers.
		this._node.addEventListener('dragstart', this);
		this._node.addEventListener('dragend', this);
		this._node.addEventListener('click', this);
	},

	/**
	   * Handles site click events.
	   */
	_onClick(event) {
		let target = event.target;
		if (target.classList.contains('newtab-link') ||
		target.parentElement.classList.contains('newtab-link')) {
			return;
		}

		event.preventDefault();
		if (event.target.classList.contains('newtab-control-block')) {
			this.block();
		} else if (this.isPinned) {
			this.unpin();
		} else {
			this.pin();
		}
	},

	/**
	   * Handles all site events.
	   */
	handleEvent(event) {
		switch (event.type) {
		case 'click':
			this._onClick(event);
			break;
		case 'dragstart':
			if (Prefs.locked) {
				event.preventDefault();
			} else {
				Drag.start(this, event);
			}
			break;
		case 'dragend':
			Drag.end(this, event);
			break;
		}
	}
};

/**
 * This singleton implements site dragging functionality.
 */
var Drag = {
	/**
	   * The site offset to the drag start point.
	   */
	_offsetX: null,
	_offsetY: null,

	/**
	   * The site that is dragged.
	   */
	_draggedSite: null,
	get draggedSite() { return this._draggedSite; },

	/**
	   * The cell width/height at the point the drag started.
	   */
	_cellWidth: null,
	_cellHeight: null,
	get cellWidth() { return this._cellWidth; },
	get cellHeight() { return this._cellHeight; },

	/**
	   * Start a new drag operation.
	   * @param site The site that's being dragged.
	   * @param event The 'dragstart' event.
	   */
	start(site, event) {
		this._draggedSite = site;

		// Mark nodes as being dragged.
		let selector = '.newtab-site, .newtab-control, .newtab-thumbnail';
		let parentCell = site.node.parentNode;
		let nodes = parentCell.querySelectorAll(selector);
		for (let i = 0; i < nodes.length; i++) {
			nodes[i].setAttribute('dragged', 'true');
		}

		parentCell.setAttribute('dragged', 'true');

		this._setDragData(site, event);

		// Store the cursor offset.
		let node = site.node;
		let rect = node.getBoundingClientRect();
		let {offsetLeft, offsetTop} = newTabTools.page.firstElementChild;
		this._offsetX = event.clientX - rect.left + offsetLeft;
		this._offsetY = event.clientY - rect.top + offsetTop;

		// Store the cell dimensions.
		let cellNode = site.cell.node;
		this._cellWidth = cellNode.offsetWidth;
		this._cellHeight = cellNode.offsetHeight;

		let style = site.node.style;
		style.width = this._cellWidth + 'px';
		style.height = this._cellHeight + 'px';
		site.node.setAttribute('frozen', 'true');
	},

	/**
	   * Handles the 'drag' event.
	   * @param site The site that's being dragged.
	   * @param event The 'drag' event.
	   */
	drag(site, event) {
		// Get the viewport size.
		let {clientWidth, clientHeight} = document.documentElement;
		let {offsetLeft, offsetTop} = newTabTools.page.firstElementChild;

		// We'll want a padding of 5px.
		let border = 5;

		// Enforce minimum constraints to keep the drag image inside the window.
		let left = Math.max(event.clientX - this._offsetX, border - offsetLeft);
		let top = Math.max(event.clientY - this._offsetY, border - offsetTop);

		// Enforce maximum constraints to keep the drag image inside the window.
		left = Math.min(left, clientWidth - this.cellWidth - border - offsetLeft);
		top = Math.min(top, clientHeight - this.cellHeight - border - offsetTop);

		// Update the drag image's position.
		Transformation.setSitePosition(site, {left, top});
		this._cellLeft = left;
		this._cellTop = top;
	},

	/**
	   * Ends the current drag operation.
	   * @param site The site that's being dragged.
	   * @param event The 'dragend' event.
	   */
	end(site) {
		let nodes = Grid.node.querySelectorAll('[dragged]');
		for (let i = 0; i < nodes.length; i++) {
			nodes[i].removeAttribute('dragged');
		}

		// Slide the dragged site back into its cell if it didn't move.
		// Transformation_rearrangeSites will fix it if it did move.
		if (!Drop._lastDropTarget || Drop._lastDropTarget.index === site.cell.index) {
			Transformation.slideSiteTo(site, site.cell, {unfreeze: true});
		}

		Drop._lastDropTarget = null;
		this._draggedSite = null;
	},

	/**
	   * Initializes the drag data for the current drag operation.
	   * @param site The site that's being dragged.
	   * @param event The 'dragstart' event.
	   */
	_setDragData(site, event) {
		let {url, title} = site;

		let dt = event.dataTransfer;
		dt.mozCursor = 'default';
		dt.effectAllowed = 'move';
		dt.setData('text/plain', url);
		dt.setData('text/uri-list', url);
		dt.setData('text/x-moz-url', url + '\n' + title);
		if (url.includes('"') && url.includes('<')) {
			url = url.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		}
		dt.setData('text/html', '<a href="' + url + '">' + url + '</a>');

		// Create and use an empty drag element. We don't want to use the default
		// drag image with its default opacity.
		let dragElement = document.createElementNS(HTML_NAMESPACE, 'div');
		dragElement.classList.add('newtab-drag');
		let scrollbox = document.getElementById('newtab-scrollbox');
		scrollbox.appendChild(dragElement);
		dt.setDragImage(dragElement, 0, 0);

		// After the 'dragstart' event has been processed we can remove the
		// temporary drag element from the DOM.
		setTimeout(function() { scrollbox.removeChild(dragElement); }, 0);
	}
};

// A little delay that prevents the grid from being too sensitive when dragging
// sites around.
const DELAY_REARRANGE_MS = 100;

/**
 * This singleton implements site dropping functionality.
 */
var Drop = {
	/**
	   * The last drop target.
	   */
	_lastDropTarget: null,

	/**
	   * Handles the 'dragenter' event.
	   * @param cell The drop target cell.
	   */
	enter(cell) {
		this._delayedRearrange(cell);
	},

	/**
	   * Handles the 'dragexit' event.
	   * @param cell The drop target cell.
	   * @param event The 'dragexit' event.
	   */
	exit(cell, event) {
		if (event.dataTransfer && !event.dataTransfer.mozUserCancelled) {
			this._delayedRearrange();
		} else {
			// The drag operation has been cancelled.
			this._cancelDelayedArrange();
			this._rearrange();
		}
	},

	/**
	   * Handles the 'drop' event.
	   * @param cell The drop target cell.
	   * @param event The 'dragexit' event.
	   */
	drop(cell, event) {
		// The cell that is the drop target could contain a pinned site. We need
		// to find out where that site has gone and re-pin it there.
		if (cell.containsPinnedSite()) {
			this._repinSitesAfterDrop(cell);
		}

		// Pin the dragged or insert the new site.
		this._pinDraggedSite(cell, event);

		this._cancelDelayedArrange();

		// Update the grid and move all sites to their new places.
		Updater.updateGrid();
	},

	/**
	   * Re-pins all pinned sites in their (new) positions.
	   * @param cell The drop target cell.
	   */
	_repinSitesAfterDrop(cell) {
		let sites = DropPreview.rearrange(cell);

		// Filter out pinned sites.
		let pinnedSites = sites.filter(function(site) {
			return site && site.isPinned;
		});

		// Re-pin all shifted pinned cells.
		pinnedSites.forEach(function(site) { site.pin(sites.indexOf(site)); }, this);
	},

	/**
	   * Pins the dragged site in its new place.
	   * @param cell The drop target cell.
	   */
	_pinDraggedSite(cell) {
		let index = cell.index;
		let draggedSite = Drag.draggedSite;

		if (draggedSite) {
			// Pin the dragged site at its new place.
			if (cell != draggedSite.cell) {
				draggedSite.pin(index);
			}
		}
	},

	/**
	   * Time a rearrange with a little delay.
	   * @param cell The drop target cell.
	   */
	_delayedRearrange(cell) {
		// The last drop target didn't change so there's no need to re-arrange.
		if (this._lastDropTarget == cell) {
			return;
		}

		let self = this;

		function callback() {
			self._rearrangeTimeout = null;
			self._rearrange(cell);
		}

		this._cancelDelayedArrange();
		this._rearrangeTimeout = setTimeout(callback, DELAY_REARRANGE_MS);

		// Store the last drop target.
		this._lastDropTarget = cell;
	},

	/**
	   * Cancels a timed rearrange, if any.
	   */
	_cancelDelayedArrange() {
		if (this._rearrangeTimeout) {
			clearTimeout(this._rearrangeTimeout);
			this._rearrangeTimeout = null;
		}
	},

	/**
	   * Rearrange all sites in the grid depending on the current drop target.
	   * @param cell The drop target cell.
	   */
	_rearrange(cell) {
		let sites = Grid.sites;

		// We need to rearrange the grid only if there's a current drop target.
		if (cell) {
			sites = DropPreview.rearrange(cell);
		}

		Transformation.rearrangeSites(sites, {unfreeze: !cell});
	}
};

/**
 * This singleton provides a custom drop target detection. We need this because
 * the default DnD target detection relies on the cursor's position. We want
 * to pick a drop target based on the dragged site's position.
 */
var DropTargetShim = {
	/**
	   * Cache for the position of all cells, cleaned after drag finished.
	   */
	_cellPositions: null,

	/**
	   * The last drop target that was hovered.
	   */
	_lastDropTarget: null,

	/**
	   * Initializes the drop target shim.
	   */
	init() {
		Grid.node.addEventListener('dragstart', this, true);
	},

	/**
	   * Add all event listeners needed during a drag operation.
	   */
	_addEventListeners() {
		Grid.node.addEventListener('dragend', this);

		let docElement = document.documentElement;
		docElement.addEventListener('dragover', this);
		docElement.addEventListener('dragenter', this);
		docElement.addEventListener('drop', this);
	},

	/**
	   * Remove all event listeners that were needed during a drag operation.
	   */
	_removeEventListeners() {
		Grid.node.removeEventListener('dragend', this);

		let docElement = document.documentElement;
		docElement.removeEventListener('dragover', this);
		docElement.removeEventListener('dragenter', this);
		docElement.removeEventListener('drop', this);
	},

	/**
	   * Handles all shim events.
	   */
	handleEvent(event) {
		if (Prefs.locked) {
			return;
		}

		switch (event.type) {
		case 'dragstart':
			this._dragstart(event);
			break;
		case 'dragenter':
			event.preventDefault();
			break;
		case 'dragover':
			this._dragover(event);
			break;
		case 'drop':
			this._drop(event);
			break;
		case 'dragend':
			this._dragend(event);
			break;
		}
	},

	/**
	   * Handles the 'dragstart' event.
	   * @param event The 'dragstart' event.
	   */
	_dragstart(event) {
		if (event.target.classList.contains('newtab-link')) {
			Grid.lock();
			this._addEventListeners();
		}
	},

	/**
	   * Handles the 'dragover' event.
	   * @param event The 'dragover' event.
	   */
	_dragover(event) {
		let sourceNode = event.target;
		while (sourceNode && !sourceNode.classList.contains('newtab-site')) {
			sourceNode = sourceNode.parentNode;
		}
		Drag.drag(sourceNode._newtabSite, event);

		// Find the current drop target, if there's one.
		this._updateDropTarget(event);

		// If we have a valid drop target,
		// let the drag-and-drop service know.
		if (this._lastDropTarget) {
			event.preventDefault();
		}
	},

	/**
	   * Handles the 'drop' event.
	   * @param event The 'drop' event.
	   */
	_drop(event) {
		// We're accepting all drops.
		event.preventDefault();

		// Make sure to determine the current drop target
		// in case the dragover event hasn't been fired.
		this._updateDropTarget(event);

		// A site was successfully dropped.
		this._dispatchEvent(event, 'drop', this._lastDropTarget);
	},

	/**
	   * Handles the 'dragend' event.
	   * @param event The 'dragend' event.
	   */
	_dragend(event) {
		if (this._lastDropTarget) {
			if (event.dataTransfer.mozUserCancelled) {
				// The drag operation was cancelled.
				this._dispatchEvent(event, 'dragexit', this._lastDropTarget);
				this._dispatchEvent(event, 'dragleave', this._lastDropTarget);
			}

			// Clean up.
			this._lastDropTarget = null;
			this._cellPositions = null;
		}

		Grid.unlock();
		this._removeEventListeners();
	},

	/**
	   * Tries to find the current drop target and will fire
	   * appropriate dragenter, dragexit, and dragleave events.
	   * @param event The current drag event.
	   */
	_updateDropTarget(event) {
		// Let's see if we find a drop target.
		let target = this._findDropTarget(event);

		if (target != this._lastDropTarget) {
			if (this._lastDropTarget) { // We left the last drop target.
				this._dispatchEvent(event, 'dragexit', this._lastDropTarget);
			}
			if (target) { // We're now hovering a (new) drop target.
				this._dispatchEvent(event, 'dragenter', target);
			}
			if (this._lastDropTarget) { // We left the last drop target.
				this._dispatchEvent(event, 'dragleave', this._lastDropTarget);
			}
			this._lastDropTarget = target;
		}
	},

	/**
	   * Determines the current drop target by matching the dragged site's position
	   * against all cells in the grid.
	   * @return The currently hovered drop target or null.
	   */
	_findDropTarget() {
		// These are the minimum intersection values - we want to use the cell if
		// the site is >= 50% hovering its position.
		let minWidth = Drag.cellWidth / 2;
		let minHeight = Drag.cellHeight / 2;

		let cellPositions = this._getCellPositions();
		let rect = new DOMRect(Drag._cellLeft, Drag._cellTop, Drag.cellWidth, Drag.cellHeight);

		// Compare each cell's position to the dragged site's position.
		for (let i = 0; i < cellPositions.length; i++) {
			let inter = rect.intersect(cellPositions[i].rect);

			// If the intersection is big enough we found a drop target.
			if (inter.width >= minWidth && inter.height >= minHeight) {
				return cellPositions[i].cell;
			}
		}

		// No drop target found.
		return null;
	},

	/**
	   * Gets the positions of all cell nodes.
	   * @return The (cached) cell positions.
	   */
	_getCellPositions() {
		if (this._cellPositions) {
			return this._cellPositions;
		}

		return this._cellPositions = Grid.cells.filter(function(cell) { // jshint ignore:line
			return !cell.node.hasAttribute('dragged');
		}).map(function(cell) {
			return {cell, rect: cell.position};
		});
	},

	/**
	   * Dispatches a custom DragEvent on the given target node.
	   * @param event The source event.
	   * @param type The event type.
	   * @param target The target node that receives the event.
	   */
	_dispatchEvent({dataTransfer}, type, target) {
		let node = target.node;
		let event = new DragEvent(type, {dataTransfer});
		node.dispatchEvent(event);
	}
};

/**
 * This singleton provides the ability to re-arrange the current grid to
 * indicate the transformation that results from dropping a cell at a certain
 * position.
 */
var DropPreview = {
	/**
	   * Rearranges the sites currently contained in the grid when a site would be
	   * dropped onto the given cell.
	   * @param cell The drop target cell.
	   * @return The re-arranged array of sites.
	   */
	rearrange(cell) {
		let sites = Grid.sites;

		// Insert the dragged site into the current grid.
		this._insertDraggedSite(sites, cell);

		// After the new site has been inserted we need to correct the positions
		// of all pinned tabs that have been moved around.
		this._repositionPinnedSites(sites, cell);

		return sites;
	},

	/**
	   * Inserts the currently dragged site into the given array of sites.
	   * @param sites The array of sites to insert into.
	   * @param cell The drop target cell.
	   */
	_insertDraggedSite(sites, cell) {
		let dropIndex = cell.index;
		let draggedSite = Drag.draggedSite;

		// We're currently dragging a site.
		if (draggedSite) {
			let dragCell = draggedSite.cell;
			let dragIndex = dragCell.index;

			// Move the dragged site into its new position.
			if (dragIndex != dropIndex) {
				sites.splice(dragIndex, 1);
				sites.splice(dropIndex, 0, draggedSite);
			}
			// We're handling an external drag item.
		} else {
			sites.splice(dropIndex, 0, null);
		}
	},

	/**
	   * Correct the position of all pinned sites that might have been moved to
	   * different positions after the dragged site has been inserted.
	   * @param sites The array of sites containing the dragged site.
	   * @param cell The drop target cell.
	   */
	_repositionPinnedSites(sites, cell) {
		// Collect all pinned sites.
		let pinnedSites = this._filterPinnedSites(sites, cell);

		// Correct pinned site positions.
		pinnedSites.forEach(function(site) {
			sites[sites.indexOf(site)] = sites[site.cell.index];
			sites[site.cell.index] = site;
		}, this);

		// There might be a pinned cell that got pushed out of the grid, try to
		// sneak it in by removing a lower-priority cell.
		if (this._hasOverflowedPinnedSite(sites, cell)) {
			this._repositionOverflowedPinnedSite(sites, cell);
		}
	},

	/**
	   * Filter pinned sites out of the grid that are still on their old positions
	   * and have not moved.
	   * @param sites The array of sites to filter.
	   * @param cell The drop target cell.
	   * @return The filtered array of sites.
	   */
	_filterPinnedSites(sites, cell) {
		let draggedSite = Drag.draggedSite;

		// When dropping on a cell that contains a pinned site make sure that all
		// pinned cells surrounding the drop target are moved as well.
		let range = this._getPinnedRange(cell);

		return sites.filter(function(site) {
			// The site must be valid, pinned and not the dragged site.
			if (!site || site == draggedSite || !site.isPinned) {
				return false;
			}

			let index = site.cell.index;

			// If it's not in the 'pinned range' it's a valid pinned site.
			return (index > range.end || index < range.start);
		});
	},

	/**
	   * Determines the range of pinned sites surrounding the drop target cell.
	   * @param cell The drop target cell.
	   * @return The range of pinned cells.
	   */
	_getPinnedRange(cell) {
		let dropIndex = cell.index;
		let range = {start: dropIndex, end: dropIndex};

		// We need a pinned range only when dropping on a pinned site.
		if (cell.containsPinnedSite()) {
			// let links = PinnedLinks.links;

			// Find all previous siblings of the drop target that are pinned as well.
			while (range.start && Grid.cells[range.start - 1].containsPinnedSite()) {
				range.start--;
			}

			let maxEnd = Grid.cells.length - 1;

			// Find all next siblings of the drop target that are pinned as well.
			while (range.end < maxEnd && Grid.cells[range.end + 1].containsPinnedSite()) {
				range.end++;
			}
		}

		return range;
	},

	/**
	   * Checks if the given array of sites contains a pinned site that has
	   * been pushed out of the grid.
	   * @param sites The array of sites to check.
	   * @param cell The drop target cell.
	   * @return Whether there is an overflowed pinned cell.
	   */
	_hasOverflowedPinnedSite(sites, cell) {
		// If the drop target isn't pinned there's no way a pinned site has been
		// pushed out of the grid so we can just exit here.
		if (!cell.containsPinnedSite()) {
			return false;
		}

		let cells = Grid.cells;

		// No cells have been pushed out of the grid, nothing to do here.
		if (sites.length <= cells.length) {
			return false;
		}

		let overflowedSite = sites[cells.length];

		// Nothing to do if the site that got pushed out of the grid is not pinned.
		return (overflowedSite && overflowedSite.isPinned);
	},

	/**
	   * We have a overflowed pinned site that we need to re-position so that it's
	   * visible again. We try to find a lower-priority cell (empty or containing
	   * an unpinned site) that we can move it to.
	   * @param sites The array of sites.
	   * @param cell The drop target cell.
	   */
	_repositionOverflowedPinnedSite(sites, cell) {
		// Try to find a lower-priority cell (empty or containing an unpinned site).
		let index = this._indexOfLowerPrioritySite(sites, cell);

		if (index > -1) {
			let cells = Grid.cells;
			let dropIndex = cell.index;

			// Move all pinned cells to their new positions to let the overflowed
			// site fit into the grid.
			for (let i = index + 1, lastPosition = index; i < sites.length; i++) {
				if (i != dropIndex) {
					sites[lastPosition] = sites[i];
					lastPosition = i;
				}
			}

			// Finally, remove the overflowed site from its previous position.
			sites.splice(cells.length, 1);
		}
	},

	/**
	   * Finds the index of the last cell that is empty or contains an unpinned
	   * site. These are considered to be of a lower priority.
	   * @param sites The array of sites.
	   * @param cell The drop target cell.
	   * @return The cell's index.
	   */
	_indexOfLowerPrioritySite(sites, cell) {
		let cells = Grid.cells;
		let dropIndex = cell.index;

		// Search (beginning with the last site in the grid) for a site that is
		// empty or unpinned (an thus lower-priority) and can be pushed out of the
		// grid instead of the pinned site.
		for (let i = cells.length - 1; i >= 0; i--) {
			// The cell that is our drop target is not a good choice.
			if (i == dropIndex) {
				continue;
			}

			let site = sites[i];

			// We can use the cell only if it's empty or the site is un-pinned.
			if (!site || !site.isPinned) {
				return i;
			}
		}

		return -1;
	}
};

/**
 * This singleton provides functionality to update the current grid to a new
 * set of pinned and blocked sites. It adds, moves and removes sites.
 */
var Updater = {
	/**
	   * Updates the current grid according to its pinned and blocked sites.
	   * This removes old, moves existing and creates new sites to fill gaps.
	   * @param callback The callback to call when finished.
	   */
	updateGrid(callback) {
		// let links = NewTabToolsLinks.getLinks().slice(0, Grid.cells.length);
		Tiles.getAllTiles().then(links => {
			// Find all sites that remain in the grid.
			let sites = this._findRemainingSites(links);

			let self = this;

			// Remove sites that are no longer in the grid.
			this._removeLegacySites(sites, function() {
				// Freeze all site positions so that we can move their DOM nodes around
				// without any visual impact.
				self._freezeSitePositions(sites);

				// Move the sites' DOM nodes to their new position in the DOM. This will
				// have no visual effect as all the sites have been frozen and will
				// remain in their current position.
				self._moveSiteNodes(sites);

				// Now it's time to animate the sites actually moving to their new
				// positions.
				self._rearrangeSites(sites, function() {
					// Try to fill empty cells and finish.
					self._fillEmptyCells(links, callback);

					// Update other pages that might be open to keep them synced.
					// AllPages.update(Page);
				});
			});
		});
	},

	fastUpdateGrid() {
		// let links = NewTabToolsLinks.getLinks().slice(0, Grid.cells.length);
		Tiles.getAllTiles().then(function(links) {
			// Find all sites that remain in the grid.
			let sites = this._findRemainingSites(links);

			// Remove sites that are no longer in the grid.
			this._removeLegacySites(sites, () => {
				// Try to fill empty cells and finish.
				this._fillEmptyCells(links);
			});
		});
	},

	/**
	   * Takes an array of links and tries to correlate them to sites contained in
	   * the current grid. If no corresponding site can be found (i.e. the link is
	   * new and a site will be created) then just set it to null.
	   * @param links The array of links to find sites for.
	   * @return Array of sites mapped to the given links (can contain null values).
	   */
	_findRemainingSites(links) {
		let map = {};

		// Create a map to easily retrieve the site for a given URL.
		Grid.sites.forEach(function(site) {
			if (site) {
				map[site.url] = site;
			}
		});

		// Map each link to its corresponding site, if any.
		return links.map(function(link) {
			return link && (link.url in map) && map[link.url];
		});
	},

	/**
	   * Freezes the given sites' positions.
	   * @param sites The array of sites to freeze.
	   */
	_freezeSitePositions(sites) {
		sites.forEach(function(site) {
			if (site) {
				Transformation.freezeSitePosition(site);
			}
		});
	},

	/**
	   * Moves the given sites' DOM nodes to their new positions.
	   * @param sites The array of sites to move.
	   */
	_moveSiteNodes(sites) {
		let cells = Grid.cells;

		// Truncate the given array of sites to not have more sites than cells.
		// This can happen when the user drags a bookmark (or any other new kind
		// of link) onto the grid.
		sites = sites.slice(0, cells.length);

		sites.forEach(function(site, index) {
			let cell = cells[index];
			let cellSite = cell.site;

			// The site's position didn't change.
			if (!site || cellSite != site) {
				let cellNode = cell.node;

				// Empty the cell if necessary.
				if (cellSite) {
					cellNode.removeChild(cellSite.node);
				}

				// Put the new site in place, if any.
				if (site) {
					cellNode.appendChild(site.node);
				}
			}
		}, this);
	},

	/**
	   * Rearranges the given sites and slides them to their new positions.
	   * @param sites The array of sites to re-arrange.
	   * @param callback The callback to call when finished.
	   */
	_rearrangeSites(sites, callback) {
		let options = {callback, unfreeze: true};
		Transformation.rearrangeSites(sites, options);
	},

	/**
	   * Removes all sites from the grid that are not in the given links array or
	   * exceed the grid.
	   * @param sites The array of sites remaining in the grid.
	   * @param callback The callback to call when finished.
	   */
	_removeLegacySites(sites, callback) {
		let batch = [];

		// Delete sites that were removed from the grid.
		Grid.sites.forEach(function(site) {
			// The site must be valid and not in the current grid.
			if (!site || sites.includes(site)) {
				return;
			}

			batch.push(new Promise(resolve => {
				// Fade out the to-be-removed site.
				Transformation.hideSite(site, function() {
					let node = site.node;

					// Remove the site from the DOM.
					node.remove();
					resolve();
				});
			}));
		});

		Promise.all(batch).then(callback);
	},

	/**
	   * Tries to fill empty cells with new links if available.
	   * @param links The array of links.
	   * @param callback The callback to call when finished.
	   */
	_fillEmptyCells(links, callback) {
		let {cells, sites} = Grid;

		// Find empty cells and fill them.
		Promise.all(sites.map((site, index) => {
			if (site || !links[index]) {
				return null;
			}

			return new Promise(resolve => {
				// Create the new site and fade it in.
				let site = Grid.createSite(links[index], cells[index]);

				// Set the site's initial opacity to zero.
				site.node.style.opacity = 0;

				// Flush all style changes for the dynamically inserted site to make
				// the fade-in transition work.
				window.getComputedStyle(site.node).opacity; // jshint ignore:line
				Transformation.showSite(site, resolve);
			});
		})).then(function() {
			newTabTools.getThumbnails();
		}).then(callback).catch(console.exception);
	}
};

/**
 * Dialog allowing to undo the removal of single site or to completely restore
 * the grid's original state.
 */
var UndoDialog = {
	/**
	   * The undo dialog's timeout in miliseconds.
	   */
	HIDE_TIMEOUT_MS: 15000,

	/**
	   * Contains undo information.
	   */
	_undoData: null,

	/**
	   * Initializes the undo dialog.
	   */
	init() {
		this._undoContainer = document.getElementById('newtab-undo-container');
		this._undoContainer.addEventListener('click', this);
		this._undoButton = document.getElementById('newtab-undo-button');
		this._undoCloseButton = document.getElementById('newtab-undo-close-button');
		this._undoRestoreButton = document.getElementById('newtab-undo-restore-button');
	},

	/**
	   * Shows the undo dialog.
	   * @param site The site that just got removed.
	   */
	show(site) {
		if (this._undoData) {
			clearTimeout(this._undoData.timeout);
		}

		this._undoData = {
			index: site.cell.index,
			wasPinned: site.isPinned,
			blockedLink: site.link,
			timeout: setTimeout(this.hide.bind(this), this.HIDE_TIMEOUT_MS)
		};

		this._undoContainer.removeAttribute('undo-disabled');
		this._undoButton.removeAttribute('tabindex');
		this._undoCloseButton.removeAttribute('tabindex');
		this._undoRestoreButton.removeAttribute('tabindex');

		newTabTools.trimRecent();
	},

	/**
	   * Hides the undo dialog.
	   */
	hide() {
		if (!this._undoData) {
			return;
		}

		clearTimeout(this._undoData.timeout);
		this._undoData = null;
		this._undoContainer.setAttribute('undo-disabled', 'true');
		this._undoButton.setAttribute('tabindex', '-1');
		this._undoCloseButton.setAttribute('tabindex', '-1');
		this._undoRestoreButton.setAttribute('tabindex', '-1');

		newTabTools.trimRecent();
	},

	/**
	   * The undo dialog event handler.
	   * @param event The event to handle.
	   */
	handleEvent(event) {
		switch (event.target.id) {
		case 'newtab-undo-button':
			this._undo();
			break;
		case 'newtab-undo-restore-button':
			this._undoAll();
			break;
		case 'newtab-undo-close-button':
			this.hide();
			break;
		}
	},

	/**
	   * Undo the last blocked site.
	   */
	_undo() {
		if (!this._undoData) {
			return;
		}

		let {wasPinned, blockedLink} = this._undoData;
		Blocked.unblock(blockedLink.url);

		if (wasPinned) {
			Tiles.putTile(blockedLink);
		}

		Updater.updateGrid();
		this.hide();
	},

	/**
	   * Undo all blocked sites.
	   */
	_undoAll() {
		Blocked.clear();
		Updater.updateGrid();
		this.hide();
	}
};

UndoDialog.init();

newTabTools.startup();
