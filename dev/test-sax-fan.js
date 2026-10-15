const { chromium } = require('playwright');
const PORT = process.env.PORT || 8088;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:' + PORT + '/home/'); await p.fill('input[name=password]', 'test'); await p.click('button[type=submit]'); await p.waitForTimeout(1500);
  await p.goto('http://localhost:' + PORT + '/home/#/system'); await p.waitForTimeout(1200);
  console.log('row:', await p.textContent('.row:has-text("Fan") .sub'));
  await p.click('.row >> text=Fan'); await p.waitForTimeout(800);
  await p.screenshot({ path: 'shots/sax-fan-auto.png' });
  await p.click('.sheet .seg >> text=Manual'); await p.waitForTimeout(300);
  await p.click('.sheet .chip >> text=Medium'); await p.waitForTimeout(200);
  await p.screenshot({ path: 'shots/sax-fan-manual.png' });
  await p.click('.sheet >> text=Save'); await p.waitForTimeout(800);
  console.log('uci fan after save:', JSON.stringify(await (await fetch('http://localhost:' + PORT + '/debug/uci')).json().then(u => u.fan || 'n/a')));
  await p.waitForTimeout(4500);
  console.log('now:', await p.textContent('.sheet dl.kv dd'));
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
