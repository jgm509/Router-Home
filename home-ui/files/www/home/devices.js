/* Router Home: devices page */
'use strict';

App.register('devices', {
	async render(page) {
		const { h, row, group, sectionTitle, icon, fmt, every, hint } = App;
		let filter = 'all', query = '', list = [];

		const search = h('input', { class: 'search', type: 'search', placeholder: 'Search by name, address or MAC', 'aria-label': 'Search devices',
			oninput: e => { query = e.target.value.toLowerCase(); draw(); } });
		const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter' });
		const body = h('div', h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
		page.append(h('h1', { class: 'page-title' }, 'Clients'), search, chips, body);

		function drawChips() {
			const counts = { all: list.length, online: list.filter(d => d.online).length, paused: list.filter(d => d.paused).length };
			chips.replaceChildren(...[['all', 'All'], ['online', 'Connected'], ['paused', 'Paused']].map(([k, l]) =>
				h('button', { type: 'button', class: 'chip', 'aria-pressed': filter === k ? 'true' : 'false', onclick: () => { filter = k; drawChips(); draw(); } }, `${l} ${counts[k]}`)));
		}

		function draw() {
			const shown = list.filter(d => (filter === 'all' || (filter === 'online' && d.online) || (filter === 'paused' && d.paused)) &&
				(!query || [d.label, d.mac, ...d.ips].join(' ').toLowerCase().includes(query)));
			if (!shown.length) {
				body.replaceChildren(h('div', { class: 'group' }, h('div', { class: 'empty' },
					list.length ? 'No devices match.' : 'No devices yet. They show up here once they connect to your WiFi or a LAN port.')));
				return;
			}
			const on = shown.filter(d => d.online), off = shown.filter(d => !d.online);
			const mk = d => row({
				icon: d.kind, iconColor: d.paused ? 'var(--offline)' : (d.online ? 'var(--online)' : null),
				label: d.label,
				sub: [Data.connText(d), d.ips[0]].filter(Boolean).join(' · '),
				right: d.paused ? h('span', { class: 'badge paused' }, icon('pause'), 'Paused') :
					d.scheduled ? h('span', { class: 'badge' }, icon('clock'), 'Schedule') :
					d.wifi ? Data.signalBars(d.wifi.signal) : null,
				onClick: () => openDevice(d, load)
			});
			body.replaceChildren(
				on.length ? sectionTitle(`Connected now`) : null, on.length ? group(...on.map(mk)) : null,
				off.length ? sectionTitle('Seen before') : null, off.length ? group(...off.map(mk)) : null,
				hint('Tap a device to rename it, give it a fixed address or pause its internet.')
			);
		}

		async function load() {
			list = await Data.clients();
			drawChips(); draw();
		}
		every(20000, load);
	}
});

function hostName(v) {
	return (v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’]/g, '')
		.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function openDevice(d, reload) {
	const { h, row, group, field, input, toggle, btn, busy, uci, rpc, call, sheet, fmt, confirm, toast, sectionTitle, hint, icon } = App;

	const sched = d.pause.filter(r => r.start_time || r.weekdays);
	const now = d.pause.filter(r => !(r.start_time || r.weekdays));
	const firstSched = sched[0] || {};
	/* an overnight schedule is stored as two rules: start..23:59 and 00:00..stop */
	const schedStop = (sched.find(r => r.start_time === '00:00:00') || firstSched).stop_time;
	const schedStart = (sched.find(r => r.start_time !== '00:00:00') || firstSched).start_time;
	const schedDays = (sched.find(r => r.start_time !== '00:00:00') || firstSched).weekdays;

	const name = input({ value: d.name, placeholder: 'For example: living-room-tv', maxlength: 60 });
	const pauseNow = toggle(now.some(r => r.enabled !== '0'), null, 'Pause internet now');
	const reserve = toggle(!!(d.host && d.host.ip), () => { ipField.hidden = !reserve.checked; }, 'Always use the same address');
	const ip = input({ value: (d.host && d.host.ip) || d.ips.find(x => !x.includes(':')) || '', inputmode: 'decimal' });
	const ipField = field('Address', ip); ipField.hidden = !reserve.checked;

	const schedOn = toggle(sched.length > 0, () => { schedBox.hidden = !schedOn.checked; }, 'Bedtime schedule');
	const days = new Set((schedDays || 'Mon Tue Wed Thu Fri Sat Sun').split(/\s+/).filter(Boolean));
	const dayChips = h('div', { class: 'chips' }, DAYS.map(dn => h('button', { type: 'button', class: 'chip', 'aria-pressed': days.has(dn) ? 'true' : 'false',
		onclick: e => { days.has(dn) ? days.delete(dn) : days.add(dn); e.currentTarget.setAttribute('aria-pressed', days.has(dn)); } }, dn)));
	const from = input({ type: 'time', value: (schedStart || '22:00:00').slice(0, 5) });
	const to = input({ type: 'time', value: (schedStop || '07:00:00').slice(0, 5) });
	const schedBox = h('div', { hidden: !sched.length },
		h('div', { class: 'field' }, h('span', 'Days'), dayChips),
		field('Pause from', from), field('Until', to));

	const w = d.wifi;
	const facts = h('dl', { class: 'kv' },
		h('dt', 'Status'), h('dd', d.paused ? 'Internet paused' : (d.online ? 'Connected' : 'Not connected')),
		w ? [h('dt', 'Connection'), h('dd', `${w.bandName} WiFi (${w.ssid || ''})`),
			h('dt', 'Signal'), h('dd', `${w.signal} dBm`),
			w.rx && w.rx.rate ? [h('dt', 'Link speed'), h('dd', `↓ ${Math.round(w.rx.rate / 1000)} / ↑ ${Math.round((w.tx && w.tx.rate || 0) / 1000)} Mbps${w.rx.mhz ? ` · ${w.rx.mhz} MHz` : ''}`)] : null,
			w.connected ? [h('dt', 'Connected for'), h('dd', fmt.duration(w.connected))] : null] :
			(d.online ? [h('dt', 'Connection'), h('dd', 'Cable (LAN port)')] : null),
		d.ips.length ? [h('dt', 'Address'), h('dd', d.ips.join(', '))] : null,
		h('dt', 'MAC'), h('dd', { class: 'mono' }, fmt.mac(d.mac)));

	sheet(d.label, close => {
		const save = btn('Save', async () => busy(save, async () => {
			const label = hostName(name.value) || d.label;
			const hostVals = {};
			/* name + reserved address live in a DHCP "host" entry */
			if (name.value.trim() || reserve.checked) {
				if (reserve.checked && !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip.value.trim())) throw new Error('Enter an address like 192.168.1.50');
				hostVals.mac = d.mac; hostVals.name = hostName(name.value) || undefined;
				hostVals.dns = '1';
				if (d.host) {
					await uci.set('dhcp', d.host['.name'], hostVals);
					if (reserve.checked) await uci.set('dhcp', d.host['.name'], { ip: ip.value.trim() });
					else if (d.host.ip) await uci.unset('dhcp', d.host['.name'], ['ip']);
				} else {
					if (reserve.checked) hostVals.ip = ip.value.trim();
					await uci.add('dhcp', 'host', hostVals);
				}
			} else if (d.host) {
				await uci.remove('dhcp', d.host['.name']);
			}

			/* pause rules */
			for (const r of d.pause) await uci.remove('firewall', r['.name']);
			const base = { src: 'lan', dest: '*', src_mac: [d.mac], proto: 'all', target: 'REJECT', family: 'any' };
			if (pauseNow.checked) await uci.add('firewall', 'rule', Object.assign({ name: `${Data.PAUSE_PREFIX}: ${label}` }, base));
			if (schedOn.checked) {
				if (!days.size) throw new Error('Pick at least one day for the schedule');
				const a = from.value || '22:00', b = to.value || '07:00';
				const dl = DAYS.filter(x => days.has(x));
				const sname = `${Data.PAUSE_PREFIX} (schedule): ${label}`;
				if (a < b) {
					await uci.add('firewall', 'rule', Object.assign({ name: sname, start_time: a + ':00', stop_time: b + ':00', weekdays: dl.join(' ') }, base));
				} else {
					const next = dl.map(x => DAYS[(DAYS.indexOf(x) + 1) % 7]);
					await uci.add('firewall', 'rule', Object.assign({ name: sname, start_time: a + ':00', stop_time: '23:59:59', weekdays: dl.join(' ') }, base));
					await uci.add('firewall', 'rule', Object.assign({ name: sname, start_time: '00:00:00', stop_time: b + ':00', weekdays: next.join(' ') }, base));
				}
			}
			if (await uci.apply()) {
				if (pauseNow.checked || schedOn.checked) for (const a of d.ips) await call('home-ui', 'flush_device', { ip: a });
				close(); reload();
			}
		}));

		return h('div',
			h('div', { class: 'group' }, facts),
			sectionTitle('Name'),
			h('div', { class: 'group' }, field('Device name', name)),
			hint('Letters, numbers and dashes. Spaces become dashes. Other devices can reach it as name.lan.'),
			sectionTitle('Internet access'),
			group(
				row({ icon: 'pause', label: 'Pause internet', sub: 'Blocks internet for this device until you turn it back on', right: pauseNow }),
				row({ icon: 'clock', label: 'Bedtime schedule', sub: 'Pause automatically at set times', right: schedOn }),
				schedBox),
			hint('The device stays connected to your WiFi and can still reach other devices at home.'),
			sectionTitle(['Address', App.explain('Fixed address',
				'The router normally hands out addresses as devices join, and a device can get a different one later.',
				'A fixed address keeps it the same, which printers, cameras, servers and port forwarding need.',
				{ rec: 'Use a fixed address for anything other devices or forwards point to; leave phones and laptops automatic.' })]),
			group(row({ icon: 'link', label: 'Always use the same address', sub: 'Useful for printers, cameras and port forwarding', right: reserve }), ipField),
			App.info.adguard ? group(row({ icon: 'shield', label: 'AdGuard Home rules', sub: 'Blocked services, schedule, safe search for this device', onClick: () => { close(); Agh.openClient(null, null, d); } })) : null,
			d.ips.some(x => !x.includes(':')) ? group(row({ icon: 'globe', label: 'Forward a port to this device', sub: 'For a game server, camera or home server', onClick: () => { close(); Firewall.openForward(null, null, null, { ip: (d.host && d.host.ip) || d.ips.find(x => !x.includes(':')), name: d.name }); } })) : null,
			h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), save),
			(d.host || d.pause.length) ? h('div', { class: 'btn-row', style: { justifyContent: 'center' } },
				btn('Forget this device', async ev => {
					if (!await confirm('Forget this device?', 'Its name, fixed address and pause rules will be removed. It can still connect.', 'Forget', true)) return;
					await busy(null, async () => {
						if (d.host) await uci.remove('dhcp', d.host['.name']);
						for (const r of d.pause) await uci.remove('firewall', r['.name']);
						if (await uci.apply()) { close(); reload(); }
					});
				}, 'secondary small')) : null
		);
	});
}
