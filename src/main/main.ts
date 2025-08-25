/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import 'core-js/stable';
import 'regenerator-runtime/runtime';
import path from 'path';
import { app, BrowserWindow, shell, Menu } from 'electron';
import * as Sentry from '@sentry/electron';
import electronLocalshortcut from 'electron-localshortcut';
import windowStateKeeper from 'electron-window-state';
import wait from 'wait';
import { resolveHtmlPath } from './util';
import BinaryRunner from './binary-runner';
import { identifyUser, trackEvent } from './analytics';
import { getLastUrl, saveLastUrl } from './url-memory';

let mainWindow: BrowserWindow | null = null;
let botpressInstance: BinaryRunner | null;

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDevelopment =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

Sentry.init({
  dsn: isDevelopment ? process.env.SENTRY_DSN_DEV : process.env.SENTRY_DSN_PROD,
});

if (isDevelopment) {
  require('electron-debug')();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload
    )
    .catch(console.log);
};

const createWindow = async () => {
  trackEvent('creatingWindow');
  if (isDevelopment) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Botpress',
        submenu: [
          {
            label: 'Open Botpress Folder',
            click: () => {
              BinaryRunner.openPath();
            },
          },
        ],
      },
    ])
  );

  const mainWindowState = windowStateKeeper({
    defaultWidth: 1200,
    defaultHeight: 800,
  });

  mainWindow = new BrowserWindow({
    show: false,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
  });

  mainWindowState.manage(mainWindow); // this persists the window position

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  electronLocalshortcut.register(mainWindow, 'CommandOrControl+T', () => {
    if (mainWindow) {
      mainWindow.webContents.openDevTools();
    }
  });

  try {
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (url.includes('localhost') === false) {
        event.preventDefault();
        shell.openExternal(url);
      }
    });
    mainWindow.webContents.once('did-finish-load', async function () {
      if (!mainWindow) {
        return;
      }
      trackEvent('loadingScreenLoaded');

      const onOutput = (msg: any) => {
        const stringified: string = msg.toString();
        if (mainWindow) {
          mainWindow.webContents.send('botpress-instance-data', stringified);
        }
        console.log('Botpress binary output : ', stringified);
      };

      const onError = (msg: any) => {
        const stringified: string = msg.toString();
        if (mainWindow) {
          mainWindow.webContents.send('botpress-instance-data', stringified);
        }
        Sentry.captureException(stringified);
        trackEvent('binaryError', { stringified });
      };

      const onReady = async (port: number) => {
        if (mainWindow) {
          trackEvent('binaryLoadUrl');
          const lastUrl = await getLastUrl();
          const url = lastUrl
            ? `http://localhost:${port}${lastUrl}`
            : `http://localhost:${port}`;

          mainWindow.loadURL(url);

          mainWindow.on('close', (event) => {
            saveLastUrl((<any>event)?.sender.webContents.getURL());
          });

          electronLocalshortcut.register(
            mainWindow,
            'CommandOrControl+R',
            async () => {
              if (mainWindow) {
                await saveLastUrl(mainWindow.webContents.getURL());
                mainWindow?.loadURL(resolveHtmlPath('index.html'));
                await wait(500);
                botpressInstance?.stop();
                await wait(500);
                botpressInstance?.start();
              }
            }
          );
        }
      };

      botpressInstance = new BinaryRunner(onOutput, onError, onReady);

      if (BinaryRunner.missingBinary()) {
        mainWindow.webContents.send(
          'botpress-instance-data',
          'Downloading latest Botpress binaries. This may take a few minutes.'
        );
        await BinaryRunner.downloadBinary((data) => {
          if (!mainWindow) return;
          mainWindow.webContents.send('binary-download-progress', data);
        });
        mainWindow.webContents.send(
          'botpress-instance-data',
          'Finished Downloading latest Botpress binaries. Checking existing user data.'
        );
        await BinaryRunner.migrateData();
        mainWindow.webContents.send(
          'botpress-instance-data',
          'Finished checking existing user data. Initializing Botpress.'
        );
        await BinaryRunner.setLatestVersion();
      }

      const started = await botpressInstance.start();
      trackEvent('binaryInitialized', { started });
    });
  } catch (error) {
    console.log('🚀 ~ file: main.ts ~ line 123 ~ createWindow ~ error', error);
    if (mainWindow) {
      mainWindow.webContents.send('botpress-instance-data', error);
    }
    trackEvent('binaryNoGo', { error: JSON.stringify(error) });
  }

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open urls in the user's browser
  mainWindow.webContents.on('new-window', (event, url) => {
    event.preventDefault();
    shell.openExternal(url);
  });
};

/**
 * Add event listeners...
 */

const quitBinariesIfExist = () => {
  if (botpressInstance) {
    botpressInstance.stop();
    botpressInstance = null;
    console.log('successfully sent kill command to binary');
  }
};

app.on('will-quit', () => {
  quitBinariesIfExist();
});

app.on('window-all-closed', () => {
  trackEvent('windowAllClosed');
  // Respect the macOS convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
  quitBinariesIfExist();
});

app
  .whenReady()
  .then(() => {
    identifyUser();
    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);
