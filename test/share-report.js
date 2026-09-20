'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/core/share-report.js'), 'utf8');
const context = { AJA: require('../shared/stages'), console };
vm.createContext(context);
vm.runInContext(source, context);
const buildShareReport = context.buildShareReport;
const records = [
  { company: '腾讯', orgUnit: '云计算', position: '后端 <工程师>', city: '深圳/广州', applicationDate: '2026-09-10', stage: '一面', companyType: '私企', timeline: [{ stage: '已投递', at: '2026-09-01' }, { stage: '一面', at: '2026-09-10', done: true }], nextAction: '不应导出', recentSchedule: '不应导出', applicationUrl: 'https://secret.example' },
  { company: '腾讯科技有限公司', position: '产品经理', city: '', applicationDate: '2026-09-08', stage: 'Offer', companyType: '私企', timeline: [{ stage: 'Offer', at: '2026-09-08' }], updatedAt: 3 },
  { company: '甲公司', position: '算法', city: '北京', applicationDate: '2026-09-09', stage: '已结束', companyType: '', timeline: [{ stage: '已结束', at: '2026-09-09' }], updatedAt: 2 }
];
const html = buildShareReport(records, { exportedAt: '2026-09-20T12:00:00.000Z', appVersion: '4.33.0' });
assert.ok(html.startsWith('<!doctype html>'));
assert.ok(html.includes('投递记录'));
assert.ok(html.includes('覆盖公司'));
assert.ok(html.includes('深圳'));
assert.ok(html.includes('未填写'));
assert.ok(html.includes('Offer'));
assert.ok(html.includes('&lt;工程师&gt;'));
assert.ok(!html.includes('不应导出'));
assert.ok(!html.includes('secret.example'));
assert.ok(!/<script\b/i.test(html));
assert.ok(!/https?:\/\//i.test(html));
assert.ok(html.includes('Content-Security-Policy'));
console.log('分享报告纯函数检查通过');
