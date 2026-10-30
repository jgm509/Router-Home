/* Router Home: core (rpc, uci, ui kit, navigation) */
'use strict';

const App = (() => {
	const NULL_SID = '00000000000000000000000000000000';
	let sid = null;
	try { sid = sessionStorage.getItem('home-sid'); } catch (e) {}

	/* ---------------- rpc ---------------- */

	class RpcError extends Error {
		constructor(code, msg) { super(msg); this.code = code; }
	}

	const UBUS_ERR = {
		1: 'Invalid command', 2: 'Invalid argument', 3: 'Method not found', 4: 'Not found',
		5: 'No data', 6: 'Permission denied', 7: 'Timed out', 8: 'Not supported', 9: 'Unknown error', 10: 'Connection failed'
	};

	let rpcId = 1;
	async function rpc(object, method, params, opts) {
		const body = { jsonrpc: '2.0', id: rpcId++, method: 'call', params: [ (opts && opts.sid) || sid || NULL_SID, object, method, params || {} ] };
		let res;
		try {
			res = await fetch('/ubus', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body), signal: opts && opts.signal,
				cache: 'no-store'
			});
		} catch (e) {
			throw new RpcError(-1, 'The router did not answer. Check that you are still connected to it.');
		}
		let j;
		try { j = await res.json(); } catch (e) { throw new RpcError(-2, 'The router sent an unreadable answer (HTTP ' + res.status + ').'); }
		if (j.error) {
			if (j.error.code === -32002 && !(opts && opts.noLogin)) {
				/* -32002 means "access denied": either the session expired, or this
				 * session isn't allowed to do this one thing. Only sign out for the first. */
				const alive = await rpc('session', 'access', { scope: 'ubus', object: 'uci', function: 'get' }, { noLogin: true, allowFail: true }).catch(() => null);
				if (!alive || !alive.access) { logout(true); throw new RpcError(-32002, 'Your session ended. Sign in again.'); }
				throw new RpcError(-32002, `The router didn't allow this (${object}.${method}). Restart rpcd after updating Router Home.`);
			}
			throw new RpcError(j.error.code, j.error.message);
		}
		const r = j.result;
		if (!Array.isArray(r)) throw new RpcError(-3, 'Unexpected answer');
		if (r[0] !== 0) {
			if (opts && opts.allowFail) return null;
			throw new RpcError(r[0], `${object}.${method}: ${UBUS_ERR[r[0]] || 'error ' + r[0]}`);
		}
		const data = r[1] || {};
		if (data.error && !(opts && opts.raw)) throw new RpcError(-4, data.error);
		return data;
	}

	const call = (o, m, p) => rpc(o, m, p, { allowFail: true }).catch(() => null);

	async function login(username, password) {
		const r = await rpc('session', 'login', { username, password, timeout: 3600 }, { sid: NULL_SID, noLogin: true, allowFail: true });
		if (!r || !r.ubus_rpc_session) return false;
		sid = r.ubus_rpc_session;
		try { sessionStorage.setItem('home-sid', sid); } catch (e) {}
		return true;
	}

	function logout(expired) {
		if (sid && !expired) rpc('session', 'destroy', {}, { allowFail: true }).catch(() => {});
		sid = null;
		try { sessionStorage.removeItem('home-sid'); } catch (e) {}
		showLogin(expired ? 'Your session ended. Sign in again.' : null);
	}

	/* ---------------- uci ---------------- */

	const uci = {
		async load(config) {
			const r = await rpc('uci', 'get', { config }, { allowFail: true });
			return (r && r.values) || {};
		},
		sections(values, type) {
			return Object.values(values)
				.filter(s => !type || s['.type'] === type)
				.sort((a, b) => a['.index'] - b['.index']);
		},
		set(config, section, values) { return rpc('uci', 'set', { config, section, values }); },
		unset(config, section, options) { return rpc('uci', 'delete', { config, section, options }); },
		async add(config, type, values, name) {
			const p = { config, type, values };
			if (name) p.name = name;
			const r = await rpc('uci', 'add', p);
			return r.section;
		},
		remove(config, section) { return rpc('uci', 'delete', { config, section }); },
		/* WiFi networks get a name (wifinet0, wifinet1, …) like LuCI gives them;
		 * unnamed ones make LuCI ask to "migrate" the wireless settings */
		async addWifi(values) {
			const w = await this.load('wireless');
			let i = 0;
			while (w['wifinet' + i]) i++;
			return this.add('wireless', 'wifi-iface', values, 'wifinet' + i);
		},
		/* commit staged changes and reload services; rolls back by itself
		 * after 30 s if the browser can't reach the router to confirm. */
		async apply(message) {
			toast(message || 'Saving…', { sticky: true });
			try {
				await rpc('uci', 'apply', { rollback: true, timeout: 30 });
			} catch (e) {
				if (e.code === 6) throw new RpcError(6, 'Another change is still being applied. Wait 30 seconds and try again.');
				throw e;
			}
			const until = Date.now() + 25000;
			await sleep(1500);
			while (Date.now() < until) {
				try {
					await rpc('uci', 'confirm', {}, { noLogin: true });
					toast('Saved');
					return true;
				} catch (e) {
					if (e.code === 5 || e.code === 4) { toast('Saved'); return true; } /* nothing pending */
					await sleep(1500);
				}
			}
			toast('The router could not confirm the change, so it put the old settings back.', { bad: true });
			return false;
		},
		revert(config) { return rpc('uci', 'revert', { config }, { allowFail: true }); }
	};

	/* ---------------- dom helpers ---------------- */

	/* append()/replaceChildren() that accept nested arrays and skip null/false */
	function smart(el) {
		if (el.__smart) return el;
		el.__smart = true;
		el.append = (...k) => { append(el, k); };
		el.replaceChildren = (...k) => { while (el.firstChild) el.removeChild(el.firstChild); append(el, k); };
		return el;
	}

	function h(tag, attrs, ...kids) {
		const el = smart(tag instanceof Node ? tag : document.createElement(tag));
		if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
		for (const k in attrs || {}) {
			const v = attrs[k];
			if (v == null || v === false) continue;
			if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
			else if (k === 'class') el.className = v;
			else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
			else if (k === 'html') el.innerHTML = v;
			else if (k in el && typeof v !== 'string') el[k] = v;
			else el.setAttribute(k, v === true ? '' : v);
		}
		append(el, kids);
		return el;
	}
	function append(el, kids) {
		for (const c of kids) {
			if (c == null || c === false) continue;
			if (Array.isArray(c)) append(el, c);
			else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
		}
	}
	const $ = (sel, root) => (root || document).querySelector(sel);
	const sleep = ms => new Promise(r => setTimeout(r, ms));

	/* ---------------- icons ---------------- */

	const ICONS = {
		home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
		devices: 'M4 5h12v9H4zM2 18h16M19 8h3v11h-3z',
		wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
		network: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
		system: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.6 7.6 0 0 1-1.7 1l-.3 2h-4l-.3-2a7.6 7.6 0 0 1-1.7-1l-1.9.7-2-3.4 1.6-1.2a7.7 7.7 0 0 1 0-3l-1.6-1.2 2-3.4 1.9.7a7.6 7.6 0 0 1 1.7-1l.3-2h4l.3 2a7.6 7.6 0 0 1 1.7 1l1.9-.7 2 3.4-1.6 1.2a7.7 7.7 0 0 1 0 3z',
		chev: 'M9 6l6 6-6 6',
		back: 'M15 6l-6 6 6 6',
		close: 'M6 6l12 12M18 6L6 18',
		phone: 'M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18.5h2',
		laptop: 'M5 5h14v10H5zM2 19h20',
		tv: 'M3 5h18v12H3zM8 21h8',
		cable: 'M7 3v5M17 3v5M5 8h14v4a7 7 0 0 1-14 0zM12 19v3',
		sim: 'M6 2h9l4 4v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM9 12h6v6H9z',
		lock: 'M6 10h12v11H6zM8.5 10V7a3.5 3.5 0 0 1 7 0v3',
		shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
		power: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
		upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
		download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
		refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
		plus: 'M12 5v14M5 12h14',
		trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
		qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2v2h-2zM18 14h2v2h-2z',
		clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
		light: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z',
		key: 'M14 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM10.5 11.5L3 19v2h3v-2h2v-2h2l1.5-1.5',
		dns: 'M4 5h16v5H4zM4 14h16v5H4zM7.5 7.5h.01M7.5 16.5h.01',
		vpn: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
		link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
		pause: 'M8 5v14M16 5v14',
		play: 'M7 4l13 8-13 8z',
		globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
		log: 'M5 3h10l4 4v14H5zM8 9h8M8 13h8M8 17h5',
		box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
		user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0',
		edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
		fan: 'M12 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0M12 10.4C12 6 13 3 15.5 3.5 18 4 16 8.5 13.4 11.2M13.6 12c4.4 0 7.4 1 6.9 3.5-.5 2.5-5 .5-7.7-2.1M12 13.6c0 4.4-1 7.4-3.5 6.9-2.5-.5-.5-5 2.1-7.7M10.4 12C6 12 3 11 3.5 8.5 4 6 8.5 8 11.2 10.6',
		antenna: 'M12 10v11M8 21h8M8.5 6.5a5 5 0 0 1 7 0M5.6 3.6a9 9 0 0 1 12.8 0M12 10h.01',
		dashboard: 'M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z',
		interfaces: 'M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-2h12v2',
		more: 'M5 12h.01M12 12h.01M19 12h.01',
		cpu: 'M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
		memory: 'M3 7h18v10H3zM7 10v4M11 10v4M15 10v4M6 17v3M18 17v3',
		chart: 'M3 20h18M5 16l4-5 4 3 6-8',
		storage: 'M6 3h9l4 4v14H6zM9 8h1M12 8h1M15 8h1',
		tools: 'M3 12h4l2-6 4 12 2-6h6',
		services: 'M4 6h10M4 12h10M4 18h7M17 15l2 2 3-4M17 5.5l2 2 3-4',
		package: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10M7.5 5l9 4',
		palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1.2-1-1.4-1-2.5 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4-4-7.5-9-7.5zM7.5 11h.01M10 7h.01M15 7h.01',
		thermo: 'M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0zM12 11v6',
		search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
		gauge: 'M12 13l4-4M4 18a9 9 0 1 1 16 0',
		up: 'M12 19V5M6 11l6-6 6 6',
		check: 'M5 12.5l4.5 4.5L19 7.5',
		down: 'M12 5v14M6 13l6 6 6-6'
	};
	function icon(name, cls) {
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '1.8');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		svg.setAttribute('aria-hidden', 'true');
		if (cls) svg.setAttribute('class', cls);
		const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		p.setAttribute('d', ICONS[name] || ICONS.box);
		svg.appendChild(p);
		return svg;
	}

	/* ---------------- ui kit ---------------- */

	function row(o) {
		const clickable = !!(o.onClick || o.href);
		const el = h(o.href ? 'a' : (clickable ? 'button' : 'div'), {
			class: 'row' + (o.danger ? ' danger' : '') + (o.disabled ? ' disabled' : ''),
			type: clickable && !o.href ? 'button' : null,
			href: o.href, target: o.target,
			onclick: o.onClick
		},
			o.icon ? h('span', { class: 'ic', style: o.iconColor ? { color: o.iconColor } : null }, typeof o.icon === 'string' ? icon(o.icon) : o.icon) : null,
			h('span', { class: 'main' },
				h('div', { class: 'label' }, o.label),
				o.sub ? h('div', { class: 'sub' }, o.sub) : null),
			o.value != null ? h('span', { class: 'value' }, o.value) : null,
			o.right || null,
			clickable && o.chevron !== false ? icon('chev', 'chev') : null
		);
		return el;
	}
	const group = (...rows) => h('div', { class: 'group' }, rows);
	const sectionTitle = (text, extra, ic) => h('h2', { class: 'section-title' + (ic ? ' with-icon' : '') }, h('span', ic ? icon(ic, 'st-ic') : null, text), extra || null);
	/* a small "?" that explains a complicated setting in plain words.
	 * parts: strings (paragraphs), or nodes; {rec: '...'} adds a "Recommended" line */
	function explain(title, ...parts) {
		return h('button', { type: 'button', class: 'explain', 'aria-label': `About ${title}`, onclick: e => {
			e.preventDefault(); e.stopPropagation();
			sheet(title, close => h('div', parts.map(p => typeof p === 'string' ? h('p', { class: 'explain-text' }, p)
				: p && p.rec ? h('div', { class: 'note' }, h('strong', 'Recommended: '), p.rec) : p),
				h('div', { class: 'actions' }, btn('Got it', close))));
		} }, '?');
	}
	const hint = text => h('p', { class: 'hint' }, text);
	const note = (text, kind) => h('div', { class: 'note' + (kind ? ' ' + kind : '') }, text);

	function field(label, input, err) {
		const f = h('label', { class: 'field' }, h('span', label), input);
		if (err) f.appendChild(h('div', { class: 'err' }, err));
		return f;
	}
	function input(attrs) { return h('input', Object.assign({ autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' }, attrs)); }
	function password(value, attrs) {
		const inp = input(Object.assign({ type: 'password', value: value || '' }, attrs));
		const peek = h('button', { type: 'button', class: 'peek', onclick: e => {
			e.preventDefault();
			inp.type = inp.type === 'password' ? 'text' : 'password';
			peek.textContent = inp.type === 'password' ? 'Show' : 'Hide';
		} }, 'Show');
		return [ inp, peek ];
	}
	function select(options, value, attrs) {
		const s = h('select', attrs);
		for (const o of options) {
			const [v, l] = Array.isArray(o) ? o : [o, o];
			s.appendChild(h('option', { value: v, selected: String(v) === String(value) }, l));
		}
		return s;
	}
	function toggle(checked, onchange, label) {
		return h('input', { type: 'checkbox', class: 'switch', checked: !!checked, 'aria-label': label || null, onchange });
	}
	function seg(options, value, onchange) {
		const wrap = h('div', { class: 'seg', role: 'group' });
		wrap.value = value;
		for (const o of options) {
			const [v, l, disabled] = Array.isArray(o) ? o : [o, o];
			const b = h('button', { type: 'button', 'aria-pressed': String(v) === String(value) ? 'true' : 'false', disabled: !!disabled, onclick: () => {
				wrap.value = v;
				for (const x of wrap.children) x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
				onchange && onchange(v);
			} }, l);
			wrap.appendChild(b);
		}
		return wrap;
	}
	function btn(label, onClick, cls, attrs) {
		return h('button', Object.assign({ type: 'button', class: 'btn' + (cls ? ' ' + cls : ''), onclick: onClick }, attrs || {}), label);
	}
	/* run an async action from a button, showing a spinner and any error */
	async function busy(button, fn) {
		const old = button ? Array.from(button.childNodes) : null;
		if (button) { button.disabled = true; button.replaceChildren(h('span', { class: 'spinner' })); }
		try { return await fn(); }
		catch (e) { toast(e.message || String(e), { bad: true }); console.error(e); }
		finally { if (button && button.isConnected) { button.disabled = false; button.replaceChildren(...old); } }
	}

	let toastTimer;
	function toast(msg, o) {
		const t = $('#toast');
		t.textContent = msg;
		t.className = 'show' + (o && o.bad ? ' bad' : '');
		clearTimeout(toastTimer);
		if (!(o && o.sticky)) toastTimer = setTimeout(() => { t.className = ''; }, o && o.bad ? 6000 : 2600);
	}

	/* bottom sheet / dialog. content: Node or (close) => Node */
	function sheet(title, content, o) {
		const root = $('#sheet-root');
		const prevFocus = document.activeElement;
		let closed = false;
		const close = () => {
			if (closed) return; closed = true;
			bd.remove();
			if (!root.children.length) document.body.classList.remove('sheet-open');
			document.removeEventListener('keydown', onKey);
			o && o.onClose && o.onClose();
			prevFocus && prevFocus.focus && prevFocus.focus();
		};
		const onKey = e => { if (e.key === 'Escape') close(); };
		const body = h('div', { class: 'sheet-body' });
		const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
			h('div', { class: 'grabber' }),
			h('div', { class: 'sheet-head' },
				h('h2', title),
				h('button', { type: 'button', class: 'btn secondary small', onclick: close, 'aria-label': 'Close' }, icon('close'))),
			body);
		const bd = h('div', { class: 'sheet-backdrop', onclick: e => { if (e.target === bd && !(o && o.modal)) close(); } }, box);
		append(body, [ typeof content === 'function' ? content(close, body) : content ]);
		root.appendChild(bd);
		/* the page behind doesn't scroll while a sheet is open */
		document.body.classList.add('sheet-open');
		document.addEventListener('keydown', onKey);
		setTimeout(() => { const f = box.querySelector('input:not([type=checkbox]),select,textarea'); (f || box.querySelector('.sheet-head button')).focus({ preventScroll: true }); }, 50);
		return { close, body, box };
	}

	function confirmBox(title, text, okLabel, danger) {
		return new Promise(resolve => {
			let done = false;
			const s = sheet(title, close => h('div',
				h('p', { style: { margin: '4px 2px 0', color: 'var(--muted)' } }, text),
				h('div', { class: 'actions' },
					btn('Cancel', () => close(), 'secondary'),
					btn(okLabel || 'Continue', () => { done = true; resolve(true); close(); }, danger ? 'danger' : ''))
			), { onClose: () => { if (!done) resolve(false); } });
			return s;
		});
	}

	function qrSvg(text) {
		const q = qrcode(0, 'M');
		q.addData(text);
		q.make();
		const n = q.getModuleCount(), m = 2;
		let d = '';
		for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
		const wrap = h('div', { class: 'qr' });
		wrap.innerHTML = `<svg viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges" role="img" aria-label="QR code"><path d="${d}" fill="#000"/></svg>`;
		return wrap;
	}

	/* ---------------- formatting ---------------- */

	const fmt = {
		bytes(n) {
			n = +n || 0;
			const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
			while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
			return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + ' ' + u[i];
		},
		/* bits per second -> [number, unit] */
		rate(bps) {
			bps = +bps || 0;
			if (bps >= 1e9) return [(bps / 1e9).toFixed(2), 'Gbps'];
			if (bps >= 1e6) return [(bps / 1e6).toFixed(bps >= 1e8 ? 0 : 1), 'Mbps'];
			if (bps >= 1e3) return [(bps / 1e3).toFixed(0), 'kbps'];
			return ['0', 'Mbps'];
		},
		rateText(bps) { const [n, u] = fmt.rate(bps); return n + ' ' + u; },
		duration(s) {
			s = Math.max(0, Math.floor(+s || 0));
			const d = Math.floor(s / 86400), hh = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
			if (d) return `${d} d ${hh} h`;
			if (hh) return `${hh} h ${m} min`;
			if (m) return `${m} min`;
			return `${s} s`;
		},
		ago(s) { return s == null ? '' : fmt.duration(s) + ' ago'; },
		mac(m) { return (m || '').toUpperCase(); }
	};

	/* ---------------- navigation ---------------- */

	const views = [];
	const TABS = [
		['network', 'Interfaces', 'interfaces'],
		['devices', 'Clients', 'devices'],
		['home', 'Dashboard', 'dashboard'],
		['wifi', 'Wireless', 'wifi'],
		['more', 'More', 'more']
	];
	/* pages reached from "More" light up the More tab */
	const tabFor = (name, sub) => TABS.some(t => t[0] === name) && !(name === 'network' && /^(firewall|lans|adguard|check|security)$/.test(sub || '')) ? name : 'more';
	let prevHash = '', lastHash = '';
	let current = null, timers = [], aborts = [];

	function register(name, def) { views[name] = def; }

	/* interval that stops when the user leaves the page */
	function every(ms, fn) {
		let stopped = false, t;
		const tick = async () => {
			if (stopped) return;
			if (!document.hidden) { try { await fn(); } catch (e) { console.warn(e); } }
			if (!stopped) t = setTimeout(tick, ms);
		};
		tick();
		const stop = () => { stopped = true; clearTimeout(t); };
		timers.push(stop);
		return stop;
	}

	function go(path) { location.hash = '#/' + path; }

	async function route() {
		if (!sid) return showLogin();
		const parts = location.hash.replace(/^#\/?/, '').split('/');
		const name = views[parts[0]] ? parts[0] : 'home';
		if (location.hash !== lastHash) { prevHash = lastHash; lastHash = location.hash; }
		timers.forEach(s => s()); timers = [];
		$('#sheet-root').replaceChildren(); document.body.classList.remove('sheet-open');
		document.body.classList.remove('login-mode');
		$('#app').classList.remove('booting', 'login-mode');
		const tab = tabFor(name, parts[1]);
		for (const a of $('#tabs').querySelectorAll('a[data-tab]')) {
			if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
			else a.removeAttribute('aria-current');
		}
		const view = $('#view');
		const page = h('div', { class: 'page' });
		view.replaceChildren(page);
		current = name;
		if (parts[0] !== name || parts.length === 1) window.scrollTo(0, 0);
		try {
			await views[name].render(page, parts.slice(1));
		} catch (e) {
			console.error(e);
			if (current === name && sid) page.replaceChildren(h('h1', { class: 'page-title' }, 'Something went wrong'), note(e.message || String(e), 'bad'),
				h('div', { class: 'btn-row' }, btn('Try again', () => route())));
		}
	}

	function buildTabs() {
		const nav = $('#tabs');
		smart(nav).replaceChildren(
			h('div', { class: 'brand' }, h('span', { class: 'lamp online', style: { width: '22px', height: '22px', boxShadow: 'none' } }), info.hostname || 'Router'),
			TABS.map(([id, label, ic]) => h('a', { href: '#/' + id, 'data-tab': id, class: id === 'home' ? 'center' : null },
				h('span', { class: 'tab-ic' }, icon(ic), h('i', { class: 'tab-badge', hidden: true })), h('span', { class: 'tab-label' }, label)))
		);
	}
	function setBadge(tab, n) {
		const b = $('#tabs').querySelector(`a[data-tab="${tab}"] .tab-badge`);
		if (!b) return;
		b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n || '');
	}
	/* where a "back" link should go: the page the user came from, when it was "More" */
	function backTo(def, defLabel) {
		if (/^#\/more\/?$/.test(prevHash)) return ['#/more', 'More'];
		return [def, defLabel];
	}

	/* ---------------- login ---------------- */

	function showLogin(msg) {
		timers.forEach(s => s()); timers = [];
		$('#sheet-root').replaceChildren(); document.body.classList.remove('sheet-open');
		$('#app').classList.add('login-mode');
		$('#app').classList.remove('booting');
		const user = input({ name: 'username', value: 'root', autocomplete: 'username' });
		const [pw, peek] = password('', { name: 'password', autocomplete: 'current-password' });
		const err = h('div', { class: 'note bad', hidden: !msg }, msg || '');
		const submit = h('button', { class: 'btn', type: 'submit' }, 'Sign in');
		const form = h('form', { onsubmit: async e => {
			e.preventDefault();
			await busy(submit, async () => {
				if (await login(user.value.trim(), pw.value)) {
					await boot();
				} else {
					err.hidden = false;
					err.textContent = 'That password didn\'t work. It is the same one you use for the advanced settings (LuCI). If you never set one, leave it empty.';
					pw.select();
				}
			});
		} },
			h('div', { class: 'lamp checking' }),
			h('h1', 'Sign in to your router'),
			h('p', 'Use the router\'s admin password.'),
			err,
			h('div', { class: 'group' }, field('User', user), field('Password', [pw, peek])),
			submit,
			h('p', { class: 'hint', style: { textAlign: 'center', marginTop: '18px' } }, h('a', { href: '/cgi-bin/luci/' }, 'Open the advanced settings (LuCI)'))
		);
		$('#view').replaceChildren(h('div', { class: 'login' }, form));
		setTimeout(() => pw.focus(), 50);
	}

	/* ---------------- boot ---------------- */

	const info = {};
	async function boot() {
		const [i, board, sys] = await Promise.all([
			rpc('home-ui', 'info', {}, { allowFail: true, raw: true }).catch(() => null),
			call('system', 'board'),
			call('system', 'info')
		]);
		Object.assign(info, i || {}, { boardinfo: board || {}, sysinfo: sys || {}, plugin: !!i });
		if (!info.hostname && board) info.hostname = board.hostname;
		buildTabs();
		if (!location.hash) location.hash = '#/home';
		route();
	}

	/* ---------------- install as an app ---------------- */

	const pwa = { prompt: null };
	window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); pwa.prompt = e; });
	window.addEventListener('appinstalled', () => { pwa.prompt = null; toast('Router Home installed'); });
	pwa.standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true || /RouterHomeApp/.test(navigator.userAgent);
	pwa.secure = () => window.isSecureContext;

	function syncSheetOpen() {
		const r = $('#sheet-root');
		document.body.classList.toggle('sheet-open', !!(r && r.children.length));
	}
	function start() {
		new MutationObserver(syncSheetOpen).observe($('#sheet-root'), { childList: true });
		document.addEventListener('visibilitychange', syncSheetOpen);
		window.addEventListener('pageshow', syncSheetOpen);
		window.addEventListener('focus', syncSheetOpen);
		if ('serviceWorker' in navigator && window.isSecureContext)
			navigator.serviceWorker.register('sw.js', { scope: './' }).catch(e => console.warn('service worker', e));
		window.addEventListener('hashchange', route);
		if (sid) {
			rpc('session', 'access', { scope: 'ubus', object: 'uci', function: 'get' }, { noLogin: true, allowFail: true })
				.then(r => (r && r.access) ? boot() : logout(true))
				.catch(() => showLogin('The router did not answer. Reload the page to try again.'));
		} else showLogin();
	}

	return {
		start, rpc, call, uci, h, $, icon, row, group, sectionTitle, explain, hint, note, field, input, password, select, toggle, seg, btn, busy,
		toast, sheet, confirm: confirmBox, qrSvg, fmt, register, every, go, route, info, sleep, logout, RpcError, pwa, setBadge, backTo,
		get sid() { return sid; }
	};
})();
