const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { scoutPageText, immoweltPageText, decodeHtml, stripTags } = require('./parsers.cjs');

const PORT = parseInt(process.env.PORT || '8088', 10);
const AUTH_TOKEN = process.env.EXTRACTOR_TOKEN || '';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map();

// Path to obscura executable
function getObscuraPath() {
  const localBin = path.join(__dirname, '../bin/obscura.exe');
  if (fs.existsSync(localBin)) return localBin;
  const localBinNoExt = path.join(__dirname, '../bin/obscura');
  if (fs.existsSync(localBinNoExt)) return localBinNoExt;
  return 'obscura'; // Fallback to system PATH
}

function detectPortal(url) {
  if (/^https:\/\/(?:www\.)?immobilienscout24\.de\/expose\/(\d+)/i.test(url)) return 'scout';
  if (/^https:\/\/(?:www\.)?immowelt\.de\/expose\/([a-z0-9_-]+)/i.test(url)) return 'immowelt';
  if (/^https:\/\/(?:www\.)?wg-gesucht\.de\/(?:[a-z]{2}\/)?(?:[a-z0-9_-]+\.)?(\d+)\.html/i.test(url)) return 'wg';
  return null;
}

function cleanWgPageText(html) {
  const title = html.search(/<h1\b[^>]*class=["'][^"']*detailed-view-title/i);
  const description = html.search(/<div\b[^>]*id=["']ad_description_text["']/i);
  if (title < 0) return stripTags(html).slice(0, 8000);
  const slice = html.slice(title, description > title ? description + 2000 : title + 8000);
  return stripTags(slice);
}

function fetchWithObscura(url, timeoutSec = 30) {
  return new Promise((resolve) => {
    const obscura = getObscuraPath();
    const args = ['fetch', url, '--stealth', '--dump', 'html', '--timeout', String(timeoutSec)];

    execFile(obscura, args, { maxBuffer: 10 * 1024 * 1024, timeout: (timeoutSec + 5) * 1000 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Erro Obscura [${url}]:`, error.message);
        return resolve({ success: false, error: error.message, html: '' });
      }
      resolve({ success: true, html: stdout || '' });
    });
  });
}

// MVV Transit calculation helper
async function getTransitTimes(location) {
  if (!location || !location.trim()) return { ok: false, reason: 'LOCALIZACAO_EM_FALTA' };
  let q = location.trim();
  if (!/münchen|munich|garching/i.test(q)) q += ', München';

  try {
    const locRes = await fetch('https://www.mvg.de/api/bgw-pt/v3/locations?query=' + encodeURIComponent(q));
    if (!locRes.ok) return { ok: false, reason: 'HTTP_' + locRes.status };
    const locs = await locRes.json();
    if (!Array.isArray(locs) || !locs.length) return { ok: false, reason: 'LOCALIZACAO_NAO_ENCONTRADA' };
    const best = locs[0];
    const lat = best.latitude, lon = best.longitude;
    if (!lat || !lon) return { ok: false, reason: 'SEM_COORDENADAS' };

    async function calc(destId) {
      const url = `https://www.mvg.de/api/bgw-pt/v3/routes?originLatitude=${lat}&originLongitude=${lon}&destinationStationGlobalId=${destId}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const routes = await res.json();
      if (!Array.isArray(routes) || !routes.length) return null;
      const r = routes[0];
      if (!r.parts || !r.parts.length) return null;
      const start = new Date(r.parts[0].from.plannedDeparture);
      const end = new Date(r.parts[r.parts.length - 1].to.plannedDeparture);
      const minutes = Math.round((end - start) / 60000);
      const usesU6 = r.parts.some(p => p.line && String(p.line.label).toUpperCase() === 'U6');
      return { minutes, usesU6 };
    }

    const [tum, marien] = await Promise.all([calc('de:09184:460'), calc('de:09162:2')]);
    if (!tum || !marien) return { ok: false, reason: 'FALHA_CALCULO_ROTA' };

    const tumOk = tum.minutes <= 60;
    const marienOk = marien.minutes <= 45;
    return {
      ok: true,
      resolvedName: best.name + (best.place ? ', ' + best.place : ''),
      tum: { minutes: tum.minutes, usesU6: tum.usesU6, ok: tumOk },
      marien: { minutes: marien.minutes, usesU6: marien.usesU6, ok: marienOk },
      meetsCriteria: tumOk && marienOk
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function handleExtract(url) {
  const portal = detectPortal(url);
  if (!portal) {
    return { status: 'URL_NAO_SUPORTADO', portal: null, url, text: '' };
  }

  // Check cache
  const cached = cache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { ...cached.data, cached: true };
  }

  const { success, html, error } = await fetchWithObscura(url);
  if (!success || !html) {
    return { status: 'ERRO_OBSCURA', portal, url, text: '', error: error || 'Sem resposta HTML' };
  }

  let text = '';
  if (portal === 'scout') text = scoutPageText(html);
  else if (portal === 'immowelt') text = immoweltPageText(html);
  else if (portal === 'wg') text = cleanWgPageText(html);

  if (!text) {
    return { status: 'SEM_DADOS_ACESSIVEIS', portal, url, text: '' };
  }

  const result = {
    status: 'OK',
    portal,
    url,
    text,
    fetchedAt: new Date().toISOString()
  };

  cache.set(url, { timestamp: Date.now(), data: result });
  return result;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Optional authentication check
  if (AUTH_TOKEN) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token !== AUTH_TOKEN && parsedUrl.searchParams.get('token') !== AUTH_TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Não autorizado. Fornece EXTRACTOR_TOKEN.' }));
    }
  }

  // Health
  if (pathname === '/health' || pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'OK',
      service: 'Rent Munich Obscura Extractor Bridge',
      obscuraPath: getObscuraPath(),
      cacheEntries: cache.size,
      uptimeSec: Math.floor(process.uptime())
    }));
  }

  // Transit calculation
  if (pathname === '/transit') {
    const location = parsedUrl.searchParams.get('location');
    const result = await getTransitTimes(location);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(result));
  }

  // Extract
  if (pathname === '/extract') {
    let targetUrl = parsedUrl.searchParams.get('url');

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const json = JSON.parse(body || '{}');
          if (json.url) targetUrl = json.url;
        } catch (_) {}

        if (!targetUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Parâmetro url em falta.' }));
        }

        const result = await handleExtract(targetUrl);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      });
      return;
    }

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Parâmetro url em falta na query string.' }));
    }

    const result = await handleExtract(targetUrl);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(result));
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Rota não encontrada.' }));
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Rent Munich Extractor Bridge ativo na porta ${PORT}`);
    console.log(`Obscura binary: ${getObscuraPath()}`);
    console.log(`Healthcheck: http://localhost:${PORT}/health`);
    console.log(`Exemplo extract: http://localhost:${PORT}/extract?url=https://www.immobilienscout24.de/expose/12345`);
    console.log(`Exemplo transit: http://localhost:${PORT}/transit?location=Leopoldstraße+50`);
  });
}

module.exports = { server, handleExtract, getTransitTimes, detectPortal };
