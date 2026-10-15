/* Router Home: internet connections, mobile/eSIM, DNS, VPN */
'use strict';

const Net = (() => {
	const { h, uci, call } = App;

	function friendly(i, cfg) {
		const p = i.proto || (cfg && cfg.proto);
		const n = i.interface || (cfg && cfg['.name']);
		if (Data.isModemProto(p)) return '5G modem' + (n !== 'wwan' && n !== 'modem' ? ` (${n})` : '');
		if (p === 'wireguard') return `VPN · ${n}`;
		if (n === 'wan') return 'WAN port';
		if (n === 'wan6') return 'WAN port · IPv6';
		if (n === 'lan') return 'Home network';
		if (n === 'tailscale') return 'Tailscale';
		if (/^wwan/.test(n || '') && (p === 'dhcp' || p === 'static')) return 'WiFi uplink' + (n !== 'wwan' ? ` (${n})` : '');
		return n;
	}

	function ipv4(i) {
		const a = (i['ipv4-address'] || [])[0];
		return a ? `${a.address}/${a.mask}` : '';
	}

	async function addToZone(zoneName, network) {
		const fw = await uci.load('firewall');
		const z = uci.sections(fw, 'zone').find(s => s.name === zoneName);
		if (!z) return false;
		const nets = [].concat(z.network || []).join(' ').split(/\s+/).filter(Boolean);
		if (!nets.includes(network)) { nets.push(network); await uci.set('firewall', z['.name'], { network: nets }); }
		return true;
	}
	async function removeFromZones(network) {
		const fw = await uci.load('firewall');
		for (const z of uci.sections(fw, 'zone')) {
			const nets = [].concat(z.network || []).join(' ').split(/\s+/).filter(Boolean);
			if (nets.includes(network)) await uci.set('firewall', z['.name'], { network: nets.filter(n => n !== network) });
		}
	}
	function freeName(netcfg, base) {
		if (!netcfg[base]) return base;
		for (let i = 2; ; i++) if (!netcfg[base + i]) return base + i;
	}
	async function lanSubnet() {
		const ifs = await Data.interfaces();
		const lan = ifs.find(i => i.interface === 'lan');
		const a = lan && (lan['ipv4-address'] || [])[0];
		if (!a) return '192.168.1.0/24';
		const parts = a.address.split('.').map(Number), m = a.mask;
		const ipn = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
		const net = m ? (ipn & ((0xffffffff << (32 - m)) >>> 0)) >>> 0 : 0;
		return [(net >>> 24) & 255, (net >>> 16) & 255, (net >>> 8) & 255, net & 255].join('.') + '/' + m;
	}

	return { friendly, ipv4, addToZone, removeFromZones, freeName, lanSubnet };
})();

App.register('network', {
	async render(page, args) {
		const sub = args[0];
		if (sub === 'mobile') return renderMobile(page);
		if (sub === 'dns') return renderDns(page);
		if (sub === 'vpn') return renderVpn(page);
		if (sub === 'usage') return renderUsage(page);
		return renderOverview(page);
	}
});

function backLink(label) {
	return App.h('a', { href: '#/network', class: 'hint', style: { display: 'inline-flex', alignItems: 'center', gap: '4px', margin: '0 0 4px', textDecoration: 'none', color: 'var(--accent)', fontWeight: 600 } }, App.icon('back'), label || 'Internet');
}

/* ======================= overview ======================= */

async function renderOverview(page) {
	const { h, row, group, sectionTitle, hint, every, uci, info, fmt } = App;
	const conns = h('div', h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
	const more = [
		info.modem ? row({ icon: 'sim', label: 'Mobile & eSIM', sub: 'Signal, carrier, APN and eSIM profiles', href: '#/network/mobile' }) : null,
		row({ icon: 'download', label: 'Data usage', sub: 'Per connection and per device', href: '#/network/usage' }),
		row({ icon: 'dns', label: 'DNS', sub: 'Choose who answers website name lookups', href: '#/network/dns' }),
		row({ icon: 'vpn', label: 'VPN', sub: App.info.protonvpn ? 'Proton VPN, WireGuard and Tailscale' : 'WireGuard and Tailscale', href: '#/network/vpn' })
	];
	page.append(
		h('h1', { class: 'page-title' }, 'Internet'),
		sectionTitle('Connections', h('a', { class: 'link', href: '#', onclick: e => { e.preventDefault(); openAddConnection(load); } }, 'Add connection')),
		conns,
		hint('When more than one connection is online, the one marked “In use” carries your traffic. The others take over if it fails.'),
		sectionTitle('Settings'),
		group(...more.filter(Boolean))
	);

	async function load() {
		const [ifaces, netcfg] = await Promise.all([Data.interfaces(), uci.load('network')]);
		const up = Data.uplink(ifaces);
		const shown = ifaces.filter(i => i.interface !== 'loopback' && i.interface !== 'lan' && !(i.interface || '').endsWith('_6') && !(i.interface || '').endsWith('_4'));
		const lan = ifaces.find(i => i.interface === 'lan');
		const rows = shown.map(i => {
			const cfg = netcfg[i.interface] || {};
			const state = i.up ? 'on' : (cfg.disabled === '1' || cfg.auto === '0' ? '' : 'warn');
			const subText = i.up ? [Data.PROTO_NAME[i.proto] || i.proto, Net.ipv4(i) || ((i['ipv6-address'] || [])[0] || {}).address, i.uptime ? 'for ' + fmt.duration(i.uptime) : ''].filter(Boolean).join(' · ')
				: (cfg.auto === '0' || cfg.disabled === '1' ? 'Stopped' : (i.errors && i.errors.length ? 'Error: ' + i.errors.map(e => e.code).join(', ') : 'Not connected'));
			return row({
				icon: Data.isModemProto(i.proto) ? 'antenna' : i.proto === 'wireguard' ? 'vpn' : 'globe',
				iconColor: i.up ? 'var(--online)' : null,
				label: Net.friendly(i, cfg), sub: subText,
				right: up && up.interface === i.interface ? h('span', { class: 'badge blue' }, 'In use') : h('span', { class: 'dot ' + state }),
				onClick: () => openInterface(i, cfg, load)
			});
		});
		if (lan) rows.push(row({ icon: 'home', label: 'Home network', sub: `Router address ${Net.ipv4(lan)}`, onClick: () => openInterface(lan, netcfg.lan || {}, load) }));
		conns.replaceChildren(group(...rows));
	}
	every(10000, load);
}

function openInterface(i, cfg, reload) {
	const { h, row, group, field, input, password, select, toggle, btn, busy, uci, rpc, call, sheet, confirm, toast, fmt, sectionTitle, hint, note, sleep } = App;
	const name = i.interface;
	const p = i.proto || cfg.proto;
	const core = ['lan', 'wan', 'wan6', 'loopback'].includes(name);
	const dns = [].concat(i['dns-server'] || []);
	const route4 = (i.route || []).find(r => r.target === '0.0.0.0' && r.mask === 0);

	sheet(Net.friendly(i, cfg), close => {
		const editor = settingsEditor(p, cfg, name);
		const metric = select([['', 'Normal'], ['10', 'Main connection'], ['20', 'Backup (used only if the main one fails)'], ['30', 'Last resort']],
			cfg.metric || '', {});
		const saveBtn = btn('Save', () => busy(saveBtn, async () => {
			const vals = await editor.values();
			if (!core || name === 'wan' || name === 'wan6') vals.metric = metric.value || undefined;
			await uci.set('network', name, vals);
			if (!metric.value && cfg.metric) await uci.unset('network', name, ['metric']);
			for (const k of editor.unset || []) if (cfg[k] != null && vals[k] == null) await uci.unset('network', name, [k]);
			if (await uci.apply('Saving… this connection restarts')) { close(); reload(); }
		}));

		const restart = btn('Reconnect', () => busy(restart, async () => {
			await rpc('file', 'exec', { command: '/sbin/ifup', params: [name] });
			toast('Reconnecting…'); close(); setTimeout(reload, 3000);
		}), 'secondary');
		const stopStart = btn(i.up ? 'Stop' : 'Start', () => busy(stopStart, async () => {
			await rpc('file', 'exec', { command: i.up ? '/sbin/ifdown' : '/sbin/ifup', params: [name] });
			toast(i.up ? 'Stopped' : 'Starting…'); close(); setTimeout(reload, 2000);
		}), 'secondary');
		const del = !core ? btn('Delete connection', async () => {
			if (!await confirm(`Delete ${Net.friendly(i, cfg)}?`, 'Its settings are removed. You can add it again later.', 'Delete', true)) return;
			await busy(null, async () => {
				await Net.removeFromZones(name);
				if (p === 'wireguard') {
					const nc = await uci.load('network');
					for (const s of uci.sections(nc, 'wireguard_' + name)) await uci.remove('network', s['.name']);
				}
				const wl = await uci.load('wireless');
				for (const w of uci.sections(wl, 'wifi-iface'))
					if (w.mode === 'sta' && [].concat(w.network || []).join(' ').split(/\s+/).includes(name)) await uci.remove('wireless', w['.name']);
				await uci.remove('network', name);
				if (await uci.apply()) { close(); reload(); }
			});
		}, 'secondary small') : null;

		const wbox = h('div');
		uci.load('wireless').then(wl => {
			const sta = uci.sections(wl, 'wifi-iface').find(w => w.mode === 'sta' && [].concat(w.network || []).join(' ').split(/\s+/).includes(name));
			if (sta) wbox.replaceChildren(sectionTitle('WiFi network'), group(row({ icon: 'wifi', label: sta.ssid || '(no name)',
				sub: sta.disabled === '1' ? 'Turned off · tap to change' : 'Tap to change the network or password', onClick: () => { close(); openWifiUplink(reload, { name, sta, cfg }); } })));
		});
		return h('div',
			wbox,
			h('div', { class: 'group' }, h('dl', { class: 'kv' },
				h('dt', 'Status'), h('dd', i.up ? `Connected for ${fmt.duration(i.uptime)}` : 'Not connected'),
				h('dt', 'Type'), h('dd', Data.PROTO_NAME[p] || p),
				Net.ipv4(i) ? [h('dt', 'Address'), h('dd', Net.ipv4(i))] : null,
				(i['ipv6-address'] || []).length ? [h('dt', 'IPv6'), h('dd', i['ipv6-address'].map(a => a.address).join(', '))] : null,
				(i['ipv6-prefix'] || []).length ? [h('dt', 'IPv6 prefix'), h('dd', i['ipv6-prefix'].map(a => `${a.address}/${a.mask}`).join(', '))] : null,
				route4 ? [h('dt', 'Gateway'), h('dd', route4.nexthop)] : null,
				dns.length ? [h('dt', 'DNS'), h('dd', dns.join(', '))] : null,
				(i.l3_device || i.device) ? [h('dt', 'Device'), h('dd', { class: 'mono' }, i.l3_device || i.device)] : null)),
			h('div', { class: 'btn-row' }, restart, name !== 'lan' ? stopStart : null),
			p === 'wireguard' ? note(h('span', 'Peers and keys for this VPN are on the ', h('a', { href: '#/network/vpn' }, 'VPN page'), '.')) : null,
			editor.node ? [sectionTitle('Settings'), editor.node] : null,
			name !== 'lan' && name !== 'loopback' && p !== 'wireguard' ? [sectionTitle('Priority'), h('div', { class: 'group' }, field('Use this connection as', metric)),
				hint('Lower priority connections wait in the background and take over when the main one stops working.')] : null,
			editor.node || name !== 'lan' ? h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), saveBtn) : null,
			del ? h('div', { class: 'btn-row', style: { justifyContent: 'center' } }, del) : null);
	});
}

