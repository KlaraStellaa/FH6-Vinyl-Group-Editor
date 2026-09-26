'use strict';
/* 多语言（i18n）：词典 + App.i18n（lang / t / set / apply / onApply）+ data-i18n 扫描应用。
   语言集合与选项文字（用各语言自身文字）由主线锁定：
   中文(zh-CN) / 繁體中文(zh-TW) / English(en) / 日本語(ja) / 한국어(ko)。
   自动命名前缀随语言（App.autoNamePrefix），STEM_MAX/去重上限等逻辑在 auto-name.js 不变。

   2026-09-14 扩容：原来只有 25 个 key，工具栏开关、左侧功能栏、编辑栏、颜色面板、
   主页左下角 Forza 坞及其弹出窗口全部漏网。本次补齐「静态 UI 文案」，
   并新增 App.i18n.onApply(fn) 注册机制——凡是**由 JS 动态设置**的文案
   （如「滚轮缩放：开/关」「隐藏图层/显示图层」）都在 apply() 末尾重刷，
   这样切语言时它们才会跟着变。 */
App.i18n = {
  lang: 'zh-CN',
  dicts: {
    'zh-CN': {
      /* --- 原有 --- */
      'home.sort.recent': '最近使用', 'home.sort.name': '名称', 'home.sort.size': '大小',
      'tab.home': '主页', 'tab.new': '新建文档', 'tab.settings': '设置',
      'edit.finish': '完成',
      'home.new': '新建', 'home.open': '打开…', 'home.tab.all': '全部',
      'home.tab.workcopy': '最近工作进程', 'home.tab.svg': 'SVG图像',
      'home.head': '最近使用项', 'home.search': '搜索文件名…', 'home.empty': '暂无文件',
      'home.openBtn': '打开', 'home.rename': '重命名', 'home.import': '导入', 'home.refresh': '刷新', 'home.exportAs': '另存为…', 'home.delete': '删除',
      'lp.title': '此处的图层', 'lp.close': '关闭', 'lp.unnamed': '未命名图层', 'lp.mask': '蒙版',
      /* 自绘标题栏（UI 改良 C 项）：窗口控制键的无障碍名与提示 */
      'win.minimize': '最小化', 'win.maximize': '最大化', 'win.restore': '向下还原', 'win.close': '关闭窗口',
      'tab.untitled': '未命名', 'panel.plusTip': '注入 SVG（同「将 SVG 导入存档」的选择窗口）',
      'app.title': 'FH6 Vinyl Group Editor',
      'home.time.justNow': '刚刚', 'home.time.minutes': '{n} 分钟前', 'home.time.hours': '{n} 小时前',
      'home.time.days': '{n} 天前', 'home.time.months': '{n} 个月前', 'home.time.years': '{n} 年前',
      'dlg.renameTitle': '重命名', 'dlg.renameMsgSvg': '新文件名（保存为：SVGImages）：', 'dlg.renameMsgWork': '新文件名（保存为：工作进程）：',
      'dlg.saveSvgTitle': '保存 SVG', 'dlg.saveSvgMsg': '文件名（保存到软件「SVGImages」目录）：',
      'edit.flip.none': '无翻转', 'edit.flip.h': '水平翻转', 'edit.flip.hv': '水平+垂直翻转', 'edit.flip.v': '垂直翻转',
      'settings.title': '设置', 'settings.lang': '语言 / Language', 'settings.theme': '主题颜色',
      'settings.dark': '深色', 'settings.light': '浅色', 'settings.close': '关闭',
      /* --- 编辑速率设置（设置面板两个入口 + 同一个编辑器窗口） --- */
      'settings.speedWasm': '更改编辑速率', 'settings.speedNudge': '更改微调编辑速率', 'settings.change': '更改',
      'speed.title.wasm': '编辑速率（WASD 连续调整）', 'speed.title.nudge': '微调编辑速率（方向键单步）',
      'speed.move': '移动', 'speed.size': '大小', 'speed.rotate': '旋转', 'speed.skew': '倾斜', 'speed.opacity': '透明度',
      'speed.ok': '确定', 'speed.cancel': '取消', 'speed.reset': '重置',
      'toast.speed.saved': '已保存速率设置', 'toast.speed.saveFail': '速率设置保存失败：{v}',
      'toast.speed.badValue': '速率必须是有限数字且在允许范围内',
      'toolbar.open': '打开 SVG 文件', 'toolbar.save': '保存 SVG', 'toolbar.saveWork': '保存工作进程',
      'toolbar.histAnchor': '恢复工作进程', 'toolbar.log': '日志',
      'panel.lib': '彩绘纹饰形状', 'panel.color': '颜色', 'panel.sub.saved': '已保存的彩绘',
      /* --- 工具栏（画布上方） --- */
      'toolbar.baseLight': '背景：灰白', 'toolbar.baseDark': '背景：灰黑',
      'toolbar.gridOn': '网格：开', 'toolbar.gridOff': '网格：关',
      'toolbar.zoomOn': '滚轮缩放：开', 'toolbar.zoomOff': '滚轮缩放：关',
      'toolbar.openImage': '打开背景图片文件', 'toolbar.bgNone': '背景图片：未设置',
      'toolbar.bgSet': '背景图片：已设置', 'toolbar.shortcuts': '快捷键', 'toolbar.shortcutsAria': '查看快捷键', 'toolbar.tip': 'QuQ',
      /* --- 编辑栏（进入编辑后左上角） --- */
      'edit.mode.move': '移动', 'edit.mode.size': '大小', 'edit.mode.rotate': '旋转',
      'edit.mode.skew': '倾斜', 'edit.mode.opacity': '透明度',
      'edit.handlesOn': '手柄显示：开', 'edit.handlesOff': '手柄显示：关',
      'edit.axisOn': '方向指示：开', 'edit.axisOff': '方向指示：关',
      'edit.anchorPlace': '放置锚点', 'edit.anchorCancel': '取消锚点',
      'edit.propRatio': '等比', 'edit.propFree': '自由',
      'edit.label.rotate': '旋转角度', 'edit.label.skew': '倾斜角度', 'edit.label.opacity': '透明度',
      'edit.removeBg': '移除背景',
      /* --- 画布右上角 --- */
      'canvas.hideLayers': '隐藏图层', 'canvas.showLayers': '显示图层',
      'canvas.hideBg': '隐藏背景', 'canvas.showBg': '显示背景',
      'canvas.opLayers': '图层', 'canvas.opBg': '背景',
      /* --- 左侧图层面板 --- */
      'panel.layers': '图层', 'panel.totalPrefix': '图案总数：',
      /* --- 左侧功能栏 16 键 --- */
      'sel.editPos': '编辑位置', 'sel.editColor': '改变颜色', 'sel.replace': '更换图案',
      'sel.toMask': '切换为蒙版', 'sel.toLayer': '切换为图层',
      'sel.flipH': '水平翻转', 'sel.flipV': '垂直翻转',
      'sel.merge': '创建新图层分组', 'sel.split': '取消分组',
      'sel.cut': '剪切', 'sel.copy': '复制', 'sel.delete': '删除',
      'sel.selectAll': '高亮所有图层', 'sel.clearSel': '取消高亮所有图层', 'sel.locateLayer': '定位图层位置',
      'sel.savePalette': '保存', 'sel.deleteAll': '删除所有图层',
      /* --- 右侧颜色面板 --- */
      'color.eyeLayer': '图层取色', 'color.eyeBg': '背景取色',
      'color.applySection': '应用颜色', 'color.apply': '应用',
      'color.histSection': '历史使用过的颜色', 'color.favSection': '收藏颜色',
      'color.favAdd': '+ 收藏当前', 'color.noHist': '暂无历史颜色', 'color.noFav': '还没有收藏颜色',
      /* --- 主页 / Forza 功能坞 --- */
      'home.account': '账户', 'home.accountTitle': '当前账户（存档操作作用于该账户）',
      'fza.geo': '从 Geometrize JSON 生成', 'fza.vinyl': '从 Vinylizer JSON 生成',
      'fza.backup': '备份当前账户存档', 'fza.inject': '将 SVG 导入存档', 'fza.export': '从存档导出 SVG',
      /* --- Forza 弹出窗口 --- */
      'fza.pickGroup': '选择彩绘纹饰分组', 'fza.pickSvgOpen': '选择要打开的 SVG',
      'fza.pickSvgInject': '选择要注入的 SVG', 'fza.importFile': '导入 SVG 文件…',
      'fza.multi': '多选', 'fza.ok': '确定', 'fza.cancel': '取消', 'fza.cont': '继续', 'fza.empty': '没有可选项',
      /* --- 日志面板 / 加载 --- */
      'log.title': '日志', 'log.copy': '复制最近日志', 'log.open': '保存日志', 'log.close': '关闭',
      'log.view': '查看日志', 'log.savedPath': '已保存：{v}',
      'log.inMemory': '（日志在内存中，共 {n} 条；点「保存日志」才写入文件）',
      'log.pathUnavailable': '（日志路径不可用）',
      'loading.lib': '正在加载图案库…'
    },
    'zh-TW': {
      'home.sort.recent': '最近使用', 'home.sort.name': '名稱', 'home.sort.size': '大小',
      'tab.home': '主頁', 'tab.new': '新建文件', 'tab.settings': '設定',
      'edit.finish': '完成',
      'home.new': '新增', 'home.open': '開啟…', 'home.tab.all': '全部',
      'home.tab.workcopy': '最近工作進程', 'home.tab.svg': 'SVG圖像',
      'home.head': '最近使用項', 'home.search': '搜尋檔名…', 'home.empty': '暫無檔案',
      'home.openBtn': '開啟', 'home.rename': '重新命名', 'home.import': '匯入', 'home.refresh': '重新整理', 'home.exportAs': '另存為…', 'home.delete': '刪除',
      'lp.title': '此處的圖層', 'lp.close': '關閉', 'lp.unnamed': '未命名圖層', 'lp.mask': '遮色片',
      /* 自繪標題列（UI 改良 C 項）：視窗控制鍵的無障礙名與提示 */
      'win.minimize': '最小化', 'win.maximize': '最大化', 'win.restore': '向下還原', 'win.close': '關閉視窗',
      'tab.untitled': '未命名', 'panel.plusTip': '注入 SVG（同「將 SVG 匯入存檔」的選擇視窗）',
      'app.title': 'FH6 Vinyl Group Editor',
      'home.time.justNow': '剛剛', 'home.time.minutes': '{n} 分鐘前', 'home.time.hours': '{n} 小時前',
      'home.time.days': '{n} 天前', 'home.time.months': '{n} 個月前', 'home.time.years': '{n} 年前',
      'dlg.renameTitle': '重新命名', 'dlg.renameMsgSvg': '新檔案名稱（儲存為：SVGImages）：', 'dlg.renameMsgWork': '新檔案名稱（儲存為：工作進程）：',
      'dlg.saveSvgTitle': '儲存 SVG', 'dlg.saveSvgMsg': '檔案名稱（儲存到軟體「SVGImages」目錄）：',
      'edit.flip.none': '無翻轉', 'edit.flip.h': '水平翻轉', 'edit.flip.hv': '水平+垂直翻轉', 'edit.flip.v': '垂直翻轉',
      'settings.title': '設定', 'settings.lang': '語言 / Language', 'settings.theme': '主題顏色',
      'settings.dark': '深色', 'settings.light': '淺色', 'settings.close': '關閉',
      'settings.speedWasm': '變更編輯速率', 'settings.speedNudge': '變更微調編輯速率', 'settings.change': '變更',
      'speed.title.wasm': '編輯速率（WASD 連續調整）', 'speed.title.nudge': '微調編輯速率（方向鍵單步）',
      'speed.move': '移動', 'speed.size': '大小', 'speed.rotate': '旋轉', 'speed.skew': '傾斜', 'speed.opacity': '透明度',
      'speed.ok': '確定', 'speed.cancel': '取消', 'speed.reset': '重設',
      'toast.speed.saved': '已儲存速率設定', 'toast.speed.saveFail': '速率設定儲存失敗：{v}',
      'toast.speed.badValue': '速率必須是有限數字且在允許範圍內',
      'toolbar.open': '開啟 SVG 檔案', 'toolbar.save': '儲存 SVG', 'toolbar.saveWork': '儲存工作進程',
      'toolbar.histAnchor': '恢復工作行程', 'toolbar.log': '日誌',
      'panel.lib': '彩繪紋飾形狀', 'panel.color': '顏色', 'panel.sub.saved': '已儲存的彩繪',
      'toolbar.baseLight': '背景：灰白', 'toolbar.baseDark': '背景：灰黑',
      'toolbar.gridOn': '網格：開', 'toolbar.gridOff': '網格：關',
      'toolbar.zoomOn': '滾輪縮放：開', 'toolbar.zoomOff': '滾輪縮放：關',
      'toolbar.openImage': '開啟背景圖片檔案', 'toolbar.bgNone': '背景圖片：未設定',
      'toolbar.bgSet': '背景圖片：已設定', 'toolbar.shortcuts': '快速鍵', 'toolbar.shortcutsAria': '檢視快速鍵', 'toolbar.tip': 'QuQ',
      'edit.mode.move': '移動', 'edit.mode.size': '大小', 'edit.mode.rotate': '旋轉',
      'edit.mode.skew': '傾斜', 'edit.mode.opacity': '透明度',
      'edit.handlesOn': '手柄顯示：開', 'edit.handlesOff': '手柄顯示：關',
      'edit.axisOn': '方向指示：開', 'edit.axisOff': '方向指示：關',
      'edit.anchorPlace': '放置錨點', 'edit.anchorCancel': '取消錨點',
      'edit.propRatio': '等比', 'edit.propFree': '自由',
      'edit.label.rotate': '旋轉角度', 'edit.label.skew': '傾斜角度', 'edit.label.opacity': '透明度',
      'edit.removeBg': '移除背景',
      'canvas.hideLayers': '隱藏圖層', 'canvas.showLayers': '顯示圖層',
      'canvas.hideBg': '隱藏背景', 'canvas.showBg': '顯示背景',
      'canvas.opLayers': '圖層', 'canvas.opBg': '背景',
      'panel.layers': '圖層', 'panel.totalPrefix': '圖案總數：',
      'sel.editPos': '編輯位置', 'sel.editColor': '改變顏色', 'sel.replace': '更換圖案',
      'sel.toMask': '切換為遮罩', 'sel.toLayer': '切換為圖層',
      'sel.flipH': '水平翻轉', 'sel.flipV': '垂直翻轉',
      'sel.merge': '建立新圖層群組', 'sel.split': '取消群組',
      'sel.cut': '剪下', 'sel.copy': '複製', 'sel.delete': '刪除',
      'sel.selectAll': '反白所有圖層', 'sel.clearSel': '取消反白所有圖層', 'sel.locateLayer': '定位圖層位置',
      'sel.savePalette': '儲存', 'sel.deleteAll': '刪除所有圖層',
      'color.eyeLayer': '圖層取色', 'color.eyeBg': '背景取色',
      'color.applySection': '套用顏色', 'color.apply': '套用',
      'color.histSection': '歷史使用過的顏色', 'color.favSection': '收藏顏色',
      'color.favAdd': '+ 收藏目前', 'color.noHist': '暫無歷史顏色', 'color.noFav': '還沒有收藏顏色',
      'home.account': '帳戶', 'home.accountTitle': '目前帳戶（存檔操作作用於該帳戶）',
      'fza.geo': '從 Geometrize JSON 產生', 'fza.vinyl': '從 Vinylizer JSON 產生',
      'fza.backup': '備份目前帳戶存檔', 'fza.inject': '將 SVG 匯入存檔', 'fza.export': '從存檔匯出 SVG',
      'fza.pickGroup': '選擇彩繪紋飾群組', 'fza.pickSvgOpen': '選擇要開啟的 SVG',
      'fza.pickSvgInject': '選擇要匯入的 SVG', 'fza.importFile': '匯入 SVG 檔案…',
      'fza.multi': '多選', 'fza.ok': '確定', 'fza.cancel': '取消', 'fza.cont': '繼續', 'fza.empty': '沒有可選項',
      'log.title': '日誌', 'log.copy': '複製最近日誌', 'log.open': '儲存日誌', 'log.close': '關閉',
      'log.view': '檢視日誌', 'log.savedPath': '已儲存：{v}',
      'log.inMemory': '（日誌在記憶體中，共 {n} 筆；點「儲存日誌」才寫入檔案）',
      'log.pathUnavailable': '（日誌路徑無法使用）',
      'loading.lib': '正在載入圖案庫…'
    },
    'en': {
      'home.sort.recent': 'Recent', 'home.sort.name': 'Name', 'home.sort.size': 'Size',
      'tab.home': 'Home', 'tab.new': 'New document', 'tab.settings': 'Settings',
      'edit.finish': 'Finish',
      'home.new': 'New', 'home.open': 'Open…', 'home.tab.all': 'All',
      'home.tab.workcopy': 'Recent workcopies', 'home.tab.svg': 'SVG images',
      'home.head': 'Recent files', 'home.search': 'Search files…', 'home.empty': 'No files yet',
      'home.openBtn': 'Open', 'home.rename': 'Rename', 'home.import': 'Import', 'home.refresh': 'Refresh', 'home.exportAs': 'Save as…', 'home.delete': 'Delete',
      'lp.title': 'Layers here', 'lp.close': 'Close', 'lp.unnamed': 'Unnamed layer', 'lp.mask': 'Mask',
      /* Self-drawn title bar (UI improvement item C): accessible names for window controls */
      'win.minimize': 'Minimize', 'win.maximize': 'Maximize', 'win.restore': 'Restore Down', 'win.close': 'Close window',
      'tab.untitled': 'Untitled', 'panel.plusTip': 'Inject SVG (same picker as "Import SVG into save")',
      'app.title': 'FH6 Vinyl Group Editor',
      'home.time.justNow': 'just now', 'home.time.minutes': '{n} min ago', 'home.time.hours': '{n} h ago',
      'home.time.days': '{n} d ago', 'home.time.months': '{n} mo ago', 'home.time.years': '{n} y ago',
      'dlg.renameTitle': 'Rename', 'dlg.renameMsgSvg': 'New file name (saved to SVGImages):', 'dlg.renameMsgWork': 'New file name (saved as a workcopy):',
      'dlg.saveSvgTitle': 'Save SVG', 'dlg.saveSvgMsg': 'File name (saved to the app "SVGImages" folder):',
      'edit.flip.none': 'None', 'edit.flip.h': 'Horizontal', 'edit.flip.hv': 'Horizontal + vertical', 'edit.flip.v': 'Vertical',
      'settings.title': 'Settings', 'settings.lang': 'Language', 'settings.theme': 'Theme color',
      'settings.dark': 'Dark', 'settings.light': 'Light', 'settings.close': 'Close',
      'settings.speedWasm': 'Change editing speed', 'settings.speedNudge': 'Change nudge speed', 'settings.change': 'Change',
      'speed.title.wasm': 'Editing speed (WASD continuous)', 'speed.title.nudge': 'Nudge speed (arrow key step)',
      'speed.move': 'Move', 'speed.size': 'Size', 'speed.rotate': 'Rotate', 'speed.skew': 'Skew', 'speed.opacity': 'Opacity',
      'speed.ok': 'OK', 'speed.cancel': 'Cancel', 'speed.reset': 'Reset',
      'toast.speed.saved': 'Speed settings saved', 'toast.speed.saveFail': 'Failed to save speed settings: {v}',
      'toast.speed.badValue': 'Speed must be a finite number within the allowed range',
      'toolbar.open': 'Open SVG file', 'toolbar.save': 'Save SVG', 'toolbar.saveWork': 'Save workcopy',
      'toolbar.histAnchor': 'Restore work session', 'toolbar.log': 'Log',
      'panel.lib': 'Library shapes', 'panel.color': 'Color', 'panel.sub.saved': 'Saved palettes',
      'toolbar.baseLight': 'Background: light gray', 'toolbar.baseDark': 'Background: dark gray',
      'toolbar.gridOn': 'Grid: on', 'toolbar.gridOff': 'Grid: off',
      'toolbar.zoomOn': 'Wheel zoom: on', 'toolbar.zoomOff': 'Wheel zoom: off',
      'toolbar.openImage': 'Open background image', 'toolbar.bgNone': 'Background: none',
      'toolbar.bgSet': 'Background: set', 'toolbar.shortcuts': 'Shortcuts', 'toolbar.shortcutsAria': 'View shortcuts', 'toolbar.tip': 'QuQ',
      'edit.mode.move': 'Move', 'edit.mode.size': 'Size', 'edit.mode.rotate': 'Rotate',
      'edit.mode.skew': 'Skew', 'edit.mode.opacity': 'Opacity',
      'edit.handlesOn': 'Handles: on', 'edit.handlesOff': 'Handles: off',
      'edit.axisOn': 'Axis hints: on', 'edit.axisOff': 'Axis hints: off',
      'edit.anchorPlace': 'Place anchor', 'edit.anchorCancel': 'Clear anchor',
      'edit.propRatio': 'Uniform', 'edit.propFree': 'Free',
      'edit.label.rotate': 'Angle', 'edit.label.skew': 'Skew angle', 'edit.label.opacity': 'Opacity',
      'edit.removeBg': 'Remove background',
      'canvas.hideLayers': 'Hide layers', 'canvas.showLayers': 'Show layers',
      'canvas.hideBg': 'Hide background', 'canvas.showBg': 'Show background',
      'canvas.opLayers': 'Layers', 'canvas.opBg': 'Background',
      'panel.layers': 'Layers', 'panel.totalPrefix': 'Patterns: ',
      'sel.editPos': 'Edit position', 'sel.editColor': 'Change color', 'sel.replace': 'Replace shape',
      'sel.toMask': 'Convert to mask', 'sel.toLayer': 'Convert to layer',
      'sel.flipH': 'Flip horizontal', 'sel.flipV': 'Flip vertical',
      'sel.merge': 'Create layer group', 'sel.split': 'Ungroup',
      'sel.cut': 'Cut', 'sel.copy': 'Copy', 'sel.delete': 'Delete',
      'sel.selectAll': 'Highlight all layers', 'sel.clearSel': 'Clear highlight', 'sel.locateLayer': 'Locate layer',
      'sel.savePalette': 'Save', 'sel.deleteAll': 'Delete all layers',
      'color.eyeLayer': 'Pick from layer', 'color.eyeBg': 'Pick from background',
      'color.applySection': 'Apply color', 'color.apply': 'Apply',
      'color.histSection': 'Recent colors', 'color.favSection': 'Favorite colors',
      'color.favAdd': '+ Add current', 'color.noHist': 'No recent colors', 'color.noFav': 'No favorites yet',
      'home.account': 'Account', 'home.accountTitle': 'Current account (save operations apply to it)',
      'fza.geo': 'Generate from Geometrize JSON', 'fza.vinyl': 'Generate from Vinylizer JSON',
      'fza.backup': 'Back up current account save', 'fza.inject': 'Import SVG into save',
      'fza.export': 'Export SVG from save',
      'fza.pickGroup': 'Select a vinyl group', 'fza.pickSvgOpen': 'Select an SVG to open',
      'fza.pickSvgInject': 'Select an SVG to import', 'fza.importFile': 'Import SVG file…',
      'fza.multi': 'Multi-select', 'fza.ok': 'OK', 'fza.cancel': 'Cancel', 'fza.cont': 'Continue', 'fza.empty': 'No options',
      'log.title': 'Log', 'log.copy': 'Copy recent log', 'log.open': 'Save log', 'log.close': 'Close',
      'log.view': 'View log', 'log.savedPath': 'Saved: {v}',
      'log.inMemory': '(Log lives in memory, {n} entries; click "Save log" to write it to disk)',
      'log.pathUnavailable': '(Log path unavailable)',
      'loading.lib': 'Loading shape library…'
    },
    'ja': {
      'home.sort.recent': '最近', 'home.sort.name': '名前', 'home.sort.size': 'サイズ',
      'tab.home': 'ホーム', 'tab.new': '新規ドキュメント', 'tab.settings': '設定',
      'edit.finish': '完了',
      'home.new': '新規', 'home.open': '開く…', 'home.tab.all': 'すべて',
      'home.tab.workcopy': '最近のワーク', 'home.tab.svg': 'SVG画像',
      'home.head': '最近のファイル', 'home.search': 'ファイルを検索…', 'home.empty': 'ファイルなし',
      'home.openBtn': '開く', 'home.rename': '名前を変更', 'home.import': 'インポート', 'home.refresh': '更新', 'home.exportAs': '名前を付けて保存…', 'home.delete': '削除',
      'lp.title': 'この位置のレイヤー', 'lp.close': '閉じる', 'lp.unnamed': '無名レイヤー', 'lp.mask': 'マスク',
      /* 自前描画のタイトルバー（UI 改良 C 項）：ウィンドウ操作のアクセシブル名 */
      'win.minimize': '最小化', 'win.maximize': '最大化', 'win.restore': '元のサイズに戻す', 'win.close': 'ウィンドウを閉じる',
      'tab.untitled': '無題', 'panel.plusTip': 'SVG を注入（「SVG をセーブに取り込む」と同じ選択画面）',
      'app.title': 'FH6 Vinyl Group Editor',
      'home.time.justNow': 'たった今', 'home.time.minutes': '{n} 分前', 'home.time.hours': '{n} 時間前',
      'home.time.days': '{n} 日前', 'home.time.months': '{n} か月前', 'home.time.years': '{n} 年前',
      'dlg.renameTitle': '名前を変更', 'dlg.renameMsgSvg': '新しいファイル名（SVGImages に保存）：', 'dlg.renameMsgWork': '新しいファイル名（ワークとして保存）：',
      'dlg.saveSvgTitle': 'SVG を保存', 'dlg.saveSvgMsg': 'ファイル名（アプリの「SVGImages」フォルダに保存）：',
      'edit.flip.none': 'なし', 'edit.flip.h': '水平', 'edit.flip.hv': '水平+垂直', 'edit.flip.v': '垂直',
      'settings.title': '設定', 'settings.lang': '言語', 'settings.theme': 'テーマ色',
      'settings.dark': 'ダーク', 'settings.light': 'ライト', 'settings.close': '閉じる',
      'settings.speedWasm': '編集速度を変更', 'settings.speedNudge': '微調整速度を変更', 'settings.change': '変更',
      'speed.title.wasm': '編集速度（WASD 連続調整）', 'speed.title.nudge': '微調整速度（矢印キー単歩）',
      'speed.move': '移動', 'speed.size': 'サイズ', 'speed.rotate': '回転', 'speed.skew': '傾き', 'speed.opacity': '不透明度',
      'speed.ok': '確定', 'speed.cancel': 'キャンセル', 'speed.reset': 'リセット',
      'toast.speed.saved': '速度設定を保存しました', 'toast.speed.saveFail': '速度設定の保存に失敗：{v}',
      'toast.speed.badValue': '速度は有限の数値で、許容範囲内である必要があります',
      'toolbar.open': 'SVGファイルを開く', 'toolbar.save': 'SVGを保存', 'toolbar.saveWork': 'ワークを保存',
      'toolbar.histAnchor': '作業セッションを復元', 'toolbar.log': 'ログ',
      'panel.lib': '図形ライブラリ', 'panel.color': '色', 'panel.sub.saved': '保存済みパレット',
      'toolbar.baseLight': '背景：ライトグレー', 'toolbar.baseDark': '背景：ダークグレー',
      'toolbar.gridOn': 'グリッド：オン', 'toolbar.gridOff': 'グリッド：オフ',
      'toolbar.zoomOn': 'ホイール拡大：オン', 'toolbar.zoomOff': 'ホイール拡大：オフ',
      'toolbar.openImage': '背景画像を開く', 'toolbar.bgNone': '背景画像：未設定',
      'toolbar.bgSet': '背景画像：設定済み', 'toolbar.shortcuts': 'ショートカット', 'toolbar.shortcutsAria': 'ショートカットを表示', 'toolbar.tip': 'QuQ',
      'edit.mode.move': '移動', 'edit.mode.size': 'サイズ', 'edit.mode.rotate': '回転',
      'edit.mode.skew': '傾き', 'edit.mode.opacity': '不透明度',
      'edit.handlesOn': 'ハンドル表示：オン', 'edit.handlesOff': 'ハンドル表示：オフ',
      'edit.axisOn': '方向表示：オン', 'edit.axisOff': '方向表示：オフ',
      'edit.anchorPlace': 'アンカーを配置', 'edit.anchorCancel': 'アンカーを解除',
      'edit.propRatio': '等倍', 'edit.propFree': '自由',
      'edit.label.rotate': '回転角度', 'edit.label.skew': '傾き角度', 'edit.label.opacity': '不透明度',
      'edit.removeBg': '背景を削除',
      'canvas.hideLayers': 'レイヤーを隠す', 'canvas.showLayers': 'レイヤーを表示',
      'canvas.hideBg': '背景を隠す', 'canvas.showBg': '背景を表示',
      'canvas.opLayers': 'レイヤー', 'canvas.opBg': '背景',
      'panel.layers': 'レイヤー', 'panel.totalPrefix': '図形の総数：',
      'sel.editPos': '位置を編集', 'sel.editColor': '色を変更', 'sel.replace': '図形を差し替え',
      'sel.toMask': 'マスクに変換', 'sel.toLayer': 'レイヤーに変換',
      'sel.flipH': '左右反転', 'sel.flipV': '上下反転',
      'sel.merge': 'レイヤーグループを作成', 'sel.split': 'グループ解除',
      'sel.cut': '切り取り', 'sel.copy': 'コピー', 'sel.delete': '削除',
      'sel.selectAll': 'すべてのレイヤーを強調', 'sel.clearSel': '強調をすべて解除', 'sel.locateLayer': 'レイヤー位置へ移動',
      'sel.savePalette': '保存', 'sel.deleteAll': 'すべてのレイヤーを削除',
      'color.eyeLayer': 'レイヤーから取得', 'color.eyeBg': '背景から取得',
      'color.applySection': '色を適用', 'color.apply': '適用',
      'color.histSection': '最近使った色', 'color.favSection': 'お気に入りの色',
      'color.favAdd': '＋ 現在を追加', 'color.noHist': '履歴はありません', 'color.noFav': 'お気に入りはありません',
      'home.account': 'アカウント', 'home.accountTitle': '現在のアカウント（セーブ操作はこのアカウントに適用）',
      'fza.geo': 'Geometrize JSON から生成', 'fza.vinyl': 'Vinylizer JSON から生成',
      'fza.backup': '現在のアカウントのセーブをバックアップ', 'fza.inject': 'SVG をセーブに取り込む',
      'fza.export': 'セーブから SVG を書き出す',
      'fza.pickGroup': 'ペイントグループを選択', 'fza.pickSvgOpen': '開く SVG を選択',
      'fza.pickSvgInject': '取り込む SVG を選択', 'fza.importFile': 'SVGファイルを読み込む…',
      'fza.multi': '複数選択', 'fza.ok': 'OK', 'fza.cancel': 'キャンセル', 'fza.cont': '続行', 'fza.empty': '項目がありません',
      'log.title': 'ログ', 'log.copy': '最近のログをコピー', 'log.open': 'ログを保存', 'log.close': '閉じる',
      'log.view': 'ログを表示', 'log.savedPath': '保存しました：{v}',
      'log.inMemory': '（ログはメモリ上に {n} 件。書き出すには「ログを保存」を押してください）',
      'log.pathUnavailable': '（ログのパスを取得できません）',
      'loading.lib': '図形ライブラリを読み込み中…'
    },
    'ko': {
      'home.sort.recent': '최근', 'home.sort.name': '이름', 'home.sort.size': '크기',
      'tab.home': '홈', 'tab.new': '새 문서', 'tab.settings': '설정',
      'edit.finish': '완료',
      'home.new': '새로 만들기', 'home.open': '열기…', 'home.tab.all': '전체',
      'home.tab.workcopy': '최근 작업', 'home.tab.svg': 'SVG 이미지',
      'home.head': '최근 파일', 'home.search': '파일 검색…', 'home.empty': '파일 없음',
      'home.openBtn': '열기', 'home.rename': '이름 바꾸기', 'home.import': '가져오기', 'home.refresh': '새로 고침', 'home.exportAs': '다른 이름으로 저장…', 'home.delete': '삭제',
      'lp.title': '이 위치의 레이어', 'lp.close': '닫기', 'lp.unnamed': '이름 없는 레이어', 'lp.mask': '마스크',
      /* 자체 그린 제목 표시줄(UI 개선 C 항목): 창 컨트롤 접근성 이름 */
      'win.minimize': '최소화', 'win.maximize': '최대화', 'win.restore': '이전 크기로', 'win.close': '창 닫기',
      'tab.untitled': '제목 없음', 'panel.plusTip': 'SVG 주입("SVG를 세이브에 가져오기"와 같은 선택 창)',
      'app.title': 'FH6 Vinyl Group Editor',
      'home.time.justNow': '방금', 'home.time.minutes': '{n}분 전', 'home.time.hours': '{n}시간 전',
      'home.time.days': '{n}일 전', 'home.time.months': '{n}개월 전', 'home.time.years': '{n}년 전',
      'dlg.renameTitle': '이름 바꾸기', 'dlg.renameMsgSvg': '새 파일 이름(SVGImages에 저장):', 'dlg.renameMsgWork': '새 파일 이름(작업 파일로 저장):',
      'dlg.saveSvgTitle': 'SVG 저장', 'dlg.saveSvgMsg': '파일 이름(앱 "SVGImages" 폴더에 저장):',
      'edit.flip.none': '없음', 'edit.flip.h': '가로', 'edit.flip.hv': '가로+세로', 'edit.flip.v': '세로',
      'settings.title': '설정', 'settings.lang': '언어', 'settings.theme': '테마 색',
      'settings.dark': '어두움', 'settings.light': '밝음', 'settings.close': '닫기',
      'settings.speedWasm': '편집 속도 변경', 'settings.speedNudge': '미세 조정 속도 변경', 'settings.change': '변경',
      'speed.title.wasm': '편집 속도 (WASD 연속 조정)', 'speed.title.nudge': '미세 조정 속도 (방향키 단계)',
      'speed.move': '이동', 'speed.size': '크기', 'speed.rotate': '회전', 'speed.skew': '기울기', 'speed.opacity': '불투명도',
      'speed.ok': '확인', 'speed.cancel': '취소', 'speed.reset': '초기화',
      'toast.speed.saved': '속도 설정을 저장했습니다', 'toast.speed.saveFail': '속도 설정 저장 실패: {v}',
      'toast.speed.badValue': '속도는 유한한 숫자여야 하며 허용 범위 안이어야 합니다',
      'toolbar.open': 'SVG 파일 열기', 'toolbar.save': 'SVG 저장', 'toolbar.saveWork': '작업 저장',
      'toolbar.histAnchor': '작업 세션 복원', 'toolbar.log': '로그',
      'panel.lib': '도형 라이브러리', 'panel.color': '색', 'panel.sub.saved': '저장된 팔레트',
      'toolbar.baseLight': '배경: 밝은 회색', 'toolbar.baseDark': '배경: 어두운 회색',
      'toolbar.gridOn': '격자: 켜짐', 'toolbar.gridOff': '격자: 꺼짐',
      'toolbar.zoomOn': '휠 확대: 켜짐', 'toolbar.zoomOff': '휠 확대: 꺼짐',
      'toolbar.openImage': '배경 이미지 열기', 'toolbar.bgNone': '배경 이미지: 없음',
      'toolbar.bgSet': '배경 이미지: 설정됨', 'toolbar.shortcuts': '단축키', 'toolbar.shortcutsAria': '단축키 보기', 'toolbar.tip': 'QuQ',
      'edit.mode.move': '이동', 'edit.mode.size': '크기', 'edit.mode.rotate': '회전',
      'edit.mode.skew': '기울기', 'edit.mode.opacity': '불투명도',
      'edit.handlesOn': '핸들 표시: 켜짐', 'edit.handlesOff': '핸들 표시: 꺼짐',
      'edit.axisOn': '방향 표시: 켜짐', 'edit.axisOff': '방향 표시: 꺼짐',
      'edit.anchorPlace': '앵커 배치', 'edit.anchorCancel': '앵커 해제',
      'edit.propRatio': '등비', 'edit.propFree': '자유',
      'edit.label.rotate': '회전 각도', 'edit.label.skew': '기울기 각도', 'edit.label.opacity': '불투명도',
      'edit.removeBg': '배경 제거',
      'canvas.hideLayers': '레이어 숨기기', 'canvas.showLayers': '레이어 표시',
      'canvas.hideBg': '배경 숨기기', 'canvas.showBg': '배경 표시',
      'canvas.opLayers': '레이어', 'canvas.opBg': '배경',
      'panel.layers': '레이어', 'panel.totalPrefix': '도형 총수: ',
      'sel.editPos': '위치 편집', 'sel.editColor': '색 변경', 'sel.replace': '도형 교체',
      'sel.toMask': '마스크로 전환', 'sel.toLayer': '레이어로 전환',
      'sel.flipH': '좌우 반전', 'sel.flipV': '상하 반전',
      'sel.merge': '레이어 그룹 만들기', 'sel.split': '그룹 해제',
      'sel.cut': '잘라내기', 'sel.copy': '복사', 'sel.delete': '삭제',
      'sel.selectAll': '모든 레이어 강조', 'sel.clearSel': '강조 모두 해제', 'sel.locateLayer': '레이어 위치로 이동',
      'sel.savePalette': '저장', 'sel.deleteAll': '모든 레이어 삭제',
      'color.eyeLayer': '레이어에서 추출', 'color.eyeBg': '배경에서 추출',
      'color.applySection': '색 적용', 'color.apply': '적용',
      'color.histSection': '최근 사용한 색', 'color.favSection': '즐겨찾기 색',
      'color.favAdd': '+ 현재 추가', 'color.noHist': '최근 색 없음', 'color.noFav': '즐겨찾기 없음',
      'home.account': '계정', 'home.accountTitle': '현재 계정(저장 작업이 이 계정에 적용됨)',
      'fza.geo': 'Geometrize JSON에서 생성', 'fza.vinyl': 'Vinylizer JSON에서 생성',
      'fza.backup': '현재 계정 세이브 백업', 'fza.inject': 'SVG를 세이브로 가져오기',
      'fza.export': '세이브에서 SVG 내보내기',
      'fza.pickGroup': '페인트 그룹 선택', 'fza.pickSvgOpen': '열 SVG 선택',
      'fza.pickSvgInject': '가져올 SVG 선택', 'fza.importFile': 'SVG 파일 가져오기…',
      'fza.multi': '다중 선택', 'fza.ok': '확인', 'fza.cancel': '취소', 'fza.cont': '계속', 'fza.empty': '항목이 없습니다',
      'log.title': '로그', 'log.copy': '최근 로그 복사', 'log.open': '로그 저장', 'log.close': '닫기',
      'log.view': '로그 보기', 'log.savedPath': '저장했습니다: {v}',
      'log.inMemory': '(로그는 메모리에 {n}건 있습니다. 파일로 쓰려면 「로그 저장」을 누르세요)',
      'log.pathUnavailable': '(로그 경로를 사용할 수 없음)',
      'loading.lib': '도형 라이브러리 불러오는 중…'
    }
  },
  /* 动态文案重刷器：由各模块注册，apply() 末尾统一调用。
     （app 里很多文案是 JS 按当前状态拼出来的，如「滚轮缩放：开/关」，
      data-i18n 扫描管不到，必须靠这里重刷，否则切语言时它们不变。） */
  refreshers: [],
  onApply(fn) { if (typeof fn === 'function') this.refreshers.push(fn); },
  t(key) {
    const d = this.dicts[this.lang] || this.dicts['zh-CN'];
    return (d && d[key]) || (this.dicts['zh-CN'] || {})[key] || key;
  },
  /* 带占位符的取词：词典里写 '已导入 {n} 个图层'，调用 tf('toast.imported', {n: 5})。
     未提供的占位符替换为空串——{extra}/{files}/{ov} 这类「可选片段」正是靠这个语义。 */
  tf(key, params) {
    const s = this.t(key);
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, (m, k) =>
      (params[k] === undefined || params[k] === null) ? '' : String(params[k]));
  },
  /* 扫描 [data-i18n]（textContent）与 [data-i18n-attr]（指定属性，如 placeholder/title）。
     textContent 同时写入同名属性（判据 UI 探针按 getAttribute('textContent') 读取）；
     标签栏文案由 renderBar 用 t() 动态生成，这里只在 Tabs 可用时重渲一次 */
  apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(el => {
      const v = this.t(el.getAttribute('data-i18n'));
      const attr = el.getAttribute('data-i18n-attr');
      if (attr) el.setAttribute(attr, v);
      else {
        /* 编辑栏的模式按钮内含 <kbd> 子元素：只替换文本节点，别把 kbd 冲掉 */
        const keep = el.getAttribute('data-i18n-keep');
        if (keep) {
          let done = false;
          el.childNodes.forEach(n => {
            if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = v; done = true; }
          });
          if (!done) { el.appendChild(document.createTextNode(v)); }
        } else {
          el.textContent = v;
        }
        el.setAttribute('textContent', v);
      }
    });
    if (App.Tabs && App.Tabs.renderBar) App.Tabs.renderBar();
    /* 动态文案重刷：某个刷新器抛错不能拖垮其它刷新器 */
    this.refreshers.forEach(fn => {
      try { fn(); } catch (e) { console.warn('[i18n] refresher failed', e); }
    });
  },
  set(lang) {
    if (!this.dicts[lang]) return;
    this.lang = lang;
    document.documentElement.lang = lang;
    this.apply();
    if (App.settings) App.settings.save();
  }
};
/* 自动命名前缀（主线锁定口径；前缀表与 main 侧 auto-name.js 保持一致） */
App.autoNamePrefix = function (lang) {
  const table = { 'zh-CN': '图案-', 'zh-TW': '圖案-', 'en': 'Pattern-', 'ja': 'パターン-', 'ko': '패턴-' };
  return table[lang || (App.i18n && App.i18n.lang) || 'zh-CN'] || '图案-';
};
