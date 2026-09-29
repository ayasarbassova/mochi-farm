# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Environment quirks (this machine)

- Node is installed via **nvm**, and non-interactive shells don't load it. Prefix commands with `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" &&` or `node`/`npx` will be "command not found".
- The parent folder `hello world website` contains spaces — always quote paths.
- The system `git` is broken (Apple Command Line Tools). Working `git` and `gh` live in a conda env: prefix commands with `export PATH="/opt/anaconda3/envs/gittools/bin:$PATH" &&`. `gh` is logged in as `ayasarbassova`.
- This folder is the git repo https://github.com/ayasarbassova/mochi-farm (public, branch `main`). Commits use the GitHub no-reply email set in the repo-local git config.
- There is no Xcode or Android Studio; the app is tested on a physical phone via **Expo Go**, so only native modules bundled in Expo Go can be used.

## Commands

- Typecheck: `npx tsc --noEmit` (this is the main verification step).
- Lint: `eslint.config.js` exists but `eslint` is not installed, so `npx expo lint` currently fails until ESLint is added.
- Tests: none configured (no Jest).
- Run on phone: `npx expo start --tunnel` (LAN mode is unreliable on this network). The user runs it in a separate Terminal window and scans the QR code with Expo Go; they are logged in to Expo as `ayasarbassova`.
- Verify a native bundle compiles without a device: with the dev server running, `curl "localhost:8081/node_modules/expo-router/entry.bundle?platform=ios&dev=true"` should return 200.
- Do **not** run `npm run reset-project` — it moves `src/app` aside and would remove the Mochi and Pomodoro screens.
- After editing `assets/mochi/mochi-farm.html`: `node scripts/sync-mochi.js` (regenerates `src/mochi/mochi-html.ts`; the app won't see the change otherwise). Syntax-check the page's script with `awk '/<script>/{f=1;next}/<\/script>/{f=0}f' assets/mochi/mochi-farm.html > /tmp/m.js && node --check /tmp/m.js`.
- Reload the app on the phone after a change: press `r` in the Terminal window running `expo start` (from a script: `osascript -e 'tell application "Terminal" to do script "r" in tab 1 of window id <id>'`).
- Browser-testing the page: there is no Playwright/Puppeteer; Google Chrome is installed, so drive `Chrome --headless=new --remote-debugging-port=9333` over the DevTools protocol with Node 24's built-in `WebSocket`/`fetch` (e.g. `Emulation.setDeviceMetricsOverride` at 440×956 for the user's iPhone 16 Pro Max, `Page.captureScreenshot`).

## Architecture

The app opens to Mochi Farm (a focus-timer farm game, shown in a WebView); the original Pomodoro timer is still at `/pomodoro`. Built on the `create-expo-app` template (Expo SDK 57, React Native 0.86, TypeScript strict).

