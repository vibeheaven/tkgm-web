/**
 * Orbit Kamera Servisi
 * type=orbit olduğunda sadece bu servis çalışır.
 * Zoom servisleriyle karışmaz.
 */
const OrbitService = (function () {
  let state = null;
  let frameId = null;

  function stop() {
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
    state = null;
  }

  function run(viewer, opts) {
    stop();

    const {
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
      onCapture
    } = opts;

    state = {
      center,
      range: cameraRange,
      pitch,
      heading,
      degPerSec: 360 / videoDuration,
      lastTime: performance.now()
    };

    const orbitLoop = () => {
      if (!state) return;
      const now = performance.now();
      const elapsed = (now - state.lastTime) / 1000;
      state.heading += Cesium.Math.toRadians(state.degPerSec * elapsed);
      state.lastTime = now;
      viewer.camera.lookAt(
        state.center,
        new Cesium.HeadingPitchRange(state.heading, state.pitch, state.range)
      );
      if (viewer.scene.requestRenderMode) viewer.scene.requestRender();
      frameId = requestAnimationFrame(orbitLoop);
    };

    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 1), {
      offset: new Cesium.HeadingPitchRange(heading, pitch, cameraRange),
      duration: 1.5
    });

    const flyToDuration = 1500;
    const totalDelayBeforeCapture = flyToDuration + alignmentDelayMs;

    if (autoplay) {
      if (save && job_id && typeof onCapture === 'function') {
        return new Promise((resolve) => {
          setTimeout(async () => {
            if (state) {
              state.lastTime = performance.now();
              frameId = requestAnimationFrame(orbitLoop);
            }
            const dur = Number(videoDuration) || 12;
            await onCapture(viewer, job_id, dur);
            resolve();
          }, totalDelayBeforeCapture);
        });
      }
      setTimeout(() => {
        if (state) {
          state.lastTime = performance.now();
          frameId = requestAnimationFrame(orbitLoop);
        }
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
            state.lastTime = performance.now();
            frameId = requestAnimationFrame(orbitLoop);
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
