/* globals Components */
let { utils: Cu } = Components;

let returnValues = window.arguments[0];
let done = window.arguments[1];

if (returnValues.importing) {
	if ('browser.newtabpage.columns' in returnValues.prefs) {
		returnValues.prefs['extensions.newtabtools.columns'] = returnValues.prefs['browser.newtabpage.columns'];
		delete returnValues.prefs['browser.newtabpage.columns'];
	}
	if ('browser.newtabpage.rows' in returnValues.prefs) {
		returnValues.prefs['extensions.newtabtools.rows'] = returnValues.prefs['browser.newtabpage.rows'];
		delete returnValues.prefs['browser.newtabpage.rows'];
	}

	document.getElementById('export-header').setAttribute('hidden', 'true');
	for (let checkbox of document.querySelectorAll('checkbox')) {
		switch (checkbox.id) {
		case 'prefs.pinned':
		case 'prefs.blocked': {
			let prefName = 'browser.newtabpage.' + checkbox.id.substring(6); // length of "prefs."
			checkbox.disabled = !(prefName in returnValues.prefs);
			break;
		}
		case 'prefs.theme':
			checkbox.disabled = !('extensions.newtabtools.page.theme' in returnValues.prefs);
			break;
		case 'prefs.gridsize':
			checkbox.disabled = !('extensions.newtabtools.columns' in returnValues.prefs) || !('extensions.newtabtools.rows' in returnValues.prefs);
			break;
		case 'prefs.gridmargin':
			checkbox.disabled = !('extensions.newtabtools.grid.margin' in returnValues.prefs) || !('extensions.newtabtools.grid.spacing' in returnValues.prefs);
			break;
		case 'prefs.thumbs.position':
			checkbox.disabled = !('extensions.newtabtools.thumbs.contain' in returnValues.prefs);
			break;
		case 'prefs.thumbs.hidebuttons':
		case 'prefs.thumbs.hidefavicons':
		case 'prefs.launcher':
		case 'prefs.recent.show':
			let prefName = 'extensions.newtabtools.' + checkbox.id.substring(6); // length of "prefs."
			checkbox.disabled = !(prefName in returnValues.prefs);
			break;
		case 'prefs.tiledata':
			checkbox.disabled = !('newtabtools/title' in returnValues.annos) && !('extensions.newtabtools.tiledata' in returnValues.prefs);
			break;
		case 'tiles.thumbs':
			checkbox.disabled = returnValues.thumbnails.length == 0;
			break;
		case 'page.background':
			checkbox.disabled = !returnValues.hasBackgroundImage;
			break;
		default:
			Cu.reportError(checkbox.id);
			checkbox.disabled = true;
			break;
		}
		checkbox.checked = !checkbox.disabled;
	}
} else {
	document.getElementById('import-header').setAttribute('hidden', 'true');
	for (let checkbox of document.querySelectorAll('checkbox')) {
		checkbox.checked = true;
	}
}

window.addEventListener('load', function onLoad() {
	document.documentElement.getButton('accept').focus();
});

/* exported onDialogAccept, onDialogCancel */
function onDialogAccept() {
	let options = {};
	for (let checkbox of document.querySelectorAll('checkbox')) {
		let dot = checkbox.id.indexOf('.');
		let category = checkbox.id.substring(0, dot);
		let name = checkbox.id.substring(dot + 1);
		if (!(category in options)) {
			options[category] = {};
		}
		options[category][name] = checkbox.checked;
	}
	returnValues.options = options;
	returnValues.cancelled = false;

	done();
}

function onDialogCancel() {
	done();
}