- `src/app/_layout.tsx` — root `Stack` with headers hidden, wrapped in the navigation `ThemeProvider`, plus the template's `AnimatedSplashOverlay` (which also hides the native splash screen). The template's tab navigator was removed.
- `src/app/index.tsx` — Mochi Farm: loads `src/mochi/mochi-html.ts` (generated from `assets/mochi/mochi-farm.html` by `node scripts/sync-mochi.js`; rerun after editing the HTML) in a WebView, keeps the screen awake via `expo-keep-awake` when the page asks, and reports app background/foreground to the page (`window.mochiNative.setHidden`).
- `src/app/pomodoro.tsx` — the timer UI (not linked from anywhere now). Per-phase labels/accent colors live in the `PhaseInfo` map there.
- `src/hooks/use-pomodoro.ts` — all timer logic. It stores an end **timestamp** (`endsAt`) rather than decrementing a counter, so time stays correct when the app is backgrounded; `endsAt === null` means paused. On completion it vibrates and auto-advances focus → short break, with a long break after every 4th focus session. Durations are in `PhaseDurations`.
- Theming: `src/constants/theme.ts` defines light/dark `Colors`, `Spacing`, and `Fonts`; `useTheme()` returns the active palette, and `ThemedText`/`ThemedView` apply it. Prefer these over hard-coded colors (phase accent colors are the intentional exception).
- Platform-specific variants use the `.web.tsx`/`.web.ts` suffix (e.g. `use-color-scheme.web.ts`).
- `@/*` maps to `src/*` (and `@/assets/*` to `assets/*`).
- `app.json` enables `experiments.reactCompiler` (don't add manual `useMemo`/`useCallback` for memoization) and `typedRoutes`.
- `hint-row`, `web-badge`, `external-link`, and `ui/collapsible` are unused template leftovers.

## Mochi Farm page (`assets/mochi/mochi-farm.html`)

One self-contained HTML file (CSS + a single IIFE script, no libraries, all art drawn as inline SVG). The same file runs in the Expo WebView and as the claude.ai artifact, so it must work in both.

- **State**: one object `S`, persisted to `localStorage` key `mochi-farm-v1` via `save()`; `fresh()` defines its shape. `S.active` is the running focus session (`endsAt`, `total`, `leftAt`, `lastSeen`); `brk` is the (unsaved) break.
- **UI flow**: every interactive element carries `data-act`/`data-arg`; one document click listener dispatches into the `ACTIONS` map. `go(tab)` switches between the four tab screens and `render()` calls the matching `renderFocus/Home/Friends/Progress`. Full-screen overlays (`#scr-active`, `#scr-reward`, `#scr-wardrobe`), the bottom sheet (`openModal`) and `toast()` sit above them.
- **Art**: `paint()` turns SVG markup into cached `data:` image URLs (`pimg()` places them); the character is `mochiInner()`/`mochiSVG()`, room items live in the `ART` map, farm scenes in `SCENES`.
- **Session rules** (product decisions from the user): there is no strict-mode toggle — leaving the app or locking the phone for more than `LEAVE_LIMIT` (5 s) always abandons the session, even if the timer ran out meanwhile, so friends compete fairly. The screen is kept awake during sessions (`keepAwake`: Wake Lock, then a silent canvas-video fallback in browsers).
- **Native bridge**: when `window.ReactNativeWebView` exists, the page posts `{type:'awake', on}` and `{type:'haptic', name}` instead of using web APIs, and `src/app/index.tsx` calls `window.mochiNative.setHidden(bool)` on AppState changes; the page's `isHidden()` combines that with `document.hidden`.
- **Wishes**: `nextWish()` picks what Mochi asks for — random in-budget items while he owns fewer than 3, afterwards items matching the styles (`STYLE` map) of what he owns; `budget()` ties price to the player's coins; the wish sticks in `S.wish` until bought. Tapping the thought bubble or wish row opens a quick-buy sheet (`ACTIONS.wish`).
- **Developer menu**: Journal tab → Developer. `S.fast` makes one minute pass in one second (`MINUTE()`), and adds a "Finish now" button during sessions; there are also coin and minute shortcuts. It is visible to everyone, so hide it before sharing the app with friends.
- **Styling**: base tokens at the top of the `<style>`, then an "iOS refinement layer" at the end that overrides them (grouped background `--ground`, cards `--card`, single tint `--tint`) for light, dark (`prefers-color-scheme`) and `[data-theme]`. Style new UI through those tokens. On phones `.device` is `position:fixed; inset:0` so the app runs edge to edge; safe areas come from `env(safe-area-inset-*)`.
- Outside the app (the claude.ai artifact) friends are sample data (`FRIENDS`) and progress is per device; inside the app, `friendsNow()` switches to the real board once the app sends `setAccount`/`setBoard`. Names from other players go through `esc()` before being rendered.

## Supabase (cloud save, accounts, friends)

- Project `pgokdfnpbtlrzbzqkhzn`; URL and publishable key live in `.env.local` (git-ignored; `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). Restart `expo start` after changing it. Without it the app runs local-only.
- Schema: `supabase/migrations/*.sql`, applied by pasting into the dashboard SQL Editor (no Supabase CLI here). Tables `profiles`, `game_state`, `focus_sessions`, `friendships`, all with RLS; sessions and friendships are written only through `security definer` RPCs (`start_session`, `finish_session`, `abandon_session`, `add_friend`, `remove_friend`), read via `friend_board`. `finish_session` only succeeds once the full time has passed on the server clock, which is what makes the leaderboard fair (fast-timer sessions are never sent).
- Auth: players are signed in anonymously on first launch; "Account" in the Journal adds an email (`updateUser` + `verifyOtp type 'email_change'`) or signs in on a new phone (`signInWithOtp` + `verifyOtp type 'email'`, which replaces the phone's game with the account's).
- Sync (`src/mochi/sync.ts`) is local-first: the page's own localStorage is the instant cache; the app keeps an outbox of session events, the latest unsent game state and the cached friends board in expo-sqlite localStorage, pushes in the background, and retries every 30 s / on foreground. Game state conflicts are last-write-wins on the phone's `updatedAt` (`save_game_state`). Errors with a Postgres `code` are dropped; others are treated as offline and retried.
- Page ↔ app messages: page sends `hello`, `state`, `session`, `friend:*`, `account:*` (requests carry `req` and get `mochiNative.reply`); app calls `mochiNative.loadState`, `setBoard`, `setAccount`.
