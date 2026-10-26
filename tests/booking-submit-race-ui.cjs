const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const width of [1280, 390]) for (const staleResult of ['occupied', 'error']) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    page.setDefaultTimeout(20000);
    await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') });
    const slot = { staffId: 'staff', staffName: '', startAt: '2030-01-02T01:00:00Z' };
    const availabilityStarted = deferred(), releaseAvailability = deferred(), bookingStarted = deferred(), releaseBooking = deferred();
    let holdAvailability = false, committed = false, reads = 0, submissions = 0;
    await page.route('**/api/catalog', r => r.fulfill({ json: [{ id: 'service', name: '整体', duration_minutes: 60, price: 7000 }] }));
    await page.route('**/api/booking-rules', r => r.fulfill({ json: { advance_days: 30, cutoff_minutes: 0, minDate: '2030-01-01', maxDate: '2030-01-31' } }));
    await page.route('**/api/availability?*', async r => {
      reads++;
      if (holdAvailability) {
        holdAvailability = false; availabilityStarted.resolve(); await releaseAvailability.promise;
        if (staleResult === 'error') { await r.fulfill({ status: 503, json: { error: '空き枠を取得できません。' } }); return; }
      }
      await r.fulfill({ json: { slots: committed ? [] : [slot] } });
    });
    await page.route('**/api/reservations', async r => {
      submissions++; committed = true; bookingStarted.resolve();
      // The booking already exists, while email/Google notifications delay the response.
      await releaseBooking.promise;
      await r.fulfill({ status: 201, json: { reservation: { id: 'test-booking' }, managePath: '/reservation#' + 'a'.repeat(64) } });
    });
    await page.goto('http://127.0.0.1:3000/');
    await page.getByLabel('ご希望の日', { exact: true }).fill('2030-01-02');
    await page.getByRole('button', { name: '10:00', exact: true }).click();
    await page.getByLabel('お名前', { exact: true }).fill('競合確認');
    await page.getByLabel('メールアドレス（必須）', { exact: true }).fill('guest@example.com');
    await page.getByRole('button', { name: '確認画面へ', exact: true }).click();
    await page.getByRole('heading', { name: '内容のご確認', exact: true }).waitFor();
    await page.evaluate(() => {
      window.__bookingFlashes = [];
      window.__bookingObserver = new MutationObserver(() => {
        if (document.querySelector('input[type="date"]')) window.__bookingFlashes.push('date-form');
        if (document.querySelector('[role="alert"]')) window.__bookingFlashes.push('error-alert');
      });
      window.__bookingObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    // Start a poll before submission, but make it finish after the booking is saved.
    holdAvailability = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await availabilityStarted.promise;
    await page.getByRole('button', { name: '予約を確定する', exact: true }).click();
    await bookingStarted.promise;
    const staleResponse = page.waitForResponse(r => r.url().includes('/api/availability?'));
    releaseAvailability.resolve(); await staleResponse;
    await page.clock.runFor(100);
    await page.getByRole('heading', { name: '内容のご確認', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '予約を確定中…', exact: true }).isDisabled(), true);
    const before = reads;
    await page.clock.runFor(30000);
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); document.dispatchEvent(new Event('visibilitychange')); });
    await page.clock.runFor(100);
    assert.equal(reads, before, 'poll, focus, pageshow and visibility refresh must pause during submission');
    assert.equal(submissions, 1);
    releaseBooking.resolve();
    await page.getByRole('heading', { name: 'ご予約を承りました', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: '予約を確認・変更・キャンセル', exact: true }).getAttribute('href'), '/reservation#' + 'a'.repeat(64));
    await page.clock.runFor(60000);
    assert.equal(reads, before, 'polling stays stopped after completion');
    assert.deepEqual(await page.evaluate(() => { window.__bookingObserver.disconnect(); return window.__bookingFlashes; }), [], 'never flash the date form or stale availability error');
    console.log(`PASS ${width}px submission race with late ${staleResult} availability response`);
    await page.close();
  }
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
