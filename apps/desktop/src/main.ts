import { registerAudioAccess } from "./audio-access.js";
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  Menu,
  shell,
} from "electron";
import { env } from "./env.js";
import {
  applicationUrl,
  isApplicationNavigation,
  isExternalWebUrl,
} from "./navigation.js";

const startUrl = applicationUrl(
  env.ZOEN_DESKTOP_URL ??
    (app.isPackaged
      ? "https://app.tryzoen.com/companion"
      : "http://localhost:3000/companion"),
  app.isPackaged
);
let mainWindow: BrowserWindow | undefined;

async function openExternal(url: string) {
  if (!isExternalWebUrl(url)) return;
  try {
    await shell.openExternal(url);
  } catch {
    await dialog.showMessageBox({
      type: "error",
      message: "Unable to open your browser.",
      detail: "Please try again from the conversation.",
    });
  }
}

function createWindow() {
  const window = new BrowserWindow({
    title: "Zoen",
    width: 1280,
    height: 850,
    minWidth: 400,
    minHeight: 560,
    show: false,
    backgroundColor: "#fcfbf8",
    titleBarStyle: "hiddenInset",
    autoHideMenuBar: true,
    webPreferences: {
      partition: "persist:zoen",
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  mainWindow = window;
  window.once("ready-to-show", () => {
    window.show();
  });
  window.on("closed", () => {
    mainWindow = undefined;
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isApplicationNavigation(url, startUrl.origin)) {
      void window.loadURL(url).catch(showLoadError);
    } else {
      void openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isApplicationNavigation(url, startUrl.origin)) return;
    event.preventDefault();
    void openExternal(url);
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (!isApplicationNavigation(url, startUrl.origin)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  registerAudioAccess(window, startUrl.origin);
  void window.loadURL(startUrl.href).catch(showLoadError);
  return window;
}

async function showLoadError() {
  mainWindow?.show();
  const { response } = await dialog.showMessageBox({
    type: "error",
    message: "Zoen couldn’t connect.",
    detail: `Check that ${startUrl.origin} is available, then try again.`,
    buttons: ["Retry", "Close"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0 && mainWindow) {
    void mainWindow.loadURL(startUrl.href).catch(showLoadError);
  } else {
    mainWindow?.close();
  }
}

function focusWindow() {
  const window = mainWindow ?? createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return window;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    focusWindow();
  });
  app.on("activate", () => {
    focusWindow();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin"
          ? [{ role: "appMenu" as const }]
          : []),
        {
          label: "File",
          submenu: [
            {
              label: "New conversation",
              accelerator: "CommandOrControl+N",
              click: () => {
                void focusWindow().loadURL(startUrl.href).catch(showLoadError);
              },
            },
            { role: "close" },
          ],
        },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ])
    );
    createWindow();
    globalShortcut.register("CommandOrControl+Shift+Space", () => {
      if (mainWindow?.isFocused()) mainWindow.hide();
      else focusWindow();
    });
  });
}
