// Read-only checks. No bookings, messages, calendar changes or DB writes.
const assert = require('node:assert/strict');
const base = process.env.CF_SMOKE_BASE_URL || 'http://127.0.0.1:3013';
async function request(path) {
  return fetch(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(20000) });
}
(async () => {
  for (const path of ['/admin', '/reservation']) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/);
  }
  const verification = await request('/google3eeb3873310908b2.html');
  assert.equal(verification.status, 200, 'verification file must not redirect');
  assert.equal((await verification.text()).trim(), 'google-site-verification: google3eeb3873310908b2.html');
  for (const path of ['/api/admin/settings', '/api/cron/reminders']) {
    const response = await request(path);
    assert.equal(response.status, 401, path + ' must remain protected');
    assert.match(response.headers.get('cache-control') || '', /no-store/);
  }
  const invalidBooking = await fetch(new URL('/api/customer-booking', base), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'view' }),
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(invalidBooking.status, 404, 'missing customer token must fail');
  console.log('PASS Workers pages, static verification, protected admin/cron and customer token validation');
})().catch(error => { console.error(error); process.exit(1); });
