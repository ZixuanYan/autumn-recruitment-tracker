'use strict';
// ============================================================================
// test/extension-parsers.js — 插件岗位采集解析引擎测试（extension/content/03-parsers.js）
//
// 做法：把真实的 03-parsers.js 原文放进带 DOM 桩的 vm 沙箱执行，再断言其行为。
//       不在测试里复制任何实现，避免与源码漂移（同 web-check.js 的做法）。
//
// 断言全部来自修复前的实证基线：
//   · 域名库子串匹配     20 个探针域名误判 9 个
//   · 标题反推取 parts[0] 10 个真实标题错 8 个（把岗位名当公司名）
//   · 岗位清洗缺噪声表    5 个样例全失败（「软件工程师 - 北森」原样输出、「职位详情」被当岗位）
//   · 城市按数组顺序      「工作地点：深圳/北京」输出北京
//   · 括号被整块删除      「后端（深圳）」「后端（北京）」撞成同名
// 运行：node test/extension-parsers.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const PARSER_PATH = path.resolve(__dirname, '../../autumn-recruitment-tracker/extension/content/03-parsers.js');
const parserSrc = fs.readFileSync(PARSER_PATH, 'utf8');

let failed = 0;
const cases = [];
function check(name, fn) { cases.push({ kind: 'case', name, fn }); }
function section(title) { cases.push({ kind: 'section', title }); }

// ---------------- DOM 桩 ----------------
// querySelectorAll/querySelector 按「选择器原文」查表，测试只需登记用到的选择器。
function mkEl(tag, options = {}) {
  const opts = options || {};
  return {
    tagName: String(tag || 'div').toUpperCase(),
    textContent: opts.text != null ? opts.text : '',
    children: opts.children || [],
    attrs: opts.attrs || {},
    ancestors: opts.ancestors || [],
    getAttribute(a) { return Object.prototype.hasOwnProperty.call(this.attrs, a) ? this.attrs[a] : null; },
    closest(sel) {
      const needle = String(sel || '').toLowerCase();
      return this.ancestors.some(name => needle.includes(String(name).toLowerCase())) ? { tagName: 'DIV' } : null;
    }
  };
}

