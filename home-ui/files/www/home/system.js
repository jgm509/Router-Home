/* Router Home: system page */
'use strict';

App.register('system', {
	async render(page) {
		const { h, row, group, sectionTitle, hint, note, call, uci, fmt, info, btn, busy, every } = App;
		const [sys, board, syscfg, tzs, fan, rst] = await Promise.all([call('system', 'info'), call('system', 'board'), uci.load('system'), call('luci', 'getTimezones'), call('home-ui', 'fan_status'), call('home-ui', 'restore_status')]);
		const restoreNote = restoreBanner(rst);
		const fanSub = h('span', fanSummary(fan));
		const fanRow = fan && !fan.available && fan.missing ? [sectionTitle('Cooling'), group(row({ icon: 'fan', label: 'Fan', sub: `Install ${fan.missing} to control the fan (apk add ${fan.missing}, or opkg install ${fan.missing}).` }))] :
			fan && fan.available ? [sectionTitle('Cooling'), group(row({ icon: 'fan', label: 'Fan', sub: fanSub, onClick: () => openFan(() => call('home-ui', 'fan_status').then(f => { fanSub.textContent = fanSummary(f); })) }))] : null;
		const s0 = App.uci.sections(syscfg, 'system')[0] || {};
		const rel = (board && board.release) || {};

		const clock = h('span');
		const tick = () => { clock.textContent = new Date().toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }); };

		page.append(
			h('h1', { class: 'page-title' }, 'System'),
			restoreNote,
			sectionTitle('Router'),
			group(
				row({ icon: 'edit', label: 'Name', value: s0.hostname || info.hostname, onClick: () => openGeneral(s0, tzs) }),
				row({ icon: 'clock', label: 'Time zone', sub: s0.zonename || 'UTC', value: clock, onClick: () => openGeneral(s0, tzs) }),
				row({ icon: 'lock', label: 'Admin password', sub: 'Used here and in the advanced settings', onClick: openPassword })),
			fanRow,
			info.led ? [sectionTitle('Front light'), group(row({ icon: 'light', label: 'Status light', sub: 'Shows whether the internet works', onClick: openLed }))] : null,
			sectionTitle('Software'),
			group(
				row({ icon: 'upload', label: 'Update firmware', sub: rel.description || 'OpenWrt', onClick: () => openUpgrade() }),
				row({ icon: 'box', label: 'Update Router Home', sub: info.version ? `Version ${info.version}` : 'Install a new home-ui.tar.gz', onClick: openSelfUpdate }),
				row({ icon: 'plus', label: 'Add-ons', sub: 'Support for this router\'s light, fan or modem', onClick: openAddons }),
				row({ icon: 'download', label: 'Back up', sub: 'Settings, apps and sign-ins in one file', onClick: openBackup }),
				row({ icon: 'refresh', label: 'Restore', sub: 'From a backup file', onClick: openRestore })),
			sectionTitle('Maintenance'),
			group(
				row({ icon: 'log', label: 'System log', sub: 'Recent messages from the router', onClick: openLog }),
				row({ icon: 'power', label: 'Restart router', onClick: reboot }),
				row({ icon: 'refresh', label: 'Reset settings, keep WiFi', sub: 'Network, DNS and firewall back to defaults; WiFi, apps and passwords stay', onClick: openSoftReset }),
				row({ icon: 'trash', label: 'Reset to factory settings', danger: true, onClick: factory })),
			sectionTitle('More'),
			group(
				row({ icon: 'system', label: 'Advanced settings (LuCI)', sub: 'Every option, for experts', href: '/cgi-bin/luci/', target: '_blank' }),
				row({ icon: 'globe', label: 'Appearance', value: themeName(), onClick: openTheme }),
				App.pwa.standalone() ? null : row({ icon: 'phone', label: 'Install as an app', sub: 'Open Router Home from its own icon', onClick: openInstall }),
				row({ icon: 'user', label: 'Sign out', onClick: () => App.logout() })),
			sectionTitle('About'),
			h('div', { class: 'group' }, h('dl', { class: 'kv' },
				h('dt', 'Model'), h('dd', (board && board.model) || '—'),
				h('dt', 'Firmware'), h('dd', rel.description || '—'),
				h('dt', 'Kernel'), h('dd', (board && board.kernel) || '—'),
				h('dt', 'Running for'), h('dd', sys ? fmt.duration(sys.uptime) : '—'),
				sys ? [h('dt', 'Memory'), h('dd', `${fmt.bytes(sys.memory.total - (sys.memory.available || sys.memory.free))} of ${fmt.bytes(sys.memory.total)} used`)] : null,
				sys && sys.load ? [h('dt', 'Load'), h('dd', sys.load.map(l => (l / 65536).toFixed(2)).join(' '))] : null)));
		every(15000, tick);
	}
});

function themeName() { return Theme.name(); }
function openTheme() { App.go('more/appearance'); }

function openGeneral(s0, tzs) {
	const { h, field, input, select, btn, busy, uci, sheet, hint } = App;
	const name = input({ value: s0.hostname || '', maxlength: 63 });
	const zones = Object.keys(tzs || {}).sort();
	const tz = select(zones.length ? zones : ['UTC'], s0.zonename || 'UTC');
	sheet('Router', close => {
		const save = btn('Save', () => busy(save, async () => {
			const hn = name.value.trim();
			if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(hn)) throw new Error('Use letters, numbers and dashes for the name');
			const v = { hostname: hn, zonename: tz.value };
			if (tzs && tzs[tz.value]) v.timezone = tzs[tz.value].tzstring;
			await uci.set('system', s0['.name'], v);
			if (await uci.apply()) { App.info.hostname = hn; close(); App.route(); }
		}));
		return h('div', h('div', { class: 'group' }, field('Router name', name), field('Time zone', tz)),
			hint('The time zone matters for bedtime schedules and the time shown in the log.'),
			h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), save));
	});
}

