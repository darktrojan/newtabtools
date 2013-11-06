let returnValues = window.arguments[0];
let done = window.arguments[1];

if ("prefs" in returnValues) {
	// for (let checkbox of document.querySelectorAll("checkbox")) {
	// 	checkbox.disabled = !(checkbox.label in returnValues.prefs);
	// }
}

function onDialogAccept() {
	let options = {};
	for (let checkbox of document.querySelectorAll("checkbox")) {
		options[checkbox.label] = checkbox.checked;
	}
	returnValues.options = options;
	returnValues.cancelled = false;

	done();
}
