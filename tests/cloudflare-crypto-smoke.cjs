const assert = require('node:assert/strict');
const { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes } = require('node:crypto');
(async () => {
  const key = Buffer.from('a'.repeat(64), 'hex'); // Public test key, never production.
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('test-store'));
  const encrypted = Buffer.concat([cipher.update('test-refresh-token', 'utf8'), cipher.final()]);
  const serialized = [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
  const response = await fetch('http://127.0.0.1:3014', {
    method: 'POST', body: JSON.stringify({ cipher: serialized, signature: createHmac('sha256', 'test-channel-secret').update('test-body').digest('base64') }),
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.plaintext, 'test-refresh-token', 'Workers must decrypt Node ciphertext');
  assert.equal(result.otherStoreRejected, true, 'tenant AAD remains enforced');
  assert.equal(result.validSignature, true, 'LINE HMAC and timing-safe comparison remain compatible');
  assert.equal(result.pkce, createHash('sha256').update('test-verifier').digest('base64url'));
  const [workerIv, tag, data] = result.cipher.split('.').map(value => Buffer.from(value, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, workerIv);
  decipher.setAAD(Buffer.from('test-store')); decipher.setAuthTag(tag);
  assert.equal(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'), 'test-refresh-token', 'Node must decrypt Workers ciphertext');
  console.log('PASS Node/Workers AES-GCM interoperability, store isolation, LINE signatures and Google PKCE');
})().catch(error => { console.error(error); process.exit(1); });
