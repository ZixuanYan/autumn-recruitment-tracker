'use strict';
// ============================================================================
// connectivity-test.js — 阶段 M0：连通性去风险闸门（只读，不下载正文，不写任何文件）
// 目的：验证最脆弱的假设——QQ 授权码能否从 GitHub-hosted runner（境外 IP）经 IMAP 登录。
// 手动触发：.github/workflows/connectivity-test.yml（workflow_dispatch）。
//
// 成功：日志出现「登录成功 + INBOX 邮件数 + 最近 3 封主题」→ 退出码 0 → 进 M1。
// 失败：退出码 1（workflow 标红）。若为 Unsafe Login/异地登录 → 转国内宿主或退回手动导入。
// ============================================================================

const { ImapFlow } = require('imapflow');
const { buildConfig } = require('./config');

function maskEmail(addr) {
  const s = String(addr || '');
  const at = s.indexOf('@');
  if (at <= 1) return s ? `${s[0]}***` : '(空)';
  return `${s.slice(0, 2)}***${s.slice(at)}`;
}

async function main() {
  const cfg = buildConfig();
  if (!cfg.imap.user || !cfg.imap.pass) {
    console.error('[M0] ❌ 缺少 Secrets：QQ_EMAIL / QQ_AUTHCODE 未配置。');
    console.error('[M0]    请在私有仓库 Settings → Secrets and variables → Actions 配置后重跑。');
    process.exitCode = 2;
    return;
  }

  console.log(`[M0] 目标服务器：${cfg.imap.host}:${cfg.imap.port}（TLS）`);
  console.log(`[M0] 登录账号：${maskEmail(cfg.imap.user)}`);
  console.log('[M0] 正在建立连接并登录（clientInfo 会触发 RFC2971 ID 命令以规避 QQ "Unsafe Login"）…');

  const client = new ImapFlow({
    host: cfg.imap.host,
    port: cfg.imap.port,
    secure: true, // 直接走 TLS（993）
    auth: { user: cfg.imap.user, pass: cfg.imap.pass },
    clientInfo: cfg.imap.clientInfo, // 关键：发送 ID 命令
    logger: false,
    connectionTimeout: 30000,
    greetingTimeout: 20000,
    socketTimeout: 60000
  });

  let lock = null;
  try {
    await client.connect();
    console.log('[M0] ✅ 登录成功（IMAP 认证通过）');

    lock = await client.getMailboxLock('INBOX');
    const mailbox = client.mailbox || {};
    const exists = Number(mailbox.exists) || 0;
    console.log(`[M0] INBOX 邮件总数 exists=${exists}，uidValidity=${mailbox.uidValidity}`);

    // 最近 3 封：只读 envelope（uid/from/subject），绝不下载正文、绝不写文件
    if (exists > 0) {
      const startSeq = Math.max(1, exists - 2);
      const recent = [];
      for await (const msg of client.fetch(`${startSeq}:*`, { uid: true, envelope: true })) {
        recent.push(msg);
        if (recent.length >= 3) break;
      }
      recent.forEach((m, i) => {
        const env = m.envelope || {};
        const fromAddr = (env.from && env.from[0] && (env.from[0].address || env.from[0].name)) || '';
        console.log(`[M0]   最近#${i + 1} uid=${m.uid} from=${fromAddr} subject=${env.subject || '(无主题)'}`);
      });
    } else {
      console.log('[M0]   INBOX 为空（exists=0），跳过最近邮件预览。');
    }

    console.log('[M0] ✅ 连通性验证通过：可以从本 runner IP 登录并读取 INBOX。闸门放行，可进入 M1。');
    process.exitCode = 0;
  } catch (err) {
    const msg = String((err && err.message) || err);
    console.error(`[M0] ❌ 连通性验证失败：${msg}`);
    if (/unsafe login|unsafe|异地|风险|验证失败|auth/i.test(msg)) {
      console.error('[M0]    疑似 QQ 风控/异地登录拦截。已发送 ID 命令仍被挡时：');
      console.error('[M0]    → 方案(b) 改国内宿主（自建 runner / 阿里云函数计算 / 腾讯云 SCF / 国内 VPS cron，脚本宿主无关）；');
      console.error('[M0]    → 或退回 B 手动导入方案。此分支需你提供国内宿主后再定。');
    } else if (/getaddrinfo|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|network|socket/i.test(msg)) {
      console.error('[M0]    疑似网络/出站端口受限：确认 runner 可出站到 imap.qq.com:993。');
    }
    process.exitCode = 1;
  } finally {
    if (lock) { try { lock.release(); } catch (_) {} }
    try { await client.logout(); } catch (_) { try { client.close(); } catch (__) {} }
  }
}

main();
