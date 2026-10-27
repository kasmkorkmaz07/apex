'use strict';
const fs = require('fs');
const { decode, prepareSettings } = require('./app/backup-restore.js');

// All filesystem dependencies are injected so rollback can be exercised in isolation.
module.exports = function restoreDeclarations(input, live, io) {
  const backup = decode(input);
  const before = decode({ live });
  const settings = prepareSettings(live.settings || io.read('apex_settings', {}), backup);
  const syncSettings = { ...io.read('apex_sync_settings', {}), manualRestorePaused: true };
  const backups = [{ at: new Date().toISOString(), reason: 'JSON geri yükleme öncesi', store: before.store },
    ...(Array.isArray(live.quickBackups) ? live.quickBackups : [])].slice(0, 2);
  const entries = [
    ['beyanname_takip_v6', backup.store], ['apex_settings', settings],
    ['apex_sync_settings', syncSettings], ['beyanname_takip_guvenli_yedekler_v1', backups]
  ];
  const originals = entries.map(([key]) => {
    const file = io.file(key);
    return { file, bytes: fs.existsSync(file) ? fs.readFileSync(file) : null };
  });
  const safetyPath = io.backup('json-geri-yukleme-oncesi', live);
  const verified = JSON.parse(fs.readFileSync(safetyPath, 'utf8'));
  if (JSON.stringify(verified.live?.store) !== JSON.stringify(live.store)) throw new Error('İşlem öncesi yedek doğrulanamadı; kayıtlar değiştirilmedi.');
  try {
    for (const [key, value] of entries) {
      io.write(key, value);
      if (JSON.stringify(io.read(key, null)) !== JSON.stringify(value)) throw new Error('Geri yüklenen kayıt doğrulanamadı.');
    }
  } catch (error) {
    let rollbackFailed = false;
    for (const { file, bytes } of originals) {
      try {
        if (bytes === null) { if (fs.existsSync(file)) fs.unlinkSync(file); }
        else { fs.writeFileSync(file + '.rollback', bytes); fs.renameSync(file + '.rollback', file); }
      } catch { rollbackFailed = true; }
    }
    throw new Error((rollbackFailed ? 'Geri alma tamamlanamadı. Güvenlik yedeği: ' + safetyPath : 'Geri yükleme tamamlanamadı; önceki kayıtlar korundu.') + ' ' + error.message);
  }
  return { ok: true, safetyPath, settings, syncSettings, backups, summary: backup.summary };
};
