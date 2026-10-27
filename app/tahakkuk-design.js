// Presentation layer for the existing Tahakkuk Gönder module.
// File discovery, WhatsApp jobs, persistence and scheduling retain their Apex handlers.
let tdActionBusy = false;
let tdConnectionRequest = 0;

function tdVisibleClients() {
  const q = tgNormalize(document.getElementById('tg-client-search')?.value || '');
  return tgStore.clients.filter(c => !q || tgNormalize(`${c.Unvan} ${c.Telefon} ${c.Klasor}`).includes(q))
    .sort((a, b) => String(a.Unvan || '').localeCompare(String(b.Unvan || ''), 'tr'));
}

tgRenderClients = function () {
  tgEnsureSelectionSets();
  const box = document.getElementById('tg-client-rows');
  if (!box) return;
  box.innerHTML = tdVisibleClients().map(c => `
    <div class="item${tgStore.selectedClientIds.has(c.Id) ? ' sel' : ''}" data-client-id="${escapeAttr(c.Id)}" role="listitem">
      <input class="cb" type="checkbox" data-tg-client="${escapeAttr(c.Id)}" aria-label="${escapeAttr(c.Unvan)} seç" ${tgStore.selectedClientIds.has(c.Id) ? 'checked' : ''}>
      <button class="row-edit" data-edit-client="${escapeAttr(c.Id)}" title="Mükellefi düzenle">
        <span class="nm">${escapeHtml(c.Unvan || '')}</span>
        <span class="fd">${escapeHtml(c.Telefon ? '+' + c.Telefon : 'Telefon eklenmemiş')}</span>
      </button>
      <span class="fl" title="${escapeAttr(c.Klasor || '')}">${escapeHtml(c.Klasor || '')}</span>
    </div>`).join('') || '<div class="empty-list">Kayıt bulunamadı.</div>';
  tdUpdateSummary();
};

tgRenderRecipients = function () {
  tgEnsureSelectionSets();
  const box = document.getElementById('tg-recipient-rows');
  if (!box) return;
  const q = tgNormalize(document.getElementById('tg-recipient-search')?.value || '');
  box.innerHTML = tgStore.recipients
    .filter(r => !q || tgNormalize(`${r.Ad} ${r.Telefon}`).includes(q))
    .sort((a, b) => String(a.Ad || '').localeCompare(String(b.Ad || ''), 'tr'))
    .map(r => `<div class="rec${tgStore.selectedRecipientIds.has(r.Id) ? ' sel' : ''}" data-recipient-id="${escapeAttr(r.Id)}" role="listitem">
      <input class="cb" type="checkbox" data-tg-recipient="${escapeAttr(r.Id)}" aria-label="${escapeAttr(r.Ad)} seç" ${tgStore.selectedRecipientIds.has(r.Id) ? 'checked' : ''}>
      <button class="row-edit" data-edit-recipient="${escapeAttr(r.Id)}" title="Özel kişiyi düzenle"><span class="nm">${escapeHtml(r.Ad || '')}</span><span class="fd">${escapeHtml(r.Telefon ? '+' + r.Telefon : '')}</span></button>
    </div>`).join('') || '<div class="empty-list">Özel kişi bulunamadı.</div>';
  tdUpdateSummary();
};

