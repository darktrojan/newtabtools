/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals Background, compareVersions, Filters, Grid, Page, Prefs, Tiles, Transformation, Updater */

var HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

var newTabTools = {
	getString(name, ...substitutions) {
		return chrome.i18n.getMessage(name, substitutions);
	},
	isValidURL(url) {
		try {
			return ['data:', 'ftp:', 'http:', 'https:', 'moz-extension:'].includes(new URL(url).protocol);
		} catch (ex) {
			return false;
		}
	},
	autocomplete() {
		this.pinURLButton.disabled = !this.pinURLInput.checkValidity() || !this.isValidURL(this.pinURLInput.value);
		let value = this.pinURLInput.value;
		if (value.length < 2) {
			this.pinURLAutocomplete.hidden = true;
			while (this.pinURLAutocomplete.lastChild) {
				this.pinURLAutocomplete.lastChild.remove();
			}
			return;
		}
		let valueParts = value.toLowerCase().split(/\s+/);

		let count = 0;
		let options = Array.from(this.pinURLAutocomplete.children);
		let urls = options.filter(u => {
			if (u == this.pinURLBlocked) {
				return false;
			}
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
			this.pinURLAutocomplete.hidden = false;
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

			this.getThemedImageURL(type, 'dark').then(url => {
				option.querySelector('.autocomplete-icon').style.backgroundImage = url ? `url(${url})` : null;
			});
			urls.push(item.url);
		};

		chrome.tabs.query({}, tabs => {
			for (let t of tabs) {
				maybeAddItem(t, 'tab');
			}

			if (count >= 10) {
				this.pinURLAutocomplete.hidden = false;
				return;
			}

			if (!this.pinURLBlocked.hidden) {
				this.pinURLAutocomplete.appendChild(this.pinURLBlocked);
				this.pinURLAutocomplete.hidden = false;
				return;
			}

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
					this.pinURLAutocomplete.hidden = false;
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
	setPinURLInputValue(url) {
		this.pinURLInput.value = url;
		this.pinURLInput.focus();
		this.pinURLInput.selectionStart = this.pinURLInput.selectionEnd = url.length;
		this.pinURLButton.disabled = !this.pinURLInput.checkValidity() || !this.isValidURL(url);
		this.pinURLAutocomplete.hidden = true;
	},
	get selectedSite() {
		return Grid.sites[this._selectedSiteIndex];
	},
	optionsOnClick(event) {
		if (event.target.disabled) {
			return;
		}
		let {id, classList} = event.target;
		switch (id) {
		case 'options-close-button':
			newTabTools.hideOptions();
			break;
		case 'options-pinURL-permissions':
			chrome.permissions.request({permissions: ['bookmarks', 'history']}, (succeeded) => {
				if (succeeded) {
					this.pinURLBlocked.hidden = true;
					this.pinURLInput.focus();
					this.autocomplete();
				}
			});
			return;
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
				newTabTools.setPinURLInputValue('');
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
		case 'options-url-set':
			this.selectedSite.link.url = this.siteURLInput.value;
			this.selectedSite.addTitle();
			Tiles.putTile(this.selectedSite.link);
			break;
		case 'options-savethumb':
			let link = this.selectedSite.link;
			let siteURL = link.url;
			chrome.runtime.sendMessage({
				name: 'Thumbnails.get',
				urls: [siteURL]
			}, thumbs => {
				let blob = thumbs.get(siteURL);
				if (!blob) {
					return;
				}
				link.image = blob;
				link.imageIsThumbnail = true;
				Tiles.putTile(link);
				this.saveCurrentThumbButton.disabled = true;
				this.removeSavedThumbButton.disabled = false;
			});
			break;
		case 'options-savedthumb-set':
			this.setThumbnail(this.selectedSite, URL.createObjectURL(this.setSavedThumbInput.files[0]));
			this.removeSavedThumbButton.disabled = false;
			break;
		case 'options-savedthumb-remove':
			this.removeThumbnail(this.selectedSite);
			this.removeSavedThumbButton.disabled = true;
			break;
		case 'options-bgcolor-display':
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
			this.showOptionsExtra('filter');
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
		case 'options-backup-restore':
			this.showOptionsExtra('export');
			return;
		case 'options-backup':
			chrome.permissions.request({permissions: ['downloads']}, function() {
				chrome.runtime.sendMessage({name: 'Export:backup'});
			});
			return;
		case 'options-restore':
			let input = newTabTools.optionsPane.querySelector('#options-export input[type="file"]');
			chrome.runtime.sendMessage({name: 'Import:restore', file: input.files[0]});
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
	},
	optionsOnChange(event) {
		if (event.target.disabled) {
			return;
		}

		let {name, value, checked} = event.target;
		switch (name) {
		case 'theme':
		case 'spacing':
		case 'titleSize':
			Prefs[name] = value;
			break;
		case 'opacity':
		case 'rows':
		case 'columns':
			Prefs[name] = parseInt(value, 10);
			break;
		case 'margin':
			Prefs.margin = value.split(' ');
			break;
		case 'themeAuto':
		case 'locked':
		case 'history':
		case 'recent':
			Prefs[name] = checked;
			break;
		}
	},
	contextMenuShowing(info) {
		if (info.contexts.includes('link')) {
			let target = browser.menus.getTargetElement(info.targetElementId);
			let site = target.closest('.newtab-site');
			let pinned = site && site._newtabSite.isPinned;

			browser.menus.update('edit', { visible: !!site });
			browser.menus.update('pin', { visible: !!site && !pinned });
			browser.menus.update('unpin', { visible: !!site && pinned });
			browser.menus.update('block', { visible: !!site });
			browser.menus.refresh();
		}
	},
	contextMenuOnClick(info) {
		let target = browser.menus.getTargetElement(info.targetElementId);
		let site = target.closest('.newtab-site');

		switch (info.menuItemId) {
		case 'edit':
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

		case 'pin':
			site._newtabSite.pin();
			break;
		case 'unpin':
			site._newtabSite.unpin();
			break;
		case 'block':
			site._newtabSite.block();
			break;
		case 'options':
			newTabTools.toggleOptions();
			break;
		}
	},
	setThumbnail(site, src) {
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

			let link = site.link;
			canvas.toBlob(function(blob) {
				link.image = blob;
				delete link.imageIsThumbnail;
				site.refreshThumbnail();

				let thumbnailURL = URL.createObjectURL(link.image);
				newTabTools.siteThumbnail.style.backgroundImage = 'url("' + thumbnailURL + '")';
				newTabTools.siteThumbnail.classList.add('custom-thumbnail');
				newTabTools.saveCurrentThumbButton.disabled = true;

				Tiles.putTile(link);
			}, 'image/png');
		};
		image.onerror = function(error) {
			console.error(error);
		};
		image.src = src;
	},
	removeThumbnail(site) {
		let link = site.link;
		delete link.image;
		delete link.imageIsThumbnail;
		site.refreshThumbnail();
		this.siteThumbnail.style.backgroundImage = null;
		this.siteThumbnail.classList.remove('custom-thumbnail');
		this.getThumbnails();

		Tiles.putTile(link);
	},
	refreshBackgroundImage() {
		return Background.getBackground().then(background => {
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
	parseColour(str) {
		let parts = /^(hsl|rgb)a?\((\d+),\s*([\d.]+%?),\s*([\d.]+%?)/.exec(str);
		if (parts && parts[1] == 'rgb') {
			return {
				r: parseInt(parts[2], 10),
				g: parseInt(parts[3], 10),
				b: parseInt(parts[4], 10),
			};
		}

		if (parts && parts[1] == 'hsl') {
			let h = parseFloat(parts[2]) / 360;
			let s = parseFloat(parts[3]) / 100;
			let l = parseFloat(parts[4]) / 100;
			let r, g, b;

			if (s == 0){
				r = g = b = l;
			} else {
				function hue2rgb(p, q, t) {
					if (t < 0) {
						t += 1;
					}
					if (t > 1) {
						t -= 1;
					}
					if (t < 1/6) {
						return p + (q - p) * 6 * t;
					}
					if (t < 1/2) {
						return q;
					}
					if (t < 2/3) {
						return p + (q - p) * (2/3 - t) * 6;
					}
					return p;
				}

				let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
				let p = 2 * l - q;
				r = hue2rgb(p, q, h + 1/3);
				g = hue2rgb(p, q, h);
				b = hue2rgb(p, q, h - 1/3);
			}

			return {
				r: Math.round(r * 255),
				g: Math.round(g * 255),
				b: Math.round(b * 255),
			};
		}

		parts = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(str);
		if (parts) {
			return {
				r: parseInt(parts[1], 16),
				g: parseInt(parts[2], 16),
				b: parseInt(parts[3], 16),
			};
		}

		parts = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i.exec(str);
		if (parts) {
			return {
				r: parseInt(parts[1].repeat(2), 16),
				g: parseInt(parts[2].repeat(2), 16),
				b: parseInt(parts[3].repeat(2), 16),
			};
		}

		return null;
	},
	async updateThemeColours(updateInfo) {
		let properties = {
			'--back-opaque': null,
			'--contrast-opaque': null,
			'--contrast-transp': null,
			'--fore-opaque': null,
			'--fore-trans1': null,
			'--fore-transp': null,
			'--page-background': null,
		};

		if (Prefs.themeAuto) {
			try {
				this._theme = updateInfo ? updateInfo.theme : await browser.theme.getCurrent();
				let back = this.parseColour(this._theme.colors.ntp_background || this._theme.colors.toolbar);
				let fore = this.parseColour(this._theme.colors.ntp_text || this._theme.colors.toolbar_text);

				if (back && fore) {
					properties['--back-opaque'] = `rgb(${back.r}, ${back.g}, ${back.b})`;
					properties['--fore-opaque'] = `rgb(${fore.r}, ${fore.g}, ${fore.b})`;
					properties['--fore-trans1'] = `rgba(${fore.r}, ${fore.g}, ${fore.b}, 0.1)`;
					properties['--fore-transp'] = `rgba(${fore.r}, ${fore.g}, ${fore.b}, var(--opacity))`;
					properties['--page-background'] = `rgb(${back.r}, ${back.g}, ${back.b})`;

					let brightness = 0.299 * fore.r + 0.587 * fore.g + 0.114 * fore.b;
					if (brightness < 144) {
						properties['--contrast-opaque'] = 'rgb(255, 255, 255)';
						properties['--contrast-transp'] = 'rgba(255, 255, 255, var(--opacity))';
					} else {
						properties['--contrast-opaque'] = 'rgb(0, 0, 0)';
						properties['--contrast-transp'] = 'rgba(0, 0, 0, var(--opacity))';
					}
				}
			} catch (ex) {
				console.debug(ex);
			}
		} else {
			this._theme = null;
		}

		for (let [key, value] of Object.entries(properties)) {
			document.documentElement.style.setProperty(key, value);
		}

		for (let [selector, name] of Object.entries({
			'.close-button': 'close',
			'.newtab-control': 'controls',
			'#options-toggle': 'options',
			'#locked-toggle': 'unlocked',
			':root[locked="true"] #locked-toggle': 'locked',
			'button.arrow': 'arrow',
		})) {
			let url = await this.getThemedImageURL(name);
			for (let element of document.querySelectorAll(selector)) {
				element.style.backgroundImage = url ? `url(${url})` : null;
			}
		}
	},
	async getThemedImageURL(name, theme = Prefs.theme) {
		let fore = document.documentElement.style.getPropertyValue('--fore-opaque');
		let back = document.documentElement.style.getPropertyValue('--back-opaque');

		if (!fore) {
			return null;
		}

		try {
			let request = await fetch(browser.extension.getURL(`images/${name}-${theme}.svg`));
			let content = await request.text();
			content = content.replaceAll('#fff', fore);
			content = content.replaceAll('#1f364c', back);
			return 'data:image/svg+xml;base64,' + btoa(content);
		} catch (ex) {
			console.debug(ex);
			return null;
		}
	},
	updateUI(keys) {
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
			document.querySelector('[name="theme"][value="' + theme + '"]').checked = true;
			document.documentElement.setAttribute('theme', theme);
			this.darkIcons.disabled = theme == 'light';
			this.updateThemeColours();
		}

		if (!keys || keys.includes('themeAuto')) {
			let themeAuto = Prefs.themeAuto;
			document.querySelector('[name="themeAuto"]').checked = themeAuto;
			this.updateThemeColours();
			if (themeAuto) {
				browser.theme.onUpdated.addListener(this.updateThemeColours);
			} else {
				browser.theme.onUpdated.removeListener(this.updateThemeColours);
			}
		}

		if (!keys || keys.includes('locked')) {
			let locked = Prefs.locked;
			document.querySelector('[name="locked"]').checked = locked;
			if (locked) {
				document.documentElement.setAttribute('locked', 'true');
				this.getThemedImageURL('locked').then(url => {
					this.lockedToggleButton.style.backgroundImage = url ? `url(${url})` : null;
				});
			} else {
				document.documentElement.removeAttribute('locked');
				this.getThemedImageURL('unlocked').then(url => {
					this.lockedToggleButton.style.backgroundImage = url ? `url(${url})` : null;
				});
			}
		}

		if (!keys || keys.includes('titleSize')) {
			let titleSize = Prefs.titleSize;
			document.querySelector('[name="titleSize"]').value = titleSize;
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
			document.querySelector('[name="opacity"]').value = opacity;
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
	refreshRecent() {
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
	trimRecent() {
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
			this.siteURL.hidden = false;
			this.editSiteURLRow.hidden = true;
			this.setTitleInput.value = '';
			this.saveCurrentThumbButton.disabled =
				this.removeSavedThumbButton.disabled =
				this.setBgColourButton.disabled =
				this.resetBgColourButton.disabled = true;
			return;
		}

		if (site.link.image) {
			let thumbnailURL = URL.createObjectURL(site.link.image);
			this.siteThumbnail.style.backgroundImage = 'url("' + thumbnailURL + '")';
			if (site.link.imageIsThumbnail) {
				this.siteThumbnail.classList.remove('custom-thumbnail');
			} else {
				this.siteThumbnail.classList.add('custom-thumbnail');
			}
			this.saveCurrentThumbButton.disabled = true;
			this.removeSavedThumbButton.disabled = false;
		} else {
			this.siteThumbnail.style.backgroundImage = site.thumbnail.style.backgroundImage;
			this.siteThumbnail.classList.remove('custom-thumbnail');
			this.saveCurrentThumbButton.disabled = !this.siteThumbnail.style.backgroundImage;
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
		this.siteURLInput.value = site.url;
		this.siteURL.hidden = site.isPinned;
		this.editSiteURLRow.hidden = !site.isPinned;
		let backgroundColor = site.link.backgroundColor;
		this.siteThumbnail.style.backgroundColor =
			this.setBgColourInput.value =
			this.setBgColourDisplay.style.backgroundColor = backgroundColor || null;
		this.setBgColourButton.disabled =
			this.resetBgColourButton.disabled = !backgroundColor;
		this.setTitleInput.value = site.title || site.url;
	},
	toggleOptions() {
		if (document.documentElement.hasAttribute('options-hidden')) {
			document.documentElement.removeAttribute('options-hidden');
			this.selectedSiteIndex = 0;
			this.resizeOptionsThumbnail();
			this.pinURLInput.focus();
			requestAnimationFrame(() => {
				this.siteURL.style.lineHeight = this.editSiteTitleRow.getBoundingClientRect().height + 'px';
			});
		} else {
			this.hideOptions();
		}
	},
	hideOptions() {
		document.documentElement.setAttribute('options-hidden', 'true');
		newTabTools.pinURLAutocomplete.hidden = true;
		this.showOptionsExtra();
	},
	resizeOptionsThumbnail() {
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
	showOptionsExtra(which) {
		if (!which) {
			document.documentElement.removeAttribute('options-extra');
		} else if (!document.documentElement.hasAttribute('options-extra')) {
			document.documentElement.setAttribute('options-extra', which);
			return;
		}

		for (let oe of newTabTools.optionsPane.querySelectorAll('.options-extra')) {
			oe.style.display = (oe.id == 'options-' + which) ? 'block' : null;
		}
	},
	async fillFilterUI(highlightHost) {
		let pinned = Grid.sites.filter(s => s && 'position' in s.link).reduce((carry, s) => {
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
			let {version} = await browser.runtime.getBrowserInfo();
			let options;
			if (compareVersions(version, '63.0a1') >= 0) {
				options = { limit: 100, onePerDomain: false, includeBlocked: true };
			} else {
				options = { providers: ['places'] };
			}
			chrome.topSites.get(options, sites => {
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
	startup() {
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

		Prefs.init().then(() => {
			// Everything is loaded. Initialize the New Tab Page.
			Page.init();
			newTabTools.updateUI();
			newTabTools.refreshBackgroundImage();

			chrome.sessions.onChanged.addListener(function() {
				newTabTools.refreshRecent();
			});

			// Forget about visiting this page. It shouldn't be in the history.
			// Maybe if bug 1322304 is ever fixed we could remove this.
			chrome.permissions.contains({permissions: ['history']}, contains => {
				if (contains) {
					chrome.history.deleteUrl({ url: location.href });
					this.pinURLBlocked.hidden = true;
				}
			});

			newTabTools.updateText.textContent = newTabTools.getString('newversion', Prefs.version);
			newTabTools.updateNotice.dataset.version = Prefs.version;

			let now = new Date();
			if (now - Prefs.versionLastUpdate < 43200000 && now - Prefs.versionLastAck > 604800000) {
				newTabTools.updateNotice.hidden = false;
			}
		}).catch(console.error);
	},
	getThumbnails() {
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
							newTabTools.saveCurrentThumbButton.disabled = false;
						}
					}
				}
			});
		});
	}
};

(function() {
	newTabTools.updateThemeColours = newTabTools.updateThemeColours.bind(newTabTools);
	let uiElements = {
		'darkIcons': 'dark-icons',
		'backgroundFake': 'background-fake',
		'page': 'newtab-scrollbox', // used in fx-newTab.js
		'optionsToggleButton': 'options-toggle',
		'pinURLBlocked': 'options-pinURL-blocked',
		'pinURLInput': 'options-pinURL-input',
		'pinURLButton': 'options-pinURL',
		'pinURLAutocomplete': 'autocomplete',
		'tilePreviousRow': 'options-previous-row-tile',
		'tilePrevious': 'options-previous-tile',
		'tileNext': 'options-next-tile',
		'tileNextRow': 'options-next-row-tile',
		'siteThumbnail': 'options-thumbnail',
		'siteURL': 'options-url',
		'editSiteURLRow': 'options-edit-url',
		'siteURLInput': 'options-url-input',
		'setURLButton': 'options-url-set',
		'saveCurrentThumbButton': 'options-savethumb',
		'setSavedThumbInput': 'options-savedthumb-input',
		'removeSavedThumbButton': 'options-savedthumb-remove',
		'setBgColourInput': 'options-bgcolor-input',
		'setBgColourDisplay': 'options-bgcolor-display',
		'setBgColourButton': 'options-bgcolor-set',
		'resetBgColourButton': 'options-bgcolor-reset',
		'editSiteTitleRow': 'options-edit-title',
		'setTitleInput': 'options-title-input',
		'setTitleButton': 'options-title-set',
		'setBackgroundInput': 'options-bg-input',
		'removeBackgroundButton': 'options-bg-remove',
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

	newTabTools.updateNotice.addEventListener('click', newTabTools.optionsOnClick.bind(newTabTools));
	newTabTools.lockedToggleButton.addEventListener('click', function() {
		Prefs.locked = !Prefs.locked;
		this.blur();
	});
	newTabTools.optionsToggleButton.addEventListener('click', newTabTools.toggleOptions.bind(newTabTools));
	newTabTools.optionsBackground.addEventListener('click', newTabTools.hideOptions.bind(newTabTools));
	newTabTools.pinURLInput.addEventListener('input', newTabTools.autocomplete.bind(newTabTools));
	newTabTools.optionsPane.addEventListener('click', newTabTools.optionsOnClick.bind(newTabTools));
	newTabTools.optionsPane.addEventListener('change', newTabTools.optionsOnChange.bind(newTabTools));
	newTabTools.optionsPane.addEventListener('transitionend', function() {
		let extra = document.documentElement.getAttribute('options-extra');
		if (extra) {
			newTabTools.showOptionsExtra(extra);
		}
	});
	for (let c of newTabTools.optionsPane.querySelectorAll('select, input[type="range"]')) {
		c.addEventListener('keyup', keyUpHandler);
	}
	for (let c of newTabTools.optionsPane.querySelectorAll('input[type="file"]')) {
		c.addEventListener('change', function() {
			c.nextElementSibling.disabled = !c.files.length;
		});
	}
	newTabTools.setBgColourInput.addEventListener('change', function() {
		newTabTools.setBgColourDisplay.style.backgroundColor = this.value;
		newTabTools.setBgColourButton.disabled = false;
	});
	newTabTools.optionsFilterCount.addEventListener('keydown', function(event) {
		if (event.key.length == 1 && (event.key < '0' || event.key > '9')) {
			event.preventDefault();
		}
	});
	newTabTools.optionsFilterHost.oninput = newTabTools.optionsFilterCount.oninput = function() {
		newTabTools.optionsFilterSet.disabled = !newTabTools.optionsFilterHost.checkValidity() || !newTabTools.optionsFilterCount.checkValidity();
	};

	browser.menus.onShown.addListener(newTabTools.contextMenuShowing);
	browser.menus.onClicked.addListener(newTabTools.contextMenuOnClick);

	window.addEventListener('keydown', function(event) {
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
				let items = [...newTabTools.pinURLAutocomplete.querySelectorAll('li:not([hidden]):not(#options-pinURL-blocked)')];
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
			case 'Tab':
				if (current) {
					newTabTools.setPinURLInputValue(current.dataset.url);
				}
				newTabTools.pinURLAutocomplete.hidden = true;
				break;
			}
		}
	});
	window.addEventListener('click', function(event) {
		if (event.button != 0) {
			return;
		}
		if (newTabTools.pinURLInput == event.target) {
			if (newTabTools.pinURLAutocomplete.hidden) {
				newTabTools.autocomplete();
			}
			return;
		}
		if (newTabTools.pinURLAutocomplete.hidden) {
			return;
		}
		if (newTabTools.pinURLAutocomplete.compareDocumentPosition(event.target) & Node.DOCUMENT_POSITION_CONTAINED_BY) {
			let target = event.target;
			while (target.nodeName != 'li') {
				target = target.parentNode;
			}
			if (target != newTabTools.pinURLBlocked) {
				newTabTools.setPinURLInputValue(target.dataset.url);
			}
			return;
		}
		newTabTools.pinURLAutocomplete.hidden = true;
		event.stopPropagation();
	}, true);
	window.addEventListener('resize', function() {
		newTabTools.refreshRecent();
	});
})();
