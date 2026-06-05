/* ════════════════════════════════════════════════════════════════
   Agent Loft — User Portal
   ════════════════════════════════════════════════════════════════ */

/* ─── Webhook URLs ──────────────────────────────────────────── */
const SIGNUP_URL =
  "https://n8n.agent-loft.com/webhook/4de196b7-2ad2-4f9a-9b4d-dc8d3b30865b";
const AGENTS_URL =
  "https://n8n.agent-loft.com/webhook/73b31740-d2c7-46d7-ab71-7a3fef5f77ff";
const KEYS_URL =
  "https://n8n.agent-loft.com/webhook/1f1a6a11-727b-4965-a59a-fde77806d27f";
const PASSWORD_URL =
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
const REFERRAL_URL =
  "https://n8n.agent-loft.com/webhook/5bb4169d-284a-4006-8952-fcc325da2d22";
const CONTRACT_URL =
  "https://n8n.agent-loft.com/webhook/18591766-147e-4bcb-b9ac-b0f9a92e74bf";
const CONTRACT_EXTEND_URL = "https://agent-loft.com"; // ← replace with Stripe payment link
const CONTRACT_CANCEL_URL = "https://agent-loft.com"; // ← replace with Stripe cancellation link
const COUPON_URL =
  "https://n8n.agent-loft.com/webhook/fd6375cb-6d73-4482-bfa3-ef8365f43a67";
// WIZZARD=false is written via AGENT_INFO_URL (POST { uuid, key, value })
const AUTH_URL =
  "https://n8n.agent-loft.com/webhook/e256310a-6627-45ba-a221-599751943fe6";
const ACCOUNT_PASSWORD_URL =
  "https://n8n.agent-loft.com/webhook/4644f196-a31c-4d1a-b76e-03e9afe39302";

/* ─── State ─────────────────────────────────────────────────── */
let currentEmail = null;
let currentSession = null;
let couponApplied = false;
let agents = [];
let activeUUID = null;
let activeAgentInfo = null;
let chatId = null; // generated on first panel open
let talkOpen = false;

// Wizard state
let wizardPhase = null; // 'skills' | 'integrations' | 'fields' | 'review'
let wizardSkillsData = null; // cached from skills/index.json
let wizardIntegrationsData = null; // cached from integrations/index.json
let wizardSkillsCache = {}; // { filename: full skill object (with prompt) }
let wizardIntegrationsCache = {}; // { filename: full integration object (with prompt) }
let wizardSelectedSkills = new Set();
let wizardSelectedIntegrations = new Set();
let wizardFieldValues = {}; // { stepIndex: { fieldKey: value } }
let wizardIntegrationStep = 0; // current index in fields phase
let wizardSelectedIntegrationList = []; // ordered list of selected integration objects

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
  const sessionId = getCookie("al_session");
  if (sessionId) {
    currentSession = sessionId;
    currentEmail = getCookie("al_email") || "";
    showApp();
    loadAgents();
  } else {
    showAuth();
  }

  // Close confirm on backdrop click
  document.getElementById("confirm-backdrop").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) confirmClose(false);
  });

  // Close user panel when clicking outside of it
  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("user-panel-wrap");
    if (wrap && !wrap.contains(e.target)) closeUserPanel();
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
  const password = document.getElementById("signin-password").value;
  hideAuthError("signin-error");

  if (!isValidEmail(email)) {
    showAuthError("signin-error", "Please enter a valid email address.");
    return;
  }
  if (!password) {
    showAuthError("signin-error", "Please enter your password.");
    return;
  }

  const btn = document.getElementById("signin-btn");
  btnLoad(btn, "Signing in\u2026");

  try {
    dbg("\u2192 Sign In", AUTH_URL);
    const res = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok)
      throw new Error(
        "Account not found or incorrect password. Please try again.",
      );

    const data = await res.json();
    dbg("\u2190 Sign In", data);
    const raw = Array.isArray(data) ? data[0] : data;
    // unwrap n8n {json:{...}} envelope if present
    const item =
      raw && typeof raw === "object" && "json" in raw ? raw.json : raw;
    const sessionId = item?.sessionid;
    if (!sessionId) throw new Error("Authentication failed. Please try again.");

    currentSession = sessionId;
    currentEmail = email;
    setCookie("al_session", sessionId, 30);
    setCookie("al_email", email, 30);
    showApp();
    loadAgents();
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
  btnLoad(btn, "Hiring agent\u2026");

  // Open a blank tab NOW while we still have the user-gesture context.
  // Browsers block window.open called after an await, so we must do this
  // synchronously before any async work begins.
  const stripeTab = window.open("", "_blank");

  try {
    // Step 1: authenticate to get a session
    dbg("\u2192 Hire Agent \u2013 auth", AUTH_URL);
    const authRes = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!authRes.ok)
      throw new Error("Account creation failed. Please try again later.");

    const authData = await authRes.json();
    dbg("\u2190 Hire Agent \u2013 auth", authData);
    const authRaw = Array.isArray(authData) ? authData[0] : authData;
    // unwrap n8n {json:{...}} envelope if present
    const authItem =
      authRaw && typeof authRaw === "object" && "json" in authRaw
        ? authRaw.json
        : authRaw;
    const sessionId = authItem?.sessionid;
    if (!sessionId)
      throw new Error("Account creation failed. Please try again.");

    currentSession = sessionId;
    currentEmail = email;
    setCookie("al_session", sessionId, 30);
    setCookie("al_email", email, 30);

    // Step 2: trigger agent creation
    dbg("\u2192 Hire Agent \u2013 create", SIGNUP_URL);
    const createRes = await fetch(SIGNUP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, agent, location }),
    });
    if (!createRes.ok) {
      throw new Error("Agent provisioning failed. Please contact support.");
    }

    const createData = await createRes.json();
    dbg("\u2190 Hire Agent \u2013 create", createData);
    const createRaw = Array.isArray(createData) ? createData[0] : createData;
    const createItem =
      createRaw && typeof createRaw === "object" && "json" in createRaw
        ? createRaw.json
        : createRaw;

    // Navigate the pre-opened tab to the Stripe checkout URL
    const checkoutUrl =
      createItem?.checkout_url || createItem?.checkoutUrl || createItem?.url;
    if (checkoutUrl && checkoutUrl.startsWith("http")) {
      stripeTab.location.href = checkoutUrl;
    } else {
      stripeTab.close();
    }

    // Enter the app and load agents now that the agent has been created
    showApp();
    loadAgents();
  } catch (err) {
    stripeTab?.close();
    showAuthError("signup-error", err.message);
  } finally {
    btnReset(btn);
  }
}

