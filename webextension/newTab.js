/*
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at http://mozilla.org/MPL/2.0/.
*/
/* globals GridPrefs, Grid, Page, Tiles, Background, browser, initDB, isFirstRun */

var HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

var newTabTools = {
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
			let link = this.pinURLInput.value;
			if (!link) {
				return;
			}

			let title = '';
			browser.history.search({
				text: link,
				startTime: 0
			}).then(function(result) {
				let entry = result.find(function(f) {
					return f.url == link;
				});
				if (entry) {
					title = entry.title;
				}
				return Tiles.addTile(link, title);
			}).then(tile => {
				for (let i = 0; i < Grid.sites.length; i++) {
					if (Grid.sites[i] === null) {
						Grid.createSite(tile, Grid.cells[i]);
						tile.position = i;
						Tiles.putTile(tile);
						this.selectedSiteIndex = i;
						this.pinURLInput.value = '';
						break;
					}
				}
			});
			break;
		case 'options-previous-row-tile':
			this.selectedSiteIndex = (this._selectedSiteIndex - GridPrefs.gridColumns + Grid.cells.length) % Grid.cells.length;
			break;
		case 'options-previous-tile':
		case 'options-next-tile':
			let { gridColumns } = GridPrefs;
			let row = Math.floor(this._selectedSiteIndex / gridColumns);
			let column = (this._selectedSiteIndex + (id == 'options-previous-tile' ? -1 : 1) + gridColumns) % gridColumns;

			this.selectedSiteIndex = row * gridColumns + column;
			break;
		case 'options-next-row-tile':
			this.selectedSiteIndex = (this._selectedSiteIndex + GridPrefs.gridColumns) % Grid.cells.length;
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
			this.selectedSite.refreshThumbnail();
			Tiles.putTile(this.selectedSite.link);
			this.siteThumbnail.style.backgroundColor = this.setBgColourInput.value;
			this.resetBgColourButton.disabled = false;
			break;
		case 'options-bgcolor-reset':
			delete this.selectedSite.link.backgroundColor;
			this.selectedSite.refreshThumbnail();
			Tiles.putTile(this.selectedSite.link);
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
			window.open('https://darktrojan.github.io/donate.html?newtabtools');
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
			GridPrefs.theme = value;
			break;
		case 'foreground.opacity':
			GridPrefs.opacity = parseInt(value, 10);
			break;
		case 'rows':
			GridPrefs.gridRows = parseInt(value, 10);
			break;
		case 'columns':
			GridPrefs.gridColumns = parseInt(value, 10);
			break;
		case 'grid.margin':
			GridPrefs.gridMargin = value.split(' ');
			break;
		case 'grid.spacing':
			GridPrefs.gridSpacing = value;
			break;
		case 'thumbs.titlesize':
			GridPrefs.titleSize = value;
			break;
		case 'locked':
			GridPrefs.gridLocked = checked;
			break;
		}
	},
	onTileChanged: function(url, whatChanged) {
		// for (let site of Grid.sites) {
		// 	if (!!site && site.url == url) {
		// 		switch (whatChanged) {
		// 		case 'backgroundColor':
		// 			site._querySelector('.newtab-thumbnail').style.backgroundColor = TileData.get(url, 'backgroundColor');
		// 			break;
		// 		case 'thumbnail':
		// 			site.refreshThumbnail();
		// 			this.selectedSiteIndex = this._selectedSiteIndex;
		// 			break;
		// 		case 'title':
		// 			site._addTitleAndFavicon();
		// 			break;
		// 		}
		// 	}
		// }
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

		this.siteThumbnail.style.backgroundImage = null;

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
		if (!keys || keys.includes('theme')) {
			let theme = GridPrefs.theme;
			this.themePref.querySelector('[value="' + theme + '"]').checked = true;
			document.documentElement.setAttribute('theme', theme);
		}

		// let containThumbs = this.prefs.getBoolPref('thumbs.contain');
		// document.querySelector('[name="thumbs.contain"]').checked = containThumbs;
		// document.documentElement.classList[containThumbs ? 'add' : 'remove']('containThumbs');

		// let hideButtons = this.prefs.getBoolPref('thumbs.hidebuttons');
		// document.querySelector('[name="thumbs.hidebuttons"]').checked = !hideButtons;
		// document.documentElement.classList[hideButtons ? 'add' : 'remove']('hideButtons');

		if (!keys || keys.includes('locked')) {
			let locked = GridPrefs.gridLocked;
			document.querySelector('[name="locked"]').checked = locked;
		}

		// let hideFavicons = this.prefs.getBoolPref('thumbs.hidefavicons');
		// document.querySelector('[name="thumbs.hidefavicons"]').checked = !hideFavicons;
		// document.documentElement.classList[hideFavicons ? 'add' : 'remove']('hideFavicons');

		if (!keys || keys.includes('titleSize')) {
			let titleSize = GridPrefs.titleSize;
			document.querySelector('[name="thumbs.titlesize"]').value = titleSize;
			document.documentElement.setAttribute('titlesize', titleSize);
		}

		if (!keys || keys.includes('margin')) {
			let gridMargin = GridPrefs.gridMargin;
			document.querySelector('[name="grid.margin"]').value = gridMargin.join(' ');
			this.setGridMargin('top', gridMargin[0]);
			this.setGridMargin('right-top', gridMargin[1]);
			this.setGridMargin('right-bottom', gridMargin[1]);
			this.setGridMargin('bottom', gridMargin[2]);
			this.setGridMargin('left-bottom', gridMargin[3]);
			this.setGridMargin('left-top', gridMargin[3]);
		}

		if (!keys || keys.includes('spacing')) {
			let gridSpacing = GridPrefs.gridSpacing;
			document.querySelector('[name="grid.spacing"]').value = gridSpacing;
			document.documentElement.setAttribute('spacing', gridSpacing);
		}

		if (!keys || keys.includes('opacity')) {
			let opacity = Math.max(0, Math.min(100, GridPrefs.opacity));
			document.querySelector('[name="foreground.opacity"]').value = opacity;
			document.documentElement.style.setProperty('--opacity', opacity / 100);
		}

		// let showHistory = this.prefs.getBoolPref('historytiles.show');
		// document.querySelector('[name="historytiles.show"]').checked = showHistory;
		// document.getElementById('historytiles-filter').disabled = !showHistory;

		if ('Grid' in window && 'cacheCellPositions' in Grid) {
			requestAnimationFrame(Grid.cacheCellPositions);
		}

		if (!document.documentElement.hasAttribute('options-hidden')) {
			this.resizeOptionsThumbnail();
		}
	},
	updateGridPrefs: function() {
		document.querySelector('[name="rows"]').value = GridPrefs.gridRows;
		document.querySelector('[name="columns"]').value = GridPrefs.gridColumns;
	},
	setGridMargin: function(piece, size) {
		let pieceElement = document.getElementById('newtab-margin-' + piece);
		pieceElement.classList.remove('medium');
		pieceElement.classList.remove('large');
		if (size == 'medium' || size == 'large') {
			pieceElement.classList.add(size);
		}
	},
	onVisible: function() {
		// if (!this.prefs.getBoolPref('optionspointershown')) {
		// 	this.optionsTogglePointer.hidden = false;
		// 	this.optionsTogglePointer.style.animationPlayState = 'running';
		// }
		this.onVisible = function() {};
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
			this.siteURL.textContent = '';// this.strings.GetStringFromName('tileurl.empty');
			this.setTitleInput.value = '';
			this.removeSavedThumbButton.disabled =
				this.setBgColourButton.disabled =
				this.resetBgColourButton.disabled = true;
			return;
		}

		if (site.link.image) {
			let thumbnailURL = URL.createObjectURL(site.link.image);
			this.siteThumbnail.style.backgroundImage = 'url("' + thumbnailURL + '")';
			this.removeSavedThumbButton.disabled = false;
		} else {
			this.siteThumbnail.style.backgroundImage = null;
			this.removeSavedThumbButton.disabled = true;
		}

		let { gridRows, gridColumns } = GridPrefs;
		let row = Math.floor(index / gridColumns);
		let column = index % gridColumns;
		this.tilePreviousRow.style.opacity = row === 0 ? 0.25 : null;
		this.tilePrevious.style.opacity = column === 0 ? 0.25 : null;
		this.tileNext.style.opacity = (column + 1 == gridColumns) ? 0.25 : null;
		this.tileNextRow.style.opacity = (row + 1 == gridRows) ? 0.25 : null;

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
		Promise.all([
			GridPrefs.init(),
			initDB()
		]).then(function() {
			// Everything is loaded. Initialize the New Tab Page.
			Page.init();
			newTabTools.updateUI();
			newTabTools.updateGridPrefs();
			newTabTools.refreshBackgroundImage();

			if (isFirstRun) {
				return newTabTools.getEverythingFromOldExtension();
			}
		}).catch(console.error.bind(console));
	},
	getEverythingFromOldExtension: function() {
		return Promise.all([
			Tiles.getTilesFromOldExtension(),
			Background.getBackgroundFromOldExtension(),
			GridPrefs.getPrefsFromOldExtension()
		]).then(function() {
			newTabTools.refreshBackgroundImage();
			Grid.refresh();
		});
	}
};

