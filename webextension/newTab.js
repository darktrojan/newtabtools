/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at http://mozilla.org/MPL/2.0/.
*/
/* globals Prefs, Grid, Page, Tiles, Updater, Background, browser */

var HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

var newTabTools = {
	getString: function(name) {
		return browser.i18n.getMessage(name);
	},
	autocomplete: function() {
		let value = this.pinURLInput.value;
		if (value.length < 2) {
			while (this.pinURLAutocomplete.lastChild) {
				this.pinURLAutocomplete.lastChild.remove();
			}
			return;
		}

		let count = 0;
		let options = Array.from(this.pinURLAutocomplete.children);
		let urls = options.map(function(u) {
			let v = u.textContent;
			if (v.includes(value)) {
				count++;
			}
			return v;
		});

		let exact = options.find(function(u) {
			return u.textContent == value;
		});
		if (exact) {
			this.pinURLAutocomplete.insertBefore(exact, this.pinURLAutocomplete.firstChild);
		}

		if (count > 10) {
			return;
		}

		browser.history.search({
			text: value,
			startTime: 0
		}).then(result => {
			for (let r of result) {
				if (urls.includes(r.url)) {
					continue;
				}
				let option = document.createElement('option');
				option.textContent = r.url;
				if (r.url == value) {
					this.pinURLAutocomplete.insertBefore(option, this.pinURLAutocomplete.firstChild);
				} else {
					this.pinURLAutocomplete.appendChild(option);
				}
				urls.push(r.url);
			}
		});
	},
	get selectedSite() {
		return Grid.sites[this._selectedSiteIndex];
	},
	optionsOnClick: function(event) {
		if (event.target.disabled) {
			return;
		}
		let id = event.target.id;
		switch (id) {
		case 'options-close-button':
			newTabTools.hideOptions();
			break;
		case 'options-pinURL':
			let url = this.pinURLInput.value;
			if (!url) {
				return;
			}
			if (Tiles.isPinned(url)) {
				throw 'Already pinned';
			}

			let title = url;
			browser.history.search({
				text: url,
				startTime: 0
			}).then(function(result) {
				let entry = result.find(function(f) {
					return f.url == url;
				});
				if (entry) {
					title = entry.title;
				}

				let emptyCell = Grid.cells.find(c => !c.containsPinnedSite());
				if (!emptyCell) {
					throw 'No free space';
				}

				let tile = { url, title, position: emptyCell.index };
				return Tiles.putTile(tile);
			}).then(function() {
				Updater.updateGrid();
			});
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
			this.selectedSite._querySelector('.newtab-thumbnail').style.backgroundColor =
				this.siteThumbnail.style.backgroundColor = this.setBgColourInput.value;
			this.resetBgColourButton.disabled = false;
			break;
		case 'options-bgcolor-reset':
			delete this.selectedSite.link.backgroundColor;
			Tiles.putTile(this.selectedSite.link);
			this.selectedSite._querySelector('.newtab-thumbnail').style.backgroundColor =
				this.siteThumbnail.style.backgroundColor =
				this.setBgColourInput.value =
				this.setBgColourDisplay.style.backgroundColor = null;
			this.setBgColourButton.disabled =
				this.resetBgColourButton.disabled = true;
			break;
		case 'options-title-set':
			this.selectedSite.link.title = this.setTitleInput.value;
			this.selectedSite._addTitleAndFavicon();
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
	setThumbnail: function(site, src) {
		let image = new Image();
		image.onload = function() {
			let [thumbnailWidth, thumbnailHeight] = [200, 200];
			let scale = Math.min(Math.max(thumbnailWidth / image.width, thumbnailHeight / image.height), 1);

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
				document.body.style.backgroundImage = null;
				this.removeBackgroundButton.disabled = true;
				this.removeBackgroundButton.blur();
				return;
			}

			document.body.style.backgroundImage = 'url("' + URL.createObjectURL(background) + '")';
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

		// let containThumbs = this.prefs.getBoolPref('thumbs.contain');
		// document.querySelector('[name="thumbs.contain"]').checked = containThumbs;
		// document.documentElement.classList[containThumbs ? 'add' : 'remove']('containThumbs');

		if (!keys || keys.includes('locked')) {
			let locked = Prefs.locked;
			document.querySelector('[name="locked"]').checked = locked;
			document.documentElement.classList[locked ? 'add' : 'remove']('hideButtons');
		}

		// let hideFavicons = this.prefs.getBoolPref('thumbs.hidefavicons');
		// document.querySelector('[name="thumbs.hidefavicons"]').checked = !hideFavicons;
		// document.documentElement.classList[hideFavicons ? 'add' : 'remove']('hideFavicons');

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
			// document.getElementById('historytiles-filter').disabled = !history;
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

		browser.sessions.getRecentlyClosed().then(undoItems => {
			let added = 0;

			for (let element of this.recentList.querySelectorAll('a')) {
				this.recentList.removeChild(element);
			}

			function recent_onclick() {
				browser.sessions.restore(this.dataset.sessionId);
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
				if (favIconUrl) {
					let favIcon = document.createElement('img');
					favIcon.classList.add('favicon');
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
	set selectedSiteIndex(index) { // jshint ignore:line
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
			this.siteURL.textContent = this.getString('tileurl.empty');
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
			this.siteThumbnail.style.backgroundImage = site._querySelector('.newtab-thumbnail').style.backgroundImage;
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
			this.optionsTogglePointer.hidden = true;
			// this.prefs.setBoolPref('optionspointershown', true);
			document.documentElement.removeAttribute('options-hidden');
			this.selectedSiteIndex = 0;
			this.resizeOptionsThumbnail();
			// this.pinURLInput.focus();
		} else {
			this.hideOptions();
		}
	},
	hideOptions: function() {
		document.documentElement.setAttribute('options-hidden', 'true');
	},
	resizeOptionsThumbnail: function() {
		let node = Grid._node.querySelector('.newtab-thumbnail');
		let ratio = node.offsetWidth / node.offsetHeight;
		if (ratio > 1.6666) {
			this.siteThumbnail.style.width = '250px';
			this.siteThumbnail.style.height = 250 / ratio + 'px';
		} else {
			this.siteThumbnail.style.width = 150 * ratio + 'px';
			this.siteThumbnail.style.height = '150px';
		}
	},
	startup: function() {
		if (!window.browser) {
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

			browser.sessions.onChanged.addListener(function() {
				newTabTools.refreshRecent();
			});
		}).then(function() {
			// Forget about visiting this page. It shouldn't be in the history.
			// Maybe if bug 1322304 is ever fixed we could remove this.
			browser.history.deleteUrl({ url: location.href });

			browser.management.getSelf().then(s => {
				newTabTools.updateText.textContent = newTabTools.getString('newversion').replace('%S', s.version);
				newTabTools.updateNotice.dataset.version = s.version;

				let currentVersion = parseFloat(s.version, 10);
				let now = new Date();
				if (currentVersion > Prefs.version) {
					Prefs.version = currentVersion;
					Prefs.versionLastUpdate = now;
				}
				if (now - Prefs.versionLastUpdate < 43200000 && now - Prefs.versionLastAck > 604800000) {
					newTabTools.updateNotice.hidden = false;
				}
			});
		}).catch(console.error.bind(console));
	},
	getThumbnails: function() {
		browser.runtime.sendMessage({
			name: 'Thumbnails.get',
			urls: Grid.sites.filter(s => s && !s._querySelector('.newtab-thumbnail').style.backgroundImage).map(s => s.link.url)
		}).then(function(thumbs) {
			Grid.sites.forEach(s => {
				if (s && !s._link.image && thumbs.has(s._link.url)) {
					let css = 'url(' + URL.createObjectURL(thumbs.get(s._link.url)) + ')';
					s._querySelector('.newtab-thumbnail').style.backgroundImage = css;

					if (newTabTools.selectedSite == s) {
						newTabTools.siteThumbnail.style.backgroundImage = css;
					}
				}
			});
		});
	}
};

(function() {
	let uiElements = {
		'page': 'newtab-scrollbox', // used in fx-newTab.js
		'optionsToggleButton': 'options-toggle',
		'optionsTogglePointer': 'options-toggle-pointer',
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
		'updateNotice': 'newtab-update-notice',
		'updateText': 'newtab-update-text'
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
	newTabTools.optionsToggleButton.addEventListener('click', newTabTools.toggleOptions.bind(newTabTools), false);
	newTabTools.optionsBackground.addEventListener('click', newTabTools.hideOptions.bind(newTabTools));
	newTabTools.pinURLInput.addEventListener('input', newTabTools.autocomplete.bind(newTabTools));
	newTabTools.optionsPane.addEventListener('click', newTabTools.optionsOnClick.bind(newTabTools), false);
	newTabTools.optionsPane.addEventListener('change', newTabTools.optionsOnChange.bind(newTabTools), false);
	for (let c of newTabTools.optionsPane.querySelectorAll('select, input[type="range"]')) {
		c.addEventListener('keyup', keyUpHandler);
	}
	newTabTools.setSavedThumbInput.addEventListener('input', function() {
		newTabTools.setSavedThumbButton.disabled = !this.files.length;
	});
	newTabTools.setBgColourInput.addEventListener('change', function() {
		newTabTools.setBgColourDisplay.style.backgroundColor = this.value;
		newTabTools.setBgColourButton.disabled = false;
	});
	newTabTools.setBackgroundInput.addEventListener('input', function() {
		newTabTools.setBackgroundButton.disabled = !this.files.length;
	});
	window.addEventListener('keypress', function(event) {
		if (event.keyCode == 27) {
			newTabTools.hideOptions();
		}
	});
})();