/* settings form for each connection type. returns { node, values(), unset } */
function settingsEditor(proto, cfg, name) {
	const { h, field, input, password, select, toggle, row, group } = App;
	const list = v => [].concat(v || []).join(' ').split(/\s+/).filter(Boolean);
	if (proto === 'static') {
		const ip = input({ value: cfg.ipaddr || '', inputmode: 'decimal' });
		const mask = input({ value: cfg.netmask || '255.255.255.0', inputmode: 'decimal' });
		const gw = input({ value: cfg.gateway || '', inputmode: 'decimal', placeholder: name === 'lan' ? 'Leave empty' : '' });
		const dns = input({ value: list(cfg.dns).join(' '), placeholder: 'Separate with spaces' });
		return {
			node: h('div', { class: 'group' }, field('Address', ip), field('Netmask', mask), field('Gateway', gw), field('DNS servers', dns)),
			unset: ['gateway', 'dns'],
			async values() {
				if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip.value.trim())) throw new Error('Enter an address like 192.168.1.1');
				const v = { ipaddr: ip.value.trim(), netmask: mask.value.trim() };
				if (gw.value.trim()) v.gateway = gw.value.trim();
				if (dns.value.trim()) v.dns = dns.value.trim().split(/[\s,]+/);
				return v;
			}
		};
	}
	if (proto === 'pppoe') {
		const user = input({ value: cfg.username || '' });
		const [pw, peek] = password(cfg.password || '');
		return { node: h('div', { class: 'group' }, field('Username', user), field('Password', [pw, peek])),
			async values() { return { username: user.value.trim(), password: pw.value }; } };
	}
	if (proto === 'modemmanager') {
		const apn = input({ value: cfg.apn || '', placeholder: 'From your carrier, for example: internet' });
		const user = input({ value: cfg.username || '', placeholder: 'Usually empty' });
		const [pw, peek] = password(cfg.password || '', { placeholder: 'Usually empty' });
		const ipt = select([['ipv4v6', 'IPv4 and IPv6'], ['ipv4', 'IPv4 only'], ['ipv6', 'IPv6 only']], cfg.iptype || 'ipv4v6');
		const roam = toggle(cfg.allow_roaming === '1', null, 'Allow roaming');
		return {
			node: h('div', h('div', { class: 'group' }, field('APN', apn), field('APN username', user), field('APN password', [pw, peek]), field('IP version', ipt)),
				h('div', { class: 'group', style: { marginTop: '12px' } }, row({ icon: 'globe', label: 'Allow roaming', sub: 'Needed for travel eSIMs that use partner networks', right: roam }))),
			unset: ['username', 'password'],
			async values() {
				const v = { apn: apn.value.trim(), iptype: ipt.value, allow_roaming: roam.checked ? '1' : '0' };
				if (user.value.trim()) { v.username = user.value.trim(); v.auth = cfg.auth || 'both'; }
				if (pw.value) v.password = pw.value;
				return v;
			}
		};
	}
	if (proto === 'dhcp') {
		const peer = toggle(cfg.peerdns !== '0', null, 'Use the provider\'s DNS');
		return { node: group(row({ icon: 'dns', label: 'Use the provider’s DNS', sub: 'Turn off to use only the DNS chosen on the DNS page', right: peer })),
			async values() { return { peerdns: peer.checked ? '1' : '0' }; } };
	}
	return { node: null, async values() { return {}; } };
}

async function openAddConnection(reload) {
	const { h, row, group, field, input, password, select, btn, busy, uci, call, sheet, sectionTitle, hint, note, info } = App;
	const [netdevs, netcfg, modems] = await Promise.all([call('luci-rpc', 'getNetworkDevices'), uci.load('network'), call('home-ui', 'modem_list')]);
	const ports = Object.keys(netdevs || {}).filter(n => !/^(lo|br-|wl|phy|wwan|mhi|tailscale|wg|ifb|teql|gre|sit|ip6|erspan|tun)/.test(n) && !n.includes('.')).sort();

	sheet('Add a connection', close => {
		const body = h('div');
		const choose = () => body.replaceChildren(group(
			(info.modemmanager) ? row({ icon: 'antenna', label: 'Mobile modem', sub: 'Use the 5G modem with an APN', onClick: modemForm }) : null,
			row({ icon: 'wifi', label: 'WiFi network', sub: 'Use another WiFi network as internet (hotspot, another router, hotel)', onClick: () => { close(); openWifiUplink(reload); } }),
			row({ icon: 'globe', label: 'Internet through a port', sub: 'Automatic address (DHCP), the most common', onClick: () => portForm('dhcp') }),
			row({ icon: 'link', label: 'PPPoE', sub: 'DSL or fibre with a username and password', onClick: () => portForm('pppoe') }),
			row({ icon: 'edit', label: 'Fixed address', sub: 'An address your provider gave you', onClick: () => portForm('static') }),
			row({ icon: 'vpn', label: 'VPN', sub: 'WireGuard or Tailscale', href: '#/network/vpn', onClick: () => close() })
		));

		const metricSel = () => select([['10', 'Main connection'], ['20', 'Backup'], ['30', 'Last resort']], '20');

		function modemForm() {
			const ms = (modems && modems.modems) || [];
			const apn = input({ placeholder: 'From your carrier, for example: internet' });
			const metric = metricSel();
			const save = btn('Add modem connection', () => busy(save, async () => {
				if (!ms.length) throw new Error('No modem found yet. Wait 2 minutes after boot and try again.');
				const n = Net.freeName(netcfg, 'wwan');
				await uci.add('network', 'interface', { proto: 'modemmanager', device: ms[0].device, apn: apn.value.trim(), iptype: 'ipv4v6', metric: metric.value, allow_roaming: '0' }, n);
				await Net.addToZone('wan', n);
				if (await uci.apply('Adding connection…')) { close(); reload(); }
			}));
			body.replaceChildren(
				ms.length ? note(`Found ${ms[0].manufacturer || ''} ${ms[0].model || 'modem'}.`) : note('No modem found yet. It can take 2 minutes after the router starts.', 'warn'),
				h('div', { class: 'group' }, field('APN', apn), field('Use this connection as', metric)),
				hint('Your carrier lists the APN on its website. For many travel eSIMs you also need to turn on roaming afterwards.'),
				h('div', { class: 'actions' }, btn('Back', choose, 'secondary'), save));
		}

		function portForm(proto) {
			const port = select(ports.map(p => [p, p === (netcfg.wan && netcfg.wan.device) ? `${p} (WAN port)` : p]), (netcfg.wan && netcfg.wan.device) || ports[0]);
			const ed = settingsEditor(proto, {}, '');
			const metric = metricSel();
			const save = btn('Add connection', () => busy(save, async () => {
				const vals = await ed.values();
				const n = Net.freeName(netcfg, 'wan');
				await uci.add('network', 'interface', Object.assign({ proto, device: port.value, metric: metric.value }, vals), n);
				await Net.addToZone('wan', n);
				if (await uci.apply('Adding connection…')) { close(); reload(); }
			}));
			body.replaceChildren(
				h('div', { class: 'group' }, field('Port', port), field('Use this connection as', metric)),
				ed.node ? [h('div', { style: { height: '12px' } }), ed.node] : null,
				hint('A port can only be used by one connection. If it is a LAN port, remove it from the home network in the advanced settings first.'),
				h('div', { class: 'actions' }, btn('Back', choose, 'secondary'), save));
		}
		choose();
		return body;
	});
}

