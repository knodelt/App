(() => {
  'use strict';

  const BACKUP_TYPE = 'frame-personal-data';
  const BACKUP_VERSION = 1;
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const KEYS = [
    'frame-state',
    'frame-last-swipe-v1',
    'frame-loop-v1',
    'frame-loop-mode-v1',
    'frame-taste-dna-v2',
    'frame-online-learning-v1',
    'frame-recommendation-history-v1',
    'frame-for-you-ready-announced-v1',
    'frame-for-you-ready-viewed-v1',
    'frame-onboarding-v1',
    'frame-mood-v1'
  ];
  // Hidden Match room tokens / private sessions must never be exported.
  const JSON_KEYS = new Set([
    'frame-state', 'frame-last-swipe-v1', 'frame-loop-v1',
    'frame-taste-dna-v2', 'frame-online-learning-v1',
    'frame-recommendation-history-v1', 'frame-mood-v1'
  ]);
  const host = document.querySelector('#frameDataTransfer');
  if (!host) return;

  const message = host.querySelector('#frameTransferMessage');
  const exportButton = host.querySelector('#frameExportData');
  const importButton = host.querySelector('#frameImportData');
  const filePicker = host.querySelector('#frameDataFile');
  const guidance = host.querySelector('#frameTransferGuidance');
  const isNewDomain = location.hostname === 'framingapp.de' ||
    location.hostname === 'www.framingapp.de';

  if (guidance) {
    guidance.textContent = isNewDomain
      ? 'Alte FRAME-Adresse öffnen, dort unter „Mein Frame“ die Daten sichern und anschließend diese Sicherung hier einspielen.'
      : 'Sichere hier deine bisherigen Swipes, Merkliste und Geschmacksdaten. Öffne danach framingapp.de und spiele die Datei dort ein.';
  }

  function setMessage(value, isError = false) {
    if (!message) return;
    message.textContent = value;
    message.classList.toggle('error', isError);
  }

  function backupValues() {
    const items = {};
    for (const key of KEYS) {
      let value = null;
      try { value = localStorage.getItem(key); }
      catch { throw new Error('Der Browser verhindert den Zugriff auf deine gespeicherten Daten.'); }
      if (value !== null) items[key] = value;
    }
    return items;
  }

  function countValues(items) {
    let swipes = 0, saved = 0;
    try {
      const state = JSON.parse(items['frame-state'] || '{}');
      swipes = state.swipes && typeof state.swipes === 'object' && !Array.isArray(state.swipes)
        ? Object.keys(state.swipes).length : 0;
      saved = Array.isArray(state.saved) ? state.saved.length : 0;
    } catch {}
    return {swipes, saved};
  }

  function downloadBackup(items) {
    const counts = countValues(items);
    if (!Object.keys(items).length) {
      setMessage('Auf dieser Adresse sind noch keine FRAME-Daten vorhanden.', true);
      return;
    }
    const payload = {
      type: BACKUP_TYPE,
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      sourceHost: location.hostname,
      items
    };
    const content = JSON.stringify(payload);
    const blob = new Blob([content], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'FRAME-Daten-' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setMessage('Sicherung gestartet: ' + counts.swipes + ' Swipes, ' +
      counts.saved + ' gemerkte Titel. Die JSON-Datei auf deinem Gerät aufbewahren.');
  }

  function readPayload(contents) {
    let backup;
    try { backup = JSON.parse(contents); }
    catch { throw new Error('Die Datei ist keine gültige JSON-Sicherung.'); }
    if (!backup || backup.type !== BACKUP_TYPE || backup.version !== BACKUP_VERSION ||
        !backup.items || typeof backup.items !== 'object' || Array.isArray(backup.items)) {
      throw new Error('Diese Datei ist keine unterstützte FRAME-Sicherung.');
    }
    const items = backup.items;
    if (!Object.keys(items).length) throw new Error('Die Sicherung enthält keine Daten.');
    for (const key of Object.keys(items)) {
      if (!KEYS.includes(key)) throw new Error('Die Sicherung enthält einen unbekannten Datentyp.');
      const value = items[key];
      if (typeof value !== 'string' || value.length > 4 * 1024 * 1024) {
        throw new Error('Die Sicherung enthält ungültige oder zu große Daten.');
      }
      if (JSON_KEYS.has(key)) {
        let parsed;
        try { parsed = JSON.parse(value); }
        catch { throw new Error('Beschädigte Daten in ' + key); }
        if (parsed !== null && typeof parsed !== 'object') {
          throw new Error('Unpassendes Datenformat in ' + key);
        }
      }
    }
    const state = JSON.parse(items['frame-state'] || '{}');
    if (items['frame-state'] && (!state || typeof state !== 'object' ||
        Array.isArray(state) || !state.swipes || typeof state.swipes !== 'object' ||
        Array.isArray(state.swipes) || !Array.isArray(state.saved))) {
      throw new Error('Die gespeicherten Swipes sind unvollständig.');
    }
    return items;
  }

  exportButton?.addEventListener('click', () => {
    try { downloadBackup(backupValues()); }
    catch (error) { setMessage(error.message || 'Sicherung fehlgeschlagen.', true); }
  });

  importButton?.addEventListener('click', () => filePicker?.click());

  filePicker?.addEventListener('change', async () => {
    const file = filePicker.files?.[0];
    filePicker.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setMessage('Die Datei ist größer als 8 MB.', true);
      return;
    }
    try {
      const items = readPayload(await file.text());
      const counts = countValues(items);
      const destination = countValues(backupValues());
      const existing = destination.swipes || destination.saved;
      const question = 'Diese FRAME-Sicherung enthält ' + counts.swipes +
        ' Swipes und ' + counts.saved + ' gemerkte Titel.' +
        (existing ? '\n\nAuf dieser Domain sind bereits ' + destination.swipes +
        ' Swipes gespeichert. Importierte Bereiche werden ersetzt. Sichere zuerst die vorhandenen Daten, wenn du sie behalten möchtest.' : '') +
        '\n\nSicherung jetzt einspielen?';
      if (!window.confirm(question)) return;

      const previous = new Map();
      const changed = [];
      try {
        for (const [key,value] of Object.entries(items)) {
          previous.set(key, localStorage.getItem(key));
          localStorage.setItem(key, value);
          changed.push(key);
        }
      } catch {
        for (const key of changed.reverse()) {
          try {
            const prior = previous.get(key);
            if (prior === null) localStorage.removeItem(key);
            else localStorage.setItem(key,prior);
          } catch {}
        }
        throw new Error('Der Import konnte nicht vollständig gespeichert werden. Prüfe den verfügbaren Browserspeicher.');
      }
      setMessage('FRAME-Daten übertragen. Die App wird neu geladen.');
      window.location.reload();
    } catch (error) {
      setMessage(error.message || 'Import fehlgeschlagen.', true);
    }
  });
})();