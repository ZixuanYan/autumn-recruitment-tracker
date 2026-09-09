      // ----- 查重四态（同公司多岗位的关键）-----
      // 岗位名归一化：全半角统一、去空白、小写。**保留括号内容** —— 括号里常是城市 / iOS-Android /
      // 校招社招 / 提前批正式批，是同一家公司多个岗位的关键区分维度。
      // 旧版这里有一行 .replace(/[（(][^）)]*[）)]/g,'') 把括号整块删掉，导致「后端（深圳）」与「后端（北京）」
      // 撞成同名被判重复；而岗位库与插件两条路径当时都是硬拦截、没有逃生口 → 第二个岗位根本录不进去。
      // v4.9.0：实现移入 ./shared/company-key.js（插件侧同一份代码叫 positionKey），这里只留转发别名
      const normalizePositionSlug = AJA.normalizePositionSlug;
      // 宽松版：再去掉括号与连字符后缀。**只用于「疑似同岗位不同方向」提示，绝不用于判重**
      const loosePositionSlug = AJA.loosePositionSlug;
      // 返回 { mode: 'duplicate' | 'variant' | 'same-company', reason, matches } 或 null
      //   duplicate    ：同投递网址，或 同公司 + 岗位归一化严格相等 + 同批次 → 应改为编辑既有记录
      //   variant      ：同公司 + 岗位宽松相等 + （严格不等或批次不等）→ 疑似同一岗位的不同方向/城市/批次，
      //                  合法但值得提醒，必须给用户「是独立投递 / 其实是同一条」二选一，不得静默拦截
      //   same-company ：同公司但岗位无关 → 合法（同公司多岗位），只做非阻断提示
      // 公司判定统一走 companyGroupKey + sameCompanyGroup，与展示分组同源（见上方「公司维度分组」注释）。
      // 不再有 options.ignoreBatch：插件不传批次（恒为空），已有记录填了批次时自然不等 → 走 variant/same-company
      // 非阻断放行；两边都没批次才判 duplicate 并给逃生口。旧版插件路径 ignoreBatch:true 会把
      // 「已有提前批 + 新收正式批」判成 duplicate 并强制打开旧记录编辑，污染已有里程碑。
      function findDuplicateRecord(records, seed) {
        const list = Array.isArray(records) ? records : [];
        const url = String((seed && seed.applicationUrl) || '').trim();
        if (url) {
          const hit = list.find(record => String(record.applicationUrl || '').trim() === url);
          if (hit) return { mode: 'duplicate', reason: 'url', matches: [hit] };
        }
        const key = companyGroupKey(seed);
        if (!key) return null;
        const sameCompany = list.filter(record => sameCompanyGroup(companyGroupKey(record), key));
        if (!sameCompany.length) return null;
        const position = normalizePositionSlug(seed && seed.position);
        const loose = loosePositionSlug(seed && seed.position);
        const batch = String((seed && seed.batch) || '').trim();
        const exact = sameCompany.filter(record => normalizePositionSlug(record.position) === position
          && String(record.batch || '').trim() === batch);
        if (exact.length) return { mode: 'duplicate', reason: 'company+position+batch', matches: exact };
        if (loose && loose.length >= 2) {
          const variant = sameCompany.filter(record => {
            const otherLoose = loosePositionSlug(record.position);
            if (!otherLoose || otherLoose !== loose) return false;
            return normalizePositionSlug(record.position) !== position
              || String(record.batch || '').trim() !== batch;
          });
          if (variant.length) return { mode: 'variant', reason: 'company+position-loose', matches: variant };
        }
        return { mode: 'same-company', reason: 'company', matches: sameCompany };
      }

