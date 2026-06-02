# AGENTS.md — Agent Loft User Portal

Read this file fully before taking any action.

---

## Project Context

Single-page user portal for **agent-loft.com** — lets customers sign up, log in, and manage their AI agents. No framework, no build step, no external dependencies.

| Item | Detail |
|---|---|
| Entry point | `index.html` — only HTML file |
| Styling | Vanilla CSS · `styles.css` (edit directly, no compilation) |
| Logic | Vanilla JS · `app.js` (edit directly, no bundler) |
| Dev server | `./start` (runs `live-server` on port 8080) |
| Auth | Email stored in `localStorage` key `al_email` |
| Backend | n8n webhooks on `n8n.agent-loft.com` |

### File map

```
index.html      ← all markup — auth card + app shell + confirm dialog
styles.css      ← all styles — design tokens, layout, components
app.js          ← all logic — auth, agents, keys, password, restart, backups, contract
start           ← dev server launcher (live-server)
AGENTS.md       ← this file
```

---

## Visual Architecture

The UI has **two mutually exclusive top-level views**. `body` is a flex container that centres whichever is visible.

```
body  (display:flex; align-items:center; justify-content:center; overflow:hidden)
 │
 ├── #auth-card        ← shown when NOT logged in  (440 px wide, auto height)
 │     ├── .auth-logo
 │     ├── .auth-switch          ← Sign In | Sign Up pill toggle
 │     ├── #signin-form
 │     └── #signup-form
 │
 └── #app-shell        ← shown when logged in  (max 1060×780 px, rounded panel)
       ├── .app-header           ← logo · email pill · Sign Out
       ├── .agent-tabs-bar       ← one pill tab per agent
       └── .app-body
             ├── #no-agents      ← shown when agent list is empty
             └── #agent-panel    ← shown for the active agent
                   └── .content-grid  (2 columns: left / right)
                         ├── .content-col [left]
                         │     ├── card: Server Actions  (#server-info-body, #restart-btn)
                         │     ├── card: Instance Password (#pw-new-input)
                         │     └── card: API Keys         (#keys-body)
                         └── .content-col [right]
                               ├── card: Backups          (#backups-body)
                               └── card: Contract         (#contract-body)
```

**Non-scrolling rule:** `body` and `#app-shell` never scroll. Only `.content-grid` (inside the shell) scrolls when content overflows, and `.backups-list` scrolls internally at `max-height: 320px`.

---

## Auth Flow

```
Page load
  └── localStorage has 'al_email'?
        Yes → showApp() + loadAgents()   ← shell made visible immediately, no auth animation
        No  → showAuth()                 ← auth card + demo shell shown side-by-side

Sign In
  └── GET AGENTS_URL?email=…&password=…
        200 → store email → showApp() (animates auth card out) → processAgents()
        !200 → show inline error

Sign Up
  └── POST SIGNUP_URL {email, password, agent, location}
        200 → open Stripe checkout tab + auto-login immediately
        !200 → show inline error

Sign Out
  └── remove 'al_email' from localStorage → showAuth()
```

The email is the only session token. There is no password verification on the frontend — authentication is enforced by the n8n webhooks.

### `showApp()` behaviour
- If called while `body.auth-layout` is present (user just signed in): animates the auth card upward and fades it out, then reveals the shell.
- If called on direct page load (user already logged in): immediately hides the auth card and shows the shell — no blink animation.
- Always sets `shell.style.display = "flex"` explicitly; the shell's default CSS is `display: none`.

---

## Design Tokens

All tokens are CSS custom properties declared in `:root` inside `styles.css`.