function openPassword() {
	const { h, field, password, btn, busy, rpc, sheet, hint, toast } = App;
	const [a, pa] = password('', { autocomplete: 'new-password' });
	const [b, pb] = password('', { autocomplete: 'new-password' });
	sheet('Admin password', close => {
		const save = btn('Change password', () => busy(save, async () => {
			if (a.value.length < 8) throw new Error('Use at least 8 characters');
			if (a.value !== b.value) throw new Error('The two passwords don\'t match');
			const r = await rpc('luci', 'setPassword', { username: 'root', password: a.value });
			if (!r || !r.result) throw new Error('The router refused the new password');
			toast('Password changed'); close();
		}));
		return h('div', h('div', { class: 'group' }, field('New password', [a, pa]), field('Type it again', [b, pb])),
			hint('This is also the password for SSH and the advanced settings. Keep it somewhere safe.'),
			h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), save));
	});
}

function openLed() {
	const { h, row, group, toggle, btn, busy, rpc, call, sheet, hint, note, sectionTitle, toast } = App;
	call('home-ui', 'led_info').then(li => {
		if (!li || li.error || li.kind === 'none') return toast((li && li.error) || 'No status light found', { bad: true });
		const en = toggle(!!li.enabled, null, 'Status light on');
		const hasBr = li.brightness != null;
		const br = h('input', { type: 'range', min: 8, max: 255, step: 1, value: li.brightness || 96, 'aria-label': 'Brightness' });
		const colors = li.colors || [];
		sheet('Front light', close => {
			const save = btn('Save', () => busy(save, async () => {
				await rpc('home-ui', 'led_set', { enabled: en.checked, brightness: hasBr ? +br.value : -1 });
				toast('Saved'); close();
			}));
			return h('div',
				group(row({ icon: 'light', label: 'Show internet status on the light',
					sub: li.kind === 'generic' ? 'Off: the light works the normal OpenWrt way' : 'Turn off for a dark bedroom', right: en }),
					hasBr ? h('div', { class: 'field' }, h('span', 'Brightness'), br) : null),
				sectionTitle('What the colors mean'),
				h('div', { class: 'group' }, h('div', { class: 'legend' }, colors.map(c => h('div', h('i', { style: { background: c.css } }), c.label)))),
				sectionTitle('Try a color'),
				h('div', { class: 'group' }, h('div', { class: 'swatches' }, colors.map(c =>
					h('button', { type: 'button', title: c.label, 'aria-label': `Show ${c.label}`, style: { background: c.css }, onclick: () => rpc('home-ui', 'led_test', { color: c.id }).then(() => toast('Showing for 4 seconds')).catch(e => toast(e.message, { bad: true })) })))),
				hint('The light goes back to showing the real status after a few seconds.'),
				li.kind === 'generic' ? hint(`Found automatically: ${li.leds}. If these are the wrong lights, an add-on for this router can drive them instead (System → Add-ons).`) : null,
				h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), save));
		});
	});
}

/* ---------- add-ons ---------- */

function openAddons() {
	const { h, row, group, btn, busy, rpc, call, sheet, hint, note, sectionTitle, toast, confirm } = App;
	sheet('Add-ons', close => {
		const body = h('div', h('div', { class: 'skeleton' }));
		const PROV = { led: 'light', fan: 'fan', modem: 'modem' };
		const what = p => (p || '').split(/\s+/).filter(Boolean).map(x => PROV[x] || x).filter((x, i, a) => a.indexOf(x) === i).join(', ');
		const done = msg => { toast(msg); setTimeout(() => location.reload(), 1200); };
		async function draw() {
			const r = await call('home-ui', 'addon_list');
			const inst = (r && r.addons) || [];
			const avail = ((r && r.catalog) || []).filter(c => !c.installed);
			const file = h('input', { type: 'file', accept: '.tar.gz,.tgz,application/gzip' });
			const up = btn('Install from file', () => busy(up, async () => {
				const f = file.files[0];
				if (!f) throw new Error('Pick an add-on file (.tar.gz) first');
				if (!await confirm('Install this add-on?', 'Add-ons run with full control of the router. Only install add-ons from people you trust.', 'Install')) return;
				await upload(f, '/tmp/home-ui-addon.tar.gz');
				const res = await rpc('home-ui', 'addon_install', {});
				done(`${res.name || res.id} ${res.version || ''} installed`);
			}), 'secondary small');
			body.replaceChildren(
				sectionTitle('Installed'),
				inst.length ? group(...inst.map(a => row({ icon: 'box', label: `${a.name || a.id}${a.version ? ' ' + a.version : ''}`,
					sub: `${what(a.provides) ? 'Adds: ' + what(a.provides) + ' · ' : ''}${a.active ? 'active on this router' : 'not for this router'}`,
					right: h('span', { class: 'dot ' + (a.active ? 'on' : '') }),
					onClick: () => details(a, true) }))) : h('div', { class: 'group' }, h('div', { class: 'empty' }, 'No add-ons installed.')),
				avail.length ? [sectionTitle('Available'), group(...avail.map(a => row({ icon: 'download', label: `${a.name || a.id} ${a.version || ''}`,
					sub: a.fits ? (a.boards.trim() === '*' ? 'For any router' : 'Made for this router') : `For ${a.boards.trim()}`,
					onClick: () => details(a, false) })))] : null,
				sectionTitle('From a file'),
				h('div', { class: 'group' }, h('label', { class: 'field' }, h('span', 'Add-on file'), file)),
				h('div', { class: 'btn-row' }, up),
				hint('Add-ons add support for a router\'s light, fan or modem when Router Home can\'t find it on its own. Add-ons made for your router model are set up automatically.'));
		}
		function details(a, installed) {
			const act = installed
				? btn('Remove', () => busy(act, async () => {
					if (!await confirm(`Remove ${a.name || a.id}?`, 'Its files are removed. Its settings stay, in case you install it again.', 'Remove', true)) return;
					await rpc('home-ui', 'addon_remove', { id: a.id });
					done('Add-on removed');
				}), 'secondary')
				: btn('Install', () => busy(act, async () => {
					const res = await rpc('home-ui', 'addon_install', { catalog: a.id });
					done(`${res.name || res.id} installed`);
				}));
			sheet(a.name || a.id, c2 => h('div',
				h('div', { class: 'group' }, h('dl', { class: 'kv' },
					h('dt', 'Version'), h('dd', a.version || '—'),
					h('dt', 'For'), h('dd', (a.boards || '').trim() === '*' ? 'Any router' : (a.boards || '—')),
					a.author ? [h('dt', 'By'), h('dd', a.author)] : null,
					installed ? [h('dt', 'Status'), h('dd', a.active ? 'Active' : 'Not active on this router')] : null)),
				a.description ? hint(a.description) : null,
				h('div', { class: 'actions' }, btn('Close', c2, 'secondary'), (installed || a.fits) ? act : null)));
		}
		draw();
		return body;
	});
}

