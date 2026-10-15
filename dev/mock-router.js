// Mock OpenWrt router for testing Router Home (ubus JSON-RPC + cgi-io)
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || '/home/claude/home-ui/files/www';
const PORT = +(process.argv[3] || 8088);
const BOARD = process.argv[4] || 'askey,cbe1v1k';
const SID = 'a'.repeat(32);
let cfgn = 100;

const PV = { session: process.env.PV_SESSION || 'no_session', enabled: false, applying: 0, gw: 'CH#12', cc: 'ch', city: 'ch-zurich' };
const uci = {
	protonvpn: { main: { '.type': 'instance', enabled: '1', interface: 'protonvpn', hop_mode: 'standard', killswitch: '0', vpn_dns: 'off', rotation_enabled: '0', rotation_mode: 'interval', rotation_interval: '360' } },
	network: {
		loopback: { '.type': 'interface', proto: 'static', device: 'lo', ipaddr: '127.0.0.1' },
		lan: { '.type': 'interface', proto: 'static', device: 'br-lan', ipaddr: '192.168.1.1', netmask: '255.255.255.0' },
		wan: { '.type': 'interface', proto: 'dhcp', device: 'eth0', metric: '10' },
		wan6: { '.type': 'interface', proto: 'dhcpv6', device: 'eth0' },
		wwan: { '.type': 'interface', proto: 'modemmanager', device: '/sys/devices/platform/soc@0/28000000.pcie/pci0000:00/0000:00:00.0/0000:01:00.0', apn: 'internet', iptype: 'ipv4v6', metric: '20', allow_roaming: '1' },
		protonvpn: { '.type': 'interface', proto: 'wireguard', private_key: 'kEYkEYkEYkEYkEYkEYkEYkEYkEYkEYkEYkEYkEYkEYk=', protonvpn_country_code: 'ca' },
		vpn: { '.type': 'interface', proto: 'wireguard', private_key: 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=', addresses: ['10.64.12.7/32'], dns: ['10.64.0.1'] },
		cfg900: { '.type': 'wireguard_vpn', description: 'server', public_key: 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=', endpoint_host: 'ca-tor-wg-001.example.net', endpoint_port: '51820', allowed_ips: ['0.0.0.0/0', '::/0'], route_allowed_ips: '1', persistent_keepalive: '25' }
	},
	wireless: {
		radio0: { '.type': 'wifi-device', type: 'mac80211', path: 'pci1', band: '6g', channel: '37', htmode: 'EHT160', country: 'CA' },
		radio1: { '.type': 'wifi-device', type: 'mac80211', path: 'pci2', band: '5g', channel: '36', htmode: 'EHT80', country: 'CA' },
		radio2: { '.type': 'wifi-device', type: 'mac80211', path: 'pci3', band: '2g', channel: 'auto', htmode: 'EHT20', country: 'CA' },
		default_radio0: { '.type': 'wifi-iface', device: 'radio0', network: 'lan', mode: 'ap', ssid: 'HomeWiFi', encryption: 'sae', key: 'example-pass-1', ieee80211w: '2' },
		default_radio1: { '.type': 'wifi-iface', device: 'radio1', network: 'lan', mode: 'ap', ssid: 'HomeWiFi', encryption: 'sae-mixed', key: 'example-pass-1' },
		default_radio2: { '.type': 'wifi-iface', device: 'radio2', network: 'lan', mode: 'ap', ssid: 'HomeWiFi', encryption: 'sae-mixed', key: 'example-pass-1' }
	},
	dhcp: {
		cfg01: { '.type': 'dnsmasq', domain: 'lan', local: '/lan/', noresolv: '0' },
		lan: { '.type': 'dhcp', interface: 'lan', start: '100', limit: '150' },
		cfg02: { '.type': 'host', name: 'printer', mac: 'AA:BB:CC:00:00:05', ip: '192.168.1.50', dns: '1' }
	},
	firewall: {
		cfg10: { '.type': 'defaults', input: 'REJECT', output: 'ACCEPT', forward: 'REJECT' },
		cfg11: { '.type': 'zone', name: 'lan', network: ['lan'], input: 'ACCEPT', output: 'ACCEPT', forward: 'ACCEPT' },
		cfg12: { '.type': 'zone', name: 'wan', network: ['wan', 'wan6', 'wwan', 'vpn'], input: 'REJECT', output: 'ACCEPT', forward: 'REJECT', masq: '1' },
		cfg13: { '.type': 'rule', name: 'Pause internet: kids-tablet', src: 'lan', dest: '*', src_mac: ['de:ad:be:ef:00:07'], proto: 'all', target: 'REJECT' }
	},
	system: { cfg20: { '.type': 'system', hostname: BOARD.includes('cbe') ? 'CBE1V1K' : 'SBE1V1K', zonename: 'Asia/Hong Kong', timezone: 'HKT-8' } },
	'cbe-led': { main: { '.type': 'led', enabled: '1', brightness: '96', interval: '15' } },
	'sbe-led': { main: { '.type': 'led', enabled: '1', interval: '15' } },
	'home-ui': {}
};

function sectionsOut(cfg) {
	const out = {}; let i = 0;
	for (const [k, v] of Object.entries(cfg)) out[k] = Object.assign({ '.anonymous': k.startsWith('cfg'), '.name': k, '.index': i++ }, v);
	return out;
}

const clients = {
	'a4:c3:f0:11:22:33': { name: 'Phone', ip: '192.168.1.162', radio: 0, signal: -48, rate: 2401900, txrate: 2161800, mhz: 160 },
	'3c:22:fb:44:55:66': { name: 'Laptop', ip: '192.168.1.146', radio: 1, signal: -57, rate: 1200900, txrate: 1080000, mhz: 80 },
	'b8:27:eb:77:88:99': { name: 'chromecast', ip: '192.168.1.120', radio: 2, signal: -71, rate: 86000, txrate: 72000, mhz: 20 },
	'de:ad:be:ef:00:07': { name: 'kids-tablet', ip: '192.168.1.133', radio: 1, signal: -66, rate: 433000, txrate: 390000, mhz: 80 },
	'aa:bb:cc:00:00:05': { name: 'printer', ip: '192.168.1.50', wired: true },
	'00:11:32:aa:bb:cc': { name: 'nas', ip: '192.168.1.10', wired: true }
};

let fan = { mode: 'auto', speed: 50 };
let bytes = { rx: 1e9, tx: 2e8 };
let esim = { job: { state: 'idle' }, profiles: { type: 'lpa', payload: { code: 0, message: 'success', data: [
	{ iccid: '8900000000000000001', profileState: 'enabled', profileNickname: null, serviceProviderName: 'Example Mobile', profileName: 'Example Plan', profileClass: 'operational' },
	{ iccid: '8901260123456789012', profileState: 'disabled', profileNickname: 'Old Spectrum', serviceProviderName: 'Spectrum Mobile', profileName: 'Spectrum', profileClass: 'operational' }
] } } };

function ifaceDump() {
	return { interface: [
		{ interface: 'loopback', up: true, proto: 'static', l3_device: 'lo', 'ipv4-address': [{ address: '127.0.0.1', mask: 8 }], route: [] },
		{ interface: 'lan', up: true, proto: 'static', uptime: 86000, l3_device: 'br-lan', device: 'br-lan', 'ipv4-address': [{ address: '192.168.1.1', mask: 24 }], 'ipv6-prefix-assignment': [], route: [], 'dns-server': [] },
		{ interface: 'wan', up: false, proto: 'dhcp', device: 'eth0', autostart: true, errors: [], route: [] },
		{ interface: 'wan6', up: false, proto: 'dhcpv6', device: 'eth0', route: [] },
		{ interface: 'wwan', up: true, proto: 'modemmanager', uptime: 5400, l3_device: 'wwan0', device: '/sys/devices/...', metric: 20,
			'ipv4-address': [{ address: '10.181.44.12', mask: 30 }], 'ipv6-address': [{ address: '2605:8d80:1::5', mask: 64 }],
			route: [{ target: '0.0.0.0', mask: 0, nexthop: '10.181.44.13', metric: 20 }], 'dns-server': ['10.177.0.34', '10.177.0.210'] },
		{ interface: 'vpn', up: true, proto: 'wireguard', uptime: 5300, l3_device: 'vpn', 'ipv4-address': [{ address: '10.64.12.7', mask: 32 }], route: [] }
	] };
}

function wirelessStatus() {
	const out = {};
	const bands = { radio0: ['6g', 37, 6135, 'EHT160'], radio1: ['5g', 36, 5180, 'EHT80'], radio2: ['2g', 6, 2437, 'EHT20'] };
	for (const r of ['radio0', 'radio1', 'radio2']) {
		const c = uci.wireless[r];
		const ifs = Object.entries(uci.wireless).filter(([k, v]) => v['.type'] === 'wifi-iface' && v.device === r && v.disabled !== '1');
		const iw = { channel: c.channel === 'auto' ? bands[r][1] : +c.channel, frequency: bands[r][2], txpower: 23, country: 'CA',
			htmodes: ['HT20', 'HT40', 'VHT20', 'VHT40', 'VHT80', 'VHT160', 'HE20', 'HE40', 'HE80', 'HE160', 'EHT20', 'EHT40', 'EHT80', 'EHT160'].concat(r === 'radio0' ? ['EHT320'] : []).filter(m => bands[r][0] !== '2g' || /20|40/.test(m)),
			hwmodes: ['ax', 'be'] };
		out[r] = { up: c.disabled !== '1', pending: false, autostart: true, disabled: c.disabled === '1', config: c,
			interfaces: ifs.map(([k, v], i) => ({ section: k, ifname: `wl${r.slice(-1)}.${i}-ap${i}`, config: v, iwinfo: iw })) };
	}
	return out;
}

function freqlist(dev) {
	const n = dev.match(/wl(\d)/); const r = n ? +n[1] : 0;
	const res = [];
	if (r === 0) for (let c = 1; c <= 233; c += 4) res.push({ band: 6, channel: c, mhz: 5950 + 5 * c, restricted: false, active: c === 37 });
	if (r === 1) for (const c of [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165]) res.push({ band: 5, channel: c, mhz: 5000 + 5 * c, restricted: c >= 52 && c <= 144, active: c === 36 });
	if (r === 2) for (let c = 1; c <= 11; c++) res.push({ band: 2, channel: c, mhz: 2407 + 5 * c, restricted: false, active: c === 6 });
	return { results: res };
}

function ubus(object, method, a) {
	switch (`${object}.${method}`) {
	case 'session.login': return a.password === 'test' ? [0, { ubus_rpc_session: SID, timeout: 3600 }] : [6];
	case 'session.access': return [0, { access: true }];
	case 'session.destroy': return [0];
	case 'uci.get': return uci[a.config] ? [0, { values: sectionsOut(uci[a.config]) }] : [4];
	case 'uci.set': Object.assign(uci[a.config][a.section] = uci[a.config][a.section] || {}, a.values); return [0];
	case 'uci.add': { const n = a.name || ('cfg' + (cfgn++)); uci[a.config][n] = Object.assign({ '.type': a.type }, a.values); return [0, { section: n }]; }
	case 'uci.delete': if (a.options) { for (const o of a.options) delete uci[a.config][a.section][o]; } else delete uci[a.config][a.section]; return [0];
	case 'uci.apply': return [0];
	case 'uci.commit': return [0];
	case 'home-ui.full_backup':
		if (a.action === 'start' || a.action === 'snapshot') { PV.fb = Date.now(); return [0, { state: 'running', message: 'Starting…' }]; }
		if (!PV.fb) return [0, { state: 'idle' }];
		if (Date.now() - PV.fb < 3000) return [0, { state: 'running', message: 'Copying apps that are not in the OpenWrt feeds…' }];
		return [0, { state: 'done', message: 'Backup ready', feed: 'tailscale adguardhome nano ', nonfeed: 'protonvpn-wireguard luci-app-protonvpn ', skipped: '', extra_files: 14, size: 1843200, homeui: '1.8.0' }];
	case 'home-ui.wifi_scan': return [0, { results: [
		{ ssid: 'Neighbour-5G', bssid: '11:22:33:44:55:66', channel: 44, signal: -61, encryption: { enabled: true, wpa: [2, 3], authentication: ['psk', 'sae'], ciphers: ['ccmp'] } },
		{ ssid: 'Phone_Hotspot', bssid: '11:22:33:44:55:67', channel: 149, signal: -48, encryption: { enabled: true, wpa: [3], authentication: ['sae'], ciphers: ['ccmp'] } },
		{ ssid: 'Hotel Guest', bssid: '11:22:33:44:55:68', channel: 36, signal: -72, encryption: { enabled: false } },
		{ ssid: 'Neighbour-5G', bssid: '11:22:33:44:55:69', channel: 44, signal: -80, encryption: { enabled: true, wpa: [2], authentication: ['psk'] } }] }];
	case 'home-ui.data_usage': return [0, { nlbw: true, uptime: 273600, periods: ['2026-09-01', '2026-10-01'],
		devices: { columns: ['mac', 'conns', 'rx_bytes', 'rx_pkts', 'tx_bytes', 'tx_pkts'], data: [
			['a4:c3:f0:11:22:33', 900, 48318382080, 1, 2147483648, 1], ['3c:22:fb:44:55:66', 300, 9663676416, 1, 805306368, 1], ['b8:27:eb:77:88:99', 120, 1073741824, 1, 104857600, 1], ['02:11:22:33:44:55', 20, 52428800, 1, 10485760, 1]] },
		ifaces: [{ name: 'eth0', rx: 64424509440, tx: 4294967296 }, { name: 'br-lan', rx: 4080218931, tx: 60129542144 }, { name: 'wwan0', rx: 2147483648, tx: 214748364 }, { name: 'tailscale0', rx: 10485760, tx: 5242880 }], vnstat: null }];
	case 'home-ui.led_info':
		if (process.env.LIGHT === 'generic') return [0, { kind: 'generic', enabled: !!PV.light, brightness: null, description: 'Green: online · red: no internet', leds: 'green:status, red:status', colors: [{ id: 'ok', label: 'Online', css: '#2fbf71' }, { id: 'bad', label: 'No internet', css: '#ff4d55' }] }];
		return [0, { kind: 'addon', enabled: true, brightness: 96, description: 'Blue: WAN · white: 5G', colors: [{ id: 'blue', label: 'WAN', css: '#3b7cff' }, { id: 'white', label: '5G', css: '#f2f5f8' }, { id: 'red', label: 'Offline', css: '#ff4d55' }] }];
	case 'home-ui.led_set': PV.light = a.enabled; return [0, { ok: true }];
	case 'home-ui.led_test': return [0, { ok: true }];
	case 'home-ui.addon_list': return [0, { board: BOARD, addons: (PV.addons || ['askey-cbe1v1k-light']).map(id => ({ id, name: id === 'qmi-modem' ? 'QMI modem status (uqmi)' : 'Askey CBE1V1K front light', version: '1.0.0', description: 'Drives the front LED.', author: 'Router Home contributors', boards: id === 'qmi-modem' ? '* ' : 'askey,cbe1v1k ', provides: id === 'qmi-modem' ? 'modem' : 'led', active: true })),
		catalog: [{ id: 'askey-cbe1v1k-light', name: 'Askey CBE1V1K front light', version: '1.0.0', description: 'Drives the front LED.', boards: 'askey,cbe1v1k ', fits: BOARD === 'askey,cbe1v1k', installed: (PV.addons || ['askey-cbe1v1k-light']).includes('askey-cbe1v1k-light') },
			{ id: 'spectrum-sax1v1k-fan', name: 'Spectrum SAX1V1K fan', version: '1.0.0', description: 'Fan on GPIO 27.', boards: 'spectrum,sax1v1k ', fits: BOARD === 'spectrum,sax1v1k', installed: false },
			{ id: 'qmi-modem', name: 'QMI modem status (uqmi)', version: '1.0.0', description: 'Modem status through uqmi.', boards: '* ', fits: true, installed: (PV.addons || []).includes('qmi-modem') }] }];
	case 'home-ui.addon_install': PV.addons = (PV.addons || ['askey-cbe1v1k-light']).concat(a.catalog || 'my-addon'); return [0, { ok: true, id: a.catalog || 'my-addon', name: a.catalog || 'My add-on', version: '1.0.0' }];
	case 'home-ui.addon_remove': PV.addons = (PV.addons || ['askey-cbe1v1k-light']).filter(x => x !== a.id); return [0, { ok: true }];
	case 'home-ui.restore_dismiss': PV.dismissed = true; return [0, { ok: true }];
	case 'home-ui.restore_status': if (process.env.RESTORE === 'done') return [0, { state: 'done', message: 'Everything was restored', done_age: 3600, dismissed: !!PV.dismissed, log: 'restore finished' }];
		return [0, process.env.RESTORE ? { state: 'running', message: 'Waiting for internet to reinstall: tailscale adguardhome', done_age: 0, log: '2026-10-14 08:00:01 restore started\n2026-10-14 08:00:02 Router Home 1.8.0 put back (firmware had 1.6.0)' } : { state: 'none' }];
	case 'protonvpn.session_state': return [0, PV.session === 'active' ? { state: 'active', session_expires_at: Date.now() / 1000 + 86400 * 29 } : { state: PV.session, action_required: 're_login' }];
	case 'protonvpn.instances': {
		const on = uci.protonvpn.main.enabled === '1';
		return [0, { instances: [{ instance: 'main', configured: true, enabled: on, fixed: false, interface: 'protonvpn', hop_mode: uci.protonvpn.main.hop_mode,
			state: on ? 'connected' : 'disconnected', location: on ? { country: PV.cc, city: PV.city } : {}, gateway: on ? PV.gw : null, latest_handshake_seconds: on ? 12 : null,
			session: { state: PV.session }, certificate: { present: true, days_left: 360, expired: false }, action_required: null,
			rotation: { enabled: uci.protonvpn.main.rotation_enabled === '1', next_run: Date.now() / 1000 + 3600 * 5 }, routing: { mode: uci.protonvpn.main.auto_routing === '1' ? 'auto' : 'none' } }] }];
	}
	case 'protonvpn.locations': return [0, { available: true, state: 'ready', countries: [
		{ code: 'ca', name: 'Canada', display_name: 'Canada', standard_count: 120, secure_core_count: 6, tor_count: 0, standard_load: 31, cities: [
			{ code: 'ca-calgary', name: 'Calgary', standard_count: 70, standard_load: 35 }, { code: 'ca-montreal', name: 'Montreal', standard_count: 40, standard_load: 22 }, { code: 'ca-vancouver', name: 'Vancouver', standard_count: 10, standard_load: 48 }] },
		{ code: 'ch', name: 'Switzerland', display_name: 'Switzerland', standard_count: 80, secure_core_count: 20, tor_count: 2, standard_load: 18, cities: [{ code: 'ch-zurich', name: 'Zurich', standard_count: 80, standard_load: 18 }] },
		{ code: 'us', name: 'United States', display_name: 'United States', standard_count: 900, secure_core_count: 30, tor_count: 0, standard_load: 44, cities: [{ code: 'us-new-york', name: 'New York', standard_count: 300, standard_load: 50 }, { code: 'us-chicago', name: 'Chicago', standard_count: 200, standard_load: 39 }] }] }];
	case 'protonvpn.account': return [0, PV.session === 'active' ? { plan: 'Proton Plus', tier: 2, max_connect: 10, devices_used: 3 } : { error: 'not logged in' }];
	case 'protonvpn.auth_info': return [0, { version: 4, salt: 'c2FsdA==', modulus: 'bW9k', server_ephemeral: 'ZXBo', srp_session: 'abc' }];
	case 'protonvpn.auth_finish': PV.session = a.client_proof === 'needs2fa' ? 'needs_2fa' : 'active'; return [0, PV.session === 'needs_2fa' ? { twofa: true } : { ok: true }];
	case 'protonvpn.set_totp': if (a.code !== '123456') return [0, { error: 'Incorrect code' }]; PV.session = 'active'; return [0, { ok: true }];
	case 'protonvpn.logout': PV.session = 'no_session'; uci.protonvpn.main.enabled = '0'; return [0, { ok: true }];
	case 'protonvpn.apply_start': PV.applying = Date.now(); return [0, { started: true }];
	case 'protonvpn.apply_status': if (!PV.applying) return [0, { state: 'idle' }];
		if (Date.now() - PV.applying < 3000) return [0, { state: 'running' }];
		uci.protonvpn.main.enabled = '1'; { const l = [].concat(uci.protonvpn.main.locations || []); if (l[0]) { PV.cc = l[0].split('-')[0]; PV.city = l[0].includes('-') ? l[0] : PV.cc + '-x'; PV.gw = PV.cc.toUpperCase() + '#' + (10 + Math.floor(Math.random() * 80)); } }
		return [0, { state: 'done', result: { state: 'success', gateway: PV.gw } }];
	case 'protonvpn.disconnect': uci.protonvpn.main.enabled = '0'; PV.applying = 0; return [0, { ok: true }];
	case 'protonvpn.rotate_now': PV.gw = PV.cc.toUpperCase() + '#' + (10 + Math.floor(Math.random() * 80)); return [0, { server: PV.gw }];
	case 'protonvpn.external_ip': return [0, { ip: '149.88.20.7', interface: 'protonvpn' }];
	case 'protonvpn.refresh_locations': return [0, { started: true }];
	case 'protonvpn.refresh_status': return [0, { state: 'done' }];
	case 'uci.confirm': return [0];
	case 'home-ui.info': return [0, { version: '1.3.0', board: BOARD, hostname: uci.system.cfg20.hostname, led: BOARD.includes('cbe') ? 'cbe' : 'sbe', modem: BOARD.includes('cbe'), lpac: true, tailscale: true, wireguard: true, modemmanager: true, doh: false, luci: true, protonvpn: true, protonvpn_login: true }];
	case 'home-ui.online': return [0, { online: true, device: 'wwan0', via_modem: true, latency: '38.4' }];
	case 'home-ui.neigh': return [0, { neigh: Object.entries(clients).map(([m, c]) => `${c.ip} dev br-lan lladdr ${m} ${c.wired && c.name === 'nas' ? 'STALE' : 'REACHABLE'}`).join('\n') + '\n10.181.44.13 dev wwan0 lladdr 11:22:33:44:55:66 REACHABLE' }];
	case 'home-ui.modem_status': if (process.env.SIMPLE_MODEM) return [0, { simple: { carrier: 'Example Mobile', state: 'connected', tech: 'lte', quality: 64, registration: 'home', lte: { rsrp: -95, rsrq: -11, sinr: 12.4 }, ip: '10.20.30.40', imei: '350000000000001', model: 'EM7455' } }];
		/* falls through */
	case 'home-ui.modem_status__mm': return [0, {
		modem: { modem: { generic: { manufacturer: 'Askey', model: 'NMQ2210', state: 'connected', 'access-technologies': ['lte', '5gnr'], 'signal-quality': { value: '72', recent: 'yes' }, bearers: ['/org/freedesktop/ModemManager1/Bearer/0'] },
			'3gpp': { 'operator-name': 'Rogers', imei: '359876543210987', 'registration-state': 'roaming' } } },
		signal: { modem: { signal: { '5g': { rsrp: '-94.00', rsrq: '-11.00', snr: '8.50' }, lte: { rsrp: '-88.00', rsrq: '-9.00', snr: '12.00' } } } },
		bearer: { bearer: { 'ipv4-config': { address: '10.181.44.12' } } } }];
	case 'home-ui.modem_list': return [0, { modems: [{ path: '/org/freedesktop/ModemManager1/Modem/0', device: '/sys/devices/.../0000:01:00.0', model: 'NMQ2210', manufacturer: 'Askey' }] }];
	case 'home-ui.esim_status': {
		if (esim.job.state === 'running' && Date.now() > esim.until) {
			const act = esim.job.action;
			if (act === 'enable') esim.profiles.payload.data.forEach(p => p.profileState = p.iccid === esim.iccid ? 'enabled' : 'disabled');
			esim.job = { state: 'done', action: act, result: { type: 'lpa', payload: { code: 0, message: 'success', data: null } } };
		}
		return [0, { job: esim.job, profiles: esim.profiles }];
	}
	case 'home-ui.esim': esim.job = { state: 'running', action: a.action, step: a.action === 'download' ? 'Downloading profile from smdp (this can take a minute)' : 'Reading eSIM profiles' }; esim.until = Date.now() + 5000; esim.iccid = a.iccid; return [0, { started: true }];
	case 'home-ui.tailscale_status': return [0, { status: { BackendState: 'Running', Self: { HostName: 'cbe1v1k', TailscaleIPs: ['100.101.12.5'] } }, prefs: { AdvertiseRoutes: ['192.168.1.0/24'] }, login_url: '' }];
	case 'home-ui.tailscale': return [0, { ok: true }];
	case 'home-ui.wg_keys': return [0, { private: a.private || 'UIJWZ0vU4ZHKqHtq1u6Yt7eqQ7Ut1mJ5Mh2lJc8M4m0=', public: 'Gq4cLx2lXy0Jp6RaJfQWz5rJ8i2pTgq9n9V6u8bCq3s=' }];
	case 'home-ui.wg_status': return [0, { dump: `vpn\tPRIV\tPUB\t0\toff\nvpn\txTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=\t(none)\t203.0.113.7:51820\t0.0.0.0/0,::/0\t${Math.floor(Date.now() / 1000) - 40}\t512000000\t42000000\t25` }];
	case 'home-ui.log': return [0, { log: 'Mon Oct 12 21:00:01 2026 daemon.info ModemManager[1234]: <info> modem is connected\nMon Oct 12 21:00:05 2026 user.notice cbe-led: status: white (wwan0)\nMon Oct 12 21:01:12 2026 daemon.info hostapd: wl0.0-ap0: STA a4:c3:f0:11:22:33 WPA: pairwise key handshake completed (RSN)' }];
	case 'home-ui.self_update': return [0, { ok: true, old: '1.2.2', new: '1.3.0' }];
	case 'home-ui.fan_status': if (BOARD.startsWith('spectrum')) return [0, { available: true, kind: 'pwm', soft: true, mode: fan.mode, speed: fan.speed, safety_temp: 85, pwm: fan.mode === 'manual' ? Math.round(fan.speed * 2.55) : 153, rpm: fan.mode === 'manual' ? Math.round(fan.speed * 55) : 3420,
		temps: [{ name: 'cpu0-thermal', temp: 71200 }, { name: 'cpu1-thermal', temp: 70900 }, { name: 'nss-top-thermal', temp: 68000 }, { name: 'wcss-phyb-thermal', temp: 66000 }] }];
		return [0, { available: true, mode: fan.mode, speed: fan.speed, safety_temp: 85, pwm: fan.mode === 'manual' ? Math.round(fan.speed * 2.55) : 72,
		temps: [{ name: 'cpu0-thermal', temp: 58200 }, { name: 'cpu1-thermal', temp: 57900 }, { name: 'top-glue-thermal', temp: 61400 }, { name: 'nss-top-thermal', temp: 63000 }, { name: 'ddrss-thermal', temp: 49000 }, { name: 'ath12k_hwmon 0001:01:00.0', temp: 71000 }, { name: 'ath12k_hwmon 0002:01:00.0', temp: 66000 }] }];
	case 'home-ui.fan_set': fan.mode = a.mode; fan.speed = a.speed; return [0, { ok: true }];
	case 'home-ui.flush_device': case 'home-ui.led_test': case 'home-ui.led_set': case 'home-ui.restart_service': return [0, { ok: true }];
	case 'luci-rpc.getWirelessDevices': return [0, wirelessStatus()];
	case 'network.wireless.status': return [6];
	case 'unused.network.wireless.status': { const w = wirelessStatus(); for (const r of Object.values(w)) for (const i of r.interfaces) delete i.iwinfo; return [0, w]; }
	case 'home-ui.wifi_info': { const w = wirelessStatus(); const o = {}; for (const r of Object.values(w)) for (const i of r.interfaces) { const iw = i.iwinfo; const width = (r.config.htmode || '').replace(/\D/g, ''); o[i.ifname] = `Interface ${i.ifname}\n\tifindex 9\n\ttype AP\n\tssid ${i.config.ssid}\n\tchannel ${iw.channel} (${iw.frequency} MHz), width: ${width} MHz, center1: ${iw.frequency} MHz\n\ttxpower ${iw.txpower}.00 dBm`; } const st = wirelessStatus(); for (const r of Object.values(st)) for (const i of r.interfaces) delete i.iwinfo; return [0, { status: st, iw: o }]; }
	case 'luci-rpc.getDHCPLeases': return [0, { dhcp_leases: Object.entries(clients).filter(([, c]) => c.name !== 'nas').map(([m, c]) => ({ macaddr: m, ipaddr: c.ip, hostname: c.name, expires: 30000 })), dhcp6_leases: [] }];
	case 'luci-rpc.getHostHints': { const o = {}; for (const [m, c] of Object.entries(clients)) o[m.toUpperCase()] = { ipaddrs: [c.ip], name: c.name }; return [0, o]; }
	case 'luci-rpc.getNetworkDevices': return [0, { eth0: {}, lan1: {}, lan2: {}, lan3: {}, 'br-lan': {}, wwan0: {}, lo: {} }];
	case 'iwinfo.assoclist': {
		const r = +((a.device.match(/wl(\d)/) || [])[1]);
		return [0, { results: Object.entries(clients).filter(([, c]) => !c.wired && c.radio === r).map(([m, c]) => ({ mac: m.toUpperCase(), signal: c.signal, connected_time: 3600, inactive: 10, rx: { rate: c.rate, mhz: c.mhz, eht: true, nss: 2 }, tx: { rate: c.txrate, mhz: c.mhz } })) }];
	}
	case 'iwinfo.freqlist': return [0, freqlist(a.device)];
	case 'iwinfo.txpowerlist': return [0, { results: [0, 5, 10, 15, 20, 23].map(d => ({ dbm: d, mw: Math.round(10 ** (d / 10)) })) }];
	case 'network.device.status': { bytes.rx += 2e6 + Math.random() * 18e6; bytes.tx += 3e5 + Math.random() * 3e6; return [0, { statistics: { rx_bytes: bytes.rx, tx_bytes: bytes.tx } }]; }
	case 'network.interface.dump': return [0, ifaceDump()];
	case 'system.board': return [0, { hostname: uci.system.cfg20.hostname, model: BOARD.includes('cbe') ? 'Askey CBE1V1K' : 'Askey SBE1V1K', board_name: BOARD, kernel: '6.18.55', release: { description: 'OpenWrt SNAPSHOT r36916-b1d5406cab' } }];
	case 'system.info': return [0, { uptime: 505, load: [3000, 4000, 5000], memory: { total: 1928000000, free: 1300000000, available: 1460000000 } }];
	case 'system.validate_firmware_image': return [0, { valid: true, forceable: true, allow_backup: true }];
	case 'luci.getTimezones': return [0, { 'UTC': { tzstring: 'UTC0' }, 'Europe/Paris': { tzstring: 'CET-1CEST,M3.5.0,M10.5.0/3' }, 'America/Vancouver': { tzstring: 'PST8PDT,M3.2.0,M11.1.0' }, 'Asia/Hong Kong': { tzstring: 'HKT-8' } }];
	case 'luci.setPassword': return [0, { result: true }];
	case 'file.exec': return [0, { code: 0, stdout: '' }];
	case 'file.remove': return [0];
	}
	if (object.startsWith('network.interface.')) return [0];
	return [3];
}

const MIME = { '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
	if (req.url === '/ubus' && req.method === 'POST') {
		let body = '';
		req.on('data', c => body += c);
		req.on('end', () => {
			const j = JSON.parse(body);
			const [sid, obj, meth, args] = j.params;
			let result;
			if (obj !== 'session' && sid !== SID) { res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, error: { code: -32002, message: 'Access denied' } })); return; }
			result = ubus(obj, meth, args || {});
			setTimeout(() => res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result })), 40);
		});
		return;
	}
	if (req.url === '/debug/uci') { res.end(JSON.stringify(uci)); return; }
	if (req.url.startsWith('/cgi-bin/cgi-upload')) { req.resume(); req.on('end', () => res.end(JSON.stringify({ size: 1234, checksum: 'x', sha256sum: 'y' }))); return; }
	if (req.url.startsWith('/cgi-bin/cgi-download')) { req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/octet-stream'); res.end('fullbackup'); }); return; }
	if (req.url.startsWith('/cgi-bin/cgi-backup')) { res.setHeader('Content-Type', 'application/x-targz'); res.end('fake'); return; }
	let p = decodeURIComponent(req.url.split('?')[0]);
	if (p === '/' ) p = '/home/index.html';
	if (p.endsWith('/')) p += 'index.html';
	const f = path.join(ROOT, p);
	fs.readFile(f, (e, d) => {
		if (e) { res.statusCode = 404; res.end('not found'); return; }
		res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
		res.end(d);
	});
}).listen(PORT, () => console.log('mock on', PORT));
