const { chromium } = require('playwright');
const PORT = process.env.PORT || 8088;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:' + PORT + '/home/'); await p.fill('input[name=password]', 'test'); await p.click('button[type=submit]'); await p.waitForTimeout(1500);
  await p.goto('http://localhost:' + PORT + '/home/#/system'); await p.waitForTimeout(1200);
  await p.click('.row >> text=Update Router Home'); await p.waitForTimeout(500);
  await p.setInputFiles('.sheet input[type=file]', 'home-ui.tar.gz');
  await p.screenshot({ path: 'shots/su-sheet.png' });
  await p.click('.sheet >> text=Upload and install'); await p.waitForTimeout(1500);
  await p.screenshot({ path: 'shots/su-done.png' });
  await p.waitForTimeout(5000);
  console.log('after:', p.url(), await p.isVisible('text=Sign in to your router'));
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
