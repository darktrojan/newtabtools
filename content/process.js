/* globals Components, addMessageListener, removeMessageListener */
let listener = {
	_messages: [
		'NewTabTools:uncacheThumbnailPrefs',
		'NewTabTools:disable'
	],
	init: function() {
		for (let m of this._messages) {
			addMessageListener(m, this);
		}
	},
	destroy: function() {
		for (let m of this._messages) {
			removeMessageListener(m, this);
		}
	},
	receiveMessage: function(message) {
		switch (message.name) {
		case 'NewTabTools:uncacheThumbnailPrefs':
			/* globals PageThumbUtils */
			Components.utils.import('resource://gre/modules/PageThumbUtils.jsm');
			delete PageThumbUtils._thumbnailWidth;
			delete PageThumbUtils._thumbnailHeight;
			break;
		case 'NewTabTools:disable':
			this.destroy();
			break;
		}
	}
};
listener.init();