/* ---------- WiFi uplink (the router joins another WiFi network) ---------- */

function encFromScan(e) {
	if (!e || !e.enabled) return 'none';
	const auth = [].concat(e.authentication || []);
	const wpa = [].concat(e.wpa || []);
	if (auth.includes('owe')) return 'owe';
	if (auth.includes('sae') && auth.includes('psk')) return 'sae-mixed';
	if (auth.includes('sae')) return 'sae';
	if (auth.includes('psk')) return wpa.includes(2) || wpa.includes(3) ? 'psk2' : 'psk';
	if (auth.includes('802.1x') || auth.includes('eap')) return 'eap';
	return 'psk2';
}
const STA_SECURITY = [['sae-mixed', 'WPA2/WPA3'], ['psk2', 'WPA2'], ['sae', 'WPA3'], ['psk', 'WPA (old)'], ['owe', 'Enhanced open (OWE)'], ['none', 'Open, no password']];

async function openWifiUplink(reload, existing) {
	const { h, row, group, field, input, password, select, btn, busy, uci, call, sheet, hint, note, sectionTitle, toast } = App;
	const [radios, netcfg] = await Promise.all([Data.wireless(), uci.load('network')]);
	if (!radios.length) return toast('This router has no WiFi radios', { bad: true });
	const sta = existing && existing.sta;
	const cur = existing ? (sta.device || radios[0].name) : ((radios.find(r => r.band === '5g') || radios[0]).name);
	sheet(existing ? 'WiFi uplink' : 'Join a WiFi network', close => {
		const radio = select(radios.map(r => [r.name, `${r.bandName}${r.disabled ? ' (WiFi off)' : ''}`]), cur);
		const ssid = input({ value: sta ? sta.ssid || '' : '', placeholder: 'Network name' });
		const [pw, peek] = password(sta ? sta.key || '' : '', { autocomplete: 'new-password' });
		const sec = select(STA_SECURITY, sta ? (sta.encryption || 'none') : 'sae-mixed');
		const metric = select([['10', 'Main connection'], ['20', 'Backup'], ['30', 'Last resort']], (existing && existing.cfg && existing.cfg.metric) || '10');
		const pwField = field('Password', [pw, peek]);
		const showPw = () => { pwField.hidden = sec.value === 'none' || sec.value === 'owe'; };
		sec.onchange = showPw; showPw();
		const found = h('div');
		const scan = btn('Find networks', () => busy(scan, async () => {
			found.replaceChildren(h('div', { class: 'skeleton' }));
			const r = await App.rpc('home-ui', 'wifi_scan', { radio: radio.value });
			const seen = {};
			const nets = (r.results || []).filter(n => n.ssid && !seen[n.ssid] && (seen[n.ssid] = 1)).sort((a, b) => (b.signal || -100) - (a.signal || -100));
			if (!nets.length) { found.replaceChildren(note('No networks found on this band. Try another band, or type the name.')); return; }
			found.replaceChildren(group(...nets.slice(0, 25).map(n => row({ icon: 'wifi', label: n.ssid,
				sub: `${n.signal ? n.signal + ' dBm' : ''}${n.channel ? ' · channel ' + n.channel : ''} · ${(STA_SECURITY.find(x => x[0] === encFromScan(n.encryption)) || ['', 'Secured'])[1]}`,
				right: Data.signalBars(n.signal),
				onClick: () => {
					ssid.value = n.ssid;
					const e = encFromScan(n.encryption);
					if (e === 'eap') { toast('This network needs an enterprise login (802.1X), which Router Home can\'t set up. Use the advanced settings.', { bad: true }); return; }
					sec.value = e; showPw();
					found.replaceChildren();
					(sec.value === 'none' || sec.value === 'owe' ? ssid : pw).focus();
				} }))));
		}), 'secondary small');
		const save = btn(existing ? 'Save' : 'Connect', () => busy(save, async () => {
			if (!ssid.value.trim()) throw new Error('Enter or pick the network name');
			const needPw = !(sec.value === 'none' || sec.value === 'owe');
			if (needPw && pw.value.length < 8) throw new Error('The password must be at least 8 characters');
			const w = { device: radio.value, mode: 'sta', ssid: ssid.value.trim(), encryption: sec.value };
			if (needPw) w.key = pw.value;
			let n;
			if (existing) {
				n = existing.name;
				await uci.set('wireless', sta['.name'], w);
				if (!needPw && sta.key) await uci.unset('wireless', sta['.name'], ['key']);
				if (sta.disabled === '1') await uci.unset('wireless', sta['.name'], ['disabled']);
				await uci.set('network', n, { metric: metric.value });
			} else {
				n = Net.freeName(netcfg, 'wwan');
				await uci.add('network', 'interface', { proto: 'dhcp', metric: metric.value }, n);
				await uci.add('wireless', 'wifi-iface', Object.assign(w, { network: n }));
				await Net.addToZone('wan', n);
			}
			/* the radio must be on for the router to join */
			const rc = radios.find(r => r.name === radio.value);
			if (rc && rc.disabled) await uci.unset('wireless', rc.name, ['disabled']);
			if (await uci.apply(existing ? 'Saving… WiFi restarts for a moment' : 'Connecting… WiFi restarts for a moment')) { close(); reload && reload(); }
		}));
		return h('div',
			h('div', { class: 'group' }, field('Band', radio)),
			h('div', { class: 'btn-row' }, scan), found,
			h('div', { class: 'group', style: { marginTop: '12px' } }, field('Network name', ssid), field('Security', sec), pwField, field('Use this connection as', metric)),
			hint('Your own WiFi on this band switches to the same channel as the network you join. Pick a band where the other network is strong; 5 GHz is usually best. If the network has a sign-in page (hotel, café), open any website on a device at home to accept it.'),
			h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), save));
	});
}

/* ======================= data usage ======================= */

