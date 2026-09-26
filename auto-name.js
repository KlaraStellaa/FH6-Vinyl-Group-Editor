'use strict';

const ILLEGAL = /[\\/:*?\u0022<>|\u0000-\u001f]/g;
const TRIM_EDGE = /^[.\s]+|[.\s]+$/g;
const RESERVED_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const STEM_MAX = 120;
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
