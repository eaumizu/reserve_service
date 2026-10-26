const assert = require('node:assert/strict');
(async () => {
  const response = await fetch('http://127.0.0.1:3016', { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.slots, ['2030-01-02T00:00:00.000Z', '2030-01-02T02:00:00.000Z'], 'Google busy 10:00-11:00 must close overlapping starts');
  assert.equal(result.mailOK, true); assert.equal(result.lineOK, true); assert.equal(result.redirectRejected, true);
  for (const host of ['oauth2.googleapis.com', 'www.googleapis.com', 'api.resend.com', 'api.line.me']) {
    const requests = result.requests.filter(request => request.host === host);
    assert.equal(requests.length, 1, host);
    assert.ok(requests.every(request => request.mode === 'manual'), host + ' uses a supported, non-following redirect mode');
  }
  assert.equal(result.requests.some(request => request.host === 'untrusted.example'), false, 'never follow a provider redirect');
  console.log('PASS native Workers Request validation, Google token/calendar/availability, mail/LINE transport and redirect rejection');
})().catch(error => { console.error(error); process.exit(1); });
