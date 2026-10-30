/* Router Home: Proton VPN (works with the protonvpn-wireguard package).
 * Everything goes through its rpcd object 'protonvpn'; sign-in uses the
 * same in-browser SRP code that luci-app-protonvpn installs, so the
 * Proton password never leaves this page. */
'use strict';

const Proton = (() => {
	const SRP_BASE = '/luci-static/resources/view/protonvpn/';
	const LUCI_PAGE = '/cgi-bin/luci/admin/vpn/protonvpn';
	const pv = (m, p) => App.rpc('protonvpn', m, p || {});
	const pvq = (m, p) => App.call('protonvpn', m, p || {});

	let locCache = null;
	const BIG_COUNTRY = 400;   /* servers; above this, a whole-country pick crashes rpcd (see openLocation) */   /* locations tree, loaded once per page view */

	function loadScript(src) {
		return new Promise((ok, bad) => {
			const s = document.createElement('script');
			s.src = src; s.onload = ok; s.onerror = () => bad(new Error('Could not load ' + src));
			document.head.appendChild(s);
		});
	}
	async function srp() {
		if (window.ProtonSRP) return window.ProtonSRP;
		await loadScript(SRP_BASE + 'vendor/bcrypt.js');
		await loadScript(SRP_BASE + 'srp.js');
		if (!window.ProtonSRP) throw new Error('The Proton sign-in code did not load');
		return window.ProtonSRP;
	}

	const STATE = {
		connected: ['Connected', 'on', 'var(--online)'],
		connecting: ['Connecting…', 'warn', null],
		degraded: ['Connection problem', 'warn', null],
		disconnected: ['Not connected', 'off', null],
		disabled: ['Off', '', null],
		not_configured: ['Not set up yet', '', null]
	};
	const stateOf = s => (s && s.configured && s.enabled === false) ? 'disabled' : ((s && s.state) || 'not_configured');

	function flag(cc) {
		if (!cc || cc.length !== 2) return '';
		cc = cc.toUpperCase() === 'UK' ? 'GB' : cc.toUpperCase();
		return String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65)) + ' ';
	}
	function countryName(code) {
		const c = (locCache && locCache.countries || []).find(x => x.code === String(code || '').toLowerCase());
		if (c) return c.display_name || c.name;
		try { return new Intl.DisplayNames(undefined, { type: 'region' }).of(String(code).toUpperCase()); } catch (e) { return String(code || '').toUpperCase(); }
	}
	function cityName(code) {
		for (const c of (locCache && locCache.countries) || [])
			for (const ci of c.cities || []) if (ci.code === code) return ci.name;
		/* 'us-new-york' -> 'New York' without loading the big server list */
		return String(code || '').split('-').slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || code;
	}
	function locLabel(code) {
		if (!code) return '';
		return code.includes('-') ? `${flag(code.split('-')[0])}${cityName(code)}, ${countryName(code.split('-')[0])}` : flag(code) + countryName(code);
	}
	function whereText(s, cfg) {
		const loc = s && s.location || {};
		if (s && s.gateway && (loc.country || loc.city))
			return `${flag(loc.country)}${loc.city ? cityName(loc.city) + ', ' : ''}${countryName(loc.country)} · ${s.gateway}`;
		const set = [].concat((cfg && cfg.locations) || []);
		if (set.length) return set.map(locLabel).join(', ');
		if (cfg && cfg.country_code) return locLabel(cfg.city_code || cfg.country_code);
		return 'Fastest server';
	}

	async function waitApply() {
		const until = Date.now() + 240000;
		await App.sleep(1500);
		while (Date.now() < until) {
			const st = await pvq('apply_status');
			if (st && (st.state === 'done' || st.state === 'failed')) return st.result || { error: st.error || 'The connection attempt did not report a result' };
			if (!st || st.state !== 'running') return { error: 'The connection attempt stopped' };
			await App.sleep(2000);
		}
		return { error: 'Still connecting after 4 minutes. Check the log.' };
	}
	/* start (or restart) the tunnel and wait for the real handshake */
	async function connect(instance) {
		App.toast('Connecting… this checks a real connection to the server and can take up to a minute.', { sticky: true });
		const r = await App.rpc('protonvpn', 'apply_start', { instance }, { raw: true });
		if (r && r.error) {
			const st = await pvq('apply_status');
			if (!st || st.state !== 'running') throw new Error(r.error);
		}
		const res = await waitApply();
		if (res.state === 'success') App.toast(`Connected through ${res.gateway || 'Proton'}`);
		else if (res.state === 'partial_failure') App.toast(`The server ${res.gateway || ''} isn't answering. Try “Change server” or another location.`, { bad: true });
		else App.toast(res.error || 'The VPN did not come up', { bad: true });
		return res;
	}

	/* ---------- sign in ---------- */
	function openSignIn(step, onDone) {
		const { h, field, input, password, btn, busy, sheet, hint, note } = App;
		let user = '';
		sheet('Sign in to Proton', close => {
			const body = h('div');
			const draw = which => {
				if (which === 'totp') {
					const code = input({ type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 8, placeholder: '123456' });
					const go = btn('Continue', () => busy(go, async () => {
						if (!/^[0-9]{6,8}$/.test(code.value.trim())) throw new Error('Enter the 6-digit code from your authenticator app');
						await pv('set_totp', { code: code.value.trim() });
						App.toast('Signed in to Proton'); close(); onDone && onDone(true);
					}));
					code.onkeydown = e => { if (e.key === 'Enter') go.click(); };
					body.replaceChildren(h('div', { class: 'group' }, field('Two-factor code', code)), hint('Open your authenticator app and enter the code for Proton.'),
						h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), go));
					setTimeout(() => code.focus(), 50);
					return;
				}
				const u = input({ type: 'email', autocomplete: 'username', placeholder: 'you@proton.me', value: user });
				const [p, peek] = password('', { autocomplete: 'current-password' });
				const go = btn('Sign in', () => busy(go, async () => {
					user = u.value.trim();
					if (!user || !p.value) throw new Error('Enter your Proton username and password');
					const S = await srp();
					const params = await pv('auth_info', { username: user });
					const proofs = await S.prepareLogin({ version: params.version, username: user, password: p.value,
						saltBase64: params.salt, modulusBase64: params.modulus, serverEphemeralBase64: params.server_ephemeral });
					p.value = '';
					const res = await pv('auth_finish', { username: user, srp_session: params.srp_session,
						client_ephemeral: proofs.clientEphemeral, client_proof: proofs.clientProof });
					if (res.server_proof && !S.verifyServerProof(proofs.expectedServerProof, res.server_proof))
						throw new Error('Proton\'s answer could not be verified, so sign-in was stopped');
					if (res.twofa) return draw('totp');
					App.toast('Signed in to Proton'); close(); onDone && onDone(true);
				}));
				p.onkeydown = e => { if (e.key === 'Enter') go.click(); };
				body.replaceChildren(
					h('div', { class: 'group' }, field('Proton username or email', u), field('Password', [p, peek])),
					hint('Your password is checked here in the browser and is never stored on the router. The router keeps only a sign-in token for about 30 days.'),
					h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), go));
				setTimeout(() => (user ? p : u).focus(), 50);
			};
			draw(step);
			return body;
		});
	}

	/* ---------- location picker ---------- */
	async function ensureLocations(force) {
		if (locCache && locCache.available && !force) return locCache;
		let l = await pvq('locations');
		if (!l || !l.available || force) {
			await App.rpc('protonvpn', 'refresh_locations', {}, { raw: true });
			const until = Date.now() + 90000;
			while (Date.now() < until) {
				await App.sleep(2500);
				const st = await pvq('refresh_status');
				if (!st || st.state !== 'running') break;
			}
			l = await pvq('locations');
		}
		locCache = l;
		return l;
	}

	function openLocation(inst, cfg, onDone) {
		const { h, row, group, btn, busy, sheet, hint, note, input, uci } = App;
		const hop = (cfg && cfg.hop_mode) || 'standard';
		const countKey = hop + '_count', loadKey = hop + '_load';
		sheet('Choose location', close => {
			const body = h('div', h('div', { class: 'skeleton' }));
			const search = h('input', { class: 'search', type: 'search', placeholder: 'Search country or city', 'aria-label': 'Search locations', style: { marginTop: '14px' } });
			const list = h('div');
			const choose = code => busy(null, async () => {
				close();
				await uci.set('protonvpn', inst, { locations: code ? [code] : [] });
				await uci.unset('protonvpn', inst, ['country_code', 'city_code', 'fixed_server']).catch(() => {});
				if (!code) await uci.unset('protonvpn', inst, ['locations']).catch(() => {});
				await App.rpc('uci', 'commit', { config: 'protonvpn' });
				await connect(inst);
				onDone && onDone();
			});
			let open = null;
			const top = group(row({ icon: 'globe', label: 'Fastest server', sub: 'Proton picks the least busy server anywhere', onClick: () => choose('') }));
			const cnt = (n, load) => `${n} server${n === 1 ? '' : 's'}${load != null ? ` · ${Math.round(load)}% busy` : ''}`;
			const flagIcon = cc => h('span', { style: { fontSize: '22px', lineHeight: 1 } }, flag(cc).trim() || '🌐');
			const draw = () => {
				const all = (locCache.countries || []).filter(c => (c[countKey] || 0) > 0);
				const citiesOf = c => (c.cities || []).filter(ci => (ci[countKey] || 0) > 0).sort((a, b) => a.name.localeCompare(b.name));
				const nameOf = c => c.display_name || c.name;
				if (open) {
					/* one country: anywhere in it, or a city */
					const c = all.find(x => x.code === open);
					search.hidden = true; top.hidden = true;
					/* protonvpn-wireguard 0.7.6: asking for the server list of a very large
					 * country (e.g. the whole US) crashes rpcd, and LuCI's Proton page
					 * asks for it on every load. Steer people to a city there. */
					const big = (c[countKey] || 0) > BIG_COUNTRY;
					const anywhere = row({ icon: flagIcon(c.code), label: `Anywhere in ${nameOf(c)}`,
						sub: big ? 'Not recommended: too many servers for LuCI\'s Proton page, which then signs everyone out' : 'Proton picks the least busy city',
						onClick: async () => {
							if (big && !await App.confirm(`Use all of ${nameOf(c)}?`, `${nameOf(c)} has ${c[countKey]} servers. With a list that big, opening the Proton page in LuCI crashes the router's login service and signs you out of LuCI and Router Home. Picking a city avoids this.`, 'Use anyway', true)) return;
							choose(c.code);
						} });
					const cityRows = citiesOf(c).map(ci => row({ icon: 'globe', label: ci.name, sub: cnt(ci[countKey], ci[loadKey]), onClick: () => choose(ci.code) }));
					list.replaceChildren(
						h('a', { class: 'link', href: '#', style: { display: 'inline-block', margin: '4px 0 10px' }, onclick: e => { e.preventDefault(); open = null; draw(); } }, '‹ All countries'),
						big ? [hint(`Pick a city: ${nameOf(c)} has too many servers to use as a whole.`), group(...cityRows), group(anywhere)]
							: group(anywhere, ...cityRows));
					return;
				}
				search.hidden = false; top.hidden = false;
				const q = search.value.trim().toLowerCase();
				const rows = [];
				for (const c of all.sort((a, b) => nameOf(a).localeCompare(nameOf(b)))) {
					const cities = citiesOf(c);
					const cMatch = !q || nameOf(c).toLowerCase().includes(q) || c.code === q;
					const cityHits = q ? cities.filter(ci => ci.name.toLowerCase().includes(q)) : [];
					if (!cMatch && !cityHits.length) continue;
					if (cMatch) rows.push(row({ icon: flagIcon(c.code), label: nameOf(c),
						sub: cnt(c[countKey], c[loadKey]) + (cities.length > 1 ? ` · ${cities.length} cities` : ''),
						onClick: () => { if (cities.length > 1) { open = c.code; draw(); } else choose(cities.length === 1 && (c[countKey] || 0) > BIG_COUNTRY ? cities[0].code : c.code); } }));
					for (const ci of cityHits) rows.push(row({ icon: flagIcon(c.code), label: ci.name, sub: `${nameOf(c)} · ${cnt(ci[countKey], ci[loadKey])}`, onClick: () => choose(ci.code) }));
				}
				list.replaceChildren(rows.length ? group(...rows) : h('div', { class: 'empty' }, 'No location matches.'));
			};
			search.oninput = draw;
			ensureLocations().then(l => {
				if (!l || !l.available) {
					body.replaceChildren(note('The server list could not be downloaded. Check that the router is online and you are signed in, then try again.', 'warn'),
						h('div', { class: 'actions' }, btn('Close', close, 'secondary')));
					return;
				}
				draw();
				body.replaceChildren(top, search, list,
					hint(hop === 'standard' ? 'Busy % is how loaded the servers are. Lower is usually faster. Countries with several cities let you pick one.' : `Showing ${hop === 'tor' ? 'Tor' : 'Secure Core'} servers only (change this in VPN settings).`));
			});
			return body;
		});
	}

	/* ---------- settings ---------- */
	function openSettings(inst, cfg, onDone) {
		const { h, row, group, seg, toggle, select, btn, busy, sheet, hint, note, sectionTitle, uci } = App;
		const auto = cfg.auto_routing !== '0';
		const ks = toggle(cfg.killswitch === '1', null, 'Kill switch');
		const dns = toggle(cfg.vpn_dns === 'standard', null, 'Proton DNS');
		let hop = cfg.hop_mode || 'standard';
		const hopSeg = seg([['standard', 'Standard'], ['secure_core', 'Secure Core'], ['tor', 'Tor']], hop, v => { hop = v; hopHint.textContent = HOP_HINT[v]; });
		const HOP_HINT = {
			standard: 'Normal servers, fastest.',
			secure_core: 'Traffic goes through a hardened server in Switzerland, Iceland or Sweden first. Slower. Needs a paid plan.',
			tor: 'Traffic exits through the Tor network. Much slower. Needs a paid plan.'
		};
		const hopHint = hint(HOP_HINT[hop]);
		const rot = toggle(cfg.rotation_enabled === '1', () => { rotWhen.disabled = !rot.checked; }, 'Change server automatically');
		const rotWhen = select([['60', 'Every hour'], ['180', 'Every 3 hours'], ['360', 'Every 6 hours'], ['720', 'Every 12 hours'], ['1440', 'Once a day']],
			['60', '180', '360', '720', '1440'].includes(cfg.rotation_interval) ? cfg.rotation_interval : '360', { 'aria-label': 'How often' });
		rotWhen.disabled = !rot.checked;
		const pinned = !!cfg.fixed_server;
		sheet('Proton VPN settings', close => {
			const save = btn('Save', () => busy(save, async () => {
				const v = { killswitch: ks.checked ? '1' : '0', vpn_dns: dns.checked ? 'standard' : 'off', hop_mode: hop,
					rotation_enabled: rot.checked ? '1' : '0', rotation_mode: 'interval', rotation_interval: rotWhen.value };
				await uci.set('protonvpn', inst, v);
				await App.rpc('uci', 'commit', { config: 'protonvpn' });
				close();
				if (cfg.enabled === '1') await connect(inst); else App.toast('Saved');
				onDone && onDone();
			}));
			return h('div',
				sectionTitle(['Protection', App.explain('Protection',
					'Kill switch: if the VPN connection drops, home devices lose internet instead of going online without the VPN. Your real address is never shown, but you notice outages.',
					'Proton DNS: website names are looked up through Proton while connected, so your internet provider can\'t see them. If you use AdGuard Home, Proton DNS bypasses it.',
					{ rec: 'Kill switch on if hiding your address matters; Proton DNS on unless you rely on AdGuard Home blocking.' })]),
				group(
					row({ icon: 'lock', label: 'Kill switch', sub: auto ? 'Block internet for home devices if the VPN drops' : 'Only works when all home traffic goes through the VPN', right: ks }),
					row({ icon: 'dns', label: 'Use Proton DNS', sub: 'Look up websites through Proton while connected', right: dns })),
				sectionTitle('Server type'), hopSeg, hopHint,
				sectionTitle('Server changes'),
				group(
					row({ icon: 'refresh', label: 'Change server automatically', sub: pinned ? 'Off while a specific server is pinned (set in advanced settings)' : 'Picks a new server in the same location', right: rot }),
					row({ icon: 'clock', label: 'How often', right: rotWhen })),
				!auto ? note('This VPN only covers some networks (set in advanced settings). Router Home leaves that routing as it is.') : null,
				hint('Saving reconnects the VPN if it is on.'),
				h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), save));
		});
	}

	/* ---------- one tunnel ---------- */
	function openInstance(s, cfg, account, reload) {
		const { h, row, group, btn, busy, sheet, hint, note, sectionTitle, fmt } = App;
		const inst = s.instance;
		const st = stateOf(s);
		const [label, dot] = STATE[st] || [st, ''];
		sheet(inst === 'main' ? 'Proton VPN' : 'Proton VPN · ' + inst, close => {
			const ipVal = h('span', '—');
			const done = () => { close(); reload(); };
			const kids = [
				group(
					row({ icon: 'vpn', iconColor: st === 'connected' ? 'var(--online)' : null, label, sub: whereText(s, cfg), right: h('span', { class: 'dot ' + dot }) }),
					s.latest_handshake_seconds != null && st !== 'disabled' ? row({ icon: 'clock', label: 'Server contact', value: s.latest_handshake_seconds < 5 ? 'just now' : fmt.duration(s.latest_handshake_seconds) + ' ago' }) : null,
					st === 'connected' ? row({ icon: 'globe', label: 'VPN address', value: ipVal,
						right: btn('Check', function () { const b = this; busy(b, async () => { ipVal.textContent = 'checking…'; const r = await pv('external_ip', { instance: inst }); ipVal.textContent = r.ip; }); }, 'secondary small') }) : null,
					s.rotation && s.rotation.enabled && s.rotation.next_run && !s.fixed ? row({ icon: 'refresh', label: 'Next server change', value: new Date(s.rotation.next_run * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) }) : null,
					s.certificate && s.certificate.present ? row({ icon: 'key', label: 'Device certificate', value: s.certificate.expired ? 'expired' : `${s.certificate.days_left} days left` }) : null)
			];
			if (s.action_required === 'renew_certificate') {
				const rn = btn('Renew certificate', () => busy(rn, async () => { await pv('certificate_renew', { instance: inst }); App.toast('Certificate renewed'); await connect(inst); done(); }), 'small');
				kids.push(note('This router\'s Proton certificate has expired, so the VPN cannot connect.', 'warn'), h('div', { class: 'btn-row' }, rn));
			}
			kids.push(sectionTitle('Location'), group(
				row({ icon: 'globe', label: 'Location', sub: [].concat(cfg.locations || []).length ? [].concat(cfg.locations).map(locLabel).join(', ') : (cfg.fixed_server ? 'Pinned server ' + cfg.fixed_server : 'Fastest server'),
					onClick: () => { close(); openLocation(inst, cfg, reload); } }),
				row({ icon: 'edit', label: 'VPN settings', sub: [cfg.killswitch === '1' ? 'Kill switch on' : 'Kill switch off', cfg.hop_mode === 'secure_core' ? 'Secure Core' : cfg.hop_mode === 'tor' ? 'Tor' : null, cfg.rotation_enabled === '1' ? 'changes server automatically' : null].filter(Boolean).join(' · '),
					onClick: () => { close(); openSettings(inst, cfg, reload); } })));
			const actions = [];
			if (st === 'disabled' || st === 'disconnected' || st === 'not_configured') {
				const on = btn('Connect', () => busy(on, async () => { await connect(inst); done(); }));
				actions.push(on);
			} else {
				if (!s.fixed) {
					const rot = btn('Change server', () => busy(rot, async () => {
						App.toast('Finding another server…', { sticky: true });
						const r = await App.rpc('protonvpn', 'rotate_now', { instance: inst }, { raw: true });
						if (r.error) App.toast(r.error, { bad: true });
						else if (r.skipped) App.toast(r.reason || 'No other server to switch to');
						else App.toast(r.server ? `Now using ${r.server}` : 'Server changed');
						done();
					}), 'secondary');
					actions.push(rot);
				}
				const off = btn('Disconnect', () => busy(off, async () => {
					await pv('disconnect', { instance: inst });
					App.toast('VPN off. Your devices use the normal internet again.');
					done();
				}), 'secondary');
				actions.push(off);
			}
			kids.push(h('div', { class: 'actions' }, actions));
			kids.push(hint(cfg.auto_routing !== '0' ? 'While connected, every device at home goes through Proton.' : 'This VPN only covers the networks chosen in advanced settings.'));
			return h('div', kids);
		});
	}

	/* ---------- the section on the VPN page ---------- */
	async function render(box, reload) {
		const { h, row, group, btn, busy, note, hint, info, uci } = App;
		if (!info.protonvpn) { box.replaceChildren(); box.hidden = true; return; }
		box.hidden = false;
		const [sess, all, conf] = await Promise.all([pvq('session_state'), pvq('instances'), uci.load('protonvpn')]);
		const kids = [];
		const state = sess && sess.state;
		if (!sess) {
			box.replaceChildren(note('Proton VPN is installed but not answering. Restart rpcd (System → Restart) and try again.', 'warn'));
			return;
		}
		if (state === 'no_session' || state === 'expired' || state === 'needs_2fa') {
			const canSrp = info.protonvpn_login;
			kids.push(group(row({ icon: 'vpn', label: state === 'expired' ? 'Sign in again' : state === 'needs_2fa' ? 'Two-factor code needed' : 'Not signed in',
				sub: state === 'expired' ? 'Your Proton sign-in ended after 30 days' : 'Sign in with your Proton account to use the VPN' })));
			if (canSrp) {
				const si = btn(state === 'needs_2fa' ? 'Enter code' : 'Sign in', () => openSignIn(state === 'needs_2fa' ? 'totp' : 'credentials', () => { locCache = null; afterSignIn(); }), 'small');
				kids.push(h('div', { class: 'btn-row' }, si));
			} else kids.push(note('Install luci-app-protonvpn to sign in. It provides the secure sign-in code this page uses.', 'warn'));
			box.replaceChildren(...kids);
			return;
		}
		const insts = (all && all.instances) || [];
		let account = null;
		function draw() {
			const rows = insts.map(s => {
				const cfg = conf[s.instance] || {};
				const st = stateOf(s);
				const [label, dot] = STATE[st] || [st, ''];
				return row({ icon: 'vpn', iconColor: st === 'connected' ? 'var(--online)' : null,
					label: insts.length > 1 ? `${label} · ${s.instance}` : label, sub: whereText(s, cfg),
					right: h('span', { class: 'dot ' + dot }), onClick: () => openInstance(s, cfg, account, reload) });
			});
			const k = [group(...rows)];
			for (const s of insts) {
				const r = s.routing || {};
				if (stateOf(s) === 'disabled' || stateOf(s) === 'not_configured') continue;
				if (r.mode === 'none') {
					const fix = btn('Send all home devices through the VPN', () => busy(fix, async () => {
						await uci.set('protonvpn', s.instance, { auto_routing: '1' });
						await App.rpc('uci', 'commit', { config: 'protonvpn' });
						await connect(s.instance); reload();
					}), 'small');
					k.push(note(h('div', h('p', { style: { margin: '0 0 8px' } }, 'The VPN is connected, but your home devices are not using it: traffic routing is off for this tunnel, so only the router itself can use it.'), fix), 'warn'));
				} else if (r.mode === 'manual')
					k.push(hint('Traffic through this VPN follows routes you set up yourself, so Router Home leaves routing alone.'));
			}
			const main = insts[0];
			if (main) {
				const st = stateOf(main);
				const cfg = conf[main.instance] || {};
				if (st === 'disabled' || st === 'disconnected' || st === 'not_configured') {
					const on = btn('Connect', () => busy(on, async () => { await connect(main.instance); reload(); }), 'small');
					const loc = btn('Choose location', () => openLocation(main.instance, cfg, reload), 'secondary small');
					k.push(h('div', { class: 'btn-row' }, on, loc));
				}
			}
			const acct = h('div');
			k.push(acct);
			if (account) acct.replaceChildren(hint(`${/proton/i.test(account.plan || '') ? '' : 'Proton '}${account.plan || ''}${account.max_connect ? ` · ${account.devices_used != null ? account.devices_used + ' of ' : 'up to '}${account.max_connect} devices in use` : ''}.`));
			const out = h('a', { class: 'link', href: '#', onclick: e => { e.preventDefault(); signOut(); } }, 'Sign out of Proton');
			k.push(h('p', { class: 'hint' }, out, info.luci ? ' · ' : null, info.luci ? h('a', { class: 'link', href: LUCI_PAGE }, 'Advanced settings') : null));
			box.replaceChildren(...k);
		}
		draw();
		if (!render.acct || Date.now() - render.acct.at > 300000)
			pvq('account').then(a => { render.acct = { at: Date.now(), a: a && !a.error ? a : null }; account = render.acct.a; draw(); });
		else account = render.acct.a, draw();

		async function signOut() {
			if (!await App.confirm('Sign out of Proton?', 'The VPN turns off and home devices use the normal internet until you sign in again.', 'Sign out', true)) return;
			await busy(null, async () => { await pv('logout'); render.acct = null; App.toast('Signed out of Proton'); reload(); });
		}
		async function afterSignIn() {
			reload();
			App.toast('Getting the server list…', { sticky: true });
			const l = await ensureLocations();
			App.toast(l && l.available ? 'Ready. Choose a location or tap Connect.' : 'Signed in, but the server list could not be downloaded yet.', l && l.available ? null : { bad: true });
			reload();
		}
	}

	return { render, connect, managedInterfaces: conf => App.uci.sections(conf, 'instance').map(s => s.interface || 'protonvpn') };
})();
