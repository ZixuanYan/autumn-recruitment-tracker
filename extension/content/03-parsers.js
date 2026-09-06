/**
 * 秋招求职与简历助手 - Content Script 03/06 岗位收录解析引擎
 * 大厂门户特征库（域名后缀匹配 + 招聘语境门禁）、五家 ATS 专有解析器（北森/Moka/大易/用友/24Talent）、
 * 四家招聘平台解析器、JSON-LD 结构化数据、候选打分调度与字段清洗
 *
 * v4.1.0 修正（均由真实数据实证，修复前的错误率见每项注释）：
 * 1. 域名库从「子串正则」改为「域名后缀匹配」+ 招聘语境门禁 —— 修掉 studionio.com→蔚来、
 *    hdji.com→大疆、163.com.phishing.site→网易、item.jd.com→京东 等误判（20 个探针域名错 9 个）
 * 2. 域名库命中不再锁死后续步骤，改为候选之一，由 ATS / JSON-LD / logo 等更可信来源覆盖
 * 3. 标题反推公司名从「取第一段」改为「角色识别 + 反向排除已识别岗位名」——
 *    中文招聘站标题序几乎全是「岗位名-公司名」，旧逻辑 10 个真实标题错 8 个（把岗位名当成公司名）
 * 4. 岗位清洗与公司清洗共用同一份平台噪声表（旧版只有公司侧有，导致「软件工程师 - 北森」原样输出）；
 *    识别不出时返回空串而非硬塞「待确认岗位」，宁空勿错，交给人工在收录表单里补填
 * 5. 岗位名保留（深圳）（iOS）（提前批）等括号修饰 —— 这是同公司多岗位的关键区分维度，
 *    删掉会让两条独立投递撞成同名，导致第二个岗位录不进去（网页端查重也依赖这一点）
 * 6. queryFirstText 不再无差别优先取 alt/title 属性（那是为 logo <img> 设计的），
 *    拆出 queryFirstAttr 专用；文本提取遇到超长容器会向下钻，避免把整个岗位列表当成岗位名
 * 7. 城市改为「按文本出现位置」选取（旧版按城市数组顺序，「深圳/北京」会输出北京），
 *    城市库 31→约 100，并对 location/city 类选择器加负向过滤（排除页脚总部地址与城市切换器）
 */
