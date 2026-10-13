/*
 * HisabCraft — GST math test suite.
 * Run: node tests/gst.test.mjs
 * These tests are the credibility layer: every GST claim in the README
 * maps to a case here.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assert = require('node:assert');
const GST = require('../js/gst.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.error('  ✗ ' + name + '\n    ' + (e && e.message));
  }
}

console.log('HisabCraft GST tests');

/* --- CGST / SGST (intra-state) --- */

test('intra-state: 18% on ₹900 taxable → CGST ₹81 + SGST ₹81, total ₹1,062', function () {
  const l = GST.computeLine({ qty: 2, rate: 500, discountPct: 10, gstRate: 18 }, false);
  assert.strictEqual(l.taxable, 900);
  assert.strictEqual(l.cgst, 81);
  assert.strictEqual(l.sgst, 81);
  assert.strictEqual(l.igst, 0);
  assert.strictEqual(l.total, 1062);
});

test('discount applies before GST (gross 1000, 10% disc → taxable 900)', function () {
  assert.strictEqual(GST.lineTaxable({ qty: 2, rate: 500, discountPct: 10 }), 900);
});

test('no discount defaults to 0%', function () {
  assert.strictEqual(GST.lineTaxable({ qty: 1, rate: 250 }), 250);
});

/* --- IGST (inter-state) --- */

test('inter-state: 18% → IGST ₹162, CGST/SGST zero', function () {
  const l = GST.computeLine({ qty: 2, rate: 500, discountPct: 10, gstRate: 18 }, true);
  assert.strictEqual(l.igst, 162);
  assert.strictEqual(l.cgst, 0);
  assert.strictEqual(l.sgst, 0);
  assert.strictEqual(l.total, 1062);
});

test('same total either way (intra = inter = ₹1,062)', function () {
  const a = GST.computeLine({ qty: 2, rate: 500, discountPct: 10, gstRate: 18 }, false).total;
  const b = GST.computeLine({ qty: 2, rate: 500, discountPct: 10, gstRate: 18 }, true).total;
  assert.strictEqual(a, b);
});

/* --- multi-line invoice + round-off --- */

test('multi-line: per-line rounding, then invoice round-off to whole rupee', function () {
  const comp = GST.computeInvoice([
    { qty: 1, rate: 100.55, discountPct: 0, gstRate: 18 },
    { qty: 2, rate: 200.44, discountPct: 0, gstRate: 5 }
  ], false, true);
  assert.strictEqual(comp.taxable, 501.43);
  assert.strictEqual(comp.cgst, 19.07);
  assert.strictEqual(comp.sgst, 19.07);
  assert.strictEqual(comp.igst, 0);
  assert.strictEqual(comp.totalBefore, 539.57);
  assert.strictEqual(comp.grandTotal, 540);
  assert.strictEqual(comp.roundDiff, 0.43);
});

test('round-off disabled keeps paise', function () {
  const comp = GST.computeInvoice([{ qty: 1, rate: 100.55, discountPct: 0, gstRate: 18 }], false, false);
  assert.strictEqual(comp.grandTotal, 118.65);
  assert.strictEqual(comp.roundDiff, 0);
});

test('empty invoice is all zeros', function () {
  const comp = GST.computeInvoice([], false, true);
  assert.strictEqual(comp.taxable, 0);
  assert.strictEqual(comp.grandTotal, 0);
});

/* --- GSTIN checksum (official mod-36 algorithm) --- */

test('valid GSTIN passes: 27AAPFU0939F1ZV', function () {
  assert.strictEqual(GST.validateGSTIN('27AAPFU0939F1ZV'), true);
});

test('corrupted checksum char fails', function () {
  assert.strictEqual(GST.validateGSTIN('27AAPFU0939F1ZX'), false);
});

test('garbage GSTIN fails', function () {
  assert.strictEqual(GST.validateGSTIN('ABC'), false);
  assert.strictEqual(GST.validateGSTIN(''), false);
  assert.strictEqual(GST.validateGSTIN(null), false);
});

test('state code extracted from GSTIN', function () {
  assert.strictEqual(GST.stateCodeFromGSTIN('27AAPFU0939F1ZV'), 27);
  assert.strictEqual(GST.stateCodeFromGSTIN('07AAAAA0000A1Z4'), 7);
});

test('makeGSTIN builds checksum-valid GSTIN from 14-char base', function () {
  const g = GST.makeGSTIN('07AAAAA0000A1Z');
  assert.strictEqual(typeof g, 'string');
  assert.strictEqual(g.length, 15);
  assert.strictEqual(GST.validateGSTIN(g), true);
});

test('gstinChecksum rejects wrong-length base', function () {
  assert.strictEqual(GST.gstinChecksum('ABC'), null);
});

/* --- formatting --- */

test('formatINR uses Indian digit grouping', function () {
  assert.strictEqual(GST.formatINR(123456.78), '₹1,23,456.78');
});

/* --- amount in words (Indian lakh/crore system) --- */

test('1,23,456.78 in words', function () {
  assert.strictEqual(
    GST.numToWordsINR(123456.78),
    'One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees and Seventy Eight Paise Only'
  );
});

test('zero in words', function () {
  assert.strictEqual(GST.numToWordsINR(0), 'Zero Rupees Only');
});

test('crore in words', function () {
  assert.strictEqual(GST.numToWordsINR(10000000), 'One Crore Rupees Only');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
