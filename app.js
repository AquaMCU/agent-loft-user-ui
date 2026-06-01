/* ════════════════════════════════════════════════════════════════
   Agent Loft — User Portal
   ════════════════════════════════════════════════════════════════ */

/* ─── Webhook URLs ──────────────────────────────────────────── */
const SIGNUP_URL =
  "https://n8n.agent-loft.com/webhook/d32eb831-b71d-46a5-b4f0-4fbbc6b54226";
const AGENTS_URL =
  "https://n8n.agent-loft.com/webhook/73b31740-d2c7-46d7-ab71-7a3fef5f77ff";
const KEYS_URL =
  "https://n8n.agent-loft.com/webhook/1f1a6a11-727b-4965-a59a-fde77806d27f";
const SSH_URL =
  "https://n8n.agent-loft.com/webhook/51098cf4-ecfd-4db4-8977-db04f01ce2b1";
const RESTART_URL =
  "https://n8n.agent-loft.com/webhook/dac205df-66e0-4728-90e5-d784cde167af";
const BACKUP_LIST_URL =
  "https://n8n.agent-loft.com/webhook/30eaa32f-378a-4963-9d80-533229d25766";
const BACKUP_URL =
  "https://n8n.agent-loft.com/webhook/30eaa32f-378a-4963-9d80-533229d25766";
const AGENT_INFO_URL =
  "https://n8n.agent-loft.com/webhook/e01d06a3-14c3-4e4e-830f-7d4be9a5f529";
const CHAT_URL =
  "https://n8n.agent-loft.com/webhook/a58d00c4-f0c9-40cd-bb50-4f45f0442ef0";
const REFERRAL_URL = ""; // TODO: set referral webhook URL

/* ─── State ─────────────────────────────────────────────────── */
let currentEmail = null;
let agents = [];
let activeUUID = null;
let activeAgentInfo = null;
let chatId = null; // generated on first panel open
let talkOpen = false;

/* ─── Debug logger ─────────────────────────────────────────── */
function dbg(label, data) {
  console.log(`[Agent Loft] ${label}`);
  console.log(data);
}

/* ─── Response normalisers ──────────────────────────────────── */
// n8n can wrap items as {json:{…}} or double-wrap arrays [[…]]
function normalizeAgents(raw) {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    // { data: [...] } envelope — recurse into the array
    if (Array.isArray(raw.data)) return normalizeAgents(raw.data);
    // Plain single agent object — wrap it
    return [raw];
  }
  if (!Array.isArray(raw)) return [];
  // unwrap double-wrapped array: [[{…}]] → [{…}]
  if (raw.length > 0 && Array.isArray(raw[0])) return normalizeAgents(raw[0]);
  // unwrap n8n {json:{…}} envelope
  if (
    raw.length > 0 &&
    raw[0] !== null &&
    typeof raw[0] === "object" &&
    "json" in raw[0]
  ) {
    return raw.map((item) => item.json);
  }
  return raw;
}

