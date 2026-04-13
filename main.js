const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Log de erros em arquivo para diagnostico
var logPath = path.join(app.getPath('userData'), 'app.log');
function logToFile(msg) {
  var line = new Date().toISOString() + ' ' + msg + '\n';
  try { fs.appendFileSync(logPath, line); } catch(e) {}
  console.log(msg);
}

logToFile('=== App iniciando ===');
logToFile('__dirname: ' + __dirname);
logToFile('userData: ' + app.getPath('userData'));

// Carregar .env antes de qualquer coisa (caminho correto tanto em dev quanto instalado)
var envPath = path.join(__dirname, '.env');
logToFile('.env path: ' + envPath);
logToFile('.env existe: ' + fs.existsSync(envPath));
require('dotenv').config({ path: envPath });

const { startServer } = require('./src/backend/server');

let mainWindow;
let server;
let autoUpdater;

const PORT = 3131;

// ==================== AUTO UPDATER ====================
function setupAutoUpdater() {
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (err) {
    console.error('[AutoUpdater] Nao foi possivel carregar:', err.message);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Log de update
  autoUpdater.logger = {
    info: (msg) => console.log('[AutoUpdater]', msg),
    warn: (msg) => console.warn('[AutoUpdater]', msg),
    error: (msg) => console.error('[AutoUpdater]', msg)
  };

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Verificando atualizacoes...');
    sendToWindow('update-status', { status: 'checking', message: 'Verificando atualizacoes...' });
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Atualizacao disponivel:', info.version);
    sendToWindow('update-status', {
      status: 'available',
      message: 'Nova versao ' + info.version + ' disponivel. Baixando...',
      version: info.version
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[AutoUpdater] Nenhuma atualizacao disponivel.');
    sendToWindow('update-status', { status: 'up-to-date', message: 'Sistema atualizado.' });
  });

  autoUpdater.on('download-progress', (progress) => {
    var msg = 'Baixando atualizacao: ' + Math.round(progress.percent) + '%';
    console.log('[AutoUpdater]', msg);
    sendToWindow('update-status', {
      status: 'downloading',
      message: msg,
      percent: Math.round(progress.percent)
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Atualizacao baixada:', info.version);
    sendToWindow('update-status', {
      status: 'downloaded',
      message: 'Atualizacao v' + info.version + ' pronta! O sistema sera reiniciado.',
      version: info.version
    });

    // Dar 5 segundos para o usuario ler o aviso, depois reiniciar
    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true);
    }, 5000);
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Erro:', err.message);
    // Nao mostrar erro ao usuario em producao (pode ser que nao tem internet)
  });

  // Verificar updates a cada 30 minutos
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 30 * 60 * 1000);

  // Verificar na inicializacao (aguardar 10s para app carregar)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 10000);
}

function sendToWindow(channel, data) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.executeJavaScript(
      'window.dispatchEvent(new CustomEvent("' + channel + '", { detail: ' + JSON.stringify(data) + ' }));'
    ).catch(() => {});
  }
}

// ==================== WINDOW ====================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Ponto Digital - CCF',
    icon: path.join(__dirname, 'src', 'frontend', 'images', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL('http://localhost:' + PORT);

  // Menu simplificado
  var menu = Menu.buildFromTemplate([
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: function() { mainWindow.reload(); } },
        { type: 'separator' },
        { label: 'Verificar Atualizacoes', click: function() {
          if (autoUpdater) {
            autoUpdater.checkForUpdates().catch(() => {});
            sendToWindow('update-status', { status: 'checking', message: 'Verificando atualizacoes...' });
          } else {
            dialog.showMessageBox(mainWindow, { type: 'info', title: 'Atualizacoes', message: 'Sistema de atualizacao nao disponivel.' });
          }
        }},
        { type: 'separator' },
        { label: 'Sobre', click: function() {
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Ponto Digital - CCF',
            message: 'Ponto Digital CCF',
            detail: 'Versao: ' + app.getVersion() + '\nCredito Casa Financiamentos\nCNPJ: 08.225.652/0001-36'
          });
        }},
        { type: 'separator' },
        { label: 'Sair', accelerator: 'CmdOrCtrl+Q', click: function() { app.quit(); } }
      ]
    },
    {
      label: 'Visualizar',
      submenu: [
        { label: 'Zoom +', accelerator: 'CmdOrCtrl+=', click: function() { mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 0.5); } },
        { label: 'Zoom -', accelerator: 'CmdOrCtrl+-', click: function() { mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 0.5); } },
        { label: 'Zoom Reset', accelerator: 'CmdOrCtrl+0', click: function() { mainWindow.webContents.setZoomLevel(0); } },
        { type: 'separator' },
        { label: 'Tela Cheia', accelerator: 'F11', click: function() { mainWindow.setFullScreen(!mainWindow.isFullScreen()); } },
        { type: 'separator' },
        { label: 'Dev Tools', accelerator: 'CmdOrCtrl+Shift+I', click: function() { mainWindow.webContents.toggleDevTools(); } }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);

  mainWindow.on('closed', function() { mainWindow = null; });
}

// ==================== APP LIFECYCLE ====================
app.on('ready', async function() {
  try {
    logToFile('App ready, iniciando servidor na porta ' + PORT);
    server = await startServer(PORT);
    logToFile('Servidor iniciado com sucesso');
    createWindow();
    setupAutoUpdater();
  } catch (err) {
    logToFile('ERRO ao iniciar: ' + err.message);
    logToFile('Stack: ' + err.stack);
    dialog.showErrorBox('Erro ao iniciar Ponto Digital',
      'Nao foi possivel iniciar o sistema.\n\n' +
      'Erro: ' + err.message + '\n\n' +
      'Log salvo em: ' + logPath
    );
    app.quit();
  }
});

app.on('window-all-closed', function() {
  if (server) server.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function() {
  if (mainWindow === null) createWindow();
});
