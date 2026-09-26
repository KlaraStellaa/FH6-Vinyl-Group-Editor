/* ---------- 原生对话框 / 应用内确认框 文案（主进程 + 渲染层共用） ----------
   为什么单独一份：**原生对话框由 OS 渲染**，标题/按钮/过滤器名必须由主进程在
   打开对话框时按「当前界面语言」传进去，渲染层的 App.i18n 管不到它们。
   主进程：const DLG = require('./dlg-i18n.js');  DLG.get(lang, 'dlg.openSvg')
   渲染层：<script src="dlg-i18n.js"></script> 加载后自动并入 App.i18n.dicts（dlg.*） */
(function () {
  var DICT = {
    'zh-CN': {
      'dlg.openSvg': '打开 SVG 文件', 'dlg.exportSvg': '导出 SVG 文件',
      'dlg.saveWork': '保存工作进程', 'dlg.openWork': '打开工作进程',
      'dlg.backupSave': '备份当前账户存档', 'dlg.openImage': '打开背景图片',
      'dlg.filterSvg': 'SVG 文件', 'dlg.importFile': '导入 SVG 文件', 'dlg.filterWork': '工作进程', 'dlg.filterAll': '所有文件',
      'dlg.filterZip': 'ZIP 压缩包', 'dlg.filterImage': '图片文件',
      'dlg.yes': '是', 'dlg.no': '否', 'dlg.cancel': '取消',
      'dlg.closeMsg': '要在关闭之前存储对 {app} 文档“{name}”的更改吗？',
      'dlg.delTitle': '删除确认', 'dlg.delMsg': '确定要删除「{name}」吗？\n此操作不可撤销。', 'dlg.delOk': '删除',
      'dlg.injectTitle': '确认注入',
      'dlg.injectMsg': '将覆盖以下分组：\n{group} - {author}\n\n确定继续吗？',
      'dlg.injectOk': '确定注入',
      'dlg.vinylTitle': 'Vinylizer 导入', 'dlg.vinylMsg': '忽略不透明度 ≤ 该值（0-255）的图层：'
    },
    'zh-TW': {
      'dlg.openSvg': '開啟 SVG 檔案', 'dlg.exportSvg': '匯出 SVG 檔案',
      'dlg.saveWork': '儲存工作進程', 'dlg.openWork': '開啟工作進程',
      'dlg.backupSave': '備份目前帳戶存檔', 'dlg.openImage': '開啟背景圖片',
      'dlg.filterSvg': 'SVG 檔案', 'dlg.importFile': '匯入 SVG 檔案', 'dlg.filterWork': '工作進程', 'dlg.filterAll': '所有檔案',
      'dlg.filterZip': 'ZIP 壓縮檔', 'dlg.filterImage': '圖片檔案',
      'dlg.yes': '是', 'dlg.no': '否', 'dlg.cancel': '取消',
      'dlg.closeMsg': '要在關閉之前儲存對 {app} 文件「{name}」的變更嗎？',
      'dlg.delTitle': '刪除確認', 'dlg.delMsg': '確定要刪除「{name}」嗎？\n此操作無法復原。', 'dlg.delOk': '刪除',
      'dlg.injectTitle': '確認注入',
      'dlg.injectMsg': '將覆蓋以下群組：\n{group} - {author}\n\n確定要繼續嗎？',
      'dlg.injectOk': '確定注入',
      'dlg.vinylTitle': 'Vinylizer 匯入', 'dlg.vinylMsg': '忽略不透明度 ≤ 此值（0-255）的圖層：'
    },
    'en': {
      'dlg.openSvg': 'Open SVG file', 'dlg.exportSvg': 'Export SVG file',
      'dlg.saveWork': 'Save workcopy', 'dlg.openWork': 'Open workcopy',
      'dlg.backupSave': 'Back up current account save', 'dlg.openImage': 'Open background image',
      'dlg.filterSvg': 'SVG files', 'dlg.importFile': 'Import SVG file', 'dlg.filterWork': 'Workcopies', 'dlg.filterAll': 'All files',
      'dlg.filterZip': 'ZIP archive', 'dlg.filterImage': 'Image files',
      'dlg.yes': 'Yes', 'dlg.no': 'No', 'dlg.cancel': 'Cancel',
      'dlg.closeMsg': 'Do you want to save the changes to the {app} document "{name}" before closing?',
      'dlg.delTitle': 'Confirm deletion', 'dlg.delMsg': 'Delete "{name}"?\nThis cannot be undone.', 'dlg.delOk': 'Delete',
      'dlg.injectTitle': 'Confirm injection',
      'dlg.injectMsg': 'This will overwrite the following group:\n{group} - {author}\n\nContinue?',
      'dlg.injectOk': 'Inject',
      'dlg.vinylTitle': 'Vinylizer import', 'dlg.vinylMsg': 'Ignore layers with opacity ≤ this value (0-255):'
    },
    'ja': {
      'dlg.openSvg': 'SVG ファイルを開く', 'dlg.exportSvg': 'SVG ファイルを書き出す',
      'dlg.saveWork': 'ワークを保存', 'dlg.openWork': 'ワークを開く',
      'dlg.backupSave': '現在のアカウントのセーブをバックアップ', 'dlg.openImage': '背景画像を開く',
      'dlg.filterSvg': 'SVG ファイル', 'dlg.importFile': 'SVG ファイルをインポート', 'dlg.filterWork': 'ワーク', 'dlg.filterAll': 'すべてのファイル',
      'dlg.filterZip': 'ZIP アーカイブ', 'dlg.filterImage': '画像ファイル',
      'dlg.yes': 'はい', 'dlg.no': 'いいえ', 'dlg.cancel': 'キャンセル',
      'dlg.closeMsg': '閉じる前に {app} ドキュメント「{name}」の変更を保存しますか？',
      'dlg.delTitle': '削除の確認', 'dlg.delMsg': '「{name}」を削除しますか？\nこの操作は取り消せません。', 'dlg.delOk': '削除',
      'dlg.injectTitle': '注入の確認',
      'dlg.injectMsg': '次のグループを上書きします：\n{group} - {author}\n\n続行しますか？',
      'dlg.injectOk': '注入する',
      'dlg.vinylTitle': 'Vinylizer 読み込み', 'dlg.vinylMsg': '不透明度がこの値以下のレイヤーを無視（0-255）：'
    },
    'ko': {
      'dlg.openSvg': 'SVG 파일 열기', 'dlg.exportSvg': 'SVG 파일 내보내기',
      'dlg.saveWork': '작업 파일 저장', 'dlg.openWork': '작업 파일 열기',
      'dlg.backupSave': '현재 계정 세이브 백업', 'dlg.openImage': '배경 이미지 열기',
      'dlg.filterSvg': 'SVG 파일', 'dlg.importFile': 'SVG 파일 가져오기', 'dlg.filterWork': '작업 파일', 'dlg.filterAll': '모든 파일',
      'dlg.filterZip': 'ZIP 압축 파일', 'dlg.filterImage': '이미지 파일',
      'dlg.yes': '예', 'dlg.no': '아니오', 'dlg.cancel': '취소',
      'dlg.closeMsg': '닫기 전에 {app} 문서 "{name}"의 변경 사항을 저장할까요?',
      'dlg.delTitle': '삭제 확인', 'dlg.delMsg': '"{name}"을(를) 삭제할까요?\n이 작업은 되돌릴 수 없습니다.', 'dlg.delOk': '삭제',
      'dlg.injectTitle': '주입 확인',
      'dlg.injectMsg': '다음 그룹을 덮어씁니다:\n{group} - {author}\n\n계속할까요?',
      'dlg.injectOk': '주입',
      'dlg.vinylTitle': 'Vinylizer 가져오기', 'dlg.vinylMsg': '불투명도가 이 값 이하인 레이어 무시(0-255):'
    }
  };
  var overwrite = {
    'zh-CN': ['确认覆盖', '已存在同名文件「{name}」。确定覆盖吗？将保留上一版 .bak 备份。', '文件在确认期间已变化，请重新保存。'],
    'zh-TW': ['確認覆蓋', '同名檔案「{name}」已存在。確定覆蓋嗎？將保留上一版 .bak 備份。', '確認期間檔案已變更，請重新儲存。'],
    'en': ['Confirm overwrite', '"{name}" already exists. Overwrite it? The previous version will be kept as a .bak file.', 'The file changed during confirmation. Please save again.'],
    'ja': ['上書きの確認', '「{name}」は既に存在します。上書きしますか？前の版は .bak に保存されます。', '確認中にファイルが変更されました。もう一度保存してください。'],
    'ko': ['덮어쓰기 확인', '"{name}" 파일이 이미 있습니다. 덮어쓸까요? 이전 버전은 .bak 파일로 보관됩니다.', '확인 중 파일이 변경되었습니다. 다시 저장하세요.']
  };
  Object.keys(overwrite).forEach(function (lang) {
    DICT[lang]['dlg.overwriteTitle'] = overwrite[lang][0];
    DICT[lang]['dlg.overwriteMsg'] = overwrite[lang][1];
    DICT[lang]['dlg.fileChanged'] = overwrite[lang][2];
  });
  /* 窗口标题（主进程侧；渲染层 <title data-i18n> 用 i18n.js 里的同名键） */
  var titles = { 'zh-CN': 'FH6 Vinyl Group Editor', 'zh-TW': 'FH6 Vinyl Group Editor', 'en': 'FH6 Vinyl Group Editor',
    'ja': 'SVG パターンコラージュエディター', 'ko': 'SVG 패턴 콜라주 편집기' };
  Object.keys(titles).forEach(function (l) { if (DICT[l]) DICT[l]['app.title'] = titles[l]; });
  var api = {
    dicts: DICT,
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
  if (typeof window !== 'undefined') window.DLG_I18N = api;
  /* 渲染层：并入 App.i18n.dicts，这样 fzaConfirm 等能直接用 App.i18n.t('dlg.*') */
  if (typeof App !== 'undefined' && App.i18n && App.i18n.dicts) {
    Object.keys(DICT).forEach(function (lang) {
      if (App.i18n.dicts[lang]) Object.assign(App.i18n.dicts[lang], DICT[lang]);
    });
  }
})();
