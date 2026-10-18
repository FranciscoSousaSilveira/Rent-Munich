// Sanitizers and parsers for ImmoScout24, Immowelt and WG-Gesucht HTML
const entities = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', sup2: '²',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß'
};

function decodeHtml(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, key) => {
    if (key[0] !== '#') return Object.prototype.hasOwnProperty.call(entities, key) ? entities[key] : all;
    const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
}

function stripTags(html) {
  return decodeHtml(
    String(html || '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function scoutPageText(html) {
  if (!html) return '';
  const lines = [];

  // 1. Try to extract from JSON-LD or IS24 state if present
  const jsonLdMatch = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      const data = JSON.parse(jsonLdMatch[1]);
      if (data && (data.name || data.description || data.offers)) {
        if (data.name) lines.push('Título: ' + data.name);
        if (data.address) {
          const addr = typeof data.address === 'object'
            ? [data.address.streetAddress, data.address.postalCode, data.address.addressLocality].filter(Boolean).join(', ')
            : data.address;
          lines.push('Endereço: ' + addr);
        }
        if (data.offers && data.offers.price) {
          lines.push('Preço anunciado: ' + data.offers.price + ' ' + (data.offers.priceCurrency || '€'));
        }
        if (data.description) lines.push('Descrição: ' + data.description);
      }
    } catch (_) {}
  }

  // 2. Extract DOM sections: Title, Key facts, Criteria, Descriptions
  const titleMatch = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (titleMatch && !lines.some(l => l.startsWith('Título:'))) {
    const t = stripTags(titleMatch[1]);
    if (t) lines.push('Título: ' + t);
  }

  // Address
  const addrMatch = html.match(/(?:<span\b[^>]*class=["'][^"']*zip-region-and-country[^"']*["'][^>]*>|<div\b[^>]*class=["'][^"']*address-group[^"']*["'][^>]*>)([\s\S]*?)<\/(?:span|div)>/i);
  if (addrMatch && !lines.some(l => l.startsWith('Endereço:'))) {
    const a = stripTags(addrMatch[1]);
    if (a) lines.push('Endereço: ' + a);
  }

  // Attributes / Key facts (prices, rooms, area, etc.)
  const attrBlockMatch = html.match(/<div\b[^>]*data-is24-qa=["']attributes["'][^>]*>([\s\S]*?)<\/div>/i) ||
    html.match(/<div\b[^>]*class=["'][^"']*criteriagroup[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
    html.match(/<div\b[^>]*class=["'][^"']*is24-key-facts[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (attrBlockMatch) {
    lines.push('Características principais: ' + stripTags(attrBlockMatch[1]));
  }

  // Common price classes / QA attributes
  const priceMatches = html.match(/<(?:div|span|dd)\b[^>]*class=["'][^"']*(?:is24-qa-(?:kaltmiete|warmmiete|gesamtmiete|nebenkosten)|is24-value)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|dd)>/gi);
  if (priceMatches) {
    const prices = priceMatches.map(m => stripTags(m)).filter(Boolean);
    if (prices.length) lines.push('Valores: ' + prices.join(' | '));
  }

  // Description / Ausstattung
  const descMatch = html.match(/<(?:div|pre)\b[^>]*class=["'][^"']*(?:is24-qa-objektbeschreibung|is24-qa-ausstattung|is24-text)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|pre)>/gi);
  if (descMatch) {
    for (const d of descMatch) {
      const txt = stripTags(d);
      if (txt && txt.length > 10) lines.push('Detalhes: ' + txt);
    }
  }

  // If specific blocks didn't catch enough, extract core body text
  if (lines.length < 2) {
    const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ||
      html.match(/<div\b[^>]*id=["']is24-content["'][^>]*>([\s\S]*?)<\/div>/i);
    const fallbackText = stripTags(mainMatch ? mainMatch[1] : html);
    if (fallbackText.length > 50) lines.push(fallbackText.slice(0, 8000));
  }

  const result = lines.join('\n');
  return /Kaltmiete|Warmmiete|Gesamtmiete|Miete|Zimmer|Wohnung/i.test(result) ? result.slice(0, 24000) : '';
}

function immoweltPageText(html) {
  if (!html) return '';
  const lines = [];

  // 1. Try __NEXT_DATA__
  const nextDataMatch = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const pageProps = nextData.props && nextData.props.pageProps;
      const estate = (pageProps && (pageProps.estate || pageProps.exposeData || pageProps.data)) || pageProps;
      if (estate) {
        if (estate.title) lines.push('Título: ' + estate.title);
        if (estate.place || estate.city || estate.zipCode || estate.address) {
          const addr = typeof estate.address === 'object'
            ? [estate.address.street, estate.address.zipCode, estate.address.city, estate.address.district].filter(Boolean).join(', ')
            : [estate.street, estate.zipCode, estate.city, estate.district].filter(Boolean).join(', ');
          if (addr) lines.push('Endereço: ' + addr);
        }
        if (estate.price || estate.prices) {
          const p = estate.prices || estate.price;
          if (typeof p === 'object') {
            lines.push('Preços: ' + Object.entries(p).map(([k, v]) => `${k}: ${v}`).join(', '));
          } else {
            lines.push('Preço: ' + p + ' €');
          }
        }
        if (estate.hardFacts && Array.isArray(estate.hardFacts)) {
          lines.push('Hardfacts: ' + estate.hardFacts.map(h => (h.label ? h.label + ': ' : '') + (h.value || h.text || '')).join(' | '));
        }
        if (estate.equipments && Array.isArray(estate.equipments)) {
          lines.push('Equipamento: ' + estate.equipments.map(e => e.value || e.name || e).join(', '));
        }
        if (estate.texts && typeof estate.texts === 'object') {
          for (const [k, v] of Object.entries(estate.texts)) {
            if (v) lines.push(`${k}: ${v}`);
          }
        }
      }
    } catch (_) {}
  }

  // 2. Try JSON-LD
  if (!lines.length) {
    const jsonLdMatch = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch) {
      try {
        const data = JSON.parse(jsonLdMatch[1]);
        if (data && (data.name || data.description || data.offers)) {
          if (data.name) lines.push('Título: ' + data.name);
          if (data.address) {
            const addr = typeof data.address === 'object'
              ? [data.address.streetAddress, data.address.postalCode, data.address.addressLocality].filter(Boolean).join(', ')
              : data.address;
            lines.push('Endereço: ' + addr);
          }
          if (data.offers && data.offers.price) {
            lines.push('Preço anunciado: ' + data.offers.price + ' ' + (data.offers.priceCurrency || '€'));
          }
          if (data.description) lines.push('Descrição: ' + data.description);
        }
      } catch (_) {}
    }
  }

  // 3. Fallback to DOM parsing
  if (!lines.length) {
    const titleMatch = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    if (titleMatch) lines.push('Título: ' + stripTags(titleMatch[1]));

    const hardfactsMatch = html.match(/<(?:div|ul)\b[^>]*class=["'][^"']*(?:hardfacts|key-facts)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|ul)>/i);
    if (hardfactsMatch) lines.push('Hardfacts: ' + stripTags(hardfactsMatch[1]));

    const descMatch = html.match(/<div\b[^>]*class=["'][^"']*(?:expose-content|description|section_content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (descMatch) lines.push('Descrição: ' + stripTags(descMatch[1]));
  }

  if (lines.length < 2) {
    const bodyText = stripTags(html);
    if (bodyText.length > 50) lines.push(bodyText.slice(0, 8000));
  }

  const result = lines.join('\n');
  return /Kaltmiete|Warmmiete|Gesamtmiete|Miete|Kaufpreis|Zimmer/i.test(result) ? result.slice(0, 24000) : '';
}

module.exports = {
  decodeHtml,
  stripTags,
  scoutPageText,
  immoweltPageText
};
