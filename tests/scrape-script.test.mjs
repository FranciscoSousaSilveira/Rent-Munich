import assert from 'node:assert/strict';
import { parseImmoScout, parseImmowelt, parseWgGesucht, detectPortal, TRANSIT_LIMITS } from '../scripts/scrape-munich-ad.mjs';

console.log('--- Testes de scrape-munich-ad.mjs ---');

// 1. Deteção de portais
assert.equal(detectPortal('https://www.immobilienscout24.de/expose/12345'), 'scout');
assert.equal(detectPortal('https://www.immowelt.de/expose/abc-123'), 'immowelt');
assert.equal(detectPortal('https://www.wg-gesucht.de/12345.html'), 'wg');
assert.equal(detectPortal('https://example.com'), null);
console.log('OK detectPortal');

// 2. Parser ImmoScout24 com fotos
const is24Sample = `
<html>
  <body>
    <h1>Schöne 3-Zimmer-Wohnung in Schwabing</h1>
    <span class="zip-region-and-country">Leopoldstraße 50, 80802 München</span>
    <span class="is24-qa-kaltmiete">1.800 €</span>
    <span class="is24-qa-gesamtmiete">2.100 €</span>
    <span class="is24-qa-zimmer">3</span>
    <span class="is24-qa-flaeche">78 m²</span>
    <p>Frei ab: 01.01.2027. Schöne Einbauküche (EBK) und möbliert.</p>
    <img src="https://pictures.immobilienscout24.de/orig/foto1.jpg?hasElevation=true">
    <img src="https://pictures.immobilienscout24.de/orig/foto2.jpg">
  </body>
</html>
`;

const is24Data = parseImmoScout(is24Sample);
assert.equal(is24Data.portal, 'scout');
assert.equal(is24Data.title, 'Schöne 3-Zimmer-Wohnung in Schwabing');
assert.equal(is24Data.address, 'Leopoldstraße 50, 80802 München');
assert.equal(is24Data.coldRent, 1800);
assert.equal(is24Data.warmRent, 2100);
assert.equal(is24Data.rooms, 3);
assert.equal(is24Data.kitchen, 'yes');
assert.equal(is24Data.furnished, 'yes');
assert.equal(is24Data.photos.length, 2);
assert.ok(is24Data.photos[0].includes('foto1.jpg'));
console.log('OK parseImmoScout');

// 3. Parser Immowelt com __NEXT_DATA__ e fotos
const iwSample = `
<html>
  <body>
    <script id="__NEXT_DATA__" type="application/json">
    {
      "props": {
        "pageProps": {
          "estate": {
            "title": "Helle Wohnung Maxvorstadt",
            "address": { "street": "Theresienstr. 20", "zipCode": "80333", "city": "München" },
            "prices": { "kaltmiete": "1300", "warmmiete": "1550" },
            "hardFacts": [
              { "label": "Zimmer", "value": "2" },
              { "label": "Wohnfläche", "value": "55" }
            ],
            "gallery": [
              { "url": "https://mms.immowelt.de/foto_iw1.jpg" },
              { "url": "https://mms.immowelt.de/foto_iw2.jpg" }
            ]
          }
        }
      }
    }
    </script>
    <div>Beschreibung mit Einbauküche</div>
  </body>
</html>
`;

const iwData = parseImmowelt(iwSample);
assert.equal(iwData.portal, 'immowelt');
assert.equal(iwData.title, 'Helle Wohnung Maxvorstadt');
assert.ok(iwData.address.includes('Theresienstr. 20'));
assert.equal(iwData.coldRent, 1300);
assert.equal(iwData.warmRent, 1550);
assert.equal(iwData.rooms, 2);
assert.equal(iwData.kitchen, 'yes');
assert.equal(iwData.photos.length, 2);
console.log('OK parseImmowelt');

// 4. Limites de transportes
assert.equal(TRANSIT_LIMITS.maxTumMinutes, 60);
assert.equal(TRANSIT_LIMITS.maxMarienMinutes, 45);
console.log('OK TRANSIT_LIMITS');

console.log('\nTodos os testes de scrape-munich-ad.mjs passaram com sucesso!');
