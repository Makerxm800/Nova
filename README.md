# Nova Explorer

A local-first desktop file explorer for Windows, macOS, and Linux. Nova is packaged as a native desktop application using Electron; the interface runs inside its own app window, not as a hosted website. Your library metadata and imported previews are stored locally in the app's browser storage.

## Run from source

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

## Build installers

```sh
npm run dist:win   # Windows x64 NSIS installer
npm run dist:mac   # macOS DMG (build on macOS)
npm run dist:linux # Linux AppImage
```

Installers are written to `dist/`. Windows/macOS builds are best run on their respective OS. The GitHub Actions workflow builds and attaches the Windows x64 installer to a GitHub Release when a `v*` tag is pushed.

## Desktop features

- Native folder chooser and folder import; import files with the button or drag/drop.
- Image, video, audio and text previews with a Quick View filmstrip.
- Folders, search, sorting, grid/list controls, starred items, trash, themes and keyboard shortcuts.
- Local-only library persistence. Use Settings to reset the sample library.

## Privacy

Folder contents are only read after the user chooses a folder. Nova does not upload files or run a network service. The font stack uses local system fonts.
