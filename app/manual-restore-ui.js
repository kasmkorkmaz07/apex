let manualRestoreInProgress = false;

function renderManualRestoreState() {
  document.querySelectorAll('.manual-restore-sync-note').forEach(el => {
    el.hidden = !apexSyncSettings.manualRestorePaused;
  });
  if (apexSyncSettings.manualRestorePaused) setSyncStatus('Yedek yüklendi · Senkron duraklatıldı', 'offline', 'Grup düzenini korumak için duraklatıldı. Veri Güvenliği bölümünden yeniden açabilirsiniz.');
}

async function resumeManualRestoreSync() {
  if (!requireAccess('audit', 'Senkronu yeniden aç')) return;
  if (!await appConfirm('Senkron yeniden açıldığında buluttaki kayıtlar bu bilgisayardaki yedekle birleştirilecek. Ana takip ve grup düzenleri değişebilir. Devam edilsin mi?', 'Senkronu yeniden aç')) return;
  const next = { ...apexSyncSettings };
  delete next.manualRestorePaused;
  try {
    await apexNative.writeJson(APEX_SYNC_SETTINGS_KEY, next);
    apexSyncSettings = next;
    try { localStorage.setItem(APEX_SYNC_SETTINGS_KEY, JSON.stringify(next)); } catch {}
    renderManualRestoreState();
    startSync();
  } catch (error) { alert('Senkron ayarı kaydedilemedi: ' + error.message); }
}

function chooseManualRestoreFile() {
  if (manualRestoreInProgress || !requireAccess('audit', 'JSON yedeği geri yükle')) return;
  if (!apexNative?.restoreDeclarations) return alert('JSON geri yükleme için güncel Apex masaüstü uygulamasını açın.');
  document.getElementById('manual-restore-file').click();
}

async function restoreManualJsonFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file || manualRestoreInProgress || !requireAccess('audit', 'JSON yedeği geri yükle')) return;
  let committed = false;
  const button = document.getElementById('manual-restore-button');
  try {
    if (file.size > 100 * 1024 * 1024) throw new Error('Yedek dosyası 100 MB sınırını aşıyor.');
    const imported = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
    const parsed = ApexBackupRestore.decode(imported);
    const s = parsed.summary;
    const date = parsed.createdAt && !Number.isNaN(Date.parse(parsed.createdAt)) ? new Date(parsed.createdAt).toLocaleString('tr-TR') : 'Tarih belirtilmemiş';
    const confirmed = await appConfirm(`${file.name}\n${date}\n\n${s.profiles} profil, ${s.tracks} beyanname listesi, ${s.groups} grup.\nAna takiplerde ${s.mainClients}, gruplarda ${s.groupClients} mükellef kaydı (farklı listelerde aynı kişi bulunabilir).\n\nBu bilgisayardaki beyanname kayıtları, grup üyelikleri, sıraları, dönemleri ve notları yedekteki durumla değiştirilecek. Mevcut durum önce güvenlik yedeğine alınacak.\n\nGrup düzenini korumak için senkron duraklatılacak; Veri Güvenliği bölümünden yeniden açabilirsiniz. Diğer modüllerin kayıtları bu işlemle yüklenmez.\n\nGeri yüklensin mi?`, 'JSON yedeğinden geri yükle');
    if (!confirmed) return;
    manualRestoreInProgress = true;
    button.disabled = true;
    button.textContent = 'Yedek geri yükleniyor…';
    clearTimeout(syncPushTimer);
    clearInterval(syncPullTimer);
    if (storePersistTimer) flushStorePersist();
    const deadline = Date.now() + 15000;
    while (syncPulling || syncPushing || settingsSyncing) {
      if (Date.now() > deadline) throw new Error('Devam eden senkron henüz bitmedi. Biraz sonra yeniden deneyin.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await apexWriteQueue;
    const result = await apexNative.restoreDeclarations(imported, buildFileBackupPayload());
    if (!result?.ok) throw new Error('Geri yükleme doğrulanamadı.');
    committed = true;
    store = parsed.store;
    apexSettings = result.settings;
    apexSyncSettings = result.syncSettings;
    backupStoreCache = result.backups;
    for (const [key, value] of [[STORAGE_KEY, store], [APEX_SETTINGS_KEY, apexSettings], [APEX_SYNC_SETTINGS_KEY, apexSyncSettings], [BACKUP_KEY, backupStoreCache]]) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    }
    storePersistTimer = null;
    syncDirty = false;
    closeDataSafeModal();
    await appAlert('Beyanname kayıtları ve grup düzenleri geri yüklendi.\n\nÖnceki durumun yedeği:\n' + result.safetyPath + '\n\nSenkron duraklatıldı. Apex ekranı şimdi yenilenecek.');
    location.reload();
  } catch (error) {
    await appAlert('JSON yedeği geri yüklenemedi: ' + error.message);
  } finally {
    if (!committed) {
      manualRestoreInProgress = false;
      if (button) { button.disabled = false; button.textContent = 'JSON yedeğinden geri yükle'; }
      if (isAnySyncConfigured() && !syncPulling && !syncPushing && !settingsSyncing) { startSync(); if (syncDirty) queueSyncPush(); }
    }
  }
}
