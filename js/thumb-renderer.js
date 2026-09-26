'use strict';

window.sveThumbHost.onJob(async function (job) {
  const id = job && job.id;
  try {
    const started = performance.now();
    let text = String(job && job.text || '');
    if (!text && job && job.sourcePath) text = await window.sveThumbHost.readSource(job.sourcePath);
    const readDone = performance.now();
    const blob = await window.SveThumbRenderer.renderCardBlob(text, 480);
    const renderDone = performance.now();
    if (job && job.cachePath) {
      const bytes = await blob.arrayBuffer();
      const byteLength = await window.sveThumbHost.writeCache(job.cachePath, bytes);
      window.sveThumbHost.finish({ id: id, ok: true, saved: true, byteLength: byteLength,
        timing: { read: readDone - started, render: renderDone - readDone, total: performance.now() - started } });
      return;
    }
    const url = await new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('PNG 读取失败')); };
      reader.readAsDataURL(blob);
    });
    window.sveThumbHost.finish({ id: id, ok: !!url, url: url || '',
      timing: { read: readDone - started, render: renderDone - readDone, total: performance.now() - started } });
  } catch (e) {
    console.warn('[thumb-worker] 生成失败', String(e && e.message || e).slice(0, 180));
    window.sveThumbHost.finish({ id: id, ok: false, error: String(e && e.message || e).slice(0, 300) });
  }
});
