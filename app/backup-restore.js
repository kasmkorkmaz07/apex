(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ApexBackupRestore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const own = (value, key) => object(value) && Object.prototype.hasOwnProperty.call(value, key);
  const clone = value => JSON.parse(JSON.stringify(value));
  function fail(message) { throw new Error('Geçersiz Apex yedeği: ' + message); }
  function decode(input) {
    if (!object(input)) fail('JSON nesnesi bekleniyor.');
    let source, settings = null;
    if (own(input.live, 'store')) {
      source = input.live.store;
      settings = input.live.settings;
    } else if (own(input.data, 'beyanname_takip_v6')) {
      source = input.data.beyanname_takip_v6;
      settings = input.data.apex_settings;
    } else if (own(input, 'profiles')) source = input;
    else fail('beyanname takip kayıtları bulunamadı.');
    if (!object(source) || !object(source.profiles) || !Object.keys(source.profiles).length) fail('profil yapısı eksik.');
    const summary = { profiles: 0, tracks: 0, groups: 0, mainClients: 0, groupClients: 0 };
    function checkKey(key) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('desteklenmeyen alan adı.');
    }
    function track(value, isGroup, depth = 0) {
      if (depth > 10 || !object(value) || !Array.isArray(value.masterList)) fail('mükellef listesi veya grup yapısı hatalı.');
      if (value.masterList.some(name => typeof name !== 'string' || !name.trim())) fail('mükellef adı hatalı.');
      for (const key of ['periodData', 'notesData', 'periodNotesData', 'clientDetails', 'deletedClients', 'deletedGroups', 'groups']) {
        if (own(value, key) && !object(value[key])) fail(key + ' alanı hatalı.');
      }
      for (const rows of Object.values(value.periodData || {})) {
        if (!object(rows) || Object.values(rows).some(row => !object(row))) fail('dönem kayıtları hatalı.');
      }
      summary[isGroup ? 'groupClients' : 'mainClients'] += value.masterList.length;
      for (const [id, group] of Object.entries(value.groups || {})) {
        checkKey(id); summary.groups++; track(group, true, depth + 1);
      }
    }
    for (const [name, profile] of Object.entries(source.profiles)) {
      checkKey(name);
      if (!name.trim() || !object(profile)) fail('profil kaydı hatalı.');
      summary.profiles++;
      for (const [type, data] of Object.entries(profile)) {
        checkKey(type); summary.tracks++; track(data, false);
      }
    }
    if (settings != null && !object(settings)) fail('ayar yapısı hatalı.');
    if (settings?.declarationTypes != null && (!Array.isArray(settings.declarationTypes) || settings.declarationTypes.some(t => !object(t) || typeof t.id !== 'string'))) fail('beyanname türleri hatalı.');
    const store = clone(source);
    delete store.apexDebtTracker;
    return { store, settings: settings ? clone(settings) : null, summary, createdAt: input.meta?.createdAt || null };
  }
  function prepareSettings(current, backup) {
    const settings = clone(current || {});
    settings.profiles = Object.keys(backup.store.profiles);
    if (backup.settings?.declarationTypes) settings.declarationTypes = clone(backup.settings.declarationTypes);
    const types = Array.isArray(settings.declarationTypes) ? settings.declarationTypes : [];
    const known = new Set(types.map(t => t.id));
    for (const profile of Object.values(backup.store.profiles)) {
      for (const id of Object.keys(profile)) {
        if (!known.has(id)) { types.push({ id, label: id, valueMode: id === 'KDV-1' ? 'kdv' : 'desc' }); known.add(id); }
      }
    }
    settings.declarationTypes = types;
    return settings;
  }
  return { decode, prepareSettings };
});
