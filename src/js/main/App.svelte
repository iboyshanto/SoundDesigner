<script lang="ts">
  import { onMount, untrack } from "svelte";
  import {
    chooseLibraryFolder,
    fileUrl,
    folderNameFromPath,
    loadLibraryPaths,
    makeWaveform,
    nextAccent,
    saveLibraryPaths,
    sameNativePath,
    scanFolder,
    waitForPanelPaint,
  } from "./library";
  import {
    detectHost,
    getAfterEffectsAudioDragState,
    getHostProjectContext,
    insertAudioInHost,
    organizeAudioInHost,
    type AfterEffectsAudioDragState,
  } from "./hostBridge";
  import { openLinkInBrowser } from "../lib/utils/bolt";
  import { decodeAudioWaveformChannels, decodeRemoteAudioWaveformChannels } from "./audioWaveform";
  import { searchFreesound } from "./freesound";
  import { prepareAudioForHost, prepareAudioSegmentForHost, requiresProjectAudioPreparation } from "./projectAudio";
  import { checkForUpdates, dismissUpdate, INSTALLED_VERSION, isUpdateDismissed, type UpdateState } from "./updater";
  import type {
    AudioConversionPolicy,
    AudioNormalization,
    AudioSegmentSelection,
    FreesoundLicenseFilter,
    InsertionTarget,
    LibraryFolder,
    ScanProgress,
    SearchTab,
    SoundDesignerPreferences,
    SoundFile,
    ToastMessage,
  } from "./types";
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

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "one-shot", label: "One shots" },
    { id: "ambience", label: "Ambience" },
    { id: "favorites", label: "Favorites" },
  ];
  const VIRTUALIZATION_THRESHOLD = 80;
  const VIRTUAL_OVERSCAN = 8;
  const PREFERENCES_STORAGE_KEY = "sounddesigner.preferences.v1";
  const LIBRARY_WIDTH_STORAGE_KEY = "sounddesigner.library-width.v1";
  const LIBRARY_MIN_WIDTH = 180;
  const LIBRARY_MAX_WIDTH = 560;
  const RESULTS_MIN_WIDTH = 320;
  const resultRowHeightForViewport = (compact = true) => {
    if (typeof window === "undefined") return 57;
    if (!compact) return 69;
    if (window.innerWidth <= 430) return 58;
    if (window.innerWidth >= 821 && window.innerHeight <= 600 && window.innerWidth / Math.max(1, window.innerHeight) >= 1.5) return 52;
    return 57;
  };
  const createLibraryTabs = (): SearchTab[] => [{ id: "search-library", label: "All sounds", query: "" }];
  type SortMode = "relevance" | "name" | "duration";

  const createBrowserDemoAudio = () => {
    const sampleRate = 8000;
    const duration = 8;
    const channelCount = 2;
    const frameCount = sampleRate * duration;
    const bytes = new Uint8Array(44 + frameCount * channelCount * 2);
    const view = new DataView(bytes.buffer);
    const ascii = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };
    ascii(0, "RIFF");
    view.setUint32(4, bytes.length - 8, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channelCount * 2, true);
    view.setUint16(32, channelCount * 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, bytes.length - 44, true);
    let offset = 44;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const time = frame / sampleRate;
      const envelope = Math.exp(-((time % 2) * 7));
      const left = Math.sin(time * Math.PI * 2 * 220) * envelope * 0.42;
      const right = Math.sin(time * Math.PI * 2 * 330) * envelope * 0.42;
      view.setInt16(offset, Math.round(left * 32767), true);
      view.setInt16(offset + 2, Math.round(right * 32767), true);
      offset += 4;
    }
    let binary = "";
    for (let start = 0; start < bytes.length; start += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(start, Math.min(bytes.length, start + 0x8000)));
    }
    return { url: `data:audio/wav;base64,${btoa(binary)}`, size: bytes.length };
  };

  const loadLibraryWidth = () => {
    try {
      const raw = localStorage.getItem(LIBRARY_WIDTH_STORAGE_KEY);
      const stored = raw === null ? Number.NaN : Number(raw);
      if (Number.isFinite(stored)) return Math.max(LIBRARY_MIN_WIDTH, Math.min(LIBRARY_MAX_WIDTH, stored));
    } catch (_error) {
      // Use the balanced default when host policy blocks local storage.
    }
    return 220;
  };

  const clampLibraryWidth = (value: number) => {
    const available = Math.max(LIBRARY_MIN_WIDTH, window.innerWidth - RESULTS_MIN_WIDTH);
    return Math.round(Math.max(LIBRARY_MIN_WIDTH, Math.min(LIBRARY_MAX_WIDTH, available, value)));
  };

  const saveLibraryWidth = (value: number) => {
    try {
      localStorage.setItem(LIBRARY_WIDTH_STORAGE_KEY, String(Math.round(value)));
    } catch (_error) {
      // Resizing remains available for the current session.
    }
  };

  type AfterEffectsDragSession = {
    id: number;
    soundId: string;
    baseline: Promise<AfterEffectsAudioDragState>;
    leftPanel: boolean;
    cancelled: boolean;
  };

  const loadPreferences = (): SoundDesignerPreferences => {
    try {
      const stored = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) || "{}");
      return {
        autoPreview: typeof stored.autoPreview === "boolean" ? stored.autoPreview : true,
        loop: typeof stored.loop === "boolean" ? stored.loop : true,
        insertionTarget: stored.insertionTarget === "selected-clip" ? "selected-clip" : "playhead",
        localSourceEnabled: typeof stored.localSourceEnabled === "boolean" ? stored.localSourceEnabled : true,
        freesoundLibraryEnabled: typeof stored.freesoundLibraryEnabled === "boolean"
          ? stored.freesoundLibraryEnabled
          : Boolean(typeof stored.freesoundApiKey === "string" && stored.freesoundApiKey.trim()),
        freesoundSourceEnabled: typeof stored.freesoundSourceEnabled === "boolean" ? stored.freesoundSourceEnabled : true,
        conversionPolicy: stored.conversionPolicy === "always" || stored.conversionPolicy === "never" ? stored.conversionPolicy : "unsupported",
        normalization: stored.normalization === "peak-minus-one" ? stored.normalization : "preserve",
        freesoundApiKey: typeof stored.freesoundApiKey === "string" ? stored.freesoundApiKey : "",
        freesoundLicenseFilter: stored.freesoundLicenseFilter === "cc0" || stored.freesoundLicenseFilter === "all" ? stored.freesoundLicenseFilter : "commercial",
      };
    } catch (_error) {
      return {
        autoPreview: true,
        loop: true,
        insertionTarget: "playhead" as InsertionTarget,
        localSourceEnabled: true,
        freesoundLibraryEnabled: false,
        freesoundSourceEnabled: true,
        conversionPolicy: "unsupported" as AudioConversionPolicy,
        normalization: "preserve" as AudioNormalization,
        freesoundApiKey: "",
        freesoundLicenseFilter: "commercial" as FreesoundLicenseFilter,
      };
    }
  };

  const savePreferences = (
    nextAutoPreview: boolean,
    nextLoop: boolean,
    nextInsertionTarget: InsertionTarget,
    nextLocalSourceEnabled: boolean,
    nextFreesoundLibraryEnabled: boolean,
    nextFreesoundSourceEnabled: boolean,
    nextConversionPolicy: AudioConversionPolicy,
    nextNormalization: AudioNormalization,
    nextFreesoundApiKey: string,
    nextFreesoundLicenseFilter: FreesoundLicenseFilter,
  ) => {
    try {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
        autoPreview: nextAutoPreview,
        loop: nextLoop,
        insertionTarget: nextInsertionTarget,
        localSourceEnabled: nextLocalSourceEnabled,
        freesoundLibraryEnabled: nextFreesoundLibraryEnabled,
        freesoundSourceEnabled: nextFreesoundSourceEnabled,
        conversionPolicy: nextConversionPolicy,
        normalization: nextNormalization,
        freesoundApiKey: nextFreesoundApiKey,
        freesoundLicenseFilter: nextFreesoundLicenseFilter,
      }));
    } catch (_error) {
      // The panel remains usable if host policy blocks local storage.
    }
  };

  const preferences = loadPreferences();
  const host = detectHost();
  const browserDemoRequested = import.meta.env.DEV && host === "browser" && new URLSearchParams(window.location.search).has("demo");
  const browserDemoAudio = browserDemoRequested ? createBrowserDemoAudio() : null;
  const browserDemoSound: SoundFile | null = browserDemoAudio ? {
    id: "browser-segment-demo",
    folderId: "browser-demo",
    directoryId: "browser-demo",
    name: "Segment Selection Demo",
    path: "",
    extension: "wav",
    size: browserDemoAudio.size,
    modifiedAt: 0,
    duration: 8,
    tags: ["demo", "impact", "stereo"],
    waveform: makeWaveform("browser-segment-demo", 160),
    accent: "graphite",
    source: "local",
    previewUrl: browserDemoAudio.url,
    channels: 2,
    sampleRate: 48000,
  } : null;
  let folders = $state<LibraryFolder[]>([]);
  let sounds = $state<SoundFile[]>(browserDemoSound ? [browserDemoSound] : []);
  let freesoundSounds = $state<SoundFile[]>([]);
  let localSourceEnabled = $state(preferences.localSourceEnabled);
  let freesoundLibraryEnabled = $state(preferences.freesoundLibraryEnabled);
  let freesoundSourceEnabled = $state(preferences.freesoundLibraryEnabled && preferences.freesoundSourceEnabled);
  let freesoundStatus = $state<"idle" | "loading" | "ready" | "error">("idle");
  let freesoundError = $state("");
  let freesoundTotal = $state(0);
  let freesoundPage = $state(1);
  let freesoundHasNext = $state(false);
  let freesoundRefreshNonce = $state(0);
  let selectedFolder = $state("all");
  let selectedId = $state(browserDemoSound?.id || "");
  let folderQuery = $state("");
  let tabs = $state<SearchTab[]>(createLibraryTabs());
  let activeTabId = $state("search-library");
  let filter = $state("all");
  let sortMode = $state<SortMode>("relevance");
  let compactResults = $state(true);
  let playing = $state(false);
  let progress = $state(0);
  let volume = $state(0.78);
  let loop = $state(preferences.loop);
  let insertionTarget = $state<InsertionTarget>(preferences.insertionTarget);
  let reversed = $state(false);
  let zoom = $state(1);
  let previewChannels = $state<Float32Array[]>([]);
  let waveformChannelsLoading = $state(false);
  let segmentSelection = $state<AudioSegmentSelection | null>(null);
  let preparedSegment = $state<SoundFile | null>(null);
  let segmentPreparing = $state(false);
  let isIndexing = $state(false);
  let indexProgress = $state<ScanProgress>({ files: 0, folders: 0, currentPath: "" });
  let insertBusy = $state(false);
  let sidebarOpen = $state(false);
  let compactPreviewOpen = $state(false);
  let settingsOpen = $state(false);
  let settingsFolderId = $state<string | null>(null);
  let autoPreview = $state(preferences.autoPreview);
  let conversionPolicy = $state<AudioConversionPolicy>(preferences.conversionPolicy);
  let normalization = $state<AudioNormalization>(preferences.normalization);
  let freesoundApiKey = $state(preferences.freesoundApiKey);
  let freesoundLicenseFilter = $state<FreesoundLicenseFilter>(preferences.freesoundLicenseFilter);
  let toasts = $state<ToastMessage[]>([]);
  let updateState = $state<UpdateState>({ status: "idle", currentVersion: INSTALLED_VERSION });
  let updateDismissed = $state(false);
  let floatingTooltip = $state<{ text: string; x: number; y: number; above: boolean } | null>(null);
  let now = $state(Date.now());
  let searchInput: HTMLInputElement;
  let resultsList: HTMLDivElement;
  let resultsScrollTop = $state(0);
  let resultsViewportHeight = $state(600);
  let resultRowHeight = $state(resultRowHeightForViewport(true));
  let pendingResultsScrollTop = 0;
  let resultsScrollFrame = 0;
  let libraryWidth = $state(loadLibraryWidth());

  let audio: HTMLAudioElement | null = null;
  let pendingPlayId: string | null = null;
  let toastId = 0;
  let tooltipTimer: number | null = null;
  let tooltipHideTimer: number | null = null;
  let persistedLibrarySignature = "";
  let libraryRestoreInProgress = false;
  let librarySyncInitialized = false;
  let afterEffectsDragSession: AfterEffectsDragSession | null = null;
  let afterEffectsDragSessionId = 0;
  let activeProjectPath = "";
  let freesoundSearchController: AbortController | null = null;
  let freesoundSearchGeneration = 0;
  let segmentPreparationGeneration = 0;
  const freesoundSessionCache = new Map<string, SoundFile>();
  const preparingSounds = new Map<string, Promise<SoundFile>>();
  const preparedSegmentCache = new Map<string, SoundFile>();
  const soundSearchTextCache = new WeakMap<SoundFile, string>();
  let segmentPreparationController: AbortController | null = null;
  let activeSegmentPreparationKey = "";
  let activeSegmentPreparation: Promise<SoundFile> | null = null;

  const cancelSegmentPreparation = () => {
    segmentPreparationController?.abort();
    segmentPreparationController = null;
    activeSegmentPreparationKey = "";
    activeSegmentPreparation = null;
    segmentPreparationGeneration += 1;
    segmentPreparing = false;
  };

  const soundSearchText = (sound: SoundFile) => {
    const cached = soundSearchTextCache.get(sound);
    if (cached) return cached;
    const text = `${sound.name} ${sound.tags.join(" ")} ${sound.extension}`.toLowerCase();
    soundSearchTextCache.set(sound, text);
    return text;
  };

  const mergeFreesoundSessionState = (sound: SoundFile) => {
    const cached = freesoundSessionCache.get(sound.id);
    if (!cached) return sound;
    return {
      ...sound,
      favorite: cached.favorite,
      path: cached.path,
      extension: cached.path ? cached.extension : sound.extension,
      size: cached.path ? cached.size : sound.size,
      modifiedAt: cached.path ? cached.modifiedAt : sound.modifiedAt,
      downloadState: cached.downloadState,
      preparedProjectPath: cached.preparedProjectPath,
      preparedProfile: cached.preparedProfile,
      originalPath: cached.originalPath,
      originalExtension: cached.originalExtension,
    };
  };

  let activeTab = $derived(tabs.find((tab) => tab.id === activeTabId) || tabs[0]);
  let cloudSourceActive = $derived(freesoundLibraryEnabled && freesoundSourceEnabled);
  let selected = $derived(sounds.find((sound) => sound.id === selectedId) || freesoundSounds.find((sound) => sound.id === selectedId) || null);
  let settingsFolder = $derived(folders.find((folder) => folder.id === settingsFolderId) || null);
  let favoriteCount = $derived([...sounds, ...freesoundSounds].filter((sound) => sound.favorite).length);
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
  let localVisibleSounds = $derived.by(() => {
    if (!localSourceEnabled) return [];
    const queryTokens = (activeTab?.query || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
    return sounds.filter((sound) => {
      if (selectedFolder !== "all" && !selectedDirectoryIds.has(sound.directoryId)) return false;
      if (filter === "favorites" && !sound.favorite) return false;
      if (filter === "ambience" && !sound.tags.includes("ambience") && sound.duration < 10) return false;
      if (filter === "one-shot" && sound.duration > 8) return false;
      if (!queryTokens.length) return true;
      const haystack = soundSearchText(sound);
      return queryTokens.every((token) => haystack.includes(token));
    });
  });
  let freesoundVisibleSounds = $derived(cloudSourceActive ? freesoundSounds.filter((sound) => {
    if (filter === "favorites" && !sound.favorite) return false;
    if (filter === "ambience" && !sound.tags.includes("ambience") && sound.duration < 10) return false;
    if (filter === "one-shot" && sound.duration > 8) return false;
    return true;
  }) : []);
  let visibleSounds = $derived.by(() => {
    const combined = [...localVisibleSounds, ...freesoundVisibleSounds];
    if (sortMode === "name") return combined.sort((first, second) => first.name.localeCompare(second.name));
    if (sortMode === "duration") return combined.sort((first, second) => (second.duration || 0) - (first.duration || 0));
    return combined;
  });
  let sortLabel = $derived(sortMode === "name" ? "Name" : sortMode === "duration" ? "Duration" : "Relevance");
  let searchPlaceholder = $derived(localSourceEnabled && cloudSourceActive
    ? "Search local and Freesound…"
    : cloudSourceActive ? "Search Freesound…" : "Search local sounds…");
  let virtualizedResults = $derived(visibleSounds.length > VIRTUALIZATION_THRESHOLD);
  let virtualStart = $derived.by(() => {
    if (!virtualizedResults) return 0;
    const start = Math.max(0, Math.floor(resultsScrollTop / resultRowHeight) - VIRTUAL_OVERSCAN);
    return Math.min(start, Math.max(0, visibleSounds.length - 1));
  });
  let virtualEnd = $derived.by(() => {
    if (!virtualizedResults) return visibleSounds.length;
    return Math.min(
      visibleSounds.length,
      Math.ceil((resultsScrollTop + resultsViewportHeight) / resultRowHeight) + VIRTUAL_OVERSCAN,
    );
  });
  let renderedSounds = $derived(visibleSounds.slice(virtualStart, virtualEnd));
  let virtualTopSpace = $derived(virtualizedResults ? virtualStart * resultRowHeight : 0);
  let virtualBottomSpace = $derived(virtualizedResults ? Math.max(0, (visibleSounds.length - virtualEnd) * resultRowHeight) : 0);

  const notify = (type: ToastMessage["type"], message: string) => {
    const id = ++toastId;
    toasts = [...toasts.slice(-2), { id, type, message }];
    window.setTimeout(() => { toasts = toasts.filter((item) => item.id !== id); }, 3200);
  };

  const persistLibraryFolders = (nextFolders: LibraryFolder[]) => {
    persistedLibrarySignature = JSON.stringify(saveLibraryPaths(nextFolders));
  };

  const setLibraryWidth = (value: number, persist = false) => {
    libraryWidth = clampLibraryWidth(value);
    if (persist) saveLibraryWidth(libraryWidth);
  };

  const startLibraryResize = (event: MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = libraryWidth;
    let finished = false;
    let move: (nextEvent: MouseEvent) => void;
    document.documentElement.classList.add("is-resizing-library");

    const finish = () => {
      if (finished) return;
      finished = true;
      saveLibraryWidth(libraryWidth);
      document.documentElement.classList.remove("is-resizing-library");
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("mouseup", finish, true);
      window.removeEventListener("blur", finish);
    };
    move = (nextEvent: MouseEvent) => {
      if ((nextEvent.buttons & 1) === 0) {
        finish();
        return;
      }
      nextEvent.preventDefault();
      setLibraryWidth(startWidth + nextEvent.clientX - startX);
    };
    window.addEventListener("mousemove", move, true);
    window.addEventListener("mouseup", finish, true);
    window.addEventListener("blur", finish);
  };

  const handleResultsScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    pendingResultsScrollTop = event.currentTarget.scrollTop;
    if (resultsScrollFrame) return;
    resultsScrollFrame = window.requestAnimationFrame(() => {
      resultsScrollFrame = 0;
      resultsScrollTop = pendingResultsScrollTop;
    });
  };

  const toggleResultDensity = () => {
    compactResults = !compactResults;
    resultRowHeight = resultRowHeightForViewport(compactResults);
    resultsScrollTop = 0;
    pendingResultsScrollTop = 0;
    resultsList?.scrollTo(0, 0);
  };

  const cycleSortMode = () => {
    sortMode = sortMode === "relevance" ? "name" : sortMode === "name" ? "duration" : "relevance";
    resultsScrollTop = 0;
    pendingResultsScrollTop = 0;
    resultsList?.scrollTo(0, 0);
  };

  const resizeLibraryWithKeyboard = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") setLibraryWidth(libraryWidth - 12, true);
    else if (event.key === "ArrowRight") setLibraryWidth(libraryWidth + 12, true);
    else if (event.key === "Home") setLibraryWidth(LIBRARY_MIN_WIDTH, true);
    else if (event.key === "End") setLibraryWidth(LIBRARY_MAX_WIDTH, true);
    else return;
    event.preventDefault();
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

  const togglePlay = () => {
    if ((!selected?.path && !selected?.previewUrl) || !audio) return;
    if (playing) {
      audio.pause();
      playing = false;
      return;
    }
    if (segmentSelection && audio.duration) {
      const start = Math.max(0, Math.min(audio.duration, segmentSelection.start));
      const end = Math.max(start, Math.min(audio.duration, segmentSelection.end));
      if (audio.currentTime < start || audio.currentTime >= end - 0.01) {
        audio.currentTime = start;
        progress = start / audio.duration;
      }
    }
    if (reversed) notify("warning", "Reverse audition is queued for the non-destructive render engine; forward preview is playing.");
    audio.play().then(() => { playing = true; }).catch(() => notify("error", "Audio preview could not start."));
  };

  const stopPlayback = (playbackWasReversed = reversed) => {
    if (audio) {
      audio.pause();
      audio.currentTime = segmentSelection?.start || 0;
    }
    playing = false;
    progress = playbackWasReversed ? 1 : (selected?.duration ? (segmentSelection?.start || 0) / selected.duration : 0);
  };

  $effect(() => savePreferences(
    autoPreview,
    loop,
    insertionTarget,
    localSourceEnabled,
    freesoundLibraryEnabled,
    freesoundSourceEnabled,
    conversionPolicy,
    normalization,
    freesoundApiKey,
    freesoundLicenseFilter,
  ));
  $effect(() => { if (audio) audio.volume = volume; });
  $effect(() => { if (audio) audio.loop = segmentSelection ? false : loop; });
  $effect(() => {
    const current = selected;
    previewChannels = [];
    waveformChannelsLoading = Boolean(current?.path || current?.previewUrl);
    if (!current?.path && !current?.previewUrl) return;
    let cancelled = false;
    const stillSelected = () => !cancelled && selectedId === current.id;
    const decodeTimer = window.setTimeout(() => {
      const decoding = current.path
        ? decodeAudioWaveformChannels(
          current.path,
          current.size,
          current.modifiedAt,
          current.duration,
          stillSelected,
        )
        : decodeRemoteAudioWaveformChannels(current.previewUrl || "", current.duration, stillSelected);
      decoding.then((channels) => {
        if (stillSelected()) {
          previewChannels = channels;
          waveformChannelsLoading = false;
        }
      });
    }, 0);
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
    if (!visibleSounds.length) {
      if (selectedId) selectedId = "";
      return;
    }
    if (!selectedId || !visibleSounds.some((sound) => sound.id === selectedId)) selectedId = visibleSounds[0].id;
  });

  $effect(() => {
    const cloudEnabled = cloudSourceActive;
    const query = activeTab?.query.trim() || "";
    const apiKey = freesoundApiKey;
    const licenseFilter = freesoundLicenseFilter;
    freesoundRefreshNonce;
    if (!cloudEnabled) {
      freesoundSearchController?.abort();
      freesoundSearchController = null;
      freesoundSounds = [];
      freesoundTotal = 0;
      freesoundHasNext = false;
      freesoundStatus = "idle";
      freesoundError = "";
      return;
    }
    freesoundSearchController?.abort();
    freesoundSearchController = null;
    if (!apiKey) {
      freesoundSounds = [];
      freesoundTotal = 0;
      freesoundHasNext = false;
      freesoundStatus = "idle";
      freesoundError = "Add your Freesound API key in Settings to search the cloud library.";
      return;
    }
    if (query.length < 2) {
      freesoundSounds = [];
      freesoundTotal = 0;
      freesoundHasNext = false;
      freesoundStatus = "idle";
      freesoundError = "Type at least two characters to search Freesound.";
      return;
    }
    const controller = new AbortController();
    const generation = ++freesoundSearchGeneration;
    freesoundSearchController = controller;
    const timer = window.setTimeout(() => {
      freesoundStatus = "loading";
      freesoundError = "";
      searchFreesound(query, apiKey, licenseFilter, 1, controller.signal).then((page) => {
        if (controller.signal.aborted || generation !== freesoundSearchGeneration) return;
        freesoundSounds = page.sounds.map(mergeFreesoundSessionState);
        freesoundTotal = page.total;
        freesoundPage = page.page;
        freesoundHasNext = page.hasNext;
        freesoundStatus = "ready";
        const selectedStillVisible = (localSourceEnabled && sounds.some((sound) => sound.id === selectedId))
          || page.sounds.some((sound) => sound.id === selectedId);
        if (!selectedStillVisible) selectedId = localVisibleSounds[0]?.id || page.sounds[0]?.id || "";
      }).catch((error) => {
        if (controller.signal.aborted || generation !== freesoundSearchGeneration) return;
        freesoundSounds = [];
        freesoundTotal = 0;
        freesoundHasNext = false;
        freesoundStatus = "error";
        freesoundError = error instanceof Error ? error.message : "Freesound search failed.";
      });
    }, 420);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  });

  $effect(() => {
    const id = selectedId;
    const currentSelected = untrack(() => sounds.find((sound) => sound.id === id) || freesoundSounds.find((sound) => sound.id === id) || null);
    if (audio) {
      audio.pause();
      audio = null;
    }
    playing = false;
    progress = 0;
    segmentSelection = null;
    preparedSegment = null;
    cancelSegmentPreparation();

    const startPendingPreview = () => {
      if (currentSelected && pendingPlayId === currentSelected.id) {
        pendingPlayId = null;
        window.setTimeout(togglePlay, 0);
      }
    };
    const previewSource = currentSelected?.path ? fileUrl(currentSelected.path) : currentSelected?.previewUrl || "";
    if (!previewSource) {
      startPendingPreview();
      return;
    }

    const nextAudio = new Audio(previewSource);
    nextAudio.preload = "metadata";
    nextAudio.volume = untrack(() => volume);
    nextAudio.loop = untrack(() => loop && !segmentSelection);
    const onTimeUpdate = () => {
      if (!nextAudio.duration) return;
      const activeSelection = segmentSelection;
      if (activeSelection && nextAudio.currentTime < activeSelection.start - 0.008) {
        nextAudio.currentTime = activeSelection.start;
        progress = activeSelection.start / nextAudio.duration;
        return;
      }
      if (activeSelection && nextAudio.currentTime >= activeSelection.end - 0.008) {
        if (loop) {
          nextAudio.currentTime = activeSelection.start;
          progress = activeSelection.start / nextAudio.duration;
          if (nextAudio.paused) nextAudio.play().catch(() => undefined);
        } else {
          nextAudio.pause();
          nextAudio.currentTime = activeSelection.end;
          progress = activeSelection.end / nextAudio.duration;
          playing = false;
        }
        return;
      }
      progress = nextAudio.currentTime / nextAudio.duration;
    };
    const onLoadedMetadata = () => {
      if (
        currentSelected
        &&
        Number.isFinite(nextAudio.duration)
        && nextAudio.duration > 0
        && currentSelected.duration !== nextAudio.duration
      ) currentSelected.duration = nextAudio.duration;
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
    const syncResultRowHeight = () => { resultRowHeight = resultRowHeightForViewport(compactResults); };
    window.addEventListener("resize", syncResultRowHeight);
    syncResultRowHeight();
    return () => window.removeEventListener("resize", syncResultRowHeight);
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
    if (!window.cep) return;
    let cancelled = false;
    const refreshProject = async () => {
      const context = await getHostProjectContext();
      if (cancelled || !context.ok || !context.projectPath) return;
      if (activeProjectPath && activeProjectPath !== context.projectPath) {
        const resetPreparedSound = (sound: SoundFile): SoundFile => {
          if (!sound.preparedProjectPath || sound.preparedProjectPath === context.projectPath) return sound;
          return {
            ...sound,
            path: sound.source === "freesound" ? "" : sound.originalPath || sound.path,
            extension: sound.originalExtension || sound.extension,
            size: sound.source === "freesound" ? 0 : sound.size,
            modifiedAt: sound.source === "freesound" ? 0 : sound.modifiedAt,
            downloadState: sound.source === "freesound" ? "remote" : sound.downloadState,
            preparedProjectPath: undefined,
            preparedProfile: undefined,
          };
        };
        sounds = sounds.map(resetPreparedSound);
        freesoundSounds = freesoundSounds.map(resetPreparedSound);
        for (const [id, cachedSound] of freesoundSessionCache) {
          freesoundSessionCache.set(id, resetPreparedSound(cachedSound));
        }
        preparedSegmentCache.clear();
        preparedSegment = null;
        cancelSegmentPreparation();
      }
      activeProjectPath = context.projectPath;
    };
    const refreshWhenVisible = () => { if (!document.hidden) refreshProject(); };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    refreshProject();
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
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
      if (!playing && !audioIsPlaying) return;
      pendingPlayId = null;
      stopPlayback();
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
          folders = [];
          sounds = [];
          selectedFolder = "all";
          selectedId = "";
          tabs = createLibraryTabs();
          activeTabId = "search-library";
          notify("info", "Shared library cleared. Add a folder when you are ready.");
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
      let restoreSkippedPaths = 0;
      let failedStoredPaths = 0;
      let firstRestoreError = "";
      for (let index = 0; index < storedPaths.length; index += 1) {
        try {
          const result = await scanFolder(storedPaths[index], nextAccent(index), (nextProgress) => {
            indexProgress = { files: completedFiles + nextProgress.files, folders: completedFolders + nextProgress.folders, currentPath: nextProgress.currentPath };
          });
          nextFolders.push(result.folder);
          nextSounds.push(...result.sounds);
          completedFiles += result.sounds.length;
          completedFolders += countTreeNodes(result.folder.tree);
          restoreSkippedPaths += result.diagnostics.unreadableDirectories + result.diagnostics.unreadableEntries;
        } catch (error) {
          // Unavailable folders are skipped without corrupting the shared path list.
          failedStoredPaths += 1;
          if (!firstRestoreError) firstRestoreError = error instanceof Error ? error.message : "A saved library could not be opened.";
        }
      }
      if (!cancelled && nextFolders.length) {
        folders = nextFolders;
        sounds = nextSounds;
        selectedFolder = "all";
        selectedId = nextSounds[0]?.id || "";
        tabs = createLibraryTabs();
        activeTabId = "search-library";
        if (failedStoredPaths || restoreSkippedPaths) {
          notify(
            "warning",
            `Library loaded - ${nextSounds.length} sounds - ${failedStoredPaths} libraries unavailable - ${restoreSkippedPaths} paths skipped`,
          );
        } else if (isCrossHostRefresh) notify("success", `Library synced · ${nextSounds.length} sounds`);
      } else if (!cancelled) {
        notify("warning", firstRestoreError || "Saved library paths are currently unavailable on this computer.");
      }
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
    const duration = audio?.duration || selected?.duration || 0;
    const minimum = segmentSelection && duration > 0 ? segmentSelection.start / duration : 0;
    const maximum = segmentSelection && duration > 0 ? segmentSelection.end / duration : 1;
    progress = Math.max(minimum, Math.min(maximum, nextProgress));
    if (audio?.duration) audio.currentTime = progress * audio.duration;
  };

  const segmentRequestKey = (sound: SoundFile, selection: AudioSegmentSelection) => [
    sound.id,
    sound.path,
    sound.size,
    sound.modifiedAt,
    `${conversionPolicy}:${normalization}`,
    Math.round(selection.start * 1000),
    Math.round(selection.end * 1000),
  ].join("|");

  const segmentKey = (sound: SoundFile, selection: AudioSegmentSelection, projectPath: string) =>
    `${segmentRequestKey(sound, selection)}|${projectPath}`;

  const prepareSelectedSegment = async (selection: AudioSegmentSelection, announceErrors = true) => {
    const sound = selected;
    if (!sound) return null;
    if (!window.cep || host === "browser") return null;
    const requestKey = segmentRequestKey(sound, selection);
    if (activeSegmentPreparation && activeSegmentPreparationKey === requestKey) {
      try {
        return await activeSegmentPreparation;
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === "AbortError";
        if (!aborted && announceErrors && selectedId === sound.id) {
          notify("error", error instanceof Error ? error.message : "The selected audio segment could not be prepared.");
        }
        return null;
      }
    }

    cancelSegmentPreparation();
    const controller = new AbortController();
    segmentPreparationController = controller;
    activeSegmentPreparationKey = requestKey;
    const generation = ++segmentPreparationGeneration;
    segmentPreparing = true;
    preparedSegment = null;

    const task = (async () => {
      const project = await getHostProjectContext();
      if (!project.ok || !project.projectPath) throw new Error(project.message);
      if (controller.signal.aborted) throw new DOMException("Audio preparation was cancelled.", "AbortError");
      const key = segmentKey(sound, selection, project.projectPath);
      const cached = preparedSegmentCache.get(key);
      if (cached) return cached;
      const prepared = await prepareAudioSegmentForHost(sound, selection, {
        host,
        project,
        conversionPolicy,
        normalization,
        signal: controller.signal,
      });
      preparedSegmentCache.set(key, prepared.sound);
      while (preparedSegmentCache.size > 16) {
        const oldestKey = preparedSegmentCache.keys().next().value;
        if (typeof oldestKey !== "string") break;
        preparedSegmentCache.delete(oldestKey);
      }
      return prepared.sound;
    })();
    activeSegmentPreparation = task;

    try {
      const prepared = await task;
      if (generation === segmentPreparationGeneration && selectedId === sound.id) preparedSegment = prepared;
      return prepared;
    } catch (error) {
      const aborted = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
      if (!aborted && announceErrors && generation === segmentPreparationGeneration) {
        notify("error", error instanceof Error ? error.message : "The selected audio segment could not be prepared.");
      }
      return null;
    } finally {
      if (generation === segmentPreparationGeneration) {
        segmentPreparing = false;
        segmentPreparationController = null;
        activeSegmentPreparationKey = "";
        activeSegmentPreparation = null;
      }
    }
  };

  const updateSegmentSelection = (next: AudioSegmentSelection | null, commit: boolean) => {
    cancelSegmentPreparation();
    segmentSelection = next;
    preparedSegment = null;
    if (!next) return;
    if (selected?.duration) seek(next.start / selected.duration);
    if (commit && window.cep && host !== "browser") prepareSelectedSegment(next, false);
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

  const updateSoundRecord = (nextSound: SoundFile) => {
    if (nextSound.source === "freesound") {
      freesoundSessionCache.set(nextSound.id, nextSound);
      freesoundSounds = freesoundSounds.map((sound) => sound.id === nextSound.id ? nextSound : sound);
    } else {
      sounds = sounds.map((sound) => sound.id === nextSound.id ? nextSound : sound);
    }
  };

  const toggleFavorite = (sound: SoundFile) => updateSoundRecord({ ...sound, favorite: !sound.favorite });

  const prepareSound = async (sound: SoundFile) => {
    const existing = preparingSounds.get(sound.id);
    if (existing) return existing;
    const requestedConversionPolicy = conversionPolicy;
    const requestedNormalization = normalization;
    const task = (async () => {
      const profile = `${requestedConversionPolicy}:${requestedNormalization}`;
      if (sound.path && sound.preparedProfile === profile && sound.preparedProjectPath) {
        const currentProject = await getHostProjectContext();
        if (currentProject.ok && currentProject.projectPath === sound.preparedProjectPath) return sound;
      }
      const needsPreparation = requiresProjectAudioPreparation(sound, requestedConversionPolicy, requestedNormalization);
      if (!needsPreparation && !sound.originalPath) return sound;
      updateSoundRecord({ ...sound, downloadState: sound.source === "freesound" ? "downloading" : sound.downloadState });
      try {
        const project = await getHostProjectContext();
        if (!project.ok) throw new Error(project.message);
        const prepared = await prepareAudioForHost(sound, {
          host,
          project,
          conversionPolicy: requestedConversionPolicy,
          normalization: requestedNormalization,
          onProgress: (_stage, message) => notify("info", message),
        });
        const current = sounds.find((item) => item.id === sound.id) || freesoundSounds.find((item) => item.id === sound.id);
        const nextSound = current ? { ...prepared.sound, favorite: current.favorite } : prepared.sound;
        updateSoundRecord(nextSound);
        return nextSound;
      } catch (error) {
        if (sound.source === "freesound") {
          const current = freesoundSounds.find((item) => item.id === sound.id) || sound;
          updateSoundRecord({ ...current, downloadState: "error" });
        }
        throw error;
      }
    })();
    preparingSounds.set(sound.id, task);
    try {
      return await task;
    } finally {
      if (preparingSounds.get(sound.id) === task) preparingSounds.delete(sound.id);
    }
  };

  const downloadSound = async (sound: SoundFile) => {
    if (sound.source !== "freesound" || sound.downloadState === "downloading") return;
    try {
      const prepared = await prepareSound(sound);
      notify("success", `${prepared.name} is ready in this project's SoundDesigner folder.`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "The sound could not be prepared.");
    }
  };

  const loadMoreFreesound = async () => {
    const query = activeTab?.query.trim() || "";
    if (!cloudSourceActive || !freesoundHasNext || freesoundStatus === "loading" || query.length < 2) return;
    freesoundStatus = "loading";
    freesoundError = "";
    const generation = ++freesoundSearchGeneration;
    const controller = new AbortController();
    freesoundSearchController?.abort();
    freesoundSearchController = controller;
    try {
      const page = await searchFreesound(query, freesoundApiKey, freesoundLicenseFilter, freesoundPage + 1, controller.signal);
      if (controller.signal.aborted || generation !== freesoundSearchGeneration) return;
      const existing = new Set(freesoundSounds.map((sound) => sound.id));
      freesoundSounds = [
        ...freesoundSounds,
        ...page.sounds.filter((sound) => !existing.has(sound.id)).map(mergeFreesoundSessionState),
      ];
      freesoundPage = page.page;
      freesoundHasNext = page.hasNext;
      freesoundStatus = "ready";
    } catch (error) {
      if (controller.signal.aborted || generation !== freesoundSearchGeneration) return;
      freesoundStatus = "error";
      freesoundError = error instanceof Error ? error.message : "More Freesound results could not be loaded.";
    }
  };

  const addFolder = async () => {
    notify("info", "Choose a folder. Windows hides files while selecting folders.");
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
    if (folders.some((folder) => sameNativePath(folder.path, chosen))) {
      notify("warning", "That folder is already indexed.");
      return;
    }
    isIndexing = true;
    indexProgress = { files: 0, folders: 1, currentPath: chosen };
    notify("info", `Indexing ${folderNameFromPath(chosen)}…`);
    await waitForPanelPaint();
    try {
      const result = await scanFolder(chosen, nextAccent(folders.length), (next) => { indexProgress = next; });
      const nextFolders = [...folders, result.folder];
      const nextSounds = [...sounds, ...result.sounds];
      folders = nextFolders;
      sounds = nextSounds;
      persistLibraryFolders(nextFolders);
      selectedFolder = result.folder.id;
      selectedId = result.sounds[0]?.id || "";
      if (nextFolders.length === 1) {
        tabs = createLibraryTabs();
        activeTabId = "search-library";
      }
      indexProgress = { files: result.sounds.length, folders: countTreeNodes(result.folder.tree), currentPath: result.folder.path };
      const skippedPaths = result.diagnostics.unreadableDirectories + result.diagnostics.unreadableEntries;
      const seenExtensions = result.diagnostics.extensionsSeen.length
        ? ` - extensions: ${result.diagnostics.extensionsSeen.join(", ")}`
        : "";
      const scanMessage = !result.sounds.length
        ? `${result.folder.name}: 0 supported sounds - scanned ${result.diagnostics.filesSeen} files via ${result.diagnostics.scanner.toUpperCase()}${seenExtensions}`
        : skippedPaths
          ? `${result.folder.name} indexed - ${result.sounds.length} sounds - ${skippedPaths} unreadable paths skipped`
          : `${result.folder.name} indexed - ${result.sounds.length} sounds - ${countTreeNodes(result.folder.tree)} folders`;
      notify(result.sounds.length && !skippedPaths ? "success" : "warning", scanMessage);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "The folder could not be indexed.");
    } finally {
      isIndexing = false;
    }
  };

  const rescanAll = async () => {
    if (!folders.length) { notify("info", "Add a sound folder to start indexing."); return; }
    isIndexing = true;
    indexProgress = { files: 0, folders: 0, currentPath: "" };
    notify("info", "Refreshing sound libraries…");
    await waitForPanelPaint();
    const nextFolders: LibraryFolder[] = [];
    const nextSounds: SoundFile[] = [];
    let completedFiles = 0;
    let completedFolders = 0;
    let skippedPaths = 0;
    let failedLibraries = 0;
    for (const folder of folders) {
      try {
        const result = await scanFolder(folder.path, folder.accent, (next) => {
          indexProgress = { files: completedFiles + next.files, folders: completedFolders + next.folders, currentPath: next.currentPath };
        });
        nextFolders.push(result.folder);
        nextSounds.push(...result.sounds);
        completedFiles += result.sounds.length;
        completedFolders += countTreeNodes(result.folder.tree);
        skippedPaths += result.diagnostics.unreadableDirectories + result.diagnostics.unreadableEntries;
      } catch (error) {
        // Keep the last valid index and persisted folder path on transient Windows or drive errors.
        const existingSounds = sounds.filter((sound) => sound.folderId === folder.id);
        nextFolders.push(folder);
        nextSounds.push(...existingSounds);
        completedFiles += existingSounds.length;
        completedFolders += countTreeNodes(folder.tree);
        failedLibraries += 1;
        notify("error", error instanceof Error ? error.message : `${folder.name} could not be refreshed.`);
      }
    }
    folders = nextFolders;
    sounds = nextSounds;
    selectedId = nextSounds[0]?.id || "";
    persistLibraryFolders(nextFolders);
    isIndexing = false;
    indexProgress = { files: completedFiles, folders: completedFolders, currentPath: "" };
    const refreshHasWarnings = failedLibraries > 0 || skippedPaths > 0;
    const refreshDetail = refreshHasWarnings
      ? ` - ${failedLibraries} libraries unavailable - ${skippedPaths} paths skipped`
      : "";
    notify(refreshHasWarnings ? "warning" : "success", `Library refreshed - ${nextSounds.length} sounds - ${completedFolders} folders${refreshDetail}`);
  };

  const insertSelected = async (soundOverride?: SoundFile | null) => {
    const sound = soundOverride || selected;
    if (!sound || insertBusy) return;
    insertBusy = true;
    try {
      if (!soundOverride && segmentSelection && host === "browser") {
        notify("success", `Segment insert simulated (${(segmentSelection.end - segmentSelection.start).toFixed(2)} seconds).`);
        return;
      }
      const prepared = !soundOverride && segmentSelection
        ? await prepareSelectedSegment(segmentSelection)
        : await prepareSound(sound);
      if (!prepared) throw new Error("The selected audio segment could not be prepared.");
      const result = await insertAudioInHost({ path: prepared.path, name: prepared.name, targetAudioTrack: -1, insertionTarget });
      notify(result.ok ? "success" : "error", result.message);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "The sound could not be prepared for Adobe.");
    } finally {
      insertBusy = false;
    }
  };

  const removeSelectedFromIndex = () => {
    const removed = selected;
    if (!removed) return;
    const nextSelectedId = visibleSounds.find((sound) => sound.id !== removed.id)?.id || "";
    if (removed.source === "freesound") freesoundSounds = freesoundSounds.filter((sound) => sound.id !== removed.id);
    else sounds = sounds.filter((sound) => sound.id !== removed.id);
    selectedId = nextSelectedId;
    notify("info", removed.source === "freesound" ? "Removed from these cloud results. Downloaded project files were kept." : "Removed from the search index. The source file was kept.");
  };

  const deleteSettingsFolder = () => {
    if (!settingsFolder) return;
    const deletedName = settingsFolder.name;
    const nextFolders = folders.filter((folder) => folder.id !== settingsFolder?.id);
    const nextSounds = sounds.filter((sound) => sound.folderId !== settingsFolder?.id);
    folders = nextFolders;
    sounds = nextSounds;
    persistLibraryFolders(nextFolders);
    selectedFolder = "all";
    selectedId = nextSounds[0]?.id || "";
    if (!nextFolders.length) {
      tabs = createLibraryTabs();
      activeTabId = "search-library";
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
    if (requiresProjectAudioPreparation(sound, conversionPolicy, normalization)) {
      event.preventDefault();
      notify("info", `${sound.name} must be prepared before dragging. Downloading or converting it now…`);
      prepareSound(sound).then((prepared) => {
        notify("success", `${prepared.name} is ready. Drag it again to add it to Adobe.`);
      }).catch((error) => {
        notify("error", error instanceof Error ? error.message : "The sound could not be prepared for dragging.");
      });
      return;
    }
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

  const dragSelectedSegment = (event: DragEvent) => {
    if (!segmentSelection || !selected) {
      event.preventDefault();
      return;
    }
    if (host === "browser") {
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", `${selected.name} (${segmentSelection.start.toFixed(2)}s–${segmentSelection.end.toFixed(2)}s)`);
      }
      return;
    }
    if (!preparedSegment) {
      event.preventDefault();
      notify("info", "Preparing the selected segment. Drag it again when the range shows Ready.");
      prepareSelectedSegment(segmentSelection);
      return;
    }
    dragSound(preparedSegment, event);
  };

  const finishSelectedSegmentDrag = (event: DragEvent) => {
    if (preparedSegment) finishSoundDrag(preparedSegment, event);
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
    <IconButton icon="activity" label="Open library status" active={!isIndexing} onclick={() => sidebarOpen = true} />
    <IconButton icon="settings" label="Open panel settings" onclick={() => { settingsFolderId = null; settingsOpen = true; }} />
  </header>

  <main class="panel-body" style={`--library-width: ${libraryWidth}px`}>
    <LibrarySidebar
      {folders} {sounds} {selectedFolder} query={folderQuery} indexing={isIndexing} {indexProgress} {now}
      {localSourceEnabled} {freesoundLibraryEnabled} {freesoundSourceEnabled}
      freesoundConnected={Boolean(freesoundApiKey)} freesoundCount={freesoundTotal}
      onSelectFolder={(id) => { selectedFolder = id; sidebarOpen = false; }}
      onQueryChange={(value) => folderQuery = value}
      onAddFolder={addFolder}
      onEditFolder={(id) => { settingsFolderId = id; settingsOpen = true; }}
      onRescan={rescanAll}
      onClose={() => sidebarOpen = false}
      onLocalSourceEnabled={(enabled) => localSourceEnabled = enabled}
      onFreesoundSourceEnabled={(enabled) => freesoundSourceEnabled = enabled}
      update={updateState}
      {updateDismissed}
      onOpenUpdate={openUpdate}
      onDismissUpdate={dismissAvailableUpdate}
    />

    <div
      aria-label="Library panel width"
      aria-orientation="vertical"
      aria-valuemax={LIBRARY_MAX_WIDTH}
      aria-valuemin={LIBRARY_MIN_WIDTH}
      aria-valuenow={libraryWidth}
      aria-valuetext={`${libraryWidth} pixels wide`}
      class="library-resizer tooltip"
      data-tooltip="Drag left or right to resize library"
      onkeydown={resizeLibraryWithKeyboard}
      onmousedown={startLibraryResize}
      role="slider"
      tabindex="0"
    ></div>

    <button aria-label="Close library drawer" class="drawer-scrim" onclick={() => sidebarOpen = false} type="button"></button>

    <section class="search-workspace">
      <SearchTabs {tabs} activeId={activeTabId} onActivate={(id) => activeTabId = id} onAdd={addSearchTab} onClose={closeSearchTab} />
      <div class="search-toolbar">
        <label class="hero-search">
          <Icon name="search" />
          <input bind:this={searchInput} aria-label="Sound search" autocomplete="off" name="sound-search" oninput={(event) => updateSearchQuery(event.currentTarget.value)} placeholder={searchPlaceholder} spellcheck="false" value={activeTab?.query || ""} />
          {#if activeTab?.query}<IconButton icon="close" label="Clear search" onclick={() => updateSearchQuery("")} />{/if}
          <kbd>⌘ K</kbd>
        </label>
        <div class="search-actions">
          <div class="filter-chips" aria-label="Sound filters">
            {#each FILTERS as item (item.id)}
              <button class:is-active={filter === item.id} onclick={() => filter = item.id} type="button">{item.label}{#if item.id === "favorites"}<span class="tiny-badge">{favoriteCount}</span>{/if}</button>
            {/each}
          </div>
          <IconButton icon="sliders" label="Open search and library settings" onclick={() => { settingsFolderId = null; settingsOpen = true; }} />
          <IconButton icon="list" label={compactResults ? "Use comfortable result density" : "Use compact result density"} active={compactResults} pressed={compactResults} onclick={toggleResultDensity} />
        </div>
      </div>

      <div class="results-summary">
        <span>
          {#if cloudSourceActive && freesoundStatus === "loading" && !visibleSounds.length}
            Searching Freesound…
          {:else}
            <strong>{visibleSounds.length}</strong> results
            {#if localSourceEnabled && cloudSourceActive}
              <small class="results-source-breakdown">{localVisibleSounds.length} local · {freesoundVisibleSounds.length}{freesoundTotal > freesoundVisibleSounds.length ? ` of ${freesoundTotal.toLocaleString()}` : ""} cloud</small>
            {:else if cloudSourceActive && freesoundTotal > freesoundVisibleSounds.length}
              <small class="results-source-breakdown">{freesoundVisibleSounds.length} of {freesoundTotal.toLocaleString()} cloud</small>
            {/if}
          {/if}
        </span>
        <div class="results-summary__actions">
          <span>Sorted by <button aria-label={`Change result sorting. Current sort: ${sortLabel}`} class="tooltip" data-tooltip="Change result sorting" onclick={cycleSortMode} type="button">{sortLabel} <Icon name="chevron" size={12} /></button></span>
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
          class:is-relaxed={!compactResults}
          class="results-list"
          role="listbox"
          aria-label="Sound results"
          onscroll={handleResultsScroll}
        >
          {#if !localSourceEnabled && !cloudSourceActive}
            <div class="empty-state empty-state--library">
              <span class="empty-glyph"><Icon name="library" size={22} /></span>
              <strong>Select a search source</strong>
              <span>{freesoundLibraryEnabled ? "Enable Local, Freesound, or both from the Library panel." : "Enable Local from the Library panel or enable Freesound in Settings."}</span>
            </div>
          {:else if visibleSounds.length}
            {#if virtualTopSpace}<div class="results-spacer" style:height={`${virtualTopSpace}px`}></div>{/if}
            {#each renderedSounds as sound (sound.id)}
              <SoundRow
                {sound}
                channels={sound.id === selectedId ? previewChannels : []}
                selected={sound.id === selectedId}
                playing={playing && sound.id === selectedId}
                progress={sound.id === selectedId ? progress : 0}
                dragHint={sound.source === "freesound" && !sound.path
                  ? "Download for this project before dragging"
                  : host === "aftereffects" ? "Drag into the active composition" : "Drag to host (support varies)"}
                onSelect={() => selectSound(sound.id)}
                onPlay={() => { if (sound.id !== selectedId) { pendingPlayId = sound.id; selectedId = sound.id; } else togglePlay(); }}
                onInsert={() => { selectedId = sound.id; insertSelected(sound); }}
                onFavorite={() => toggleFavorite(sound)}
                onDownload={() => downloadSound(sound)}
                onDragPrepare={() => prepareAfterEffectsDrag(sound)}
                onDragStart={(event) => dragSound(sound, event)}
                onDragEnd={(event) => finishSoundDrag(sound, event)}
              />
            {/each}
            {#if virtualBottomSpace}<div class="results-spacer" style:height={`${virtualBottomSpace}px`}></div>{/if}
            {#if cloudSourceActive && freesoundHasNext && !virtualizedResults}
              <button class="load-more-button" disabled={freesoundStatus === "loading"} onclick={loadMoreFreesound} type="button">
                {#if freesoundStatus === "loading"}<span class="spinner"></span>{:else}<Icon name="cloud" size={14} />{/if}
                Load more from Freesound
              </button>
            {/if}
          {:else if localSourceEnabled && !folders.length && cloudSourceActive && !freesoundApiKey}
            <div class="empty-state empty-state--library">
              <span class="empty-glyph"><Icon name="library" size={22} /></span>
              <strong>Set up a sound source</strong>
              <span>Add a local folder or connect Freesound. Both sources can be searched together.</span>
              <div class="empty-state-actions">
                <button class="ghost-button" onclick={addFolder} type="button"><Icon name="folder" /> Add folder</button>
                <button class="primary-button" onclick={() => { settingsFolderId = null; settingsOpen = true; }} type="button"><Icon name="settings" /> Connect Freesound</button>
              </div>
            </div>
          {:else if cloudSourceActive && !freesoundApiKey}
            <div class="empty-state empty-state--cloud">
              <span class="empty-glyph"><Icon name="cloud" size={22} /></span>
              <strong>Connect Freesound</strong>
              <span>Local matches remain available. Add your personal API key to include CC0 and CC BY cloud results.</span>
              <button class="primary-button" onclick={() => { settingsFolderId = null; settingsOpen = true; }} type="button"><Icon name="settings" /> Open settings</button>
            </div>
          {:else if cloudSourceActive && freesoundStatus === "loading" && !freesoundSounds.length}
            <div class="results-loading" aria-live="polite" aria-label="Searching Freesound">
              {#each Array(5) as _, index (index)}<div class="sound-row-skeleton"><i></i><span></span><b></b></div>{/each}
            </div>
          {:else if cloudSourceActive && freesoundStatus === "error" && !freesoundSounds.length}
            <div class="empty-state empty-state--cloud">
              <span class="empty-glyph"><Icon name="cloud" size={22} /></span>
              <strong>Freesound is unavailable</strong>
              <span>{freesoundError}</span>
              <button class="ghost-button" onclick={() => freesoundRefreshNonce += 1} type="button"><Icon name="refresh" /> Try again</button>
            </div>
          {:else if cloudSourceActive && !localSourceEnabled && (activeTab?.query.trim().length || 0) < 2}
            <div class="empty-state empty-state--cloud">
              <span class="empty-glyph"><Icon name="search" size={22} /></span>
              <strong>Search the Freesound library</strong>
              <span>Type at least two characters. Cloud results are loaded only when you search.</span>
            </div>
          {:else if localSourceEnabled && !folders.length}
            <div class="empty-state empty-state--library">
              <span class="empty-glyph"><Icon name="folder" size={22} /></span>
              <strong>Add your sound library</strong>
              <span>Choose a top-level folder. SoundDesigner will preserve every nested folder in the library tree.</span>
              <button class="primary-button" onclick={addFolder} type="button"><Icon name="add" /> Add sound folder</button>
            </div>
          {:else}
            <div class="empty-state">
              <span class="empty-glyph"><Icon name="waveform" size={22} /></span>
              <strong>No sounds match this search</strong>
              <span>Try fewer keywords, change the enabled Library sources, or adjust the Freesound license filter.</span>
              {#if localSourceEnabled}<button class="ghost-button" onclick={addFolder} type="button"><Icon name="folder" /> Add folder</button>{/if}
            </div>
          {/if}
        </div>
        <PreviewPane
          sound={selected}
          channels={previewChannels}
          channelsLoading={waveformChannelsLoading}
          {progress}
          {zoom}
          {reversed}
          selection={segmentSelection}
          {segmentPreparing}
          segmentReady={host === "browser" ? Boolean(segmentSelection) : Boolean(preparedSegment)}
          onSeek={seek}
          onZoomIn={() => zoom = Math.min(3, zoom + 0.5)}
          onZoomOut={() => zoom = Math.max(1, zoom - 0.5)}
          onSelectionChange={updateSegmentSelection}
          onSegmentDragStart={dragSelectedSegment}
          onSegmentDragEnd={finishSelectedSegmentDrag}
        />
      </div>
    </section>
  </main>

  <Transport
    sound={selected} {playing} {progress} {volume} {loop} {reversed} busy={insertBusy}
    segmentDuration={segmentSelection ? segmentSelection.end - segmentSelection.start : 0}
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
    open={settingsOpen} folder={settingsFolder} {autoPreview} {loop} {insertionTarget} {conversionPolicy} {normalization} {freesoundLibraryEnabled} {freesoundApiKey} {freesoundLicenseFilter} update={updateState}
    onAutoPreview={(value) => autoPreview = value}
    onLoop={(value) => loop = value}
    onInsertionTarget={(value) => insertionTarget = value}
    onConversionPolicy={(value) => conversionPolicy = value}
    onNormalization={(value) => normalization = value}
    onFreesoundLibraryEnabled={(enabled) => {
      freesoundLibraryEnabled = enabled;
      freesoundSourceEnabled = enabled;
    }}
    onFreesoundApiKey={(value) => freesoundApiKey = value}
    onFreesoundLicenseFilter={(value) => freesoundLicenseFilter = value}
    onOpenFreesoundSetup={() => openLinkInBrowser("https://freesound.org/apiv2/apply/")}
    onOpenFreesoundTerms={() => openLinkInBrowser("https://freesound.org/help/tos_api/")}
    onBrowseFreesound={() => openLinkInBrowser("https://freesound.org/search/")}
    onCheckUpdate={refreshUpdates}
    onOpenUpdate={openUpdate}
    onClose={() => settingsOpen = false}
    onDelete={deleteSettingsFolder}
  />
</div>
