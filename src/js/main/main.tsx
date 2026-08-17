import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";
import {
  chooseLibraryFolder,
  createDemoLibrary,
  fileUrl,
  folderNameFromPath,
  loadLibraryPaths,
  nextAccent,
  saveLibraryPaths,
  scanFolder,
  waitForPanelPaint,
} from "./library";
import { detectHost, insertAudioInHost } from "./hostBridge";
import { openLinkInBrowser } from "../lib/utils/bolt";
import {
  checkForUpdates,
  dismissUpdate,
  INSTALLED_VERSION,
  isUpdateDismissed,
  type UpdateState,
} from "./updater";
import type { HostApp, LibraryFolder, LibraryTreeNode, ScanProgress, SearchTab, SoundFile, ToastMessage } from "./types";
import "./main.scss";

const demoLibrary = createDemoLibrary();
const DEFAULT_TABS: SearchTab[] = [
  { id: "search-impact", label: "Impact", query: "impact" },
  { id: "search-room", label: "Room tone", query: "room tone" },
  { id: "search-rise", label: "Risers", query: "rise" },
];
const createLibraryTabs = (): SearchTab[] => [{ id: "search-library", label: "All sounds", query: "" }];
const PREFERENCES_STORAGE_KEY = "sounddesigner.preferences.v1";

const loadPreferences = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) || "{}");
    return {
      autoPreview: typeof stored.autoPreview === "boolean" ? stored.autoPreview : true,
      loop: typeof stored.loop === "boolean" ? stored.loop : true,
    };
  } catch (_error) {
    return { autoPreview: true, loop: true };
  }
};

const savePreferences = (autoPreview: boolean, loop: boolean) => {
  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ autoPreview, loop }));
  } catch (_error) {
    // The panel remains usable if host policy blocks local storage.
  }
};

