/* Router Home: "More" tab and its pages (monitoring, storage, charts, tools,
 * services and schedules, packages, lights, appearance) */
'use strict';

const More = (() => {
	const sx = (action, p) => App.call('home-ui', 'sysx', Object.assign({ action }, p || {}));
	const head = (page, title, right) => {
		const { h, icon } = App;
		page.append(h('a', { class: 'hint back-link', href: '#/more' }, icon('back'), 'More'), h('h1', { class: 'page-title' }, title));
		if (right) { right.classList.add('bar-right'); page.append(right); }
	};
	const card = (title, ic, ...body) => App.h('div', { class: 'card' }, title ? App.h('div', { class: 'card-head ruled' }, App.icon(ic || 'box'), App.h('span', { class: 'grow' }, title)) : null, ...body);
	const kv = pairs => App.h('dl', { class: 'kv tight' }, pairs.filter(Boolean).map(([k, v]) => [App.h('dt', k), App.h('dd', v)]));
	const needPlugin = page => {
		if (App.info.plugin) return false;
		page.append(App.note('This page needs the Router Home service on the router. Update Router Home from System → Update Router Home.', 'warn'));
		return true;
	};

	/* ======================= index ======================= */
	async function index(page) {
		const { h, row, group, info, call } = App;
		const fan = await call('home-ui', 'fan_status');
		const sub = h('span', fan && fan.available ? fanSummary(fan) : '');
		const lbl = t => h('div', { class: 'more-label' }, t);
		page.append(
			h('h1', { class: 'page-title' }, 'More'),
			lbl('Router'),
			group(
				row({ icon: 'system', label: 'System settings', sub: 'Name, time zone, password, updates, backup, reset', href: '#/system' }),
				row({ icon: 'palette', label: 'Appearance', sub: Theme.name(), href: '#/more/appearance' }),
				row({ icon: 'power', label: 'Restart router', sub: 'Perform a system restart', onClick: async () => {
					if (!await App.confirm('Restart the router?', 'The internet will be down for about a minute.', 'Restart')) return;
					await call('system', 'reboot'); App.toast('Restarting…');
				} })),
			lbl('Monitoring'),
			group(
				row({ icon: 'gauge', label: 'System monitoring', sub: 'Live CPU, memory, load and temperatures', href: '#/more/monitor' }),
				row({ icon: 'storage', label: 'Storage', sub: 'Space used, mount points', href: '#/more/storage' }),
				row({ icon: 'chart', label: 'Realtime charts', sub: 'Live traffic, CPU and memory graphs', href: '#/more/charts' }),
				row({ icon: 'chart', label: 'Data usage', sub: 'How much each device used', href: '#/network/usage' })),
			lbl('Network'),
			group(
				row({ icon: 'tools', label: 'Network tools', sub: 'Ping, traceroute, DNS lookup, routes and ARP', href: '#/more/tools' }),
				row({ icon: 'refresh', label: 'Connection check', sub: 'Find and fix internet problems', href: '#/network/check' }),
				row({ icon: 'dns', label: 'DHCP & DNS', sub: 'Name servers, encrypted DNS, local names', href: '#/network/dns' }),
				row({ icon: 'shield', label: 'Firewall', sub: 'Zones, port forwards, rules, UPnP', href: '#/network/firewall' }),
				row({ icon: 'interfaces', label: 'Networks', sub: 'Guest and IoT networks, VLANs', href: '#/network/lans' }),
				row({ icon: 'lock', label: 'Security check', sub: 'Look for risky settings', href: '#/network/security' }),
				info.adguard ? row({ icon: 'shield', label: 'AdGuard Home', sub: 'Blocking, lists, query log', href: '#/network/adguard' }) : null,
				row({ icon: 'vpn', label: 'VPN', sub: 'WireGuard, Proton, Tailscale', href: '#/network/vpn' }),
				info.modem || info.modemmanager ? row({ icon: 'antenna', label: 'Mobile & modem', sub: 'Signal, bands, SMS, eSIM, GPS', href: '#/network/mobile' }) : null),
			lbl('Hardware'),
			group(
				fan && fan.available ? row({ icon: 'fan', label: 'Fan', sub, onClick: () => openFan(() => call('home-ui', 'fan_status').then(f => { sub.textContent = fanSummary(f); })) }) :
					row({ icon: 'fan', label: 'Fan', sub: fan && fan.missing ? `Needs ${fan.missing}` : 'No controllable fan found', disabled: true }),
				row({ icon: 'light', label: 'Lights', sub: 'Every LED, night mode', href: '#/more/lights' }),
				info.iot ? row({ icon: 'antenna', label: 'Thread & Bluetooth', sub: 'Smart-home radio: Thread border router, Bluetooth LE', href: '#/more/iot' }) : null),
			lbl('Software'),
			group(
				row({ icon: 'services', label: 'Services & schedules', sub: 'Start, stop, run at boot, scheduled tasks', href: '#/more/services' }),
				row({ icon: 'package', label: 'Packages', sub: 'Installed apps, find and install, updates', href: '#/more/packages' }),
				row({ icon: 'log', label: 'System log', sub: 'Recent messages from the router', onClick: () => openLog() }),
				row({ icon: 'system', label: 'Advanced settings (LuCI)', sub: 'Every option, for experts', href: '/cgi-bin/luci/', target: '_blank' }))
		);
	}

	/* ======================= monitoring ======================= */
	async function monitor(page) {
		const { h, every, fmt, info, icon } = App;
		head(page, 'System monitoring');
		if (needPlugin(page)) return;
		const b = info.boardinfo || {};
		page.append(h('p', { class: 'hint', style: { textAlign: 'center', marginTop: '-4px' } }, `${info.hostname || 'Router'} · ${b.model || ''}`));
		const cpuBox = h('div'), memBox = h('div'), loadBox = h('div'), upBox = h('div'), thBox = h('div');
		const thPill = h('span', { class: 'pill' });
		page.append(card('CPU', 'cpu', cpuBox), card('Memory', 'memory', memBox), card('Load average', 'gauge', loadBox),
			card('Uptime', 'clock', upBox),
			h('div', { class: 'card' }, h('div', { class: 'card-head ruled' }, icon('thermo'), h('span', { class: 'grow' }, 'Temperatures'), thPill), thBox));
		const cpu = CpuMeter();
		every(3000, async () => {
			const st = await sx('stat');
			if (!st || !st.mem) return;
			const p = cpu(st), m = st.mem;
			const avail = m.MemAvailable || (m.MemFree + (m.Cached || 0) + (m.Buffers || 0));
			const pct = Math.round((1 - avail / m.MemTotal) * 1000) / 10;
			const bar = (v, warn, bad) => h('div', { class: 'meter' }, h('i', { class: v >= bad ? 'bad' : v >= warn ? 'warn' : '', style: { width: Math.min(100, v) + '%' } }));
			cpuBox.replaceChildren(p == null ? h('p', { class: 'hint' }, 'Measuring…') : bar(p, 70, 90),
				kv([['Usage', p == null ? '…' : p.toFixed(1) + '%'], ['Cores', String(st.cpus)], ['Processes', String(st.procs)], ['1 minute load', st.load[0].toFixed(2)]]));
			memBox.replaceChildren(bar(pct, 80, 92), kv([['Used', `${pct}%  ·  ${fmt.bytes(m.MemTotal - avail)}`], ['Available', fmt.bytes(avail)], ['Free', fmt.bytes(m.MemFree)],
				['Cached', fmt.bytes(m.Cached || 0)], ['Buffers', fmt.bytes(m.Buffers || 0)], ['Total', fmt.bytes(m.MemTotal)],
				m.SwapTotal ? ['Swap used', `${fmt.bytes(m.SwapTotal - m.SwapFree)} of ${fmt.bytes(m.SwapTotal)}`] : null]));
			loadBox.replaceChildren(kv([['1 minute', st.load[0].toFixed(2)], ['5 minutes', st.load[1].toFixed(2)], ['15 minutes', st.load[2].toFixed(2)]]),
				h('p', { class: 'hint', style: { margin: '10px 0 0' } }, `Below ${st.cpus} means the processor keeps up with the work.`));
			upBox.replaceChildren(kv([['Running for', fmt.duration(st.uptime)], ['Since', new Date(Date.now() - st.uptime * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })]]));
			const temps = (st.temps || []).filter(x => x.temp > -40000 && x.temp < 150000).sort((a, b) => b.temp - a.temp);
			const hot = temps.length ? temps[0].temp / 1000 : null;
			thPill.className = 'pill ' + (hot == null ? 'mute' : hot >= 85 ? 'bad' : hot >= 65 ? 'warn' : '');
			thPill.textContent = hot == null ? 'No sensors' : hot >= 85 ? 'Hot' : hot >= 65 ? 'Warm' : 'Normal';
			thBox.replaceChildren(...(temps.length ? [kv([['Hottest', hot.toFixed(1) + ' °C']]),
				h('div', { class: 'hint', style: { margin: '12px 0 6px' } }, `Sensors (${temps.length})`),
				...temps.map(t => h('div', { class: 'tbl-row' }, h('span', h('div', zoneName(t.name)), h('div', { class: 'hint mono', style: { margin: 0 } }, t.path)),
					h('span', { class: 'pill ' + (t.temp >= 85000 ? 'bad' : t.temp >= 65000 ? 'warn' : '') }, (t.temp / 1000).toFixed(1) + ' °C')))]
				: [h('p', { class: 'hint', style: { margin: 0 } }, 'This router doesn\'t report temperatures.')]));
		});
	}

	/* ======================= storage ======================= */
	async function storage(page) {
		const { h, fmt, btn, icon } = App;
		const reload = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Refresh', onclick: () => draw() }, icon('refresh'));
		head(page, 'Storage', reload);
		if (needPlugin(page)) return;
		const body = h('div', h('div', { class: 'skeleton' }));
		page.append(body);
		async function draw() {
			const st = await sx('storage');
			if (!st || !st.mounts) return body.replaceChildren(App.note('Could not read the storage information.', 'bad'));
			const ms = st.mounts.filter(m => !/^(\/dev|\/sys|\/proc)(\/|$)/.test(m.mount));
			const main = ms.find(m => m.mount === '/overlay') || ms.find(m => m.mount === '/') || ms[0];
			const pct = m => m.size ? Math.round(m.used / m.size * 1000) / 10 : 0;
			const meter = m => h('div', { class: 'meter' }, h('i', { class: pct(m) >= 90 ? 'bad' : pct(m) >= 75 ? 'warn' : '', style: { width: pct(m) + '%' } }));
			const [ovDev, ovType] = (st.overlay || '').split(' ');
			body.replaceChildren(
				App.sectionTitle('Space for settings and apps', null, 'storage'),
				main ? h('div', { class: 'card' },
					h('div', { class: 'card-head' }, h('span', { class: 'grow' }, main.mount === '/overlay' ? 'Writable storage' : 'Main storage'), h('span', { class: 'pill ' + (pct(main) >= 90 ? 'bad' : pct(main) >= 75 ? 'warn' : 'acc') }, pct(main) + '% used')),
					meter(main),
					h('div', { class: 'stats' },
						h('div', h('div', { class: 'k' }, 'Total'), h('div', { class: 'v' }, fmt.bytes(main.size))),
						h('div', h('div', { class: 'k' }, 'Used'), h('div', { class: 'v' }, fmt.bytes(main.used))),
						h('div', h('div', { class: 'k' }, 'Free'), h('div', { class: 'v' }, fmt.bytes(main.avail))))) : null,
				ovDev ? [App.sectionTitle('Overlay', null, 'box'), card(null, null, h('div', { class: 'card-head ruled' }, icon('vpn'), h('span', `Overlay active on ${ovDev}`)),
					kv([['Mount point', '/overlay'], ['Device', ovDev], ['Type', (ovType || '').toUpperCase()], main ? ['Free', fmt.bytes(main.avail)] : null]))] : null,
				App.sectionTitle(`Mounted storage (${ms.length})`, null, 'storage'),
				h('div', { class: 'cards' }, ms.map(m => h('div', { class: 'citem', style: { cursor: 'default' } },
					h('span', { class: 'bub', style: { background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' } }, icon('storage')),
					h('span', { class: 'main' }, h('div', { class: 't' }, m.mount), h('div', { class: 's' }, `${m.device} · ${m.type || '?'}`)),
					h('span', { class: 'side' }, h('div', `${pct(m)}% used`), h('div', `${fmt.bytes(m.used)} / ${fmt.bytes(m.size)}`))))),
				h('p', { class: 'hint' }, 'Read-only parts of the firmware (like /rom) always show as full. That is normal.'));
		}
		draw();
	}

	/* ======================= realtime charts ======================= */
	async function charts(page) {
		const { h, seg, every, call, info, select } = App;
		head(page, 'Realtime charts');
		let ms = 2000, win = 60;
		const devs = await call('network.device', 'status', {}) || {};
		const ifs = await Data.interfaces();
		const up = Data.uplink(ifs);
		const names = Object.keys(devs).filter(n => n !== 'lo' && devs[n] && typeof devs[n] === 'object' && 'statistics' in devs[n] && devs[n].up !== false).sort();
		let dev = up ? (up.l3_device || up.device) : names[0];
		const pick = select(names.length ? names : ['—'], dev);
		const cpuC = LiveChart({ points: 30, fmt: v => Math.round(v) + '%', fixedMax: 100 });
		const memC = LiveChart({ points: 30, fmt: v => Math.round(v) + '%', fixedMax: 100 });
		const netC = LiveChart({ lines: 2, points: 30, fmt: rateLabel, min: 1e5 });
		const cpuL = h('b', '—'), memL = h('b', '—'), rxL = h('b', '—'), txL = h('b', '—');
		const pts = () => Math.round(win * 1000 / ms);
		const resize = () => { [cpuC, memC, netC].forEach(c => c.resize(pts())); };
		let stopper = null;
		const start = () => { stopper && stopper(); stopper = every(ms, tick); };
		page.append(
			h('div', { class: 'card' },
				h('div', { class: 'card-head' }, h('span', { class: 'grow' }, 'Update every')),
				seg([[1000, '1 s'], [2000, '2 s'], [5000, '5 s']], ms, v => { ms = +v; resize(); start(); }),
				h('div', { class: 'card-head', style: { marginTop: '14px' } }, h('span', { class: 'grow' }, 'Show the last')),
				seg([[30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min']], win, v => { win = +v; resize(); })),
			info.plugin ? [App.sectionTitle('CPU usage', null, 'cpu'), h('div', { class: 'card' }, h('div', { class: 'legend-pills' }, h('span', h('i'), 'CPU ', cpuL)), cpuC.el),
				App.sectionTitle('Memory usage', null, 'memory'), h('div', { class: 'card' }, h('div', { class: 'legend-pills' }, h('span', { class: 'c2' }, h('i'), 'Memory ', memL)), memC.el)] : null,
			App.sectionTitle('Network traffic', null, 'chart'),
			h('div', { class: 'card' },
				h('div', { class: 'group', style: { boxShadow: 'none', border: '1px solid var(--line)', marginBottom: '10px' } }, App.field('Port or interface', pick)),
				h('div', { class: 'legend-pills' }, h('span', h('i'), 'Download ', rxL), h('span', { class: 'c2' }, h('i'), 'Upload ', txL)), netC.el));
		memC.el.querySelector('path.l1').style.stroke = 'var(--info)';
		memC.el.querySelector('path.a1').style.fill = 'color-mix(in srgb, var(--info) 10%, transparent)';
		pick.onchange = () => { dev = pick.value; last = null; netC.clear(); };
		resize();
		const cpu = CpuMeter();
		let last = null;
		async function tick() {
			const [st, d] = await Promise.all([info.plugin ? sx('stat') : null, dev ? call('network.device', 'status', { name: dev }) : null]);
			if (st && st.mem) {
				const p = cpu(st);
				if (p != null) { cpuC.push(p); cpuL.textContent = p.toFixed(1) + '%'; }
				const m = st.mem, used = (1 - (m.MemAvailable || m.MemFree) / m.MemTotal) * 100;
				memC.push(used); memL.textContent = used.toFixed(1) + '%';
			}
			if (d && d.statistics) {
				const now = performance.now(), s = d.statistics;
				if (last) {
					const dt = (now - last.t) / 1000;
					const rx = Math.max(0, (s.rx_bytes - last.rx) * 8 / dt), tx = Math.max(0, (s.tx_bytes - last.tx) * 8 / dt);
					netC.push([rx, tx]); rxL.textContent = rateLabel(rx); txL.textContent = rateLabel(tx);
				}
				last = { t: now, rx: s.rx_bytes, tx: s.tx_bytes };
			}
		}
		start();
	}

	/* ======================= network tools ======================= */
	async function tools(page) {
		const { h, seg, btn, busy, icon, toggle, every, sleep } = App;
		head(page, 'Network tools');
		if (needPlugin(page)) return;
		const ifs = await Data.interfaces();
		const up = Data.uplink(ifs);
		const gw = up && (up.route || []).map(r => r.nexthop).find(x => x && x !== '0.0.0.0');
		let tool = 'ping';
		const target = h('input', { class: 'inp', value: 'openwrt.org', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Name or address', enterkeyhint: 'go',
			onkeydown: e => { if (e.key === 'Enter') run.click(); } });
		const count = App.select([['3', '3 packets'], ['5', '5 packets'], ['10', '10 packets']], '3');
		const six = toggle(false, null, 'Use IPv6');
		const quick = h('div', { class: 'quick' }, [gw ? ['Gateway (' + gw + ')', gw] : null, ['1.1.1.1', '1.1.1.1'], ['8.8.8.8', '8.8.8.8'], ['openwrt.org', 'openwrt.org']].filter(Boolean)
			.map(([l, v]) => h('button', { type: 'button', onclick: () => { target.value = v; } }, l)));
		const opts = h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px' } },
			h('div', { class: 'group', style: { flex: 1, boxShadow: 'none', border: '1px solid var(--line)' } }, App.field('Count', count)),
			h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, 'IPv6', six));
		const result = h('div');
		const run = btn('Start', () => busy(run, go));
		run.style.width = '100%'; run.style.marginTop = '12px';
		const form = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('span', { class: 'grow', id: 'tool-title' }, 'Ping a name or address')),
			target, quick, opts, run);
		const tablesBox = h('div', { hidden: true });
		const tabs = seg([['ping', 'Ping'], ['trace', 'Traceroute'], ['lookup', 'DNS lookup'], ['tables', 'Routes & ARP']], tool, v => {
			tool = v;
			form.hidden = v === 'tables'; result.hidden = v === 'tables'; tablesBox.hidden = v !== 'tables';
			opts.hidden = v !== 'ping' && v !== 'trace'; count.closest('.group').hidden = v !== 'ping';
			form.querySelector('#tool-title').textContent = { ping: 'Ping a name or address', trace: 'Trace the route to a name or address', lookup: 'Look up a name' }[v] || '';
			run.textContent = { ping: 'Start ping', trace: 'Start traceroute', lookup: 'Look up' }[v] || 'Start';
			result.replaceChildren();
			if (v === 'tables') drawTables();
		});
		tabs.classList.add('scroll');
		page.append(
			h('a', { class: 'card', href: '#/network/check', style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' } },
				h('span', { class: 'bub', style: { width: '42px', height: '42px', borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--good) 15%, transparent)', color: 'var(--good)' } }, icon('refresh')),
				h('span', { style: { flex: 1 } }, h('div', { style: { fontWeight: 640 } }, 'Connection check'), h('div', { class: 'hint', style: { margin: 0 } }, 'Tests every step to the internet and fixes common problems')),
				(c => { c.style.cssText = 'width:18px;height:18px;color:var(--muted);flex:none'; return c; })(icon('chev'))),
			tabs, form, result, tablesBox);
		run.textContent = 'Start ping';

		async function go() {
			const t = target.value.trim();
			if (!t) throw new Error('Type a name or address');
			const r = await sx('tool', { tool, target: t, count: +count.value, six: six.checked });
			if (r && r.error) throw new Error(r.error === 'busy' ? 'Another test is still running' : r.error);
			const out = h('pre', { class: 'out' }, '');
			const box = h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 'card-head' }, h('span', { class: 'spinner' }), h('span', { class: 'grow' }, 'Running…')), out);
			result.replaceChildren(box);
			for (let i = 0; i < 120; i++) {
				await sleep(i ? 1000 : 400);
				const s = await sx('tool-status');
				if (!s) continue;
				out.textContent = s.output || '';
				if (s.state === 'done' || s.state === 'failed') { result.replaceChildren(summary(s, t)); return; }
			}
		}
		function summary(s, t) {
			const out = s.output || '';
			const raw = h('details', { style: { marginTop: '12px' } }, h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, 'Raw output'), h('pre', { class: 'out' }, out));
			if (tool === 'ping') {
				const m = out.match(/(\d+) packets transmitted, (\d+) (?:packets )?received.*?(\d+(?:\.\d+)?)% packet loss/s);
				const rt = out.match(/= ([\d.]+)\/([\d.]+)\/([\d.]+)/);
				const lines = out.split('\n').filter(l => /seq=/.test(l));
				const loss = m ? +m[3] : 100;
				return h('div', { class: 'card', style: { marginTop: '14px' } },
					h('div', { class: 'card-head' }, App.icon(loss < 100 ? 'vpn' : 'close'), h('span', { class: 'grow' }, `Ping to ${t}`), h('span', { class: 'pill ' + (loss === 0 ? '' : loss < 100 ? 'warn' : 'bad') }, `${loss}% loss`)),
					rt ? h('div', { class: 'stats four' },
						h('div', h('div', { class: 'v' }, rt[1] + ' ms'), h('div', { class: 's' }, 'Fastest')),
						h('div', h('div', { class: 'v acc' }, rt[2] + ' ms'), h('div', { class: 's' }, 'Average')),
						h('div', h('div', { class: 'v' }, rt[3] + ' ms'), h('div', { class: 's' }, 'Slowest')),
						h('div', h('div', { class: 'v' }, m ? `${m[2]} / ${m[1]}` : '—'), h('div', { class: 's' }, 'Replies'))) :
						h('p', { class: 'hint', style: { margin: 0 } }, /bad address|unknown host|resolve/i.test(out) ? 'That name could not be found.' : 'No replies. The address may be down, or blocks ping.'),
					lines.length ? [h('div', { class: 'hint', style: { margin: '14px 0 4px' } }, 'Replies'), lines.map(l => {
						const ms = (l.match(/time=([\d.]+)/) || [])[1];
						return h('div', { class: 'tbl-row mono' }, h('span', (l.match(/seq=\d+/) || [''])[0] + '  ' + (l.match(/ttl=\d+/) || [''])[0]), h('span', { style: { color: 'var(--accent)', fontWeight: 600 } }, ms ? ms + ' ms' : ''));
					})] : null, raw);
			}
			if (tool === 'lookup') {
				const addrs = [...out.matchAll(/Address(?: \d+)?:\s*([0-9a-fA-F.:]+)(?!#)/g)].map(x => x[1]).filter((a, i) => i > 0 || !/#53/.test(out.split('\n')[1] || ''));
				const server = (out.match(/Server:\s*(\S+)/) || [])[1];
				const ans = out.split(/Name:\s*/).slice(1).flatMap(b => [...b.matchAll(/Address(?: \d+)?:\s*([0-9a-fA-F.:]+)/g)].map(x => x[1]));
				const list = ans.length ? ans : addrs.slice(1);
				return h('div', { class: 'card', style: { marginTop: '14px' } },
					h('div', { class: 'card-head' }, App.icon(list.length ? 'vpn' : 'close'), h('span', { class: 'grow' }, t), h('span', { class: 'pill ' + (list.length ? '' : 'bad') }, list.length ? `${list.length} address${list.length === 1 ? '' : 'es'}` : 'Not found')),
					server ? kv([['Asked', server]]) : null,
					[...new Set(list)].map(a => h('div', { class: 'tbl-row mono' }, h('span', a), h('span', { class: 'hint', style: { margin: 0 } }, a.includes(':') ? 'IPv6' : 'IPv4'))), raw);
			}
			const hops = out.split('\n').filter(l => /^\s*\d+\s/.test(l));
			return h('div', { class: 'card', style: { marginTop: '14px' } },
				h('div', { class: 'card-head' }, App.icon('tools'), h('span', { class: 'grow' }, `Route to ${t}`), h('span', { class: 'pill acc' }, `${hops.length} hops`)),
				hops.map(l => { const p = l.trim().split(/\s+/); const ms = (l.match(/([\d.]+) ms/) || [])[1];
					return h('div', { class: 'tbl-row mono' }, h('span', `${p[0].padStart(2)}  ${p[1] === '*' ? '* (no answer)' : p[1]}`), h('span', { style: { color: 'var(--accent)' } }, ms ? ms + ' ms' : '')); }), raw);
		}
		async function drawTables() {
			tablesBox.replaceChildren(h('div', { class: 'skeleton' }));
			const t = await sx('tables');
			if (!t) return tablesBox.replaceChildren(App.note('Could not read the tables.', 'bad'));
			const neigh = (t.neigh || '').split('\n').filter(Boolean).map(l => {
				const p = l.split(/\s+/), mac = p[p.indexOf('lladdr') + 1];
				return { ip: p[0], dev: p[p.indexOf('dev') + 1], mac: p.includes('lladdr') ? mac : '', state: p[p.length - 1] };
			});
			const routes = s => (s || '').split('\n').filter(Boolean);
			tablesBox.replaceChildren(
				App.sectionTitle(`Neighbours / ARP (${neigh.length})`, null, 'devices'),
				h('div', { class: 'card' }, neigh.length ? neigh.map(n => h('div', { class: 'tbl-row' },
					h('span', h('div', { class: 'mono' }, n.ip), h('div', { class: 'hint mono', style: { margin: 0 } }, App.fmt.mac(n.mac) || '—')),
					h('span', { style: { textAlign: 'right' } }, h('div', n.dev), h('span', { class: 'pill ' + (n.state === 'REACHABLE' ? '' : n.state === 'FAILED' ? 'bad' : 'mute') }, n.state.toLowerCase())))) : h('p', { class: 'hint' }, 'Empty')),
				App.sectionTitle('IPv4 routes', null, 'interfaces'), h('pre', { class: 'out' }, routes(t.route).join('\n') || 'None'),
				App.sectionTitle('IPv6 routes', null, 'interfaces'), h('pre', { class: 'out' }, routes(t.route6).join('\n') || 'None'),
				h('div', { class: 'btn-row' }, App.btn('Refresh', drawTables, 'secondary')));
		}
	}

	/* ======================= services & schedules ======================= */
	const CRON_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	function cronParse(text) {
		return (text || '').split('\n').map((l, i) => {
			let on = true, s = l.trim();
			if (/^#\s*([\d*@])/.test(s) && /^#\s*(@\w+\s+\S|(\S+\s+){5}\S)/.test(s)) { on = false; s = s.replace(/^#\s*/, ''); }
			else if (!s || s[0] === '#') return { line: l, i, comment: true };
			let when, cmd;
			if (s[0] === '@') { const p = s.split(/\s+/); when = p[0]; cmd = p.slice(1).join(' '); }
			else { const p = s.split(/\s+/); when = p.slice(0, 5).join(' '); cmd = p.slice(5).join(' '); }
			return { line: l, i, on, when, cmd };
		});
	}
	function cronText(items) { return items.map(t => t.comment ? t.line : (t.on ? '' : '# ') + t.when + ' ' + t.cmd).join('\n').replace(/\n+$/, '') + '\n'; }
	function cronHuman(w) {
		if (w === '@reboot') return 'At every start-up';
		if (w === '@hourly') return 'Every hour';
		if (w === '@daily' || w === '@midnight') return 'Every day at midnight';
		if (w === '@weekly') return 'Every Sunday at midnight';
		const [m, hh, dom, mon, dow] = w.split(' ');
		const pad = n => String(n).padStart(2, '0');
		const at = /^\d+$/.test(m) && /^\d+$/.test(hh) ? `at ${pad(hh)}:${pad(m)}` : null;
		if (/^\*\/\d+$/.test(m) && hh === '*' && dom === '*' && mon === '*' && dow === '*') return `Every ${m.slice(2)} minutes`;
		if (/^\d+$/.test(m) && hh === '*' && dom === '*' && mon === '*' && dow === '*') return `Every hour at :${pad(m)}`;
		if (at && dom === '*' && mon === '*' && dow === '*') return `Every day ${at}`;
		if (at && dom === '*' && mon === '*' && /^[0-7]$/.test(dow)) return `Every ${CRON_DAYS[+dow % 7]} ${at}`;
		if (at && dom === '*' && mon === '*' && dow === '1-5') return `Weekdays ${at}`;
		if (at && /^\d+$/.test(dom) && mon === '*' && dow === '*') return `Day ${dom} of every month ${at}`;
		return `Schedule: ${w}`;
	}

	async function services(page) {
		const { h, btn, busy, icon, toggle, toast, confirm } = App;
		head(page, 'Services & schedules');
		if (needPlugin(page)) return;
		const svcBox = h('div', h('div', { class: 'skeleton' }));
		const cronBox = h('div', h('div', { class: 'skeleton' }));
		const search = h('input', { class: 'search', type: 'search', placeholder: 'Search services…', oninput: () => drawSvc() });
		const addBtn = btn('Add task', () => editTask(null), 'small');
		addBtn.prepend(icon('plus'));
		page.append(
			App.sectionTitle('Scheduled tasks', addBtn, 'clock'), cronBox,
			App.sectionTitle(['Services', App.explain('Services', 'Services are the programs that run in the background: the DNS server, the firewall, the VPN and so on.',
				'"Starts at boot" decides whether a service starts by itself when the router starts. "Restart" is the usual fix when a service misbehaves.',
				{ rec: 'Leave services you don\'t recognise as they are. Stopping network, firewall, dnsmasq or the web server can cut you off from the router.' })], null, 'services'),
			search, svcBox);

		let list = [];
		async function loadSvc() { const r = await sx('services'); list = (r && r.services) || []; drawSvc(); }
		function drawSvc() {
			const q = search.value.trim().toLowerCase();
			const shown = list.filter(s => !q || s.name.toLowerCase().includes(q));
			const run = list.filter(s => s.running).length;
			svcBox.replaceChildren(h('p', { class: 'hint', style: { margin: '0 4px 10px' } }, `${list.length} services · ${run} running`),
				h('div', { class: 'cards' }, shown.map(s => {
					const en = toggle(s.enabled, async e => {
						const r = await sx('service', { name: s.name, trigger: e.target.checked ? 'enable' : 'disable' });
						if (r && r.error) { e.target.checked = !e.target.checked; return toast(r.error, { bad: true }); }
						s.enabled = e.target.checked; toast(s.enabled ? `${s.name} starts at boot` : `${s.name} won't start at boot`);
					}, 'Starts at boot');
					const act = (a, label) => h('button', { class: 'icon-btn' + (a === 'stop' ? ' danger' : ''), type: 'button', 'aria-label': `${label} ${s.name}`, title: label, onclick: async () => {
						if (a === 'stop' && /^(firewall|dnsmasq|dropbear|odhcpd)$/.test(s.name) && !await confirm(`Stop ${s.name}?`, 'Devices may lose the internet or name lookups until you start it again or restart the router.', 'Stop', true)) return;
						const r = await sx('service', { name: s.name, trigger: a });
						if (r && r.error) return toast(r.error, { bad: true });
						toast(`${label}: ${s.name}`); setTimeout(loadSvc, 2500);
					} }, icon(a === 'restart' ? 'refresh' : a === 'stop' ? 'pause' : 'play'));
					return h('div', { class: 'citem', style: { cursor: 'default' } },
						h('span', { class: 'main' }, h('div', { class: 't' }, s.name, h('span', { class: 'pill ' + (s.running ? '' : 'mute') }, s.running ? 'Running' : s.kind === 'procd' ? 'Stopped' : 'Script')),
							h('div', { class: 's', style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' } }, en, 'Starts at boot')),
						h('span', { class: 'list-actions' }, s.running ? act('restart', 'Restart') : null, s.running ? act('stop', 'Stop') : act('start', 'Start')));
				})));
		}

		let tasks = [], cronOn = true;
		async function loadCron() {
			const r = await sx('cron-get');
			tasks = cronParse(r && r.text); cronOn = !r || r.enabled !== false; drawCron();
		}
		async function saveCron(msg) {
			const r = await sx('cron-set', { text: cronText(tasks) });
			if (r && r.error) throw new Error(r.error);
			toast(msg || 'Saved'); await loadCron();
		}
		function drawCron() {
			const real = tasks.filter(t => !t.comment);
			cronBox.replaceChildren(real.length ? h('div', { class: 'card' }, real.map((t, k) => {
				const ours = /home-ui\/sysx night/.test(t.cmd);
				const tog = toggle(t.on, async e => { t.on = e.target.checked; try { await saveCron(t.on ? 'Task on' : 'Task paused'); } catch (x) { toast(x.message, { bad: true }); } }, 'Task on');
				return h('div', { class: 'row', style: { padding: '10px 0', minHeight: 0 } },
					h('span', { class: 'ic' }, icon('clock')),
					h('span', { class: 'main' },
						h('div', { class: 'label mono', style: { whiteSpace: 'normal', overflowWrap: 'anywhere' } }, ours ? (/night off/.test(t.cmd) ? 'Lights off (night mode)' : 'Lights on (night mode)') : t.cmd),
						h('div', { class: 'sub' }, cronHuman(t.when), t.on ? null : h('span', { class: 'pill mute' }, 'Paused'))),
					ours ? h('a', { class: 'btn small secondary', href: '#/more/lights' }, 'Lights') : [tog,
						h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Edit', onclick: () => editTask(t) }, icon('edit')),
						h('button', { class: 'icon-btn danger', type: 'button', 'aria-label': 'Delete', onclick: async () => {
							if (!await confirm('Delete this task?', t.cmd, 'Delete', true)) return;
							tasks = tasks.filter(x => x !== t); try { await saveCron('Deleted'); } catch (x) { toast(x.message, { bad: true }); }
						} }, icon('trash'))]);
			})) : h('div', { class: 'card empty' }, 'No scheduled tasks. Add one to run a command at a set time, for example a nightly restart.'),
			cronOn ? null : App.note('The task scheduler (cron) is off. Saving a task turns it on.', 'warn'));
		}

		function editTask(t) {
			const { field, input, select, seg } = App;
			const w = t ? t.when : '0 4 * * *';
			const p = w.split(' ');
			let kind = w === '@reboot' ? 'boot' : /^\*\/\d+ \* \* \* \*$/.test(w) ? 'minutes' : /^\d+ \* \* \* \*$/.test(w) ? 'hourly' : /^\d+ \d+ \* \* \*$/.test(w) ? 'daily' : /^\d+ \d+ \* \* [0-6]$/.test(w) ? 'weekly' : 'custom';
			const time = input({ type: 'time', value: /^\d+$/.test(p[1] || '') ? `${String(p[1]).padStart(2, '0')}:${String(p[0]).padStart(2, '0')}` : '04:00' });
			const every = select([['5', '5 minutes'], ['10', '10 minutes'], ['15', '15 minutes'], ['30', '30 minutes']], kind === 'minutes' ? p[0].slice(2) : '15');
			const day = select(CRON_DAYS.map((d, i) => [String(i), d]), kind === 'weekly' ? p[4] : '0');
			const custom = input({ value: w, class: 'mono', autocapitalize: 'off', spellcheck: 'false' });
			const cmd = input({ value: t ? t.cmd : '', placeholder: 'reboot', class: 'mono', autocapitalize: 'off', spellcheck: 'false' });
			const fTime = field('Time', time), fEvery = field('Every', every), fDay = field('Day', day), fCustom = field('Schedule (minute hour day month weekday)', custom);
			const show = () => { fTime.hidden = !/daily|weekly/.test(kind); fEvery.hidden = kind !== 'minutes'; fDay.hidden = kind !== 'weekly'; fCustom.hidden = kind !== 'custom'; };
			const kinds = seg([['daily', 'Daily'], ['weekly', 'Weekly'], ['hourly', 'Hourly'], ['minutes', 'Minutes'], ['boot', 'At start'], ['custom', 'Custom']], kind, v => { kind = v; show(); });
			kinds.classList.add('scroll');
			show();
			App.sheet(t ? 'Edit task' : 'New task', close => {
				const save = btn('Save', () => busy(save, async () => {
					const c = cmd.value.trim();
					if (!c) throw new Error('Type the command to run');
					const [hh, mm] = (time.value || '04:00').split(':').map(Number);
					const when = kind === 'boot' ? '@reboot' : kind === 'minutes' ? `*/${every.value} * * * *` : kind === 'hourly' ? `${p[0] && /^\d+$/.test(p[0]) && t ? p[0] : 0} * * * *`
						: kind === 'daily' ? `${mm} ${hh} * * *` : kind === 'weekly' ? `${mm} ${hh} * * ${day.value}` : custom.value.trim().replace(/\s+/g, ' ');
					if (kind === 'custom' && !/^(@\w+|(\S+ ){4}\S+)$/.test(when)) throw new Error('A schedule has 5 parts, like 0 4 * * *');
					if (t) { t.when = when; t.cmd = c; t.on = true; } else tasks.push({ when, cmd: c, on: true });
					await saveCron(t ? 'Task saved' : 'Task added'); close();
				}));
				return h('div', kinds, h('div', { class: 'group', style: { marginTop: '12px' } }, fTime, fEvery, fDay, fCustom, field('Command', cmd)),
					h('div', { class: 'quick' }, [['Restart the router', 'reboot'], ['Restart WiFi', 'wifi'], ['Reconnect the internet', 'ifup wan']].map(([l, v]) => h('button', { type: 'button', onclick: () => { cmd.value = v; } }, l))),
					App.hint('Commands run as the administrator, so double-check them. The time is the router\'s time zone (System settings).'),
					h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), save));
			});
		}

		loadCron(); loadSvc();
	}

	/* ======================= packages ======================= */
	async function packages(page) {
		const { h, btn, busy, icon, seg, toast, confirm, sleep } = App;
		const refresh = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Refresh package lists', onclick: () => job('update', [], 'Refreshing the package lists…') }, icon('refresh'));
		head(page, 'Packages', refresh);
		if (needPlugin(page)) return;
		let tab = 'installed', inst = null, upg = null, mgr = '';
		const search = h('input', { class: 'search', type: 'search', placeholder: 'Search installed packages…' });
		const tabs = seg([['installed', 'Installed'], ['find', 'Find & install'], ['updates', 'Updates']], tab, v => { tab = v; search.value = ''; draw(); });
		const body = h('div', h('div', { class: 'skeleton' }));
		page.append(tabs, h('div', { style: { height: '12px' } }), search, body);
		let tmr;
		search.oninput = () => { clearTimeout(tmr); tmr = setTimeout(draw, tab === 'find' ? 600 : 100); };
		search.onkeydown = e => { if (e.key === 'Enter') { clearTimeout(tmr); draw(); } };

		const label = () => { tabs.children[0].textContent = inst ? `Installed ${inst.length}` : 'Installed'; tabs.children[2].textContent = upg && upg.length ? `Updates ${upg.length}` : 'Updates'; };
		const item = (p, action) => h('div', { class: 'citem', style: { cursor: 'default' } },
			h('span', { class: 'bub', style: { background: 'color-mix(in srgb, var(--good) 14%, transparent)', color: 'var(--good)' } }, icon('package')),
			h('span', { class: 'main' }, h('div', { class: 't' }, p.name, p.user ? h('span', { class: 'pill acc' }, 'Added') : null),
				h('div', { class: 's', style: { whiteSpace: 'normal' } }, [p.version ? (p.from ? `${p.from} → ${p.version}` : p.version) : null, p.description].filter(Boolean).join(' · '))),
			action);

		async function draw() {
			const q = search.value.trim();
			if (tab === 'installed') {
				search.placeholder = 'Search installed packages…';
				if (!inst) { body.replaceChildren(h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })); const r = await sx('pkg-list'); inst = (r && r.packages) || []; mgr = r && r.manager; label(); }
				const shown = inst.filter(p => !q || p.name.includes(q.toLowerCase())).sort((a, b) => (b.user - a.user) || a.name.localeCompare(b.name));
				body.replaceChildren(h('p', { class: 'hint', style: { margin: '0 4px 10px' } }, `${inst.length} installed · ${inst.filter(p => p.user).length} added by you or by an add-on · ${mgr === 'apk' ? 'apk' : 'opkg'}`),
					h('div', { class: 'cards' }, shown.slice(0, 200).map(p => item(p, p.user && p.name !== 'home-ui' ? h('button', { class: 'btn small outline danger', type: 'button', onclick: async () => {
						if (!await confirm(`Remove ${p.name}?`, 'Other apps that need it may stop working. Packages that came with the firmware come back after a reset anyway.', 'Remove', true)) return;
						job('remove', [p.name], `Removing ${p.name}…`);
					} }, 'Remove') : null))),
					shown.length > 200 ? App.hint(`Showing 200 of ${shown.length}. Search to narrow it down.`) : null);
			} else if (tab === 'find') {
				search.placeholder = 'Find a package, e.g. luci-app, wireguard…';
				if (q.length < 2) return body.replaceChildren(h('div', { class: 'card empty' }, 'Type at least 2 letters to search the OpenWrt package lists.'));
				body.replaceChildren(h('div', { class: 'skeleton' }));
				const r = await sx('pkg-search', { text: q });
				if (r && r.error) return body.replaceChildren(App.note(r.error, 'warn'));
				const res = (r && r.packages) || [];
				if (!inst) { const x = await sx('pkg-list'); inst = (x && x.packages) || []; label(); }
				const have = new Set(inst.map(p => p.name));
				body.replaceChildren(res.length ? h('div', { class: 'cards' }, res.map(p => item(p, have.has(p.name) ? h('span', { class: 'pill' }, 'Installed') :
					h('button', { class: 'btn small outline', type: 'button', onclick: () => job('install', [p.name], `Installing ${p.name}…`) }, 'Install'))))
					: h('div', { class: 'card empty' }, 'Nothing found. If you never refreshed the package lists, tap ', icon('refresh'), ' at the top first.'));
			} else {
				search.placeholder = 'Search updates…';
				if (!upg) { body.replaceChildren(h('div', { class: 'skeleton' })); const r = await sx('pkg-upgradable'); upg = (r && r.packages) || []; label(); }
				const shown = upg.filter(p => !q || p.name.includes(q.toLowerCase()));
				body.replaceChildren(App.note('Updating single packages is fine for apps you added. For the core system, updating the whole firmware (System settings → Update firmware) is safer.', 'warn'),
					shown.length ? h('div', { class: 'cards' }, shown.map(p => item(p, h('button', { class: 'btn small outline', type: 'button', onclick: () => job('upgrade', [p.name], `Updating ${p.name}…`) }, 'Update'))))
						: h('div', { class: 'card empty' }, 'Everything is up to date (as of the last list refresh).'));
			}
		}

		async function job(trigger, names, title) {
			const r = await sx('pkg', { trigger, names: names.join(' ') });
			if (r && r.error) return toast(r.error === 'busy' ? 'Another package job is running' : r.error, { bad: true });
			const msg = h('p', { style: { margin: '4px 2px' } }, title), log = h('pre', { class: 'out' }, '');
			const s = App.sheet('Packages', h('div', h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, h('span', { class: 'spinner' }), msg), log), { modal: true });
			for (let i = 0; i < 400; i++) {
				await sleep(1500);
				const st = await sx('pkg-status');
				if (!st) continue;
				if (st.message) msg.textContent = st.message;
				if (st.log) log.textContent = st.log;
				if (st.state === 'done' || st.state === 'failed') {
					s.close();
					toast(st.state === 'done' ? ({ update: 'Package lists refreshed', install: 'Installed', remove: 'Removed', upgrade: 'Updated' }[trigger]) : st.message, st.state === 'done' ? null : { bad: true });
					inst = null; upg = null; draw();
					return;
				}
			}
			s.close();
		}
		draw();
	}

	/* ======================= lights ======================= */
	const ledName = n => {
		const p = n.split(':');
		const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
		if (p.length >= 2) return `${cap(p[p.length - 2] || p[0])} · ${p[p.length - 1].replace(/[-_]/g, ' ')}`;
		return cap(n.replace(/[-_]/g, ' '));
	};
	const TRIG = { none: 'Off / on', 'default-on': 'Always on', timer: 'Blink', heartbeat: 'Heartbeat', netdev: 'Network activity', 'activity': 'CPU activity', 'disk-activity': 'Storage activity', panic: 'On a crash', mmc0: 'SD card' };
	async function lights(page) {
		const { h, toggle, icon, toast, btn, busy, input, field, select, info } = App;
		head(page, 'Lights');
		if (needPlugin(page)) return;
		const nightBox = h('div'), list = h('div', { class: 'cards' }, h('div', { class: 'skeleton' }));
		page.append(App.sectionTitle('Night mode', null, 'clock'), nightBox,
			App.sectionTitle(['Every light', App.explain('Lights', 'Each light on the router can be switched off, kept on, or tied to something like network activity or a heartbeat blink.',
				'Your choice is saved, so it stays after a restart.', info.led ? 'The status light is managed by Router Home\'s "Show internet status on the light" setting while that is on; turn that off first if you want to control it here.' : '')], null, 'light'),
			list,
			info.led ? h('div', { class: 'btn-row' }, btn('Status light settings', () => openLed(), 'secondary')) : null);

		async function drawNight() {
			const n = await sx('night-get') || {};
			const now = toggle(n.now, async e => { const r = await sx('night', { trigger: e.target.checked ? 'off' : 'on' }); if (r && r.error) toast(r.error, { bad: true }); else { toast(e.target.checked ? 'Lights off' : 'Lights back on'); drawLeds(); } }, 'Lights off now');
			const sched = toggle(n.enabled, null, 'Turn off on a schedule');
			const off = input({ type: 'time', value: n.off || '23:00' }), on = input({ type: 'time', value: n.on || '07:00' });
			const times = h('div', { hidden: !n.enabled }, h('div', { class: 'group', style: { boxShadow: 'none', border: '1px solid var(--line)', display: 'grid', gridTemplateColumns: '1fr 1fr', marginTop: '10px' } }, field('Off at', off), field('On at', on)));
			const save = btn('Save schedule', () => busy(save, async () => {
				const r = await sx('night-set', { enabled: sched.checked, off: off.value, on: on.value });
				if (r && r.error) throw new Error(r.error);
				toast(sched.checked ? `Lights off every night at ${off.value}` : 'Schedule removed');
			}), 'small');
			sched.onchange = () => { times.hidden = !sched.checked; if (!sched.checked) save.click(); };
			times.append(h('div', { class: 'btn-row' }, save));
			nightBox.replaceChildren(h('div', { class: 'card' },
				h('div', { class: 'row', style: { padding: 0, minHeight: '48px' } }, h('span', { class: 'main' }, h('div', { class: 'label' }, 'All lights off now'), h('div', { class: 'sub' }, 'Until you switch them back on or restart')), now),
				h('div', { class: 'row', style: { padding: 0, minHeight: '48px' } }, h('span', { class: 'main' }, h('div', { class: 'label' }, 'Every night'), h('div', { class: 'sub' }, 'Dark at night, back on in the morning')), sched),
				times));
		}

		async function drawLeds() {
			const r = await sx('leds');
			const leds = (r && r.leds) || [];
			if (!leds.length) return list.replaceChildren(h('div', { class: 'card empty' }, 'This router doesn\'t expose any lights to software.'));
			list.replaceChildren(...leds.map(l => {
				const lit = l.trigger !== 'none' || l.brightness > 0;
				const sw = toggle(lit, async e => {
					const r2 = await sx('led-set', { name: l.name, trigger: e.target.checked ? 'default-on' : 'none', brightness: e.target.checked ? l.max : 0, persist: true });
					if (r2 && r2.error) return toast(r2.error, { bad: true });
					drawLeds();
				}, `${l.name} on`);
				const color = (l.name.match(/^(red|green|blue|white|amber|orange|yellow)/i) || [])[1];
				const tr = l.triggers.filter(t => !/^(phy\d|rfkill|mmc|usbport|kbd-|bluetooth|hci)/.test(t) || t === l.trigger);
				const sel = select(tr.map(t => [t, TRIG[t] || t]), l.trigger);
				sel.onchange = async () => {
					const r2 = await sx('led-set', { name: l.name, trigger: sel.value, brightness: l.max, persist: true });
					if (r2 && r2.error) return toast(r2.error, { bad: true });
					toast('Saved'); drawLeds();
				};
				const bright = l.max > 1 ? h('input', { type: 'range', min: 1, max: l.max, value: l.brightness || l.max, 'aria-label': 'Brightness', onchange: async e => {
					await sx('led-set', { name: l.name, trigger: 'none', brightness: +e.target.value, persist: true }); drawLeds();
				} }) : null;
				return h('div', { class: 'card' },
					h('div', { class: 'card-head', style: { marginBottom: '6px' } },
						h('span', { style: { width: '14px', height: '14px', borderRadius: '50%', flex: 'none', background: lit ? (color ? ({ amber: '#f0b429', orange: '#f97316', yellow: '#facc15' }[color.toLowerCase()] || color) : 'var(--accent)') : 'var(--line)', boxShadow: lit ? '0 0 8px ' + (color || 'var(--accent)') : 'none' } }),
						h('span', { class: 'grow' }, ledName(l.name), h('div', { class: 'hint mono', style: { margin: 0, fontWeight: 400 } }, l.name)), sw),
					h('div', { class: 'group', style: { boxShadow: 'none', border: '1px solid var(--line)' } }, field('Shows', sel)),
					bright && l.trigger === 'none' && l.brightness > 0 ? h('div', { style: { marginTop: '10px' } }, h('div', { class: 'hint', style: { margin: '0 0 4px' } }, 'Brightness'), bright) : null);
			}));
		}
		drawNight(); drawLeds();
	}

	/* ======================= appearance ======================= */
	function appearance(page) {
		const { h, icon } = App;
		head(page, 'Appearance');
		const PV = { light: ['#ffffff', '#f3f5f7', '#ffffff'], dark: ['#1f2226', '#16181b', '#1f2226'], black: ['#101113', '#000000', '#101113'], midnight: ['#142130', '#0c1520', '#142130'] };
		const modes = h('div', { class: 'theme-grid' });
		const accents = h('div', { class: 'accent-row' });
		function draw() {
			const m = Theme.mode(), a = Theme.accent();
			const acc = (Theme.ACCENTS.find(x => x[0] === a) || Theme.ACCENTS[0]);
			modes.replaceChildren(...Theme.MODES.map(([k, l]) => {
				const pv = k === 'auto' ? null : PV[k];
				const c = Theme.resolved() === 'light' && k === 'auto' ? acc[2] : (k === 'light' ? acc[2] : acc[3]);
				return h('button', { type: 'button', class: 'theme-opt', 'aria-pressed': String(m === k), onclick: () => { Theme.setMode(k); draw(); } },
					h('span', { class: 'pv', style: k === 'auto' ? { background: 'linear-gradient(135deg, #f3f5f7 50%, #16181b 50%)' } : { background: pv[1] } },
						h('i', { style: { background: pv ? pv[0] : 'transparent' } }), h('i', { style: { margin: '8px', borderRadius: '6px', background: pv ? pv[2] : 'transparent', boxShadow: pv ? 'inset 0 0 0 1px rgba(128,128,128,.25)' : 'none' } }),
						h('i', { style: { background: pv ? pv[0] : 'transparent', display: 'flex', justifyContent: 'center' } }, h('b', { style: { width: '10px', height: '10px', borderRadius: '50%', background: c, marginTop: '1px' } }))),
					l);
			}));
			accents.replaceChildren(...Theme.ACCENTS.map(([k, l, light, dark]) => h('button', { type: 'button', class: 'accent-opt', 'aria-pressed': String(a === k), 'aria-label': l, title: l,
				style: { background: Theme.resolved() === 'light' ? light : dark }, onclick: () => { Theme.setAccent(k); draw(); } }, a === k ? icon('check') : null)));
			name.textContent = Theme.name();
		}
		const name = h('span', { class: 'pill acc' });
		page.append(
			App.sectionTitle('Theme', name, 'palette'), h('div', { class: 'card' }, modes,
				App.hint('Automatic follows your phone or computer. Black saves battery on OLED screens. Midnight is the original Router Home look.')),
			App.sectionTitle('Accent color', null, 'palette'), h('div', { class: 'card' }, accents),
			App.sectionTitle('Preview', null, 'dashboard'),
			h('div', { class: 'card' },
				h('div', { class: 'row', style: { padding: 0 } }, h('span', { class: 'ic' }, icon('wifi')), h('span', { class: 'main' }, h('div', { class: 'label' }, 'Home WiFi', h('span', { class: 'pill' }, 'On')), h('div', { class: 'sub' }, '5 GHz · Ch 36 · WPA3')), App.toggle(true)),
				h('div', { class: 'btn-row' }, App.btn('Button', () => {}), App.btn('Secondary', () => {}, 'secondary'))),
			App.hint('Saved on this phone or computer only. The colors of the status light (blue, white, yellow, red) never change, so they always match the router.'));
		draw();
	}


	/* ======================= Thread & Bluetooth ======================= */
	const iotc = (action, p) => App.call('home-ui', 'iot', Object.assign({ action }, p || {}));
	const ROLE = { leader: ['Leader', ''], router: ['Router', ''], child: ['Connected (end device)', ''], detached: ['Looking for the network', 'warn'], disabled: ['Off', 'mute'] };
	async function iotPage(page) {
		const { h, btn, busy, icon, toggle, toast, confirm, sleep, field, input, sheet, every } = App;
		head(page, 'Thread & Bluetooth');
		if (needPlugin(page)) return;
		const body = h('div', h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
		page.append(body);
		let last = '';
		async function draw(force) {
			const st = await iotc('info');
			if (!st) return body.replaceChildren(App.note('Router Home did not answer.', 'bad'));
			const key = JSON.stringify(st);
			if (!force && key === last) return;
			last = key;
			const parts = [];
			const intro = h('p', { class: 'hint', style: { margin: '0 4px 12px' } },
				'This router has a Silicon Labs radio for Thread (smart-home devices, Matter) and Bluetooth LE. ',
				App.explain('Thread & Bluetooth',
					'Thread is the low-power mesh network many Matter devices use: door sensors, bulbs, plugs, locks. A Thread border router connects that mesh to your home network.',
					'With Home Assistant, this router can be its Thread radio, so you don\'t need a separate Thread dongle. Google Home and SmartThings still want their own hub as the controller.',
					'Bluetooth LE here can scan for nearby devices (phones, tags, sensors) and make the router visible. It is the base for presence detection and Bluetooth sensors.',
					{ rec: 'Turn on Thread if you use Home Assistant with Matter or Thread devices. Otherwise you can leave it off.' }));
			parts.push(intro);
			if (!st.tty) {
				parts.push(App.note('The radio\'s serial port is not enabled in this firmware. Build the firmware with the radio change (ipq9570-askey-iot-radio.dtsi or patch 0005), then come back.', 'warn'));
				return body.replaceChildren(...parts);
			}
			if (!st.installed) {
				const file = h('input', { type: 'file', accept: '.tar.gz,.tgz' });
				const go = btn('Install', () => busy(go, async () => {
					const f = file.files[0]; if (!f) throw new Error('Choose your iotkit.tar.gz');
					await upload(f, '/tmp/home-ui-iot.tar.gz');
					const r = await iotc('install');
					if (r && r.error) throw new Error(r.error);
					toast('Installed'); draw(true);
				}));
				parts.push(App.sectionTitle('Step 1: radio software', null, 'package'), h('div', { class: 'card' },
					h('p', { style: { margin: '0 0 10px' } }, 'The radio needs Silicon Labs\' programs: cpcd, otbr-agent with CPC, and cpc_hci_bridge. Router Home doesn\'t include them. The best way is to build them into the firmware from source (packages cpcd, otbr-cpc and cpc-hci-bridge); this page then finds them by itself. Or install your own iotkit.tar.gz here.'),
					h('div', { class: 'group', style: { boxShadow: 'none', border: '1px solid var(--line)' } }, field('iotkit.tar.gz', file)),
					h('div', { class: 'btn-row' }, go),
					h('p', { class: 'hint', style: { margin: '10px 0 0' } }, 'It is kept through firmware updates. Use only a kit made for your own router.')));
				return body.replaceChildren(...parts);
			}
			if (!st.paired) {
				const go = btn('Pair with the radio', () => busy(go, async () => {
					const r = await iotc('pair'); if (r && r.error) throw new Error(r.error === 'busy' ? 'Already pairing' : r.error);
					for (let i = 0; i < 60; i++) {
						await sleep(2000);
						const j = await iotc('pair-status');
						if (j && j.message) go.lastChild && (go.title = j.message);
						if (j && j.state === 'done') { toast(j.message); return draw(true); }
						if (j && j.state === 'failed') throw new Error(j.message);
					}
					throw new Error('Pairing took too long');
				}));
				parts.push(App.sectionTitle('Step 2: pair', null, 'lock'), h('div', { class: 'card' },
					h('p', { style: { margin: '0 0 10px' } }, 'The radio still expects the stock firmware\'s encryption key. Pairing removes the old pairing and makes a new key for this router. It takes about 20 seconds.'),
					h('div', { class: 'btn-row' }, go)));
				return body.replaceChildren(...parts);
			}
			const on = toggle(st.enabled, async e => {
				const r = await iotc('set', { enabled: e.target.checked }); if (r && r.error) toast(r.error, { bad: true });
				toast(e.target.checked ? 'Starting… (about 15 s)' : 'Stopped'); setTimeout(() => draw(true), e.target.checked ? 12000 : 1500);
			}, 'Radio on');
			const bleOn = toggle(st.ble_enabled, async e => { await iotc('set', { ble: e.target.checked }); toast('Saved'); setTimeout(() => draw(true), 8000); }, 'Bluetooth on');
			parts.push(h('div', { class: 'card' },
				h('div', { class: 'row', style: { padding: 0, minHeight: '48px' } }, h('span', { class: 'main' }, h('div', { class: 'label' }, 'Radio on'), h('div', { class: 'sub' }, st.cpcd ? 'Running' : 'Stopped')), on),
				h('div', { class: 'row', style: { padding: 0, minHeight: '48px' } }, h('span', { class: 'main' }, h('div', { class: 'label' }, 'Bluetooth LE'), h('div', { class: 'sub' }, st.bluetooth_kmod ? 'Uses the same radio' : 'Needs kmod-hci-uart in the firmware')), bleOn),
				h('p', { class: 'hint', style: { margin: '8px 0 0' } }, st.source === 'kit' ? 'Using the programs from your iotkit.' : 'Using the programs built into the firmware.'),
				st.source === 'kit' && st.packages ? h('div', { class: 'btn-row' }, btn('Use the built-in programs instead', async () => {
					if (!await confirm('Remove the iotkit?', 'The firmware has its own cpcd and otbr-agent now. The pairing key and Thread network stay.', 'Remove kit')) return;
					await iotc('remove'); await iotc('set', { enabled: true }); toast('Switched to the built-in programs'); setTimeout(() => draw(true), 12000);
				}, 'small secondary')) : null));
			if (!st.enabled) return body.replaceChildren(...parts);

			/* Thread */
			const t = st.thread || {};
			const role = ROLE[t.state] || [t.state || (st.otbr ? 'Starting…' : 'Not running'), 'mute'];
			const tcard = h('div', { class: 'card' },
				h('div', { class: 'card-head' }, icon('antenna'), h('span', { class: 'grow' }, t.name && t.state !== 'disabled' ? t.name : 'No network yet'), h('span', { class: 'pill ' + role[1] }, role[0])),
				t.state && t.state !== 'disabled' ? kv([['Channel', t.channel], ['PAN ID', t.panid], ['Extended PAN ID', h('span', { class: 'mono' }, t.extpanid)], ['Other Thread routers/devices', String(t.neighbors)],
					['Router address on Thread', h('span', { class: 'mono' }, t.address || '—')], ['Radio firmware', t.rcp]]) : h('p', { class: 'hint', style: { margin: 0 } }, st.otbr ? 'Start a new Thread network, or join an existing one (for example Home Assistant\'s, or your other router\'s).' : 'otbr-agent is not running yet.'));
			const actions = h('div', { class: 'btn-row' });
			if (st.otbr) {
				actions.append(
					btn('New network', () => {
						const name = input({ value: 'RouterHome', maxlength: 16 });
						sheet('New Thread network', close => { const ok = btn('Create', () => busy(ok, async () => {
							const r = await iotc('thread-form', { name: name.value.trim() }); if (r && r.error) throw new Error(r.error);
							toast('Network created'); close(); setTimeout(() => draw(true), 8000);
						})); return h('div', h('div', { class: 'group' }, field('Network name', name)),
							App.hint('This router becomes the leader. Devices and other border routers join with its dataset (Share).'),
							t.state && t.state !== 'disabled' ? App.note('This replaces the current network. Devices on it will have to be added again.', 'warn') : null,
							h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), ok)); });
					}, 'small'),
					btn('Join', () => {
						const ds = h('textarea', { class: 'mono', rows: 4, placeholder: '0e08…', spellcheck: 'false' });
						sheet('Join a Thread network', close => { const ok = btn('Join', () => busy(ok, async () => {
							const r = await iotc('thread-join', { dataset: ds.value.replace(/\s+/g, '') }); if (r && r.error) throw new Error(r.error);
							toast('Joining…'); close(); setTimeout(() => draw(true), 15000);
						})); return h('div', h('div', { class: 'group' }, field('Active dataset (hex)', ds)),
							App.hint('Get it from the other border router: Share on another Router Home, or in Home Assistant: Settings → Thread → the network → ⋮ → copy the active dataset TLVs.'),
							h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), ok)); });
					}, 'small secondary'),
					t.state && t.state !== 'disabled' ? btn('Share', async () => {
						const r = await iotc('thread-dataset');
						const txt = h('textarea', { class: 'mono', rows: 5, readonly: true }, (r && r.dataset) || '');
						sheet('Share this Thread network', close => h('div', h('div', { class: 'group' }, field('Active dataset', txt)),
							App.note('This contains the network\'s key: anyone with it can join. Only give it to your own devices and apps.', 'warn'),
							h('div', { class: 'actions' }, btn('Copy', async () => { try { await navigator.clipboard.writeText(txt.value); toast('Copied'); } catch (e) { txt.select(); toast('Select and copy the text'); } }), btn('Done', close, 'secondary'))));
					}, 'small secondary') : null,
					btn('Scan', async () => {
						const list = h('div', h('div', { class: 'skeleton' }));
						sheet('Thread networks nearby', list);
						const r = await iotc('thread-scan');
						const n = (r && r.networks) || [];
						list.replaceChildren(n.length ? App.group(...n.map(x => App.row({ icon: 'antenna', label: x.name || '(hidden)', sub: `Channel ${x.channel} · PAN ${x.panid} · ${x.extpanid}`, value: x.rssi + ' dBm' }))) :
							h('div', { class: 'card empty' }, 'No Thread networks heard.'));
					}, 'small secondary'),
					t.state && t.state !== 'disabled' ? btn('Leave', async () => {
						if (!await confirm('Leave the Thread network?', 'This router forgets the network and its key.', 'Leave', true)) return;
						await iotc('thread-leave'); toast('Left the network'); draw(true);
					}, 'small secondary') : null);
			}
			parts.push(App.sectionTitle('Thread', null, 'antenna'), tcard, actions);

			/* Bluetooth */
			if (st.ble_enabled) {
				const b = st.ble || {};
				const adv = toggle(b.advertising, async e => { await iotc('ble-adv', { on: e.target.checked }); toast(e.target.checked ? 'Visible as ' + (App.info.hostname || 'the router') : 'Hidden'); }, 'Visible to phones');
				const list = h('div');
				const scan = btn('Scan for devices', () => busy(scan, async () => {
					list.replaceChildren(h('div', { class: 'skeleton' }));
					const r = await iotc('ble-scan');
					if (r && r.error) throw new Error(r.error);
					const d = ((r && r.devices) || []).sort((a, c) => c.rssi - a.rssi);
					const bars = v => v >= -60 ? 4 : v >= -70 ? 3 : v >= -80 ? 2 : 1;
					list.replaceChildren(h('p', { class: 'hint', style: { margin: '12px 0 8px' } }, `${d.length} device${d.length === 1 ? '' : 's'} heard in 10 s`),
						d.length ? App.group(...d.slice(0, 60).map(x => App.row({ icon: 'devices', label: x.name || 'Unnamed device', sub: x.address,
							right: h('span', { class: 'bars', title: x.rssi + ' dBm' }, [1, 2, 3, 4].map(i => h('i', { class: i <= bars(x.rssi) ? 'on' : '' }))) }))) : null);
				}), 'small');
				parts.push(App.sectionTitle('Bluetooth LE', null, 'antenna'), h('div', { class: 'card' },
					b.up ? kv([['Status', 'On'], ['Address', h('span', { class: 'mono' }, b.address || '—')]]) : h('p', { class: 'hint', style: { margin: 0 } }, st.bluetooth_kmod ? 'Starting…' : 'Bluetooth needs kmod-hci-uart (and input-support) built into the firmware.'),
					b.up ? h('div', { class: 'row', style: { padding: '10px 0 0', minHeight: 0 } }, h('span', { class: 'main' }, h('div', { class: 'label' }, 'Visible to phones'), h('div', { class: 'sub' }, 'Advertises the router\'s name (try nRF Connect)')), adv) : null,
					b.up ? h('div', { class: 'btn-row' }, scan) : null, list));
			}
			body.replaceChildren(...parts);
		}
		await draw(true);
		every(10000, () => draw(false));
	}

	App.register('more', {
		render(page, args) {
			const s = args[0];
			if (s === 'monitor') return monitor(page);
			if (s === 'storage') return storage(page);
			if (s === 'charts') return charts(page);
			if (s === 'tools') return tools(page);
			if (s === 'services') return services(page);
			if (s === 'packages') return packages(page);
			if (s === 'lights') return lights(page);
			if (s === 'appearance') return appearance(page);
			if (s === 'iot') return iotPage(page);
			return index(page);
		}
	});
	return { cronParse, cronText, cronHuman };
})();
