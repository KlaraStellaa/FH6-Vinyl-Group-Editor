'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveAutoSaveName } = require('./auto-name');
const hash = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// Write a complete, flushed sibling first. Never truncate a user's original file.
// New files are published exclusively; existing targets are replaced by rename.
function atomicWrite(fp, text, replace, io = fs) {
  const tmp = fp + '.' + crypto.randomUUID() + '.tmp';
  let fd;
  try {
    fd = io.openSync(tmp, 'wx');
    io.writeFileSync(fd, text, 'utf8');
    io.fsyncSync(fd);
    io.closeSync(fd); fd = undefined;
    if (replace) io.renameSync(tmp, fp);
    else io.linkSync(tmp, fp); // fails with EEXIST rather than overwriting a collision
  } finally {
    if (fd !== undefined) { try { io.closeSync(fd); } catch (_) {} }
    try { io.unlinkSync(tmp); } catch (_) {}
  }
}

class WorkcopyStore {
  constructor(io = fs) {
    this.fs = io;
    this.sources = new Map();
  }
  validate(text) {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 200 * 1024 * 1024)
      throw new Error('工作进程内容无效或超过 200 MB');
    const data = JSON.parse(text);
    if (!data || data.type !== 'sve-work-copy' || !Array.isArray(data.layers))
      throw new Error('不是有效的工作进程，已取消保存');
  }
  source(fp, text) {
    const resolved = path.resolve(fp);
    let id;
    for (const [key, value] of this.sources) {
      if (value === resolved) { id = key; break; }
    }
    if (!id) { id = crypto.randomUUID(); this.sources.set(id, resolved); }
    return { id, path: resolved, name: path.basename(resolved), revision: hash(text) };
  }
  read(fp) {
    if (this.fs.statSync(fp).size > 200 * 1024 * 1024) throw new Error('文件过大');
    const content = this.fs.readFileSync(fp, 'utf8');
    this.validate(content);
    return { ok: true, content, name: path.basename(fp), source: this.source(fp, content) };
  }
  renamed(oldPath, newPath) {
    oldPath = path.resolve(oldPath); newPath = path.resolve(newPath);
    for (const [id, fp] of this.sources) if (fp === oldPath) this.sources.set(id, newPath);
  }
  save(content, source, dir, lang) {
    this.validate(content);
    const io = this.fs;
    let fp, backup = null;
    if (source) {
      // Only a capability issued by file-read / the native open dialog is accepted.
      // Never trust an arbitrary path or filename received over IPC.
      fp = this.sources.get(source.id);
      if (!fp || typeof source.revision !== 'string') throw new Error('源文件关联已失效，请重新打开文件');
      if (!io.existsSync(fp)) throw new Error('源文件已移动或删除，请重新打开；未重建旧文件');
      const oldText = io.readFileSync(fp, 'utf8');
      if (hash(oldText) !== source.revision)
        throw new Error('源文件已被其他标签或程序修改。为避免覆盖较新的内容，保存已停止；请先另存当前内容再重新打开');
      // Keep one recoverable previous version, outside the home list (.bak extension).
      backup = fp + '.bak';
      atomicWrite(backup, oldText, true, io);
      // Detect external changes that happened while the backup was being written.
      if (hash(io.readFileSync(fp, 'utf8')) !== source.revision)
        throw new Error('保存期间源文件发生变化，已停止覆盖');
      atomicWrite(fp, content, true, io);
    } else {
      const name = resolveAutoSaveName('workcopy', undefined, n => io.existsSync(path.join(dir, n)), undefined, lang);
      fp = path.join(dir, name);
      atomicWrite(fp, content, false, io);
    }
    return { ok: true, name: path.basename(fp), path: fp, backup, source: this.source(fp, content) };
  }
}
module.exports = { WorkcopyStore, atomicWrite };
