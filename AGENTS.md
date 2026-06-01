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
app.js          ← all logic — auth, agents, keys, SSH, restart, backups
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
                         │     ├── card: API Keys        (#keys-body)
                         │     ├── card: SSH Key         (#ssh-input)
                         │     └── card: Server Actions  (#restart-btn)
                         └── .content-col [right]
                               └── card: Backups         (#backups-body)
```

**Non-scrolling rule:** `body` and `#app-shell` never scroll. Only `.content-grid` (inside the shell) scrolls when content overflows, and `.backups-list` scrolls internally at `max-height: 320px`.

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
| `--warning` | `#f0a04b` | mid-range credit bar |
| `--text` | `#e4e8f5` | primary text |
| `--text-muted` | `#7a82a0` | secondary text, labels |
| `--radius` | `8px` | default border-radius |
| `--shadow` | (see CSS) | shell / auth card drop shadow |

**Never use raw hex values in HTML or JS** — always reference a token via `var(--token-name)` in CSS or as a string literal only when building inline styles in JS (acceptable only for dynamic status colours in `renderKeys`).

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
| `btn btn-ghost` | `--bg-hover` + border | secondary actions (Save, Make Backup) |
| `btn btn-sm` | — modifier, smaller padding | actions inside card headers |
| `btn btn-block` | — modifier, full width | auth form submit |

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

## Auth Flow

```
Page load
  └── localStorage has 'al_email'?
        Yes → showApp() + loadAgents()
        No  → showAuth()

Sign In
  └── GET AGENTS_URL?email=…
        200 → store email → showApp() → processAgents()
        !200 → show inline error

Sign Up
  └── POST SIGNUP_URL {email, password, agent, location}
        200 → show Stripe billing notice (do NOT auto-login)
        !200 → show inline error

Sign Out
  └── remove 'al_email' from localStorage → showAuth()
```

The email is the only session token. There is no password verification on the frontend — authentication is enforced by the n8n webhooks.

---

## Webhook Contracts

### 1 · Sign Up
```
POST  https://n8n.agent-loft.com/webhook/d32eb831-b71d-46a5-b4f0-4fbbc6b54226
Body: { email, password, agent, location }
```
Response: `200` on success. User receives a Stripe billing email separately.

### 2 · List Agents
```
GET   https://n8n.agent-loft.com/webhook/73b31740-d2c7-46d7-ab71-7a3fef5f77ff
      ?email=<email>
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

### 4 · Update SSH Key
```
POST  https://n8n.agent-loft.com/webhook/51098cf4-ecfd-4db4-8977-db04f01ce2b1
Body: { uuid, email, ssh_key }
```
Requires confirm dialog before calling. The input is a `<textarea>` (SSH keys are long). No GET endpoint — the field is always blank on load (masked placeholder).

### 5 · Restart Server
```
POST  https://n8n.agent-loft.com/webhook/51098cf4-ecfd-4db4-8977-db04f01ce2b1
Body: { uuid, email, action: "restart" }
```
Same webhook as SSH update, differentiated by the `action` field. Requires confirm dialog.

### 6 · Backups
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

---

## State Variables (`app.js`)

| Variable | Type | Description |
|---|---|---|
| `currentEmail` | `string \| null` | logged-in user's email |
| `agents` | `Array` | full agent objects from AGENTS_URL |
| `activeUUID` | `string \| null` | UUID of the currently selected agent tab |

There is no global keys or backups state — both are re-fetched from the network every time a tab is selected (`selectAgent()`).

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
| `selectAgent(uuid)` | switch active tab, load keys + backups |
| `loadKeys(uuid)` | fetch + render API keys card |
| `renderKeys(keys)` | build key rows with credit bar + Buy Credits button |
| `saveSSHKey()` | confirm → POST SSH webhook |
| `doRestart()` | confirm → POST restart webhook |
| `loadBackups(uuid)` | fetch + render backup list |
| `makeBackup()` | POST backup make → reload list |
| `restoreBackup(backup)` | confirm → POST backup restore |
| `confirmDialog(title, msg)` | shows modal, returns `Promise<boolean>` |
| `toast(msg, type)` | bottom-right notification, auto-removes after 4 s |
| `btnLoad(btn, label)` | disable button, show spinner + label, save original HTML |
| `btnReset(btn)` | re-enable button, restore original HTML |
| `escHtml(s)` | HTML-escape a string for safe innerHTML insertion |
| `escAttr(s)` | HTML + single-quote escape for safe attribute values |

---

## How to Add a New Feature

1. **New card** — add a `.card` inside the appropriate `.content-col` in `index.html`. Give the dynamic content container a unique `id`.
2. **New webhook call** — declare the URL as a `const` at the top of `app.js`. Use `btnLoad` / `btnReset` for the trigger button and wrap the call in `try/catch` with `toast(err.message, 'error')` in the catch.
3. **Destructive action** — always gate with `await confirmDialog(...)` before the fetch.
4. **New CSS component** — add it to `styles.css` in the appropriate section (marked with `/* ─── Section ─ */` comments). Use only existing token variables.
5. **New agent-tab action** — call it from `selectAgent()` so it reloads when the user switches agents.

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
- **NEVER** call a destructive webhook (restart, restore, SSH update) without `confirmDialog`.
- **NEVER** auto-login after sign-up — the user must complete Stripe billing first.
- **ALWAYS** use `escHtml()` when inserting user-supplied or API-returned strings into `innerHTML`.
- **ALWAYS** use `btnLoad` / `btnReset` around async operations on buttons.
- **ALWAYS** show an error toast (`toast(err.message, 'error')`) when a webhook call fails.

---

## Failure Conditions

These actions constitute a failure:

- Removing `escHtml()` from any innerHTML insertion of external data.
- Skipping `confirmDialog` before restart, SSH update, or backup restore.
- Adding a `<script src="…">` or `<link>` to an external CDN.
- Editing the page so it scrolls at the `body` level.
- Breaking the centered floating-panel layout on desktop (1280 px+).
- Using hardcoded hex values instead of CSS token variables.
