<div align="center">

# 🎵 S O U N D D E S I G N E R 🎵

```text
  ____                        _ ____            _                       
 / ___|  ___  _   _ _ __   __| |  _ \ ___  ___(_) __ _ _ __   ___ _ __  
 \___ \ / _ \| | | | '_ \ / _` | | | / _ \/ __| |/ _` | '_ \ / _ \ '__| 
  ___) | (_) | |_| | | | | (_| | |_| \ __/\__ \ | (_| | | | |  __/ |    
 |____/ \___/ \__,_|_| |_|\__,_|____/ \___||___/_|\__, |_| |_|\___|_|    
                                                  |___/                 
```

**The Ultimate Sound Management Extension for Adobe Premiere Pro & After Effects**

<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/Version-0.0.6-orange?style=for-the-badge&logo=rocket"></a>
  <a href="#"><img src="https://img.shields.io/github/repo-size/iboyshanto/SoundDesigner?color=FF4500&label=Size&style=for-the-badge"></a>
  <a href="#"><img src="https://img.shields.io/github/license/iboyshanto/SoundDesigner?style=for-the-badge&color=FF8C00"></a>
  <br>
  <a href="#"><img src="https://img.shields.io/badge/Powered%20By-Svelte_5-ff3e00?style=for-the-badge&logo=svelte"></a>
  <a href="#"><img src="https://img.shields.io/badge/Engine-Bun_1.3-fbf0df?style=for-the-badge&logo=bun"></a>
  <a href="#"><img src="https://img.shields.io/badge/Platform-Adobe_CEP_11-ff0000?style=for-the-badge&logo=adobe"></a>
</p>

