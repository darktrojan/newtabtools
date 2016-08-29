/* globals Components, Services, sizeToContent */
Components.utils.import('resource://gre/modules/Services.jsm');

const PREF = 'extensions.newtabtools.filter';
const XULNS = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';
let rows = document.querySelector('rows');
let addRow = document.querySelector('row#addRow');
let addKeyBox = addRow.children[0];
let addValueBox = addRow.children[1];
let addButton = addRow.children[2];

(function() {
	let filters = {};
	try {
		filters = JSON.parse(Services.prefs.getCharPref(PREF));
	} catch (ex) {}
	for (let key of Object.keys(filters).sort()) {
		insertRow(key, filters[key]);
	}
	setTimeout(sizeToContent, 0);

	addKeyBox.addEventListener('input', function() {
		addButton.disabled = !this.value.trim();
	});
	setTimeout(function() { addKeyBox.focus(); }, 0);
})();

function insertRow(key, value) {
	let row = document.createElementNS(XULNS, 'row');
	row.setAttribute('align', 'baseline');
	let keyLabel = document.createElementNS(XULNS, 'label');
	keyLabel.setAttribute('value', key);
	row.appendChild(keyLabel);
	let valueBox = document.createElementNS(XULNS, 'textbox');
	valueBox.setAttribute('type', 'number');
	valueBox.setAttribute('size', '1');
	valueBox.setAttribute('value', value);
	row.appendChild(valueBox);
	let removeButton = document.createElementNS(XULNS, 'button');
	removeButton.setAttribute('label', rows.getAttribute('removebuttonlabel'));
	removeButton.onclick = onRemoveClicked;
	row.appendChild(removeButton);
	rows.insertBefore(row, rows.lastElementChild);
}

/* exported onAddClicked */
function onAddClicked() {
	if (addKeyBox.value) {
		insertRow(addKeyBox.value.trim(), addValueBox.value);
		sizeToContent();
		addKeyBox.value = addValueBox.value = '';
	}
	addKeyBox.focus();
}

/* exported onRemoveClicked */
function onRemoveClicked() {
	this.parentNode.remove();
}

/* exported onDialogAccept */
function onDialogAccept() {
	let data = {};
	for (let row of rows.children) {
		if (row == rows.firstElementChild) {
			continue;
		}
		if (row == rows.lastElementChild) {
			break;
		}
		data[row.children[0].value] = parseInt(row.children[1].value, 10);
	}

	Services.prefs.setCharPref(PREF, JSON.stringify(data));
}
