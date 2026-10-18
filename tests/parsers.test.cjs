const assert = require('node:assert/strict');
const { scoutPageText, immoweltPageText } = require('../extractor/parsers.cjs');

const is24Html = `<!DOCTYPE html><html><body>
<h1>Helle 3-Zimmer-Wohnung in Schwabing</h1>
<span class="zip-region-and-country">Leopoldstraße 50, 80802 München</span>
<div data-is24-qa="attributes">
  <dl>
    <dt>Kaltmiete</dt><dd class="is24-qa-kaltmiete">1.800 €</dd>
    <dt>Nebenkosten</dt><dd>250 €</dd>
    <dt>Gesamtmiete</dt><dd class="is24-qa-gesamtmiete">2.050 €</dd>
    <dt>Zimmer</dt><dd class="is24-qa-zimmer">3</dd>
  </dl>
</div>
<div class="is24-qa-ausstattung">Einbauküche vorhanden, Balkon, Aufzug.</div>
<pre class="is24-qa-objektbeschreibung">Schöne Wohnung ab 01.01.2027 verfügbar.</pre>
</body></html>`;

const is24Text = scoutPageText(is24Html);
console.log('--- IS24 Text ---');
console.log(is24Text);
assert.ok(is24Text.includes('Helle 3-Zimmer-Wohnung in Schwabing'));
assert.ok(is24Text.includes('Leopoldstraße 50, 80802 München'));
assert.ok(is24Text.includes('2.050 €'));
assert.ok(is24Text.includes('Einbauküche'));

const iwHtml = `<!DOCTYPE html><html><body>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "estate": {
        "title": "Traumhafte 2-Zimmer-Wohnung",
        "city": "München",
        "street": "Schleißheimer Str. 10",
        "zipCode": "80333",
        "prices": { "kaltmiete": "1200 €", "warmmiete": "1450 €" },
        "hardFacts": [
          { "label": "Zimmer", "value": "2" },
          { "label": "Wohnfläche", "value": "60 m²" }
        ],
        "equipments": ["Einbauküche", "Balkon"],
        "texts": { "description": "Ruhige Lage im Zentrum." }
      }
    }
  }
}
</script>
</body></html>`;

const iwText = immoweltPageText(iwHtml);
console.log('--- Immowelt Text ---');
console.log(iwText);
assert.ok(iwText.includes('Traumhafte 2-Zimmer-Wohnung'));
assert.ok(iwText.includes('Schleißheimer Str. 10'));
assert.ok(iwText.includes('warmmiete: 1450 €'));
assert.ok(iwText.includes('Einbauküche'));

console.log('ALL PARSER TESTS PASSED!');
