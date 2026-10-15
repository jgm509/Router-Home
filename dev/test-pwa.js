const { chromium } = require('playwright');
const PORT = process.env.PORT || 8088;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => (m.type() === 'error' || m.type() === 'warning') && errs.push(m.text()));
  await p.goto('http://localhost:' + PORT + '/home/'); await p.waitForTimeout(1500);
  const sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r ? (r.active || r.installing || r.waiting) && r.scope : null; });
  console.log('service worker scope:', sw);
  const cdp = await ctx.newCDPSession(p);
  const inst = await cdp.send('Page.getInstallabilityErrors').catch(e => ({ err: e.message }));
  console.log('installability errors:', JSON.stringify(inst));
  const man = await cdp.send('Page.getAppManifest');
  console.log('manifest errors:', JSON.stringify(man.errors));
  await p.fill('input[name=password]', 'test'); await p.click('button[type=submit]'); await p.waitForTimeout(1500);
  await p.goto('http://localhost:' + PORT + '/home/#/system'); await p.waitForTimeout(1200);
  await p.click('.row >> text=Install as an app'); await p.waitForTimeout(600);
  await p.screenshot({ path: 'shots/pwa-sheet.png' });
  // offline: the shell should still load from cache
  await ctx.setOffline(true); await p.reload(); await p.waitForTimeout(1500);
  console.log('offline shell title:', await p.title(), '| login visible:', await p.isVisible('text=Sign in to your router'), '| note:', (await p.textContent('#view')).slice(0, 80));
  console.log(errs.join('\n') || 'no console errors'); await b.close();
})();
