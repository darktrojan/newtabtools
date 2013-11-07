let returnValues = window.arguments[0];
let done = window.arguments[1];

if (returnValues.importing) {
	for (let checkbox of document.querySelectorAll("checkbox")) {
		switch (checkbox.id) {
		case "prefs.pinned":
		case "prefs.blocked": {
			let prefName = "browser.newtabpage." + checkbox.id.substring(6); // length of "prefs."
			checkbox.disabled = !(prefName in returnValues.prefs);
			break;
		}
		case "prefs.gridsize":
			checkbox.disabled = !("browser.newtabpage.columns" in returnValues.prefs) || !("browser.newtabpage.rows" in returnValues.prefs);
			break;
		case "prefs.thumbs.contain":
		case "prefs.thumbs.hidebuttons":
		case "prefs.thumbs.hidefavicons":
		case "prefs.launcher":
		case "prefs.recent.show":
			let prefName = "extensions.newtabtools." + checkbox.id.substring(6); // length of "prefs."
			checkbox.disabled = !(prefName in returnValues.prefs);
			break;
		case "annos.title":
			checkbox.disabled = !("newtabtools/title" in returnValues.annos);
		case "tiles.thumbs":
			checkbox.disabled = returnValues.thumbnails.length == 0;
			break;
		case "page.background":
			checkbox.disabled = !returnValues.hasBackgroundImage;
			break;
		default:
			Components.utils.reportError(checkbox.id);
			checkbox.disabled = true;
			break;
		}
		checkbox.checked = !checkbox.disabled;
	}
} else {
	for (let checkbox of document.querySelectorAll("checkbox")) {
		checkbox.checked = true;
	}
}

window.addEventListener("load", function onLoad() {
	document.documentElement.getButton("accept").focus();
});

function onDialogAccept() {
	let options = {};
	for (let checkbox of document.querySelectorAll("checkbox")) {
		let dot = checkbox.id.indexOf(".");
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
