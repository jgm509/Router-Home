/* Router Home: connection check (what stops the internet, with one-tap
 * fixes) and "last working settings" (saved automatically, put back by
 * itself when a change breaks the internet). */
'use strict';

const Diag = (() => {
	const LV = { bad: ['Problem', 'bad', 'close', 'var(--offline)'], warn: ['Check this', 'warn', 'shield', 'var(--warn)'],
		info: ['Good to know', '', 'shield', null], ok: ['OK', 'ok', 'shield', 'var(--good)'] };
	const when = s => { const d = new Date(+s * 1000); return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };

	async function run(onStep) {
		const { rpc, call, sleep } = App;
		const r = await rpc('home-ui', 'diagnose', { action: 'start' });
		if (r && r.error && r.error !== 'busy') throw new Error(r.error);
		for (let i = 0; i < 40; i++) {
			await sleep(1500);
			const s = await call('home-ui', 'diagnose', { action: 'status' });
			if (s && s.checks) return s;
			onStep && onStep(i);
		}
		throw new Error('The check is taking too long. Try again.');
	}

	async function render(page) {
		const { h, group, btn, busy, explain, hint, note, toast, icon, rpc } = App;
		const results = h('div');
		const guardBox = h('div');
		const again = btn('Check again', () => check(), 'small secondary');
		page.append(backLink(), h('h1', { class: 'page-title' }, 'Connection check'),
			hint('Finds out why the internet doesn\'t work: the connection to your provider, the upstream router, name lookups, the firewall and VPNs.'),
			results, h('div', { class: 'btn-row' }, again), guardBox);

		const STEPS = ['Looking at your connections…', 'Pinging the upstream router and the internet…', 'Testing name lookups…', 'Testing downloads…', 'Checking the firewall and VPNs…'];
		async function check() {
			const line = h('span', STEPS[0]);
			results.replaceChildren(h('div', { class: 'note' }, h('span', { class: 'spinner', style: { marginRight: '10px', verticalAlign: 'middle' } }), line));
			again.disabled = true;
			try {
				const r = await run(i => { line.textContent = STEPS[Math.min(STEPS.length - 1, Math.floor(i / 2) + 1)]; });
				show(r);
			} catch (e) { results.replaceChildren(note(e.message, 'bad')); }
			finally { again.disabled = false; }
		}

		function show(r) {
			const order = { bad: 0, warn: 1, info: 2, ok: 3 };
			/* the router's clock against this phone's */
			const rt = r.epoch ? r.epoch * 1000 : NaN;
			const skew = isNaN(rt) ? 0 : Math.round((Date.now() - rt) / 60000);
			const extra = Math.abs(skew) > 10 ? [{ level: 'warn', id: 'clock_skew', title: `The router's clock is ${Math.abs(skew) >= 1440 ? Math.round(Math.abs(skew) / 1440) + ' day(s)' : Math.abs(skew) >= 60 ? Math.round(Math.abs(skew) / 60) + ' hour(s)' : Math.abs(skew) + ' minutes'} ${skew > 0 ? 'behind' : 'ahead'}`,
				text: 'It sets its clock over the internet, by name (needs the router\'s own name lookups). A wrong clock breaks secure downloads, schedules and logs.', fix: 'set_clock', fix_label: 'Use this phone\'s time' }] : [];
			const checks = (r.checks || []).concat(extra).slice().sort((a, b) => order[a.level] - order[b.level]);
			const bad = checks.filter(c => c.level === 'bad').length;
			const rows = checks.map(c => {
				const [tag, cls, ic, color] = LV[c.level] || LV.info;
				let action = null;
				if (c.fix) {
					const b = btn(c.fix_label || 'Fix it', () => busy(b, async () => {
						if (c.fix === 'goback' && !await App.confirm('Go back to the last working settings?', 'Settings changed since the internet last worked are put back as they were then. You can undo this afterwards.', 'Go back')) return;
						const res = c.fix === 'set_clock'
							? (await rpc('luci', 'setLocaltime', { localtime: Math.floor(Date.now() / 1000) }), { ok: true, message: 'Clock set' })
							: await rpc('home-ui', 'diag_fix', { id: c.fix });
						if (res && res.ok === false) throw new Error(res.message || 'That did not work');
						toast(res && res.message || 'Done');
						await App.sleep(2500);
						check(); loadGuard();
					}), 'small');
					action = b;
				}
				return h('div', { class: 'row check ' + c.level },
					h('span', { class: 'ic', style: { color } }, icon(ic)),
					h('span', { class: 'main' },
						h('div', { class: 'label' }, c.title, ' ', h('span', { class: 'tag ' + cls }, tag)),
						c.text ? h('div', { class: 'sub' }, c.text) : null,
						action ? h('div', { style: { marginTop: '8px' } }, action) : null));
			});
			results.replaceChildren(
				h('div', { class: 'note' + (bad ? ' bad' : '') }, bad ? `Found ${bad} problem${bad > 1 ? 's' : ''}. Start with the first one.` : 'Everything works.'),
				group(...rows),
				hint(`Checked ${r.time || 'just now'}.`));
		}

		/* ---------- last working settings ---------- */
		async function loadGuard() {
			const g = await App.call('home-ui', 'guard_info');
			if (!g) { guardBox.replaceChildren(); return; }
			const tEn = App.toggle(g.enabled, async e => { await rpc('home-ui', 'guard_set', { enabled: e.target.checked }); loadGuard(); }, 'Remember working settings');
			const tAuto = App.toggle(g.auto_recover, async e => { await rpc('home-ui', 'guard_set', { auto_recover: e.target.checked }); }, 'Go back by itself');
			const wait = App.select([[5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour']], g.wait || 10,
				{ onchange: async e => { await rpc('home-ui', 'guard_set', { wait: +e.target.value }); toast('Saved'); } });
			const points = (g.points || []).map((p, i) => App.row({ icon: 'clock', label: when(p.id), sub: (i === 0 ? 'Latest' : 'Older') + (p.uplink ? ` · internet through ${p.uplink}` : ''),
				right: (() => { const b = btn('Go back', () => busy(b, async () => {
					if (!await App.confirm(`Go back to ${when(p.id)}?`, 'Settings that changed since then are put back. The router reloads its network for a few seconds; you may have to reconnect. You can undo this afterwards.', 'Go back')) return;
					await rpc('home-ui', 'guard_action', { action: 'restore', id: p.id });
					toast('Going back… reconnect if the page stops answering', { sticky: true });
					await App.sleep(12000); location.reload();
				}), 'small secondary'); return b; })() }));
			const changed = (g.changed || '').trim();
			guardBox.replaceChildren(
				h('h2', { class: 'section-title' }, h('span', 'Last working settings', explain('Last working settings',
					'Every couple of minutes, Router Home checks that the internet works. When it does and your settings changed (from here, LuCI or a command), it saves a copy. The last 3 are kept.',
					'If a change breaks the internet, you can go back to a working copy here with one tap, even if you don\'t know which change did it.',
					'“Go back by itself” does that for you: when the internet stays down for the time you pick after a settings change, the last working settings are put back. It only happens once, and never when nothing changed (for example when your provider has an outage).',
					{ rec: 'Leave both on. Before trying risky commands, check that the latest copy is from a time when everything worked.' }))),
				g.recovered_at ? note(h('div', h('strong', 'Working settings were put back'), h('div', `On ${when(g.recovered_at)}, the internet had stopped after a settings change, so the last working settings were restored.`),
					h('div', { style: { display: 'flex', gap: '18px', marginTop: '8px' } },
						g.undo ? h('a', { class: 'link', href: '#', onclick: async e => { e.preventDefault(); if (!await App.confirm('Undo?', 'The settings from before the restore come back, including the change that broke the internet.', 'Undo', true)) return; await rpc('home-ui', 'guard_action', { action: 'undo' }); toast('Undoing…'); setTimeout(() => location.reload(), 10000); } }, 'Undo') : null,
						h('a', { class: 'link', href: '#', onclick: async e => { e.preventDefault(); await rpc('home-ui', 'guard_action', { action: 'dismiss' }); loadGuard(); } }, 'OK'))), 'warn') : null,
				group(
					App.row({ icon: 'shield', label: 'Remember working settings', sub: 'Saves a copy when the internet works', right: tEn }),
					g.enabled ? App.row({ icon: 'refresh', label: 'Go back by itself', sub: 'When a change breaks the internet', right: tAuto }) : null,
					g.enabled && g.auto_recover ? App.field('After the internet is down for', wait) : null),
				points.length ? group(...points) : (g.enabled ? hint('No copy yet. One is saved within a few minutes while the internet works.') : null),
				changed && points.length ? [
					hint(`Changed since the latest copy: ${changed}.`),
					h('details', { class: 'group', style: { padding: '10px 14px' } }, h('summary', 'Show the changes'), h('pre', { class: 'log' }, g.diff || '(none)'))] : null,
				g.undo && !g.recovered_at ? group(App.row({ icon: 'refresh', label: 'Undo the last “Go back” or reset', sub: g.undo_when || '', right: (() => { const b = btn('Undo', () => busy(b, async () => {
					await rpc('home-ui', 'guard_action', { action: 'undo' }); toast('Undoing…', { sticky: true }); await App.sleep(10000); location.reload(); }), 'small secondary'); return b; })() })) : null,
				g.enabled ? h('div', { class: 'btn-row' }, (() => { const b = btn('Save current settings now', () => busy(b, async () => {
					let r = await rpc('home-ui', 'guard_action', { action: 'save' });
					if (r && r.error && r.error.includes('internet')) {
						if (!await App.confirm('Save anyway?', 'The router\'s own internet check fails right now (often its own name lookups, see the check above). Save these settings as working only if your devices are online and everything works for you.', 'Save anyway')) return;
						r = await rpc('home-ui', 'guard_action', { action: 'save_force' });
					}
					if (r && r.error) throw new Error(r.error);
					toast('Saved'); loadGuard(); }), 'small secondary'); return b; })()) : null);
		}

		loadGuard();
		check();
	}

	/* banner for the Home page: shown when settings were put back by themselves */
	async function recoveredBanner() {
		const g = await App.call('home-ui', 'guard_info').catch(() => null);
		if (!g || !g.recovered_at) return null;
		return App.note(App.h('div', App.h('strong', 'Working settings were put back'),
			App.h('div', 'The internet stopped after a settings change, so Router Home restored the last settings that worked. '),
			App.h('a', { class: 'link', href: '#/network/check' }, 'Details')), 'warn');
	}

	return { render, run, recoveredBanner };
})();
