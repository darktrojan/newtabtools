import json, os
from codecs import open as codecsopen
from collections import OrderedDict

from parser import getParser


def _red(string):
	return '\033[91m%s\033[m' % string


def _yellow(string):
	return '\033[93m%s\033[m' % string


def _blue(string):
	return '\033[94m%s\033[m' % string

old_dir = os.path.join(os.getcwd(), 'locale')
new_dir = os.path.join(os.getcwd(), 'webextension', '_locales')
english_file = os.path.join(new_dir, 'en', 'messages.json')
english_data = OrderedDict({
	"options.recent": "Recently closed tabs",
	"recently-closed-tabs": "Recently closed tabs:",
})

for lang in os.listdir(old_dir):
	print _blue(lang)

	locale_dir = os.path.join(new_dir, lang)
	if not os.path.isdir(locale_dir):
		print _red('skipping ' + lang)
		continue

	locale_file = os.path.join(locale_dir, 'messages.json')
	with codecsopen(locale_file, 'r', 'utf-8') as f:
		locale_data = json.load(f)

	for filename in ['newTab.dtd', 'options.dtd']:
		parser = getParser(filename)
		parser.readFile(os.path.join(old_dir, lang, filename))

		for k in parser:
			key = k.get_key().replace('newtabtools.', '')
			value = k.get_val()

			if key in english_data and value != english_data[key]:
				locale_data[key] = dict(message=value)

	for k in english_data.iterkeys():
		if k not in locale_data:
			print _yellow(k)

	with codecsopen(locale_file, 'w', 'utf-8') as f:
		f.write(json.dumps(locale_data, indent=4, separators=[',', ': '], sort_keys=True, ensure_ascii=False).replace('    ', '\t'))
		f.write('\n')
