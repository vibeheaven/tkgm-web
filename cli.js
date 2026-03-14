#!/usr/bin/env node
/**
 * TKGM Video Üretim CLI - Tarayıcı olmadan terminalden video üretir
 * Kullanım: node cli.js --kml 4.kml [--type all] [--duration 12] [--port 3010]
 *
 * Sunucu çalışıyor olmalı: npm run dev
 */

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { kml: null, type: 'all', duration: 12, port: 3010, pitch: -20 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--kml' && args[i + 1]) opts.kml = args[++i];
    else if (args[i] === '--type' && args[i + 1]) opts.type = args[++i];
    else if (args[i] === '--duration' && args[i + 1]) opts.duration = args[++i];
    else if (args[i] === '--port' && args[i + 1]) opts.port = parseInt(args[++i], 10);
    else if (args[i] === '--pitch' && args[i + 1]) opts.pitch = parseFloat(args[++i]);
  }
  return opts;
}

async function postDrawKml(port, kmlPath, formFields) {
  const formData = new FormData();
  const fileBuffer = fs.readFileSync(kmlPath);
  const blob = new Blob([fileBuffer], { type: 'application/vnd.google-earth.kml+xml' });
  formData.append('kml_file', blob, path.basename(kmlPath));
  for (const [k, v] of Object.entries(formFields)) {
    formData.append(k, String(v));
  }

  const res = await fetch(`http://127.0.0.1:${port}/api/draw-kml`, { method: 'POST', body: formData });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

async function main() {
  const { kml, type, duration, port, pitch } = parseArgs();
  if (!kml) {
    console.error('Kullanım: node cli.js --kml <dosya.kml> [--type all|orbit|zoomA|zoomB|zoomC|photo] [--duration 12] [--pitch -20] [--port 3010]');
    process.exit(1);
  }
  if (!fs.existsSync(kml)) {
    console.error('KML dosyası bulunamadı:', kml);
    process.exit(1);
  }

  console.log('[CLI] Video üretimi başlatılıyor (headless)...');
  console.log('  KML:', kml, '| type:', type, '| duration:', duration, 'sn | pitch:', pitch, '°');
  const start = Date.now();

  try {
    const result = await postDrawKml(port, kml, {
      type,
      duration: String(duration),
      pitch: String(pitch),
      save: 'true',
      os: 'linux'
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log('[CLI] Tamamlandı (' + elapsed + ' sn)');
    console.log('  job_id:', result.job_id);
    if (result.path) console.log('  video:', result.path);
    if (result.filename) console.log('  dosya:', result.filename);
  } catch (err) {
    console.error('[CLI] Hata:', err.message);
    process.exit(1);
  }
}

main();
