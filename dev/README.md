# Development tools

- `mock-router.js`: simulates an OpenWrt router (ubus JSON-RPC, uploads, backups, add-ons, Proton VPN) with made-up data.
  `node mock-router.js <path to home-ui/files/www> [port] [board]`, then open http://localhost:PORT/home/ (password `test`).
  `GET /debug/uci` shows the simulated settings after you save something.
  Environment switches: `LIGHT=generic` (automatic status light), `SIMPLE_MODEM=1` (modem from an add-on),
  `RESTORE=1` or `RESTORE=done` (restore banner), `PV_SESSION=active` (signed in to Proton).
- `test-*.js`: Playwright scripts (`npm i playwright`) that click through the pages and report script errors.
  Start the mock router first, then `PORT=8088 node test-addons.js` (screenshots go to `shots/`).
- `../home-ui/addons/pack.sh`: packs the add-ons into the catalog that ships with Router Home.
