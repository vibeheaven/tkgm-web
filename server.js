const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);

// Google Drive - Service Account gerekli (API key yeterli değil)
const GOOGLE_CREDENTIALS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'google-credentials.json');
const GOOGLE_DRIVE_ROOT = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '1okL8SQ9ZYLc76m6AaEL6hXJQRTIvvyD6';

async function uploadToDrive(jobId, filePath, filename) {
  if (!fs.existsSync(GOOGLE_CREDENTIALS_PATH)) {
    console.warn('[Drive] Credentials bulunamadı:', GOOGLE_CREDENTIALS_PATH);
    return { success: false, error: 'Google credentials yok' };
  }
  if (!GOOGLE_DRIVE_ROOT) {
    console.warn('[Drive] GOOGLE_DRIVE_ROOT_FOLDER_ID gerekli. Drive\'da klasör oluşturup Service Account ile paylaş, klasör ID\'sini env\'e ekle.');
    return { success: false, error: 'GOOGLE_DRIVE_ROOT_FOLDER_ID gerekli' };
  }
  try {
    const { google } = require('googleapis');
    const auth = new google.auth.GoogleAuth({
      keyFile: GOOGLE_CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/drive']
    });
    const drive = google.drive({ version: 'v3', auth });

    const driveOpts = { supportsAllDrives: true };
    const parents = [GOOGLE_DRIVE_ROOT];
    const mimeType = filename.endsWith('.mp4') ? 'video/mp4' : filename.endsWith('.png') ? 'image/png' : 'application/octet-stream';

    const fileRes = await drive.files.create({
      resource: {
        name: jobId + '_' + filename,
        parents
      },
      media: {
        mimeType,
        body: fs.createReadStream(filePath)
      },
      fields: 'id,webViewLink,webContentLink',
      ...driveOpts
    });
    return { success: true, driveUrl: fileRes.data.webContentLink || fileRes.data.webViewLink };
  } catch (err) {
    console.error('[Drive] Yükleme hatası:', err.message);
    return { success: false, error: err.message };
  }
}

function deleteFilePermanently(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('[Drive] Sunucudan silindi:', filePath);
    }
  } catch (e) {
    console.error('[Drive] Silme hatası:', e.message);
  }
}

const VALID_CAMERA_TYPES = ['orbit', 'zooma', 'zoomb', 'zoomc', 'all', 'photo'];

const JOBS_DIR = path.join(__dirname, 'jobs');
const RECORDINGS_DIR = path.join(__dirname, 'recordings');
const jobs = new Map();

// İş kuyruğu: sıralı işlem, biri bitmeden diğerine geçilmez
// { jobId, res?, payload } - res varsa headless
const jobQueue = [];
const AVG_JOB_SECONDS = 60; // Tahmini işlem süresi (sn) - video/photo ortalaması

function getQueueInfo(jobId) {
  const idx = jobQueue.findIndex((q) => q.jobId === jobId);
  if (idx < 0) return null;
  const position = idx + 1;
  const queueLength = jobQueue.length;
  const estimatedStartSeconds = idx * AVG_JOB_SECONDS;
  return {
    queue_position: position,
    queue_length: queueLength,
    current_position: position,
    estimated_start_seconds: estimatedStartSeconds
  };
}

function addToQueue(jobId, payload, res) {
  const isHeadless = !!res;
  jobQueue.push({ jobId, res, payload });
  if (jobQueue.length === 1) {
    if (isHeadless) processNextHeadless();
    else io.emit('drawPolygon', payload);
  }
}

function removeFromQueueAndActivateNext(jobId) {
  const idx = jobQueue.findIndex((q) => q.jobId === jobId);
  if (idx < 0) return;
  jobQueue.splice(idx, 1);
  if (jobQueue.length > 0) {
    const next = jobQueue[0];
    if (next.res) processNextHeadless();
    else io.emit('drawPolygon', next.payload);
  }
}

