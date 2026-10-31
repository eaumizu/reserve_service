const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.BOOKING_TEST_URL || 'http://127.0.0.1:3000';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    let mode = 'menu', ready = true, failSave = true, failRead = false, dateReads = 0;
    const writes = [], errors = [];
    const user = { id: '5877c0b4-11fc-4a92-a647-ac0cde8bb2d7', email: 'owner@example.com', app_metadata: { store_id: '11111111-1111-1111-1111-111111111111', role: 'admin' }, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01T00:00:00Z' };
    const jwt = [{ alg: 'HS256', typ: 'JWT' }, { sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }, {}].map(x => Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
    const json = (r, data, status = 200) => r.fulfill({ status, json: data });
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    await context.route('**/auth/v1/token*', r => r.fulfill({ status: 200, headers, json: { access_token: jwt, refresh_token: 'refresh', expires_in: 3600, token_type: 'bearer', user } }));
    await context.route('**/auth/v1/user*', r => r.fulfill({ status: 200, headers, json: user }));
    await context.route('**/api/**', async r => {
      const path = new URL(r.request().url()).pathname;
      if (path === '/api/booking-mode') return json(r, failRead ? { error: 'unavailable' } : { mode }, failRead ? 503 : 200);
      if (path === '/api/catalog') return json(r, [{ id: 's', name: '確認用メニュー', duration_minutes: 60, price: 7000 }]);
      if (path === '/api/booking-rules') return json(r, { advance_days: 30, cutoff_minutes: 0, minDate: '2030-01-01', maxDate: '2030-01-31' });
      if (path === '/api/date-availability') { dateReads++; return json(r, { slots: [{ serviceId: 's', staffId: 'a', staffName: '担当', startAt: '2030-01-02T01:00:00.000Z' }] }); }
      if (path === '/api/availability') return json(r, { slots: [] });
      if (path === '/api/admin/settings') {
        if (r.request().method() === 'POST') {
          const payload = r.request().postDataJSON(); writes.push(payload);
          assert.equal(payload.kind, 'booking_mode'); assert.deepEqual(Object.keys(payload).sort(), ['data', 'kind']);
          if (failSave) return json(r, { error: '保存できませんでした。' }, 503);
          mode = payload.data.mode; return json(r, { saved: true, id: user.app_metadata.store_id });
        }
        return json(r, { store: { id: user.app_metadata.store_id, name: '確認用店舗', timezone: 'Asia/Tokyo' }, bookingMode: { mode, ready }, bookingRules: { advance_days: 30, cutoff_minutes: 0 }, services: [], staff: [], links: [], hours: [] });
      }
      if (path === '/api/admin/reservations') return json(r, { reservations: [], staff: [], hasMore: false, canManageSettings: true });
      if (path === '/api/admin/booking-options') return json(r, { storeId: user.app_metadata.store_id, services: [], staff: [], links: [] });
      if (path === '/api/admin/calendar') return json(r, { connection: null, pending: 0, failed: 0, platformReady: false });
      if (path === '/api/admin/line-settings') return json(r, { accountName: '', friendUrl: '', channelId: '', hasAccessToken: false, hasChannelSecret: false, version: null, encryptionReady: false });
      if (path === '/api/admin/email-settings') return json(r, { settings: null, platformReady: false, events: { pending: 0, expired: 0, rows: [] } });
      if (path === '/api/admin/store-notifications') return json(r, { recipient: '', enabled: false, senderReady: false, platformReady: false, pending: 0, expired: 0, rows: [] });
      if (path === '/api/admin/reminders') return json(r, { enabled: false, rows: [] });
      return json(r, { error: 'Unmocked test endpoint' }, 404);
    });
    const admin = await context.newPage(), customer = await context.newPage();
    for (const p of [admin, customer]) { p.setDefaultTimeout(20000); p.setDefaultNavigationTimeout(60000); p.on('pageerror', e => errors.push(e.message)); }
    await customer.goto(base + '/?mode=date');
    await customer.getByLabel('ご希望の日', { exact: true }).waitFor();
    assert.equal(await customer.getByRole('button', { name: '日時から選ぶ', exact: true }).count(), 0);
    assert.equal(await customer.getByRole('table', { name: '予約日時の選択', exact: true }).count(), 0); assert.equal(dateReads, 0);
    await customer.getByLabel('お名前', { exact: true }).fill('入力中のお客様');
    await admin.goto(base + '/admin');
    await admin.getByLabel('メールアドレス', { exact: true }).fill('owner@example.com');
    await admin.getByLabel('パスワード', { exact: true }).fill('test-password');
    await admin.getByRole('button', { name: 'ログイン', exact: true }).click();
    await admin.getByRole('button', { name: '店舗設定', exact: true }).click();
    await admin.getByRole('radio', { name: '日時から選ぶ', exact: true }).check();
    assert.equal(mode, 'menu', 'draft must not change the public page');
    const save = admin.getByRole('button', { name: '予約画面の表示方式を保存', exact: true });
    await save.click(); await admin.getByRole('alert').filter({ hasText: '保存できませんでした。' }).waitFor();
    assert.equal(mode, 'menu'); failSave = false; await save.click();
    await admin.getByRole('status').filter({ hasText: '保存しました。' }).waitFor();
    assert.equal(mode, 'date');
    assert.equal(await customer.getByLabel('お名前', { exact: true }).inputValue(), '入力中のお客様', 'owner setting must not interrupt an active customer session');
    await admin.getByRole('button', { name: '設定を再読み込み（未保存の入力は戻ります）', exact: true }).click();
    await admin.getByRole('radio', { name: '日時から選ぶ', exact: true }).waitFor();
    assert.equal(await admin.getByRole('radio', { name: '日時から選ぶ', exact: true }).isChecked(), true);
    await customer.reload();
    await customer.getByRole('table', { name: '予約日時の選択', exact: true }).waitFor();
    await customer.getByRole('button', { name: '2030年1月2日(水) 10:00 予約可能', exact: true }).waitFor();
    assert.equal(await customer.getByRole('combobox', { name: /施術メニュー/ }).count(), 0);
    assert.equal(await customer.getByRole('button', { name: 'メニューから選ぶ', exact: true }).count(), 0);
    assert.equal(await customer.getByLabel('お名前', { exact: true }).count(), 0, 'calendar page begins with dates/times only');
    assert.equal(await customer.getByText('確認用メニュー', { exact: true }).count(), 0, 'menus appear only after choosing a time');
    assert.equal(await customer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.BOOKING_SCREENSHOT_DIR) {
      await customer.screenshot({ path: `${process.env.BOOKING_SCREENSHOT_DIR}/booking-date-home-${width}.png`, fullPage: true });
      await admin.getByRole('heading', { name: '予約画面の表示方式', exact: true }).scrollIntoViewIfNeeded();
      await admin.screenshot({ path: `${process.env.BOOKING_SCREENSHOT_DIR}/booking-mode-admin-${width}.png` });
    }
    await admin.getByRole('radio', { name: 'メニューから選ぶ', exact: true }).check(); await save.click();
    await admin.getByRole('status').filter({ hasText: '保存しました。' }).waitFor(); await customer.reload();
    await customer.getByLabel('ご希望の日', { exact: true }).waitFor();
    assert.equal(await customer.getByRole('table', { name: '予約日時の選択', exact: true }).count(), 0);
    ready = false; await admin.getByRole('button', { name: '設定を再読み込み（未保存の入力は戻ります）', exact: true }).click();
    await admin.getByText('表示方式の保存には、追加のDB設定が必要です。現在はメニューから選ぶ画面を表示します。', { exact: true }).waitFor();
    assert.equal(await save.isDisabled(), true);
    failRead = true; await customer.reload(); await customer.getByRole('button', { name: 'もう一度読み込む', exact: true }).waitFor();
    assert.equal(await customer.getByLabel('ご希望の日', { exact: true }).count(), 0, 'failed configuration cannot display an unintended mode');
    failRead = false; await customer.getByRole('button', { name: 'もう一度読み込む', exact: true }).click(); await customer.getByLabel('ご希望の日', { exact: true }).waitFor();
    assert.equal(writes.length, 3); assert.deepEqual(errors, []);
    console.log(`PASS ${width}px admin save/reload/failure, isolated public modes, active input retention and config retry`);
    await context.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
