export type HostApp = "premiere" | "aftereffects" | "browser" | "unknown";

export type AccentName = "graphite";

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
  isDemo?: boolean;
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
  isDemo?: boolean;
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
};

export type HostResult = {
  ok: boolean;
  message: string;
  host?: string;
  imported?: boolean;
  trackIndex?: number;
};