async function processNextHeadless() {
  if (jobQueue.length === 0) return;
  const next = jobQueue[0];
  if (!next.res) return;
  const { jobId, res } = next;
  try {
    await runHeadlessJob(jobId, res);
  } finally {
    removeFromQueueAndActivateNext(jobId);
  }
}

const WORKER_COUNT = 4;

async function processJob(jobId, expectedFrames) {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'frames_received') return;

  job.status = 'processing';
  const framesDir = path.join(JOBS_DIR, jobId);
  const mp4Name = jobId + '.mp4';
  const mp4Path = path.join(RECORDINGS_DIR, mp4Name);

  const frameFiles = fs.readdirSync(framesDir).filter(f => /^frame_\d{4}\.(jpg|png)$/.test(f));
  const totalFrames = frameFiles.length;
  if (expectedFrames && totalFrames !== expectedFrames) {
    console.warn(`[processJob] ${jobId}: Beklenen ${expectedFrames} frame, alınan ${totalFrames} frame`);
  }
  if (totalFrames === 0) {
    job.status = 'failed';
    job.error = 'Frame bulunamadı';
    removeFromQueueAndActivateNext(jobId);
    return;
  }

  // photo: tek frame -> PNG olarak kaydet, webhook varsa sadece raw PNG gönder (path/parametre yok)
  const isPhoto = job.type === 'photo' || (job.payload && job.payload.type === 'photo');
  if (isPhoto && totalFrames >= 1) {
    const firstFrame = path.join(framesDir, frameFiles.sort()[0]);
    const pngBuffer = fs.readFileSync(firstFrame);
    const pngName = jobId + '.png';
    const pngPath = path.join(RECORDINGS_DIR, pngName);
    fs.writeFileSync(pngPath, pngBuffer);
    fs.rmSync(framesDir, { recursive: true });
    job.status = 'completed';
    job.path = pngPath;
    job.filename = pngName;
    if (job.webhook) {
      fetch(job.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: pngBuffer
      }).catch(e => console.error('Webhook hatası:', e));
    }
    console.log(`Job ${jobId} tamamlandı (photo): ${pngPath}${job.webhook ? ' → webhook\'a PNG gönderildi' : ''}`);
    removeFromQueueAndActivateNext(jobId);
    uploadToDrive(jobId, pngPath, pngName).then((r) => {
      if (r.success) {
        if (r.driveUrl) job.drive_url = r.driveUrl;
        deleteFilePermanently(pngPath);
        job.path = null;
      }
    });
    return;
  }

  const framesPerWorker = Math.ceil(totalFrames / WORKER_COUNT);
  const segmentPaths = [...Array(WORKER_COUNT)].map((_, i) => path.join(framesDir, `seg_${i}.mp4`));

  const encodeSegment = (workerIndex) =>
    new Promise((resolve, reject) => {
      const startFrame = workerIndex * framesPerWorker + 1;
      const endFrame = Math.min((workerIndex + 1) * framesPerWorker, totalFrames);
      const frameCount = endFrame - startFrame + 1;
      if (frameCount <= 0) return resolve();

      const segPath = segmentPaths[workerIndex];

      ffmpeg()
        .input(path.join(framesDir, 'frame_%04d.jpg'))
        .inputOptions(['-start_number', String(startFrame), '-framerate', '30'])
        .outputOptions([
          '-vframes', String(frameCount),
          '-c:v', 'libx264',
          '-profile:v', 'main',
          '-level', '4.0',
          '-crf', '18',
          '-preset', 'veryfast',
          '-pix_fmt', 'yuv420p',
          '-g', '30',
          '-movflags', '+faststart'
        ])
        .output(segPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

  try {
    await Promise.all([...Array(WORKER_COUNT)].map((_, i) => encodeSegment(i)));

    const concatListPath = path.join(framesDir, 'concat.txt');
    fs.writeFileSync(
      concatListPath,
      segmentPaths.filter(p => fs.existsSync(p)).map(p => `file '${path.basename(p)}'`).join('\n')
    );

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
        .output(mp4Path)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    fs.rmSync(framesDir, { recursive: true });
    job.status = 'completed';
    job.path = mp4Path;
    job.filename = mp4Name;
    if (job.webhook) {
      fetch(job.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, status: 'completed', path: mp4Path, filename: mp4Name })
      }).catch(e => console.error('Webhook hatası:', e));
    }
    console.log(`Job ${jobId} tamamlandı: ${mp4Path}`);
    removeFromQueueAndActivateNext(jobId);
    uploadToDrive(jobId, mp4Path, mp4Name).then((r) => {
      if (r.success) {
        if (r.driveUrl) job.drive_url = r.driveUrl;
        deleteFilePermanently(mp4Path);
        job.path = null;
      }
    });
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true });
    if (job.webhook) {
      fetch(job.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, status: 'failed', error: err.message })
      }).catch(e => console.error('Webhook hatası:', e));
    }
    console.error(`Job ${jobId} hata:`, err);
    removeFromQueueAndActivateNext(jobId);
  }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3010;