/* ---------- firmware, backup, restore ---------- */

function upload(file, path, onProgress) {
	return new Promise((resolve, reject) => {
		const fd = new FormData();
		fd.append('sessionid', App.sid);
		fd.append('filename', path);
		fd.append('filedata', file);
		const x = new XMLHttpRequest();
		x.open('POST', '/cgi-bin/cgi-upload');
		x.upload.onprogress = e => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
		x.onload = () => {
			let j = null; try { j = JSON.parse(x.responseText); } catch (e) {}
			if (x.status === 200 && j && j.size != null) resolve(j);
			else reject(new Error(x.status === 403 ? 'Upload refused (permission denied). Sign out and in again.' : 'Upload failed: ' + (x.responseText || x.status)));
		};
		x.onerror = () => reject(new Error('Upload failed: connection lost'));
		x.send(fd);
	});
}

async function waitForReboot(msgEl, seconds) {
	const { sleep } = App;
	const start = Date.now();
	await sleep(15000);
	while (Date.now() - start < (seconds || 300) * 1000) {
		msgEl.textContent = `Waiting for the router… ${Math.round((Date.now() - start) / 1000)} s`;
		try {
			const r = await fetch('/home/index.html', { cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined });
			if (r.ok) { msgEl.textContent = 'The router is back. Reloading…'; await sleep(2000); location.reload(); return; }
		} catch (e) {}
		await sleep(4000);
	}
	msgEl.textContent = 'The router is taking longer than usual. If its address changed, reconnect to its WiFi and open this page again.';
}

function blockingSheet(title, text) {
	const { h, sheet } = App;
	const msg = h('p', { style: { color: 'var(--muted)', margin: '6px 2px' } }, text);
	const s = sheet(title, h('div', h('div', { class: 'lamp checking', style: { margin: '10px auto 16px', width: '56px', height: '56px' } }), msg), { modal: true });
	s.box.querySelector('.sheet-head button').hidden = true;
	return msg;
}

function openUpgrade() {
	const { h, row, group, field, toggle, btn, busy, rpc, sheet, hint, note, fmt, confirm } = App;
	sheet('Update firmware', close => {
		const file = h('input', { type: 'file', accept: '.bin,.itb,.img,.tar' });
		const keepApps = toggle(true, null, 'Keep apps');
		const keep = toggle(true, () => { appsRow.hidden = !keep.checked; }, 'Keep settings');
		const appsRow = h('div', { class: 'row' }, h('span', { class: 'main' }, h('div', { class: 'label' }, 'Keep apps'), h('div', { class: 'sub' }, 'Reinstall your apps and sign-ins after the update (needs internet)')), keepApps);
		const bar = h('div', { class: 'hint' });
		const go = btn('Upload and check', () => busy(go, async () => {
			const f = file.files[0];
			if (!f) throw new Error('Pick the sysupgrade file first');
			if (/initramfs|factory/i.test(f.name) && !await confirm('Are you sure about this file?', `“${f.name}” doesn't look like a sysupgrade image. Usually you want the file ending in -sysupgrade.bin.`, 'Use it anyway', true)) return;
			await upload(f, '/tmp/firmware.bin', p => { bar.textContent = `Uploading… ${Math.round(p * 100)}%`; });
			bar.textContent = 'Checking the file…';
			const v = await rpc('system', 'validate_firmware_image', { path: '/tmp/firmware.bin' }, { allowFail: true }).catch(() => null);
			if (v && v.valid === false) {
				bar.textContent = '';
				await rpc('file', 'remove', { path: '/tmp/firmware.bin' }, { allowFail: true });
				throw new Error('This file is not a valid update for this router. Use the -sysupgrade.bin file built for it.');
			}
			if (v && v.allow_backup === false && keep.checked) throw new Error('This file can\'t keep settings. Turn off “Keep settings” to continue.');
			bar.textContent = `${f.name} · ${fmt.bytes(f.size)} · checked`;
			if (!await confirm('Install this update?', 'The router installs the update and restarts. This takes about 3 minutes. Do not unplug it.', 'Install')) return;
			if (keep.checked && keepApps.checked) {
				try { await runFullBackup('snapshot', m => { bar.textContent = m; }); }
				catch (e) {
					if (!await confirm('Apps could not be saved', `${e.message}. Install the update anyway? Your settings are kept, but apps would have to be reinstalled by hand.`, 'Install anyway', true)) return;
				}
			}
			rpc('file', 'exec', { command: '/sbin/sysupgrade', params: keep.checked ? ['/tmp/firmware.bin'] : ['-n', '/tmp/firmware.bin'] }, { allowFail: true }).catch(() => {});
			close();
			const msg = blockingSheet('Installing update', 'Do not unplug the router. This page reloads when it\'s back.');
			waitForReboot(msg, 420);
		}));
		return h('div',
			h('div', { class: 'group' }, field('Firmware file', file), h('div', { class: 'row' }, h('span', { class: 'main' }, h('div', { class: 'label' }, 'Keep settings'), h('div', { class: 'sub' }, 'Recommended')), keep), appsRow),
			bar,
			hint('Use the file whose name ends in -sysupgrade.bin from your build for this router model.'),
			h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), go));
	});
}