/* ═══════════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  const saved = localStorage.getItem("al_email");
  if (saved) {
    currentEmail = saved;
    showApp();
    loadAgents();
  } else {
    showAuth();
  }

  // Close confirm on backdrop click
  document.getElementById("confirm-backdrop").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) confirmClose(false);
  });
});

/* ═══════════════════════════════════════════════════════════════
   AUTH — tab switch
═══════════════════════════════════════════════════════════════ */
function switchAuthTab(tab) {
  document
    .querySelectorAll(".auth-switch-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.getElementById("signin-form").style.display =
    tab === "signin" ? "" : "none";
  document.getElementById("signup-form").style.display =
    tab === "signup" ? "" : "none";

  // Clear stale error/success messages
  document.getElementById("signin-error").style.display = "none";
  document.getElementById("signup-error").style.display = "none";
  document.getElementById("signup-success").style.display = "none";
}

/* ═══════════════════════════════════════════════════════════════
   AUTH — sign in
   Sends the email to the agents webhook; a 200 response means
   the account exists and we proceed to the app.
═══════════════════════════════════════════════════════════════ */
async function doSignIn() {
  const email = document.getElementById("signin-email").value.trim();
  hideAuthError("signin-error");

  if (!isValidEmail(email)) {
    showAuthError("signin-error", "Please enter a valid email address.");
    return;
  }

  const btn = document.getElementById("signin-btn");
  btnLoad(btn, "Signing in\u2026");

  try {
    const _agentsUrl = `${AGENTS_URL}?email=${encodeURIComponent(email)}`;
    dbg("→ List Agents (sign-in)", _agentsUrl);
    const res = await fetch(_agentsUrl);
    if (!res.ok)
      throw new Error(
        "Account not found or service unavailable. Please try again.",
      );

    let data = [];
    try {
      data = await res.json();
    } catch (_) {
      /* empty body is fine */
    }
    dbg("← List Agents (sign-in)", data);

    currentEmail = email;
    localStorage.setItem("al_email", email);
    showApp();
    processAgents(normalizeAgents(data));
  } catch (err) {
    showAuthError("signin-error", err.message);
  } finally {
    btnReset(btn);
  }
}

/* ═══════════════════════════════════════════════════════════════
   AUTH — sign up
═══════════════════════════════════════════════════════════════ */
async function doSignUp() {
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const agent = document.getElementById("signup-agent").value;
  const location = document.getElementById("signup-location").value;

  hideAuthError("signup-error");
  document.getElementById("signup-success").style.display = "none";

  if (!isValidEmail(email)) {
    showAuthError("signup-error", "Please enter a valid email address.");
    return;
  }
  if (password.length < 8) {
    showAuthError("signup-error", "Password must be at least 8 characters.");
    return;
  }

  const btn = document.getElementById("signup-btn");
  btnLoad(btn, "Creating account\u2026");

  try {
    const res = await fetch(SIGNUP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, agent, location }),
    });
    if (!res.ok) throw new Error("Sign up failed. Please try again later.");

    // Show success — do NOT auto-login (user pays via Stripe first)
    const successEl = document.getElementById("signup-success");
    successEl.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5"
                 stroke-linecap="round" stroke-linejoin="round"
                 style="flex-shrink:0">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>Request received! Check your inbox — you will get an email from
            <strong>Stripe</strong> to complete billing setup before your agent is activated.</span>
        `;
    successEl.style.display = "flex";
    btn.style.display = "none";
  } catch (err) {
    showAuthError("signup-error", err.message);
    btnReset(btn);
  }
}

/* ═══════════════════════════════════════════════════════════════
   AUTH — sign out
═══════════════════════════════════════════════════════════════ */
function doSignOut() {
  localStorage.removeItem("al_email");
  currentEmail = null;
  agents = [];
  activeUUID = null;
  chatId = null;
  talkOpen = false;
  const tp = document.getElementById("talk-panel");
  if (tp) {
    tp.classList.remove("open");
  }
  const chev = document.getElementById("talk-chevron");
  if (chev) {
    chev.style.transform = "";
  }
  const chatMsgs = document.getElementById("chat-msgs");
  if (chatMsgs) {
    chatMsgs.innerHTML = "";
  }

  // Reset signup form state so it's clean on next visit
  document.getElementById("signup-btn").style.display = "";
  document.getElementById("signup-success").style.display = "none";
  document.getElementById("signup-email").value = "";
  document.getElementById("signup-password").value = "";

  showAuth();
}

/* ─── View switching ────────────────────────────────────────── */
function showAuth() {
  document.getElementById("auth-card").style.display = "";
  document.getElementById("app-shell").style.display = "none";
}

function showApp() {
  document.getElementById("auth-card").style.display = "none";
  document.getElementById("app-shell").style.display = "flex";
  document.getElementById("user-email-label").textContent = currentEmail;
}

/* ═══════════════════════════════════════════════════════════════
   AGENTS — load & render tabs
═══════════════════════════════════════════════════════════════ */
async function loadAgents() {
  const bar = document.getElementById("agent-tabs-bar");
  bar.innerHTML =
    '<div class="tabs-loading"><div class="spinner"></div> Loading agents&hellip;</div>';
  hide("agent-panel");
  hide("no-agents");

  try {
    const _agentsUrl2 = `${AGENTS_URL}?email=${encodeURIComponent(currentEmail)}`;
    dbg("→ List Agents", _agentsUrl2);
    const res = await fetch(_agentsUrl2);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let data = [];
    try {
      data = await res.json();
    } catch (_) {}
    dbg("← List Agents", data);
    processAgents(normalizeAgents(data));
  } catch (err) {
    bar.innerHTML = `<span class="tabs-error">${escHtml(err.message)}</span>`;
  }
}

function processAgents(data) {
  agents = data;
  dbg(
    "processAgents agents[0] (JSON)",
    agents.length ? JSON.stringify(agents[0]) : "(empty)",
  );
  renderAgentTabs();

  if (agents.length > 0) {
    // Accept UUID (spec) or uuid (n8n lowercase) as fallback
    selectAgent(agents[0].UUID || agents[0].uuid || "");
  } else {
    show("no-agents");
    hide("agent-panel");
  }
}

function renderAgentTabs() {
  const bar = document.getElementById("agent-tabs-bar");
  if (!agents.length) {
    bar.innerHTML = '<span class="tabs-empty">No agents on your account</span>';
    return;
  }
  bar.innerHTML = agents
    .map((a) => {
      const uuid = a.UUID || a.uuid || "";
      const server = a.server || "";
      return `
        <button class="agent-tab${uuid === activeUUID ? " active" : ""}"
                onclick="selectAgent('${escAttr(uuid)}')">
            <span class="agent-tab-dot"></span>
            <span>${escHtml(uuid)}</span>
            <span class="agent-tab-badge">${escHtml(server.toUpperCase())}</span>
        </button>
    `;
    })
    .join("");
}

function selectAgent(uuid) {
  activeUUID = uuid;
  renderAgentTabs();

  hide("no-agents");
  // Show agent panel using flex so its children lay out correctly
  const panel = document.getElementById("agent-panel");
  panel.style.display = "flex";

  // Reset SSH field
  document.getElementById("ssh-input").value = "";
  document.getElementById("ssh-input").placeholder =
    "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (enter new key to update)";

  // Reset comment + SSH command — placeholders until loadAgentInfo resolves
  cancelComment();
  renderComment("");
  document.getElementById("ssh-cmd-text").textContent =
    `ssh root@${uuid}.agent-loft.com -p …`;

  loadKeys(uuid);
  loadBackups(uuid);
  loadAgentInfo(uuid);
}

/* ═══════════════════════════════════════════════════════════════
   AGENT INFO
═══════════════════════════════════════════════════════════════ */
// Strip the extra surrounding quotes n8n injects into string values: '"Hermes"' → 'Hermes'
function stripQuotes(v) {
  if (v == null) return "—";
  return String(v).replace(/^"|"$/g, "").trim() || "—";
}

async function loadAgentInfo(uuid) {
  const body = document.getElementById("server-info-body");
  body.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';
  activeAgentInfo = null;

  try {
    const _infoUrl = `${AGENT_INFO_URL}?uuid=${encodeURIComponent(uuid)}`;
    dbg("→ Agent Info", _infoUrl);
    const res = await fetch(_infoUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    dbg("← Agent Info", json);

    // Unwrap [[{...}]], [{...}], or plain {...}
    let info = json;
    if (Array.isArray(info)) info = info[0]; // outer array
    if (Array.isArray(info)) info = info[0]; // inner array ([[...]])
    if (!info || typeof info !== "object")
      throw new Error("Unexpected agent info format");

    activeAgentInfo = info;
    renderAgentInfo(info);
    renderComment(info.comment);

    // Update SSH command with real port from ssh_port field
    const port = stripQuotes(info.ssh_port);
    document.getElementById("ssh-cmd-text").textContent =
      `ssh root@${uuid}.agent-loft.com -p ${port}`;
  } catch (err) {
    body.innerHTML = `<p class="inline-error">${escHtml(err.message)}</p>`;
  }
}

/* ─── Header comment ────────────────────────────────────────── */
function renderComment(text) {
  const el = document.getElementById("header-comment-display");
  if (text && text.trim()) {
    el.textContent = stripQuotes(text);
    el.classList.remove("comment-empty");
  } else {
    el.textContent = "Name your Agent";
    el.classList.add("comment-empty");
  }
}

function editComment() {
  const display = document.getElementById("header-comment-display");
  const edit = document.getElementById("header-comment-edit");
  const input = document.getElementById("header-comment-input");
  const current = display.classList.contains("comment-empty")
    ? ""
    : display.textContent;
  input.value = current;
  display.style.display = "none";
  edit.style.display = "flex";
  input.focus();
  input.select();
}

function cancelComment() {
  document.getElementById("header-comment-display").style.display = "";
  document.getElementById("header-comment-edit").style.display = "none";
}

function handleCommentKey(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    saveComment();
  }
  if (e.key === "Escape") cancelComment();
}

async function saveComment() {
  const input = document.getElementById("header-comment-input");
  const btn = document.getElementById("comment-save-btn");
  const text = input.value.trim();
  btnLoad(btn, "Saving…");
  try {
    dbg("→ Save Comment", AGENT_INFO_URL);
    const res = await fetch(AGENT_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuid: activeUUID, comment: text }),
    });
    if (!res.ok)
      throw new Error(`Failed to save comment (HTTP ${res.status}).`);
    renderComment(text);
    cancelComment();
    toast("Comment saved.", "success");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btnReset(btn);
  }
}

function renderAgentInfo(info) {
  const body = document.getElementById("server-info-body");
  const domain = stripQuotes(info.domain);
  const domainHref =
    domain !== "—"
      ? domain.startsWith("http")
        ? domain
        : `https://${domain}`
      : null;

  const rows = [
    `<div class="server-info-row">
      <span class="server-info-label">Agent Type</span>
      <span class="server-info-val">${escHtml(stripQuotes(info.agent))}</span>
    </div>`,
    `<div class="server-info-row">
      <span class="server-info-label">Dashboard</span>
      <span class="server-info-val">${
        domainHref
          ? `<a href="${escAttr(domainHref)}" target="_blank" rel="noopener" class="server-info-link">${escHtml(domain)}</a>`
          : escHtml(domain)
      }</span>
    </div>`,
    `<div class="server-info-row">
      <span class="server-info-label">SSH Port</span>
      <span class="server-info-val">${escHtml(stripQuotes(info.ssh_port))}</span>
    </div>`,
    `<div class="server-info-row">
      <span class="server-info-label">Created</span>
      <span class="server-info-val">${escHtml(stripQuotes(info.created))}</span>
    </div>`,
  ];
  body.innerHTML = rows.join("");
}