async function runHeadlessJob(jobId, res) {
  const job = jobs.get(jobId);
  if (!job || !job.payload) {
    return res.status(500).json({ error: 'Job veya payload bulunamadı' });
  }
  let browser;
  try {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920 });
    const baseUrl = `http://127.0.0.1:${PORT}`;
    await page.goto(`${baseUrl}/?jobId=${jobId}`, { waitUntil: 'load', timeout: 90000 });
    const pollInterval = 2000;
    const maxWait = 10 * 60 * 1000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const j = jobs.get(jobId);
      if (!j) break;
      if (j.status === 'completed') {
        await browser.close();
        return res.json({
          success: true,
          job_id: jobId,
          status: 'completed',
          path: j.path,
          filename: j.filename
        });
      }
      if (j.status === 'failed') {
        await browser.close();
        return res.status(500).json({ error: j.error || 'Job başarısız' });
      }
      await new Promise(r => setTimeout(r, pollInterval));
    }
    await browser.close();
    res.status(504).json({ error: 'Video üretimi zaman aşımına uğradı' });
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error('[headless]', err);
    res.status(500).json({ error: err.message || 'Headless işlem hatası' });
  }
}

// Multer - KML dosyası yükleme (memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.kml' || file.mimetype === 'application/vnd.google-earth.kml+xml') {
      cb(null, true);
    } else {
      cb(new Error('Sadece .kml dosyaları kabul edilir'));
    }
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ana sayfa
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// KML'den polygon koordinatlarını parse et
function parseKmlCoordinates(kmlContent) {
  const polygons = [];
  const coordRegex = /<coordinates>([\s\S]*?)<\/coordinates>/gi;
  let match;

  while ((match = coordRegex.exec(kmlContent)) !== null) {
    const coordStr = match[1].trim();
    const points = [];

    coordStr.split(/\s+/).forEach(part => {
      const trimmed = part.trim();
      if (!trimmed) return;

      const [lon, lat] = trimmed.split(',').map(Number);
      if (!isNaN(lon) && !isNaN(lat)) {
        points.push({ longitude: lon, latitude: lat });
      }
    });

    if (points.length >= 3) {
      polygons.push(points);
    }
  }

  return polygons;
}

// KML'den name değerini parse et (Document veya Placemark)
function parseKmlName(kmlContent) {
  const docMatch = kmlContent.match(/<Document>[\s\S]*?<name>([^<]+)<\/name>/i);
  if (docMatch) return docMatch[1].trim();
  const placeMatch = kmlContent.match(/<Placemark>[\s\S]*?<name>([^<]+)<\/name>/i);
  if (placeMatch) return placeMatch[1].trim();
  const nameMatch = kmlContent.match(/<name>([^<]+)<\/name>/i);
  return nameMatch ? nameMatch[1].trim() : '';
}

