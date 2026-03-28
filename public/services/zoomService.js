/**
 * Zoom Kamera Servisi (zoomA, zoomB, zoomC)
 * Orbit çemberi üzerinde hareket - Orbit ile aynı mantık:
 * zoomA: Üst köşeden (kuzey) çeyrek dönüş (0° → 90°)
 * zoomC: Alt köşeden (güney) çeyrek dönüş (180° → 270°)
 * zoomB: Sol yarı (batıdan doğuya) yarım çember (-90° → 90°)
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
   * zoomA: Üst (kuzey, 0°) → doğu (90°) çeyrek
   * zoomC: Alt (güney, π) → batı (270°) çeyrek
   * zoomB: Sol (batı, -90°) → doğu (90°) yarım
   */
  async function getLinePoints(center, polygonPositions, terrainProvider, zoomType, opts) {
    const n = polygonPositions.length;
    if (n < 3) return null;

    let startHeading, endHeading;

    if (zoomType === 'zooma') {
      startHeading = 0;
      endHeading = Math.PI / 2;
    } else if (zoomType === 'zoomc') {
      startHeading = Math.PI;
      endHeading = (3 * Math.PI) / 2;
    } else if (zoomType === 'zoomb') {
      startHeading = -Math.PI / 2;
      endHeading = Math.PI / 2;
    } else {
      startHeading = 0;
      endHeading = Math.PI / 2;
    }

    return { startHeading, endHeading };
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
      zoomType,
      linePoints: precomputedLinePoints
    } = opts;

    const linePoints = precomputedLinePoints || await getLinePoints(center, polygonPositions, terrainProvider, zoomType || 'zooma', { cameraRange, pitch });
    if (!linePoints) return;
    const { startHeading, endHeading } = linePoints;
    let startTime = 0;
    const totalDurationSec = videoDuration;
    const pitchRad = (typeof pitch === 'number' && Math.abs(pitch) <= Math.PI) ? pitch : Cesium.Math.toRadians(-45);

    function easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    const zoomLoop = () => {
      if (frameId === null) return;
      if (startTime === 0) startTime = performance.now();
      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed >= totalDurationSec) {
        frameId = requestAnimationFrame(zoomLoop);
        return;
      }
      const tRaw = Math.min(1, elapsed / totalDurationSec);
      const t = easeInOutCubic(tRaw);
      const camHeading = startHeading + t * (endHeading - startHeading);
      viewer.camera.lookAt(
        center,
        new Cesium.HeadingPitchRange(camHeading, pitchRad, cameraRange)
      );
      if (viewer.scene.requestRenderMode) viewer.scene.requestRender();
      frameId = requestAnimationFrame(zoomLoop);
    };

    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 1), {
      offset: new Cesium.HeadingPitchRange(startHeading, pitchRad, cameraRange),
      duration: 2.5
    });

    const flyToDuration = 2500;
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

  async function getLinePointsForType(center, polygonPositions, terrainProvider, zoomType, opts) {
    return getLinePoints(center, polygonPositions, terrainProvider, zoomType, opts);
  }

  return {
    run,
    stop,
    getLinePoints: getLinePointsForType,
    get isRunning() {
      return frameId !== null;
    }
  };
})();