async function renderUsage(page) {
	const { h, row, group, sectionTitle, hint, note, call, fmt, uci, select, every } = App;
	const body = h('div', h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
	page.append(backLink(), h('h1', { class: 'page-title' }, 'Data usage'), body);
	let period = '';
	let clients = null;
	const both = (d, u) => `↓ ${fmt.bytes(d)} · ↑ ${fmt.bytes(u)}`;
	const bar = (v, max) => h('div', { style: { height: '4px', borderRadius: '2px', marginTop: '6px', background: 'var(--accent)', width: Math.max(2, Math.round(v / (max || 1) * 100)) + '%' } });

	async function load() {
		const [u, ifaces, netcfg] = await Promise.all([call('home-ui', 'data_usage', { period }), Data.interfaces(), uci.load('network')]);
		if (!clients) clients = await Data.clients().catch(() => []);
		if (!u) { body.replaceChildren(note('Could not read the counters. Restart rpcd after updating Router Home.', 'warn')); return; }
		const kids = [];

		/* ---- connections ---- */
		const stat = {}; for (const x of u.ifaces || []) stat[x.name] = x;
		const vn = {};
		for (const vi of (u.vnstat && u.vnstat.interfaces) || []) {
			const months = (vi.traffic && (vi.traffic.month || vi.traffic.months)) || [];
			const last = months[months.length - 1];
			if (last) vn[vi.name || vi.id] = { rx: last.rx * (u.vnstat.jsonversion === '1' ? 1024 : 1), tx: last.tx * (u.vnstat.jsonversion === '1' ? 1024 : 1) };
		}
		const shown = ifaces.filter(i => i.interface !== 'loopback' && !(i.interface || '').endsWith('_6') && !(i.interface || '').endsWith('_4') && (i.l3_device || i.device));
		const seenDev = {};
		const rows = [];
		for (const i of shown) {
			const dev = i.l3_device || i.device;
			if (seenDev[dev]) continue; seenDev[dev] = 1;
			const s = stat[dev]; if (!s) continue;
			const lan = i.interface === 'lan';
			/* for the home network the router sends what devices download */
			const down = lan ? s.tx : s.rx, up = lan ? s.rx : s.tx;
			const month = vn[dev];
			rows.push(row({ icon: lan ? 'home' : i.proto === 'wireguard' ? 'vpn' : Data.isModemProto(i.proto) ? 'antenna' : /^wwan/.test(i.interface) ? 'wifi' : 'globe',
				label: Net.friendly(i, netcfg[i.interface]),
				sub: month ? `This month ${both(lan ? month.tx : month.rx, lan ? month.rx : month.tx)}` : both(down, up),
				value: fmt.bytes((month ? month.rx + month.tx : down + up)) }));
		}
		kids.push(sectionTitle('Connections'), rows.length ? group(...rows) : h('div', { class: 'group' }, h('div', { class: 'empty' }, 'No counters yet.')),
			hint(Object.keys(vn).length ? 'Monthly totals from vnstat.' : `Since the router started ${fmt.duration(u.uptime)} ago. Install vnstat to keep monthly totals across restarts.`));

		/* ---- devices ---- */
		kids.push(sectionTitle('Devices'));
		if (!u.nlbw) {
			kids.push(note('To count data per device, install nlbwmon (System → Software in the advanced settings, or apk add nlbwmon). It keeps monthly totals for every device.', 'warn'));
		} else {
			const periods = [...(u.periods || [])].sort().reverse();
			if (periods.length > 1) {
				const sel = select(periods.map((p, n) => [n === 0 ? '' : p, n === 0 ? `Current period (since ${new Date(p + 'T00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })})` : `From ${new Date(p + 'T00:00').toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}`]), period, { 'aria-label': 'Period' });
				sel.onchange = () => { period = sel.value; body.style.opacity = .5; load().finally(() => { body.style.opacity = 1; }); };
				kids.push(h('div', { class: 'group' }, h('label', { class: 'field' }, h('span', 'Period'), sel)));
			}
			const cols = (u.devices && u.devices.columns) || [];
			const ci = n => cols.indexOf(n);
			const names = {}; for (const c of clients || []) names[c.mac] = c;
			const list = ((u.devices && u.devices.data) || []).map(r => ({ mac: String(r[ci('mac')] || '').toLowerCase(), down: +r[ci('rx_bytes')] || 0, up: +r[ci('tx_bytes')] || 0 }))
				.filter(d => d.mac && d.mac !== '00:00:00:00:00:00')
				.map(d => Object.assign(d, { total: d.down + d.up })).sort((a, b) => b.total - a.total);
			const max = list.length ? list[0].total : 1;
			const sum = list.reduce((a, d) => a + d.total, 0);
			if (!list.length) kids.push(h('div', { class: 'group' }, h('div', { class: 'empty' }, 'No traffic counted yet in this period.')));
			else {
				kids.push(group(...list.slice(0, 60).map(d => {
					const c = names[d.mac];
					const r = row({ icon: c ? (c.kind === 'cable' ? 'cable' : c.kind === 'tv' ? 'tv' : c.kind === 'laptop' ? 'laptop' : 'phone') : 'devices',
						label: c ? c.label : d.mac, sub: both(d.down, d.up), value: fmt.bytes(d.total) });
					r.querySelector('.main').appendChild(bar(d.total, max));
					return r;
				})));
				kids.push(hint(`${list.length} device${list.length === 1 ? '' : 's'} · ${fmt.bytes(sum)} in total. Counted by nlbwmon; traffic between devices at home isn't included.`));
			}
		}
		body.replaceChildren(...kids);
	}
	await load();
	every(30000, () => period ? null : load());
}

/* ======================= mobile & eSIM ======================= */

async function renderMobile(page) {
	const { h, row, group, sectionTitle, hint, note, every, call, btn, busy, info, uci } = App;
	const status = h('div', h('div', { class: 'skeleton' }));
	const settings = h('div');
	const esim = h('div', h('div', { class: 'skeleton' }));
	page.append(backLink(), h('h1', { class: 'page-title' }, 'Mobile & eSIM'), status, sectionTitle('Connection'), settings,
		sectionTitle('eSIM profiles', info.lpac ? h('a', { class: 'link', href: '#', onclick: e => { e.preventDefault(); openAddProfile(refreshEsim); } }, 'Add profile') : null), esim);

	let showIds = false;
	async function loadStatus() {
		const m = await call('home-ui', 'modem_status');
		if (m && m.simple) return drawSimple(m.simple);
		const mm = m && m.modem && m.modem.modem;
		if (!mm) {
			status.replaceChildren(note((m && m.error) || 'No modem found yet. It can take 2 minutes after the router starts.', 'warn'),
				h('div', { class: 'btn-row' }, restartMM()));
			return;
		}
		const g = mm.generic || {}, op = mm['3gpp'] || {};
		const sig = (m.signal && m.signal.modem && m.signal.modem.signal) || {};
		const nr = sig['5g'] || {}, lte = sig.lte || {};
		const val = v => v && v !== '--' ? v : null;
		const num = v => val(v) ? String(Math.round(parseFloat(v) * 10) / 10).replace('-', '−') : '—';
		const q = +(g['signal-quality'] && g['signal-quality'].value) || 0;
		const bearer = m.bearer && m.bearer.bearer;
		const ip4 = bearer && bearer['ipv4-config'] && bearer['ipv4-config'].address;
		status.replaceChildren(h('div', { class: 'group' }, h('dl', { class: 'kv' },
			h('dt', 'Carrier'), h('dd', op['operator-name'] || '—'),
			h('dt', 'State'), h('dd', g.state === 'connected' ? 'Connected' : (g.state || '—')),
			h('dt', 'Network'), h('dd', techName(g['access-technologies'])),
			h('dt', 'Signal'), h('dd', Data.signalBars(q >= 75 ? -50 : q >= 50 ? -60 : q >= 25 ? -70 : q ? -80 : 0), ` ${q}%`),
			val(nr.rsrp) ? [h('dt', '5G signal'), h('dd', `${num(nr.rsrp)} dBm`), h('dt', '5G quality'), h('dd', `RSRQ ${num(nr.rsrq)} dB · SINR ${num(nr.snr)} dB`)] : null,
			val(lte.rsrp) ? [h('dt', 'LTE signal'), h('dd', `${num(lte.rsrp)} dBm`), h('dt', 'LTE quality'), h('dd', `RSRQ ${num(lte.rsrq)} dB · SINR ${num(lte.snr)} dB`)] : null,
			h('dt', 'Registration'), h('dd', ({ home: 'Home network', roaming: 'Roaming', searching: 'Searching…', denied: 'Refused by the carrier', idle: 'Not registered' })[op['registration-state']] || op['registration-state'] || '—'),
			ip4 ? [h('dt', 'Mobile address'), h('dd', ip4)] : null,
			h('dt', 'IMEI'), h('dd', h('a', { href: '#', onclick: e => { e.preventDefault(); showIds = !showIds; e.target.textContent = showIds ? (op.imei || '—') : 'Show'; } }, showIds ? (op.imei || '—') : 'Show')),
			h('dt', 'Model'), h('dd', `${g.manufacturer || ''} ${g.model || ''}`.trim() || '—'))),
			hint('RSRP above −90 dBm is good, below −110 dBm is weak. Moving the router near a window often helps.'),
			h('div', { class: 'btn-row' }, restartMM()));
	}
	/* status from a modem add-on (format in ADDONS.md) */
	function drawSimple(x) {
		const num = v => v != null && v !== '' ? String(Math.round(parseFloat(v) * 10) / 10).replace('-', '−') : '—';
		const q = +x.quality || 0;
		const blk = (n, b) => b && b.rsrp != null ? [h('dt', `${n} signal`), h('dd', `${num(b.rsrp)} dBm`), h('dt', `${n} quality`), h('dd', `RSRQ ${num(b.rsrq)} dB · SINR ${num(b.sinr)} dB`)] : null;
		status.replaceChildren(h('div', { class: 'group' }, h('dl', { class: 'kv' },
			h('dt', 'Carrier'), h('dd', x.carrier || '—'),
			h('dt', 'State'), h('dd', x.state === 'connected' ? 'Connected' : (x.state || '—')),
			h('dt', 'Network'), h('dd', techName(x.tech ? [x.tech] : [])),
			h('dt', 'Signal'), h('dd', Data.signalBars(q >= 75 ? -50 : q >= 50 ? -60 : q >= 25 ? -70 : q ? -80 : 0), ` ${q}%`),
			blk('5G', x.nr), blk('LTE', x.lte),
			h('dt', 'Registration'), h('dd', ({ home: 'Home network', roaming: 'Roaming', searching: 'Searching…', denied: 'Refused by the carrier', idle: 'Not registered' })[x.registration] || x.registration || '—'),
			x.ip ? [h('dt', 'Mobile address'), h('dd', x.ip)] : null,
			x.imei ? [h('dt', 'IMEI'), h('dd', h('a', { href: '#', onclick: e => { e.preventDefault(); showIds = !showIds; e.target.textContent = showIds ? x.imei : 'Show'; } }, showIds ? x.imei : 'Show'))] : null,
			x.model ? [h('dt', 'Model'), h('dd', x.model)] : null)),
			hint('RSRP above −90 dBm is good, below −110 dBm is weak. Moving the router near a window often helps.'));
	}
	function restartMM() {
		const b = btn('Restart modem service', () => busy(b, async () => {
			await App.rpc('home-ui', 'restart_service', { name: 'modemmanager' });
			App.toast('Restarting… the modem reconnects in about a minute');
		}), 'secondary small');
		return b;
	}

	async function loadSettings() {
		const netcfg = await uci.load('network');
		const mi = uci.sections(netcfg, 'interface').filter(s => Data.isModemProto(s.proto));
		const ifs = await Data.interfaces();
		settings.replaceChildren(mi.length ? group(...mi.map(s => {
			const st = ifs.find(i => i.interface === s['.name']) || { interface: s['.name'], proto: s.proto };
			return row({ icon: 'antenna', label: `APN: ${s.apn || 'not set'}`, sub: `${st.up ? 'Connected' : 'Not connected'} · roaming ${s.allow_roaming === '1' ? 'allowed' : 'off'}`,
				onClick: () => openInterface(st, s, () => { loadSettings(); loadStatus(); }) });
		})) : h('div', h('div', { class: 'group' }, h('div', { class: 'empty' }, 'No mobile connection is set up yet.')),
			h('div', { class: 'btn-row' }, btn('Set up mobile connection', () => openAddConnection(loadSettings), 'small'))));
	}

	/* ---- eSIM ---- */
	let polling = null;
	async function refreshEsim(startList) {
		if (!info.lpac) {
			esim.replaceChildren(note('eSIM management needs the lpac package (built with QMI over QRTR). Add it to your firmware build.', 'warn'));
			return;
		}
		if (startList) await App.rpc('home-ui', 'esim', { action: 'list' });
		const st = await call('home-ui', 'esim_status');
		const job = (st && st.job) || { state: 'idle' };
		const prof = st && st.profiles && st.profiles.payload;
		const kids = [];
		if (job.state === 'running') {
			kids.push(note(h('span', h('span', { class: 'spinner' }), ' ', job.step || 'Working…', '. Mobile data is paused until this finishes.')));
			if (!polling) polling = setTimeout(() => { polling = null; refreshEsim(); }, 2500);
		} else if (job.state === 'error') {
			kids.push(note(job.error, 'bad'));
		} else if (job.state === 'done' && job.result && job.result.payload && job.result.payload.code !== 0) {
			kids.push(note(`The eSIM said: ${esimError(job.result.payload)}`, 'bad'));
		} else if (job.state === 'done' && job.action && job.action !== 'list' && job.action !== 'chip') {
			kids.push(note({ enable: 'Profile switched. The modem needs about a minute to register on the new network.', disable: 'Profile turned off.', delete: 'Profile deleted.', nickname: 'Profile renamed.', download: 'Profile downloaded. Tap it and choose “Use this profile” to switch to it.' }[job.action] || 'Done.'));
		}
		const list = (prof && prof.code === 0 && Array.isArray(prof.data)) ? prof.data : null;
		if (list) {
			kids.push(list.length ? group(...list.map(p => row({
				icon: 'sim', iconColor: p.profileState === 'enabled' ? 'var(--online)' : null,
				label: p.profileNickname || p.serviceProviderName || p.profileName || 'Profile',
				sub: `${p.serviceProviderName || ''}${p.profileNickname && p.profileName ? ' · ' + p.profileName : ''} · ICCID …${String(p.iccid || '').slice(-6)}`,
				right: p.profileState === 'enabled' ? h('span', { class: 'badge good' }, 'In use') : null,
				onClick: job.state === 'running' ? null : () => openProfile(p, refreshEsim)
			}))) : h('div', { class: 'group' }, h('div', { class: 'empty' }, 'No profiles on the eSIM. Use “Add profile” with the code from your carrier.')));
		} else if (job.state !== 'running') {
			kids.push(h('div', { class: 'group' }, h('div', { class: 'empty' }, 'Profiles haven\'t been read yet.')));
		}
		const rb = btn(list ? 'Read profiles again' : 'Read profiles', () => busy(rb, () => refreshEsim(true)), 'secondary small', { disabled: job.state === 'running' });
		kids.push(h('div', { class: 'btn-row' }, rb), hint('Reading or changing the eSIM pauses mobile data for about 30 seconds.'));
		esim.replaceChildren(...kids);
	}

	await Promise.all([loadStatus(), loadSettings(), refreshEsim()]);
	every(15000, loadStatus);
}

function techName(t) {
	t = [].concat(t || []);
	const n = [];
	if (t.includes('5gnr')) n.push('5G');
	if (t.includes('lte')) n.push('LTE');
	if (t.some(x => /umts|hspa/.test(x))) n.push('3G');
	return n.join(' + ') || (t.join(', ').toUpperCase() || '—');
}

function esimError(p) {
	const m = String(p.message || '') + (p.data ? ' ' + (typeof p.data === 'string' ? p.data : JSON.stringify(p.data)) : '');
	if (/es10b_ProfileDownload|matchingId|MatchingID|refused/i.test(m)) return 'The activation code was refused. It may already have been used; ask the carrier for a new one. (' + m + ')';
	if (/catBusy|disallowedByPolicy/i.test(m)) return 'The eSIM refused the change. Turn off the active profile first. (' + m + ')';
	if (/curl|tls|ssl|http/i.test(m)) return 'The router could not reach the carrier\'s server. Check that the router has internet through another connection. (' + m + ')';
	return m || 'unknown error';
}

function openProfile(p, refresh) {
	const { h, row, group, field, input, btn, busy, rpc, sheet, confirm, sectionTitle, hint } = App;
	const run = async (action, extra) => {
		await rpc('home-ui', 'esim', Object.assign({ action, iccid: p.iccid }, extra || {}));
		refresh();
	};
	sheet(p.profileNickname || p.serviceProviderName || 'Profile', close => {
		const nick = input({ value: p.profileNickname || '', placeholder: p.serviceProviderName || 'Name', maxlength: 64 });
		const en = p.profileState === 'enabled';
		const use = btn(en ? 'Turn off this profile' : 'Use this profile', async () => {
			if (!await confirm(en ? 'Turn off this profile?' : 'Switch to this profile?', en ? 'The modem will have no mobile service until you turn a profile on.' : 'The modem switches carriers. Mobile data stops for about a minute.', en ? 'Turn off' : 'Switch', en)) return;
			await busy(use, () => run(en ? 'disable' : 'enable')); close();
		}, en ? 'secondary' : '');
		const ren = btn('Rename', () => busy(ren, async () => { await run('nickname', { name: nick.value.trim() }); close(); }), 'secondary');
		const del = btn('Delete profile', async () => {
			if (!await confirm('Delete this profile?', 'This can\'t be undone. You will need a new activation code from the carrier to get it back.', 'Delete', true)) return;
			await busy(del, () => run('delete')); close();
		}, 'danger small', { disabled: en, title: en ? 'Turn it off first' : null });
		return h('div',
			h('div', { class: 'group' }, h('dl', { class: 'kv' },
				h('dt', 'Carrier'), h('dd', p.serviceProviderName || '—'),
				h('dt', 'Profile'), h('dd', p.profileName || '—'),
				h('dt', 'State'), h('dd', en ? 'In use' : 'Off'),
				h('dt', 'ICCID'), h('dd', { class: 'mono' }, p.iccid || '—'))),
			h('div', { class: 'btn-row' }, use),
			sectionTitle('Name'),
			h('div', { class: 'group' }, field('Nickname', nick)),
			h('div', { class: 'btn-row' }, ren),
			sectionTitle('Remove'),
			hint(en ? 'Turn the profile off before deleting it.' : 'Deleting removes the profile from the eSIM for good.'),
			h('div', { class: 'btn-row' }, del));
	});
}

function openAddProfile(refresh) {
	const { h, field, input, btn, busy, rpc, sheet, hint, note } = App;
	sheet('Add an eSIM profile', close => {
		const code = h('textarea', { placeholder: 'LPA:1$smdp.example.com$ABCD-1234', rows: 3, autocapitalize: 'off', spellcheck: 'false' });
		const conf = input({ placeholder: 'Only if the carrier gave you one' });
		const go = btn('Download profile', () => busy(go, async () => {
			const c = code.value.trim();
			if (!/^(LPA:)?1\$[^$]+\$/i.test(c)) throw new Error('The code should start with LPA:1$ followed by the server address');
			await rpc('home-ui', 'esim', { action: 'download', code: c, confirm: conf.value.trim() });
			close(); refresh();
		}));
		return h('div',
			note('The router needs internet (WAN port or the current profile) to download a new profile.'),
			h('div', { class: 'group' }, field('Activation code', code), field('Confirmation code', conf)),
			hint('The activation code is the text inside the carrier\'s QR code. Most carrier emails also show it as text, or a QR reader app on your phone can copy it.'),
			h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), go));
	});
}

