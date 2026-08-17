<script lang="ts">
  import { onMount, untrack } from "svelte";
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
  import {
    detectHost,
    getAfterEffectsAudioDragState,
    insertAudioInHost,
    organizeAudioInHost,
    type AfterEffectsAudioDragState,
  } from "./hostBridge";
  import { openLinkInBrowser } from "../lib/utils/bolt";
  import { decodeAudioWaveformChannels } from "./audioWaveform";
  import { checkForUpdates, dismissUpdate, INSTALLED_VERSION, isUpdateDismissed, type UpdateState } from "./updater";
  import type { LibraryFolder, ScanProgress, SearchTab, SoundFile, ToastMessage } from "./types";
  import { collectTreeIds, countTreeNodes, findTreeNode, hostLabel } from "./ui-utils";
  import Icon from "./components/Icon.svelte";
  import IconButton from "./components/IconButton.svelte";
  import LibrarySidebar from "./components/LibrarySidebar.svelte";
  import PreviewPane from "./components/PreviewPane.svelte";
  import SearchTabs from "./components/SearchTabs.svelte";
  import SettingsSheet from "./components/SettingsSheet.svelte";
  import SoundRow from "./components/SoundRow.svelte";
  import Transport from "./components/Transport.svelte";
  import "./main.scss";

  const demoLibrary = createDemoLibrary();
  const DEFAULT_TABS: SearchTab[] = [
    { id: "search-impact", label: "Impact", query: "impact" },
    { id: "search-room", label: "Room tone", query: "room tone" },
    { id: "search-rise", label: "Risers", query: "rise" },
  ];
  const FILTERS = [
    { id: "all", label: "All" },
    { id: "one-shot", label: "One shots" },
    { id: "ambience", label: "Ambience" },
    { id: "favorites", label: "Favorites" },
  ];
  const RESULT_ROW_HEIGHT = 57;
  const VIRTUALIZATION_THRESHOLD = 200;
  const VIRTUAL_OVERSCAN = 8;
  const PREFERENCES_STORAGE_KEY = "sounddesigner.preferences.v1";
  const createLibraryTabs = (): SearchTab[] => [{ id: "search-library", label: "All sounds", query: "" }];

  type AfterEffectsDragSession = {
    id: number;
    soundId: string;
    baseline: Promise<AfterEffectsAudioDragState>;
    leftPanel: boolean;
    cancelled: boolean;
  };

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

  const savePreferences = (nextAutoPreview: boolean, nextLoop: boolean) => {
    try {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ autoPreview: nextAutoPreview, loop: nextLoop }));
    } catch (_error) {
      // The panel remains usable if host policy blocks local storage.
    }
  };

  const preferences = loadPreferences();
  const host = detectHost();
  let folders = $state<LibraryFolder[]>(demoLibrary.folders);
  let sounds = $state<SoundFile[]>(demoLibrary.sounds);
  let selectedFolder = $state("all");
  let selectedId = $state(demoLibrary.sounds[0].id);
  let folderQuery = $state("");
  let tabs = $state<SearchTab[]>(DEFAULT_TABS);
  let activeTabId = $state(DEFAULT_TABS[0].id);
  let filter = $state("all");
  let playing = $state(false);
  let progress = $state(0);
  let volume = $state(0.78);
  let loop = $state(preferences.loop);
  let reversed = $state(false);
  let zoom = $state(1);
  let previewChannels = $state<Float32Array[]>([]);
  let isIndexing = $state(false);
  let indexProgress = $state<ScanProgress>({ files: 0, folders: 0, currentPath: "" });
  let insertBusy = $state(false);
  let sidebarOpen = $state(false);
  let compactPreviewOpen = $state(false);
  let settingsOpen = $state(false);
  let settingsFolderId = $state<string | null>(null);
  let autoPreview = $state(preferences.autoPreview);
  let toasts = $state<ToastMessage[]>([]);
  let updateState = $state<UpdateState>({ status: "idle", currentVersion: INSTALLED_VERSION });
  let updateDismissed = $state(false);
  let floatingTooltip = $state<{ text: string; x: number; y: number; above: boolean } | null>(null);
  let now = $state(Date.now());
  let searchInput: HTMLInputElement;
  let resultsList: HTMLDivElement;
  let resultsScrollTop = $state(0);
  let resultsViewportHeight = $state(600);

  let audio: HTMLAudioElement | null = null;
  let demoTimer: number | null = null;
  let pendingPlayId: string | null = null;
  let toastId = 0;
  let tooltipTimer: number | null = null;
  let tooltipHideTimer: number | null = null;
  let persistedLibrarySignature = "";
  let libraryRestoreInProgress = false;
  let librarySyncInitialized = false;
  let afterEffectsDragSession: AfterEffectsDragSession | null = null;
  let afterEffectsDragSessionId = 0;

  let activeTab = $derived(tabs.find((tab) => tab.id === activeTabId) || tabs[0]);
  let selected = $derived(sounds.find((sound) => sound.id === selectedId) || null);
  let settingsFolder = $derived(folders.find((folder) => folder.id === settingsFolderId) || null);
  let favoriteCount = $derived(sounds.filter((sound) => sound.favorite).length);
  let selectedDirectoryIds = $derived.by(() => {
    const ids = new Set<string>();
    if (selectedFolder === "all") return ids;
    for (const folder of folders) {
      const node = folder.id === selectedFolder ? folder.tree : findTreeNode(folder.tree, selectedFolder);
      if (node) {
        collectTreeIds(node, ids);
        break;
      }
    }
    return ids;
  });
  let visibleSounds = $derived.by(() => {
    const queryTokens = (activeTab?.query || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
    return sounds.filter((sound) => {
      if (selectedFolder !== "all" && !selectedDirectoryIds.has(sound.directoryId)) return false;
      if (filter === "favorites" && !sound.favorite) return false;
      if (filter === "ambience" && !sound.tags.includes("ambience") && sound.duration < 10) return false;
      if (filter === "one-shot" && sound.duration > 8) return false;
      const haystack = `${sound.name} ${sound.tags.join(" ")} ${sound.extension}`.toLowerCase();
      return queryTokens.every((token) => haystack.includes(token));
    });
  });
  let virtualizedResults = $derived(visibleSounds.length > VIRTUALIZATION_THRESHOLD);
  let virtualStart = $derived.by(() => {
    if (!virtualizedResults) return 0;
    const start = Math.max(0, Math.floor(resultsScrollTop / RESULT_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    return Math.min(start, Math.max(0, visibleSounds.length - 1));
  });
  let virtualEnd = $derived.by(() => {
    if (!virtualizedResults) return visibleSounds.length;
    return Math.min(
      visibleSounds.length,
      Math.ceil((resultsScrollTop + resultsViewportHeight) / RESULT_ROW_HEIGHT) + VIRTUAL_OVERSCAN,
    );
  });
  let renderedSounds = $derived(visibleSounds.slice(virtualStart, virtualEnd));
  let virtualTopSpace = $derived(virtualizedResults ? virtualStart * RESULT_ROW_HEIGHT : 0);
  let virtualBottomSpace = $derived(virtualizedResults ? Math.max(0, (visibleSounds.length - virtualEnd) * RESULT_ROW_HEIGHT) : 0);

  const notify = (type: ToastMessage["type"], message: string) => {
    const id = ++toastId;
    toasts = [...toasts.slice(-2), { id, type, message }];
    window.setTimeout(() => { toasts = toasts.filter((item) => item.id !== id); }, 3200);
  };

  const persistLibraryFolders = (nextFolders: LibraryFolder[]) => {
    persistedLibrarySignature = JSON.stringify(saveLibraryPaths(nextFolders));
  };

  const refreshUpdates = async () => {
    updateState = { ...updateState, status: "checking", message: "Checking GitHub…" };
    const next = await checkForUpdates(true);
    updateState = next;
    updateDismissed = isUpdateDismissed(next.latestVersion);
    notify(next.status === "available" ? "success" : next.status === "error" ? "warning" : "info", next.message || "Update check finished.");
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
    updateDismissed = true;
  };

  const stopDemoTimer = () => {
    if (demoTimer !== null) window.clearInterval(demoTimer);
    demoTimer = null;
  };

  const togglePlay = () => {
    if (!selected) return;
    if (playing) {
      audio?.pause();
      stopDemoTimer();
      playing = false;
      return;
    }
    if (selected.path && audio) {
      if (reversed) notify("warning", "Reverse audition is queued for the non-destructive render engine; forward preview is playing.");
      audio.play().then(() => { playing = true; }).catch(() => notify("error", "Audio preview could not start."));
      return;
    }
    playing = true;
    stopDemoTimer();
    demoTimer = window.setInterval(() => {
      const step = 0.04 / Math.max(1, selected?.duration || 1);
      const next = reversed ? progress - step : progress + step;
      if ((reversed && next <= 0) || (!reversed && next >= 1)) {
        if (loop) progress = reversed ? 1 : 0;
        else {
          stopDemoTimer();
          playing = false;
          progress = reversed ? 0 : 1;
        }
      } else progress = next;
    }, 40);
  };

  const stopPlayback = (playbackWasReversed = reversed) => {
    stopDemoTimer();
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    playing = false;
    progress = playbackWasReversed ? 1 : 0;
  };

  $effect(() => savePreferences(autoPreview, loop));
  $effect(() => { if (audio) audio.volume = volume; });
  $effect(() => { if (audio) audio.loop = loop; });
  $effect(() => {
    const current = selected;
    previewChannels = [];
    if (!current?.path) return;
    let cancelled = false;
    const decodeTimer = window.setTimeout(() => {
      decodeAudioWaveformChannels(current.path, current.size, current.modifiedAt).then((channels) => {
        if (!cancelled && selectedId === current.id) previewChannels = channels;
      });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(decodeTimer);
    };
  });
  $effect(() => {
    // Searches and folder/filter changes begin at the top, matching the existing list behavior.
    activeTabId;
    activeTab?.query;
    filter;
    selectedFolder;
    untrack(() => {
      resultsScrollTop = 0;
      resultsList?.scrollTo(0, 0);
    });
  });

  $effect(() => {
    const id = selectedId;
    const currentSelected = untrack(() => sounds.find((sound) => sound.id === id) || null);
    if (audio) {
      audio.pause();
      audio = null;
    }
    stopDemoTimer();
    playing = false;
    progress = 0;

    const startPendingPreview = () => {
      if (currentSelected && pendingPlayId === currentSelected.id) {
        pendingPlayId = null;
        window.setTimeout(togglePlay, 0);
      }
    };
    if (!currentSelected?.path) {
      startPendingPreview();
      return;
    }

    const nextAudio = new Audio(fileUrl(currentSelected.path));
    nextAudio.preload = "metadata";
    nextAudio.volume = untrack(() => volume);
    nextAudio.loop = untrack(() => loop);
    const onTimeUpdate = () => { if (nextAudio.duration) progress = nextAudio.currentTime / nextAudio.duration; };
    const onLoadedMetadata = () => {
      if (Number.isFinite(nextAudio.duration) && nextAudio.duration > 0) {
        sounds = sounds.map((sound) => sound.id === currentSelected.id ? { ...sound, duration: nextAudio.duration } : sound);
      }
    };
    const onEnded = () => { if (!nextAudio.loop) { playing = false; progress = 1; } };
    const onError = () => {
      if (audio !== nextAudio || !nextAudio.paused || nextAudio.currentTime > 0) return;
      notify("error", "This audio format could not be previewed by CEP.");
    };
    nextAudio.addEventListener("timeupdate", onTimeUpdate);
    nextAudio.addEventListener("loadedmetadata", onLoadedMetadata);
    nextAudio.addEventListener("ended", onEnded);
    nextAudio.addEventListener("error", onError);
    audio = nextAudio;
    startPendingPreview();

    return () => {
      nextAudio.removeEventListener("timeupdate", onTimeUpdate);
      nextAudio.removeEventListener("loadedmetadata", onLoadedMetadata);
      nextAudio.removeEventListener("ended", onEnded);
      nextAudio.removeEventListener("error", onError);
      nextAudio.pause();
      if (audio === nextAudio) audio = null;
      nextAudio.removeAttribute("src");
      nextAudio.load();
    };
  });

  onMount(() => {
    let timer: number | null = null;
    const syncRelativeTimeClock = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      if (!document.hidden) {
        now = Date.now();
        timer = window.setInterval(() => { now = Date.now(); }, 60000);
      }
    };
    document.addEventListener("visibilitychange", syncRelativeTimeClock);
    syncRelativeTimeClock();
    return () => {
      document.removeEventListener("visibilitychange", syncRelativeTimeClock);
      if (timer !== null) window.clearInterval(timer);
    };
  });

  onMount(() => {
    let cancelled = false;
    checkForUpdates().then((next) => {
      if (cancelled) return;
      updateState = next;
      updateDismissed = isUpdateDismissed(next.latestVersion);
    });
    return () => { cancelled = true; };
  });

  onMount(() => {
    const tooltipTarget = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>(".tooltip[data-tooltip]") : null;
    const hideTooltip = () => {
      if (tooltipTimer !== null) window.clearTimeout(tooltipTimer);
      tooltipTimer = null;
      if (tooltipHideTimer !== null) window.clearTimeout(tooltipHideTimer);
      // Focus can move while Svelte is reconciling keyed rows. Defer the state
      // update so it never occurs inside a template/derived update.
      tooltipHideTimer = window.setTimeout(() => {
        tooltipHideTimer = null;
        floatingTooltip = null;
      }, 0);
    };
    const showTooltip = (element: HTMLElement) => {
      hideTooltip();
      tooltipTimer = window.setTimeout(() => {
        const text = element.dataset.tooltip;
        if (!text || !document.documentElement.contains(element)) return;
        const rect = element.getBoundingClientRect();
        const above = Boolean(element.closest(".transport-bar")) || rect.bottom + 38 > window.innerHeight;
        const halfWidth = Math.min(96, Math.max(42, window.innerWidth / 2 - 8));
        const center = rect.left + rect.width / 2;
        floatingTooltip = { text, x: Math.max(halfWidth, Math.min(window.innerWidth - halfWidth, center)), y: above ? rect.top - 7 : rect.bottom + 7, above };
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
    const onFocusIn = (event: FocusEvent) => { const target = tooltipTarget(event.target); if (target) showTooltip(target); };
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", hideTooltip);
    return () => {
      if (tooltipTimer !== null) window.clearTimeout(tooltipTimer);
      tooltipTimer = null;
      if (tooltipHideTimer !== null) window.clearTimeout(tooltipHideTimer);
      tooltipHideTimer = null;
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", hideTooltip);
    };
  });

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput?.focus();
        searchInput?.select();
      } else if (event.key === "Escape") {
        if (afterEffectsDragSession) afterEffectsDragSession.cancelled = true;
        settingsOpen = false;
        sidebarOpen = false;
        compactPreviewOpen = false;
      } else if (event.code === "Space" && !editing) {
        event.preventDefault();
        togglePlay();
      }
    };
    const handOffPreviewToHost = () => {
      const audioIsPlaying = Boolean(audio && !audio.paused);
      if (!playing && !audioIsPlaying && demoTimer === null) return;
      pendingPlayId = null;
      stopPlayback();
      loop = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", handOffPreviewToHost);
    document.addEventListener("dragenter", markDragInsidePanel);
    document.addEventListener("dragleave", markDragOutsidePanel);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", handOffPreviewToHost);
      document.removeEventListener("dragenter", markDragInsidePanel);
      document.removeEventListener("dragleave", markDragOutsidePanel);
    };
  });

  onMount(() => {
    if (!window.cep) return;
    let cancelled = false;
    const restore = async () => {
      if (libraryRestoreInProgress) return;
      const storedPaths = loadLibraryPaths();
      const signature = JSON.stringify(storedPaths);
      if (signature === persistedLibrarySignature) return;
      const isCrossHostRefresh = librarySyncInitialized;
      persistedLibrarySignature = signature;
      librarySyncInitialized = true;
      libraryRestoreInProgress = true;

      if (!storedPaths.length) {
        if (isCrossHostRefresh && !cancelled) {
          folders = demoLibrary.folders;
          sounds = demoLibrary.sounds;
          selectedFolder = "all";
          selectedId = demoLibrary.sounds[0].id;
          tabs = DEFAULT_TABS;
          activeTabId = DEFAULT_TABS[0].id;
          notify("info", "Shared library cleared. Demo folders restored.");
        }
        libraryRestoreInProgress = false;
        return;
      }

      isIndexing = true;
      indexProgress = { files: 0, folders: 0, currentPath: "" };
      const nextFolders: LibraryFolder[] = [];
      const nextSounds: SoundFile[] = [];
      let completedFiles = 0;
      let completedFolders = 0;
      for (let index = 0; index < storedPaths.length; index += 1) {
        try {
          const result = await scanFolder(storedPaths[index], nextAccent(index), (nextProgress) => {
            indexProgress = { files: completedFiles + nextProgress.files, folders: completedFolders + nextProgress.folders, currentPath: nextProgress.currentPath };
          });
          nextFolders.push(result.folder);
          nextSounds.push(...result.sounds);
          completedFiles += result.sounds.length;
          completedFolders += countTreeNodes(result.folder.tree);
        } catch (_error) {
          // Unavailable folders are skipped without corrupting the shared path list.
        }
      }
      if (!cancelled && nextFolders.length) {
        folders = nextFolders;
        sounds = nextSounds;
        selectedFolder = "all";
        selectedId = nextSounds[0]?.id || "";
        tabs = createLibraryTabs();
        activeTabId = "search-library";
        if (isCrossHostRefresh) notify("success", `Library synced · ${nextSounds.length} sounds`);
      } else if (!cancelled && isCrossHostRefresh) notify("warning", "Shared library paths are currently unavailable on this computer.");
      if (!cancelled) isIndexing = false;
      libraryRestoreInProgress = false;
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
  });

  const seek = (nextProgress: number) => {
    progress = Math.max(0, Math.min(1, nextProgress));
    if (audio?.duration) audio.currentTime = progress * audio.duration;
  };

  const selectSound = (id: string) => {
    if (autoPreview && id !== selectedId) pendingPlayId = id;
    selectedId = id;
  };

  const moveSelection = (direction: number) => {
    if (!visibleSounds.length) return;
    const currentIndex = visibleSounds.findIndex((sound) => sound.id === selectedId);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + visibleSounds.length) % visibleSounds.length;
    selectedId = visibleSounds[nextIndex].id;
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
    isIndexing = true;
    indexProgress = { files: 0, folders: 1, currentPath: chosen };
    notify("info", `Indexing ${folderNameFromPath(chosen)}…`);
    await waitForPanelPaint();
    try {
      const realFolders = folders.filter((folder) => !folder.isDemo);
      const result = await scanFolder(chosen, nextAccent(realFolders.length), (next) => { indexProgress = next; });
      const nextFolders = [...realFolders, result.folder];
      const nextSounds = [...sounds.filter((sound) => !sound.isDemo), ...result.sounds];
      folders = nextFolders;
      sounds = nextSounds;
      persistLibraryFolders(nextFolders);
      selectedFolder = result.folder.id;
      selectedId = result.sounds[0]?.id || "";
      if (!realFolders.length) {
        tabs = createLibraryTabs();
        activeTabId = "search-library";
      }
      indexProgress = { files: result.sounds.length, folders: countTreeNodes(result.folder.tree), currentPath: result.folder.path };
      notify(result.sounds.length ? "success" : "warning", `${result.folder.name} indexed · ${result.sounds.length} sounds · ${countTreeNodes(result.folder.tree)} folders`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "The folder could not be indexed.");
    } finally {
      isIndexing = false;
    }
  };

  const rescanAll = async () => {
    const realFolders = folders.filter((folder) => !folder.isDemo);
    if (!realFolders.length) { notify("info", "Add a real folder to start indexing."); return; }
    isIndexing = true;
    indexProgress = { files: 0, folders: 0, currentPath: "" };
    notify("info", "Refreshing sound libraries…");
    await waitForPanelPaint();
    const nextFolders: LibraryFolder[] = [];
    const nextSounds: SoundFile[] = [];
    let completedFiles = 0;
    let completedFolders = 0;
    for (const folder of realFolders) {
      try {
        const result = await scanFolder(folder.path, folder.accent, (next) => {
          indexProgress = { files: completedFiles + next.files, folders: completedFolders + next.folders, currentPath: next.currentPath };
        });
        nextFolders.push(result.folder);
        nextSounds.push(...result.sounds);
        completedFiles += result.sounds.length;
        completedFolders += countTreeNodes(result.folder.tree);
      } catch (_error) {
        notify("error", `${folder.name} is unavailable.`);
      }
    }
    folders = nextFolders;
    sounds = nextSounds;
    selectedId = nextSounds[0]?.id || "";
    persistLibraryFolders(nextFolders);
    isIndexing = false;
    indexProgress = { files: completedFiles, folders: completedFolders, currentPath: "" };
    notify("success", `Library refreshed · ${nextSounds.length} sounds · ${completedFolders} folders`);
  };

  const insertSelected = async (soundOverride?: SoundFile | null) => {
    const sound = soundOverride || selected;
    if (!sound) return;
    insertBusy = true;
    const result = await insertAudioInHost({ path: sound.path, name: sound.name, targetAudioTrack: -1 });
    insertBusy = false;
    notify(result.ok ? "success" : "error", result.message);
  };

  const removeSelectedFromIndex = () => {
    if (!selected) return;
    sounds = sounds.filter((sound) => sound.id !== selected?.id);
    selectedId = visibleSounds.find((sound) => sound.id !== selected?.id)?.id || "";
    notify("info", "Removed from the search index. The source file was kept.");
  };

  const deleteSettingsFolder = () => {
    if (!settingsFolder || settingsFolder.isDemo) return;
    const deletedName = settingsFolder.name;
    const nextFolders = folders.filter((folder) => folder.id !== settingsFolder?.id);
    const nextSounds = sounds.filter((sound) => sound.folderId !== settingsFolder?.id);
    folders = nextFolders.length ? nextFolders : demoLibrary.folders;
    sounds = nextFolders.length ? nextSounds : demoLibrary.sounds;
    persistLibraryFolders(nextFolders);
    selectedFolder = "all";
    selectedId = (nextFolders.length ? nextSounds : demoLibrary.sounds)[0]?.id || "";
    if (!nextFolders.length) {
      tabs = DEFAULT_TABS;
      activeTabId = DEFAULT_TABS[0].id;
    }
    settingsOpen = false;
    notify("info", `${deletedName} removed from SoundDesigner. Files were kept.`);
  };

  const updateSearchQuery = (query: string) => {
    tabs = tabs.map((tab) => tab.id === activeTabId ? { ...tab, query, label: query.trim() || "New search" } : tab);
  };
  const addSearchTab = () => {
    const id = `search-${Date.now()}`;
    tabs = [...tabs, { id, label: "New search", query: "" }];
    activeTabId = id;
  };
  const closeSearchTab = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    const nextTabs = tabs.filter((tab) => tab.id !== id);
    tabs = nextTabs;
    if (id === activeTabId) activeTabId = nextTabs[Math.max(0, index - 1)].id;
  };

  const prepareAfterEffectsDrag = (sound: SoundFile) => {
    if (host !== "aftereffects" || !sound.path) return;
    const request = { path: sound.path, name: sound.name, targetAudioTrack: -1 };
    afterEffectsDragSession = {
      id: ++afterEffectsDragSessionId,
      soundId: sound.id,
      baseline: getAfterEffectsAudioDragState(request),
      leftPanel: false,
      cancelled: false,
    };
  };

  const dragSound = (sound: SoundFile, event: DragEvent) => {
    if (!sound.path || !event.dataTransfer) { event.preventDefault(); return; }
    if (host === "aftereffects" && afterEffectsDragSession?.soundId !== sound.id) prepareAfterEffectsDrag(sound);
    if (afterEffectsDragSession?.soundId === sound.id) {
      afterEffectsDragSession.leftPanel = false;
      afterEffectsDragSession.cancelled = false;
    }
    const uri = fileUrl(sound.path);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("com.adobe.cep.dnd.file.0", sound.path);
    event.dataTransfer.setData("text/uri-list", uri);
    event.dataTransfer.setData("text/plain", sound.path);
    event.dataTransfer.setData("DownloadURL", `audio/${sound.extension}:${sound.name}.${sound.extension}:${uri}`);
  };

  const organizeAudioAfterNativeDrop = async (sound: SoundFile) => {
    const request = { path: sound.path, name: sound.name, targetAudioTrack: -1 };
    const retryDelays = [80, 160, 280, 450, 700];
    for (const delay of retryDelays) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
      const result = await organizeAudioInHost(request);
      if (result.ok) return;
    }
    notify("warning", `${sound.name} was added, but its project item could not be moved into SoundDesigner.`);
  };

  const finishAfterEffectsDrag = async (sound: SoundFile, event: DragEvent) => {
    if (host !== "aftereffects") return;
    const session = afterEffectsDragSession;
    afterEffectsDragSession = null;
    if (!session || session.soundId !== sound.id || session.cancelled) return;

    const droppedOutsidePanel = session.leftPanel
      || event.clientX <= 0
      || event.clientY <= 0
      || event.clientX >= window.innerWidth
      || event.clientY >= window.innerHeight;
    if (!droppedOutsidePanel) return;

    const nativeDropAccepted = event.dataTransfer
      && event.dataTransfer.dropEffect
      && event.dataTransfer.dropEffect !== "none";
    if (nativeDropAccepted) {
      await organizeAudioAfterNativeDrop(sound);
      return;
    }

    const baseline = await session.baseline;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 280));
    if (session.id !== afterEffectsDragSessionId) return;
    const request = { path: sound.path, name: sound.name, targetAudioTrack: -1 };
    const current = await getAfterEffectsAudioDragState(request);
    const nativeLayerWasAdded = baseline.ok
      && current.ok
      && baseline.compositionId === current.compositionId
      && current.layerCount > baseline.layerCount;
    if (nativeLayerWasAdded) await organizeAudioAfterNativeDrop(sound);
    else await insertSelected(sound);
  };

  const finishSoundDrag = async (sound: SoundFile, event: DragEvent) => {
    if (host === "aftereffects") {
      await finishAfterEffectsDrag(sound, event);
      return;
    }
    if (host !== "premiere") return;
    const nativeDropAccepted = event.dataTransfer
      && event.dataTransfer.dropEffect
      && event.dataTransfer.dropEffect !== "none";
    const droppedOutsidePanel = event.clientX <= 0
      || event.clientY <= 0
      || event.clientX >= window.innerWidth
      || event.clientY >= window.innerHeight;
    if (nativeDropAccepted || droppedOutsidePanel) await organizeAudioAfterNativeDrop(sound);
  };

  const markDragInsidePanel = () => {
    if (afterEffectsDragSession) afterEffectsDragSession.leftPanel = false;
  };

  const markDragOutsidePanel = (event: DragEvent) => {
    if (!afterEffectsDragSession) return;
    const related = event.relatedTarget;
    if (!(related instanceof Node) || !document.documentElement.contains(related)) afterEffectsDragSession.leftPanel = true;
  };
