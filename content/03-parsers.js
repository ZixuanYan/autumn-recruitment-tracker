/**
 * 秋招求职与简历助手 - Content Script 03/06 岗位收录解析引擎
 * 知名大厂门户特征库、五家 ATS 专有解析器（北森/Moka/大易/用友/24Talent）、
 * JSON-LD / OpenGraph / 正则通用兜底与字段清洗
 */
'use strict';

  // ================= 页面收录与 DOM 解析引擎 =================
  // 1. 知名大厂官方招聘门户特征库
  const KNOWN_ENTERPRISES = [
    { match: /careers\.tencent\.com|tencent\.com/i, company: '腾讯科技' },
    { match: /jobs\.bytedance\.com|bytedance\.com/i, company: '字节跳动' },
    { match: /talent\.alibaba\.com|taotian\.com|alibabagroup\.com|aliyun\.com/i, company: '阿里巴巴' },
    { match: /zhaopin\.meituan\.com|meituan\.com/i, company: '美团' },
    { match: /career\.huawei\.com|huawei\.com/i, company: '华为' },
    { match: /hr\.163\.com|campus\.163\.com|163\.com/i, company: '网易' },
    { match: /talent\.baidu\.com|baidu\.com/i, company: '百度' },
    { match: /campus\.jd\.com|jd\.com/i, company: '京东' },
    { match: /campus\.kuaishou\.cn|zhaopin\.kuaishou\.cn|kuaishou\.com/i, company: '快手' },
    { match: /job\.xiaohongshu\.com|xiaohongshu\.com/i, company: '小红书' },
    { match: /careers\.pinduoduo\.com|pinduoduo\.com/i, company: '拼多多' },
    { match: /hr\.xiaomi\.com|xiaomi\.com/i, company: '小米' },
    { match: /talent\.antgroup\.com|antgroup\.com/i, company: '蚂蚁集团' },
    { match: /job\.bilibili\.com|bilibili\.com/i, company: '哔哩哔哩' },
    { match: /didiglobal\.com|didichuxing\.com/i, company: '滴滴出行' },
    { match: /careers\.oppo\.com|oppo\.com/i, company: 'OPPO' },
    { match: /hr\.vivo\.com|vivo\.com/i, company: 'vivo' },
    { match: /we-dji\.com|dji\.com/i, company: '大疆创新' },
    { match: /nio\.com/i, company: '蔚来汽车' },
    { match: /lixiang\.com/i, company: '理想汽车' },
    { match: /xiaopeng\.com/i, company: '小鹏汽车' },
    { match: /job\.byd\.com|byd\.com/i, company: '比亚迪' },
    { match: /campus\.sf-express\.com|sf-express\.com/i, company: '顺丰速运' },
    { match: /talent\.shein\.com|shein\.com/i, company: 'SHEIN' },
    { match: /careers\.shopee\.cn|shopee\.com/i, company: 'Shopee' },
    { match: /job\.dewu\.com|poizon\.com/i, company: '得物' },
    { match: /cvte\.com/i, company: 'CVTE' },
    { match: /360\.cn/i, company: '360' },
    { match: /lenovo\.com/i, company: '联想集团' },
    { match: /zte\.com\.cn/i, company: '中兴通讯' }
  ];

  // 辅助函数：按选择器数组顺序提取第一个非空文本
  function queryFirstText(selectors, root = document) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (!el || el.closest('#autumn-job-assistant-host')) continue;
        
        // 优先提取属性
        const attrVal = el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('value');
        if (attrVal && attrVal.trim().length >= 2 && attrVal.trim().length < 100) {
          return attrVal.trim();
        }
        
        const txt = el.textContent?.trim();
        if (txt && txt.length >= 2 && txt.length < 150) {
          return txt;
        }
      } catch (_) {}
    }
    return '';
  }

  // 2. 核心 ATS 系统专有解析器 (北森, Moka, 大易, 用友, 24Talent)
  function parseAtsJobData() {
    const host = location.hostname.toLowerCase();
    const pathname = location.pathname;

    // ① 北森 (Beisen / iTalent / zhiye)
    if (/beisen\.com|italent\.cn|zhiye\.com/i.test(host)) {
      const position = queryFirstText([
        '.job-detail-title',
        '.detail-title',
        '.detail-header .title',
        '.job-title',
        '.job-name',
        '.post-name',
        '.position-name',
        '.beisen-breadcrumb .ant-breadcrumb-link:last-child',
        '.ant-breadcrumb li:last-child',
        '.breadcrumb-item:last-child',
        'h1'
      ]);
      const company = queryFirstText([
        '.header-logo img',
        '.logo img',
        '.header .company-name',
        '.tenant-name',
        '.brand-name',
        '.header-left .name'
      ]);
      return { company, position, source: 'Beisen' };
    }

    // ② Moka (MokaHR)
    if (/mokahr\.com/i.test(host)) {
      const position = queryFirstText([
        '.job-title',
        '.position-title',
        'h1.title',
        '.position-head .title',
        '.job-detail-title',
        '.job-name',
        '.moka-breadcrumb span:last-child',
        '.ant-breadcrumb li:last-child'
      ]);
      let company = queryFirstText([
        '.org-logo img',
        '.logo img',
        '.org-name',
        '.company-title',
        '.brand-title'
      ]);
      if (!company) {
        const m = pathname.match(/(?:campus-recruitment|apply|campus|social-recruitment)\/([^\/\?#]+)/i);
        if (m && m[1]) company = m[1];
      }
      return { company, position, source: 'Moka' };
    }

    // ③ 大易 (Dayee / HiTalent / WinTalent / CloudTalent)
    if (/dayee\.com|hitalent\.cn|wintalent\.cn|cloudtalent\.cn|bphr\.com\.cn/i.test(host)) {
      const position = queryFirstText([
        '.jobName',
        '.job_name',
        '.post_name',
        '.job-title',
        '.detail_title',
        '.nav_path a:last-child',
        '.nav-path span:last-child',
        'h1'
      ]);
      const company = queryFirstText([
        '.header_logo img',
        '.logo img',
        '.comp-title',
        '.header-brand',
        '.company-name'
      ]);
      return { company, position, source: 'Dayee' };
    }

    // ④ 用友 (Yonyou / DayHR / YonBIP)
    if (/yonyou\.com|yonyoucloud\.com|dayhr\.com|upesn\.com/i.test(host)) {
      const position = queryFirstText([
        '.post-title',
        '.job-name',
        '.position-detail-title',
        '.recruit-title',
        '.detail-header-title',
        'h1'
      ]);
      const company = queryFirstText([
        '.header img',
        '.logo_wrap img',
        '.tenant-logo img',
        '.company-name'
      ]);
      return { company, position, source: 'Yonyou' };
    }

    // ⑤ 24Talent / 赛码 (24talent.com / acmcoder.com)
    if (/24talent\.com|24-talent\.com|acmcoder\.com|51sai\.com/i.test(host)) {
      const position = queryFirstText([
        '.position-title',
        '.job-title',
        '.detail-title',
        '.job-detail-head .title',
        'h1'
      ]);
      const company = queryFirstText([
        '.company-title',
        '.company_name',
        '.logo img'
      ]);
      return { company, position, source: '24Talent' };
    }

    // ⑥ 招聘平台专属 (BOSS直聘, 牛客, 实习僧, 猎聘, 智联, 前程无忧, 拉勾)
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

  // 3. 通用面包屑末项提取器
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
      const el = document.querySelector(sel);
      const txt = el?.textContent?.trim();
      if (txt && txt.length >= 2 && txt.length <= 60 && !/首页|主页|返回|详情|列表|校招|社招|岗位列表|招聘信息/i.test(txt)) {
        return txt;
      }
    }
    return '';
  }

  // 4. 通用顶栏 Logo 反查企业名称
  function parseHeaderLogoCompany() {
    const logoSelectors = [
      'header img[alt]',
      'nav img[alt]',
      '.header img[alt]',
      '.navbar img[alt]',
      '.logo img[alt]',
      '[class*="logo" i] img[alt]',
      '[class*="brand" i] img[alt]',
      'header a[title]',
      'nav a[title]'
    ];
    for (const sel of logoSelectors) {
      const el = document.querySelector(sel);
      const txt = (el?.getAttribute('alt') || el?.getAttribute('title') || '').trim();
      if (txt && txt.length >= 2 && txt.length <= 40 && !/logo|icon|image|pic|首页|图片|招聘官网|招聘系统/i.test(txt)) {
        return txt;
      }
    }
    return '';
  }

  // 5. 智能岗位名称清洗器 (彻底废除 split(/\s+/)[0]，保留中英文混排空格)
  function cleanJobPosition(raw) {
    if (!raw) return '';
    let str = String(raw).replace(/[\r\n\t]+/g, ' ').trim();

    // 剔除前后方括号/圆括号内的修饰词 (如 【2025届校招】、[秋招]、(急聘)、【校招/全职】、【应届生】)
    str = str.replace(/^[【\[（(][^【\[（()）\]】]{1,25}[】\]）)]\s*/g, '');
    str = str.replace(/\s*[【\[（(][^【\[（()）\]】]{1,25}[】\]）)]$/g, '');

    // 剔除前置标签：如 "招聘职位："、"应聘岗位："、"职位详情："、"校招-"
    str = str.replace(/^(?:招聘职位|投递岗位|应聘岗位|职位名称|岗位名称|招聘岗位|招聘)\s*[:：\-—|·]\s*/i, '');
    str = str.replace(/^(?:20\d{2}届?(?:校园招聘|校招|秋招|春招|全球校招)?)\s*[:：\-—|·]\s*/i, '');

    // 剔除后缀噪音词：如 "- 职位详情"、"| 校园招聘"、"- 招聘官网"
    str = str.replace(/\s*[-—|·_]\s*(?:职位详情|岗位详情|校园招聘|校招|网申通道|投递通道|招聘官网|招聘门户|招聘管理系统).*$/i, '');

    // 压缩连续多余空格，但完整保留内部空格（如 "AI 产品经理"）
    str = str.replace(/\s{2,}/g, ' ').trim();

    return str.slice(0, 60) || '待确认岗位';
  }

  // 6. 智能企业名称清洗器
  function cleanJobCompany(raw, host, pageTitle) {
    let str = String(raw || '').replace(/[\r\n\t]+/g, ' ').trim();

    // 剔除系统与平台后缀
    str = str.replace(/\s*[-—|·_]\s*(?:北森|Moka|大易|用友|24Talent|BOSS直聘|猎聘|智联招聘|前程无忧|牛客网?|实习僧|招聘官网|校园招聘|招聘系统|招聘门户).*$/i, '');
    str = str.replace(/^(?:关于|欢迎加入|走进)\s*/i, '');
    str = str.replace(/(?:校园招聘|官方招聘|人才招聘|招聘门户|招聘主页|招聘官网)$/i, '');

    // 如果清洗后为空或太短，从 document.title 智能拆解
    if (!str || str.length < 2 || /待确认|未知|招聘|职位|详情|首页/i.test(str)) {
      const parts = String(pageTitle || document.title || '')
        .split(/[-—|·_]/)
        .map(p => p.trim())
        .filter(p => p.length >= 2 && !/招聘|职位|详情|BOSS|猎聘|智联|前程|牛客|实习僧|Moka|北森|大易|官网|首页|系统|管理|投递/i.test(p));
      if (parts.length > 0) {
        str = parts[0];
      }
    }

    // 若仍为空，从二级域名反查 (如 oppo.italent.cn -> OPPO)
    if (!str || str.length < 2) {
      const sub = (host || location.hostname).split('.')[0];
      if (sub && sub.length >= 2 && !/www|app|campus|jobs?|careers?|talent|hr|zhaopin/i.test(sub)) {
        str = sub.toUpperCase();
      }
    }

    return str.slice(0, 50) || '待确认公司';
  }

  // ================= 综合调度提取主函数 =================
  function extractPageJobData() {
    let detectedCompany = '';
    let detectedPosition = '';
    let city = '';
    const host = location.hostname.toLowerCase();

    // Step 1: 知名大厂官方域名优先锁定
    const matchedEnterprise = KNOWN_ENTERPRISES.find(item => item.match.test(host));
    if (matchedEnterprise) {
      detectedCompany = matchedEnterprise.company;
    }

    // Step 2: 专有 ATS / 招聘系统解析
    const atsData = parseAtsJobData();
    if (atsData) {
      if (!detectedCompany && atsData.company) detectedCompany = atsData.company;
      if (atsData.position) detectedPosition = atsData.position;
    }

    // Step 3: 面包屑末项精准捕获 (岗位通用探测)
    if (!detectedPosition) {
      detectedPosition = parseBreadcrumbPosition();
    }

    // Step 4: JSON-LD 结构化数据探测
    function flatten(value, output = []) {
      if (!value) return output;
      if (Array.isArray(value)) value.forEach(item => flatten(item, output));
      else if (typeof value === 'object') {
        output.push(value);
        if (value['@graph']) flatten(value['@graph'], output);
      }
      return output;
    }
    const jsonObjects = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(node => {
      try { flatten(JSON.parse(node.textContent), jsonObjects); } catch (_) {}
    });
    const jobLd = jsonObjects.find(item => {
      const type = item && item['@type'];
      return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
    }) || {};

    if (!detectedPosition && jobLd.title) detectedPosition = jobLd.title;
    if (!detectedCompany && (jobLd.hiringOrganization?.name || typeof jobLd.hiringOrganization === 'string')) {
      detectedCompany = typeof jobLd.hiringOrganization === 'string' ? jobLd.hiringOrganization : jobLd.hiringOrganization.name;
    }

    // Step 5: 通用 DOM 大字号标题与 Logo 探测
    if (!detectedPosition) {
      detectedPosition = queryFirstText([
        'h1',
        '[class*="job-title" i]',
        '[class*="jobTitle" i]',
        '[class*="position-title" i]',
        '[class*="positionTitle" i]',
        '[class*="post-title" i]',
        '[class*="job-name" i]',
        '[class*="jobName" i]',
        '[class*="position" i]',
        '.title'
      ]);
    }
    if (!detectedCompany) {
      detectedCompany = parseHeaderLogoCompany() || queryFirstText([
        '[data-testid*="company" i]',
        '[class*="company-name" i]',
        '[class*="companyName" i]',
        '[class*="company_title" i]',
        '[class*="companyTitle" i]',
        '[class*="org-name" i]'
      ]);
    }

    // Step 6: Meta 元数据与网页 Title 兜底
    if (!detectedPosition) {
      detectedPosition = document.querySelector('meta[property="og:title"],meta[name="og:title"]')?.content?.trim() || document.title;
    }
    if (!detectedCompany) {
      detectedCompany = document.querySelector('meta[property="og:site_name"],meta[name="og:site_name"]')?.content?.trim() || '';
    }

    // Step 7: 智能清洗与标准化
    const position = cleanJobPosition(detectedPosition);
    const company = cleanJobCompany(detectedCompany, host, document.title);

    // Step 8: 城市与阶段分析
    const locations = Array.isArray(jobLd.jobLocation) ? jobLd.jobLocation : [jobLd.jobLocation].filter(Boolean);
    city = locations.map(loc => {
      const address = loc?.address || loc;
      return [address?.addressLocality, address?.addressRegion].filter(Boolean).join(' ');
    }).filter(Boolean).join(' / ');

    const pageText = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 50000);
    if (!city) {
      const knownCities = ['北京','上海','广州','深圳','杭州','南京','苏州','成都','重庆','武汉','西安','长沙','天津','厦门','合肥','郑州','青岛','济南','宁波','无锡','珠海','佛山','东莞','福州','昆明','南昌','大连','沈阳','哈尔滨','香港','澳门'];
      // 优先：工作地点/城市类名区块内的文本（比全文扫描准，减少 JD 正文里其它城市造成的误判）
      const locSelectors = ['[class*="work-location" i]', '[class*="workLocation" i]', '[class*="job-location" i]', '[class*="jobLocation" i]', '[class*="work-place" i]', '[class*="work-city" i]', '[class*="workCity" i]', '[class*="location" i]', '[class*="city" i]'];
      for (const sel of locSelectors) {
        if (city) break;
        for (const el of document.querySelectorAll(sel)) {
          if (el.closest('#autumn-job-assistant-host')) continue;
          const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (!txt || txt.length > 40) continue;
          const hit = knownCities.find(c => txt.includes(c));
          if (hit) { city = hit; break; }
        }
      }
      // 兜底：全文扫描，窗口由 4000 收窄到 1500，进一步降低正文误判
      if (!city) city = knownCities.find(c => (position + ' ' + document.title + ' ' + pageText.slice(0, 1500)).includes(c)) || '';
    }

    const stage = '已投递';

    const dateMatch = pageText.match(/(?:投递|申请)(?:时间|日期)?\s*[:：]?\s*(20\d{2})[.\/年-](\d{1,2})[.\/月-](\d{1,2})日?/);
    const applicationDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}` : new Date().toISOString().slice(0, 10);

    return {
      company,
      position,
      city: city.slice(0, 30),
      stage,
      applicationDate,
      applicationUrl: location.href
    };
  }

