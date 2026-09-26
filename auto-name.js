'use strict';
/* file-auto-save 命名解析（纯函数，可被 node 直接 require 做秒级判据）
   规则与渲染层 js/fza.js 的官方导出命名同源（开源版已剥离该功能，命名规则保留）：
   - 显式传入 fileName（svg 类目）→ 安全化官方名；空结果回退 Exported_Forza_VinylGroup
   - 未传 fileName → 保持既有默认 图案-<时间戳>.svg / 工作进程-<时间戳>.svework
   - 同名已存在 → 扩展名前加 -2 / -3 …（本函数绝不覆盖既有文件）
   - 注意：工作进程的「覆盖原文件」不走本函数，而是由 workcopy-store.js 按打开时签发的
     源句柄回写（见 main.js 的 file-save-work）。本函数只负责【新建文件】的命名。
   - stem 命中 Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9，不分大小写）→ 加 _ 前缀
   - stem 超过 120 字符 → 截断到 120（最终文件名远小于 200 上限）
   - dedupe 撞名到 -9999 仍冲突 → 退回 stem-<Date.now36>，再冲突则抛错（宁可不存也不覆盖）
   与渲染层的差异仅在「净化为空」时的兜底位置：渲染层的官方导出命名函数直接返回
   Exported_Forza_VinylGroup，本模块 safeFileTitle 返回空串、由 resolveAutoSaveName 统一兜底
   —— 端到端最终文件名一致，属有意设计，勿改行为。 */

const ILLEGAL = /[\\/:*?\u0022<>|\u0000-\u001f]/g;
const TRIM_EDGE = /^[.\s]+|[.\s]+$/g;
const RESERVED_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const STEM_MAX = 120;
/* 自动命名前缀随界面语言（与渲染层 js/i18n.js 的 App.autoNamePrefix 同表）；
   仅前缀表改动——STEM_MAX、9999 去重上限等逻辑不变 */
const NAME_PREFIX = {
  svg: { 'zh-CN': '图案-', 'zh-TW': '圖案-', 'en': 'Pattern-', 'ja': 'パターン-', 'ko': '패턴-' },
  work: { 'zh-CN': '工作进程-', 'zh-TW': '工作進程-', 'en': 'Workcopy-', 'ja': 'ワーク-', 'ko': '작업-' }
};

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function fnameTs(d) {
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
    pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

function safeFileTitle(title) {
  let s = String(title === undefined || title === null ? '' : title);
  s = s.replace(ILLEGAL, '_');
  s = s.replace(TRIM_EDGE, '');
  return s;
}

function stripExt(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

function defaultName(kind, date, lang) {
  const d = date instanceof Date ? date : new Date();
  const isSvg = kind === 'svg';
  const table = isSvg ? NAME_PREFIX.svg : NAME_PREFIX.work;
  const pre = table[lang || 'zh-CN'] || table['zh-CN'];
  return pre + fnameTs(d) + (isSvg ? '.svg' : '.svework');
}

function dedupe(name, exists, ext) {
  if (!exists(name)) return name;
  const stem = stripExt(name);
  let i = 1;
  let candidate = name;
  while (exists(candidate) && i < 9999) {
    i++;
    candidate = stem + '-' + i + ext;
  }
  if (!exists(candidate)) return candidate;
  candidate = stem + '-' + Date.now().toString(36) + ext;
  if (!exists(candidate)) return candidate;
  throw new Error('auto-name: 候选文件名全部被占用，拒绝覆盖: ' + name);
}

function resolveAutoSaveName(kind, fileName, exists, date, lang) {
  const isSvg = kind === 'svg';
  const ext = isSvg ? '.svg' : '.svework';
  const existsFn = typeof exists === 'function' ? exists : function () { return false; };
  const passed = isSvg && fileName !== undefined && fileName !== null && String(fileName).length > 0;
  if (!passed) return dedupe(defaultName(kind, date, lang), existsFn, ext);
  let stem = safeFileTitle(stripExt(String(fileName)));
  if (!stem) stem = 'Exported_Forza_VinylGroup';
  if (stem.length > STEM_MAX) stem = stem.slice(0, STEM_MAX);
  if (RESERVED_DEVICE.test(stem)) stem = '_' + stem;
  return dedupe(stem + ext, existsFn, ext);
}

module.exports = { resolveAutoSaveName: resolveAutoSaveName, safeFileTitle: safeFileTitle,
  defaultName: defaultName, dedupe: dedupe };
