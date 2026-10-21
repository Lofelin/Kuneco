<!-- README_SYNC: source=working-tree; updated=2026-10-21 -->

**English** · [简体中文](README.zh-CN.md)

# Kuneco

**Use Claude Code, Codex, and DeepSeek in one desktop workspace, with conversations, browsing, and connections organized by account and environment.**

Working across several AI tools and environments? [Star Kuneco](https://github.com/Lofelin/Kuneco) to keep it close at hand.

[Version 0.1.0](package.json) · macOS · In development · [Issues](https://github.com/Lofelin/Kuneco/issues)

Working with several AI tools also means managing project directories, sign-ins, browser sessions, and network routes. Kuneco puts these in one desktop app: select an environment, choose a runtime, then work with its conversations, browser, and connection settings together.

It is intended for developers comfortable running from source who use multiple AI tools and want separate local and container workspaces.

> Active development. This README describes the current working tree. The development launch workflow targets macOS; packaged releases and Windows/Linux support are not yet validated. Kuneco sign-in is separate from AI provider authentication.

## One environment, one working context

- **Work across runtimes.** Use Claude Code and Codex, or configure the DeepSeek API in managed containers. Runtime availability depends on installation and authentication in the selected environment.
- **Keep browsing with its environment.** Local environments use the desktop browser. Managed Docker environments run pages in a separate Chromium container, with uploads and downloads kept inside that environment's `/workspace`.
- **Carry sourced memories across runtimes.** The shared memory library supports extraction from completed conversations, recall before requests, source inspection, and conflict resolution. It is scoped by account and environment, encrypted locally, and does not sync across devices. Extraction and recall can each be disabled.
- **Control the connection explicitly.** Import proxies and subscription nodes, and save multiple configurations per environment. Proxy forwarding opens after exit verification and blocks on failure; managed container browsing does not fall back to direct access.
- **Resume your work.** Conversations are organized by account and environment, with local recovery and account-service synchronization. The memory library and saved proxy lists have their own local storage boundaries; synchronization does not cover every kind of data.

## Get started

### Prerequisites

- macOS for the current desktop workflow.
- Node.js and npm compatible with the dependencies in `package-lock.json`.
- macOS Command Line Tools for native integration builds during startup.
- For the local account service: Go 1.26 and PostgreSQL. Google sign-in uses the bundled OAuth client by default.
- A configured AI runtime or API key for the provider you want to use. Runtime authentication is separate from signing in to Kuneco.

### Run from source

```bash
git clone https://github.com/Lofelin/Kuneco.git
cd Kuneco
npm ci
cp -n backend/.env.example backend/.env
chmod 600 backend/.env
```

Create a PostgreSQL database and update `DATABASE_URL` in `backend/.env`. Google sign-in uses the shared OAuth client committed with the source; no credentials need to be copied from another computer. To use your own client, set both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and register this callback URL:

```text
http://localhost:8787/v1/auth/google/callback
```

Then start the app:

```bash
npm start
```

The launcher builds the UI and starts or reuses the local account service before opening Kuneco. The account service continues running after the desktop window closes. To use an existing remote service instead, set `WORKSPACE_ACCOUNT_SERVER_URL`.

See the [account service guide (Chinese)](backend/README.md) for configuration, database setup, and deployment details. Keep database passwords, encryption keys, and user tokens local. The shared Google OAuth client is in `backend/internal/server/google-oauth.json` and embedded in the server. If the Google Cloud app is in testing mode, new accounts must be added as test users; its maintainer controls publishing status, redirect URLs, and quotas.

### Set up your workspace

1. Sign in to Kuneco and select or create an environment.
2. Open **Runtimes** to detect, install, or configure a supported AI tool, then complete its sign-in or API setup.
3. Choose the connection mode for your work. For proxy mode, add your proxy and verify its exit IP before starting.
4. Start a conversation or open a browser tab.

For managed Docker environments, initialize the container engine when prompted. Runtime credentials stay in that environment; host-machine logins are not copied automatically.

## Connection and data boundaries

Proxy mode checks the upstream exit IP and blocks forwarding when verification fails. It does not silently fall back to a direct connection. Direct and automatic modes are separate, explicit choices; automatic routing can use a direct connection.

These controls apply to the app's managed requests and supported runtime environments. They are not a system-wide firewall, and a fixed proxy address does not guarantee that the provider will always use the same exit IP. The account service has its own connection path, separate from the workspace proxy.

Container browsing does not yet support folder uploads, selecting multiple upload files at once, or download pause/resume. Automatic memory extraction makes an additional request through the runtime and model used for the completed turn; it is not offline extraction. Recalled content is also sent to the selected runtime with the conversation request. CLIs launched directly in the console do not automatically use the shared memory service.

Details (Chinese): [container browser isolation](docs/architecture/container-browser.md) · [memory library](docs/operations/memory-library.md) · [subscription proxies](docs/operations/subscription-proxies.md) · [browser settings](docs/operations/browser-settings.md).

## Development

Kuneco uses Electron and JavaScript for the desktop app, Web Awesome for UI components, a Go/PostgreSQL account service, and Docker/Colima/Lima for managed containers.

| Command | Purpose |
| --- | --- |
| `npm start` | Build the UI and launch the desktop app |
| `npm run check` | Build UI assets and check JavaScript syntax |
| `npm test` | Run the Node.js test suite |
| `npm run test:desktop` | Run the Kuneco desktop acceptance test |
| `npm run backend:test` | Run Go tests with the race detector |
| `npm run test:docker` | Exercise container environments and networking |
| `npm run validate` | Run checks, Node tests, desktop smoke tests, and CLI handshakes |

Desktop tests need a graphical session; container tests need the container engine. Backend integration tests need a test database configuration. CLI handshake checks do not establish that a real model request will succeed.

```text
src/        Desktop app, browser, runtime integrations, shared UI
backend/    Account service, authentication, and persistence
docker/     Container runtime, proxy gateway, and isolated browser
scripts/    Build, setup, maintenance, and benchmark utilities
test/       Automated tests and acceptance scripts
```

Read [AGENTS.md](AGENTS.md) before changing shared components or application behavior. Earlier implementation details and acceptance notes are preserved in [historical notes (Chinese)](docs/archive/legacy-notes.zh-CN.md); they describe work at different stages, not a current release guarantee.

## Where this is heading

Kuneco is growing toward a shared workspace for AI agents across platforms. Cross-agent collaboration remains a direction for the project, rather than a promise that every integration is available today.

If you find a bug or have an idea, [open an issue](https://github.com/Lofelin/Kuneco/issues) with what you were trying to do, your environment, and what happened. Please remove credentials and private conversation data from logs before sharing them.

See [repository layout and dependency rules](docs/architecture/repository-layout.md) for directory responsibilities.

## License

The repository currently has no project-level `LICENSE` file. Dependencies and third-party assets retain their respective licenses.

If Kuneco fits the way you work, [Star it](https://github.com/Lofelin/Kuneco) for later or share what needs improving in an [issue](https://github.com/Lofelin/Kuneco/issues).
