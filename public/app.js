// Cesium Ion Access Token
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI1YTIxOTdhMC04MmMwLTQ0MjUtODc3NS0yYTI5MWZiY2NmY2MiLCJpZCI6NDAwMjc4LCJpYXQiOjE3NzI5Nzc5NzZ9.uxJDEC5K4R_nyzu0OSdw71KaTeS9XjgnlDz-dudR2Nc';

const VALID_CAMERA_TYPES = ['orbit', 'zooma', 'zoomb', 'zoomc', 'all', 'photo'];

let kmlPolygonEntities = [];

(async function init() {
// CesiumJS Viewer - Realistik uydu görüntüsü (Cesium Ion) + arazi
// save modunda UI kapatılacağı için başta minimal (performans odaklı)
const viewer = new Cesium.Viewer('cesiumContainer', {
  imageryProvider: await Cesium.IonImageryProvider.fromAssetId(2),
  terrainProvider: await Cesium.createWorldTerrainAsync(),
  animation: false,
  baseLayerPicker: false,
  fullscreenButton: false,
  geocoder: false,
  homeButton: false,
  infoBox: false,
  sceneModePicker: false,
  selectionIndicator: false,
  timeline: false,
  navigationHelpButton: false,
  useDefaultRenderLoop: true,
  requestRenderMode: false,
});

// Photorealistic 3D Tiles (Google - binalar, detaylı görünüm)
try {
  const tileset = await Cesium.createGooglePhotorealistic3DTileset();
  viewer.scene.primitives.add(tileset);
} catch (e) {
  console.warn('[TKGM] Photorealistic 3D Tiles yüklenemedi:', e.message);
}

// Varsayılan Türkiye görünümü
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(32.8597, 39.9334, 500000),
  orientation: {
    heading: 0,
    pitch: Cesium.Math.toRadians(-90),
    roll: 0
  }
});

// Dikey (yukarıdan) kamera açısı
viewer.scene.screenSpaceCameraController.minimumZoomDistance = 100;
viewer.scene.screenSpaceCameraController.maximumZoomDistance = 40000000;

const FPS = 30;
const BATCH_SIZE = 30;

async function captureFrames(viewer, duration = 12) {
  const canvas = viewer.scene.canvas;
  const totalSeconds = Number(duration) || 12;
  const TOTAL_FRAMES = totalSeconds <= 1 ? 1 : Math.floor(FPS * Math.max(6, Math.min(60, totalSeconds)));
  const INTERVAL_MS = 1000 / FPS;

  const wasRenderMode = viewer.scene.requestRenderMode;
  const wasDefaultLoop = viewer.useDefaultRenderLoop;
  viewer.scene.requestRenderMode = true;
  viewer.useDefaultRenderLoop = false;

  const usePng = totalSeconds <= 1;
  const captureFrame = () =>
    new Promise((resolve) => {
      viewer.scene.requestRender();
      viewer.render();
      requestAnimationFrame(() => {
        canvas.toBlob((blob) => resolve(blob), usePng ? 'image/png' : 'image/jpeg', usePng ? undefined : 0.98);
      });
    });

  const frames = [];
  const startTime = performance.now();
  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const blob = await captureFrame();
    frames.push(blob);
    const elapsed = performance.now() - startTime;
    const targetNext = (i + 1) * INTERVAL_MS;
    const wait = Math.max(0, targetNext - elapsed);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  viewer.scene.requestRenderMode = wasRenderMode;
  viewer.useDefaultRenderLoop = wasDefaultLoop;
  return frames;
}

