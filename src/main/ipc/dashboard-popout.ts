import { app, ipcMain, screen } from 'electron'
import type { Store } from '../persistence'
import type { KeybindingService } from '../keybindings/keybinding-service'
import type { DashboardSnapshot } from '../../shared/dashboard-snapshot'
import {
  createOrFocusDashboardPopout,
  closeDashboardPopout,
  getDashboardPopoutWindow,
  isDashboardPopoutRenderer,
  onDashboardPopoutOpenChanged
} from '../window/dashboard-popout-window'
import { safelyRevealWindow } from '../window/focus-existing-window'
import { isBackgroundLaunch } from '../window/foreground-activation-policy'
import { getTrustedUIRendererWindow, isTrustedUIRenderer, sendToTrustedUIRenderer } from './ui'
import {
  admitDashboardSnapshot,
  isDashboardPaneKey,
  isDashboardRevealAgentArgs
} from './dashboard-payload-validation'

// Replay immediately on mount; clear on close to avoid showing a previous session.
let lastSnapshot: DashboardSnapshot | null = null
let displayListenersRegistered = false
let dashboardHandlersStore: Store | null = null

function isDashboardEnabled(store: Store): boolean {
  return store.getSettings().experimentalAgentDashboardPopout === true
}

function syncOrcaModeDisplayLayout(store: Store): void {
  const settings = store.getSettings()
  if (settings.orcaModeEnabled !== true || !isDashboardEnabled(store)) {
    return
  }
  const primary = screen.getPrimaryDisplay()
  const mainWindow = getTrustedUIRendererWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBounds(primary.workArea)
  }
  const secondary = screen.getAllDisplays().find((display) => display.id !== primary.id)
  createOrFocusDashboardPopout(store, {
    dashboardDisplayBounds: secondary?.workArea ?? centeredFallbackBounds(primary.workArea)
  })
}

function centeredFallbackBounds(workArea: Electron.Rectangle): Electron.Rectangle {
  const width = Math.min(workArea.width, Math.max(480, Math.round(workArea.width * 0.7)))
  const height = Math.min(workArea.height, Math.max(360, Math.round(workArea.height * 0.7)))
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height
  }
}

export function registerDashboardPopoutHandlers(
  store: Store,
  keybindings?: KeybindingService
): void {
  dashboardHandlersStore = store
  ipcMain.removeHandler('dashboardPopout:open')
  ipcMain.removeHandler('dashboard:publishSnapshot')
  ipcMain.removeHandler('dashboard:requestSnapshot')
  ipcMain.removeHandler('dashboard:getPopoutOpen')
  ipcMain.removeHandler('dashboardPopout:revealAgent')
  ipcMain.removeHandler('dashboardPopout:ackAgent')

  onDashboardPopoutOpenChanged((open) => {
    if (!open) {
      lastSnapshot = null
    }
  })
  if (!displayListenersRegistered) {
    displayListenersRegistered = true
    const syncCurrentLayout = (): void => {
      const currentStore = dashboardHandlersStore
      if (currentStore?.getSettings().orcaModeEnabled === true) {
        syncOrcaModeDisplayLayout(currentStore)
      }
    }
    screen.on('display-added', syncCurrentLayout)
    screen.on('display-removed', syncCurrentLayout)
    screen.on('display-metrics-changed', syncCurrentLayout)
  }
  if (store.getSettings().orcaModeEnabled === true) {
    void app.whenReady().then(() => syncOrcaModeDisplayLayout(store))
  }
  store.onSettingsChanged((updates, settings) => {
    if ('orcaModeEnabled' in updates && settings.orcaModeEnabled === true) {
      syncOrcaModeDisplayLayout(store)
    }
    if (
      'experimentalAgentDashboardPopout' in updates &&
      settings.experimentalAgentDashboardPopout !== true
    ) {
      lastSnapshot = null
      closeDashboardPopout()
    }
  })

  ipcMain.handle('dashboardPopout:open', (event): void => {
    if (!isTrustedUIRenderer(event.sender) || !isDashboardEnabled(store)) {
      return
    }
    if (store.getSettings().orcaModeEnabled === true) {
      syncOrcaModeDisplayLayout(store)
      return
    }
    createOrFocusDashboardPopout(store, {
      getKeybindings: () => keybindings?.getOverrides()
    })
  })

  ipcMain.handle('dashboard:publishSnapshot', (event, snapshot: unknown): void => {
    if (!isTrustedUIRenderer(event.sender) || !isDashboardEnabled(store)) {
      return
    }
    const admitted = admitDashboardSnapshot(snapshot)
    // Explain stale replays instead of silently discarding malformed snapshots.
    if (!admitted) {
      console.warn('[dashboard] rejected malformed snapshot; pop-out keeps its previous board')
      return
    }
    if (admitted.droppedCardCount > 0) {
      console.warn(`[dashboard] dropped ${admitted.droppedCardCount} invalid card(s) from snapshot`)
    }
    // Retain omitted unchanged icons for newly mounting popouts; live forwards stay sparse.
    lastSnapshot =
      admitted.snapshot.repoIconsByRepoId === undefined && lastSnapshot?.repoIconsByRepoId
        ? { ...admitted.snapshot, repoIconsByRepoId: lastSnapshot.repoIconsByRepoId }
        : admitted.snapshot
    getDashboardPopoutWindow()?.webContents.send('dashboard:snapshot', admitted.snapshot)
  })

  // Replay immediately, then request fresh renderer state.
  ipcMain.handle('dashboard:requestSnapshot', (event): void => {
    if (!isDashboardPopoutRenderer(event.sender) || !isDashboardEnabled(store)) {
      return
    }
    if (lastSnapshot) {
      event.sender.send('dashboard:snapshot', lastSnapshot)
    }
    sendToTrustedUIRenderer('dashboard:snapshotRequested', null)
  })

  ipcMain.handle('dashboard:getPopoutOpen', (event): boolean =>
    isTrustedUIRenderer(event.sender) && isDashboardEnabled(store)
      ? getDashboardPopoutWindow() !== null
      : false
  )

  // Acknowledge in the main store so popout views also mute sidebar rows.
  ipcMain.handle('dashboardPopout:ackAgent', (event, args: unknown): void => {
    const ack = args && typeof args === 'object' ? args : {}
    const paneKey = 'paneKey' in ack ? ack.paneKey : undefined
    if (
      !isDashboardPopoutRenderer(event.sender) ||
      !isDashboardEnabled(store) ||
      !isDashboardPaneKey(paneKey)
    ) {
      return
    }
    sendToTrustedUIRenderer('ui:ackDashboardAgent', {
      paneKey,
      intent: 'intent' in ack && ack.intent === 'explicit' ? 'explicit' : 'view'
    })
  })

  ipcMain.handle('dashboardPopout:revealAgent', (event, args: unknown): void => {
    if (
      !isDashboardPopoutRenderer(event.sender) ||
      !isDashboardEnabled(store) ||
      !isDashboardRevealAgentArgs(args)
    ) {
      return
    }
    const mainWindow = getTrustedUIRendererWindow()
    if (!mainWindow) {
      return
    }
    safelyRevealWindow(mainWindow)
    mainWindow.webContents.send('ui:revealDashboardAgent', args)
    if (!isBackgroundLaunch()) {
      try {
        app.focus({ steal: true })
      } catch {
        // Best-effort; the per-window focus above may still bring it forward.
      }
    }
  })
}
