(function () {
  var DICT = {
    'zh-CN': {
      'dlg.openSvg': '打开 SVG 文件', 'dlg.exportSvg': '导出 SVG 文件',
      'dlg.saveWork': '保存工作进程', 'dlg.openWork': '打开工作进程',
      'dlg.backupSave': '备份当前账户存档', 'dlg.openImage': '打开背景图片',
      'dlg.pickExe': '选择已下载的安装包', 'dlg.filterExe': '程序安装包', 'dlg.filterSvg': 'SVG 文件', 'dlg.importFile': '导入 SVG 文件', 'dlg.filterWork': '工作进程', 'dlg.filterAll': '所有文件',
      'dlg.filterZip': 'ZIP 压缩包', 'dlg.filterImage': '图片文件',
      'dlg.yes': '是', 'dlg.no': '否', 'dlg.cancel': '取消',
      'dlg.closeMsg': '要在关闭之前存储对 {app} 文档“{name}”的更改吗？',
      'dlg.delTitle': '删除确认', 'dlg.updTitle': '发现新版本', 'dlg.updMessage': '发现新版本 {v}', 'dlg.updCurrent': '当前版本：{v}', 'dlg.updLatest': '最新版本：{v}', 'dlg.updNotes': '更新说明：', 'dlg.updDownload': '前往下载', 'dlg.updLater': '以后再说', 'dlg.updSkip': '跳过此版本', 'dlg.delMsg': '确定要删除「{name}」吗？\n此操作不可撤销。', 'dlg.delOk': '删除',
      'dlg.injectTitle': '确认注入',
      'dlg.injectMsg': '将覆盖以下分组：\n{group} - {author}\n\n确定继续吗？',
      'dlg.injectOk': '确定注入',
      'dlg.vinylTitle': 'Vinylizer 导入', 'dlg.vinylMsg': '忽略不透明度 ≤ 该值（0-255）的图层：'
    },
    'zh-TW': {
      'dlg.openSvg': '開啟 SVG 檔案', 'dlg.exportSvg': '匯出 SVG 檔案',
      'dlg.saveWork': '儲存工作進程', 'dlg.openWork': '開啟工作進程',
      'dlg.backupSave': '備份目前帳戶存檔', 'dlg.openImage': '開啟背景圖片',
      'dlg.pickExe': '選擇已下載的安裝包', 'dlg.filterExe': '程式安裝包', 'dlg.filterSvg': 'SVG 檔案', 'dlg.importFile': '匯入 SVG 檔案', 'dlg.filterWork': '工作進程', 'dlg.filterAll': '所有檔案',
      'dlg.filterZip': 'ZIP 壓縮檔', 'dlg.filterImage': '圖片檔案',
      'dlg.yes': '是', 'dlg.no': '否', 'dlg.cancel': '取消',
      'dlg.closeMsg': '要在關閉之前儲存對 {app} 文件「{name}」的變更嗎？',
      'dlg.delTitle': '刪除確認', 'dlg.updTitle': '發現新版本', 'dlg.updMessage': '發現新版本 {v}', 'dlg.updCurrent': '目前版本：{v}', 'dlg.updLatest': '最新版本：{v}', 'dlg.updNotes': '更新說明：', 'dlg.updDownload': '前往下載', 'dlg.updLater': '稍後再說', 'dlg.updSkip': '跳過此版本', 'dlg.delMsg': '確定要刪除「{name}」嗎？\n此操作無法復原。', 'dlg.delOk': '刪除',
      'dlg.injectTitle': '確認注入',
      'dlg.injectMsg': '將覆蓋以下群組：\n{group} - {author}\n\n確定要繼續嗎？',
      'dlg.injectOk': '確定注入',
      'dlg.vinylTitle': 'Vinylizer 匯入', 'dlg.vinylMsg': '忽略不透明度 ≤ 此值（0-255）的圖層：'
    },
    'en': {
      'dlg.openSvg': 'Open SVG file', 'dlg.exportSvg': 'Export SVG file',
      'dlg.saveWork': 'Save workcopy', 'dlg.openWork': 'Open workcopy',
      'dlg.backupSave': 'Back up current account save', 'dlg.openImage': 'Open background image',
      'dlg.pickExe': 'Select the downloaded installer', 'dlg.filterExe': 'Application', 'dlg.filterSvg': 'SVG files', 'dlg.importFile': 'Import SVG file', 'dlg.filterWork': 'Workcopies', 'dlg.filterAll': 'All files',
      'dlg.filterZip': 'ZIP archive', 'dlg.filterImage': 'Image files',
      'dlg.yes': 'Yes', 'dlg.no': 'No', 'dlg.cancel': 'Cancel',
      'dlg.closeMsg': 'Do you want to save the changes to the {app} document "{name}" before closing?',
      'dlg.delTitle': 'Confirm deletion', 'dlg.updTitle': 'New version available', 'dlg.updMessage': 'New version available: {v}', 'dlg.updCurrent': 'Current version: {v}', 'dlg.updLatest': 'Latest version: {v}', 'dlg.updNotes': 'Release notes:', 'dlg.updDownload': 'Download', 'dlg.updLater': 'Later', 'dlg.updSkip': 'Skip this version', 'dlg.delMsg': 'Delete "{name}"?\nThis cannot be undone.', 'dlg.delOk': 'Delete',
      'dlg.injectTitle': 'Confirm injection',
      'dlg.injectMsg': 'This will overwrite the following group:\n{group} - {author}\n\nContinue?',
      'dlg.injectOk': 'Inject',
      'dlg.vinylTitle': 'Vinylizer import', 'dlg.vinylMsg': 'Ignore layers with opacity ≤ this value (0-255):'
    },
    'ja': {
      'dlg.openSvg': 'SVG ファイルを開く', 'dlg.exportSvg': 'SVG ファイルを書き出す',
      'dlg.saveWork': 'ワークを保存', 'dlg.openWork': 'ワークを開く',
      'dlg.backupSave': '現在のアカウントのセーブをバックアップ', 'dlg.openImage': '背景画像を開く',
      'dlg.pickExe': 'ダウンロード済みのインストーラーを選択', 'dlg.filterExe': 'アプリ', 'dlg.filterSvg': 'SVG ファイル', 'dlg.importFile': 'SVG ファイルをインポート', 'dlg.filterWork': 'ワーク', 'dlg.filterAll': 'すべてのファイル',
      'dlg.filterZip': 'ZIP アーカイブ', 'dlg.filterImage': '画像ファイル',
      'dlg.yes': 'はい', 'dlg.no': 'いいえ', 'dlg.cancel': 'キャンセル',
      'dlg.closeMsg': '閉じる前に {app} ドキュメント「{name}」の変更を保存しますか？',
      'dlg.delTitle': '削除の確認', 'dlg.updTitle': '新しいバージョンがあります', 'dlg.updMessage': '新しいバージョン：{v}', 'dlg.updCurrent': '現在のバージョン：{v}', 'dlg.updLatest': '最新バージョン：{v}', 'dlg.updNotes': '更新内容：', 'dlg.updDownload': 'ダウンロードへ', 'dlg.updLater': 'あとで', 'dlg.updSkip': 'このバージョンをスキップ', 'dlg.delMsg': '「{name}」を削除しますか？\nこの操作は取り消せません。', 'dlg.delOk': '削除',
      'dlg.injectTitle': '注入の確認',
      'dlg.injectMsg': '次のグループを上書きします：\n{group} - {author}\n\n続行しますか？',
      'dlg.injectOk': '注入する',
      'dlg.vinylTitle': 'Vinylizer 読み込み', 'dlg.vinylMsg': '不透明度がこの値以下のレイヤーを無視（0-255）：'
    },
    'ko': {
      'dlg.openSvg': 'SVG 파일 열기', 'dlg.exportSvg': 'SVG 파일 내보내기',
      'dlg.saveWork': '작업 파일 저장', 'dlg.openWork': '작업 파일 열기',
      'dlg.backupSave': '현재 계정 세이브 백업', 'dlg.openImage': '배경 이미지 열기',
      'dlg.pickExe': '다운로드한 설치 파일 선택', 'dlg.filterExe': '응용 프로그램', 'dlg.filterSvg': 'SVG 파일', 'dlg.importFile': 'SVG 파일 가져오기', 'dlg.filterWork': '작업 파일', 'dlg.filterAll': '모든 파일',
      'dlg.filterZip': 'ZIP 압축 파일', 'dlg.filterImage': '이미지 파일',
      'dlg.yes': '예', 'dlg.no': '아니오', 'dlg.cancel': '취소',
      'dlg.closeMsg': '닫기 전에 {app} 문서 "{name}"의 변경 사항을 저장할까요?',
      'dlg.delTitle': '삭제 확인', 'dlg.updTitle': '새 버전이 있습니다', 'dlg.updMessage': '새 버전: {v}', 'dlg.updCurrent': '현재 버전: {v}', 'dlg.updLatest': '최신 버전: {v}', 'dlg.updNotes': '업데이트 내용:', 'dlg.updDownload': '다운로드', 'dlg.updLater': '나중에', 'dlg.updSkip': '이 버전 건너뛰기', 'dlg.delMsg': '"{name}"을(를) 삭제할까요?\n이 작업은 되돌릴 수 없습니다.', 'dlg.delOk': '삭제',
      'dlg.injectTitle': '주입 확인',
      'dlg.injectMsg': '다음 그룹을 덮어씁니다:\n{group} - {author}\n\n계속할까요?',
      'dlg.injectOk': '주입',
      'dlg.vinylTitle': 'Vinylizer 가져오기', 'dlg.vinylMsg': '불투명도가 이 값 이하인 레이어 무시(0-255):'
    }
  };
  var overwrite = {
    'zh-CN': ['确认覆盖', '已存在同名文件「{name}」。确定覆盖吗？', '文件在确认期间已变化，请重新保存。'],
    'zh-TW': ['確認覆蓋', '同名檔案「{name}」已存在。確定覆蓋嗎？', '確認期間檔案已變更，請重新儲存。'],
    'en': ['Confirm overwrite', '"{name}" already exists. Overwrite it?', 'The file changed during confirmation. Please save again.'],
    'ja': ['上書きの確認', '「{name}」は既に存在します。上書きしますか？', '確認中にファイルが変更されました。もう一度保存してください。'],
    'ko': ['덮어쓰기 확인', '"{name}" 파일이 이미 있습니다. 덮어쓸까요?', '확인 중 파일이 변경되었습니다. 다시 저장하세요.']
  };
  Object.keys(overwrite).forEach(function (lang) {
    DICT[lang]['dlg.overwriteTitle'] = overwrite[lang][0];
    DICT[lang]['dlg.overwriteMsg'] = overwrite[lang][1];
    DICT[lang]['dlg.fileChanged'] = overwrite[lang][2];
  });
  var crash = {
    'zh-CN': {
      msg: '上次运行没有正常退出，可能发生过闪退。',
      detail: '上次启动：{time}\n当时版本：{version}\n判定原因：{why}\n\n可以把崩溃日志导出后发给开发者，帮助我们定位闪退。日志只含运行记录，不含作品内容。',
      exp: '导出崩溃日志', skip: '不用了',
      whyKilled: '程序没有执行正常退出流程（崩溃或被强制结束）',
      whyRenderer: '窗口渲染进程异常退出（{why}）',
      whyUncaught: '主进程未捕获异常（{why}）',
      doneTitle: '崩溃日志已导出',
      done: '已导出 {name}（{size}）。\n反馈问题时请把这个文件一起发给开发者。',
      failTitle: '导出失败', fail: '崩溃日志没能导出：{detail}',
      open: '打开所在文件夹', close: '完成'
    },
    'zh-TW': {
      msg: '上次執行沒有正常結束，可能發生過閃退。',
      detail: '上次啟動：{time}\n當時版本：{version}\n判定原因：{why}\n\n可以匯出崩潰日誌後寄給開發者，協助我們定位閃退。日誌只含執行記錄，不含作品內容。',
      exp: '匯出崩潰日誌', skip: '不用了',
      whyKilled: '程式沒有執行正常結束流程（崩潰或被強制結束）',
      whyRenderer: '視窗轉譯程序異常結束（{why}）',
      whyUncaught: '主程序未攔截的例外（{why}）',
      doneTitle: '崩潰日誌已匯出',
      done: '已匯出 {name}（{size}）。\n回報問題時請把這個檔案一併寄給開發者。',
      failTitle: '匯出失敗', fail: '崩潰日誌無法匯出：{detail}',
      open: '開啟所在資料夾', close: '完成'
    },
    'en': {
      msg: 'The app did not shut down normally last time, so it may have crashed.',
      detail: 'Last start: {time}\nVersion then: {version}\nDetected: {why}\n\nYou can export a crash log and send it to the developer to help fix the crash. The log contains run records only — no artwork.',
      exp: 'Export crash log', skip: 'Not now',
      whyKilled: 'the app did not run its normal exit path (crash, force-kill or power loss)',
      whyRenderer: 'the window renderer process died ({why})',
      whyUncaught: 'an uncaught exception in the main process ({why})',
      doneTitle: 'Crash log exported',
      done: 'Exported {name} ({size}).\nPlease attach this file when reporting the issue.',
      failTitle: 'Export failed', fail: 'The crash log could not be exported: {detail}',
      open: 'Show in folder', close: 'Done'
    },
    'ja': {
      msg: '前回は正常終了していません。クラッシュした可能性があります。',
      detail: '前回の起動：{time}\n当時のバージョン：{version}\n判定理由：{why}\n\nクラッシュログを書き出して開発者に送ると、原因の特定に役立ちます。ログには動作記録のみが含まれ、作品データは含まれません。',
      exp: 'クラッシュログを書き出す', skip: '今はしない',
      whyKilled: '正常終了の処理が実行されていません（クラッシュ／強制終了）',
      whyRenderer: 'ウィンドウのレンダラープロセスが異常終了しました（{why}）',
      whyUncaught: 'メインプロセスの未処理例外（{why}）',
      doneTitle: 'クラッシュログを書き出しました',
      done: '{name}（{size}）を書き出しました。\n問題を報告する際にこのファイルを添付してください。',
      failTitle: '書き出しに失敗しました', fail: 'クラッシュログを書き出せませんでした：{detail}',
      open: 'フォルダーを開く', close: '完了'
    },
    'ko': {
      msg: '지난번 실행이 정상 종료되지 않았습니다. 충돌이 있었을 수 있습니다.',
      detail: '지난 시작: {time}\n당시 버전: {version}\n판정 사유: {why}\n\n충돌 로그를 내보내 개발자에게 보내면 원인 파악에 도움이 됩니다. 로그에는 실행 기록만 포함되며 작품 내용은 없습니다.',
      exp: '충돌 로그 내보내기', skip: '나중에',
      whyKilled: '정상 종료 절차가 실행되지 않았습니다(충돌/강제 종료)',
      whyRenderer: '창 렌더러 프로세스가 비정상 종료되었습니다({why})',
      whyUncaught: '메인 프로세스의 처리되지 않은 예외({why})',
      doneTitle: '충돌 로그를 내보냈습니다',
      done: '{name}({size})을(를) 내보냈습니다.\n문제를 알릴 때 이 파일을 함께 보내 주세요.',
      failTitle: '내보내기 실패', fail: '충돌 로그를 내보내지 못했습니다: {detail}',
      open: '폴더 열기', close: '완료'
    }
  };
  Object.keys(DICT).forEach(function (lang) {
    var c = crash[lang] || crash['zh-CN'];
    DICT[lang]['dlg.crashMsg'] = c.msg;
    DICT[lang]['dlg.crashDetail'] = c.detail;
    DICT[lang]['dlg.crashExport'] = c.exp;
    DICT[lang]['dlg.crashSkip'] = c.skip;
    DICT[lang]['dlg.crashWhyKilled'] = c.whyKilled;
    DICT[lang]['dlg.crashWhyRenderer'] = c.whyRenderer;
    DICT[lang]['dlg.crashWhyUncaught'] = c.whyUncaught;
    DICT[lang]['dlg.crashDoneTitle'] = c.doneTitle;
    DICT[lang]['dlg.crashDone'] = c.done;
    DICT[lang]['dlg.crashFailTitle'] = c.failTitle;
    DICT[lang]['dlg.crashFail'] = c.fail;
    DICT[lang]['dlg.crashOpen'] = c.open;
    DICT[lang]['dlg.crashClose'] = c.close;
  });
  var titles = { 'zh-CN': 'FH6 Vinyl Group Editor', 'zh-TW': 'FH6 Vinyl Group Editor', 'en': 'FH6 Vinyl Group Editor',
    'ja': 'SVG パターンコラージュエディター', 'ko': 'SVG 패턴 콜라주 편집기' };
  Object.keys(titles).forEach(function (l) { if (DICT[l]) DICT[l]['app.title'] = titles[l]; });
  var api = {
    dicts: DICT,
    langs: ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'],
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
  if (typeof App !== 'undefined' && App.i18n && App.i18n.dicts) {
    Object.keys(DICT).forEach(function (lang) {
      if (App.i18n.dicts[lang]) Object.assign(App.i18n.dicts[lang], DICT[lang]);
    });
  }
})();