(function() {
	// function getTopWindow() {
	// 	return window.QueryInterface(Ci.nsIInterfaceRequestor)
	// 	.getInterface(Ci.nsIWebNavigation)
	// 	.QueryInterface(Ci.nsIDocShellTreeItem)
	// 	.rootTreeItem
	// 	.QueryInterface(Ci.nsIInterfaceRequestor)
	// 	.getInterface(Ci.nsIDOMWindow)
	// 	.wrappedJSObject;
	// }

	// XPCOMUtils.defineLazyGetter(newTabTools, 'browserWindow', function() {
	// 	return getTopWindow();
	// });

	// XPCOMUtils.defineLazyGetter(newTabTools, 'prefs', function() {
	// 	return Services.prefs.getBranch('extensions.newtabtools.');
	// });

	// XPCOMUtils.defineLazyGetter(newTabTools, 'strings', function() {
	// 	return Services.strings.createBundle('chrome://newtabtools/locale/newTabTools.properties');
	// });

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
		'optionsBackground': 'options-bg',
		'optionsPane': 'options'
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

	newTabTools.optionsToggleButton.addEventListener('click', newTabTools.toggleOptions.bind(newTabTools), false);
	newTabTools.optionsBackground.addEventListener('click', newTabTools.hideOptions.bind(newTabTools));
	newTabTools.pinURLInput.addEventListener('input', newTabTools.autocomplete.bind(newTabTools));
	newTabTools.optionsPane.addEventListener('click', newTabTools.optionsOnClick.bind(newTabTools), false);
	newTabTools.optionsPane.addEventListener('change', newTabTools.optionsOnChange.bind(newTabTools), false);
	for (let c of newTabTools.optionsPane.querySelectorAll('select, input[type="range"]')) {
		c.addEventListener('keyup', keyUpHandler);
	}
	newTabTools.setSavedThumbInput.addEventListener('input', function() {
		// newTabTools.setSavedThumbButton.disabled = !/^(file|ftp|http|https):\/\//.exec(this.value);
		newTabTools.setSavedThumbButton.disabled = !this.files.length;
	});
	newTabTools.setBgColourInput.addEventListener('change', function() {
		newTabTools.setBgColourDisplay.style.backgroundColor = this.value;
		newTabTools.setBgColourButton.disabled = false;
	});
	newTabTools.setBackgroundInput.addEventListener('input', function() {
		// newTabTools.setBackgroundButton.disabled = !/^(file|ftp|http|https):\/\//.exec(this.value);
		newTabTools.setBackgroundButton.disabled = !this.files.length;
	});
	window.addEventListener('keypress', function(event) {
		if (event.keyCode == 27) {
			newTabTools.hideOptions();
		}
	});

	let preloaded = document.visibilityState == 'hidden';
	if (!preloaded) {
		newTabTools.onVisible();
	}
})();
