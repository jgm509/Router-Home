/* Router Home: AdGuard Home control (through its API on the router, via the
 * home-ui rpcd plugin, which keeps the AdGuard Home sign-in).
 * Tabs: Overview · Log · Block & allow · Lists · Services · Devices · Settings */
'use strict';

const Agh = (() => {
	const TABS = [['overview', 'Overview'], ['log', 'Log'], ['rules', 'Block & allow'], ['lists', 'Lists'], ['services', 'Services'], ['devices', 'Devices'], ['settings', 'Settings']];
	const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
	const LISTS = [
		{ name: 'AdGuard DNS filter', url: 'https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt', sub: 'Ads and trackers. A good default.' },
		{ name: 'HaGeZi Multi PRO', url: 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/pro.txt', sub: 'Stronger ads, trackers, malware. Rarely breaks sites.' },
		{ name: 'HaGeZi Threat Intelligence', url: 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/tif.txt', sub: 'Malware, phishing, scams.' },
		{ name: 'HaGeZi DoH/VPN/Proxy bypass', url: 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/doh-vpn-proxy-bypass.txt', sub: 'Stops devices and apps from going around AdGuard Home with their own encrypted DNS or VPNs.' },
		{ name: 'OISD small', url: 'https://small.oisd.nl/', sub: 'Ads and trackers, very few false blocks.' },
		{ name: 'OISD big', url: 'https://big.oisd.nl/', sub: 'Broad ads, trackers, malware.' },
		{ name: 'AdAway', url: 'https://adguardteam.github.io/HostlistsRegistry/assets/filter_2.txt', sub: 'Mobile ads.' },
		{ name: 'Steven Black hosts', url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts', sub: 'Ads and malware (hosts format).' }
	];
	const UPSTREAMS = [
		['Quad9 (blocks malware)', 'https://dns.quad9.net/dns-query'],
		['Cloudflare', 'https://cloudflare-dns.com/dns-query'],
		['AdGuard DNS', 'https://dns.adguard-dns.com/dns-query'],
		['Google', 'https://dns.google/dns-query'],
		['Mullvad', 'https://dns.mullvad.net/dns-query']
	];
	const LOCAL_UP = ['[/lan/]127.0.0.1:54', '[/in-addr.arpa/]127.0.0.1:54', '[/ip6.arpa/]127.0.0.1:54'];

	/* ---------- API ---------- */
	class SignIn extends Error {}
	async function api(method, path, body) {
		const r = await App.rpc('home-ui', 'agh', { action: 'call', method, path, body: body === undefined ? '' : JSON.stringify(body) });
		if (r && r.error === 'signin') throw new SignIn('Sign in to AdGuard Home');
		if (!r || r.error) throw new Error((r && r.error) || 'No answer');
		if (r.status >= 400) throw new Error(typeof r.data === 'string' && r.data ? r.data.trim() : `AdGuard Home answered ${r.status}`);
		return r.data;
	}
	const get = p => api('GET', p);
	const post = (p, b) => api('POST', p, b === undefined ? {} : b);
	/* newer versions use PUT for some settings, older ones a POST to another path */
	async function put(p, b, oldPath, oldBody) {
		try { return await api('PUT', p, b); }
		catch (e) { if (oldPath && /404|405|not found|method/i.test(e.message)) return post(oldPath, oldBody === undefined ? b : oldBody); throw e; }
	}

	/* domain rules: ||example.com^ blocks, @@||example.com^ allows */
	const domainOf = r => { const m = /^(@@)?\|\|([a-z0-9.*-]+)\^(\$important)?$/i.exec(r.trim()); return m ? { allow: !!m[1], domain: m[2] } : null; };
	const cleanDomain = s => s.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/:?#].*$/, '').replace(/^\*\./, '').replace(/^www\./, '');
	const validDomain = d => /^([a-z0-9-]+\.)+[a-z0-9-]{2,}$/.test(d);

	async function setRule(domain, allow) {
		const st = await get('/control/filtering/status');
		const rules = (st.user_rules || []).filter(r => { const d = domainOf(r); return !(d && d.domain === domain); });
		if (allow !== null) rules.push(`${allow ? '@@' : ''}||${domain}^${allow ? '$important' : ''}`);
		await post('/control/filtering/set_rules', { rules });
	}

	const ms2hm = ms => { const m = Math.round((ms || 0) / 60000); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
	const hm2ms = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return ((h || 0) * 60 + (m || 0)) * 60000; };

	/* ---------- page ---------- */
	async function render(page, args) {
		const { h, btn, busy, note, hint, rpc, call } = App;
		const body = h('div', h('div', { class: 'skeleton' }));
		page.append(backLink(), h('h1', { class: 'page-title' }, 'AdGuard Home'), body);
		const info = await call('home-ui', 'agh', { action: 'info' });
		if (!info || !info.installed) {
			const b = btn('Install AdGuard Home', () => busy(b, () => install('adguardhome', () => App.route())), 'small');
			body.replaceChildren(note('AdGuard Home blocks ads, trackers and unwanted sites for every device at home.'), h('div', { class: 'btn-row' }, b),
				hint('After installing, open its setup page (port 3000 on the router) once to create its user name and password, then come back here.'));
			return;
		}
		if (!info.curl) {
			const b = btn('Install curl', () => busy(b, () => install('curl', () => App.route())), 'small');
			body.replaceChildren(note('Router Home needs the small “curl” tool to talk to AdGuard Home.'), h('div', { class: 'btn-row' }, b));
			return;
		}
		if (!info.running) {
			const b = btn('Start AdGuard Home', () => busy(b, async () => { await rpc('home-ui', 'restart_service', { name: 'adguardhome' }); await App.sleep(4000); App.route(); }), 'small');
			body.replaceChildren(note('AdGuard Home is installed but not running. While it is stopped, name lookups may not work if dnsmasq was moved away from port 53.', 'warn'), h('div', { class: 'btn-row' }, b));
			return;
		}
		if (!info.signed_in) return signIn(body, info);

		const tab = TABS.some(t => t[0] === args[1]) ? args[1] : 'overview';
		const seg = App.seg(TABS.map(([k, l]) => [k, l]), tab, v => { location.hash = `#/network/adguard/${v}`; });
		seg.classList.add('scroll');
		const content = h('div', h('div', { class: 'skeleton' }));
		body.replaceChildren(seg, content);
		try {
			await ({ overview, log, rules, lists, services, devices, settings })[tab](content, info);
		} catch (e) {
			if (e instanceof SignIn) return signIn(body, info, 'AdGuard Home did not accept the saved sign-in. Sign in again.');
			content.replaceChildren(note(e.message, 'bad'));
		}
	}

	async function install(name, done) {
		const r = await App.rpc('home-ui', 'pkg_install', { name });
		if (r && r.error) throw new Error(r.error === 'busy' ? 'Another install is still running' : r.error);
		App.toast(`Installing ${name}…`, { sticky: true });
		for (let i = 0; i < 150; i++) {
			await App.sleep(2000);
			const s = await App.call('home-ui', 'pkg_status');
			if (s && s.state === 'done') { App.toast('Installed'); return done(); }
			if (s && s.state === 'failed') throw new Error(s.message);
		}
		throw new Error('Still installing. Check again in a minute.');
	}

	function signIn(body, info, msg) {
		const { h, field, input, password, btn, busy, note, hint, rpc, group } = App;
		const user = input({ autocomplete: 'username', placeholder: 'admin' });
		const [pw, peek] = password('', { autocomplete: 'current-password' });
		const go = btn('Sign in', () => busy(go, async () => {
			const r = await rpc('home-ui', 'agh', { action: 'login', user: user.value.trim(), pass: pw.value });
			if (r && r.error) throw new Error(r.error);
			App.route();
		}));
		body.replaceChildren(
			msg ? note(msg, 'warn') : null,
			hint('Use the user name and password you chose when you set up AdGuard Home. Router Home keeps them on the router, readable by the router\'s admin only.'),
			group(field('User name', user), field('Password', [pw, peek])),
			h('div', { class: 'actions' }, go),
			hint(h('span', 'Forgot it? ', h('a', { href: `http://${location.hostname}:${info.port || 3000}/`, target: '_blank' }, 'Open AdGuard Home'), ' or reset it in its settings file' + (info.config ? ` (${info.config})` : '') + '.')));
	}

	/* ---------- Overview ---------- */
	async function overview(box, info) {
		const { h, row, group, toggle, btn, busy, explain, hint, note, toast, uci, sectionTitle } = App;
		const [st, stats, fw] = await Promise.all([get('/control/status'), get('/control/stats').catch(() => null), uci.load('firewall')]);
		const on = st.protection_enabled;
		const prot = toggle(on, async e => {
			const v = e.target.checked;
			try { await post('/control/protection', { enabled: v }).catch(() => post('/control/dns_config', { protection_enabled: v })); toast(v ? 'Blocking is on' : 'Blocking is off'); }
			catch (err) { e.target.checked = !v; toast(err.message, { bad: true }); }
		}, 'Blocking');
		const pause = btn('Pause 1 hour', () => busy(pause, async () => {
			await post('/control/protection', { enabled: false, duration: 3600000 });
			toast('Blocking is paused for 1 hour'); overview(box, info);
		}), 'small secondary');
		const q = stats ? stats.num_dns_queries || 0 : 0, b = stats ? stats.num_blocked_filtering || 0 : 0;
		const pct = q ? Math.round(b * 1000 / q) / 10 : 0;
		const top = (stats && stats.top_blocked_domains || []).slice(0, 8).map(o => { const [d, n] = Object.entries(o)[0] || []; return { d, n }; }).filter(x => x.d);
		const forced = fw && Object.values(fw).some(s => s.home_ui_force_dns === '1' && s['.type'] === 'redirect' && s.enabled !== '0');
		const force = toggle(forced, async e => {
			const v = e.target.checked;
			try { await setForce(v); } catch (err) { e.target.checked = !v; toast(err.message, { bad: true }); }
		}, 'Every device uses AdGuard Home');
		box.replaceChildren(
			group(
				row({ icon: 'shield', label: 'Blocking', sub: on ? `On · AdGuard Home ${st.version || ''}` : (st.protection_disabled_until ? `Paused until ${new Date(st.protection_disabled_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Off: nothing is blocked'), right: prot }),
				row({ icon: 'lock', label: 'Every device uses AdGuard Home', sub: 'Catches devices with their own DNS settings', right: force })),
			h('div', { class: 'btn-row' }, on ? pause : null),
			h('h2', { class: 'section-title' }, h('span', 'Why a blocked site may still load', explain('Devices that go around AdGuard Home',
				'Phones, browsers and some apps can use their own DNS: Android “Private DNS”, Chrome or Firefox “secure DNS”, iCloud Private Relay, VPN apps. Then they ask AdGuard Home first, get “blocked”, and ask their own DNS next: the site loads, just slower.',
				'“Every device uses AdGuard Home” sends all normal DNS from your home network to AdGuard Home and blocks encrypted DNS on port 853 (Private DNS).',
				'Encrypted DNS over the web port (DoH) can\'t be told apart by the firewall; add the “HaGeZi DoH/VPN/Proxy bypass” list under Lists to block it.',
				{ rec: 'Turn on “Every device uses AdGuard Home”, add the bypass list, and set Private DNS to Off on your phones.' }))),
			stats ? [
				sectionTitle(`Last ${stats.time_units === 'days' ? (stats.dns_queries || []).length + ' days' : '24 hours'}`),
				h('div', { class: 'group' }, h('dl', { class: 'kv' },
					h('dt', 'Lookups'), h('dd', q.toLocaleString()),
					h('dt', 'Blocked'), h('dd', `${b.toLocaleString()} (${pct}%)`),
					h('dt', 'Average time'), h('dd', `${Math.round((stats.avg_processing_time || 0) * 1000)} ms`))),
				top.length ? [sectionTitle('Most blocked'), group(...top.map(x => row({ icon: 'close', label: x.d, value: String(x.n), onClick: () => domainSheet(x.d, () => overview(box, info)) })))] : null] : null,
			hint(h('span', 'Everything else is in ', h('a', { href: `http://${location.hostname}:${info.port || 3000}/`, target: '_blank' }, 'AdGuard Home\'s own page'), '.')),
			h('div', { class: 'btn-row' }, btn('Sign out of AdGuard Home', async () => { await App.rpc('home-ui', 'agh', { action: 'logout' }); App.route(); }, 'small secondary')));
	}

	async function setForce(on) {
		const { uci } = App;
		const fw = await uci.load('firewall');
		for (const s of Object.values(fw)) if (s.home_ui_force_dns === '1') await uci.remove('firewall', s['.name']);
		if (on) {
			await uci.add('firewall', 'redirect', { name: 'Every device uses AdGuard Home', src: 'lan', src_dport: '53', proto: ['tcp', 'udp'], target: 'DNAT', home_ui_force_dns: '1' });
			await uci.add('firewall', 'rule', { name: 'Block encrypted DNS (DoT) going around AdGuard Home', src: 'lan', dest: 'wan', dest_port: '853', proto: ['tcp', 'udp'], target: 'REJECT', home_ui_force_dns: '1' });
		}
		if (!await uci.apply(on ? 'Sending all DNS to AdGuard Home…' : 'Turning off…')) throw new Error('Not saved');
	}

	/* one domain: block / allow / reset, and why it was (not) blocked */
	async function domainSheet(domain, done) {
		const { h, btn, busy, sheet, note, hint } = App;
		let why = null;
		try { why = await get(`/control/filtering/check_host?name=${encodeURIComponent(domain)}`); } catch (e) {}
		const st = await get('/control/filtering/status').catch(() => ({}));
		const own = (st.user_rules || []).map(domainOf).find(d => d && d.domain === domain);
		sheet(domain, close => {
			const act = (allow, label) => { const b = btn(label, () => busy(b, async () => { await setRule(domain, allow); App.toast('Saved. Devices may cache the old answer for a few minutes.'); close(); done && done(); }), allow === false ? 'danger' : allow === null ? 'secondary' : ''); return b; };
			const reason = why && why.reason || '';
			const blocked = /^Filtered/.test(reason) && reason !== 'FilteredSafeSearch';
			return h('div',
				note(blocked ? `Blocked now${why.rules && why.rules[0] ? ` by “${why.rules[0].text}”` : ''}${why.service_name ? ` (service: ${why.service_name})` : ''}.` : (reason === 'NotFilteredAllowList' || reason === 'NotFilteredWhiteList') ? 'Allowed by an allow rule.' : 'Not blocked now.', blocked ? 'bad' : null),
				own ? hint(`Your own rule: ${own.allow ? 'always allow' : 'always block'}.`) : null,
				h('div', { class: 'actions' }, act(true, 'Always allow'), act(false, 'Always block')),
				own ? h('div', { class: 'btn-row', style: { justifyContent: 'center' } }, act(null, 'Remove my rule')) : null,
				hint('Rules also cover the subdomains (www., m., …).'));
		});
	}

	/* ---------- Log ---------- */
	async function log(box) {
		const { h, row, group, input, seg, hint, note } = App;
		let only = 'all', search = '';
		const list = h('div', h('div', { class: 'skeleton' }));
		const s = input({ type: 'search', placeholder: 'Search a site or device' });
		let t; s.oninput = () => { clearTimeout(t); t = setTimeout(() => { search = s.value.trim(); load(); }, 400); };
		const f = seg([['all', 'All'], ['blocked', 'Blocked']], only, v => { only = v; load(); });
		box.replaceChildren(h('div', { class: 'group' }, h('label', { class: 'field' }, s)), f, list);
		async function load() {
			const r = await get(`/control/querylog?limit=100&response_status=${only === 'blocked' ? 'blocked' : 'all'}${search ? '&search=' + encodeURIComponent(search) : ''}`);
			const rows = (r.data || []).map(e => {
				const d = e.question && e.question.name || '?';
				const blocked = /^Filtered/.test(e.reason || '') && e.reason !== 'FilteredSafeSearch';
				const who = (e.client_info && e.client_info.name) || e.client || '';
				const when = e.time ? new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
				return row({ icon: blocked ? 'close' : 'globe', iconColor: blocked ? 'var(--offline)' : null, label: d,
					sub: [who, when, blocked ? (e.service_name ? `blocked (${e.service_name})` : 'blocked') : (/Rewrite/.test(e.reason || '') ? 'rewritten' : null)].filter(Boolean).join(' · '),
					onClick: () => domainSheet(d, load) });
			});
			list.replaceChildren(rows.length ? group(...rows) : note('Nothing here yet.'), hint('Tap a site to always block or allow it.'));
		}
		await load();
	}

	/* ---------- Block & allow ---------- */
	async function rules(box) {
		const { h, row, group, input, btn, busy, field, hint, note, explain, sheet } = App;
		const st = await get('/control/filtering/status');
		const all = st.user_rules || [];
		const doms = all.map(domainOf).filter(Boolean);
		const other = all.filter(r => !domainOf(r) && r.trim() && !r.startsWith('!') && !r.startsWith('#'));
		const d = input({ placeholder: 'example.com', inputmode: 'url', autocapitalize: 'off' });
		const add = allow => { const b = btn(allow ? 'Allow' : 'Block', () => busy(b, async () => {
			const v = cleanDomain(d.value);
			if (!validDomain(v)) throw new Error('Enter a site name like example.com');
			await setRule(v, allow); App.toast(`${v} ${allow ? 'allowed' : 'blocked'}`); rules(box);
		}), allow ? 'secondary' : 'danger'); return b; };
		const check = btn('Check', () => busy(check, async () => { const v = cleanDomain(d.value); if (!validDomain(v)) throw new Error('Enter a site name'); domainSheet(v, () => rules(box)); }), 'secondary');
		const mk = x => row({ icon: x.allow ? 'shield' : 'close', iconColor: x.allow ? 'var(--good)' : 'var(--offline)', label: x.domain, sub: x.allow ? 'Always allowed' : 'Always blocked',
			right: (() => { const b = btn('Remove', () => busy(b, async () => { await setRule(x.domain, null); rules(box); }), 'small secondary'); return b; })(), chevron: false });
		box.replaceChildren(
			h('h2', { class: 'section-title' }, h('span', 'Add a site', explain('Block and allow',
				'Block: the site and its subdomains stop working on every device. Allow: never blocked, even if a list blocks it (fixes a site a list broke).',
				'Changes work within seconds, but devices and browsers may remember the old answer for a few minutes.',
				{ rec: 'When a site or app stops working, open the Log, find what was blocked around that time and tap “Always allow”.' }))),
			group(field('Site', d)),
			h('div', { class: 'btn-row' }, add(false), add(true), check),
			doms.length ? [h('h2', { class: 'section-title' }, h('span', 'Your sites')), group(...doms.filter(x => !x.allow).concat(doms.filter(x => x.allow)).map(mk))] : null,
			h('div', { class: 'btn-row' }, btn(`Edit all rules${other.length ? ` (${other.length} advanced)` : ''}`, () => editRules(all, () => rules(box)), 'small secondary')));
	}
	function editRules(all, done) {
		const { h, btn, busy, sheet, hint } = App;
		sheet('All custom rules', close => {
			const ta = h('textarea', { rows: 14, spellcheck: 'false', autocapitalize: 'off' }); ta.value = all.join('\n');
			const save = btn('Save', () => busy(save, async () => { await post('/control/filtering/set_rules', { rules: ta.value.split('\n').map(s => s.trim()).filter(Boolean) }); close(); done(); }));
			return h('div', h('label', { class: 'field' }, ta),
				hint('One rule per line, AdGuard syntax: ||example.com^ blocks, @@||example.com^ allows, lines starting with ! are comments.'),
				h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), save));
		});
	}

	/* ---------- Lists ---------- */
	async function lists(box) {
		const { h, row, group, toggle, btn, busy, sheet, field, input, hint, explain, confirm, toast } = App;
		const st = await get('/control/filtering/status');
		const mk = (f, white) => row({ icon: white ? 'shield' : 'box', label: f.name || f.url,
			sub: `${(f.rules_count || 0).toLocaleString()} rules${f.last_updated ? ' · updated ' + new Date(f.last_updated).toLocaleDateString() : ''}`,
			right: toggle(f.enabled, async e => {
				const v = e.target.checked;
				try { await post('/control/filtering/set_url', { url: f.url, whitelist: white, data: { name: f.name, url: f.url, enabled: v } }); }
				catch (err) { e.target.checked = !v; toast(err.message, { bad: true }); }
			}, f.name), onClick: async () => {
				if (!await confirm(`Remove “${f.name}”?`, 'Its rules stop applying.', 'Remove', true)) return;
				await busy(null, async () => { await post('/control/filtering/remove_url', { url: f.url, whitelist: white }); lists(box); });
			}, chevron: false });
		const have = new Set((st.filters || []).concat(st.whitelist_filters || []).map(f => f.url));
		const upd = btn('Update lists now', () => busy(upd, async () => { const r = await post('/control/filtering/refresh', { whitelist: false }); toast(`Updated${r && r.updated != null ? ` (${r.updated} changed)` : ''}`); lists(box); }), 'small secondary');
		box.replaceChildren(
			h('h2', { class: 'section-title' }, h('span', 'Blocklists', explain('Blocklists',
				'Lists made by others that block ads, trackers or dangerous sites. AdGuard Home updates them by itself.',
				'More lists block more, but also break more sites, and use more memory. Two or three good lists are plenty.',
				{ rec: 'AdGuard DNS filter or HaGeZi Multi PRO, plus HaGeZi Threat Intelligence. Add the DoH/VPN bypass list if devices go around AdGuard Home.' })),
				h('a', { class: 'link', href: '#', onclick: e => { e.preventDefault(); addList(); } }, 'Add')),
			(st.filters || []).length ? group(...st.filters.map(f => mk(f, false))) : group(h('div', { class: 'empty' }, 'No blocklists.')),
			(st.whitelist_filters || []).length ? [h('h2', { class: 'section-title' }, h('span', 'Allowlists')), group(...st.whitelist_filters.map(f => mk(f, true)))] : null,
			hint('Tap a list to remove it. The switch turns it on or off.'),
			h('div', { class: 'btn-row' }, upd));
		function addList() {
			sheet('Add a blocklist', close => {
				const name = input({ placeholder: 'My list' }), url = input({ placeholder: 'https://…', inputmode: 'url' });
				const addOne = (n, u, b) => busy(b, async () => { await post('/control/filtering/add_url', { name: n, url: u, whitelist: false }); toast(`${n} added`); close(); lists(box); });
				const custom = btn('Add', () => { if (!/^https?:\/\/\S+$/.test(url.value.trim())) return toast('Enter the list\'s web address', { bad: true }); addOne(name.value.trim() || 'Custom list', url.value.trim(), custom); });
				return h('div',
					group(...LISTS.filter(l => !have.has(l.url)).map(l => row({ icon: 'plus', label: l.name, sub: l.sub,
						right: (() => { const b = btn('Add', () => addOne(l.name, l.url, b), 'small'); return b; })(), chevron: false }))),
					h('h2', { class: 'section-title' }, h('span', 'Another list')),
					group(field('Name', name), field('Address', url)),
					h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), custom));
			});
		}
	}

	/* ---------- Services (and their schedule) ---------- */
	async function servicesData() {
		let all = [];
		try { const r = await get('/control/blocked_services/all'); all = r.blocked_services || []; }
		catch (e) { const r = await get('/control/blocked_services/services'); all = (Array.isArray(r) ? r : []).map(id => ({ id, name: id })); }
		let cur;
		try { cur = await get('/control/blocked_services/get'); }
		catch (e) { cur = { ids: await get('/control/blocked_services/list').catch(() => []) }; }
		return { all, ids: (cur && cur.ids) || (Array.isArray(cur) ? cur : []), schedule: cur && cur.schedule };
	}
	function serviceGrid(all, ids) {
		const { h, toggle, input } = App;
		const sel = new Set(ids);
		const q = input({ type: 'search', placeholder: 'Search services' });
		const wrap = h('div', { class: 'group' });
		const draw = () => {
			const f = q.value.trim().toLowerCase();
			const items = all.filter(s => !f || s.name.toLowerCase().includes(f) || s.id.includes(f))
				.sort((a, b) => (sel.has(b.id) - sel.has(a.id)) || a.name.localeCompare(b.name));
			wrap.replaceChildren(...items.slice(0, f ? 200 : 60).map(s => App.row({
				icon: s.icon_svg ? h('img', { src: `data:image/svg+xml;base64,${s.icon_svg}`, alt: '', style: { width: '22px', height: '22px' } }) : 'globe',
				label: s.name, right: toggle(sel.has(s.id), e => { e.target.checked ? sel.add(s.id) : sel.delete(s.id); }, s.name) })),
				!f && items.length > 60 ? h('div', { class: 'empty' }, `Search to see all ${items.length} services`) : null);
		};
		q.oninput = draw; draw();
		return { node: [h('div', { class: 'group' }, h('label', { class: 'field' }, q)), wrap], get ids() { return [...sel]; } };
	}
	/* AdGuard Home's schedule lists, per day, when blocking is paused.
	 * Shown here as "allowed from … to …" on the chosen days. */
	function scheduleEditor(schedule) {
		const { h, toggle, input, field, row, group, hint } = App;
		const days = DAYS.filter(([k]) => schedule && schedule[k]);
		const first = days.length ? schedule[days[0][0]] : { start: 7 * 3600000, end: 22 * 3600000 };
		const on = toggle(days.length > 0, () => { box.hidden = !on.checked; }, 'Allow at certain times');
		const from = input({ type: 'time', value: ms2hm(first.start) }), to = input({ type: 'time', value: ms2hm(first.end) });
		const sel = new Set(days.length ? days.map(d => d[0]) : DAYS.map(d => d[0]));
		const chips = h('div', { class: 'chips' }, DAYS.map(([k, l]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': sel.has(k) ? 'true' : 'false',
			onclick: e => { sel.has(k) ? sel.delete(k) : sel.add(k); e.currentTarget.setAttribute('aria-pressed', sel.has(k) ? 'true' : 'false'); } }, l)));
		const box = h('div', field('Allowed from', from), field('Until', to), h('div', { style: { padding: '0 14px 12px' } }, chips));
		box.hidden = !on.checked;
		return {
			node: [group(row({ icon: 'clock', label: 'Allow only at certain times', sub: 'Outside these hours they stay blocked', right: on }), box),
				hint('Example: to block games and videos at night, allow them from 07:00 until 21:00. On days that aren\'t selected they are blocked all day.')],
			value() {
				const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';
				const s = { time_zone: tz };
				if (!on.checked) return s;
				const a = hm2ms(from.value), b = hm2ms(to.value);
				if (b <= a) throw new Error('“Until” must be later than “Allowed from” (the same day)');
				for (const k of sel) s[k] = { start: a, end: b };
				return s;
			}
		};
	}
	async function services(box) {
		const { h, btn, busy, explain, hint, toast } = App;
		const d = await servicesData();
		const grid = serviceGrid(d.all, d.ids);
		const sch = scheduleEditor(d.schedule);
		const save = btn('Save', () => busy(save, async () => {
			const ids = grid.ids;
			await put('/control/blocked_services/update', { ids, schedule: sch.value() }, '/control/blocked_services/set', ids);
			toast('Saved'); services(box);
		}));
		box.replaceChildren(
			h('h2', { class: 'section-title' }, h('span', 'Blocked services', explain('Blocked services',
				'Block whole apps and sites with one switch: social networks, games, video, shopping… AdGuard Home knows all their addresses.',
				'This applies to every device that uses the global settings. Set different services per device under Devices.',
				{ rec: 'Use the schedule to allow them only at certain hours, for example on children\'s devices.' }))),
			grid.node,
			h('h2', { class: 'section-title' }, h('span', 'Schedule')),
			sch.node,
			h('div', { class: 'actions' }, save));
	}

	/* ---------- Devices (AdGuard Home "clients") ---------- */
	async function devices(box) {
		const { h, row, group, btn, hint, explain } = App;
		const r = await get('/control/clients');
		const list = (r && r.clients) || [];
		box.replaceChildren(
			h('h2', { class: 'section-title' }, h('span', 'Devices with their own rules', explain('Per-device rules',
				'Give a device its own blocked services and schedule, safe search, or turn blocking off for it (for example a work laptop).',
				'Devices are recognised by their hardware address (MAC) and IP address. Give them a fixed address on the Devices page so this stays reliable.',
				{ rec: 'For a child\'s tablet: block games and social apps, allow them only after school, and turn on safe search.' })),
				h('a', { class: 'link', href: '#', onclick: e => { e.preventDefault(); openClient(null, () => devices(box)); } }, 'Add')),
			list.length ? group(...list.map(c => row({ icon: 'devices', label: c.name, sub: [(c.ids || []).join(', '), c.use_global_blocked_services === false ? `${(c.blocked_services || []).length} services blocked` : null, c.filtering_enabled === false ? 'blocking off' : null].filter(Boolean).join(' · '),
				onClick: () => openClient(c, () => devices(box)) }))) : group(h('div', { class: 'empty' }, 'No devices with their own rules.')),
			hint('Also on the Devices page: a device → AdGuard Home rules.'));
	}

	/* c: an AdGuard Home client, or null; dev: a Router Home device to start from */
	async function openClient(c, done, dev) {
		const { h, row, group, field, input, select, toggle, btn, busy, sheet, hint, note, toast, confirm, sectionTitle } = App;
		const sv = await servicesData();
		const devs = await Data.clients().catch(() => []);
		if (!c && dev) {
			const r = await get('/control/clients').catch(() => ({}));
			c = ((r && r.clients) || []).find(x => (x.ids || []).some(id => id.toLowerCase() === dev.mac || dev.ips.includes(id))) || null;
		}
		const isNew = !c;
		if (!c) {
			const [sb, pc] = await Promise.all([get('/control/safebrowsing/status').catch(() => null), get('/control/parental/status').catch(() => null)]);
			c = { name: dev ? dev.label : '', ids: dev ? [dev.mac, ...dev.ips.filter(i => !i.includes(':'))] : [], use_global_settings: true, filtering_enabled: true,
				safebrowsing_enabled: !!(sb && sb.enabled), parental_enabled: !!(pc && pc.enabled), use_global_blocked_services: true, blocked_services: [], safe_search: { enabled: false } };
		}
		sheet(isNew ? 'Own rules for a device' : c.name, close => {
			const name = input({ value: c.name, placeholder: 'Kids tablet' });
			const pick = select([['', 'Choose a device…'], ...devs.map(d => [d.mac, `${d.label}${d.ips[0] ? ' (' + d.ips[0] + ')' : ''}`])], '');
			const ids = input({ value: (c.ids || []).join(', '), placeholder: 'MAC or IP addresses' });
			pick.onchange = () => { const d = devs.find(x => x.mac === pick.value); if (d) { ids.value = [d.mac, ...d.ips.filter(i => !i.includes(':'))].join(', '); if (!name.value) name.value = d.label; } };
			const filt = toggle(c.filtering_enabled !== false, null, 'Blocking');
			const safe = toggle(!!(c.safe_search && c.safe_search.enabled) || c.safesearch_enabled === true, null, 'Safe search');
			const own = toggle(c.use_global_blocked_services === false, () => { svBox.hidden = !own.checked; }, 'Own blocked services');
			const grid = serviceGrid(sv.all, c.blocked_services || []);
			const sch = scheduleEditor(c.blocked_services_schedule);
			const svBox = h('div', grid.node, sectionTitle('Schedule'), sch.node); svBox.hidden = !own.checked;
			const save = btn('Save', () => busy(save, async () => {
				const n = name.value.trim(); if (!n) throw new Error('Enter a name');
				const idl = ids.value.split(/[\s,]+/).map(s => s.trim()).filter(Boolean); if (!idl.length) throw new Error('Choose the device');
				const data = Object.assign({}, c, { name: n, ids: idl, use_global_settings: false, filtering_enabled: filt.checked,
					safe_search: Object.assign({ bing: true, duckduckgo: true, google: true, pixabay: true, yandex: true, youtube: true }, c.safe_search || {}, { enabled: safe.checked }), safesearch_enabled: safe.checked,
					use_global_blocked_services: !own.checked, blocked_services: own.checked ? grid.ids : (c.blocked_services || []),
					blocked_services_schedule: own.checked ? sch.value() : c.blocked_services_schedule });
				data.parental_enabled = !!data.parental_enabled; data.safebrowsing_enabled = !!data.safebrowsing_enabled;
				if (isNew) await post('/control/clients/add', data);
				else await post('/control/clients/update', { name: c.name, data });
				toast('Saved'); close(); done && done();
			}));
			const del = !isNew && btn('Remove own rules', async () => {
				if (!await confirm(`Remove ${c.name}'s own rules?`, 'The device then follows the global settings.', 'Remove', true)) return;
				await busy(null, async () => { await post('/control/clients/delete', { name: c.name }); close(); done && done(); });
			}, 'secondary small');
			return h('div',
				group(field('Name', name), isNew && !dev ? field('Device', pick) : null, field('Addresses', ids)),
				group(
					row({ icon: 'shield', label: 'Blocking', sub: 'Turn off to block nothing for this device', right: filt }),
					row({ icon: 'lock', label: 'Safe search', sub: 'Google, Bing, YouTube… in safe mode', right: safe }),
					row({ icon: 'box', label: 'Own blocked services', sub: 'Instead of the global ones', right: own })),
				svBox,
				h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), save),
				del ? h('div', { class: 'btn-row', style: { justifyContent: 'center' } }, del) : null);
		});
	}

	/* ---------- Settings ---------- */
	async function settings(box, info) {
		const { h, row, group, field, select, toggle, btn, busy, hint, note, explain, toast, input, sheet, confirm, sectionTitle } = App;
		const [dns, rw, sb, pc, ss] = await Promise.all([get('/control/dns_info'), get('/control/rewrite/list').catch(() => []),
			get('/control/safebrowsing/status').catch(() => null), get('/control/parental/status').catch(() => null), get('/control/safesearch/status').catch(() => null)]);
		const ups = (dns.upstream_dns || []);
		const local = LOCAL_UP.every(l => ups.includes(l)) || ups.includes(LOCAL_UP[0]);
		const ta = h('textarea', { rows: 6, spellcheck: 'false', autocapitalize: 'off' });
		ta.value = ups.filter(u => !LOCAL_UP.includes(u)).join('\n');
		const loc = toggle(local, null, 'Local names from the router');
		const mode = select([['load_balance', 'Load balancing'], ['parallel', 'Ask all at once (fastest answer)'], ['fastest_addr', 'Fastest server address']], dns.upstream_mode || 'load_balance');
		const preset = h('div', { class: 'chips' }, UPSTREAMS.map(([l, u]) => h('button', { type: 'button', class: 'chip', onclick: () => {
			const lines = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
			if (!lines.includes(u)) lines.push(u); ta.value = lines.join('\n');
		} }, '+ ' + l)));
		const lines = () => ta.value.split('\n').map(s => s.trim()).filter(Boolean).concat(loc.checked ? LOCAL_UP : []);
		const test = btn('Test', () => busy(test, async () => {
			const r = await post('/control/test_upstream_dns', { upstream_dns: lines(), bootstrap_dns: dns.bootstrap_dns, fallback_dns: dns.fallback_dns });
			const bad = Object.entries(r || {}).filter(([, v]) => v !== 'OK');
			bad.length ? toast(`Not working: ${bad.map(([k]) => k).join(', ')}`, { bad: true }) : toast('All servers answer');
		}), 'secondary');
		const save = btn('Save', () => busy(save, async () => {
			if (!lines().filter(l => !l.startsWith('[')).length) throw new Error('Add at least one server');
			await post('/control/dns_config', { upstream_dns: lines(), upstream_mode: mode.value });
			toast('Saved'); settings(box, info);
		}));
		const tog = (st, path, label) => toggle(st && st.enabled, async e => {
			const v = e.target.checked;
			try {
				if (path === 'safesearch') await put('/control/safesearch/settings', Object.assign({}, st || {}, { enabled: v }), v ? '/control/safesearch/enable' : '/control/safesearch/disable', {});
				else await post(`/control/${path}/${v ? 'enable' : 'disable'}`);
				toast('Saved');
			} catch (err) { e.target.checked = !v; toast(err.message, { bad: true }); }
		}, label);
		const rwRows = (Array.isArray(rw) ? rw : []).map(x => row({ icon: 'link', label: x.domain, sub: `→ ${x.answer}`, onClick: async () => {
			if (!await confirm(`Remove ${x.domain}?`, 'Devices then get its real address again.', 'Remove', true)) return;
			await busy(null, async () => { await post('/control/rewrite/delete', { domain: x.domain, answer: x.answer }); settings(box, info); });
		} }));
		const addRw = () => sheet('Add a DNS rewrite', close => {
			const d = input({ placeholder: 'nas.home or *.example.com' }), a = input({ placeholder: '192.168.1.10 or another name' });
			const b = btn('Add', () => busy(b, async () => {
				if (!d.value.trim() || !a.value.trim()) throw new Error('Fill in both');
				await post('/control/rewrite/add', { domain: d.value.trim().toLowerCase(), answer: a.value.trim() }); close(); settings(box, info);
			}));
			return h('div', group(field('Name', d), field('Answer with', a)),
				hint('Devices that look up the name get this address (or the other name) instead. Useful to reach your own servers by name.'),
				h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), b));
		});
		box.replaceChildren(
			h('h2', { class: 'section-title' }, h('span', 'Upstream DNS', explain('Upstream DNS',
				'AdGuard Home asks these servers for everything it doesn\'t block. https:// addresses are encrypted (DNS over HTTPS), so your provider can\'t see the sites you visit.',
				'“Local names from the router” sends .lan names and reverse lookups to dnsmasq (port 54), so device names keep working.',
				'Encrypted servers need the router\'s clock to be right.',
				{ rec: 'Two or three encrypted servers, for example Quad9 and Cloudflare, with load balancing; keep local names on.' }))),
			group(h('label', { class: 'field' }, h('span', 'One server per line'), ta), h('div', { style: { padding: '0 14px 12px' } }, preset),
				field('How to use them', mode),
				row({ icon: 'home', label: 'Local names from the router', sub: '.lan names and device names (dnsmasq on port 54)', right: loc })),
			h('div', { class: 'actions' }, test, save),
			h('h2', { class: 'section-title' }, h('span', 'DNS rewrites'), h('a', { class: 'link', href: '#', onclick: e => { e.preventDefault(); addRw(); } }, 'Add')),
			rwRows.length ? group(...rwRows) : group(h('div', { class: 'empty' }, 'No rewrites.')),
			h('h2', { class: 'section-title' }, h('span', 'Protection', explain('Protection',
				'Safe browsing: blocks known phishing and malware sites (checked with AdGuard\'s service, privately).',
				'Parental control: blocks adult sites.',
				'Safe search: forces safe mode on Google, Bing, DuckDuckGo, YouTube and others.',
				{ rec: 'Safe browsing on. Parental control and safe search per device (Devices tab) if only children need them.' }))),
			group(
				sb ? row({ icon: 'shield', label: 'Safe browsing', sub: 'Phishing and malware sites', right: tog(sb, 'safebrowsing', 'Safe browsing') }) : null,
				pc ? row({ icon: 'lock', label: 'Parental control', sub: 'Adult sites, for every device', right: tog(pc, 'parental', 'Parental control') }) : null,
				ss ? row({ icon: 'globe', label: 'Safe search', sub: 'For every device', right: tog(ss, 'safesearch', 'Safe search') }) : null));
	}

	return { render, openClient, api };
})();