function makeSandbox(fixture) {
  const f = fixture || {};
  const table = f.selectors || {};
  const all = sel => (Object.prototype.hasOwnProperty.call(table, sel) ? table[sel] : []);
  const document = {
    title: f.title || '',
    querySelectorAll: all,
    querySelector(sel) { const list = all(sel); return list.length ? list[0] : null; },
    body: { innerText: f.bodyText || '' }
  };
  const location = {
    hostname: f.hostname || 'www.example.com',
    pathname: f.pathname || '/',
    href: f.href || `https://${f.hostname || 'www.example.com'}${f.pathname || '/'}`
  };
  const sandbox = { document, location, console, __api: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const exportLine = '\n;__export({ matchEnterpriseByHost, hasRecruitContext, pickCompanyFromTitle, cleanJobPosition,'
    + ' cleanJobCompany, pickCity, subdomainGuess, stripPlatformNoise, pickBestCandidate, extractPageJobData,'
    + ' queryFirstText, queryFirstAttr, deepestFittingText, readJobPostingLd, parseBreadcrumbPosition,'
    + ' parseHeaderLogoCompany, KNOWN_ENTERPRISES, KNOWN_CITIES, COMPANY_SOURCE_WEIGHTS, POSITION_SOURCE_WEIGHTS });';
  sandbox.__export = api => { sandbox.__api = api; };
  vm.runInContext(parserSrc + exportLine, sandbox, { filename: '03-parsers.js' });
  return sandbox;
}

// 默认沙箱：纯函数测试用（不依赖具体 DOM）
const box = makeSandbox({});
const api = box.__api;

assert.ok(api, '解析器未能导出任何函数');

// 标题 → 公司名（组合调用，与真实链路一致：先角色识别再清洗）
const companyFromTitle = (title, position) => api.cleanJobCompany(api.pickCompanyFromTitle(title, position || ''));

async function runAll() {
  for (const item of cases) {
    if (item.kind === 'section') { console.log(item.title); continue; }
    try { await item.fn(); console.log(`  ✓ ${item.name}`); }
    catch (e) { failed += 1; console.error(`  ✗ ${item.name}\n    ${e.message}`); }
  }
  console.log(`\n${failed ? `存在 ${failed} 个失败` : '插件解析引擎测试全部通过'}`);
  if (failed) process.exitCode = 1;
}

// ============================================================================
section('A1 域名库：后缀匹配（修复前 20 个探针误判 9 个）');

check('真实招聘域名正确命中', () => {
  const ok = {
    'careers.tencent.com': '腾讯科技', 'www.tencent.com': '腾讯科技',
    'jobs.bytedance.com': '字节跳动', 'talent.alibaba.com': '阿里巴巴',
    'campus.jd.com': '京东', 'we-dji.com': '大疆创新', 'www.dji.com': '大疆创新',
    'zte.com.cn': '中兴通讯', 'www.360.cn': '360', 'careers.shopee.cn': 'Shopee',
    'job.dewu.com': '得物', 'www.poizon.com': '得物', 'campus.kuaishou.cn': '快手',
    'hr.163.com': '网易', 'www.didiglobal.com': '滴滴出行', 'www.sf-express.com': '顺丰速运'
  };
  for (const host of Object.keys(ok)) {
    const hit = api.matchEnterpriseByHost(host);
    assert.ok(hit, `${host} 应命中域名库`);
    assert.strictEqual(hit.company, ok[host], `${host} → ${ok[host]}`);
  }
});

check('子串误判全部消除（修复前 9/20 误判，含钓鱼域名）', () => {
  const bad = [
    'studionio.com', 'canio.com', 'hdji.com', 'bjd.com', 'myjd.com', 'not-tencent.com',
    'shein.com.co', '360.cn.security-check.top', '163.com.phishing.site', 'lixianghua.com',
    'vivotek.com.tw', 'xiaomi-eco.cn', 'kuaishou-mall.com', 'lenovo-clone.com', 'zte.net.cn',
    'byd-auto.parts', 'huawei-partner.cn', 'meituan-jobs.evil.net', 'baidu-seo.cn', 'oppo-vision.cn'
  ];
  const hits = bad.filter(host => api.matchEnterpriseByHost(host));
  assert.deepStrictEqual(hits, [], `以下域名被误判：${hits.join(', ')}`);
});

check('域名库规则全部是注册域（不含子域前缀，避免与后缀匹配语义重复）', () => {
  for (const item of api.KNOWN_ENTERPRISES) {
    assert.ok(Array.isArray(item.domains) && item.domains.length, `${item.company} 缺 domains`);
    for (const d of item.domains) {
      assert.ok(!/^(careers?|jobs?|talent|hr|zhaopin|campus|recruit|www)\./i.test(d), `${d} 不应带子域前缀`);
      assert.ok(!/[*?+]/.test(d), `${d} 不应是正则`);
    }
  }
});

section('A1 招聘语境门禁（购物页/文档页不应得到大厂名）');

check('招聘子域、招聘路径、招聘标题三种语境都放行', () => {
  assert.strictEqual(api.hasRecruitContext({ title: 'x' }, { hostname: 'jobs.bytedance.com', pathname: '/' }), true);
  assert.strictEqual(api.hasRecruitContext({ title: 'x' }, { hostname: 'careers.tencent.com', pathname: '/' }), true);
  assert.strictEqual(api.hasRecruitContext({ title: 'x' }, { hostname: 'www.example.com', pathname: '/careers/list' }), true);
  assert.strictEqual(api.hasRecruitContext({ title: 'x' }, { hostname: 'www.example.com', pathname: '/zhaopin/1' }), true);
  assert.strictEqual(api.hasRecruitContext({ title: '2026 校园招聘' }, { hostname: 'www.example.com', pathname: '/' }), true);
});

check('非招聘页拒绝（item.jd.com 购物、help.aliyun.com 文档）', () => {
  assert.strictEqual(api.hasRecruitContext({ title: '【京东】iPhone 17 手机 价格' }, { hostname: 'item.jd.com', pathname: '/100012345.html' }), false);
  assert.strictEqual(api.hasRecruitContext({ title: 'ECS 实例规格族' }, { hostname: 'help.aliyun.com', pathname: '/zh/ecs/spec' }), false);
  assert.strictEqual(api.hasRecruitContext({ title: '小米商城 - 手机' }, { hostname: 'www.mi.com', pathname: '/product' }), false);
});

section('A2 标题角色识别（修复前 10 个真实标题错 8 个）');

check('「岗位名-公司名」序的标题正确取出公司名', () => {
  const cases2 = [
    ['后端开发工程师-腾讯科技招聘', '腾讯科技'],
    ['产品经理（深圳）- 小米集团校园招聘', '小米集团'],
    ['前端开发工程师-美团点评', '美团点评'],
    ['硬件工程师-比亚迪股份有限公司', '比亚迪股份有限公司'],
    ['运营管培生_网易杭州', '网易杭州'],
    ['算法工程师-商汤科技招聘官网', '商汤科技'],
    ['数据分析师 | 蚂蚁集团 2026 校招', '蚂蚁集团'],
    ['【2026届校园招聘】算法工程师_字节跳动', '字节跳动'],
    ['游戏策划_米哈游', '米哈游']
  ];
  for (const [title, expected] of cases2) {
    assert.strictEqual(companyFromTitle(title), expected, `${title} → ${expected}`);
  }
});

check('「公司名-岗位名」序也正确（不因顺序改变而失效）', () => {
  assert.strictEqual(companyFromTitle('腾讯科技-后端开发工程师'), '腾讯科技');
  assert.strictEqual(companyFromTitle('小米集团_产品经理', '产品经理'), '小米集团');
});

check('标题里只有 ATS 平台名时返回空串（宁空勿错，不再硬塞错值）', () => {
  assert.strictEqual(companyFromTitle('Java开发工程师-北森'), '');
  assert.strictEqual(companyFromTitle('算法工程师|猎聘'), '');
  assert.strictEqual(companyFromTitle('软件工程师 - Moka'), '');
  assert.strictEqual(companyFromTitle('职位详情'), '');
});

check('反向排除：已识别出的岗位名绝不会被当成公司名', () => {
  // 标题只有一段且它就是岗位名时，即使含 COMPANY_HINT 也要被排除
  assert.strictEqual(companyFromTitle('技术支持工程师', '技术支持工程师'), '');
  // 岗位名带修饰、标题段是其超集时同样排除
  assert.strictEqual(companyFromTitle('高级算法工程师', '算法工程师'), '');
});

check('cleanJobCompany 剥掉法人尾巴之外的招聘修饰与裸年份', () => {
  assert.strictEqual(api.cleanJobCompany('小米集团校园招聘'), '小米集团');
  assert.strictEqual(api.cleanJobCompany('蚂蚁集团 2026 校招'), '蚂蚁集团');
  assert.strictEqual(api.cleanJobCompany('腾讯科技招聘官网'), '腾讯科技');
  assert.strictEqual(api.cleanJobCompany('关于腾讯'), '腾讯');
  assert.strictEqual(api.cleanJobCompany('北森'), '');
  assert.strictEqual(api.cleanJobCompany(''), '');
  assert.strictEqual(api.cleanJobCompany('招聘'), '');
});

section('A3 岗位清洗：与公司清洗共用噪声表（修复前 5/5 失败）');

check('剥离平台/系统噪声尾巴', () => {
  assert.strictEqual(api.cleanJobPosition('软件工程师 - 北森', ''), '软件工程师');
  assert.strictEqual(api.cleanJobPosition('算法工程师|猎聘', ''), '算法工程师');
  assert.strictEqual(api.cleanJobPosition('管培生-校园招聘-网易', '网易'), '管培生');
  assert.strictEqual(api.cleanJobPosition('后端开发工程师_腾讯科技招聘官网', '腾讯科技'), '后端开发工程师');
  assert.strictEqual(api.cleanJobPosition('游戏策划_米哈游', '米哈游'), '游戏策划');
});

check('纯噪声不得被当成岗位名（修复前「职位详情」被原样返回）', () => {
  assert.strictEqual(api.cleanJobPosition('职位详情', ''), '');
  assert.strictEqual(api.cleanJobPosition('岗位详情', ''), '');
  assert.strictEqual(api.cleanJobPosition('北森', ''), '');
  assert.strictEqual(api.cleanJobPosition('', ''), '');
  assert.strictEqual(api.cleanJobPosition('招聘', ''), '');
});

check('保留区分性括号：城市 / iOS-Android / 批次（同公司多岗位的关键）', () => {
  assert.strictEqual(api.cleanJobPosition('后端开发工程师（深圳）', ''), '后端开发工程师（深圳）');
  assert.strictEqual(api.cleanJobPosition('后端开发工程师（北京）', ''), '后端开发工程师（北京）');
  assert.strictEqual(api.cleanJobPosition('客户端开发（iOS）', ''), '客户端开发（iOS）');
  assert.strictEqual(api.cleanJobPosition('客户端开发（Android）', ''), '客户端开发（Android）');
  assert.strictEqual(api.cleanJobPosition('产品经理（提前批）', ''), '产品经理（提前批）');
  assert.notStrictEqual(
    api.cleanJobPosition('后端开发工程师（深圳）', ''),
    api.cleanJobPosition('后端开发工程师（北京）', ''),
    '两个不同工作地的岗位清洗后必须不同名'
  );
});

check('只剔除噪声括号与【】营销标签', () => {
  assert.strictEqual(api.cleanJobPosition('（急聘）销售顾问', ''), '销售顾问');
  assert.strictEqual(api.cleanJobPosition('研发工程师（2026届校园招聘）', ''), '研发工程师');
  assert.strictEqual(api.cleanJobPosition('【2026届校招】AI 产品经理（深圳）', ''), 'AI 产品经理（深圳）');
  assert.strictEqual(api.cleanJobPosition('【秋招】测试开发工程师', ''), '测试开发工程师');
});

check('前置标签剔除、内部空格保留、识别不出返回空串', () => {
  assert.strictEqual(api.cleanJobPosition('招聘职位：产品经理', ''), '产品经理');
  assert.strictEqual(api.cleanJobPosition('应聘岗位 - 算法工程师', ''), '算法工程师');
  assert.strictEqual(api.cleanJobPosition('  高级 Java 开发工程师  ', ''), '高级 Java 开发工程师');
  assert.strictEqual(api.cleanJobPosition('首页', ''), '');
});

check('stripPlatformNoise 循环剥离多段尾巴', () => {
  assert.strictEqual(api.stripPlatformNoise('工程师 - 北森 - 校园招聘'), '工程师');
  assert.strictEqual(api.stripPlatformNoise('工程师'), '工程师');
  assert.strictEqual(api.stripPlatformNoise('校园招聘'), '');
});

section('A5 城市：按文本出现位置 + 扩库');

check('按出现位置选取（修复前「深圳/北京」输出北京）', () => {
  assert.strictEqual(api.pickCity('工作地点：深圳（南山）/ 北京'), '深圳');
  assert.strictEqual(api.pickCity('深圳市南山区科技园'), '深圳');
  assert.strictEqual(api.pickCity('上海 · 深圳 双地点'), '上海');
  assert.strictEqual(api.pickCity('base 广州，可远程'), '广州');
  assert.strictEqual(api.pickCity('北京'), '北京');
});

check('嵌套不误判：「上海口岸」应取上海而非海口', () => {
  assert.strictEqual(api.pickCity('上海口岸物流园'), '上海');
});

check('城市库已扩充到约 100 个，覆盖常见二三线', () => {
  assert.ok(api.KNOWN_CITIES.length >= 95, `当前 ${api.KNOWN_CITIES.length} 个`);
  for (const c of ['石家庄', '太原', '温州', '常州', '徐州', '中山', '惠州', '烟台', '南通', '绍兴', '嘉兴', '泉州', '贵阳', '南宁', '海口', '长春', '兰州']) {
    assert.ok(api.KNOWN_CITIES.includes(c), `缺少 ${c}`);
  }
  assert.strictEqual(new Set(api.KNOWN_CITIES).size, api.KNOWN_CITIES.length, '城市库不应有重复');
});

section('A6 二级域名兜底与候选打分');

check('二级域名兜底拒绝数字/连字符/通用前缀（避免 "12345"、"CN-HR"）', () => {
  assert.strictEqual(api.subdomainGuess('oppo.italent.cn'), 'OPPO');
  assert.strictEqual(api.subdomainGuess('nio.jobs.feishu.cn'), 'NIO');
  assert.strictEqual(api.subdomainGuess('12345.italent.cn'), '');
  assert.strictEqual(api.subdomainGuess('cn-hr.italent.cn'), '');
  assert.strictEqual(api.subdomainGuess('www.example.com'), '');
  assert.strictEqual(api.subdomainGuess('campus.example.com'), '');
  assert.strictEqual(api.subdomainGuess('app.example.com'), '');
});

check('候选打分取最高权重，且低于阈值视为无值', () => {
  const best = api.pickBestCandidate([
    { value: '来自标题', weight: 45, source: 'title' },
    { value: '来自 JSON-LD', weight: 100, source: 'jsonld' },
    { value: '来自 logo', weight: 70, source: 'logo' }
  ], 20);
  assert.strictEqual(best.value, '来自 JSON-LD');
  assert.strictEqual(api.pickBestCandidate([{ value: 'x', weight: 15, source: 'subdomain' }], 20), null);
  assert.strictEqual(api.pickBestCandidate([{ value: '', weight: 100, source: 'jsonld' }], 20), null);
  assert.strictEqual(api.pickBestCandidate([], 20), null);
});

section('A4 文本/属性提取分工');

check('queryFirstAttr 只取属性，queryFirstText 只取可见文本', () => {
  const sb = makeSandbox({
    selectors: {
      '.logo img': [mkEl('img', { attrs: { alt: '星海科技' } })],
      'h1': [mkEl('h1', { text: '后端开发工程师', attrs: { title: 'SEO 标题不该被采用' } })]
    }
  });
  assert.strictEqual(sb.__api.queryFirstAttr(['.logo img']), '星海科技');
  assert.strictEqual(sb.__api.queryFirstText(['h1']), '后端开发工程师');
  assert.strictEqual(sb.__api.queryFirstText(['.logo img']), '', 'img 没有文本内容，不应从属性里取值');
});

check('超长容器向下钻，不把整个列表当成一个岗位名', () => {
  const list = mkEl('div', {
    text: '后端开发工程师 前端开发工程师 算法工程师 测试工程师 产品经理 运营专员 数据分析师 客户端开发',
    children: [mkEl('a', { text: '后端开发工程师' }), mkEl('a', { text: '前端开发工程师' })]
  });
  const sb = makeSandbox({ selectors: { '[class*="position" i]': [list] } });
  assert.strictEqual(sb.__api.queryFirstText(['[class*="position" i]'], { max: 40 }), '后端开发工程师');
});

check('avoid=true 时跳过页脚/导航/列表容器，avoid 缺省时不误伤面包屑', () => {
  const inFooter = mkEl('div', { text: '总部地址：深圳市南山区', ancestors: ['footer'] });
  const normal = mkEl('div', { text: '深圳市南山区' });
  const sb = makeSandbox({ selectors: { '.loc': [inFooter], '.ok': [normal] } });
  assert.strictEqual(sb.__api.queryFirstText(['.loc'], { avoid: true }), '');
  assert.strictEqual(sb.__api.queryFirstText(['.loc']), '总部地址：深圳市南山区');
  assert.strictEqual(sb.__api.queryFirstText(['.ok'], { avoid: true }), '深圳市南山区');
});

check('面包屑末项过滤导航噪声词', () => {
  const sb = makeSandbox({
    selectors: { '.ant-breadcrumb li:last-child': [mkEl('li', { text: '职位详情' })] }
  });
  assert.strictEqual(sb.__api.parseBreadcrumbPosition(), '');
  const sb2 = makeSandbox({
    selectors: { '.ant-breadcrumb li:last-child': [mkEl('li', { text: '后端开发工程师' })] }
  });
  assert.strictEqual(sb2.__api.parseBreadcrumbPosition(), '后端开发工程师');
});

check('parseHeaderLogoCompany 拒绝 logo/icon 这类无意义 alt', () => {
  const sb = makeSandbox({ selectors: { 'header img[alt]': [mkEl('img', { attrs: { alt: 'company logo' } })] } });
  assert.strictEqual(sb.__api.parseHeaderLogoCompany(), '');
  const sb2 = makeSandbox({ selectors: { 'header img[alt]': [mkEl('img', { attrs: { alt: '星海科技' } })] } });
  assert.strictEqual(sb2.__api.parseHeaderLogoCompany(), '星海科技');
});

section('端到端：extractPageJobData 真实场景');

check('BOSS直聘岗位详情页', () => {
  const sb = makeSandbox({
    hostname: 'www.zhipin.com', pathname: '/job_detail/abc.html',
    title: '后端开发工程师_腾讯科技招聘-BOSS直聘',
    selectors: {
      '.job-name': [mkEl('div', { text: '后端开发工程师' })],
      '.company-name': [mkEl('div', { text: '腾讯科技' })]
    },
    bodyText: '工作地点：深圳市南山区科技园 岗位职责：负责后台服务开发'
  });
  const got = sb.__api.extractPageJobData();
  assert.strictEqual(got.company, '腾讯科技');
  assert.strictEqual(got.position, '后端开发工程师');
  assert.strictEqual(got.city, '深圳');
  assert.strictEqual(got.stage, '已投递');
  assert.ok(got.applicationUrl.startsWith('https://www.zhipin.com'));
});

check('北森 ATS 页：公司名靠标题角色识别补上', () => {
  const sb = makeSandbox({
    hostname: 'xinghai.italent.cn', pathname: '/job/123',
    title: '产品经理-星海科技招聘官网',
    selectors: { 'h1': [mkEl('h1', { text: '产品经理' })] },
    bodyText: '工作地点：上海 岗位职责：负责 B 端产品'
  });
  const got = sb.__api.extractPageJobData();
  assert.strictEqual(got.position, '产品经理');
  assert.strictEqual(got.company, '星海科技');
  assert.strictEqual(got.city, '上海');
});

check('京东购物页点收录不会得到「京东」（招聘语境门禁生效）', () => {
  const sb = makeSandbox({
    hostname: 'item.jd.com', pathname: '/100012345.html',
    title: '【京东】iPhone 17 手机 价格 评测',
    selectors: {}, bodyText: '商品详情 品牌 苹果 型号 iPhone 17'
  });
  const got = sb.__api.extractPageJobData();
  assert.notStrictEqual(got.company, '京东');
  assert.strictEqual(got.company, '', '识别不出就留空，交人工补填');
});

check('阿里云文档页点收录不会得到「阿里巴巴」', () => {
  const sb = makeSandbox({
    hostname: 'help.aliyun.com', pathname: '/zh/ecs/spec',
    title: 'ECS 实例规格族_云服务器 ECS',
    selectors: { 'h1': [mkEl('h1', { text: '实例规格族' })] },
    bodyText: '本文介绍云服务器 ECS 的实例规格族'
  });
  const got = sb.__api.extractPageJobData();
  assert.notStrictEqual(got.company, '阿里巴巴');
});

check('JSON-LD 结构化数据优先于一切 DOM 猜测', () => {
  const ld = {
    '@type': 'JobPosting',
    title: '高级算法工程师（推荐方向）',
    hiringOrganization: { name: '星海科技股份有限公司' },
    jobLocation: { address: { addressLocality: '杭州市' } }
  };
  const sb = makeSandbox({
    hostname: 'www.example.com', pathname: '/jobs/1',
    title: '随便一个标题-某网站',
    selectors: {
      'script[type="application/ld+json"]': [{ textContent: JSON.stringify(ld) }],
      'h1': [mkEl('h1', { text: '招聘' })],
      '.company-name': [mkEl('div', { text: '错误公司名' })]
    },
    bodyText: '岗位职责'
  });
  const got = sb.__api.extractPageJobData();
  assert.strictEqual(got.company, '星海科技股份有限公司');
  assert.strictEqual(got.position, '高级算法工程师（推荐方向）');
  assert.strictEqual(got.city, '杭州');
  assert.strictEqual(got._sources.company, 'jsonld');
});

check('同一家公司两个不同岗位分别收录，得到两个不同的岗位名', () => {
  const mk = pos => makeSandbox({
    hostname: 'xinghai.italent.cn', pathname: '/job/1',
    title: `${pos}-星海科技招聘官网`,
    selectors: { 'h1': [mkEl('h1', { text: pos })] },
    bodyText: '工作地点：深圳'
  });
  const a = mk('后端开发工程师（深圳）').__api.extractPageJobData();
  const b = mk('后端开发工程师（北京）').__api.extractPageJobData();
  assert.strictEqual(a.company, '星海科技');
  assert.strictEqual(b.company, '星海科技');
  assert.strictEqual(a.position, '后端开发工程师（深圳）');
  assert.strictEqual(b.position, '后端开发工程师（北京）');
  assert.notStrictEqual(a.position, b.position, '两个岗位必须可区分，否则第二个岗位会被判成重复而录不进去');
});

check('城市负向过滤：页脚总部地址不被当成岗位 base 地', () => {
  const sb = makeSandbox({
    hostname: 'x.example.com', pathname: '/job/1', title: '后端工程师-星海科技',
    selectors: {
      '[class*="location" i]': [mkEl('div', { text: '总部地址：北京市朝阳区', ancestors: ['footer'] })],
      'h1': [mkEl('h1', { text: '后端工程师' })]
    },
    bodyText: '工作地点：深圳市南山区 公司简介：总部位于北京市朝阳区'
  });
  assert.strictEqual(sb.__api.extractPageJobData().city, '深圳');
});

check('返回值结构与旧版兼容（收录表单只消费这 5 个字段）', () => {
  const sb = makeSandbox({ hostname: 'x.example.com', title: 't', selectors: {}, bodyText: '' });
  const got = sb.__api.extractPageJobData();
  for (const key of ['company', 'position', 'city', 'stage', 'applicationDate', 'applicationUrl']) {
    assert.ok(Object.prototype.hasOwnProperty.call(got, key), `缺少字段 ${key}`);
  }
  assert.ok(typeof got.company === 'string' && typeof got.position === 'string');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(got.applicationDate), '日期格式应为 YYYY-MM-DD');
});

runAll();
