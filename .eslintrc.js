/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-env node */

module.exports = {
	root: true,
	env: {
		browser: true,
		es6: true,
		webextensions: true,
	},
	extends: ['eslint:recommended'],
	parserOptions: {
		ecmaVersion: 9,
	},
	globals: {
		browser: true,
		chrome: true,
	},
	rules: {
		'comma-dangle': [2, 'only-multiline'],
		'complexity': 0,
		'curly': 2,
		'indent': [2, 'tab', { SwitchCase: 0 }],
		'func-names': [2, 'never'],
		'no-case-declarations': 0,
		'no-tabs': 0,
		'object-curly-newline': 2,
		'padded-blocks': [2, 'never'],
		'quotes': [2, 'single'],
		'semi': 2,
	},
};
