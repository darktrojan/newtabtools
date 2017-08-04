{
	let canvas1 = document.createElement('canvas');
	canvas1.width = 600;
	canvas1.height = 600;
	let context1 = canvas1.getContext('2d');
	let scale = canvas1.width / document.documentElement.clientWidth;

	context1.scale(scale, scale);
	context1.imageSmoothingEnabled = true;
	context1.drawWindow(window, 0, 0, document.documentElement.clientWidth, document.documentElement.clientWidth, '#fff');

	let canvas2 = document.createElement('canvas');
	canvas2.width = 300;
	canvas2.height = 300;
	let context2 = canvas2.getContext('2d');

	context2.imageSmoothingEnabled = true;
	context2.drawImage(canvas1, 0, 0, 600, 600, 0, 0, 300, 300);

	canvas2.toBlob(function(blob) {
		browser.runtime.sendMessage({
			name: 'Thumbnails.save',
			url: location.href,
			image: blob
		});
	});
}
