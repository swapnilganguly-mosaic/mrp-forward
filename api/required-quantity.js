// Vercel serverless function -- deploy this at:  api/required-quantity.js
// (i.e. an "api" folder at the root of your Vercel project, next to
// mrp-forward_index.html / your other pages).
//
// This is v2 -- replaces required-quantity.js with the confirmed endpoint
// and auth header:
//   URL:    https://novacore.mosaicwellness.in/api/vendor-master/material-planning/batch
//   Header: x-api-key: <your key>
//
// PURPOSE: this is the ONLY place the real Nova Core API key should ever
// live. It never appears in mrp-forward_index.html or any other client-side
// file, so it can never be read from "view source" on the public site.
//
// SETUP (one-time, in the Vercel dashboard -- not in any file you commit):
//   1. Go to your Vercel project -> Settings -> Environment Variables.
//   2. Add NOVA_CORE_API_KEY with your real key as the value.
//   3. Add NOVA_CORE_API_URL = https://novacore.mosaicwellness.in/api/vendor-master/material-planning/batch
//      (kept as an env var, not hardcoded, so it can change without a code deploy).
//   4. Redeploy so the new environment variables take effect.
//
// STILL TO CONFIRM once you can test against the real API:
//   - Whether "period" (m1/m2) belongs in the request body, as a query
//     param, or isn't part of their contract at all -- this proxy just
//     forwards whatever body the browser sent, so no change is needed here
//     regardless of the answer.
//   - The response shape, so mrp-forward_index.html's applyReqQtyApiResponse()
//     can be filled in to actually populate Consolidated RM/PM (this proxy
//     itself doesn't need to change for that -- it just passes the response
//     through as-is).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.NOVA_CORE_API_KEY;
  const apiUrl = process.env.NOVA_CORE_API_URL || 'https://novacore.mosaicwellness.in/api/vendor-master/material-planning/batch';

  if (!apiKey) {
    res.status(500).json({
      error: 'Server is not configured yet. Set NOVA_CORE_API_KEY as an Environment Variable in the Vercel project settings, then redeploy.'
    });
    return;
  }

  try {
    const upstream = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify(req.body)
    });

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Could not reach Nova Core API: ' + err.message });
  }
}