/* save a downloaded file (inside the Android app: through the app, to Downloads) */
async function saveBlob(blob, name) {
	if (window.RouterHomeApp && RouterHomeApp.saveFile) {
		const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
		if (!RouterHomeApp.saveFile(name, 'application/gzip', b64)) throw new Error('The app could not save the file to Downloads');
		return 'Backup saved to Downloads';
	}
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = name;
	document.body.appendChild(a); a.click(); a.remove();
	setTimeout(() => URL.revokeObjectURL(a.href), 5000);
	return 'Backup downloaded';
}
const backupName = full => `backup-${full ? 'full-' : ''}${App.info.hostname || 'router'}-${new Date().toISOString().slice(0, 10)}.tar.gz`;

async function backupSettingsOnly() {
	const r = await fetch('/cgi-bin/cgi-backup', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'sessionid=' + encodeURIComponent(App.sid) });
	if (!r.ok) throw new Error('The router refused the backup (' + r.status + ')');
	App.toast(await saveBlob(await r.blob(), backupName(false)));
}

/* run the full backup (or the pre-update snapshot) and wait for it */
async function runFullBackup(action, onMsg) {
	const { rpc, call, sleep } = App;
	let st = await rpc('home-ui', 'full_backup', { action }, { raw: true });
	const until = Date.now() + 15 * 60000;
	while (st && st.state === 'running' && Date.now() < until) {
		onMsg && onMsg(st.message || 'Working…');
		await sleep(2000);
		st = await call('home-ui', 'full_backup', { action: 'status' });
	}
	if (!st || st.state !== 'done') throw new Error((st && st.message) || 'The backup did not finish');
	return st;
}

function openBackup() {
	const { h, row, group, btn, busy, sheet, hint, note, sectionTitle, fmt } = App;
	sheet('Back up', close => {
		const body = h('div');
		const status = h('p', { class: 'hint' });
		const words = list => (list || '').trim().split(/\s+/).filter(Boolean);
		const full = btn('Back up everything', () => busy(full, async () => {
			status.textContent = 'Starting…';
			const st = await runFullBackup('start', m => { status.textContent = m; });
			status.textContent = 'Downloading…';
			const r = await fetch('/cgi-bin/cgi-download', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: 'sessionid=' + encodeURIComponent(App.sid) + '&path=' + encodeURIComponent('/tmp/backup.tar.gz') + '&filename=backup.tar.gz' });
			if (!r.ok) throw new Error('The router refused the download (' + r.status + ')');
			const msg = await saveBlob(await r.blob(), backupName(true));
			const feed = words(st.feed), own = words(st.nonfeed), skipped = (st.skipped || '').trim();
			body.replaceChildren(
				note(`${msg} · ${fmt.bytes(st.size || 0)}`),
				group(
					row({ icon: 'download', label: 'Apps from OpenWrt', sub: feed.length ? feed.join(', ') : 'None added', value: String(feed.length) }),
					row({ icon: 'box', label: 'Apps saved in the backup', sub: own.length ? own.join(', ') + ' (not in the OpenWrt feeds)' : 'None', value: String(own.length) }),
					row({ icon: 'edit', label: 'Your files and sign-ins', sub: 'Router Home, Proton and Tailscale sign-ins, scripts you added', value: String(st.extra_files || 0) })),
				skipped ? note('Left out: ' + skipped, 'warn') : null,
				hint('Restoring this file puts your settings back, then the router reinstalls the OpenWrt apps (latest versions) once it is online and restarts one more time. Saved apps are only put back when they are newer than what the new firmware already has.'),
				h('div', { class: 'actions' }, btn('Done', close)));
		}));
		const only = btn('Settings only', () => busy(only, backupSettingsOnly), 'secondary');
		body.replaceChildren(
			group(
				row({ icon: 'box', label: 'Everything (recommended)', sub: 'Settings, the apps you installed, Router Home, sign-ins (Proton, Tailscale) and files you added. Needs internet to check which apps OpenWrt still has.' }),
				row({ icon: 'download', label: 'Settings only', sub: 'The standard OpenWrt backup. Apps you installed have to be reinstalled by hand.' })),
			status,
			h('div', { class: 'actions' }, only, full));
		return body;
	});
}