/* ═══════════════════════════════════════════════════════════════
   AUTH — sign out
═══════════════════════════════════════════════════════════════ */
/* ─── Coupon ────────────────────────────────────────────────── */
function handleCouponKey(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    applyCoupon();
  }
}

async function applyCoupon() {
  const input = document.getElementById("coupon-input");
  const spinner = document.getElementById("coupon-spinner");
  const errorEl = document.getElementById("coupon-error");
  const code = input.value.trim();

  if (!code) return;

  input.disabled = true;
  input.classList.remove("coupon-input-error");
  errorEl.style.display = "none";
  spinner.style.display = "";

  try {
    const res = await apiFetch(COUPON_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    const text = (await res.text()).trim();
    if (text === "OK") {
      // Valid coupon — hide the box, show success
      couponApplied = true;
      document.getElementById("coupon-box").style.display = "none";
      document.getElementById("coupon-success").style.display = "";
    } else {
      input.classList.add("coupon-input-error");
      errorEl.style.display = "";
      input.disabled = false;
    }
  } catch (err) {
    input.classList.add("coupon-input-error");
    errorEl.textContent = "Could not validate coupon. Try again.";
    errorEl.style.display = "";
    input.disabled = false;
  } finally {
    spinner.style.display = "none";
  }
}

function doSignOut() {
  // Invalidate server session (fire-and-forget)
  if (currentSession) {
    fetch(AUTH_URL, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": currentSession,
      },
      body: JSON.stringify({ sessionid: currentSession }),
    }).catch(() => {});
  }
  deleteCookie("al_session");
  deleteCookie("al_email");
  localStorage.removeItem("al_email"); // clean up legacy storage
  currentSession = null;
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

  // Reset coupon state
  couponApplied = false;
  const couponBox = document.getElementById("coupon-box");
  if (couponBox) couponBox.style.display = "";
  const couponSuccessEl = document.getElementById("coupon-success");
  if (couponSuccessEl) couponSuccessEl.style.display = "none";
  const couponInput = document.getElementById("coupon-input");
  if (couponInput) {
    couponInput.value = "";
    couponInput.classList.remove("coupon-input-error");
  }
  const couponError = document.getElementById("coupon-error");
  if (couponError) couponError.style.display = "none";

  closeUserPanel();
  showAuth();
}

/* ─── View switching ────────────────────────────────────────── */
function showAuth() {
  document.getElementById("auth-card").style.display = "";
  document.getElementById("app-shell").style.display = "flex";
  document.getElementById("app-shell").classList.add("demo-mode");
  document.body.classList.add("auth-layout");
  populateDemoShell();
}

function showApp() {
  const authCard = document.getElementById("auth-card");
  const shell = document.getElementById("app-shell");
  const fromAuth = document.body.classList.contains("auth-layout");

  function reveal() {
    authCard.style.display = "none";
    authCard.classList.remove("auth-leaving");
    document.body.classList.remove("auth-layout");

    // Make shell visible and play entry animation
    shell.style.display = "flex";
    shell.classList.remove("demo-mode");
    shell.classList.add("app-entering");
    document.getElementById("user-email-label").textContent = currentEmail;

    setTimeout(() => shell.classList.remove("app-entering"), 620);
  }

  if (fromAuth) {
    // Transitioning from the auth screen: animate auth card out first
    authCard.classList.add("auth-leaving");
    setTimeout(reveal, 310);
  } else {
    // Direct page load while already logged in: skip the auth animation
    reveal();
  }
}

