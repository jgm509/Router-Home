/* Router Home: separate networks (guest, smart home / IoT, custom).
 * Each one is its own bridge, address range, DHCP, firewall zone and
 * WiFi, so devices on it can be kept away from the home network and the
 * router's settings. Created sections carry home_ui_net '1'. */
'use strict';

const Lans = (() => {
	const PRESETS = {
		guest: { label: 'Guest', name: 'guest', sub: 'Internet only. Guests can\'t see your devices or the router\'s settings.',
			internet: true, toRouter: false, homeIn: false, toHome: false, isolate: true },
		iot: { label: 'Smart home', name: 'iot', sub: 'For cameras, plugs and TVs. They get internet; your home network can reach them, they can\'t reach it.',
			internet: true, toRouter: false, homeIn: true, toHome: false, isolate: false },
		custom: { label: 'Custom', name: 'net', sub: 'Choose everything yourself.',
			internet: true, toRouter: false, homeIn: false, toHome: false, isolate: false }
	};
	const list = v => [].concat(v || []).join(' ').split(/\s+/).filter(Boolean);
	const ip2n = a => a.split('.').reduce((n, x) => ((n << 8) | (+x & 255)) >>> 0, 0);

	async function loadAll() {
		const { uci } = App;
		const [net, wl, dhcp, fw, ifaces, radios] = await Promise.all([uci.load('network'), uci.load('wireless'), uci.load('dhcp'), uci.load('firewall'), Data.interfaces(), Data.wireless()]);
		return { net, wl, dhcp, fw, ifaces, radios };
	}

	/* the bridge device section behind an interface (null for a plain port) */
	function bridgeOf(net, ifname) {
		const dev = net[ifname] && net[ifname].device;
		return App.uci.sections(net, 'device').find(d => d.name === dev && d.type === 'bridge') || null;
	}
	function zoneOf(fw, ifname) { return App.uci.sections(fw, 'zone').find(z => list(z.network).includes(ifname)) || null; }
	function hasFwd(fw, src, dest) { return App.uci.sections(fw, 'forwarding').some(f => f.src === src && f.dest === dest && f.enabled !== '0'); }

	/* separate networks: static bridges other than the home network */
	function separate(all) {
		const { net } = all;
		return App.uci.sections(net, 'interface').filter(i => {
			const n = i['.name'];
			if (n === 'lan' || n === 'loopback' || i.proto !== 'static') return false;
			return i.home_ui_net === '1' || !!bridgeOf(net, n) || /^br-/.test(i.device || '');
		});
	}

	/* a free /24 that doesn't overlap anything the router uses */
	function freeSubnet(all) {
		const used = [];
		for (const i of App.uci.sections(all.net, 'interface')) if (i.ipaddr) used.push(String(i.ipaddr).split('/')[0]);
		for (const i of all.ifaces) for (const a of i['ipv4-address'] || []) used.push(a.address);
		const nets = used.map(a => ip2n(a) & 0xffffff00);
		for (const third of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200])
			if (!nets.includes(ip2n(`192.168.${third}.0`))) return `192.168.${third}.1`;
		return '192.168.250.1';
	}
	function freeId(all, base) {
		const taken = n => all.net[n] || all.dhcp[n] || App.uci.sections(all.fw, 'zone').some(z => z.name === n);
		if (!taken(base)) return base;
		for (let i = 2; ; i++) if (!taken(base + i)) return base + i;
	}

	/* ---------- firewall pieces for one network ---------- */
	async function setForward(fw, src, dest, on) {
		const { uci } = App;
		const ex = uci.sections(fw, 'forwarding').filter(f => f.src === src && f.dest === dest);
		if (on && !ex.length) await uci.add('firewall', 'forwarding', { src, dest });
		if (!on) for (const f of ex) await uci.remove('firewall', f['.name']);
	}
	async function setRouterAccess(fw, zone, id, allowed) {
		const { uci } = App;
		await uci.set('firewall', zone['.name'], { input: allowed ? 'ACCEPT' : 'REJECT' });
		const mine = uci.sections(fw, 'rule').filter(r => r.home_ui_net === id);
		if (allowed) { for (const r of mine) await uci.remove('firewall', r['.name']); return; }
		if (!mine.some(r => r.dest_port === '67-68'))
			await uci.add('firewall', 'rule', { name: `${id}: allow DHCP`, src: id, proto: 'udp', dest_port: '67-68', target: 'ACCEPT', family: 'ipv4', home_ui_net: id });
		if (!mine.some(r => r.dest_port === '53'))
			await uci.add('firewall', 'rule', { name: `${id}: allow DNS`, src: id, proto: ['tcp', 'udp'], dest_port: '53', target: 'ACCEPT', home_ui_net: id });
		if (!mine.some(r => r.proto === 'icmp'))
			await uci.add('firewall', 'rule', { name: `${id}: allow ping to the router`, src: id, proto: 'icmp', icmp_type: 'echo-request', family: 'ipv4', target: 'ACCEPT', home_ui_net: id });
	}

	/* ---------- the page ---------- */
	async function render(page) {
		const { h, row, group, sectionTitle, explain, hint, note, btn } = App;
		const body = h('div', h('div', { class: 'skeleton' }));
		page.append(backLink(), h('h1', { class: 'page-title' }, 'Networks'), body);
		async function load() {
			const all = await loadAll();
			const nets = separate(all);
			const ifst = n => all.ifaces.find(i => i.interface === n) || {};
			const wifiOf = n => App.uci.sections(all.wl, 'wifi-iface').filter(w => list(w.network).includes(n) && (w.mode || 'ap') === 'ap');
			const lan = all.net.lan || {};
			const lanBr = bridgeOf(all.net, 'lan');
			const rows = [row({ icon: 'home', label: 'Home network', sub: `${lan.ipaddr || ''} · ${wifiOf('lan').map(w => w.ssid).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'no WiFi'}${lanBr ? ` · ports ${list(lanBr.ports).join(', ') || 'none'}` : ''}` })];
			for (const n of nets) {
				const z = zoneOf(all.fw, n['.name']);
				const tags = [];
				if (z && z.input !== 'ACCEPT') tags.push('no router access');
				if (z && !hasFwd(all.fw, z.name, 'lan')) tags.push('kept from home devices');
				if (z && !hasFwd(all.fw, z.name, 'wan')) tags.push('no internet');
				const w = wifiOf(n['.name']);
				rows.push(row({ icon: n.home_ui_kind === 'iot' ? 'tv' : 'wifi', label: n.home_ui_label || n['.name'],
					sub: [n.ipaddr, w.length ? `WiFi “${w[0].ssid}”` : 'no WiFi', ...tags].filter(Boolean).join(' · '),
					right: h('span', { class: 'dot ' + (ifst(n['.name']).up ? 'on' : '') }),
					onClick: () => openNetwork(n['.name'], load) }));
			}
			body.replaceChildren(
				h('h2', { class: 'section-title' }, h('span', 'Your networks', explain('Separate networks',
					'A separate network has its own WiFi name and its own addresses. Devices on it get internet, but you decide whether they can see your other devices and the router\'s settings.',
					'Use one for guests, so visitors never get near your computers. Use another for smart-home devices (cameras, plugs, TVs), which often get few security updates, so a hacked one can\'t reach the rest of your home.',
					{ rec: 'A Guest network with “Internet only”, and a Smart home network if you have many connected gadgets.' })),
					h('a', { class: 'link', href: '#', onclick: e => { e.preventDefault(); openAdd(load); } }, 'Add a network')),
				group(...rows),
				nets.length ? null : note('No separate networks yet. Add one for guests or smart-home devices so they stay away from your computers and the router\'s settings.'),
				h('div', { class: 'btn-row' }, btn('Add a network', () => openAdd(load), 'small')));
		}
		await load();
	}

	/* ---------- add ---------- */
	async function openAdd(reload) {
		const { h, row, group, field, input, password, select, toggle, seg, btn, busy, sheet, hint, note, explain, uci, toast } = App;
		const all = await loadAll();
		const lanBr = bridgeOf(all.net, 'lan');
		const lanPorts = lanBr ? list(lanBr.ports) : [];
		sheet('Add a network', close => {
			const body = h('div');
			let preset = 'guest';
			const draw = () => {
				const P = PRESETS[preset];
				const name = input({ value: P.label + ' WiFi', maxlength: 32 });
				const ssid = input({ value: `${(all.wl && App.uci.sections(all.wl, 'wifi-iface').find(w => list(w.network).includes('lan')) || {}).ssid || 'Home'}-${P.label.replace(/\s.*/, '')}`, maxlength: 32 });
				const [pw, peek] = password('', { autocomplete: 'new-password', placeholder: 'At least 8 characters' });
				const sec = select([['sae-mixed', 'WPA2/WPA3 (recommended)'], ['psk2', 'WPA2'], ['sae', 'WPA3 only'], ['none', 'Open, no password']], 'sae-mixed');
				const radioBoxes = all.radios.map(r => ({ r, t: toggle(r.band !== '6g', null, r.bandName) }));
				const iso = toggle(P.isolate, null, 'Keep devices apart');
				const inet = toggle(P.internet, null, 'Internet');
				const toRouter = toggle(P.toRouter, null, 'Router settings');
				const homeIn = toggle(P.homeIn, null, 'Home network can reach it');
				const toHome = toggle(P.toHome, null, 'It can reach the home network');
				const portBoxes = lanPorts.map(p => ({ p, t: toggle(false, null, p) }));
				const vport = select([['', 'No VLAN'], ...lanPorts.map(p => [p, p])], '');
				const vid = input({ type: 'number', min: 2, max: 4094, placeholder: 'For example 20', inputmode: 'numeric' });
				sec.onchange = () => { pwField.hidden = sec.value === 'none'; };
				const pwField = field('WiFi password', [pw, peek]);
				const addr = freeSubnet(all);
				const save = btn('Create network', () => busy(save, async () => {
					const label = name.value.trim() || P.label;
					if (!ssid.value.trim()) throw new Error('Enter a WiFi name');
					if (sec.value !== 'none' && pw.value.length < 8) throw new Error('The WiFi password must be at least 8 characters');
					const radios = radioBoxes.filter(x => x.t.checked).map(x => x.r);
					const ports = portBoxes.filter(x => x.t.checked).map(x => x.p);
					if (!radios.length && !ports.length && !vport.value) throw new Error('Choose at least one WiFi band, a port or a VLAN, so devices can join');
					if (ports.length && ports.length === lanPorts.length) throw new Error('Leave at least one port on the home network, or you could lock yourself out');
					if (vport.value && !(+vid.value >= 2 && +vid.value <= 4094)) throw new Error('Enter a VLAN ID between 2 and 4094');
					const id = freeId(all, P.name);
					const br = 'br-' + id;
					const members = [...ports];
					if (vport.value) {
						const vdev = `${vport.value}.${+vid.value}`;
						await uci.add('network', 'device', { type: '8021q', ifname: vport.value, vid: String(+vid.value), name: vdev, home_ui_net: id }, `vlan_${id}`);
						members.push(vdev);
					}
					await uci.add('network', 'device', { type: 'bridge', name: br, bridge_empty: '1', ports: members.length ? members : undefined, home_ui_net: id }, `dev_${id}`);
					await uci.add('network', 'interface', { proto: 'static', device: br, ipaddr: addr, netmask: '255.255.255.0', home_ui_net: '1', home_ui_kind: preset, home_ui_label: label }, id);
					if (ports.length && lanBr) await uci.set('network', lanBr['.name'], { ports: lanPorts.filter(p => !ports.includes(p)) });
					await uci.add('dhcp', 'dhcp', { interface: id, start: '100', limit: '150', leasetime: '12h' }, id);
					const zsec = await uci.add('firewall', 'zone', { name: id, network: [id], input: toRouter.checked ? 'ACCEPT' : 'REJECT', output: 'ACCEPT', forward: 'REJECT', home_ui_net: id });
					const fw = await uci.load('firewall');
					if (inet.checked) await uci.add('firewall', 'forwarding', { src: id, dest: 'wan' });
					if (homeIn.checked) await uci.add('firewall', 'forwarding', { src: 'lan', dest: id });
					if (toHome.checked) await uci.add('firewall', 'forwarding', { src: id, dest: 'lan' });
					if (!toRouter.checked) await setRouterAccess(fw, { '.name': zsec }, id, false);
					for (const r of radios) {
						const w = { device: r.name, mode: 'ap', network: id, ssid: ssid.value.trim(), encryption: sec.value };
						if (sec.value !== 'none') w.key = pw.value;
						if (iso.checked) w.isolate = '1';
						await uci.add('wireless', 'wifi-iface', w, `${id}_${r.name}`.replace(/[^a-z0-9_]/gi, '_'));
					}
					if (await uci.apply(`Creating ${label}… WiFi restarts for a moment`)) { close(); toast(`${label} is ready`); reload(); }
				}));
				const radioRows = radioBoxes.map(x => row({ icon: 'wifi', label: x.r.bandName, sub: x.r.band === '6g' ? 'Only newer devices (WiFi 6E/7) see it' : null, right: x.t }));
				body.replaceChildren(
					seg(Object.entries(PRESETS).map(([k, v]) => [k, v.label]), preset, v => { preset = v; draw(); }),
					hint(P.sub),
					group(field('Network name (only shown here)', name)),
					h('h2', { class: 'section-title' }, h('span', 'WiFi')),
					group(field('WiFi name', ssid), field('Security', sec), pwField, ...radioRows,
						row({ icon: 'devices', label: 'Keep devices apart', sub: 'Devices on this WiFi can\'t see each other', right: iso })),
					h('h2', { class: 'section-title' }, h('span', 'What it can reach', explain('Access',
						'Internet: devices on this network can go online.',
						'Router settings: whether they can open this page, LuCI or SSH. Turned off, they still get an address and name lookups from the router, nothing else.',
						'Home network can reach it: your phone and computer can talk to devices on this network (for example to control a camera or cast to a TV). The devices here still can\'t start a connection to your home devices.',
						'It can reach the home network: devices here can reach your computers. Leave this off unless you really need it.',
						{ rec: 'Guests: Internet only. Smart home: Internet, and “Home network can reach it” on.' }))),
					group(
						row({ icon: 'globe', label: 'Internet', right: inet }),
						row({ icon: 'lock', label: 'Router settings', sub: 'This page, LuCI and SSH', right: toRouter }),
						row({ icon: 'home', label: 'Home network can reach it', sub: 'Control or cast to devices here from your phone', right: homeIn }),
						row({ icon: 'link', label: 'It can reach the home network', sub: 'Usually off', right: toHome })),
					lanPorts.length ? [
						h('h2', { class: 'section-title' }, h('span', 'Wired ports', explain('Wired ports',
							'Move a LAN port to this network to plug in a device (or a second access point) that should be on it. The port leaves your home network.',
							'Don\'t move the port your computer is plugged into while you set this up.'))),
						group(...portBoxes.map(x => row({ icon: 'cable', label: x.p, right: x.t }))),
						h('h2', { class: 'section-title' }, h('span', 'VLAN (advanced)', explain('VLAN',
							'A VLAN carries this network over a port that stays on your home network too, tagged with a number. Use it with a managed switch or an access point that supports VLANs: set the same VLAN ID there.',
							'Plain devices (a TV, a computer) don\'t understand tagged VLANs; for those, move a whole port instead.',
							'This creates a tagged VLAN on the chosen port. On a few routers the switch chip needs LuCI\'s “Bridge VLAN filtering” instead; if devices behind the VLAN get no address, use that.',
							{ rec: 'Leave this empty unless your switch or access point is set up for VLANs.' }))),
						group(field('Port', vport), field('VLAN ID', vid))] : null,
					hint(`Addresses: ${addr.replace(/\.1$/, '.x')}. The router is ${addr}.`),
					h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), save));
			};
			draw();
			return body;
		});
	}

	/* ---------- one network ---------- */
	async function openNetwork(id, reload) {
		const { h, row, group, field, input, password, toggle, btn, busy, sheet, hint, note, explain, uci, confirm, toast, fmt } = App;
		const all = await loadAll();
		const n = all.net[id] || {};
		const z = zoneOf(all.fw, id);
		const br = bridgeOf(all.net, id);
		const lanBr = bridgeOf(all.net, 'lan');
		const wifi = uci.sections(all.wl, 'wifi-iface').filter(w => list(w.network).includes(id) && (w.mode || 'ap') === 'ap');
		const clients = (await Data.clients({ radios: all.radios, ifaces: all.ifaces }).catch(() => [])).filter(c => c.wifi && wifi.some(w => w.ssid === c.wifi.ssid));
		sheet(n.home_ui_label || id, close => {
			const inet = toggle(z && hasFwd(all.fw, z.name, 'wan'), null, 'Internet');
			const toRouter = toggle(z && z.input === 'ACCEPT', null, 'Router settings');
			const homeIn = toggle(z && hasFwd(all.fw, 'lan', z.name), null, 'Home network can reach it');
			const toHome = toggle(z && hasFwd(all.fw, z.name, 'lan'), null, 'It can reach the home network');
			const w0 = wifi[0] || {};
			const ssid = input({ value: w0.ssid || '', maxlength: 32 });
			const [pw, peek] = password(w0.key || '', { autocomplete: 'new-password' });
			const iso = toggle(w0.isolate === '1', null, 'Keep devices apart');
			const myPorts = br ? list(br.ports).filter(p => !p.includes('.')) : [];
			const lanPorts = lanBr ? list(lanBr.ports) : [];
			const portBoxes = [...myPorts.map(p => ({ p, t: toggle(true, null, p) })), ...lanPorts.map(p => ({ p, t: toggle(false, null, p) }))];
			const vlans = br ? list(br.ports).filter(p => p.includes('.')) : [];
			const save = btn('Save', () => busy(save, async () => {
				if (!z) throw new Error('This network has no firewall zone; edit it in the advanced settings');
				const fw = all.fw;
				await setForward(fw, z.name, 'wan', inet.checked);
				await setForward(fw, 'lan', z.name, homeIn.checked);
				await setForward(fw, z.name, 'lan', toHome.checked);
				await setRouterAccess(fw, z, id, toRouter.checked);
				if (wifi.length) {
					if (!ssid.value.trim()) throw new Error('Enter a WiFi name');
					const open = (w0.encryption || 'none') === 'none';
					if (!open && pw.value.length < 8) throw new Error('The WiFi password must be at least 8 characters');
					for (const w of wifi) {
						await uci.set('wireless', w['.name'], { ssid: ssid.value.trim(), ...(open ? {} : { key: pw.value }), isolate: iso.checked ? '1' : '0' });
					}
				}
				if (br) {
					const want = portBoxes.filter(x => x.t.checked).map(x => x.p);
					if (lanBr && want.length && lanPorts.every(p => want.includes(p)) && lanPorts.length) throw new Error('Leave at least one port on the home network');
					await uci.set('network', br['.name'], { ports: [...want, ...vlans].length ? [...want, ...vlans] : undefined });
					if (!want.length && !vlans.length) await uci.unset('network', br['.name'], ['ports']).catch(() => {});
					if (lanBr) {
						const lanWant = [...lanPorts.filter(p => !want.includes(p)), ...myPorts.filter(p => !want.includes(p))];
						await uci.set('network', lanBr['.name'], { ports: lanWant });
					}
				}
				if (await uci.apply('Saving… this network restarts for a moment')) { close(); reload(); }
			}));
			const del = btn('Delete network', async () => {
				if (!await confirm(`Delete ${n.home_ui_label || id}?`, 'Its WiFi, addresses and firewall settings are removed. Its wired ports go back to the home network.', 'Delete', true)) return;
				await busy(null, async () => {
					for (const w of wifi) await uci.remove('wireless', w['.name']);
					for (const f of uci.sections(all.fw, 'forwarding')) if (z && (f.src === z.name || f.dest === z.name)) await uci.remove('firewall', f['.name']);
					for (const r of uci.sections(all.fw, 'rule')) if (r.home_ui_net === id || (z && (r.src === z.name || r.dest === z.name))) await uci.remove('firewall', r['.name']);
					for (const r of uci.sections(all.fw, 'redirect')) if (z && (r.src === z.name || r.dest === z.name)) await uci.remove('firewall', r['.name']);
					if (z) await uci.remove('firewall', z['.name']);
					for (const d of uci.sections(all.dhcp, 'dhcp')) if (d.interface === id) await uci.remove('dhcp', d['.name']);
					if (br && lanBr) await uci.set('network', lanBr['.name'], { ports: [...lanPorts, ...myPorts] });
					for (const d of uci.sections(all.net, 'device')) if (d.home_ui_net === id || (br && d['.name'] === br['.name'])) await uci.remove('network', d['.name']);
					await uci.remove('network', id);
					if (await uci.apply('Removing the network…')) { close(); toast('Network removed'); reload(); }
				});
			}, 'secondary small');
			return h('div',
				h('div', { class: 'group' }, h('dl', { class: 'kv' },
					h('dt', 'Router address'), h('dd', n.ipaddr || '—'),
					h('dt', 'Devices on its WiFi'), h('dd', String(clients.length)),
					vlans.length ? [h('dt', 'VLAN'), h('dd', vlans.join(', '))] : null)),
				wifi.length ? [h('h2', { class: 'section-title' }, h('span', 'WiFi')),
					group(field('WiFi name', ssid), (w0.encryption || 'none') === 'none' ? null : field('WiFi password', [pw, peek]),
						row({ icon: 'devices', label: 'Keep devices apart', sub: 'Devices on this WiFi can\'t see each other', right: iso })),
					hint(`On ${wifi.map(w => (all.radios.find(r => r.name === w.device) || {}).bandName || w.device).join(', ')}.`)] : null,
				h('h2', { class: 'section-title' }, h('span', 'What it can reach', explain('Access',
					'Internet: devices on this network can go online.',
					'Router settings: whether they can open this page, LuCI or SSH. Turned off, they still get an address and name lookups.',
					'Home network can reach it: your phone and computer can control or cast to devices here.',
					'It can reach the home network: devices here can reach your computers. Usually off.'))),
				group(
					row({ icon: 'globe', label: 'Internet', right: inet }),
					row({ icon: 'lock', label: 'Router settings', sub: 'This page, LuCI and SSH', right: toRouter }),
					row({ icon: 'home', label: 'Home network can reach it', right: homeIn }),
					row({ icon: 'link', label: 'It can reach the home network', right: toHome })),
				br && portBoxes.length ? [h('h2', { class: 'section-title' }, h('span', 'Wired ports')), group(...portBoxes.map(x => row({ icon: 'cable', label: x.p, right: x.t }))),
					hint('Ports turned on here are on this network; the others stay on the home network.')] : null,
				h('div', { class: 'actions' }, btn('Close', close, 'secondary'), save),
				h('div', { class: 'btn-row', style: { justifyContent: 'center' } }, del));
		});
	}

	return { render, separate, loadAll, setRouterAccess };
})();
