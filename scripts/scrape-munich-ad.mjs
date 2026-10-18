#!/usr/bin/env node
/**
 * scripts/scrape-munich-ad.mjs
 * 
 * Script / serviço complementar local do Rent Munich:
 * - Executa extração stealth via Obscura para ImmoScout24, Immowelt ou WG-Gesucht.
 * - Extrai texto limpo, preços (Kaltmiete, Warmmiete, despesas), morada, data de entrada,
 *   tipologia e fotos principais.
 * - Calcula tempos de percurso MVV até TUM Garching e Marienplatz (com deteção U6).
 * - Opcionalmente avalia critérios com a Gemini API (Free Tier).
 * - Opcionalmente dispara notificação instantânea para o Telegram Bot.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constantes de percurso por defeito (configuráveis)
export const TRANSIT_LIMITS = {
  maxTumMinutes: 60,       // TUM Garching Campus (1 h)
  maxMarienMinutes: 45,    // Marienplatz
  tumGlobalId: 'de:09184:460',
  marienGlobalId: 'de:09162:2'
};

/**
 * Localiza o binário do Obscura no projeto ou no PATH do sistema.
 */
export function locateObscura() {
  const localExe = path.join(__dirname, '../bin/obscura.exe');
  if (fs.existsSync(localExe)) return localExe;
  const localBin = path.join(__dirname, '../bin/obscura');
  if (fs.existsSync(localBin)) return localBin;
  return 'obscura';
}

/**
 * Deteta o portal com base no URL.
 */
export function detectPortal(url) {
  if (/^https:\/\/(?:www\.)?immobilienscout24\.de\/expose\/(\d+)/i.test(url)) return 'scout';
  if (/^https:\/\/(?:www\.)?immowelt\.de\/expose\/([a-z0-9_-]+)/i.test(url)) return 'immowelt';
  if (/^https:\/\/(?:www\.)?wg-gesucht\.de\/(?:[a-z]{2}\/)?(?:[a-z0-9_-]+\.)?(\d+)\.html/i.test(url)) return 'wg';
  return null;
}

/**
 * Normaliza e decodifica entidades HTML básicas.
 */
