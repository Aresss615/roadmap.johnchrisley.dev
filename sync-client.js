(function roadmapCloudSync() {
  if (typeof STORAGE_KEY === "undefined" || typeof render !== "function" || typeof state === "undefined") {
    return;
  }

  const SYNC_SETTINGS_KEY = "jc_roadmap_cloud_sync_v1";
  const DEFAULT_PROFILE_ID = "johnchrisley";
  const DEFAULT_LOCAL_API = "http://localhost:8787";
  const syncSession = {
    connected: false,
    mode: "idle",
    pendingAutoSync: false,
    timerId: 0,
    feedback: "",
    feedbackTone: "neutral",
    lastSyncedAt: 0
  };

  function getDefaultApiBase() {
    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
      return window.location.origin;
    }

    return DEFAULT_LOCAL_API;
  }

  function normalizeBooleanMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    const normalized = {};

    Object.entries(value).forEach(([rawKey, rawValue]) => {
      const key = String(rawKey).slice(0, 120);
      if (key) {
        normalized[key] = Boolean(rawValue);
      }
    });

    return normalized;
  }

  function normalizeSnapshot(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const updatedAt = Number(source.updatedAt);

    return {
      checked: normalizeBooleanMap(source.checked),
      adhdMode: Boolean(source.adhdMode),
      tipIdx: Number.isFinite(source.tipIdx) ? Math.max(0, Math.trunc(source.tipIdx)) : 0,
      activePhase: Number.isFinite(source.activePhase) ? Math.max(1, Math.trunc(source.activePhase)) : 1,
      openSkills: normalizeBooleanMap(source.openSkills),
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.trunc(updatedAt) : 0
    };
  }

  function readStoredLocalSnapshot() {
    try {
      return normalizeSnapshot(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
    } catch (_) {
      return normalizeSnapshot({});
    }
  }

  function buildSnapshot(options) {
    const config = options || {};

    if (config.touch !== false) {
      state.updatedAt = Date.now();
    } else if (!Number.isFinite(state.updatedAt) || state.updatedAt <= 0) {
      state.updatedAt = Date.now();
    }

    return normalizeSnapshot({
      checked: state.checked,
      adhdMode: state.adhdMode,
      tipIdx: state.tipIdx,
      activePhase: state.activePhase,
      openSkills: state.openSkills,
      updatedAt: state.updatedAt
    });
  }

  function persistLocalSnapshot(snapshot) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }

  function applySnapshot(snapshot) {
    const nextSnapshot = normalizeSnapshot(snapshot);
    state.checked = nextSnapshot.checked;
    state.adhdMode = nextSnapshot.adhdMode;
    state.tipIdx = nextSnapshot.tipIdx;
    state.activePhase = nextSnapshot.activePhase;
    state.openSkills = nextSnapshot.openSkills;
    state.updatedAt = nextSnapshot.updatedAt || Date.now();
    persistLocalSnapshot(buildSnapshot({ touch: false }));
    render();
  }

  function readSyncSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(SYNC_SETTINGS_KEY) || "{}");
      return {
        apiBase: normalizeApiBase(raw.apiBase) || getDefaultApiBase(),
        profileId: normalizeProfileId(raw.profileId) || DEFAULT_PROFILE_ID,
        syncKey: typeof raw.syncKey === "string" ? raw.syncKey : ""
      };
    } catch (_) {
      return {
        apiBase: getDefaultApiBase(),
        profileId: DEFAULT_PROFILE_ID,
        syncKey: ""
      };
    }
  }

  function persistSyncSettings(settings) {
    localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(settings));
  }

  function normalizeApiBase(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function normalizeProfileId(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
  }

  function getUi() {
    return {
      panel: document.getElementById("cloudSyncPanel"),
      apiBase: document.getElementById("syncApiBase"),
      profileId: document.getElementById("syncProfileId"),
      syncKey: document.getElementById("syncKey"),
      connectButton: document.getElementById("syncConnectButton"),
      saveButton: document.getElementById("syncSaveButton"),
      statusPill: document.getElementById("syncStatusPill"),
      feedback: document.getElementById("syncFeedback")
    };
  }

  function setFeedback(message, tone) {
    syncSession.feedback = message;
    syncSession.feedbackTone = tone || "neutral";
    updateSyncUi();
  }

  function formatTimestamp(timestamp) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return "";
    }

    try {
      return new Date(timestamp).toLocaleString();
    } catch (_) {
      return "";
    }
  }

  function buildDefaultFeedback() {
    if (syncSession.mode === "connecting") {
      return "Connecting to the roadmap backend...";
    }

    if (syncSession.mode === "saving") {
      return "Saving your roadmap progress to the backend...";
    }

    if (syncSession.connected && syncSession.lastSyncedAt) {
      return `Cloud sync is active. Last successful sync: ${formatTimestamp(syncSession.lastSyncedAt)}.`;
    }

    return "Checklist progress still works locally. Add an API URL, profile ID, and sync key to back it up across devices.";
  }

  function updateSyncUi() {
    const ui = getUi();

    if (!ui.panel) {
      return;
    }

    const hasError = syncSession.feedbackTone === "error";
    const uiSettings = readSyncSettings();
    const feedbackText = syncSession.feedback || buildDefaultFeedback();

    ui.apiBase.value = ui.apiBase.value || uiSettings.apiBase;
    ui.profileId.value = ui.profileId.value || uiSettings.profileId;
    ui.syncKey.value = ui.syncKey.value || uiSettings.syncKey;

    ui.panel.dataset.tone = hasError ? "error" : syncSession.connected ? "success" : "neutral";
    ui.feedback.textContent = feedbackText;
    ui.feedback.dataset.tone = syncSession.feedbackTone || "neutral";

    if (syncSession.mode === "connecting") {
      ui.statusPill.textContent = "Connecting";
    } else if (syncSession.mode === "saving") {
      ui.statusPill.textContent = "Syncing";
    } else if (hasError) {
      ui.statusPill.textContent = "Needs Attention";
    } else if (syncSession.connected) {
      ui.statusPill.textContent = "Cloud Active";
    } else {
      ui.statusPill.textContent = "Local Only";
    }

    ui.statusPill.dataset.state = syncSession.mode === "idle"
      ? syncSession.connected
        ? "success"
        : hasError
          ? "error"
          : "neutral"
      : "busy";

    const inputsDisabled = syncSession.mode !== "idle";
    ui.apiBase.disabled = inputsDisabled;
    ui.profileId.disabled = inputsDisabled;
    ui.syncKey.disabled = inputsDisabled;
    ui.connectButton.disabled = syncSession.mode !== "idle";
    ui.saveButton.disabled = syncSession.mode !== "idle";
    ui.connectButton.textContent = syncSession.connected ? "Reconnect" : "Connect";
  }

  async function requestJson(apiBase, pathname, body, method) {
    const response = await fetch(`${apiBase}${pathname}`, {
      method: method || "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(payload.message || `Request failed with status ${response.status}.`);
      error.code = payload.code || "REQUEST_FAILED";
      throw error;
    }

    return payload;
  }

  async function verifyBackend(apiBase) {
    const response = await fetch(`${apiBase}/api/health`);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.ok) {
      throw new Error("API URL did not respond like the roadmap backend.");
    }

    return payload;
  }

  async function loadRemoteSnapshot(settings) {
    try {
      const payload = await requestJson(settings.apiBase, "/api/state/load", {
        profileId: settings.profileId,
        syncKey: settings.syncKey
      });
      return payload;
    } catch (error) {
      if (error.code === "PROFILE_NOT_FOUND") {
        return null;
      }
      throw error;
    }
  }

  async function saveRemoteSnapshot(reason, snapshotOverride) {
    const settings = readSyncSettings();
    const snapshot = snapshotOverride || buildSnapshot({ touch: false });

    syncSession.mode = "saving";
    updateSyncUi();

    try {
      const payload = await requestJson(settings.apiBase, "/api/state/save", {
        profileId: settings.profileId,
        syncKey: settings.syncKey,
        payload: snapshot
      });

      const remoteSnapshot = normalizeSnapshot(payload.state);
      syncSession.connected = true;
      syncSession.lastSyncedAt = remoteSnapshot.updatedAt;
      setFeedback(
        reason === "manual"
          ? `Cloud save complete. Last synced: ${formatTimestamp(remoteSnapshot.updatedAt)}.`
          : `Changes synced to the cloud. Last synced: ${formatTimestamp(remoteSnapshot.updatedAt)}.`,
        "success"
      );
    } catch (error) {
      if (error.code === "INVALID_SYNC_KEY") {
        syncSession.connected = false;
      }

      setFeedback(`Cloud sync failed: ${error.message}`, "error");
      throw error;
    } finally {
      syncSession.mode = "idle";
      updateSyncUi();
    }
  }

  function validateSettings(settings) {
    if (!settings.apiBase) {
      return "API URL is required.";
    }

    if (!/^https?:\/\//i.test(settings.apiBase)) {
      return "API URL must start with http:// or https://";
    }

    if (!settings.profileId || settings.profileId.length < 3) {
      return "Profile ID must be at least 3 characters.";
    }

    if (!settings.syncKey || settings.syncKey.length < 8) {
      return "Sync key must be at least 8 characters.";
    }

    return "";
  }

  function readFormSettings() {
    const ui = getUi();

    return {
      apiBase: normalizeApiBase(ui.apiBase.value),
      profileId: normalizeProfileId(ui.profileId.value),
      syncKey: ui.syncKey.value.trim()
    };
  }

  async function connectSync() {
    const settings = readFormSettings();
    const validationError = validateSettings(settings);

    if (validationError) {
      setFeedback(validationError, "error");
      return;
    }

    persistSyncSettings(settings);
    syncSession.mode = "connecting";
    syncSession.connected = false;
    updateSyncUi();

    try {
      await verifyBackend(settings.apiBase);
      const localSnapshot = buildSnapshot({ touch: false });
      const remotePayload = await loadRemoteSnapshot(settings);

      syncSession.connected = true;

      if (!remotePayload) {
        await saveRemoteSnapshot("manual", localSnapshot);
        return;
      }

      const remoteSnapshot = normalizeSnapshot(remotePayload.state);
      const localUpdatedAt = localSnapshot.updatedAt || 0;
      const remoteUpdatedAt = remoteSnapshot.updatedAt || 0;

      if (remoteUpdatedAt > localUpdatedAt) {
        applySnapshot(remoteSnapshot);
        syncSession.lastSyncedAt = remoteUpdatedAt;
        setFeedback(
          `Cloud progress loaded on this device. Last synced: ${formatTimestamp(remoteUpdatedAt)}.`,
          "success"
        );
      } else if (localUpdatedAt > remoteUpdatedAt) {
        await saveRemoteSnapshot("manual", localSnapshot);
      } else {
        syncSession.lastSyncedAt = remoteUpdatedAt;
        setFeedback(
          `Cloud sync connected. Last synced: ${formatTimestamp(remoteUpdatedAt)}.`,
          "success"
        );
      }
    } catch (error) {
      syncSession.connected = false;
      setFeedback(`Unable to connect: ${error.message}`, "error");
    } finally {
      syncSession.mode = "idle";
      updateSyncUi();
    }
  }

  function scheduleAutoSync() {
    if (!syncSession.connected) {
      return;
    }

    window.clearTimeout(syncSession.timerId);
    syncSession.timerId = window.setTimeout(async () => {
      try {
        await saveRemoteSnapshot("auto");
      } catch (_) {
        return;
      }

      if (syncSession.pendingAutoSync) {
        syncSession.pendingAutoSync = false;
        scheduleAutoSync();
      }
    }, 500);
  }

  function installStyles() {
    if (document.getElementById("cloudSyncStyles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "cloudSyncStyles";
    style.textContent = `
      .cloud-sync-card {
        margin-top: 14px;
        border: 1px solid rgba(215, 219, 226, 0.22);
        background: linear-gradient(180deg, rgba(21, 24, 29, 0.94), rgba(16, 18, 22, 0.86));
        border-radius: 16px;
        padding: 16px;
      }
      .cloud-sync-head {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: flex-start;
        margin-bottom: 8px;
      }
      .cloud-sync-eyebrow {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--muted);
        margin-bottom: 4px;
      }
      .cloud-sync-title {
        font-family: var(--display);
        font-size: 20px;
        color: var(--p4);
        line-height: 1.1;
      }
      .cloud-sync-pill {
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 999px;
        font-size: 10px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        padding: 6px 10px;
        white-space: nowrap;
      }
      .cloud-sync-pill[data-state="success"] {
        color: var(--ok);
        border-color: rgba(52, 211, 153, 0.35);
        background: rgba(52, 211, 153, 0.12);
      }
      .cloud-sync-pill[data-state="error"] {
        color: var(--danger);
        border-color: rgba(239, 68, 68, 0.35);
        background: rgba(239, 68, 68, 0.12);
      }
      .cloud-sync-pill[data-state="busy"] {
        color: var(--warn);
        border-color: rgba(245, 158, 11, 0.35);
        background: rgba(245, 158, 11, 0.12);
      }
      .cloud-sync-copy {
        font-size: 12px;
        line-height: 1.55;
        color: rgba(220, 230, 240, 0.78);
        margin-bottom: 12px;
      }
      .cloud-sync-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }
      .cloud-sync-field {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .cloud-sync-field span {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .cloud-sync-field input {
        width: 100%;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.04);
        color: var(--p4);
        padding: 10px 12px;
        font-size: 12px;
        outline: none;
      }
      .cloud-sync-field input:focus {
        border-color: rgba(215, 219, 226, 0.4);
        box-shadow: 0 0 0 3px rgba(215, 219, 226, 0.08);
      }
      .cloud-sync-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 12px;
      }
      .cloud-sync-actions button {
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        padding: 10px 14px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        color: var(--p4);
        background: rgba(255, 255, 255, 0.04);
      }
      .cloud-sync-actions button:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.08);
      }
      .cloud-sync-actions button:disabled {
        opacity: 0.6;
        cursor: wait;
      }
      .cloud-sync-feedback {
        margin-top: 10px;
        font-size: 12px;
        line-height: 1.55;
        color: rgba(220, 230, 240, 0.72);
      }
      .cloud-sync-feedback[data-tone="error"] {
        color: #fca5a5;
      }
      .cloud-sync-feedback[data-tone="success"] {
        color: #86efac;
      }
      @media (max-width: 760px) {
        .cloud-sync-grid {
          grid-template-columns: 1fr;
        }
        .cloud-sync-head {
          flex-direction: column;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function installPanel() {
    if (document.getElementById("cloudSyncPanel")) {
      return;
    }

    const progressCard = document.querySelector(".progress-card");
    if (!progressCard) {
      return;
    }

    const settings = readSyncSettings();
    const card = document.createElement("section");
    card.id = "cloudSyncPanel";
    card.className = "cloud-sync-card";
    card.innerHTML = `
      <div class="cloud-sync-head">
        <div>
          <p class="cloud-sync-eyebrow">Cloud Sync</p>
          <h2 class="cloud-sync-title">Access your checklist anywhere</h2>
        </div>
        <span class="cloud-sync-pill" id="syncStatusPill" data-state="neutral">Local Only</span>
      </div>
      <p class="cloud-sync-copy">
        Save your roadmap checklist to a backend instead of only this browser.
        If the frontend still lives on GitHub Pages, point API URL to the separate backend you deploy for this roadmap.
      </p>
      <div class="cloud-sync-grid">
        <label class="cloud-sync-field">
          <span>API URL</span>
          <input id="syncApiBase" type="url" placeholder="https://roadmap-api.example.com" value="${settings.apiBase}">
        </label>
        <label class="cloud-sync-field">
          <span>Profile ID</span>
          <input id="syncProfileId" type="text" placeholder="johnchrisley" value="${settings.profileId}">
        </label>
        <label class="cloud-sync-field">
          <span>Sync Key</span>
          <input id="syncKey" type="password" placeholder="At least 8 characters" value="${settings.syncKey}">
        </label>
      </div>
      <div class="cloud-sync-actions">
        <button id="syncConnectButton" type="button">Connect</button>
        <button id="syncSaveButton" type="button">Sync Now</button>
      </div>
      <p class="cloud-sync-feedback" id="syncFeedback" data-tone="neutral"></p>
    `;

    progressCard.insertAdjacentElement("afterend", card);

    const ui = getUi();
    ui.connectButton.addEventListener("click", () => {
      void connectSync();
    });

    ui.saveButton.addEventListener("click", async () => {
      if (!syncSession.connected) {
        await connectSync();
        return;
      }

      try {
        await saveRemoteSnapshot("manual");
      } catch (_) {
        return;
      }
    });

    updateSyncUi();
  }

  const initialSnapshot = readStoredLocalSnapshot();
  state.openSkills = initialSnapshot.openSkills;
  state.updatedAt = initialSnapshot.updatedAt;

  save = function saveState(options) {
    const config = options || {};
    const snapshot = buildSnapshot({ touch: config.touch !== false });
    persistLocalSnapshot(snapshot);

    if (config.skipRemote) {
      return;
    }

    if (!syncSession.connected) {
      setFeedback("Saved locally. Connect cloud sync when you are ready.", "neutral");
      return;
    }

    if (syncSession.mode !== "idle") {
      syncSession.pendingAutoSync = true;
      return;
    }

    scheduleAutoSync();
  };

  installStyles();
  installPanel();
  updateSyncUi();

  const savedSettings = readSyncSettings();
  if (savedSettings.syncKey) {
    setFeedback("Saved cloud settings found on this device. Reconnecting...", "neutral");
    void connectSync();
  }
})();
