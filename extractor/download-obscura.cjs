const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

async function downloadObscura() {
  const binDir = path.join(__dirname, '../bin');
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const obscuraExe = path.join(binDir, 'obscura.exe');
  if (fs.existsSync(obscuraExe)) {
    console.log('Obscura já se encontra instalado em:', obscuraExe);
    try {
      const ver = execSync(`"${obscuraExe}" --version`, { encoding: 'utf8' }).trim();
      console.log('Versão:', ver);
      return obscuraExe;
    } catch (_) {}
  }

  console.log('A obter a versão mais recente do Obscura no GitHub...');
  const res = await fetch('https://api.github.com/repos/h4ckf0r0day/obscura/releases/latest', {
    headers: { 'User-Agent': 'RentMunich/1.0' }
  });
  if (!res.ok) throw new Error(`Falha ao contactar GitHub releases: ${res.status}`);
  const release = await res.json();
  const asset = (release.assets || []).find(a => a.name === 'obscura-x86_64-windows-stealth.zip') ||
    (release.assets || []).find(a => a.name === 'obscura-x86_64-windows.zip');

  if (!asset) throw new Error('Não foi encontrado ficheiro binário do Obscura para Windows.');

  console.log(`A descarregar ${asset.name} (${(asset.size / (1024 * 1024)).toFixed(1)} MB)...`);
  const zipPath = path.join(binDir, asset.name);
  const dlRes = await fetch(asset.browser_download_url, {
    headers: { 'User-Agent': 'RentMunich/1.0' }
  });
  if (!dlRes.ok) throw new Error(`Falha no download: ${dlRes.status}`);

  const buffer = Buffer.from(await dlRes.arrayBuffer());
  fs.writeFileSync(zipPath, buffer);
  console.log('Download concluído. A extrair ficheiros...');

  // Use tar.exe or Expand-Archive to extract
  try {
    execSync(`tar -xf "${zipPath}" -C "${binDir}"`, { stdio: 'inherit' });
  } catch (_) {
    execSync(`powershell -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${binDir}'"`, { stdio: 'inherit' });
  }

  // Check if obscura.exe is in a subfolder or root
  let found = null;
  function search(dir) {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) search(full);
      else if (f.toLowerCase() === 'obscura.exe') found = full;
    }
  }
  search(binDir);

  if (found && found !== obscuraExe) {
    fs.copyFileSync(found, obscuraExe);
  }

  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  if (!fs.existsSync(obscuraExe)) throw new Error('obscura.exe não foi encontrado após extração.');

  console.log('Obscura pronto em:', obscuraExe);
  try {
    const ver = execSync(`"${obscuraExe}" --version`, { encoding: 'utf8' }).trim();
    console.log('Versão confirmada:', ver);
  } catch (_) {}
  return obscuraExe;
}

if (require.main === module) {
  downloadObscura().catch(err => {
    console.error('Erro ao descarregar Obscura:', err);
    process.exit(1);
  });
}

module.exports = { downloadObscura };