function restoreBanner(r) {
	const { h, note, btn, busy, rpc, sheet, toast } = App;
	if (!r || r.state === 'none' || r.dismissed) return null;
	if (r.state === 'done' && r.done_age > 7 * 86400) return null;
	/* "running" but nothing is running: the router restarted or the wait gave up */
	const stalled = r.state === 'running' && !r.active;
	const kind = r.state === 'failed' || stalled ? 'warn' : null;
	const title = stalled ? 'Restore paused' : r.state === 'running' ? 'Restoring your apps…' : r.state === 'failed' ? 'Restore stopped' : 'Restore finished';
	const msg = stalled ? 'It stopped before it finished, for example because the router restarted. Make sure the router is online, then tap Continue.' : (r.message || '');
	const showLog = () => sheet('Restore log', close => h('div', h('pre', { class: 'log' }, r.log || '(empty)'), h('div', { class: 'actions' }, btn('Close', close))));
	const retryFailed = r.state === 'done' && /Could not reinstall/.test(r.message || '');
	const cont = r.state !== 'done' || retryFailed ? btn(retryFailed ? 'Try again' : r.state === 'running' && !stalled ? 'Try now' : 'Continue', () => busy(cont, async () => {
		await rpc('home-ui', 'restore_retry', {});
		toast('Restore continues. This page updates by itself.');
		setTimeout(() => location.reload(), 4000);
	}), 'small') : null;
	const box = note(h('div', h('strong', title), h('div', msg),
		h('div', { style: { display: 'flex', gap: '18px', marginTop: '8px', alignItems: 'center', flexWrap: 'wrap' } },
			cont,
			h('a', { class: 'link', href: '#', onclick: e => { e.preventDefault(); showLog(); } }, 'Details'),
			r.state !== 'running' ? h('a', { class: 'link', href: '#', onclick: e => {
				e.preventDefault(); box.remove();
				App.call('home-ui', 'restore_dismiss', {});
			} }, 'Dismiss') : null)), kind);
	return box;
}

function openRestore() {
	const { h, field, btn, busy, rpc, sheet, hint, note, confirm } = App;
	sheet('Restore', close => {
		const file = h('input', { type: 'file', accept: '.tar.gz,.tgz' });
		const go = btn('Restore and restart', () => busy(go, async () => {
			const f = file.files[0];
			if (!f) throw new Error('Pick a backup file first');
			if (!await confirm('Restore this backup?', 'Your current settings are replaced and the router restarts. With a full backup it then reinstalls your apps by itself and restarts once more.', 'Restore', true)) return;
			await upload(f, '/tmp/backup.tar.gz');
			const r = await rpc('file', 'exec', { command: '/sbin/sysupgrade', params: ['--restore-backup', '/tmp/backup.tar.gz'] });
			if (r.code !== 0) throw new Error('The backup could not be restored: ' + (r.stderr || r.stdout || r.code));
			rpc('system', 'reboot', {}, { allowFail: true }).catch(() => {});
			close();
			waitForReboot(blockingSheet('Restarting', 'Settings restored. If the backup changed the router\'s address, reconnect to it afterwards.'));
		}));
		return h('div', h('div', { class: 'group' }, field('Backup file', file)),
			hint('Use a file made with “Back up”. A full backup also brings back your apps and sign-ins: after the restart, the router reinstalls them once it is online (a few minutes) and restarts once more. Progress shows at the top of this page.'),
			h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), go));
	});
}

async function reboot() {
	const { rpc, confirm } = App;
	if (!await confirm('Restart the router?', 'Everyone loses internet for about 2 minutes.', 'Restart')) return;
	rpc('system', 'reboot', {}, { allowFail: true }).catch(() => {});
	waitForReboot(blockingSheet('Restarting', 'This page reloads when the router is back.'));
}

async function factory() {
	const { rpc, confirm, toast } = App;
	if (!await confirm('Reset to factory settings?', 'Every setting is erased: WiFi names, passwords, VPNs and the mobile APN. The router goes back to 192.168.1.1 with no password. eSIM profiles stay on the eSIM.', 'Erase everything', true)) return;
	try {
		const r = await rpc('file', 'exec', { command: '/sbin/firstboot', params: ['-r', '-y'] });
		if (r.code !== 0) throw new Error('Reset failed: ' + (r.stderr || r.code));
		waitForReboot(blockingSheet('Resetting', 'The router erases its settings and restarts. Reconnect to it at 192.168.1.1 afterwards.'), 300);
	} catch (e) { toast(e.message, { bad: true }); }
}

function openLog() {
	const { h, sheet, call, btn, busy } = App;
	sheet('System log', close => {
		const pre = h('pre', { class: 'code log' }, 'Loading…');
		const filter = h('input', { class: 'search', type: 'search', placeholder: 'Filter, for example: wlan, modem, error', style: { marginBottom: '10px' } });
		let text = '';
		const draw = () => {
			const q = filter.value.toLowerCase();
			pre.textContent = (q ? text.split('\n').filter(l => l.toLowerCase().includes(q)).join('\n') : text) || 'Nothing to show.';
			pre.scrollTop = pre.scrollHeight;
		};
		filter.oninput = draw;
		const load = async () => { const r = await call('home-ui', 'log', { lines: 400 }); text = (r && r.log) || ''; draw(); };
		const rb = btn('Refresh', () => busy(rb, load), 'secondary small');
		load();
		return h('div', filter, pre, h('div', { class: 'btn-row' }, rb));
	});
}