[**Download Latest**](https://github.com/iboyshanto/SoundDesigner/releases) • [**Report a Bug**](https://github.com/iboyshanto/SoundDesigner/issues)

</div>

---

## 📑 Table of Contents

- [🔮 Overview](#overview)
- [💎 Features](#features)
- [⚙️ Prerequisites](#prerequisites)
- [🚀 Installation](#installation)
- [🎶 Usage & Workflows](#usage--workflows)
  - [Freesound Setup](#freesound-setup)
  - [Project Audio & Conversion](#project-audio--conversion)
  - [Waveform Segment Selection](#waveform-segment-selection)
- [🛠️ Development](#development)
- [📦 Publishing Updates](#publishing-updates)
- [📜 License](#license)

---

<a id="overview"></a>

## 🔮 Overview

**SoundDesigner** is a professional-grade, dockable Adobe CEP extension tailored for video editors and motion designers. It seamlessly integrates into **Adobe Premiere Pro** and **After Effects**, providing an all-in-one hub for managing, searching, previewing, and inserting both local sound effects and Freesound-hosted libraries.

> [!IMPORTANT]
> Say goodbye to messy project bins! SoundDesigner automatically organizes every inserted or dragged sound into a dedicated `SoundDesigner` folder/bin in your Adobe Project panel, keeping your workspace clean and efficient.

---

<a id="features"></a>

## 💎 Features

<table align="center">
  <tr>
    <td align="center" width="50%">
      <h3>🔍 Deep Library Integration</h3>
      <p>Recursive sound-library indexing that preserves your original folder hierarchy. Supports WAV, Opus, OGG, FLAC, MP3, AAC, AIFF, and more.</p>
    </td>
    <td align="center" width="50%">
      <h3>☁️ Freesound On-Demand</h3>
      <p>Search and audition sounds directly from Freesound with built-in CC0, commercial-use, and all-license filters. No web browser needed.</p>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <h3>🎧 Advanced Audio Auditioning</h3>
      <p>Rich audio previews, looping, decoded multichannel waveform navigation, volume control, favorites, and smart filters.</p>
    </td>
    <td align="center" width="50%">
      <h3>⚡ Lightning Fast Workflows</h3>
      <p>Double-click insertion and seamless CEP drag-and-drop support. Includes an After Effects active-composition fallback.</p>
    </td>
  </tr>
</table>

### Full Feature Highlights

- **Persistent Libraries:** Collapsed folder trees on startup for quick navigation.
- **Multi-Tab Searching:** Open multiple independent search tabs simultaneously.
- **Smart Conversion:** Adobe compatibility policies for unsupported audio, plus optional −1 dBFS peak normalization.
- **Project-Scoped Storage:** Cloud downloads and converted audio are smartly cached beside each saved Premiere Pro or After Effects project.
- **Native UI:** Graphite interface designed specifically to blend in with compact Adobe panels.
- **Update Ready:** Built-in stable GitHub Release update notifications.

---

<a id="prerequisites"></a>

## ⚙️ Prerequisites

| Requirement | Notes |
|---|---|
| **Adobe Host** | Premiere Pro 15.4+ or After Effects 18.4+ |
| **CEP Installer** | Any modern ZXP Installer (e.g., Anastasiy's Extension Manager) |
| **Internet** | Required only for Freesound API features |

---

<a id="installation"></a>

## 🚀 Installation

1. **Download:** Grab the latest signed `SoundDesigner-vX.Y.Z.zxp` from [GitHub Releases](https://github.com/iboyshanto/SoundDesigner/releases).
2. **Install:** Use a CEP-compatible ZXP installer to install the extension.
3. **Launch:** Open SoundDesigner from the **Window > Extensions** menu in Premiere Pro or After Effects.

> [!TIP]
> Always verify Adobe host versions and operating-system combinations against the release notes before deploying to a production environment.

---

<a id="usage--workflows"></a>

## 🎶 Usage & Workflows

### Freesound Setup

Freesound requires an API credential for in-panel searches. **SoundDesigner deliberately does not scrape the website or include a shared API key.** Each user connects their own Freesound account.

#### 1. Request an API credential

1. [Create a Freesound account](https://freesound.org/home/register/) or sign in to an existing account.
2. Open the [Freesound API credentials page](https://freesound.org/apiv2/apply/).
3. Under **Create new API credentials**, enter the following values:

   | Field | Value |
   | --- | --- |
   | **Name** | `SoundDesigner` |
   | **URL** | `https://github.com/iboyshanto/SoundDesigner` |
   | **Callback URL** | `http://freesound.org/home/app_permissions/permission_granted/` |

   SoundDesigner uses token authentication rather than an OAuth2 login flow, so it does not receive callback requests. The Freesound-hosted callback above is the fallback provided for desktop and non-server applications.
4. Submit the form and wait for the credential to appear in the table at the top of the page.

#### 2. Copy the correct value

Copy the long value under **Client secret/API key**. Do **not** copy the shorter **Client ID**—SoundDesigner needs the API key.

Treat the API key like a password:

- Do not post it in screenshots, issues, or discussions.
- Do not commit it to this repository.
- Do not share one key between distributed copies of the extension.
- If it is exposed, delete or regenerate the credential from Freesound.

#### 3. Connect SoundDesigner

1. Open SoundDesigner in Premiere Pro or After Effects.
2. Open **Settings** and find the **Freesound** section.
3. Enable **Freesound library**.
4. Paste the value from **Client secret/API key** into **Personal API key**.
5. Select the desired license filter and click **Save changes**.
6. In the Library panel, enable **Freesound**. Keep **Local** enabled if both sources should be searched together.
7. Enter at least two characters in Search. Cloud results should appear with the cloud source icon.

#### Authentication and licensing

- SoundDesigner uses Freesound's token-authenticated, read-only search and preview workflow; OAuth2 authorization is not required.
- Freesound API access is free for non-commercial use. Commercial API use requires separate permission or licensing from Freesound.
- Every sound retains its own license. A CC0 result and a CC BY result do not have the same attribution requirements.
- The selected license filter applies to cloud searches, but users remain responsible for checking the license shown for each sound.

> [!NOTE]
> Disabling the Freesound library stops cloud requests while retaining your key. You can also browse Freesound without a key via your default browser using the **Browse without key** setting.
> 
> Results and low-bandwidth waveform previews are requested only while the Freesound source is active and a search is entered. Audio is downloaded only when the user explicitly downloads, inserts, or prepares a drag. See the official [authentication documentation](https://freesound.org/docs/api/authentication.html) and [API terms](https://freesound.org/help/tos_api/).

#### Troubleshooting

- **No Freesound source in the Library panel:** Enable **Freesound library** in Settings and save the changes.
- **No cloud results:** Confirm Freesound is checked in the Library panel, enter at least two search characters, and verify the API key was copied without surrounding spaces.
- **Unauthorized or invalid-key error:** Return to the credentials page and copy **Client secret/API key**, not **Client ID**.
- **Local results only:** Both sources can be enabled independently; make sure the Freesound source checkbox is active.
- **Commercial project:** Contact Freesound for API permission before using the integration commercially, then review the license of every selected sound.

### Project Audio & Conversion

Used cloud audio is stored securely under `Project folder/SoundDesigner/Project name/Freesound/Originals`. Compatibility and normalized WAVs are cached under `Project folder/SoundDesigner/Project name/Converted`, with provenance and conversion records in `Metadata`. 

- **Conversion Engine:** The lightweight converter uses available CEP decoders to write 24-bit PCM WAV (no FFmpeg required). 
- **Integrity:** Sample rate and channel counts are preserved. Peak normalization applies uniform gain across all channels.
- **Important:** Always save your Adobe project before preparing cloud or converted audio.

### Waveform Segment Selection

Need just a specific slice of a sound? 
- **Select:** Drag horizontally across the spectrum preview.
- **Refine:** Drag the edges. Use arrow keys for fine adjustments, `Shift+Arrow` for larger steps, and `Home`/`End` to reach boundaries.
- **Insert:** Click **Insert segment** or drag the blue selection. SoundDesigner renders and caches just that segment as a 24-bit PCM WAV.

> [!WARNING]
> Freesound sounds retain their individual Creative Commons licenses. CC BY sounds require attribution, and Freesound requires separate permission for commercial use of its API. Review the [Freesound API terms](https://freesound.org/help/tos_api/) before distributing a commercial build.

---

<a id="development"></a>

## 🛠️ Development

SoundDesigner's panel uses **Svelte 5** and is compiled for the Chromium 88 runtime in CEP 11. Host-side code is bundled separately for ExtendScript/ES3 compatibility.

**Requirements:** `Bun 1.3+` and `Node.js` for CEP release tooling.

```sh
# Install dependencies
bun install --frozen-lockfile

# Build the project
bun run build

# Watch mode for active development
bun run watch
```

---

<a id="publishing-updates"></a>

## 📦 Publishing Updates

Production releases must use a persistent publisher certificate. The extension never silently executes downloaded code—it simply checks for updates and directs users to the repository.

```sh
# One-time, secure publisher setup
bun run certificate:create

# Build the signed ZXP and checksum
bun run release:package
```

The certificate is stored under the Git-ignored `.signing` directory, and its password is requested through a hidden terminal prompt rather than saved to disk.

Please refer to [`RELEASING.md`](RELEASING.md) for the complete signing, testing, tagging, and publishing procedure.

---

<a id="license"></a>

## 📜 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

<div align="center">
  <sub>Built with passion for the Adobe creative community.</sub>
</div>
