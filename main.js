const path = require('path');
const { app, BrowserWindow, desktopCapturer, screen, session } = require('electron');

let overlayWindow;
let cursorTimer;
let lastCursorLocal = null;

function getPrimaryBounds() {
  return screen.getPrimaryDisplay().bounds;
}

function registerDisplayCaptureHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
      });

      const primaryDisplay = screen.getPrimaryDisplay();
      const primaryId = String(primaryDisplay.id);
      const preferredSource =
        sources.find((source) => source.display_id === primaryId) || sources[0];

      callback({ video: preferredSource });
    } catch (_error) {
      callback({});
    }
  });
}

function createOverlayWindow() {
  const bounds = getPrimaryBounds();

  overlayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setContentProtection(true);

  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));

  overlayWindow.webContents.on('did-finish-load', () => {
    const windowBounds = overlayWindow.getBounds();
    overlayWindow.webContents.send('overlay-bounds', windowBounds);
  });

  const updateBounds = () => {
    const nextBounds = getPrimaryBounds();
    overlayWindow.setBounds(nextBounds);
    overlayWindow.webContents.send('overlay-bounds', nextBounds);
  };

  screen.on('display-added', updateBounds);
  screen.on('display-removed', updateBounds);
  screen.on('display-metrics-changed', updateBounds);

  const tickCursor = () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      return;
    }

    const point = screen.getCursorScreenPoint();
    const windowBounds = overlayWindow.getBounds();
    const localPoint = {
      x: point.x - windowBounds.x,
      y: point.y - windowBounds.y,
    };

    if (
      !lastCursorLocal ||
      lastCursorLocal.x !== localPoint.x ||
      lastCursorLocal.y !== localPoint.y
    ) {
      lastCursorLocal = localPoint;
      overlayWindow.webContents.send('cursor-move', localPoint);
    }
  };

  cursorTimer = setInterval(tickCursor, 8);

  overlayWindow.on('closed', () => {
    lastCursorLocal = null;
    overlayWindow = null;
  });
}

app.whenReady().then(() => {
  registerDisplayCaptureHandler();
  createOverlayWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOverlayWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (cursorTimer) {
    clearInterval(cursorTimer);
    cursorTimer = null;
  }

  app.quit();
});