function decodeEntities(str) {
  const map = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&euro;': '€',
    '&sup2;': '²', '&auml;': 'ä', '&ouml;': 'ö', '&uuml;': 'ü', '&Auml;': 'Ä', '&Ouml;': 'Ö',
    '&Uuml;': 'Ü', '&szlig;': 'ß', '&nbsp;': ' '
  };
  return String(str || '').replace(/&(?:[a-z]+|#x[0-9a-f]+|#\d+);/gi, m => map[m] || m);
}

/**
 * Remove tags HTML e comprime espaços em branco.
 */
function stripHtml(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

/**
 * Executa o Obscura em modo stealth para recolher o HTML renderizado.
 */
export function fetchWithObscura(url, timeoutSec = 30) {
  return new Promise((resolve, reject) => {
    const bin = locateObscura();
    const args = ['fetch', url, '--stealth', '--dump', 'html', '--timeout', String(timeoutSec)];

    execFile(bin, args, { maxBuffer: 15 * 1024 * 1024, timeout: (timeoutSec + 5) * 1000 }, (err, stdout) => {
      if (err) return reject(new Error(`Falha ao executar Obscura [${url}]: ${err.message}`));
      resolve(stdout || '');
    });
  });
}

/**
 * Extrai dados estruturados de um anúncio do ImmoScout24.
 */
export function parseImmoScout(html) {
  const data = {
    portal: 'scout',
    title: '',
    address: '',
    coldRent: null,
    warmRent: null,
    extraCosts: null,
    rooms: null,
    livingArea: null,
    moveInDate: '',
    kitchen: 'unknown',
    furnished: 'unknown',
    photos: [],
    description: '',
    rawText: ''
  };

  // 1. Fotos
  const photoMatches = String(html).match(/https:\/\/pictures\.immobilienscout24\.de\/[^\s"'<>]+/gi) || [];
  const uniquePhotos = Array.from(new Set(photoMatches.map(p => p.split('?')[0]))).filter(p => !p.endsWith('.svg'));
  data.photos = uniquePhotos.slice(0, 5);

  // 2. JSON-LD
  const jsonLdMatch = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      const parsed = JSON.parse(jsonLdMatch[1]);
      if (parsed.name) data.title = parsed.name;
      if (parsed.description) data.description = parsed.description;
      if (parsed.address) {
        data.address = typeof parsed.address === 'object'
          ? [parsed.address.streetAddress, parsed.address.postalCode, parsed.address.addressLocality].filter(Boolean).join(', ')
          : String(parsed.address);
      }
      if (parsed.offers && parsed.offers.price) data.coldRent = parseFloat(parsed.offers.price);
    } catch (_) {}
  }

  // 3. Fallbacks de DOM
  if (!data.title) {
    const t = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    if (t) data.title = stripHtml(t[1]);
  }
  if (!data.address) {
    const a = html.match(/(?:<span\b[^>]*class=["'][^"']*zip-region-and-country[^"']*["'][^>]*>|<div\b[^>]*class=["'][^"']*address-group[^"']*["'][^>]*>)([\s\S]*?)<\/(?:span|div)>/i);
    if (a) data.address = stripHtml(a[1]);
  }

  // Preços e Atributos via data-is24-qa
  const coldMatch = html.match(/is24-qa-kaltmiete[^>]*>([\s\S]*?)<\//i);
  if (coldMatch) {
    const val = stripHtml(coldMatch[1]).replace(/[^\d.,]/g, '').replace('.', '').replace(',', '.');
    if (val) data.coldRent = parseFloat(val);
  }
  const warmMatch = html.match(/is24-qa-gesamtmiete[^>]*>([\s\S]*?)<\//i) || html.match(/is24-qa-warmmiete[^>]*>([\s\S]*?)<\//i);
  if (warmMatch) {
    const val = stripHtml(warmMatch[1]).replace(/[^\d.,]/g, '').replace('.', '').replace(',', '.');
    if (val) data.warmRent = parseFloat(val);
  }
  const nebenMatch = html.match(/is24-qa-nebenkosten[^>]*>([\s\S]*?)<\//i);
  if (nebenMatch) {
    const val = stripHtml(nebenMatch[1]).replace(/[^\d.,]/g, '').replace('.', '').replace(',', '.');
    if (val) data.extraCosts = parseFloat(val);
  }
  const roomsMatch = html.match(/is24-qa-zimmer[^>]*>([\s\S]*?)<\//i);
  if (roomsMatch) {
    const val = stripHtml(roomsMatch[1]).replace(/[^\d.,]/g, '').replace(',', '.');
    if (val) data.rooms = parseFloat(val);
  }
  const areaMatch = html.match(/is24-qa-flaeche[^>]*>([\s\S]*?)<\//i) || html.match(/is24-qa-wohnflaeche[^>]*>([\s\S]*?)<\//i);
  if (areaMatch) {
    const val = stripHtml(areaMatch[1]).replace(/[^\d.,]/g, '').replace(',', '.');
    if (val) data.livingArea = parseFloat(val);
  }

  // Cozinha / Mobília
  const fullText = stripHtml(html);
  if (/einbauk(?:ü|ue)che|\bebk\b/i.test(fullText)) data.kitchen = 'yes';
  else if (/ohne k(?:ü|ue)che|keine k(?:ü|ue)che/i.test(fullText)) data.kitchen = 'no';

  if (/m(?:ö|oe)bliert|furnished/i.test(fullText)) data.furnished = 'yes';
  else if (/unm(?:ö|oe)bliert|unfurnished/i.test(fullText)) data.furnished = 'no';

  const moveInMatch = fullText.match(/(?:frei ab|verf(?:ü|ue)gbar ab|ab datum|bezugsfrei ab)[:\s]+([0-9]{2}[./-][0-9]{2}[./-][0-9]{4}|sofort|[a-z]+\s+[0-9]{4})/i);
  if (moveInMatch) data.moveInDate = moveInMatch[1].trim();

  // Texto limpo resumido
  data.rawText = `[ImmoScout24] ${data.title}\nMorada: ${data.address}\nKaltmiete: ${data.coldRent ?? '?'} € | Warmmiete: ${data.warmRent ?? '?'} € | Nebenkosten: ${data.extraCosts ?? '?'} €\nZimmer: ${data.rooms ?? '?'} | Área: ${data.livingArea ?? '?'} m²\nCozinha: ${data.kitchen} | Mobília: ${data.furnished} | Entrada: ${data.moveInDate || 'por confirmar'}\n\nDescrição:\n${fullText.slice(0, 4000)}`;

  return data;
}

/**
 * Extrai dados estruturados de um anúncio do Immowelt.
 */
export function parseImmowelt(html) {
  const data = {
    portal: 'immowelt',
    title: '',
    address: '',
    coldRent: null,
    warmRent: null,
    extraCosts: null,
    rooms: null,
    livingArea: null,
    moveInDate: '',
    kitchen: 'unknown',
    furnished: 'unknown',
    photos: [],
    description: '',
    rawText: ''
  };

  // 1. Fotos
  const photoMatches = String(html).match(/https:\/\/mms\.immowelt\.de\/[^\s"'<>]+/gi) || [];
  data.photos = Array.from(new Set(photoMatches.map(p => p.split('?')[0]))).slice(0, 5);

  // 2. __NEXT_DATA__
  const nextDataMatch = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const next = JSON.parse(nextDataMatch[1]);
      const estate = next.props?.pageProps?.estate || next.props?.pageProps?.exposeData || {};
      if (estate.title) data.title = estate.title;
      if (estate.address) {
        data.address = typeof estate.address === 'object'
          ? [estate.address.street, estate.address.zipCode, estate.address.city, estate.address.district].filter(Boolean).join(', ')
          : String(estate.address);
      }
      if (estate.prices) {
        if (estate.prices.kaltmiete) data.coldRent = parseFloat(String(estate.prices.kaltmiete).replace(/[^\d.,]/g, '').replace(',', '.'));
        if (estate.prices.warmmiete) data.warmRent = parseFloat(String(estate.prices.warmmiete).replace(/[^\d.,]/g, '').replace(',', '.'));
      }
      if (estate.hardFacts && Array.isArray(estate.hardFacts)) {
        for (const h of estate.hardFacts) {
          const l = (h.label || '').toLowerCase();
          const v = h.value || h.text || '';
          if (l.includes('zimmer')) data.rooms = parseFloat(String(v).replace(',', '.'));
          if (l.includes('wohnfläche') || l.includes('flaeche')) data.livingArea = parseFloat(String(v).replace(',', '.'));
        }
      }
      if (estate.gallery && Array.isArray(estate.gallery) && !data.photos.length) {
        data.photos = estate.gallery.map(g => g.url || g).filter(Boolean).slice(0, 5);
      }
      if (estate.texts?.description) data.description = estate.texts.description;
    } catch (_) {}
  }

  const fullText = stripHtml(html);
  if (!data.title) {
    const t = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    if (t) data.title = stripHtml(t[1]);
  }

  if (/einbauk(?:ü|ue)che|\bebk\b/i.test(fullText)) data.kitchen = 'yes';
  if (/m(?:ö|oe)bliert|furnished/i.test(fullText)) data.furnished = 'yes';

  data.rawText = `[Immowelt] ${data.title}\nMorada: ${data.address}\nKaltmiete: ${data.coldRent ?? '?'} € | Warmmiete: ${data.warmRent ?? '?'} €\nZimmer: ${data.rooms ?? '?'} | Área: ${data.livingArea ?? '?'} m²\nCozinha: ${data.kitchen} | Mobília: ${data.furnished}\n\nDescrição:\n${fullText.slice(0, 4000)}`;

  return data;
}

/**
 * Extrai dados de um anúncio do WG-Gesucht.
 */
export function parseWgGesucht(html) {
  const data = {
    portal: 'wg',
    title: '',
    address: '',
    coldRent: null,
    warmRent: null,
    extraCosts: null,
    rooms: null,
    livingArea: null,
    moveInDate: '',
    kitchen: 'unknown',
    furnished: 'unknown',
    photos: [],
    description: '',
    rawText: ''
  };

  const photoMatches = String(html).match(/https:\/\/(?:img\.)?wg-gesucht\.de\/media\/[^\s"'<>]+/gi) || [];
  data.photos = Array.from(new Set(photoMatches)).slice(0, 5);

  const t = html.match(/<h1\b[^>]*class=["'][^"']*detailed-view-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (t) data.title = stripHtml(t[1]);

  const fullText = stripHtml(html);
  const rentMatch = fullText.match(/(?:gesamtmiete|miete)[:\s]+([0-9.,]+)\s*€/i);
  if (rentMatch) data.warmRent = parseFloat(rentMatch[1].replace('.', '').replace(',', '.'));

  const moveMatch = fullText.match(/frei ab[:\s]+([0-9]{2}\.[0-9]{2}\.[0-9]{4})/i);
  if (moveMatch) data.moveInDate = moveMatch[1];

  data.rawText = `[WG-Gesucht] ${data.title}\n${fullText.slice(0, 4000)}`;
  return data;
}

/**
 * Consulta a API de transportes da MVG para obter tempos de percurso até TUM Garching e Marienplatz.
 */
export async function getTransitTimes(address) {
  if (!address || !address.trim()) return { ok: false, reason: 'LOCALIZACAO_EM_FALTA' };
  let q = address.trim();
  if (!/münchen|munich|garching/i.test(q)) q += ', München';

  try {
    const locRes = await fetch('https://www.mvg.de/api/bgw-pt/v3/locations?query=' + encodeURIComponent(q));
    if (!locRes.ok) return { ok: false, reason: 'HTTP_' + locRes.status };
    const locs = await locRes.json();
    if (!Array.isArray(locs) || !locs.length) return { ok: false, reason: 'LOCALIZACAO_NAO_ENCONTRADA' };
    const best = locs[0];
    const { latitude: lat, longitude: lon } = best;
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

    const [tum, marien] = await Promise.all([
      calc(TRANSIT_LIMITS.tumGlobalId),
      calc(TRANSIT_LIMITS.marienGlobalId)
    ]);
    if (!tum || !marien) return { ok: false, reason: 'FALHA_CALCULO_ROTA' };

    const tumOk = tum.minutes <= TRANSIT_LIMITS.maxTumMinutes;
    const marienOk = marien.minutes <= TRANSIT_LIMITS.maxMarienMinutes;
    const meetsCriteria = tumOk && marienOk;

    const summary = `🚇 ${tum.minutes} min à TUM Garching ${tum.usesU6 ? '(U6)' : ''} | ${marien.minutes} min a Marienplatz ${marien.usesU6 ? '(U6)' : ''}`;

    return {
      ok: true,
      resolvedName: best.name + (best.place ? ', ' + best.place : ''),
      tum: { minutes: tum.minutes, usesU6: tum.usesU6, ok: tumOk },
      marien: { minutes: marien.minutes, usesU6: marien.usesU6, ok: marienOk },
      meetsCriteria,
      summary
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Dispara notificação instantânea para o Telegram Bot via Telegram Bot API.
 */
export async function sendTelegramAlert(listing, transit, options = {}) {
  const botToken = options.botToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId || process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    return { sent: false, reason: 'TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não definidos' };
  }

  const tipoStr = listing.kind === 'entire' ? `Casa inteira para ${listing.people || 3}` :
    listing.kind === 'shared' ? 'Quarto em WG' :
    listing.kind === 'studio' ? 'Estúdio Individual' : 'Apartamento / Quarto';

  const warmStr = listing.warmRent ? `${listing.warmRent.toFixed(2).replace('.', ',')} €` : 'por confirmar';
  const personStr = listing.warmPerPerson ? `${listing.warmPerPerson.toFixed(2).replace('.', ',')} €` : warmStr;

  const transitLine = transit?.summary || '🚇 Tempos MVV por confirmar';

  const text = `🏠 <b>${tipoStr} — Munique</b>\n\n` +
    `💶 <b>Warmmiete:</b> ${warmStr} (<b>${personStr}/pessoa</b>)\n` +
    `📍 <b>Localização:</b> ${listing.address || 'Munique'}\n` +
    `${transitLine}\n` +
    `📅 <b>Entrada:</b> ${listing.moveInDate || '2027-01-01'} · <b>Cozinha:</b> ${listing.kitchen === 'yes' ? 'Instalada (EBK) ✅' : 'Por confirmar'}\n\n` +
    `<b>Título:</b> ${listing.title || 'Anúncio de arrendamento'}\n` +
    (listing.notes ? `<i>${listing.notes}</i>\n` : '');

  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: false,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔗 Ver Anúncio no Site', url: listing.url },
          { text: '✉️ Contactar Senhorio', url: listing.url }
        ]
      ]
    }
  };

  const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const respData = await res.json();
  return { sent: res.ok, status: res.status, data: respData };
}

/**
 * Função principal que coordena a extração, transportes, IA e Telegram.
 */
export async function scrapeListing(url, options = {}) {
  const portal = detectPortal(url);
  if (!portal) throw new Error(`URL de portal não suportado: ${url}`);

  // 1. Fetch stealth com Obscura
  const html = await fetchWithObscura(url, options.timeoutSec || 30);
  if (!html) throw new Error(`Obscura não retornou conteúdo HTML para: ${url}`);

  // 2. Extração limpa dos dados
  let ad;
  if (portal === 'scout') ad = parseImmoScout(html);
  else if (portal === 'immowelt') ad = parseImmowelt(html);
  else ad = parseWgGesucht(html);
  ad.url = url;

  // 3. Cálculo de transportes MVV
  let transit = null;
  const addressQuery = ad.address || ad.title;
  if (addressQuery) {
    transit = await getTransitTimes(addressQuery);
    ad.transit = transit;
  }

  // 4. Opcional: Gemini API
  let geminiResult = null;
  const apiKey = options.geminiApiKey || process.env.GEMINI_API_KEY;
  if (options.gemini && apiKey) {
    const prompt = `Avalia este anúncio de arrendamento em Munique segundo os critérios:
- Orçamento: máx 1000 € warm/pessoa (ideal 800 €).
- Cozinha instalada (EBK) obrigatória.
- Entrada a partir de 2027-01-01 (longa duração).
- Localização e percurso: TUM Garching <= 60 min, Marienplatz <= 45 min.
Dados do anúncio:\n${ad.rawText}\n\nTransportes MVV:\n${transit?.summary || 'Não calculados'}\n\nResponde em JSON com: { approved: boolean, reason: string, warmPerPerson: number, kind: string, people: number }`;

    const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 }
      })
    });
    if (gRes.ok) {
      const gJson = await gRes.json();
      try {
        geminiResult = JSON.parse(gJson.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
        ad.gemini = geminiResult;
      } catch (_) {}
    }
  }

  // 5. Opcional: Notificação Telegram
  if (options.telegram) {
    const tgRes = await sendTelegramAlert(ad, transit, options);
    ad.telegram = tgRes;
  }

  return ad;
}

// Execução direta via CLI
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    console.log(`
Uso do Scraper Rent Munich:
  node scripts/scrape-munich-ad.mjs <URL_DO_ANUNCIO> [opções]

Opções:
  --gemini          Avalia o anúncio com a Gemini API (requer GEMINI_API_KEY)
  --telegram        Envia alerta imediato para o Telegram Bot (requer TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID)
  --json            Devolve apenas a saída em formato JSON
  --transit <morada> Calcula apenas os tempos de transporte MVV para uma morada

Exemplos:
  node scripts/scrape-munich-ad.mjs https://www.immobilienscout24.de/expose/12345678
  node scripts/scrape-munich-ad.mjs https://www.immowelt.de/expose/2c3d4e --gemini
  node scripts/scrape-munich-ad.mjs --transit "Leopoldstraße 50, München"
`);
    process.exit(0);
  }

  if (args[0] === '--transit' || args[0] === '-t') {
    const addr = args.slice(1).join(' ');
    console.log(`A calcular tempos MVV para: "${addr}"...`);
    const res = await getTransitTimes(addr);
    console.log(JSON.stringify(res, null, 2));
    if (res.ok) console.log(`\n${res.summary}`);
    process.exit(0);
  }

  const url = args.find(a => a.startsWith('http'));
  if (!url) {
    console.error('Erro: Fornece um URL válido de anúncio (ImmoScout24, Immowelt ou WG-Gesucht).');
    process.exit(1);
  }

  const opts = {
    gemini: args.includes('--gemini'),
    telegram: args.includes('--telegram'),
    json: args.includes('--json')
  };

  try {
    if (!opts.json) console.log(`A extrair anúncio (${detectPortal(url)}) com Obscura Stealth...`);
    const result = await scrapeListing(url, opts);

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('\n================ RESULTADO DA EXTRAÇÃO ================');
      console.log(`Portal:        ${result.portal.toUpperCase()}`);
      console.log(`Título:        ${result.title}`);
      console.log(`Morada:        ${result.address || 'Não indicada'}`);
      console.log(`Kaltmiete:     ${result.coldRent ? result.coldRent + ' €' : 'por confirmar'}`);
      console.log(`Warmmiete:     ${result.warmRent ? result.warmRent + ' €' : 'por confirmar'}`);
      console.log(`Tipologia:     ${result.rooms ? result.rooms + ' Zimmer' : 'por confirmar'} (${result.livingArea ? result.livingArea + ' m²' : 'área n/d'})`);
      console.log(`Cozinha:       ${result.kitchen}`);
      console.log(`Mobília:       ${result.furnished}`);
      console.log(`Data Entrada:  ${result.moveInDate || 'por confirmar'}`);
      console.log(`Fotos:         ${result.photos.length} encontrada(s)`);
      if (result.photos.length) console.log(`               ${result.photos.join('\n               ')}`);
      if (result.transit?.ok) {
        console.log(`\nPercurso MVV:  ${result.transit.summary}`);
        console.log(`Cumpre tempo:  ${result.transit.meetsCriteria ? 'SIM (≤60m TUM, ≤45m Marienplatz) ✅' : 'NÃO (excede limites) ❌'}`);
      }
      if (result.gemini) {
        console.log('\nAvaliação IA (Gemini):', JSON.stringify(result.gemini, null, 2));
      }
      if (result.telegram) {
        console.log('\nDisparo Telegram:', result.telegram.sent ? 'Enviado com sucesso! ✅' : `Falha: ${result.telegram.reason}`);
      }
      console.log('=======================================================\n');
    }
  } catch (err) {
    console.error('Erro durante a extração:', err.message);
    process.exit(1);
  }
}