/* ======================= DNS ======================= */

const DNS_PRESETS = [
	['isp', 'Your internet provider', 'The default. Uses whatever your provider hands out.', []],
	['cloudflare', 'Cloudflare', 'Fast and private.', ['1.1.1.1', '1.0.0.1', '2606:4700:4700::1111', '2606:4700:4700::1001']],
	['cloudflare-sec', 'Cloudflare, blocks malware', 'Stops known malicious sites.', ['1.1.1.2', '1.0.0.2', '2606:4700:4700::1112', '2606:4700:4700::1002']],
	['cloudflare-family', 'Cloudflare for families', 'Blocks malware and adult content.', ['1.1.1.3', '1.0.0.3', '2606:4700:4700::1113', '2606:4700:4700::1003']],
	['google', 'Google', 'Fast and reliable.', ['8.8.8.8', '8.8.4.4', '2001:4860:4860::8888', '2001:4860:4860::8844']],
	['quad9', 'Quad9', 'Blocks malware, privacy focused.', ['9.9.9.9', '149.112.112.112', '2620:fe::fe', '2620:fe::9']],
	['adguard', 'AdGuard', 'Blocks most ads and trackers for every device.', ['94.140.14.14', '94.140.15.15', '2a10:50c0::ad1:ff', '2a10:50c0::ad2:ff']],
	['custom', 'Custom', 'Enter your own servers.', null]
];

