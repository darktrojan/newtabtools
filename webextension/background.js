/* globals Prefs, Tiles, Blocked, Background, browser, initDB, isFirstRun */
Promise.all([
	Prefs.init(),
	initDB()
]).then(function() {
	if (isFirstRun) {
		return Promise.all([
			Tiles.getTilesFromOldExtension(),
			Background.getBackgroundFromOldExtension(),
			Prefs.getPrefsFromOldExtension()
		]);
	}
});

browser.runtime.onMessage.addListener(function(message, sender, sendResponse) {
	switch (message.name) {
	case 'Tiles.getAllTiles':
		Tiles.getAllTiles(message.count).then(function(tiles) {
			sendResponse({ tiles, list: Tiles._list });
		});
		return true;
	case 'Tiles.putTile':
		Tiles.putTile(message.tile).then(sendResponse);
		return true;
	case 'Tiles.removeTile':
		Tiles.removeTile(message.tile).then(sendResponse);
		return true;

	case 'Blocked.block':
		sendResponse(Blocked.block(message.url));
		return;
	case 'Blocked.unblock':
		sendResponse(Blocked.unblock(message.url));
		return;
	case 'Blocked.isBlocked':
		sendResponse(Blocked.isBlocked(message.url));
		return;
	case 'Blocked.clear':
		sendResponse(Blocked.clear());
		return;

	case 'Background.getBackground':
		Background.getBackground().then(sendResponse);
		return true;
	case 'Background.setBackground':
		Background.setBackground(message.file).then(sendResponse);
		return true;
	}
});
