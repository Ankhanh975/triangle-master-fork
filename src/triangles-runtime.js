(() => {
  const container = document.getElementById('container');
  const output = document.getElementById('output');
  const controls = document.getElementById('controls');

  if (!container || !output || typeof window.createTrianglesCore !== 'function') {
    return;
  }

  const triangles = window.createTrianglesCore({
    container,
    output,
    controls,
    enableControls: false,
  });

  const webglRenderer = triangles.getWebGL();
  const sourceCanvas = webglRenderer ? webglRenderer.element : null;
  const TARGET_FPS = 60;
  const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
  const CAPTURE_FPS = 15;
  const CAPTURE_INTERVAL_MS = Math.round(1000 / CAPTURE_FPS);
  let captureTimer = null;
  let captureStream = null;
  let debugWindow = null;
  let debugCaptureCanvas = null;
  let debugSourceCanvas = null;
  let debugMaskCanvas = null;
  let debugScreenCanvas = null;
  let debugHistogramCanvas = null;
  let debugCaptureContext = null;
  let debugSourceContext = null;
  let debugMaskContext = null;
  let debugScreenContext = null;
  let debugHistogramContext = null;

  const captureVideo = document.createElement('video');
  captureVideo.playsInline = true;
  captureVideo.muted = true;

  const captureCanvas = document.createElement('canvas');
  captureCanvas.style.display = 'none';
  const histogramSampleCanvas = document.createElement('canvas');
  const histogramSampleContext = histogramSampleCanvas.getContext('2d', {
    willReadFrequently: true,
  });

  const screenCanvas = document.createElement('canvas');
  const screenContext = screenCanvas.getContext('2d');
  screenCanvas.style.position = 'absolute';
  screenCanvas.style.left = '0';
  screenCanvas.style.top = '0';
  screenCanvas.style.width = '100%';
  screenCanvas.style.height = '100%';
  screenCanvas.style.pointerEvents = 'none';
  screenCanvas.style.zIndex = '10';
  output.appendChild(screenCanvas);

  if (sourceCanvas) {
    sourceCanvas.style.opacity = '0';
    sourceCanvas.style.pointerEvents = 'none';
  }

  function resizeOverlayCanvas() {
    screenCanvas.width = container.offsetWidth;
    screenCanvas.height = container.offsetHeight;
    captureCanvas.width = container.offsetWidth;
    captureCanvas.height = container.offsetHeight;
    if (sourceCanvas) {
      sourceCanvas.width = container.offsetWidth;
      sourceCanvas.height = container.offsetHeight;
    }
  }

  function openDebugWindow() {
    try {
      debugWindow = window.open('', 'triangles-debug', 'width=1800,height=960');
      if (!debugWindow) {
        return;
      }

      debugWindow.document.open();
      debugWindow.document.write(`
        <!doctype html>
        <html>
          <head>
            <meta charset="UTF-8" />
            <title>Triangles Debug</title>
            <style>
              html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #111; color: #fff; font-family: sans-serif; }
              .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 12px; box-sizing: border-box; width: 100%; height: 100%; }
              .panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
              .label { font-size: 12px; margin: 0 0 8px; opacity: 0.8; }
              canvas { width: 100%; height: 100%; background: #000; border: 1px solid #333; box-sizing: border-box; }
            </style>
          </head>
          <body>
            <div class="grid">
              <div class="panel"><div class="label">Hidden Capture</div><canvas id="debug-capture"></canvas></div>
              <div class="panel"><div class="label">Triangles Source</div><canvas id="debug-source"></canvas></div>
              <div class="panel"><div class="label">Mask</div><canvas id="debug-mask"></canvas></div>
              <div class="panel"><div class="label">Final Screen</div><canvas id="debug-screen"></canvas></div>
              <div class="panel"><div class="label">Histogram</div><canvas id="debug-histogram"></canvas></div>
            </div>
          </body>
        </html>
      `);
      debugWindow.document.close();

      debugCaptureCanvas = debugWindow.document.getElementById('debug-capture');
      debugSourceCanvas = debugWindow.document.getElementById('debug-source');
      debugMaskCanvas = debugWindow.document.getElementById('debug-mask');
      debugScreenCanvas = debugWindow.document.getElementById('debug-screen');
      debugHistogramCanvas = debugWindow.document.getElementById('debug-histogram');
      debugCaptureContext = debugCaptureCanvas && debugCaptureCanvas.getContext('2d');
      debugSourceContext = debugSourceCanvas && debugSourceCanvas.getContext('2d');
      debugMaskContext = debugMaskCanvas && debugMaskCanvas.getContext('2d');
      debugScreenContext = debugScreenCanvas && debugScreenCanvas.getContext('2d');
      debugHistogramContext = debugHistogramCanvas && debugHistogramCanvas.getContext('2d');

      const syncDebugSize = () => {
        if (!debugWindow || debugWindow.closed) {
          return;
        }

        const width = Math.max(1, container.offsetWidth);
        const height = Math.max(1, container.offsetHeight);

        for (const canvas of [debugCaptureCanvas, debugSourceCanvas, debugMaskCanvas, debugScreenCanvas, debugHistogramCanvas]) {
          if (canvas) {
            canvas.width = width;
            canvas.height = height;
          }
        }
      };

      syncDebugSize();
      debugWindow.addEventListener('resize', syncDebugSize);
    } catch (error) {
      console.error('Failed to open debug window:', error);
      debugWindow = null;
    }
  }

  function drawCanvasToContext(source, context, width, height) {
    if (!source || !context) {
      return;
    }

    context.clearRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
  }

  function buildHistogramInfoFromCanvas(canvas) {
    if (!canvas || !histogramSampleContext || canvas.width < 1 || canvas.height < 1) {
      return null;
    }

    const sampleWidth = Math.max(1, Math.min(320, canvas.width));
    const sampleHeight = Math.max(1, Math.min(180, canvas.height));
    histogramSampleCanvas.width = sampleWidth;
    histogramSampleCanvas.height = sampleHeight;

    histogramSampleContext.clearRect(0, 0, sampleWidth, sampleHeight);
    histogramSampleContext.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);

    const imageData = histogramSampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
    const histogram = new Map();

    for (let i = 0; i < imageData.length; i += 4) {
      // Quantize channels to stabilize histogram under video compression noise.
      const r = imageData[i] & 0xf8;
      const g = imageData[i + 1] & 0xf8;
      const b = imageData[i + 2] & 0xf8;
      const key = `${r},${g},${b}`;

      histogram.set(key, (histogram.get(key) || 0) + 1);
    }

    const topColors = Array.from(histogram.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, count]) => {
        const [r, g, b] = key.split(',').map(Number);
        return { rgb: { r, g, b }, count };
      });

    if (topColors.length === 0) {
      return null;
    }

    return {
      uniqueColors: histogram.size,
      count: topColors[0].count,
      topColors,
    };
  }

  function drawHistogram(context, width, height) {
    if (!context) {
      return;
    }

    let info = sourceCanvas ? sourceCanvas.__screenMaskInfo : null;
    if (!info || !Array.isArray(info.topColors) || info.topColors.length === 0) {
      info = buildHistogramInfoFromCanvas(captureCanvas);
    }

    context.clearRect(0, 0, width, height);
    context.fillStyle = '#111';
    context.fillRect(0, 0, width, height);

    if (!info || !Array.isArray(info.topColors) || info.topColors.length === 0) {
      context.fillStyle = '#999';
      context.font = '16px sans-serif';
      context.fillText('No histogram data yet', 16, 28);
      return;
    }

    const margin = 16;
    const innerWidth = Math.max(1, width - margin * 2);
    const barHeight = Math.max(10, Math.floor((height - 80) / info.topColors.length));
    const maxCount = info.topColors[0].count || 1;

    context.fillStyle = '#ddd';
    context.font = '14px sans-serif';
    context.fillText(`Unique colors: ${info.uniqueColors || 0}`, margin, 22);
    context.fillText(`Dominant count: ${info.count || 0}`, margin, 42);

    info.topColors.forEach((entry, idx) => {
      const y = 56 + idx * barHeight;
      const ratio = entry.count / maxCount;
      const barWidth = Math.max(1, Math.floor(innerWidth * ratio));
      const color = `rgb(${entry.rgb.r}, ${entry.rgb.g}, ${entry.rgb.b})`;

      context.fillStyle = color;
      context.fillRect(margin, y, barWidth, Math.max(6, barHeight - 4));

      context.fillStyle = '#fff';
      context.font = '12px sans-serif';
      context.fillText(`${entry.rgb.r},${entry.rgb.g},${entry.rgb.b} - ${entry.count}`, margin + 6, y + Math.max(12, barHeight - 8));
    });
  }

  function syncDebugWindow() {
    if (!debugWindow || debugWindow.closed) {
      return;
    }

    const width = Math.max(1, container.offsetWidth);
    const height = Math.max(1, container.offsetHeight);

    drawCanvasToContext(captureCanvas, debugCaptureContext, width, height);
    drawCanvasToContext(sourceCanvas, debugSourceContext, width, height);
    // The mask panel is updated directly in applyScreenColorMaskFrame.
    drawCanvasToContext(screenCanvas, debugScreenContext, width, height);
    drawHistogram(debugHistogramContext, width, height);
  }

  async function startCaptureMaskLoop() {
    if (typeof window.applyScreenColorMaskFrame !== 'function') {
      return;
    }

    captureStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: CAPTURE_FPS, max: CAPTURE_FPS },
      },
      audio: false,
    });

    captureVideo.srcObject = captureStream;
    await captureVideo.play();

    const captureContext = captureCanvas.getContext('2d', { willReadFrequently: true });
    if (!captureContext) {
      throw new Error('Failed to create capture context.');
    }

    const tickCapture = () => {
      if (captureVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !sourceCanvas) {
        return;
      }

      const width = captureCanvas.width;
      const height = captureCanvas.height;

      captureContext.clearRect(0, 0, width, height);
      captureContext.drawImage(captureVideo, 0, 0, width, height);
      window.applyScreenColorMaskFrame(captureCanvas, sourceCanvas, debugMaskCanvas);
    };

    captureTimer = window.setInterval(tickCapture, CAPTURE_INTERVAL_MS);
  }

  function drawToScreenCanvas() {
    if (!screenContext || !sourceCanvas) {
      return;
    }

    screenContext.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
    screenContext.drawImage(captureCanvas, 0, 0, screenCanvas.width, screenCanvas.height);
    screenContext.drawImage(sourceCanvas, 0, 0, screenCanvas.width, screenCanvas.height);

    // Keep the rectangle overlay on top of the composited triangles.
    screenContext.strokeStyle = 'rgba(255, 80, 80, 0.9)';
    screenContext.lineWidth = 3;

    const margin = 24;
    const rectWidth = Math.max(40, screenCanvas.width - margin * 2);
    const rectHeight = Math.max(40, screenCanvas.height - margin * 2);
    screenContext.strokeRect(margin, margin, rectWidth, rectHeight);
  }

  function onResize() {
    triangles.resize(container.offsetWidth, container.offsetHeight);
    resizeOverlayCanvas();
  }

  function onMouseMove(event) {
    triangles.setMousePosition(event.clientX, event.clientY);
  }

  let lastFrameAt = 0;
  function animate(timestamp) {
    if (timestamp - lastFrameAt >= FRAME_INTERVAL_MS) {
      // Keep WebGL update and 2D composite in the exact same frame budget.
      triangles.tick();
      drawToScreenCanvas();
      syncDebugWindow();
      lastFrameAt = timestamp - ((timestamp - lastFrameAt) % FRAME_INTERVAL_MS);
    }

    window.requestAnimationFrame(animate);
  }

  window.addEventListener('resize', onResize);
  container.addEventListener('mousemove', onMouseMove);

  resizeOverlayCanvas();

  startCaptureMaskLoop().catch((error) => {
    console.error('Failed to start capture mask loop:', error);
  });

  window.addEventListener('beforeunload', () => {
    if (captureTimer) {
      window.clearInterval(captureTimer);
      captureTimer = null;
    }
    if (captureStream) {
      for (const track of captureStream.getTracks()) {
        track.stop();
      }
      captureStream = null;
    }
    if (debugWindow && !debugWindow.closed) {
      debugWindow.close();
    }
  });

  window.requestAnimationFrame(animate);

  openDebugWindow();

  window.trianglesRuntime = triangles;
  window.trianglesWebGL = triangles.getWebGL();
})();
