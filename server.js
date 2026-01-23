import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static("public"));

const PORT = Number(process.env.PORT || 8080);
const VRM_BASE = "https://vrmapi.victronenergy.com/v2";

// Malawi bbox filter fallback when country is blank
const MALAWI_BBOX = { latMin: -17.2, latMax: -9.2, lonMin: 32.5, lonMax: 36.1 };
const inMalawiBBox = (lat, lon) => {
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
  return la >= MALAWI_BBOX.latMin && la <= MALAWI_BBOX.latMax && lo >= MALAWI_BBOX.lonMin && lo <= MALAWI_BBOX.lonMax;
};

// -------- tiny in-memory TTL cache --------
const cache = new Map();
function cacheGet(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() > v.expires) { cache.delete(key); return null; }
  return v.value;
}
function cacheSet(key, value, ttlMs) {
  cache.set(key, { value, expires: Date.now() + ttlMs });
}

// -------- HTTP helper --------
async function fetchJson(url, { method = "GET", headers = {}, body, params } = {}) {
  const u = new URL(url);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach(x => u.searchParams.append(k, String(x)));
      else if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    });
  }

  const res = await fetch(u.toString(), {
    method,
    headers: { "Accept": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} :: ${text.slice(0, 400)}`);
  if (!text.trim()) return {};
  try { return JSON.parse(text); }
  catch { throw new Error(`Expected JSON, got: ${text.slice(0, 200)}`); }
}

// -------- lat/lon parsing helpers --------
function dmsToDecimal(component, hemisphere) {
  if (component === null || component === undefined) return null;
  const s = String(component).trim();
  if (!s) return null;

  const direct = Number(s);
  if (Number.isFinite(direct)) return direct;

  const re = /(?<deg>-?\d+(?:\.\d+)?)(?:[^\d]+(?<min>\d+(?:\.\d+)?))?(?:[^\d]+(?<sec>\d+(?:\.\d+)?))?\s*(?<hemi>[NnSsEeWw])?/;
  const m = s.match(re);
  if (!m?.groups) return null;

  const d = Number(m.groups.deg);
  const mi = m.groups.min ? Number(m.groups.min) : 0;
  const se = m.groups.sec ? Number(m.groups.sec) : 0;
  const hemi = (m.groups.hemi || hemisphere || "").toUpperCase();

  let dec = Math.abs(d) + mi / 60 + se / 3600;
  if (d < 0) dec *= -1;

  if (hemi === "S" || hemi === "W") dec = -Math.abs(dec);
  if (hemi === "N" || hemi === "E") dec = Math.abs(dec);

  return Number.isFinite(dec) ? dec : null;
}

function parseLatLonFromText(blob) {
  if (!blob) return [null, null];
  const s = String(blob);

  // decimal pair "-13.9, 33.7"
  let m = s.match(/(-?\d{1,3}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)/);
  if (m) {
    const lat = Number(m[1]), lon = Number(m[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) return [lat, lon];
  }

  // hemisphere tokens
  const tokens = [...s.matchAll(/([NSns])[^A-Za-z0-9]*([0-9°\s'" .]+)|([EWew])[^A-Za-z0-9]*([0-9°\s'" .]+)/g)];
  if (tokens.length) {
    let lat = null, lon = null;
    for (const t of tokens) {
      if (t[1]) lat = dmsToDecimal(t[2], t[1]);
      if (t[3]) lon = dmsToDecimal(t[4], t[3]);
    }
    return [lat, lon];
  }

  return [null, null];
}

// ====================== SonSetLink ======================
async function sslSites() {
  const base = process.env.SSL_BASE;
  const user = process.env.SSL_USER;
  const pass = process.env.SSL_PASS;
  if (!base) return [];

  const url = `${base.replace(/\/$/, "")}/sites.json.php`;
  const rows = await fetchJson(url, { params: { login: user || "", password: pass || "" } });

  if (!Array.isArray(rows)) return [];

  return rows.map(r => {
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);

    // Parse "YYYY-MM-DD HH:MM:SS" as UTC
    let ts = null;
    if (r.most_recent_tx) {
      const iso = String(r.most_recent_tx).trim().replace(" ", "T") + "Z";
      const t = Date.parse(iso);
      if (!isNaN(t)) ts = t / 1000;
    }

    return {
      source: "SonSetLink",
      site_id: String(r.site ?? ""),
      serial: String(r.serial ?? ""),
      site_name: String(r.name ?? ""),
      country: String(r.location ?? ""),
      last_updated: ts,
      flow_total: Number(r.flow_total),
      flow_unit: r.flow_unit,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      model: r.model ?? null,
      group: r.group ?? null,
      table: r.table ?? null
    };
  });
}

async function sslSeries(siteId, serial, startUtc, endUtc) {
  const base = process.env.SSL_BASE;
  const user = process.env.SSL_USER;
  const pass = process.env.SSL_PASS;
  const endpoints = ["usage.json.php", "usage1_msg.json.php", "usage8_msg.json.php", "usage12_msg.json.php"];

  for (const ep of endpoints) {
    const url = `${base.replace(/\/$/, "")}/${ep}`;
    try {
      const j = await fetchJson(url, {
        params: {
          login: user || "",
          password: pass || "",
          site: siteId,
          serial: serial,
          start_date: startUtc,
          end_date: endUtc,
          "feature[]": ["backfill", "decumulation"]
        }
      });
      if (Array.isArray(j) && j.length) return { endpoint: ep, rows: j };
    } catch {
      // try next endpoint
    }
  }
  return { endpoint: null, rows: [] };
}

// ======================== VRM ==========================
async function vrmAuthHeadersTry() {
  const token = process.env.VRM_TOKEN;
  if (!token) throw new Error("VRM_TOKEN not set");

  const schemes = ["Token", "Bearer"];
  for (const scheme of schemes) {
    const headers = {
      "X-Authorization": `${scheme} ${token}`,
      "Authorization": `${scheme} ${token}`
    };
    try {
      const me = await fetchJson(`${VRM_BASE}/users/me`, { headers });
      const uid = String(me?.user?.id || "");
      if (uid) return { headers, uid, scheme };
    } catch {
      // continue
    }
  }
  throw new Error("VRM token failed for Token and Bearer schemes");
}

function findLatLonInDiagnostics(records) {
  let lat = null, lon = null;

  for (const r of (records || [])) {
    if (!r || typeof r !== "object") continue;

    // candidate numeric
    let cand = null;
    for (const field of ["rawValue", "value", "text", "localized"]) {
      const v = r[field];
      if (typeof v === "number" && Number.isFinite(v)) { cand = v; break; }
      if (typeof v === "string") {
        const m = v.match(/(-?\d+(?:\.\d+)?)/);
        if (m) {
          const f = Number(m[1]);
          if (Number.isFinite(f)) { cand = f; break; }
        }
      }
    }

    const nameBlob = ["code", "name", "description", "text", "localized"]
      .map(k => String(r[k] ?? ""))
      .join(" ")
      .toLowerCase();

    if (cand !== null) {
      if (lat === null && /\b(lat|latitude)\b/.test(nameBlob)) lat = cand;
      if (lon === null && /\b(lon|long|longitude)\b/.test(nameBlob)) lon = cand;
    }

    for (const field of ["localized", "text"]) {
      const [lt, ln] = parseLatLonFromText(r[field]);
      if (lat === null && lt !== null) lat = lt;
      if (lon === null && ln !== null) lon = ln;
    }
  }

  if (lat !== null && !(lat >= -90 && lat <= 90)) lat = null;
  if (lon !== null && !(lon >= -180 && lon <= 180)) lon = null;
  return [lat, lon];
}

async function vrmInstallations(vrm) {
  const j = await fetchJson(`${VRM_BASE}/users/${vrm.uid}/installations`, {
    headers: vrm.headers,
    params: { extended: 1 }
  });

  let recs = [];
  if (Array.isArray(j)) recs = j;
  else if (j && typeof j === "object") {
    for (const k of ["records", "installations", "data", "sites"]) {
      if (Array.isArray(j[k])) { recs = j[k]; break; }
    }
    if (!recs.length && j.data?.records && Array.isArray(j.data.records)) recs = j.data.records;
  }

  return recs.map(r => ({
    site_id: String(r.idSite ?? r.idInstallation ?? r.id ?? ""),
    site_name: String(r.name ?? r.siteName ?? ""),
    last_updated: r.last_timestamp ? Number(r.last_timestamp) : null
  }));
}

async function vrmCoordsForSite(vrm, siteId) {
  const ck = `vrm:coords:${siteId}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  let lat = null, lon = null;
  const stats = {};

  // diagnostics
  try {
    const diag = await fetchJson(`${VRM_BASE}/installations/${siteId}/diagnostics`, {
      headers: vrm.headers,
      params: { count: 1000 }
    });
    const recs = diag.records || [];
    [lat, lon] = findLatLonInDiagnostics(recs);

    // Extract common stats
    // Added: ScS (Charge State), ScERR (Error), SLs (Load State), GW (Gateway/Logger ID - 'd')
    // Added: MA (Pulse Agg), MC (Pulse Count)
    const WANTED = new Set(["BV", "SOC", "P", "I", "T", "TL", "TF", "PVP", "YT", "SCS", "SCERR", "SLS", "SCW", "D", "GW", "MA", "MC"]);

    for (const r of recs) {
      const c = String(r.code || "");
      const upper = c.toUpperCase();

      // Check normalized upper case code against WANTED set
      // Also catch anything starting with BAT or SOL
      if (WANTED.has(upper) || upper.startsWith("BAT") || upper.startsWith("SOL")) {
        stats[upper] = r.formattedValue ?? r.value;
      }

      // Special mappings if needed
      if (c === "d") stats["GW"] = r.formattedValue ?? r.value; // Gateway ID

      if (c === "F" || upper.includes("FIRMWARE") || r.description?.toLowerCase().includes("firmware")) {
        stats["BUILD"] = r.formattedValue ?? r.value;
      }
    }
  } catch { }

  // system overview scan
  if (lat === null || lon === null) {
    try {
      const ov = await fetchJson(`${VRM_BASE}/installations/${siteId}/system-overview`, { headers: vrm.headers });
      const txt = JSON.stringify(ov);
      const [lt, ln] = parseLatLonFromText(txt);
      if (lat === null && lt !== null) lat = lt;
      if (lon === null && ln !== null) lon = ln;
    } catch { }
  }

  const out = { lat, lon, stats };
  cacheSet(ck, out, 12 * 60 * 60 * 1000);
  return out;
}

async function vrmGraphSeries(vrm, siteId, startEpoch, endEpoch) {
  // 1. Fetch Diagnostics to discover available data points
  let diagRecords = [];
  try {
    const diag = await fetchJson(`${VRM_BASE}/installations/${siteId}/diagnostics`, {
      headers: vrm.headers,
      params: { count: 1000 }
    });
    diagRecords = diag.records || [];
  } catch (e) {
    console.log(`VRM Diag Error ${siteId}:`, e.message);
    return []; // Cannot verify IDs without diagnostics
  }

  // console.log(`VRM DEBUG: site=${siteId} diag_count=${diagRecords.length}`);

  // 2. Select IDs using a "Safe Discovery" strategy
  // Priority: Flow > Tank > Energy > Other
  const PRIORITY_CODES = new Set([
    "mc", "ma",               // Pulse/Flow
    "tl", "tr",               // Tank
    "pvp", "bv", "soc", "dc", // Solar/Batt
    "yt", "wr",               // Yield, Work
    "v", "i", "p"             // Generic V/I/P
  ]);

  // Codes to explicitly IGNORE (Metadata, versions, enums)
  const IGNORE_CODES = new Set([
    "d", "fw", "ver", "build", "cp", "mn", "mi", "bid", "xv", // Device/FW info
    "st", "s", "ss", "cs", "dm", "ve", "err",                 // States/Enums
    "gd", "ge", "gw"                                          // Geo/Gateway
  ]);

  const selectedIds = new Set();
  const attributes = []; // To track what we picked

  // Pass 1: Grab Priority items first
  for (const r of diagRecords) {
    if (!r.id || !r.code) continue;
    const c = String(r.code).toLowerCase();

    // Special case: 'v' is often Firmware Version (bad) or Voltage (good).
    // If description says "Version" or "Fw", skip it.
    if (c === 'v' && String(r.description).toLowerCase().includes('version')) continue;

    if (PRIORITY_CODES.has(c)) {
      selectedIds.add(r.id);
      attributes.push({ id: r.id, code: r.code });
    }
  }

  // Pass 2: Fill up to 20 items with other valid numeric fields
  // Strict filter: Must NOT be in IGNORE list
  for (const r of diagRecords) {
    if (selectedIds.size >= 20) break;
    if (!r.id || !r.code) continue;
    if (selectedIds.has(r.id)) continue;

    const c = String(r.code).toLowerCase();
    if (IGNORE_CODES.has(c)) continue;

    // check if it looks like a number
    if (Number.isFinite(Number(r.rawValue))) {
      selectedIds.add(r.id);
      attributes.push({ id: r.id, code: r.code });
    }
  }

  // console.log(`VRM DEBUG: site=${siteId} selected=${attributes.map(a => a.code).join(",")}`);

  if (selectedIds.size === 0) {
    console.log(`VRM DEBUG: No numeric IDs found for site ${siteId}`);
    return [];
  }

  // 3. Fetch Graph using Attribute IDs
  // Ensure IDs are strings for URL construction
  const attributeIds = Array.from(selectedIds).map(String);
  const payload = await fetchJson(`${VRM_BASE}/installations/${siteId}/widgets/Graph`, {
    headers: vrm.headers,
    params: {
      "attributeIds[]": attributeIds,
      start: startEpoch,
      end: endEpoch
    }
  });

  const rec = payload.records || {};
  const data = rec.data || {};
  const meta = rec.meta || {};
  const keys = Object.keys(data);
  console.log(`VRM DEBUG: site=${siteId} request_ids=${attributeIds.length} response_keys=${keys.length}`);

  // console.log(`VRM DEBUG: site=${siteId} payload_keys=${Object.keys(payload.records?.data || {}).length}`);
  const pts = [];

  for (const [idStr, arr] of Object.entries(data)) {
    const md = meta[idStr] || {};
    const code = String(md.code || "").trim() || "UNKNOWN";

    if (arr && arr.length > 0) {
      console.log(`VRM DEBUG: Code ${code} (ID ${idStr}) has ${arr.length} pts. First: ${JSON.stringify(arr[0])}`);
    } else {
      // console.log(`VRM DEBUG: Code ${code} (ID ${idStr}) is empty.`);
    }

    for (const p of (arr || [])) {
      let x, y;
      if (Array.isArray(p) && p.length >= 2) [x, y] = p;
      else if (p && typeof p === "object") { x = p.x ?? p.t ?? p.ts; y = p.y ?? p.v ?? p.value; }
      else continue;

      const ts = Number(x);
      const val = Number(y);
      if (!Number.isFinite(ts) || !Number.isFinite(val)) continue;

      const tsMs = ts > 1e10 ? Math.trunc(ts) : Math.trunc(ts * 1000);
      pts.push({ timestamp_ms: tsMs, code, value: val });
    }
  }

  return pts;
}

// ======================== API endpoints =========================
app.get("/api/config", (req, res) => {
  res.json({
    defaults: {
      malawi_only: String(process.env.DEFAULT_MALAWI_ONLY || "true") === "true",
      days: Number(process.env.DEFAULT_DAYS || 30)
    }
  });
});

app.get("/api/sites", async (req, res) => {
  try {
    const malawiOnly = (req.query.malawi_only ?? "true") === "true";

    const ck = `sites:${malawiOnly}`;
    const cached = cacheGet(ck);
    if (cached) return res.json(cached);

    const out = [];

    // SonSetLink
    let ssl = [];
    try { ssl = await sslSites(); } catch { }
    out.push(...ssl);

    // VRM
    let vrm = null;
    try { vrm = await vrmAuthHeadersTry(); } catch { vrm = null; }

    if (vrm) {
      const inst = await vrmInstallations(vrm);
      for (const r of inst) {
        const c = await vrmCoordsForSite(vrm, r.site_id);
        out.push({
          source: "VRM",
          site_id: r.site_id,
          serial: "",
          site_name: r.site_name,
          country: "",
          last_updated: r.last_updated,
          lat: c.lat,
          lon: c.lon,
          stats: c.stats
        });
      }
    }

    let filtered = out;
    if (malawiOnly) {
      filtered = out.filter(r => {
        const c = String(r.country || "").trim().toLowerCase();
        return c === "malawi" || inMalawiBBox(r.lat, r.lon);
      });
    }

    cacheSet(ck, filtered, 2 * 60 * 1000);
    res.json(filtered);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/series", async (req, res) => {
  try {
    const source = String(req.query.source || "");
    const siteId = String(req.query.site_id || "");
    const serial = String(req.query.serial || "");
    const days = Math.max(1, Math.min(365, Number(req.query.days || 30)));

    if (!source || !siteId) return res.status(400).json({ error: "Missing source/site_id" });

    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 3600 * 1000);

    // format UTC as "YYYY-MM-DD HH:MM:SS"
    const fmt = (d) => d.toISOString().replace("T", " ").slice(0, 19);
    const sUtc = fmt(start);
    const eUtc = fmt(end);

    const ck = `series:${source}:${siteId}:${serial}:${days}`;
    const cached = cacheGet(ck);
    if (cached) return res.json(cached);

    if (source === "SonSetLink") {
      const got = await sslSeries(siteId, serial, sUtc, eUtc);
      const payload = { source, site_id: siteId, serial, start_utc: sUtc, end_utc: eUtc, ...got };
      cacheSet(ck, payload, 60 * 1000);
      return res.json(payload);
    }

    if (source === "VRM") {
      const vrm = await vrmAuthHeadersTry();
      const startEpoch = Math.trunc(start.getTime() / 1000);
      const endEpoch = Math.trunc(end.getTime() / 1000);
      const rows = await vrmGraphSeries(vrm, siteId, startEpoch, endEpoch);
      const payload = { source, site_id: siteId, start_utc: sUtc, end_utc: eUtc, rows };
      cacheSet(ck, payload, 60 * 1000);
      return res.json(payload);
    }

    return res.status(400).json({ error: "Unknown source" });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/debug/vrm", async (req, res) => {
  try {
    const vrm = await vrmAuthHeadersTry();
    const inst = await vrmInstallations(vrm);
    if (!inst.length) return res.json({ error: "No VRM sites found" });

    // Pick first site
    const siteId = inst[0].site_id;

    const diag = await fetchJson(`${VRM_BASE}/installations/${siteId}/diagnostics`, {
      headers: vrm.headers,
      params: { count: 1000 }
    });

    // Return simplified list of all available codes
    const summary = (diag.records || []).map(r => ({
      code: r.code,
      description: r.description,
      formatted: r.formattedValue,
      raw: r.rawValue,
      b: r.idDataAttribute
    }));

    res.json({ site: siteId, name: inst[0].site_name, count: summary.length, variables: summary });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/debug/graph", async (req, res) => {
  try {
    const vrm = await vrmAuthHeadersTry();
    const inst = await vrmInstallations(vrm);
    if (!inst.length) return res.json({ error: "No VRM sites" });
    const siteId = inst[0].site_id; // Use first site

    // Force codes just like series API
    // Force codes just like series API
    // const codes = ["PVP", "BV", "SOC", "DC", "MC", "mc", "MA", "ma", "TL", "tl", "TR", "tr"];

    // Last 2 days
    const end = Math.trunc(Date.now() / 1000);
    const start = end - (2 * 24 * 3600);

    const results = [];

    // Test first 5 sites
    for (const site of inst.slice(0, 5)) {
      const sid = site.site_id;
      try {
        const payload = await fetchJson(`${VRM_BASE}/installations/${sid}/widgets/Graph`, {
          headers: vrm.headers,
          params: {
            "attributeCodes[]": ["mc", "MC", "tl", "TL", "soc", "SOC"],
            instance: 0,
            start,
            end
          }
        });
        const ptCount = countPoints(payload);
        results.push({ site_id: sid, name: site.site_name, points: ptCount });
      } catch (e) {
        results.push({ site_id: sid, error: e.message });
      }
    }

    res.json({
      scan_results: results,
      note: "Testing Strategy B (Codes + Instance 0) across 5 sites"
    });

  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

function countPoints(payload) {
  const data = payload.records?.data || {};
  let count = 0;
  for (const k of Object.keys(data)) count += (data[k] || []).length;
  return count;
}

function getSample(payload) {
  const data = payload.records?.data || {};
  const out = {};
  for (const k of Object.keys(data)) out[k] = (data[k] || []).slice(0, 3);
  return out;
}


app.listen(PORT, () => {
  console.log(`Running at: http://localhost:${PORT}`);
});
