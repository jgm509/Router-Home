const { chromium } = require('playwright');
const PORT = process.env.PORT || 8088;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:' + PORT + '/home/'); await p.fill('input[name=password]', 'test'); await p.click('button[type=submit]'); await p.waitForTimeout(1500);
  await p.goto('http://localhost:' + PORT + '/home/#/system'); await p.waitForTimeout(1200);
  await p.screenshot({ path: 'shots/fan-row.png' });
  await p.click('.row >> text=Fan'); await p.waitForTimeout(800); await p.click('.sheet .seg >> text=Manual'); await p.click('.sheet .chip >> text=Quiet'); await p.waitForTimeout(300);
  await p.screenshot({ path: 'shots/fan-sheet.png' });
  await p.click('.sheet >> text=Save'); await p.waitForTimeout(4500);
  console.log(await p.textContent('.sheet dl'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(800);
  console.log(await p.textContent('.row >> text=Manual 25%'));
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
