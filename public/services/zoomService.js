/**
 * Zoom Kamera Servisi (zoomA, zoomB, zoomC)
 * Köşeden başlayıp merkeze doğru çizginin polygon karşı kenarındaki
 * kesişim noktasına kadar polygon üzerinden geçer.
 * zoomA: A köşesi (0) → karşı nokta
 * zoomB: karşı nokta → A köşesi (ters yön)
 * zoomC: Rastgele köşe → karşı nokta (aynı kamera hareketi)
 */
const ZoomService = (function () {
  let frameId = null;

  function stop() {
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  }

  /**
   * A köşesinden (vertex 0) merkeze doğru çizilen ışının polygon kenarı ile
   * kesişim noktasını bulur (A'nın tam zıttı).
   */
  function raySegmentIntersection(lonA, latA, dirLon, dirLat, lon1, lat1, lon2, lat2) {
    const denom = (lon2 - lon1) * dirLat - (lat2 - lat1) * dirLon;
    if (Math.abs(denom) < 1e-12) return null;
    const s = (dirLon * (lat1 - latA) - dirLat * (lon1 - lonA)) / denom;
    if (s < -1e-6 || s > 1 + 1e-6) return null;
    const lon = lon1 + s * (lon2 - lon1);
    const lat = lat1 + s * (lat2 - lat1);
    let t;
    if (Math.abs(dirLon) > 1e-12) {
      t = (lon - lonA) / dirLon;
    } else {
      t = (lat - latA) / dirLat;
    }
    if (t < 1e-6) return null;
    return { t, lon, lat };
  }

  /**
   * zoomA: A köşesi (0) → karşı nokta
   * zoomB: karşı nokta → A köşesi
   * zoomC: Rastgele köşe → karşı nokta
   */
  async function getLinePoints(center, polygonPositions, terrainProvider, zoomType) {
    const n = polygonPositions.length;
    if (n < 3) return null;

    let startIdx = 0;
    if (zoomType === 'zoomc') {
      startIdx = Math.floor(Math.random() * n);
    }

    const cartoStart = Cesium.Cartographic.fromCartesian(polygonPositions[startIdx]);
    const cartoC = Cesium.Cartographic.fromCartesian(center);
    const lonA = cartoStart.longitude, latA = cartoStart.latitude;
    const lonC = cartoC.longitude, latC = cartoC.latitude;
    const dx = lonC - lonA, dy = latC - latA;
    const len = Math.sqrt(dx * dx + dy * dy) || 1e-10;
    const dirLon = dx / len, dirLat = dy / len;

    let bestT = Infinity;
    let bestLon = 0, bestLat = 0;

    for (let i = 0; i < n; i++) {
      const i1 = i, i2 = (i + 1) % n;
      const p1 = Cesium.Cartographic.fromCartesian(polygonPositions[i1]);
      const p2 = Cesium.Cartographic.fromCartesian(polygonPositions[i2]);
      if (i1 === startIdx || i2 === startIdx) continue;
      const hit = raySegmentIntersection(lonA, latA, dirLon, dirLat, p1.longitude, p1.latitude, p2.longitude, p2.latitude);
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        bestLon = hit.lon;
        bestLat = hit.lat;
      }
    }

    if (bestT === Infinity) {
      const dir = Cesium.Cartesian3.subtract(center, polygonPositions[startIdx], new Cesium.Cartesian3());
      const dist = Math.max(Cesium.Cartesian3.magnitude(dir), 100);
      const dirNorm = Cesium.Cartesian3.normalize(dir, new Cesium.Cartesian3());
      const end = Cesium.Cartesian3.add(polygonPositions[startIdx], Cesium.Cartesian3.multiplyByScalar(dirNorm, dist, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      return zoomType === 'zoomb' ? { start: end, end: polygonPositions[startIdx] } : { start: polygonPositions[startIdx], end };
    }

    const cartoEnd = new Cesium.Cartographic(bestLon, bestLat);
    await Cesium.sampleTerrainMostDetailed(terrainProvider, [cartoEnd]);
    const endPoint = Cesium.Cartesian3.fromRadians(cartoEnd.longitude, cartoEnd.latitude, cartoEnd.height || 0);
    const startPoint = polygonPositions[startIdx];

    if (zoomType === 'zoomb') {
      return { start: endPoint, end: startPoint };
    }
    return { start: startPoint, end: endPoint };
  }

  async function run(viewer, opts) {
    stop();

    const {
      center,
      polygonPositions,
      terrainProvider,
      cameraRange,
      heading,
      pitch,
      videoDuration,
      alignmentDelayMs,
      tour,
      autoplay,
      save,
      job_id,
      onCapture,
      zoomType
    } = opts;

    const linePoints = await getLinePoints(center, polygonPositions, terrainProvider, zoomType || 'zooma');
    if (!linePoints) return;
    const { start, end } = linePoints;
    let startTime = 0;
    const totalDurationSec = videoDuration;

    const zoomLoop = () => {
      if (frameId === null) return;
      if (startTime === 0) startTime = performance.now();
      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed >= totalDurationSec) {
        frameId = requestAnimationFrame(zoomLoop);
        return;
      }
      const t = Math.min(1, elapsed / totalDurationSec);
      const target = Cesium.Cartesian3.lerp(start, end, t, new Cesium.Cartesian3());
      viewer.camera.lookAt(
        target,
        new Cesium.HeadingPitchRange(heading, pitch, cameraRange)
      );
      if (viewer.scene.requestRenderMode) viewer.scene.requestRender();
      frameId = requestAnimationFrame(zoomLoop);
    };

    const firstTarget = start;
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(firstTarget, 1), {
      offset: new Cesium.HeadingPitchRange(heading, pitch, cameraRange),
      duration: 1.5
    });

    const flyToDuration = 1500;
    const totalDelayBeforeCapture = flyToDuration + alignmentDelayMs;

    if (autoplay) {
      if (save && job_id && typeof onCapture === 'function') {
        return new Promise((resolve) => {
          setTimeout(async () => {
            frameId = requestAnimationFrame(zoomLoop);
            const dur = Number(videoDuration) || 12;
            await onCapture(viewer, job_id, dur);
            resolve();
          }, totalDelayBeforeCapture);
        });
      }
      setTimeout(() => {
        frameId = requestAnimationFrame(zoomLoop);
      }, totalDelayBeforeCapture);
    } else {
      const tourBtn = document.getElementById('tourBtn');
      if (tourBtn) {
        tourBtn.textContent = 'Tour Başlat';
        tourBtn.classList.remove('hidden');
        tourBtn.onclick = () => {
          if (frameId !== null) {
            cancelAnimationFrame(frameId);
            frameId = null;
            tourBtn.textContent = 'Tour Başlat';
          } else {
            frameId = requestAnimationFrame(zoomLoop);
            tourBtn.textContent = 'Tour Durdur';
          }
        };
      }
    }
  }

  return {
    run,
    stop,
    get isRunning() {
      return frameId !== null;
    }
  };
})();
