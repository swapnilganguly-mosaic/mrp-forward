// Vercel serverless function
// Reads data from public Google Sheets tabs and returns it as window.__MRP_SEED__ format.
//
// Required Google Sheet tabs (names must match exactly):
//   "SKU Master"  → columns: sku_code, fg_name, pack_size_g
//   "RM BOM"      → columns: sku_code, rm_name, rm_pct
//   "PM BOM"      → columns: sku_code, pm_name, pm_qty_per_unit, pm_code (optional)
//   "DRR"         → columns: sku_code, drr
//   "RM Firm"     → columns: name, code, stock, supply
//   "RM MOQ"      → columns: name, moq

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
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'mrp-app/1.0' } });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

function parseCSV(text) {
  if (!text) return [];
  const rows = [];
  let row = [], field = '', i = 0, q = false;
  text = text.replace(/^\uFEFF/, '');
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
    const [skuText, rmText, pmText, drrText, firmText, moqText] = await Promise.all([
      fetchSheet(TABS.skuMaster),
      fetchSheet(TABS.rmBom),
      fetchSheet(TABS.pmBom),
      fetchSheet(TABS.drr),
      fetchSheet(TABS.rmFirm),
      fetchSheet(TABS.rmMoq),
    ]);

    const sku_master = csvToObjects(skuText).map(r => ({
      sku_code:    pick(r, 'sku_code', 'sku code', 'sku', 'code'),
      fg_name:     pick(r, 'fg_name', 'fg name', 'product name', 'name', 'product'),
      pack_size_g: pick(r, 'pack_size_g', 'pack size (g)', 'pack_size', 'pack size', 'pack'),
    })).filter(r => r.sku_code);

    const bom_rm = csvToObjects(rmText).map(r => ({
      sku_code: pick(r, 'sku_code', 'sku code', 'sku'),
      rm_name:  pick(r, 'rm_name', 'rm name', 'raw material', 'name'),
      rm_pct:   pick(r, 'rm_pct', 'rm %', 'rm percent', 'pct', 'percent', '%'),
    })).filter(r => r.sku_code && r.rm_name);

    const bom_pm = csvToObjects(pmText).map(r => ({
      sku_code:        pick(r, 'sku_code', 'sku code', 'sku'),
      pm_name:         pick(r, 'pm_name', 'pm name', 'packaging material', 'name'),
      pm_qty_per_unit: pick(r, 'pm_qty_per_unit', 'qty per unit', 'qty/unit', 'qty', 'quantity') || '1',
      pm_code:         pick(r, 'pm_code', 'pm code', 'code') || '',
    })).filter(r => r.sku_code && r.pm_name);

    const drr = {};
    csvToObjects(drrText).forEach(r => {
      const sku = pick(r, 'sku_code', 'sku code', 'sku');
      const val = pick(r, 'drr', 'units/day', 'units per day', 'daily run rate');
      if (sku) drr[sku] = parseFloat(val) || 0;
    });

    const rm_firm = csvToObjects(firmText).map(r => ({
      name:   pick(r, 'name', 'rm_name', 'rm name', 'material'),
      code:   pick(r, 'code', 'rm_code', 'rm code'),
      stock:  pick(r, 'stock', 'current stock', 'stock (kg)'),
      supply: pick(r, 'supply', 'expected supply', 'supply (kg)'),
    })).filter(r => r.name);

    const rm_moq = csvToObjects(moqText).map(r => ({
      name: pick(r, 'name', 'rm_name', 'rm name', 'material'),
      moq:  pick(r, 'moq', 'moq (kg)', 'minimum order qty'),
    })).filter(r => r.name);

    res.status(200).json({ sku_master, bom_rm, bom_pm, drr, rm_firm, rm_moq });
  } catch (err) {
    console.error('MRP data fetch error:', err);
    res.status(500).json({ error: err.message });
  }
}