function tdUpdateSummary() {
  const root = document.getElementById('tahakkuk-gonder-view');
  if (!root) return;
  tgEnsureSelectionSets();
  const clientIds = new Set(tgStore.clients.map(c => c.Id));
  const recipientIds = new Set(tgStore.recipients.map(c => c.Id));
  for (const id of tgStore.selectedClientIds) if (!clientIds.has(id)) tgStore.selectedClientIds.delete(id);
  for (const id of tgStore.selectedRecipientIds) if (!recipientIds.has(id)) tgStore.selectedRecipientIds.delete(id);
  const active = (tgStore.meta?.schedules || []).filter(s => s.status === 'pending' || s.status === 'sending');
  document.getElementById('td-total').textContent = tgStore.clients.length;
  document.getElementById('td-selected').textContent = tgStore.selectedClientIds.size;
  document.getElementById('td-scheduled').textContent = active.length;
  root.querySelectorAll('[data-client-id]').forEach(row => {
    const selected = tgStore.selectedClientIds.has(row.dataset.clientId);
    row.classList.toggle('sel', selected);
    row.querySelector('input').checked = selected;
  });
  root.querySelectorAll('[data-recipient-id]').forEach(row => {
    const selected = tgStore.selectedRecipientIds.has(row.dataset.recipientId);
    row.classList.toggle('sel', selected);
    row.querySelector('input').checked = selected;
  });
  const visible = tdVisibleClients();
  document.getElementById('td-select-all').textContent = visible.length && visible.every(c => tgStore.selectedClientIds.has(c.Id)) ? 'Seçimi kaldır' : 'Tümünü seç';
  const special = document.getElementById('td-special-button');
  special.classList.toggle('on', tgStore.specialOpen);
  special.setAttribute('aria-expanded', String(tgStore.specialOpen));
  document.getElementById('tg-special-box').classList.toggle('open', tgStore.specialOpen);
  const types = [...root.querySelectorAll('input[data-tg-code]:checked')].map(el => el.closest('label').textContent.trim());
  const years = tgYears().join(', ') || 'Yıl seçilmedi';
  const months = tgMonths().join(', ') || 'Ay seçilmedi';
  document.getElementById('td-summary').innerHTML = `${tgStore.selectedClientIds.size} firma${tgStore.specialOpen ? ' + ' + tgStore.selectedRecipientIds.size + ' özel kişi' : ''} seçili<span>${escapeHtml(years)} / ${escapeHtml(months)} · ${escapeHtml(types.join(', ') || (tgSources().length ? 'Tür seçilmedi' : 'Elle dosya seçimi'))}</span>`;
}

function tdToggleAllVisible() {
  if (tdActionBusy) return;
  const list = tdVisibleClients();
  const clear = list.length && list.every(c => tgStore.selectedClientIds.has(c.Id));
  list.forEach(c => clear ? tgStore.selectedClientIds.delete(c.Id) : tgStore.selectedClientIds.add(c.Id));
  tdUpdateSummary();
}

const tdOriginalToggleSelection = tgToggleSelection;
tgToggleSelection = function (...args) {
  tdOriginalToggleSelection(...args);
  tdUpdateSummary();
};
const tdOriginalToggleSpecial = tgToggleSpecial;
tgToggleSpecial = function () {
  if (tdActionBusy) return;
  tdOriginalToggleSpecial();
  tdUpdateSummary();
  if (tgStore.specialOpen) document.getElementById('tg-recipient-search').focus({ preventScroll: true });
};

function tdScheduleMarkup(schedule) {
  const when = new Date(schedule.at);
  const whenText = Number.isNaN(when.getTime()) ? '-' : when.toLocaleString('tr-TR');
  const files = tgScheduleFileNames(schedule);
  const recipients = (schedule.jobs || []).map(job => job.name || job.phone).filter(Boolean).join(', ');
  const pending = schedule.status === 'pending';
  return `<div class="tg-schedule-item">
    <div class="tg-schedule-head"><span>${escapeHtml(whenText)}</span><span class="tg-schedule-status ${tgScheduleStatusClass(schedule.status)}">${escapeHtml(tgScheduleStatusText(schedule.status))}</span></div>
    <div class="tg-schedule-meta">${escapeHtml(recipients || 'Alıcı yok')} · ${schedule.jobs?.length || 0} sohbet · ${files.length} dosya</div>
    <div class="tg-schedule-files">${escapeHtml(files.slice(0, 8).join(', ') || 'Dosya yok')}${files.length > 8 ? escapeHtml(`, … ${files.length - 8} dosya daha`) : ''}</div>
    ${schedule.cancelReason ? `<div class="tg-schedule-meta">${escapeHtml(schedule.cancelReason)}</div>` : ''}
    ${pending ? `<div class="tg-schedule-actions"><button data-schedule-action="add" data-schedule-id="${escapeAttr(schedule.id)}">Ekle</button><button data-schedule-action="edit" data-schedule-id="${escapeAttr(schedule.id)}">Düzenle</button><button class="danger" data-schedule-action="cancel" data-schedule-id="${escapeAttr(schedule.id)}">İptal</button></div>` : ''}
  </div>`;
}

