/**
 * 秋招求职与简历助手 - 设计令牌（v5.0.0）
 * 全端唯一事实源：content script 的 Shadow DOM 与 Side Panel 扩展页面共用同一套令牌，
 * 组件 CSS 只允许引用 var(--aja-*)，不得写死颜色与圆角，否则两端会各自漂移。
 *
 * 为什么要有这个文件：v4.2.0 的 577 行 CSS 里散落着 4 处蓝紫渐变、27 处不成体系的圆角
 * (20/16/15/12/10/8/6/4px)、6 处阴影（含带品牌色的彩色阴影 rgba(64,83,203,.35)）、
 * 1 处毛玻璃与 18 处 emoji 图标，是典型的「AI 生成感」。收敛成令牌之后，
 * autumn-mail-sync/test/extension-ui.js 的静态守卫可以逐项断言不回归。
 */
(() => {
  'use strict';
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.AJA = root.AJA || {};

  const TOKENS = {
    // 圆角只保留四档，替代旧版 8 种混用值
    radius: { xs: '2px', sm: '3px', md: '4px', lg: '6px' },
    space: { 1: '4px', 2: '6px', 3: '8px', 4: '12px', 5: '16px', 6: '20px' },
    font: { xs: '11px', sm: '12px', md: '13px', lg: '14px' },
    // 动效上限 150ms；旧版 0.25-0.28s 的 easeOutExpo 会让 UI 显得"弹"，工具类界面不需要
    motion: { fast: '120ms', base: '150ms', ease: 'cubic-bezier(.2,0,0,1)' },

    // 唯一装饰性强调色：与网页版 --accent 同源，让插件与管理器有品牌呼应
    accent: '#e8552d',
    accentHover: '#cf4a26',
    accentSoft: 'rgba(232,85,45,.12)',

    // 语义色（功能必需，非装饰）：危险动作与识别告警。
    // 旧版这里散落着 #24a475 绿（保存按钮）、#5b6cfa 蓝紫（计数徽标）、#dc2626 红（丢弃）、
    // #92400e/#fcd34d 琥珀（告警）四套互不相干的彩色，现在收敛为 accent / danger / warn 三色。
    danger: '#c0392b',
    dangerSoft: 'rgba(192,57,43,.10)',
    warn: '#8a6118',
    warnSoft: 'rgba(178,140,20,.14)',

    light: {
      bg: '#ffffff',
      bgSub: '#f6f7f9',
      bgHover: '#eceef2',
      border: '#d5d9e0',
      borderSoft: '#e5e8ed',
      text: '#1a1d23',
      textSub: '#5b636f',
      textMute: '#8b93a0',
      // 浮在任意招聘页面上需要一点分离感，但只用无色阴影（旧版是带品牌色的彩色阴影）
      shadow: 'rgba(15,18,25,.18)'
    },
    dark: {
      bg: '#1c1f26',
      bgSub: '#22262e',
      bgHover: '#2b303a',
      border: '#3b414a',
      borderSoft: '#2e333c',
      text: '#e8eaed',
      textSub: '#a7afbb',
      textMute: '#7c848f',
      shadow: 'rgba(0,0,0,.5)'
    }
  };
  root.AJA.TOKENS = TOKENS;

  // camelCase → kebab-case，统一加 --aja- 前缀（--aja-bg-sub / --aja-text-mute ...）
  function kebab(key) {
    return String(key).replace(/[A-Z]/g, ch => '-' + ch.toLowerCase());
  }

  /**
   * 生成 CSS 变量声明文本。
   * @param {'light'|'dark'} scheme
   * @param {string} selector Shadow DOM 传 ':host'，扩展页面传 ':root'
   */
  function tokensToCssVars(scheme, selector) {
    const sel = String(selector || ':root');
    const palette = TOKENS[scheme === 'dark' ? 'dark' : 'light'];
    const lines = [];
    // 尺寸类令牌与主题无关，两套 scheme 都要声明（否则深色下圆角/间距会丢）
    for (const group of ['radius', 'space', 'font', 'motion']) {
      for (const [k, v] of Object.entries(TOKENS[group])) lines.push(`--aja-${group}-${kebab(k)}: ${v};`);
    }
    for (const k of ['accent', 'accentHover', 'accentSoft', 'danger', 'dangerSoft', 'warn', 'warnSoft']) {
      lines.push(`--aja-${kebab(k)}: ${TOKENS[k]};`);
    }
    for (const [k, v] of Object.entries(palette)) lines.push(`--aja-${kebab(k)}: ${v};`);
    return `${sel} {\n  ${lines.join('\n  ')}\n}`;
  }
  root.AJA.tokensToCssVars = tokensToCssVars;

  // 当前系统/浏览器主题。content script 与扩展页面都能用 matchMedia。
  function currentScheme() {
    try {
      return (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    } catch (_) { return 'light'; }
  }
  root.AJA.currentScheme = currentScheme;

  /**
   * 订阅主题变化，返回取消订阅函数。
   * Side Panel 必须实时跟随浏览器深浅主题（它是浏览器 UI 的一部分，配色割裂会很明显）；
   * content script 侧的胶囊浮在网页上，同样跟随系统主题才能与宿主环境协调。
   */
  function onSchemeChange(cb) {
    try {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const handler = () => cb(currentScheme());
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
      }
      if (typeof mq.addListener === 'function') { // 老浏览器兜底
        mq.addListener(handler);
        return () => mq.removeListener(handler);
      }
    } catch (_) {}
    return () => {};
  }
  root.AJA.onSchemeChange = onSchemeChange;

  // 供测试与守卫使用的白名单：所有允许出现的 border-radius 字面量
  root.AJA.RADIUS_WHITELIST = Object.values(TOKENS.radius);
  // 允许出现的非灰阶色值（装饰性强调 + 两个语义色），静态守卫据此判断有没有引入新的杂色
  root.AJA.COLOR_WHITELIST = [TOKENS.accent, TOKENS.accentHover, TOKENS.danger, TOKENS.warn];
  // 动效时长上限（毫秒）
  root.AJA.MOTION_MAX_MS = 150;
})();