async function uploadFrames(jobId, frames) {
  const ext = frames[0]?.type === 'image/png' ? 'png' : 'jpg';
  for (let offset = 0; offset < frames.length; offset += BATCH_SIZE) {
    const formData = new FormData();
    formData.append('offset', offset);
    frames.slice(offset, offset + BATCH_SIZE).forEach((blob, i) => {
      formData.append('frames', blob, `frame_${offset + i + 1}.${ext}`);
    });
    const r = await fetch(`/api/job/${jobId}/frames`, { method: 'POST', body: formData });
    if (!r.ok) throw new Error('Frame yükleme hatası: ' + r.status);
  }
  const r = await fetch(`/api/job/${jobId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_frames: frames.length })
  });
  if (!r.ok) throw new Error('Complete hatası: ' + r.status);
}

async function captureFramesAndUpload(viewer, jobId, duration = 12) {
  console.log('[capture] duration:', duration, 'sn');
  const frames = await captureFrames(viewer, duration);
  await uploadFrames(jobId, frames);
  const hint = document.getElementById('captureHint');
  if (hint) hint.textContent = `${frames.length} frame gönderildi. Sunucuda video üretiliyor...`;
}

const TRANSITION_DELAY_MS = 1000; // Zoom servisleri arası kısa geçiş (donma önleme)

async function runAllSequential(viewer, opts) {
  const { center, polygonPositions, terrainProvider, cameraRange, heading, pitch, videoDuration, alignmentDelayMs, job_id } = opts;
  const allFrames = [];
  const captureOnly = async (v, _jobId, dur) => {
    const frames = await captureFrames(v, dur);
    allFrames.push(...frames);
  };

  const transitionPause = () => new Promise(r => setTimeout(r, TRANSITION_DELAY_MS));

  // Zoom noktalarını önceden hesapla - geçişlerde donma olmasın
  console.log('[all] Zoom noktaları hesaplanıyor...');
  const [lineA, lineC, lineB] = await Promise.all([
    ZoomService.getLinePoints(center, polygonPositions, terrainProvider, 'zooma'),
    ZoomService.getLinePoints(center, polygonPositions, terrainProvider, 'zoomc'),
    ZoomService.getLinePoints(center, polygonPositions, terrainProvider, 'zoomb')
  ]);
  if (!lineA || !lineC || !lineB) {
    console.error('[all] Zoom noktaları hesaplanamadı');
    return;
  }

  console.log('[all] orbit başlıyor...');
  await OrbitService.run(viewer, {
    center, cameraRange, heading, pitch, videoDuration, alignmentDelayMs,
    tour: true, autoplay: true, save: true, job_id, onCapture: captureOnly
  });
  OrbitService.stop();
  await transitionPause();

  console.log('[all] zoomA başlıyor...');
  await ZoomService.run(viewer, {
    center, polygonPositions, terrainProvider, cameraRange, heading, pitch, videoDuration, alignmentDelayMs,
    tour: true, autoplay: true, save: true, job_id, onCapture: captureOnly, zoomType: 'zooma', linePoints: lineA
  });
  ZoomService.stop();
  await transitionPause();

  console.log('[all] zoomC başlıyor...');
  await ZoomService.run(viewer, {
    center, polygonPositions, terrainProvider, cameraRange, heading, pitch, videoDuration, alignmentDelayMs,
    tour: true, autoplay: true, save: true, job_id, onCapture: captureOnly, zoomType: 'zoomc', linePoints: lineC
  });
  ZoomService.stop();
  await transitionPause();

  console.log('[all] zoomB başlıyor...');
  await ZoomService.run(viewer, {
    center, polygonPositions, terrainProvider, cameraRange, heading, pitch, videoDuration, alignmentDelayMs,
    tour: true, autoplay: true, save: true, job_id, onCapture: captureOnly, zoomType: 'zoomb', linePoints: lineB
  });
  ZoomService.stop();

  console.log('[all] Toplam', allFrames.length, 'frame yükleniyor...');
  await uploadFrames(job_id, allFrames);
  const hint = document.getElementById('captureHint');
  if (hint) hint.textContent = `${allFrames.length} frame (orbit+zoomA+zoomC+zoomB) gönderildi. Video üretiliyor...`;
}

// Socket.IO - KML polygon çizimi
const socket = io();

async function handleDrawPolygon(data) {
  const { polygons, parcel_name, border_color, marker_height, type, alignment_delay, tour, autoplay, size, save, job_id, pitch: pitchDeg } = data;
  const cameraType = (type || 'orbit').toLowerCase();
  if (!VALID_CAMERA_TYPES.includes(cameraType)) {
    console.warn('[TKGM] Geçersiz type:', type, '- Kabul edilen:', VALID_CAMERA_TYPES.join(', '));
    return;
  }
  const durationRaw = data.duration ?? data.duration_seconds ?? 12;
  const videoDuration = Math.max(6, Math.min(60, parseInt(String(durationRaw), 10) || 12));
  const alignmentDelayMs = Math.max(0, Math.min(60, parseInt(alignment_delay, 10) || 10)) * 1000;
  if (save && job_id) {
    const hintMsg = cameraType === 'all'
      ? `Kayıt başladı (${job_id.slice(0, 8)}...) - orbit→zoomA→zoomC→zoomB`
      : cameraType === 'photo'
        ? `Fotoğraf çekiliyor (${job_id.slice(0, 8)}...)`
        : `Kayıt başladı (${job_id.slice(0, 8)}...) - Frame yakalanıyor...`;
    console.log('[TKGM] Video kaydı başlatılıyor, job_id:', job_id, 'type:', cameraType);
    const hintEl = document.getElementById('captureHint');
    if (hintEl) hintEl.textContent = hintMsg;
  }

  // Render boyutu (örn: 1080x1920 - dikey)
  const container = document.getElementById('cesiumContainer');
  if (size && size.width && size.height) {
    container.style.width = size.width + 'px';
    container.style.height = size.height + 'px';
    container.style.minWidth = size.width + 'px';
    container.style.minHeight = size.height + 'px';
    container.classList.add('render-size');
  } else {
    container.style.cssText = '';
    container.classList.remove('render-size');
  }
  viewer.resize();

  OrbitService.stop();
  ZoomService.stop();
  document.getElementById('tourBtn').classList.add('hidden');

  // Önceki çizimleri temizle
  kmlPolygonEntities.forEach(e => viewer.entities.remove(e));
  kmlPolygonEntities = [];

  const color = Cesium.Color.fromCssColorString(border_color || '#2779F5');
  const lineWidth = Math.max(3, Math.min(20, marker_height || 6));

  // Ardışık tekrarlayan/çok yakın noktaları temizle (GroundPolyline "normalized" hatasını önler)
  function deduplicatePoints(pts) {
    const result = [];
    const eps = 1e-8;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const prev = result[result.length - 1];
      if (!prev || Math.abs(p.longitude - prev.longitude) > eps || Math.abs(p.latitude - prev.latitude) > eps) {
        result.push(p);
      }
    }
    return result;
  }

  await (async function addPolygons() {
    for (const points of polygons) {
      const deduped = deduplicatePoints(points);
      if (deduped.length < 3) continue;

      const cartographics = deduped.map(p => Cesium.Cartographic.fromDegrees(p.longitude, p.latitude));
      await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographics);
      const positionsWithHeight = cartographics.map(c =>
        Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height || 0)
      );
      const closedPositions = [...positionsWithHeight, positionsWithHeight[0].clone()];

      // Border: polyline (terrain üzerinde)
      const lineEntity = viewer.entities.add({
        polyline: {
          positions: closedPositions,
          width: lineWidth,
          material: new Cesium.PolylineOutlineMaterialProperty({
            color: color,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2
          }),
          clampToGround: true
        }
      });
      kmlPolygonEntities.push(lineEntity);

      // Alan dolgusu - sınır ile aynı yükseklikte (terrain sample ile)
      const fillEntity = viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positionsWithHeight),
          material: color.withAlpha(0.15),
          perPositionHeight: true
        }
      });
      kmlPolygonEntities.push(fillEntity);
    }
  })();

  // Tour: orbit animasyonu | Statik: dinamik kamera
  if (polygons.length > 0 && polygons[0].length > 0) {
    // Tüm poligonların merkezi: tüm noktaların bounding box ortası
    const allLons = polygons.flatMap(p => p.map(pt => pt.longitude));
    const allLats = polygons.flatMap(p => p.map(pt => pt.latitude));
    const centerLon = (Math.min(...allLons) + Math.max(...allLons)) / 2;
    const centerLat = (Math.min(...allLats) + Math.max(...allLats)) / 2;

    const setupCamera = async () => {
      const cartographic = Cesium.Cartographic.fromDegrees(centerLon, centerLat);
      const [updated] = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [cartographic]);
      const centerHeight = updated.height || 0;
      const center = Cesium.Cartesian3.fromDegrees(centerLon, centerLat, centerHeight);

      // Merkeze en yakın poligon (zoom için) - tüm poligonların merkezine en yakın olan
      const polyCentroids = polygons.map(poly => {
        const lons = poly.map(pt => pt.longitude);
        const lats = poly.map(pt => pt.latitude);
        return { lon: (Math.min(...lons) + Math.max(...lons)) / 2, lat: (Math.min(...lats) + Math.max(...lats)) / 2, poly };
      });
      const polyForZoom = polyCentroids.reduce((best, cur) => {
        const dCur = Math.hypot(cur.lon - centerLon, cur.lat - centerLat);
        const dBest = best ? Math.hypot(best.lon - centerLon, best.lat - centerLat) : Infinity;
        return dCur < dBest ? cur : best;
      }).poly;

      const deduped = deduplicatePoints(polyForZoom);
      const cartographicsFirst = deduped.map(p => Cesium.Cartographic.fromDegrees(p.longitude, p.latitude));
      await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographicsFirst);
      const polygonPositions = cartographicsFirst.map(c =>
        Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height || 0)
      );

      // Parcel adını tüm poligonların ortasına yaz
      if (parcel_name) {
        const labelEntity = viewer.entities.add({
          position: center,
          label: {
            text: parcel_name,
            font: 'bold 28px sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            pixelOffset: new Cesium.Cartesian2(0, 0),
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        });
        kmlPolygonEntities.push(labelEntity);
      }

      // Tüm poligonlardaki en uzak köşe (kamera mesafesi için)
      let maxDist = 0;
      let farthestVertex = null;
      for (const poly of polygons) {
        for (const p of poly) {
          const v = Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, centerHeight);
          const d = Cesium.Cartesian3.distance(center, v);
          if (d > maxDist) {
            maxDist = d;
            farthestVertex = v;
          }
        }
      }

      // Aspect ratio'a göre kamera mesafesi: dar ekranda (dikey) daha geri
      const viewWidth = size ? size.width : (container.clientWidth || window.innerWidth);
      const viewHeight = size ? size.height : (container.clientHeight || window.innerHeight);
      const aspectRatio = viewWidth / viewHeight;
      const vFOV = Math.PI / 3; // Cesium default 60°
      const hFOV = 2 * Math.atan(Math.tan(vFOV / 2) * aspectRatio);
      const limitingFOV = Math.min(hFOV, vFOV);
      const cameraRange = Math.max(maxDist / Math.tan(limitingFOV / 2) * 1.1, 50);
      const pitch = Cesium.Math.toRadians(typeof pitchDeg === 'number' ? pitchDeg : -20);

      if (!farthestVertex) farthestVertex = center;
      const transform = Cesium.Transforms.eastNorthUpToFixedFrame(center);
      const east = Cesium.Matrix4.getColumn(transform, 0, new Cesium.Cartesian3());
      const north = Cesium.Matrix4.getColumn(transform, 1, new Cesium.Cartesian3());
      const toVertex = Cesium.Cartesian3.subtract(farthestVertex, center, new Cesium.Cartesian3());
      const heading = Math.atan2(
        Cesium.Cartesian3.dot(toVertex, north),
        Cesium.Cartesian3.dot(toVertex, east)
      );

      if (cameraType === 'orbit') {
        OrbitService.run(viewer, {
          center,
          cameraRange,
          heading,
          pitch,
          videoDuration,
          alignmentDelayMs,
          tour,
          autoplay,
          save,
          job_id,
          onCapture: captureFramesAndUpload
        });
      } else if (cameraType === 'photo' && save && job_id) {
        try {
          await viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 1), {
            offset: new Cesium.HeadingPitchRange(heading, pitch, cameraRange),
            duration: 1.5
          });
          await new Promise(r => setTimeout(r, alignmentDelayMs));
          const frames = await captureFrames(viewer, 1);
          if (frames.length === 0) throw new Error('Frame yakalanamadı');
          await uploadFrames(job_id, frames);
          const hintEl = document.getElementById('captureHint');
          if (hintEl) hintEl.textContent = 'Fotoğraf gönderildi. İşleniyor...';
        } catch (err) {
          console.error('[photo] Hata:', err);
          const hintEl = document.getElementById('captureHint');
          if (hintEl) hintEl.textContent = 'Fotoğraf hatası: ' + (err.message || err);
        }
      } else if (cameraType === 'zooma' || cameraType === 'zoomb' || cameraType === 'zoomc') {
        ZoomService.run(viewer, {
          center,
          polygonPositions,
          terrainProvider: viewer.terrainProvider,
          cameraRange,
          heading,
          pitch,
          videoDuration,
          alignmentDelayMs,
          tour,
          autoplay,
          save,
          job_id,
          onCapture: captureFramesAndUpload,
          zoomType: cameraType
        });
      } else if (cameraType === 'all' && save && job_id) {
        runAllSequential(viewer, {
          center,
          polygonPositions,
          terrainProvider: viewer.terrainProvider,
          cameraRange,
          heading,
          pitch,
          videoDuration,
          alignmentDelayMs,
          job_id
        });
      } else {
        viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 1), {
          offset: new Cesium.HeadingPitchRange(heading, pitch, cameraRange),
          duration: 1.5
        });
      }
    };
    setupCamera();
  }
}

socket.on('drawPolygon', handleDrawPolygon);

// Headless mod: URL'de jobId varsa payload fetch edip çizimi başlat
const urlParams = new URLSearchParams(window.location.search);
const jobIdFromUrl = urlParams.get('jobId');
if (jobIdFromUrl) {
  (async () => {
    try {
      const res = await fetch(`/api/job/${jobIdFromUrl}/payload`);
      if (res.ok) {
        const data = await res.json();
        handleDrawPolygon(data);
      }
    } catch (e) {
      console.error('[headless] payload fetch hatası:', e);
    }
  })();
}

})();