| Variable | Value | Usage |
|---|---|---|
| `--bg` | `#0f1117` | page background |
| `--bg-card` | `#1a1d27` | app shell / auth card surface |
| `--bg-inner` | `#141720` | inner cards, tabs bar |
| `--bg-hover` | `#22263a` | hover states, ghost button bg |
| `--bg-input` | `#12151f` | input / textarea background |
| `--border` | `#2a2f45` | default borders |
| `--border-hi` | `rgba(79,142,247,0.28)` | shell outer border glow |
| `--accent` | `#4f8ef7` | primary brand blue |
| `--accent-dim` | `#1a2d5e` | active tab bg, logo bg |
| `--danger` | `#e05252` | destructive actions, errors |
| `--danger-dim` | `#5a1f1f` | error message background |
| `--success` | `#3fc97e` | positive indicators, active dot |
| `--warning` | `#f0a04b` | mid-range credit bar, contract warning |
| `--text` | `#e4e8f5` | primary text |
| `--text-muted` | `#7a82a0` | secondary text, labels |
| `--radius` | `8px` | default border-radius |
| `--shadow` | (see CSS) | shell / auth card drop shadow |

**Never use raw hex values in HTML or JS** — always reference a token via `var(--token-name)` in CSS or as a string literal only when building inline styles in JS (acceptable only for dynamic status colours in `renderKeys` and `renderContract`).

---

## Component Patterns

### Cards
Every content block is a `.card` with `.card-header` + body content.

```html
<div class="card">
    <div class="card-header">
        <span class="card-title">
            <!-- 14×14 SVG icon --> Title
        </span>
        <!-- optional action button -->
    </div>
    <!-- body -->
</div>
```

