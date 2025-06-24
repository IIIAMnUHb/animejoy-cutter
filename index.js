const { app, BrowserWindow } = require('electron/main')
const path = require('node:path')

function createWindow () {
  const win = new BrowserWindow({
    width: 400,
    height: 700,
    autoHideMenuBar: true,
    resizable: false,
    
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })
  win.setResizable(false);
  win.loadFile('index.html')
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
});

require('./socket');