'use strict';

  // ================= 1. 大厂官方招聘门户特征库 =================
  // 只登记「注册域」，匹配用 host === d || host.endsWith('.' + d)，杜绝子串误判。
  // company 取值保持历史不变（台账里可能已有这些名称），本轮只改匹配方式。
  const KNOWN_ENTERPRISES = [
    { domains: ['tencent.com'], company: '腾讯科技' },
    { domains: ['bytedance.com'], company: '字节跳动' },
    { domains: ['alibaba.com', 'taotian.com', 'alibabagroup.com', 'aliyun.com'], company: '阿里巴巴' },
    { domains: ['meituan.com'], company: '美团' },
    { domains: ['huawei.com'], company: '华为' },
    { domains: ['163.com'], company: '网易' },
    { domains: ['baidu.com'], company: '百度' },
    { domains: ['jd.com'], company: '京东' },
    { domains: ['kuaishou.cn', 'kuaishou.com'], company: '快手' },
    { domains: ['xiaohongshu.com'], company: '小红书' },
    { domains: ['pinduoduo.com'], company: '拼多多' },
    { domains: ['xiaomi.com'], company: '小米' },
    { domains: ['antgroup.com'], company: '蚂蚁集团' },
    { domains: ['bilibili.com'], company: '哔哩哔哩' },
    { domains: ['didiglobal.com', 'didichuxing.com'], company: '滴滴出行' },
    { domains: ['oppo.com'], company: 'OPPO' },
    { domains: ['vivo.com'], company: 'vivo' },
    { domains: ['dji.com', 'we-dji.com'], company: '大疆创新' },
    { domains: ['nio.com'], company: '蔚来汽车' },
    { domains: ['lixiang.com'], company: '理想汽车' },
    { domains: ['xiaopeng.com'], company: '小鹏汽车' },
    { domains: ['byd.com'], company: '比亚迪' },
    { domains: ['sf-express.com'], company: '顺丰速运' },
    { domains: ['shein.com'], company: 'SHEIN' },
    { domains: ['shopee.cn', 'shopee.com'], company: 'Shopee' },
    { domains: ['dewu.com', 'poizon.com'], company: '得物' },
    { domains: ['cvte.com'], company: 'CVTE' },
    { domains: ['360.cn'], company: '360' },
    { domains: ['lenovo.com'], company: '联想集团' },
    { domains: ['zte.com.cn'], company: '中兴通讯' }
  ];

  // 品牌名清单：用于标题角色识别时给「命中已知品牌」的段加最高分
  const KNOWN_BRANDS = KNOWN_ENTERPRISES.map(item => item.company);

  // 域名后缀匹配（不做子串匹配）
  function matchEnterpriseByHost(host) {
    const h = String(host || location.hostname || '').toLowerCase();
    if (!h) return null;
    return KNOWN_ENTERPRISES.find(item => item.domains.some(d => h === d || h.endsWith('.' + d))) || null;
  }

  // 招聘语境门禁：域名库命中还必须是招聘页。
  // 否则在 item.jd.com 逛京东、help.aliyun.com 查云文档时点收录，会得到与当前页面毫无关系的公司名。
  const RECRUIT_HOST_RE = /(^|\.)(careers?|jobs?|talent|hr|zhaopin|campus|recruit|joinus|join)(\.|$)/i;
  const RECRUIT_PATH_RE = /(^|\/)(careers?|jobs?|talent|hr|zhaopin|campus|recruit|joinus|join|positions?|posts?)(\/|$)/i;
  const RECRUIT_TITLE_RE = /招聘|校招|社招|校园|职位|岗位|投递|网申|人才|诚聘|career|jobs?|position|recruit|talent/i;
  function hasRecruitContext(doc, loc) {
    const d = doc || document;
    const l = loc || location;
    const host = String(l.hostname || '').toLowerCase();
    if (RECRUIT_HOST_RE.test(host)) return true;
    if (RECRUIT_PATH_RE.test(String(l.pathname || ''))) return true;
    return RECRUIT_TITLE_RE.test(String(d.title || ''));
  }

  // ================= 2. DOM 提取原语 =================
  // 贪婪选择器需要排除的祖先容器：页脚总部地址、导航、侧栏推荐岗位、筛选器与列表容器
  const NOISE_CONTAINER_SEL = 'footer, nav, aside, [class*="footer" i], [class*="sidebar" i], [class*="recommend" i], [class*="filter" i], [class*="nav" i], [class*="list" i]';

  function isOwnHost(el) {
    try { return !!(el && el.closest && el.closest('#autumn-job-assistant-host')); } catch (_) { return false; }
  }
  function isNoiseContainer(el, avoid) {
    if (!avoid || !el || !el.closest) return false;
    try { return !!el.closest(NOISE_CONTAINER_SEL); } catch (_) { return false; }
  }

  // 元素自身文本落在 [min,max] 就直接用；过长说明是容器 → 向下钻到合适的最深子元素，
  // 避免把整个岗位列表的文本拼成一个「岗位名」。
  function deepestFittingText(el, min, max) {
    if (!el) return '';
    const own = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    if (own.length >= min && own.length <= max) return own;
    if (own.length > max) {
      const children = el.children || [];
      for (let i = 0; i < children.length; i += 1) {
        const t = deepestFittingText(children[i], min, max);
        if (t) return t;
      }
    }
    return '';
  }

  // 只取可见文本。options: { min, max, avoid }（avoid=true 时跳过页脚/导航/列表等噪声容器）
  function queryFirstText(selectors, options = {}) {
    const min = Number(options.min) > 0 ? Number(options.min) : 2;
    const max = Number(options.max) > 0 ? Number(options.max) : 150;
    for (const sel of selectors) {
      try {
        const nodes = document.querySelectorAll(sel);
        for (let i = 0; i < nodes.length; i += 1) {
          const el = nodes[i];
          if (isOwnHost(el) || isNoiseContainer(el, options.avoid === true)) continue;
          const txt = deepestFittingText(el, min, max);
          if (txt) return txt;
        }
      } catch (_) {}
    }
    return '';
  }

  // 只取属性（alt/title），专用于 logo <img>：这类元素没有文本内容，公司名只存在于属性里。
  // 旧版把「属性优先于文本」无差别应用到所有选择器，导致带 tooltip 的标题元素取到属性而非用户看到的文本。
  function queryFirstAttr(selectors, attrs = ['alt', 'title'], options = {}) {
    const min = Number(options.min) > 0 ? Number(options.min) : 2;
    const max = Number(options.max) > 0 ? Number(options.max) : 40;
    for (const sel of selectors) {
      try {
        const nodes = document.querySelectorAll(sel);
        for (let i = 0; i < nodes.length; i += 1) {
          const el = nodes[i];
          if (isOwnHost(el)) continue;
          for (const a of attrs) {
            const v = String(el.getAttribute(a) || '').trim();
            if (v.length >= min && v.length <= max) return v;
          }
        }
      } catch (_) {}
    }
    return '';
  }

  // ================= 3. ATS / 招聘平台专有解析器 =================
  const LOGO_SELECTORS = [
    '.header-logo img', '.logo img', '.org-logo img', '.header_logo img',
    '.logo_wrap img', '.tenant-logo img', '[class*="logo" i] img', '[class*="brand" i] img'
  ];

  function parseAtsJobData() {
    const host = location.hostname.toLowerCase();
    const pathname = location.pathname;

    // ① 北森 (Beisen / iTalent / zhiye)
    if (/beisen\.com|italent\.cn|zhiye\.com/i.test(host)) {
      const position = queryFirstText([
        '.job-detail-title', '.detail-title', '.detail-header .title', '.job-title', '.job-name',
        '.post-name', '.position-name', '.beisen-breadcrumb .ant-breadcrumb-link:last-child',
        '.ant-breadcrumb li:last-child', '.breadcrumb-item:last-child', 'h1'
      ]);
      const company = queryFirstAttr(['.header-logo img', '.logo img'])
        || queryFirstText(['.header .company-name', '.tenant-name', '.brand-name', '.header-left .name']);
      return { company, position, source: 'Beisen' };
    }

    // ② Moka (MokaHR)
    if (/mokahr\.com/i.test(host)) {
      const position = queryFirstText([
        '.job-title', '.position-title', 'h1.title', '.position-head .title',
        '.job-detail-title', '.job-name', '.moka-breadcrumb span:last-child', '.ant-breadcrumb li:last-child'
      ]);
      let company = queryFirstAttr(['.org-logo img', '.logo img'])
        || queryFirstText(['.org-name', '.company-title', '.brand-title']);
      if (!company) {
        // 路径里的 org 段常是英文/拼音 slug 甚至数字 id，可信度低，只作最后兜底
        const m = pathname.match(/(?:campus-recruitment|apply|campus|social-recruitment)\/([^\/\?#]+)/i);
        if (m && m[1]) company = m[1];
      }
      return { company, position, source: 'Moka' };
    }

    // ③ 大易 (Dayee / HiTalent / WinTalent / CloudTalent)
    if (/dayee\.com|hitalent\.cn|wintalent\.cn|cloudtalent\.cn|bphr\.com\.cn/i.test(host)) {
      const position = queryFirstText([
        '.jobName', '.job_name', '.post_name', '.job-title', '.detail_title',
        '.nav_path a:last-child', '.nav-path span:last-child', 'h1'
      ]);
      const company = queryFirstAttr(['.header_logo img', '.logo img'])
        || queryFirstText(['.comp-title', '.header-brand', '.company-name']);
      return { company, position, source: 'Dayee' };
    }

    // ④ 用友 (Yonyou / DayHR / YonBIP)
    if (/yonyou\.com|yonyoucloud\.com|dayhr\.com|upesn\.com/i.test(host)) {
      const position = queryFirstText([
        '.post-title', '.job-name', '.position-detail-title', '.recruit-title', '.detail-header-title', 'h1'
      ]);
      const company = queryFirstAttr(['.header img', '.logo_wrap img', '.tenant-logo img'])
        || queryFirstText(['.company-name']);
      return { company, position, source: 'Yonyou' };
    }

    // ⑤ 24Talent / 赛码 (24talent.com / acmcoder.com)
    if (/24talent\.com|24-talent\.com|acmcoder\.com|51sai\.com/i.test(host)) {
      const position = queryFirstText(['.position-title', '.job-title', '.detail-title', '.job-detail-head .title', 'h1']);
      const company = queryFirstAttr(['.logo img']) || queryFirstText(['.company-title', '.company_name']);
      return { company, position, source: '24Talent' };
    }

    // ⑥ 招聘平台专属 (BOSS直聘 / 牛客 / 实习僧 / 猎聘)
    if (/zhipin\.com/i.test(host)) {
      return {
        company: queryFirstText(['.company-name', '.company-info .name', '.job-sec-company .name']),
        position: queryFirstText(['.job-name', '.name', 'h1']),
        source: 'Boss'
      };
    }
    if (/nowcoder\.com/i.test(host)) {
      return {
        company: queryFirstText(['.company-item-title', '.job-detail-company', '.company-name', '.feed-item-company-name']),
        position: queryFirstText(['.job-item-title', '.job-title', '.detail-title', 'h1']),
        source: 'Nowcoder'
      };
    }
    if (/shixiseng\.com/i.test(host)) {
      return {
        company: queryFirstText(['.com-name', '.company-name', '.com_name']),
        position: queryFirstText(['.job-name', '.job_name', '.new_job_name', 'h1']),
        source: 'Shixiseng'
      };
    }
    if (/liepin\.com/i.test(host)) {
      return {
        company: queryFirstText(['.company-info-title', '.name-box .name', '.company-name']),
        position: queryFirstText(['.job-title-left .name', '.job-title-box .name', 'h1']),
        source: 'Liepin'
      };
    }

    return null;
  }

  // ================= 4. 通用探测 =================
  // 面包屑末项：注意不能用 queryFirstText（它带噪声容器过滤时会跳过 nav 内的面包屑）
  function parseBreadcrumbPosition() {
    const breadcrumbSelectors = [
      '.ant-breadcrumb li:last-child',
      '.ant-breadcrumb-link:last-child',
      '.el-breadcrumb__item:last-child',
      '.breadcrumb-item:last-child',
      '.breadcrumb > *:last-child',
      'nav[aria-label*="breadcrumb" i] *:last-child',
      '[class*="breadcrumb" i] li:last-child',
      '[class*="nav-path" i] *:last-child',
      '[class*="navPath" i] *:last-child'
    ];
    for (const sel of breadcrumbSelectors) {
      try {
        const nodes = document.querySelectorAll(sel);
        for (let i = 0; i < nodes.length; i += 1) {
          const el = nodes[i];
          if (isOwnHost(el)) continue;
          const txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
          if (txt && txt.length >= 2 && txt.length <= 60
            && !/^(?:首页|主页|返回|详情|列表|校招|社招|岗位列表|招聘信息|职位详情|岗位详情|招聘职位|个人中心|登录|注册)$/i.test(txt)) {
            return txt;
          }
        }
      } catch (_) {}
    }
    return '';
  }

  // 顶栏 Logo 反查企业名称（只取属性，且排除 logo/icon 这类无意义 alt）
  function parseHeaderLogoCompany() {
    const logoSelectors = [
      'header img[alt]', 'nav img[alt]', '.header img[alt]', '.navbar img[alt]',
      '.logo img[alt]', '[class*="logo" i] img[alt]', '[class*="brand" i] img[alt]',
      'header a[title]', 'nav a[title]'
    ];
    const txt = queryFirstAttr(logoSelectors, ['alt', 'title'], { min: 2, max: 40 });
    if (!txt) return '';
    return /logo|icon|image|pic|banner|首页|图片|招聘官网|招聘系统/i.test(txt) ? '' : txt;
  }

  // JSON-LD 里的 JobPosting（结构化数据，最可信来源）
  function readJobPostingLd() {
    function flatten(value, output) {
      if (!value) return output;
      if (Array.isArray(value)) { value.forEach(item => flatten(item, output)); return output; }
      if (typeof value === 'object') {
        output.push(value);
        if (value['@graph']) flatten(value['@graph'], output);
      }
      return output;
    }
    const jsonObjects = [];
    try {
      document.querySelectorAll('script[type="application/ld+json"]').forEach(node => {
        try { flatten(JSON.parse(node.textContent), jsonObjects); } catch (_) {}
      });
    } catch (_) {}
    const jobLd = jsonObjects.find(item => {
      const type = item && item['@type'];
      return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
    }) || {};
    let org = '';
    const ho = jobLd.hiringOrganization;
    if (typeof ho === 'string') org = ho;
    else if (ho && typeof ho === 'object') org = String(ho.name || '');
    return { title: String(jobLd.title || ''), organization: org, raw: jobLd };
  }

  // ================= 5. 清洗器（岗位与公司共用同一份噪声表） =================
  // 平台/系统噪声词：岗位名与公司名共用这一份，避免两个清洗器规则漂移
  // （旧版只有 cleanJobCompany 有这张表，导致「软件工程师 - 北森」的岗位名原样输出）
  const PLATFORM_NOISE_WORDS = '北森|MokaHR|Moka|大易|用友|YonBIP|DayHR|24Talent|24-Talent|赛码|acmcoder|BOSS直聘|猎聘|智联招聘|前程无忧|51job|牛客网|牛客|实习僧|拉勾|招聘官网|招聘门户|招聘系统|招聘管理系统|校园招聘|职位详情|岗位详情|网申通道|投递通道|校招|社招|秋招|春招|招聘';
  const PLATFORM_TAIL_RE = new RegExp('[\\s\\-—|·_~–]*(?:' + PLATFORM_NOISE_WORDS + ')[\\s\\-—|·_~–]*$', 'i');
  const PLATFORM_ANY_RE = new RegExp(PLATFORM_NOISE_WORDS, 'i');

  // 循环剥离尾部的「分隔符 + 平台噪声」，处理 "软件工程师 - 北森 - 校园招聘" 这类多段尾巴
  function stripPlatformNoise(str) {
    let s = String(str || '').replace(/[\r\n\t]+/g, ' ').trim();
    let prev = null;
    let guard = 0;
    while (s !== prev && guard < 8) { prev = s; s = s.replace(PLATFORM_TAIL_RE, '').trim(); guard += 1; }
    return s;
  }

  // 括号内确属噪声的内容（可以删）；城市/方向/iOS-Android/批次这类区分性括号必须保留
  const PAREN_NOISE_INNER_RE = /^(?:急聘|急招|热招|热销|诚聘|招聘|校招|社招|秋招|春招|20\d{2}\s*届?(?:校园招聘|校招|秋招|春招)?|应届生?|全职|兼职|实习|若干|\d+人)$/i;
  // 整段就是噪声、不能当岗位名的取值
  const POSITION_NOISE_ONLY_RE = /^(?:职位详情|岗位详情|招聘职位|职位名称|岗位名称|详情|招聘|校招|社招|首页|主页|职位|岗位|列表|更多)$/i;

  // 岗位名清洗。保留（深圳）（iOS）（提前批）等区分性括号 —— 它们决定了网页端能否把
  // 同一家公司的两个岗位识别成两条独立投递。company 传入后会从首尾剥掉公司名。
  function cleanJobPosition(raw, company) {
    if (!raw) return '';
    let str = String(raw).replace(/[\r\n\t]+/g, ' ').trim();

    // 只剔除【】/[] 包裹的前后置修饰（多为「【2025届校招】」这类营销标签）
    str = str.replace(/^[【\[][^【\[\]】]{1,25}[】\]]\s*/g, '');
    str = str.replace(/\s*[【\[][^【\[\]】]{1,25}[】\]]$/g, '');

    // （）只在内容确属噪声时才删；「（深圳）」「（iOS）」「（提前批）」一律保留
    str = str.replace(/^[（(]([^（()）]{1,25})[）)]\s*/, (m, inner) => (PAREN_NOISE_INNER_RE.test(inner.trim()) ? '' : m));
    str = str.replace(/\s*[（(]([^（()）]{1,25})[）)]$/, (m, inner) => (PAREN_NOISE_INNER_RE.test(inner.trim()) ? '' : m));

    // 剔除前置标签：「招聘职位：」「应聘岗位：」「2026届校招-」
    str = str.replace(/^(?:招聘职位|投递岗位|应聘岗位|职位名称|岗位名称|招聘岗位|招聘岗位名称|招聘)\s*[:：\-—|·]\s*/i, '');
    str = str.replace(/^(?:20\d{2}\s*届?\s*(?:校园招聘|校招|秋招|春招|全球校招)?)\s*[:：\-—|·]\s*/i, '');

    // 剥离平台/系统噪声尾巴，再剥离公司名尾巴（如「后端开发工程师_腾讯科技招聘官网」）
    str = stripPlatformNoise(str);
    const comp = String(company || '').trim();
    if (comp.length >= 2) {
      const esc = comp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      str = str.replace(new RegExp('[\\s\\-—|·_~–]*' + esc + '[\\s\\-—|·_~–]*$', 'i'), '').trim();
      str = str.replace(new RegExp('^[\\s\\-—|·_~–]*' + esc + '[\\s\\-—|·_~–]*', 'i'), '').trim();
      str = stripPlatformNoise(str);
    }

    str = str.replace(/\s{2,}/g, ' ').trim();
    // 识别不出就返回空串（宁空勿错）：收录表单里留空比塞一个错值更好，保存时仍会兜底为「待确认岗位」
    if (!str || POSITION_NOISE_ONLY_RE.test(str) || str.length < 2) return '';
    return str.slice(0, 60);
  }

  // 标题角色识别用的词库
  const JOB_HINT_RE = /(工程师|开发|产品|运营|设计|算法|分析|经理|专员|管培生?|顾问|研究员|总监|实习|前端|后端|客户端|测试|运维|数据|架构|策划|编辑|翻译|财务|法务|人力|市场|销售|客服|审计|风控|硬件|软件|嵌入式|安卓|全栈|技术支持|项目管理|科学家|专家|助理|主管|Java|Android|iOS|Python|Go|C\+\+|UI|UX|PM|RD|QA|BD|HR)/i;
  const COMPANY_HINT_RE = /(有限公司|股份|集团|控股|科技|网络|信息|技术|银行|证券|保险|汽车|电子|通信|研究院|研究所|大学|学院|医院|中心|传媒|文化|能源|生物|制药|地产|物流|航空|食品|零售|制造|电气|机械|化工|材料|建筑)/;
  const TITLE_NOISE_RE = /^(?:20\d{2}\s*届?|招聘|校招|社招|秋招|春招|校园招聘|秋季招聘|春季招聘|职位|岗位|详情|首页|主页|官网|门户|系统|投递|申请|网申|欢迎|加入|诚聘英才|加入我们|人才|北森|Moka|大易|用友|24Talent|赛码|BOSS直聘|猎聘|智联招聘|前程无忧|牛客|实习僧|拉勾|campus|careers|jobs?|talent|hr|zhaopin|recruit)/i;
  const TITLE_SPLIT_RE = /[-—|·_~–/、,，]+/;
  // 公司名尾巴上的招聘修饰（「小米集团校园招聘」→「小米集团」）
  const COMPANY_TAIL_RE = /[\s\-—|·_~–]*(?:20\d{2}\s*届?\s*)?(?:全球校园招聘|校园招聘|官方招聘|人才招聘|招聘门户|招聘主页|招聘官网|秋季招聘|春季招聘|校招|社招|秋招|春招|招聘|诚聘)+$/i;
  // 剥掉招聘修饰后可能剩下裸年份（「蚂蚁集团 2026 校招」→「蚂蚁集团 2026」→「蚂蚁集团」）
  const COMPANY_YEAR_TAIL_RE = /[\s\-—|·_~–]*20\d{2}\s*届?$/;

  function brandHit(seg) {
    const s = String(seg || '');
    return KNOWN_BRANDS.some(b => b.length >= 2 && (s.includes(b) || (s.length >= 3 && b.includes(s))));
  }

  // 从网页标题里识别公司段（取代旧版「按分隔符切开后无条件取第一段」）。
  // 核心是「角色识别 + 反向排除」：命中岗位词的段判为岗位段；已经识别出的岗位名直接从候选里排除；
  // 若存在岗位段，则另一个既非岗位也非噪声的段大概率就是公司名。最高分低于阈值时返回空串。
  function pickCompanyFromTitle(title, knownPosition) {
    const raw = String(title || (typeof document !== 'undefined' ? document.title : '') || '');
    if (!raw) return '';
    const segments = raw.split(TITLE_SPLIT_RE).map(s => s.trim()).filter(Boolean);
    if (!segments.length) return '';
    const posSlug = String(knownPosition || '').replace(/\s+/g, '').toLowerCase();
    const isJob = seg => JOB_HINT_RE.test(seg) && !COMPANY_HINT_RE.test(seg);
    const hasJobSeg = segments.some(isJob);

    let best = null;
    for (const seg of segments) {
      let score = 0;
      if (brandHit(seg)) score += 100;                       // 命中已知品牌：最强信号
      if (COMPANY_HINT_RE.test(seg)) score += 40;            // 含法人/行业后缀
      if (JOB_HINT_RE.test(seg)) score -= 60;                // 含岗位词
      if (TITLE_NOISE_RE.test(seg)) score -= 30;             // 整段以噪声词开头
      if (hasJobSeg && !isJob(seg) && !TITLE_NOISE_RE.test(seg)) score += 25; // 另一段大概率是公司
      const segSlug = seg.replace(/\s+/g, '').toLowerCase();
      if (posSlug.length >= 2 && segSlug.length >= 2
        && (segSlug === posSlug || segSlug.includes(posSlug) || posSlug.includes(segSlug))) score -= 200; // 反向排除
      const len = [...seg].length;
      if (len >= 2 && len <= 20) score += 5;
      else if (len > 25) score -= 10;
      if (!best || score > best.score) best = { seg, score };
    }
    return best && best.score >= 20 ? best.seg : '';
  }

  // 公司名清洗：只负责剥噪声；识别不出返回空串（不再退回标题第一段，也不再硬塞「待确认公司」）
  function cleanJobCompany(raw) {
    let str = String(raw || '').replace(/[\r\n\t]+/g, ' ').trim();
    if (!str) return '';
    str = str.replace(/^(?:关于|欢迎加入|走进|加入)\s*/i, '');
    str = stripPlatformNoise(str);
    str = str.replace(COMPANY_TAIL_RE, '').trim();
    str = str.replace(COMPANY_YEAR_TAIL_RE, '').trim();
    if ([...str].length < 2 || /^(?:待确认|未知|招聘|职位|详情|首页|公司名|企业名称)$/i.test(str)) return '';
    return str.slice(0, 50);
  }

  // 二级域名兜底：含数字、连字符或过长的一律不采用（避免 "12345"、"CN-HR" 这类机器 id）
  function subdomainGuess(host) {
    const sub = String(host || location.hostname || '').toLowerCase().split('.')[0];
    if (!sub) return '';
    if (!/^[a-z]{2,12}$/.test(sub)) return '';
    if (/^(www|app|m|en|cn|campus|jobs?|careers?|talent|hr|zhaopin|recruit|join|apply|sso|portal|home)$/i.test(sub)) return '';
    return sub.toUpperCase();
  }

  // ================= 6. 城市 =================
  const KNOWN_CITIES = [
    '北京', '上海', '广州', '深圳', '杭州', '南京', '苏州', '成都', '重庆', '武汉', '西安', '长沙', '天津', '厦门', '合肥',
    '郑州', '青岛', '济南', '宁波', '无锡', '珠海', '佛山', '东莞', '福州', '昆明', '南昌', '大连', '沈阳', '哈尔滨',
    '香港', '澳门', '石家庄', '太原', '呼和浩特', '长春', '乌鲁木齐', '兰州', '西宁', '银川', '海口', '三亚', '南宁',
    '贵阳', '温州', '常州', '徐州', '南通', '扬州', '镇江', '盐城', '泰州', '绍兴', '嘉兴', '金华', '台州', '湖州',
    '芜湖', '泉州', '汕头', '湛江', '中山', '惠州', '江门', '肇庆', '柳州', '桂林', '烟台', '潍坊', '威海', '洛阳',
    '保定', '唐山', '秦皇岛', '廊坊', '邯郸', '邢台', '张家口', '承德', '沧州', '衡水', '绵阳', '宜宾', '泸州', '德阳',
    '襄阳', '宜昌', '株洲', '湘潭', '赣州', '九江', '上饶', '咸阳', '宝鸡', '渭南', '鞍山', '吉林', '大庆', '包头', '大同'
  ];
  const CITY_NEGATIVE_SEL = 'footer, [class*="footer" i], [class*="select" i], [class*="picker" i], [class*="switch" i], [class*="filter" i], [class*="sidebar" i], [class*="nav" i]';
  const CITY_LOC_SELECTORS = [
    '[class*="work-location" i]', '[class*="workLocation" i]', '[class*="job-location" i]', '[class*="jobLocation" i]',
    '[class*="work-place" i]', '[class*="workPlace" i]', '[class*="work-city" i]', '[class*="workCity" i]',
    '[class*="location" i]', '[class*="city" i]'
  ];

  // 按「文本中出现的位置」选最早的城市，而不是按城市库数组顺序
  // （旧版对「工作地点：深圳（南山）/ 北京」会输出北京）
  function pickCity(text) {
    const txt = String(text || '');
    if (!txt) return '';
    let best = null;
    for (const c of KNOWN_CITIES) {
      const idx = txt.indexOf(c);
      if (idx >= 0 && (!best || idx < best.idx)) best = { city: c, idx };
    }
    return best ? best.city : '';
  }

  function extractCity(jobLd, position, pageTitle, pageText) {
    // ① JSON-LD 结构化地点最可信
    const locations = Array.isArray(jobLd.jobLocation) ? jobLd.jobLocation : [jobLd.jobLocation].filter(Boolean);
    const fromLd = locations.map(loc => {
      const address = (loc && loc.address) || loc;
      return [address && address.addressLocality, address && address.addressRegion].filter(Boolean).join(' ');
    }).filter(Boolean).join(' / ');
    if (fromLd) {
      const hit = pickCity(fromLd);
      if (hit) return hit;
      return fromLd.slice(0, 30);
    }
    // ② 「工作地点」类名区块（排除页脚总部地址与城市切换器）
    for (const sel of CITY_LOC_SELECTORS) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); } catch (_) { continue; }
      for (let i = 0; i < nodes.length; i += 1) {
        const el = nodes[i];
        if (isOwnHost(el)) continue;
        try { if (el.closest(CITY_NEGATIVE_SEL)) continue; } catch (_) {}
        const txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt || txt.length > 40) continue;
        const hit = pickCity(txt);
        if (hit) return hit;
      }
    }
    // ③ 关键词窗口：在「工作地点/办公地点/base」后 40 字内找，比全文扫 1500 字准得多
    //    （JD 正文常有「我们在北京、上海、深圳均有办公室」，全文扫会误判）
    const winRe = /(工作地点|办公地点|工作城市|工作地|所在城市|驻地|base)\s*[:：]?\s*([^\n]{0,40})/gi;
    let m;
    while ((m = winRe.exec(pageText)) !== null) {
      const hit = pickCity(m[2]);
      if (hit) return hit;
    }
    // ④ 最后才退回岗位名与标题
    return pickCity(position + ' ' + pageTitle);
  }

  // ================= 7. 候选打分调度 =================
  // 同一字段可能来自多个来源，按可信度取最高，而不是「先到先得」。
  const COMPANY_SOURCE_WEIGHTS = { jsonld: 100, ats: 90, domain: 78, logo: 70, selector: 66, og: 50, title: 45, subdomain: 15 };
  const POSITION_SOURCE_WEIGHTS = { jsonld: 100, ats: 95, selector: 80, breadcrumb: 72, h1: 60, generic: 55, og: 40, docTitle: 30 };
  const COMPANY_THRESHOLD = 20;
  const POSITION_THRESHOLD = 30;

  function pickBestCandidate(candidates, threshold) {
    let best = null;
    for (const c of candidates) {
      const value = String((c && c.value) || '').trim();
      if (!value) continue;
      if (!best || c.weight > best.weight) best = { value, weight: c.weight, source: c.source };
    }
    return best && best.weight >= threshold ? best : null;
  }

  const COMPANY_SELECTORS = [
    '[data-testid*="company" i]', '[class*="company-name" i]', '[class*="companyName" i]',
    '[class*="company-title" i]', '[class*="company_title" i]', '[class*="companyTitle" i]',
    '[class*="org-name" i]', '[class*="orgName" i]', '[class*="employer" i]'
  ];
  const POSITION_SELECTORS = [
    '[class*="job-title" i]', '[class*="jobTitle" i]', '[class*="position-title" i]', '[class*="positionTitle" i]',
    '[class*="post-title" i]', '[class*="postTitle" i]', '[class*="job-name" i]', '[class*="jobName" i]',
    '[class*="position-name" i]', '[class*="positionName" i]'
  ];
  const POSITION_GENERIC_SELECTORS = ['[class*="position" i]', '[class*="job-item" i] .title', '.title'];

  // ================= 综合调度提取主函数 =================
  function extractPageJobData() {
    const host = location.hostname.toLowerCase();
    const pageTitle = document.title || '';
    const jobLd = readJobPostingLd();
    const ats = parseAtsJobData();

    // ---- 先定岗位（岗位不依赖公司；公司反过来要用岗位做「反向排除」）----
    const positionCandidates = [];
    if (jobLd.title) positionCandidates.push({ value: jobLd.title, weight: POSITION_SOURCE_WEIGHTS.jsonld, source: 'jsonld' });
    if (ats && ats.position) positionCandidates.push({ value: ats.position, weight: POSITION_SOURCE_WEIGHTS.ats, source: 'ats:' + ats.source });
    const bySemantic = queryFirstText(POSITION_SELECTORS, { avoid: true });
    if (bySemantic) positionCandidates.push({ value: bySemantic, weight: POSITION_SOURCE_WEIGHTS.selector, source: 'selector' });
    const byBreadcrumb = parseBreadcrumbPosition();
    if (byBreadcrumb) positionCandidates.push({ value: byBreadcrumb, weight: POSITION_SOURCE_WEIGHTS.breadcrumb, source: 'breadcrumb' });
    const byH1 = queryFirstText(['h1'], { avoid: true });
    if (byH1) positionCandidates.push({ value: byH1, weight: POSITION_SOURCE_WEIGHTS.h1, source: 'h1' });
    const byGeneric = queryFirstText(POSITION_GENERIC_SELECTORS, { avoid: true });
    if (byGeneric) positionCandidates.push({ value: byGeneric, weight: POSITION_SOURCE_WEIGHTS.generic, source: 'generic' });
    const ogTitle = (document.querySelector('meta[property="og:title"],meta[name="og:title"]') || {}).content;
    if (ogTitle && ogTitle.trim()) positionCandidates.push({ value: ogTitle.trim(), weight: POSITION_SOURCE_WEIGHTS.og, source: 'og:title' });
    if (pageTitle) positionCandidates.push({ value: pageTitle, weight: POSITION_SOURCE_WEIGHTS.docTitle, source: 'document.title' });

    const bestPosition = pickBestCandidate(positionCandidates, POSITION_THRESHOLD);
    // 先用「不带公司」的清洗结果作为反向排除的依据（此时公司还没定）
    const prelimPosition = cleanJobPosition(bestPosition ? bestPosition.value : '', '');

    // ---- 再定公司（域名库只是候选之一，不再锁死后续来源）----
    const companyCandidates = [];
    if (jobLd.organization) companyCandidates.push({ value: jobLd.organization, weight: COMPANY_SOURCE_WEIGHTS.jsonld, source: 'jsonld' });
    if (ats && ats.company) companyCandidates.push({ value: ats.company, weight: COMPANY_SOURCE_WEIGHTS.ats, source: 'ats:' + ats.source });
    // 域名库必须同时满足招聘语境门禁，否则在购物/文档页点收录会得到无关公司名
    if (hasRecruitContext()) {
      const enterprise = matchEnterpriseByHost(host);
      if (enterprise) companyCandidates.push({ value: enterprise.company, weight: COMPANY_SOURCE_WEIGHTS.domain, source: 'domain' });
    }
    const byLogo = parseHeaderLogoCompany();
    if (byLogo) companyCandidates.push({ value: byLogo, weight: COMPANY_SOURCE_WEIGHTS.logo, source: 'logo' });
    const byCompanySelector = queryFirstText(COMPANY_SELECTORS, { avoid: true });
    if (byCompanySelector) companyCandidates.push({ value: byCompanySelector, weight: COMPANY_SOURCE_WEIGHTS.selector, source: 'selector' });
    const ogSite = (document.querySelector('meta[property="og:site_name"],meta[name="og:site_name"]') || {}).content;
    if (ogSite && ogSite.trim()) companyCandidates.push({ value: ogSite.trim(), weight: COMPANY_SOURCE_WEIGHTS.og, source: 'og:site_name' });
    const byTitle = pickCompanyFromTitle(pageTitle, prelimPosition);
    if (byTitle) companyCandidates.push({ value: byTitle, weight: COMPANY_SOURCE_WEIGHTS.title, source: 'title' });
    const bySub = subdomainGuess(host);
    if (bySub) companyCandidates.push({ value: bySub, weight: COMPANY_SOURCE_WEIGHTS.subdomain, source: 'subdomain' });

    const bestCompany = pickBestCandidate(companyCandidates, COMPANY_THRESHOLD);
    const company = cleanJobCompany(bestCompany ? bestCompany.value : '');

    // ---- 岗位名再清洗一次：这次带上已识别的公司名，剥掉「后端开发工程师_腾讯科技」里的公司尾巴 ----
    const position = cleanJobPosition(bestPosition ? bestPosition.value : '', company) || prelimPosition;

    // ---- 城市 ----
    const pageText = String((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 50000);
    const city = extractCity(jobLd.raw, position, pageTitle, pageText);

    return {
      company,
      position,
      city: String(city || '').slice(0, 30),
      stage: '已投递',
      applicationDate: resolveApplicationDate(pageText),
      applicationUrl: location.href,
      // 采集来源，仅供排查（console.debug），本轮不上 UI；后续做置信度展示时可直接接上
      _sources: {
        company: bestCompany ? bestCompany.source : '',
        position: bestPosition ? bestPosition.source : '',
        city: city ? 'detected' : ''
      }
    };
  }

  function resolveApplicationDate(pageText) {
    const dateMatch = String(pageText || '').match(/(?:投递|申请)(?:时间|日期)?\s*[:：]?\s*(20\d{2})[.\/年-](\d{1,2})[.\/月-](\d{1,2})日?/);
    return dateMatch
      ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
      : new Date().toISOString().slice(0, 10);
  }
