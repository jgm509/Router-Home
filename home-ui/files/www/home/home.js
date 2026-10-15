/* Router Home: home page */
'use strict';

App.register('home', {
	async render(page) {
		const { h, row, group, sectionTitle, icon, fmt, every, call, info } = App;

		const lamp = h('div', { class: 'lamp checking' });
		const headline = h('h1', 'Checking your connection…');
		const sub = h('p', '');
		const upName = h('span', '—');
		const upIcon = h('span', { class: 'ni' }, icon('globe'));
		const devCount = h('span', '—');
		const wires = [h('span', { class: 'wire' }), h('span', { class: 'wire' }), h('span', { class: 'wire' })];

		const dlNum = h('span', { class: 'num' }, '0'), dlUnit = h('span', { class: 'unit' }, 'Mbps');
		const ulNum = h('span', { class: 'num' }, '0'), ulUnit = h('span', { class: 'unit' }, 'Mbps');
		const spark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		spark.setAttribute('class', 'spark'); spark.setAttribute('viewBox', '0 0 300 56'); spark.setAttribute('preserveAspectRatio', 'none');
		spark.innerHTML = '<path class="dl" stroke-width="1.6"/><path class="ul" stroke-width="1.6"/>';

		const glance = h('div', { class: 'group' }, h('div', { class: 'skeleton', style: { margin: 0, borderRadius: 0 } }));

		page.append(
			h('div', { class: 'lamp-wrap' }, lamp, h('div', { class: 'lamp-text' }, headline, sub)),
			h('div', { class: 'group' },
				h('div', { class: 'path', style: { '--c': 'var(--online)' } },
					h('div', { class: 'node' }, icon('globe'), h('span', 'Internet')),
					wires[0],
					h('div', { class: 'node' }, upIcon, upName),
					wires[1],
					h('div', { class: 'node' }, icon('home'), h('span', 'Router')),
					wires[2],
					h('div', { class: 'node' }, icon('devices'), devCount)),
				h('div', { class: 'speed' },
					h('div', h('div', { class: 'lbl' }, h('span', { class: 'dot blue' }), 'Download now'), h('div', dlNum, dlUnit)),
					h('div', h('div', { class: 'lbl' }, h('span', { class: 'dot on' }), 'Upload now'), h('div', ulNum, ulUnit))),
				h('div', { style: { padding: '0 16px 12px' } }, spark)
			),
			sectionTitle('At a glance'),
			glance
		);

		/* -------- connection state (matches the front light) -------- */
		let upDev = null, upIface = null;
		every(15000, async () => {
			const [on, ifaces] = await Promise.all([call('home-ui', 'online'), Data.interfaces()]);
			upIface = Data.uplink(ifaces);
			upDev = upIface ? (upIface.l3_device || upIface.device) : (on && on.device) || null;
			const viaModem = (on && on.via_modem) || (upIface && Data.isModemProto(upIface.proto));
			let state, title, text;
			if (!upIface && !(on && on.device)) {
				state = 'offline'; title = 'No internet connection';
				text = 'Nothing is plugged into the WAN port and the modem isn\'t connected.';
			} else if (on && !on.online) {
				state = 'warn'; title = 'Connected, but no internet';
				text = 'The router has a connection, but the internet isn\'t answering.';
			} else if (!on) {
				state = upIface ? 'online' : 'offline'; title = upIface ? 'Connected' : 'Status unknown';
				text = 'The status check isn\'t installed, so this is based on the routing table.';
			} else if (viaModem) {
				state = 'modem'; title = 'Online through 5G';
				text = 'Using the mobile modem' + (on.latency ? ` · ${Math.round(on.latency)} ms to the internet` : '');
			} else {
				state = 'online'; title = 'You\'re online';
				text = 'Through the WAN port' + (on.latency ? ` · ${Math.round(on.latency)} ms to the internet` : '');
			}
			lamp.className = 'lamp ' + state;
			headline.textContent = title;
			sub.textContent = text;
			upName.textContent = upIface ? (viaModem ? '5G' : (upIface.interface === 'wan' ? 'WAN port' : upIface.interface)) : 'None';
			upIcon.replaceChildren(icon(viaModem ? 'antenna' : 'cable'));
			const live = state === 'online' || state === 'modem';
			wires.forEach(w => w.classList.toggle('live', live));
			page.querySelector('.path').style.setProperty('--c', state === 'modem' ? 'var(--modem)' : 'var(--online)');
		});

		/* -------- live speed of the uplink -------- */
		const hist = Array.from({ length: 60 }, () => [0, 0]);
		let last = null;
		every(2000, async () => {
			if (!upDev) return;
			const st = await call('network.device', 'status', { name: upDev });
			if (!st || !st.statistics) return;
			const now = performance.now(), s = st.statistics;
			if (last && last.dev === upDev) {
				const dt = (now - last.t) / 1000;
				const dl = Math.max(0, (s.rx_bytes - last.rx) * 8 / dt), ul = Math.max(0, (s.tx_bytes - last.tx) * 8 / dt);
				const [a, b] = fmt.rate(dl), [c, d] = fmt.rate(ul);
				dlNum.textContent = a; dlUnit.textContent = b; ulNum.textContent = c; ulUnit.textContent = d;
				hist.push([dl, ul]); if (hist.length > 60) hist.shift();
				drawSpark();
			}
			last = { dev: upDev, t: now, rx: s.rx_bytes, tx: s.tx_bytes };
		});
		function drawSpark() {
			const max = Math.max(1e6, ...hist.map(x => Math.max(x[0], x[1])));
			const off = 60 - hist.length;
			const pts = k => hist.map((x, i) => `${((off + i) / 59 * 300).toFixed(1)},${(54 - x[k] / max * 50).toFixed(1)}`);
			const area = k => hist.length < 2 ? '' : `M${pts(k)[0].split(',')[0]},56L${pts(k).join('L')}L${pts(k).slice(-1)[0].split(',')[0]},56Z`;
			spark.children[0].setAttribute('d', area(0));
			spark.children[1].setAttribute('d', area(1));
		}

		/* -------- at a glance -------- */
		every(30000, async () => {
			const [radios, sys] = await Promise.all([Data.wireless(), call('system', 'info')]);
			const clients = await Data.clients({ radios });
			const online = clients.filter(c => c.online);
			devCount.textContent = `${online.length} online`;
			const paused = clients.filter(c => c.paused).length;

			const nets = [];
			for (const r of radios) for (const i of r.ifaces) if ((i.config.mode || 'ap') === 'ap' && i.config.ssid && !i.config.disabled) nets.push(i);
			const ssids = [...new Set(nets.map(i => i.config.ssid))];
			const bands = radios.filter(r => r.up).map(r => r.bandName).join(', ');

			const rows = [
				row({ icon: 'wifi', label: ssids.length ? ssids.join(', ') : 'WiFi is off', sub: bands ? 'On ' + bands : 'No radios on', href: '#/wifi' }),
				row({ icon: 'devices', label: `${online.length} connected`, sub: paused ? `${paused} paused` : `${clients.length} known device${clients.length === 1 ? '' : 's'}`, href: '#/devices' }),
				nets.length && nets.some(i => i.config.key || (i.config.encryption || 'none') === 'none')
					? row({ icon: 'qr', label: 'Share WiFi', sub: 'Show a code guests can scan', onClick: () => WifiShare.pick(nets) }) : null
			];

			if (info.modem) {
				const m = await call('home-ui', 'modem_status');
				const g = m && m.modem && m.modem.modem && m.modem.modem.generic;
				const op = m && m.modem && m.modem.modem && m.modem.modem['3gpp'];
				rows.push(row({ icon: 'antenna', label: op && op['operator-name'] ? op['operator-name'] : 'Mobile modem',
					sub: g ? `${techName(g['access-technologies'])} · signal ${g['signal-quality'] && g['signal-quality'].value || 0}%` : 'Starting up (can take 2 minutes after boot)',
					href: '#/network/mobile' }));
			}

			if (sys) rows.push(row({ icon: 'system', label: 'Router', sub: `Up ${fmt.duration(sys.uptime)} · memory ${Math.round((1 - (sys.memory.available || sys.memory.free) / sys.memory.total) * 100)}% used`, href: '#/system' }));
			glance.replaceChildren(...rows.filter(Boolean));
		});
	}
});
