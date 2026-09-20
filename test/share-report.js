'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/core/share-report.js'), 'utf8');
const context = {
  AJA: require('../shared/stages'), console,
  groupRecordsByCompany(list) {
    return [
      { label: '腾讯', records: list.filter(record => String(record.company).startsWith('腾讯')) },
      { label: '甲公司', records: list.filter(record => record.company === '甲公司') }
    ].filter(group => group.records.length);
  },
  computeCityStats() { return [{ city: '深圳', total: 1, offers: 0 }, { city: '广州', total: 1, offers: 0 }, { city: '北京', total: 1, offers: 0 }, { city: '', total: 1, offers: 1 }]; },
  computeCompanyTypeStats() { return [{ label: '央国企', total: 0 }, { label: '私企', total: 2 }, { label: '外企', total: 0 }, { label: '未设置', total: 1 }]; }
};
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
assert.ok(html.includes('按企业收纳'));
assert.ok(html.includes('2 个岗位'));
assert.ok(html.includes('city-bar'));
assert.ok(html.includes('type-bar'));
assert.ok(html.includes('&lt;工程师&gt;'));
assert.ok(!html.includes('不应导出'));
assert.ok(!html.includes('secret.example'));
assert.ok(!/<script(?![^>]*nonce=)[^>]*>/i.test(html));
assert.strictEqual((html.match(/<script\b/g) || []).length, 1);
assert.ok(html.includes('全部展开'));
assert.ok(html.includes('全部合并'));
assert.ok(html.includes('nonce=\"share-report-controls-v1\"'));
assert.ok(html.includes('</script>'));
assert.ok(!/https?:\/\//i.test(html));
assert.ok(html.includes('Content-Security-Policy'));
console.log('分享报告纯函数检查通过');