function populateDemoShell() {
  hide("wizard-card");
  // Header
  document.getElementById("user-email-label").textContent = "preview";
  renderComment("My AI Assistant");

  // Agent tab
  document.getElementById("agent-tabs-bar").innerHTML = `
    <button class="agent-tab active">
      <span class="agent-tab-dot"></span>
      <span>hermes</span>
      <span class="agent-tab-badge">EU</span>
    </button>`;

  // Show agent panel with demo data
  hide("no-agents");
  document.getElementById("agent-panel").style.display = "flex";

  // API Keys
  const keysDot = document.getElementById("keys-status-dot");
  keysDot.className = "contract-dot contract-dot--green";
  keysDot.style.visibility = "visible";
  document.getElementById("keys-body").innerHTML = `
    <div class="key-row">
      <div class="key-info">
        <div class="key-name">Default Key
          <span style="font-size:10px;font-weight:500;padding:1px 7px;border-radius:10px;
            background:#0e2e1c;color:var(--success);margin-left:6px;vertical-align:middle;">Active</span>
        </div>
        <div class="key-stats">
          <span><span class="key-stat-val">350</span>
          <span class="text-muted"> / 500 credits remaining</span></span>
          <span class="sep-dot">&middot;</span>
          <span class="text-muted">Expires Dec 31, 2026</span>
        </div>

      </div>
      <button class="btn btn-ghost btn-sm">Buy Credits</button>
    </div>`;

  // Server info
  document.getElementById("server-info-body").innerHTML = `
    <div class="server-info-row">
      <span class="server-info-label">Agent Type</span>
      <span class="server-info-val">Hermes</span>
    </div>
    <div class="server-info-row">
      <span class="server-info-label">Dashboard</span>
      <span class="server-info-val"><a href="#" class="server-info-link" onclick="return false">hermes.agent-loft.com</a></span>
    </div>
    <div class="server-info-row server-info-row--copy" title="Click to copy">
      <span class="server-info-label">SSH Access</span>
      <span class="server-info-val server-info-copyval">ssh root@hermes.agent-loft.com -p 2201</span>
    </div>
    <div class="server-info-row">
      <span class="server-info-label">Created</span>
      <span class="server-info-val">2026-01-01</span>
    </div>`;

  // Contract
  const demoDot = document.getElementById("contract-status-dot");
  demoDot.className = "contract-dot contract-dot--green";
  demoDot.style.visibility = "visible";
  document.getElementById("contract-body").innerHTML = `
    <div class="contract-row">
      <div class="contract-info">
        <span class="contract-type">Auto - Monthly</span>
        <span class="contract-expires">No expiration</span>
      </div>
      <a href="#" class="btn btn-ghost btn-sm" style="margin-left:auto;flex-shrink:0;" onclick="return false">Cancel</a>
    </div>`;

  // Backups
  document.getElementById("backups-body").innerHTML = `
    <div class="backups-list">
      <div class="backup-row">
        <div class="backup-info"><div class="backup-date">2026-05-30 09:12</div></div>
        <button class="btn btn-ghost btn-sm">Restore</button>
      </div>
      <div class="backup-row">
        <div class="backup-info"><div class="backup-date">2026-05-31 14:47</div></div>
        <button class="btn btn-ghost btn-sm">Restore</button>
      </div>
    </div>`;
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
    const res = await apiFetch(_agentsUrl2);
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

  // Reset password field
  document.getElementById("pw-new-input").value = "";
  togglePwSave("");

  // Reset comment
  cancelComment();
  renderComment("");

  hide("wizard-card");
  loadKeys(uuid);
  loadBackups(uuid);
  loadAgentInfo(uuid);
  loadContract(uuid);
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
  hide("wizard-card");

  try {
    const _infoUrl = `${AGENT_INFO_URL}?uuid=${encodeURIComponent(uuid)}`;
    dbg("→ Agent Info", _infoUrl);
    const res = await apiFetch(_infoUrl);
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
    loadWizard(info);
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
    const res = await apiFetch(AGENT_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuid: activeUUID, key: "comment", value: text }),
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

  const port = stripQuotes(info.ssh_port);
  const sshCmd = `ssh root@${activeUUID}.agent-loft.com -p ${port}`;

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
    `<div class="server-info-row server-info-row--copy" onclick="copySSHAccess()" title="Click to copy">
      <span class="server-info-label">SSH Access</span>
      <span class="server-info-val server-info-copyval">${escHtml(sshCmd)}</span>
    </div>`,
    `<div class="server-info-row">
      <span class="server-info-label">Created</span>
      <span class="server-info-val">${escHtml(stripQuotes(info.created))}</span>
    </div>`,
  ];
  body.innerHTML = rows.join("");
}

function copySSHAccess() {
  if (!activeAgentInfo) return;
  const port = stripQuotes(activeAgentInfo.ssh_port);
  const cmd = `ssh root@${activeUUID}.agent-loft.com -p ${port}`;
  navigator.clipboard
    .writeText(cmd)
    .then(() => toast("SSH command copied to clipboard.", "info"))
    .catch(() => toast("Could not access clipboard.", "error"));
}

function openAgent() {
  if (!activeAgentInfo) {
    toast("Agent info not loaded yet.", "warning");
    return;
  }
  const domain = stripQuotes(activeAgentInfo.domain);
  if (!domain || domain === "\u2014") {
    toast("No dashboard URL available for this agent.", "warning");
    return;
  }
  const href = domain.startsWith("http") ? domain : `https://${domain}`;
  window.open(href, "_blank", "noopener");
}

