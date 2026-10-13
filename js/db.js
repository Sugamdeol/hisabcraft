/*
 * HisabCraft — storage layer.
 * IndexedDB, 100% local. Nothing ever leaves the device.
 * Stores: settings, parties, items, invoices, purchases, payments
 */
(function (root) {
  'use strict';

  var NAME = 'hisabcraft';
  var VERSION = 1;
  var STORES = ['settings', 'parties', 'items', 'invoices', 'purchases', 'payments'];
  var _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('parties')) {
          db.createObjectStore('parties', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('items')) {
          db.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('invoices')) {
          var inv = db.createObjectStore('invoices', { keyPath: 'id', autoIncrement: true });
          inv.createIndex('partyId', 'partyId');
          inv.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('purchases')) {
          db.createObjectStore('purchases', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('payments')) {
          var pay = db.createObjectStore('payments', { keyPath: 'id', autoIncrement: true });
          pay.createIndex('partyId', 'partyId');
        }
      };
      req.onsuccess = function () { _db = req.result; resolve(_db); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function toPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function all(store) {
    var db = await open();
    return toPromise(db.transaction(store, 'readonly').objectStore(store).getAll());
  }

  async function get(store, id) {
    var db = await open();
    return toPromise(db.transaction(store, 'readonly').objectStore(store).get(id));
  }

  async function put(store, obj) {
    var db = await open();
    return toPromise(db.transaction(store, 'readwrite').objectStore(store).put(obj));
  }

  async function del(store, id) {
    var db = await open();
    return toPromise(db.transaction(store, 'readwrite').objectStore(store).delete(id));
  }

  async function clearStore(store) {
    var db = await open();
    return toPromise(db.transaction(store, 'readwrite').objectStore(store).clear());
  }

  async function settingsGet(key, def) {
    var rec = await get('settings', key);
    return rec ? rec.value : def;
  }

  async function settingsSet(key, value) {
    return put('settings', { key: key, value: value });
  }

  async function nextInvoiceNo() {
    var prefix = await settingsGet('invoicePrefix', 'INV-');
    var list = await all('invoices');
    var max = list.reduce(function (m, inv) { return Math.max(m, inv.seq || 0); }, 0);
    return { no: prefix + String(max + 1).padStart(4, '0'), seq: max + 1 };
  }

  // Backup: full JSON dump of every store. Restore replaces everything.
  async function exportJSON() {
    var out = { app: 'hisabcraft', version: 1, exportedAt: new Date().toISOString(), data: {} };
    for (var i = 0; i < STORES.length; i++) {
      out.data[STORES[i]] = await all(STORES[i]);
    }
    return out;
  }

  async function importJSON(dump) {
    if (!dump || !dump.data) throw new Error('Invalid backup file');
    for (var i = 0; i < STORES.length; i++) {
      await clearStore(STORES[i]);
      var rows = dump.data[STORES[i]] || [];
      for (var j = 0; j < rows.length; j++) {
        await put(STORES[i], rows[j]);
      }
    }
  }

  async function resetAll() {
    for (var i = 0; i < STORES.length; i++) {
      if (STORES[i] !== 'settings') await clearStore(STORES[i]);
      else {
        var rows = await all('settings');
        for (var j = 0; j < rows.length; j++) await del('settings', rows[j].key);
      }
    }
  }

  var DB = {
    open: open,
    all: all,
    get: get,
    put: put,
    del: del,
    clearStore: clearStore,
    settingsGet: settingsGet,
    settingsSet: settingsSet,
    nextInvoiceNo: nextInvoiceNo,
    exportJSON: exportJSON,
    importJSON: importJSON,
    resetAll: resetAll,
    STORES: STORES
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = DB;
  else root.DB = DB;
})(typeof window !== 'undefined' ? window : globalThis);
