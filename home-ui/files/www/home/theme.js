/* Router Home: themes. Runs before the page is drawn so there is no flash.
 * mode:   auto | light | dark | black | midnight   (localStorage home-theme)
 * accent: ember | ocean | forest | violet | rose | teal | amber (home-accent) */
'use strict';
var Theme = (function () {
	var MODES = [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark'], ['black', 'Black'], ['midnight', 'Midnight']];
	var ACCENTS = [
		['ember', 'Ember', '#c2410c', '#fb7a3c'],
		['ocean', 'Ocean', '#2f6df6', '#5b8eff'],
		['forest', 'Forest', '#15803d', '#4ade80'],
		['violet', 'Violet', '#7c3aed', '#a78bfa'],
		['rose', 'Rose', '#e11d48', '#fb7185'],
		['teal', 'Teal', '#0f766e', '#2dd4bf'],
		['amber', 'Amber', '#b45309', '#fbbf24']
	];
	var BG = { light: '#f3f5f7', dark: '#16181b', black: '#000000', midnight: '#0c1520' };
	function get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
	function put(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} }
	var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
	function mode() { return get('home-theme', 'auto'); }
	function accent() { return get('home-accent', 'ember'); }
	function resolved() { var m = mode(); return m === 'auto' ? (mq && mq.matches ? 'dark' : 'light') : m; }
	function apply() {
		var r = document.documentElement, t = resolved();
		r.setAttribute('data-theme', t);
		r.setAttribute('data-accent', accent());
		var metas = document.querySelectorAll('meta[name="theme-color"]');
		for (var i = 0; i < metas.length; i++) { metas[i].setAttribute('content', BG[t] || BG.light); metas[i].removeAttribute('media'); }
	}
	if (mq) { var f = function () { if (mode() === 'auto') apply(); }; mq.addEventListener ? mq.addEventListener('change', f) : mq.addListener(f); }
	apply();
	document.addEventListener('DOMContentLoaded', apply);
	return {
		MODES: MODES, ACCENTS: ACCENTS, mode: mode, accent: accent, resolved: resolved, apply: apply,
		setMode: function (m) { put('home-theme', m === 'auto' ? null : m); apply(); },
		setAccent: function (a) { put('home-accent', a === 'ember' ? null : a); apply(); },
		name: function () {
			var m = MODES.filter(function (x) { return x[0] === mode(); })[0], a = ACCENTS.filter(function (x) { return x[0] === accent(); })[0];
			return (m ? m[1] : 'Automatic') + ' · ' + (a ? a[1] : 'Ember');
		}
	};
})();
