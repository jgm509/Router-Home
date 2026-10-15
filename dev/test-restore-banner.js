const { chromium } = require('playwright');
const PORT = process.env.PORT || 8088;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + PORT + '/home/'); await p.fill('input[name=password]', 'test'); await p.click('button[type=submit]'); await p.waitForTimeout(1500);
  await p.goto('http://localhost:' + PORT + '/home/#/system'); await p.waitForTimeout(1500);
  await p.screenshot({ path: 'shots/rs1.png', clip: { x: 0, y: 0, width: 390, height: 300 } });
  console.log('banner before:', await p.isVisible('text=Restore finished'));
  await p.click('text=Dismiss'); await p.waitForTimeout(500);
  console.log('banner after click:', await p.isVisible('text=Restore finished'));
  await p.reload(); await p.waitForTimeout(2000);
  console.log('banner after reload:', await p.isVisible('text=Restore finished'));
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
