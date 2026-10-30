/* Router Home: dashboard */
'use strict';

/* a small live line chart. o: { lines: 1|2, points: 60, fmt: v => label, min: smallest top value, fixedMax } */
function LiveChart(o) {
	const NS = 'http://www.w3.org/2000/svg';
	const W = 320, H = 170, L = 62, T = 8, B = 10;
	const svg = document.createElementNS(NS, 'svg');
	svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
	svg.setAttribute('preserveAspectRatio', 'none');
	svg.innerHTML = '<g class="grid"></g><path class="a2"/><path class="a1"/><path class="l2"/><path class="l1"/>';
	const [grid, a2, a1, l2, l1] = svg.children;
	let n = o.points || 60;
	let hist = [];
	const el = App.h('div', { class: 'chart' }, svg);
	function nice(v) {
		if (o.fixedMax) return o.fixedMax;
		const p = Math.pow(10, Math.floor(Math.log10(v)));
		for (const m of [1, 1.5, 2, 3, 5, 7.5, 10]) if (m * p >= v) return m * p;
		return 10 * p;
	}
	function draw() {
		const top = nice(Math.max(o.min || 1, ...hist.flat()));
		let g = '';
		for (let i = 0; i <= 3; i++) {
			const y = T + (H - T - B) * (1 - i / 3);
			g += `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${o.fmt ? o.fmt(top * i / 3) : Math.round(top * i / 3)}</text>`;
		}
		grid.innerHTML = g;
		const off = n - hist.length;
		const xy = (k) => hist.map((x, i) => [L + (off + i) / (n - 1) * (W - L), T + (H - T - B) * (1 - Math.min(1, (x[k] || 0) / top))]);
		const line = p => p.length < 2 ? '' : 'M' + p.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join('L');
		const area = p => p.length < 2 ? '' : line(p) + `L${p[p.length - 1][0].toFixed(1)},${H - B}L${p[0][0].toFixed(1)},${H - B}Z`;
		const p1 = xy(0); l1.setAttribute('d', line(p1)); a1.setAttribute('d', area(p1));
		if ((o.lines || 1) > 1) { const p2 = xy(1); l2.setAttribute('d', line(p2)); a2.setAttribute('d', area(p2)); }
	}
	draw();
	return {
		el,
		push(v) { hist.push(Array.isArray(v) ? v : [v]); while (hist.length > n) hist.shift(); draw(); },
		resize(points) { n = Math.max(2, points); while (hist.length > n) hist.shift(); draw(); },
		clear() { hist = []; draw(); }
	};
}
const rateLabel = v => { const [a, b] = App.fmt.rate(v); return `${+a} ${b}`; };

/* CPU use from two /proc/stat samples */
const CpuMeter = () => { let last = null; return st => {
	if (!st || !st.cpu) return null;
	const [t, i] = st.cpu; let pct = null;
	if (last && t > last[0]) pct = Math.max(0, Math.min(100, 100 * (1 - (i - last[1]) / (t - last[0]))));
	last = [t, i]; return pct;
}; };
const hotC = st => { const t = ((st && st.temps) || []).map(x => x.temp).filter(x => x > -40000 && x < 150000); return t.length ? Math.max(...t) / 1000 : null; };
const tempClass = c => c == null ? '' : c >= 85 ? 'bad' : c >= 65 ? 'warn' : 'good';