tgRenderSchedules = function () {
  const box = document.getElementById('tg-schedule-list');
  if (!box) return;
  const schedules = tgSchedules().slice().sort((a, b) => new Date(a.at) - new Date(b.at));
  const active = schedules.filter(s => s.status === 'pending' || s.status === 'sending');
  const history = schedules.filter(s => s.status !== 'pending' && s.status !== 'sending');
  document.getElementById('td-schedule-card').classList.toggle('empty', !active.length);
  box.innerHTML = active.length ? active.map(tdScheduleMarkup).join('') : '<p class="schedule-empty">Zamanlanmış gönderim yok.</p>';
  if (history.length) box.innerHTML += `<details class="schedule-history"><summary>Geçmiş (${history.length})</summary>${history.slice().reverse().map(tdScheduleMarkup).join('')}</details>`;
  tdUpdateSummary();
};

tgLog = function (message) {
  const box = document.getElementById('tg-log');
  if (!box) return;
  const time = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  box.insertAdjacentHTML('beforeend', `<div><em>${time}</em>${escapeHtml(message)}</div>`);
  while (box.children.length > 300) box.firstElementChild.remove();
  box.scrollTop = box.scrollHeight;
};

async function tdRunAction(action, button) {
  if (tdActionBusy) return;
  tdActionBusy = true;
  const controls = [...document.querySelectorAll('#tahakkuk-gonder-view button, #tahakkuk-gonder-view input, #tahakkuk-gonder-view textarea')];
  const state = controls.map(el => [el, el.disabled]);
  state.forEach(([el]) => { el.disabled = true; });
  try {
    return await action();
  } catch (error) {
    tgLog(`İşlem hatası: ${error.message || error}`);
    await appAlert(error.message || String(error), 'Tahakkuk Gönder');
  } finally {
    state.forEach(([el, disabled]) => { el.disabled = disabled; });
    tdActionBusy = false;
    tdUpdateSummary();
  }
}

async function tdCheckConnection() {
  const seq = ++tdConnectionRequest;
  const pill = document.getElementById('td-connection');
  const target = document.getElementById('tg-root').value;
  pill.classList.add('offline');
  pill.querySelector('span').textContent = 'Zirve kontrol ediliyor';
  let result;
  try { result = await apexNative.checkTahakkukConnection(target); }
  catch { result = { ok: false, reason: 'Bağlantı kontrol edilemedi' }; }
  if (seq !== tdConnectionRequest) return;
  pill.classList.toggle('offline', !result?.ok);
  pill.querySelector('span').textContent = result?.ok ? 'Zirve bağlı' : 'Zirve bağlı değil';
  pill.title = result?.ok ? 'Ana klasöre erişim doğrulandı' : (result?.reason || 'Ana klasöre erişilemiyor');
}

async function tdSavePaths() {
  tgStore.meta.rootPath = document.getElementById('tg-root').value.trim();
  tgStore.meta.folderTarget = document.getElementById('tg-folder-target').value.trim();
  try { await tgSave({ pushRemote: false }); }
  catch (error) { await appAlert('Klasör ayarı kaydedilemedi: ' + error.message); }
}

const tdOriginalChooseFolder = tgChooseFolderTarget;
tgChooseFolderTarget = async function () {
  await tdOriginalChooseFolder();
  await tdSavePaths();
};