/* ═══════════════════════════════════════════════════════════════
   KEYS
═══════════════════════════════════════════════════════════════ */
async function loadKeys(uuid) {
  const body = document.getElementById("keys-body");
  body.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';

  try {
    const _keysUrl = `${KEYS_URL}?uuid=${encodeURIComponent(uuid)}`;
    dbg("→ List API Keys", _keysUrl);
    const res = await fetch(_keysUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    dbg("← List API Keys", json);
    // Response is [{data: [...]}, ...]  or  {data: [...]}  or  flat array
    const first = Array.isArray(json) ? json[0] : json;
    const keys =
      first && Array.isArray(first.data)
        ? first.data
        : Array.isArray(json)
          ? json
          : [];
    renderKeys(keys);
  } catch (err) {
    body.innerHTML = `<p class="inline-error">${escHtml(err.message)}</p>`;
  }
}

function renderKeys(keys) {
  const body = document.getElementById("keys-body");

  if (!keys.length) {
    body.innerHTML =
      '<p class="text-muted" style="font-size:13px; padding: 4px 0;">No API keys found.</p>';
    return;
  }

  body.innerHTML = keys
    .map((k) => {
      const used = (k.limit || 0) - (k.limit_remaining || 0);
      const total = k.limit || 0;
      const pct =
        total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
      const progClass =
        pct < 50 ? "prog-low" : pct < 80 ? "prog-mid" : "prog-high";
      const exp = k.expires_at
        ? new Date(k.expires_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "\u2014";
      const statusColor = k.disabled ? "var(--danger)" : "var(--success)";
      const statusLabel = k.disabled ? "Disabled" : "Active";

      return `
        <div class="key-row">
            <div class="key-info">
                <div class="key-name">
                    ${escHtml(k.name)}
                    <span style="font-size:10px; font-weight:500; padding:1px 7px; border-radius:10px;
                                 background:${k.disabled ? "var(--danger-dim)" : "#0e2e1c"};
                                 color:${statusColor}; margin-left:6px; vertical-align:middle;">
                        ${statusLabel}
                    </span>
                </div>
                <code class="key-label">${escHtml(k.label)}</code>
                <div class="key-stats">
                    <span>
                        <span class="key-stat-val">${k.limit_remaining ?? "\u2014"}</span>
                        <span class="text-muted"> / ${total} credits remaining</span>
                    </span>
                    <span class="sep-dot">&middot;</span>
                    <span class="text-muted">Expires ${exp}</span>
                </div>
                <div class="prog-wrap">
                    <div class="prog-bar ${progClass}" style="width:${pct}%"></div>
                </div>
            </div>
            <button class="btn btn-primary btn-sm"
                    style="align-self:center"
                    onclick="buyCredits('${escAttr(k.name)}')">
                Buy Credits
            </button>
        </div>`;
    })
    .join("");
}

function copySSHCommand(btn) {
  const cmd = document.getElementById("ssh-cmd-text").textContent;
  if (!cmd) return;
  navigator.clipboard
    .writeText(cmd)
    .then(() => {
      const orig = btn.innerHTML;
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg> Copied!`;
      setTimeout(() => {
        btn.innerHTML = orig;
      }, 1800);
    })
    .catch(() => toast("Could not access clipboard.", "error"));
}

function buyCredits(keyName) {
  toast(`Opening Agent Loft to purchase credits\u2026`, "info");
  window.open("https://agent-loft.com", "_blank");
}

/* ═══════════════════════════════════════════════════════════════
   SSH KEY
═══════════════════════════════════════════════════════════════ */
async function saveSSHKey() {
  const key = document.getElementById("ssh-input").value.trim();
  if (!key) {
    toast("Please paste your SSH public key first.", "warning");
    return;
  }

  const ok = await confirmDialog(
    "Update SSH Key",
    "This will replace the SSH key on your server. You will need the matching private key to connect after this change. Continue?",
  );
  if (!ok) return;

  const btn = document.getElementById("ssh-save-btn");
  btnLoad(btn, "Saving\u2026");

  try {
    dbg("→ Update SSH Key", KEYS_URL);
    const res = await fetch(KEYS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uuid: activeUUID,
        email: currentEmail,
        ssh_key: key,
      }),
    });
    if (!res.ok)
      throw new Error(`Failed to save SSH key (HTTP ${res.status}).`);

    toast("SSH key updated successfully.", "success");
    document.getElementById("ssh-input").value = "";
    document.getElementById("ssh-input").placeholder =
      "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (updated \u2713)";
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btnReset(btn);
  }
}

/* ═══════════════════════════════════════════════════════════════
   RESTART
═══════════════════════════════════════════════════════════════ */
async function doRestart() {
  const ok = await confirmDialog(
    "Restart Server",
    "Your agent will be unavailable for a few minutes while the server restarts. This will interrupt any active sessions. Continue?",
  );
  if (!ok) return;

  const btn = document.getElementById("restart-btn");
  btnLoad(btn, "Restarting\u2026");

  try {
    dbg("→ Restart Server", RESTART_URL);
    const res = await fetch(RESTART_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uuid: activeUUID,
        email: currentEmail,
        action: "restart",
      }),
    });
    if (!res.ok)
      throw new Error(`Restart request failed (HTTP ${res.status}).`);
    toast(
      "Restart initiated \u2014 your agent will be back shortly.",
      "success",
    );
  } catch (err) {
    toast(err.message, "error");
  } finally {
    // Rebuild button with its SVG icon
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 4v6h-6"/>
            <path d="M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.36-3.36L23 10M1 14l5.13 4.36A9 9 0 0 0 20.49 15"/>
        </svg> Restart Server`;
  }
}

/* ═══════════════════════════════════════════════════════════════
   BACKUPS — load, render, create, restore
═══════════════════════════════════════════════════════════════ */
async function loadBackups(uuid) {
  const body = document.getElementById("backups-body");
  body.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';

  try {
    const _backupsUrl = `${BACKUP_LIST_URL}?uuid=${encodeURIComponent(uuid)}`;
    dbg("→ List Backups", _backupsUrl);
    const res = await fetch(_backupsUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let data = [];
    try {
      data = await res.json();
    } catch (_) {}
    dbg("← List Backups", data);
    // Response: { uuid, backup_path, archives: [{name, start, end, id}] }
    const archives =
      data && Array.isArray(data.archives)
        ? data.archives
        : Array.isArray(data)
          ? data
          : [];
    renderBackups(archives);
  } catch (err) {
    body.innerHTML = `<p class="inline-error">${escHtml(err.message)}</p>`;
  }
}

function renderBackups(backups) {
  const body = document.getElementById("backups-body");

  if (!backups.length) {
    body.innerHTML = `
            <div class="backup-empty">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="1.5"
                     stroke-linecap="round" stroke-linejoin="round" style="opacity:.3">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                No backups yet. Click <strong>Make Backup</strong> to create one.
            </div>`;
    return;
  }

  const rows = backups
    .map((b) => {
      const start = formatBackupDate(b.start);
      const id = escAttr(String(b.id || b.name || ""));
      const nm = escAttr(String(b.name || b.id || start));
      return `
        <div class="backup-row">
            <div class="backup-info">
                <div class="backup-date">${escHtml(start)}</div>
            </div>
            <button class="btn btn-ghost btn-sm"
                    data-backup-id="${id}"
                    data-backup-name="${nm}"
                    onclick="restoreBackupFromBtn(this)">
                Restore
            </button>
        </div>`;
    })
    .join("");

  body.innerHTML = `<div class="backups-list">${rows}</div>`;
}

async function makeBackup() {
  const btn = document.getElementById("make-backup-btn");
  btnLoad(btn, "…");
  try {
    dbg("→ Make Backup", BACKUP_URL);
    const res = await fetch(BACKUP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuid: activeUUID }),
    });
    if (!res.ok)
      throw new Error(`Failed to create backup (HTTP ${res.status}).`);
    toast("Backup created successfully!", "success");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btnReset(btn);
    await loadBackups(activeUUID);
  }
}

function restoreBackupFromBtn(btn) {
  restoreBackup({ id: btn.dataset.backupId, name: btn.dataset.backupName });
}

async function restoreBackup(backup) {
  const ok = await confirmDialog(
    "Restore Backup",
    `Restore "${backup.name}"? Your server data will be replaced with this backup and the agent will restart briefly.`,
  );
  if (!ok) return;

  try {
    dbg("→ Restore Backup", BACKUP_URL);
    const res = await fetch(BACKUP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uuid: activeUUID,
        email: currentEmail,
        action: "restore",
        archive_name: backup.name,
      }),
    });
    if (!res.ok) throw new Error(`Restore failed (HTTP ${res.status}).`);
    toast(
      "Restore initiated \u2014 your agent will be back shortly.",
      "success",
    );
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ═══════════════════════════════════════════════════════════════
   CONFIRM DIALOG
