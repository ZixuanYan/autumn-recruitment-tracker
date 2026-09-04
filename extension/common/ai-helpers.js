/**
 * 秋招求职与简历助手 - AI 辅助填写公共助手（全端共享：content scripts 注入 / background importScripts）
 * 挂载到 AJA.AIHelpers。
 *
 * 部分算法（语义推断、AI 输出校验、日期规范化、级联检测）参考并移植自 MIT 许可项目
 * Resume Pro（TshyGO/resume-form-assistant-plugin）的 ai-helpers.js，按其 MIT 许可证保留此出处声明。
 * 本项目仅吸收“字段语义/跳过/校验/日期/级联”等防错件；规则匹配仍用本插件既有的
 * AUTOFILL_FIELD_SYNONYMS + findMatchedResumeValue，简历解析类逻辑未移植（简历来自网页版同步）。
 */
(() => {
  'use strict';
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.AJA = root.AJA || {};

  // 字段语义类型 → 关键词（用于推断某表单字段的语义，支撑跳过/校验/精确匹配）
  const FIELD_SEMANTICS = [
    { type: 'pinyin', keywords: ['拼音', 'pinyin'] },
    { type: 'email', keywords: ['邮箱', 'email', 'e-mail', 'mail'] },
    { type: 'phone', keywords: ['手机', '电话', '联系方式', 'mobile', 'phone', '联系电话'] },
    { type: 'gender', keywords: ['性别', 'gender'] },
    { type: 'birth_date', keywords: ['出生日期', '生日', 'birth', '出生年月'] },
    { type: 'name', keywords: ['姓名', 'name', 'realname'] },
    { type: 'id_number', keywords: ['身份证', '证件号码', '证件号', 'idnumber', '身份证号'] },
    { type: 'hometown', keywords: ['籍贯', '生源地', 'nativeplace', 'hometown'] },
    { type: 'region', keywords: ['国家/地区', '国家地区', 'country', 'region', '地区'] },
    { type: 'major', keywords: ['专业', 'major'] },
    { type: 'school', keywords: ['学校', '院校', '大学', '学院', 'school', 'university'] },
    { type: 'degree', keywords: ['学历', '学位', '培养层次', 'degree'] }
  ];

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[\s:：*（）()【】\[\]\-_/.]+/g, '');
  }

  function inferFieldSemantic(field) {
    const haystack = normalizeText([
      field && field.group,
      field && field.label,
      field && field.placeholder,
      field && field.name,
      field && field.idAttr,
      field && field.ariaLabel
    ].filter(Boolean).join(' '));
    const hit = FIELD_SEMANTICS.find(item => item.keywords.some(kw => haystack.includes(normalizeText(kw))));
    return hit ? hit.type : '';
  }

  // 高风险字段不让 AI 猜：基础强类型走规则精确匹配；结构化下拉（证件/外语/年月/学历等）易错，跳过 AI
  function shouldSkipAIForField(field) {
    const semantic = inferFieldSemantic(field);
    if (['name', 'email', 'phone', 'gender', 'birth_date', 'id_number', 'hometown', 'region', 'pinyin'].includes(semantic)) {
      return true;
    }
    if ((field && (field.inputType === 'select' || field.inputType === 'radio')) && Array.isArray(field && field.options) && field.options.length) {
      const text = normalizeText([
        field && field.label,
        field && field.placeholder,
        field && field.name,
        field && field.ariaLabel
      ].filter(Boolean).join(' '));
      if (/证件类型|外语类型|外语等级|年份|年月|月份|学位|学历|培养层次/.test(text)) {
        return true;
      }
    }
    return false;
  }

  // 校验 AI/规则给出的值对该字段是否合法（防幻觉）：select/radio 值必须是选项之一 + 语义正则
  function isValueValidForField(field, value) {
    const text = String(value == null ? '' : value).trim();
    const semantic = inferFieldSemantic(field);
    if (!text) return false;

    if ((field && (field.inputType === 'select' || field.inputType === 'radio')) &&
        Array.isArray(field && field.options) && field.options.length &&
        (field && field.cascadeGroup) === undefined) {
      const normalizedValue = normalizeText(text);
      const hasOption = field.options.some(option => normalizeText(option) === normalizedValue);
      if (!hasOption) return false;
    }

    switch (semantic) {
      case 'pinyin': return /^[A-Za-z\s]+$/.test(text);
      case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
      case 'phone': return /^[+\d][\d\s-]{6,}$/.test(text);
      case 'birth_date': return /(\d{4}[-/.年]\d{1,2}([-/.月]\d{1,2}日?)?)/.test(text);
      case 'gender': return /(男|女|male|female)/i.test(text);
      case 'id_number': return /^[0-9xX]{8,18}$/.test(text.replace(/\s/g, ''));
      case 'name': return text.length <= 20 && !/@/.test(text) && !/\d{5,}/.test(text);
      case 'hometown': return !/(硕|博|学位|专业|邮箱|电话|手机)/.test(text);
      default: return true;
    }
  }

  function filterValidMatches(formFields, matches) {
    const formFieldMap = new Map((formFields || []).map(field => [field.fieldId, field]));
    return (matches || []).filter(match => {
      const formField = formFieldMap.get(match && match.fieldId);
      if (!formField) return false;
      return isValueValidForField(formField, match.value);
    });
  }

  function pad2(value) {
    return String(Number(value)).padStart(2, '0');
  }

  function parseDateParts(raw) {
    if (/(19|20)\d{2}.+(19|20)\d{2}/.test(raw)) return null;
    const chineseMatch = raw.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?(?:[T\s](\d{1,2}):(\d{1,2}))?/);
    if (chineseMatch) {
      return { year: chineseMatch[1], month: chineseMatch[2], day: chineseMatch[3] || null, hour: chineseMatch[4] != null ? chineseMatch[4] : null, minute: chineseMatch[5] != null ? chineseMatch[5] : null };
    }
    const separatorMatch = raw.match(/^(\d{4})[/\-.](\d{1,2})(?:[/\-.](\d{1,2})(?!\d))?(?:[T\s](\d{1,2}):(\d{1,2}))?/);
    if (separatorMatch) {
      return { year: separatorMatch[1], month: separatorMatch[2], day: separatorMatch[3] || null, hour: separatorMatch[4] != null ? separatorMatch[4] : null, minute: separatorMatch[5] != null ? separatorMatch[5] : null };
    }
    const timeMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
      return { year: null, month: null, day: null, hour: timeMatch[1], minute: timeMatch[2] };
    }
    return null;
  }

  // 把任意日期文本规范化为目标控件所需格式（date/month/time/datetime-local）
  function normalizeDateValue(rawValue, inputType) {
    const raw = String(rawValue == null ? '' : rawValue).trim();
    const parsed = parseDateParts(raw);
    if (!parsed) return raw;
    const { year, month, day, hour, minute } = parsed;
    switch (inputType) {
      case 'date':
        if (!year || !month || !day) return raw;
        return `${year}-${pad2(month)}-${pad2(day)}`;
      case 'month':
        if (!year || !month) return raw;
        return `${year}-${pad2(month)}`;
      case 'time':
        if (hour === null || minute === null) return raw;
        return `${pad2(hour)}:${pad2(minute)}`;
      case 'datetime-local':
        if (!year || !month || !day) return raw;
        return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour == null ? 0 : hour)}:${pad2(minute == null ? 0 : minute)}`;
      default:
        return raw;
    }
  }

  // 省市区等级联下拉识别：同一父容器内多个 select，含地点关键词或后续 select 选项稀疏（依赖前级选择）
  function detectCascadeGroups(fields, fieldMap) {
    const selectFields = (fields || []).filter(f => f.tagName === 'select');
    let cascadeGroupIndex = 0;
    const processedSelectIDs = new Set();
    const locationRegex = /(省|市|区|county|city|province)/i;

    selectFields.forEach(currentField => {
      if (processedSelectIDs.has(currentField.fieldId)) return;
      const currentElement = fieldMap.get(currentField.fieldId) && fieldMap.get(currentField.fieldId).element;
      if (!currentElement) return;

      let parent = currentElement.parentElement;
      let depth = 0;
      while (parent && depth < 5) {
        const validSelectFieldsInParent = selectFields.filter(f => {
          const el = fieldMap.get(f.fieldId) && fieldMap.get(f.fieldId).element;
          return el && parent.contains(el);
        });

        if (validSelectFieldsInParent.length > 1) {
          const hasLocationKeywords = validSelectFieldsInParent.some(f =>
            locationRegex.test(f.name) || locationRegex.test(f.idAttr) || locationRegex.test(f.ariaLabel) || locationRegex.test(f.label));

          let isCascade = hasLocationKeywords;
          if (!isCascade) {
            for (let i = 1; i < validSelectFieldsInParent.length; i++) {
              if (validSelectFieldsInParent[i].options.length <= 1) { isCascade = true; break; }
            }
          }

          if (isCascade) {
            let cascadeSelects;
            if (hasLocationKeywords) {
              cascadeSelects = validSelectFieldsInParent.filter(f =>
                locationRegex.test(f.name) || locationRegex.test(f.idAttr) ||
                locationRegex.test(f.ariaLabel) || locationRegex.test(f.label) ||
                f.options.length <= 1);
            } else {
              const firstSparseIndex = validSelectFieldsInParent.findIndex((f, i) => i > 0 && f.options.length <= 1);
              cascadeSelects = firstSparseIndex > 0
                ? validSelectFieldsInParent.filter((f, i) => i === firstSparseIndex - 1 || (i >= firstSparseIndex && f.options.length <= 1))
                : [];
            }
            if (cascadeSelects.length > 1) {
              cascadeSelects.forEach((f, idx) => {
                f.cascadeGroup = `group-${cascadeGroupIndex}`;
                f.cascadeLevel = idx;
                processedSelectIDs.add(f.fieldId);
              });
              cascadeGroupIndex++;
            }
            break;
          }
        }
        parent = parent.parentElement;
        depth++;
      }
    });
  }

  root.AJA.AIHelpers = {
    normalizeText,
    inferFieldSemantic,
    shouldSkipAIForField,
    isValueValidForField,
    filterValidMatches,
    normalizeDateValue,
    parseDateParts,
    detectCascadeGroups
  };
})();