/* ---------- fan ---------- */

function zoneName(n) {
	n = String(n || '').replace(/[-_]thermal$/, '').replace(/[_-]+/g, ' ').trim();
	if (/^ath1[12]k/i.test(n)) return 'WiFi radio' + (n.match(/000(\d):/) ? ' ' + n.match(/000(\d):/)[1] : '');
	if (/^cpu ?(\d+)/i.test(n)) return 'CPU core ' + n.match(/(\d+)/)[1];
	if (/^top glue/i.test(n)) return 'Processor';
	if (/^nss/i.test(n)) return 'Network engine' + (n.match(/(\d+)$/) ? ' ' + n.match(/(\d+)$/)[1] : '');
	if (/^wcss|^wcs/i.test(n)) return 'WiFi core';
	if (/^lpass/i.test(n)) return 'Audio block';
	if (/^ddr/i.test(n)) return 'Memory';
	if (/^ubi/i.test(n)) return 'Packet engine';
	if (/^cpuss/i.test(n)) return 'CPU cluster' + (n.match(/(\d+)$/) ? ' ' + n.match(/(\d+)$/)[1] : '');
	if (/^wcss/i.test(n)) return 'WiFi core';
	return n.charAt(0).toUpperCase() + n.slice(1);
}
function hottest(f) {
	const t = ((f && f.temps) || []).map(x => x.temp).filter(x => x > -40000 && x < 150000);
	return t.length ? Math.round(Math.max(...t) / 1000) : null;
}
function fanSummary(f) {
	if (!f) return '';
	if (f.kind === 'onoff') {
		const hot = hottest(f);
		return [f.mode === 'manual' ? (f.speed > 0 ? 'Always on' : 'Off') : 'Automatic', f.pwm ? 'running' : 'stopped', hot != null ? `hottest ${hot} °C` : null].filter(Boolean).join(' · ');
	}
	const pct = f.pwm != null ? Math.round(f.pwm / 255 * 100) : null;
	const hot = hottest(f);
	return [f.mode === 'manual' ? `Manual ${f.speed}%` : 'Automatic', pct != null ? `running at ${pct}%` : null, hot != null ? `hottest ${hot} °C` : null].filter(Boolean).join(' · ');
}

function openFan(onDone) {
	const { h, row, group, seg, btn, busy, rpc, call, sheet, hint, note, sectionTitle, toast, every } = App;
	call('home-ui', 'fan_status').then(f => {
		if (!f || !f.available) return toast('No controllable fan found on this router', { bad: true });
		if (f.kind === 'onoff') return openFanOnOff(f, onDone);
		let mode = f.mode === 'manual' ? 'manual' : 'auto';
		const pctLabel = h('strong', `${f.speed}%`);
		const slider = h('input', { type: 'range', min: 0, max: 100, step: 5, value: f.speed, 'aria-label': 'Fan speed',
			oninput: () => { pctLabel.textContent = slider.value + '%'; warn.hidden = +slider.value >= 20; } });
		const warn = note('Below 20% many fans stop spinning. The fan still goes to full speed if the router gets too hot.', 'warn');
		warn.hidden = +f.speed >= 20;
		const manualBox = h('div', { class: 'group', hidden: mode !== 'manual', style: { marginTop: '12px' } },
			h('div', { class: 'field' }, h('span', { style: { display: 'flex', justifyContent: 'space-between' } }, 'Speed', pctLabel), slider));
		const presets = h('div', { class: 'chips', hidden: mode !== 'manual' }, [['Quiet', 25], ['Medium', 50], ['High', 75], ['Full', 100]].map(([l, v]) =>
			h('button', { type: 'button', class: 'chip', onclick: () => { slider.value = v; slider.dispatchEvent(new Event('input')); } }, l)));
		const modeSeg = seg([['auto', 'Automatic'], ['manual', 'Manual']], mode, v => {
			mode = v; manualBox.hidden = presets.hidden = v !== 'manual'; autoHint.hidden = v !== 'auto'; manHint.hidden = v !== 'manual';
		});
		const autoHint = hint(f.soft
			? 'The router speeds the fan up as it warms: off below 50 °C, 30% from 50 °C, 60% from 65 °C and full from 80 °C.'
			: 'The router speeds the fan up as it warms: quiet below 50 °C, low from 50 °C, medium from 65 °C and full from 80 °C.');
		const manHint = hint(`The fan stays at this speed. For safety it switches to full speed above ${f.safety_temp} °C and comes back when the router cools down.`);
		autoHint.hidden = mode !== 'auto'; manHint.hidden = mode !== 'manual';

		const now = h('dl', { class: 'kv' });
		const drawNow = st => {
			const temps = ((st && st.temps) || []).filter(x => x.temp > -40000 && x.temp < 150000);
			const byName = {};
			for (const x of temps) { const n = zoneName(x.name); if (!byName[n] || byName[n] < x.temp) byName[n] = x.temp; }
			const list = Object.entries(byName).sort((a, b) => b[1] - a[1]);
			now.replaceChildren(
				h('dt', 'Fan right now'), h('dd', st && st.pwm != null ? `${Math.round(st.pwm / 255 * 100)}%${st.rpm ? ` · ${st.rpm} RPM` : ''}` : '—'),
				list.slice(0, 8).map(([n, t]) => [h('dt', n), h('dd', { style: t >= 80000 ? { color: 'var(--offline)' } : t >= 65000 ? { color: 'var(--warn)' } : null }, `${(t / 1000).toFixed(0)} °C`)]));
		};
		drawNow(f);

		let stop = null;
		sheet('Fan', close => {
			const save = btn('Save', () => busy(save, async () => {
				await rpc('home-ui', 'fan_set', { mode, speed: +slider.value });
				toast(mode === 'auto' ? 'Fan set to automatic' : `Fan set to ${slider.value}%`);
				setTimeout(async () => drawNow(await call('home-ui', 'fan_status')), 3500);
				onDone && onDone();
			}));
			return h('div',
				h('div', { class: 'group' }, now),
				sectionTitle('Mode'),
				modeSeg, autoHint, manHint,
				manualBox, presets, warn,
				h('div', { class: 'actions' }, btn('Close', close, 'secondary'), save));
		}, { onClose: () => stop && stop() });
		stop = every(4000, async () => drawNow(await call('home-ui', 'fan_status')));
	});
}

