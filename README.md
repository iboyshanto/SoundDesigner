# SoundDesigner

SoundDesigner is a dockable Adobe CEP extension for managing, searching, previewing, and inserting local sound-effect libraries in Adobe Premiere Pro and After Effects.

## Features

- Recursive sound-library indexing with the original folder hierarchy
- Persistent libraries with collapsed folder trees on startup
- Multiple independent search tabs
- Audio preview, looping, decoded multichannel waveform navigation, volume, favorites, and filters
- Double-click insertion and CEP drag-and-drop support, including an After Effects active-composition fallback
- Automatic `SoundDesigner` Project-panel folder/bin organization for every inserted or dragged sound
- Premiere Pro and After Effects host adapters
- Native-feeling graphite interface designed for compact Adobe panels
- Built-in stable GitHub Release update notifications

## Installation

1. Download the latest signed `SoundDesigner-vX.Y.Z.zxp` from [GitHub Releases](https://github.com/iboyshanto/SoundDesigner/releases).
2. Install it with a CEP-compatible ZXP installer.
3. Open SoundDesigner from the Window > Extensions menu in Premiere Pro or After Effects.

Adobe host versions and operating-system combinations should be tested against the release notes before deployment.

## Development

Requirements: Bun 1.3+ and Node.js for CEP release tooling.

```sh
bun install --frozen-lockfile
bun run build
```

The panel uses Svelte 5 and is compiled for the Chromium 88 runtime in CEP 11. Host-side code is bundled separately for ExtendScript/ES3 compatibility. The minimum supported hosts are Premiere Pro 15.4 and After Effects 18.4.

## Publishing updates

Production releases must use the same persistent publisher certificate. The application never silently executes or installs downloaded code. It checks stable GitHub Releases and opens a repository-scoped download in the default browser.

See [RELEASING.md](RELEASING.md) for the complete signing, testing, tagging, and publishing procedure.

## License

See [LICENSE](LICENSE).
