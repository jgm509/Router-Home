const { chromium } = require('playwright');
const PORT = process.env.PORT || 8088;
const OUT = process.argv[2] || 'shots';
const BASE = process.argv[3] || 'http://localhost:' + PORT + '/home/';
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
	const browser = await chromium.launch();
	const errors = [];
	async function run(name, vp, scheme, steps) {
		const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 2 });
		const page = await ctx.newPage();
		page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${name}] ${m.type()}: ${m.text()}`); });
		page.on('pageerror', e => errors.push(`[${name}] pageerror: ${e.message}`));
		await page.goto(BASE);
		await page.fill('input[name=password]', 'test');
		await page.click('button[type=submit]');
		await page.waitForSelector('.lamp-wrap');
		for (const [shot, fn] of steps) {
			await fn(page);
			await page.waitForTimeout(900);
			await page.screenshot({ path: `${OUT}/${name}-${shot}.png`, fullPage: shot.endsWith('full') });
		}
		await ctx.close();
	}
	const phone = { width: 390, height: 844 };
	const nav = h => async p => { await p.goto(BASE + h); await p.waitForTimeout(1200); };
	const click = (sel) => async p => { await p.click(sel); await p.waitForTimeout(700); };
	const closeSheet = async p => { await p.keyboard.press('Escape'); await p.waitForTimeout(300); };

	await run('phone-dark', phone, 'dark', [
		['home', async p => { await p.waitForTimeout(5000); }],
		['home-full', async p => {}],
		['devices-full', nav('#/devices')],
		['device-sheet', click('text=kids-tablet')],
		['wifi-full', async p => { await closeSheet(p); await nav('#/wifi')(p); }],
		['wifi-net', click('.group >> text=HomeWiFi')],
		['wifi-radio', async p => { await closeSheet(p); await p.click('text=6 GHz radio'); await p.waitForTimeout(900); }],
		['internet-full', async p => { await closeSheet(p); await nav('#/network')(p); }],
		['iface', click('text=5G modem')],
		['mobile-full', async p => { await closeSheet(p); await nav('#/network/mobile')(p); }],
		['esim-run', async p => { await p.click('text=Old Spectrum'); await p.waitForTimeout(500); await p.click('text=Use this profile'); await p.waitForTimeout(500); await p.click('.sheet >> text=Switch'); await p.waitForTimeout(1500); }],
		['dns-full', nav('#/network/dns')],
		['vpn-full', nav('#/network/vpn')],
		['vpn-add', async p => { await p.click('text=Add VPN'); await p.waitForTimeout(400); await p.click('text=Reach home from anywhere'); }],
		['system-full', async p => { await closeSheet(p); await nav('#/system')(p); }],
		['led', click('text=Status light')],
		['log', async p => { await closeSheet(p); await p.click('text=System log'); }],
		['share', async p => { await closeSheet(p); await nav('#/home')(p); await p.waitForTimeout(1500); await p.click('text=Share WiFi'); }]
	]);
	await run('phone-light', phone, 'light', [
		['home', async p => { await p.waitForTimeout(5000); }],
		['devices', nav('#/devices')],
		['wifi', nav('#/wifi')],
		['upgrade', async p => { await nav('#/system')(p); await p.click('text=Update firmware'); }]
	]);
	await run('desk', { width: 1280, height: 860 }, 'light', [
		['home', async p => { await p.waitForTimeout(5000); }],
		['internet', nav('#/network')],
		['device', async p => { await nav('#/devices')(p); await p.click('text=Phone'); }]
	]);
	await browser.close();
	console.log(errors.length ? errors.join('\n') : 'no console errors');
})();
