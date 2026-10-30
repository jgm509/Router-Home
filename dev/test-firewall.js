const { chromium } = require('playwright');
const PORT = process.env.PORT || 8088;
const S = './shots/';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  p.on('pageerror', e => console.log('PAGEERROR', e.message)); p.on('console', m => m.type() === 'error' && console.log('CONSOLE', m.text()));
  const txt = async sel => (await p.textContent(sel)).replace(/\s+/g, ' ');
  const cfg = c => p.evaluate(c => App.uci.load(c), c);
  await p.goto(`http://localhost:${PORT}/home/`); await p.fill('input[name=password]', 'test'); await p.click('button[type=submit]'); await p.waitForTimeout(1500);
  await p.goto(`http://localhost:${PORT}/home/#/network`); await p.waitForTimeout(1200);
  console.log('OVERVIEW', (await txt('main')).slice(-300));
  await p.goto(`http://localhost:${PORT}/home/#/network/lans`); await p.waitForTimeout(1500);
  await p.screenshot({ path: S + 'lans1.png', fullPage: true });
  console.log('LANS', (await txt('main')).slice(0, 300));
  await p.click('button:has-text("Add a network")'); await p.waitForTimeout(800);
  await p.screenshot({ path: S + 'lans-add.png', fullPage: true });
  await p.fill('.sheet input[type=password]', 'guestpass123');
  // move lan4 to guest
  const lan4 = p.locator('.sheet .row:has-text("lan4") input[type=checkbox]'); await lan4.check();
  await p.click('.sheet button:has-text("Create network")'); await p.waitForTimeout(3000);
  console.log('TOAST', await txt('#toast'));
  const net = await cfg('network'), fw = await cfg('firewall'), wl = await cfg('wireless'), dh = await cfg('dhcp');
  console.log('NET', JSON.stringify(Object.values(net).filter(s => s.home_ui_net || s.name === 'br-lan').map(s => [s['.name'], s.type || s.proto, s.ports, s.ipaddr, s.device])));
  console.log('FW', JSON.stringify(Object.values(fw).filter(s => s.home_ui_net || s.src === 'guest' || s.dest === 'guest').map(s => [s['.type'], s.name, s.src, s.dest, s.input, s.dest_port])));
  console.log('WL', JSON.stringify(Object.values(wl).filter(s => s.network === 'guest').map(s => [s['.name'], s.device, s.ssid, s.encryption, s.isolate])));
  console.log('DHCP', JSON.stringify(dh.guest));
  await p.waitForTimeout(500);
  await p.screenshot({ path: S + 'lans2.png', fullPage: true });
  await p.click('.row:has-text("Guest WiFi")'); await p.waitForTimeout(1200);
  await p.screenshot({ path: S + 'lans-manage.png', fullPage: true });
  await p.locator('.sheet .row:has-text("Router settings") input').check();
  await p.click('.sheet button:has-text("Save")'); await p.waitForTimeout(2500);
  const fw2 = await cfg('firewall');
  console.log('AFTER ACCESS', JSON.stringify(Object.values(fw2).filter(s => s.name === 'guest' || s.home_ui_net === 'guest').map(s => [s['.type'], s.name, s.input])));
  // security
  await p.goto(`http://localhost:${PORT}/home/#/network/security`); await p.waitForTimeout(1500);
  await p.screenshot({ path: S + 'sec1.png', fullPage: true });
  console.log('SEC', (await txt('main')).slice(0, 900));
  await p.locator('.row.check:has-text("open the router") button').click(); await p.waitForTimeout(2500);
  console.log('SEC2', (await txt('main')).slice(0, 300));
  // firewall
  await p.goto(`http://localhost:${PORT}/home/#/network/firewall`); await p.waitForTimeout(1500);
  await p.screenshot({ path: S + 'fw1.png', fullPage: true });
  console.log('FWPAGE', (await txt('main')).slice(0, 1200));
  await p.click('a.link:has-text("Add") >> nth=0'); await p.waitForTimeout(800);
  await p.selectOption('.sheet select >> nth=0', { index: 1 }); await p.waitForTimeout(200);
  await p.fill('.sheet input[placeholder="25565 or 8000-8010"]', '8080');
  await p.screenshot({ path: S + 'fw-fwd.png', fullPage: true });
  await p.click('.sheet button:has-text("Add forward")'); await p.waitForTimeout(2500);
  console.log('TOAST2', await txt('#toast'));
  const fw3 = await cfg('firewall'); console.log('REDIR', JSON.stringify(Object.values(fw3).filter(s => s['.type'] === 'redirect')));
  const dh3 = await cfg('dhcp'); console.log('HOSTS', JSON.stringify(Object.values(dh3).filter(s => s['.type'] === 'host')));
  await p.click('button:has-text("Open a port on the router")'); await p.waitForTimeout(800);
  await p.fill('.sheet input[placeholder="51820"]', '22');
  await p.click('.sheet button:has-text("Add rule")'); await p.waitForTimeout(800);
  console.log('CONFIRM', (await txt('.sheet-backdrop:last-child .sheet')).slice(0, 200));
  await p.click('.sheet-backdrop:last-child button:has-text("Open anyway")'); await p.waitForTimeout(2500);
  // zone
  await p.goto(`http://localhost:${PORT}/home/#/network/firewall`); await p.waitForTimeout(1500);
  await p.click('.row:has-text("Internet (wan)")'); await p.waitForTimeout(800);
  await p.screenshot({ path: S + 'fw-zone.png', fullPage: true });
  await p.keyboard.press('Escape');
  // upnp
  await p.locator('.row:has-text("UPnP") input.switch').first().check(); await p.waitForTimeout(3500);
  await p.screenshot({ path: S + 'fw2.png', fullPage: true });
  console.log('UPNP', (await txt('main')).slice(-500));
  await p.goto(`http://localhost:${PORT}/home/#/network/security`); await p.waitForTimeout(1500);
  console.log('SEC3', (await txt('main')).slice(0, 900));
  await p.screenshot({ path: S + 'sec2.png', fullPage: true });
  // delete guest network
  await p.goto(`http://localhost:${PORT}/home/#/network/lans`); await p.waitForTimeout(1500);
  await p.click('.row:has-text("Guest WiFi")'); await p.waitForTimeout(1200);
  await p.click('.sheet button:has-text("Delete network")'); await p.waitForTimeout(500);
  await p.click('.sheet-backdrop:last-child button:has-text("Delete")'); await p.waitForTimeout(2500);
  const n4 = await cfg('network'), f4 = await cfg('firewall'), w4 = await cfg('wireless');
  console.log('LEFT', JSON.stringify(Object.values(n4).filter(s => s.home_ui_net || s.name === 'br-lan').map(s => [s['.name'], s.ports])), Object.values(f4).filter(s => JSON.stringify(s).includes('guest')).length, Object.values(w4).filter(s => s.network === 'guest').length);
  // help sheet
  await p.goto(`http://localhost:${PORT}/home/#/wifi`); await p.waitForTimeout(1500);
  await b.close();
})();
