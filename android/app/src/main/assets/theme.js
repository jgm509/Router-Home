/* The theme picked in Router Home (Settings → Appearance), which the app
 * copies from the router pages: mode auto|light|dark|black|midnight, and an accent. */
'use strict';
(function () {
	var mq = matchMedia('(prefers-color-scheme: dark)');
	function apply() {
		var t = {};
		try { t = JSON.parse(AppTheme.get()) || {}; } catch (e) { }
		var m = t.mode || 'auto', r = document.documentElement;
		r.setAttribute('data-theme', m === 'auto' ? (mq.matches ? 'dark' : 'light') : m);
		r.setAttribute('data-accent', t.accent || 'ember');
	}
	apply();
	window.applyTheme = function () { apply(); if (window.onTheme) window.onTheme(); };
	if (mq.addEventListener) mq.addEventListener('change', window.applyTheme);
})();