App.register('home', {
	async render(page) {
		const { h, row, group, sectionTitle, icon, fmt, every, call, info } = App;

		/* app bar */
		const barDot = h('span', { class: 'dot' });
		const appbar = h('div', { class: 'appbar' }, h('button', { type: 'button', onclick: openQuick }, barDot, h('span', info.hostname || 'Router'), icon('chev', 'chev-d')));

		const lamp = h('div', { class: 'lamp checking' });
		const headline = h('h1', 'Checking your connection…');
		const sub = h('p', '');
		const fixLink = h('a', { class: 'link', href: '#/network/check', hidden: true, style: { display: 'inline-block', marginTop: '6px' } }, 'Find the problem');
		const banner = h('div');
		Diag.recoveredBanner().then(b => b && banner.replaceChildren(b));

		/* model / version */
		const b = info.boardinfo || {}, rel = b.release || {};
		const ver = (rel.version || '').replace(/-.*/, '');
		const stable = /^\d+\.\d+\.\d+$/.test(rel.version || '');
		const modelCard = h('div', { class: 'card duo' },
			h('div', h('div', { class: 'k' }, 'Model'), h('div', { class: 'v' }, b.model || b.board_name || 'Router')),
			h('div', h('div', { class: 'k' }, rel.distribution || 'OpenWrt'), h('div', { class: 'v' }, ver || '—', ver ? h('span', { class: 'pill' + (stable ? '' : ' warn') }, stable ? 'Stable' : 'Snapshot') : null)));

		/* traffic */
		const dl = h('span', '0 bps'), ul = h('span', '0 bps');
		const chart = LiveChart({ lines: 2, points: 60, fmt: rateLabel, min: 1e6 });
		const upName = h('span', { class: 'pill mute', style: { marginLeft: 'auto' } }, '—');
		const traffic = h('div', { class: 'card' },
			h('div', { class: 'rates' }, h('span', { class: 'dl' }, icon('down'), dl), h('span', { class: 'ul' }, icon('up'), ul)),
			chart.el);

		/* vitals */
		const v = k => h('div', { class: 'v' }, '—');
		const cpuV = v(), memV = v(), tempV = v(), loadV = v(), upV = v();
		const vitals = h('a', { class: 'card', href: '#/more/monitor' },
			h('div', { class: 'stats' },
				h('div', h('div', { class: 'k' }, 'CPU usage'), cpuV),
				h('div', h('div', { class: 'k' }, 'Memory'), memV),
				h('div', h('div', { class: 'k' }, 'Temperature'), tempV)),
			h('div', { class: 'stats two', style: { marginTop: '14px' } },
				h('div', h('div', { class: 'k' }, 'Load average'), loadV),
				h('div', h('div', { class: 'k' }, 'Uptime'), upV)));

		/* clients */
		const wiredV = h('div', { class: 'v' }, '—'), wlV = h('div', { class: 'v' }, '—');
		const clientsCard = h('a', { class: 'card tiles', href: '#/devices' },
			h('div', { class: 'tile' }, h('span', { class: 'ic' }, icon('interfaces')), h('div', h('div', { class: 'k' }, 'Wired clients'), wiredV)),
			h('div', { class: 'tile' }, h('span', { class: 'ic acc' }, icon('wifi')), h('div', h('div', { class: 'k' }, 'Wireless clients'), wlV)),
			icon('chev', 'chev'));
		clientsCard.lastChild.style.cssText = 'width:18px;height:18px;color:var(--muted)';

		const radiosBox = h('div', { class: 'cards' }, h('div', { class: 'skeleton' }));
		const extra = h('div');

		page.append(
			appbar, banner,
			h('div', { class: 'lamp-wrap' }, lamp, h('div', { class: 'lamp-text' }, headline, sub, fixLink)),
			modelCard,
			sectionTitle('Real-time network traffic', upName, 'chart'), traffic,
			sectionTitle('System vitals', null, 'gauge'), vitals,
			sectionTitle('Connected clients', null, 'devices'), clientsCard,
			sectionTitle('Wireless radios & SSIDs', null, 'wifi'), radiosBox,
			extra
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
				const via = !upIface ? 'the internet connection' : upIface.interface === 'wan' ? 'the WAN port' : /sta|wwan/.test((upIface.l3_device || '') + upIface.interface) ? 'WiFi' : `“${upIface.interface}”`;
				text = `Through ${via}` + (on.latency ? ` · ${Math.round(on.latency)} ms to the internet` : '');
			}
			lamp.className = 'lamp ' + state;
			barDot.className = 'dot ' + (state === 'warn' ? 'warn' : state === 'offline' ? 'off' : 'on');
			fixLink.hidden = !(state === 'warn' || state === 'offline');
			headline.textContent = title;
			sub.textContent = text;
			const wifiUp = upIface && /sta|wwan/.test((upIface.l3_device || '') + upIface.interface);
			upName.textContent = upIface ? (viaModem ? '5G' : (upIface.interface === 'wan' ? 'WAN port' : wifiUp ? 'WiFi' : upIface.interface)) : 'No uplink';
		});

		/* -------- live speed of the uplink -------- */
		let last = null;
		every(2000, async () => {
			if (!upDev) return;
			const st = await call('network.device', 'status', { name: upDev });
			if (!st || !st.statistics) return;
			const now = performance.now(), s = st.statistics;
			if (last && last.dev === upDev) {
				const dt = (now - last.t) / 1000;
				const d = Math.max(0, (s.rx_bytes - last.rx) * 8 / dt), u = Math.max(0, (s.tx_bytes - last.tx) * 8 / dt);
				dl.textContent = rateLabel(d); ul.textContent = rateLabel(u);
				chart.push([d, u]);
			}
			last = { dev: upDev, t: now, rx: s.rx_bytes, tx: s.tx_bytes };
		});

		/* -------- vitals -------- */
		const cpu = CpuMeter();
		every(3000, async () => {
			const st = info.plugin ? await call('home-ui', 'sysx', { action: 'stat' }) : null;
			if (st && st.mem) {
				const p = cpu(st);
				if (p != null) cpuV.textContent = Math.round(p) + '%';
				const m = st.mem, used = 1 - (m.MemAvailable || (m.MemFree + (m.Cached || 0) + (m.Buffers || 0))) / m.MemTotal;
				memV.textContent = Math.round(used * 100) + '%';
				const t = hotC(st);
				tempV.textContent = t == null ? '—' : Math.round(t) + '°C'; tempV.className = 'v ' + tempClass(t);
				loadV.textContent = st.load[0].toFixed(2);
				upV.textContent = fmt.duration(st.uptime);
			} else {
				const sys = await call('system', 'info');
				if (!sys) return;
				memV.textContent = Math.round((1 - (sys.memory.available || sys.memory.free) / sys.memory.total) * 100) + '%';
				loadV.textContent = (sys.load[0] / 65536).toFixed(2);
				upV.textContent = fmt.duration(sys.uptime);
			}
		});

		/* -------- clients and radios -------- */
		every(20000, async () => {
			const radios = await Data.wireless();
			const clients = await Data.clients({ radios });
			const online = clients.filter(c => c.online);
			const wl = online.filter(c => c.wifi).length;
			wiredV.textContent = `${online.length - wl} connected`;
			wlV.textContent = `${wl} connected`;
			App.setBadge('devices', online.length);
			const per = {};
			for (const c of online) if (c.wifi) per[c.wifi.ifname] = (per[c.wifi.ifname] || 0) + 1;
			const items = [];
			const nets = [];
			for (const r of radios) for (const i of r.ifaces) {
				if ((i.config.mode || 'ap') !== 'ap' || !i.config.ssid) continue;
				const on = r.up && !i.config.disabled && !r.disabled;
				if (on) nets.push(i);
				const n = per[i.ifname] || 0;
				items.push(h('a', { class: 'citem', href: '#/wifi' },
					h('span', { class: 'bub' + (on ? '' : ' off') }, icon('wifi')),
					h('span', { class: 'main' },
						h('div', { class: 't' }, i.config.ssid, h('span', { class: 'pill' + (on ? '' : ' bad') }, on ? 'On' : 'Off')),
						h('div', { class: 's' }, [r.bandName, r.iwinfo.channel ? 'Ch ' + r.iwinfo.channel : null, encName(i.config.encryption)].filter(Boolean).join(' · '))),
					h('span', { class: 'side' }, h('span', { class: 'pill acc' }, `${n} client${n === 1 ? '' : 's'}`))));
			}
			radiosBox.replaceChildren(...(items.length ? items : [h('div', { class: 'card empty' }, 'No WiFi networks')]));

			const rows = [];
			if (nets.some(i => i.config.key || (i.config.encryption || 'none') === 'none'))
				rows.push(row({ icon: 'qr', label: 'Share WiFi', sub: 'Show a code guests can scan', onClick: () => WifiShare.pick(nets) }));
			if (info.modem) {
				const m = await call('home-ui', 'modem_status');
				const g = m && m.modem && m.modem.modem && m.modem.modem.generic;
				const op = m && m.modem && m.modem.modem && m.modem.modem['3gpp'];
				rows.push(row({ icon: 'antenna', label: op && op['operator-name'] ? op['operator-name'] : 'Mobile modem',
					sub: g ? `${techName(g['access-technologies'])} · signal ${g['signal-quality'] && g['signal-quality'].value || 0}%` : 'Starting up (can take 2 minutes after boot)',
					href: '#/network/mobile' }));
			}
			extra.replaceChildren(...(rows.length ? [sectionTitle('Shortcuts', null, 'link'), group(...rows)] : []));
		});

		function openQuick() {
			App.sheet(info.hostname || 'Router', close => h('div',
				group(
					row({ icon: 'system', label: 'System settings', sub: 'Name, password, updates, backup', onClick: () => { close(); App.go('system'); } }),
					row({ icon: 'palette', label: 'Appearance', value: Theme.name(), onClick: () => { close(); App.go('more/appearance'); } }),
					row({ icon: 'power', label: 'Restart router', onClick: async () => {
						if (!await App.confirm('Restart the router?', 'The internet will be down for about a minute.', 'Restart')) return;
						await App.call('system', 'reboot'); App.toast('Restarting…'); close();
					} }),
					row({ icon: 'user', label: 'Sign out', onClick: () => App.logout() }))));
		}
	}
});

function encName(e) {
	e = e || 'none';
	if (e === 'none') return 'Open';
	if (/^owe/.test(e)) return 'Enhanced open';
	if (/sae-mixed/.test(e)) return 'WPA2/WPA3';
	if (/sae/.test(e)) return 'WPA3';
	if (/psk2|psk-mixed/.test(e)) return 'WPA2';
	if (/wpa/.test(e)) return 'Enterprise';
	return e;
}