// POST /api/draw-kml
// Form fields: kml_file (file), border_color (#2779F5), marker_height (6)
app.post('/api/draw-kml', upload.single('kml_file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'kml_file gerekli' });
    }

    const kmlContent = req.file.buffer.toString('utf-8');
    const polygons = parseKmlCoordinates(kmlContent);

    if (polygons.length === 0) {
      return res.status(400).json({ error: 'KML dosyasında geçerli polygon bulunamadı' });
    }

    const borderColor = req.body.border_color || '#2779F5';
    const markerHeight = parseInt(req.body.marker_height, 10) || 6;
    const cameraType = (req.body.type || req.body.camera_type || 'orbit').toLowerCase();
    if (!VALID_CAMERA_TYPES.includes(cameraType)) {
      return res.status(400).json({
        error: `Geçersiz type. Kabul edilen: ${VALID_CAMERA_TYPES.join(', ')}`
      });
    }
    const durationRaw = req.body.duration ?? req.query.duration;
    const duration = Math.max(6, Math.min(60, parseInt(String(durationRaw), 10) || 12));
    const alignmentDelay = Math.max(0, Math.min(60, parseInt(req.body.alignment_delay, 10) || 10));
    const pitchDeg = parseFloat(req.body.pitch ?? req.query.pitch ?? -20);
    const pitch = Math.max(-90, Math.min(0, isNaN(pitchDeg) ? -20 : pitchDeg));
    const tourEnabled = req.body.tour === 'true' || req.body.tour === true;
    const autoplay = req.body.autoplay === 'true' || req.body.autoplay === true;
    const saveVideo = req.body.save === 'true' || req.body.save === true;
    const webhook = req.body.webhook || null;
    const parcelName = parseKmlName(kmlContent);

    let jobId = null;
    const osLinux = (req.body.os || '').toLowerCase() === 'linux';
    let jobDir;
    if (saveVideo) {
      jobId = randomUUID();
      jobDir = path.join(JOBS_DIR, jobId);
      fs.mkdirSync(jobDir, { recursive: true });
      jobs.set(jobId, { webhook, status: 'pending', parcel_name: parcelName, framesPath: jobDir, payload: null, type: cameraType });
    }

    let size = null;
    const sizeParam = req.body.size || req.body.render_size;
    if (sizeParam && typeof sizeParam === 'string') {
      const match = sizeParam.match(/^(\d+)[xX×](\d+)$/);
      if (match) {
        size = { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
      }
    }
    if (saveVideo) {
      size = { width: 1080, height: 1920 };
    }

    const payload = {
      polygons,
      parcel_name: parcelName,
      border_color: borderColor,
      marker_height: markerHeight,
      type: cameraType,
      duration,
      alignment_delay: alignmentDelay,
      pitch,
      tour: saveVideo ? true : tourEnabled,
      autoplay: saveVideo ? true : autoplay,
      size: size,
      save: saveVideo,
      job_id: jobId
    };

    if (saveVideo) {
      const job = jobs.get(jobId);
      if (job) job.payload = payload;
      addToQueue(jobId, payload, osLinux ? res : null);
    }

    if (osLinux && saveVideo) {
      return;
    }

    if (saveVideo) {
      console.log('[draw-kml] job_id:', jobId, 'type:', cameraType, 'duration:', duration, 'sn');
    } else {
      io.emit('drawPolygon', payload);
    }

    const queueInfo = saveVideo ? getQueueInfo(jobId) : null;
    res.json({
      success: true,
      message: `${polygons.length} polygon haritaya çizildi`,
      polygons_count: polygons.length,
      job_id: jobId,
      ...(queueInfo && {
        queue_position: queueInfo.queue_position,
        queue_length: queueInfo.queue_length,
        current_position: queueInfo.current_position,
        estimated_start_seconds: queueInfo.estimated_start_seconds
      })
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'KML işlenirken hata oluştu' });
  }
});

