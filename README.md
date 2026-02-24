# Arcane Forge for VS Code

Sync Arcane Forge project knowledge-base files into your local workspace from VS Code and other VS Code-compatible IDEs (including Cursor).

## Features

- Browser-based Arcane Forge login (with IDE callback handoff)
- Workspace-level project selection
- Pull active knowledge-base document files into a local folder
- Push only changed local files back to Arcane Forge
- Hash-based change detection (`SHA-256`)
- Sync manifest for incremental uploads and conflict checks
- Deterministic conflict resolution for duplicate remote entries:
  - newest non-deprecated upload wins (`created_at`)
  - tie-breaker: higher `file_id`

## What It Syncs (v1)

- Syncs **document** entries only
- Downloads the **newest active version** only (not full version history)
- Does **not** propagate deletions (local or remote)

## Installation

### VS Code Marketplace (recommended)
Search for `Arcane Forge` in the Extensions panel.

### Manual install (`.vsix`)
If you install from a release artifact:

```bash
code --install-extension arcaneforge.arcane-forge-vscode-extension-<version>.vsix
```

For Cursor and other VS Code-based IDEs, use that IDE's equivalent "Install from VSIX" flow.

## Quick Start

1. Open a folder/workspace in your IDE.
2. Run `Arcane Forge: Login`.
3. Complete login in your browser (the site redirects back to the IDE).
4. Run `Arcane Forge: Select Project`.
5. Run `Arcane Forge: Pull Knowledge Base`.
6. Edit files in `game_knowledge_base/` (default).
7. Run `Arcane Forge: Push Knowledge Base`.

## Commands

- `Arcane Forge: Login`
- `Arcane Forge: Logout`
- `Arcane Forge: Select Project`
- `Arcane Forge: Pull Knowledge Base`
- `Arcane Forge: Push Knowledge Base`
- `Arcane Forge: Show Sync Status`

## Configuration

### `arcaneForge.kbDirectory`
- Type: `string`
- Default: `game_knowledge_base`
- Scope: Workspace
- Controls where Arcane Forge KB files are stored locally (relative to workspace root)

### `arcaneForge.apiBaseUrl`
- Type: `string`
- Default: `https://arcane-forge-service.dev.arcaneforge.ai`
- Scope: Machine
- Arcane Forge API base URL

### `arcaneForge.webBaseUrl`
- Type: `string`
- Default: `https://arcaneforge.ai`
- Scope: Machine
- Arcane Forge website base URL used for browser login

## Local Files Created

- `./game_knowledge_base/` (default KB download folder)
- `./.arcane-forge/sync-manifest.json` (sync metadata, hashes, remote IDs)

## Sync Behavior (Important)

### Pull
- Downloads active document files from the selected project
- Skips non-document entries (`link`, `folder`, `contact`, `other`)
- Uses signed download URLs from the Arcane Forge API

### Push
- Uploads only changed/new files (based on local hash comparisons)
- Detects remote changes and skips conflicting files
- Assumes backend creates a new KB entry and deprecates the old one

### Deletions
- Deleting local files does **not** delete Arcane Forge KB entries
- Remote deletions/deprecations are **not** automatically mirrored locally

## Browser Login Requirements

This extension uses browser login with a VS Code URI callback.

Your Arcane Forge website deployment must support an IDE auth handoff flow that redirects back to the extension callback URI with:

- `access_token`
- `state` (echoed back unchanged)
- optional `refresh_token`

If the website handoff is unavailable in your environment, the extension provides a **developer token fallback** after browser login timeout/failure.

## Troubleshooting

### Login opens browser but never completes
- Confirm the website IDE callback handoff is deployed
- Check `arcaneForge.webBaseUrl`
- Open `Arcane Forge` output channel and review logs
- Use the developer token fallback temporarily

### Pull/Push fails with auth error (401)
- Run `Arcane Forge: Logout`
- Run `Arcane Forge: Login` again

### No files uploaded on push
- Verify files were changed under the configured KB directory
- Run `Arcane Forge: Show Sync Status` to inspect manifest state

## Development

### Prerequisites
- Node.js
- npm
- VS Code (or compatible IDE)

### Run locally

```bash
npm install
npm run compile
```

Then press `F5` in VS Code to launch an Extension Development Host.

## Manual Test Checklist (Release Smoke Test)

1. Login (browser callback returns to IDE)
2. Select project
3. Pull KB files into local folder
4. Edit one file
5. Push KB changes (only changed file uploads)
6. Run push again (no changes => no uploads)
7. Delete local file and confirm push does not delete remote entry
8. Run `Show Sync Status` and inspect output channel

## Compatibility

- VS Code (stable)
- Cursor
- Other VS Code-compatible IDEs (best effort; depends on URI callback support and extension API compatibility)

## Privacy / Security Notes

- Tokens are stored using VS Code `SecretStorage`
- v1 browser handoff may pass the access token in a callback URL to the IDE (fast integration path)
- A one-time code exchange flow is recommended for a future hardening pass

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE).

Arcane Forge name and logos are trademarks of Arcane Forge. This repository's
open-source license does not grant trademark rights.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Support

For support, visit [Arcane Forge](https://arcaneforge.ai) or contact your Arcane Forge team administrator.
