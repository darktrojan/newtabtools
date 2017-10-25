/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

function getString(name) {
	return chrome.i18n.getMessage(name);
}

function getTab() {
	return new Promise(function(resolve) {
		chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
			resolve(tabs[0]);
		});
	});
}

document.querySelectorAll('[data-message]').forEach(n => {
	n.textContent = getString(n.dataset.message);
});

getTab().then(tab => {
	chrome.runtime.sendMessage({name: 'Tiles.isPinned', url: tab.url}, isPinned => {
		document.getElementById('pinned').hidden = !isPinned;
		document.getElementById('pin').hidden = isPinned;
	});
});

document.getElementById('pin').onclick = function() {
	getTab().then(function(tab) {
		chrome.runtime.sendMessage({name: 'Tiles.pinTile', title: tab.title, url: tab.url});
		window.close();
	});
};

document.getElementById('capture').onclick = function() {
	getTab().then(function(tab) {
		chrome.runtime.sendMessage({name: 'Thumbnails.capture', url: tab.url}, function() {
			window.close();
		});
	});
};
