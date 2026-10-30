/* Router Home: firewall (zones, port forwarding, traffic rules, UPnP) and
 * the security check. Everything is applied with automatic rollback. */
'use strict';

const Firewall = (() => {
	const list = v => [].concat(v == null ? [] : v).join(' ').split(/\s+/).filter(Boolean);
	const ip2n = a => String(a).split('.').reduce((n, x) => ((n << 8) | (+x & 255)) >>> 0, 0);
	const POLICY = [['ACCEPT', 'Allow'], ['REJECT', 'Block'], ['DROP', 'Block silently']];
	const policyText = p => ({ ACCEPT: 'allowed', REJECT: 'blocked', DROP: 'blocked silently' })[p] || 'blocked';
	const PROTOS = [['tcp udp', 'TCP and UDP'], ['tcp', 'TCP'], ['udp', 'UDP']];
	const validPort = p => /^\d{1,5}(-\d{1,5})?$/.test(p) && p.split('-').every(x => +x >= 1 && +x <= 65535) && (!p.includes('-') || +p.split('-')[0] <= +p.split('-')[1]);
	const validIp = a => /^(\d{1,3}\.){3}\d{1,3}$/.test(a) && a.split('.').every(x => +x <= 255);

	async function loadAll(extra) {
		const { uci } = App;
		const [fw, net, dhcp, devices] = await Promise.all([uci.load('firewall'), uci.load('network'), uci.load('dhcp'),
			extra && extra.devices === false ? [] : Data.clients().catch(() => [])]);
		return { fw, net, dhcp, devices };
	}
	const zones = all => App.uci.sections(all.fw, 'zone');
	function zoneLabel(all, name) {
		if (!name) return 'the router';
		if (name === '*') return 'any network';
		if (name === 'lan') return 'Home network';
		if (name === 'wan') return 'Internet';
		const i = all.net[name];
		return (i && i.home_ui_label) || name;
	}
	function devName(all, ip, mac) {
		const d = all.devices.find(x => (ip && x.ips.includes(ip)) || (mac && x.mac === String(mac).toLowerCase()));
		return d ? d.label : (ip || mac || '');
	}
	/* the zone whose networks contain an IPv4 address */
	function zoneForIp(all, ip) {
		if (!validIp(ip)) return null;
		for (const i of App.uci.sections(all.net, 'interface')) {
			if (!i.ipaddr) continue;
			for (const a of list(i.ipaddr)) {
				const [addr, cidr] = a.split('/');
				const bits = cidr ? +cidr : (i.netmask ? ip2n(i.netmask).toString(2).replace(/0/g, '').length : 24);
				const mask = bits ? (0xffffffff << (32 - bits)) >>> 0 : 0;
				if (((ip2n(addr) & mask) >>> 0) === ((ip2n(ip) & mask) >>> 0)) {
					const z = zones(all).find(z => list(z.network).includes(i['.name']));
					if (z) return z.name;
				}
			}
		}
		return null;
	}
	const isPause = r => (r.name || '').startsWith(Data.PAUSE_PREFIX);
	const enabledToggle = (sec, config, label) => App.toggle(sec.enabled !== '0', async e => {
		const on = e.target.checked;
		try {
			await App.uci.set(config, sec['.name'], { enabled: on ? '1' : '0' });
			if (!await App.uci.apply(on ? 'Turning on…' : 'Turning off…')) e.target.checked = !on;
		} catch (err) { App.toast(err.message, { bad: true }); e.target.checked = !on; }
	}, label);

	function devicePicker(all, value, opts) {
		const { select, input, field, h } = App;
		const devs = all.devices.filter(d => d.ips.some(validIp));
		const sel = select([['', opts && opts.none || 'Choose a device'], ...devs.map(d => [d.ips.find(validIp), `${d.label} (${d.ips.find(validIp)})`]), ['other', 'Another address…']],
			devs.some(d => d.ips.includes(value)) ? value : (value ? 'other' : ''));
		const other = input({ value: devs.some(d => d.ips.includes(value)) ? '' : (value || ''), inputmode: 'decimal', placeholder: '192.168.1.50' });
		const otherField = field('Address', other);
		otherField.hidden = sel.value !== 'other';
		sel.addEventListener('change', () => { otherField.hidden = sel.value !== 'other'; opts && opts.onchange && opts.onchange(); });
		return { sel, otherField, get value() { return sel.value === 'other' ? other.value.trim() : sel.value; },
			get device() { return devs.find(d => d.ips.includes(sel.value)) || null; } };
	}

	/* ======================= page ======================= */

	async function render(page) {
		const { h, row, group, explain, hint, note, btn, call, uci } = App;
		const body = h('div', h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
		page.append(backLink(), h('h1', { class: 'page-title' }, 'Firewall'), body);
		const title = (text, help, link) => h('h2', { class: 'section-title' }, h('span', text, help || null), link || null);
		const addLink = (text, fn) => h('a', { class: 'link', href: '#', onclick: e => { e.preventDefault(); fn(); } }, text);

		async function load() {
			const [all, upnp, upcfg] = await Promise.all([loadAll(), call('home-ui', 'upnp_status'), uci.load('upnpd')]);
			const fwd = uci.sections(all.fw, 'redirect').filter(r => (r.target || 'DNAT') === 'DNAT');
			const rules = uci.sections(all.fw, 'rule').filter(r => !isPause(r) && !r.home_ui_net);
			const zs = zones(all);
			const up0 = uci.sections(upcfg, 'upnpd')[0];

			const fwdRows = fwd.map(r => row({ icon: 'link', label: r.name || `Port ${r.src_dport || 'all'}`,
				sub: `${zoneLabel(all, r.src)} port ${r.src_dport || 'all'} → ${devName(all, r.dest_ip)}${r.dest_port && r.dest_port !== r.src_dport ? ' port ' + r.dest_port : ''} · ${list(r.proto || 'tcp udp').join('/').toUpperCase()}`,
				right: enabledToggle(r, 'firewall', 'On'), onClick: () => openForward(all, r, load), chevron: false }));

			const ruleRows = rules.map(r => row({ icon: r.target === 'ACCEPT' ? 'shield' : 'lock', label: r.name || 'Rule',
				sub: ruleText(all, r), right: enabledToggle(r, 'firewall', 'On'), onClick: () => openRule(all, r, load), chevron: false }));

			const zoneRows = zs.map(z => {
				const to = uci.sections(all.fw, 'forwarding').filter(f => f.src === z.name && f.enabled !== '0').map(f => zoneLabel(all, f.dest));
				return row({ icon: z.name === 'wan' ? 'globe' : z.name === 'lan' ? 'home' : 'network', label: zoneLabel(all, z.name) + (zoneLabel(all, z.name) !== z.name ? ` (${z.name})` : ''),
					sub: `${list(z.network).join(', ') || 'no networks'} · router ${policyText(z.input)}${to.length ? ' · can reach ' + to.join(', ') : ''}${z.masq === '1' ? ' · NAT' : ''}`,
					onClick: () => openZone(all, z, load) });
			});

			const upnpBox = !upnp || !upnp.installed
				? group(row({ icon: 'box', label: 'UPnP is not installed', sub: 'Lets game consoles and apps open ports by themselves', right: (() => { const b = btn('Install', () => installUpnp(b, load), 'small secondary'); return b; })() }))
				: group(
					row({ icon: 'link', label: 'UPnP', sub: up0 && up0.enabled === '1' ? (upnp.running ? 'On' : 'On, not running yet') : 'Off',
						right: upnpToggle(up0) }),
					up0 && up0.enabled === '1' ? row({ icon: 'shield', label: 'Secure mode', sub: 'Devices can only open ports for themselves', right: upnpSecure(up0) }) : null,
					...(upnp.leases || []).map(l => row({ icon: 'devices', label: l.desc || 'Open port', sub: `${l.proto} ${l.ext} → ${devName(all, l.ip)}:${l.port}` })),
					up0 && up0.enabled === '1' && !(upnp.leases || []).length ? row({ icon: 'devices', label: 'No ports opened yet', sub: 'Ports opened by devices show up here' }) : null);

			body.replaceChildren(
				group(row({ icon: 'shield', label: 'Security check', sub: 'Look for risky settings and fix them in one tap', href: '#/network/security' }),
					row({ icon: 'network', label: 'Networks', sub: 'Guest and smart-home networks, VLANs', href: '#/network/lans' })),

				title('Port forwarding', explain('Port forwarding',
					'Port forwarding lets something on the internet reach one device at home, on one port. Game servers, cameras and home servers sometimes need it.',
					'Each forward is a door into your home network. Only forward to devices that are kept up to date, and only the ports they need.',
					'Give the device a fixed address first (Devices → the device → Always use the same address), or the forward breaks when its address changes.',
					{ rec: 'To reach your own devices from outside, use a VPN (Tailscale or WireGuard on the VPN page) instead. It opens nothing to the whole internet.' }),
					addLink('Add', () => openForward(all, null, load))),
				fwd.length ? group(...fwdRows) : group(h('div', { class: 'empty' }, 'No ports are forwarded.')),

				title('Traffic rules', explain('Traffic rules',
					'Rules allow or block traffic that the zones below would otherwise treat differently: open a port on the router itself, or keep one device off a network.',
					'Rules are checked from top to bottom; the first one that matches wins.',
					'Rules made by Router Home for pausing devices and for separate networks are not shown here; change those on the device or the network.',
					{ rec: 'Keep this list short. Don\'t open SSH (22) or the web pages (80, 443) to the internet; use a VPN to manage the router from outside.' }),
					addLink('Add', () => openRule(all, null, load))),
				rules.length ? group(...ruleRows) : group(h('div', { class: 'empty' }, 'No rules.')),
				h('div', { class: 'btn-row' },
					btn('Open a port on the router', () => openRule(all, { _preset: 'open' }, load), 'small secondary'),
					btn('Block a device', () => openRule(all, { _preset: 'block' }, load), 'small secondary')),

				title('Zones', explain('Zones',
					'A zone is a group of networks that are treated the same. Your home network is in “lan”, the internet in “wan”. Each separate network gets its own zone.',
					'For each zone you set three things: whether its devices may talk to the router itself (Router access), whether they may talk to each other across its networks, and which other zones they may reach.',
					'“NAT” (masquerading) is turned on for the zone that faces the internet, so all your devices share the router\'s internet address.',
					{ rec: 'Internet zone: router access and forwarding blocked, NAT on. Home zone: allowed. Guest zones: router access blocked, reach only the internet.' }),
					addLink('Add', () => openZone(all, null, load))),
				group(...zoneRows),

				title('UPnP', explain('UPnP',
					'UPnP lets devices at home open ports on the router by themselves. Game consoles use it for online play (it fixes “strict NAT”), and some video-call and media apps too.',
					'It is convenient, but any program on any device can use it, including malware. Secure mode makes sure a device can only open ports to itself.',
					{ rec: 'Leave UPnP off unless a game console or app needs it. If you turn it on, keep Secure mode on, and use it only for the home network.' })),
				upnpBox,

				App.info.luci ? hint(h('span', 'More settings (NAT rules, IP sets, logging) are in ', h('a', { href: '/cgi-bin/luci/admin/network/firewall', target: '_blank' }, 'the advanced settings'), '.')) : null);
		}

		function upnpToggle(sec) {
			return App.toggle(sec && sec.enabled === '1', async e => {
				const on = e.target.checked;
				try {
					if (sec) await uci.set('upnpd', sec['.name'], { enabled: on ? '1' : '0' });
					else await uci.add('upnpd', 'upnpd', { enabled: on ? '1' : '0', secure_mode: '1', internal_iface: 'lan' }, 'config');
					if (!await uci.apply(on ? 'Turning UPnP on…' : 'Turning UPnP off…')) { e.target.checked = !on; return; }
					await call('home-ui', 'restart_service', { name: 'miniupnpd' });
					setTimeout(load, 1500);
				} catch (err) { App.toast(err.message, { bad: true }); e.target.checked = !on; }
			}, 'UPnP');
		}
		function upnpSecure(sec) {
			return App.toggle(sec.secure_mode !== '0', async e => {
				const on = e.target.checked;
				await uci.set('upnpd', sec['.name'], { secure_mode: on ? '1' : '0' });
				if (await uci.apply()) await call('home-ui', 'restart_service', { name: 'miniupnpd' }); else e.target.checked = !on;
			}, 'Secure mode');
		}
		await load();
	}

	async function installUpnp(button, done) {
		await App.busy(button, async () => {
			const r = await App.rpc('home-ui', 'pkg_install', { name: 'upnp' });
			if (r && r.error) throw new Error(r.error === 'busy' ? 'Another install is still running' : r.error);
			App.toast('Installing UPnP… this takes a minute', { sticky: true });
			for (let i = 0; i < 120; i++) {
				await App.sleep(2000);
				const s = await App.call('home-ui', 'pkg_status');
				if (s && s.state === 'done') { App.toast('UPnP installed. Turn it on below.'); return done(); }
				if (s && s.state === 'failed') throw new Error(s.message);
			}
			throw new Error('The install is taking long. Check again in a minute.');
		});
	}

	function ruleText(all, r) {
		const what = r.target === 'ACCEPT' ? 'Allow' : 'Block';
		const from = r.src_ip || r.src_mac ? devName(all, list(r.src_ip)[0], list(r.src_mac)[0]) : zoneLabel(all, r.src || '');
		const to = r.dest_ip ? devName(all, r.dest_ip) : zoneLabel(all, r.dest || '');
		const port = r.dest_port ? ` port ${r.dest_port}` : '';
		const proto = r.proto && r.proto !== 'all' ? ` · ${list(r.proto).join('/').toUpperCase()}` : '';
		return `${what} ${from || 'the router'} → ${to}${port}${proto}`;
	}

	/* ======================= port forwarding ======================= */

	async function openForward(all, r, reload, prefill) {
		const { h, row, group, field, input, select, toggle, btn, busy, sheet, hint, note, explain, uci, confirm, toast } = App;
		if (!all) all = await loadAll();
		const isNew = !r;
		r = r || {};
		sheet(isNew ? 'Forward a port' : (r.name || 'Port forward'), close => {
			const name = input({ value: r.name || (prefill && prefill.name ? `${prefill.name}` : ''), placeholder: 'For example: Game server', maxlength: 40 });
			const proto = select(PROTOS, list(r.proto || 'tcp udp').sort().reverse().join(' ') === 'udp tcp' ? 'tcp udp' : list(r.proto || 'tcp udp').join(' '));
			const ext = input({ value: r.src_dport || '', inputmode: 'numeric', placeholder: '25565 or 8000-8010' });
			const intp = input({ value: r.dest_port || '', inputmode: 'numeric', placeholder: 'Same as outside' });
			const dev = devicePicker(all, r.dest_ip || (prefill && prefill.ip) || '', { onchange: () => fixedRow.hidden = !needsFixed() });
			const srcZones = zones(all).map(z => [z.name, zoneLabel(all, z.name)]);
			const from = select(srcZones, r.src || 'wan');
			const only = input({ value: list(r.src_ip).join(' '), inputmode: 'decimal', placeholder: 'Anyone' });
			const reflect = toggle(r.reflection !== '0', null, 'Works from home too');
			const needsFixed = () => { const d = dev.device; return !!(d && !(d.host && d.host.ip)); };
			const fixed = toggle(true, null, 'Give it a fixed address');
			const fixedRow = row({ icon: 'link', label: 'Give this device a fixed address', sub: 'So the forward keeps working after it reconnects', right: fixed });
			fixedRow.hidden = !needsFixed();
			const save = btn(isNew ? 'Add forward' : 'Save', () => busy(save, async () => {
				const ip = dev.value;
				if (!validPort(ext.value.trim())) throw new Error('Enter the outside port: a number from 1 to 65535, or a range like 8000-8010');
				if (intp.value.trim() && !validPort(intp.value.trim())) throw new Error('The inside port is not valid');
				if (!validIp(ip)) throw new Error('Choose the device to forward to');
				for (const a of only.value.trim().split(/[\s,]+/).filter(Boolean)) if (!/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(a)) throw new Error(`“${a}” is not an address`);
				const dz = zoneForIp(all, ip);
				if (!dz) throw new Error('That address is not on any of the router\'s networks');
				if (dz === from.value) throw new Error('The device is on the same network the traffic comes from; choose “Internet” or another network');
				const v = { name: name.value.trim() || `Port ${ext.value.trim()}`, target: 'DNAT', src: from.value, dest: dz, proto: list(proto.value),
					src_dport: ext.value.trim(), dest_ip: ip, dest_port: intp.value.trim() || ext.value.trim(),
					reflection: reflect.checked ? '1' : '0' };
				if (only.value.trim()) v.src_ip = only.value.trim().split(/[\s,]+/);
				if (isNew) await uci.add('firewall', 'redirect', v);
				else {
					await uci.set('firewall', r['.name'], v);
					if (!v.src_ip) await uci.unset('firewall', r['.name'], ['src_ip']).catch(() => {});
				}
				const d = dev.device;
				if (d && needsFixed() && fixed.checked) {
					const hn = (d.name || '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || undefined;
					await uci.add('dhcp', 'host', { name: hn, mac: d.mac, ip });
				}
				if (await uci.apply('Saving the forward…')) { close(); toast('Saved'); reload && reload(); }
			}));
			const del = !isNew && btn('Delete forward', async () => {
				if (!await confirm('Delete this forward?', 'The port closes again.', 'Delete', true)) return;
				await busy(null, async () => { await uci.remove('firewall', r['.name']); if (await uci.apply()) { close(); reload && reload(); } });
			}, 'secondary small');
			return h('div',
				group(field('Name', name), field('Device', dev.sel), dev.otherField, fixedRow),
				h('h2', { class: 'section-title' }, h('span', 'Ports', explain('Ports',
					'Outside port: the port people on the internet connect to. Inside port: the port the device listens on. They are usually the same.',
					'The app or device\'s manual says which ports and which protocol (TCP or UDP) it needs.',
					{ rec: 'Use the exact ports the app asks for. Avoid forwarding big ranges.' }))),
				group(field('Protocol', proto), field('Outside port', ext), field('Inside port', intp)),
				h('h2', { class: 'section-title' }, h('span', 'Who can use it', explain('Who can use it',
					'Comes from: usually the Internet. Pick another zone to let one of your separate networks reach a single device at home.',
					'Only from: limit the forward to some addresses, for example a friend\'s or your office\'s address. Leave it empty for anyone.',
					'Works from home too (NAT loopback): devices at home can use your internet address and port too, the same way outside visitors do.'))),
				group(field('Comes from', from), field('Only from (optional)', only),
					row({ icon: 'home', label: 'Works from home too', sub: 'Use the internet address from inside your home', right: reflect })),
				from.value === 'wan' ? note('Anyone on the internet can reach this port on the device. Keep the device up to date.', 'warn') : null,
				h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), save),
				del ? h('div', { class: 'btn-row', style: { justifyContent: 'center' } }, del) : null);
		});
	}

	/* ======================= traffic rules ======================= */

	async function openRule(all, r, reload) {
		const { h, row, group, field, input, select, seg, btn, busy, sheet, hint, note, uci, confirm, toast } = App;
		const preset = r && r._preset;
		const isNew = !r || !!preset;
		r = preset ? {} : (r || {});
		const zs = zones(all);
		const title = preset === 'open' ? 'Open a port on the router' : preset === 'block' ? 'Block a device' : isNew ? 'Add a rule' : (r.name || 'Rule');
		sheet(title, close => {
			const name = input({ value: r.name || '', placeholder: preset === 'block' ? 'For example: No internet for the TV' : 'For example: Allow game server', maxlength: 40 });
			const action = seg([['ACCEPT', 'Allow'], ['REJECT', 'Block'], ['DROP', 'Block silently']], r.target || (preset === 'open' ? 'ACCEPT' : 'REJECT'));
			const from = select([['*', 'Any network'], ...zs.map(z => [z.name, zoneLabel(all, z.name)])], r.src || (preset === 'open' ? 'wan' : 'lan'));
			const srcDev = devicePicker(all, list(r.src_ip)[0] || '', { none: 'Any device' });
			const to = select([['', 'The router itself'], ['*', 'Any network'], ...zs.map(z => [z.name, zoneLabel(all, z.name)])], r.dest != null ? r.dest : (preset === 'block' ? 'wan' : ''));
			const destIp = input({ value: r.dest_ip || '', inputmode: 'decimal', placeholder: 'Any address' });
			const protoVal = r.proto ? list(r.proto).join(' ') : (preset === 'block' ? 'all' : 'tcp udp');
			const proto = select([['all', 'Everything'], ['tcp udp', 'TCP and UDP'], ['tcp', 'TCP'], ['udp', 'UDP'], ['icmp', 'Ping (ICMP)']], ['all', 'tcp udp', 'tcp', 'udp', 'icmp'].includes(protoVal) ? protoVal : 'tcp udp');
			const port = input({ value: r.dest_port || '', inputmode: 'numeric', placeholder: preset === 'open' ? '51820' : 'Any port' });
			const portField = field('Port', port);
			const syncProto = () => { portField.hidden = proto.value === 'all' || proto.value === 'icmp'; };
			proto.addEventListener('change', syncProto); syncProto();
			const save = btn(isNew ? 'Add rule' : 'Save', () => busy(save, async () => {
				const p = port.value.trim();
				if (!portField.hidden && p && !p.split(/[\s,]+/).every(validPort)) throw new Error('The port is not valid');
				if (preset === 'open' && !p) throw new Error('Enter the port to open');
				const sip = srcDev.value;
				if (srcDev.sel.value && !validIp(sip)) throw new Error('The device address is not valid');
				if (destIp.value.trim() && !validIp(destIp.value.trim())) throw new Error('The destination address is not valid');
				if (preset === 'block' && !sip) throw new Error('Choose the device to block');
				if (action.value === 'ACCEPT' && from.value === 'wan' && !to.value && ['22', '80', '443'].includes(p)
					&& !await confirm('Open this to the internet?', `Port ${p} is the router's ${p === '22' ? 'SSH' : 'web page'}. Anyone on the internet could try to log in. A VPN is much safer.`, 'Open anyway', true)) return;
				const v = { name: name.value.trim() || (preset === 'block' ? `Block ${devName(all, sip)}` : (p ? `Open port ${p}` : 'Rule')), src: from.value, target: action.value };
				if (to.value) v.dest = to.value;
				if (!portField.hidden && p) v.dest_port = p.split(/[\s,]+/).join(' ');
				v.proto = list(proto.value);
				if (proto.value === 'icmp') v.family = 'ipv4';
				if (sip) {
					v.src_ip = sip;
					const d = srcDev.device;
					if (d && d.mac) { v.src_mac = d.mac; delete v.src_ip; }
				}
				if (destIp.value.trim()) v.dest_ip = destIp.value.trim();
				if (isNew) await uci.add('firewall', 'rule', v);
				else {
					await uci.set('firewall', r['.name'], v);
					const drop = ['dest', 'dest_port', 'src_ip', 'src_mac', 'dest_ip', 'family'].filter(k => r[k] != null && v[k] == null);
					if (drop.length) await uci.unset('firewall', r['.name'], drop);
				}
				if (await uci.apply('Saving the rule…')) { close(); toast('Saved'); reload && reload(); }
			}));
			const del = !isNew && btn('Delete rule', async () => {
				if (!await confirm('Delete this rule?', 'Traffic is then handled by the zone settings again.', 'Delete', true)) return;
				await busy(null, async () => { await uci.remove('firewall', r['.name']); if (await uci.apply()) { close(); reload && reload(); } });
			}, 'secondary small');
			return h('div',
				group(field('Name', name)),
				action,
				h('h2', { class: 'section-title' }, h('span', 'From')),
				group(field('Network', from), field('Device', srcDev.sel), srcDev.otherField),
				h('h2', { class: 'section-title' }, h('span', 'To')),
				group(field('Going to', to), field('Address (optional)', destIp), field('Protocol', proto), portField),
				hint(preset === 'block' ? 'To block a device from the internet, choose its network under From, the device, and Internet under To. For a pause with an on/off switch or a bedtime schedule, use the device page instead.'
					: '“The router itself” means traffic for the router: its web pages, SSH, DNS, VPN servers running on it.'),
				h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), save),
				del ? h('div', { class: 'btn-row', style: { justifyContent: 'center' } }, del) : null);
		});
	}

	/* ======================= zones ======================= */

	async function openZone(all, z, reload) {
		const { h, row, group, field, input, select, toggle, btn, busy, sheet, hint, note, explain, uci, confirm, toast } = App;
		const isNew = !z;
		z = z || {};
		const zs = zones(all);
		const others = zs.filter(o => o.name !== z.name);
		const ifs = uci.sections(all.net, 'interface').filter(i => i['.name'] !== 'loopback');
		const fwds = uci.sections(all.fw, 'forwarding');
		const has = (s, d) => fwds.some(f => f.src === s && f.dest === d && f.enabled !== '0');
		sheet(isNew ? 'Add a zone' : `${zoneLabel(all, z.name)} zone`, close => {
			const name = input({ value: z.name || '', placeholder: 'For example: lab', maxlength: 15, disabled: !isNew });
			const nets = ifs.map(i => {
				const owner = zs.find(o => list(o.network).includes(i['.name']));
				return { i, owner, t: toggle(owner && owner.name === z.name && !isNew, null, i['.name']) };
			});
			const input_ = select(POLICY, z.input || 'REJECT');
			const output = select(POLICY, z.output || 'ACCEPT');
			const forward = select(POLICY, z.forward || 'REJECT');
			const masq = toggle(z.masq === '1', null, 'NAT');
			const mtu = toggle(z.mtu_fix === '1', null, 'MSS clamping');
			const toBoxes = others.map(o => ({ o, t: toggle(!isNew && has(z.name, o.name), null, o.name) }));
			const fromBoxes = others.map(o => ({ o, t: toggle(!isNew && has(o.name, z.name), null, o.name) }));
			const save = btn(isNew ? 'Add zone' : 'Save', () => busy(save, async () => {
				const zn = isNew ? name.value.trim() : z.name;
				if (!/^[a-z][a-z0-9_]{0,14}$/.test(zn)) throw new Error('Use a short name: lowercase letters, numbers and _ (up to 15)');
				if (isNew && zs.some(o => o.name === zn)) throw new Error('There is already a zone with that name');
				const chosen = nets.filter(x => x.t.checked).map(x => x.i['.name']);
				if (z.name === 'lan' && !chosen.includes('lan')) throw new Error('Keep the “lan” network in this zone, or you would lose access to the router');
				if (z.name === 'lan' && input_.value !== 'ACCEPT' && !await confirm('Block router access from home?', 'Devices on your home network could then no longer open this page, LuCI or SSH. You would have to reset the router to get back in.', 'Block anyway', true)) return;
				if (z.name === 'wan' && input_.value === 'ACCEPT' && !await confirm('Allow the internet into the router?', 'Anyone on the internet could reach the router\'s login pages and SSH. This is not safe.', 'Allow anyway', true)) return;
				/* a network can only be in one zone: take it out of the old one */
				for (const x of nets) if (x.t.checked && x.owner && x.owner.name !== zn) {
					await uci.set('firewall', x.owner['.name'], { network: list(x.owner.network).filter(n => n !== x.i['.name']) });
				}
				const v = { name: zn, network: chosen, input: input_.value, output: output.value, forward: forward.value, masq: masq.checked ? '1' : '0', mtu_fix: mtu.checked ? '1' : '0' };
				if (isNew) await uci.add('firewall', 'zone', v);
				else await uci.set('firewall', z['.name'], v);
				const fresh = uci.sections(await uci.load('firewall'), 'forwarding');
				const sync = async (src, dest, on) => {
					const ex = fresh.filter(f => f.src === src && f.dest === dest);
					if (on && !ex.length) await uci.add('firewall', 'forwarding', { src, dest });
					if (on) for (const f of ex) if (f.enabled === '0') await uci.set('firewall', f['.name'], { enabled: '1' });
					if (!on) for (const f of ex) await uci.remove('firewall', f['.name']);
				};
				for (const x of toBoxes) await sync(zn, x.o.name, x.t.checked);
				for (const x of fromBoxes) await sync(x.o.name, zn, x.t.checked);
				if (await uci.apply('Saving the zone…')) { close(); toast('Saved'); reload && reload(); }
			}));
			const del = !isNew && btn('Delete zone', async () => {
				const core = z.name === 'lan' || z.name === 'wan';
				if (!await confirm(`Delete the ${z.name} zone?`, (core ? 'This is one of the main zones. Without it the router may stop working or lock you out. ' : '') + 'Its rules, port forwards and links to other zones are removed. Its networks lose their firewall settings.', 'Delete', true)) return;
				await busy(null, async () => {
					for (const f of fwds) if (f.src === z.name || f.dest === z.name) await uci.remove('firewall', f['.name']);
					for (const t of ['rule', 'redirect']) for (const x of uci.sections(all.fw, t)) if (x.src === z.name || x.dest === z.name) await uci.remove('firewall', x['.name']);
					await uci.remove('firewall', z['.name']);
					if (await uci.apply('Removing the zone…')) { close(); reload && reload(); }
				});
			}, 'secondary small');
			return h('div',
				isNew ? group(field('Zone name', name)) : null,
				h('h2', { class: 'section-title' }, h('span', 'Networks in this zone', explain('Networks',
					'Pick the router networks (interfaces) that belong to this zone. Each network is in at most one zone; picking it here takes it out of its old zone.'))),
				group(...nets.map(x => row({ icon: 'network', label: x.i['.name'], sub: x.owner && x.owner.name !== z.name ? `Now in ${x.owner.name}` : (x.i.home_ui_label || null), right: x.t }))),
				h('h2', { class: 'section-title' }, h('span', 'Traffic', explain('Traffic',
					'Router access: traffic from this zone to the router itself (its web pages, SSH, DNS, DHCP).',
					'From the router: traffic the router itself sends into this zone. Almost always allowed.',
					'Inside the zone: traffic between different networks of this same zone.',
					'“Block” answers with a refusal, so apps notice quickly. “Block silently” drops traffic with no answer; on the internet side that hides the router a bit better.',
					'NAT (masquerading): devices behind the router share its address on this zone. Turn on for the internet zone. MSS clamping fixes slow or stuck pages on some connections (PPPoE, VPN); turn it on for the internet zone.',
					{ rec: 'Internet: Router access “Block silently” or “Block”, NAT and MSS clamping on. Home: all allowed. Guests: Router access “Block”.' }))),
				group(field('Router access', input_), field('From the router', output), field('Inside the zone', forward),
					row({ icon: 'globe', label: 'NAT (masquerading)', sub: 'For the zone that faces the internet', right: masq }),
					row({ icon: 'refresh', label: 'MSS clamping', sub: 'Helps on PPPoE and VPN connections', right: mtu })),
				others.length ? [
					h('h2', { class: 'section-title' }, h('span', 'Can reach', explain('Zone to zone',
						'“Can reach” lets devices in this zone start connections to the other zone. Answers always come back, so you only need one direction for most things.',
						'Example: Home → Internet lets you browse. Home → Smart home lets your phone control a camera, while the camera can\'t start anything toward your computer.'))),
					group(...toBoxes.map(x => row({ icon: 'link', label: zoneLabel(all, x.o.name), sub: x.o.name, right: x.t }))),
					h('h2', { class: 'section-title' }, h('span', 'Can be reached from')),
					group(...fromBoxes.map(x => row({ icon: 'link', label: zoneLabel(all, x.o.name), sub: x.o.name, right: x.t })))] : null,
				h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), save),
				del ? h('div', { class: 'btn-row', style: { justifyContent: 'center' } }, del) : null);
		});
	}

	/* ======================= security check ======================= */

	async function securityChecks() {
		const { uci, call } = App;
		const [all, wl, db, up, sec] = await Promise.all([loadAll({ devices: false }), uci.load('wireless'), uci.load('dropbear'), uci.load('upnpd'), call('home-ui', 'security_info')]);
		const out = [];
		const add = (level, title, text, fix, extra) => out.push(Object.assign({ level, title, text, fix }, extra || {}));
		const zs = zones(all);
		const wan = zs.find(z => z.name === 'wan');
		const lanNets = list((zs.find(z => z.name === 'lan') || {}).network);

		if (sec && sec.root_password === false)
			add('bad', 'No admin password', 'Anyone on your network can open the settings and SSH without a password.', { label: 'Set a password', run: () => openPassword() });
		else if (sec) add('ok', 'Admin password is set');

		if (!wan) add('warn', 'No internet zone', 'There is no zone named “wan”. Check that your internet connection is protected by the firewall.');
		else {
			if (wan.input === 'ACCEPT') add('bad', 'The internet can reach the router', 'Anyone on the internet can reach the router\'s login pages and SSH.',
				{ label: 'Block it', run: async () => { await uci.set('firewall', wan['.name'], { input: 'REJECT' }); return uci.apply(); } });
			else add('ok', 'The internet can\'t reach the router');
			if (wan.forward === 'ACCEPT') add('bad', 'The internet can reach your devices', 'Traffic from the internet is let through to your home network.',
				{ label: 'Block it', run: async () => { await uci.set('firewall', wan['.name'], { forward: 'REJECT' }); return uci.apply(); } });
			if (uci.sections(all.fw, 'forwarding').some(f => f.src === 'wan' && f.enabled !== '0')) add('bad', 'The internet zone can reach another zone', 'A zone link lets the internet start connections into your network.',
				{ label: 'Remove it', run: async () => { for (const f of uci.sections(all.fw, 'forwarding')) if (f.src === 'wan') await uci.remove('firewall', f['.name']); return uci.apply(); } });
		}

		const risky = uci.sections(all.fw, 'rule').filter(r => r.enabled !== '0' && r.src === 'wan' && !r.dest && r.target === 'ACCEPT' && list(r.dest_port).some(p => ['22', '80', '443', '8080', '8443'].includes(p)));
		if (risky.length) add('bad', 'Router logins are open to the internet', `${risky.map(r => r.name || r.dest_port).join(', ')} let the internet reach SSH or the router's web pages.`,
			{ label: 'Close them', run: async () => { for (const r of risky) await uci.set('firewall', r['.name'], { enabled: '0' }); return uci.apply(); } });

		const dmz = uci.sections(all.fw, 'redirect').filter(r => r.enabled !== '0' && (r.target || 'DNAT') === 'DNAT' && r.src === 'wan' && !r.src_dport);
		if (dmz.length) add('bad', 'A device gets all internet traffic', `${dmz.map(r => r.name || r.dest_ip).join(', ')} forwards every port to one device (DMZ).`,
			{ label: 'Turn it off', run: async () => { for (const r of dmz) await uci.set('firewall', r['.name'], { enabled: '0' }); return uci.apply(); } });
		const fwd = uci.sections(all.fw, 'redirect').filter(r => r.enabled !== '0' && (r.target || 'DNAT') === 'DNAT' && r.src === 'wan' && r.src_dport);
		if (fwd.length) add('info', `${fwd.length} port forward${fwd.length > 1 ? 's' : ''} open`, `${fwd.map(r => `${r.name || 'port'} (${r.src_dport})`).join(', ')}. Make sure you still need ${fwd.length > 1 ? 'them' : 'it'}, and keep those devices up to date.`,
			{ label: 'Review', href: '#/network/firewall' });

		/* SSH */
		const dbs = uci.sections(db, 'dropbear').filter(d => d.enable !== '0');
		if (dbs.length && sec && sec.dropbear) {
			if (dbs.some(d => d.RootPasswordAuth !== 'off' && d.PasswordAuth !== 'off') && dbs.some(d => !d.Interface))
				add('tip', 'SSH answers on every network', 'SSH (the command line) accepts passwords on all networks. The firewall keeps the internet out, but limiting SSH to the home network adds a second lock, for example if a firewall rule is changed by mistake.',
					{ label: 'Only on the home network', run: async () => { for (const d of dbs) if (!d.Interface) await uci.set('dropbear', d['.name'], { Interface: 'lan' }); const ok = await uci.apply(); if (ok) await call('home-ui', 'restart_service', { name: 'dropbear' }); return ok; },
					  confirm: 'SSH then only works from the home network (and not over Tailscale or a VPN, unless you set that in the advanced settings).' });
			else add('ok', 'SSH is limited');
		}

		/* WiFi */
		const aps = uci.sections(wl, 'wifi-iface').filter(w => (w.mode || 'ap') === 'ap' && w.disabled !== '1');
		for (const w of aps) {
			const nets = list(w.network);
			const home = nets.some(n => lanNets.includes(n));
			const enc = w.encryption || 'none';
			if (enc === 'none' || enc === 'owe') {
				if (home && enc === 'none') add('bad', `“${w.ssid}” has no password`, 'Anyone nearby can join your home network and see your devices.', { label: 'Set a password', href: '#/wifi' });
				else if (enc === 'none') add('info', `“${w.ssid}” is open`, 'It\'s on a separate network, so that\'s fine for guests, but traffic on it is not encrypted.');
			} else if (/^(psk|psk-mixed|wep)/.test(enc) && !/psk2|sae/.test(enc) || /wep/.test(enc))
				add('warn', `“${w.ssid}” uses old security`, 'WEP and WPA (version 1) can be broken. Use WPA2 or WPA3.', { label: 'Change it', href: '#/wifi' });
			if (w.wps_pushbutton === '1') add('warn', `WPS is on for “${w.ssid}”`, 'WPS makes joining easier, but it has known weaknesses.',
				{ label: 'Turn off WPS', run: async () => { await uci.set('wireless', w['.name'], { wps_pushbutton: '0' }); return uci.apply('Turning off WPS… WiFi restarts'); } });
		}
		if (aps.length && !out.some(c => /“.*”/.test(c.title) && c.level !== 'info')) add('ok', 'WiFi security is good');

		/* separate networks */
		const seps = zs.filter(z => !['lan', 'wan'].includes(z.name) && list(z.network).some(n => all.net[n] && all.net[n].home_ui_net === '1'));
		for (const z of seps) {
			const label = zoneLabel(all, z.name);
			if (z.input === 'ACCEPT') add('warn', `${label} can open the router's settings`, 'Devices on it can reach this page, LuCI and SSH.',
				{ label: 'Block it', run: async () => { const fw = await uci.load('firewall'); await Lans.setRouterAccess(fw, z, list(z.network)[0], false); return uci.apply(); } });
			if (uci.sections(all.fw, 'forwarding').some(f => f.src === z.name && f.dest === 'lan' && f.enabled !== '0')) add('warn', `${label} can reach your home devices`, 'Devices on it can start connections to your computers and phones.',
				{ label: 'Block it', run: async () => { for (const f of uci.sections(all.fw, 'forwarding')) if (f.src === z.name && f.dest === 'lan') await uci.remove('firewall', f['.name']); return uci.apply(); } });
		}
		if (!seps.length) add('tip', 'No guest network', 'A guest network keeps visitors and smart-home gadgets away from your computers and the router\'s settings.', { label: 'Add one', href: '#/network/lans' });

		/* UPnP */
		const u = uci.sections(up, 'upnpd')[0];
		if (u && u.enabled === '1') {
			if (u.secure_mode === '0') add('warn', 'UPnP is on without secure mode', 'Any device can open ports to any other device.',
				{ label: 'Turn on secure mode', run: async () => { await uci.set('upnpd', u['.name'], { secure_mode: '1' }); const ok = await uci.apply(); if (ok) await call('home-ui', 'restart_service', { name: 'miniupnpd' }); return ok; } });
			else add('tip', 'UPnP is on', 'Devices can open ports on the router by themselves. Fine for game consoles; turn it off if nothing needs it.',
				{ label: 'Turn off', run: async () => { await uci.set('upnpd', u['.name'], { enabled: '0' }); const ok = await uci.apply(); if (ok) await call('home-ui', 'restart_service', { name: 'miniupnpd' }); return ok; } });
		}
		const order = { bad: 0, warn: 1, tip: 2, info: 3, ok: 4 };
		return out.sort((a, b) => order[a.level] - order[b.level]);
	}

	async function renderSecurity(page) {
		const { h, row, group, hint, btn, busy, toast, confirm, icon } = App;
		const body = h('div', h('div', { class: 'skeleton' }));
		page.append(backLink(), h('h1', { class: 'page-title' }, 'Security check'), body);
		const LV = { bad: ['Fix this', 'bad', 'close'], warn: ['Worth fixing', 'warn', 'shield'], tip: ['Suggestion', '', 'shield'], info: ['Good to know', '', 'shield'], ok: ['OK', 'ok', 'shield'] };
		async function load() {
			const checks = await securityChecks();
			const bad = checks.filter(c => c.level === 'bad').length, warn = checks.filter(c => c.level === 'warn').length;
			const rows = checks.map(c => {
				const [tag, cls, ic] = LV[c.level];
				let action = null;
				if (c.fix && c.fix.href) action = h('a', { class: 'btn small secondary', href: c.fix.href }, c.fix.label);
				else if (c.fix) {
					const b = action = btn(c.fix.label, () => busy(b, async () => {
						if (c.fix.confirm && !await confirm(c.fix.label + '?', c.fix.confirm, 'Continue')) return;
						const ok = await c.fix.run();
						if (ok !== false) { toast('Fixed'); load(); }
					}), 'small');
				}
				return h('div', { class: 'row check ' + c.level },
					h('span', { class: 'ic', style: { color: c.level === 'bad' ? 'var(--offline)' : c.level === 'warn' ? 'var(--warn)' : c.level === 'ok' ? 'var(--good)' : null } }, icon(ic)),
					h('span', { class: 'main' },
						h('div', { class: 'label' }, c.title, ' ', h('span', { class: 'tag ' + cls }, tag)),
						c.text ? h('div', { class: 'sub' }, c.text) : null,
						action ? h('div', { style: { marginTop: '8px' } }, action) : null));
			});
			body.replaceChildren(
				h('div', { class: 'note' + (bad ? ' bad' : warn ? ' warn' : '') }, bad ? `${bad} thing${bad > 1 ? 's' : ''} to fix now.` : warn ? `Looks mostly good; ${warn} thing${warn > 1 ? 's' : ''} worth fixing.` : 'Looks good.'),
				group(...rows),
				hint('Fixes are applied with a safety net: if the router can\'t be reached afterwards, it puts the old settings back after 30 seconds.'),
				h('div', { class: 'btn-row' }, (() => { const b = btn('Check again', () => busy(b, load), 'small secondary'); return b; })()));
		}
		await load();
	}

	return { render, renderSecurity, openForward, openRule, securityChecks, zoneLabel };
})();
