/* Router Home: shared data loaders */
'use strict';

const Data = (() => {
	const { rpc, call, uci } = App;

	const BAND_NAME = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz', '60g': '60 GHz' };

	function bandOf(radio) {
		const c = radio.config || {};
		if (c.band) return c.band;
		const f = radio.iwinfo && radio.iwinfo.frequency;
		if (f > 5925) return '6g';
		if (f > 4900) return '5g';
		if (f) return '2g';
		if (c.hwmode === '11a') return '5g';
		return '2g';
	}

	/* parse `iw dev X info`: channel, frequency, width, tx power */
	function parseIw(t) {
		const o = {};
		if (!t) return o;
		let m = t.match(/channel (\d+) \((\d+) MHz\)(?:, width: (\d+) MHz)?/);
		if (m) { o.channel = +m[1]; o.frequency = +m[2]; if (m[3]) o.width = +m[3]; }
		m = t.match(/txpower ([\d.]+) dBm/);
		if (m) o.txpower = Math.round(+m[1]);
		m = t.match(/ssid (.+)/);
		if (m) o.ssid = m[1].trim();
		return o;
	}

	/* radios with their interfaces, from netifd + nl80211. This avoids
	 * luci-rpc getWirelessDevices, which asks the radio firmware for
	 * statistics and can take seconds on ath12k. */
	async function wireless() {
		const wi = await call('home-ui', 'wifi_info');
		let st = wi && wi.status;
		const iwmap = (wi && wi.iw) || {};
		/* fallback: the slower LuCI call, which also carries iwinfo details */
		if (!st || !Object.keys(st).length) {
			const lr = await call('luci-rpc', 'getWirelessDevices');
			st = lr || {};
			for (const r of Object.values(st)) for (const i of r.interfaces || []) if (i.ifname && !iwmap[i.ifname] && i.iwinfo)
				iwmap[i.ifname] = { _iwinfo: i.iwinfo };
		}
		const radios = [];
		for (const name of Object.keys(st || {}).sort()) {
			const r = st[name];
			const ifaces = (r.interfaces || []).map(i => {
				const raw = iwmap[i.ifname];
				const iw = raw && raw._iwinfo ? raw._iwinfo : parseIw(raw);
				return { section: i.section, ifname: i.ifname, config: i.config || {}, iwinfo: iw };
			});
			const iw = (ifaces.find(i => i.iwinfo.channel) || {}).iwinfo || {};
			const radio = { name, up: !!r.up, disabled: !!r.disabled, config: r.config || {}, iwinfo: iw, ifaces };
			radio.band = bandOf(radio);
			radio.bandName = BAND_NAME[radio.band] || radio.band;
			for (const i of ifaces) { i.radio = name; i.band = radio.band; }
			radios.push(radio);
		}
		return radios;
	}

	async function interfaces() {
		const r = await call('network.interface', 'dump');
		return (r && r.interface) || [];
	}

	/* the interface currently carrying the default route */
	function uplink(ifaces) {
		let best = null;
		for (const i of ifaces) {
			if (!i.up) continue;
			for (const rt of i.route || []) {
				if (rt.target === '0.0.0.0' && rt.mask === 0) {
					const m = rt.metric != null ? rt.metric : (i.metric || 0);
					if (!best || m < best.metric) best = { iface: i, metric: m };
				}
			}
		}
		if (!best) for (const i of ifaces) {
			if (!i.up) continue;
			for (const rt of i.route || []) if (rt.target === '::' && rt.mask === 0) { best = { iface: i, metric: 0 }; break; }
			if (best) break;
		}
		return best && best.iface;
	}

	const isModemProto = p => p === 'modemmanager' || p === 'qmi' || p === 'mbim' || p === 'ncm' || p === '3g';

	function kindOfName(name) {
		const n = (name || '').toLowerCase();
		if (/iphone|ipad|pixel|android|galaxy|sm-|oneplus|xiaomi|redmi|huawei|phone|motorola|moto/.test(n)) return 'phone';
		if (/tv|roku|chromecast|fire|shield|appletv|bravia|webos|tizen/.test(n)) return 'tv';
		if (/mac|book|laptop|desktop|pc|win|thinkpad|surface|lenovo|dell|hp-|asus/.test(n)) return 'laptop';
		return 'devices';
	}

	function parseNeigh(text, lanDevs) {
		const out = {};
		for (const line of (text || '').split('\n')) {
			const m = line.match(/^(\S+) dev (\S+)(?: lladdr (\S+))?.* (\S+)$/);
			if (!m || !m[3]) continue;
			if (lanDevs.length && !lanDevs.includes(m[2])) continue;
			const mac = m[3].toLowerCase();
			const e = out[mac] || (out[mac] = { ips: [], ip6s: [], state: 'STALE' });
			(m[1].includes(':') ? e.ip6s : e.ips).push(m[1]);
			if (!/FAILED|INCOMPLETE/.test(m[4])) e.state = 'REACHABLE';
		}
		return out;
	}

	const PAUSE_PREFIX = 'Pause internet';

	/* every device the router knows about on the home network */
	async function clients(opts) {
		const [radios, leases, hints, dhcp, fw, neigh, ifaces] = await Promise.all([
			(opts && opts.radios) ? opts.radios : wireless(),
			call('luci-rpc', 'getDHCPLeases', { family: 0 }),
			call('luci-rpc', 'getHostHints'),
			uci.load('dhcp'),
			uci.load('firewall'),
			call('home-ui', 'neigh'),
			(opts && opts.ifaces) ? opts.ifaces : interfaces()
		]);
		const lanDevs = ifaces.filter(i => i.interface === 'lan' || (i.interface || '').startsWith('lan')).map(i => i.l3_device || i.device).filter(Boolean);
		const devs = {};
		const get = mac => {
			mac = (mac || '').toLowerCase();
			if (!mac) return null;
			return devs[mac] || (devs[mac] = { mac, name: '', ips: [], ip6s: [], wifi: null, online: false, lease: null, host: null, pause: [] });
		};

		for (const l of (leases && leases.dhcp_leases) || []) {
			const d = get(l.macaddr); if (!d) continue;
			d.lease = l; if (l.hostname && !d.name) d.name = l.hostname;
			if (l.ipaddr && !d.ips.includes(l.ipaddr)) d.ips.push(l.ipaddr);
		}
		for (const h of uci.sections(dhcp, 'host')) {
			const macs = [].concat(h.mac || []).join(' ').split(/\s+/).filter(Boolean);
			for (const m of macs) {
				const d = get(m); if (!d) continue;
				d.host = h; if (h.name) d.name = h.name;
				if (h.ip && !d.ips.includes(h.ip)) d.ips.unshift(h.ip);
			}
		}
		const nb = parseNeigh(neigh && neigh.neigh, lanDevs);
		for (const mac in nb) {
			const d = devs[mac] || (lanDevs.length ? get(mac) : null);
			if (!d) continue;
			for (const ip of nb[mac].ips) if (!d.ips.includes(ip)) d.ips.push(ip);
			for (const ip of nb[mac].ip6s) if (!d.ip6s.includes(ip)) d.ip6s.push(ip);
			if (nb[mac].state === 'REACHABLE') d.online = true;
		}
		/* only show hints for devices we already know are on the LAN */
		for (const mac in hints || {}) {
			const d = devs[mac.toLowerCase()];
			if (d && !d.name && hints[mac].name) d.name = hints[mac].name;
		}

		await Promise.all(radios.flatMap(r => r.ifaces.filter(i => i.ifname && (i.config.mode || 'ap') === 'ap').map(async i => {
			const a = await call('iwinfo', 'assoclist', { device: i.ifname });
			for (const s of (a && a.results) || []) {
				const d = get(s.mac);
				d.online = true;
				d.wifi = { band: r.band, bandName: r.bandName, ssid: i.config.ssid, ifname: i.ifname, signal: s.signal, rx: s.rx, tx: s.tx, connected: s.connected_time, inactive: s.inactive };
			}
		})));

		for (const rule of uci.sections(fw, 'rule')) {
			if (!(rule.name || '').startsWith(PAUSE_PREFIX)) continue;
			for (const m of [].concat(rule.src_mac || [])) {
				const d = devs[m.toLowerCase()];
				if (d) d.pause.push(rule);
			}
		}

		const list = Object.values(devs).map(d => {
			d.label = d.name || 'Unnamed device';
			d.kind = d.wifi ? (kindOfName(d.name) === 'devices' ? 'phone' : kindOfName(d.name)) : kindOfName(d.name);
			if (!d.wifi && d.kind === 'devices') d.kind = 'cable';
			d.paused = d.pause.some(r => r.enabled !== '0');
			d.scheduled = d.pause.some(r => r.enabled !== '0' && (r.start_time || r.weekdays));
			return d;
		});
		list.sort((a, b) => (b.online - a.online) || a.label.localeCompare(b.label));
		return list;
	}

	function connText(d) {
		if (d.wifi) {
			const rate = d.wifi.rx && d.wifi.rx.rate ? ` · ${Math.round(d.wifi.rx.rate / 1000)} Mbps` : '';
			return `${d.wifi.bandName} WiFi${rate}`;
		}
		return d.online ? 'Wired' : (d.lease ? 'Not connected right now' : 'Offline');
	}

	function signalBars(dbm) {
		const n = dbm >= -55 ? 4 : dbm >= -65 ? 3 : dbm >= -75 ? 2 : dbm ? 1 : 0;
		return App.h('span', { class: 'bars', title: dbm ? dbm + ' dBm' : '' }, [1, 2, 3, 4].map(i => App.h('i', { class: i <= n ? 'on' : '' })));
	}

	const PROTO_NAME = {
		dhcp: 'Automatic (DHCP)', dhcpv6: 'Automatic IPv6', static: 'Fixed address', pppoe: 'PPPoE (DSL/fibre login)',
		modemmanager: 'Mobile modem', qmi: 'Mobile modem (QMI)', mbim: 'Mobile modem (MBIM)', wireguard: 'WireGuard VPN',
		none: 'Unmanaged', '6in4': 'IPv6 tunnel', relay: 'Relay bridge', wwan: 'WiFi client'
	};

	return { wireless, interfaces, uplink, clients, connText, signalBars, isModemProto, BAND_NAME, PROTO_NAME, PAUSE_PREFIX, kindOfName };
})();
