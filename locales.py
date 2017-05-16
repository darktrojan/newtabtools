import json, os
from codecs import open as codecsopen
from collections import OrderedDict

from parser import getParser


def _yellow(string):
	return '\033[93m%s\033[m' % string


def _blue(string):
	return '\033[94m%s\033[m' % string

old_dir = os.path.join(os.getcwd(), 'locale')
new_dir = os.path.join(os.getcwd(), 'webextension', '_locales')
english_file = os.path.join(new_dir, 'en', 'messages.json')
english_data = OrderedDict()

with open(english_file) as f:
	j = json.load(f)
	for k, v in j.iteritems():
		english_data[k] = v['message']

for lang in os.listdir(old_dir):
	print _blue(lang)

	locale_data = dict()
	for locale_file in ['fx-newTab.dtd', 'fx-newTab.properties', 'newTab.dtd', 'newTabTools.properties', 'options.dtd']:
		parser = getParser(locale_file)
		parser.readFile(os.path.join(old_dir, lang, locale_file))

		for k in parser:
			key = k.get_key().replace('newtabtools.', '')
			if locale_file == 'fx-newTab.properties':
				key = key.replace('newtab.', 'tile.')
			elif locale_file == 'newTabTools.properties' and key == 'donate.label':
				continue
			value = k.get_val()

			if key in english_data and value != english_data[key]:
				locale_data[key] = dict(message=value)

	for k in english_data.iterkeys():
		if k not in locale_data:
			print _yellow(k)

	locale_dir = os.path.join(new_dir, lang)
	if not os.path.isdir(locale_dir):
		os.mkdir(locale_dir)

	with codecsopen(os.path.join(locale_dir, 'messages.json'), 'w', 'utf-8') as f:
		f.write(json.dumps(locale_data, indent=4, separators=[',', ': '], sort_keys=True, ensure_ascii=False).replace('    ', '\t'))
		f.write('\n')
