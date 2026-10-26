// Test-only worker. No production credentials or external network requests.
import { decryptLineCredential, encryptLineCredential } from "../../lib/line-settings-secret";
import { validLineSignature } from "../../lib/line-webhook";
import { createHash } from "node:crypto";
const worker = {
  async fetch(request: Request) {
    const { cipher, signature } = await request.json() as { cipher: string; signature: string };
    const plaintext = decryptLineCredential("test-store", cipher);
    let otherStoreRejected = false;
    try { decryptLineCredential("other-store", cipher); } catch { otherStoreRejected = true; }
    return Response.json({
      plaintext,
      cipher: encryptLineCredential("test-store", plaintext),
      otherStoreRejected,
      validSignature: validLineSignature("test-body", signature, "test-channel-secret"),
      pkce: createHash("sha256").update("test-verifier").digest("base64url"),
    });
  },
};
export default worker;
