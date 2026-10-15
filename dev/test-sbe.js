const { chromium } = require('playwright');
const PORT = process.env.PORT || 8088;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + PORT + '/home/'); await p.fill('input[name=password]', 'wrong'); await p.click('button[type=submit]'); await p.waitForTimeout(800);
  await p.screenshot({ path: 'shots/sbe-login.png' });
  await p.fill('input[name=password]', 'test'); await p.click('button[type=submit]'); await p.waitForTimeout(4000);
  await p.goto('http://localhost:' + PORT + '/home/#/network'); await p.waitForTimeout(1500);
  await p.screenshot({ path: 'shots/sbe-net.png' });
  await p.goto('http://localhost:' + PORT + '/home/#/system'); await p.waitForTimeout(1000); await p.click('text=Status light'); await p.waitForTimeout(800);
  await p.screenshot({ path: 'shots/sbe-led.png' });
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
