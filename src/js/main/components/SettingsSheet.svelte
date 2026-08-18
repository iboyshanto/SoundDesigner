<script lang="ts">
  import type { LibraryFolder } from "../types";
  import { INSTALLED_VERSION, type UpdateState } from "../updater";
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";

  let { open, folder, autoPreview, loop, update, onAutoPreview, onLoop, onCheckUpdate, onOpenUpdate, onClose, onDelete }: {
    open: boolean;
    folder: LibraryFolder | null;
    autoPreview: boolean;
    loop: boolean;
    update: UpdateState;
    onAutoPreview: (value: boolean) => void;
    onLoop: (value: boolean) => void;
    onCheckUpdate: () => void;
    onOpenUpdate: () => void;
    onClose: () => void;
    onDelete: () => void;
  } = $props();

  let draftAutoPreview = $state(false);
  let draftLoop = $state(false);

  $effect(() => {
    if (open) {
      draftAutoPreview = autoPreview;
      draftLoop = loop;
    }
  });
</script>

{#if open}
  <div class="sheet-scrim" onmousedown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="presentation">
    <section aria-modal="true" class="bottom-sheet" role="dialog">
      <header class="sheet-header">
        <div><span class="eyebrow">SoundDesigner settings</span><strong>{folder ? folder.name : "Panel preferences"}</strong></div>
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
          <div class="segmented-control"><button class="is-active" type="button">Playhead</button><button type="button">Selected clip</button></div>
          <p>Premiere inserts into the first unlocked audio track. After Effects adds a footage layer at composition time.</p>
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
        <div><button class="ghost-button" onclick={onClose} type="button">Cancel</button><button class="primary-button" onclick={() => { onAutoPreview(draftAutoPreview); onLoop(draftLoop); onClose(); }} type="button">Save changes</button></div>
      </footer>
    </section>
  </div>
{/if}