const formatDuration = (seconds: number) => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${minutes}:${remainder.toFixed(safe < 10 ? 2 : 1).padStart(safe < 10 ? 4 : 4, "0")}`;
};

const formatSize = (bytes: number) => {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const relativeTime = (timestamp: number, now: number) => {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
};

const hostLabel = (host: HostApp) => {
  if (host === "premiere") return "Premiere Pro";
  if (host === "aftereffects") return "After Effects";
  if (host === "browser") return "Browser preview";
  return "Adobe host";
};

const collectTreeIds = (node: LibraryTreeNode, target: Set<string>) => {
  target.add(node.id);
  for (let index = 0; index < node.children.length; index += 1) collectTreeIds(node.children[index], target);
};

const findTreeNode = (node: LibraryTreeNode, nodeId: string): LibraryTreeNode | null => {
  if (node.id === nodeId) return node;
  for (let index = 0; index < node.children.length; index += 1) {
    const match = findTreeNode(node.children[index], nodeId);
    if (match) return match;
  }
  return null;
};

const countTreeNodes = (node: LibraryTreeNode): number => {
  let count = 1;
  for (let index = 0; index < node.children.length; index += 1) count += countTreeNodes(node.children[index]);
  return count;
};

type IconButtonProps = {
  icon: IconName;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
};

const IconButton = ({ icon, label, onClick, active, disabled, className = "", type = "button" }: IconButtonProps) => (
  <button
    aria-label={label}
    className={`icon-button tooltip ${active ? "is-active" : ""} ${className}`}
    data-tooltip={label}
    disabled={disabled}
    onClick={onClick}
    type={type}
  >
    <Icon name={icon} />
  </button>
);

const Waveform = ({
  values,
  progress = 0,
  compact = false,
  zoom = 1,
  reversed = false,
}: {
  values: number[];
  progress?: number;
  compact?: boolean;
  zoom?: number;
  reversed?: boolean;
}) => {
  const count = Math.max(18, Math.floor(values.length / zoom));
  const visibleValues = values.slice(0, count);
  if (reversed) visibleValues.reverse();
  return (
    <div className={`waveform ${compact ? "waveform--compact" : ""}`} aria-label="Audio waveform">
      <div className="waveform-bars waveform-bars--base">
        {visibleValues.map((value, index) => (
          <i key={`${index}-${value}`} style={{ height: `${Math.round(value * 88 + 8)}%` }} />
        ))}
      </div>
      <div className="waveform-played" style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}>
        <div className="waveform-bars waveform-bars--played">
          {visibleValues.map((value, index) => (
            <i key={`${index}-${value}`} style={{ height: `${Math.round(value * 88 + 8)}%` }} />
          ))}
        </div>
      </div>
      {!compact && <span className="waveform-playhead" style={{ insetInlineStart: `${Math.max(0, Math.min(100, progress * 100))}%` }} />}
    </div>
  );
};

const EmptyState = ({ onAdd }: { onAdd: () => void }) => (
  <div className="empty-state">
    <span className="empty-glyph"><Icon name="waveform" size={22} /></span>
    <strong>No sounds match this search</strong>
    <span>Try fewer keywords or index another sound folder.</span>
    <button className="ghost-button" onClick={onAdd} type="button"><Icon name="folder" /> Add folder</button>
  </div>
);

const treeMatchesQuery = (node: LibraryTreeNode, query: string): boolean => {
  if (!query || node.name.toLowerCase().indexOf(query) > -1) return true;
  return node.children.some((child) => treeMatchesQuery(child, query));
};

const LibraryTreeRow = ({
  node,
  depth,
  selectedId,
  expandedIds,
  filterQuery,
  meta,
  onSelect,
  onToggle,
  onEdit,
}: {
  node: LibraryTreeNode;
  depth: number;
  selectedId: string;
  expandedIds: Set<string>;
  filterQuery: string;
  meta?: string;
  onSelect: (nodeId: string) => void;
  onToggle: (nodeId: string) => void;
  onEdit?: () => void;
}) => {
  const visibleChildren = node.children.filter((child) => treeMatchesQuery(child, filterQuery));
  const hasChildren = visibleChildren.length > 0;
  const expanded = filterQuery.length > 0 || expandedIds.has(node.id);
  return (
    <div className="library-tree-branch">
      <div className={`library-tree-row ${selectedId === node.id ? "is-selected" : ""}`} style={{ paddingInlineStart: `${4 + depth * 13}px` }}>
        <button
          aria-label={`${expanded ? "Collapse" : "Expand"} ${node.name}`}
          className={`tree-expander ${expanded ? "is-expanded" : ""}`}
          disabled={!hasChildren}
          onClick={() => onToggle(node.id)}
          type="button"
        ><Icon name="chevron" size={12} /></button>
        <button className="library-tree-select" onClick={() => onSelect(node.id)} type="button">
          <span className="library-icon"><Icon name="folder" size={14} /></span>
          <span className="library-copy">
            <strong>{node.name}</strong>
            <small>{meta || (node.children.length ? `${node.children.length} folders` : `${node.directFileCount} sounds`)}</small>
          </span>
          <span className="count-badge">{node.totalFileCount}</span>
        </button>
        {onEdit && <IconButton icon="more" label={`Edit ${node.name}`} onClick={onEdit} className="library-more" />}
      </div>
      {hasChildren && expanded && (
        <div className="library-tree-children">
          {visibleChildren.map((child) => (
            <LibraryTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              filterQuery={filterQuery}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const LibrarySidebar = ({
  folders,
  sounds,
  selectedFolder,
  query,
  indexing,
  indexProgress,
  now,
  onSelectFolder,
  onQueryChange,
  onAddFolder,
  onEditFolder,
  onRescan,
  onClose,
  update,
  updateDismissed,
  onOpenUpdate,
  onDismissUpdate,
}: {
  folders: LibraryFolder[];
  sounds: SoundFile[];
  selectedFolder: string;
  query: string;
  indexing: boolean;
  indexProgress: ScanProgress;
  now: number;
  onSelectFolder: (folderId: string) => void;
  onQueryChange: (value: string) => void;
  onAddFolder: () => void;
  onEditFolder: (folderId: string) => void;
  onRescan: () => void;
  onClose: () => void;
  update: UpdateState;
  updateDismissed: boolean;
  onOpenUpdate: () => void;
  onDismissUpdate: () => void;
}) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const normalizedQuery = query.trim().toLowerCase();
  const toggleTreeNode = (nodeId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };
  const progressLocation = folderNameFromPath(indexProgress.currentPath);
  return (
  <aside className="library-panel">
    <div className="panel-heading">
      <div>
        <span className="eyebrow">Library</span>
        <strong>{sounds.length.toLocaleString()} sounds</strong>
      </div>
      <div className="heading-actions">
        <IconButton icon="refresh" label="Rescan all folders" onClick={onRescan} disabled={indexing} />
        <IconButton icon="add" label="Add sound folder" onClick={onAddFolder} />
        <IconButton icon="close" label="Close library drawer" onClick={onClose} className="drawer-close" />
      </div>
    </div>

    <label className="compact-search">
      <Icon name="search" />
      <input aria-label="Search library folders" onChange={(event) => onQueryChange(event.target.value)} placeholder="Filter library" value={query} />
      {query && <IconButton icon="close" label="Clear library filter" onClick={() => onQueryChange("")} />}
    </label>

    <div className="library-list">
      <button className={`library-item library-item--all ${selectedFolder === "all" ? "is-selected" : ""}`} onClick={() => onSelectFolder("all")} type="button">
        <span className="library-icon"><Icon name="library" /></span>
        <span className="library-copy"><strong>All sounds</strong><small>Every indexed folder</small></span>
        <span className="count-badge">{sounds.length}</span>
      </button>
      {folders
        .filter((folder) => treeMatchesQuery(folder.tree, normalizedQuery))
        .map((folder) => (
          <LibraryTreeRow
            key={folder.id}
            node={folder.tree}
            depth={0}
            selectedId={selectedFolder}
            expandedIds={expandedIds}
            filterQuery={normalizedQuery}
            meta={`Indexed ${relativeTime(folder.indexedAt, now)}`}
            onSelect={onSelectFolder}
            onToggle={toggleTreeNode}
            onEdit={() => onEditFolder(folder.id)}
          />
        ))}
    </div>

    {update.status === "available" && !updateDismissed && (
      <div className="update-card" role="status">
        <span className="update-card__glyph"><Icon name="download" size={14} /></span>
        <span className="update-card__copy">
          <strong>Update available</strong>
          <small>SoundDesigner {update.latestVersion}</small>
        </span>
        <IconButton icon="download" label={`Download SoundDesigner ${update.latestVersion}`} onClick={onOpenUpdate} className="update-card__action" />
        <IconButton icon="close" label={`Dismiss SoundDesigner ${update.latestVersion} update`} onClick={onDismissUpdate} className="update-card__dismiss" />
      </div>
    )}

    {indexing && (
      <div className="index-card">
        <div className="index-card__top">
          <span className="status-dot is-pulsing" />
          <strong>Indexing library</strong>
          <span>{indexProgress.files} files</span>
        </div>
        <div className="meter-track is-indeterminate"><i /></div>
        <small>{indexProgress.folders} folders · {progressLocation || "Starting…"}</small>
      </div>
    )}
  </aside>
  );
};

const SearchTabs = ({ tabs, activeId, onActivate, onAdd, onClose }: {
  tabs: SearchTab[];
  activeId: string;
  onActivate: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
}) => (
  <div className="search-tabs" role="tablist" aria-label="Sound searches">
    <div className="search-tabs__scroller">
      {tabs.map((tab) => (
        <button
          aria-selected={tab.id === activeId}
          className={`search-tab ${tab.id === activeId ? "is-active" : ""}`}
          key={tab.id}
          onClick={() => onActivate(tab.id)}
          role="tab"
          type="button"
        >
          <Icon name="search" size={13} />
          <span>{tab.label || "New search"}</span>
          {tabs.length > 1 && (
            <span
              aria-label={`Close ${tab.label} search`}
              className="tab-close tooltip"
              data-tooltip="Close search"
              onClick={(event) => { event.stopPropagation(); onClose(tab.id); }}
              role="button"
            ><Icon name="close" size={12} /></span>
          )}
        </button>
      ))}
    </div>
    <IconButton icon="add" label="Open a new search tab" onClick={onAdd} className="new-tab-button" />
  </div>
);

const SoundRow = ({ sound, selected, playing, progress, onSelect, onPlay, onInsert, onFavorite, onDragStart }: {
  sound: SoundFile;
  selected: boolean;
  playing: boolean;
  progress: number;
  onSelect: () => void;
  onPlay: () => void;
  onInsert: () => void;
  onFavorite: () => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
}) => {
  const score = 76 + (sound.name.length * 7) % 23;
  return (
    <div
      className={`sound-row accent-${sound.accent} ${selected ? "is-selected" : ""}`}
      draggable={!sound.isDemo}
      onClick={onSelect}
      onDoubleClick={onInsert}
      onDragStart={onDragStart}
      role="option"
      aria-selected={selected}
    >
      <span className="drag-handle tooltip" data-tooltip={sound.isDemo ? "Demo sound" : "Drag to host (support varies)"}><Icon name="drag" /></span>
      <button aria-label={playing ? `Pause ${sound.name}` : `Preview ${sound.name}`} className="row-play tooltip" data-tooltip={playing ? "Pause preview" : "Preview sound"} onClick={(event) => { event.stopPropagation(); onPlay(); }} type="button">
        <Icon name={playing ? "pause" : "play"} size={14} />
      </button>
      <div className="sound-main">
        <div className="sound-title-line"><strong>{sound.name}</strong>{sound.isDemo && <span className="demo-badge">DEMO</span>}</div>
        <Waveform compact values={sound.waveform} progress={playing ? progress : 0} />
      </div>
      <div className="sound-meta">
        <span>{sound.duration ? formatDuration(sound.duration) : "—:—"}</span>
        <small>{sound.extension.toUpperCase()} · {formatSize(sound.size)}</small>
      </div>
      <span className="match-score tooltip" data-tooltip="Search relevance">{score}%</span>
      <IconButton icon="heart" label={sound.favorite ? "Remove from favorites" : "Add to favorites"} active={sound.favorite} onClick={() => onFavorite()} className="row-favorite" />
    </div>
  );
};

const PreviewPane = ({ sound, progress, zoom, reversed, onSeek, onZoomIn, onZoomOut }: {
  sound: SoundFile | null;
  progress: number;
  zoom: number;
  reversed: boolean;
  onSeek: (progress: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) => (
  <section className="preview-pane">
    <div className="preview-heading">
      <div><span className="eyebrow">Spectrum preview</span><strong>{sound ? sound.name : "Nothing selected"}</strong></div>
      <div className="preview-tools">
        <span className="zoom-value">{zoom.toFixed(1)}×</span>
        <IconButton icon="zoomOut" label="Zoom waveform out" onClick={onZoomOut} disabled={zoom <= 1} />
        <IconButton icon="zoomIn" label="Zoom waveform in" onClick={onZoomIn} disabled={zoom >= 3} />
      </div>
    </div>
    <button
      aria-label="Seek audio preview"
      className="hero-waveform"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek((event.clientX - rect.left) / rect.width);
      }}
      type="button"
    >
      <span className="time-ruler"><i>0:00</i><i>{sound ? formatDuration((sound.duration || 8) / 2) : "0:00"}</i><i>{sound ? formatDuration(sound.duration || 8) : "0:00"}</i></span>
      <Waveform values={sound ? sound.waveform : createDemoLibrary().sounds[0].waveform} progress={progress} zoom={zoom} reversed={reversed} />
    </button>
    <div className="preview-detail-grid">
      <div><span>Format</span><strong>{sound ? sound.extension.toUpperCase() : "—"}</strong></div>
      <div><span>Size</span><strong>{sound ? formatSize(sound.size) : "—"}</strong></div>
      <div><span>Length</span><strong>{sound && sound.duration ? formatDuration(sound.duration) : "On load"}</strong></div>
      <div><span>Source</span><strong>{sound?.isDemo ? "Demo" : sound ? "Local" : "—"}</strong></div>
    </div>
    <div className="tag-row">
      {(sound?.tags || ["select", "a sound"]).slice(0, 5).map((tag) => <span className="tag-chip" key={tag}>{tag}</span>)}
    </div>
  </section>
);

const Transport = ({ sound, playing, progress, volume, loop, reversed, busy, onPrevious, onTogglePlay, onNext, onStop, onLoop, onReverse, onVolume, onInsert, onRemove }: {
  sound: SoundFile | null;
  playing: boolean;
  progress: number;
  volume: number;
  loop: boolean;
  reversed: boolean;
  busy: boolean;
  onPrevious: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onStop: () => void;
  onLoop: () => void;
  onReverse: () => void;
  onVolume: (value: number) => void;
  onInsert: () => void;
  onRemove: () => void;
}) => (
  <footer className="transport-bar">
    <div className="now-playing">
      <span className="now-glyph"><Icon name="waveform" /></span>
      <div><span className="eyebrow">Now previewing</span><strong>{sound ? sound.name : "Select a sound"}</strong></div>
    </div>
    <div className="transport-controls">
      <IconButton icon="previous" label="Previous sound" onClick={onPrevious} disabled={!sound} />
      <button aria-label={playing ? "Pause preview" : "Play preview"} className="play-button tooltip" data-tooltip={playing ? "Pause preview" : "Play preview"} disabled={!sound} onClick={onTogglePlay} type="button">
        <Icon name={playing ? "pause" : "play"} size={18} />
      </button>
      <IconButton icon="next" label="Next sound" onClick={onNext} disabled={!sound} />
      <IconButton icon="stop" label="Stop and return to start" onClick={onStop} disabled={!sound} />
      <IconButton icon="loop" label="Loop preview" active={loop} onClick={onLoop} />
      <IconButton icon="reverse" label="Reverse preview" active={reversed} onClick={onReverse} />
    </div>
    <div className="transport-right">
      <div className="volume-control tooltip" data-tooltip="Preview volume">
        <Icon name="volume" />
        <input aria-label="Preview volume" max="1" min="0" onChange={(event) => onVolume(Number(event.target.value))} step="0.01" type="range" value={volume} />
      </div>
      <span className="transport-time">{sound ? formatDuration(progress * (sound.duration || 0)) : "0:00"}</span>
      <IconButton icon="trash" label="Remove from index (keeps source file)" onClick={onRemove} disabled={!sound} className="danger-icon" />
      <button className="primary-button tooltip" data-tooltip="Insert at the current playhead" disabled={!sound || busy} onClick={onInsert} type="button">
        {busy ? <span className="spinner" /> : <Icon name="download" />}
        <span>Insert</span>
      </button>
    </div>
  </footer>
);

const SettingsSheet = ({ open, folder, autoPreview, loop, update, onAutoPreview, onLoop, onCheckUpdate, onOpenUpdate, onClose, onDelete }: {
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
}) => {
  const [draftAutoPreview, setDraftAutoPreview] = useState(autoPreview);
  const [draftLoop, setDraftLoop] = useState(loop);
  useEffect(() => { if (open) { setDraftAutoPreview(autoPreview); setDraftLoop(loop); } }, [open, autoPreview, loop]);
  if (!open) return null;
  return (
    <div className="sheet-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-modal="true" className="bottom-sheet" role="dialog">
        <header className="sheet-header">
          <div><span className="eyebrow">SoundDesigner settings</span><strong>{folder ? folder.name : "Panel preferences"}</strong></div>
          <IconButton icon="close" label="Close settings" onClick={onClose} />
        </header>
        <div className="sheet-body">
          {folder && (
            <div className="settings-group">
              <span className="field-label">Library folder</span>
              <div className="path-field"><Icon name="folder" /><code>{folder.path}</code></div>
              <p>{folder.fileCount.toLocaleString()} indexed audio files. Removing this library never deletes the source folder or its files.</p>
            </div>
          )}
          <div className="settings-group">
            <span className="field-label">Preview behavior</span>
            <label className="switch-row">
              <span><strong>Auto-preview selection</strong><small>Start auditioning when the selection changes.</small></span>
              <input checked={draftAutoPreview} onChange={(event) => setDraftAutoPreview(event.target.checked)} type="checkbox" />
              <i className="switch"><b /></i>
            </label>
            <label className="switch-row">
              <span><strong>Loop previews</strong><small>Continue playback until you stop or choose another sound.</small></span>
              <input checked={draftLoop} onChange={(event) => setDraftLoop(event.target.checked)} type="checkbox" />
              <i className="switch"><b /></i>
            </label>
          </div>
          <div className="settings-group">
            <span className="field-label">Host insertion</span>
            <div className="segmented-control"><button className="is-active" type="button">Playhead</button><button type="button">Selected clip</button></div>
            <p>Premiere inserts into the first unlocked audio track. After Effects adds a footage layer at composition time.</p>
          </div>
          <div className="settings-group">
            <span className="field-label">Updates</span>
            <div className="update-settings-row">
              <span className="update-settings-copy">
                <strong>SoundDesigner {INSTALLED_VERSION}</strong>
                <small>{update.status === "checking" ? "Checking GitHub…" : update.message || "Updates have not been checked yet."}</small>
              </span>
              <IconButton icon="refresh" label="Check GitHub for updates" onClick={onCheckUpdate} disabled={update.status === "checking"} />
              {update.status === "available" && <IconButton icon="download" label={`Download SoundDesigner ${update.latestVersion}`} onClick={onOpenUpdate} />}
            </div>
            <p>Stable releases are checked at most once every 24 hours. Downloads open in your default browser for explicit installation.</p>
          </div>
        </div>
        <footer className="sheet-footer">
          <button className="danger-ghost" disabled={!folder || folder.isDemo} onClick={onDelete} type="button"><Icon name="trash" /> Remove library</button>
          <div><button className="ghost-button" onClick={onClose} type="button">Cancel</button><button className="primary-button" onClick={() => { onAutoPreview(draftAutoPreview); onLoop(draftLoop); onClose(); }} type="button">Save changes</button></div>
        </footer>
      </section>
    </div>
  );
};

export const App = () => {
  const [host] = useState<HostApp>(() => detectHost());
  const [folders, setFolders] = useState<LibraryFolder[]>(demoLibrary.folders);
  const [sounds, setSounds] = useState<SoundFile[]>(demoLibrary.sounds);
  const [selectedFolder, setSelectedFolder] = useState("all");
  const [selectedId, setSelectedId] = useState(demoLibrary.sounds[0].id);
  const [folderQuery, setFolderQuery] = useState("");
  const [tabs, setTabs] = useState<SearchTab[]>(DEFAULT_TABS);
  const [activeTabId, setActiveTabId] = useState(DEFAULT_TABS[0].id);
  const [filter, setFilter] = useState("all");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(0.78);
  const [loop, setLoop] = useState(() => loadPreferences().loop);
  const [reversed, setReversed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<ScanProgress>({ files: 0, folders: 0, currentPath: "" });
  const [insertBusy, setInsertBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFolderId, setSettingsFolderId] = useState<string | null>(null);
  const [autoPreview, setAutoPreview] = useState(() => loadPreferences().autoPreview);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [updateState, setUpdateState] = useState<UpdateState>({ status: "idle", currentVersion: INSTALLED_VERSION });
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [floatingTooltip, setFloatingTooltip] = useState<{ text: string; x: number; y: number; above: boolean } | null>(null);
  const [now, setNow] = useState(Date.now());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const demoTimerRef = useRef<number | null>(null);
  const pendingPlayIdRef = useRef<string | null>(null);
  const togglePlayRef = useRef<() => void>(() => undefined);
  const stopPlaybackRef = useRef<() => void>(() => undefined);
  const playingRef = useRef(false);
  const toastIdRef = useRef(0);
  const tooltipTimerRef = useRef<number | null>(null);
  const persistedLibrarySignatureRef = useRef("");
  const libraryRestoreInProgressRef = useRef(false);
  const librarySyncInitializedRef = useRef(false);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];
  const selected = sounds.find((sound) => sound.id === selectedId) || null;
  const settingsFolder = folders.find((folder) => folder.id === settingsFolderId) || null;

  const selectedDirectoryIds = useMemo(() => {
    const ids = new Set<string>();
    if (selectedFolder === "all") return ids;
    for (let index = 0; index < folders.length; index += 1) {
      const folder = folders[index];
      const node = folder.id === selectedFolder ? folder.tree : findTreeNode(folder.tree, selectedFolder);
      if (node) {
        collectTreeIds(node, ids);
        break;
      }
    }
    return ids;
  }, [folders, selectedFolder]);

  const notify = (type: ToastMessage["type"], message: string) => {
    toastIdRef.current += 1;
    const toast = { id: toastIdRef.current, type, message };
    setToasts((current) => [...current.slice(-2), toast]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== toast.id)), 3200);
  };

  const persistLibraryFolders = (nextFolders: LibraryFolder[]) => {
    const paths = saveLibraryPaths(nextFolders);
    persistedLibrarySignatureRef.current = JSON.stringify(paths);
  };

  const refreshUpdates = async () => {
    setUpdateState((current) => ({ ...current, status: "checking", message: "Checking GitHub…" }));
    const next = await checkForUpdates(true);
    setUpdateState(next);
    setUpdateDismissed(isUpdateDismissed(next.latestVersion));
    notify(
      next.status === "available" ? "success" : next.status === "error" ? "warning" : "info",
      next.message || "Update check finished.",
    );
  };

  const openUpdate = () => {
    const url = updateState.downloadUrl || updateState.releaseUrl;
    if (!url) {
      notify("warning", "No trusted GitHub release download is available yet.");
      return;
    }
    openLinkInBrowser(url);
  };

  const dismissAvailableUpdate = () => {
    if (!updateState.latestVersion) return;
    dismissUpdate(updateState.latestVersion);
    setUpdateDismissed(true);
  };

  const visibleSounds = useMemo(() => {
    const queryTokens = (activeTab?.query || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
    return sounds.filter((sound) => {
      if (selectedFolder !== "all" && !selectedDirectoryIds.has(sound.directoryId)) return false;
      if (filter === "favorites" && !sound.favorite) return false;
      if (filter === "ambience" && sound.tags.indexOf("ambience") === -1 && sound.duration < 10) return false;
      if (filter === "one-shot" && sound.duration > 8) return false;
      const haystack = `${sound.name} ${sound.tags.join(" ")} ${sound.extension}`.toLowerCase();
      return queryTokens.every((token) => haystack.indexOf(token) > -1);
    });
  }, [sounds, selectedFolder, selectedDirectoryIds, filter, activeTab]);

  useEffect(() => {
    let timer: number | null = null;
    const syncRelativeTimeClock = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      if (!document.hidden) {
        setNow(Date.now());
        timer = window.setInterval(() => setNow(Date.now()), 60000);
      }
    };
    document.addEventListener("visibilitychange", syncRelativeTimeClock);
    syncRelativeTimeClock();
    return () => {
      document.removeEventListener("visibilitychange", syncRelativeTimeClock);
      if (timer !== null) window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    savePreferences(autoPreview, loop);
  }, [autoPreview, loop]);

  useEffect(() => {
    let cancelled = false;
    checkForUpdates().then((next) => {
      if (cancelled) return;
      setUpdateState(next);
      setUpdateDismissed(isUpdateDismissed(next.latestVersion));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const tooltipTarget = (target: EventTarget | null) => target instanceof Element
      ? target.closest<HTMLElement>(".tooltip[data-tooltip]")
      : null;
    const hideTooltip = () => {
      if (tooltipTimerRef.current !== null) window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
      setFloatingTooltip(null);
    };
    const showTooltip = (element: HTMLElement) => {
      hideTooltip();
      tooltipTimerRef.current = window.setTimeout(() => {
        const text = element.dataset.tooltip;
        if (!text || !document.documentElement.contains(element)) return;
        const rect = element.getBoundingClientRect();
        const above = Boolean(element.closest(".transport-bar")) || rect.bottom + 38 > window.innerHeight;
        const halfWidth = Math.min(96, Math.max(42, window.innerWidth / 2 - 8));
        const center = rect.left + rect.width / 2;
        setFloatingTooltip({
          text,
          x: Math.max(halfWidth, Math.min(window.innerWidth - halfWidth, center)),
          y: above ? rect.top - 7 : rect.bottom + 7,
          above,
        });
      }, 380);
    };
    const onPointerOver = (event: PointerEvent) => {
      const next = tooltipTarget(event.target);
      if (next && next !== tooltipTarget(event.relatedTarget)) showTooltip(next);
    };
    const onPointerOut = (event: PointerEvent) => {
      const current = tooltipTarget(event.target);
      if (current && current !== tooltipTarget(event.relatedTarget)) hideTooltip();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = tooltipTarget(event.target);
      if (target) showTooltip(target);
    };
    const onFocusOut = () => hideTooltip();
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      if (tooltipTimerRef.current !== null) window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (event.key === "Escape") {
        setSettingsOpen(false);
        setSidebarOpen(false);
      } else if (event.code === "Space" && !editing) {
        event.preventDefault();
        togglePlayRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!window.cep) return;
    let cancelled = false;
    const restore = async () => {
      if (libraryRestoreInProgressRef.current) return;
      const storedPaths = loadLibraryPaths();
      const signature = JSON.stringify(storedPaths);
      if (signature === persistedLibrarySignatureRef.current) return;
      const isCrossHostRefresh = librarySyncInitializedRef.current;
      persistedLibrarySignatureRef.current = signature;
      librarySyncInitializedRef.current = true;
      libraryRestoreInProgressRef.current = true;

      if (!storedPaths.length) {
        if (isCrossHostRefresh && !cancelled) {
          setFolders(demoLibrary.folders);
          setSounds(demoLibrary.sounds);
          setSelectedFolder("all");
          setSelectedId(demoLibrary.sounds[0].id);
          setTabs(DEFAULT_TABS);
          setActiveTabId(DEFAULT_TABS[0].id);
          notify("info", "Shared library cleared. Demo folders restored.");
        }
        libraryRestoreInProgressRef.current = false;
        return;
      }

      setIsIndexing(true);
      setIndexProgress({ files: 0, folders: 0, currentPath: "" });
      const nextFolders: LibraryFolder[] = [];
      const nextSounds: SoundFile[] = [];
      let completedFiles = 0;
      let completedFolders = 0;
      for (let index = 0; index < storedPaths.length; index += 1) {
        try {
          const result = await scanFolder(storedPaths[index], nextAccent(index), (progress) => setIndexProgress({
            files: completedFiles + progress.files,
            folders: completedFolders + progress.folders,
            currentPath: progress.currentPath,
          }));
          nextFolders.push(result.folder);
          nextSounds.push(...result.sounds);
          completedFiles += result.sounds.length;
          completedFolders += countTreeNodes(result.folder.tree);
        } catch (_error) {
          // Unavailable folders are skipped without corrupting the shared path list.
        }
      }
      if (!cancelled && nextFolders.length) {
        setFolders(nextFolders);
        setSounds(nextSounds);
        setSelectedFolder("all");
        setSelectedId(nextSounds[0]?.id || "");
        setTabs(createLibraryTabs());
        setActiveTabId("search-library");
        if (isCrossHostRefresh) notify("success", `Library synced · ${nextSounds.length} sounds`);
      } else if (!cancelled && isCrossHostRefresh) {
        notify("warning", "Shared library paths are currently unavailable on this computer.");
      }
      if (!cancelled) setIsIndexing(false);
      libraryRestoreInProgressRef.current = false;
    };
    const syncWhenVisible = () => { if (!document.hidden) restore(); };
    window.addEventListener("focus", syncWhenVisible);
    document.addEventListener("visibilitychange", syncWhenVisible);
    restore();
    return () => {
      cancelled = true;
      window.removeEventListener("focus", syncWhenVisible);
      document.removeEventListener("visibilitychange", syncWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (demoTimerRef.current !== null) window.clearInterval(demoTimerRef.current);
    demoTimerRef.current = null;
    setPlaying(false);
    setProgress(0);
    const startPendingPreview = () => {
      if (selected && pendingPlayIdRef.current === selected.id) {
        pendingPlayIdRef.current = null;
        window.setTimeout(() => togglePlayRef.current(), 0);
      }
    };
    if (!selected?.path) {
      startPendingPreview();
      return;
    }
    const audio = new Audio(fileUrl(selected.path));
    audio.preload = "metadata";
    audio.volume = volume;
    audio.loop = loop;
    const onTimeUpdate = () => {
      if (audio.duration) setProgress(audio.currentTime / audio.duration);
    };
    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setSounds((current) => current.map((sound) => sound.id === selected.id ? { ...sound, duration: audio.duration } : sound));
      }
    };
    const onEnded = () => { if (!audio.loop) { setPlaying(false); setProgress(1); } };
    const onError = () => {
      if (audioRef.current !== audio || !audio.paused || audio.currentTime > 0) return;
      notify("error", "This audio format could not be previewed by CEP.");
    };
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audioRef.current = audio;
    startPendingPreview();
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      if (audioRef.current === audio) audioRef.current = null;
      audio.removeAttribute("src");
      audio.load();
    };
  }, [selectedId]);

  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);
  useEffect(() => { if (audioRef.current) audioRef.current.loop = loop; }, [loop]);

  const stopDemoTimer = () => {
    if (demoTimerRef.current !== null) window.clearInterval(demoTimerRef.current);
    demoTimerRef.current = null;
  };

  const togglePlay = () => {
    if (!selected) return;
    if (playing) {
      audioRef.current?.pause();
      stopDemoTimer();
      setPlaying(false);
      return;
    }
    if (selected.path && audioRef.current) {
      if (reversed) {
        notify("warning", "Reverse audition is queued for the non-destructive render engine; forward preview is playing.");
      }
      audioRef.current.play().then(() => setPlaying(true)).catch(() => notify("error", "Audio preview could not start."));
      return;
    }
    setPlaying(true);
    stopDemoTimer();
    demoTimerRef.current = window.setInterval(() => {
      setProgress((current) => {
        const step = 0.04 / Math.max(1, selected.duration);
        const next = reversed ? current - step : current + step;
        if ((reversed && next <= 0) || (!reversed && next >= 1)) {
          if (loop) return reversed ? 1 : 0;
          stopDemoTimer();
          setPlaying(false);
          return reversed ? 0 : 1;
        }
        return next;
      });
    }, 40);
  };
  togglePlayRef.current = togglePlay;

  const stopPlayback = () => {
    stopDemoTimer();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    setPlaying(false);
    setProgress(reversed ? 1 : 0);
  };
  stopPlaybackRef.current = stopPlayback;
  playingRef.current = playing;

  useEffect(() => {
    const handOffPreviewToHost = () => {
      const audioIsPlaying = Boolean(audioRef.current && !audioRef.current.paused);
      const demoIsPlaying = demoTimerRef.current !== null;
      if (!playingRef.current && !audioIsPlaying && !demoIsPlaying) return;
      pendingPlayIdRef.current = null;
      stopPlaybackRef.current();
      setLoop(false);
    };
    window.addEventListener("blur", handOffPreviewToHost);
    return () => window.removeEventListener("blur", handOffPreviewToHost);
  }, []);

  const seek = (nextProgress: number) => {
    const safe = Math.max(0, Math.min(1, nextProgress));
    setProgress(safe);
    if (audioRef.current && audioRef.current.duration) audioRef.current.currentTime = safe * audioRef.current.duration;
  };

  const selectSound = (id: string) => {
    if (autoPreview && id !== selectedId) pendingPlayIdRef.current = id;
    setSelectedId(id);
  };

  const moveSelection = (direction: number) => {
    if (!visibleSounds.length) return;
    const currentIndex = visibleSounds.findIndex((sound) => sound.id === selectedId);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + visibleSounds.length) % visibleSounds.length;
    setSelectedId(visibleSounds[nextIndex].id);
  };

  const addFolder = async () => {
    notify("info", "Choose a sound-library folder…");
    await waitForPanelPaint();
    let chosen: string | null = null;
    try {
      chosen = chooseLibraryFolder();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "The folder picker could not open.");
      return;
    }
    if (!chosen) {
      notify(window.cep ? "info" : "warning", window.cep ? "No folder was selected." : "Folder picking is available inside the installed CEP panel.");
      return;
    }
    if (folders.some((folder) => folder.path === chosen)) {
      notify("warning", "That folder is already indexed.");
      return;
    }
    setIsIndexing(true);
    setIndexProgress({ files: 0, folders: 1, currentPath: chosen });
    notify("info", `Indexing ${folderNameFromPath(chosen)}…`);
    await waitForPanelPaint();
    try {
      const realFolders = folders.filter((folder) => !folder.isDemo);
      const result = await scanFolder(chosen, nextAccent(realFolders.length), setIndexProgress);
      const nextFolders = [...realFolders, result.folder];
      const nextSounds = [...sounds.filter((sound) => !sound.isDemo), ...result.sounds];
      setFolders(nextFolders);
      setSounds(nextSounds);
      persistLibraryFolders(nextFolders);
      setSelectedFolder(result.folder.id);
      setSelectedId(result.sounds[0]?.id || "");
      if (!realFolders.length) {
        setTabs(createLibraryTabs());
        setActiveTabId("search-library");
      }
      setIndexProgress({ files: result.sounds.length, folders: countTreeNodes(result.folder.tree), currentPath: result.folder.path });
      notify(result.sounds.length ? "success" : "warning", `${result.folder.name} indexed · ${result.sounds.length} sounds · ${countTreeNodes(result.folder.tree)} folders`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "The folder could not be indexed.");
    } finally {
      setIsIndexing(false);
    }
  };

  const rescanAll = async () => {
    const realFolders = folders.filter((folder) => !folder.isDemo);
    if (!realFolders.length) { notify("info", "Add a real folder to start indexing."); return; }
    setIsIndexing(true);
    setIndexProgress({ files: 0, folders: 0, currentPath: "" });
    notify("info", "Refreshing sound libraries…");
    await waitForPanelPaint();
    const nextFolders: LibraryFolder[] = [];
    const nextSounds: SoundFile[] = [];
    let completedFiles = 0;
    let completedFolders = 0;
    for (let index = 0; index < realFolders.length; index += 1) {
      try {
        const result = await scanFolder(realFolders[index].path, realFolders[index].accent, (progress) => setIndexProgress({
          files: completedFiles + progress.files,
          folders: completedFolders + progress.folders,
          currentPath: progress.currentPath,
        }));
        nextFolders.push(result.folder);
        nextSounds.push(...result.sounds);
        completedFiles += result.sounds.length;
        completedFolders += countTreeNodes(result.folder.tree);
      } catch (_error) {
        notify("error", `${realFolders[index].name} is unavailable.`);
      }
    }
    setFolders(nextFolders);
    setSounds(nextSounds);
    setSelectedId(nextSounds[0]?.id || "");
    persistLibraryFolders(nextFolders);
    setIsIndexing(false);
    setIndexProgress({ files: completedFiles, folders: completedFolders, currentPath: "" });
    notify("success", `Library refreshed · ${nextSounds.length} sounds · ${completedFolders} folders`);
  };

  const insertSelected = async (soundOverride?: SoundFile | null) => {
    const sound = soundOverride || selected;
    if (!sound) return;
    setInsertBusy(true);
    const result = await insertAudioInHost({ path: sound.path, name: sound.name, targetAudioTrack: -1 });
    setInsertBusy(false);
    notify(result.ok ? "success" : "error", result.message);
  };

  const removeSelectedFromIndex = () => {
    if (!selected) return;
    setSounds((current) => current.filter((sound) => sound.id !== selected.id));
    const next = visibleSounds.find((sound) => sound.id !== selected.id);
    setSelectedId(next?.id || "");
    notify("info", "Removed from the search index. The source file was kept.");
  };

  const deleteSettingsFolder = () => {
    if (!settingsFolder || settingsFolder.isDemo) return;
    const nextFolders = folders.filter((folder) => folder.id !== settingsFolder.id);
    const nextSounds = sounds.filter((sound) => sound.folderId !== settingsFolder.id);
    setFolders(nextFolders.length ? nextFolders : demoLibrary.folders);
    setSounds(nextFolders.length ? nextSounds : demoLibrary.sounds);
    persistLibraryFolders(nextFolders);
    setSelectedFolder("all");
    setSelectedId((nextFolders.length ? nextSounds : demoLibrary.sounds)[0]?.id || "");
    if (!nextFolders.length) {
      setTabs(DEFAULT_TABS);
      setActiveTabId(DEFAULT_TABS[0].id);
    }
    setSettingsOpen(false);
    notify("info", `${settingsFolder.name} removed from SoundDesigner. Files were kept.`);
  };

  const updateSearchQuery = (query: string) => {
    setTabs((current) => current.map((tab) => tab.id === activeTabId ? { ...tab, query, label: query.trim() || "New search" } : tab));
  };

  const addSearchTab = () => {
    const id = `search-${Date.now()}`;
    setTabs((current) => [...current, { id, label: "New search", query: "" }]);
    setActiveTabId(id);
  };

  const closeSearchTab = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    const nextTabs = tabs.filter((tab) => tab.id !== id);
    setTabs(nextTabs);
    if (id === activeTabId) setActiveTabId(nextTabs[Math.max(0, index - 1)].id);
  };

  const dragSound = (sound: SoundFile, event: React.DragEvent<HTMLDivElement>) => {
    if (!sound.path) { event.preventDefault(); return; }
    const uri = fileUrl(sound.path);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("com.adobe.cep.dnd.file.0", sound.path);
    event.dataTransfer.setData("text/uri-list", uri);
    event.dataTransfer.setData("text/plain", sound.path);
    event.dataTransfer.setData("DownloadURL", `audio/${sound.extension}:${sound.name}.${sound.extension}:${uri}`);
  };

  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-open" : ""}`} data-host={host}>
      <header className="topbar">
        <div className="brand-block"><span className="brand-mark"><Icon name="waveform" size={18} /></span><div><strong>SoundDesigner</strong><small>Library workspace</small></div></div>
        <IconButton icon="library" label="Toggle library drawer" onClick={() => setSidebarOpen((open) => !open)} className="sidebar-toggle" active={sidebarOpen} />
        <div className="topbar-spacer" />
        <span className="host-pill tooltip" data-tooltip={`Connected to ${hostLabel(host)}`}><i />{hostLabel(host)}</span>
        <IconButton icon="activity" label="Library status" active={!isIndexing} />
        <IconButton icon="settings" label="Open panel settings" onClick={() => { setSettingsFolderId(null); setSettingsOpen(true); }} />
      </header>

      <main className="panel-body">
        <LibrarySidebar
          folders={folders}
          sounds={sounds}
          selectedFolder={selectedFolder}
          query={folderQuery}
          indexing={isIndexing}
          indexProgress={indexProgress}
          now={now}
          onSelectFolder={(id) => { setSelectedFolder(id); setSidebarOpen(false); }}
          onQueryChange={setFolderQuery}
          onAddFolder={addFolder}
          onEditFolder={(id) => { setSettingsFolderId(id); setSettingsOpen(true); }}
          onRescan={rescanAll}
          onClose={() => setSidebarOpen(false)}
          update={updateState}
          updateDismissed={updateDismissed}
          onOpenUpdate={openUpdate}
          onDismissUpdate={dismissAvailableUpdate}
        />

        <section className="search-workspace">
          <SearchTabs tabs={tabs} activeId={activeTabId} onActivate={setActiveTabId} onAdd={addSearchTab} onClose={closeSearchTab} />
          <div className="search-toolbar">
            <label className="hero-search">
              <Icon name="search" />
              <input ref={searchInputRef} aria-label="Sound search" onChange={(event) => updateSearchQuery(event.target.value)} placeholder="Search sounds, tags, or formats…" value={activeTab?.query || ""} />
              {activeTab?.query && <IconButton icon="close" label="Clear search" onClick={() => updateSearchQuery("")} />}
              <kbd>⌘ K</kbd>
            </label>
            <div className="search-actions">
              <div className="filter-chips" aria-label="Sound filters">
                {[{ id: "all", label: "All" }, { id: "one-shot", label: "One shots" }, { id: "ambience", label: "Ambience" }, { id: "favorites", label: "Favorites" }].map((item) => (
                  <button className={filter === item.id ? "is-active" : ""} key={item.id} onClick={() => setFilter(item.id)} type="button">{item.label}{item.id === "favorites" && <span className="tiny-badge">{sounds.filter((sound) => sound.favorite).length}</span>}</button>
                ))}
              </div>
              <IconButton icon="sliders" label="Open advanced search filters" />
              <IconButton icon="list" label="Toggle result density" active />
            </div>
          </div>

          <div className="results-summary"><span><strong>{visibleSounds.length}</strong> results</span><span>Sorted by <button type="button">Relevance <Icon name="chevron" size={12} /></button></span></div>

          <div className="search-content">
            <div className="results-list" role="listbox" aria-label="Sound results">
              {visibleSounds.length ? visibleSounds.map((sound) => (
                <SoundRow
                  key={sound.id}
                  sound={sound}
                  selected={sound.id === selectedId}
                  playing={playing && sound.id === selectedId}
                  progress={sound.id === selectedId ? progress : 0}
                  onSelect={() => selectSound(sound.id)}
                  onPlay={() => { if (sound.id !== selectedId) { pendingPlayIdRef.current = sound.id; setSelectedId(sound.id); } else togglePlay(); }}
                  onInsert={() => { setSelectedId(sound.id); insertSelected(sound); }}
                  onFavorite={() => setSounds((current) => current.map((item) => item.id === sound.id ? { ...item, favorite: !item.favorite } : item))}
                  onDragStart={(event) => dragSound(sound, event)}
                />
              )) : <EmptyState onAdd={addFolder} />}
            </div>
            <PreviewPane sound={selected} progress={progress} zoom={zoom} reversed={reversed} onSeek={seek} onZoomIn={() => setZoom((value) => Math.min(3, value + 0.5))} onZoomOut={() => setZoom((value) => Math.max(1, value - 0.5))} />
          </div>
        </section>
      </main>

      <Transport
        sound={selected}
        playing={playing}
        progress={progress}
        volume={volume}
        loop={loop}
        reversed={reversed}
        busy={insertBusy}
        onPrevious={() => moveSelection(-1)}
        onTogglePlay={togglePlay}
        onNext={() => moveSelection(1)}
        onStop={stopPlayback}
        onLoop={() => setLoop((value) => !value)}
        onReverse={() => { setReversed((value) => !value); stopPlayback(); }}
        onVolume={setVolume}
        onInsert={() => insertSelected()}
        onRemove={removeSelectedFromIndex}
      />

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => <div className={`toast toast--${toast.type}`} key={toast.id}><span>{toast.type === "success" ? "✓" : toast.type === "error" ? "!" : toast.type === "warning" ? "△" : "i"}</span>{toast.message}</div>)}
      </div>

      {floatingTooltip && (
        <div
          className={`floating-tooltip ${floatingTooltip.above ? "is-above" : "is-below"}`}
          role="tooltip"
          style={{ left: `${floatingTooltip.x}px`, top: `${floatingTooltip.y}px` }}
        >{floatingTooltip.text}</div>
      )}

      <SettingsSheet
        open={settingsOpen}
        folder={settingsFolder}
        autoPreview={autoPreview}
        loop={loop}
        update={updateState}
        onAutoPreview={setAutoPreview}
        onLoop={setLoop}
        onCheckUpdate={refreshUpdates}
        onOpenUpdate={openUpdate}
        onClose={() => setSettingsOpen(false)}
        onDelete={deleteSettingsFolder}
      />
    </div>
  );
};
