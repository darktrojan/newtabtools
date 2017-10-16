/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at http://mozilla.org/MPL/2.0/.
*/
/* globals Prefs, Filters, Grid, Page, Tiles, Updater, Transformation, Background, chrome, -length */

var HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

var newTabTools = {
	getString: function(name, ...substitutions) {
		return chrome.i18n.getMessage(name, substitutions);
	},
	isValidURL: function(url) {
		try {
			return ['http:', 'https:', 'ftp:'].includes(new URL(url).protocol);
		} catch (ex) {
			return false;
		}
	},
	autocomplete: function() {
		this.pinURLAutocomplete.hidden = false;
		let value = this.pinURLInput.value;
		if (value.length < 2) {
			while (this.pinURLAutocomplete.lastChild) {
				this.pinURLAutocomplete.lastChild.remove();
			}
			this.pinURLAutocomplete.hidden = true;
			return;
		}
		let valueParts = value.toLowerCase().split(/\s+/);

		let count = 0;
		let options = Array.from(this.pinURLAutocomplete.children);
		let urls = options.filter(function(u) {
			let matches = valueParts.every(vp => u.dataset.url.toLowerCase().includes(vp) || u.dataset.title.toLowerCase().includes(vp));
			if (matches) {
				count++;
			}
			u.hidden = count > 10 || !matches;
			return matches;
		}).map(u => u.dataset.url);

		let exact = options.find(function(u) {
			return u.dataset.url == value;
		});
		if (exact) {
			this.pinURLAutocomplete.insertBefore(exact, this.pinURLAutocomplete.firstChild);
		}

		if (count >= 10) {
			return;
		}

		let template = newTabTools.pinURLAutocomplete.nextElementSibling;
		let maybeAddItem = (item, type) => {
			if (!this.isValidURL(item.url) || urls.includes(item.url)) {
				return;
			}
			if (!valueParts.every(vp => item.url.toLowerCase().includes(vp) || item.title.toLowerCase().includes(vp))) {
				return;
			}

			let option = template.content.firstElementChild.cloneNode(true);
			option.classList.add(type);
			if (Tiles.isPinned(item.url)) {
				option.classList.add('pinned');
			}
			option.dataset.title = option.querySelector('.autocomplete-title').textContent = item.title;
			option.dataset.url = option.querySelector('.autocomplete-url').textContent = item.url;
			if (++count > 10) {
				option.hidden = true;
			}
			if (item.url == value) {
				this.pinURLAutocomplete.insertBefore(option, this.pinURLAutocomplete.firstChild);
			} else {
				this.pinURLAutocomplete.appendChild(option);
			}
			urls.push(item.url);
		};

		chrome.bookmarks.getTree(tree => {
			function traverse(children) {
				for (let c of children) {
					if (c.type == 'folder') {
						traverse(c.children);
					} else if (c.type == 'bookmark') {
						maybeAddItem(c, 'bookmark');
					}
				}
			}

			traverse(tree[0].children);

			if (count >= 10) {
				return;
			}

			chrome.tabs.query({}, tabs => {
				for (let t of tabs) {
					maybeAddItem(t, 'tab');
				}

				if (count >= 10) {
					return;
				}

				chrome.history.search({
					text: value,
					startTime: 0
				}, result => {
					for (let r of result) {
						maybeAddItem(r, 'history');
					}
					this.pinURLAutocomplete.hidden = !count;
				});
			});
		});
	},
	get selectedSite() {
		return Grid.sites[this._selectedSiteIndex];
	},
	optionsOnClick: function(event) {
		if (event.target.disabled) {
			return;
		}
		let {id, classList} = event.target;
		switch (id) {
		case 'options-close-button':
			newTabTools.hideOptions();
			break;
		case 'options-pinURL':
			if (!this.pinURLInput.checkValidity()) {
				throw 'URL is invalid';
			}

			let position, cell, length, svg, path, dbID;
			let shouldUpdateGrid = true;
			let url = this.pinURLInput.value;
			Tiles.getTile(url).then(tile => {
				return tile ? tile : new Promise(resolve => {
					chrome.history.search({
						text: url,
						startTime: 0
					}, function(result) {
						let entry = result.find(function(f) {
							return f.url == url;
						});
						tile = { url };
						if (entry && entry.title) {
							tile.title = entry.title;
						}
						resolve(tile);
					});
				});
			}).then(tile => {
				if ('position' in tile && tile.position < Prefs.rows * Prefs.columns) {
					console.warn('Already pinned');
					position = tile.position;
					cell = Grid.cells[tile.position];
					shouldUpdateGrid = false;
					return Promise.resolve();
				}

				cell = Grid.cells.find(c => !c.containsPinnedSite());
				if (!cell) {
					throw 'No free space';
				}
				tile.position = position = cell.index;
				return Tiles.putTile(tile);
			}).then(id => {
				dbID = id;
				return new Promise(resolve => {
					let bcr = cell.node.getBoundingClientRect();
					let width = Math.round(bcr.width) + 2;
					let height = Math.round(bcr.height) + 2;
					let halfLength = width + height;
					length = halfLength * 2;

					svg = document.querySelector('svg');
					svg.style.left = Math.round(bcr.left - 2) + 'px';
					svg.style.top = Math.round(bcr.top - 2) + 'px';
					svg.setAttribute('width', width + 2);
					svg.setAttribute('height', height + 2);

					path = svg.querySelector('path');
					path.setAttribute('d', 'M1 1V' + (height + 1) + 'H' + (width + 1) + 'V1Z');
					path.style.strokeDasharray = [halfLength, halfLength, halfLength, length].join(' ');

					newTabTools.optionsPane.animate([
						{'opacity': 1},
						{'opacity': 0}
					], {duration: 150, fill: 'both'}).onfinish = resolve;
				});
			}).then(() => {
				return shouldUpdateGrid ? new Promise(resolve => {
					Updater.updateGrid(resolve);
				}) : Promise.resolve();
			}).then(() => {
				// Ensure that the just added site is pinned and selected.
				let site = Grid.sites[position];
				site.link.id = dbID;
				site.link.position = position;
				site.updateAttributes(true);
				newTabTools.pinURLInput.value = '';
				newTabTools.pinURLInput.focus();
				newTabTools.selectedSiteIndex = position;

				Transformation.freezeSitePosition(site);
				site.node.setAttribute('highlighted', 'true');
				return new Promise(resolve => {
					svg.style.display = 'block';
					path.animate([
						{'strokeDashoffset': 0 - length},
						{'strokeDashoffset': length * 1.5}
					], {duration: 1500, fill: 'both'}).onfinish = () => {
						svg.style.display = null;
						site.node.removeAttribute('highlighted');
						Transformation.unfreezeSitePosition(site);
						newTabTools.optionsPane.animate([
							{'opacity': 0},
							{'opacity': 1}
						], {duration: 150, fill: 'both'}).onfinish = resolve;
					};
				});
			}).catch(console.error);
			break;
		case 'options-previous-row-tile':
			this.selectedSiteIndex = (this._selectedSiteIndex - Prefs.columns + Grid.cells.length) % Grid.cells.length;
			break;
		case 'options-previous-tile':
		case 'options-next-tile':
			let { columns } = Prefs;
			let row = Math.floor(this._selectedSiteIndex / columns);
			let column = (this._selectedSiteIndex + (id == 'options-previous-tile' ? -1 : 1) + columns) % columns;

			this.selectedSiteIndex = row * columns + column;
			break;
		case 'options-next-row-tile':
			this.selectedSiteIndex = (this._selectedSiteIndex + Prefs.columns) % Grid.cells.length;
			break;
		case 'options-savedthumb-set':
			this.setThumbnail(this.selectedSite, URL.createObjectURL(this.setSavedThumbInput.files[0]));
			this.removeSavedThumbButton.disabled = false;
			break;
		case 'options-savedthumb-remove':
			this.removeThumbnail(this.selectedSite);
			this.removeSavedThumbButton.disabled = true;
			break;
		case 'options-bgcolor-displaybutton':
			this.setBgColourInput.click();
			break;
		case 'options-bgcolor-set':
			this.selectedSite.link.backgroundColor = this.setBgColourInput.value;
			Tiles.putTile(this.selectedSite.link);
			this.selectedSite.thumbnail.style.backgroundColor =
				this.siteThumbnail.style.backgroundColor = this.setBgColourInput.value;
			this.resetBgColourButton.disabled = false;
			break;
		case 'options-bgcolor-reset':
			delete this.selectedSite.link.backgroundColor;
			Tiles.putTile(this.selectedSite.link);
			this.selectedSite.thumbnail.style.backgroundColor =
				this.siteThumbnail.style.backgroundColor =
				this.setBgColourInput.value =
				this.setBgColourDisplay.style.backgroundColor = null;
			this.setBgColourButton.disabled =
				this.resetBgColourButton.disabled = true;
			break;
		case 'options-title-set':
			this.selectedSite.link.title = this.setTitleInput.value;
			this.selectedSite.addTitle();
			Tiles.putTile(this.selectedSite.link);
			break;
		case 'options-bg-set':
			if (this.setBackgroundInput.files.length) {
				let file = this.setBackgroundInput.files[0];
				Background.setBackground(file).then(() => {
					this.refreshBackgroundImage();
				});
			}
			break;
		case 'options-bg-remove':
			Background.setBackground().then(() => {
				this.refreshBackgroundImage();
			});
			break;
		case 'historytiles-filter':
			document.documentElement.setAttribute('options-filter-shown', '');
			this.fillFilterUI();
			return;
		case 'options-filter-set':
			Filters.setFilter(this.optionsFilterHost.value, parseInt(this.optionsFilterCount.value, 10));
			Updater.updateGrid();
			this.fillFilterUI(this.optionsFilterHost.value);
			this.optionsFilterHost.value = '';
			this.optionsFilterCount.value = '';
			this.optionsFilterHost.focus();
			this.optionsFilterSet.disabled = true;
			return;
		case 'options-donate':
		case 'newtab-update-donate':
			window.open('https://darktrojan.github.io/donate.html?newtabtools');
			Prefs.versionLastAck = new Date();
			break;
		case 'newtab-update-changelog':
			window.open('https://addons.mozilla.org/addon/new-tab-tools/versions/' + this.updateNotice.dataset.version);
			Prefs.versionLastAck = new Date();
			break;
		case 'newtab-update-hide':
			this.updateNotice.hidden = true;
			Prefs.versionLastAck = new Date();
			break;
		}

		if (classList.contains('plus-button') || classList.contains('minus-button')) {
			let row = event.target.parentNode.parentNode;
			let unpinned = row.cells[2].querySelector('span');
			let count = parseInt(unpinned.textContent, 10);

			if (isNaN(count)) {
				if (classList.contains('minus-button')) {
					return;
				}
				count = -1;
			}
			count += classList.contains('plus-button') ? 1 : -1;
			unpinned.textContent = count == -1 ? this.getString('filter_unlimited') : count;
			row.querySelector('.minus-button').disabled = count == -1;

			Filters.setFilter(row.cells[0].textContent, count);
			Updater.updateGrid();
		}

		if (this.pinURLAutocomplete.compareDocumentPosition(event.target) & Node.DOCUMENT_POSITION_CONTAINED_BY) {
			let target = event.target;
			while (target.nodeName != 'li') {
				target = target.parentNode;
			}
			this.pinURLInput.value = target.dataset.url;
			this.pinURLInput.focus();
			this.pinURLInput.selectionStart = this.pinURLInput.selectionEnd = this.pinURLInput.value.length;
			this.pinURLAutocomplete.hidden = true;
		}
	},
	optionsOnChange: function(event) {
		if (event.target.disabled) {
			return;
		}

		let {name, value, checked} = event.originalTarget;
		switch (name) {
		case 'theme':
			Prefs.theme = value;
			break;
		case 'foreground.opacity':
			Prefs.opacity = parseInt(value, 10);
			break;
		case 'rows':
			Prefs.rows = parseInt(value, 10);
			break;
		case 'columns':
			Prefs.columns = parseInt(value, 10);
			break;
		case 'margin':
			Prefs.margin = value.split(' ');
			break;
		case 'spacing':
			Prefs.spacing = value;
			break;
		case 'thumbs.titlesize':
			Prefs.titleSize = value;
			break;
		case 'locked':
			Prefs.locked = checked;
			break;
		case 'history':
			Prefs.history = checked;
			break;
		case 'recent':
			Prefs.recent = checked;
			break;
		}
	},
	contextMenuShowing: function() {
		let site = document.activeElement;
		while (site != document && !site.classList.contains('newtab-site')) {
			site = site.parentNode;
		}
		let onSite = site != document;
		for (let item of newTabTools.contextMenu.querySelectorAll('.tile-context-menu')) {
			item.hidden = !onSite;
		}
		if (onSite) {
			let pinned = site._newtabSite.isPinned;
			newTabTools.contextMenuPin.hidden = pinned;
			newTabTools.contextMenuUnpin.hidden = !pinned;
		}
	},
	contextMenuOnClick: function(event) {
		let site = document.activeElement;
		while (site != document && !site.classList.contains('newtab-site')) {
			site = site.parentNode;
		}

		switch (event.target.id) {
		case 'newtabtools-edittile':
			let index = 0;
			let cell = site.parentNode;
			while (cell.previousElementSibling) {
				cell = cell.previousElementSibling;
				index++;
			}
			cell = cell.parentNode;
			while (cell.previousElementSibling) {
				cell = cell.previousElementSibling;
				index += cell.childElementCount;
			}

			newTabTools.toggleOptions();
			newTabTools.selectedSiteIndex = index;
			break;

		case 'newtabtools-pintile':
			site._newtabSite.pin();
			break;
		case 'newtabtools-unpintile':
			site._newtabSite.unpin();
			break;
		case 'newtabtools-blocktile':
			site._newtabSite.block();
			break;
		case 'newtabtools-options':
			newTabTools.toggleOptions();
			break;
		}
	},
	setThumbnail: function(site, src) {
		let image = new Image();
		image.onload = function() {
			let thumbnailSize = Prefs.thumbnailSize;
			let scale = Math.min(thumbnailSize / image.width, thumbnailSize / image.height, 1);

			let canvas = document.createElementNS(HTML_NAMESPACE, 'canvas');
			canvas.mozOpaque = false;
			if ('imageSmoothingEnabled' in canvas) {
				canvas.imageSmoothingEnabled = true;
			} else {
				canvas.mozImageSmoothingEnabled = true;
			}
			canvas.width = image.width * scale;
			canvas.height = image.height * scale;
			let ctx = canvas.getContext('2d');
			ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

			canvas.toBlob(function(blob) {
				site.link.image = blob;
				site.refreshThumbnail();

				let thumbnailURL = URL.createObjectURL(site.link.image);
				newTabTools.siteThumbnail.style.backgroundImage = 'url("' + thumbnailURL + '")';
				newTabTools.siteThumbnail.classList.add('custom-thumbnail');

				Tiles.putTile(site.link);
			}, 'image/png');
		};
		image.onerror = function(error) {
			console.error(error);
		};
		image.src = src;
	},
	removeThumbnail: function(site) {
		delete site.link.image;
		site.refreshThumbnail();
		this.getThumbnails();

		this.siteThumbnail.style.backgroundImage = null;
		this.siteThumbnail.classList.remove('custom-thumbnail');

		Tiles.putTile(site.link);
	},
	refreshBackgroundImage: function() {
		Background.getBackground().then(background => {
			if (!background) {
				document.body.style.backgroundImage = this.backgroundFake.style.backgroundImage = null;
				this.removeBackgroundButton.disabled = true;
				this.removeBackgroundButton.blur();
				return;
			}

			document.body.style.backgroundImage =
				this.backgroundFake.style.backgroundImage = 'url("' + URL.createObjectURL(background) + '")';
			this.removeBackgroundButton.disabled = false;
		});
	},
	updateUI: function(keys) {
		function setMargin(piece, size) {
			for (let pieceElement of document.querySelectorAll(piece)) {
				pieceElement.classList.remove('medium');
				pieceElement.classList.remove('large');
				if (size == 'medium' || size == 'large') {
					pieceElement.classList.add(size);
				}
			}
		}

		if (!keys || keys.includes('rows')) {
			document.querySelector('[name="rows"]').value = Prefs.rows;
		}

		if (!keys || keys.includes('columns')) {
			document.querySelector('[name="columns"]').value = Prefs.columns;
		}

		if (!keys || keys.includes('theme')) {
			let theme = Prefs.theme;
			this.themePref.querySelector('[value="' + theme + '"]').checked = true;
			document.documentElement.setAttribute('theme', theme);
		}

		if (!keys || keys.includes('locked')) {
			let locked = Prefs.locked;
			document.querySelector('[name="locked"]').checked = locked;
			if (locked) {
				document.documentElement.setAttribute('locked', 'true');
			} else {
				document.documentElement.removeAttribute('locked');
			}
		}

		if (!keys || keys.includes('titleSize')) {
			let titleSize = Prefs.titleSize;
			document.querySelector('[name="thumbs.titlesize"]').value = titleSize;
			document.documentElement.setAttribute('titlesize', titleSize);
		}

		if (!keys || keys.includes('margin')) {
			let margin = Prefs.margin;
			document.querySelector('[name="margin"]').value = margin.join(' ');
			setMargin('#newtab-margin-top', margin[0]);
			setMargin('.newtab-margin-right', margin[1]);
			setMargin('#newtab-margin-bottom', margin[2]);
			setMargin('.newtab-margin-left', margin[3]);
		}

		if (!keys || keys.includes('spacing')) {
			let spacing = Prefs.spacing;
			document.querySelector('[name="spacing"]').value = spacing;
			document.documentElement.setAttribute('spacing', spacing);
		}

		if (!keys || keys.includes('opacity')) {
			let opacity = Prefs.opacity;
			document.querySelector('[name="foreground.opacity"]').value = opacity;
			document.documentElement.style.setProperty('--opacity', opacity / 100);
		}

		if (!keys || keys.includes('history')) {
			let history = Prefs.history;
			document.querySelector('[name="history"]').checked = history;
			document.getElementById('historytiles-filter').disabled = !history;
		}

		if (!keys || keys.includes('recent')) {
			let recent = Prefs.recent;
			document.querySelector('[name="recent"]').checked = recent;
			this.refreshRecent();
		}

		if ('Grid' in window && 'cacheCellPositions' in Grid) {
			requestAnimationFrame(Grid.cacheCellPositions);
		}

		if (!document.documentElement.hasAttribute('options-hidden')) {
			this.resizeOptionsThumbnail();
		}
	},
	refreshRecent: function() {
		if (!Prefs.recent) {
			this.recentList.hidden = true;
			return;
		}

		chrome.sessions.getRecentlyClosed(undoItems => {
			let added = 0;

			for (let element of this.recentList.querySelectorAll('a')) {
				this.recentList.removeChild(element);
			}

			function recent_onclick() {
				chrome.sessions.restore(this.dataset.sessionId);
				return false;
			}

			for (let item of undoItems) {
				if (!item.tab || item.tab.incognito) {
					continue;
				}

				let {url, title, sessionId, favIconUrl} = item.tab;

				let a = document.createElementNS(HTML_NAMESPACE, 'a');
				a.href = url;
				a.className = 'recent';
				a.title = (!title || title == url ? title : title + '\n' + url);
				a.dataset.sessionId = sessionId;
				a.onclick = recent_onclick;
				if (favIconUrl && newTabTools.isValidURL(favIconUrl)) {
					let favIcon = document.createElement('img');
					favIcon.classList.add('favicon');
					favIcon.onerror	= function() {
						this.remove();
					};
					favIcon.src = favIconUrl;
					a.appendChild(favIcon);
				}
				a.appendChild(document.createTextNode(title || url));
				this.recentList.appendChild(a);
				added++;
			}
			this.trimRecent();
			this.recentList.hidden = !added;
		});
	},
	trimRecent: function() {
		this.recentList.style.width = '0';

		let width = this.recentListOuter.clientWidth;
		let elements = document.querySelectorAll('.recent');

		for (let recent of elements) {
			// see .recent
			let right = recent.offsetLeft + recent.offsetWidth - this.recentList.offsetLeft + 4;
			if (right == 4) {
				requestAnimationFrame(this.trimRecent.bind(this));
				return;
			}
			if (right <= width) {
				this.recentList.style.width = right + 'px';
			} else {
				break;
			}
		}
	},
	get selectedSiteIndex() {
		return this._selectedSiteIndex;
	},
	set selectedSiteIndex(index) {
		this._selectedSiteIndex = index;
		let site = this.selectedSite;
		let disabled = site === null;

		this.setSavedThumbInput.value = '';
		this.setSavedThumbInput.disabled =
			this.setTitleInput.disabled =
			this.setTitleButton.disabled =
			this.setBgColourDisplay.parentNode.disabled = disabled;

		if (disabled) {
			this.siteThumbnail.style.backgroundImage =
				this.siteThumbnail.style.backgroundColor =
				this.setBgColourDisplay.style.backgroundColor = null;
			this.siteURL.textContent = this.getString('tileurl_empty');
			this.setTitleInput.value = '';
			this.removeSavedThumbButton.disabled =
				this.setBgColourButton.disabled =
				this.resetBgColourButton.disabled = true;
			return;
		}

		if (site.link.image) {
			let thumbnailURL = URL.createObjectURL(site.link.image);
			this.siteThumbnail.style.backgroundImage = 'url("' + thumbnailURL + '")';
			this.siteThumbnail.classList.add('custom-thumbnail');
			this.removeSavedThumbButton.disabled = false;
		} else {
			this.siteThumbnail.style.backgroundImage = site.thumbnail.style.backgroundImage;
			this.siteThumbnail.classList.remove('custom-thumbnail');
			this.removeSavedThumbButton.disabled = true;
		}

		let { rows, columns } = Prefs;
		let row = Math.floor(index / columns);
		let column = index % columns;
		this.tilePreviousRow.style.opacity = row === 0 ? 0.25 : null;
		this.tilePrevious.style.opacity = column === 0 ? 0.25 : null;
		this.tileNext.style.opacity = (column + 1 == columns) ? 0.25 : null;
		this.tileNextRow.style.opacity = (row + 1 == rows) ? 0.25 : null;

		this.siteURL.textContent = site.url;
		let backgroundColor = site.link.backgroundColor;
		this.siteThumbnail.style.backgroundColor =
			this.setBgColourInput.value =
			this.setBgColourDisplay.style.backgroundColor = backgroundColor || null;
		this.setBgColourButton.disabled =
			this.resetBgColourButton.disabled = !backgroundColor;
		this.setTitleInput.value = site.title || site.url;
	},
	toggleOptions: function() {
		if (document.documentElement.hasAttribute('options-hidden')) {
			document.documentElement.removeAttribute('options-hidden');
			this.selectedSiteIndex = 0;
			this.resizeOptionsThumbnail();
			this.pinURLInput.focus();
		} else {
			this.hideOptions();
		}
	},
	hideOptions: function() {
		document.documentElement.setAttribute('options-hidden', 'true');
		document.documentElement.removeAttribute('options-filter-shown');
		newTabTools.pinURLAutocomplete.hidden = true;
		newTabTools.optionsFilter.style.display = null;
	},
	resizeOptionsThumbnail: function() {
		let node = Grid.node.querySelector('.newtab-thumbnail');
		let ratio = node.offsetWidth / node.offsetHeight;
		if (ratio > 1.6666) {
			this.siteThumbnail.style.width = '250px';
			this.siteThumbnail.style.height = 250 / ratio + 'px';
		} else {
			this.siteThumbnail.style.width = 150 * ratio + 'px';
			this.siteThumbnail.style.height = '150px';
		}
	},
	fillFilterUI: function(highlightHost) {
		let pinned = Grid.sites
				.filter(s => s && 'position' in s.link)
				.reduce((carry, s) => {
			let host = new URL(s.url).host;
			if (!(host in carry)) {
				carry[host] = 0;
			}
			carry[host]++;
			return carry;
		}, Object.create(null));
		let filters = Filters.getList();

		let table = newTabTools.optionsFilter.querySelector('table');
		while (table.tBodies[0].rows.length) {
			table.tBodies[0].rows[0].remove();
		}

		let template = table.querySelector('template');
		let last = null;
		for (let k of Object.keys(pinned).concat(Object.keys(filters)).sort()) {
			if (k == last) {
				continue;
			}
			last = k;

			let row = template.content.firstElementChild.cloneNode(true);
			row.cells[0].textContent = k;
			row.cells[1].textContent = pinned[k] || 0;
			row.cells[2].querySelector('span').textContent = k in filters ? filters[k] : this.getString('filter_unlimited');
			if (k in filters) {
				row.querySelector('.minus-button').disabled = false;
			}
			table.tBodies[0].append(row);
			if (highlightHost && k == highlightHost) {
				row.animate([
					{'backgroundColor': '#f0ff'},
					{'backgroundColor': '#f0f0'}
				], {duration: 500, fill: 'both'});
			}
		}

		if (this.optionsFilterHostAutocomplete.childElementCount === 0) {
			chrome.topSites.get({ providers: ['places'] }, sites => {
				for (let s of sites.reduce((carry, site) => {
					let {protocol, host} = new URL(site.url);
					if (host && ['http:', 'https:', 'ftp:'].includes(protocol) && !carry.includes(host)) {
						carry.push(host);
					}
					return carry;
				}, []).sort()) {
					let option = document.createElement('option');
					option.textContent = s;
					this.optionsFilterHostAutocomplete.appendChild(option);
				}
			});
		}
	},
	startup: function() {
		if (!window.chrome) {
			// The page couldn't be loaded properly because WebExtensions is too slow. Sad.
			return;
		}

		document.querySelectorAll('[data-message]').forEach(n => {
			n.textContent = newTabTools.getString(n.dataset.message);
		});
		document.querySelectorAll('[data-placeholder]').forEach(n => {
			n.placeholder = newTabTools.getString(n.dataset.placeholder);
		});
		document.querySelectorAll('[data-title]').forEach(n => {
			n.title = newTabTools.getString(n.dataset.title);
		});
		document.querySelectorAll('[data-label]').forEach(n => {
			n.parentNode.insertBefore(document.createTextNode(newTabTools.getString(n.dataset.label)), n.nextSibling);
		});

		Prefs.init().then(function() {
			// Everything is loaded. Initialize the New Tab Page.
			Page.init();
			newTabTools.updateUI();
			newTabTools.refreshBackgroundImage();

			chrome.sessions.onChanged.addListener(function() {
				newTabTools.refreshRecent();
			});
		}).then(function() {
			// Forget about visiting this page. It shouldn't be in the history.
			// Maybe if bug 1322304 is ever fixed we could remove this.
			chrome.history.deleteUrl({ url: location.href });

			newTabTools.updateText.textContent = newTabTools.getString('newversion', Prefs.version);
			newTabTools.updateNotice.dataset.version = Prefs.version;

			let now = new Date();
			if (now - Prefs.versionLastUpdate < 43200000 && now - Prefs.versionLastAck > 604800000) {
				newTabTools.updateNotice.hidden = false;
			}
		}).catch(console.error);
	},
	getThumbnails: function() {
		chrome.runtime.sendMessage({
			name: 'Thumbnails.get',
			urls: Grid.sites.filter(s => s && !s.thumbnail.style.backgroundImage).map(s => s.link.url)
		}, function(thumbs) {
			Grid.sites.forEach(s => {
				if (!s) {
					return;
				}
				let link = s.link;
				if (!link.image) {
					let thumb = thumbs.get(link.url);
					if (thumb) {
						let css = 'url(' + URL.createObjectURL(thumb) + ')';
						s.thumbnail.style.backgroundImage = css;

						if (newTabTools.selectedSite == s) {
							newTabTools.siteThumbnail.style.backgroundImage = css;
						}
					}
				}
			});
		});
	}
};

