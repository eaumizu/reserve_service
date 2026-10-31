const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.BOOKING_TEST_URL || 'http://127.0.0.1:3000';
const short = { id: 'short', name: '基本整体', duration_minutes: 30, price: 3000 };
const long = { id: 'long', name: 'じっくり整体', duration_minutes: 90, price: 8000 };
const at = (day, clock) => new Date(`2030-01-${day}T${clock}:00+09:00`).toISOString();
const slot = (serviceId, staffId, clock) => ({ serviceId, staffId, staffName: `担当${staffId}`, startAt: at('02', clock) });
const available = [slot('short', 'A', '10:00'), slot('short', 'A', '11:00'), slot('long', 'A', '11:00'), slot('long', 'B', '11:00')];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function setup(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(60000);
  await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') });
  await page.route('**/api/catalog', r => r.fulfill({ json: [short, long] }));
  await page.route('**/api/booking-rules', r => r.fulfill({ json: { advance_days: 8, cutoff_minutes: 0, minDate: '2030-01-01', maxDate: '2030-01-09' } }));
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  return { page, errors };
}
async function pick(page, time, menu, staff) {
  await page.getByRole('button', { name: time, exact: true }).click();
  await page.getByRole('button', { name: new RegExp(menu) }).click();
  if (staff) await page.getByLabel('担当者', { exact: true }).selectOption(staff);
  await page.getByRole('button', { name: 'この内容でお客様情報へ', exact: true }).click();
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  for (const width of [1280, 390]) {
    {
      const { page, errors } = await setup(browser, width);
      let reads = 0, singleReads = 0, attempts = 0, posted;
      await page.route('**/api/date-availability?*', r => { reads++; const day = new URL(r.request().url()).searchParams.get('date'); return r.fulfill({ json: { slots: day === '2030-01-02' ? available : [] } }); });
      await page.route('**/api/availability?*', r => { singleReads++; const id = new URL(r.request().url()).searchParams.get('serviceId'); return r.fulfill({ json: { slots: available.filter(s => s.serviceId === id) } }); });
      await page.route('**/api/reservations', async r => {
        attempts++;
        if (attempts === 1) return r.fulfill({ status: 409, json: { error: 'その時間は受付できません。空き枠を選び直してください。' } });
        posted = r.request().postDataJSON();
        return r.fulfill({ status: 201, json: { reservation: { id: 'test' }, managePath: '/reservation#' + 'a'.repeat(64) } });
      });
      await page.goto(base);
      await page.getByRole('button', { name: '日時から選ぶ', exact: true }).click();
      await page.getByText('この日に受付できる空き枠はありません。別の日付を選択してください。', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '前の7日間', exact: true }).isDisabled(), true);
      await page.getByRole('button', { name: '次の7日間', exact: true }).click();
      await page.getByRole('heading', { name: '1月8日(火)の空き時間', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '次の7日間', exact: true }).isDisabled(), true);
      await page.getByLabel('日付を指定する', { exact: true }).fill('2030-01-02');
      await page.getByRole('button', { name: '10:00', exact: true }).click();
      assert.equal(singleReads, 0, 'calendar bulk read replaces per-menu requests');
      assert.equal(await page.getByRole('button', { name: /じっくり整体/ }).count(), 0, 'long menu cannot fit this start');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.BOOKING_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.BOOKING_SCREENSHOT_DIR}/date-calendar-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: /基本整体/ }).click();
      await page.getByRole('button', { name: 'この内容でお客様情報へ', exact: true }).click();
      await page.getByLabel('お名前', { exact: true }).fill('日時予約テスト');
      const confirm = page.getByRole('button', { name: '確認画面へ', exact: true });
      assert.equal(await confirm.isDisabled(), true);
      await page.getByLabel('メールアドレス（必須）', { exact: true }).fill('guest@example.com');
      await page.getByRole('button', { name: '日時・メニューを選び直す', exact: true }).click();
      await page.getByRole('button', { name: '11:00', exact: true }).click();
      await page.getByRole('button', { name: /じっくり整体/ }).click();
      assert.equal(await page.getByRole('button', { name: 'この内容でお客様情報へ', exact: true }).isDisabled(), true, 'must select an eligible staff');
      await page.getByLabel('担当者', { exact: true }).selectOption('B');
      await page.getByRole('button', { name: 'この内容でお客様情報へ', exact: true }).click();
      assert.equal(await page.getByLabel('お名前', { exact: true }).inputValue(), '日時予約テスト');
      assert.equal(await page.getByLabel('メールアドレス（必須）', { exact: true }).inputValue(), 'guest@example.com');
      await confirm.click();
      await page.getByRole('button', { name: '予約を確定する', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'その時間は受付できません。' }).waitFor();
      assert.equal(await confirm.isDisabled(), true); assert.equal(posted, undefined);
      await page.getByRole('button', { name: '日時・メニューを選び直す', exact: true }).click();
      await pick(page, '11:00', 'じっくり整体', 'B');
      await confirm.click();
      await page.getByRole('button', { name: '予約を確定する', exact: true }).click();
      await page.getByRole('heading', { name: 'ご予約を承りました', exact: true }).waitFor();
      assert.equal(posted.serviceId, 'long'); assert.equal(posted.staffId, 'B'); assert.equal(posted.startAt, at('02', '11:00'));
      assert.equal(posted.customerEmail, 'guest@example.com'); assert.equal(posted.customerPhone, ''); assert.equal(posted.source, 'web');
      const before = reads + singleReads; await page.clock.runFor(60000);
      assert.equal(reads + singleReads, before, 'no calendar or availability polling after completion'); assert.equal(attempts, 2);
      assert.deepEqual(errors, []); await page.close();
      console.log(`PASS ${width}px calendar → eligible menu/staff → existing confirmation/409/retry/success`);
    }
    {
      const { page, errors } = await setup(browser, width);
      let failed = false, occupied = false, reads = 0;
      await page.route('**/api/date-availability?*', r => { reads++; return r.fulfill(failed ? { status: 503, json: { error: '空き枠を取得できません。' } } : { json: { slots: occupied ? [] : available } }); });
      await page.goto(base); await page.getByRole('button', { name: '日時から選ぶ', exact: true }).click();
      await page.getByRole('button', { name: '10:00', exact: true }).click(); await page.getByRole('button', { name: /基本整体/ }).click();
      occupied = true; await page.clock.runFor(30000);
      await page.getByRole('alert').filter({ hasText: '選択した時間は受付できなくなりました。' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'この内容でお客様情報へ', exact: true }).count(), 0);
      failed = true; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.getByRole('button', { name: 'もう一度確認する', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '10:00', exact: true }).count(), 0);
      failed = false; occupied = false; await page.getByRole('button', { name: 'もう一度確認する', exact: true }).click();
      await page.getByRole('button', { name: '10:00', exact: true }).waitFor();
      await page.getByRole('button', { name: 'メニューから選ぶ', exact: true }).click();
      await page.getByRole('combobox', { name: /施術メニュー/ }).waitFor();
      const before = reads; await page.clock.runFor(60000); assert.equal(reads, before, 'calendar stops when menu mode is selected');
      assert.deepEqual(errors, []); await page.close();
      console.log(`PASS ${width}px calendar refresh, lost slot, failure/retry and original menu entry`);
    }
    {
      const { page, errors } = await setup(browser, width);
      const started = deferred(), release = deferred();
      await page.route('**/api/date-availability?*', async r => {
        if (new URL(r.request().url()).searchParams.get('date') === '2030-01-02') { started.resolve(); await release.promise; return r.fulfill({ json: { slots: available } }).catch(() => {}); }
        return r.fulfill({ json: { slots: [] } });
      });
      await page.goto(base); await page.getByRole('button', { name: '日時から選ぶ', exact: true }).click();
      await page.getByLabel('日付を指定する', { exact: true }).fill('2030-01-02'); await started.promise;
      await page.getByLabel('日付を指定する', { exact: true }).fill('2030-01-03'); release.resolve();
      await page.getByText('この日に受付できる空き枠はありません。別の日付を選択してください。', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '10:00', exact: true }).count(), 0, 'late response cannot populate a different date');
      assert.deepEqual(errors, []); await page.close();
      console.log(`PASS ${width}px stale date response isolation`);
    }
    {
      const { page, errors } = await setup(browser, width);
      let submissions = 0;
      await page.route('**/api/date-availability?*', r => r.fulfill({ json: { slots: available } }));
      // The earlier calendar snapshot was valid, but the chosen staff is now busy.
      await page.route('**/api/availability?*', r => r.fulfill({ json: { slots: [] } }));
      await page.route('**/api/reservations', r => { submissions++; return r.fulfill({ status: 500, json: {} }); });
      await page.goto(base); await page.getByRole('button', { name: '日時から選ぶ', exact: true }).click();
      await page.getByLabel('日付を指定する', { exact: true }).fill('2030-01-02');
      await pick(page, '10:00', '基本整体');
      await page.getByRole('alert').filter({ hasText: '選択した時間は受付できなくなりました。' }).waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), '選択した日時・メニュー', 'keyboard focus follows the new step');
      await page.getByLabel('お名前', { exact: true }).fill('再確認');
      await page.getByLabel('メールアドレス（必須）', { exact: true }).fill('guest@example.com');
      assert.equal(await page.getByRole('button', { name: '確認画面へ', exact: true }).isDisabled(), true);
      assert.equal(submissions, 0); assert.deepEqual(errors, []); await page.close();
      console.log(`PASS ${width}px revalidation blocks a stale calendar selection before submission`);
    }
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