async function renderDns(page) {
	const { h, row, group, sectionTitle, hint, note, btn, busy, uci, input, field, info } = App;
	const dhcp = await uci.load('dhcp');
	const dm = uci.sections(dhcp, 'dnsmasq')[0];
	if (!dm) { page.append(backLink(), h('h1', { class: 'page-title' }, 'DNS'), note('The DNS service (dnsmasq) isn\'t set up on this router.', 'warn')); return; }
	const servers = [].concat(dm.server || []).filter(s => !s.startsWith('/'));
	const current = dm.noresolv === '1' && servers.length
		? (DNS_PRESETS.find(p => p[3] && p[3].length && p[3].slice(0, 2).every(x => servers.includes(x))) || DNS_PRESETS[DNS_PRESETS.length - 1])[0]
		: 'isp';
	let choice = current;
	const custom = input({ value: current === 'custom' ? servers.join(' ') : '', placeholder: 'For example: 1.1.1.1 9.9.9.9' });
	const customField = field('DNS servers', custom); customField.hidden = choice !== 'custom';
	const radios = DNS_PRESETS.map(([id, label, sub]) => {
		const r = h('input', { type: 'radio', name: 'dns', value: id, checked: id === choice, style: { width: '20px', height: '20px', accentColor: 'var(--accent)' },
			onchange: () => { choice = id; customField.hidden = id !== 'custom'; } });
		return h('label', { class: 'row', style: { cursor: 'pointer' } }, r, h('span', { class: 'main' }, h('div', { class: 'label' }, label), h('div', { class: 'sub' }, sub)));
	});
	const save = btn('Save', () => busy(save, async () => {
		let list = [];
		if (choice === 'custom') {
			list = custom.value.trim().split(/[\s,]+/).filter(Boolean);
			if (!list.length || !list.every(x => /^[0-9a-fA-F.:#]+$/.test(x))) throw new Error('Enter one or more server addresses separated by spaces');
		} else if (choice !== 'isp') list = DNS_PRESETS.find(p => p[0] === choice)[3];
		const keep = [].concat(dm.server || []).filter(s => s.startsWith('/'));
		if (list.length) await uci.set('dhcp', dm['.name'], { server: keep.concat(list), noresolv: '1' });
		else {
			if (keep.length) await uci.set('dhcp', dm['.name'], { server: keep, noresolv: '0' });
			else { await uci.unset('dhcp', dm['.name'], ['server']); await uci.set('dhcp', dm['.name'], { noresolv: '0' }); }
		}
		await uci.apply();
	}));
	page.append(backLink(), h('h1', { class: 'page-title' }, 'DNS'),
		hint('DNS turns website names into addresses. The router answers for every device at home, so a change here applies to all of them.'),
		sectionTitle('Who answers'),
		h('div', { class: 'group' }, radios, customField),
		info.doh ? note('Encrypted DNS (https-dns-proxy) is installed. It is managed in the advanced settings and may override this choice.') : null,
		h('div', { class: 'btn-row' }, save),
		sectionTitle('Device names'),
		hint('Devices you name on the Devices page can be reached by name, for example printer.lan.'));
}

/* ======================= VPN ======================= */

async function renderVpn(page) {
	const { h, row, group, sectionTitle, hint, note, btn, busy, uci, call, every, info, fmt } = App;
	const wgBox = h('div', h('div', { class: 'skeleton' }));
	const tsBox = h('div');
	const pvBox = h('div', h('div', { class: 'skeleton' }));
	page.append(backLink(), h('h1', { class: 'page-title' }, 'VPN'),
		info.protonvpn ? [sectionTitle('Proton VPN'), pvBox] : null,
		sectionTitle('WireGuard', info.wireguard ? h('a', { class: 'link', href: '#', onclick: e => { e.preventDefault(); openAddVpn(loadWg); } }, 'Add VPN') : null), wgBox,
		sectionTitle('Tailscale'), tsBox);
	const loadPv = () => info.protonvpn ? Proton.render(pvBox, loadPv) : null;

	async function loadWg() {
		if (!info.wireguard) {
			wgBox.replaceChildren(note('WireGuard isn\'t installed. Add wireguard-tools and kmod-wireguard (and luci-proto-wireguard for the advanced settings) to your firmware build.', 'warn'));
			return;
		}
		const [netcfg, st, ifs, pvcfg] = await Promise.all([uci.load('network'), call('home-ui', 'wg_status'), Data.interfaces(), info.protonvpn ? uci.load('protonvpn') : {}]);
		const dump = parseWg(st && st.dump);
		/* tunnels managed by the Proton VPN service are shown in their own section */
		const proton = new Set(info.protonvpn ? Proton.managedInterfaces(pvcfg) : []);
		const wgs = uci.sections(netcfg, 'interface').filter(s => s.proto === 'wireguard' && !proton.has(s['.name']) && !Object.keys(s).some(k => k.startsWith('protonvpn_')));
		if (!wgs.length) {
			wgBox.replaceChildren(h('div', { class: 'group' }, h('div', { class: 'empty' }, 'No WireGuard VPN yet.')),
				h('div', { class: 'btn-row' }, btn('Add VPN', () => openAddVpn(loadWg), 'small')));
			return;
		}
		wgBox.replaceChildren(group(...wgs.map(s => {
			const n = s['.name'], d = dump[n] || { peers: [] };
			const peers = uci.sections(netcfg, 'wireguard_' + n);
			const server = !!s.listen_port && peers.every(p => !p.endpoint_host);
			const live = d.peers.filter(p => p.handshake && Date.now() / 1000 - p.handshake < 180).length;
			const st = ifs.find(i => i.interface === n);
			return row({ icon: 'vpn', iconColor: live ? 'var(--online)' : null,
				label: n, sub: server ? `Home VPN server · ${peers.length} device${peers.length === 1 ? '' : 's'} · ${live} connected now`
					: `${st && st.up ? (live ? 'Connected' : 'Waiting for the server') : 'Off'}${peers[0] && peers[0].endpoint_host ? ' · ' + peers[0].endpoint_host : ''}`,
				right: h('span', { class: 'dot ' + (live ? 'on' : st && st.up ? 'warn' : '') }),
				onClick: () => openWg(s, peers, d, server, loadWg) });
		})));
	}

	async function loadTs() {
		if (!info.tailscale) {
			tsBox.replaceChildren(note('Tailscale isn\'t installed. Add the tailscale package to your firmware build to use it.', 'warn'));
			return;
		}
		const t = await call('home-ui', 'tailscale_status');
		const s = (t && t.status) || {};
		const prefs = (t && t.prefs) || {};
		const state = s.BackendState || 'Stopped';
		const self = s.Self || {};
		const lan = await Net.lanSubnet();
		const routes = [].concat(prefs.AdvertiseRoutes || []).filter(r => r !== '0.0.0.0/0' && r !== '::/0');
		const exitNode = [].concat(prefs.AdvertiseRoutes || []).includes('0.0.0.0/0');
		const fw = await uci.load('firewall');
		const hasZone = uci.sections(fw, 'zone').some(z => z.name === 'tailscale');
		const kids = [];
		if (state === 'Running') {
			const shareLan = App.toggle(routes.includes(lan), null, 'Share home network');
			const exitT = App.toggle(exitNode, null, 'Exit node');
			const apply = async () => {
				await App.rpc('home-ui', 'tailscale', { action: 'set', routes: shareLan.checked ? lan : '', exit_node: exitT.checked });
				App.toast('Saved. Approve the change in the Tailscale admin console.');
			};
			shareLan.onchange = apply; exitT.onchange = apply;
			kids.push(group(
				row({ icon: 'vpn', iconColor: 'var(--online)', label: 'Connected', sub: `${self.HostName || ''} · ${(self.TailscaleIPs || [])[0] || ''}` }),
				row({ icon: 'home', label: 'Share home network', sub: `Tailscale devices can reach ${lan}`, right: shareLan }),
				row({ icon: 'globe', label: 'Use as exit node', sub: 'Other devices can send all their internet through home', right: exitT })),
				hint('After turning these on, approve them in the Tailscale admin console (Machines → this router → Edit route settings).'),
				!hasZone ? note(h('span', 'Tailscale devices can\'t reach your home network until the firewall allows it. ', h('a', { href: '#', onclick: e => { e.preventDefault(); setupTsFirewall(); } }, 'Set up the firewall'))) : null);
			const down = btn('Disconnect', () => busy(down, async () => { await App.rpc('home-ui', 'tailscale', { action: 'down' }); loadTs(); }), 'secondary small');
			const out = btn('Sign out', () => busy(out, async () => { await App.rpc('home-ui', 'tailscale', { action: 'logout' }); loadTs(); }), 'secondary small');
			kids.push(h('div', { class: 'btn-row' }, down, out));
		} else {
			const url = t && t.login_url;
			kids.push(group(row({ icon: 'vpn', label: state === 'NeedsLogin' ? 'Sign in needed' : state === 'Stopped' ? 'Not connected' : state,
				sub: 'Connect this router to your Tailscale account' })));
			if (url && state === 'NeedsLogin') kids.push(note(h('span', 'Open this link and sign in to add the router: ', h('a', { href: url, target: '_blank', rel: 'noopener' }, url))));
			const up = btn('Connect', () => busy(up, async () => {
				const r = await App.rpc('home-ui', 'tailscale', { action: 'up' });
				if (r.login_url) window.open(r.login_url, '_blank', 'noopener');
				loadTs();
			}), 'small');
			kids.push(h('div', { class: 'btn-row' }, up));
		}
		tsBox.replaceChildren(...kids);
	}

	async function setupTsFirewall() {
		await busy(null, async () => {
			const netcfg = await uci.load('network');
			if (!netcfg.tailscale) await uci.add('network', 'interface', { proto: 'none', device: 'tailscale0' }, 'tailscale');
			await uci.add('firewall', 'zone', { name: 'tailscale', network: ['tailscale'], input: 'ACCEPT', output: 'ACCEPT', forward: 'ACCEPT', masq: '1', mtu_fix: '1' });
			for (const [src, dest] of [['tailscale', 'lan'], ['tailscale', 'wan'], ['lan', 'tailscale']])
				await uci.add('firewall', 'forwarding', { src, dest });
			if (await uci.apply('Setting up the firewall…')) loadTs();
		});
	}

	await Promise.all([loadWg(), loadTs(), loadPv()]);
	every(20000, () => Promise.all([loadWg(), loadTs(), loadPv()]));
}

function parseWg(text) {
	const out = {};
	for (const line of (text || '').split('\n')) {
		const f = line.split('\t');
		if (f.length === 5) out[f[0]] = { pub: f[2], port: f[3], peers: [] };
		else if (f.length >= 9 && out[f[0]]) out[f[0]].peers.push({ pub: f[1], endpoint: f[3], allowed: f[4], handshake: +f[5] || 0, rx: +f[6] || 0, tx: +f[7] || 0 });
	}
	return out;
}

function wgClientConfig(peer, server) {
	return [
		'[Interface]',
		`PrivateKey = ${peer.private_key}`,
		`Address = ${[].concat(peer.allowed_ips || [])[0]}`,
		`DNS = ${server.dns}`,
		'',
		'[Peer]',
		`PublicKey = ${server.pub}`,
		`Endpoint = ${server.endpoint}:${server.port}`,
		'AllowedIPs = 0.0.0.0/0, ::/0',
		'PersistentKeepalive = 25',
		''
	].join('\n');
}

async function openWg(s, peers, d, server, reload) {
	const { h, row, group, field, input, btn, busy, uci, rpc, call, sheet, confirm, sectionTitle, hint, note, fmt, qrSvg } = App;
	const n = s['.name'];
	const ui = await uci.load('home-ui');
	const meta = ui[n] || {};
	const keys = s.private_key ? await call('home-ui', 'wg_keys', { private: s.private_key }) : null;
	const live = pub => (d.peers.find(p => p.pub === pub) || {});
	const addr = [].concat(s.addresses || [])[0] || '';

	sheet(n, close => {
		const body = h('div');
		const del = btn('Delete VPN', async () => {
			if (!await confirm(`Delete ${n}?`, server ? 'Every device using it loses access.' : 'The router stops using this VPN.', 'Delete', true)) return;
			await busy(del, async () => {
				for (const p of peers) await uci.remove('network', p['.name']);
				await Net.removeFromZones(n);
				await uci.remove('network', n);
				const fw = await uci.load('firewall');
				for (const r of uci.sections(fw, 'rule')) if (r.name === `Allow WireGuard ${n}`) await uci.remove('firewall', r['.name']);
				if (meta['.name']) await uci.remove('home-ui', n);
				if (await uci.apply()) { close(); reload(); }
			});
		}, 'secondary small');

		if (server) {
			const ep = input({ value: meta.endpoint || '', placeholder: 'Your public address or a dynamic DNS name' });
			const saveEp = btn('Save address', () => busy(saveEp, async () => {
				if (meta['.name']) await uci.set('home-ui', n, { endpoint: ep.value.trim() });
				else await uci.add('home-ui', 'wireguard', { endpoint: ep.value.trim() }, n);
				await uci.apply(); meta.endpoint = ep.value.trim();
			}), 'secondary small');
			const peerRows = peers.map(p => {
				const l = live(p.public_key);
				return row({ icon: 'phone', iconColor: l.handshake && Date.now() / 1000 - l.handshake < 180 ? 'var(--online)' : null,
					label: p.description || 'Device', sub: l.handshake ? `Last seen ${fmt.ago(Date.now() / 1000 - l.handshake)} · ↓${fmt.bytes(l.tx)} ↑${fmt.bytes(l.rx)}` : 'Never connected',
					onClick: () => showPeer(p) });
			});
			const addPeer = btn('Add a device', () => busy(addPeer, async () => {
				const nm = prompt('Name for the device (for example: Living room TV)');
				if (!nm) return;
				const k = await rpc('home-ui', 'wg_keys', {});
				const base = addr.split('/')[0].split('.').map(Number);
				const used = new Set(peers.map(p => [].concat(p.allowed_ips || [])[0]).filter(Boolean).map(a => +a.split('/')[0].split('.')[3]));
				used.add(base[3]);
				let host = 2; while (used.has(host)) host++;
				const ip = `${base[0]}.${base[1]}.${base[2]}.${host}/32`;
				await uci.add('network', 'wireguard_' + n, { description: nm, public_key: k.public, private_key: k.private, allowed_ips: [ip], route_allowed_ips: '0', persistent_keepalive: '25' });
				if (await uci.apply('Adding device…')) { close(); reload(); showPeer({ description: nm, private_key: k.private, allowed_ips: [ip] }); }
			}), 'small');
			function showPeer(p) {
				if (!p.private_key) return App.sheet(p.description || 'Device', note('This device was added outside this page, so its setup code isn\'t stored here.'));
				if (!meta.endpoint) return App.toast('Save the router\'s public address first', { bad: true });
				const conf = wgClientConfig(p, { pub: keys && keys.public, endpoint: meta.endpoint, port: s.listen_port, dns: addr.split('/')[0] });
				App.sheet(p.description || 'Device', close2 => h('div',
					qrSvg(conf),
					hint('In the WireGuard app tap + → Scan from QR code. On a computer, save the text below as a .conf file and import it.'),
					h('pre', { class: 'code' }, conf),
					h('div', { class: 'actions' },
						btn('Copy', () => { navigator.clipboard && navigator.clipboard.writeText(conf).then(() => App.toast('Copied')); }, 'secondary'),
						p['.name'] ? btn('Remove device', async () => {
							if (!await confirm('Remove this device?', 'It will no longer be able to connect.', 'Remove', true)) return;
							await uci.remove('network', p['.name']); if (await uci.apply()) { close2(); close(); reload(); }
						}, 'danger') : null)));
			}
			body.append(
				h('div', { class: 'group' }, h('dl', { class: 'kv' }, h('dt', 'Type'), h('dd', 'VPN server for your devices'), h('dt', 'Port'), h('dd', 'UDP ' + s.listen_port), h('dt', 'VPN network'), h('dd', addr))),
				sectionTitle('Router\'s public address'),
				h('div', { class: 'group' }, field('Address devices connect to', ep)),
				hint('Your home internet address, or a dynamic DNS name if it changes. On 5G, the carrier usually blocks incoming connections, so this only works through the WAN port or with Tailscale.'),
				h('div', { class: 'btn-row' }, saveEp),
				sectionTitle('Devices'),
				peerRows.length ? group(...peerRows) : h('div', { class: 'group' }, h('div', { class: 'empty' }, 'No devices yet.')),
				h('div', { class: 'btn-row' }, addPeer));
		} else {
			const p = peers[0] || {};
			const l = live(p.public_key);
			const allTraffic = [].concat(p.allowed_ips || []).some(a => a === '0.0.0.0/0');
			body.append(h('div', { class: 'group' }, h('dl', { class: 'kv' },
				h('dt', 'Server'), h('dd', `${p.endpoint_host || '—'}:${p.endpoint_port || ''}`),
				h('dt', 'Last handshake'), h('dd', l.handshake ? fmt.ago(Date.now() / 1000 - l.handshake) : 'Never'),
				h('dt', 'Traffic'), h('dd', `↓ ${fmt.bytes(l.rx)} · ↑ ${fmt.bytes(l.tx)}`),
				h('dt', 'Your VPN address'), h('dd', [].concat(s.addresses || []).join(', ')),
				h('dt', 'Sends'), h('dd', allTraffic && p.route_allowed_ips === '1' ? 'All internet traffic' : 'Only the VPN\'s own network'))),
				!l.handshake ? hint('No handshake yet usually means a wrong key, a wrong server address or a blocked port.') : null);
		}
		body.append(h('div', { class: 'btn-row', style: { justifyContent: 'center', marginTop: '22px' } }, del));
		return body;
	});
}

function parseWgConf(text) {
	const out = { iface: {}, peers: [] };
	let cur = null;
	for (let line of text.split(/\r?\n/)) {
		line = line.replace(/#.*$/, '').trim();
		if (!line) continue;
		if (/^\[interface\]$/i.test(line)) { cur = out.iface; continue; }
		if (/^\[peer\]$/i.test(line)) { cur = {}; out.peers.push(cur); continue; }
		const m = line.match(/^([A-Za-z]+)\s*=\s*(.+)$/);
		if (m && cur) cur[m[1].toLowerCase()] = m[2].trim();
	}
	return out;
}

function openAddVpn(reload) {
	const { h, row, group, field, input, toggle, btn, busy, uci, rpc, sheet, hint, note, sectionTitle } = App;
	sheet('Add a VPN', close => {
		const body = h('div');
		const choose = () => body.replaceChildren(group(
			row({ icon: 'globe', label: 'Connect to a VPN service', sub: 'Use a .conf file from Proton, Mullvad, a friend\'s server…', onClick: clientForm }),
			row({ icon: 'home', label: 'Reach home from anywhere', sub: 'Turn this router into a VPN server for your phone and laptop', onClick: serverForm })));

		function clientForm() {
			const conf = h('textarea', { placeholder: '[Interface]\nPrivateKey = …\nAddress = …\n\n[Peer]\nPublicKey = …\nEndpoint = …\nAllowedIPs = 0.0.0.0/0', rows: 9, spellcheck: 'false' });
			const file = h('input', { type: 'file', accept: '.conf,text/plain', onchange: async () => { if (file.files[0]) conf.value = await file.files[0].text(); } });
			const all = toggle(true, null, 'Send all traffic');
			const save = btn('Add VPN', () => busy(save, async () => {
				const c = parseWgConf(conf.value);
				const p = c.peers[0];
				if (!c.iface.privatekey || !c.iface.address || !p || !p.publickey || !p.endpoint) throw new Error('That doesn\'t look like a complete WireGuard config. It needs PrivateKey, Address, and a [Peer] with PublicKey and Endpoint.');
				const netcfg = await uci.load('network');
				const n = Net.freeName(netcfg, 'vpn');
				const ep = p.endpoint.match(/^\[?([^\]]+?)\]?:(\d+)$/);
				const vals = { proto: 'wireguard', private_key: c.iface.privatekey, addresses: c.iface.address.split(/\s*,\s*/) };
				if (c.iface.mtu) vals.mtu = c.iface.mtu;
				if (c.iface.dns) vals.dns = c.iface.dns.split(/\s*,\s*/).filter(x => /^[0-9a-fA-F.:]+$/.test(x));
				await uci.add('network', 'interface', vals, n);
				const pv = { description: 'server', public_key: p.publickey, endpoint_host: ep ? ep[1] : p.endpoint, endpoint_port: ep ? ep[2] : '51820',
					allowed_ips: p.allowedips ? p.allowedips.split(/\s*,\s*/) : ['0.0.0.0/0', '::/0'], route_allowed_ips: all.checked ? '1' : '0', persistent_keepalive: p.persistentkeepalive || '25' };
				if (p.presharedkey) pv.preshared_key = p.presharedkey;
				await uci.add('network', 'wireguard_' + n, pv);
				await Net.addToZone('wan', n);
				if (await uci.apply('Connecting…')) { close(); reload(); }
			}));
			body.replaceChildren(
				h('div', { class: 'group' }, field('Paste the config', conf), field('Or pick the file', file)),
				h('div', { style: { height: '12px' } }),
				group(row({ icon: 'globe', label: 'Send all internet through the VPN', sub: 'Every device at home will use it', right: all })),
				hint('Keep the config private: it contains the key to your VPN account.'),
				h('div', { class: 'actions' }, btn('Back', choose, 'secondary'), save));
		}

		function serverForm() {
			const port = input({ value: '51820', inputmode: 'numeric' });
			const net = input({ value: '10.8.0.1/24' });
			const save = btn('Create VPN server', () => busy(save, async () => {
				if (!/^\d+$/.test(port.value) || +port.value < 1 || +port.value > 65535) throw new Error('Enter a port between 1 and 65535');
				if (!/^\d{1,3}(\.\d{1,3}){3}\/\d+$/.test(net.value.trim())) throw new Error('Enter the VPN network like 10.8.0.1/24');
				const k = await rpc('home-ui', 'wg_keys', {});
				const netcfg = await uci.load('network');
				const n = Net.freeName(netcfg, 'wghome');
				await uci.add('network', 'interface', { proto: 'wireguard', private_key: k.private, listen_port: port.value, addresses: [net.value.trim()] }, n);
				await Net.addToZone('lan', n);
				await uci.add('firewall', 'rule', { name: `Allow WireGuard ${n}`, src: 'wan', dest_port: port.value, proto: 'udp', target: 'ACCEPT' });
				const ifs = await Data.interfaces();
				const w = ifs.find(i => i.interface === 'wan');
				const pub = w && (w['ipv4-address'] || [])[0];
				await uci.add('home-ui', 'wireguard', { endpoint: pub ? pub.address : '' }, n);
				if (await uci.apply('Creating VPN server…')) { close(); reload(); }
			}));
			body.replaceChildren(
				note('Devices connected to this VPN act as if they were at home: they can reach your devices and use your internet.'),
				h('div', { class: 'group' }, field('Port (UDP)', port), field('VPN network', net)),
				hint('The defaults are fine for almost everyone. Next you\'ll add each phone or laptop and get a QR code for the WireGuard app.'),
				h('div', { class: 'actions' }, btn('Back', choose, 'secondary'), save));
		}
		choose();
		return body;
	});
}
