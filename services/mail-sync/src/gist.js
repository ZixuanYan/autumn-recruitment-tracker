'use strict';
// ============================================================================
// gist.js — 只读回 / 只写 mail-suggestions.json 这一个文件
// 不变量①⑥：Action 永不读写 vault-*.json；PATCH body 只含本文件 →
// GitHub Gist 的 PATCH 是按文件合并的，只提交一个文件不会动其他文件（vault 哈希不变）。
// fetchImpl 可注入，便于本地用假 fetch 单测「按文件 PATCH 不覆盖 vault」。
// ============================================================================

const GITHUB_API_VERSION = '2022-11-28';
const { encryptJson, decryptJson, isEncryptedPayload } = require('./crypto');

function headers(cfg, withBody) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    Authorization: `Bearer ${cfg.gist.token}`,
    ...(withBody ? { 'Content-Type': 'application/json' } : {})
  };
}

// GET /gists/{id}；404 返回 null（首次运行 Gist 可能还没有该文件，但 Gist 本体应已存在）
async function gistGet(cfg, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  const res = await doFetch(`${cfg.gist.apiBase}/gists/${encodeURIComponent(cfg.gist.id)}`, {
    method: 'GET',
    headers: headers(cfg, false)
  });
  if (res.status === 404) return null;
  if (res.status === 401) throw new Error('GIST_PAT 无效或已过期，请重新生成（需 gist 权限）');
  if (res.status === 403) throw new Error('GitHub 拒绝请求或触发限流，请确认 GIST_PAT 已勾选 gist 权限');
  if (!res.ok) throw new Error(`读取 Gist 失败（HTTP ${res.status}）`);
  return res.json();
}

// 从 Gist 响应里取出文件并解析；支持加密信封（有 encKey 则解密）；缺失/损坏/无法解密静默返回 null。
// 也用于读明文的 mail-config.json（不传 encKey 即可）。
async function readMailFile(gist, filename, encKey) {
  const file = gist && gist.files && gist.files[filename];
  const content = file && (file.content != null ? file.content : '');
  if (!content || !String(content).trim()) return null;
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return null;
    if (isEncryptedPayload(parsed)) {
      if (!encKey) return null; // 加密但无密钥：无法读取（水位将从头开始）
      return await decryptJson(parsed, encKey);
    }
    return parsed;
  } catch (_) {
    return null; // 损坏或解密失败：静默跳过，按空状态处理
  }
}

// PATCH 只写 mail-suggestions.json 一个文件（永不触碰 vault）；配了 MAIL_ENC_KEY 则加密存储
async function patchMailFile(cfg, payloadObj, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  const content = cfg.mailEncKey
    ? JSON.stringify(await encryptJson(payloadObj, cfg.mailEncKey))
    : JSON.stringify(payloadObj, null, 2);
  const body = JSON.stringify({
    files: { [cfg.gist.filename]: { content } }
  });
  const res = await doFetch(`${cfg.gist.apiBase}/gists/${encodeURIComponent(cfg.gist.id)}`, {
    method: 'PATCH',
    headers: headers(cfg, true),
    body
  });
  if (res.status === 401) throw new Error('GIST_PAT 无效或已过期，请重新生成（需 gist 权限）');
  if (res.status === 403) throw new Error('GitHub 拒绝写入或触发限流，请确认 GIST_PAT 已勾选 gist 权限');
  if (res.status === 404) throw new Error('GIST_ID 不存在，请确认 Secrets 里的 GIST_ID 与网页「工具→云同步」用的是同一个 Gist');
  if (!res.ok) {
    let detail = '';
    try { const e = await res.json(); detail = e && e.message ? `：${e.message}` : ''; } catch (_) {}
    throw new Error(`写入 Gist 失败（HTTP ${res.status}）${detail}`);
  }
  return res.json().catch(() => null);
}

module.exports = { gistGet, readMailFile, patchMailFile, GITHUB_API_VERSION };
