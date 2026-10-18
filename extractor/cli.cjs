#!/usr/bin/env node
const { handleExtract, getTransitTimes, detectPortal } = require('./server.cjs');

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    console.log('Uso:');
    console.log('  node extractor/cli.cjs <URL do anúncio>');
    console.log('  node extractor/cli.cjs --transit "<morada ou estação em Munique>"');
    console.log('\nExemplos:');
    console.log('  node extractor/cli.cjs https://www.immobilienscout24.de/expose/14232753');
    console.log('  node extractor/cli.cjs https://www.immowelt.de/expose/2c3d4e');
    console.log('  node extractor/cli.cjs --transit "Leopoldstraße 50, München"');
    process.exit(0);
  }

  if (args[0] === '--transit' || args[0] === '-t') {
    const loc = args.slice(1).join(' ');
    console.log('A calcular percurso MVV para:', loc);
    const res = await getTransitTimes(loc);
    console.log(JSON.stringify(res, null, 2));
    if (res.ok) {
      console.log(`\nResultado:`);
      console.log(`  Localização: ${res.resolvedName}`);
      console.log(`  TUM Garching: ${res.tum.minutes} min ${res.tum.usesU6 ? '(U6)' : ''} [${res.tum.ok ? 'OK ≤60m' : 'EXCEDE >60m'}]`);
      console.log(`  Marienplatz:  ${res.marien.minutes} min ${res.marien.usesU6 ? '(U6)' : ''} [${res.marien.ok ? 'OK ≤45m' : 'EXCEDE >45m'}]`);
      console.log(`  Requisitos:   ${res.meetsCriteria ? 'CUMPRE CRITÉRIOS' : 'REJEITADO'}`);
    }
    return;
  }

  const url = args[0];
  const portal = detectPortal(url);
  if (!portal) {
    console.error('URL não reconhecido como ImmoScout24, Immowelt ou WG-Gesucht.');
    process.exit(1);
  }

  console.log(`A extrair anúncio (${portal}) com Obscura Stealth...`);
  console.log(`URL: ${url}`);
  const result = await handleExtract(url);

  console.log('\n--- Resultado ---');
  console.log(`Status: ${result.status}`);
  if (result.error) console.log(`Erro: ${result.error}`);
  if (result.text) {
    console.log('\n--- Texto extraído (primeiros 1000 caracteres) ---');
    console.log(result.text.slice(0, 1000));
    console.log(`\n[Total: ${result.text.length} caracteres extraídos]`);
  }
}

main().catch(err => {
  console.error('Erro na execução:', err);
  process.exit(1);
});
