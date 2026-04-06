(() => {
  const TARGET_FPS = 15;
  const FRAME_INTERVAL_MS = Math.round(1000 / TARGET_FPS);
  const BINS_PER_CHANNEL = 32;
  const BIN_COUNT = BINS_PER_CHANNEL * BINS_PER_CHANNEL * BINS_PER_CHANNEL;
  const COLOR_TOLERANCE = 24;

  function clampByte(value) {
    return Math.max(0, Math.min(255, value));
  }

  function binToRgb(bin) {
    const rBin = bin % BINS_PER_CHANNEL;
    const gBin = Math.floor(bin / BINS_PER_CHANNEL) % BINS_PER_CHANNEL;
    const bBin = Math.floor(bin / (BINS_PER_CHANNEL * BINS_PER_CHANNEL));

    const step = 256 / BINS_PER_CHANNEL;
    const r = clampByte(Math.floor((rBin + 0.5) * step));
    const g = clampByte(Math.floor((gBin + 0.5) * step));
    const b = clampByte(Math.floor((bBin + 0.5) * step));

    return { r, g, b };
  }

  function createDominantColorHistogram(rgba) {
    const histogram = new Uint32Array(BIN_COUNT);
    let bestBin = 0;
    let bestCount = 0;

    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];

      const rq = Math.min(BINS_PER_CHANNEL - 1, Math.floor((r * BINS_PER_CHANNEL) / 256));
      const gq = Math.min(BINS_PER_CHANNEL - 1, Math.floor((g * BINS_PER_CHANNEL) / 256));
      const bq = Math.min(BINS_PER_CHANNEL - 1, Math.floor((b * BINS_PER_CHANNEL) / 256));

      const bin = rq + gq * BINS_PER_CHANNEL + bq * BINS_PER_CHANNEL * BINS_PER_CHANNEL;
      const count = ++histogram[bin];
      if (count > bestCount) {
        bestCount = count;
        bestBin = bin;
      }
    }

    return {
      dominant: binToRgb(bestBin),
      count: bestCount,
    };
  }

  function buildColorMask(sourceRgba, width, height, dominant) {
    const maskRgba = new Uint8ClampedArray(sourceRgba.length);

    for (let i = 0; i < sourceRgba.length; i += 4) {
      const dr = Math.abs(sourceRgba[i] - dominant.r);
      const dg = Math.abs(sourceRgba[i + 1] - dominant.g);
      const db = Math.abs(sourceRgba[i + 2] - dominant.b);

      const isMatch = dr <= COLOR_TOLERANCE && dg <= COLOR_TOLERANCE && db <= COLOR_TOLERANCE;
      const alpha = isMatch ? 255 : 0;

      maskRgba[i] = 255;
      maskRgba[i + 1] = 255;
      maskRgba[i + 2] = 255;
      maskRgba[i + 3] = alpha;
    }

    return new ImageData(maskRgba, width, height);
  }

  function applyMaskFrame(targetCanvas) {
    if (!targetCanvas) {
      throw new Error('targetCanvas is required.');
    }

    const targetCtx = targetCanvas.getContext('2d');
    if (!targetCtx) {
      throw new Error('2D context is required on targetCanvas.');
    }

    const width = Math.max(1, targetCanvas.width || targetCanvas.clientWidth || 1);
    const height = Math.max(1, targetCanvas.height || targetCanvas.clientHeight || 1);

    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = width;
    sampleCanvas.height = height;

    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!sampleCtx) {
      throw new Error('Failed to create sample 2D context.');
    }

    sampleCtx.drawImage(targetCanvas, 0, 0, width, height);
    const frame = sampleCtx.getImageData(0, 0, width, height);

    const dominantInfo = createDominantColorHistogram(frame.data);
    const mask = buildColorMask(frame.data, width, height, dominantInfo.dominant);

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) {
      throw new Error('Failed to create mask 2D context.');
    }

    maskCtx.putImageData(mask, 0, 0);

    targetCtx.save();
    targetCtx.globalCompositeOperation = 'destination-in';
    targetCtx.drawImage(maskCanvas, 0, 0, width, height);
    targetCtx.restore();

    targetCanvas.__screenMaskInfo = {
      timestamp: Date.now(),
      dominant: dominantInfo.dominant,
      count: dominantInfo.count,
    };

    return targetCanvas.__screenMaskInfo;
  }

  async function startScreenColorMaskLoop(targetCanvas) {
    if (!targetCanvas) {
      throw new Error('targetCanvas is required.');
    }

    const targetCtx = targetCanvas.getContext('2d');
    if (!targetCtx) {
      throw new Error('2D context is required on targetCanvas.');
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: TARGET_FPS, max: TARGET_FPS },
      },
      audio: false,
    });

    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    await video.play();

    const sampleCanvas = document.createElement('canvas');
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!sampleCtx) {
      throw new Error('Failed to create sample 2D context.');
    }

    const maskCanvas = document.createElement('canvas');
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) {
      throw new Error('Failed to create mask 2D context.');
    }

    let timer = null;

    function syncSize() {
      const width = Math.max(1, targetCanvas.width || targetCanvas.clientWidth || 1);
      const height = Math.max(1, targetCanvas.height || targetCanvas.clientHeight || 1);

      sampleCanvas.width = width;
      sampleCanvas.height = height;
      maskCanvas.width = width;
      maskCanvas.height = height;

      if (targetCanvas.width !== width) {
        targetCanvas.width = width;
      }
      if (targetCanvas.height !== height) {
        targetCanvas.height = height;
      }
    }

    function tick() {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }

      syncSize();

      const width = sampleCanvas.width;
      const height = sampleCanvas.height;

      sampleCtx.drawImage(video, 0, 0, width, height);
      const frame = sampleCtx.getImageData(0, 0, width, height);

      const dominantInfo = createDominantColorHistogram(frame.data);
      const mask = buildColorMask(frame.data, width, height, dominantInfo.dominant);

      maskCtx.putImageData(mask, 0, 0);

      // Apply the mask to the target canvas content.
      targetCtx.save();
      targetCtx.globalCompositeOperation = 'destination-in';
      targetCtx.drawImage(maskCanvas, 0, 0, width, height);
      targetCtx.restore();

      targetCanvas.__screenMaskInfo = {
        timestamp: Date.now(),
        dominant: dominantInfo.dominant,
        count: dominantInfo.count,
      };
    }

    timer = window.setInterval(tick, FRAME_INTERVAL_MS);

    function stop() {
      if (timer) {
        window.clearInterval(timer);
        timer = null;
      }
      for (const track of stream.getTracks()) {
        track.stop();
      }
      video.srcObject = null;
    }

    return {
      stop,
      getDominantColor() {
        return targetCanvas.__screenMaskInfo || null;
      },
    };
  }

  window.startScreenColorMaskLoop = startScreenColorMaskLoop;
  window.applyScreenColorMaskFrame = applyMaskFrame;
})();