/* ---------- Router Home self-update ---------- */

function openSelfUpdate() {
	const { h, field, btn, busy, rpc, sheet, hint, note, toast, info, sleep } = App;
	sheet('Update Router Home', close => {
		const file = h('input', { type: 'file', accept: '.tar.gz,.tgz,.tar,application/gzip,application/x-tar' });
		const status = h('div', { class: 'hint' });
		const go = btn('Upload and install', () => busy(go, async () => {
			const f = file.files[0];
			if (!f) throw new Error('Pick the home-ui.tar.gz file first');
			if (!/\.(tar\.gz|tgz|tar)$/i.test(f.name)) throw new Error('Use the home-ui.tar.gz file (a .tar.gz, .tgz or .tar archive)');
			if (f.size > 8 * 1024 * 1024) throw new Error('That file is too big for a Router Home update');
			await upload(f, '/tmp/home-ui-update.tar.gz', p => { status.textContent = `Uploading… ${Math.round(p * 100)}%`; });
			status.textContent = 'Checking and installing…';
			const r = await rpc('home-ui', 'self_update', {});
			status.textContent = '';
			close();
			const msg = h('p', { style: { color: 'var(--muted)', margin: '6px 2px' } },
				`Updated from ${r.old || '?'} to ${r.new || '?'}. Reloading in a few seconds…`);
			const s = sheet('Router Home updated', h('div', h('div', { class: 'lamp online', style: { margin: '10px auto 16px', width: '56px', height: '56px' } }), msg), { modal: true });
			s.box.querySelector('.sheet-head button').hidden = true;
			await sleep(4000);
			/* sign in again so new permissions apply, then load the new files */
			App.logout();
			location.replace('/home/?u=' + Date.now());
		}));
		return h('div',
			note(`Installed now: Router Home ${info.version || '(unknown version)'}`),
			h('div', { class: 'group' }, field('Update file', file)),
			status,
			hint('Use the home-ui.tar.gz file you received. Your settings (fan, WiFi, VPN and so on) are kept. You will be asked to sign in again afterwards.'),
			h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), go));
	});
}

/* ---------- install as an app ---------- */

function openInstall() {
	const { h, btn, sheet, note, hint, pwa, toast } = App;
	if (pwa.prompt) {
		const p = pwa.prompt;
		pwa.prompt = null;
		p.prompt();
		p.userChoice.then(c => { if (c.outcome !== 'accepted') pwa.prompt = p; });
		return;
	}
	const ua = navigator.userAgent;
	const ios = /iPhone|iPad|iPod/.test(ua), android = /Android/.test(ua);
	const steps = ios
		? ['Tap the Share button in Safari.', 'Choose “Add to Home Screen”.', 'Tap Add.']
		: android
			? ['Open the browser menu (⋮).', 'Choose “Add to Home screen” or “Install app”.', 'Tap Add or Install.']
			: ['Click the install icon at the right of the address bar, or open the browser menu.', 'Choose “Install Router Home” or “Save and share → Install page as app”.'];
	sheet('Install as an app', close => h('div',
		h('ol', { style: { margin: '6px 0 4px', paddingLeft: '22px', lineHeight: 1.7 } }, steps.map(s => h('li', s))),
		pwa.secure() ? null : note(h('div',
			h('p', { style: { margin: '0 0 8px' } }, 'The router page uses plain http, so the browser may only add a shortcut that opens in a tab. To get a full app with its own window:'),
			h('ol', { style: { margin: 0, paddingLeft: '20px', lineHeight: 1.6 } },
				h('li', 'In Chrome open chrome://flags (in Brave: brave://flags).'),
				h('li', 'Search for “Insecure origins treated as secure”.'),
				h('li', h('span', 'Enter ', h('strong', { class: 'mono' }, location.origin), ', set it to Enabled and relaunch.')),
				h('li', 'Come back here and tap “Install as an app” again.'))), 'warn'),
		hint('The app icon opens straight to your router. You sign in the same way.'),
		h('div', { class: 'actions' }, btn('Done', close))));
}

