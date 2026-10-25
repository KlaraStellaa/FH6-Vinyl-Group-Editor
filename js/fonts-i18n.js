'use strict';
/* 「设置 → 更改字体」的词条（加载时并入 App.i18n.dicts，与 shortcuts / keymap / help 同一套做法）。
   该功能按需求**只对中文开放**：非中文语言下设置里那一行整行置灰、不可进入；
   词条仍按 5 语言给全，避免切语言时任何一处 t() 落到裸 key 上。 */
App.FONT_I18N = {
  'zh-CN': {
    'settings.font': '更改字体',
    'font.default': '默认字体',
    'font.title': '更改字体',
    'font.empty': '还没有导入字体。点右下角「导入」选择字体文件。',
    'font.import': '导入',
    'font.confirm': '确认',
    'font.download': '下载字体',
    'font.deleteTitle': '是否删除',
    'font.deleteMsg': '删除字体「{v}」？',
    'font.yes': '是',
    'font.no': '否',
    'font.importFail': '字体导入失败',
    'font.deleteFail': '字体删除失败',
    'font.imported': '已导入 {v} 个字体'
  },
  'zh-TW': {
    'settings.font': '變更字型',
    'font.default': '預設字型',
    'font.title': '變更字型',
    'font.empty': '還沒有匯入字型。點右下角「匯入」選擇字型檔案。',
    'font.import': '匯入',
    'font.confirm': '確認',
    'font.download': '下載字型',
    'font.deleteTitle': '是否刪除',
    'font.deleteMsg': '刪除字型「{v}」？',
    'font.yes': '是',
    'font.no': '否',
    'font.importFail': '字型匯入失敗',
    'font.deleteFail': '字型刪除失敗',
    'font.imported': '已匯入 {v} 個字型'
  },
  'en': {
    'settings.font': 'Change font',
    'font.default': 'Default font',
    'font.title': 'Change font',
    'font.empty': 'No fonts imported yet. Click Import to pick a font file.',
    'font.import': 'Import',
    'font.confirm': 'OK',
    'font.download': 'Download fonts',
    'font.deleteTitle': 'Delete font',
    'font.deleteMsg': 'Delete "{v}"?',
    'font.yes': 'Yes',
    'font.no': 'No',
    'font.importFail': 'Font import failed',
    'font.deleteFail': 'Font delete failed',
    'font.imported': 'Imported {v} font(s)'
  },
  'ja': {
    'settings.font': 'フォントを変更',
    'font.default': '既定のフォント',
    'font.title': 'フォントを変更',
    'font.empty': 'フォントがまだありません。「インポート」から選択してください。',
    'font.import': 'インポート',
    'font.confirm': 'OK',
    'font.download': 'フォントをダウンロード',
    'font.deleteTitle': '削除しますか',
    'font.deleteMsg': '「{v}」を削除しますか？',
    'font.yes': 'はい',
    'font.no': 'いいえ',
    'font.importFail': 'フォントのインポートに失敗しました',
    'font.deleteFail': 'フォントの削除に失敗しました',
    'font.imported': '{v} 個のフォントをインポートしました'
  },
  'ko': {
    'settings.font': '글꼴 변경',
    'font.default': '기본 글꼴',
    'font.title': '글꼴 변경',
    'font.empty': '아직 가져온 글꼴이 없습니다. "가져오기"를 눌러 선택하세요.',
    'font.import': '가져오기',
    'font.confirm': '확인',
    'font.download': '글꼴 내려받기',
    'font.deleteTitle': '삭제할까요',
    'font.deleteMsg': '"{v}" 글꼴을 삭제할까요?',
    'font.yes': '예',
    'font.no': '아니요',
    'font.importFail': '글꼴 가져오기 실패',
    'font.deleteFail': '글꼴 삭제 실패',
    'font.imported': '글꼴 {v}개를 가져왔습니다'
  }
};
Object.keys(App.FONT_I18N).forEach(function (lang) {
  if (App.i18n.dicts[lang]) Object.assign(App.i18n.dicts[lang], App.FONT_I18N[lang]);
});
