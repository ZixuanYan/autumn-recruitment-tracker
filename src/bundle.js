/**
 * 拼接清单：顺序即最终内联进 index.html 的顺序。**唯一事实源**——
 * build.js 与 test/lib/load-src.js 都读这一份，两边各写一份顺序就会漂移，
 * 漂移后测试测的不再是上线的那份代码（那正是本项目一直在消灭的东西）。
 *
 * 字符串项 = 直接拼接的文件；{ module, files } = 插到 app/ 里同名的顶格标记
 * `__MODULE:xxx__`（外面包一对块注释符；标记必须顶格，带缩进的话那几个空格会残留进产物）。
 * ⚠️ 刻意不在本块注释里抄写标记的完整形态：它结尾的那两个字符会**提前关闭块注释**，
 * 于是后面的说明文字全部变成代码，整个文件语法错误——只有 node --check 抓得到，
 * 而症状（build.js require 本文件时 Unexpected end of input）离原因（一行注释）很远。
 *
 * 每个 src/ 文件都以换行结尾，所以拼接是 join('')，不是 join('\n')。
 */
'use strict';

module.exports = {
  styles: ['styles/base.css', 'styles/apple.css'],
  app: [
    'app/00-bootstrap.js',
    { module: 'core', files: [
      'core/dates.js', 'core/ics.js', 'core/company.js',
      'core/insights.js', 'core/dedupe.js', 'core/city.js'
    ] },
    'app/10-views.js',
    { module: 'mail', files: ['mail/pure.js'] },
    'app/20-runtime.js'
  ]
};