═══════════════════════════════════════════════════════════════ */
let _confirmResolve = null;

function confirmDialog(title, message, okLabel = "Confirm") {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-message").textContent = message;
  document.getElementById("confirm-ok-btn").textContent = okLabel;
  document.getElementById("confirm-backdrop").classList.add("open");
  return new Promise((resolve) => {
    _confirmResolve = resolve;
  });
}

function confirmClose(result) {
  document.getElementById("confirm-backdrop").classList.remove("open");
  if (_confirmResolve) {
    _confirmResolve(result);
    _confirmResolve = null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════════════════════ */
function toast(msg, type = "info", duration = 4000) {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateX(50px)";
    setTimeout(() => el.remove(), 320);
  }, duration);
}

/* ═══════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════ */
function escHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(s) {
  return escHtml(s).replace(/'/g, "&#39;");
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Format backup start "2026-06-01T17:55:07.000000" → "2026-06-01 17:55"
function formatBackupDate(s) {
  if (!s) return "—";
  // Slice to minute precision and swap T for a space
  const safe = String(s).slice(0, 16).replace("T", " ");
  return safe.length >= 16 ? safe : "—";
}

function formatDate(d) {
  if (!d) return "\u2014";
  try {
    return new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_) {
    return String(d);
  }
}

function show(id) {
  document.getElementById(id).style.display = "";
}
function hide(id) {
  document.getElementById(id).style.display = "none";
}

/* Button loading helpers */
function btnLoad(btn, label) {
  btn.disabled = true;
  btn._origHTML = btn.innerHTML;
  btn.innerHTML = `<div class="spinner-sm"></div> ${label}`;
}

function btnReset(btn) {
  btn.disabled = false;
  btn.innerHTML = btn._origHTML || "";
}

/* Auth error helpers */
function showAuthError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.style.display = "flex";
}

function hideAuthError(id) {
  document.getElementById(id).style.display = "none";
}

/* ═══════════════════════════════════════════════════════════════
   TALK TO US
═══════════════════════════════════════════════════════════════ */
function toggleTalk() {
  talkOpen = !talkOpen;
  document.getElementById("talk-panel").classList.toggle("open", talkOpen);
  document
    .getElementById("talk-toggle-btn")
    .classList.toggle("active", talkOpen);
  const chev = document.getElementById("talk-chevron");
  chev.style.transform = talkOpen ? "rotate(180deg)" : "";

  if (talkOpen) {
    if (!chatId) {
      chatId = String(Math.floor(100000 + Math.random() * 900000));
      appendChatMsg("bot", "Hi! How can we help you today?");
    }
    document.getElementById("refer-own-email").textContent = currentEmail || "";
    setTimeout(() => document.getElementById("chat-input").focus(), 280);
  }
}

function appendChatMsg(from, text) {
  const msgs = document.getElementById("chat-msgs");
  const div = document.createElement("div");
  div.className = `chat-msg chat-msg-${from}`;
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function handleChatKey(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    sendChat();
  }
}

async function sendChat() {
  const input = document.getElementById("chat-input");
  const btn = document.getElementById("chat-send-btn");
  const msg = input.value.trim();
  if (!msg) return;

  appendChatMsg("user", msg);
  input.value = "";
  btnLoad(btn, "…");

  try {
    dbg("→ Chat", CHAT_URL);
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: msg,
        sessionId: chatId,
        email: currentEmail,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    dbg("← Chat", json);
    const first = Array.isArray(json) ? json[0] : json;
    const reply =
      typeof json === "string"
        ? json
        : (first &&
            (first.output ||
              first.message ||
              first.reply ||
              first.response ||
              first.text)) ||
          JSON.stringify(json);
    appendChatMsg("bot", reply);
  } catch (err) {
    appendChatMsg("bot", `Sorry, something went wrong (${err.message}).`);
  } finally {
    btnReset(btn);
    document.getElementById("chat-input").focus();
  }
}

async function sendReferral() {
  const input = document.getElementById("refer-email");
  const btn = document.getElementById("refer-send-btn");
  const email = input.value.trim();
  if (!email) {
    toast("Please enter your friend\u2019s email.", "warning");
    return;
  }
  if (!isValidEmail(email)) {
    toast("Please enter a valid email address.", "warning");
    return;
  }

  btnLoad(btn, "Sending\u2026");
  try {
    if (!REFERRAL_URL) throw new Error("Referral webhook not configured yet.");
    dbg("→ Referral", REFERRAL_URL);
    const res = await fetch(REFERRAL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referrer: currentEmail, friend_email: email }),
    });
    if (!res.ok) throw new Error(`Failed to send invite (HTTP ${res.status}).`);
    toast(
      "Invite sent! You\u2019ll earn $10 credit when your friend signs up.",
      "success",
    );
    input.value = "";
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btnReset(btn);
  }
}
