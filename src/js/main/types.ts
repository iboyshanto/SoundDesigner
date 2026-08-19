export type HostApp = "premiere" | "aftereffects" | "browser" | "unknown";

export type AccentName = "graphite";

export type SoundSource = "local" | "freesound";

export type AudioConversionPolicy = "unsupported" | "always" | "never";

export type AudioNormalization = "preserve" | "peak-minus-one";

export type AudioSegmentSelection = {
  start: number;
  end: number;
};

export type InsertionTarget = "playhead" | "selected-clip";

export type FreesoundLicenseFilter = "commercial" | "cc0" | "all";

export type SoundDesignerPreferences = {
  autoPreview: boolean;
  loop: boolean;
  localSourceEnabled: boolean;
  freesoundLibraryEnabled: boolean;
  freesoundSourceEnabled: boolean;
  insertionTarget: InsertionTarget;
  conversionPolicy: AudioConversionPolicy;
  normalization: AudioNormalization;
  freesoundApiKey: string;
  freesoundLicenseFilter: FreesoundLicenseFilter;
};

export type LibraryTreeNode = {
  id: string;
  rootId: string;
  name: string;
  path: string;
  directFileCount: number;
  totalFileCount: number;
  children: LibraryTreeNode[];
};

export type LibraryFolder = {
  id: string;
  name: string;
  path: string;
  fileCount: number;
  accent: AccentName;
  indexedAt: number;
  tree: LibraryTreeNode;
};

export type SoundFile = {
  id: string;
  folderId: string;
  directoryId: string;
  name: string;
  path: string;
  extension: string;
  size: number;
  modifiedAt: number;
  duration: number;
  tags: string[];
  waveform: Float32Array;
  accent: AccentName;
  favorite?: boolean;
  source?: SoundSource;
  sourceId?: string;
  sourceUrl?: string;
  previewUrl?: string;
  creator?: string;
  license?: string;
  channels?: number;
  sampleRate?: number;
  downloadState?: "remote" | "downloading" | "ready" | "error";
  preparedProjectPath?: string;
  preparedProfile?: string;
  originalPath?: string;
  originalExtension?: string;
};

export type ScanProgress = {
  files: number;
  folders: number;
  currentPath: string;
};

export type SearchTab = {
  id: string;
  label: string;
  query: string;
};

export type ToastMessage = {
  id: number;
  type: "success" | "warning" | "error" | "info";
  message: string;
};

export type InsertAudioRequest = {
  path: string;
  name: string;
  targetAudioTrack: number;
  insertionTarget?: InsertionTarget;
};

export type HostResult = {
  ok: boolean;
  message: string;
  host?: string;
  imported?: boolean;
  trackIndex?: number;
};

export type HostProjectContext = {
  ok: boolean;
  host: HostApp | string;
  projectPath?: string;
  projectDirectory?: string;
  projectName?: string;
  message: string;
};
