import { desktopText as t, refreshDesktopLanguage } from "./i18n.js";
import { localeCookie } from "@zoen/companion-ui/i18n/locale";
import { registerAudioAccess } from "./audio-access.js";
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  Menu,
  shell,
  type Cookie,
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
      message: t("Unable to open your browser."),
      detail: t("Please try again from the conversation."),
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
  const session = window.webContents.session;
  const refreshLanguage = () => {
    void refreshDesktopLanguage(session, startUrl.href)
      .then(updateMenu)
      .catch(() => {
        // Keep the current native language if the session's preference cannot be read.
      });
  };
  const languageChanged = (_event: Electron.Event, cookie: Cookie) => {
    if (cookie.name === localeCookie) refreshLanguage();
  };
  session.cookies.on("changed", languageChanged);
  window.once("closed", () => {
    session.cookies.off("changed", languageChanged);
  });
  refreshLanguage();
  registerAudioAccess(window, startUrl.origin);
  void window.loadURL(startUrl.href).catch(showLoadError);
  return window;
}

async function showLoadError() {
  mainWindow?.show();
  const { response } = await dialog.showMessageBox({
    type: "error",
    message: t("Zoen couldn’t connect."),
    detail: t("Check that {origin} is available, then try again.", {
      origin: startUrl.origin,
    }),
    buttons: [t("Retry"), t("Close")],
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

function updateMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin"
        ? [
            {
              label: "Zoen",
              submenu: [
                { role: "about" as const, label: t("About Zoen") },
                { type: "separator" as const },
                { role: "services" as const, label: t("Services") },
                { type: "separator" as const },
                { role: "hide" as const, label: t("Hide Zoen") },
                { role: "hideOthers" as const, label: t("Hide others") },
                { role: "unhide" as const, label: t("Show all") },
                { type: "separator" as const },
                { role: "quit" as const, label: t("Quit Zoen") },
              ],
            },
          ]
        : []),
      {
        label: t("File"),
        submenu: [
          {
            label: t("New conversation"),
            accelerator: "CommandOrControl+N",
            click: () => {
              void focusWindow().loadURL(startUrl.href).catch(showLoadError);
            },
          },
          { role: "close", label: t("Close") },
        ],
      },
      {
        label: t("Edit"),
        submenu: [
          { role: "undo", label: t("Undo") },
          { role: "redo", label: t("Redo") },
          { type: "separator" },
          { role: "cut", label: t("Cut") },
          { role: "copy", label: t("Copy") },
          { role: "paste", label: t("Paste") },
          ...(process.platform === "darwin"
            ? [
                {
                  role: "pasteAndMatchStyle" as const,
                  label: t("Paste and match style"),
                },
              ]
            : []),
          { role: "delete", label: t("Delete") },
          { role: "selectAll", label: t("Select all") },
          ...(process.platform === "darwin"
            ? [
                {
                  label: t("Speech"),
                  submenu: [
                    {
                      role: "startSpeaking" as const,
                      label: t("Start speaking"),
                    },
                    {
                      role: "stopSpeaking" as const,
                      label: t("Stop speaking"),
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      {
        label: t("View"),
        submenu: [
          { role: "reload", label: t("Reload") },
          { role: "forceReload", label: t("Force reload") },
          { role: "toggleDevTools", label: t("Developer tools") },
          { type: "separator" },
          { role: "resetZoom", label: t("Actual size") },
          { role: "zoomIn", label: t("Zoom in") },
          { role: "zoomOut", label: t("Zoom out") },
          { role: "togglefullscreen", label: t("Toggle full screen") },
        ],
      },
      {
        label: t("Window"),
        submenu: [
          { role: "minimize", label: t("Minimize") },
          { role: "zoom", label: t("Zoom") },
          { role: "front", label: t("Bring all to front") },
          { role: "close", label: t("Close") },
        ],
      },
    ])
  );
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
    updateMenu();
    createWindow();
    globalShortcut.register("CommandOrControl+Shift+Space", () => {
      if (mainWindow?.isFocused()) mainWindow.hide();
      else focusWindow();
    });
  });
}
