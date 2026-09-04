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
    { keys: ['证件号码', '身份证号', '身份证', '证件号'], patterns: [/^身份证(?:号(?:码)?)?$/, /^证件号码$/, /^证件号$/, /^id\s*card$/i, /^id\s*number$/i, /^sfz$/i, /^zjhm$/i, /身份证/i, /证件号/i] },

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
      const nameM = emContact.replace(/(1[3-9]\d{9})|[\(\)（）\s,，]/g, '').trim();
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

  function extractFieldLabel(el) {
    if (!el) return '';
    const candidates = [];

    // 1. ATS 专属属性直锁 (Moka, Beisen, Dayee, Yonyou, 24Talent)
    const atsAttrs = [
      'data-key', 'data-field-name', 'data-name', 'data-title', 'data-label',
      'prop', 'data-prop', 'name', 'id', 'aria-label', 'placeholder', 'title'
    ];
    for (const attr of atsAttrs) {
      const v = el.getAttribute ? el.getAttribute(attr) : null;
      if (v && typeof v === 'string' && v.length >= 2 && v.length <= 40) {
        candidates.push(v);
      }
    }

    // 2. label[for=id]
    if (el.id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl && lbl.innerText) candidates.push(lbl.innerText);
      } catch (_) {}
    }

    // 3. aria-labelledby
    const labelledBy = el.getAttribute ? el.getAttribute('aria-labelledby') : null;
    if (labelledBy) {
      try {
        const lbl = document.getElementById(labelledBy);
        if (lbl && lbl.innerText) candidates.push(lbl.innerText);
      } catch (_) {}
    }

    // 4. 祖先表单容器中的 label / 标题 (全面覆盖各大 ATS 类名)
    const parentContainer = el.closest ? el.closest(`
      .form-item, .form-group, .el-form-item, .ant-form-item, .semi-form-field,
      .next-form-item, .moka-form-item, .beisen-form-item, .dayee-form-item,
      .item-wrap, .field-wrap, .form-row, .form-line, tr, td,
      [class*="form-item" i], [class*="formItem" i], [class*="form-group" i],
      [class*="formGroup" i], [class*="form-field" i], [class*="formField" i]
    `) : null;
    if (parentContainer) {
      const lbl = parentContainer.querySelector(`
        label, [class*="label" i], .ant-form-item-label, .el-form-item__label,
        .semi-form-field-label, .next-form-item-label, th, [class*="title" i], [class*="name" i]
      `);
      if (lbl && lbl.innerText) {
        candidates.push(lbl.innerText);
      }
    }

    // 5. 前置兄弟节点中的文本 (如 <span>姓名:</span><input> 或 <th>毕业院校</th>)
    let prev = el.previousElementSibling;
    while (prev) {
      if (['LABEL', 'SPAN', 'DIV', 'STRONG', 'P', 'TH', 'B'].includes(prev.tagName)) {
        const txt = prev.innerText?.trim();
        if (txt && txt.length <= 30) {
          candidates.push(txt);
          break;
        }
      }
      prev = prev.previousElementSibling;
    }

    // 综合清洗提取
    for (const raw of candidates) {
      const cleaned = String(raw)
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/[*＊:：?？!！_]/g, ' ') // 剔除必填星号、下划线及标点
        .replace(/^(?:请输入|请选择|请填写|录入|填写|input|select)\s*/i, '')
        .replace(/\s*(?:必填|选填|optional|required)$/i, '')
        .trim();
      if (cleaned && cleaned.length >= 1 && cleaned.length <= 50) {
        return cleaned;
      }
    }

    return '';
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

  function findMatchedResumeValue(label, flatMap) {
    if (!label || !flatMap) return null;
    const cleanLabel = label.trim();

    // 1. 直接精确包含或匹配 flatMap 自身的 key
    for (const [k, v] of Object.entries(flatMap)) {
      if (cleanLabel === k || cleanLabel.includes(k) || (k.length >= 2 && cleanLabel.startsWith(k))) {
        if (v) return v;
      }
    }

    // 2. 根据同义词规则库进行模式匹配
    for (const rule of AUTOFILL_FIELD_SYNONYMS) {
      let matched = false;
      for (const pat of rule.patterns) {
        if (pat.test(cleanLabel)) {
          matched = true;
          break;
        }
      }
      if (matched) {
        for (const k of rule.keys) {
          if (flatMap[k]) {
            return flatMap[k];
          }
        }
      }
    }

    return null;
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

  async function autoFillPageForm() {
    const autofillBtn = AJA.ui && AJA.ui.autofillBtn;
    if (!autofillBtn || autofillBtn.disabled) return;
    const origBtnHtml = autofillBtn.innerHTML;
    autofillBtn.disabled = true;
    autofillBtn.innerHTML = `<span>⏳</span><span>正在智能填充...</span>`;

    try {
      const flatMap = buildResumeFlatMap(currentResumeData);
      if (Object.keys(flatMap).length === 0) {
        showToast('⚠️ 简历库为空，请先在看板配置简历');
        return;
      }

      let filledCount = 0;
      let skippedCount = 0;
      const processedElements = new Set();
      const processedRadios = new Set();

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
          const val = findMatchedResumeValue(label, flatMap);
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
              filledCount++;
              if (name) processedRadios.add(name);
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
          const val = findMatchedResumeValue(label, flatMap);
          if (val) {
            const ok = setSelectFieldValue(el, val);
            if (ok) filledCount++;
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
          const val = findMatchedResumeValue(label, flatMap);
          if (val) {
            const proto = (el instanceof HTMLTextAreaElement) ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) {
              setter.call(el, val);
            } else {
              el.value = val;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            filledCount++;
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
        const label = extractFieldLabel(customEl);
        const val = findMatchedResumeValue(label, flatMap);
        if (val) {
          const trigger = customEl.querySelector('.ant-select-selector, .el-select__wrapper, .el-input__inner, [class*="trigger" i], input') || customEl;
          simulateClick(trigger);
          const ok = await pickCustomDropdownOption(val);
          if (ok) {
            filledCount++;
          } else {
            skippedCount++;
          }
          processedElements.add(customEl);
          await sleep(60);
        }
      }

      if (filledCount > 0) {
        showToast(`⚡ 已自动填充 ${filledCount} 项，跳过 ${skippedCount} 项`);
      } else {
        showToast(`未检测到可匹配的空白输入项 (跳过 ${skippedCount} 项)`);
      }
    } finally {
      autofillBtn.disabled = false;
      autofillBtn.innerHTML = origBtnHtml;
    }
  }
