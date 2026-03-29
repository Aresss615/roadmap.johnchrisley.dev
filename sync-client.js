(function roadmapSupabaseSync() {
  if (
    typeof STORAGE_KEY === "undefined" ||
    typeof render !== "function" ||
    typeof state === "undefined"
  ) {
    return;
  }

  const syncConfig = window.ROADMAP_SUPABASE_CONFIG || {};
  const hasSupabaseLibrary = Boolean(window.supabase && window.supabase.createClient);
  const hasProjectConfig = Boolean(syncConfig.url && syncConfig.anonKey);
  const syncSession = {
    client: null,
    user: null,
    connected: false,
    mode: "idle",
    timerId: 0,
    pendingAutoSync: false,
    feedback: "",
    feedbackTone: "neutral",
    lastSyncedAt: 0
  };
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

  function getUi() {
    return {
      panel:        document.getElementById("cloudSyncPanel"),
      googleButton: document.getElementById("syncGoogleButton"),
      saveButton:   document.getElementById("syncSaveButton"),
      signOutButton:document.getElementById("syncSignOutButton"),
      statusPill:   document.getElementById("syncStatusPill"),
      feedback:     document.getElementById("syncFeedback"),
      userLine:     document.getElementById("syncUserLine")
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
    if (!hasSupabaseLibrary) {
      return "Supabase library failed to load, so cloud sync is unavailable right now.";
    }

    if (!hasProjectConfig) {
      return "Add your Supabase project URL and anon key in index.html to enable free cloud sync.";
    }

    if (syncSession.mode === "loading") {
      return "Loading cloud progress...";
    }

    if (syncSession.mode === "saving") {
      return "Saving your roadmap progress online...";
    }

    if (syncSession.connected && syncSession.user && syncSession.lastSyncedAt) {
      const name = syncSession.user.user_metadata?.full_name || syncSession.user.email;
      return `Cloud sync is active for ${name}. Last sync: ${formatTimestamp(syncSession.lastSyncedAt)}.`;
    }

    if (syncSession.connected && syncSession.user) {
      const name = syncSession.user.user_metadata?.full_name || syncSession.user.email;
      return `Signed in as ${name}. Your roadmap can now sync across devices.`;
    }

    return "Checklist progress still works locally. Sign in with Google to save it online for free.";
  }

  function updateSyncUi() {
    const ui = getUi();

    if (!ui.panel) {
      return;
    }

    const hasError = syncSession.feedbackTone === "error";
    const feedbackText = syncSession.feedback || buildDefaultFeedback();
    const busy = syncSession.mode !== "idle";

    ui.feedback.textContent = feedbackText;
    ui.feedback.dataset.tone = syncSession.feedbackTone || "neutral";
    ui.googleButton.disabled = busy || syncSession.connected || !hasProjectConfig;
    ui.saveButton.disabled = busy || !syncSession.connected;
    ui.signOutButton.disabled = busy || !syncSession.connected;
    ui.userLine.hidden = !syncSession.connected;
    ui.userLine.textContent = syncSession.user
      ? `Signed in as ${syncSession.user.user_metadata?.full_name || syncSession.user.email}`
      : "";

    if (syncSession.mode === "loading" || syncSession.mode === "saving") {
      ui.statusPill.textContent = "Syncing";
      ui.statusPill.dataset.state = "busy";
    } else if (hasError) {
      ui.statusPill.textContent = "Needs Attention";
      ui.statusPill.dataset.state = "error";
    } else if (syncSession.connected) {
      ui.statusPill.textContent = "Cloud Active";
      ui.statusPill.dataset.state = "success";
    } else if (!hasProjectConfig) {
      ui.statusPill.textContent = "Setup Needed";
      ui.statusPill.dataset.state = "error";
    } else {
      ui.statusPill.textContent = "Local Only";
      ui.statusPill.dataset.state = "neutral";
    }
  }

  function createClient() {
    if (!hasSupabaseLibrary || !hasProjectConfig) {
      return null;
    }

    if (!syncSession.client) {
      syncSession.client = window.supabase.createClient(syncConfig.url, syncConfig.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
    }

    return syncSession.client;
  }

  async function saveRemoteSnapshot(reason, snapshotOverride) {
    const client = createClient();

    if (!client || !syncSession.user) {
      return;
    }

    const snapshot = snapshotOverride || buildSnapshot({ touch: false });
    syncSession.mode = "saving";
    updateSyncUi();

    try {
      const { data, error } = await client
        .from("roadmap_progress")
        .upsert(
          {
            user_id: syncSession.user.id,
            email: syncSession.user.email,
            payload: snapshot,
            updated_at_ms: snapshot.updatedAt
          },
          { onConflict: "user_id" }
        )
        .select("payload, updated_at_ms")
        .single();

      if (error) {
        throw error;
      }

      syncSession.lastSyncedAt = Number(data.updated_at_ms || snapshot.updatedAt || Date.now());
      setFeedback(
        reason === "manual"
          ? `Cloud save complete. Last synced: ${formatTimestamp(syncSession.lastSyncedAt)}.`
          : `Changes synced to Supabase. Last synced: ${formatTimestamp(syncSession.lastSyncedAt)}.`,
        "success"
      );
    } catch (error) {
      setFeedback(`Cloud sync failed: ${error.message}`, "error");
      throw error;
    } finally {
      syncSession.mode = "idle";
      updateSyncUi();
    }
  }

  async function loadRemoteSnapshot() {
    const client = createClient();

    if (!client || !syncSession.user) {
      return;
    }

    syncSession.mode = "loading";
    updateSyncUi();

    try {
      const { data, error } = await client
        .from("roadmap_progress")
        .select("payload, updated_at_ms")
        .eq("user_id", syncSession.user.id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      const localSnapshot = buildSnapshot({ touch: false });

      if (!data || !data.payload) {
        syncSession.lastSyncedAt = 0;
        setFeedback("No cloud save was found yet, so this device is still using local progress.", "neutral");
        if (localSnapshot.updatedAt > 0) {
          await saveRemoteSnapshot("manual", localSnapshot);
        }
        return;
      }

      const remoteSnapshot = normalizeSnapshot(data.payload);
      const remoteUpdatedAt = Number(data.updated_at_ms || remoteSnapshot.updatedAt || 0);
      const localUpdatedAt = Number(localSnapshot.updatedAt || 0);

      if (remoteUpdatedAt > localUpdatedAt) {
        syncSession.lastSyncedAt = remoteUpdatedAt;
        applySnapshot({ ...remoteSnapshot, updatedAt: remoteUpdatedAt });
        setFeedback(`Cloud progress loaded. Last synced: ${formatTimestamp(remoteUpdatedAt)}.`, "success");
      } else if (localUpdatedAt > remoteUpdatedAt) {
        await saveRemoteSnapshot("manual", localSnapshot);
      } else {
        syncSession.lastSyncedAt = remoteUpdatedAt;
        setFeedback(`Cloud sync connected. Last synced: ${formatTimestamp(remoteUpdatedAt)}.`, "success");
      }
    } catch (error) {
      setFeedback(`Could not load cloud progress: ${error.message}`, "error");
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

  async function signInWithGoogle() {
    const client = createClient();
    if (!client) {
      setFeedback("Supabase is not configured yet in index.html.", "error");
      return;
    }

    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });

    if (error) {
      setFeedback(`Could not start Google sign-in: ${error.message}`, "error");
    }
    // On success the browser navigates to Google — no further UI update needed here.
  }

  async function signOut() {
    const client = createClient();
    if (!client) {
      return;
    }

    await client.auth.signOut();
    syncSession.user = null;
    syncSession.connected = false;
    syncSession.lastSyncedAt = 0;
    setFeedback("Signed out. Your progress still stays in this browser locally.", "neutral");
    updateSyncUi();
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
        grid-template-columns: minmax(0, 1fr);
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
      .cloud-sync-feedback,
      .cloud-sync-user {
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
      .cloud-sync-google-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
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
        Sign in with your Google account and your checklist will sync across all your devices. The site stays fully static — Supabase's free tier handles the backend.
      </p>
      <div class="cloud-sync-actions">
        <button id="syncGoogleButton" type="button" class="cloud-sync-google-btn">
          <svg width="16" height="16" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="flex-shrink:0">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 6.293C4.672 4.166 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>
        <button id="syncSaveButton" type="button">Sync Now</button>
        <button id="syncSignOutButton" type="button">Sign Out</button>
      </div>
      <p class="cloud-sync-user" id="syncUserLine" hidden></p>
      <p class="cloud-sync-feedback" id="syncFeedback" data-tone="neutral"></p>
    `;

    progressCard.insertAdjacentElement("afterend", card);

    const ui = getUi();
    ui.googleButton.addEventListener("click", () => {
      void signInWithGoogle();
    });
    ui.saveButton.addEventListener("click", async () => {
      try {
        await saveRemoteSnapshot("manual");
      } catch (_) {
        return;
      }
    });
    ui.signOutButton.addEventListener("click", () => {
      void signOut();
    });

    updateSyncUi();
  }

  async function hydrateSession() {
    const client = createClient();

    if (!client) {
      updateSyncUi();
      return;
    }

    const { data, error } = await client.auth.getSession();
    if (error) {
      setFeedback(`Could not restore your session: ${error.message}`, "error");
      return;
    }

    syncSession.user = data.session ? data.session.user : null;
    syncSession.connected = Boolean(syncSession.user);
    updateSyncUi();

    if (syncSession.connected) {
      await loadRemoteSnapshot();
    }

    client.auth.onAuthStateChange((_event, session) => {
      syncSession.user = session ? session.user : null;
      syncSession.connected = Boolean(syncSession.user);
      updateSyncUi();

      if (syncSession.connected) {
        void loadRemoteSnapshot();
      }
    });
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
      setFeedback("Saved locally. Sign in to also keep this progress online.", "neutral");
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
  void hydrateSession();
})();
