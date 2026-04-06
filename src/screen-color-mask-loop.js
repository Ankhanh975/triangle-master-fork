(() => {
  const TARGET_FPS = 15;
  const FRAME_INTERVAL_MS = Math.round(1000 / TARGET_FPS);

  function getTopColors(histogram, limit) {
    return Array.from(histogram.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, count]) => {
        const [r, g, b] = key.split(',').map(Number);

        return {
          rgb: { r, g, b },
          count,
        };
      });
  }

  function createDominantColorHistogram(rgba) {
    const histogram = new Map();
    let bestKey = '0,0,0';
    let bestCount = 0;

    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const key = `${r},${g},${b}`;
      const count = (histogram.get(key) || 0) + 1;

      histogram.set(key, count);
      if (count > bestCount) {
        bestCount = count;
        bestKey = key;
      }
    }

    const [r, g, b] = bestKey.split(',').map(Number);
    const topColors = getTopColors(histogram, 5);

    return {
      dominant: { r, g, b },
      count: bestCount,
      uniqueColors: histogram.size,
      topColors,
    };
  }

  function buildColorMask(sourceRgba, width, height, dominant) {
    const maskRgba = new Uint8ClampedArray(sourceRgba.length);

    for (let i = 0; i < sourceRgba.length; i += 4) {
      const isMatch =
        sourceRgba[i] === dominant.r &&
        sourceRgba[i + 1] === dominant.g &&
        sourceRgba[i + 2] === dominant.b;
      const alpha = isMatch ? 255 : 0;

      maskRgba[i] = 255;
      maskRgba[i + 1] = 255;
      maskRgba[i + 2] = 255;
      maskRgba[i + 3] = alpha;
    }

    return new ImageData(maskRgba, width, height);
  }

  function applyMaskFrame(sourceCanvas, targetCanvas, maskOutputCanvas) {
    if (!sourceCanvas) {
      throw new Error('sourceCanvas is required.');
    }

    const actualTargetCanvas = targetCanvas || sourceCanvas;

    const targetCtx = actualTargetCanvas.getContext('2d');
    if (!targetCtx) {
      throw new Error('2D context is required on targetCanvas.');
    }

    const width = Math.max(1, sourceCanvas.width || sourceCanvas.clientWidth || 1);
    const height = Math.max(1, sourceCanvas.height || sourceCanvas.clientHeight || 1);

    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = width;
    sampleCanvas.height = height;

    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!sampleCtx) {
      throw new Error('Failed to create sample 2D context.');
    }

    sampleCtx.drawImage(sourceCanvas, 0, 0, width, height);
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

    if (maskOutputCanvas) {
      const maskOutputCtx = maskOutputCanvas.getContext('2d');
      if (!maskOutputCtx) {
        throw new Error('2D context is required on maskOutputCanvas.');
      }

      if (maskOutputCanvas.width !== width) {
        maskOutputCanvas.width = width;
      }
      if (maskOutputCanvas.height !== height) {
        maskOutputCanvas.height = height;
      }

      maskOutputCtx.clearRect(0, 0, width, height);
      maskOutputCtx.drawImage(maskCanvas, 0, 0, width, height);
    }

    targetCtx.save();
    targetCtx.globalCompositeOperation = 'destination-in';
    targetCtx.drawImage(maskCanvas, 0, 0, width, height);
    targetCtx.restore();

    const maskInfo = {
      timestamp: Date.now(),
      dominant: dominantInfo.dominant,
      count: dominantInfo.count,
      uniqueColors: dominantInfo.uniqueColors,
      topColors: dominantInfo.topColors,
    };

    // Keep debug data available regardless of which canvas the runtime reads from.
    actualTargetCanvas.__screenMaskInfo = maskInfo;
    sourceCanvas.__screenMaskInfo = maskInfo;
    if (maskOutputCanvas) {
      maskOutputCanvas.__screenMaskInfo = maskInfo;
    }

    return maskInfo;
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

    let timer = null;

    function syncSize() {
      const width = Math.max(1, targetCanvas.width || targetCanvas.clientWidth || 1);
      const height = Math.max(1, targetCanvas.height || targetCanvas.clientHeight || 1);

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

      const width = Math.max(1, targetCanvas.width || targetCanvas.clientWidth || 1);
      const height = Math.max(1, targetCanvas.height || targetCanvas.clientHeight || 1);

      targetCtx.clearRect(0, 0, width, height);
      targetCtx.drawImage(video, 0, 0, width, height);
      applyMaskFrame(targetCanvas);
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
