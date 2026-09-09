      // ----- 公司维度分组（同公司多岗位）-----
      // 只有一套键：companyGroupKey（保守——只归一化全半角/空格/标点，只剥「法人形式后缀」，保留行业词）。
      // 查重与展示必须共用它，否则会出现自相矛盾：实证过「字节 / 字节跳动」展示合并但查重放行
      // （重复记录被美化成「一家 2 个岗位」），而「小米科技 / 小米智能」展示分成两家却被查重判为重复
      // （两家不同公司被合并）。旧版查重用的是激进的 normalizeCompanySlug（连「科技/网络/智能」这类
      // 行业词也剥），已退役；该函数仍保留，但只服务于邮件建议的模糊匹配。
      // 聚类语义也统一为「相等或互相包含」，与 groupRecordsByCompany 完全一致。
      // v4.9.0：归一化实现移入 ./shared/company-key.js（与插件 background 的暂存箱去重同源），
      // 这里只留转发别名，31 处调用点因此零改动。合并前已实测**三方逐值等价**（483 项断言：
      // 网页版旧实现 / shared / 插件旧实现，覆盖尾空格、法人后缀循环剥离、全角转半角、
      // 行业词保留、键互相包含、岗位括号修饰、空值与 null/undefined 等场景）。
      // 法人后缀正则 LEGAL_SUFFIX_RE 一并移入 shared，本文件不再保留第二份（此前它与插件侧
      // 那个独立的归一化模块各有一份，靠 company-dedup.js 的断言防漂移；该模块已随本次合并删除）。
      const sameCompanyGroup = AJA.sameCompanyGroup;
      const companyGroupKey = AJA.companyGroupKey;
      // 按公司聚合：先取保守键，再把「键互相包含」的并成一家（腾讯 ⊂ 腾讯科技深圳），
      // 组的规范键取成员里最短的那个，保证同一家公司在配色/折叠/排序上始终一致。
      function groupRecordsByCompany(records) {
        const groups = [];
        for (const r of (Array.isArray(records) ? records : [])) {
          const key = companyGroupKey(r);
          if (!key) continue;
          const hit = groups.find(group => [...group.keys].some(existing => existing === key
            || (existing.length >= 2 && key.length >= 2 && (existing.includes(key) || key.includes(existing)))));
          if (hit) { hit.records.push(r); hit.keys.add(key); if (!hit.label) hit.label = String(r.company || ''); }
          else groups.push({ keys: new Set([key]), label: String(r.company || ''), records: [r] });
        }
        return groups
          .map(group => ({
            key: [...group.keys].sort((a, b) => a.length - b.length || a.localeCompare(b, 'zh-CN'))[0],
            label: group.label,
            records: group.records
          }))
          .sort((a, b) => b.records.length - a.records.length || String(a.label).localeCompare(String(b.label), 'zh-CN'));
      }
      // 记录 id → 所属公司的规范键（渲染前建一次，避免每张卡片重复聚类）
      function companyGroupIndex(records) {
        const map = new Map();
        for (const group of groupRecordsByCompany(records)) {
          for (const record of group.records) map.set(record.id, group.key);
        }
        return map;
      }
      // 公司标识色：按 key 哈希取固定色板，保证同一家公司在看板/表格/抽屉里颜色一致
      // iOS 系统色板风格：蓝 / 绿(深档) / 靛 / 橙(焦档) / 红 / 青(深档) / 紫(深档) / 棕。
      // 全部低饱和、有序、彼此可区分；仅用于 3px 装饰色条与 chip 左边条，**无文本对比度约束**
      // （#a2845e 棕 3.5:1 亦安全，因为它从不承载文字）。
      // 换色板后既有公司的标识色会随哈希重新分配——属预期行为，CHANGELOG 已注明，勿当 bug 修。
      const COMPANY_PALETTE = ['#0071e3', '#248a3d', '#5856d6', '#b25000', '#d70015', '#177e89', '#8944ab', '#a2845e'];
      function companyColor(key) {
        const s = String(key || '');
        let h = 0;
        for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return COMPANY_PALETTE[h % COMPANY_PALETTE.length];
      }