function openWizard() {
  const card = document.getElementById("wizard-card");
  const btn = document.getElementById("wizard-toggle-btn");
  if (card.style.display !== "none") {
    // Wizard is visible — close it, restore button label
    hide("wizard-card");
    if (btn) btn.textContent = "Integrations";
    return;
  }
  // Wizard is hidden — open from step 1, update button label
  wizardPhase = "skills";
  wizardSelectedSkills = new Set();
  wizardSelectedIntegrations = new Set();
  wizardFieldValues = {};
  wizardIntegrationStep = 0;
  wizardSelectedIntegrationList = [];
  show("wizard-card");
  if (btn) btn.textContent = "Backup";
  renderWizardStep();
}

/* ═══════════════════════════════════════════════════════════════
   KEYS
═══════════════════════════════════════════════════════════════ */
async function loadKeys(uuid) {
  const body = document.getElementById("keys-body");
  body.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';
  document.getElementById("keys-status-dot").style.visibility = "hidden";

  try {
    const _keysUrl = `${KEYS_URL}?uuid=${encodeURIComponent(uuid)}`;
    dbg("→ List API Keys", _keysUrl);
    const res = await apiFetch(_keysUrl);
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
  const dot = document.getElementById("keys-status-dot");

  if (!keys.length) {
    dot.className = "contract-dot contract-dot--red";
    dot.style.visibility = "visible";
    body.innerHTML =
      '<p class="text-muted" style="font-size:13px; padding: 4px 0;">No API keys found.</p>';
    return;
  }

  const hasActive = keys.some((k) => !k.disabled);
  dot.className = `contract-dot ${hasActive ? "contract-dot--green" : "contract-dot--red"}`;
  dot.style.visibility = "visible";

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
                <div class="key-stats">
                    <span>
                        <span class="key-stat-val">${k.limit_remaining ?? "\u2014"}</span>
                        <span class="text-muted"> / ${total} credits remaining</span>
                    </span>
                    <span class="sep-dot">&middot;</span>
                    <span class="text-muted">Expires ${exp}</span>
                </div>

            </div>
            <button class="btn btn-ghost btn-sm"
                    style="align-self:center"
                    onclick="buyCredits('${escAttr(k.name)}')">
                Buy Credits
            </button>
        </div>`;
    })
    .join("");
}

function buyCredits(keyName) {
  toast(`Opening Agent Loft to purchase credits\u2026`, "info");
  window.open("https://agent-loft.com", "_blank");
}

/* ═══════════════════════════════════════════════════════════════
   INSTANCE PASSWORD
═══════════════════════════════════════════════════════════════ */
function togglePwSave(value) {
  document.getElementById("pw-save-btn").style.display = value
    ? "flex"
    : "none";
}

async function savePassword() {
  const newPw = document.getElementById("pw-new-input").value;
  const btn = document.getElementById("pw-save-btn");

  if (!newPw) {
    toast("Please enter a new password.", "warning");
    return;
  }
  if (newPw.length < 8) {
    toast("Password must be at least 8 characters.", "warning");
    return;
  }

  // Lock the button immediately so a second click can't corrupt the dialog Promise
  btn.disabled = true;

  const ok = await confirmDialog(
    "Update Instance Password",
    "This will immediately update the root password on your server. Make sure to save it somewhere safe. Continue?",
  );

  if (!ok) {
    btn.disabled = false; // user cancelled — restore button
    return;
  }

  btnLoad(btn, "Saving\u2026");

  try {
    dbg("\u2192 Update Password", PASSWORD_URL);
    const res = await apiFetch(PASSWORD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uuid: activeUUID,
        email: currentEmail,
        password: newPw,
      }),
    });
    if (!res.ok)
      throw new Error(`Failed to update password (HTTP ${res.status}).`);

    toast("Password updated successfully.", "success");
    document.getElementById("pw-new-input").value = "";
    togglePwSave("");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btnReset(btn);
  }
}

/* ═══════════════════════════════════════════════════════════════
   ACCOUNT / USER PANEL
═══════════════════════════════════════════════════════════════ */
function toggleUserPanel() {
  const panel = document.getElementById("user-panel");
  if (!panel) return;
  if (panel.style.display === "none" || panel.style.display === "") {
    document.getElementById("user-panel-email-val").textContent =
      currentEmail || "—";
    panel.style.display = "block";
  } else {
    closeUserPanel();
  }
}

function closeUserPanel() {
  const panel = document.getElementById("user-panel");
  if (!panel) return;
  panel.style.display = "none";
  const inp = document.getElementById("acct-pw-input");
  if (inp) inp.value = "";
  const btn = document.getElementById("acct-pw-save-btn");
  if (btn) btn.style.display = "none";
}

function toggleAccountPwSave(value) {
  const btn = document.getElementById("acct-pw-save-btn");
  if (btn) btn.style.display = value ? "flex" : "none";
}

async function saveAccountPassword() {
  const newPw = document.getElementById("acct-pw-input").value;
  const btn = document.getElementById("acct-pw-save-btn");

  if (!newPw) {
    toast("Please enter a new password.", "warning");
    return;
  }
  if (newPw.length < 8) {
    toast("Password must be at least 8 characters.", "warning");
    return;
  }

  btn.disabled = true;
  const ok = await confirmDialog(
    "Change Account Password",
    "This will update your account login password immediately. Continue?",
  );
  if (!ok) {
    btn.disabled = false;
    return;
  }

  btnLoad(btn, "");
  try {
    dbg("→ Update Account Password", ACCOUNT_PASSWORD_URL);
    const res = await apiFetch(ACCOUNT_PASSWORD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: currentEmail, password: newPw }),
    });
    if (!res.ok)
      throw new Error(
        `Failed to update account password (HTTP ${res.status}).`,
      );

    toast("Account password updated.", "success");
    closeUserPanel();
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
    "Restart Agent",
    "Your agent will be unavailable for a few minutes while it restarts. This will interrupt any active sessions. Continue?",
  );
  if (!ok) return;

  const btn = document.getElementById("restart-btn");
  btnLoad(btn, "Restarting\u2026");

  try {
    dbg("→ Restart Agent", RESTART_URL);
    const res = await apiFetch(RESTART_URL, {
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
        </svg> Restart Agent`;
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
    const res = await apiFetch(_backupsUrl);
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

  const rows = [...backups]
    .sort((a, b) => {
      const da = new Date(
        a.start || a.created_at || a.createdAt || a.date || a.timestamp || 0,
      );
      const db = new Date(
        b.start || b.created_at || b.createdAt || b.date || b.timestamp || 0,
      );
      return db - da;
    })
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
    const res = await apiFetch(BACKUP_URL, {
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
    const res = await apiFetch(BACKUP_URL, {
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
   CONTRACT
═══════════════════════════════════════════════════════════════ */
async function loadContract(uuid) {
  const body = document.getElementById("contract-body");
  body.innerHTML = '<div class="loading-row"><div class="spinner"></div></div>';
  document.getElementById("contract-status-dot").style.visibility = "hidden";
  try {
    const url = `${CONTRACT_URL}?uuid=${encodeURIComponent(uuid)}`;
    dbg("\u2192 Contract", url);
    const res = await apiFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    dbg("\u2190 Contract", data);
    renderContract(Array.isArray(data) ? data : [data]);
  } catch (err) {
    body.innerHTML = `<p class="inline-error" style="padding:14px 16px">${escHtml(err.message)}</p>`;
  }
}

function renderContract(data) {
  const body = document.getElementById("contract-body");
  const headerDot = document.getElementById("contract-status-dot");

  if (!data || !data.length) {
    body.innerHTML =
      '<p class="inline-error" style="padding:14px 16px">No contract data.</p>';
    return;
  }

  const item = data[0];
  const type = (item.type || "").trim();
  const expires = item.expires || "";

  // Determine status
  const t = type.toLowerCase();
  let expired = false;
  if (expires && expires.trim()) {
    try {
      expired = new Date(expires) < new Date();
    } catch (_) {}
  }

  let statusClass;
  if (!type || expired || t.includes("none")) {
    statusClass = "contract-dot--red";
  } else if (t.includes("auto")) {
    statusClass = "contract-dot--green";
  } else {
    statusClass = "contract-dot--yellow";
  }

  // Update the header dot
  headerDot.className = `contract-dot ${statusClass}`;
  headerDot.style.visibility = "visible";

  // Empty type — show placeholder row with extend button on the right
  if (!type) {
    body.innerHTML = `
      <div class="contract-row">
        <div class="contract-info">
          <span class="contract-type">No contract</span>
          <span class="contract-expires">Stripe payments can take up to 24hrs to be recognized.</span>
        </div>
        <a href="${escAttr(CONTRACT_EXTEND_URL)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="margin-left:auto;flex-shrink:0;">Extend Contract</a>
      </div>`;
    return;
  }

  const expLabel =
    expires && expires.trim()
      ? new Date(expires).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "No expiration";

  const extendHtml =
    statusClass === "contract-dot--red"
      ? `<a href="${escAttr(CONTRACT_EXTEND_URL)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="margin-top:8px;display:inline-flex;">Extend Contract</a>`
      : "";

  const cancelHtml =
    statusClass === "contract-dot--green"
      ? `<a href="${escAttr(CONTRACT_CANCEL_URL)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="margin-left:auto;flex-shrink:0;">Cancel</a>`
      : "";

  body.innerHTML = `
    <div class="contract-row">
      <div class="contract-info">
        <span class="contract-type">${escHtml(type)}</span>
        <span class="contract-expires">${escHtml(expLabel)}</span>
        ${extendHtml}
      </div>
      ${cancelHtml}
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   WIZARD (Integrations setup)
═══════════════════════════════════════════════════════════════ */
function loadWizard(info) {
  // Check both key casings; strip n8n's extra surrounding quotes before comparing
  const rawVal = info.wizzard ?? info.WIZZARD;
  const strVal = String(rawVal ?? "")
    .replace(/^"|"$/g, "")
    .trim()
    .toLowerCase();
  const disabled = rawVal === false || strVal === "false";

  const tb = document.getElementById("wizard-toggle-btn");
  if (disabled) {
    hide("wizard-card");
    if (tb) tb.textContent = "Integrations";
    return;
  }
  // Reset selection state each time (JSON data cached across calls)
  wizardPhase = "skills";
  wizardSelectedSkills = new Set();
  wizardSelectedIntegrations = new Set();
  wizardFieldValues = {};
  wizardIntegrationStep = 0;
  wizardSelectedIntegrationList = [];
  show("wizard-card");
  if (tb) tb.textContent = "Backup";
  renderWizardStep();
}

async function renderWizardStep() {
  const body = document.getElementById("wizard-body");

  if (wizardPhase === "skills") {
    body.innerHTML =
      '<div class="loading-row"><div class="spinner"></div></div>';
    try {
      if (!wizardSkillsData) {
        const res = await fetch("skills/index.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        wizardSkillsData = await res.json();
      }
      await Promise.all(
        wizardSkillsData.map(async (file) => {
          if (!wizardSkillsCache[file]) {
            const res = await fetch(`skills/${file}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            wizardSkillsCache[file] = await res.json();
          }
        }),
      );
    } catch (err) {
      body.innerHTML = `<p class="inline-error" style="padding:10px 16px">${escHtml(err.message)}</p>`;
      return;
    }
    renderWizardSkills();
  } else if (wizardPhase === "integrations") {
    body.innerHTML =
      '<div class="loading-row"><div class="spinner"></div></div>';
    try {
      if (!wizardIntegrationsData) {
        const res = await fetch("integrations/index.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        wizardIntegrationsData = await res.json();
      }
      await Promise.all(
        wizardIntegrationsData.map(async (file) => {
          if (!wizardIntegrationsCache[file]) {
            const res = await fetch(`integrations/${file}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            wizardIntegrationsCache[file] = await res.json();
          }
        }),
      );
    } catch (err) {
      body.innerHTML = `<p class="inline-error" style="padding:10px 16px">${escHtml(err.message)}</p>`;
      return;
    }
    renderWizardIntegrations();
  } else if (wizardPhase === "fields") {
    renderWizardFields();
  } else if (wizardPhase === "review") {
    renderWizardReview();
  }

  updateWizardNav();
}

function renderWizardSkills() {
  const items = (wizardSkillsData || [])
    .map((file, i) => {
      const s = wizardSkillsCache[file] || {};
      return `<label class="wizard-list-item" data-name="${escAttr((s.name || "").toLowerCase())}" data-desc="${escAttr((s.description || "").toLowerCase())}">
          <input type="checkbox" ${wizardSelectedSkills.has(i) ? "checked" : ""}
                 onchange="wizardToggleSkill(${i},this.checked)">
          <span class="wizard-list-item-content">
            <span class="wizard-list-item-name">${escHtml(s.name || file)}</span>
            ${s.description ? `<span class="wizard-list-item-desc">${escHtml(s.description)}</span>` : ""}
          </span>
        </label>`;
    })
    .join("");

  document.getElementById("wizard-body").innerHTML = `
    <div style="padding:12px 16px 4px">
      <input class="wizard-search" type="text" placeholder="Search skills…"
             oninput="wizardFilter(this,'wizard-skills-list')">
      <div class="wizard-list" id="wizard-skills-list">${items}</div>
    </div>`;
}

function renderWizardIntegrations() {
  const items = (wizardIntegrationsData || [])
    .map((file, i) => {
      const s = wizardIntegrationsCache[file] || {};
      return `<label class="wizard-list-item" data-name="${escAttr((s.name || "").toLowerCase())}" data-desc="${escAttr((s.description || "").toLowerCase())}">
          <input type="checkbox" ${wizardSelectedIntegrations.has(i) ? "checked" : ""}
                 onchange="wizardToggleIntegration(${i},this.checked)">
          <span class="wizard-list-item-content">
            <span class="wizard-list-item-name">${escHtml(s.name || file)}</span>
            ${s.description ? `<span class="wizard-list-item-desc">${escHtml(s.description)}</span>` : ""}
          </span>
        </label>`;
    })
    .join("");

  document.getElementById("wizard-body").innerHTML = `
    <div style="padding:12px 16px 4px">
      <input class="wizard-search" type="text" placeholder="Search integrations…"
             oninput="wizardFilter(this,'wizard-integrations-list')">
      <div class="wizard-list" id="wizard-integrations-list">${items}</div>
    </div>`;
}

function renderWizardFields() {
  const file = wizardSelectedIntegrationList[wizardIntegrationStep];
  const integration = file ? wizardIntegrationsCache[file] : null;
  if (!integration) {
    wizardPhase = "review";
    renderWizardStep();
    return;
  }
  const saved = wizardFieldValues[wizardIntegrationStep] || {};
  const fields = integration.fields
    .map((f) => {
      const val = saved[f.key] || "";
      const input =
        f.type === "textarea"
          ? `<textarea placeholder="${escAttr(f.placeholder || "")}" rows="6"
                 oninput="wizardSetField(${wizardIntegrationStep},'${escAttr(f.key)}',this.value)">${escHtml(val)}</textarea>`
          : `<input type="${escAttr(f.type || "text")}"
                 placeholder="${escAttr(f.placeholder || "")}"
                 value="${escAttr(val)}"
                 oninput="wizardSetField(${wizardIntegrationStep},'${escAttr(f.key)}',this.value)">`;
      return `<div class="form-group"><label>${escHtml(f.label)}</label>${input}</div>`;
    })
    .join("");

  document.getElementById("wizard-body").innerHTML = `
    <div class="wizard-fields" style="padding:12px 16px 4px">
      ${fields}
      <p class="wizard-signup-hint"><a href="${escAttr(
        integration.signup_url,
      )}" target="_blank" rel="noopener">${escHtml(integration.signup_label)}</a></p>
    </div>`;
}

function renderWizardReview() {
  const prompt = buildWizardPrompt();
  document.getElementById("wizard-body").innerHTML = `
    <div class="wizard-review-area" style="padding:12px 16px 4px">
      <p class="wizard-review-intro">Review the generated init prompt below, then copy it into your agent's system prompt.</p>
      <textarea class="wizard-review-textarea" id="wizard-prompt-textarea" readonly>${escHtml(prompt)}</textarea>
    </div>`;
}

function buildWizardPrompt() {
  const parts = [];

  const skillLines = [];
  for (const i of wizardSelectedSkills) {
    const file = wizardSkillsData && wizardSkillsData[i];
    const skill = file && wizardSkillsCache[file];
    if (skill && skill.prompt) skillLines.push(skill.prompt);
  }
  if (skillLines.length) parts.push("## Skills\n\n" + skillLines.join("\n\n"));

  const intLines = [];
  for (
    let stepIdx = 0;
    stepIdx < wizardSelectedIntegrationList.length;
    stepIdx++
  ) {
    const file = wizardSelectedIntegrationList[stepIdx];
    const integration = wizardIntegrationsCache[file];
    if (!integration) continue;
    const values = wizardFieldValues[stepIdx] || {};
    let prompt = integration.prompt || "";
    for (const [k, v] of Object.entries(values)) {
      prompt = prompt.split(`{${k}}`).join(v || `{${k}}`);
    }
    intLines.push(`### ${integration.name}\n${prompt}`);
  }
  if (intLines.length)
    parts.push("## Integrations\n\n" + intLines.join("\n\n"));

  return parts.join("\n\n---\n\n") || "(No skills or integrations selected.)";
}

function updateWizardNav() {
  const backBtn = document.getElementById("wizard-back-btn");
  const nextBtn = document.getElementById("wizard-next-btn");
  const cardTitle = document.getElementById("wizard-card-title");

  let label = "";
  if (wizardPhase === "skills") label = "Select Skills";
  else if (wizardPhase === "integrations") label = "Select Integrations";
  else if (wizardPhase === "fields") {
    const file = wizardSelectedIntegrationList[wizardIntegrationStep];
    const int = file ? wizardIntegrationsCache[file] : null;
    label = int ? int.name : "";
  } else if (wizardPhase === "review") label = "Review Init Prompt";
  if (cardTitle) cardTitle.textContent = label;

  if (backBtn) {
    backBtn.style.display = wizardPhase === "skills" ? "none" : "";
    backBtn.onclick = wizardBack;
  }
  if (nextBtn) {
    nextBtn.textContent =
      wizardPhase === "review" ? "Copy & Finish" : "Next \u2192";
    nextBtn.onclick = wizardNext;
  }
}

function wizardToggleSkill(index, checked) {
  if (checked) wizardSelectedSkills.add(index);
  else wizardSelectedSkills.delete(index);
}

function wizardToggleIntegration(index, checked) {
  if (checked) wizardSelectedIntegrations.add(index);
  else wizardSelectedIntegrations.delete(index);
}

function wizardSetField(stepKey, fieldKey, value) {
  if (!wizardFieldValues[stepKey]) wizardFieldValues[stepKey] = {};
  wizardFieldValues[stepKey][fieldKey] = value;
}

function wizardFilter(input, listId) {
  const q = input.value.toLowerCase().trim();
  const list = document.getElementById(listId);
  if (!list) return;
  list.querySelectorAll(".wizard-list-item").forEach((item) => {
    const name = (item.dataset.name || "").toLowerCase();
    const desc = (item.dataset.desc || "").toLowerCase();
    item.style.display =
      !q || name.includes(q) || desc.includes(q) ? "" : "none";
  });
}

function wizardNext() {
  if (wizardPhase === "skills") {
    wizardPhase = "integrations";
    renderWizardStep();
  } else if (wizardPhase === "integrations") {
    wizardSelectedIntegrationList = (wizardIntegrationsData || []).filter(
      (_, i) => wizardSelectedIntegrations.has(i),
    );
    wizardIntegrationStep = 0;
    wizardPhase = wizardSelectedIntegrationList.length ? "fields" : "review";
    renderWizardStep();
  } else if (wizardPhase === "fields") {
    wizardIntegrationStep++;
    if (wizardIntegrationStep >= wizardSelectedIntegrationList.length) {
      wizardPhase = "review";
    }
    renderWizardStep();
  } else if (wizardPhase === "review") {
    wizardCopyAndFinish();
  }
}

function wizardBack() {
  if (wizardPhase === "integrations") {
    wizardPhase = "skills";
    renderWizardStep();
  } else if (wizardPhase === "fields") {
    if (wizardIntegrationStep > 0) {
      wizardIntegrationStep--;
    } else {
      wizardPhase = "integrations";
    }
    renderWizardStep();
  } else if (wizardPhase === "review") {
    if (wizardSelectedIntegrationList.length > 0) {
      wizardPhase = "fields";
      wizardIntegrationStep = wizardSelectedIntegrationList.length - 1;
    } else {
      wizardPhase = "integrations";
    }
    renderWizardStep();
  }
}

async function wizardCopyAndFinish() {
  const textarea = document.getElementById("wizard-prompt-textarea");
  if (!textarea) return;

  let copied = false;
  try {
    await navigator.clipboard.writeText(textarea.value);
    copied = true;
  } catch (_) {
    toast("Could not copy to clipboard — please copy manually.", "error");
    return;
  }

  // Mark wizard complete via the agent-info endpoint (non-fatal)
  try {
    await apiFetch(AGENT_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uuid: activeUUID,
        key: "WIZZARD",
        value: "false",
      }),
    });
  } catch (_) {
    /* non-fatal */
  }

  // Show success screen inside the wizard instead of closing immediately
  const cardTitle = document.getElementById("wizard-card-title");
  if (cardTitle) cardTitle.textContent = "Prompt Copied";

  document.getElementById("wizard-body").innerHTML = `
    <div style="padding:24px 20px 8px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
           stroke="var(--success)" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
      <p style="font-size:14px;font-weight:600;color:var(--text);margin:0">
        Your init prompt is in the clipboard.
      </p>
      <p style="font-size:13px;color:var(--text-muted);margin:0;max-width:300px;line-height:1.6">
        Open your agent’s console and paste the prompt
        (<strong style="color:var(--text)">Ctrl&nbsp;+&nbsp;V</strong> or
        <strong style="color:var(--text)">Cmd&nbsp;+&nbsp;V</strong>)
        to apply the configuration.
      </p>
    </div>`;

  const backBtn = document.getElementById("wizard-back-btn");
  const nextBtn = document.getElementById("wizard-next-btn");
  if (backBtn) backBtn.style.display = "none";
  if (nextBtn) {
    nextBtn.textContent = "Done";
    nextBtn.onclick = () => {
      hide("wizard-card");
      const tb = document.getElementById("wizard-toggle-btn");
      if (tb) tb.textContent = "Integrations";
    };
  }
}

function wizardDone() {
  hide("wizard-card");
  const tb = document.getElementById("wizard-toggle-btn");
  if (tb) tb.textContent = "Integrations";
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
/* ─── Cookie helpers ───────────────────────────────────────── */
function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Strict`;
}
function getCookie(name) {
  return document.cookie.split("; ").reduce((acc, c) => {
    const [k, ...rest] = c.split("=");
    return k === name ? decodeURIComponent(rest.join("=")) : acc;
  }, null);
}
function deleteCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Strict`;
}

/* ─── Authenticated fetch ───────────────────────────────────── */
// Wraps fetch() for all webhook calls — injects session header when logged in.
async function apiFetch(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    ...(currentSession ? { "X-Session-Id": currentSession } : {}),
  };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    deleteCookie("al_session");
    deleteCookie("al_email");
    localStorage.removeItem("al_email");
    location.reload();
  }
  return res;
}

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
    const res = await apiFetch(CHAT_URL, {
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
  const nameInput = document.getElementById("name");
  const input = document.getElementById("refer-email");
  const btn = document.getElementById("refer-send-btn");
  const name = nameInput.value.trim();
  const email = input.value.trim();
  if (!name) {
    toast("Please enter your friend\u2019s name.", "warning");
    return;
  }
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
    dbg("\u2192 Referral", REFERRAL_URL);
    const res = await apiFetch(REFERRAL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        referrer: currentEmail,
        friend_name: name,
        friend_email: email,
        uuid: activeUUID,
      }),
    });
    if (!res.ok) throw new Error(`Failed to send invite (HTTP ${res.status}).`);
    const json = await res.json().catch(() => null);
    dbg("\u2190 Referral", json);
    const first = Array.isArray(json) ? json[0] : json;
    const result = first && first.result;
    const success =
      typeof result === "string" &&
      result.toLowerCase().includes("invite send");
    showReferralResult(
      success ? result : "This email address has already been claimed.",
      success,
    );
    if (success) {
      input.value = "";
      nameInput.value = "";
    }
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btnReset(btn);
  }
}

function showReferralResult(text, success = true) {
  let el = document.getElementById("refer-result");
  if (!el) {
    el = document.createElement("p");
    el.id = "refer-result";
    el.className = "refer-result";
    document
      .getElementById("refer-send-btn")
      .closest(".refer-input-row")
      .insertAdjacentElement("afterend", el);
  }
  el.textContent = text;
  el.style.color = success ? "var(--success)" : "var(--warning)";
}
