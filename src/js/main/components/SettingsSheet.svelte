<script lang="ts">
  import type {
    AudioConversionPolicy,
    AudioNormalization,
    FreesoundLicenseFilter,
    InsertionTarget,
    LibraryFolder,
  } from "../types";
  import { INSTALLED_VERSION, type UpdateState } from "../updater";
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";

  let {
    open, folder, autoPreview, loop, insertionTarget, conversionPolicy, normalization, freesoundLibraryEnabled, freesoundApiKey, freesoundLicenseFilter,
    update, onAutoPreview, onLoop, onInsertionTarget, onConversionPolicy, onNormalization, onFreesoundApiKey,
    onFreesoundLibraryEnabled, onFreesoundLicenseFilter, onOpenFreesoundSetup, onOpenFreesoundTerms, onBrowseFreesound, onCheckUpdate, onOpenUpdate, onClose, onDelete,
  }: {
    open: boolean;
    folder: LibraryFolder | null;
    autoPreview: boolean;
    loop: boolean;
    insertionTarget: InsertionTarget;
    conversionPolicy: AudioConversionPolicy;
    normalization: AudioNormalization;
    freesoundLibraryEnabled: boolean;
    freesoundApiKey: string;
    freesoundLicenseFilter: FreesoundLicenseFilter;
    update: UpdateState;
    onAutoPreview: (value: boolean) => void;
    onLoop: (value: boolean) => void;
    onInsertionTarget: (value: InsertionTarget) => void;
    onConversionPolicy: (value: AudioConversionPolicy) => void;
    onNormalization: (value: AudioNormalization) => void;
    onFreesoundLibraryEnabled: (value: boolean) => void;
    onFreesoundApiKey: (value: string) => void;
    onFreesoundLicenseFilter: (value: FreesoundLicenseFilter) => void;
    onOpenFreesoundSetup: () => void;
    onOpenFreesoundTerms: () => void;
    onBrowseFreesound: () => void;
    onCheckUpdate: () => void;
    onOpenUpdate: () => void;
    onClose: () => void;
    onDelete: () => void;
  } = $props();

  let draftAutoPreview = $state(false);
  let draftLoop = $state(false);
  let draftInsertionTarget = $state<InsertionTarget>("playhead");
  let draftConversionPolicy = $state<AudioConversionPolicy>("unsupported");
  let draftNormalization = $state<AudioNormalization>("preserve");
  let draftFreesoundLibraryEnabled = $state(false);
  let draftFreesoundApiKey = $state("");
  let draftFreesoundLicenseFilter = $state<FreesoundLicenseFilter>("commercial");
  let dialogElement = $state<HTMLElement | null>(null);

  $effect(() => {
    if (open) {
      draftAutoPreview = autoPreview;
      draftLoop = loop;
      draftInsertionTarget = insertionTarget;
      draftConversionPolicy = conversionPolicy;
      draftNormalization = normalization;
      draftFreesoundLibraryEnabled = freesoundLibraryEnabled;
      draftFreesoundApiKey = freesoundApiKey;
      draftFreesoundLicenseFilter = freesoundLicenseFilter;
    }
  });

  $effect(() => {
    if (!open || !dialogElement) return;
    const element = dialogElement;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = Array.from(document.querySelectorAll<HTMLElement>(".topbar, .panel-body, .transport-bar"));
    const previousAriaHidden = background.map((element) => element.getAttribute("aria-hidden"));
    background.forEach((element) => element.setAttribute("aria-hidden", "true"));

    const focusableElements = () => Array.from(element.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.offsetParent !== null);
    const keepDialogAnchored = () => {
      if (element.scrollTop) element.scrollTop = 0;
      if (element.scrollLeft) element.scrollLeft = 0;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements();
      if (!focusable.length) {
        event.preventDefault();
        element.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    element.addEventListener("scroll", keepDialogAnchored);
    window.setTimeout(() => focusableElements()[0]?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      element.removeEventListener("scroll", keepDialogAnchored);
      background.forEach((element, index) => {
        const value = previousAriaHidden[index];
        if (value === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", value);
      });
      if (previousFocus && document.documentElement.contains(previousFocus)) previousFocus.focus();
    };
  });
</script>

{#if open}
  <div class="sheet-scrim" onmousedown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="presentation">
    <div aria-labelledby="settings-title" aria-modal="true" bind:this={dialogElement} class="bottom-sheet" role="dialog" tabindex="-1">
      <header class="sheet-header">
        <div><span class="eyebrow">SoundDesigner settings</span><strong id="settings-title">{folder ? folder.name : "Panel preferences"}</strong></div>
        <IconButton icon="close" label="Close settings" onclick={onClose} />
      </header>
      <div class="sheet-body">
        {#if folder}
          <div class="settings-group">
            <span class="field-label">Library folder</span>
            <div class="path-field"><Icon name="folder" /><code>{folder.path}</code></div>
            <p>{folder.fileCount.toLocaleString()} indexed audio files. Removing this library never deletes the source folder or its files.</p>
          </div>
        {/if}
        <div class="settings-group">
          <span class="field-label">Preview behavior</span>
          <label class="switch-row">
            <span><strong>Auto-preview selection</strong><small>Start auditioning when the selection changes.</small></span>
            <input checked={draftAutoPreview} onchange={(event) => draftAutoPreview = event.currentTarget.checked} type="checkbox" />
            <i class="switch"><b></b></i>
          </label>
          <label class="switch-row">
            <span><strong>Loop previews</strong><small>Continue playback until you stop or choose another sound.</small></span>
            <input checked={draftLoop} onchange={(event) => draftLoop = event.currentTarget.checked} type="checkbox" />
            <i class="switch"><b></b></i>
          </label>
        </div>
        <div class="settings-group">
          <span class="field-label">Host insertion</span>
          <div aria-label="Audio insertion target" class="segmented-control" role="group">
            <button aria-pressed={draftInsertionTarget === "playhead"} class:is-active={draftInsertionTarget === "playhead"} onclick={() => draftInsertionTarget = "playhead"} type="button">Playhead</button>
            <button aria-pressed={draftInsertionTarget === "selected-clip"} class:is-active={draftInsertionTarget === "selected-clip"} onclick={() => draftInsertionTarget = "selected-clip"} type="button">Selected clip</button>
          </div>
          <p>Playhead uses the current timeline or composition time. Selected clip uses the selected Premiere clip or After Effects layer start.</p>
        </div>
        <div class="settings-group">
          <span class="field-label">Adobe compatibility</span>
          <div class="choice-list" role="radiogroup" aria-label="Audio conversion behavior">
            <label class="choice-row">
              <input checked={draftConversionPolicy === "unsupported"} name="conversion-policy" onchange={() => draftConversionPolicy = "unsupported"} type="radio" />
              <span><strong>Convert unsupported audio to WAV</strong><small>Recommended · prepares FLAC, OGG, Opus and other incompatible audio only when used.</small></span>
            </label>
            <label class="choice-row">
              <input checked={draftConversionPolicy === "always"} name="conversion-policy" onchange={() => draftConversionPolicy = "always"} type="radio" />
              <span><strong>Always convert imported audio to WAV</strong><small>Creates a consistent 24-bit PCM WAV copy for every inserted sound.</small></span>
            </label>
            <label class="choice-row">
              <input checked={draftConversionPolicy === "never"} name="conversion-policy" onchange={() => draftConversionPolicy = "never"} type="radio" />
              <span><strong>Never convert automatically</strong><small>Adobe may reject unsupported containers or codecs.</small></span>
            </label>
          </div>
        </div>
        <div class="settings-group">
          <span class="field-label">Normalization</span>
          <div class="choice-list" role="radiogroup" aria-label="Audio normalization behavior">
            <label class="choice-row">
              <input checked={draftNormalization === "preserve"} name="normalization" onchange={() => draftNormalization = "preserve"} type="radio" />
              <span><strong>Preserve original level</strong><small>Recommended · keeps the sound designer's intended dynamics.</small></span>
            </label>
            <label class="choice-row">
              <input checked={draftNormalization === "peak-minus-one"} name="normalization" onchange={() => draftNormalization = "peak-minus-one"} type="radio" />
              <span><strong>Peak normalize to −1 dBFS</strong><small>Creates a non-destructive WAV and applies one gain value across every channel.</small></span>
            </label>
          </div>
          {#if draftNormalization !== "preserve" && draftConversionPolicy === "never"}
            <p class="settings-notice">Normalization requires a processed WAV and therefore overrides “Never convert” for normalized sounds.</p>
          {/if}
        </div>
        <div class="settings-group">
          <span class="field-label">Freesound</span>
          <label class="switch-row settings-feature-toggle">
            <span><strong>Enable Freesound library</strong><small>Add Freesound as an optional cloud source in the Library panel.</small></span>
            <input aria-controls="freesound-settings-fields" aria-expanded={draftFreesoundLibraryEnabled} checked={draftFreesoundLibraryEnabled} onchange={(event) => draftFreesoundLibraryEnabled = event.currentTarget.checked} type="checkbox" />
            <i class="switch"><b></b></i>
          </label>
          {#if draftFreesoundLibraryEnabled}
            <div class="settings-dependent-fields" id="freesound-settings-fields">
              <label class="text-field-row">
                <span><strong>Personal API key</strong><small>Required for in-panel Freesound search and preview metadata.</small></span>
                <input autocomplete="off" name="freesound-api-key" oninput={(event) => draftFreesoundApiKey = event.currentTarget.value} placeholder="Paste your Freesound API key…" spellcheck="false" type="password" value={draftFreesoundApiKey} />
              </label>
              <label class="select-field-row">
                <span><strong>License filter</strong><small>Applied to every cloud search.</small></span>
                <select onchange={(event) => draftFreesoundLicenseFilter = event.currentTarget.value as FreesoundLicenseFilter} value={draftFreesoundLicenseFilter}>
                  <option value="commercial">CC0 + CC BY</option>
                  <option value="cc0">CC0 only</option>
                  <option value="all">All licenses, including non-commercial</option>
                </select>
              </label>
              <div class="settings-inline-action">
                <p>In-panel Freesound search requires your own API key for both personal and commercial use. Commercial API use also requires separate permission; every sound retains its individual license.</p>
                <div class="settings-inline-buttons">
                  <button class="ghost-button" onclick={onBrowseFreesound} type="button">Browse without key</button>
                  <button class="ghost-button" onclick={onOpenFreesoundTerms} type="button">API terms</button>
                  <button class="ghost-button" onclick={onOpenFreesoundSetup} type="button">Request API key</button>
                </div>
              </div>
              <details class="api-key-guide">
                <summary>How to connect Freesound</summary>
                <ol>
                  <li>Create or sign in to your Freesound account.</li>
                  <li>Select “Request API key” and register SoundDesigner as your application.</li>
                  <li>Copy the API key shown by Freesound into the field above.</li>
                  <li>Select “Save changes.” Freesound will appear in the Library panel.</li>
                </ol>
                <p>Without a key, the Freesound source appears as “API key required” and local libraries continue to work. “Browse without key” opens the public website. SoundDesigner does not scrape the website or include a shared secret key.</p>
              </details>
            </div>
          {:else}
            <p class="settings-disabled-note">Freesound is hidden from the Library panel and no cloud requests are made. A previously saved API key is retained for the next time you enable it.</p>
          {/if}
        </div>
        <div class="settings-group">
          <span class="field-label">Updates</span>
          <div class="update-settings-row">
            <span class="update-settings-copy">
              <strong>SoundDesigner {INSTALLED_VERSION}</strong>
              <small>{update.status === "checking" ? "Checking GitHub…" : update.message || "Updates have not been checked yet."}</small>
            </span>
            <IconButton icon="refresh" label="Check GitHub for updates" onclick={onCheckUpdate} disabled={update.status === "checking"} />
            {#if update.status === "available"}<IconButton icon="download" label={`Download SoundDesigner ${update.latestVersion}`} onclick={onOpenUpdate} />{/if}
          </div>
          <p>Stable releases are checked at most once every 24 hours. Downloads open in your default browser for explicit installation.</p>
        </div>
      </div>
      <footer class="sheet-footer">
        <button class="danger-ghost" disabled={!folder} onclick={onDelete} type="button"><Icon name="trash" /> Remove library</button>
        <div><button class="ghost-button" onclick={onClose} type="button">Cancel</button><button class="primary-button" onclick={() => {
          onAutoPreview(draftAutoPreview);
          onLoop(draftLoop);
          onInsertionTarget(draftInsertionTarget);
          onConversionPolicy(draftConversionPolicy);
          onNormalization(draftNormalization);
          onFreesoundLibraryEnabled(draftFreesoundLibraryEnabled);
          onFreesoundApiKey(draftFreesoundApiKey.trim());
          onFreesoundLicenseFilter(draftFreesoundLicenseFilter);
          onClose();
        }} type="button">Save changes</button></div>
      </footer>
    </div>
  </div>
{/if}
