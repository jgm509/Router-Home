/* Router Home: dashboard */
'use strict';

/* a small live line chart. o: { lines: 1|2, points: 60, fmt: v => label, min: smallest top value, fixedMax } */
function LiveChart(o) {
	const NS = 'http://www.w3.org/2000/svg';
	let W = 320; const H = 170, L = 62, T = 8, B = 10;
	const svg = document.createElementNS(NS, 'svg');
	svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
	svg.setAttribute('preserveAspectRatio', 'none');
	svg.innerHTML = '<g class="grid"></g><path class="a2"/><path class="a1"/><path class="l2"/><path class="l1"/><text class="chart-wait" text-anchor="middle"></text>';
	const [grid, a2, a1, l2, l1, wait] = svg.children;
	wait.setAttribute('x', (L + W) / 2); wait.setAttribute('y', (T + H - B) / 2 + 4);
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
			g += `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${o.fmt ? o.fmt(top * i / 3, true) : Math.round(top * i / 3)}</text>`;
		}
		grid.innerHTML = g;
		// until two samples exist there is no line to draw
		wait.textContent = hist.length < 2 ? 'Collecting…' : '';
		const off = n - hist.length;
		const xy = (k) => hist.map((x, i) => [L + (off + i) / (n - 1) * (W - L), T + (H - T - B) * (1 - Math.min(1, (x[k] || 0) / top))]);
		const line = p => p.length < 2 ? '' : 'M' + p.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join('L');
		const area = p => p.length < 2 ? '' : line(p) + `L${p[p.length - 1][0].toFixed(1)},${H - B}L${p[0][0].toFixed(1)},${H - B}Z`;
		const p1 = xy(0); l1.setAttribute('d', line(p1)); a1.setAttribute('d', area(p1));
		if ((o.lines || 1) > 1) { const p2 = xy(1); l2.setAttribute('d', line(p2)); a2.setAttribute('d', area(p2)); }
	}
	// keep the drawing as wide as the box, so labels aren't stretched on wide screens
	if (window.ResizeObserver) new ResizeObserver(() => {
		const r = svg.getBoundingClientRect();
		const w = r.height ? Math.max(200, Math.round(r.width * H / r.height)) : 320;
		if (w === W) return;
		W = w; svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
		wait.setAttribute('x', (L + W) / 2); draw();
	}).observe(svg);
	draw();
	return {
		el,
		push(v) { hist.push(Array.isArray(v) ? v : [v]); while (hist.length > n) hist.shift(); draw(); },
		resize(points) { n = Math.max(2, points); while (hist.length > n) hist.shift(); draw(); },
		clear() { hist = []; draw(); }
	};
}
/* axis: whole numbers from 10 up (67 Mbps, not 66.7), one decimal below */
const rateLabel = (v, axis) => { const [a, b] = App.fmt.rate(v); const x = +a; return `${axis && x >= 10 ? Math.round(x) : x} ${b}`; };

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
		const appbar = h('div', { class: 'appbar' }, h('button', { type: 'button', onclick: App.openQuick }, barDot, h('span', info.hostname || 'Router'), icon('chev', 'chev-d')));

		const lamp = h('div', { class: 'lamp checking' });
		const headline = h('h1', 'Checking your connection…');
		const sub = h('p', '');
		const fixLink = h('a', { class: 'link', href: '#/network/check', hidden: true, style: { display: 'inline-block', marginTop: '6px' } }, 'Find the problem');
		const banner = h('div');
		Diag.recoveredBanner().then(b => b && banner.replaceChildren(b));
		/* a newer Router Home on GitHub (the router asks at most once a day) */
		const updBanner = h('div');
		App.rpc('home-ui', 'update_check', {}).then(u => {
			/* updated meanwhile (the installer over SSH, another browser): this page is the old one */
			if (u && u.current && info.version && u.current !== info.version) {
				updBanner.replaceChildren(h('div', { class: 'note' },
					h('div', `Router Home was updated to ${u.current}. Reload to use it.`),
					h('div', { class: 'btn-row', style: { marginTop: '8px' } },
						App.btn('Reload', () => location.replace('/home/?u=' + Date.now()), 'small'))));
				return;
			}
			let seen = ''; try { seen = localStorage.getItem('hu-update-later') || ''; } catch (e) { }
			if (!u || !u.newer || seen === u.latest) return;
			updBanner.replaceChildren(h('div', { class: 'note' },
				h('div', `Router Home ${u.latest} is available (you have ${u.current}).`),
				h('div', { class: 'btn-row', style: { marginTop: '8px' } },
					App.btn('See update', () => { try { sessionStorage.setItem('hu-open-update', '1'); } catch (e) { } location.hash = '#/system'; }, 'small'),
					App.btn('Later', () => { try { localStorage.setItem('hu-update-later', u.latest); } catch (e) { } updBanner.replaceChildren(); }, 'small secondary'))));
		}).catch(() => { });

		/* model / version */
		const b = info.boardinfo || {}, rel = b.release || {};
		/* a release shows its number ("24.10.4"), a snapshot its build ("r38099"),
		   so the card doesn't read "SNAPSHOT Snapshot" */
		const stable = /^\d+\.\d+\.\d+$/.test(rel.version || '');
		const ver = stable || !/snapshot/i.test(rel.version || '') ? (rel.version || '').replace(/-.*/, '')
			: (String(rel.revision || '').match(/^r\d+/) || [''])[0] || rel.version;
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
			h('div', { class: 'tile' }, h('span', { class: 'ic' }, icon('interfaces')), h('div', h('div', { class: 'k' }, 'Wired'), wiredV)),
			h('div', { class: 'tile' }, h('span', { class: 'ic acc' }, icon('wifi')), h('div', h('div', { class: 'k' }, 'Wireless'), wlV)),
			icon('chev', 'chev'));
		clientsCard.lastChild.style.cssText = 'width:18px;height:18px;color:var(--muted)';

		const radiosBox = h('div', { class: 'cards' }, h('div', { class: 'skeleton' }));
		const extra = h('div');

		page.append(
			appbar, banner, updBanner,
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
				const [m, ifs] = await Promise.all([call('home-ui', 'modem_status'), Data.interfaces().catch(() => [])]);
				const mm = m && m.modem && m.modem.modem;
				const op = mm && mm['3gpp'];
				const errs = [].concat(...ifs.filter(i => Data.isModemProto(i.proto)).map(i => (i.errors || []).map(e => e.code)));
				rows.push(row({ icon: 'antenna', label: mmVal(op && op['operator-name']) || 'Mobile modem',
					sub: m && m.simple ? [m.simple.carrier, m.simple.state === 'connected' ? 'Connected' : m.simple.state].filter(Boolean).join(' · ') || 'Mobile modem' : modemLine(mm, errs), href: '#/network/mobile' }));
			}
			extra.replaceChildren(...(rows.length ? [sectionTitle('Shortcuts', null, 'link'), group(...rows)] : []));
		});

	}
});

