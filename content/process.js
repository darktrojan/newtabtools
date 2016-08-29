/* globals Components, addMessageListener, removeMessageListener, PageThumbUtils */
Components.utils.import('resource://gre/modules/PageThumbUtils.jsm');

let listener = {
	_messages: [
		'NewTabTools:enable',
		'NewTabTools:uncacheThumbnailPrefs',
		'NewTabTools:disable'
	],
	// NewTabTools:enable is broadcast to all processes at startup, to counteract any broadcasts
	// of NewTabTools:disable from the shutdown of a previous version. This function might run
	// twice in a row, so we need to make sure any effects aren't doubled.
	enable: function() {
		for (let m of this._messages) {
			addMessageListener(m, this);
		}

		if (typeof PageThumbUtils._oldGetContentSize != 'function') {
			PageThumbUtils._oldGetContentSize = PageThumbUtils.getContentSize;
			PageThumbUtils.getContentSize = function(window) {
				let [width, height] = PageThumbUtils._oldGetContentSize(window);
				return [
					Math.min(16384, width),
					Math.min(16384, height + window.scrollMaxY)
				];
			};
		}
	},
	disable: function() {
		for (let m of this._messages) {
			removeMessageListener(m, this);
		}

		if (typeof PageThumbUtils._oldGetContentSize == 'function') {
			PageThumbUtils.getContentSize = PageThumbUtils._oldGetContentSize;
			delete PageThumbUtils._oldGetContentSize;
		}
	},
	receiveMessage: function(message) {
		switch (message.name) {
		case 'NewTabTools:enable':
			this.enable();
			break;
		case 'NewTabTools:uncacheThumbnailPrefs':
			delete PageThumbUtils._thumbnailWidth;
			delete PageThumbUtils._thumbnailHeight;
			break;
		case 'NewTabTools:disable':
			this.disable();
			break;
		}
	}
};
listener.enable();
