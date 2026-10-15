const { chromium } = require('playwright');
const PORT = process.env.PORT || 8088;
const B = 'http://localhost:' + PORT + '';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  p.on('dialog', d => d.accept('Living room TV'));
  const uci = async () => (await (await fetch(B + '/debug/uci')).json());
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('STEP FAILED', name, e.message.split('\n')[0]); } };
  await p.goto(B + '/home/'); await p.fill('input[name=password]', 'test'); await p.click('button[type=submit]'); await p.waitForSelector('.lamp-wrap');
  let u;
  await step('device', async () => {
    await p.goto(B + '/home/#/devices'); await p.waitForTimeout(1200);
    await p.click('text=Phone'); await p.waitForTimeout(500);
    await p.fill('.sheet input[placeholder^="For example"]', 'Phone');
    await p.click('.sheet [aria-label="Bedtime schedule"]');
    await p.click('.sheet [aria-label="Always use the same address"]');
    await p.click('.sheet >> text=Save'); await p.waitForTimeout(3000);
    u = await uci();
    console.log('fw rules:', JSON.stringify(Object.values(u.firewall).filter(r => r['.type'] === 'rule').map(r => [r.name, r.start_time, r.stop_time, r.weekdays])));
    console.log('hosts:', JSON.stringify(Object.values(u.dhcp).filter(r => r['.type'] === 'host')));
  });
  await step('unpause', async () => {
    await p.click('text=kids-tablet'); await p.waitForTimeout(500);
    await p.click('.sheet [aria-label="Pause internet now"]'); await p.click('.sheet >> text=Save'); await p.waitForTimeout(3000);
    u = await uci(); console.log('rules after unpause:', Object.values(u.firewall).filter(r => r['.type'] === 'rule').map(r => r.name).join(' | '));
  });
  await step('radio', async () => {
    await p.goto(B + '/home/#/wifi'); await p.waitForTimeout(1200);
    await p.click('text=5 GHz radio'); await p.waitForTimeout(800); await p.click('.sheet >> text=Use this');
    await p.selectOption('.sheet select >> nth=0', '149'); await p.click('.sheet .seg >> text=160');
    await p.click('.sheet >> text=Save'); await p.waitForTimeout(3000);
    u = await uci(); console.log('radio1:', JSON.stringify(u.wireless.radio1));
  });
  await step('wifi pw', async () => {
    await p.click('.group >> text=HomeWiFi'); await p.waitForTimeout(500);
    await p.fill('.sheet input[type=password]', 'new-password-123'); await p.click('.sheet >> text=Save'); await p.waitForTimeout(3000);
    u = await uci(); console.log('ifaces:', JSON.stringify(Object.values(u.wireless).filter(x => x['.type'] === 'wifi-iface').map(x => [x.device, x.encryption, x.key, x.ieee80211w])));
  });
  await step('dns', async () => {
    await p.goto(B + '/home/#/network/dns'); await p.waitForTimeout(1000);
    await p.click('text=Quad9'); await p.click('text=Save'); await p.waitForTimeout(3000);
    u = await uci(); console.log('dnsmasq:', JSON.stringify(u.dhcp.cfg01));
  });
  await step('tz', async () => {
    await p.goto(B + '/home/#/system'); await p.waitForTimeout(1000);
    await p.click('text=Time zone'); await p.waitForTimeout(400); await p.selectOption('.sheet select', 'Europe/Paris'); await p.click('.sheet >> text=Save'); await p.waitForTimeout(3000);
    u = await uci(); console.log('system:', JSON.stringify(u.system.cfg20));
  });
  await step('vpn client', async () => {
    await p.goto(B + '/home/#/network/vpn'); await p.waitForTimeout(1000);
    await p.click('text=Add VPN'); await p.click('text=Connect to a VPN service');
    await p.fill('.sheet textarea', '[Interface]\nPrivateKey = AAA=\nAddress = 10.2.0.2/32, fd00::2/128\nDNS = 10.2.0.1\n\n[Peer]\nPublicKey = BBB=\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = 1.2.3.4:51820\n');
    await p.click('.sheet >> text=Add VPN'); await p.waitForTimeout(3000);
    u = await uci(); console.log('vpn2:', JSON.stringify(u.network.vpn2), JSON.stringify(Object.values(u.network).filter(x => x['.type'] === 'wireguard_vpn2')), 'wan zone:', JSON.stringify(u.firewall.cfg12.network));
  });
  await step('vpn server', async () => {
    await p.click('text=Add VPN'); await p.click('text=Reach home from anywhere'); await p.click('.sheet >> text=Create VPN server'); await p.waitForTimeout(3000);
    u = await uci(); console.log('wghome:', JSON.stringify(u.network.wghome), JSON.stringify(u['home-ui']), 'lan zone', JSON.stringify(u.firewall.cfg11.network));
  });
  await step('peer', async () => {
    await p.goto(B + '/home/#/network/vpn'); await p.waitForTimeout(1500);
    await p.click('text=wghome'); await p.waitForTimeout(800);
    await p.fill('.sheet input[placeholder^="Your public"]', 'home.example.net'); await p.click('.sheet >> text=Save address'); await p.waitForTimeout(2500);
    await p.click('.sheet >> text=Add a device'); await p.waitForTimeout(3500);
    await p.screenshot({ path: 'shots/func-peer.png' });
    u = await uci(); console.log('peers:', JSON.stringify(Object.values(u.network).filter(x => x['.type'] === 'wireguard_wghome')), JSON.stringify(u['home-ui']));
  });
  await step('modem conn', async () => {
    await p.goto(B + '/home/#/network'); await p.waitForTimeout(1000);
    await p.click('text=Add connection'); await p.waitForTimeout(800); await p.click('.sheet >> text=Mobile modem'); await p.fill('.sheet input', 'internet.com');
    await p.click('.sheet >> text=Add modem connection'); await p.waitForTimeout(3000);
    u = await uci(); console.log('wwan2:', JSON.stringify(u.network.wwan2));
  });
  console.log('errors:', errs.join('\n') || 'none');
  await b.close();
})();