/* ModemManager writes "--" for a value it doesn't have */
function mmVal(v) { v = String(v == null ? '' : v).trim(); return v === '--' ? '' : v; }

/* the bands the modem is locked to ("B5, B7"), or '' when it may use all of them */
function mmBandLock(g) {
	const sup = ((g && g['supported-bands']) || []).filter(b => b !== 'any' && b !== 'unknown'), cur = (g && g['current-bands']) || [];
	if (!sup.length || !cur.length || cur.includes('any') || cur.length >= sup.length) return '';
	const kind = b => /^eutran-/.test(b) ? 'lte' : /^ngran-/.test(b) ? 'nr' : 'other';
	const name = b => { let m = /^eutran-(\d+)$/.exec(b); if (m) return `B${m[1]}`; m = /^ngran-(\d+)$/.exec(b); if (m) return `n${m[1]}`; return b.replace(/^utran-/, '3G ').replace(/^g-?/, ''); };
	const supNr = sup.filter(b => kind(b) === 'nr'), allNr = supNr.length && supNr.every(b => cur.includes(b));
	const l = cur.filter(b => !(allNr && kind(b) === 'nr')).map(name);
	return l.length > 6 ? l.slice(0, 6).join(', ') + '…' : l.join(', ');
}

/* What the modem is doing, in plain words.
   mm = ModemManager's "modem" object; errs = the error codes netifd has for its connection.
   -> { state, detail, level ('good' | 'warn' | 'bad' | ''), online, slot (a SIM slot to switch to) } */
