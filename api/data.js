// Vercel serverless function — reads Google Sheets and returns MRP seed data

const SHEET_ID = '1PDvEjSHOqrn902Y6vIpRvVwlkw3B5HpwP4w6_Stl58o';

const TABS = {
  skuMaster: 'SKU Master',
  rmBom:     'RM BOM',
  pmBom:     'PM BOM',
  drr:       'DRR',
  rmFirm:    'RM Firm',
  rmMoq:     'RM MOQ',
};

async function fetchSheet(tabName) {
  // Try gviz/tq first (works for "Anyone with link can view")
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    // gviz returns HTML redirect when the sheet requires auth
    if (!res.ok || text.startsWith('<!') || text.startsWith('<html') || text.includes('accounts.google.com')) {
      return { text: null, status: res.status, hint: 'html_or_redirect' };
    }
    return { text, status: res.status, hint: 'ok' };
  } catch (e) {
    return { text: null, status: 0, hint: e.message };
  }
}

function parseCSV(text) {
  if (!text) return [];
  const rows = [];
  let row = [], field = '', i = 0, q = false;
  text = text.replace(/^﻿/, '');
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    i++;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

function csvToObjects(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = String(r[i] ?? '').trim(); });
    return obj;
  });
}

function pick(row, ...keys) {
  for (const k of keys) {
    const v = row[k] ?? row[k.replace(/ /g, '_')] ?? row[k.replace(/_/g, ' ')];
    if (v != null && v !== '') return v;
  }
  return '';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const results = await Promise.all([
      fetchSheet(TABS.skuMaster),
      fetchSheet(TABS.rmBom),
      fetchSheet(TABS.pmBom),
      fetchSheet(TABS.drr),
      fetchSheet(TABS.rmFirm),
      fetchSheet(TABS.rmMoq),
    ]);

    const [skuR, rmR, pmR, drrR, firmR, moqR] = results;

    // Debug mode: return raw fetch status
    if (req.query && req.query.debug === '1') {
      return res.status(200).json({
        debug: true,
        tabs: {
          skuMaster: { status: skuR.status, hint: skuR.hint, bytes: skuR.text?.length ?? 0, preview: skuR.text?.slice(0, 200) },
          rmBom:     { status: rmR.status,  hint: rmR.hint,  bytes: rmR.text?.length ?? 0 },
          pmBom:     { status: pmR.status,  hint: pmR.hint,  bytes: pmR.text?.length ?? 0 },
          drr:       { status: drrR.status, hint: drrR.hint, bytes: drrR.text?.length ?? 0 },
          rmFirm:    { status: firmR.status,hint: firmR.hint,bytes: firmR.text?.length ?? 0 },
          rmMoq:     { status: moqR.status, hint: moqR.hint, bytes: moqR.text?.length ?? 0 },
        }
      });
    }

    const sku_master = csvToObjects(skuR.text).map(r => ({
      sku_code:    pick(r, 'sku_code', 'sku code', 'sku', 'code'),
      fg_name:     pick(r, 'fg_name', 'fg name', 'product name', 'name', 'product'),
      pack_size_g: pick(r, 'pack_size_g', 'pack size (g)', 'pack_size', 'pack size', 'pack'),
    })).filter(r => r.sku_code);

    const bom_rm = csvToObjects(rmR.text).map(r => ({
      sku_code: pick(r, 'sku_code', 'sku code', 'sku'),
      rm_name:  pick(r, 'rm_name', 'rm name', 'raw material', 'name'),
      rm_pct:   pick(r, 'rm_pct', 'rm %', 'rm percent', 'pct', 'percent', '%'),
    })).filter(r => r.sku_code && r.rm_name);

    const bom_pm = csvToObjects(pmR.text).map(r => ({
      sku_code:        pick(r, 'sku_code', 'sku code', 'sku'),
      pm_name:         pick(r, 'pm_name', 'pm name', 'packaging material', 'name'),
      pm_qty_per_unit: pick(r, 'pm_qty_per_unit', 'qty per unit', 'qty/unit', 'qty', 'quantity') || '1',
      pm_code:         pick(r, 'pm_code', 'pm code', 'code') || '',
    })).filter(r => r.sku_code && r.pm_name);

    const drr = {};
    csvToObjects(drrR.text).forEach(r => {
      const sku = pick(r, 'sku_code', 'sku code', 'sku');
      const val = pick(r, 'drr', 'units/day', 'units per day', 'daily run rate');
      if (sku) drr[sku] = parseFloat(val) || 0;
    });

    const rm_firm = csvToObjects(firmR.text).map(r => ({
      name:      pick(r, 'name', 'rm_name', 'rm name', 'material'),
      code:      pick(r, 'code', 'rm_code', 'rm code'),
      stock:     pick(r, 'stock', 'current stock', 'stock (kg)'),
      supply:    pick(r, 'supply', 'supply_m1', 'expected supply', 'supply (kg)'),
      supply_m2: pick(r, 'supply_m2') || '0',
    })).filter(r => r.name);

    const rm_moq = csvToObjects(moqR.text).map(r => ({
      name: pick(r, 'name', 'rm_name', 'rm name', 'material'),
      code: pick(r, 'code', 'rm_code') || '',
      moq:  pick(r, 'moq', 'moq (kg)', 'minimum order qty'),
    })).filter(r => r.name);

    res.status(200).json({ sku_master, bom_rm, bom_pm, drr, rm_firm, rm_moq });
  } catch (err) {
    console.error('MRP data fetch error:', err);
    res.status(500).json({ error: err.message });
  }
}
