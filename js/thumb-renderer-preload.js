'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

contextBridge.exposeInMainWorld('sveThumbHost', {
  onJob: callback => ipcRenderer.on('sve-thumb-job', (_event, job) => callback(job)),
  finish: result => ipcRenderer.send('sve-thumb-result', result),
  readSource: filePath => {
    const fp = String(filePath || '');
    if (!/\.svg$/i.test(fp)) return Promise.reject(new Error('缩略图源文件无效'));
    return fs.promises.readFile(fp, 'utf8');
  },
  writeCache: async (filePath, bytes) => {
    const fp = path.resolve(String(filePath || ''));
    const name = path.basename(fp);
    if (path.basename(path.dirname(fp)) !== 'svg-thumb-cache' || !/^[a-f0-9]{40}\.png$/i.test(name)) {
      throw new Error('缩略图缓存路径无效');
    }
    const data = Buffer.from(bytes);
    if (data.length < 8 || data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) {
      throw new Error('缩略图 PNG 数据无效');
    }
    await fs.promises.mkdir(path.dirname(fp), { recursive: true });
    await fs.promises.writeFile(fp, data);
    return data.length;
  }
});