function modemPlain(mm, errs) {
	const g = (mm && mm.generic) || {}, op = (mm && mm['3gpp']) || {};
	const st = mmVal(g.state), reg = mmVal(op['registration-state']), why = mmVal(g['state-failed-reason']);
	const lock = mmBandLock(g);
	const lockNote = lock ? `The bands are locked to ${lock}, so a network on any other band can't be used.` : '';
	const regFailed = (errs || []).some(c => /REGISTRATION/.test(c));
	if (st === 'connected') return { state: 'Connected', level: 'good', online: true };
	if (reg === 'denied') return { state: 'Refused by the network', level: 'bad',
		detail: 'The mobile network refused this SIM. The plan may have expired, or the SIM isn\'t allowed on the networks here.' };
	if (st === 'connecting') return { state: 'Connecting…', online: true };
	if (st === 'registered') return { state: 'On the network, not connected', level: 'warn', online: true,
		detail: 'The modem found a network but has no data connection. If it stays this way, check the APN.' };
	if (st === 'searching' || st === 'enabled') return { state: 'Looking for a network…', detail: lockNote || null, level: lock ? 'warn' : '' };
	if (st === 'failed' && why === 'sim-missing') {
		const slots = g['sim-slots'] || [], prim = +mmVal(g['primary-sim-slot']) || 0;
		const other = slots.findIndex((p, i) => mmVal(p) && p !== '/' && i + 1 !== prim);
		return other >= 0 && prim ? { state: 'Using an empty SIM slot', level: 'bad', slot: other + 1,
			detail: `The modem is set to SIM slot ${prim}, which is empty. The SIM or eSIM is in slot ${other + 1}.` }
			: { state: 'No SIM or eSIM profile', level: 'bad', detail: 'The modem sees no SIM. Turn on an eSIM profile below, or put in a SIM.' };
	}
	if (st === 'failed') return { state: 'The modem reports a problem', level: 'bad', detail: why ? `Reason given by the modem: ${why.replace(/-/g, ' ')}.` : null };
	if (st === 'locked') return { state: 'The SIM is locked (PIN)', level: 'bad', detail: 'The SIM asks for its PIN. Turn the PIN lock off with a phone, then put the SIM back.' };
	if (st === 'disabled') return regFailed ? { state: 'Turned off: no network accepted it', level: 'warn',
		detail: ['The modem couldn\'t register on a mobile network, so it was turned off. The usual causes: the plan expired, there is no signal here, or the bands are locked.', lockNote, 'Use Reconnect on the mobile connection to try again.'].filter(Boolean).join(' ') }
		: { state: 'Turned off' };
	return { state: ({ disabling: 'Turning off…', enabling: 'Turning on…', initializing: 'Starting up…' })[st] || (st ? st[0].toUpperCase() + st.slice(1) : 'No network') };
}

/* one line for the modem shortcut: only a modem on a network has a technology and a signal */
function modemLine(mm, errs) {
	if (!mm) return 'Starting up (can take 2 minutes after boot)';
	const g = mm.generic || {}, p = modemPlain(mm, errs);
	if (!p.online) return p.state;
	const sig = g['signal-quality'] && +mmVal(g['signal-quality'].value) || 0;
	const tech = [].concat(g['access-technologies'] || []).map(mmVal).filter(Boolean);
	return [tech.length ? techName(tech) : null, p.state === 'Connected' ? null : p.state, sig ? `signal ${sig}%` : null].filter(Boolean).join(' · ');
}

/* netifd's error codes for a connection, in plain words */
function ifaceErrorText(i) {
	const codes = ((i && i.errors) || []).map(e => e.code).filter(Boolean);
	if (!codes.length) return '';
	const known = {
		MM_3GPP_OPERATOR_REGISTRATION_FAILED: 'Couldn\'t register on a mobile network',
		MM_PINCODE_REQUIRED: 'The SIM asks for its PIN', MM_PINCODE_WRONG: 'The SIM PIN is wrong',
		MM_CONNECT_FAILED: 'The mobile data connection failed (check the APN)',
		MM_CONNECT_IN_PROGRESS: 'Connecting…', MM_DISCONNECT_IN_PROGRESS: 'Disconnecting…',
		MM_MODEM_DISABLED: 'The modem is turned off', MM_INTERFACE_NOT_FOUND: 'The modem\'s network port is missing',
		DEVICE_NOT_MANAGED: 'The modem wasn\'t found', NO_DEVICE: 'The port or device is missing',
		NO_IFACE: 'The network port is missing', NO_IFNAME: 'The network port is missing',
		SETUP_FAILED: 'Setting up the connection failed', MISSING_ADDRESS: 'No address is set',
		NO_WAN_ADDRESS: 'No internet address yet', NO_WAN_LINK: 'No link on the internet port',
		CONNECT_FAILED: 'Connecting failed', AUTH_FAILED: 'Sign-in was refused (check the user name and password)',
		PIN_FAILED: 'The SIM PIN was refused', NO_NETWORK: 'No mobile network found'
	};
	return codes.map(c => known[c]
		|| (/SIM_MISSING/.test(c) ? 'No SIM or eSIM profile' : /REGISTRATION/.test(c) ? 'Couldn\'t register on a mobile network' : /PIN|PUK/.test(c) ? 'The SIM is locked' : null)
		|| c.replace(/^MM_/, '').replace(/_/g, ' ').toLowerCase().replace(/^./, x => x.toUpperCase()) + ` (${c})`).join('; ');
}

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