</script>

<div class:sidebar-open={sidebarOpen} class="app-shell" data-host={host}>
  <header class="topbar">
    <div class="brand-block"><span class="brand-mark"><Icon name="waveform" size={18} /></span><div><strong>SoundDesigner</strong><small>Library workspace</small></div></div>
    <IconButton icon="library" label="Toggle library drawer" onclick={() => sidebarOpen = !sidebarOpen} class="sidebar-toggle" active={sidebarOpen} pressed={sidebarOpen} />
    <div class="topbar-spacer"></div>
    <span class="host-pill tooltip" data-tooltip={`Connected to ${hostLabel(host)}`}><i></i>{hostLabel(host)}</span>
    <IconButton icon="activity" label="Library status" active={!isIndexing} />
    <IconButton icon="settings" label="Open panel settings" onclick={() => { settingsFolderId = null; settingsOpen = true; }} />
  </header>

  <main class="panel-body">
    <LibrarySidebar
      {folders} {sounds} {selectedFolder} query={folderQuery} indexing={isIndexing} {indexProgress} {now}
      onSelectFolder={(id) => { selectedFolder = id; sidebarOpen = false; }}
      onQueryChange={(value) => folderQuery = value}
      onAddFolder={addFolder}
      onEditFolder={(id) => { settingsFolderId = id; settingsOpen = true; }}
      onRescan={rescanAll}
      onClose={() => sidebarOpen = false}
      update={updateState}
      {updateDismissed}
      onOpenUpdate={openUpdate}
      onDismissUpdate={dismissAvailableUpdate}
    />

    <button aria-label="Close library drawer" class="drawer-scrim" onclick={() => sidebarOpen = false} type="button"></button>

    <section class="search-workspace">
      <SearchTabs {tabs} activeId={activeTabId} onActivate={(id) => activeTabId = id} onAdd={addSearchTab} onClose={closeSearchTab} />
      <div class="search-toolbar">
        <label class="hero-search">
          <Icon name="search" />
          <input bind:this={searchInput} aria-label="Sound search" oninput={(event) => updateSearchQuery(event.currentTarget.value)} placeholder="Search sounds, tags, or formats…" value={activeTab?.query || ""} />
          {#if activeTab?.query}<IconButton icon="close" label="Clear search" onclick={() => updateSearchQuery("")} />{/if}
          <kbd>⌘ K</kbd>
        </label>
        <div class="search-actions">
          <div class="filter-chips" aria-label="Sound filters">
            {#each FILTERS as item (item.id)}
              <button class:is-active={filter === item.id} onclick={() => filter = item.id} type="button">{item.label}{#if item.id === "favorites"}<span class="tiny-badge">{favoriteCount}</span>{/if}</button>
            {/each}
          </div>
          <IconButton icon="sliders" label="Open advanced search filters" />
          <IconButton icon="list" label="Toggle result density" active />
        </div>
      </div>

      <div class="results-summary">
        <span><strong>{visibleSounds.length}</strong> results</span>
        <div class="results-summary__actions">
          <span>Sorted by <button type="button">Relevance <Icon name="chevron" size={12} /></button></span>
          <IconButton
            icon="waveform"
            label={compactPreviewOpen ? "Show sound results" : "Show spectrum preview"}
            onclick={() => compactPreviewOpen = !compactPreviewOpen}
            active={compactPreviewOpen}
            pressed={compactPreviewOpen}
            class="compact-preview-toggle"
          />
        </div>
      </div>

      <div
        class:is-preview-open={compactPreviewOpen}
        class="search-content"
      >
        <div
          bind:this={resultsList}
          bind:clientHeight={resultsViewportHeight}
          class="results-list"
          role="listbox"
          aria-label="Sound results"
          onscroll={(event) => resultsScrollTop = event.currentTarget.scrollTop}
        >
          {#if visibleSounds.length}
            {#if virtualTopSpace}<div class="results-spacer" style:height={`${virtualTopSpace}px`}></div>{/if}
            {#each renderedSounds as sound (sound.id)}
              <SoundRow
                {sound}
                channels={sound.id === selectedId ? previewChannels : []}
                selected={sound.id === selectedId}
                playing={playing && sound.id === selectedId}
                progress={sound.id === selectedId ? progress : 0}
                dragHint={host === "aftereffects" ? "Drag into the active composition" : "Drag to host (support varies)"}
                onSelect={() => selectSound(sound.id)}
                onPlay={() => { if (sound.id !== selectedId) { pendingPlayId = sound.id; selectedId = sound.id; } else togglePlay(); }}
                onInsert={() => { selectedId = sound.id; insertSelected(sound); }}
                onFavorite={() => sounds = sounds.map((item) => item.id === sound.id ? { ...item, favorite: !item.favorite } : item)}
                onDragPrepare={() => prepareAfterEffectsDrag(sound)}
                onDragStart={(event) => dragSound(sound, event)}
                onDragEnd={(event) => finishSoundDrag(sound, event)}
              />
            {/each}
            {#if virtualBottomSpace}<div class="results-spacer" style:height={`${virtualBottomSpace}px`}></div>{/if}
          {:else}
            <div class="empty-state">
              <span class="empty-glyph"><Icon name="waveform" size={22} /></span>
              <strong>No sounds match this search</strong>
              <span>Try fewer keywords or index another sound folder.</span>
              <button class="ghost-button" onclick={addFolder} type="button"><Icon name="folder" /> Add folder</button>
            </div>
          {/if}
        </div>
        <PreviewPane sound={selected} channels={previewChannels} {progress} {zoom} {reversed} onSeek={seek} onZoomIn={() => zoom = Math.min(3, zoom + 0.5)} onZoomOut={() => zoom = Math.max(1, zoom - 0.5)} />
      </div>
    </section>
  </main>

  <Transport
    sound={selected} {playing} {progress} {volume} {loop} {reversed} busy={insertBusy}
    onPrevious={() => moveSelection(-1)}
    onTogglePlay={togglePlay}
    onNext={() => moveSelection(1)}
    onStop={() => stopPlayback()}
    onLoop={() => loop = !loop}
    onReverse={() => { const playbackWasReversed = reversed; reversed = !reversed; stopPlayback(playbackWasReversed); }}
    onVolume={(value) => volume = value}
    onInsert={() => insertSelected()}
    onRemove={removeSelectedFromIndex}
  />

  <div class="toast-stack" aria-live="polite">
    {#each toasts as toast (toast.id)}
      <div class={`toast toast--${toast.type}`}><span>{toast.type === "success" ? "✓" : toast.type === "error" ? "!" : toast.type === "warning" ? "△" : "i"}</span>{toast.message}</div>
    {/each}
  </div>

  {#if floatingTooltip}
    <div class:is-above={floatingTooltip.above} class:is-below={!floatingTooltip.above} class="floating-tooltip" role="tooltip" style:left={`${floatingTooltip.x}px`} style:top={`${floatingTooltip.y}px`}>{floatingTooltip.text}</div>
  {/if}

  <SettingsSheet
    open={settingsOpen} folder={settingsFolder} {autoPreview} {loop} update={updateState}
    onAutoPreview={(value) => autoPreview = value}
    onLoop={(value) => loop = value}
    onCheckUpdate={refreshUpdates}
    onOpenUpdate={openUpdate}
    onClose={() => settingsOpen = false}
    onDelete={deleteSettingsFolder}
  />
</div>
