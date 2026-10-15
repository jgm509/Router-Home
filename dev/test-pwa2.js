const { chromium } = require('playwright');
const PORT = process.env.PORT || 8088;
(async () => {
  const b = await chromium.launch({ args: ['--host-resolver-rules=MAP router.test 127.0.0.1'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 10 Pro XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://router.test:8088/home/'); await p.fill('input[name=password]', 'test'); await p.click('button[type=submit]'); await p.waitForTimeout(1500);
  console.log('secure context:', await p.evaluate(() => isSecureContext));
  await p.goto('http://router.test:8088/home/#/system'); await p.waitForTimeout(1200);
  await p.click('.row >> text=Install as an app'); await p.waitForTimeout(600);
  await p.screenshot({ path: 'shots/pwa-http.png' });
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
