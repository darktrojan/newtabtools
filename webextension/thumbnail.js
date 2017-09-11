/* globals chrome */
chrome.storage.local.get({'thumbnailSize': 600}, function(prefs) {
	let canvas1 = document.createElement('canvas');
	canvas1.width = prefs.thumbnailSize;
	let context1 = canvas1.getContext('2d');
	let scale = canvas1.width / document.documentElement.scrollWidth;
	canvas1.height = Math.min(canvas1.width, scale * document.documentElement.scrollHeight);

	context1.scale(scale, scale);
	context1.imageSmoothingEnabled = true;
	context1.drawWindow(window, 0, 0, document.documentElement.scrollWidth, document.documentElement.scrollWidth, '#fff');

	canvas1.toBlob(function(blob) {
		chrome.runtime.sendMessage({
			name: 'Thumbnails.save',
			url: location.href,
			image: blob
		});
	});
});
