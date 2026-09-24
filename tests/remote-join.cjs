const { chromium } = require('playwright');

(async () => {
  const room = process.env.ROOM_ID;
  if (!room || !/^[A-Za-z0-9_-]{4,80}$/.test(room)) throw new Error('ROOM_ID missing or invalid');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`https://parrrm.github.io/rhyme-match-game/?room=${encodeURIComponent(room)}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#inputPlayerName').fill('WAN QC');
  await page.locator('#btnJoinInit').click();
  const start = Date.now();
  let last = '';
  while (Date.now() - start < 30000) {
    const snapshot = await page.evaluate(() => ({
      status: document.querySelector('#connectionStatus')?.textContent || '',
      lobby: document.querySelector('#lobbyView')?.classList.contains('active'),
      roster: document.querySelector('#playerRoster')?.textContent?.trim() || '',
      count: document.querySelector('#playerCount')?.textContent?.trim() || '',
      message: document.querySelector('#lobbyStatusMessage')?.textContent?.trim() || '',
      peerId: typeof peer !== 'undefined' ? peer?.id : undefined,
      signalDisconnected: typeof peer !== 'undefined' ? peer?.disconnected : undefined,
      dataOpen: typeof hostConn !== 'undefined' ? hostConn?.open : undefined,
      ice: typeof hostConn !== 'undefined' ? hostConn?.peerConnection?.iceConnectionState : undefined,
      connection: typeof hostConn !== 'undefined' ? hostConn?.peerConnection?.connectionState : undefined,
    }));
    const line = JSON.stringify(snapshot);
    if (line !== last) { console.log(`${Date.now() - start}ms ${line}`); last = line; }
    if (snapshot.roster.includes('WAN QC') && snapshot.dataOpen) {
      console.log('RESULT: joined canonical host roster');
      await browser.close();
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  console.error('RESULT: remote join did not converge');
  if (errors.length) console.error('Browser errors:', errors.slice(0, 10));
  await browser.close();
  process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
