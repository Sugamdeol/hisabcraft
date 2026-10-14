/*
 * HisabCraft — main app. Single-page, offline-first, English/Hindi.
 * IndexedDB + GST engine. No build step, zero dependencies.
 *
 * Design rules that keep the khata honest:
 *  - Party balances are DERIVED from invoices + payments, never stored.
 *    Deleting anything re-derives correctly. No drift.
 *  - Purchases are stored in their own store and INCREASE stock.
 *  - Invoice lines are snapshotted (name/HSN/unit) so records survive edits.
 */
(function () {
  'use strict';

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var state = { view: 'dashboard', lang: 'en', partyMap: {}, itemMap: {}, ledgerParty: 0 };
  var T = I18N.en;

  function t(k) { return T[k] || k; }
  function fmt(n) { return GST.formatINR(n); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function toast(msg, isErr) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isErr);
    el.classList.remove('hidden');
    clearTimeout(el._tm);
    el._tm = setTimeout(function () { el.classList.add('hidden'); }, 2400);
  }
  function showErr(id, msg) {
    var el = document.getElementById(id);
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
  }

  /* ---------------- data helpers ---------------- */

  async function loadMaps() {
    var parties = await DB.all('parties');
    state.partyMap = {};
    for (var i = 0; i < parties.length; i++) {
      state.partyMap[parties[i].id] = parties[i].name + (parties[i].gstin ? ' • ' + parties[i].gstin : '');
    }
    var items = await DB.all('items');
    state.itemMap = {};
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      state.itemMap[it.id] = it.name + (it.hsn ? ' (' + it.hsn + ')' : '') + ' • ' + fmt(it.salePrice || 0) + ' • ' + (it.gstRate || 0) + '%';
    }
  }

  function partyOptions(selected, typeFilter) {
    var html = '<option value="">' + t('select_party') + '</option>';
    var keys = Object.keys(state.partyMap).sort(function (a, b) {
      return String(state.partyMap[a]).localeCompare(String(state.partyMap[b]));
    });
    for (var i = 0; i < keys.length; i++) {
      var id = Number(keys[i]);
      html += '<option value="' + keys[i] + '"' + (String(id) === String(selected) ? ' selected' : '') + '>' +
        esc(state.partyMap[id]) + '</option>';
    }
    return html;
  }

  function itemOptions(selected) {
    var html = '<option value="">' + t('select_item') + '</option>';
    var keys = Object.keys(state.itemMap).sort(function (a, b) {
      return String(state.itemMap[a]).localeCompare(String(state.itemMap[b]));
    });
    for (var i = 0; i < keys.length; i++) {
      html += '<option value="' + keys[i] + '"' + (String(keys[i]) === String(selected) ? ' selected' : '') + '>' +
        esc(state.itemMap[keys[i]]) + '</option>';
    }
    return html;
  }

  var UNITS = ['PCS', 'MTR', 'KG', 'LTR', 'BOX', 'DOZ', 'SQFT', 'CBM'];
  function unitOptions(sel) {
    var h = '';
    for (var i = 0; i < UNITS.length; i++) h += '<option' + (UNITS[i] === sel ? ' selected' : '') + '>' + UNITS[i] + '</option>';
    return h;
  }
  var GST_RATES = ['0', '0.25', '3', '5', '12', '18', '28'];
  function gstRateOptions(sel) {
    var h = '';
    for (var i = 0; i < GST_RATES.length; i++) h += '<option value="' + GST_RATES[i] + '"' + (GST_RATES[i] === String(sel) ? ' selected' : '') + '>' + GST_RATES[i] + '%</option>';
    return h;
  }

  async function findParty(id) {
    var list = await DB.all('parties');
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // Khata ledger entries for a party. Balances are derived, never stored.
  async function ledgerEntries(partyId) {
    var out = [];
    var invs = await DB.all('invoices');
    for (var i = 0; i < invs.length; i++) {
      if (invs[i].partyId === partyId) {
        out.push({ date: invs[i].date, kind: 'invoice', ref: invs[i].no, label: t('invoice_no') + ' ' + invs[i].no, amount: invs[i].grandTotal, store: 'invoices', id: invs[i].id });
      }
    }
    var pur = await DB.all('purchases');
    for (var j = 0; j < pur.length; j++) {
      if (pur[j].partyId === partyId) {
        out.push({ date: pur[j].date, kind: 'purchase', ref: pur[j].no, label: t('purchase_record') + ' ' + pur[j].no, amount: pur[j].grandTotal, store: 'purchases', id: pur[j].id });
      }
    }
    var pays = await DB.all('payments');
    for (var k = 0; k < pays.length; k++) {
      if (pays[k].partyId === partyId) {
        var dirLbl = pays[k].direction === 'in' ? t('direction_in') : t('direction_out');
        out.push({ date: pays[k].date, kind: 'payment', ref: '', label: dirLbl + (pays[k].note ? ' — ' + pays[k].note : ''), amount: pays[k].amount, store: 'payments', id: pays[k].id, dir: pays[k].direction });
      }
    }
    out.sort(function (a, b) { return (a.date + a.id).localeCompare(b.date + b.id); });
    return out;
  }

  // Signed change to the party's balance for one ledger entry.
  function entryImpact(partyType, e) {
    if (e.kind !== 'payment') return e.amount; // sale or purchase: they owe more / we owe more
    var inPay = e.dir === 'in';
    if (partyType === 'customer') return inPay ? -e.amount : e.amount;
    return inPay ? e.amount : -e.amount; // supplier
  }

  async function partyBalance(party) {
    var entries = await ledgerEntries(party.id);
    var bal = 0;
    for (var i = 0; i < entries.length; i++) bal += entryImpact(party.type, entries[i]);
    return GST.round2(bal);
  }

  async function nextNo(store, prefixKey, defPrefix) {
    var prefix = await DB.settingsGet(prefixKey, defPrefix);
    var list = await DB.all(store);
    var max = 0;
    for (var i = 0; i < list.length; i++) max = Math.max(max, list[i].seq || 0);
    return { no: prefix + String(max + 1).padStart(4, '0'), seq: max + 1 };
  }

  /* ---------------- i18n ---------------- */

  function renderLangBtn() {
    var btn = $('#langBtn');
    if (btn) btn.textContent = t('lang_toggle');
  }

  function applyLang() {
    T = I18N[state.lang] || I18N.en;
    document.documentElement.lang = state.lang === 'hi' ? 'hi' : 'en';
    $$('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n');
      if (T[k]) el.textContent = T[k];
    });
    renderLangBtn();
    renderView();
  }

  window.toggleLang = function () {
    state.lang = state.lang === 'en' ? 'hi' : 'en';
    DB.settingsSet('lang', state.lang);
    applyLang();
  };

  /* ---------------- router ---------------- */

  function setView(v) {
    state.view = v;
    if (location.hash !== '#' + v) location.hash = '#' + v;
    $$('#nav a').forEach(function (a) { a.classList.toggle('active', a.dataset.view === v); });
    renderView();
  }
  window.setView = setView;

  function renderView() {
    var main = $('#main');
    if (!main) return;
    switch (state.view) {
      case 'dashboard': renderDashboard(main); break;
      case 'sales': renderDocList(main, 'sales'); break;
      case 'purchases': renderDocList(main, 'purchases'); break;
      case 'parties': renderParties(main); break;
      case 'ledger': renderLedger(main); break;
      case 'items': renderItems(main); break;
      case 'payments': renderPayments(main); break;
      case 'reports': renderReports(main); break;
      case 'settings': renderSettings(main); break;
      default: renderDashboard(main);
    }
    window.scrollTo(0, 0);
  }
  window.renderView = renderView;

  /* ---------------- dashboard ---------------- */

  async function renderDashboard(root) {
    var invoices = await DB.all('invoices');
    var purchases = await DB.all('purchases');
    var items = await DB.all('items');
    var parties = await DB.all('parties');
    var today = new Date().toISOString().slice(0, 10);
    var month = today.slice(0, 7);
    var todaySales = 0, monthSales = 0;
    for (var i = 0; i < invoices.length; i++) {
      if (invoices[i].date === today) todaySales += invoices[i].grandTotal;
      if ((invoices[i].date || '').slice(0, 7) === month) monthSales += invoices[i].grandTotal;
    }
    var receivables = 0, payables = 0;
    for (var p = 0; p < parties.length; p++) {
      var bal = await partyBalance(parties[p]);
      if (parties[p].type === 'customer') receivables += Math.max(0, bal);
      else payables += Math.max(0, bal);
    }
    var lowStock = 0;
    for (var s = 0; s < items.length; s++) {
      if (items[s].lowAt && (items[s].stock || 0) <= items[s].lowAt) lowStock++;
    }
    var recent = invoices.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }).slice(0, 8);
    var rows = '';
    for (var r = 0; r < recent.length; r++) {
      var inv = recent[r];
      rows += '<tr><td>' + esc(inv.no) + '</td><td>' + esc(inv.date) + '</td><td>' +
        esc(inv.partyName || (state.partyMap[inv.partyId] || '')) + '</td><td class="num">' +
        fmt(inv.grandTotal) + '</td><td><button class="btn small" onclick="viewRecord(\'invoices\',' + inv.id + ')">' + t('view') + '</button></td></tr>';
    }
    root.innerHTML =
      '<div class="page-head"><h1>' + t('dashboard') + '</h1></div>' +
      '<div class="grid grid-4">' +
      '<div class="stat green"><div class="label">' + t('today_sales') + '</div><div class="value">' + fmt(todaySales) + '</div></div>' +
      '<div class="stat"><div class="label">' + t('month_sales') + '</div><div class="value">' + fmt(monthSales) + '</div></div>' +
      '<div class="stat green"><div class="label">' + t('receivables') + '</div><div class="value">' + fmt(receivables) + '</div></div>' +
      '<div class="stat red"><div class="label">' + t('payables') + '</div><div class="value">' + fmt(payables) + '</div></div>' +
      '<div class="stat"><div class="label">' + t('low_stock') + '</div><div class="value">' + lowStock + '</div></div>' +
      '<div class="stat"><div class="label">' + t('nav_parties') + '</div><div class="value">' + parties.length + '</div></div>' +
      '</div>' +
      '<div class="card"><h3>' + t('quick_actions') + '</h3><div style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="btn" onclick="openForm(\'sales\')">' + t('new_invoice') + '</button>' +
      '<button class="btn secondary" onclick="openDocForm(\'purchases\')">' + t('new_purchase') + '</button>' +
      '<button class="btn secondary" onclick="openPartyForm()">' + t('new_party') + '</button>' +
      '<button class="btn secondary" onclick="openItemForm()">' + t('new_item') + '</button>' +
      '<button class="btn secondary" onclick="openPaymentForm()">' + t('new_payment') + '</button>' +
      '</div></div>' +
      '<div class="card"><h3>' + t('nav_sales') + ' — ' + t('recent', 'recent') + '</h3>' +
      (recent.length ?
        '<div class="table-wrap"><table><thead><tr><th>' + t('invoice_no') + '</th><th>' + t('date') + '</th><th>' + t('party') + '</th><th class="num">' + t('total') + '</th><th>' + t('actions') + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' :
        '<div class="empty">' + t('no_data') + '</div>') +
      '</div>';
  }

  /* ---------------- invoice / purchase lists ---------------- */

  async function renderDocList(root, kind) {
    var store = kind === 'sales' ? 'invoices' : 'purchases';
    var list = (await DB.all(store)).sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '') || (b.id - a.id);
    });
    var rows = '';
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      rows += '<tr><td>' + esc(r.no) + '</td><td>' + esc(r.date) + '</td><td>' +
        esc(r.partyName || (state.partyMap[r.partyId] || '')) + '</td>' +
        (r.partyGstin ? '<td>' + esc(r.partyGstin) + '</td>' : '<td class="badge gray">' + t('gstr1_b2c') + '</td>') +
        '<td class="num">' + fmt(r.grandTotal) + '</td>' +
        '<td><button class="btn small" onclick="viewRecord(\'' + store + '\',' + r.id + ')">' + t('view') + '</button> ' +
        '<button class="btn small danger" onclick="deleteRecord(\'' + store + '\',' + r.id + ')">' + t('del') + '</button></td></tr>';
    }
    root.innerHTML =
      '<div class="page-head"><h1>' + t('nav_' + kind) + '</h1>' +
      '<button class="btn" onclick="openForm(\'' + kind + '\')">' + (kind === 'sales' ? t('new_invoice') : t('new_purchase')) + '</button></div>' +
      '<div class="card"><div class="table-wrap"><table><thead><tr><th>' + t('invoice_no') + '</th><th>' + t('date') + '</th><th>' + t('party') + '</th><th>GSTIN</th><th class="num">' + t('total') + '</th><th>' + t('actions') + '</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="empty">' + t('no_data') + '</td></tr>') +
      '</tbody></table></div></div>';
  }

  /* ---------------- invoice / purchase form ---------------- */

  window.openForm = function (kind) { openDocForm(kind); };
  window.openDocForm = function (kind) {
    var main = $('#main');
    var isSale = kind === 'sales';
    var action = isSale ? 'sales' : 'purchases';
    main.innerHTML =
      '<div class="page-head"><h1>' + (isSale ? t('new_invoice') : t('new_purchase')) + '</h1></div>' +
      '<div class="card" style="max-width:1000px">' +
      '<form id="docForm" onsubmit="saveDoc(event,\'' + action + '\'); return false;">' +
      '<div class="form-grid">' +
      '<div class="form-row"><label>' + t('date') + ' *</label><input type="date" name="date" required value="' + new Date().toISOString().slice(0, 10) + '"></div>' +
      '<div class="form-row"><label>' + t('party') + ' *</label><select name="partyId" id="docParty" required onchange="recalc()">' + partyOptions('', isSale ? 'customer' : 'supplier') + '</select></div>' +
      '<div class="form-row"><label>' + t('type') + '</label><span id="docInterState">—</span></div>' +
      '</div>' +
      '<div id="docLines"></div>' +
      '<button type="button" class="btn secondary" onclick="addLine()" style="margin:10px 0">+ ' + t('add_line') + '</button>' +
      '<div class="totals-box" id="docTotals"></div>' +
      '<div class="err hidden" id="docErr"></div>' +
      '<div style="margin-top:12px;display:flex;gap:10px">' +
      '<button type="submit" class="btn">' + (isSale ? t('save_invoice') : t('save')) + '</button>' +
      '<button type="button" class="btn secondary" onclick="renderView()">' + t('cancel') + '</button>' +
      '</div></form></div>';
    addLine();
  };

  function collectDocLines() {
    var rows = $$('#docLines .doc-line');
    var lines = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var itemId = Number(r.querySelector('[name=itemId]').value || 0);
      if (!itemId) continue;
      lines.push({
        itemId: itemId,
        qty: Number(r.querySelector('[name=qty]').value) || 0,
        unit: r.querySelector('[name=unit]').value || '',
        rate: Number(r.querySelector('[name=rate]').value) || 0,
        discountPct: Number(r.querySelector('[name=discountPct]').value) || 0,
        gstRate: Number(r.querySelector('[name=gstRate]').value) || 0
      });
    }
    return lines;
  }

  window.addLine = function () {
    var wrap = $('#docLines');
    if (!wrap) return;
    var div = document.createElement('div');
    div.className = 'card doc-line';
    div.style.padding = '10px';
    div.style.marginBottom = '8px';
    div.innerHTML =
      '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">' +
      '<div class="form-row" style="flex:2;min-width:170px;margin:0"><label>' + t('item') + '</label><select name="itemId" onchange="updateLine(this)">' + itemOptions('') + '</select></div>' +
      '<div class="form-row" style="width:64px;margin:0"><label>' + t('qty') + '</label><input type="number" name="qty" step="any" min="0" value="1" oninput="recalc()"></div>' +
      '<div class="form-row" style="width:66px;margin:0"><label>' + t('unit') + '</label><select name="unit" onchange="recalc()">' + unitOptions('PCS') + '</select></div>' +
      '<div class="form-row" style="width:96px;margin:0"><label>' + t('rate') + '</label><input type="number" name="rate" step="0.01" min="0" value="0" oninput="recalc()"></div>' +
      '<div class="form-row" style="width:70px;margin:0"><label>' + t('disc') + '</label><input type="number" name="discountPct" step="0.01" min="0" max="100" value="0" oninput="recalc()"></div>' +
      '<div class="form-row" style="width:80px;margin:0"><label>' + t('gst_rate') + '</label><select name="gstRate" onchange="recalc()">' + gstRateOptions(18) + '</select></div>' +
      '<button type="button" class="btn danger small" style="margin-bottom:2px" onclick="this.closest(\'.doc-line\').remove(); recalc();">✕</button>' +
      '</div>';
    wrap.appendChild(div);
    recalc();
  };

  window.updateLine = function (sel) {
    var row = sel.closest('.doc-line');
    var itemId = Number(sel.value);
    if (!itemId) return;
    DB.get('items', itemId).then(function (it) {
      if (!it) return;
      if (it.salePrice) row.querySelector('[name=rate]').value = it.salePrice;
      if (it.unit) row.querySelector('[name=unit]').value = it.unit;
      row.querySelector('[name=gstRate]').value = String(it.gstRate || 18);
      recalc();
    });
  };

  async function docIsInterState() {
    var sel = $('#docParty');
    if (!sel) return false;
    var partyId = Number(sel.value || 0);
    if (!partyId) return false;
    var party = await findParty(partyId);
    if (!party) return false;
    var shopGstin = ((await DB.settingsGet('shopGstin', '')) || '').trim().toUpperCase();
    if (party.gstin && GST.validateGSTIN(party.gstin) && GST.validateGSTIN(shopGstin)) {
      return GST.stateCodeFromGSTIN(party.gstin) !== GST.stateCodeFromGSTIN(shopGstin);
    }
    var shopState = await DB.settingsGet('shopState', '');
    if (party.state && shopState) return party.state !== shopState;
    return false;
  }

  window.recalc = async function () {
    var lines = collectDocLines();
    var inter = await docIsInterState();
    var comp = GST.computeInvoice(lines, inter, true);
    var html =
      '<div class="row"><span>' + t('taxable') + '</span><span>' + fmt(comp.taxable) + '</span></div>' +
      (comp.cgst ? '<div class="row"><span>' + t('cgst') + '</span><span>' + fmt(comp.cgst) + '</span></div>' : '') +
      (comp.sgst ? '<div class="row"><span>' + t('sgst') + '</span><span>' + fmt(comp.sgst) + '</span></div>' : '') +
      (comp.igst ? '<div class="row"><span>' + t('igst') + '</span><span>' + fmt(comp.igst) + '</span></div>' : '') +
      '<div class="row"><span>' + t('round_off') + '</span><span class="neg">' + fmt(comp.roundDiff) + '</span></div>' +
      '<div class="row grand"><span>' + t('grand_total') + '</span><span>' + fmt(comp.grandTotal) + '</span></div>' +
      '<div class="row" style="font-size:12px;color:#666;font-weight:400;border:none">' + t('amount_words') + ': ' + esc(GST.numToWordsINR(comp.grandTotal)) + '</div>';
    var tot = $('#docTotals');
    if (tot) tot.innerHTML = html;
    var is = $('#docInterState');
    if (is) is.innerHTML = inter ? '<span class="badge amber">IGST — inter-state</span>' : '<span class="badge green">CGST + SGST — intra-state</span>';
  };

  window.saveDoc = async function (e, kind) {
    e.preventDefault();
    var f = e.target;
    var partyId = Number(f.partyId.value || 0);
    if (!partyId) { showErr('docErr', t('need_party')); return; }
    var rawLines = collectDocLines();
    if (!rawLines.length) { showErr('docErr', t('need_line')); return; }
    var party = await findParty(partyId);
    if (!party) { showErr('docErr', t('need_party')); return; }
    // snapshot item details into the line so records survive item edits
    var items = await DB.all('items');
    var imap = {};
    for (var i = 0; i < items.length; i++) imap[items[i].id] = items[i];
    var enriched = [];
    for (var j = 0; j < rawLines.length; j++) {
      var it = imap[rawLines[j].itemId];
      enriched.push({
        itemId: rawLines[j].itemId,
        name: it ? it.name : '',
        hsn: it ? (it.hsn || '') : '',
        unit: rawLines[j].unit || (it ? (it.unit || '') : ''),
        qty: rawLines[j].qty, rate: rawLines[j].rate,
        discountPct: rawLines[j].discountPct, gstRate: rawLines[j].gstRate
      });
    }
    var inter = await docIsInterState();
    var comp = GST.computeInvoice(enriched, inter, true);
    var merged = [];
    for (var m = 0; m < enriched.length; m++) {
      var row = {};
      for (var k in enriched[m]) row[k] = enriched[m][k];
      for (var k2 in comp.lines[m]) row[k2] = comp.lines[m][k2];
      merged.push(row);
    }
    var store = kind === 'sales' ? 'invoices' : 'purchases';
    var noInfo = await nextNo(store, kind === 'sales' ? 'invoicePrefix' : 'purchasePrefix', kind === 'sales' ? 'INV-' : 'PO-');
    var rec = {
      no: noInfo.no, seq: noInfo.seq, date: f.date.value,
      partyId: partyId, partyName: party.name, partyPhone: party.phone || '',
      partyGstin: party.gstin || '', partyState: party.state || '',
      interState: inter, lines: merged,
      taxable: comp.taxable, cgst: comp.cgst, sgst: comp.sgst, igst: comp.igst,
      roundDiff: comp.roundDiff, grandTotal: comp.grandTotal
    };
    await DB.put(store, rec);
    // stock movement: sales decrement, purchases increment
    var items2 = await DB.all('items');
    var imap2 = {};
    for (var a = 0; a < items2.length; a++) imap2[items2[a].id] = items2[a];
    for (var b = 0; b < merged.length; b++) {
      var it2 = imap2[merged[b].itemId];
      if (!it2) continue;
      var delta = kind === 'sales' ? -merged[b].qty : merged[b].qty;
      var ns = Math.round(((it2.stock || 0) + delta) * 100) / 100;
      if (ns < 0) { ns = 0; toast(t('stock_low') + ': ' + it2.name, true); }
      it2.stock = ns;
      await DB.put('items', it2);
    }
    await loadMaps();
    toast(t('saved'));
    setView(kind === 'sales' ? 'sales' : 'purchases');
  };

  /* ---------------- parties ---------------- */

  async function renderParties(root) {
    var parties = (await DB.all('parties')).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var rows = '';
    for (var i = 0; i < parties.length; i++) {
      var p = parties[i];
      var bal = await partyBalance(p);
      var badge;
      if (p.type === 'customer') {
        badge = bal >= 0 ? '<span class="badge green">' + t('receivables') + ' ' + fmt(bal) + '</span>' : '<span class="badge amber">' + t('payables') + ' ' + fmt(-bal) + '</span>';
      } else {
        badge = bal >= 0 ? '<span class="badge amber">' + t('payables') + ' ' + fmt(bal) + '</span>' : '<span class="badge green">' + t('receivables') + ' ' + fmt(-bal) + '</span>';
      }
      rows += '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.phone || '') + '</td><td>' + esc(p.gstin || '—') + '</td><td>' + esc(p.state || '') + '</td><td>' + (p.type === 'customer' ? t('type_customer') : t('type_supplier')) + '</td><td>' + badge + '</td>' +
        '<td><button class="btn small" onclick="openLedger(' + p.id + ')">' + t('ledger') + '</button> ' +
        '<button class="btn small secondary" onclick="openPartyForm(' + p.id + ')">' + t('edit') + '</button> ' +
        '<button class="btn small danger" onclick="deleteRecord(\'parties\',' + p.id + ')">' + t('del') + '</button></td></tr>';
    }
    root.innerHTML =
      '<div class="page-head"><h1>' + t('parties') + '</h1><button class="btn" onclick="openPartyForm()">' + t('new_party') + '</button></div>' +
      '<div class="card"><div class="table-wrap"><table><thead><tr><th>' + t('name') + '</th><th>' + t('phone') + '</th><th>' + t('gstin') + '</th><th>' + t('state') + '</th><th>' + t('type') + '</th><th>' + t('balance') + '</th><th>' + t('actions') + '</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7" class="empty">' + t('no_data') + '</td></tr>') +
      '</tbody></table></div></div>';
  }

  window.openPartyForm = function (id) {
    var main = $('#main');
    main.innerHTML = '<div class="page-head"><h1>' + (id ? t('edit') : t('new_party')) + '</h1></div><div class="card" style="max-width:760px" id="partyFormWrap">Loading…</div>';
    var render = function (p) {
      p = p || {};
      var stateOpts = '';
      for (var i = 0; i < GST.INDIAN_STATES.length; i++) {
        stateOpts += '<option value="' + GST.INDIAN_STATES[i][0] + '"' + (p.state === GST.INDIAN_STATES[i][0] ? ' selected' : '') + '>' + GST.INDIAN_STATES[i][0] + ' — ' + GST.INDIAN_STATES[i][1] + '</option>';
      }
      $('#partyFormWrap').innerHTML =
        '<form onsubmit="saveParty(event,' + (p.id || 0) + '); return false;">' +
        '<div class="form-grid">' +
        '<div class="form-row"><label>' + t('name') + ' *</label><input name="name" required value="' + esc(p.name || '') + '"></div>' +
        '<div class="form-row"><label>' + t('phone') + '</label><input name="phone" value="' + esc(p.phone || '') + '"></div>' +
        '<div class="form-row"><label>' + t('gstin') + '</label><input name="gstin" placeholder="07AAAAA0000A1Z4" value="' + esc(p.gstin || '') + '"></div>' +
        '<div class="form-row"><label>' + t('state') + '</label><select name="state">' + stateOpts + '</select></div>' +
        '<div class="form-row"><label>' + t('type') + ' *</label><select name="type"><option value="customer"' + (p.type !== 'supplier' ? ' selected' : '') + '>' + t('type_customer') + '</option><option value="supplier"' + (p.type === 'supplier' ? ' selected' : '') + '>' + t('type_supplier') + '</option></select></div>' +
        '</div>' +
        '<div class="form-row"><label>' + t('address') + '</label><textarea name="address" rows="2">' + esc(p.address || '') + '</textarea></div>' +
        '<div class="err hidden" id="partyErr"></div>' +
        '<div style="display:flex;gap:10px;margin-top:10px"><button class="btn" type="submit">' + t('save') + '</button><button class="btn secondary" type="button" onclick="renderView()">' + t('cancel') + '</button></div>' +
        '</form>';
    };
    if (id) { DB.get('parties', id).then(render); } else { render(null); }
  };

  window.saveParty = async function (e, id) {
    e.preventDefault();
    var f = e.target;
    var gstin = f.gstin.value.trim().toUpperCase();
    if (gstin && !GST.validateGSTIN(gstin)) { showErr('partyErr', t('invalid_gstin')); return; }
    var name = f.name.value.trim();
    if (!name) { showErr('partyErr', t('name') + ' required'); return; }
    var p = { name: name, phone: f.phone.value.trim(), gstin: gstin, state: f.state.value, address: f.address.value.trim(), type: f.type.value };
    if (id) p.id = id;
    await DB.put('parties', p);
    await loadMaps();
    toast(t('saved'));
    renderView();
  };

  /* ---------------- ledger (khata detail) ---------------- */

  window.openLedger = function (partyId) {
    state.view = 'ledger';
    state.ledgerParty = Number(partyId);
    renderView();
  };

  async function renderLedger(root) {
    var party = await DB.get('parties', state.ledgerParty);
    if (!party) { setView('parties'); return; }
    var entries = await ledgerEntries(party.id);
    var bal = 0;
    var rows = '';
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var impact = entryImpact(party.type, e);
      bal = GST.round2(bal + impact);
      var signCol = impact >= 0 ? '<span class="badge red">+' + fmt(impact) + '</span>' : '<span class="badge green">' + fmt(impact) + '</span>';
      var delBtn = '<button class="btn small danger" onclick="deleteRecord(\'' + e.store + '\',' + e.id + '); openLedger(' + party.id + ')">' + t('del') + '</button>';
      rows += '<tr><td>' + esc(e.date) + '</td><td>' + esc(e.label) + '</td><td>' + signCol + '</td><td class="num">' + fmt(bal) + '</td><td>' + delBtn + '</td></tr>';
    }
    var balLbl = bal >= 0
      ? (party.type === 'customer' ? t('receivables') : t('payables'))
      : (party.type === 'customer' ? t('payables') : t('receivables'));
    root.innerHTML =
      '<div class="page-head"><h1>' + t('ledger') + ' — ' + esc(party.name) + '</h1><button class="btn secondary" onclick="setView(\'parties\')">← ' + t('parties') + '</button></div>' +
      '<div class="grid grid-4">' +
      '<div class="stat"><div class="label">' + t('phone') + '</div><div class="value" style="font-size:16px">' + esc(party.phone || '—') + '</div></div>' +
      '<div class="stat"><div class="label">' + t('gstin') + '</div><div class="value" style="font-size:16px">' + esc(party.gstin || '—') + '</div></div>' +
      '<div class="stat"><div class="label">' + t('state') + '</div><div class="value" style="font-size:16px">' + esc(party.state || '—') + '</div></div>' +
      '<div class="stat ' + (bal >= 0 ? 'amber' : 'green') + '"><div class="label">' + balLbl + '</div><div class="value">' + fmt(Math.abs(bal)) + '</div></div>' +
      '</div>' +
      '<div class="card"><div class="table-wrap"><table><thead><tr><th>' + t('date') + '</th><th>' + t('note') + '</th><th>' + t('amount') + '</th><th class="num">' + t('balance') + '</th><th>' + t('actions') + '</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5" class="empty">' + t('no_data') + '</td></tr>') +
      '</tbody></table></div></div>';
  }

  /* ---------------- items ---------------- */

  async function renderItems(root) {
    var items = (await DB.all('items')).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var rows = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var low = it.lowAt && (it.stock || 0) <= it.lowAt;
      rows += '<tr' + (low ? ' style="background:#fffbeb"' : '') + '><td>' + esc(it.name) + '</td><td>' + esc(it.hsn || '') + '</td><td>' + esc(it.unit || '') + '</td><td>' + esc(String(it.gstRate || 0) + '%') + '</td><td class="num">' + (it.stock || 0) + '</td><td class="num">' + (it.lowAt || '—') + '</td><td class="num">' + fmt(it.salePrice) + '</td><td class="num">' + fmt(it.purchasePrice) + '</td>' +
        '<td>' + (low ? '<span class="badge amber">' + t('stock_low') + '</span> ' : '') +
        '<button class="btn small secondary" onclick="openItemForm(' + it.id + ')">' + t('edit') + '</button> ' +
        '<button class="btn small danger" onclick="deleteRecord(\'items\',' + it.id + ')">' + t('del') + '</button></td></tr>';
    }
    root.innerHTML =
      '<div class="page-head"><h1>' + t('items') + '</h1><button class="btn" onclick="openItemForm()">' + t('new_item') + '</button></div>' +
      '<div class="card"><div class="table-wrap"><table><thead><tr><th>' + t('item') + '</th><th>' + t('hsn') + '</th><th>' + t('unit') + '</th><th>' + t('gst_rate') + '</th><th class="num">' + t('stock') + '</th><th class="num">' + t('low_at') + '</th><th class="num">' + t('sale_price') + '</th><th class="num">' + t('purchase_price') + '</th><th>' + t('actions') + '</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="9" class="empty">' + t('no_data') + '</td></tr>') +
      '</tbody></table></div></div>';
  }

  window.openItemForm = function (id) {
    var main = $('#main');
    main.innerHTML = '<div class="page-head"><h1>' + (id ? t('edit') : t('new_item')) + '</h1></div><div class="card" style="max-width:760px" id="itemFormWrap">Loading…</div>';
    var render = function (p) {
      p = p || {};
      var rateOpts = '';
      for (var i = 0; i < GST_RATES.length; i++) rateOpts += '<option value="' + GST_RATES[i] + '"' + (String(p.gstRate) === GST_RATES[i] ? ' selected' : '') + '>' + GST_RATES[i] + '%</option>';
      var unitOpts = '';
      for (var j = 0; j < UNITS.length; j++) unitOpts += '<option' + (p.unit === UNITS[j] ? ' selected' : '') + '>' + UNITS[j] + '</option>';
      $('#itemFormWrap').innerHTML =
        '<form onsubmit="saveItem(event,' + (p.id || 0) + '); return false;">' +
        '<div class="form-grid">' +
        '<div class="form-row"><label>' + t('item') + ' *</label><input name="name" required value="' + esc(p.name || '') + '"></div>' +
        '<div class="form-row"><label>' + t('hsn') + '</label><input name="hsn" value="' + esc(p.hsn || '') + '"></div>' +
        '<div class="form-row"><label>' + t('unit') + '</label><select name="unit">' + unitOpts + '</select></div>' +
        '<div class="form-row"><label>' + t('gst_rate') + '</label><select name="gstRate">' + rateOpts + '</select></div>' +
        '<div class="form-row"><label>' + t('stock') + '</label><input type="number" name="stock" step="any" min="0" value="' + (p.stock || 0) + '"></div>' +
        '<div class="form-row"><label>' + t('low_at') + '</label><input type="number" name="lowAt" step="any" min="0" value="' + (p.lowAt || '') + '"></div>' +
        '<div class="form-row"><label>' + t('sale_price') + '</label><input type="number" name="salePrice" step="0.01" min="0" value="' + (p.salePrice || 0) + '"></div>' +
        '<div class="form-row"><label>' + t('purchase_price') + '</label><input type="number" name="purchasePrice" step="0.01" min="0" value="' + (p.purchasePrice || 0) + '"></div>' +
        '</div>' +
        '<div class="err hidden" id="itemErr"></div>' +
        '<div style="display:flex;gap:10px;margin-top:10px"><button class="btn" type="submit">' + t('save') + '</button><button class="btn secondary" type="button" onclick="renderView()">' + t('cancel') + '</button></div>' +
        '</form>';
    };
    if (id) { DB.get('items', id).then(render); } else { render(null); }
  };

  window.saveItem = async function (e, id) {
    e.preventDefault();
    var f = e.target;
    var name = f.name.value.trim();
    if (!name) { showErr('itemErr', t('item') + ' required'); return; }
    var p = {
      name: name, hsn: f.hsn.value.trim(), unit: f.unit.value,
      gstRate: Number(f.gstRate.value) || 0,
      stock: Number(f.stock.value) || 0,
      lowAt: f.lowAt.value === '' ? null : Number(f.lowAt.value),
      salePrice: Number(f.salePrice.value) || 0,
      purchasePrice: Number(f.purchasePrice.value) || 0
    };
    if (id) p.id = id;
    await DB.put('items', p);
    await loadMaps();
    toast(t('saved'));
    renderView();
  };

  /* ---------------- payments ---------------- */

  async function renderPayments(root) {
    var payments = (await DB.all('payments')).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var rows = '';
    for (var i = 0; i < payments.length; i++) {
      var pay = payments[i];
      rows += '<tr><td>' + esc(pay.date) + '</td><td>' + esc(pay.partyName || (state.partyMap[pay.partyId] || '')) + '</td>' +
        '<td>' + (pay.direction === 'in' ? '<span class="badge green">' + t('direction_in') + '</span>' : '<span class="badge red">' + t('direction_out') + '</span>') + '</td>' +
        '<td class="num">' + fmt(pay.amount) + '</td><td>' + esc(pay.note || '') + '</td>' +
        '<td><button class="btn small danger" onclick="deleteRecord(\'payments\',' + pay.id + ')">' + t('del') + '</button></td></tr>';
    }
    root.innerHTML =
      '<div class="page-head"><h1>' + t('payments') + '</h1><button class="btn" onclick="openPaymentForm()">' + t('new_payment') + '</button></div>' +
      '<div class="card"><div class="table-wrap"><table><thead><tr><th>' + t('date') + '</th><th>' + t('party') + '</th><th>' + t('amount') + '</th><th class="num">' + t('amount') + '</th><th>' + t('note') + '</th><th>' + t('actions') + '</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="empty">' + t('no_data') + '</td></tr>') +
      '</tbody></table></div></div>';
  }

  window.openPaymentForm = function () {
    var main = $('#main');
    var now = new Date().toISOString().slice(0, 10);
    main.innerHTML =
      '<div class="page-head"><h1>' + t('new_payment') + '</h1></div>' +
      '<div class="card" style="max-width:640px">' +
      '<form onsubmit="savePayment(event); return false;">' +
      '<div class="form-grid">' +
      '<div class="form-row"><label>' + t('date') + ' *</label><input type="date" name="date" required value="' + now + '"></div>' +
      '<div class="form-row"><label>' + t('party') + ' *</label><select name="partyId" required>' + partyOptions('') + '</select></div>' +
      '<div class="form-row"><label>' + t('direction_in') + ' / ' + t('direction_out') + ' *</label><select name="direction" required><option value="in">' + t('direction_in') + '</option><option value="out">' + t('direction_out') + '</option></select></div>' +
      '<div class="form-row"><label>' + t('amount') + ' *</label><input type="number" name="amount" step="0.01" min="0.01" required></div>' +
      '</div>' +
      '<div class="form-row"><label>' + t('note') + '</label><input name="note" placeholder="Cash / UPI / bank ref"></div>' +
      '<div class="err hidden" id="payErr"></div>' +
      '<div style="display:flex;gap:10px;margin-top:10px"><button class="btn" type="submit">' + t('save') + '</button><button class="btn secondary" type="button" onclick="renderView()">' + t('cancel') + '</button></div>' +
      '</form></div>';
  };

  window.savePayment = async function (e) {
    e.preventDefault();
    var f = e.target;
    var partyId = Number(f.partyId.value || 0);
    var amount = Number(f.amount.value || 0);
    if (!partyId) { showErr('payErr', t('need_party')); return; }
    if (!(amount > 0)) { showErr('payErr', t('amount') + ' > 0'); return; }
    var party = await findParty(partyId);
    await DB.put('payments', {
      date: f.date.value, partyId: partyId, direction: f.direction.value,
      amount: amount, note: f.note.value.trim(),
      partyName: party ? party.name : ''
    });
    await loadMaps();
    toast(t('saved'));
    renderView();
  };

  /* ---------------- reports ---------------- */

  function tableHTML(heads, rowsHtml) {
    var h = '';
    for (var i = 0; i < heads.length; i++) h += '<th' + (heads[i].num ? ' class="num"' : '') + '>' + heads[i].label + '</th>';
    return '<div class="table-wrap"><table><thead><tr>' + h + '</tr></thead><tbody>' + (rowsHtml || '<tr><td colspan="' + heads.length + '" class="empty">' + t('no_data') + '</td></tr>') + '</tbody></table></div>';
  }

  async function renderReports(root) {
    var invoices = await DB.all('invoices');
    var parties = await DB.all('parties');
    // B2B: party has GSTIN
    var b2bRows = '';
    for (var i = 0; i < invoices.length; i++) {
      var inv = invoices[i];
      if (!inv.partyGstin) continue;
      b2bRows += '<tr><td>' + esc(inv.no) + '</td><td>' + esc(inv.date) + '</td><td>' + esc(inv.partyName) + '</td><td>' + esc(inv.partyGstin) + '</td><td class="num">' + fmt(inv.taxable) + '</td><td class="num">' + fmt(inv.igst) + '</td><td class="num">' + fmt(inv.cgst) + '</td><td class="num">' + fmt(inv.sgst) + '</td><td class="num">' + fmt(inv.grandTotal) + '</td></tr>';
    }
    // B2C: rate-wise aggregation
    var rateMap = {};
    for (var b = 0; b < invoices.length; b++) {
      var inv2 = invoices[b];
      if (inv2.partyGstin) continue;
      for (var l = 0; l < (inv2.lines || []).length; l++) {
        var line = inv2.lines[l];
        var key = String(line.gstRate);
        if (!rateMap[key]) rateMap[key] = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        rateMap[key].taxable += line.taxable;
        rateMap[key].cgst += line.cgst;
        rateMap[key].sgst += line.sgst;
        rateMap[key].igst += line.igst;
      }
    }
    var b2cRows = '';
    var keys = Object.keys(rateMap).sort(function (a, b) { return Number(a) - Number(b); });
    for (var k = 0; k < keys.length; k++) {
      var r = rateMap[keys[k]];
      b2cRows += '<tr><td>' + keys[k] + '%</td><td class="num">' + fmt(GST.round2(r.taxable)) + '</td><td class="num">' + fmt(GST.round2(r.igst)) + '</td><td class="num">' + fmt(GST.round2(r.cgst)) + '</td><td class="num">' + fmt(GST.round2(r.sgst)) + '</td></tr>';
    }
    // month-wise
    var monthMap = {};
    for (var m2 = 0; m2 < invoices.length; m2++) {
      var mo = (invoices[m2].date || '').slice(0, 7);
      if (!mo) continue;
      if (!monthMap[mo]) monthMap[mo] = { taxable: 0, tax: 0, total: 0, n: 0 };
      monthMap[mo].taxable += invoices[m2].taxable;
      monthMap[mo].tax += invoices[m2].cgst + invoices[m2].sgst + invoices[m2].igst;
      monthMap[mo].total += invoices[m2].grandTotal;
      monthMap[mo].n++;
    }
    var monthRows = '';
    var mkeys = Object.keys(monthMap).sort().reverse();
    for (var m3 = 0; m3 < mkeys.length; m3++) {
      var mm = monthMap[mkeys[m3]];
      monthRows += '<tr><td>' + esc(mkeys[m3]) + '</td><td class="num">' + mm.n + '</td><td class="num">' + fmt(GST.round2(mm.taxable)) + '</td><td class="num">' + fmt(GST.round2(mm.tax)) + '</td><td class="num">' + fmt(GST.round2(mm.total)) + '</td></tr>';
    }
    // outstanding
    var outRows = '';
    for (var p2 = 0; p2 < parties.length; p2++) {
      var bal = await partyBalance(parties[p2]);
      if (Math.abs(bal) < 0.01) continue;
      var label = parties[p2].type === 'customer'
        ? (bal > 0 ? t('receivables') : t('payables'))
        : (bal > 0 ? t('payables') : t('receivables'));
      outRows += '<tr><td>' + esc(parties[p2].name) + '</td><td>' + esc(parties[p2].phone || '') + '</td><td>' + label + '</td><td class="num">' + fmt(Math.abs(bal)) + '</td></tr>';
    }
    root.innerHTML =
      '<div class="page-head"><h1>' + t('reports') + '</h1><button class="btn secondary" onclick="exportCSV()">' + t('export_csv') + '</button></div>' +
      '<div class="card"><h3>' + t('gstr1_b2b') + '</h3>' + tableHTML(
        [{ label: t('invoice_no') }, { label: t('date') }, { label: t('party') }, { label: t('gstin') }, { label: t('taxable'), num: 1 }, { label: t('igst'), num: 1 }, { label: t('cgst'), num: 1 }, { label: t('sgst'), num: 1 }, { label: t('total'), num: 1 }], b2bRows) + '</div>' +
      '<div class="card"><h3>' + t('gstr1_b2c') + '</h3>' + tableHTML(
        [{ label: t('gst_rate') }, { label: t('taxable'), num: 1 }, { label: t('igst'), num: 1 }, { label: t('cgst'), num: 1 }, { label: t('sgst'), num: 1 }], b2cRows) + '</div>' +
      '<div class="card"><h3>' + t('monthwise') + '</h3>' + tableHTML(
        [{ label: t('date') }, { label: '#' }, { label: t('taxable'), num: 1 }, { label: t('igst') + '+' + t('cgst') + '+' + t('sgst'), num: 1 }, { label: t('total'), num: 1 }], monthRows) + '</div>' +
      '<div class="card"><h3>' + t('outstanding') + '</h3>' + tableHTML(
        [{ label: t('party') }, { label: t('phone') }, { label: t('type') }, { label: t('amount'), num: 1 }], outRows) + '</div>';
  }

  function downloadCSV(filename, rows) {
    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  window.exportCSV = async function () {
    var invoices = await DB.all('invoices');
    var rows = [['Invoice No', 'Date', 'Party', 'GSTIN', 'State', 'Taxable', 'IGST', 'CGST', 'SGST', 'Round Off', 'Grand Total']];
    for (var i = 0; i < invoices.length; i++) {
      var v = invoices[i];
      rows.push([v.no, v.date, v.partyName, v.partyGstin, v.partyState, v.taxable, v.igst, v.cgst, v.sgst, v.roundDiff, v.grandTotal]);
    }
    downloadCSV('hisabcraft-invoices-' + new Date().toISOString().slice(0, 10) + '.csv', rows);
  };

  /* ---------------- settings ---------------- */

  async function renderSettings(root) {
    var shopName = await DB.settingsGet('shopName', '');
    var shopGstin = await DB.settingsGet('shopGstin', '');
    var shopState = await DB.settingsGet('shopState', '07');
    var shopPhone = await DB.settingsGet('shopPhone', '');
    var shopAddr = await DB.settingsGet('shopAddress', '');
    var invPrefix = await DB.settingsGet('invoicePrefix', 'INV-');
    var purPrefix = await DB.settingsGet('purchasePrefix', 'PO-');
    var terms = await DB.settingsGet('terms', 'Goods once sold cannot be returned. Subject to Delhi jurisdiction.');
    var stateOpts = '';
    for (var i = 0; i < GST.INDIAN_STATES.length; i++) {
      stateOpts += '<option value="' + GST.INDIAN_STATES[i][0] + '"' + (shopState === GST.INDIAN_STATES[i][0] ? ' selected' : '') + '>' + GST.INDIAN_STATES[i][0] + ' — ' + GST.INDIAN_STATES[i][1] + '</option>';
    }
    root.innerHTML =
      '<div class="page-head"><h1>' + t('settings') + '</h1></div>' +
      '<div class="card" style="max-width:760px">' +
      '<form onsubmit="saveSettings(event); return false;">' +
      '<div class="form-grid">' +
      '<div class="form-row"><label>' + t('shop_name') + ' *</label><input name="shopName" required value="' + esc(shopName) + '"></div>' +
      '<div class="form-row"><label>' + t('gstin') + '</label><input name="shopGstin" placeholder="07AAAAA0000A1Z4" value="' + esc(shopGstin) + '"></div>' +
      '<div class="form-row"><label>' + t('state') + '</label><select name="shopState">' + stateOpts + '</select></div>' +
      '<div class="form-row"><label>' + t('phone') + '</label><input name="shopPhone" value="' + esc(shopPhone) + '"></div>' +
      '</div>' +
      '<div class="form-row"><label>' + t('address') + '</label><textarea name="shopAddress" rows="2">' + esc(shopAddr) + '</textarea></div>' +
      '<div class="form-grid">' +
      '<div class="form-row"><label>' + t('invoice_prefix') + '</label><input name="invoicePrefix" value="' + esc(invPrefix) + '"></div>' +
      '<div class="form-row"><label>Purchase prefix</label><input name="purchasePrefix" value="' + esc(purPrefix) + '"></div>' +
      '</div>' +
      '<div class="form-row"><label>' + t('terms') + '</label><textarea name="terms" rows="2">' + esc(terms) + '</textarea></div>' +
      '<div class="err hidden" id="setErr"></div>' +
      '<button class="btn" type="submit">' + t('save_settings') + '</button>' +
      '</form></div>' +
      '<div class="card"><h3>Data</h3><div style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="btn secondary" onclick="backup()">' + t('backup') + '</button>' +
      '<label class="btn secondary" style="cursor:pointer">' + t('restore') + '<input type="file" accept=".json" style="display:none" onchange="restore(event)"></label>' +
      '<button class="btn secondary" onclick="loadDemo()">' + t('demo_data') + '</button>' +
      '<button class="btn danger" onclick="confirmReset()">' + t('reset_data') + '</button>' +
      '</div><div class="hint">' + t('hint_backup', 'Backup JSON lives in your browser. Export before clearing site data.') + '</div></div>';
  }

  window.saveSettings = async function (e) {
    e.preventDefault();
    var f = e.target;
    var gstin = f.shopGstin.value.trim().toUpperCase();
    if (gstin && !GST.validateGSTIN(gstin)) { showErr('setErr', t('invalid_gstin')); return; }
    await DB.settingsSet('shopName', f.shopName.value.trim());
    await DB.settingsSet('shopGstin', gstin);
    await DB.settingsSet('shopState', f.shopState.value);
    await DB.settingsSet('shopPhone', f.shopPhone.value.trim());
    await DB.settingsSet('shopAddress', f.shopAddress.value.trim());
    await DB.settingsSet('invoicePrefix', f.invoicePrefix.value.trim() || 'INV-');
    await DB.settingsSet('purchasePrefix', f.purchasePrefix.value.trim() || 'PO-');
    await DB.settingsSet('terms', f.terms.value.trim());
    toast(t('saved'));
  };

  /* ---------------- print ---------------- */

  window.viewRecord = async function (store, id) {
    var rec = await DB.get(store, id);
    if (!rec) return;
    var isSale = store === 'invoices';
    var shopName = await DB.settingsGet('shopName', 'My Shop');
    var shopAddr = await DB.settingsGet('shopAddress', '');
    var shopPhone = await DB.settingsGet('shopPhone', '');
    var shopGstin = await DB.settingsGet('shopGstin', '');
    var terms = await DB.settingsGet('terms', '');
    var linesHtml = '';
    for (var i = 0; i < (rec.lines || []).length; i++) {
      var l = rec.lines[i];
      linesHtml += '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(l.name || '') +
        (l.hsn ? ' <span style="color:#666">(' + esc(l.hsn) + ')</span>' : '') + '</td>' +
        '<td>' + esc(l.hsn || '') + '</td><td class="num">' + l.qty + '</td><td>' + esc(l.unit || '') + '</td>' +
        '<td class="num">' + fmt(l.rate) + '</td>' +
        (l.discountPct ? '<td class="num">' + l.discountPct + '%</td>' : '<td class="num">—</td>') +
        '<td class="num">' + fmt(l.taxable != null ? l.taxable : GST.lineTaxable(l)) + '</td>' +
        '<td class="num">' + l.gstRate + '%</td></tr>';
    }
    var partyStateName = '';
    for (var s = 0; s < GST.INDIAN_STATES.length; s++) {
      if (GST.INDIAN_STATES[s][0] === rec.partyState) { partyStateName = GST.INDIAN_STATES[s][1]; break; }
    }
    var shopStateName = '';
    var shopStateCode = await DB.settingsGet('shopState', '');
    for (var s2 = 0; s2 < GST.INDIAN_STATES.length; s2++) {
      if (GST.INDIAN_STATES[s2][0] === shopStateCode) { shopStateName = GST.INDIAN_STATES[s2][1]; break; }
    }
    $('#print-area').innerHTML =
      '<div class="invoice-print">' +
      '<div class="inv-head"><div>' +
      '<div style="font-size:18px;font-weight:800">' + esc(shopName) + '</div>' +
      '<div>' + esc(shopAddr) + '</div>' +
      (shopPhone ? '<div>📞 ' + esc(shopPhone) + '</div>' : '') +
      (shopGstin ? '<div>GSTIN: ' + esc(shopGstin) + '</div>' : '') +
      (shopStateName ? '<div>State: ' + esc(shopStateCode) + ' — ' + esc(shopStateName) + '</div>' : '') +
      '</div><div style="text-align:right">' +
      '<div class="inv-title">' + (isSale ? t('tax_invoice') : t('purchase_record')) + '</div>' +
      '<div>' + t('invoice_no') + ': ' + esc(rec.no) + '</div>' +
      '<div>' + t('date') + ': ' + esc(rec.date) + '</div>' +
      '<div>Place of Supply: ' + esc(rec.partyState || '') + (partyStateName ? ' — ' + esc(partyStateName) : '') + '</div>' +
      '</div></div>' +
      '<div style="display:flex;justify-content:space-between;margin:12px 0">' +
      '<div><strong>' + (isSale ? t('bill_to') + ':' : t('supplier') + ':') + '</strong><br>' +
      esc(rec.partyName) + (rec.partyPhone ? '<br>📞 ' + esc(rec.partyPhone) : '') +
      (rec.partyGstin ? '<br>GSTIN: ' + esc(rec.partyGstin) : '') +
      (partyStateName ? '<br>State: ' + esc(rec.partyState) + ' — ' + esc(partyStateName) : '') +
      '</div>' +
      (isSale ? '<div style="text-align:right"><strong>CGST/SGST or IGST</strong><br>' + (rec.interState ? 'IGST (inter-state)' : 'CGST + SGST (intra-state)') + '</div>' : '') +
      '</div>' +
      '<table><thead><tr><th class="num">#</th><th>' + t('description') + '</th><th>HSN</th><th class="num">' + t('qty') + '</th><th>' + t('unit') + '</th><th class="num">' + t('rate') + '</th><th class="num">' + t('disc') + '</th><th class="num">' + t('taxable') + '</th><th class="num">' + t('gst_rate') + '</th></tr></thead><tbody>' + linesHtml + '</tbody></table>' +
      '<div class="totals-box" style="margin-top:10px">' +
      '<div class="row"><span>' + t('taxable') + '</span><span>' + fmt(rec.taxable) + '</span></div>' +
      (rec.cgst ? '<div class="row"><span>' + t('cgst') + '</span><span>' + fmt(rec.cgst) + '</span></div>' : '') +
      (rec.sgst ? '<div class="row"><span>' + t('sgst') + '</span><span>' + fmt(rec.sgst) + '</span></div>' : '') +
      (rec.igst ? '<div class="row"><span>' + t('igst') + '</span><span>' + fmt(rec.igst) + '</span></div>' : '') +
      (rec.roundDiff ? '<div class="row"><span>' + t('round_off') + '</span><span>' + fmt(rec.roundDiff) + '</span></div>' : '') +
      '<div class="row grand"><span>' + t('grand_total') + '</span><span>' + fmt(rec.grandTotal) + '</span></div>' +
      '</div>' +
      '<div class="inv-foot"><strong>' + t('amount_words') + ':</strong> ' + esc(GST.numToWordsINR(rec.grandTotal)) +
      (terms ? '<br><br><em>' + esc(terms) + '</em>' : '') + '</div>' +
      '<div class="sign"><div>' + t('declaration') + '</div><div>' + t('signature') + '<br><br>________________</div></div>' +
      '</div>';
    window.print();
    setTimeout(function () { $('#print-area').innerHTML = ''; }, 1000);
  };

  /* ---------------- data ops ---------------- */

  window.deleteRecord = async function (store, id) {
    if (!confirm(t('confirm_del'))) return;
    var rec = await DB.get(store, id);
    if (rec && (store === 'invoices' || store === 'purchases')) {
      // reverse stock movement
      var items = await DB.all('items');
      var imap = {};
      for (var i = 0; i < items.length; i++) imap[items[i].id] = items[i];
      for (var j = 0; j < (rec.lines || []).length; j++) {
        var it = imap[rec.lines[j].itemId];
        if (!it) continue;
        var delta = store === 'invoices' ? rec.lines[j].qty : -rec.lines[j].qty;
        it.stock = Math.max(0, Math.round(((it.stock || 0) + delta) * 100) / 100);
        await DB.put('items', it);
      }
    }
    await DB.del(store, id);
    await loadMaps();
    toast(t('deleted'));
    renderView();
  };

  window.backup = async function () {
    var dump = await DB.exportJSON();
    var blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'hisabcraft-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  window.restore = async function (e) {
    var file = e.target.files[0];
    if (!file) return;
    try {
      var text = await file.text();
      var dump = JSON.parse(text);
      await DB.importJSON(dump);
      await loadMaps();
      toast(t('saved'));
      renderView();
    } catch (err) {
      toast('Invalid backup: ' + err.message, true);
    }
  };

  window.confirmReset = function () {
    if (!confirm(t('reset_data') + '?!')) return;
    DB.resetAll().then(function () {
      loadMaps().then(function () { toast(t('deleted')); renderView(); });
    });
  };

  window.loadDemo = async function () {
    if (!confirm('Load demo data? This replaces ALL current data.')) return;
    await DB.resetAll();
    var now = new Date().toISOString().slice(0, 10);
    // checksum-valid GSTINs generated by the engine itself
    var shopGstin = GST.makeGSTIN('07AAAAA0000A1Z');
    await DB.settingsSet('shopName', 'Sharma Kirana Store');
    await DB.settingsSet('shopGstin', shopGstin);
    await DB.settingsSet('shopState', '07');
    await DB.settingsSet('shopPhone', '98765 43210');
    await DB.settingsSet('shopAddress', 'Main Road, Connaught Place, Delhi 110001');
    await DB.settingsSet('invoicePrefix', 'INV-');
    await DB.settingsSet('purchasePrefix', 'PO-');
    await DB.settingsSet('terms', 'Goods once sold cannot be returned. Subject to Delhi jurisdiction.');
    var ramesh = await DB.put('parties', { name: 'Ramesh Traders', phone: '98111 22233', gstin: GST.makeGSTIN('07BBBBB1111B2Z'), state: '07', address: 'Connaught Place, Delhi', type: 'customer' });
    var walkin = await DB.put('parties', { name: 'Walk-in Customer', phone: '', gstin: '', state: '07', address: '', type: 'customer' });
    var suresh = await DB.put('parties', { name: 'Suresh Stores', phone: '98222 33344', gstin: GST.makeGSTIN('27DDDDD3333D4Z'), state: '27', address: 'MG Road, Pune, Maharashtra', type: 'customer' });
    var gupta = await DB.put('parties', { name: 'Gupta Wholesale', phone: '98111 33344', gstin: GST.makeGSTIN('07CCCCC2222C3Z'), state: '07', address: 'Sadar Bazar, Delhi', type: 'supplier' });
    var rice = await DB.put('items', { name: 'Basmati Rice 5kg', hsn: '1006', unit: 'PCS', gstRate: 5, stock: 50, lowAt: 10, salePrice: 450, purchasePrice: 380 });
    var oil = await DB.put('items', { name: 'Mustard Oil 1L', hsn: '1514', unit: 'PCS', gstRate: 5, stock: 80, lowAt: 15, salePrice: 140, purchasePrice: 115 });
    var atta = await DB.put('items', { name: 'Wheat Flour 10kg', hsn: '1101', unit: 'PCS', gstRate: 5, stock: 60, lowAt: 10, salePrice: 320, purchasePrice: 270 });
    var dal = await DB.put('items', { name: 'Toor Dal 1kg', hsn: '0713', unit: 'PCS', gstRate: 5, stock: 100, lowAt: 20, salePrice: 160, purchasePrice: 130 });
    var sugar = await DB.put('items', { name: 'Sugar 1kg', hsn: '1701', unit: 'PCS', gstRate: 5, stock: 8, lowAt: 15, salePrice: 45, purchasePrice: 38 });

    function merge(raw, comp) {
      return raw.map(function (r, idx) {
        var m = {};
        for (var k in r) m[k] = r[k];
        for (var k2 in comp.lines[idx]) m[k2] = comp.lines[idx][k2];
        return m;
      });
    }
    // invoice 1: intra-state (Delhi 07 -> Delhi 07) => CGST+SGST
    var inv1Raw = [
      { itemId: rice, name: 'Basmati Rice 5kg', hsn: '1006', unit: 'PCS', qty: 2, rate: 450, discountPct: 0, gstRate: 5 },
      { itemId: oil, name: 'Mustard Oil 1L', hsn: '1514', unit: 'PCS', qty: 5, rate: 140, discountPct: 5, gstRate: 5 }
    ];
    var c1 = GST.computeInvoice(inv1Raw, false, true);
    await DB.put('invoices', {
      no: 'INV-0001', seq: 1, date: now, partyId: ramesh, partyName: 'Ramesh Traders',
      partyPhone: '98111 22233', partyGstin: GST.makeGSTIN('07BBBBB1111B2Z'), partyState: '07',
      interState: false, lines: merge(inv1Raw, c1),
      taxable: c1.taxable, cgst: c1.cgst, sgst: c1.sgst, igst: c1.igst, roundDiff: c1.roundDiff, grandTotal: c1.grandTotal
    });
    // invoice 2: inter-state (Delhi 07 -> Maharashtra 27) => IGST
    var inv2Raw = [
      { itemId: atta, name: 'Wheat Flour 10kg', hsn: '1101', unit: 'PCS', qty: 3, rate: 320, discountPct: 0, gstRate: 5 },
      { itemId: dal, name: 'Toor Dal 1kg', hsn: '0713', unit: 'PCS', qty: 2, rate: 160, discountPct: 0, gstRate: 5 }
    ];
    var c2 = GST.computeInvoice(inv2Raw, true, true);
    await DB.put('invoices', {
      no: 'INV-0002', seq: 2, date: now, partyId: suresh, partyName: 'Suresh Stores',
      partyPhone: '98222 33344', partyGstin: GST.makeGSTIN('27DDDDD3333D4Z'), partyState: '27',
      interState: true, lines: merge(inv2Raw, c2),
      taxable: c2.taxable, cgst: c2.cgst, sgst: c2.sgst, igst: c2.igst, roundDiff: c2.roundDiff, grandTotal: c2.grandTotal
    });
    // purchase from supplier
    var pur1Raw = [
      { itemId: sugar, name: 'Sugar 1kg', hsn: '1701', unit: 'PCS', qty: 10, rate: 38, discountPct: 0, gstRate: 5 }
    ];
    var c3 = GST.computeInvoice(pur1Raw, false, true);
    await DB.put('purchases', {
      no: 'PO-0001', seq: 1, date: now, partyId: gupta, partyName: 'Gupta Wholesale',
      partyPhone: '98111 33344', partyGstin: GST.makeGSTIN('07CCCCC2222C3Z'), partyState: '07',
      interState: false, lines: merge(pur1Raw, c3),
      taxable: c3.taxable, cgst: c3.cgst, sgst: c3.sgst, igst: c3.igst, roundDiff: c3.roundDiff, grandTotal: c3.grandTotal
    });
    // payment
    await DB.put('payments', { date: now, partyId: ramesh, direction: 'in', amount: 500, note: 'UPI advance', partyName: 'Ramesh Traders' });
    await loadMaps();
    toast(t('demo_loaded'));
    renderView();
  };

  /* ---------------- init ---------------- */

  function init() {
    DB.open().then(function () {
      return DB.settingsGet('lang', 'en').then(function (lang) {
        state.lang = lang;
        applyLang();
      });
    }).then(function () {
      $('#langBtn').addEventListener('click', window.toggleLang);
      $$('#nav a').forEach(function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          setView(a.dataset.view);
          $('#sidebar').classList.remove('open');
        });
      });
      var menuBtn = $('#menuBtn');
      if (menuBtn) menuBtn.addEventListener('click', function () { $('#sidebar').classList.toggle('open'); });
      window.addEventListener('hashchange', function () {
        var v = (location.hash || '#dashboard').replace('#', '');
        if (v !== state.view) {
          state.view = v;
          $$('#nav a').forEach(function (a) { a.classList.toggle('active', a.dataset.view === v); });
          renderView();
        }
      });
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      }
      window.HC = { DB: DB, GST: GST, state: state, partyBalance: partyBalance, ledgerEntries: ledgerEntries };
    }).catch(function (err) {
      var main = $('#main');
      if (main) main.innerHTML = '<div class="card"><h2 style="color:#b91c1c">Init error</h2><pre>' + esc(err && err.message) + '</pre></div>';
      console.error(err);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
