/**
 * 秋招求职与简历助手 - 设计令牌（v5.2.0 Apple 风格统一）
 * 全端唯一事实源：content script 的 Shadow DOM 与 Side Panel 扩展页面共用同一套令牌，
 * 组件 CSS 只允许引用 var(--aja-*)，不得写死颜色与圆角，否则两端会各自漂移。
 *
 * v5.2.0 的两处结构改动（都是为了对齐网页版 v4.10.0 的 Apple 设计系统）：
 *
 * 1. **accent / danger / warn 从「主题无关单值」移进 light / dark 两套**。
 *    旧结构无法表达 Apple 规范：暗背景上的强调色是 #2997ff 而不是 #0071e3
 *    （后者在 #1c1c1e 上对比度约 3.4:1，不达标），语义色在暗色下同样要提亮
 *    （#ff453a / #ff9f0a）。设计资源写得很明确：「Accent #2997ff，暗背景上的链接与高亮」。
 *    顺带的好处：tokensToCssVars 少一个循环，色值全部走同一条 palette 路径。
 *
 * 2. **圆角加第五档 pill，四档整体上调；动效加 slow 档，上限 150→320ms**。
 *    旧值（2/3/4/6px 与 150ms 上限）是 v5.0.0 去 AI 感时刻意压小的工具类尺度；
 *    Apple 的语言里按钮是完全胶囊、抽屉/toast 是 320ms。RADIUS_WHITELIST 与
 *    MOTION_MAX_MS 都是从这里读出来的，所以守卫会自动跟随，不用改守卫逻辑。
 *
 * 为什么要有这个文件：v4.2.0 的 577 行 CSS 里散落着 4 处蓝紫渐变、27 处不成体系的圆角、
 * 6 处阴影（含带品牌色的彩色阴影）、1 处毛玻璃与 18 处 emoji 图标，是典型的「AI 生成感」。
 * 收敛成令牌之后，test/extension-ui.js 的静态守卫可以逐项断言不回归。
 */
(() => {
  'use strict';
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  root.AJA = root.AJA || {};

  const TOKENS = {
    // 圆角五档。pill 是按钮的语言（Apple 按钮完全胶囊）；导航项与卡片用 md/lg 圆角矩形。
    radius: { xs: '4px', sm: '6px', md: '10px', lg: '14px', pill: '999px' },
    // 间距收敛到 4 的倍数网格（设计资源的阶是 4/8/12/16/24/32/48/64/96，没有 6 与 20）
    space: { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '24px', 6: '32px' },
    // 字号保持工具类尺度（11-14px）：插件浮在别人的网页上、面板只有 ~360px 宽，
    // 设计资源的 Body 17px / Headline 19px 是营销页尺度，套过来会撑爆迷你卡片。
    font: { xs: '11px', sm: '12px', md: '13px', lg: '14px' },
    // fast=微交互（hover 底色）、base=Apple hover 180ms、slow=抽屉/toast/卡片展开 320ms。
    // ease 是 ease-apple；全局曲线统一，组件 CSS 不许再硬写 cubic-bezier。
    motion: { fast: '120ms', base: '180ms', slow: '320ms', ease: 'cubic-bezier(.28,.11,.32,1)' },

    light: {
      // Apple Primary / Secondary；soft 是 @12% 混白
      accent: '#0071e3', accentHover: '#0066cc', accentSoft: 'rgba(0,113,227,.12)',
      // 语义色文本/实底档（白字对比达标）；bright 档在 dark 里才用，light 下文本档即可
      danger: '#d70015', dangerSoft: 'rgba(215,0,21,.10)',
      warn: '#a05a00', warnSoft: 'rgba(160,90,0,.12)',
      // 画布三级 + 边框两级（与网页版 --bg/--surface-2/--surface-3/--line-strong/--line 同值）
      bg: '#ffffff', bgSub: '#f5f5f7', bgHover: '#ededf2',
      border: '#d2d2d7', borderSoft: 'rgba(0,0,0,.08)',
      // 文字三级：ink / muted(刻意加深，插件大量 11-12px 微文本) / ink-soft
      text: '#1d1d1f', textSub: '#6e6e73', textMute: '#86868b',
      // 浮在任意招聘页面上需要分离感，但只用无色阴影（旧版是带品牌色的彩色阴影）
      shadow: 'rgba(0,0,0,.12)',
      // 玻璃唯一配方（设计资源 glass-nav 原值）：.72 + saturate(180%) blur(20px)
      glass: 'rgba(255,255,255,.72)'
    },

    dark: {
      // 暗背景的强调色是 #2997ff（设计资源明确），不是 #0071e3——后者在暗底对比不足
      accent: '#2997ff', accentHover: '#4dabff', accentSoft: 'rgba(41,151,255,.18)',
      // Apple 暗色语义色（文本档在暗底要提亮）
      danger: '#ff453a', dangerSoft: 'rgba(255,69,58,.16)',
      warn: '#ff9f0a', warnSoft: 'rgba(255,159,10,.16)',
      // systemBackground 暗色三级（设计资源 Dark card 的渐变端点正是 #1c1c1e → #3a3a3c）
      bg: '#1c1c1e', bgSub: '#2c2c2e', bgHover: '#3a3a3c',
      border: '#48484a', borderSoft: 'rgba(255,255,255,.10)',
      // 暗区文字用 white / white 70（设计资源原话），textMute 用 systemGray dark
      text: '#f5f5f7', textSub: 'rgba(255,255,255,.70)', textMute: '#8e8e93',
      shadow: 'rgba(0,0,0,.5)',
      // 玻璃「深色区反色」（设计资源原话）
      glass: 'rgba(28,28,30,.72)'
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
   *
   * v5.2.0 起色值全部在 palette 里（accent/danger/warn 已移入两套主题），
   * 所以这里只剩「尺寸类（两套都声明）+ palette」两条路径，比旧版少一个循环。
   */
  function tokensToCssVars(scheme, selector) {
    const sel = String(selector || ':root');
    const palette = TOKENS[scheme === 'dark' ? 'dark' : 'light'];
    const lines = [];
    // 尺寸类令牌与主题无关，两套 scheme 都要声明（否则深色下圆角/间距会丢）
    for (const group of ['radius', 'space', 'font', 'motion']) {
      for (const [k, v] of Object.entries(TOKENS[group])) lines.push(`--aja-${group}-${kebab(k)}: ${v};`);
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

  // 供测试与守卫使用的白名单：所有允许出现的 border-radius 字面量。
  // 加 pill 档后这里是 5 个值，守卫自动跟随（它读的就是这个数组）。
  root.AJA.RADIUS_WHITELIST = Object.values(TOKENS.radius);
  // 允许出现的非灰阶色值：两套主题的强调色与语义色都收进来。
  // 旧版只收单值的 4 个；不收 dark 的 4 个会让守卫把 #2997ff 当成"新引入的杂色"拦下。
  root.AJA.COLOR_WHITELIST = ['accent', 'accentHover', 'danger', 'warn']
    .flatMap(k => [TOKENS.light[k], TOKENS.dark[k]]);
  // 动效时长上限（毫秒）：320ms = 抽屉/toast/卡片展开档。hover 仍走 base 180ms。
  root.AJA.MOTION_MAX_MS = 320;
})();
