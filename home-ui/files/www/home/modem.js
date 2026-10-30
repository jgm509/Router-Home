/* Router Home: more mobile modem tools on the Mobile page (ModemManager):
 * signal per band and carrier aggregation, band locking, SMS, location (GPS)
 * and the clock from the mobile network. Backend: modem-extra. */
'use strict';

const Modem = (() => {
	const x = (action, args) => App.rpc('home-ui', 'modem_extra', Object.assign({ action }, args || {}));
	const val = v => v != null && v !== '' && v !== '--' ? v : null;
	const num = v => val(v) != null ? String(Math.round(parseFloat(v) * 10) / 10).replace('-', '−') : '—';
	/* "eutran-66" -> LTE B66, "ngran-71" -> 5G n71 */
	const bandName = b => { let m = /^eutran-(\d+)$/.exec(b); if (m) return `B${m[1]}`; m = /^ngran-(\d+)$/.exec(b); if (m) return `n${m[1]}`; return b.replace(/^utran-/, '3G ').replace(/^g-?/, ''); };
	const bandKind = b => /^eutran-/.test(b) ? 'lte' : /^ngran-/.test(b) ? 'nr' : 'other';
	const bandNum = b => +((/(\d+)$/.exec(b) || [0, 0])[1]);
	const q = s => (/'([^']*)'/.exec(s) || [])[1];

	/* the rows added to the Mobile page */
	function tools() {
		const { h, row, group, explain } = App;
		const bandsSub = h('span', 'Use only some 4G/5G bands');
		const smsSub = h('span', 'Read and send text messages');
		const gpsSub = h('span', 'Where the router is');
		const box = h('div',
			h('h2', { class: 'section-title' }, h('span', 'Modem tools', explain('Modem tools',
				'Signal details: the bands the modem uses right now, carrier aggregation (several bands combined for more speed) and the cells it sees.',
				'Bands: lock the modem to the bands that work best where you live. A wrong lock means no service: “Use all bands” always brings it back.',
				'Messages: texts sent to the SIM (for example carrier notices or data-plan warnings), and sending texts.',
				'Location: the modem\'s GPS, read with your own copy of the stock GPS tool.',
				'Clock: the mobile network tells the router the time, even when the internet doesn\'t work.',
				{ rec: 'Look at Signal details at different times of day before locking bands. Lock only if one band is clearly better.' }))),
			group(
				row({ icon: 'antenna', label: 'Signal details', sub: 'Bands in use, carrier aggregation, cells', onClick: openSignal }),
				row({ icon: 'network', label: 'Bands', sub: bandsSub, onClick: () => openBands(refresh) }),
				row({ icon: 'edit', label: 'Messages', sub: smsSub, onClick: () => openSms(refresh) }),
				row({ icon: 'globe', label: 'Location', sub: gpsSub, onClick: () => openGps(refresh) }),
				row({ icon: 'clock', label: 'Clock from the mobile network', sub: 'Set the router\'s time from the carrier', onClick: openClock })));
		async function refresh() {
			const [i, s, g] = await Promise.all([x('info').catch(() => null), x('sms_list').catch(() => null), x('gps_status').catch(() => null)]);
			if (!i || i.error) { bandsSub.textContent = 'Modem not ready yet (it can take a minute after an eSIM change)'; return; }
			const gen = i && i.modem && i.modem.modem && i.modem.modem.generic || {};
			const sup = gen['supported-bands'] || [], cur = gen['current-bands'] || [];
			const supNr = sup.filter(b => bandKind(b) === 'nr'), allNr = supNr.length && supNr.every(b => cur.includes(b));
			bandsSub.textContent = !sup.length ? 'Not available on this modem' : (cur.length >= sup.length || cur.includes('any') ? `All ${sup.length} bands` :
				`Locked to ${cur.filter(b => !(allNr && bandKind(b) === 'nr')).map(bandName).join(', ')}${allNr ? ' (all 5G bands allowed)' : ''}`);
			const msgs = (s && s.messages) || [];
			const unread = msgs.filter(m => ((m.sms || {}).sms || {}).properties && m.sms.sms.properties.state === 'received').length;
			smsSub.textContent = msgs.length ? `${msgs.length} message${msgs.length > 1 ? 's' : ''}${unread ? ` · ${unread} received` : ''}` : 'No messages';
			gpsSub.textContent = g && g.tool ? (g.job && g.job.state === 'done' ? 'Position found · tap to see or update' : 'Ready · tap to find the position') : 'Needs the GPS tool from your firmware';
		}
		box.refresh = refresh;
		refresh();
		return box;
	}

	/* ---------- signal details ---------- */
	async function openSignal() {
		const { h, sheet, hint, note, btn, busy } = App;
		sheet('Signal details', close => {
			const body = h('div', h('div', { class: 'skeleton' }));
			const load = async () => {
				const i = await x('info');
				if (i.error) { body.replaceChildren(note(i.error, 'warn')); return; }
				const sig = (i.signal && i.signal.modem && i.signal.modem.signal) || {};
				const lte = sig.lte || {}, nr = sig['5g'] || {};
				/* active bands from qmicli rf-band-info: blocks of Radio Interface / Active Band Class / Active Channel */
				const active = [];
				let cur = null;
				for (const line of (i.rf || '').split('\n')) {
					if (/Radio Interface/.test(line)) { cur = { tech: q(line) }; active.push(cur); }
					else if (cur && /Active Band Class/.test(line)) cur.band = q(line);
					else if (cur && /Active Channel/.test(line)) cur.ch = q(line);
					else if (cur && /Bandwidth/.test(line)) cur.bw = q(line);
				}
				const tidy = t => (t || '').split('\n').filter(l => l.trim() && !/^\[|error|warning|not released|CID:|Service:/i.test(l)).map(l => l.replace(/\t/g, '  ')).join('\n');
				const caTxt = tidy(i.ca), cellTxt = tidy(i.cell);
				body.replaceChildren(
					h('div', { class: 'group' }, h('dl', { class: 'kv' },
						val(nr.rsrp) ? (parseFloat(nr.rsrp) <= -140 ? [h('dt', '5G'), h('dd', 'No usable 5G signal right now')] : [h('dt', '5G RSRP'), h('dd', `${num(nr.rsrp)} dBm`), h('dt', '5G RSRQ / SINR'), h('dd', `${num(nr.rsrq)} dB · ${num(nr.snr)} dB`)]) : null,
						val(lte.rsrp) ? [h('dt', 'LTE RSRP'), h('dd', `${num(lte.rsrp)} dBm`), h('dt', 'LTE RSRQ / SINR'), h('dd', `${num(lte.rsrq)} dB · ${num(lte.snr)} dB`), val(lte.rssi) ? [h('dt', 'LTE RSSI'), h('dd', `${num(lte.rssi)} dBm`)] : null] : null,
						active.length ? [h('dt', 'Bands in use'), h('dd', active.map(a => `${a.band ? bandName(a.band) : a.tech}${a.ch ? ' (ch ' + a.ch + ')' : ''}`).join(', '))] : null)),
					active.length > 1 ? hint(`Carrier aggregation: ${active.length} bands combined.`) : null,
					!i.qmicli ? note('Install “qmi-utils” for bands in use, carrier aggregation and cells (apk add qmi-utils).', 'warn') : null,
					caTxt ? [h('h2', { class: 'section-title' }, h('span', 'Carrier aggregation')), h('pre', { class: 'log' }, caTxt)] : null,
					cellTxt ? [h('h2', { class: 'section-title' }, h('span', 'Cells')), h('details', { class: 'group', style: { padding: '10px 14px' } }, h('summary', 'Serving and nearby cells'), h('pre', { class: 'log' }, cellTxt))] : null,
					hint('RSRP: signal strength (above −90 dBm good, below −110 weak). RSRQ and SINR: quality (SINR above 10 dB good, below 0 poor).'),
					h('div', { class: 'actions' }, btn('Close', close, 'secondary'), (() => { const b = btn('Refresh', () => busy(b, load)); return b; })()));
			};
			load().catch(e => body.replaceChildren(note(e.message, 'bad')));
			return body;
		});
	}

	/* ---------- bands ---------- */
	async function openBands(done) {
		const { h, sheet, hint, note, btn, busy, toast, explain, confirm } = App;
		const i = await x('info');
		const gen = (i && i.modem && i.modem.modem && i.modem.modem.generic) || {};
		const sup = (gen['supported-bands'] || []).filter(b => b !== 'any' && b !== 'unknown');
		const cur = new Set(gen['current-bands'] || []);
		const all = cur.has('any') || sup.every(b => cur.has(b));
		sheet('Bands', close => {
			if (!sup.length) return h('div', note('This modem doesn\'t tell which bands it supports, so band locking isn\'t available here.', 'warn'), h('div', { class: 'actions' }, btn('Close', close)));
			const sel = new Set(all ? sup : sup.filter(b => cur.has(b)));
			const chip = b => h('button', { type: 'button', class: 'chip', 'aria-pressed': sel.has(b) ? 'true' : 'false',
				onclick: e => { sel.has(b) ? sel.delete(b) : sel.add(b); e.currentTarget.setAttribute('aria-pressed', sel.has(b) ? 'true' : 'false'); } }, bandName(b));
			const grp = (title, kind) => { const l = sup.filter(b => bandKind(b) === kind).sort((a, b) => bandNum(a) - bandNum(b)); return l.length ? [h('h2', { class: 'section-title' }, h('span', title)), h('div', { class: 'group', style: { padding: '10px 12px' } }, h('div', { class: 'chips' }, l.map(chip)))] : null; };
			const save = btn('Lock to these bands', () => busy(save, async () => {
				const list = sup.filter(b => sel.has(b));
				if (!list.length) throw new Error('Choose at least one band');
				if (!list.some(b => bandKind(b) === 'lte') && !await confirm('No 4G band?', 'Many 5G networks need a 4G band to connect (non-standalone 5G). Without one the modem may get no service.', 'Lock anyway', true)) return;
				const r = await x('bands', { bands: list.join('|') });
				if (r.error) throw new Error(r.error);
				toast('Bands locked. The modem reconnects in a moment.'); close(); done && done();
			}));
			const reset = btn('Use all bands', () => busy(reset, async () => {
				const r = await x('bands', { bands: 'any' });
				if (r.error) throw new Error(r.error);
				toast('All bands are allowed again'); close(); done && done();
			}), 'secondary');
			return h('div',
				all ? hint('All bands are allowed now (the modem chooses).') : note(`Locked to ${[...cur].map(bandName).join(', ')}.`, 'warn'),
				grp('4G (LTE)', 'lte'), grp('5G', 'nr'), grp('Other', 'other'),
				hint('Tip: open Signal details to see which bands are in use and how strong they are. Changing bands briefly disconnects the mobile internet.'),
				h('div', { class: 'actions' }, reset, save),
				h('div', { class: 'btn-row', style: { justifyContent: 'center' } }, btn('Test bands for me', () => { close(); openBandTest(sup, done); }, 'small secondary')));
		});
	}

	/* ---------- band test ---------- */
	async function openBandTest(sup, done) {
		const { h, sheet, hint, note, btn, busy, toast, group, row, confirm } = App;
		const lte = sup.filter(b => bandKind(b) === 'lte').sort((a, b) => bandNum(a) - bandNum(b));
		const nr = sup.filter(b => bandKind(b) === 'nr');
		sheet('Test bands', close => {
			const body = h('div');
			let timer = null;
			const stopPoll = () => { if (timer) clearTimeout(timer); timer = null; };
			const draw = st => {
				const res = (st && st.results) || [];
				const good = res.filter(r => r.ok && r.sinr != null).sort((a, b) => (b.sinr - a.sinr) || (b.rsrp - a.rsrp));
				const bad = res.filter(r => !r.ok || r.sinr == null);
				const running = st && st.state === 'running';
				const resultRow = (r, i) => row({ icon: 'antenna', label: `${i === 0 && !running ? '★ ' : ''}${bandName(r.band)}`,
					sub: `SINR ${num(r.sinr)} dB · RSRP ${num(r.rsrp)} dBm${r.nr_rsrp != null && r.nr_rsrp > -140 ? ` · 5G ${num(r.nr_rsrp)} dBm` : ''}`,
					right: running ? null : (() => { const b = btn('Use', () => busy(b, () => lock([r.band])), 'small secondary'); return b; })(), chevron: false });
				body.replaceChildren(
					running ? note(`Testing ${bandName(st.band || '')} (${st.step || 0} of ${st.total || '?'})… The mobile internet drops while each band is tested.`) : null,
					good.length ? [h('h2', { class: 'section-title' }, h('span', running ? 'So far' : 'Best first')), group(...good.map(resultRow))] : null,
					bad.length ? hint(`No service: ${bad.map(r => bandName(r.band)).join(', ')}.`) : null,
					!running && good.length ? hint('Ranked by SINR (signal quality), which matters most for speed. Test again in the evening: busy hours change the ranking.') : null,
					h('div', { class: 'actions' },
						running ? btn('Stop test', () => busy(null, async () => { stopPoll(); await x('band_test_stop'); toast('Stopped; your bands are back'); load(); }), 'secondary') : btn('Close', close, 'secondary'),
						!running && good.length >= 2 ? (() => { const b = btn(`Lock to the best ${Math.min(2, good.length)}`, () => busy(b, () => lock(good.slice(0, 2).map(r => r.band))), ''); return b; })() : null));
			};
			const lock = async list => {
				const r = await x('bands', { bands: list.concat(nr).join('|') });
				if (r.error) throw new Error(r.error);
				toast(`Locked to ${list.map(bandName).join(' + ')} (5G bands stay allowed)`); close(); done && done();
			};
			const poll = async () => {
				const st = await x('band_test_status').catch(() => null);
				draw(st);
				if (st && st.state === 'running') timer = setTimeout(poll, 3000);
				else if (st && st.state === 'done') { done && done(); }
			};
			const start = () => {
				const sel = new Set(lte);
				const chips = h('div', { class: 'chips' }, lte.map(b => h('button', { type: 'button', class: 'chip', 'aria-pressed': 'true',
					onclick: e => { sel.has(b) ? sel.delete(b) : sel.add(b); e.currentTarget.setAttribute('aria-pressed', sel.has(b) ? 'true' : 'false'); } }, bandName(b))));
				const go = btn('Start test', () => busy(go, async () => {
					const list = lte.filter(b => sel.has(b));
					if (!list.length) throw new Error('Choose at least one band');
					if (!await confirm('Start the band test?', `About ${Math.ceil(list.length * 50 / 60)} minutes. The mobile internet drops for a moment with each band. At the end your current bands are put back.`, 'Start')) return;
					const r = await x('band_test', { bands: list.join('|') });
					if (r && r.error) throw new Error(r.error === 'busy' ? 'A test is already running' : r.error);
					await App.sleep(1500); poll();
				}));
				body.replaceChildren(
					hint('Router Home locks the modem to one 4G band at a time (5G stays allowed, since your 5G needs a 4G band), waits for it to connect and measures the signal. Bands without coverage are skipped after 45 seconds.'),
					h('div', { class: 'group', style: { padding: '10px 12px' } }, chips),
					hint('Tap to leave out bands you don\'t want to test.'),
					h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), go));
			};
			const load = async () => {
				const st = await x('band_test_status').catch(() => null);
				if (st && (st.state === 'running' || (st.state === 'done' && (st.results || []).length))) { draw(st); if (st.state === 'running') timer = setTimeout(poll, 3000); }
				else start();
			};
			if (!lte.length) return h('div', note('This modem doesn\'t report its 4G bands, so they can\'t be tested.', 'warn'));
			load();
			return body;
		}, { onClose: () => {} });
	}

	/* ---------- SMS ---------- */
	async function openSms(done) {
		const { h, sheet, hint, note, btn, busy, toast, field, input, group, row, confirm } = App;
		sheet('Messages', close => {
			const body = h('div', h('div', { class: 'skeleton' }));
			const load = async () => {
				const r = await x('sms_list');
				const msgs = ((r && r.messages) || []).map(m => ({ index: m.index, s: (m.sms && m.sms.sms) || {} }))
					.sort((a, b) => String((b.s.properties || {}).timestamp || '').localeCompare(String((a.s.properties || {}).timestamp || '')) || b.index - a.index);
				const number = input({ type: 'tel', placeholder: '+1 555 123 4567' });
				const text = h('textarea', { rows: 3, placeholder: 'Message', maxlength: 600 });
				const send = btn('Send', () => busy(send, async () => {
					const n = number.value.replace(/[\s().-]/g, '');
					if (!/^\+?[0-9*#]{3,20}$/.test(n)) throw new Error('Enter a phone number');
					if (!text.value.trim()) throw new Error('Write a message');
					const res = await x('sms_send', { number: n, text: text.value });
					if (res.error) throw new Error(res.error);
					toast('Sent'); text.value = ''; load(); done && done();
				}));
				body.replaceChildren(
					msgs.length ? group(...msgs.map(m => {
						const c = m.s.content || {}, p = m.s.properties || {};
						const inbound = p.state === 'received' || p['pdu-type'] === 'deliver';
						const d = p.timestamp ? new Date(p.timestamp) : null;
						const when = [d && !isNaN(d) ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null,
							!inbound && p.state && p.state !== 'sent' ? 'not sent' : null].filter(Boolean).join(' · ');
						return h('div', { class: 'row', style: { alignItems: 'flex-start' } },
							h('span', { class: 'ic' }, App.icon(inbound ? 'download' : 'upload')),
							h('span', { class: 'main' },
								h('div', { class: 'label' }, `${inbound ? 'From' : 'To'} ${c.number || 'unknown'}`),
								h('div', { class: 'sub', style: { whiteSpace: 'pre-wrap' } }, c.text || '(no text)'),
								when ? h('div', { class: 'sub' }, when) : null),
							(() => { const b = btn('Delete', async () => {
								if (!await confirm('Delete this message?', '', 'Delete', true)) return;
								await busy(b, async () => { await x('sms_delete', { index: m.index }); load(); done && done(); });
							}, 'small secondary'); return b; })());
					})) : note('No messages on the SIM.'),
					h('h2', { class: 'section-title' }, h('span', 'Send a text')),
					group(field('To', number), h('label', { class: 'field' }, h('span', 'Message'), text)),
					hint('Sending a text may cost money on some plans.'),
					h('div', { class: 'actions' }, btn('Close', close, 'secondary'), send));
			};
			load().catch(e => body.replaceChildren(note(e.message, 'bad')));
			return body;
		});
	}

	/* ---------- location ---------- */
	async function openGps(done) {
		const { h, sheet, hint, note, btn, busy, toast, field, confirm } = App;
		sheet('Location', close => {
			const body = h('div', h('div', { class: 'skeleton' }));
			const load = async () => {
				const g = await x('gps_status');
				if (!g.tool) {
					const file = h('input', { type: 'file', accept: '.tar.gz,.tgz' });
					const up = btn('Install', () => busy(up, async () => {
						const f = file.files[0]; if (!f) throw new Error('Choose the stockgnss.tar.gz file');
						await upload(f, '/tmp/home-ui-gps.tar.gz');
						const r = await x('gps_install');
						if (r.error) throw new Error(r.error);
						toast('GPS tool installed'); load(); done && done();
					}));
					body.replaceChildren(
						note('This modem\'s GPS works with Qualcomm\'s own tool from the router\'s stock firmware. It can\'t be shipped with Router Home, so it is installed from your own copy.'),
						h('div', { class: 'group' }, field('Your stockgnss.tar.gz', file)),
						hint('Made from your router\'s stock firmware (qmi_gnssloc_ctrl and its libraries). It is kept through firmware updates. The kernel needs QRTR for it' + (g.qrtr ? ' (yours has it).' : ' — this router\'s kernel doesn\'t seem to have it.')),
						h('div', { class: 'actions' }, btn('Close', close, 'secondary'), up));
					return;
				}
				const job = g.job || {};
				const pos = job.state === 'done' ? job : null;
				const find = btn(pos ? 'Update position' : 'Find position', () => busy(find, async () => {
					await x('gps_get');
					for (let k = 0; k < 90; k++) {
						await App.sleep(3000);
						const s = await x('gps_status');
						if (s.job && s.job.state === 'done') { toast('Position found'); return load().then(() => done && done()); }
						if (s.job && s.job.state === 'failed') throw new Error(s.job.message || 'No position. Move the router near a window and try again.');
					}
					throw new Error('Still searching. Try again near a window.');
				}));
				const map = pos ? `https://www.openstreetmap.org/?mlat=${pos.lat}&mlon=${pos.lon}#map=16/${pos.lat}/${pos.lon}` : null;
				body.replaceChildren(
					pos ? h('div', { class: 'group' }, h('dl', { class: 'kv' },
						h('dt', 'Latitude'), h('dd', String(pos.lat)),
						h('dt', 'Longitude'), h('dd', String(pos.lon)),
						h('dt', 'Altitude'), h('dd', `${Math.round(pos.alt)} m`),
						h('dt', 'Found'), h('dd', new Date(pos.time * 1000).toLocaleString()))) : note(job.state === 'running' ? 'Searching…' : 'No position yet.'),
					pos ? h('div', { class: 'btn-row' }, h('a', { class: 'btn small secondary', href: map, target: '_blank', rel: 'noopener' }, 'Show on map')) : null,
					hint('The first position can take a few minutes; GPS works best near a window. The position stays on the router and isn\'t sent anywhere.'),
					h('div', { class: 'actions' }, btn('Close', close, 'secondary'), find),
					h('div', { class: 'btn-row', style: { justifyContent: 'center' } }, btn('Remove the GPS tool', async () => {
						if (!await confirm('Remove the GPS tool?', 'You can install it again from your file.', 'Remove', true)) return;
						await x('gps_remove'); load(); done && done();
					}, 'small secondary')));
			};
			load().catch(e => body.replaceChildren(note(e.message, 'bad')));
			return body;
		});
	}

	/* ---------- clock ---------- */
	async function openClock() {
		const { h, sheet, hint, note, btn, busy, toast } = App;
		const r = await x('time');
		const net = r && r.time && r.time.modem && r.time.modem.time || {};
		sheet('Clock from the mobile network', close => {
			const set = btn('Set the router\'s clock', () => busy(set, async () => {
				const s = await x('time_set');
				if (s.error) throw new Error(s.error);
				toast(`Clock set: ${s.time}`); close();
			}));
			return h('div',
				h('div', { class: 'group' }, h('dl', { class: 'kv' },
					h('dt', 'Mobile network'), h('dd', val(net.current) ? new Date(net.current).toLocaleString() : 'Not sent right now'),
					h('dt', 'Router'), h('dd', r && r.router || '—'))),
				hint('Router Home also does this by itself every couple of minutes when the router\'s clock is more than 5 minutes off (while “Remember working settings” is on).'),
				h('div', { class: 'actions' }, btn('Close', close, 'secondary'), val(net.current) ? set : null));
		});
	}

	return { tools };
})();
