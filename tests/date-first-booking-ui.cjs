const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.BOOKING_TEST_URL || 'http://127.0.0.1:3000';
const short = { id: 'short', name: '基本整体', duration_minutes: 30, price: 3000 };
const long = { id: 'long', name: 'じっくり整体', duration_minutes: 90, price: 8000 };
const at = (day, clock) => new Date(`2030-01-${day}T${clock}:00+09:00`).toISOString();
const slot = (serviceId, staffId, clock) => ({ serviceId, staffId, staffName: `担当${staffId}`, startAt: at('02', clock) });
const available = [slot('short', 'A', '10:00'), slot('short', 'A', '10:15'), slot('short', 'A', '10:30'), slot('short', 'A', '11:00'), slot('long', 'A', '11:00'), slot('long', 'B', '11:00')];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function setup(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(60000);
  await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') });
  await page.route('**/api/booking-mode', r => r.fulfill({ json: { mode: 'date' } }));
  await page.route('**/api/catalog', r => r.fulfill({ json: [short, long] }));
  await page.route('**/api/booking-rules', r => r.fulfill({ json: { advance_days: 8, cutoff_minutes: 0, minDate: '2030-01-01', maxDate: '2030-01-09' } }));
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  return { page, errors };
}
const cell = (page, time) => page.getByRole('button', { name: `2030年1月2日(水) ${time} 予約可能`, exact: true });
async function pick(page, time, menu, staff) {
  await cell(page, time).click();
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
      await page.route('**/api/date-availability?*', r => { reads++; const day = new URL(r.request().url()).searchParams.get('date'); return r.fulfill({ json: { times: ['10:00', '10:15', '10:30', '11:00'], slots: day === '2030-01-02' ? available : [] } }); });
      await page.route('**/api/availability?*', r => { singleReads++; const id = new URL(r.request().url()).searchParams.get('serviceId'); return r.fulfill({ json: { slots: available.filter(s => s.serviceId === id) } }); });
      await page.route('**/api/reservations', async r => {
        attempts++;
        if (attempts === 1) return r.fulfill({ status: 409, json: { error: 'その時間は受付できません。空き枠を選び直してください。' } });
        posted = r.request().postDataJSON();
        return r.fulfill({ status: 201, json: { reservation: { id: 'test' }, managePath: '/reservation#' + 'a'.repeat(64) } });
      });
      await page.goto(base);
      assert.equal(await page.getByRole('button', { name: '日時から選ぶ', exact: true }).count(), 0);
      await cell(page, '10:00').waitFor();
      assert.equal(await page.getByRole('button', { name: '前の週', exact: true }).isDisabled(), true);
      await page.getByRole('button', { name: '次の週', exact: true }).click();
      await page.getByRole('columnheader', { name: '2030年1月8日(火)', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '次の週', exact: true }).isDisabled(), true);
      await page.getByRole('button', { name: '前の週', exact: true }).click();
      await cell(page, '10:00').click();
      assert.equal(await page.getByRole('rowheader', {name:'10:15',exact:true}).count(),0,'quarter-hour rows stay hidden even with old API responses');
      assert.equal(await page.getByRole('button',{name:/10:15 予約可能$/}).count(),0);
      await cell(page,'10:30').waitFor();
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
      await cell(page, '11:00').click();
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
      await page.route('**/api/date-availability?*', r => { reads++; return r.fulfill(failed ? { status: 503, json: { error: '空き枠を取得できません。' } } : { json: { times: ['10:00', '10:15', '10:30', '11:00'], slots: occupied ? [] : available } }); });
      await page.goto(base); assert.equal(await page.getByRole('button', { name: '日時から選ぶ', exact: true }).count(), 0);
      await cell(page, '10:00').click(); await page.getByRole('button', { name: /基本整体/ }).click();
      occupied = true; await page.clock.runFor(60000);
      await page.getByRole('alert').filter({ hasText: '選択した時間は受付できなくなりました。' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'この内容でお客様情報へ', exact: true }).count(), 0);
      failed = true; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.getByRole('button', { name: 'もう一度確認する', exact: true }).waitFor();
      assert.equal(await cell(page, '10:00').count(), 0);
      failed = false; occupied = false; await page.getByRole('button', { name: 'もう一度確認する', exact: true }).click();
      await cell(page, '10:00').waitFor();
      assert.equal(await page.getByRole('button', { name: 'メニューから選ぶ', exact: true }).count(), 0);
      assert.equal(await page.getByRole('combobox', { name: /施術メニュー/ }).count(), 0, 'menu-first controls never appear on the calendar page');
      assert.deepEqual(errors, []); await page.close();
      console.log(`PASS ${width}px calendar refresh, lost slot, failure/retry and isolated calendar page`);
    }
    {
      const { page, errors } = await setup(browser, width);
      const started = deferred(), release = deferred();
      await page.route('**/api/date-availability?*', async r => {
        if (new URL(r.request().url()).searchParams.get('date') === '2030-01-02') { started.resolve(); await release.promise; return r.fulfill({ json: { times: ['10:00', '10:15', '10:30', '11:00'], slots: available } }).catch(() => {}); }
        return r.fulfill({ json: { times: ['10:00', '10:15', '10:30', '11:00'], slots: [] } });
      });
      await page.goto(base); assert.equal(await page.getByRole('button', { name: '日時から選ぶ', exact: true }).count(), 0);
      await started.promise;
      await page.getByRole('button', { name: '次の週', exact: true }).click(); release.resolve();
      await page.getByText('この週に受付できる空き枠はありません。別の週を選択してください。', { exact: true }).waitFor();
      assert.equal(await cell(page, '10:00').count(), 0, 'late response cannot populate a different date');
      assert.deepEqual(errors, []); await page.close();
      console.log(`PASS ${width}px stale date response isolation`);
    }
    {
      const { page, errors } = await setup(browser, width);
      let submissions = 0;
      await page.route('**/api/date-availability?*', r => r.fulfill({ json: { times: ['10:00', '10:15', '10:30', '11:00'], slots: available } }));
      // The earlier calendar snapshot was valid, but the chosen staff is now busy.
      await page.route('**/api/availability?*', r => r.fulfill({ json: { times: ['10:00', '10:15', '10:30', '11:00'], slots: [] } }));
      await page.route('**/api/reservations', r => { submissions++; return r.fulfill({ status: 500, json: {} }); });
      await page.goto(base); assert.equal(await page.getByRole('button', { name: '日時から選ぶ', exact: true }).count(), 0);
      await pick(page, '10:00', '基本整体');
      await page.getByRole('alert').filter({ hasText: '選択した時間は受付できなくなりました。' }).waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), '選択した日時・メニュー', 'keyboard focus follows the new step');
      await page.getByLabel('お名前', { exact: true }).fill('再確認');
      await page.getByLabel('メールアドレス（必須）', { exact: true }).fill('guest@example.com');
      assert.equal(await page.getByRole('button', { name: '確認画面へ', exact: true }).isDisabled(), true);
      assert.equal(submissions, 0); assert.deepEqual(errors, []); await page.close();
      console.log(`PASS ${width}px revalidation blocks a stale calendar selection before submission`);
    }
    {
      const { page, errors } = await setup(browser, width);
      const gate = deferred(), started = deferred();
      const requests = []; let active = 0, maxActive = 0;
      await page.route('**/api/booking-rules', r => r.fulfill({ json: { advance_days: 8, cutoff_minutes: 0, minDate: '2030-01-29', maxDate: '2030-02-06' } }));
      await page.route('**/api/date-availability?*', async r => {
        const day = new URL(r.request().url()).searchParams.get('date'); requests.push(day);
        active++; maxActive = Math.max(maxActive, active); if (requests.length === 2) started.resolve();
        await gate.promise;
        // Mark the response issued before Playwright waits for its acknowledgement;
        // the client can already start its next request during that acknowledgement.
        active--;
        if (day === '2030-01-31') return await r.fulfill({ status: 503, json: { error: 'Unavailable' } });
        return await r.fulfill({ json: { times: ['10:00', '10:15', '10:30', '11:00'], slots: ['10:00', '10:15', '11:00'].map(time => ({ serviceId: 'short', staffId: 'A', staffName: '担当A', startAt: new Date(`${day}T${time}:00+09:00`).toISOString() })) } });
      });
      await page.goto(base); await started.promise;
      assert.equal(requests.length, 2, 'only two daily checks may be in flight');
      assert.equal(await page.getByRole('button', { name: /予約可能$/ }).count(), 0, 'unverified cells never show circles');
      gate.resolve();
      await page.getByRole('button', { name: '2030年2月4日(月) 10:00 予約可能', exact: true }).waitFor();
      assert.equal(maxActive, 2); assert.equal(requests.length, 7);
      await page.getByText('2030年1月〜2030年2月', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: /^2030年1月31日.*予約可能$/ }).count(), 0);
      assert.equal(await page.getByLabel('2030年1月31日(木) 10:00 確認できません', { exact: true }).isVisible(), true);
      assert.equal(await page.getByLabel('2030年2月1日(金) 10:30 受付不可', { exact: true }).isVisible(), true);
      const keyboard = page.getByRole('button', { name: '2030年2月1日(金) 10:00 予約可能', exact: true });
      await keyboard.focus(); await keyboard.press('Enter');
      await page.getByRole('button', { name: /基本整体/ }).waitFor();
      await page.getByRole('button', { name: '次の週', exact: true }).click();
      await page.getByRole('button', { name: '2030年2月6日(水) 10:00 予約可能', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '次の週', exact: true }).isDisabled(), true);
      assert.equal(requests.length, 9); assert.equal(requests.some(d => d > '2030-02-06'), false);
      assert.equal(await page.getByLabel('2030年2月7日(木) 10:00 受付期間外', { exact: true }).isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []); await page.close();
      console.log(`PASS ${width}px month boundary, bounded checks, partial failure, keyboard and last-week limits`);
    }
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
