/* globals chrome */
function getTab() {
	return new Promise(function(resolve) {
		chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
			resolve(tabs[0]);
		});
	});
}

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
		chrome.tabs.executeScript(tab.id, {file: 'thumbnail.js'});
		window.close();
	});
};
