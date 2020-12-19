New Tab Tools add-on
====================

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/gfonmeedigdbjpgpeojioadpimflbogh.svg)](https://chrome.google.com/webstore/detail/new-tab-tools/gfonmeedigdbjpgpeojioadpimflbogh)
[![Firefox Add-ons](https://img.shields.io/amo/v/new-tab-tools.svg)](https://addons.mozilla.org/firefox/addon/new-tab-tools/)

Releases
--------

### Firefox
Released versions can be downloaded from https://addons.mozilla.org/firefox/addon/new-tab-tools/

### Chrome
Download from the Chrome store https://chrome.google.com/webstore/detail/new-tab-tools/gfonmeedigdbjpgpeojioadpimflbogh

Hacking
-------

### Firefox
To get a working version of this repo in your Firefox profile, clone it, then link it into your extensions directory as `newtabtools@darktrojan.net` and start Firefox.
```
git clone git://github.com/darktrojan/newtabtools.git
realpath newtabtools > [your profile dir]/extensions/newtabtools@darktrojan.net
```

### Chrome
To get a working version of this repo in Chrome/Chromium, clone it, then switch to the `chrome` branch. From the Extensions page, click "Load unpacked extension…".

Localizing
----------
Please send a pull request. [Here's some information that might be helpful](https://github.com/darktrojan/openwith/issues/141#issue-261143759) (it's for another extension, but mostly applies to New Tab Tools).

Credit
------
The files in `webextension/lib` are from https://github.com/gildas-lormeau/zip.js.
