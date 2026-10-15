# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Security → Report a vulnerability** form for this repository, not in a public issue.

## Security model

Synapse opens folders of Markdown files that may come from anywhere: a downloaded vault, a shared folder, a git clone. The design assumes **note content is untrusted**.

| Layer | Protection |
|---|---|
| Renderer | `contextIsolation`, `sandbox`, no `nodeIntegration`; strict Content-Security-Policy (no inline or remote scripts) |
| Bridge | The preload exposes one `invoke` function limited to an allow-list of channels; main also checks that the sender is the app window |
| Filesystem | Every path from the UI is vault-relative and resolved in the main process. Absolute paths, `..` escapes, symlinks pointing outside the vault and the `.synapse` config folder are refused. Listings never follow symlinks. |
| Vault opening | The UI can only open or create vaults in folders the user picked in a native dialog, or in vaults already registered |
| Markdown | Raw HTML is not rendered. `javascript:`, `vbscript:`, `file:` and `data:` links are neutralised. Clicked links open externally only for `http`, `https` and `mailto`. |
| Navigation | The window cannot navigate away; new windows are denied |
| Permissions | Web permission requests (notifications, geolocation, camera, …) are denied; only clipboard writes are allowed |
| Writes | Atomic, with conflict detection; deletions go to the macOS Trash |
| Electron fuses | `RunAsNode` and `NODE_OPTIONS` are disabled; ASAR integrity validation is on; the app only loads from its ASAR |

### Known trade-offs

- **Remote images in notes are loaded** (`img-src https:`). A note can therefore make a request to a server it names, which reveals your IP address when you view it in reading mode.
- **The Node inspector fuse stays enabled**, so the end-to-end tests can drive the packaged app. Anyone able to start the app with debugging flags can already run code as your user.
- The build is **ad-hoc signed and not notarized**.
- `npm audit` reports moderate issues in electron-builder's dependency chain. They are build-time only and are not shipped in the app bundle.
