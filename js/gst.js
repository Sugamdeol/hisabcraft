/*
 * HisabCraft — GST core (pure functions, zero dependencies).
 * This is the testable brain of the app. Same file runs in browser and node tests.
 * Indian GST rules implemented here:
 *  - Intra-state sale: CGST + SGST (half of the total rate each)
 *  - Inter-state sale: IGST (full rate)
 *  - Line taxable value = qty * rate - discount
 *  - Invoice-level round off to whole rupee
 *  - GSTIN checksum validation (mod-36, official algorithm)
 */
(function (root) {
  'use strict';

  var ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function validateGSTIN(g) {
    if (typeof g !== 'string') return false;
    g = g.trim().toUpperCase();
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
    var sum = 0, i, val, prod;
    for (i = 0; i < 14; i++) {
      val = ALPHABET.indexOf(g[i]);
      if (val < 0) return false;
      prod = val * (i % 2 === 0 ? 1 : 2);
      sum += Math.floor(prod / 36) + (prod % 36);
    }
    return ALPHABET[(36 - (sum % 36)) % 36] === g[14];
  }

  function stateCodeFromGSTIN(g) {
    if (!validateGSTIN(g)) return null;
    return parseInt(g.slice(0, 2), 10);
  }

  // Checksum char for a 14-char GSTIN base. Used to generate valid demo GSTINs.
  function gstinChecksum(base14) {
    if (typeof base14 !== 'string' || base14.length !== 14) return null;
    var sum = 0, i, val, prod;
    for (i = 0; i < 14; i++) {
      val = ALPHABET.indexOf(base14[i]);
      if (val < 0) return null;
      prod = val * (i % 2 === 0 ? 1 : 2);
      sum += Math.floor(prod / 36) + (prod % 36);
    }
    return ALPHABET[(36 - (sum % 36)) % 36];
  }

  // Build a checksum-valid 15-char GSTIN from a 14-char base.
  function makeGSTIN(base14) {
    var c = gstinChecksum(base14);
    return c === null ? null : (base14 + c);
  }

  // Line: {qty, rate, discountPct, gstRate}
  function lineTaxable(l) {
    var gross = round2((Number(l.qty) || 0) * (Number(l.rate) || 0));
    var disc = round2(gross * (Number(l.discountPct) || 0) / 100);
    return round2(gross - disc);
  }

  function computeLine(l, interState) {
    var taxable = lineTaxable(l);
    var taxAmt = round2(taxable * (Number(l.gstRate) || 0) / 100);
    var cgst = 0, sgst = 0, igst = 0;
    if (interState) {
      igst = taxAmt;
    } else {
      cgst = round2(taxAmt / 2);
      sgst = round2(taxAmt - cgst);
    }
    return {
      taxable: taxable,
      cgst: cgst,
      sgst: sgst,
      igst: igst,
      total: round2(taxable + cgst + sgst + igst)
    };
  }

  // lines: array of {qty, rate, discountPct, gstRate}
  function computeInvoice(lines, interState, roundOff) {
    if (roundOff === undefined) roundOff = true;
    var computed = (lines || []).map(function (l) { return computeLine(l, interState); });
    function sumOf(key) {
      return round2(computed.reduce(function (s, l) { return s + l[key]; }, 0));
    }
    var taxable = sumOf('taxable');
    var cgst = sumOf('cgst');
    var sgst = sumOf('sgst');
    var igst = sumOf('igst');
    var totalBefore = round2(taxable + cgst + sgst + igst);
    var grandTotal = roundOff ? Math.round(totalBefore) : totalBefore;
    return {
      lines: computed,
      taxable: taxable,
      cgst: cgst,
      sgst: sgst,
      igst: igst,
      totalBefore: totalBefore,
      roundDiff: round2(grandTotal - totalBefore),
      grandTotal: grandTotal
    };
  }

  function formatINR(n) {
    var v = Number(n) || 0;
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(v);
    } catch (e) {
      return '₹' + round2(v).toFixed(2);
    }
  }

  function numToWordsINR(n) {
    n = round2(Math.abs(Number(n) || 0));
    var rupees = Math.floor(n);
    var paise = Math.round((n - rupees) * 100);
    var ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
      'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    var tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    function two(x) {
      if (x < 20) return ones[x];
      return tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : '');
    }
    function three(x) {
      var h = Math.floor(x / 100), r = x % 100, s = '';
      if (h) s += ones[h] + ' Hundred';
      if (r) s += (s ? ' ' : '') + two(r);
      return s;
    }
    if (rupees === 0 && paise === 0) return 'Zero Rupees Only';
    var parts = [];
    var crore = Math.floor(rupees / 1e7);
    var lakh = Math.floor((rupees % 1e7) / 1e5);
    var thousand = Math.floor((rupees % 1e5) / 1e3);
    var rest = rupees % 1e3;
    if (crore) parts.push(three(crore) + ' Crore');
    if (lakh) parts.push(two(lakh) + ' Lakh');
    if (thousand) parts.push(two(thousand) + ' Thousand');
    if (rest) parts.push(three(rest));
    var out = parts.join(' ') + ' Rupees';
    if (paise) out += (rupees ? ' and ' : '') + two(paise) + ' Paise';
    return out + ' Only';
  }

  var INDIAN_STATES = [
    ['01', 'Jammu & Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'],
    ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'],
    ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'],
    ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'],
    ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'],
    ['24', 'Gujarat'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'], ['31', 'Lakshadweep'],
    ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman & Nicobar'],
    ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'], ['97', 'Other Territory']
  ];

  var GST = {
    round2: round2,
    validateGSTIN: validateGSTIN,
    stateCodeFromGSTIN: stateCodeFromGSTIN,
    gstinChecksum: gstinChecksum,
    makeGSTIN: makeGSTIN,
    lineTaxable: lineTaxable,
    computeLine: computeLine,
    computeInvoice: computeInvoice,
    formatINR: formatINR,
    numToWordsINR: numToWordsINR,
    INDIAN_STATES: INDIAN_STATES
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = GST;
  else root.GST = GST;
})(typeof window !== 'undefined' ? window : globalThis);
