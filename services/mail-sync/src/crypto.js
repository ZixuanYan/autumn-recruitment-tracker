'use strict';
// ============================================================================
// crypto.js — 与网页端 index.html 的 encryptSyncText/decryptSyncText 逐字节兼容
// 格式：{ v:1, enc:'AES-GCM-PBKDF2', salt:b64(16), iv:b64(12), data:b64(密文+GCM tag) }
// 派生：PBKDF2(SHA-256, 120000 次, AES-GCM 256)。Node 20 的 webcrypto 与浏览器一致，
//       因此 Action 端用 MAIL_ENC_KEY 加密后，网页端用同一把 key 的 decryptSyncText 可直接解密。
// 不变量③：MAIL_ENC_KEY 只在私有仓库 Secrets（Action 侧）与用户本机 localStorage（网页侧），永不进 Gist。
// ============================================================================

const subtle = (globalThis.crypto && globalThis.crypto.subtle) || require('crypto').webcrypto.subtle;
const getRandomValues = (arr) => (globalThis.crypto && globalThis.crypto.getRandomValues)
  ? globalThis.crypto.getRandomValues(arr)
  : require('crypto').webcrypto.getRandomValues(arr);

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}
function base64ToBytes(b64) {
  return new Uint8Array(Buffer.from(String(b64), 'base64'));
}

async function deriveKey(passphrase, salt) {
  const material = await subtle.importKey('raw', new TextEncoder().encode(String(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// 判定一个已解析对象是否是加密信封（与网页 parseSyncPayload 的判据一致）
function isEncryptedPayload(obj) {
  return Boolean(obj && typeof obj === 'object' && obj.enc && obj.data && obj.salt && obj.iv);
}

// 加密任意可 JSON 序列化对象 → 信封对象
async function encryptJson(obj, key) {
  const salt = getRandomValues(new Uint8Array(16));
  const iv = getRandomValues(new Uint8Array(12));
  const cryptoKey = await deriveKey(key, salt);
  const cipher = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(JSON.stringify(obj))));
  return { v: 1, enc: 'AES-GCM-PBKDF2', salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(cipher) };
}

// 解密信封对象 → 原对象
async function decryptJson(payload, key) {
  const cryptoKey = await deriveKey(key, base64ToBytes(payload.salt));
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(payload.iv) }, cryptoKey, base64ToBytes(payload.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

module.exports = { encryptJson, decryptJson, isEncryptedPayload, bytesToBase64, base64ToBytes };
