/**
 * 秋招求职与简历助手 - Content Script 04/06 智能一键自动填充表单引擎
 * 字段同义词匹配、原生 Setter 设值、自定义下拉/单选/剪贴板兜底
 */
'use strict';

  // ================= 智能一键自动填充表单引擎 (深度适配北森/Moka/大易/用友/24Talent/大厂门户) =================
  const AUTOFILL_FIELD_SYNONYMS = [
    // 1. 姓名与基本信息
    { keys: ['姓名', '中文名', '真实姓名'], patterns: [/^姓\s*名$/, /^中文名$/, /^真实姓名$/, /^name$/i, /^applicant\s*name$/i, /^xm$/i, /^real_?name$/i, /姓名/i, /中文名/i] },
    { keys: ['姓氏', '姓'], patterns: [/^姓\s*氏$/, /^姓$/, /^last\s*name$/i, /^surname$/i, /^family\s*name$/i, /^xing$/i] },
    { keys: ['名字', '名'], patterns: [/^名\s*字$/, /^名$/, /^first\s*name$/i, /^given\s*name$/i, /^ming$/i] },
    { keys: ['英文名', '拼音'], patterns: [/^英文名$/, /^拼音$/, /^english\s*name$/i, /^pinyin$/i] },
    { keys: ['性别'], patterns: [/^性\s*别$/, /^gender$/i, /^sex$/i, /^xb$/i, /性别/i] },
    { keys: ['民族'], patterns: [/^民\s*族$/, /^nationality$/i, /^ethnicity$/i, /^nation$/i, /^mz$/i, /民族/i] },
    { keys: ['政治面貌', '政治'], patterns: [/^政治面貌$/, /^政治$/, /^political\s*status$/i, /^political$/i, /^zzmm$/i, /政治面貌/i] },
    { keys: ['婚姻状况'], patterns: [/^婚姻状况$/, /^婚姻$/, /^marital\s*status$/i, /^hyzk$/i, /婚姻/i] },
    { keys: ['健康状况'], patterns: [/^健康状况$/, /^健康$/, /^health\s*status$/i, /^health$/i, /^jkzk$/i, /健康/i] },
    { keys: ['身高'], patterns: [/^身\s*高$/, /^height$/i, /^sg$/i] },
    { keys: ['体重'], patterns: [/^体\s*重$/, /^weight$/i, /^tz$/i] },

    // 2. 出生日期与年龄
    { keys: ['标准出生日期', '出生日期', '出生年月', '生日'], patterns: [/^出生日期$/, /^出生年月$/, /^生\s*日$/, /^birthday$/i, /^birth\s*date$/i, /^csrq$/i, /^csny$/i, /出生日期/i, /出生年月/i, /生日/i] },
    { keys: ['出生年份', '出生年'], patterns: [/^出生年份$/, /^出生年$/, /^birth\s*year$/i, /^csnf$/i] },
    { keys: ['出生月份', '出生月'], patterns: [/^出生月份$/, /^出生月$/, /^birth\s*month$/i, /^csyf$/i] },
    { keys: ['出生日', '出生号'], patterns: [/^出生日$/, /^出生号$/, /^birth\s*day$/i] },

    // 3. 证件信息
    { keys: ['证件类型', '证件名称'], patterns: [/^证件类型$/, /^证件名称$/, /^id\s*type$/i, /^certificate\s*type$/i, /^card\s*type$/i, /证件类型/i] },
    { keys: ['证件号码', '身份证号', '身份证', '证件号'], patterns: [/^身份证(?:号(?:码)?)?$/, /^证件号码$/, /^证件号$/, /^个人证件$/, /^id\s*card$/i, /^id\s*number$/i, /^sfz$/i, /^zjhm$/i, /身份证/i, /证件号/i, /个人证件/i] },

    // 4. 联系方式
    { keys: ['手机', '联系电话', '手机号', '电话'], patterns: [/^手\s*机(?:号(?:码)?)?$/, /^联系电话$/, /^移动电话$/, /^phone(?:\s*number)?$/i, /^mobile$/i, /^tel$/i, /^sjh$/i, /^lxdh$/i, /手机号?/i, /联系电话/i] },
    { keys: ['邮箱', '电子邮箱', 'Email', 'E-mail'], patterns: [/^电子邮箱$/, /^邮\s*箱$/, /^e-?mail(?:\s*address)?$/i, /^yx$/i, /^dzyx$/i, /邮箱/i, /e-?mail/i] },
    { keys: ['微信号', '微信'], patterns: [/^微\s*信(?:号)?$/, /^wechat(?:\s*id)?$/i, /^wx$/i, /^weixin$/i, /微信号?/i, /wechat/i] },
    { keys: ['QQ号', 'QQ'], patterns: [/^qq(?:\s*号)?$/i] },

    // 5. 紧急联系人
    { keys: ['紧急联系人姓名', '紧急联系人'], patterns: [/^紧急联系人(?:姓名)?$/, /^emergency\s*contact(?:\s*name)?$/i, /^jjlxr$/i, /紧急联系人/i] },
    { keys: ['紧急联系人电话', '紧急联系人手机'], patterns: [/^紧急联系人(?:电话|手机)$/, /^emergency\s*(?:phone|tel|mobile)$/i, /^jjlxrdh$/i, /紧急联系人电话/i] },
    { keys: ['紧急联系人关系'], patterns: [/^紧急联系人关系$/, /^与本人关系$/, /^emergency\s*relation$/i, /^jjlxrgx$/i, /紧急联系人关系/i] },

    // 6. 地址与籍贯
    { keys: ['现居省份'], patterns: [/^现居省份$/, /^现住省份$/, /^居住省份$/, /^current\s*province$/i] },
    { keys: ['现居城市', '当前城市', '居住地', '现居地'], patterns: [/^现居(?:地|城市)?$/, /^居住(?:地|城市)?$/, /^当前城市$/, /^现住址$/, /^现住地$/, /^current\s*city$/i, /^live_?city$/i, /现居/i, /居住地/i] },
    { keys: ['通讯地址', '现居详细地址', '详细地址', '家庭住址'], patterns: [/^通讯地址$/, /^详细地址$/, /^现居详细地址$/, /^家庭住址$/, /^联系地址$/, /^address$/i, /^detail\s*address$/i, /^txdz$/i, /通讯地址/i, /详细地址/i] },
    { keys: ['籍贯省份'], patterns: [/^籍贯省份$/, /^户籍省份$/, /^native\s*province$/i] },
    { keys: ['籍贯城市', '籍贯', '户籍地', '户口所在地'], patterns: [/^籍\s*贯$/, /^户\s*籍(?:所在地)?$/, /^户口所在地$/, /^家乡$/, /^native\s*place$/i, /^hukou$/i, /^jg$/i, /籍贯/i, /户籍/i] },
    { keys: ['邮政编码', '邮编'], patterns: [/^邮政编码$/, /^邮\s*编$/, /^zip\s*code$/i, /^postcode$/i, /^yzbm$/i, /邮编/i] },

    // 7. 求职意向与招聘偏好
    { keys: ['求职意向', '意向岗位', '期望岗位', '期望职位'], patterns: [/^求职意向$/, /^意向岗位$/, /^期望岗位$/, /^期望职位$/, /^应聘职位$/, /^intended\s*position$/i, /^target\s*job$/i, /^qzyx$/i, /求职意向/i, /期望岗位/i] },
    { keys: ['期望工作地点', '期望城市', '意向城市'], patterns: [/^期望(?:工作)?(?:地点|城市)$/, /^意向(?:地点|城市)$/, /^expected\s*city$/i, /^work\s*city$/i, /^qwdd$/i, /期望工作地点/i, /期望城市/i] },
    { keys: ['期望薪资', '期望薪酬'], patterns: [/^期望薪[资酬]$/, /^expected\s*salary$/i, /^salary$/i, /^qwxz$/i] },
    { keys: ['到岗时间', '最快到岗'], patterns: [/^到岗时间$/, /^最快到岗$/, /^入职时间$/, /^available\s*time$/i, /^dgsj$/i, /到岗时间/i] },
    { keys: ['是否接受调剂', '调剂'], patterns: [/^是否(?:接受)?调剂$/, /^服从调剂$/, /^accept\s*transfer$/i, /^sftj$/i, /调剂/i] },
    { keys: ['招聘渠道', '信息来源'], patterns: [/^招聘(?:信息)?渠道$/, /^信息来源$/, /^了解渠道$/, /^recruitment\s*channel$/i, /^source$/i, /招聘渠道/i, /信息来源/i] },
    { keys: ['求职状态'], patterns: [/^求职状态$/, /^当前状态$/, /^job\s*status$/i] },

    // 8. 教育经历 (最高学历/当前学历)
    { keys: ['学校', '毕业院校', '就读学校', '最高学历学校'], patterns: [/^毕业院校$/, /^就读学校$/, /^毕业学校$/, /^学\s*校$/, /^最高学历学校$/, /^university$/i, /^school$/i, /^college$/i, /^byxx$/i, /^jdxx$/i, /毕业院校/i, /就读学校/i, /毕业学校/i] },
    { keys: ['学院', '院系', '所学学院', '最高学历学院'], patterns: [/^学\s*院$/, /^院\s*系$/, /^所学学院$/, /^department$/i, /^faculty$/i, /^xy$/i, /学院/i, /院系/i] },
    { keys: ['专业', '所学专业', '专业名称', '最高学历专业'], patterns: [/^所学专业$/, /^专业名称$/, /^专\s*业$/, /^major$/i, /^profession$/i, /^zy$/i, /^sxzy$/i, /所学专业/i, /专业名称/i] },
    { keys: ['学历', '最高学历', '学历层次'], patterns: [/^最高学历$/, /^学\s*历$/, /^学历层次$/, /^education$/i, /^edu\s*level$/i, /^xl$/i, /^zgxl$/i, /最高学历/i, /学历/i] },
    { keys: ['学位', '最高学位'], patterns: [/^最高学位$/, /^学\s*位$/, /^degree$/i, /^academic\s*degree$/i, /^xw$/i, /学位/i] },
    { keys: ['培养方式', '学历类别', '学习形式'], patterns: [/^培养方式$/, /^学历类别$/, /^学习形式$/, /^教育类型$/, /^study\s*mode$/i, /^pyfs$/i, /培养方式/i, /学历类别/i] },
    { keys: ['入学年份', '入学年'], patterns: [/^入学年份$/, /^入学年$/, /^start\s*year$/i, /^enroll\s*year$/i, /^rxnf$/i] },
    { keys: ['入学月份', '入学月'], patterns: [/^入学月份$/, /^入学月$/, /^start\s*month$/i, /^enroll\s*month$/i, /^rxyf$/i] },
    { keys: ['入学时间', '入学年月'], patterns: [/^入学(?:时间|年月|日期)$/, /^开始(?:时间|年月)$/, /^enroll\s*date$/i, /^start\s*date$/i, /^rxsj$/i, /入学时间/i] },
    { keys: ['毕业年份', '毕业年'], patterns: [/^毕业年份$/, /^毕业年$/, /^预计毕业年(?:份)?$/, /^grad\s*year$/i, /^bynf$/i] },
    { keys: ['毕业月份', '毕业月'], patterns: [/^毕业月份$/, /^毕业月$/, /^预计毕业月(?:份)?$/, /^grad\s*month$/i, /^byyf$/i] },
    { keys: ['毕业时间', '毕业年月'], patterns: [/^毕业(?:时间|年月|日期)$/, /^预计毕业(?:时间|年月|日期)$/, /^结束(?:时间|年月)$/, /^grad\s*date$/i, /^end\s*date$/i, /^bysj$/i, /毕业时间/i] },
    { keys: ['导师', '指导老师'], patterns: [/^导\s*师$/, /^指导老师$/, /^advisor$/i, /^supervisor$/i, /^ds$/i, /导师/i] },
    { keys: ['成绩排名', '专业排名'], patterns: [/^成绩排名$/, /^专业排名$/, /^年级排名$/, /^major\s*ranking$/i, /^ranking$/i, /^cjpm$/i, /排名/i] },
    { keys: ['GPA', '平均绩点'], patterns: [/^gpa$/i, /^平均绩点$/, /^平均学分绩点$/, /^grade\s*point$/i, /^jd$/i] },

    // 9. 语言能力与技能证书
    { keys: ['英语水平', '英语等级', '外语水平'], patterns: [/^英语水平$/, /^外语水平$/, /^英语等级$/, /^english\s*level$/i, /^yysp$/i, /^yydj$/i, /英语水平/i, /英语等级/i] },
    { keys: ['英语分数', '英语成绩', '四六级成绩'], patterns: [/^英语(?:成绩|分数)$/, /^四六级(?:成绩|分数)$/, /^cet(?:-?[46])?(?:成绩|分数)$/i, /^english\s*score$/i, /^yycj$/i, /英语成绩/i, /英语分数/i] },
    { keys: ['计算机水平', '计算机等级'], patterns: [/^计算机水平$/, /^计算机等级$/, /^computer\s*level$/i, /^jsjsp$/i] },
    { keys: ['专业技能', '技能评价', 'IT技能', '技能'], patterns: [/^专业技能$/, /^技能评价$/, /^IT技能$/, /^技\s*能$/, /^skills?$/i, /^zyjn$/i, /专业技能/i, /技能/i] },

    // 10. 实习与工作经历
    { keys: ['实习单位', '实习公司', '单位', '公司', '工作单位'], patterns: [/^实习单位$/, /^工作单位$/, /^实习公司$/, /^单位名称$/, /^公司名称$/, /^单位$/, /^公\s*司$/, /^company$/i, /^employer$/i, /^sxdw$/i, /实习单位/i, /工作单位/i, /公司名称/i] },
    { keys: ['实习部门', '部门'], patterns: [/^实习部门$/, /^部\s*门$/, /^department$/i, /^sxbm$/i] },
    { keys: ['实习岗位', '岗位', '职位'], patterns: [/^实习岗位$/, /^工作岗位$/, /^职\s*位$/, /^岗\s*位$/, /^position$/i, /^job\s*title$/i, /^sxgw$/i] },
    { keys: ['岗位职责', '主要工作', '工作内容', '工作描述'], patterns: [/^岗位职责$/, /^主要工作$/, /^工作内容$/, /^工作描述$/, /^实习内容$/, /^responsibilities$/i, /^job\s*description$/i, /^gznr$/i, /^gwzz$/i, /岗位职责/i, /工作内容/i] },

    // 11. 项目经历
    { keys: ['项目名称'], patterns: [/^项目名称$/, /^project\s*name$/i, /^xmmc$/i, /项目名称/i] },
    { keys: ['项目角色'], patterns: [/^项目角色$/, /^担任职务$/, /^project\s*role$/i, /^xmjs$/i, /项目角色/i] },
    { keys: ['主要工作', '项目描述', '项目职责'], patterns: [/^项目描述$/, /^项目职责$/, /^主要工作$/, /^项目主要工作$/, /^project\s*description$/i, /^xmms$/i, /项目描述/i, /项目职责/i] },

    // 12. 自我评价与开放问答
    { keys: ['自我评价', '个人评价', '个人简介', '个人优势', '自我介绍'], patterns: [/^自我评价$/, /^个人评价$/, /^个人简介$/, /^个人优势$/, /^自我介绍$/, /^self\s*evaluation$/i, /^personal\s*summary$/i, /^zwpj$/i, /自我评价/i, /个人评价/i, /个人优势/i, /自我介绍/i] },
    { keys: ['应聘理由', '为什么选择本公司'], patterns: [/^应聘理由$/, /^求职动机$/, /^为什么选择(?:本|我|贵)公司$/, /^reason\s*for\s*applying$/i, /应聘理由/i] }
  ];

  function buildResumeFlatMap(resume) {
    const flatMap = {};
    if (!resume || typeof resume !== 'object') return flatMap;

    // 1. 先将原数据所有已有键值存入 (支持用户自定义字段)
    for (const [sectionName, sectionData] of Object.entries(resume)) {
      if (!sectionData) continue;
      if (Array.isArray(sectionData)) {
        sectionData.forEach((item, idx) => {
          if (item && typeof item === 'object') {
            for (const [k, v] of Object.entries(item)) {
              if (k.startsWith('_') || v === undefined || v === null || v === '') continue;
              const strVal = String(v).trim();
              if (idx === 0 && !flatMap[k]) flatMap[k] = strVal;
              flatMap[`${k}_${idx}`] = strVal;
            }
          }
        });
      } else if (typeof sectionData === 'object') {
        for (const [k, v] of Object.entries(sectionData)) {
          if (v === undefined || v === null || v === '') continue;
          flatMap[k] = String(v).trim();
        }
      }
    }

    // 2. 智能衍生与字段拆解 (Zero configuration, automatically derived)
    
    // ① 姓名拆解 (姓 / 名 / 英文名 / 拼音)
    const fullName = flatMap['姓名'] || flatMap['中文名'] || '';
    if (fullName) {
      if (fullName.length === 2) {
        flatMap['姓氏'] = flatMap['姓'] = fullName[0];
        flatMap['名字'] = flatMap['名'] = fullName[1];
      } else if (fullName.length >= 3) {
        const compoundSurnames = ['欧阳', '司马', '上官', '诸葛', '皇甫', '令狐', '慕容', '宇文', '司徒', '端木'];
        const isCompound = compoundSurnames.some(s => fullName.startsWith(s));
        if (isCompound && fullName.length >= 3) {
          flatMap['姓氏'] = flatMap['姓'] = fullName.slice(0, 2);
          flatMap['名字'] = flatMap['名'] = fullName.slice(2);
        } else {
          flatMap['姓氏'] = flatMap['姓'] = fullName[0];
          flatMap['名字'] = flatMap['名'] = fullName.slice(1);
        }
      }
      if (!flatMap['英文名'] && !flatMap['拼音']) {
        flatMap['拼音'] = fullName;
      }
    }

    // ② 出生年月拆解 (年 / 月 / 日 / 完整格式)
    const birthday = flatMap['出生年月'] || flatMap['出生日期'] || flatMap['生日'] || '';
    if (birthday) {
      const m = birthday.match(/(\d{4})[^\d]?(\d{1,2})?(?:[^\d]?(\d{1,2}))?/);
      if (m) {
        flatMap['出生年份'] = flatMap['出生年'] = m[1];
        if (m[2]) {
          flatMap['出生月份'] = flatMap['出生月'] = m[2].padStart(2, '0');
          flatMap['出生月份_无零'] = String(parseInt(m[2], 10));
        }
        if (m[3]) {
          flatMap['出生日'] = flatMap['出生号'] = m[3].padStart(2, '0');
        } else {
          flatMap['出生日'] = '01';
        }
        flatMap['标准出生日期'] = `${flatMap['出生年']}-${flatMap['出生月'] || '01'}-${flatMap['出生日'] || '01'}`;
      }
    }

    // ③ 身份证与证件
    const idCard = flatMap['身份证'] || flatMap['身份证号'] || flatMap['证件号'] || '';
    if (idCard) {
      flatMap['证件类型'] = '居民身份证';
      flatMap['证件名称'] = '身份证';
      flatMap['证件号码'] = idCard;
      if (!birthday && idCard.length === 18) {
        const idYear = idCard.slice(6, 10);
        const idMonth = idCard.slice(10, 12);
        const idDay = idCard.slice(12, 14);
        flatMap['出生年'] = idYear;
        flatMap['出生月'] = idMonth;
        flatMap['出生日'] = idDay;
        flatMap['出生年月'] = `${idYear}-${idMonth}`;
        flatMap['标准出生日期'] = `${idYear}-${idMonth}-${idDay}`;
      }
    }

    // ④ 现居地与籍贯拆解 (省 / 市 / 区 / 详细地址)
    const currentLoc = flatMap['现居地'] || flatMap['居住地'] || flatMap['现住址'] || flatMap['当前城市'] || '';
    if (currentLoc) {
      const pMatch = currentLoc.match(/(.+?省|.+?自治区|北京市|上海市|天津市|重庆市)/);
      if (pMatch) flatMap['现居省份'] = pMatch[1];
      const cMatch = currentLoc.match(/(.+?市|.+?地区|.+?自治州)/);
      if (cMatch) flatMap['现居城市'] = cMatch[1];
      flatMap['现居详细地址'] = currentLoc;
      flatMap['通讯地址'] = currentLoc;
      flatMap['家庭住址'] = currentLoc;
    }

    const nativePlace = flatMap['籍贯'] || flatMap['户籍'] || flatMap['户口所在地'] || '';
    if (nativePlace) {
      const npMatch = nativePlace.match(/(.+?省|.+?自治区|北京市|上海市|天津市|重庆市)/);
      if (npMatch) flatMap['籍贯省份'] = npMatch[1];
      const ncMatch = nativePlace.match(/(.+?市|.+?地区)/);
      if (ncMatch) flatMap['籍贯城市'] = ncMatch[1];
      flatMap['户口所在地'] = nativePlace;
      flatMap['户籍地'] = nativePlace;
    }

    // ⑤ 紧急联系人拆解 (姓名 / 电话 / 关系)
    const emContact = flatMap['紧急联系人'] || '';
    if (emContact) {
      const phoneM = emContact.match(/(1[3-9]\d{9})/);
      if (phoneM) flatMap['紧急联系人电话'] = flatMap['紧急联系人手机'] = phoneM[1];
      const nameM = emContact.replace(/(1[3-9]\d{9})/g, '').replace(/[\(\)（）\s,，]/g, '').replace(/父亲|母亲|父母|父|母|爸|妈|兄|弟|姐|妹|配偶|亲属|家人/g, '').trim();
      if (nameM) flatMap['紧急联系人姓名'] = nameM;
      flatMap['紧急联系人关系'] = /父|母|爸|妈|家/.test(emContact) ? '父母' : '亲属';
    }

    // ⑥ 英语水平与分数拆解
    const english = flatMap['英语水平'] || flatMap['外语水平'] || '';
    if (english) {
      if (/cet-?6|六级/i.test(english)) {
        flatMap['英语等级'] = '大学英语六级(CET-6)';
        flatMap['英语六级'] = 'CET-6';
      } else if (/cet-?4|四级/i.test(english)) {
        flatMap['英语等级'] = '大学英语四级(CET-4)';
        flatMap['英语四级'] = 'CET-4';
      }
      const scoreM = english.match(/(\d{3})/);
      if (scoreM) {
        flatMap['英语分数'] = flatMap['英语成绩'] = scoreM[1];
        flatMap['四六级成绩'] = scoreM[1];
      }
    }

    // ⑦ 教育经历深度拆解 (支持硕士/本科多段，入学/毕业年/月分离)
    const eduList = Array.isArray(resume['教育经历']) ? resume['教育经历'] : [];
    eduList.forEach((edu, idx) => {
      const prefix = idx === 0 ? '最高学历' : (idx === 1 ? '本科' : `教育${idx}`);
      const school = edu['学校'] || '';
      const major = edu['专业'] || '';
      const degree = edu['学历'] || '';
      const start = edu['开始时间'] || edu['开始年月'] || '';
      const end = edu['结束时间'] || edu['结束年月'] || '';

      if (school) {
        flatMap[`${prefix}学校`] = school;
        if (idx === 0) {
          flatMap['学校'] = flatMap['毕业院校'] = flatMap['就读学校'] = school;
        }
      }
      if (major) {
        flatMap[`${prefix}专业`] = major;
        if (idx === 0) flatMap['专业'] = flatMap['所学专业'] = major;
      }
      if (degree) {
        flatMap[`${prefix}学历`] = degree;
        if (idx === 0) {
          flatMap['学历'] = flatMap['最高学历'] = degree;
          flatMap['学位'] = /硕士|研究生/.test(degree) ? '硕士' : (/博士/.test(degree) ? '博士' : '学士');
        }
      }
      if (start) {
        const sm = start.match(/(\d{4})[^\d]?(\d{1,2})?/);
        if (sm) {
          flatMap[`${prefix}入学年份`] = flatMap[`${prefix}入学年`] = sm[1];
          if (sm[2]) flatMap[`${prefix}入学月份`] = sm[2].padStart(2, '0');
          if (idx === 0) {
            flatMap['入学年份'] = flatMap['入学年'] = sm[1];
            if (sm[2]) flatMap['入学月份'] = flatMap['入学月'] = sm[2].padStart(2, '0');
            flatMap['入学时间'] = flatMap['入学年月'] = start;
          }
        }
      }
      if (end) {
        const em = end.match(/(\d{4})[^\d]?(\d{1,2})?/);
        if (em) {
          flatMap[`${prefix}毕业年份`] = flatMap[`${prefix}毕业年`] = em[1];
          if (em[2]) flatMap[`${prefix}毕业月份`] = em[2].padStart(2, '0');
          if (idx === 0) {
            flatMap['毕业年份'] = flatMap['毕业年'] = em[1];
            if (em[2]) flatMap['毕业月份'] = flatMap['毕业月'] = em[2].padStart(2, '0');
            flatMap['毕业时间'] = flatMap['毕业年月'] = end;
          }
        }
      }
    });

    // ⑧ 不再注入任何捏造默认值：一键填充只写用户在简历中真实填写（或由实填数据安全衍生）的字段，
    //    避免把 民族/政治面貌/婚姻状况/邮编/应聘理由 等用户未确认的资料填进真实网申。
    //    空简历时 flatMap 为空，由调用方（autoFillPageForm）提示“请先在看板配置简历”。

    return flatMap;
  }

  // 过滤 name/id 里的随机 token（field_123 / input1384 / 纯数字 / hex 串），避免当作字段标签
  function isNoiseToken(s) {
    const t = String(s || '').trim();
    if (!t) return true;
    if (/^\d+$/.test(t)) return true;
    if (/^[0-9a-f]{6,}$/i.test(t)) return true;
    if (/\d{2,}\s*$/.test(t)) return true;
    if (/^(?:field|input|item|node|el|txt|text)[_-]?\d*$/i.test(t)) return true;
    return false;
  }

  function extractFieldLabelCandidates(el) {
    if (!el) return { best: '', candidates: [] };
    const tier1 = []; // 可靠：可见 label / 语义属性（优先）
    const tier2 = []; // 兜底：name/id/title 等易噪属性
    const push = (arr, raw) => { if (raw && typeof raw === 'string') arr.push(raw); };

    // 0. Formily / UD-Design（字节跳动校招等）：字段自身或最近容器带 data-form-field-i18n-name（人类可读中文标签，最稳定）
    //    这类站点 input 无 placeholder/name/id/aria-label，且容器类名为 ud-formily-item（不含子串 form-item），只能靠该属性取标签
    if (el.closest) {
      const i18nEl = el.closest('[data-form-field-i18n-name]');
      if (i18nEl) {
        const v = i18nEl.getAttribute('data-form-field-i18n-name');
        if (v && v.trim()) push(tier1, v.trim());
      }
    }

    // 1. label[for=id]
    if (el.id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl && lbl.innerText) push(tier1, lbl.innerText);
      } catch (_) {}
    }

    // 2. aria-labelledby
    const labelledBy = el.getAttribute ? el.getAttribute('aria-labelledby') : null;
    if (labelledBy) {
      try {
        const lbl = document.getElementById(labelledBy);
        if (lbl && lbl.innerText) push(tier1, lbl.innerText);
      } catch (_) {}
    }

    // 3. 最近的“紧”字段容器的 label（排除 tr/td/table 与大 form-group，避免整组共用首个 label）
    const wrap = el.closest ? el.closest(`
      .form-item, .el-form-item, .ant-form-item, .semi-form-field, .next-form-item, .arco-form-item,
      .moka-form-item, .beisen-form-item, .dayee-form-item, .item-wrap, .field-wrap, .form-row, .form-line,
      [class*="form-item" i], [class*="formItem" i], [class*="form-field" i], [class*="formField" i], [class*="field-wrap" i]
    `) : null;
    if (wrap) {
      const fieldCount = wrap.querySelectorAll('input, select, textarea').length;
      const labelSel = 'label, [class*="label" i], .ant-form-item-label, .el-form-item__label, .semi-form-field-label, .next-form-item-label, th';
      const lbl = fieldCount <= 1
        ? wrap.querySelector(labelSel)                                   // 紧容器：取其内首个 label
        : wrap.querySelector(':scope > label, :scope > [class*="label" i]'); // 宽容器：只取直接 label
      if (lbl && lbl.innerText) push(tier1, lbl.innerText);
    }

    // 4. 紧邻前置兄弟文本（如 <span>姓名:</span><input> 或 <th>毕业院校</th>）
    let prev = el.previousElementSibling;
    let hops = 0;
    while (prev && hops < 3) {
      if (['LABEL', 'SPAN', 'DIV', 'STRONG', 'P', 'TH', 'B', 'EM'].includes(prev.tagName)) {
        const txt = (prev.innerText || prev.textContent || '').trim();
        if (txt && txt.length <= 30) { push(tier1, txt); break; }
      }
      prev = prev.previousElementSibling;
      hops += 1;
    }

    // 5. 语义属性：用户可见文本(placeholder/aria-label)优先，再 ATS 语义标识（含字节 atsx 的 data-test/data-cy），最后技术属性
    const semanticAttrs = ['placeholder', 'aria-label', 'data-label', 'data-title', 'data-field-name', 'data-test', 'data-cy', 'data-field', 'data-key', 'data-name', 'data-id', 'data-role', 'prop', 'data-prop'];
    for (const attr of semanticAttrs) {
      const v = el.getAttribute ? el.getAttribute(attr) : null;
      if (v && v.length >= 2 && v.length <= 40) push(tier1, v);
    }

    // 6. 兜底：name / id / title（过滤随机 token 噪声）
    for (const attr of ['name', 'id', 'title']) {
      const v = el.getAttribute ? el.getAttribute(attr) : null;
      if (v && v.length >= 2 && v.length <= 40 && !isNoiseToken(v)) push(tier2, v);
    }

    // 综合清洗：收集全部有效候选（tier1 优先，再 tier2），best = 第一个
    const candidates = [];
    for (const raw of tier1.concat(tier2)) {
      const cleaned = String(raw)
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/[*＊:：?？!！_]/g, ' ')
        .replace(/^(?:请输入|请选择|请填写|请选取|录入|填写|input|select|enter)\s*/i, '')
        .replace(/\s*(?:必填|选填|optional|required)$/i, '')
        .trim();
      if (cleaned && cleaned.length >= 1 && cleaned.length <= 50 && !candidates.includes(cleaned)) {
        candidates.push(cleaned);
      }
    }
    return { best: candidates[0] || '', candidates };
  }

  // 兼容旧调用：只取最佳标签字符串
  function extractFieldLabel(el) {
    return extractFieldLabelCandidates(el).best;
  }

  // 取单选项自身的可见文本（包裹 label / label[for] / 相邻兄弟），
  // 弥补 extractFieldLabel 常返回整组标签（如“性别”）而非单选项文本（如“男”）导致单选命中率低
  function getRadioOptionText(radio) {
    if (!radio) return '';
    const wrap = radio.closest ? radio.closest('label') : null;
    if (wrap) {
      const txt = (wrap.textContent || '').trim();
      if (txt && txt.length <= 20) return txt;
    }
    if (radio.id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(radio.id)}"]`);
        const txt = (lbl && lbl.textContent || '').trim();
        if (txt && txt.length <= 20) return txt;
      } catch (_) {}
    }
    let sib = radio.nextElementSibling;
    let hops = 0;
    while (sib && hops < 2) {
      const txt = (sib.textContent || '').trim();
      if (txt && txt.length <= 20) return txt;
      sib = sib.nextElementSibling;
      hops += 1;
    }
    return '';
  }

  // 匹配简历值：返回 { value, strong } 或 null。strong=true 表示全等/锚定命中（可信），
  // false 表示包含型弱命中（用于同值防串护栏）。修复“单字键(名/姓)泛匹配 → 全填成姓名”。
  function matchResume(label, flatMap) {
    if (!label || !flatMap) return null;
    const L = String(label).trim();
    if (!L) return null;

    // A) 精确全等（最强）：避免“紧急联系人姓名”被“姓名”抢答
    if (Object.prototype.hasOwnProperty.call(flatMap, L) && flatMap[L]) {
      return { value: flatMap[L], strong: true };
    }

    // B) 同义词规则：锚定(全匹配 ^...$)优先于包含型；同规则内按 keys 顺序取首个存在的值
    let looseHit = null;
    for (const rule of AUTOFILL_FIELD_SYNONYMS) {
      let anchored = false, loose = false;
      for (const pat of rule.patterns) {
        if (!pat.test(L)) continue;
        if (pat.source.charAt(0) === '^') anchored = true; else loose = true;
      }
      if (anchored) {
        for (const k of rule.keys) { if (flatMap[k]) return { value: flatMap[k], strong: true }; }
      } else if (loose && !looseHit) {
        for (const k of rule.keys) { if (flatMap[k]) { looseHit = { value: flatMap[k], strong: false }; break; } }
      }
    }
    if (looseHit) return looseHit;

    // C) 直接键兜底：startsWith / includes，键长必须 >= 2（跳过“名/姓”等单字键），取最长键（最specific）
    let best = null;
    for (const k of Object.keys(flatMap)) {
      const v = flatMap[k];
      if (!v || k.length < 2) continue;
      if (L.startsWith(k) || L.includes(k)) {
        if (!best || k.length > best.klen) best = { value: v, strong: false, klen: k.length };
      }
    }
    return best;
  }

  function findMatchedResumeValue(label, flatMap) {
    const m = matchResume(label, flatMap);
    return m ? m.value : null;
  }

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // 模拟用户真实点击
  function simulateClick(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const evtOpts = { bubbles: true, cancelable: true, view: window, clientX, clientY };

    el.dispatchEvent(new MouseEvent('mousedown', evtOpts));
    el.dispatchEvent(new MouseEvent('mouseup', evtOpts));
    el.dispatchEvent(new MouseEvent('click', evtOpts));
    if (typeof el.focus === 'function') el.focus();
  }

  // 关闭残留打开的下拉弹层
  function closeActiveDropdowns() {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } catch (_) {}
  }

  // 尝试匹配并点击下拉浮层中的选项
  async function pickCustomDropdownOption(targetVal) {
    if (!targetVal) return false;
    await sleep(130); // 等待下拉浮层挂载渲染

    const cleanTarget = String(targetVal).trim().toLowerCase();

    // 寻找页面上处于可见激活状态的下拉浮层容器
    const containerSelectors = [
      '.ud__select__dropdown:not(.ud__select__dropdown-hidden)',
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
      '.ant-cascader-dropdown:not(.ant-cascader-dropdown-hidden)',
      '.el-select-dropdown:not([style*="display: none"])',
      '.el-popper:not([style*="display: none"])',
      '.el-cascader__dropdown:not([style*="display: none"])',
      '[role="listbox"]:not([style*="display: none"])',
      '.select-dropdown:not([style*="display: none"])',
      '.dropdown-menu:not([style*="display: none"])',
      '[class*="dropdown-menu" i]:not([style*="display: none"])',
      '[class*="dropdown-panel" i]:not([style*="display: none"])',
      '[class*="select-options" i]:not([style*="display: none"])',
      '[class*="select_dropdown" i]:not([style*="display: none"])',
      '[class*="selectDropdown" i]:not([style*="display: none"])'
    ];

    let activeDropdowns = [];
    for (const sel of containerSelectors) {
      const els = Array.from(document.querySelectorAll(sel)).filter(d => {
        if (d.closest('#autumn-job-assistant-host')) return false;
        const rect = d.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (els.length > 0) activeDropdowns.push(...els);
    }

    if (activeDropdowns.length === 0) {
      activeDropdowns = Array.from(document.querySelectorAll('[role="listbox"], [role="menu"]')).filter(d => {
        if (d.closest('#autumn-job-assistant-host')) return false;
        const rect = d.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    }

    if (activeDropdowns.length === 0) return false;

    // 获取最新激活的下拉框容器
    const dropdown = activeDropdowns[activeDropdowns.length - 1];

    // 1. 如果下拉浮层内有搜索输入框，先尝试输入过滤
    const searchInput = dropdown.querySelector('input[type="text"], input[type="search"], .ant-select-selection-search-input, .el-select__input');
    if (searchInput && !searchInput.readOnly) {
      const proto = HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(searchInput, targetVal);
      else searchInput.value = targetVal;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(150); // 等待过滤
    }

    // 2. 查找选项节点
    const optionSelectors = [
      '.ud__select__list__item__content',
      '.ud__select__list__item',
      '.ant-select-item-option-content',
      '.ant-select-item-option',
      '.ant-cascader-menu-item',
      '.el-select-dropdown__item',
      '.el-cascader-node',
      '[role="option"]',
      'li[class*="option" i]',
      'div[class*="option" i]',
      'li',
      'span'
    ];

    let optionNodes = [];
    for (const sel of optionSelectors) {
      const items = Array.from(dropdown.querySelectorAll(sel)).filter(item => {
        const txt = (item.textContent || '').trim();
        return txt.length > 0 && txt.length < 50;
      });
      if (items.length > 0) {
        optionNodes = items;
        break;
      }
    }

    // 3. 匹配选项文本
    let bestOption = null;

    // ① 精确匹配
    for (const opt of optionNodes) {
      const txt = (opt.textContent || '').trim().toLowerCase();
      if (txt === cleanTarget) {
        bestOption = opt;
        break;
      }
    }

    // ② 包含 / 被包含匹配
    if (!bestOption) {
      for (const opt of optionNodes) {
        const txt = (opt.textContent || '').trim().toLowerCase();
        if (txt.includes(cleanTarget) || (cleanTarget.length >= 2 && cleanTarget.includes(txt))) {
          bestOption = opt;
          break;
        }
      }
    }

    // ③ 虚拟滚动兜底：rc-virtual-list 只渲染可视行，逐步滚动 holder 再找目标选项（字节 UD 等长列表下拉）
    if (!bestOption) {
      const holder = dropdown.querySelector('.rc-virtual-list-holder, [class*="virtual-list-holder" i], [class*="virtualList" i]');
      if (holder && holder.scrollHeight > holder.clientHeight) {
        const optSel = '.ud__select__list__item__content, .ud__select__list__item, [role="option"], li[class*="option" i], div[class*="option" i]';
        for (let s = 1; s <= 6 && !bestOption; s++) {
          holder.scrollTop = (holder.scrollHeight - holder.clientHeight) * (s / 6);
          holder.dispatchEvent(new Event('scroll', { bubbles: true }));
          await sleep(90);
          for (const opt of Array.from(dropdown.querySelectorAll(optSel))) {
            const txt = (opt.textContent || '').trim().toLowerCase();
            if (!txt || txt.length >= 50) continue;
            if (txt === cleanTarget || txt.includes(cleanTarget) || (cleanTarget.length >= 2 && cleanTarget.includes(txt))) { bestOption = opt; break; }
          }
        }
      }
    }

    if (bestOption) {
      simulateClick(bestOption);
      await sleep(100);
      return true;
    }

    // 未匹配到，收起弹层
    closeActiveDropdowns();
    return false;
  }

  function setSelectFieldValue(el, targetVal) {
    if (!el || !targetVal) return false;
    const cleanTarget = String(targetVal).trim().toLowerCase();
    let matchedIndex = -1;

    for (let i = 0; i < el.options.length; i++) {
      const optText = el.options[i].text.trim().toLowerCase();
      const optVal = el.options[i].value.trim().toLowerCase();
      if (!optText && !optVal) continue;
      if (optText === cleanTarget || optVal === cleanTarget || optText.includes(cleanTarget) || (cleanTarget.length >= 2 && cleanTarget.includes(optText))) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex >= 0) {
      el.selectedIndex = matchedIndex;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  // ================= AI 辅助填写支撑：统一填充引擎 / 字段扫描 / 分组标签 / 高亮 / 简历适配 =================
  // 以下 setElementValue、scanFillableFields、highlight、日期/级联处理等思路移植自 MIT 项目 Resume Pro，
  // 用于在规则填充之后，对仍未命中的字段做 AI 补全（AI 需用户在侧边栏显式开启）。

  function inferPickerInputType(container, inner) {
    const cls = container.className || '';
    const ph = (inner.getAttribute('placeholder') || '').toLowerCase();
    if (/range/i.test(cls) || /range/i.test(ph)) return 'daterange';
    if (/time/i.test(cls) || /时间|hh:mm/.test(ph)) return 'time';
    if (/month/i.test(cls) || /年月|月份|month/.test(ph)) return 'month';
    if (/datetime/i.test(cls) || /日期.*时间|datetime/.test(ph)) return 'datetime-local';
    return 'date';
  }

  function findNearestGroupLabel(element) {
    const sectionSelectors = ['fieldset', "[role='group']", '.form-item', '.ant-form-item', '.el-form-item', '.semi-form-field', 'tr', 'li', 'section', 'td'];
    for (const selector of sectionSelectors) {
      const container = element.closest ? element.closest(selector) : null;
      if (!container) continue;
      const labelCandidate = container.querySelector('legend, label, th, .label, .form-label, .ant-form-item-label, .el-form-item__label');
      const text = (labelCandidate && labelCandidate.textContent || '').trim().replace(/[*\s]+$/g, '').trim();
      if (text && text.length < 40) return text;
    }
    return '';
  }

  // 统一填充引擎：radio / 原生日期时间 / 自定义日期选择器 / input / textarea / select / contentEditable
  function setElementValue(entry, value) {
    if (!entry) return false;
    const H = (typeof AJA !== 'undefined' && AJA.AIHelpers) || null;
    if (entry.kind === 'radio') {
      const tv = String(value || '').trim();
      const matched = entry.elements.find(r => getRadioOptionText(r) === tv || (r.value || '').trim() === tv);
      if (!matched) return false;
      matched.checked = true;
      matched.dispatchEvent(new Event('input', { bubbles: true }));
      matched.dispatchEvent(new Event('change', { bubbles: true }));
      try { matched.click(); } catch (_) {}
      return true;
    }
    let el = entry.kind === 'element' ? entry.element : entry;
    if (!el) return false;
    const pickerType = entry.pickerType || null;
    const pickerInputType = entry.pickerInputType || 'date';

    if (el instanceof HTMLInputElement && ['date', 'month', 'datetime-local', 'time'].includes(el.type)) {
      const normalized = H ? H.normalizeDateValue(value, el.type) : value;
      const desc = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
      el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      if (desc && desc.set) desc.set.call(el, normalized); else el.value = normalized;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      return el.value === normalized;
    }
    if (el instanceof HTMLInputElement && (pickerType === 'antd' || pickerType === 'element' || pickerType === 'generic')) {
      const normalized = H ? H.normalizeDateValue(value, pickerInputType) : value;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return new Promise(resolve => {
        setTimeout(() => {
          try {
            const desc = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
            if (desc && desc.set) desc.set.call(el, normalized); else el.value = normalized;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
          } catch (_) { resolve(false); return; }
          resolve(el.value === normalized);
        }, 150);
      });
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const d = Object.getOwnPropertyDescriptor(proto, 'value');
      if (d && d.set) d.set.call(el, value); else el.value = value;
      if (el._valueTracker) { try { el._valueTracker.setValue(''); } catch (_) {} } // React 受控输入：复位值追踪器，确保触发 onChange 且值不被重置
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el instanceof HTMLSelectElement) {
      if (el.options.length <= 1) { const only = el.options[0]; if (!only || (only.value !== value && only.text.trim() !== String(value).trim())) return false; }
      if (Array.from(el.options).some(o => o.value === value)) el.value = value;
      else { const mo = Array.from(el.options).find(o => o.text.trim() === String(value).trim()); if (!mo) return false; el.value = mo.value; }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el instanceof HTMLElement && el.isContentEditable) { el.textContent = value; el.dispatchEvent(new Event('input', { bubbles: true })); return true; }
    return false;
  }

  // 写后校验：值是否真的留住了（受控框架可能异步重置）。只判"是否非空/已选中"，容忍站点掩码/格式化改写
  function verifyEntryValue(entry, val) {
    if (!entry) return false;
    if (entry.kind === 'radio') {
      const tv = String(val || '').trim();
      return entry.elements.some(r => {
        if (!r.checked) return false;
        const opt = getRadioOptionText(r) || '';
        const rv = (r.value || '').trim();
        return opt === tv || rv === tv || (opt && (opt.includes(tv) || (tv.length >= 2 && tv.includes(opt))));
      });
    }
    const el = entry.element;
    if (!el) return false;
    if (el instanceof HTMLSelectElement) return el.selectedIndex > 0 && !!el.value;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return (el.value || '').trim().length > 0;
    if (el instanceof HTMLElement && el.isContentEditable) return (el.textContent || '').trim().length > 0;
    return false;
  }

  // 加强重试：更完整的事件序列（focus + 原生 setter + _valueTracker 复位 + keydown/input/keyup/change/blur）
  async function refillEnhanced(entry, val) {
    if (!entry) return false;
    if (entry.kind === 'radio') {
      const tv = String(val || '').trim();
      const r = entry.elements.find(x => getRadioOptionText(x) === tv || (x.value || '').trim() === tv);
      if (!r) return false;
      try { r.focus(); } catch (_) {}
      r.checked = true;
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
      try { r.click(); } catch (_) {}
      return true;
    }
    const el = entry.element;
    if (!el) return false;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      try {
        el.focus();
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const d = Object.getOwnPropertyDescriptor(proto, 'value');
        if (d && d.set) d.set.call(el, val); else el.value = val;
        if (el._valueTracker) { try { el._valueTracker.setValue(''); } catch (_) {} }
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        return true;
      } catch (_) { return false; }
    }
    return await setElementValue(entry, val);
  }

  function isFieldEmpty(entry) {
    if (!entry) return false;
    if (entry.kind === 'radio') return !entry.elements.some(r => r.checked);
    const el = entry.element;
    if (!el) return false;
    if (el instanceof HTMLSelectElement) return !(el.selectedIndex > 0 && el.value && el.value.trim());
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return !(el.value && el.value.trim());
    if (el instanceof HTMLElement && el.isContentEditable) return !(el.textContent && el.textContent.trim());
    return true;
  }

  // ================= 阶段1：富字段上下文采集（供 AI 表单理解；不改变规则填充行为）=================
  // 判定控件类型：text/textarea/select-native/select-custom/radio/checkbox/date/daterange/cascader/contenteditable
  function detectFieldKind(el, meta) {
    if (!el) return 'text';
    if (el.isContentEditable) return 'contenteditable';
    const tag = (el.tagName || '').toLowerCase();
    const type = String((el.getAttribute && el.getAttribute('type')) || el.type || '').toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select-native';
    if (type === 'radio') return 'radio';
    if (type === 'checkbox') return 'checkbox';
    if (el.closest && el.closest('[class*="cascader" i]')) return 'cascader';
    if (meta && meta.pickerType) return (meta.pickerInputType === 'daterange' ? 'daterange' : 'date');
    if (el.closest && el.closest('.ud__select, .ant-select, .el-select, .semi-select, .arco-select')) return 'select-custom';
    const role = el.getAttribute && el.getAttribute('role');
    if (role === 'combobox' || (type === 'search' && el.readOnly)) return 'select-custom';
    if (/^(date|month|week|time|datetime-local)$/.test(type)) return 'date';
    return 'text';
  }

  // 字段所属区块标题（如“教育经历”），供 AI 理解上下文；找不到返回 ''
  function findFieldSection(el) {
    if (!el || !el.closest) return '';
    const sec = el.closest('[class*="applyFormModuleWrapper"], fieldset, [class*="form-section" i], [class*="section-card" i], section');
    if (!sec) return '';
    const t = sec.querySelector('[class*="applyFormModuleWrapper-title"], [class*="applyFormModuleWrapper-text"], legend, h1, h2, h3, h4, [class*="section-title" i], [class*="title" i]');
    const txt = ((t && (t.innerText || t.textContent)) || '').replace(/\s+/g, ' ').trim();
    return (txt && txt.length <= 30) ? txt : '';
  }

  // 字段容器 outerHTML 片段（截断 ~300 + 脱敏），供 AI 读懂结构；不含任何已填值/密码
  function buildFieldSnippet(el) {
    if (!el) return '';
    const box = (el.closest && el.closest('.ud-formily-item, [class*="form-item" i], [class*="form-field" i], .form-group, label')) || el.parentElement || el;
    let html = '';
    try { html = box.outerHTML || ''; } catch (_) { return ''; }
    html = html
      .replace(/\svalue\s*=\s*"[^"]*"/gi, ' value=""')
      .replace(/<input([^>]*?)type\s*=\s*["']?password["']?[^>]*>/gi, '<input type="password">');
    return html.replace(/\s+/g, ' ').slice(0, 300);
  }

  // 采集单个字段的富上下文（FieldContext）
  function collectFieldContext(el, meta) {
    meta = meta || {};
    const lab = extractFieldLabelCandidates(el);
    const A = (n) => ((el.getAttribute && el.getAttribute(n)) || '');
    let options = [];
    if ((el.tagName || '').toLowerCase() === 'select') options = Array.from(el.options || []).map(o => (o.text || '').trim()).filter(Boolean);
    else if (Array.isArray(meta.radioOptions)) options = meta.radioOptions;
    return {
      kind: detectFieldKind(el, meta),
      bestLabel: lab.best,
      labelCandidates: lab.candidates,
      section: findFieldSection(el),
      attrs: {
        placeholder: A('placeholder'), ariaLabel: A('aria-label'), name: A('name'), id: el.id || '',
        dataTest: A('data-test') || A('data-cy'), i18nName: A('data-form-field-i18n-name'),
        type: String((el.getAttribute && el.getAttribute('type')) || el.type || ''), role: A('role'),
        required: !!(el.required || A('aria-required') === 'true')
      },
      options,
      snippet: buildFieldSnippet(el),
      isEmpty: meta.radioElements ? isFieldEmpty({ kind: 'radio', elements: meta.radioElements }) : isFieldEmpty({ kind: 'element', element: el })
    };
  }

  // 扫描可填写字段（原生 input/textarea/select/radio + 日期选择器），为每个字段分配 fieldId 与元数据，供 AI 匹配
  function scanFillableFields() {
    const fieldMap = new Map();
    const fields = [];
    const radioGroups = new Set();
    const visible = (el) => {
      if (!el || (el.closest && el.closest('#autumn-job-assistant-host'))) return false;
      const type = ((el.getAttribute && el.getAttribute('type')) || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(type)) return false;
      if (el.disabled) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const candidates = Array.from(document.querySelectorAll('input, textarea, select')).filter(visible);
    candidates.forEach((element, index) => {
      if (element instanceof HTMLInputElement && element.type === 'radio') {
        const groupName = element.name || `__radio__${index}`;
        if (radioGroups.has(groupName)) return;
        radioGroups.add(groupName);
        const radioEls = candidates.filter(c => c instanceof HTMLInputElement && c.type === 'radio' && (c.name || `__radio__${index}`) === groupName);
        const fieldId = `field-radio-${fields.length}`;
        fieldMap.set(fieldId, { kind: 'radio', elements: radioEls });
        fields.push({ fieldId, label: extractFieldLabel(element), placeholder: '', name: groupName, idAttr: '', ariaLabel: element.getAttribute('aria-label') || '', tagName: 'input', inputType: 'radio', options: radioEls.map(getRadioOptionText).filter(Boolean), group: findNearestGroupLabel(element), ctx: collectFieldContext(element, { radioOptions: radioEls.map(getRadioOptionText).filter(Boolean), radioElements: radioEls }) });
        return;
      }
      const fieldId = `field-${fields.length}`;
      fieldMap.set(fieldId, { kind: 'element', element });
      fields.push({
        fieldId, label: extractFieldLabel(element), placeholder: element.getAttribute('placeholder') || '',
        name: element.getAttribute('name') || '', idAttr: element.id || '', ariaLabel: element.getAttribute('aria-label') || '',
        tagName: element.tagName.toLowerCase(),
        inputType: element instanceof HTMLInputElement ? (element.type || 'text') : element.tagName.toLowerCase(),
        options: element instanceof HTMLSelectElement ? Array.from(element.options).map(o => o.text.trim()).filter(Boolean) : [],
        group: findNearestGroupLabel(element),
        ctx: collectFieldContext(element, {})
      });
    });
    const pickerSelectors = [{ selector: '.ant-picker', pickerType: 'antd' }, { selector: '.el-date-editor', pickerType: 'element' }, { selector: "[class*='date-picker']", pickerType: 'generic' }, { selector: "[class*='range-picker' i]", pickerType: 'generic' }, { selector: "[class*='date-range' i]", pickerType: 'generic' }];
    pickerSelectors.forEach(({ selector, pickerType }) => {
      document.querySelectorAll(selector).forEach(container => {
        if (container.closest && container.closest('#autumn-job-assistant-host')) return;
        Array.from(container.querySelectorAll("input:not([type='hidden']):not([disabled])")).forEach(inner => {
          if (!visible(inner)) return;
          const pickerInputType = inferPickerInputType(container, inner);
          const existing = Array.from(fieldMap.entries()).find(([, v]) => v.element === inner);
          if (existing) {
            const [eid, ev] = existing;
            ev.pickerType = pickerType; ev.pickerInputType = pickerInputType;
            const ef = fields.find(f => f.fieldId === eid);
            if (ef) { ef.inputType = 'date-picker'; ef.pickerType = pickerType; ef.pickerInputType = pickerInputType; if (ef.ctx) ef.ctx.kind = (pickerInputType === 'daterange' ? 'daterange' : 'date'); }
            return;
          }
          const fieldId = `field-${fields.length}`;
          fieldMap.set(fieldId, { kind: 'element', element: inner, pickerType, pickerInputType });
          fields.push({ fieldId, label: extractFieldLabel(inner), placeholder: inner.getAttribute('placeholder') || '', name: inner.getAttribute('name') || '', idAttr: inner.id || '', ariaLabel: inner.getAttribute('aria-label') || '', tagName: 'input', inputType: 'date-picker', pickerType, pickerInputType, options: [], group: findNearestGroupLabel(inner), ctx: collectFieldContext(inner, { pickerType, pickerInputType }) });
        });
      });
    });
    if (typeof AJA !== 'undefined' && AJA.AIHelpers && AJA.AIHelpers.detectCascadeGroups) AJA.AIHelpers.detectCascadeGroups(fields, fieldMap);
    return { fields, fieldMap };
  }

  // 把网页版同步来的简历 JSON 转成 [{group,key,value}]，供 AI 匹配（数组段按 段名+序号 分组以保留多段上下文）
  function buildResumeFieldsForAI(resume) {
    const out = [];
    if (!resume || typeof resume !== 'object') return out;
    for (const [section, data] of Object.entries(resume)) {
      if (!data) continue;
      if (Array.isArray(data)) {
        data.forEach((item, idx) => {
          if (!item || typeof item !== 'object') return;
          const g = `${section}${idx + 1}`;
          for (const [k, v] of Object.entries(item)) {
            if (k.startsWith('_') || v === undefined || v === null || String(v).trim() === '') continue;
            out.push({ group: g, key: k, value: String(v).trim() });
          }
        });
      } else if (typeof data === 'object') {
        for (const [k, v] of Object.entries(data)) {
          if (v === undefined || v === null || String(v).trim() === '') continue;
          out.push({ group: section, key: k, value: String(v).trim() });
        }
      }
    }
    return out;
  }

  // 填充高亮：规则=绿、AI=琥珀（提示重点复核）
  const AJA_HIGHLIGHT_STYLE_ID = 'aja-field-highlight-style';
  function ensureHighlightStyle() {
    if (document.getElementById(AJA_HIGHLIGHT_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = AJA_HIGHLIGHT_STYLE_ID;
    style.textContent = `
      .aja-fill-rule { animation: aja-fill-rule 2.4s ease-out forwards !important; outline: 2px solid rgba(22,163,74,.9) !important; outline-offset: 2px !important; background-color: rgba(22,163,74,.08) !important; }
      .aja-fill-ai { animation: aja-fill-ai 3.4s ease-out forwards !important; outline: 2px solid rgba(217,119,6,.95) !important; outline-offset: 2px !important; box-shadow: 0 0 0 4px rgba(217,119,6,.14) !important; background-color: rgba(217,119,6,.1) !important; }
      @keyframes aja-fill-rule { 0%{outline-color:rgba(22,163,74,.9)} 70%{outline-color:rgba(22,163,74,.55)} 100%{outline-color:rgba(22,163,74,0);background-color:transparent} }
      @keyframes aja-fill-ai { 0%{outline-color:rgba(217,119,6,.95)} 75%{outline-color:rgba(217,119,6,.7)} 100%{outline-color:rgba(217,119,6,0);background-color:transparent} }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
  function getHighlightTargets(entry, value) {
    if (!entry) return [];
    if (entry.kind === 'radio') {
      const tv = String(value || '').trim();
      const mr = entry.elements.find(r => getRadioOptionText(r) === tv || (r.value || '').trim() === tv);
      if (!mr) return [];
      return [(mr.labels && mr.labels[0]) || (mr.closest && mr.closest('label')) || mr];
    }
    const el = entry.element;
    if (!(el instanceof HTMLElement)) return [];
    if (entry.pickerType) return [(el.closest && el.closest('.ant-picker, .el-date-editor, [class*="date-picker"]')) || el];
    return [el];
  }
  function isInViewport(el) {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= (window.innerHeight || document.documentElement.clientHeight) && r.right <= (window.innerWidth || document.documentElement.clientWidth);
  }
  function highlightFilledField(entry, value, variant) {
    const cls = variant === 'ai' ? 'aja-fill-ai' : 'aja-fill-rule';
    getHighlightTargets(entry, value).forEach(t => {
      if (!(t instanceof HTMLElement)) return;
      if (!isInViewport(t)) { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {} }
      t.classList.remove(cls); void t.offsetWidth; t.classList.add(cls);
      setTimeout(() => t.classList.remove(cls), variant === 'ai' ? 3600 : 2600);
    });
  }

  async function autoFillPageForm() {
    const autofillBtn = AJA.ui && AJA.ui.autofillBtn;
    if (!autofillBtn || autofillBtn.disabled) return;
    const origBtnHtml = autofillBtn.innerHTML;
    autofillBtn.disabled = true;
    autofillBtn.innerHTML = `<span>⏳</span><span>正在智能填充...</span>`;

    try {
      const flatMap = buildResumeFlatMap(currentResumeData);
      if (Object.keys(flatMap).length === 0) {
        showToast('⚠️ 插件里还没有简历：请打开网页版 →「我的简历」填写并保存，然后刷新本页重试');
        if (typeof AJA !== 'undefined' && AJA.refreshResumeStatus) AJA.refreshResumeStatus();
        return;
      }

      let filledCount = 0;
      let skippedCount = 0;
      const processedElements = new Set();
      const processedRadios = new Set();
      const ruleAttempts = []; // 规则初次设值的字段，待写后校验（受控框架可能异步重置）
      // 同值防串护栏：同一个简历值最多弱命中写入 MAX_SAME_VALUE 个字段，超出则拒绝（防“整页填成一个值”）
      const MAX_SAME_VALUE = 3;
      const valueUseCount = new Map();
      const allowValue = (val, strong) => {
        const n = valueUseCount.get(val) || 0;
        if (n >= MAX_SAME_VALUE && !strong) return false;
        valueUseCount.set(val, n + 1);
        return true;
      };
      ensureHighlightStyle();

      // ================= 阶段 1: 常规表单项快速填充 (Input, Textarea, Select, Radio) =================
      const allElements = Array.from(document.querySelectorAll('input, textarea, select')).filter(el => {
        if (el.closest('#autumn-job-assistant-host')) return false;
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(type)) return false;
        if (el.disabled) return false;
        
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        if (el.offsetParent === null && style.position !== 'fixed') return false;

        return true;
      });

      for (const el of allElements) {
        const type = (el.getAttribute('type') || el.type || '').toLowerCase();

        // 1. 单选框 (Radio)
        if (type === 'radio') {
          const name = el.name;
          if (name && processedRadios.has(name)) continue;
          
          const label = extractFieldLabel(el);
          const m = matchResume(label, flatMap); let val = m ? m.value : null; if (val && !allowValue(val, m.strong)) val = null;
          if (val) {
            const group = name ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)) : [el];
            let checkedAny = false;
            for (const r of group) {
              const rLabel = extractFieldLabel(r);
              const rOption = getRadioOptionText(r);
              const rVal = r.value || '';
              if (
                (rOption && (rOption === val || rOption.includes(val) || (val.length >= 2 && val.includes(rOption)))) ||
                rLabel.includes(val) || val.includes(rLabel) || rVal === val
              ) {
                r.checked = true;
                r.dispatchEvent(new Event('change', { bubbles: true }));
                r.dispatchEvent(new Event('input', { bubbles: true }));
                checkedAny = true;
                break;
              }
            }
            if (checkedAny) {
              if (name) processedRadios.add(name);
              ruleAttempts.push({ entry: { kind: 'radio', elements: group }, val });
            } else {
              skippedCount++;
            }
          }
          processedElements.add(el);
          continue;
        }

        // 2. 原生 Select 下拉框
        if (el instanceof HTMLSelectElement) {
          if (el.selectedIndex > 0 && el.value && el.value.trim() !== '') {
            skippedCount++;
            processedElements.add(el);
            continue;
          }
          const label = extractFieldLabel(el);
          const m = matchResume(label, flatMap); let val = m ? m.value : null; if (val && !allowValue(val, m.strong)) val = null;
          if (val) {
            const ok = setSelectFieldValue(el, val);
            if (ok) ruleAttempts.push({ entry: { kind: 'element', element: el }, val });
            else skippedCount++;
          } else {
            skippedCount++;
          }
          processedElements.add(el);
          continue;
        }

        // 3. 可写 Input & Textarea
        if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !el.readOnly) {
          if (el.value && el.value.trim().length > 0) {
            skippedCount++;
            processedElements.add(el);
            continue;
          }

          const label = extractFieldLabel(el);
          const m = matchResume(label, flatMap); let val = m ? m.value : null; if (val && !allowValue(val, m.strong)) val = null;
          if (val) {
            const entry = { kind: 'element', element: el };
            const ok = setElementValue(entry, val);
            if (ok) ruleAttempts.push({ entry, val });
            else skippedCount++;
          } else {
            skippedCount++;
          }
          processedElements.add(el);
        }
      }

      // ================= 阶段 2: 现代 UI 自定义下拉选择/弹出选择控件 (AntD/Element/ATS组件) =================
      const customSelectWrappers = Array.from(document.querySelectorAll(`
        .ant-select:not(.ant-select-disabled),
        .el-select:not(.is-disabled),
        .ant-cascader:not(.ant-cascader-disabled),
        .el-cascader:not(.is-disabled),
        .ud__select:not(.ud__select--disabled),
        [role="combobox"]:not([aria-disabled="true"]),
        [aria-haspopup="listbox"]:not([disabled]),
        [class*="custom-select" i],
        [class*="select-trigger" i],
        [class*="select_trigger" i],
        [class*="selectTrigger" i],
        input[readonly]:not([type="hidden"]):not([type="button"])
      `)).filter(el => {
        if (el.closest('#autumn-job-assistant-host')) return false;
        if (processedElements.has(el)) return false;
        
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;

        // 检查是否已有已选择的内容（排除占位词）
        const text = (el.textContent || el.value || '').trim();
        if (text && !/^(?:请选择|选择|请选取|select|click\s*to\s*select)/i.test(text) && text.length >= 2) {
          return false;
        }

        return true;
      });

      for (const customEl of customSelectWrappers) {
        if (processedElements.has(customEl)) continue; // 父级 .ud__select 等已处理并登记内部 input，跳过重复
        const label = extractFieldLabel(customEl);
        const m = matchResume(label, flatMap);
        let val = m ? m.value : null;
        if (val && !allowValue(val, m.strong)) val = null;
        if (val) {
          const trigger = customEl.querySelector('.ud__select__selector, .ant-select-selector, .el-select__wrapper, .el-input__inner, [class*="trigger" i], input') || customEl;
          simulateClick(trigger);
          const ok = await pickCustomDropdownOption(val);
          await sleep(50);
          const inner = customEl.querySelector('input');
          const shown = ((inner && inner.value) || customEl.textContent || customEl.value || '').trim();
          const reverted = !!shown && !shown.includes(val) && !val.includes(shown) && !/^(?:请选择|选择|请选取|select)/i.test(shown);
          if (ok && !reverted) {
            filledCount++;
            highlightFilledField({ kind: 'element', element: customEl }, val, 'rule');
          } else {
            skippedCount++;
          }
          processedElements.add(customEl);
          customEl.querySelectorAll('input, textarea').forEach(i => processedElements.add(i)); // 去重内部 input，避免阶段1/2重复处理
          await sleep(60);
        }
      }

      // ================= 写后校验：受控框架可能异步重置，短延时后回读；未留住的加强重试一次 =================
      if (ruleAttempts.length) {
        await sleep(130);
        for (const a of ruleAttempts) {
          if (verifyEntryValue(a.entry, a.val)) {
            filledCount++; highlightFilledField(a.entry, a.val, 'rule');
          } else {
            await refillEnhanced(a.entry, a.val);
            await sleep(70);
            if (verifyEntryValue(a.entry, a.val)) { filledCount++; highlightFilledField(a.entry, a.val, 'rule'); }
            else skippedCount++;
          }
        }
      }

      // ================= 阶段 3: AI 补全（仅规则未命中、仍为空、非高风险字段；需用户在侧边栏显式开启）=================
      let aiCount = 0;
      const aiCfg = (typeof AJA !== 'undefined' && AJA.aiConfig) || null;
      if (aiCfg && aiCfg.enabled && aiCfg.apiUrl && aiCfg.model && aiCfg.apiKey) {
        try {
          ensureHighlightStyle();
          const H = AJA.AIHelpers || null;
          const { fields, fieldMap } = scanFillableFields();
          const residual = fields.filter(f => !(H && H.shouldSkipAIForField(f)) && isFieldEmpty(fieldMap.get(f.fieldId)));
          if (residual.length) {
            const resumeFields = buildResumeFieldsForAI(currentResumeData);
            const resp = await chrome.runtime.sendMessage({
              type: AJA.MSG.AI_FILL, formFields: residual, resumeFields,
              aiConfig: { apiUrl: aiCfg.apiUrl, model: aiCfg.model, apiKey: aiCfg.apiKey }
            });
            if (resp && resp.success && Array.isArray(resp.matches) && resp.matches.length) {
              const metaMap = new Map(fields.map(f => [f.fieldId, f]));
              const sorted = [...resp.matches].sort((a, b) => {
                const ma = metaMap.get(a.fieldId), mb = metaMap.get(b.fieldId);
                if (ma && ma.cascadeGroup !== undefined && ma.cascadeGroup === (mb && mb.cascadeGroup)) return (ma.cascadeLevel || 0) - (mb.cascadeLevel || 0);
                return 0;
              });
              for (const match of sorted) {
                const entry = fieldMap.get(match.fieldId);
                if (!entry) continue;
                const meta = metaMap.get(match.fieldId);
                let ok = await setElementValue(entry, match.value);
                if (!ok && entry.kind === 'element' && entry.element instanceof HTMLSelectElement && meta && meta.cascadeGroup !== undefined) {
                  for (let t = 0; t < 3 && !ok; t++) { await sleep(100); ok = await setElementValue(entry, match.value); }
                }
                if (ok) { aiCount++; highlightFilledField(entry, match.value, 'ai'); }
                if (ok && meta && meta.cascadeGroup !== undefined) await sleep(250);
              }
            } else if (resp && !resp.success && resp.error) {
              showToast(`AI 补全未完成：${resp.error}`);
            }
          }
        } catch (e) {
          showToast('AI 补全请求失败：' + ((e && e.message) || '未知错误'));
        }
      }

      if (filledCount > 0 || aiCount > 0) {
        showToast(`⚡ 已填充 ${filledCount} 项（绿色高亮）` + (aiCount ? `，AI 补全 ${aiCount} 项（琥珀高亮，请复核）` : '') + `，跳过 ${skippedCount} 项`);
      } else {
        showToast(`没有可匹配的空白项（跳过 ${skippedCount} 项）；若字段有值却没匹配上，可在侧边栏开启 AI 辅助填写；折叠区块需先点「添加」展开出输入框再填充`);
      }
    } finally {
      autofillBtn.disabled = false;
      autofillBtn.innerHTML = origBtnHtml;
    }
  }