const tdOriginalLoad = tgLoad;
tgLoad = async function () {
  // Original load includes the saved real schedules, records and cloud merge.
  await tdOriginalLoad();
  if (tgStore.meta.rootPath) document.getElementById('tg-root').value = tgStore.meta.rootPath;
  document.getElementById('tg-folder-target').value = tgStore.meta.folderTarget || '';
  tdUpdateSummary();
  tdCheckConnection();
};

tgCloudSyncNow = async function () {
  if (tgSyncBusy) return appAlert('Kayıt eşitlemesi sürüyor. Biraz sonra yeniden deneyin.', 'Senkron');
  if (!isBaserowSyncConfigured()) {
    return appAlert(apexSyncSettings.manualRestorePaused
      ? 'JSON geri yüklemesinden sonra senkron duraklatılmış. Veri Güvenliği bölümünden yeniden açabilirsiniz.'
      : 'Senkron için Apex Ayarlar bölümünde Baserow bağlantısını tanımlayın.', 'Senkron');
  }
  tgSyncBusy = true;
  tgLog('Kayıtlar eşitleniyor…');
  try {
    const remote = await tgReadRemote();
    const merged = tgMergePayload(tgPayload(), remote || {});
    tgApplyPayload(merged);
    await tgSave({ pushRemote: false });
    await tgWriteRemote(tgPayload());
    // Retain native phone-document sync when a newer host provides the bridge.
    if (apexNative.syncTahakkukCloud) {
      const result = await apexNative.syncTahakkukCloud();
      if (result?.message) tgLog(result.message);
    }
    tgRenderClients();
    tgRenderRecipients();
    tgLog(`Senkron tamamlandı: ${tgStore.clients.length} firma, ${tgStore.recipients.length} özel kişi.`);
    tdCheckConnection();
  } finally {
    tgSyncBusy = false;
  }
};

const tdRoot = document.getElementById('tahakkuk-gonder-view');
tdRoot.addEventListener('change', event => {
  const el = event.target;
  if (el.matches('[data-tg-client]')) tgToggleSelection('client', el.dataset.tgClient, el.checked);
  else if (el.matches('[data-tg-recipient]')) tgToggleSelection('recipient', el.dataset.tgRecipient, el.checked);
  else tdUpdateSummary();
});
tdRoot.addEventListener('input', event => {
  if (event.target.id === 'tg-custom-year') tdUpdateSummary();
});
tdRoot.addEventListener('click', event => {
  if (tdActionBusy) return;
  const editClient = event.target.closest('[data-edit-client]');
  const editRecipient = event.target.closest('[data-edit-recipient]');
  const schedule = event.target.closest('[data-schedule-action]');
  if (editClient) return void tdRunAction(() => tgOpenClientEditor(editClient.dataset.editClient), editClient);
  if (editRecipient) return void tdRunAction(() => tgOpenRecipientEditor(editRecipient.dataset.editRecipient), editRecipient);
  if (schedule) {
    const fn = { add: tgAddFilesToSchedule, edit: tgEditScheduleTime, cancel: tgCancelSchedule }[schedule.dataset.scheduleAction];
    return void tdRunAction(() => fn(schedule.dataset.scheduleId), schedule);
  }
  if (event.target.closest('input,button')) return;
  const row = event.target.closest('[data-client-id],[data-recipient-id]');
  if (!row) return;
  const input = row.querySelector('input');
  input.checked = !input.checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
tdRoot.addEventListener('dblclick', event => {
  if (tdActionBusy || event.target.closest('button,input')) return;
  const row = event.target.closest('[data-client-id],[data-recipient-id]');
  if (row?.dataset.clientId) tdRunAction(() => tgOpenClientEditor(row.dataset.clientId));
  else if (row?.dataset.recipientId) tdRunAction(() => tgOpenRecipientEditor(row.dataset.recipientId));
});
