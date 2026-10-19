# Kuneco

**A home for your AI tools, browsers, and working environments.**

**English** · [简体中文](README.zh-CN.md)

Kuneco brings AI conversations, a built-in browser, local and container environments, and proxy settings into one desktop workspace. Keep your tools close and give each environment its own place to work.

The longer-term goal is to make collaboration between AI agents across platforms feel natural. Today, the focus is on the workspace they run in.

> Kuneco is in active development. The current development workflow targets macOS; packaged releases and Windows/Linux support are not yet validated.

## What you can do

- **Talk to different AI tools.** Work with Claude Code and Codex runtimes, or configure DeepSeek through its API in managed containers. Available tools depend on the selected environment and its setup.
- **Keep environments separate.** Switch between your local machine and Docker environments, with environment-specific runtimes, browser sessions, and workspace data.
- **Browse alongside your work.** Use the built-in Chromium browser with tabs, history, and downloads.
- **Choose how you connect.** Configure a proxy, import TXT/CSV proxy lists, and choose proxy, direct, or automatic routing where supported.
- **Pick up your conversations.** Organize chats by account and environment, with local recovery and account-backed synchronization.

## Get started

### Prerequisites

- macOS for the current desktop workflow.
- Node.js and npm compatible with the dependencies in `package-lock.json`.
- For the local account service: Go 1.26 and PostgreSQL. Google sign-in uses the bundled OAuth client by default.
- A configured AI runtime or API key for the provider you want to use. Runtime authentication is separate from signing in to Kuneco.

### Run from source

```bash
git clone https://github.com/Lofelin/Kuneco.git
cd Kuneco
npm ci
cp backend/.env.example backend/.env
```

Create a PostgreSQL database and update `DATABASE_URL` in `backend/.env`. Google sign-in uses the shared OAuth client committed with the source; no credentials need to be copied from another computer. To use your own client, set both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and register this callback URL:

```text
http://localhost:8787/v1/auth/google/callback
```

Then start the app:

```bash
npm start
```

The launcher builds the UI and starts or reuses the local account service before opening Electron. The account service continues running after the desktop window closes. To use an existing remote service instead, set `WORKSPACE_ACCOUNT_SERVER_URL`.

See the [account service guide (Chinese)](backend/README.md) for configuration, database setup, and deployment details. Keep database passwords, encryption keys, and user tokens local. The shared Google OAuth client is in `backend/internal/server/google-oauth.json` and embedded in the server. If the Google Cloud app is in testing mode, new accounts must be added as test users; its maintainer controls publishing status, redirect URLs, and quotas.

### Set up your workspace

1. Sign in to Kuneco and select or create an environment.
2. Open **Runtimes** to detect, install, or configure a supported AI tool, then complete its sign-in or API setup.
3. Choose the connection mode for your work. For proxy mode, add your proxy and verify its exit IP before starting.
4. Start a conversation or open a browser tab.

For managed Docker environments, initialize the container engine when prompted. Runtime credentials stay in that environment; host-machine logins are not copied automatically.

## A note on connections

Proxy mode checks the upstream exit IP and blocks forwarding when verification fails. It does not silently fall back to a direct connection. Direct and automatic modes are separate, explicit choices; automatic routing can use a direct connection.

These controls apply to the app's managed requests and supported runtime environments. They are not a system-wide firewall, and a fixed proxy address does not guarantee that the provider will always use the same exit IP. The account service has its own connection path, separate from the workspace proxy.

## Development

Kuneco uses Electron and JavaScript for the desktop app, Web Awesome for UI components, a Go/PostgreSQL account service, and Docker/Colima/Lima for managed containers.

| Command | Purpose |
| --- | --- |
| `npm start` | Build the UI and launch the desktop app |
| `npm run check` | Build UI assets and check JavaScript syntax |
| `npm test` | Run the Node.js test suite |
| `npm run test:desktop` | Run the Electron desktop smoke test |
| `npm run backend:test` | Run Go tests with the race detector |
| `npm run test:docker` | Exercise container environments and networking |
| `npm run validate` | Run checks, Node tests, desktop smoke tests, and CLI handshakes |

Desktop tests need a graphical session; container tests need the container engine. Backend integration tests need a test database configuration. CLI handshake checks do not establish that a real model request will succeed.

```text
src/        Desktop app, browser, runtime integrations, shared UI
backend/    Account service, authentication, and persistence
docker/     Container runtime and proxy gateway
scripts/    Build and development utilities
test/       Automated tests and acceptance scripts
```

Read [AGENTS.md](AGENTS.md) before changing shared components or application behavior. Earlier implementation details and acceptance notes are preserved in [historical notes (Chinese)](docs/archive/legacy-notes.zh-CN.md); they describe work at different stages, not a current release guarantee.

## Where this is heading

Kuneco is growing toward a shared workspace for AI agents across platforms. Cross-agent collaboration remains a direction for the project, rather than a promise that every integration is available today.

If you find a bug or have an idea, [open an issue](https://github.com/Lofelin/Kuneco/issues) with what you were trying to do, your environment, and what happened. Please remove credentials and private conversation data from logs before sharing them.

## Repository layout / 仓库组织

See [directory responsibilities and dependency rules](docs/architecture/repository-layout.md).
