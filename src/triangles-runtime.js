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
  }

  function drawToScreenCanvas() {
    if (!screenContext || !sourceCanvas) {
      return;
    }

    screenContext.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
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

  function animate() {
    triangles.tick();
    drawToScreenCanvas();
    window.requestAnimationFrame(animate);
  }

  window.addEventListener('resize', onResize);
  container.addEventListener('mousemove', onMouseMove);

  resizeOverlayCanvas();
  animate();

  window.trianglesRuntime = triangles;
  window.trianglesWebGL = triangles.getWebGL();
})();