if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR, { recursive: true });

const framesUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.post('/api/job/:jobId/frames', framesUpload.array('frames', 50), (req, res) => {
  try {
    const { jobId } = req.params;
    const job = jobs.get(jobId);
    if (!job || !req.files || !req.files.length) {
      return res.status(400).json({ error: 'Geçersiz job veya frame' });
    }
    const jobDir = path.join(JOBS_DIR, jobId);
    req.files.forEach((f, i) => {
      const idx = parseInt(req.body.offset || 0) + i;
      const ext = path.extname(f.originalname) || '.jpg';
      fs.writeFileSync(path.join(jobDir, `frame_${String(idx + 1).padStart(4, '0')}${ext}`), f.buffer);
    });
    res.json({ success: true, received: req.files.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/job/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job bulunamadı' });
  const queueInfo = getQueueInfo(req.params.jobId);
  res.json({
    job_id: req.params.jobId,
    status: job.status,
    path: job.path,
    filename: job.filename,
    drive_url: job.drive_url || null,
    error: job.error,
    ...(queueInfo && {
      queue_position: queueInfo.queue_position,
      queue_length: queueInfo.queue_length,
      current_position: queueInfo.current_position,
      estimated_start_seconds: queueInfo.estimated_start_seconds
    })
  });
});

app.get('/api/job/:jobId/payload', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.payload) return res.status(404).json({ error: 'Job veya payload bulunamadı' });
  res.json(job.payload);
});

// Oluşturulmuş video/fotoğrafı direkt döndür (veya Drive'a yönlendir)
app.get('/api/job/:jobId/video', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job bulunamadı' });
  if (job.status !== 'completed') {
    return res.status(400).json({ error: 'Video henüz hazır değil', status: job.status });
  }
  if (job.drive_url) return res.redirect(302, job.drive_url);
  if (!job.path || !fs.existsSync(job.path)) {
    return res.status(404).json({ error: 'Dosya bulunamadı (Drive\'a yüklenmiş olabilir)' });
  }
  const ext = path.extname(job.filename).toLowerCase();
  const mime = ext === '.mp4' ? 'video/mp4' : ext === '.png' ? 'image/png' : 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', 'inline; filename="' + job.filename + '"');
  res.setHeader('Accept-Ranges', 'bytes');
  res.sendFile(job.path);
});

app.post('/api/job/:jobId/complete', (req, res) => {
  try {
    const { jobId } = req.params;
    const job = jobs.get(jobId);
    if (!job) return res.status(404).json({ error: 'Job bulunamadı' });
    const expectedFrames = req.body && req.body.expected_frames;
    job.status = 'frames_received';
    res.json({ success: true });
    processJob(jobId, expectedFrames);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

io.on('connection', (socket) => {
  console.log('Harita tarayıcıda açıldı.');
});

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  TKGM Harita Arayüzü - CesiumJS                          ║
╠══════════════════════════════════════════════════════════╣
║  Tarayıcıda aç: http://localhost:${PORT}                    ║
║                                                          ║
║  KML yükle: POST /api/draw-kml                           ║
║  Video al:  GET /api/job/:jobId/video                    ║
║  - kml_file: .kml dosyası                                ║
║  - type: orbit|zoomA|zoomB|zoomC|all|photo                ║
║  - os=linux: headless (tarayıcısız) video üretimi       ║
║  - duration: 12 (saniye, 6-60)                           ║
║  - alignment_delay: 10 (kayıt öncesi bekleme, sn)        ║
║  - pitch: -20 (kamera açısı, derece, -90 ile 0 arası)     ║
║  - border_color: #2779F5 (varsayılan)                    ║
║  - marker_height: 6 (çizgi kalınlığı)                   ║
╚══════════════════════════════════════════════════════════╝
`);
});