/* fans that can only be switched on or off (no PWM driver yet) */
function openFanOnOff(f, onDone) {
	const { h, seg, btn, busy, rpc, call, sheet, hint, sectionTitle, toast, every } = App;
	let choice = f.mode === 'manual' ? (f.speed > 0 ? 'on' : 'off') : 'auto';
	const now = h('dl', { class: 'kv' });
	const drawNow = st => {
		const temps = ((st && st.temps) || []).filter(x => x.temp > -40000 && x.temp < 150000);
		const byName = {};
		for (const x of temps) { const n = zoneName(x.name); if (!byName[n] || byName[n] < x.temp) byName[n] = x.temp; }
		const list = Object.entries(byName).sort((a, b) => b[1] - a[1]);
		now.replaceChildren(
			h('dt', 'Fan right now'), h('dd', st && st.pwm ? 'Running' : 'Stopped'),
			list.slice(0, 8).map(([n, t]) => [h('dt', n), h('dd', { style: t >= 80000 ? { color: 'var(--offline)' } : t >= 65000 ? { color: 'var(--warn)' } : null }, `${(t / 1000).toFixed(0)} °C`)]));
	};
	drawNow(f);
	const autoHint = hint(`The fan turns on above ${f.on_temp} °C and off again below ${f.off_temp} °C.`);
	const offHint = hint(`The fan stays off, but turns on anyway above ${f.safety_temp} °C.`);
	const show = () => { autoHint.hidden = choice !== 'auto'; offHint.hidden = choice !== 'off'; };
	const modeSeg = seg([['auto', 'Automatic'], ['on', 'Always on'], ['off', 'Off']], choice, v => { choice = v; show(); });
	show();
	let stop = null;
	sheet('Fan', close => {
		const save = btn('Save', () => busy(save, async () => {
			await rpc('home-ui', 'fan_set', choice === 'auto' ? { mode: 'auto' } : { mode: 'manual', speed: choice === 'on' ? 100 : 0 });
			toast(choice === 'auto' ? 'Fan set to automatic' : choice === 'on' ? 'Fan always on' : 'Fan off');
			setTimeout(async () => drawNow(await call('home-ui', 'fan_status')), 6500);
			onDone && onDone();
		}));
		return h('div',
			h('div', { class: 'group' }, now),
			sectionTitle('Mode'),
			modeSeg, autoHint, offHint,
			hint('This router\'s fan can only be switched on or off for now. Variable speed needs a firmware update with the fan driver.'),
			h('div', { class: 'actions' }, btn('Close', close, 'secondary'), save));
	}, { onClose: () => stop && stop() });
	stop = every(5000, async () => drawNow(await call('home-ui', 'fan_status')));
}

function openSoftReset() {
	const { h, row, group, toggle, btn, busy, rpc, sheet, hint, note, explain } = App;
	const keepUp = toggle(true, null, 'Keep the internet connection');
	sheet('Reset settings, keep WiFi', close => {
		const go = btn('Reset settings', () => busy(go, async () => {
			if (!await App.confirm('Reset the network settings?', 'The router’s address becomes 192.168.1.1. Your WiFi names and passwords stay, so your devices reconnect by themselves. Wired devices may need to be unplugged and plugged back in.', 'Reset', true)) return;
			const r = await rpc('home-ui', 'soft_reset', { keep_uplink: keepUp.checked });
			if (r && r.error) throw new Error(r.error);
			close();
			const s = blockingSheet('Resetting settings', 'The network restarts. In about a minute, reconnect to your WiFi and open http://192.168.1.1/home/. If something was better before, open Internet → Connection check and tap Undo.');
			/* the page comes back at the default address once the network is up */
			setTimeout(() => { location.href = `${location.protocol}//192.168.1.1/home/`; }, 45000);
			return s;
		}), 'danger');
		return h('div',
			note(h('div', h('strong', 'Use this when the internet stopped working and you don\'t know why.'), h('div', 'It is like a factory reset for the network only, without losing WiFi access.'))),
			h('h2', { class: 'section-title' }, h('span', 'What goes back to defaults', explain('Reset settings',
				'Reset: the home network (address 192.168.1.1), DHCP and name lookups (DNS), the firewall (zones, port forwards, rules), separate networks (guest, smart home), VPN interfaces, SSH and web server settings. Apps that take over name lookups or traffic (AdGuard Home, encrypted DNS, Proton VPN, UPnP) are switched off.',
				'Kept: your WiFi names and passwords, the admin password, the router name and time zone, installed apps (and their own settings), Router Home, and device names on the Devices page (fixed addresses only when they fit the 192.168.1.x range).',
				'Before resetting, the current settings are saved. Internet → Connection check → Undo puts them back.',
				{ rec: 'Try Internet → Connection check first: it often finds the exact problem. Use this when that doesn\'t help.' }))),
			group(
				row({ icon: 'network', label: 'Home network, DHCP and DNS', sub: 'Router address becomes 192.168.1.1' }),
				row({ icon: 'shield', label: 'Firewall', sub: 'Port forwards, rules, guest networks' }),
				row({ icon: 'vpn', label: 'VPNs and DNS apps', sub: 'Switched off; turn them back on when needed' })),
			h('h2', { class: 'section-title' }, h('span', 'Kept')),
			group(
				row({ icon: 'wifi', label: 'WiFi names and passwords' }),
				row({ icon: 'lock', label: 'Admin password, router name, apps' }),
				row({ icon: 'globe', label: 'Keep the internet connection', sub: 'WAN, PPPoE login, WiFi uplink or mobile. Turn off if that is what broke.', right: keepUp })),
			hint('A copy of the current settings is kept: Internet → Connection check → Undo.'),
			h('div', { class: 'actions' }, btn('Cancel', close, 'secondary'), go));
	});
}