Card backgrounds are `--bg-inner` (one level darker than the shell's `--bg-card`).

### Buttons

| Class | Colour | Use for |
|---|---|---|
| `btn btn-primary` | `--accent` blue | primary CTA (Buy Credits) |
| `btn btn-danger` | `--danger` red | destructive (Restart, Confirm) |
| `btn btn-ghost` | `--bg-hover` + border | secondary actions (Make Backup) |
| `btn btn-sm` | — modifier, smaller padding | actions inside card headers |
| `btn btn-block` | — modifier, full width | auth form submit |

#### Inline icon-only buttons
Use the `.pw-save-btn` pattern for buttons embedded inside input fields: `position: absolute`, no text, icon only, hidden by default, shown/hidden via JS.

### Forms
Inputs and selects use `.form-group` inside `.form-row`:

```html
<div class="form-row">
    <div class="form-group">
        <label>Label</label>
        <input type="text" ... />
    </div>
</div>
```

Focus state: `border-color` switches to `--accent`.

#### Inline-button input (`.pw-input-wrap`)
Wrap an input + absolutely-positioned button together when the button should appear inside the field:

```html
<div class="pw-input-wrap">
    <input type="password" id="pw-new-input" oninput="togglePwSave(this.value)" />
    <button id="pw-save-btn" class="pw-save-btn" style="display:none" onclick="savePassword()">
        <!-- SVG checkmark icon -->
    </button>
</div>
```

### Loading states
Use `.loading-row` with a `.spinner` while async calls are in flight:

```html
<div class="loading-row"><div class="spinner"></div></div>
```

Use `.spinner-sm` (13 px) inside buttons when a call is pending (see `btnLoad()`).

### Toast notifications
Call `toast(message, type)` from anywhere. `type` is `'info'` | `'success'` | `'error'` | `'warning'`. Toasts self-remove after 4 s with a slide-out animation.

### Confirm dialog
Always use `confirmDialog(title, message)` before destructive actions. It returns a `Promise<boolean>`.

```js
const ok = await confirmDialog('Delete?', 'This cannot be undone.');
if (!ok) return;
```

---

## Webhook Contracts

### 1 · Sign Up
```
POST  https://n8n.agent-loft.com/webhook/4de196b7-2ad2-4f9a-9b4d-dc8d3b30865b
Body: { email, password, agent, location }
```
Response: `200` on success. User receives a Stripe billing email separately.

### 2 · List Agents
```
GET   https://n8n.agent-loft.com/webhook/73b31740-d2c7-46d7-ab71-7a3fef5f77ff
      ?email=<email>&password=<password>
```
Response shape:
```json
[{ "email": "…", "UUID": "apple", "server": "fr", "id": 1,
   "createdAt": "…", "updatedAt": "…" }]
```
An empty array `[]` means no agents — show `#no-agents` state.

### 3 · List API Keys
```
GET   https://n8n.agent-loft.com/webhook/1f1a6a11-727b-4965-a59a-fde77806d27f
      ?uuid=<UUID>
```
Response shape: `[{ "data": [ { "name", "label", "limit", "limit_remaining",
"expires_at", "disabled", "usage_monthly", … } ] }]`

`renderKeys()` reads `json[0].data`. The credit progress bar colour follows:
- `< 50 %` used → `prog-low` (green)
- `50–79 %` used → `prog-mid` (amber)
- `≥ 80 %` used → `prog-high` (red)

### 4 · Update Instance Password
```
POST  https://n8n.agent-loft.com/webhook/51098cf4-ecfd-4db4-8977-db04f01ce2b1
Body: { uuid, email, password }
```
Requires confirm dialog before calling. Uses a single `<input type="password">` embedded in `.pw-input-wrap`; the save button (checkmark icon, no text) only appears when the field has content. No GET endpoint — the field is always blank on load. Minimum password length: 8 characters.

### 5 · Restart Server
```
POST  https://n8n.agent-loft.com/webhook/dac205df-66e0-4728-90e5-d784cde167af
Body: { uuid, email, action: "restart" }
```
Requires confirm dialog.

### 6 · Agent Info
```
GET   https://n8n.agent-loft.com/webhook/e01d06a3-14c3-4e4e-830f-7d4be9a5f529
      ?uuid=<UUID>
```
Response shape: `{ agent, domain, ssh_port, created, comment, … }` (n8n may wrap values in extra quotes — use `stripQuotes()` before display).

`renderAgentInfo()` builds the Server Actions card body with rows: Agent Type, Dashboard, SSH Access (clickable — copies `ssh root@UUID.agent-loft.com -p PORT` to clipboard), Created.

### 7 · Backups
```
GET   https://n8n.agent-loft.com/webhook/30eaa32f-378a-4963-9d80-533229d25766
      ?uuid=<UUID>                    ← list all backups

POST  …/30eaa32f-…
Body: { uuid, email, action: "make" }      ← create backup

POST  …/30eaa32f-…
Body: { uuid, email, action: "restore",
        backup_id: <id> }                  ← restore; requires confirm dialog
```

The backup object shape from the API is flexible. The renderer reads `b.name || b.id` for display and `b.created_at || b.createdAt || b.date || b.timestamp` for the date.

### 8 · Contract
```
GET   https://n8n.agent-loft.com/webhook/18591766-147e-4bcb-b9ac-b0f9a92e74bf
      ?uuid=<UUID>
```
Response shape:
```json
[{ "type": "Auto - Monthly", "expires": "" }]
```

`renderContract()` shows a status dot + contract type + expiration date. Status logic (evaluated in order):
1. `expires` is a past date → 🔴 red
2. `type` contains `"none"` (case-insensitive) → 🔴 red
3. `type` contains `"auto"` (case-insensitive) → 🟢 green
4. Otherwise → 🟡 yellow

When status is red, an **Extend Contract →** link is shown pointing to `CONTRACT_EXTEND_URL` (defined at the top of `app.js` — **update this to the Stripe payment link**).

---

## State Variables (`app.js`)

| Variable | Type | Description |
|---|---|---|
| `currentEmail` | `string \| null` | logged-in user's email |
| `agents` | `Array` | full agent objects from AGENTS_URL |
| `activeUUID` | `string \| null` | UUID of the currently selected agent tab |
| `activeAgentInfo` | `object \| null` | last loaded agent info response (used by `copySSHAccess`) |

There is no global keys, backups, or contract state — all are re-fetched from the network every time a tab is selected (`selectAgent()`).

---

## Key Functions

| Function | What it does |
|---|---|
| `showAuth()` / `showApp()` | toggle between auth card and app shell |
| `switchAuthTab(tab)` | toggle Sign In / Sign Up forms |
| `doSignIn()` | validate email → fetch agents → enter app |
| `doSignUp()` | validate form → POST signup webhook → show Stripe notice |
| `doSignOut()` | clear localStorage → reset state → showAuth |
| `loadAgents()` | fetch agent list, call `processAgents()` |
| `selectAgent(uuid)` | switch active tab, load keys + backups + agent info + contract |
| `loadKeys(uuid)` | fetch + render API keys card |
| `renderKeys(keys)` | build key rows with credit bar + Buy Credits button |
| `togglePwSave(value)` | show/hide the inline password save button based on field content |
| `savePassword()` | validate → confirm → POST password webhook |
| `loadAgentInfo(uuid)` | fetch agent info, call `renderAgentInfo()` + `renderComment()` |
| `renderAgentInfo(info)` | build Server Actions info rows including clickable SSH Access row |
| `copySSHAccess()` | copy `ssh root@UUID.agent-loft.com -p PORT` to clipboard + info toast |
| `doRestart()` | confirm → POST restart webhook |
| `loadBackups(uuid)` | fetch + render backup list |
| `makeBackup()` | POST backup make → reload list |
| `restoreBackup(backup)` | confirm → POST backup restore |
| `loadContract(uuid)` | fetch + render contract card |
| `renderContract(data)` | determine status dot colour + show type, expiry, extend link if red |
| `confirmDialog(title, msg)` | shows modal, returns `Promise<boolean>` |
| `toast(msg, type)` | bottom-right notification, auto-removes after 4 s |
| `btnLoad(btn, label)` | disable button, show spinner + label, save original HTML |
| `btnReset(btn)` | re-enable button, restore original HTML |
| `escHtml(s)` | HTML-escape a string for safe innerHTML insertion |
| `escAttr(s)` | HTML + single-quote escape for safe attribute values |
| `stripQuotes(v)` | strip extra surrounding quotes that n8n injects into string values |

---

## How to Add a New Feature

1. **New card** — add a `.card` inside the appropriate `.content-col` in `index.html`. Give the dynamic content container a unique `id`.
2. **New webhook call** — declare the URL as a `const` at the top of `app.js`. Use `btnLoad` / `btnReset` for the trigger button and wrap the call in `try/catch` with `toast(err.message, 'error')` in the catch.
3. **Destructive action** — always gate with `await confirmDialog(...)` before the fetch.
4. **New CSS component** — add it to `styles.css` in the appropriate section (marked with `/* ─── Section ─ */` comments). Use only existing token variables.
5. **New agent-tab action** — call it from `selectAgent()` so it reloads when the user switches agents.
6. **Demo shell** — update `populateDemoShell()` to populate the new card's `id` with representative static data so the auth screen preview stays consistent.

---

## Commands

```bash
# Start dev server (live-reload on file save)
./start
# → http://localhost:8080

# No build step required — CSS and JS are plain files.
```

---

## Rules

- **NEVER** add external scripts, CDN links, or npm packages.
- **NEVER** introduce a framework (React, Vue, Alpine, etc.).
- **NEVER** use raw hex colour values — reference CSS token variables.
- **NEVER** scroll the outer page — keep `overflow: hidden` on `body`.
- **NEVER** call a destructive webhook (restart, restore, password update) without `confirmDialog`.
- On successful sign-up, open the Stripe checkout tab **and** log the user in immediately via `showApp()` + `loadAgents()`.
- **ALWAYS** use `escHtml()` when inserting user-supplied or API-returned strings into `innerHTML`.
- **ALWAYS** use `btnLoad` / `btnReset` around async operations on buttons.
- **ALWAYS** show an error toast (`toast(err.message, 'error')`) when a webhook call fails.
- **ALWAYS** call new per-agent loaders from `selectAgent()` and populate them in `populateDemoShell()`.

---

## Failure Conditions

These actions constitute a failure:

- Removing `escHtml()` from any innerHTML insertion of external data.
- Skipping `confirmDialog` before restart, password update, or backup restore.
- Adding a `<script src="…">` or `<link>` to an external CDN.
- Editing the page so it scrolls at the `body` level.
- Breaking the centered floating-panel layout on desktop (1280 px+).
- Using hardcoded hex values instead of CSS token variables.
- Adding a new per-agent data loader without calling it from `selectAgent()`.
- Setting `app-shell` visible without `shell.style.display = "flex"` (CSS default is `none`).
