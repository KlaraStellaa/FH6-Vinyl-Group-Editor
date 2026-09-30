/* ---------- 命名 / 标签类文案词典（渲染层 + 主进程共用） ----------
   这些字符串散落在 js/io.js、js/tabs.js、js/model.js、js/forza.js、js/library.js、main.js 里，
   既当**默认文件名**（图案拼贴-/Forza导出/彩绘）又当**界面标签 / 图层默认名**
   （未命名/工作进程/图案/合并图层/导入·）。集中到这里，两端共用一份，避免再散回去。
   与 dlg-i18n.js 同一套写法：Node 端 module.exports，浏览器端并入 App.i18n.dicts。
   注意：**不要**把 `锚点-` 也搬进来 —— main.js 用 /^锚点-.*\.svework$/ 匹配已有文件，
   翻译它会让老锚点文件读不出来（历史文件名约定，必须保持原样）。 */
(function () {
  var DICT = {
    'zh-CN': {
      'name.untitled': '未命名',
      'name.workcopy': '工作进程',
      'name.pattern': '图案',
      'name.mergedLayer': '合并图层',
      'name.importPrefix': '导入',
      'name.collageFile': '图案拼贴',
      'name.paletteFile': '彩绘',
      'name.forzaExportFile': 'Forza导出',
      'name.uncategorized': '未分类',
      'name.maskDark': '棋盘格·深色',
      'name.maskLight': '棋盘格·浅色'
    },
    'zh-TW': {
      'name.untitled': '未命名',
      'name.workcopy': '工作進程',
      'name.pattern': '圖案',
      'name.mergedLayer': '合併圖層',
      'name.importPrefix': '匯入',
      'name.collageFile': '圖案拼貼',
      'name.paletteFile': '彩繪',
      'name.forzaExportFile': 'Forza匯出',
      'name.uncategorized': '未分類',
      'name.maskDark': '棋盤格·深色',
      'name.maskLight': '棋盤格·淺色'
    },
    'en': {
      'name.untitled': 'Untitled',
      'name.workcopy': 'Workcopy',
      'name.pattern': 'Pattern',
      'name.mergedLayer': 'Merged layer',
      'name.importPrefix': 'Imported',
      'name.collageFile': 'Pattern collage',
      'name.paletteFile': 'Artwork',
      'name.forzaExportFile': 'Forza export',
      'name.uncategorized': 'Uncategorized',
      'name.maskDark': 'Checkerboard · dark',
      'name.maskLight': 'Checkerboard · light'
    },
    'ja': {
      'name.untitled': '無題',
      'name.workcopy': 'ワーク',
      'name.pattern': 'パターン',
      'name.mergedLayer': '結合レイヤー',
      'name.importPrefix': '読み込み',
      'name.collageFile': 'パターンコラージュ',
      'name.paletteFile': 'ペイント',
      'name.forzaExportFile': 'Forza書き出し',
      'name.uncategorized': '未分類',
      'name.maskDark': 'チェッカー · 濃色',
      'name.maskLight': 'チェッカー · 淡色'
    },
    'ko': {
      'name.untitled': '제목 없음',
      'name.workcopy': '작업',
      'name.pattern': '패턴',
      'name.mergedLayer': '병합 레이어',
      'name.importPrefix': '가져옴',
      'name.collageFile': '패턴 콜라주',
      'name.paletteFile': '페인팅',
      'name.forzaExportFile': 'Forza 내보내기',
      'name.uncategorized': '미분류',
      'name.maskDark': '체커보드 · 어두움',
      'name.maskLight': '체커보드 · 밝음'
    }
  };
  var api = {
    langs: ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'],
    /* 取词 + {占位符} 替换（与渲染层 App.i18n.tf 同语义） */
    get: function (lang, key, params) {
      var d = DICT[lang] || DICT['zh-CN'];
      var s = d[key] || DICT['zh-CN'][key] || key;
      if (params) {
        s = s.replace(/\{(\w+)\}/g, function (m, k) {
          return (params[k] === undefined || params[k] === null) ? '' : String(params[k]);
        });
      }
      return s;
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NAME_I18N = api;
  /* 并入主词典（i18n.js 先加载） */
  if (typeof App !== 'undefined' && App.i18n && App.i18n.dicts) {
    Object.keys(DICT).forEach(function (lang) {
      if (App.i18n.dicts[lang]) Object.assign(App.i18n.dicts[lang], DICT[lang]);
    });
  }
})();
