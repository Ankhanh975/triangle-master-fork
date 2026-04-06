const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayApi', {
  onCursorMove: (callback) => {
    ipcRenderer.on('cursor-move', (_event, point) => callback(point));
  },
  onOverlayBounds: (callback) => {
    ipcRenderer.on('overlay-bounds', (_event, bounds) => callback(bounds));
  },
});
