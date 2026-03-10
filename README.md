# Zypher

> A private, local-first Windows journal for long-form writing, structured notes, and reflection.

[![Release](https://img.shields.io/github/v/release/Yizno/Zypher?display_name=tag&style=for-the-badge)](https://github.com/Yizno/Zypher/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-111827?style=for-the-badge)](https://github.com/Yizno/Zypher/releases)
[![License](https://img.shields.io/badge/license-MIT-0f172a?style=for-the-badge)](./LICENSE)

Zypher is built for people who want their journal to stay on their machine. It combines a rich editor, flexible organization, recovery tools, privacy controls, and local backup/export workflows into a focused desktop app with no hosted backend required.

## Why Zypher

| Area | What you get |
| --- | --- |
| Writing | Rich text editing with headings, quotes, code blocks, tables, inline images, and slash commands. |
| Organization | Folders, tags, pinning, search filters, sort modes, bulk actions, and a quick switcher. |
| Recovery | Trash, per-page history snapshots, manual backups, and automatic backup intervals. |
| Privacy | Optional password protection, idle lock, encrypted local storage, and self-destruct protection after repeated failed unlock attempts. |
| Reflection | "On This Day" memories plus gated monthly and yearly review generation. |
| Personalization | Themes, accent colors, font controls, imported custom fonts, spellcheck, and editable keyboard shortcuts. |

## Install

Download the latest release from [GitHub Releases](https://github.com/Yizno/Zypher/releases) and run `Zypher-Setup-<version>-Custom.exe`.

The public installer is a custom Windows setup experience that can:

- perform a fresh install
- update an existing Zypher install
- repair program files without touching journal data
- uninstall the app binaries while leaving local journal data in your profile

GitHub automatically attaches source archives to each release, so every release includes both the Windows installer and downloadable source code.

The current public release is unsigned, so Windows may show an "Unknown publisher" warning before launch.

## Local-First Storage

Zypher stores journal data locally and does not require a cloud account or hosted sync service. Notes stay on your device unless you explicitly export them or copy your backups elsewhere.

The app also hardens imported rich content and external-link handling through sanitization and a restricted Electron bridge.

## Development

Requirements:

- Node.js 20+
- npm
- Windows (for packaged installer builds)

Install dependencies and start the app in development:

```bash
npm install
npm run dev
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run the Vitest suite. |
| `npm run build` | Build the renderer and Electron main process. |
| `npm run build:exe` | Produce an unpacked Windows app directory. |
| `npm run build:installer` | Build the official custom Windows installer. |
| `npm run build:installer:custom` | Build the custom installer explicitly. |
| `npm run build:installer:nsis` | Build the legacy NSIS installer flow. |

The official release installer is written to `release-installer/Zypher-Setup-<version>-Custom.exe`.

## License

Zypher is released under the MIT License. See [LICENSE](./LICENSE) for details.
