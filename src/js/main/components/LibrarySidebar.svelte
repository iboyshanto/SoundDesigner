<script lang="ts">
  import type { UpdateState } from "../updater";
  import type { LibraryFolder, ScanProgress, SoundFile } from "../types";
  import { folderNameFromPath } from "../library";
  import { relativeTime, treeMatchesQuery } from "../ui-utils";
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";
  import LibraryTreeRow from "./LibraryTreeRow.svelte";

  let {
    folders, sounds, selectedFolder, query, indexing, indexProgress, now,
    localSourceEnabled, freesoundLibraryEnabled, freesoundSourceEnabled, freesoundConnected, freesoundCount,
    onSelectFolder, onQueryChange, onAddFolder, onEditFolder, onRescan, onClose,
    onLocalSourceEnabled, onFreesoundSourceEnabled,
    update, updateDismissed, onOpenUpdate, onDismissUpdate,
  }: {
    folders: LibraryFolder[];
    sounds: SoundFile[];
    selectedFolder: string;
    query: string;
    indexing: boolean;
    indexProgress: ScanProgress;
    now: number;
    localSourceEnabled: boolean;
    freesoundLibraryEnabled: boolean;
    freesoundSourceEnabled: boolean;
    freesoundConnected: boolean;
    freesoundCount: number;
    onSelectFolder: (folderId: string) => void;
    onQueryChange: (value: string) => void;
    onAddFolder: () => void;
    onEditFolder: (folderId: string) => void;
    onRescan: () => void;
    onClose: () => void;
    onLocalSourceEnabled: (enabled: boolean) => void;
    onFreesoundSourceEnabled: (enabled: boolean) => void;
    update: UpdateState;
    updateDismissed: boolean;
    onOpenUpdate: () => void;
    onDismissUpdate: () => void;
  } = $props();

  let expandedIds = $state(new Set<string>());
  let normalizedQuery = $derived(query.trim().toLowerCase());
  let progressLocation = $derived(folderNameFromPath(indexProgress.currentPath));
  let visibleFolders = $derived(folders.filter((folder) => treeMatchesQuery(folder.tree, normalizedQuery)));
  let activeSourceCount = $derived(Number(localSourceEnabled) + Number(freesoundLibraryEnabled && freesoundSourceEnabled));

  const toggleTreeNode = (nodeId: string) => {
    const next = new Set(expandedIds);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    expandedIds = next;
  };
</script>

<aside class="library-panel">
  <div class="panel-heading">
    <div><span class="eyebrow">Library</span><strong>{activeSourceCount} {activeSourceCount === 1 ? "source" : "sources"} active</strong></div>
    <div class="heading-actions">
      <IconButton icon="refresh" label="Rescan all folders" onclick={onRescan} disabled={indexing} />
      <IconButton icon="add" label="Add sound folder" onclick={onAddFolder} />
      <IconButton icon="close" label="Close library drawer" onclick={onClose} class="drawer-close" />
    </div>
  </div>

  <div class="library-list">
    <div aria-label="Search sources" class="library-sources" role="group">
      <label class:is-active={localSourceEnabled} class="library-source-row">
        <input checked={localSourceEnabled} onchange={(event) => onLocalSourceEnabled(event.currentTarget.checked)} type="checkbox" />
        <span class="source-check"><Icon name="check" size={11} /></span>
        <span class="source-icon"><Icon name="drive" size={14} /></span>
        <span class="library-copy"><strong>Local</strong><small>{sounds.length.toLocaleString()} indexed sounds</small></span>
      </label>
      {#if localSourceEnabled}
        <div class="local-library-branch">
          {#if folders.length}
            <label class="compact-search">
              <Icon name="search" />
              <input aria-label="Search library folders" autocomplete="off" name="library-folder-search" oninput={(event) => onQueryChange(event.currentTarget.value)} placeholder="Filter local folders…" spellcheck="false" value={query} />
              {#if query}<IconButton icon="close" label="Clear library filter" onclick={() => onQueryChange("")} />{/if}
            </label>
          {/if}
          <button class:is-selected={selectedFolder === "all"} class="library-item library-item--all" onclick={() => onSelectFolder("all")} type="button">
            <span class="library-icon"><Icon name="library" /></span>
            <span class="library-copy"><strong>All local sounds</strong><small>Every indexed folder</small></span>
            <span class="count-badge">{sounds.length}</span>
          </button>
          {#each visibleFolders as folder (folder.id)}
            <LibraryTreeRow
              node={folder.tree}
              depth={0}
              selectedId={selectedFolder}
              {expandedIds}
              filterQuery={normalizedQuery}
              meta={`Indexed ${relativeTime(folder.indexedAt, now)}`}
              onSelect={onSelectFolder}
              onToggle={toggleTreeNode}
              onEdit={() => onEditFolder(folder.id)}
            />
          {/each}
        </div>
      {/if}
      {#if freesoundLibraryEnabled}
        <label class:is-active={freesoundSourceEnabled} class="library-source-row">
          <input checked={freesoundSourceEnabled} onchange={(event) => onFreesoundSourceEnabled(event.currentTarget.checked)} type="checkbox" />
          <span class="source-check"><Icon name="check" size={11} /></span>
          <span class="source-icon source-icon--cloud"><Icon name="cloud" size={14} /></span>
          <span class="library-copy"><strong>Freesound</strong><small>{freesoundConnected ? `${freesoundCount.toLocaleString()} cloud results` : "API key required"}</small></span>
        </label>
      {/if}
    </div>
  </div>

  {#if update.status === "available" && !updateDismissed}
    <div class="update-card" role="status">
      <span class="update-card__glyph"><Icon name="download" size={14} /></span>
      <span class="update-card__copy"><strong>Update available</strong><small>SoundDesigner {update.latestVersion}</small></span>
      <IconButton icon="download" label={`Download SoundDesigner ${update.latestVersion}`} onclick={onOpenUpdate} class="update-card__action" />
      <IconButton icon="close" label={`Dismiss SoundDesigner ${update.latestVersion} update`} onclick={onDismissUpdate} class="update-card__dismiss" />
    </div>
  {/if}

  {#if indexing}
    <div class="index-card">
      <div class="index-card__top"><span class="status-dot is-pulsing"></span><strong>Indexing library</strong><span>{indexProgress.files} files</span></div>
      <div class="meter-track is-indeterminate"><i></i></div>
      <small>{indexProgress.folders} folders · {progressLocation || "Starting…"}</small>
    </div>
  {/if}
</aside>