(function() {
	let uiElements = {
		'backgroundFake': 'background-fake',
		'page': 'newtab-scrollbox', // used in fx-newTab.js
		'optionsToggleButton': 'options-toggle',
		'pinURLInput': 'options-pinURL-input',
		'pinURLAutocomplete': 'autocomplete',
		'tilePreviousRow': 'options-previous-row-tile',
		'tilePrevious': 'options-previous-tile',
		'tileNext': 'options-next-tile',
		'tileNextRow': 'options-next-row-tile',
		'siteThumbnail': 'options-thumbnail',
		'siteURL': 'options-url',
		'setSavedThumbInput': 'options-savedthumb-input',
		'setSavedThumbButton': 'options-savedthumb-set',
		'removeSavedThumbButton': 'options-savedthumb-remove',
		'setBgColourInput': 'options-bgcolor-input',
		'setBgColourDisplay': 'options-bgcolor-display',
		'setBgColourButton': 'options-bgcolor-set',
		'resetBgColourButton': 'options-bgcolor-reset',
		'setTitleInput': 'options-title-input',
		'setTitleButton': 'options-title-set',
		'setBackgroundInput': 'options-bg-input',
		'setBackgroundButton': 'options-bg-set',
		'removeBackgroundButton': 'options-bg-remove',
		'themePref': 'options-theme-pref',
		'recentList': 'newtab-recent',
		'recentListOuter': 'newtab-recent-outer',
		'optionsBackground': 'options-bg',
		'optionsPane': 'options',
		'optionsFilter': 'options-filter',
		'optionsFilterHost': 'options-filter-host',
		'optionsFilterHostAutocomplete': 'host-autocomplete',
		'optionsFilterCount': 'options-filter-count',
		'optionsFilterSet': 'options-filter-set',
		'updateNotice': 'newtab-update-notice',
		'updateText': 'newtab-update-text',
		'lockedToggleButton': 'locked-toggle',
		'databaseError': 'database-error',
		'contextMenu': 'context-menu',
		'contextMenuPin': 'newtabtools-pintile',
		'contextMenuUnpin': 'newtabtools-unpintile'
	};
	for (let key in uiElements) {
		let value = uiElements[key];
		newTabTools[key] = document.getElementById(value);
	}

	function keyUpHandler(event) {
		if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(event.key) > -1) {
			newTabTools.optionsOnChange(event);
		} else if (event.key == 'Escape') {
			newTabTools.hideOptions();
		}
	}

	newTabTools.updateNotice.addEventListener('click', newTabTools.optionsOnClick.bind(newTabTools), false);
	newTabTools.lockedToggleButton.addEventListener('click', function() {
		Prefs.locked = !Prefs.locked;
		this.blur();
	}, false);
	newTabTools.optionsToggleButton.addEventListener('click', newTabTools.toggleOptions.bind(newTabTools), false);
	newTabTools.optionsBackground.addEventListener('click', newTabTools.hideOptions.bind(newTabTools));
	newTabTools.pinURLInput.addEventListener('input', newTabTools.autocomplete.bind(newTabTools));
	newTabTools.optionsPane.addEventListener('click', newTabTools.optionsOnClick.bind(newTabTools), false);
	newTabTools.optionsPane.addEventListener('change', newTabTools.optionsOnChange.bind(newTabTools), false);
	newTabTools.optionsPane.addEventListener('transitionend', function() {
		if (document.documentElement.hasAttribute('options-filter-shown')) {
			newTabTools.optionsFilter.style.display = 'block';
		}
	});
	for (let c of newTabTools.optionsPane.querySelectorAll('select, input[type="range"]')) {
		c.addEventListener('keyup', keyUpHandler);
	}
	newTabTools.setSavedThumbInput.addEventListener('change', function() {
		newTabTools.setSavedThumbButton.disabled = !this.files.length;
	});
	newTabTools.setBgColourInput.addEventListener('change', function() {
		newTabTools.setBgColourDisplay.style.backgroundColor = this.value;
		newTabTools.setBgColourButton.disabled = false;
	});
	newTabTools.setBackgroundInput.addEventListener('change', function() {
		newTabTools.setBackgroundButton.disabled = !this.files.length;
	});
	newTabTools.optionsFilterCount.addEventListener('keydown', function(event) {
		if (event.key.length == 1 && (event.key < '0' || event.key > '9')) {
			event.preventDefault();
		}
	});
	newTabTools.optionsFilterHost.oninput = newTabTools.optionsFilterCount.oninput = function() {
		newTabTools.optionsFilterSet.disabled = !newTabTools.optionsFilterHost.checkValidity() || !newTabTools.optionsFilterCount.checkValidity();
	};
	document.body.oncontextmenu = newTabTools.contextMenuShowing;
	newTabTools.contextMenu.onclick = newTabTools.contextMenuOnClick;

	window.addEventListener('keypress', function(event) {
		if (event.key == 'Escape') {
			if (newTabTools.pinURLAutocomplete.hidden) {
				newTabTools.hideOptions();
			} else {
				newTabTools.pinURLAutocomplete.hidden = true;
			}
		} else if (document.activeElement == newTabTools.pinURLInput) {
			let current = newTabTools.pinURLAutocomplete.querySelector('li.current');
			switch (event.key) {
			case 'ArrowDown':
			case 'ArrowUp':
				let items = [...newTabTools.pinURLAutocomplete.querySelectorAll('li:not([hidden])')];
				if (!items.length) {
					return;
				}

				let index = event.key == 'ArrowDown' ? 0 : items.length - 1;
				if (current) {
					current.classList.remove('current');
					let newIndex = items.indexOf(current) + (event.key == 'ArrowDown' ? 1 : -1);
					if (items[newIndex]) {
						index = newIndex;
					}
				}
				items[index].classList.add('current');
				break;
			case 'Enter':
				if (current) {
					newTabTools.pinURLInput.value = current.dataset.url;
					newTabTools.pinURLInput.selectionStart = newTabTools.pinURLInput.selectionEnd = newTabTools.pinURLInput.value.length;
					newTabTools.pinURLAutocomplete.hidden = true;
				}
				break;
			}
		}
	});
})();
