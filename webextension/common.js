/* exported compareVersions */
function compareVersions(a, b) {
	function splitApart(name) {
		var parts = [];
		var lastIsDigit = false;
		var part = '';
		for (let c of name.toString()) {
			let currentIsDigit = c >= '0' && c <= '9';
			if (c == '.' || lastIsDigit != currentIsDigit) {
				if (part) {
					parts.push(lastIsDigit ? parseInt(part, 10) : part);
				}
				part = c == '.' ? '' : c;
			} else {
				part += c;
			}
			lastIsDigit = currentIsDigit;
		}
		if (part) {
			parts.push(lastIsDigit ? parseInt(part, 10) : part);
		}
		return parts;
	}
	function compareParts(x, y) {
		let xType = typeof x;
		let yType = typeof y;

		switch (xType) {
		case yType:
			return x == y ? 0 : (x < y ? -1 : 1);
		case 'string':
			return -1;
		case 'undefined':
			return yType == 'number' ? (y === 0 ? 0 : -1) : 1;
		case 'number':
			return x === 0 && yType == 'undefined' ? 0 : 1;
		}
	}
	let aParts = splitApart(a);
	let bParts = splitApart(b);
	for (let i = 0; i <= aParts.length || i <= bParts.length; i++) {
		let comparison = compareParts(aParts[i], bParts[i]);
		if (comparison !== 0) {
			return comparison;
		}
	}
	return 0;
}
