/* Router Home: WiFi page */
'use strict';

const WifiShare = (() => {
	const esc = s => String(s || '').replace(/([\\;,:"])/g, '\\$1');
	function code(cfg) {
		const enc = cfg.encryption || 'none';
		if (enc === 'none' || enc === 'owe') return `WIFI:T:nopass;S:${esc(cfg.ssid)};${cfg.hidden === '1' ? 'H:true;' : ''};`;
		const t = enc.startsWith('sae') && !enc.includes('mixed') ? 'SAE' : 'WPA';
		return `WIFI:T:${t};S:${esc(cfg.ssid)};P:${esc(cfg.key)};${cfg.hidden === '1' ? 'H:true;' : ''};`;
	}
	function show(cfg) {
		const { h, sheet, qrSvg, hint } = App;
		sheet('Share “' + cfg.ssid + '”', h('div',
			qrSvg(code(cfg)),
			h('dl', { class: 'kv' }, h('dt', 'Network'), h('dd', cfg.ssid), h('dt', 'Password'), h('dd', { class: 'mono' }, cfg.key || 'No password')),
			hint('Point a phone camera at the code to join without typing the password.')));
	}
	/* nets: wifi interfaces; prefer one that isn't 6 GHz-only WPA3 so older phones can join */
	function pick(nets) {
		const by = {};
		for (const i of nets) (by[i.config.ssid] = by[i.config.ssid] || []).push(i);
		const names = Object.keys(by);
		const best = n => (by[n].find(i => i.band !== '6g') || by[n][0]).config;
		if (names.length === 1) return show(best(names[0]));
		const { h, sheet, row, group } = App;
		const s = sheet('Share which network?', close => group(...names.map(n => row({ icon: 'wifi', label: n, onClick: () => { close(); show(best(n)); } }))));
	}
	return { show, pick, code };
})();

const WIDTHS = { '2g': [20, 40], '5g': [20, 40, 80, 160], '6g': [20, 40, 80, 160, 320] };
const DFS_5G = c => c >= 52 && c <= 144;
const RECOMMENDED = {
	'2g': { channel: 'auto', width: 20, why: 'Auto channel at 20 MHz. Wider channels on 2.4 GHz collide with neighbours and usually end up slower.' },
	'5g': { channel: '36', width: 80, why: 'Channel 36 at 80 MHz: fast, no radar wait, works with every device. Pick 160 MHz if you have no close neighbours.' },
	'6g': { channel: '37', width: 160, why: 'Channel 37 at 160 MHz. Most phones and laptops top out at 160 MHz on 6 GHz, so 320 MHz rarely adds speed.' }
};
const SECURITY = [
	['sae-mixed', 'WPA2/WPA3 (works with everything)'],
	['sae', 'WPA3 only (newest devices)'],
	['psk2+ccmp', 'WPA2 only (older devices)'],
	['none', 'No password']
];

App.register('wifi', {
	async render(page) {
		const { h, row, group, sectionTitle, hint, icon, every, btn, uci } = App;
		const nets = h('div', h('div', { class: 'skeleton' }));
		const radiosBox = h('div', h('div', { class: 'skeleton' }));
		page.append(
			h('h1', { class: 'page-title' }, 'Wireless'),
			sectionTitle('Networks', h('a', { class: 'link', href: '#', onclick: e => { e.preventDefault(); openAddNetwork(state, load); } }, 'Add network')),
			nets,
			sectionTitle('Radios'),
			radiosBox,
			hint('Each radio broadcasts on one band. Tap a radio to change its channel, width or power.')
		);

		const state = {};
		async function load() {
			const [radios, cfg] = await Promise.all([Data.wireless(), uci.load('wireless')]);
			Object.assign(state, { radios, cfg });
			const bandOfRadio = {}; for (const r of radios) bandOfRadio[r.name] = r;
			const counts = {};
			await Promise.all(radios.flatMap(r => r.ifaces.filter(i => i.ifname).map(async i => {
				const a = await App.call('iwinfo', 'assoclist', { device: i.ifname });
				counts[i.section] = ((a && a.results) || []).length;
			})));

			/* networks grouped by name */
			const groups = {};
			for (const s of uci.sections(cfg, 'wifi-iface')) {
				if ((s.mode || 'ap') !== 'ap') continue;
				const key = s.ssid || s['.name'];
				(groups[key] = groups[key] || []).push(s);
			}
			const netRows = Object.keys(groups).map(ssid => {
				const secs = groups[ssid];
				const on = secs.filter(s => s.disabled !== '1' && cfg[s.device] && cfg[s.device].disabled !== '1');
				const bands = on.map(s => (bandOfRadio[s.device] || {}).bandName).filter(Boolean);
				const users = secs.reduce((n, s) => n + (counts[s['.name']] || 0), 0);
				return row({
					icon: 'wifi', iconColor: on.length ? 'var(--online)' : null,
					label: ssid, sub: on.length ? `${bands.join(' · ')} · ${users} connected` : 'Off',
					right: secs.some(s => s.network && [].concat(s.network).join(' ').includes('guest')) ? h('span', { class: 'badge' }, 'Guest') : null,
					onClick: () => openNetwork(ssid, secs, state, load)
				});
			});
			nets.replaceChildren(netRows.length ? group(...netRows) : h('div', { class: 'group' }, h('div', { class: 'empty' }, 'No WiFi networks yet. Use “Add network”.')));

			radiosBox.replaceChildren(group(...radios.map(r => {
				const c = cfg[r.name] || {};
				const iw = r.iwinfo || {};
				const width = iw.width || (c.htmode || '').replace(/\D/g, '');
				const sub = c.disabled === '1' ? 'Turned off' :
					!r.up ? 'Starting… (or failed to start)' :
					`Channel ${iw.channel || c.channel}${c.channel === 'auto' ? ' (auto)' : ''} · ${width || '?'} MHz${iw.txpower ? ` · ${iw.txpower} dBm` : ''}`;
				return row({ icon: 'antenna', iconColor: r.up ? 'var(--online)' : null, label: `${r.bandName} radio`, sub,
					right: h('span', { class: 'dot ' + (c.disabled === '1' ? '' : r.up ? 'on' : 'warn') }), onClick: () => openRadio(r, state, load) });
			})));
		}
		every(30000, load);
	}
});

function openNetwork(ssid, secs, state, reload) {
	const { h, row, group, field, input, password, select, toggle, btn, busy, uci, sheet, confirm, sectionTitle, hint, note } = App;
	const first = secs.find(s => (state.cfg[s.device] || {}).band !== '6g') || secs[0];
	const name = input({ value: ssid, maxlength: 32 });
	const [key, peek] = password(first.key || '', { minlength: 8, maxlength: 63 });
	const secVal = (first.encryption || 'none').startsWith('psk2') ? 'psk2+ccmp' : (first.encryption || 'none').replace('owe', 'none');
	const sec = select(SECURITY, SECURITY.some(s => s[0] === secVal) ? secVal : 'sae-mixed', { onchange: () => { keyField.hidden = sec.value === 'none'; } });
	const keyField = field('Password', [key, peek]); keyField.hidden = sec.value === 'none';
	const hidden = toggle(first.hidden === '1', null, 'Hide network name');
	const radios = state.radios;
	const bandToggles = radios.map(r => {
		const s = secs.find(x => x.device === r.name);
		return { r, s, t: toggle(!!s && s.disabled !== '1', null, r.bandName) };
	});

	sheet(ssid, close => {
		const save = btn('Save', () => busy(save, async () => {
			const n = name.value.trim();
			if (!n) throw new Error('Enter a network name');
			if (sec.value !== 'none' && (key.value.length < 8 || key.value.length > 63)) throw new Error('The password needs 8 to 63 characters');
			if (!bandToggles.some(b => b.t.checked)) throw new Error('Turn on at least one band, or delete the network');
			const tmpl = Object.assign({}, first);
			for (const b of bandToggles) {
				const is6 = b.r.band === '6g';
				/* 6 GHz requires WPA3 (or open with OWE) */
				const enc = sec.value === 'none' ? (is6 ? 'owe' : 'none') : (is6 ? 'sae' : sec.value);
				const vals = { ssid: n, encryption: enc, hidden: hidden.checked ? '1' : '0', disabled: b.t.checked ? '0' : '1' };
				if (sec.value !== 'none') vals.key = key.value;
				if (is6 && sec.value !== 'none') vals.ieee80211w = '2';
				if (b.s) {
					await uci.set('wireless', b.s['.name'], vals);
					if (sec.value === 'none' && b.s.key) await uci.unset('wireless', b.s['.name'], ['key']);
				} else if (b.t.checked) {
					await uci.addWifi(Object.assign({ device: b.r.name, mode: 'ap', network: tmpl.network || 'lan' }, vals));
				}
			}
			if (await uci.apply('Saving… WiFi restarts for a few seconds')) { close(); reload(); }
		}));
		const del = btn('Delete network', async () => {
			if (!await confirm(`Delete “${ssid}”?`, 'Devices using it will be disconnected.', 'Delete', true)) return;
			await busy(del, async () => {
				for (const s of secs) await uci.remove('wireless', s['.name']);
				if (await uci.apply()) { close(); reload(); }
			});
		}, 'secondary small');
		return h('div',
			h('div', { class: 'group' }, field('Network name', name), field('Security', sec), keyField),
			radios.some(r => r.band === '6g') && sec.value !== 'none' ? hint('6 GHz always uses WPA3, which every 6 GHz device supports.') : null,
			sectionTitle(['Bands', App.explain('Bands',
				'2.4 GHz reaches farthest and through walls, but is slower and crowded. 5 GHz is fast with good range. 6 GHz is the fastest and least crowded, but has the shortest range and only newer devices (WiFi 6E/7) see it.',
				'With the same name on several bands, devices pick the best band by themselves.',
				{ rec: 'Turn on all bands with the same name and password. Make a separate 2.4 GHz-only network only if an old smart-home gadget can\'t join.' })]),
			group(...bandToggles.map(b => row({ icon: 'antenna', label: b.r.bandName, sub: b.r.band === '2g' ? 'Longest range, slowest' : b.r.band === '5g' ? 'Good range and speed' : b.r.band === '6g' ? 'Fastest, shortest range, newest devices' : '', right: b.t }))),
			sectionTitle(['Options', App.explain('Hidden network',
				'A hidden network doesn\'t show up in the WiFi list; devices have to type its name to join.',
				'It doesn\'t make the network safer: the name is still sent when devices connect, and phones keep searching for it everywhere they go.',
				{ rec: 'Leave the name visible and use a strong password with WPA2/WPA3.' })]),
			group(row({ icon: 'lock', label: 'Hide network name', sub: 'Devices must type the name to join', right: hidden })),
			h('div', { class: 'actions' }, btn('Share', () => WifiShare.show({ ssid: name.value, key: key.value, encryption: sec.value, hidden: hidden.checked ? '1' : '0' }), 'secondary'), save),
			h('div', { class: 'btn-row', style: { justifyContent: 'center' } }, del));
	});
}

function openAddNetwork(state, reload) {
	const { h, row, group, field, input, password, select, toggle, btn, busy, uci, sheet, sectionTitle, hint } = App;
	const name = input({ placeholder: 'For example: Home-Guest', maxlength: 32 });
	const [key, peek] = password('', { minlength: 8, maxlength: 63 });
	const sec = select(SECURITY.slice(0, 3), 'sae-mixed');
	const t = state.radios.map(r => ({ r, t: toggle(r.band !== '6g', null, r.bandName) }));
	sheet('Add a network', close => {
		const save = btn('Create network', () => busy(save, async () => {
			const n = name.value.trim();
			if (!n) throw new Error('Enter a network name');
			if (key.value.length < 8) throw new Error('The password needs at least 8 characters');
			if (!t.some(x => x.t.checked)) throw new Error('Pick at least one band');
			for (const x of t) if (x.t.checked) {
				const is6 = x.r.band === '6g';
				await uci.addWifi({ device: x.r.name, mode: 'ap', network: 'lan', ssid: n, key: key.value,
					encryption: is6 ? 'sae' : sec.value, ieee80211w: is6 ? '2' : undefined });
			}
			if (await uci.apply('Creating network…')) { close(); reload(); }
		}));
		return h('div',
			h('div', { class: 'group' }, field('Network name', name), field('Security', sec), field('Password', [key, peek])),
			sectionTitle('Bands'),
			group(...t.map(x => row({ icon: 'antenna', label: x.r.bandName, right: x.t }))),
			hint('The new network joins your home network, so its devices can see each other and your other devices.'),
			h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), save));
	});
}

async function openRadio(r, state, reload) {
	const { h, row, group, field, select, toggle, seg, btn, busy, uci, sheet, call, sectionTitle, hint, note } = App;
	const c = state.cfg[r.name] || {};
	const dev = (r.ifaces.find(i => i.ifname) || {}).ifname || r.name;
	const [fl, tp] = await Promise.all([call('iwinfo', 'freqlist', { device: dev }), call('iwinfo', 'txpowerlist', { device: dev })]);
	const bandNum = { '2g': 2, '5g': 5, '6g': 6 }[r.band];
	const chans = ((fl && fl.results) || []).filter(f => !f.band || f.band === bandNum)
		.filter(f => r.band !== '6g' || (f.channel - 1) % 4 === 0);
	const htmodes = (r.iwinfo && r.iwinfo.htmodes) || [];
	const cfgPrefix = (c.htmode || '').replace(/\d+$/, '');
	const prefix = htmodes.some(m => m.startsWith('EHT')) ? 'EHT' : htmodes.some(m => m.startsWith('HE')) ? 'HE' : cfgPrefix || (r.band === '2g' ? 'HT' : 'VHT');
	const supported = WIDTHS[r.band].filter(w => !htmodes.length || htmodes.some(m => m.endsWith(String(w))));
	let width = parseInt((c.htmode || '').replace(/\D/g, ''), 10) || supported[supported.length - 1];

	const enabled = toggle(c.disabled !== '1', null, 'Radio on');
	const chanSel = select([['auto', 'Automatic']].concat(chans.map(f => [String(f.channel),
		`${f.channel} (${f.mhz} MHz)${r.band === '5g' && DFS_5G(f.channel) ? ' · radar check, 1 min to start' : f.restricted ? ' · limited' : ''}`])), c.channel || 'auto');
	const widthSeg = seg(WIDTHS[r.band].map(w => [w, String(w), !supported.includes(w)]), width, v => { width = v; });
	const powers = ((tp && tp.results) || []).map(p => p.dbm).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b - a);
	const pow = select([['', 'Maximum allowed']].concat(powers.filter(p => p > 0).map(p => [String(p), p + ' dBm'])), c.txpower || '');
	const country = select([['CA', 'Canada'], ['US', 'United States'], ['GB', 'United Kingdom'], ['FR', 'France'], ['DE', 'Germany'], ['AU', 'Australia'], ['JP', 'Japan']]
		.concat(c.country && !['CA', 'US', 'GB', 'FR', 'DE', 'AU', 'JP'].includes(c.country) ? [[c.country, c.country]] : []), c.country || 'CA');

	const rec = RECOMMENDED[r.band];
	sheet(`${r.bandName} radio`, close => {
		const save = btn('Save', () => busy(save, async () => {
			const vals = { disabled: enabled.checked ? '0' : '1', channel: chanSel.value, htmode: prefix + width, country: country.value };
			if (pow.value) vals.txpower = pow.value;
			await uci.set('wireless', r.name, vals);
			if (!pow.value && c.txpower) await uci.unset('wireless', r.name, ['txpower']);
			if (country.value !== c.country) for (const o of state.radios) if (o.name !== r.name) await uci.set('wireless', o.name, { country: country.value });
			if (await uci.apply('Saving… this radio restarts for a few seconds')) { close(); reload(); }
		}));
		return h('div',
			group(row({ icon: 'power', label: 'Radio on', sub: 'Turning it off removes this band from every network', right: enabled })),
			sectionTitle(['Channel', App.explain('Channel and width',
				'The channel is the slice of radio space the router talks on. Neighbors on the same channel slow each other down. Automatic picks a quiet one when the radio starts.',
				'Channel width: wider is faster, but picks up more interference and reaches a bit less far. On 2.4 GHz, 20 MHz is best almost everywhere.',
				'5 GHz channels marked “radar check” (DFS) are often the emptiest, but the router must listen for weather radar for a minute before using them, and moves away if it hears one.',
				{ rec: '2.4 GHz: 20 MHz, channel 1, 6 or 11 (or Automatic). 5 GHz: 80 MHz, Automatic or 36/149. 6 GHz: 160 MHz or more, Automatic.' })]),
			h('div', { class: 'group' }, field('Channel', chanSel), h('div', { class: 'field' }, h('span', 'Channel width (MHz)'), widthSeg)),
			hint('Wider channels are faster but more sensitive to interference.' + (r.band === '6g' ? ' Your phone or laptop decides the width it uses; 320 MHz only helps devices that support it.' : '')),
			note(h('span', h('strong', 'Recommended: '), rec.why, ' ', h('a', { href: '#', onclick: e => {
				e.preventDefault();
				chanSel.value = chans.some(f => String(f.channel) === rec.channel) ? rec.channel : 'auto';
				const w = supported.includes(rec.width) ? rec.width : supported[supported.length - 1];
				width = w; widthSeg.value = w;
				for (const b of widthSeg.children) b.setAttribute('aria-pressed', b.textContent === String(w) ? 'true' : 'false');
			} }, 'Use this'))),
			sectionTitle(['Advanced', App.explain('Power and country',
				'Transmit power: how loud the router talks. Lower power can help when you have several access points close together, so devices move to the nearest one. Otherwise, more is better.',
				'Country: sets the legal channels and power for where you live. A wrong country can hide channels from your devices or break the law.',
				{ rec: 'Maximum allowed power, and your real country.' })]),
			h('div', { class: 'group' }, field('Transmit power', pow), field('Country', country)),
			hint('The country decides which channels and power levels are legal. It applies to every radio.'),
			h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), save));
	});
}
