import { fs, path } from "../lib/cep/node";
import { csi } from "../lib/utils/bolt";
import type { AccentName, LibraryFolder, LibraryTreeNode, ScanProgress, SoundFile } from "./types";

const AUDIO_EXTENSIONS: { [extension: string]: boolean } = {
  aac: true,
  ac3: true,
  aif: true,
  aiff: true,
  bwf: true,
  flac: true,
  m4a: true,
  mp2: true,
  mp3: true,
  oga: true,
  ogg: true,
  wav: true,
  wma: true,
};

const ACCENT: AccentName = "graphite";

const DEMO_TRACKS: Array<{
  name: string;
  duration: number;
  folder: number;
  directory: string;
  tags: string[];
}> = [
  { name: "Cinematic Impact — Heavy", duration: 2.48, folder: 0, directory: "Impacts", tags: ["impact", "cinematic", "heavy", "one shot"] },
  { name: "Deep Sub Hit 07", duration: 1.86, folder: 0, directory: "Impacts", tags: ["impact", "sub", "bass", "one shot"] },
  { name: "Metal Whoosh Transition", duration: 3.14, folder: 0, directory: "Transitions", tags: ["whoosh", "metal", "transition"] },
  { name: "Forest Room Tone — Night", duration: 36.2, folder: 1, directory: "Nature", tags: ["room tone", "forest", "night", "ambience"] },
  { name: "City Alley Rain", duration: 42.84, folder: 1, directory: "Urban", tags: ["rain", "city", "field", "ambience"] },
  { name: "Interface Confirm Soft", duration: 0.64, folder: 2, directory: "Interface", tags: ["ui", "confirm", "soft", "one shot"] },
  { name: "Servo Rise Short", duration: 1.32, folder: 2, directory: "Mechanical", tags: ["servo", "rise", "tech", "one shot"] },
  { name: "Digital Error Cluster", duration: 0.92, folder: 2, directory: "Interface", tags: ["digital", "error", "glitch", "one shot"] },
];

export const LIBRARY_STORAGE_KEY = "sounddesigner.library-folders.v1";
const SHARED_STORAGE_DIRECTORY = "SoundDesigner";
const SHARED_STORAGE_FILE = "library-folders.json";

export const normalizeDialogPath = (value: string) => {
  let normalized = String(value || "").trim();
  if (!/^file:\/\//i.test(normalized)) return normalized;

  normalized = normalized.replace(/^file:\/\//i, "");
  if (normalized.indexOf("localhost/") === 0) normalized = normalized.slice(9);
  try {
    normalized = decodeURIComponent(normalized);
  } catch (_error) {
    // Keep the raw native path when a literal percent sign is present.
  }
  if (/^\/[A-Za-z]:[\\/]/.test(normalized)) normalized = normalized.slice(1);
  else if (normalized.charAt(0) !== "/" && !/^[A-Za-z]:[\\/]/.test(normalized)) normalized = `//${normalized}`;
  return normalized;
};

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
};

export const makeWaveform = (seed: string, bars = 72) => {
  let value = hashString(seed) || 1;
  const waveform: number[] = [];
  for (let index = 0; index < bars; index += 1) {
    value = (value * 1664525 + 1013904223) >>> 0;
    const noise = (value % 1000) / 1000;
    const envelope = 0.44 + Math.sin((index / bars) * Math.PI) * 0.56;
    waveform.push(Math.max(0.12, Math.min(1, (0.2 + noise * 0.8) * envelope)));
  }
  return waveform;
};

const fileTags = (fileName: string) =>
  fileName
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .split(/[\s_\-.]+/)
    .filter((part) => part.length > 1)
    .slice(0, 8);

const soundFromPath = (filePath: string, stat: import("fs").Stats, folder: LibraryFolder, directory: LibraryTreeNode): SoundFile | null => {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (!AUDIO_EXTENSIONS[extension]) return null;

  const name = path.basename(filePath, path.extname(filePath));
  return {
    id: `file-${hashString(filePath)}`,
    folderId: folder.id,
    directoryId: directory.id,
    name,
    path: filePath,
    extension,
    size: stat.size,
    modifiedAt: stat.mtimeMs || stat.mtime.getTime(),
    duration: 0,
    tags: fileTags(name),
    waveform: makeWaveform(filePath),
    accent: folder.accent,
  };
};

export const waitForPanelPaint = () => new Promise<void>((resolve) => window.setTimeout(resolve, 18));

const createTreeNode = (rootId: string, name: string, nodePath: string): LibraryTreeNode => ({
  id: nodePath === rootId ? rootId : `directory-${hashString(nodePath)}`,
  rootId,
  name,
  path: nodePath,
  directFileCount: 0,
  totalFileCount: 0,
  children: [],
});

const finalizeTree = (node: LibraryTreeNode): number => {
  node.children.sort((first, second) => first.name.toLowerCase().localeCompare(second.name.toLowerCase()));
  let total = node.directFileCount;
  for (let index = 0; index < node.children.length; index += 1) total += finalizeTree(node.children[index]);
  node.totalFileCount = total;
  return total;
};

export const scanFolder = async (
  folderPath: string,
  accent: AccentName,
  onProgress?: (progress: ScanProgress) => void,
) => {
  folderPath = normalizeDialogPath(folderPath);
  if (!window.cep) throw new Error("The CEP filesystem bridge is unavailable.");
  if (!fs || typeof fs.existsSync !== "function") {
    throw new Error("Node filesystem access is unavailable. Check the panel manifest and restart the Adobe host.");
  }
  if (!fs.existsSync(folderPath)) throw new Error(`The selected folder path could not be resolved: ${folderNameFromPath(folderPath) || folderPath}`);

  const rootId = `folder-${hashString(folderPath)}`;
  const tree = createTreeNode(rootId, path.basename(folderPath) || folderPath, folderPath);
  tree.id = rootId;
  const folder: LibraryFolder = {
    id: rootId,
    name: path.basename(folderPath) || folderPath,
    path: folderPath,
    fileCount: 0,
    accent,
    indexedAt: Date.now(),
    tree,
  };
  const queue: Array<{ path: string; node: LibraryTreeNode }> = [{ path: folderPath, node: tree }];
  const sounds: SoundFile[] = [];
  let queueIndex = 0;
  let visitedDirectories = 0;
  let processedEntries = 0;
  let lastProgressAt = 0;

  const reportProgress = (currentPath: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 80) return;
    lastProgressAt = now;
    if (onProgress) onProgress({ files: sounds.length, folders: visitedDirectories + queue.length - queueIndex, currentPath });
  };

  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex += 1;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(current.path);
    } catch (_error) {
      continue;
    }

    for (let index = 0; index < entries.length; index += 1) {
      const fullPath = path.join(current.path, entries[index]);
      let stat: import("fs").Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch (_error) {
        continue;
      }
      if (stat.isDirectory()) {
        const childNode = createTreeNode(rootId, entries[index], fullPath);
        current.node.children.push(childNode);
        queue.push({ path: fullPath, node: childNode });
      }
      else if (stat.isFile()) {
        const sound = soundFromPath(fullPath, stat, folder, current.node);
        if (sound) {
          sounds.push(sound);
          current.node.directFileCount += 1;
        }
      }
      processedEntries += 1;
      if (processedEntries % 192 === 0) {
        reportProgress(current.path);
        await waitForPanelPaint();
      }
    }

    visitedDirectories += 1;
    reportProgress(current.path);
    if (visitedDirectories % 6 === 0) await waitForPanelPaint();
  }

  folder.fileCount = finalizeTree(tree);
  reportProgress(folderPath, true);
  return { folder, sounds };
};

export const chooseLibraryFolder = (): string | null => {
  if (!window.cep) return null;
  const showDialog = window.cep.fs.showOpenDialogEx || window.cep.fs.showOpenDialog;
  const result = showDialog(false, true, "Add sound library", "", [], "", "Select folder") as {
    data?: string[] | string;
    err?: number | string;
  };
  if (!result) return null;
  if (typeof result.err !== "undefined" && Number(result.err) !== 0) {
    throw new Error(`The folder picker failed (CEP error ${String(result.err)}).`);
  }
  if (Array.isArray(result.data)) return result.data[0] ? normalizeDialogPath(result.data[0]) : null;
  if (typeof result.data === "string" && result.data.length) return normalizeDialogPath(result.data);
  return null;
};

const normalizePathList = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  const paths: string[] = [];
  const seen: { [folderPath: string]: boolean } = {};
  for (let index = 0; index < values.length; index += 1) {
    if (typeof values[index] !== "string") continue;
    const folderPath = normalizeDialogPath(values[index] as string);
    if (!folderPath || seen[folderPath]) continue;
    seen[folderPath] = true;
    paths.push(folderPath);
  }
  return paths;
};

export const getSharedLibraryStoragePath = () => {
  if (!window.cep || !fs || !path || typeof csi.getSystemPath !== "function") return "";
  try {
    const userDataPath = csi.getSystemPath("userData");
    return userDataPath ? path.join(userDataPath, SHARED_STORAGE_DIRECTORY, SHARED_STORAGE_FILE) : "";
  } catch (_error) {
    return "";
  }
};

const readLocalLibraryPaths = () => {
  try {
    return normalizePathList(JSON.parse(localStorage.getItem(LIBRARY_STORAGE_KEY) || "[]"));
  } catch (_error) {
    return [];
  }
};

const writeLocalLibraryPaths = (paths: string[]) => {
  try {
    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(paths));
  } catch (_error) {
    // The shared file remains authoritative if a host blocks local storage.
  }
};

const readSharedLibraryPaths = (): string[] | null => {
  const storagePath = getSharedLibraryStoragePath();
  if (!storagePath || typeof fs.existsSync !== "function" || !fs.existsSync(storagePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(storagePath, "utf8"));
    return normalizePathList(parsed && Array.isArray(parsed.paths) ? parsed.paths : parsed);
  } catch (_error) {
    return null;
  }
};

const writeSharedLibraryPaths = (paths: string[]) => {
  const storagePath = getSharedLibraryStoragePath();
  if (!storagePath || typeof fs.writeFileSync !== "function") return false;
  const directory = path.dirname(storagePath);
  const temporaryPath = `${storagePath}.tmp-${Date.now()}-${Math.round(Math.random() * 100000)}`;
  try {
    if (!fs.existsSync(directory)) fs.mkdirSync(directory);
    fs.writeFileSync(temporaryPath, JSON.stringify({ version: 1, paths, updatedAt: Date.now() }), "utf8");
    try {
      fs.renameSync(temporaryPath, storagePath);
    } catch (_renameError) {
      if (fs.existsSync(storagePath)) fs.unlinkSync(storagePath);
      fs.renameSync(temporaryPath, storagePath);
    }
    return true;
  } catch (_error) {
    try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch (_cleanupError) {}
    return false;
  }
};

export const saveLibraryPaths = (folders: LibraryFolder[]) => {
  const paths = normalizePathList(folders.filter((folder) => !folder.isDemo).map((folder) => folder.path));
  writeLocalLibraryPaths(paths);
  writeSharedLibraryPaths(paths);
  return paths;
};

export const loadLibraryPaths = () => {
  const sharedPaths = readSharedLibraryPaths();
  if (sharedPaths !== null) {
    writeLocalLibraryPaths(sharedPaths);
    return sharedPaths;
  }
  const localPaths = readLocalLibraryPaths();
  if (localPaths.length) writeSharedLibraryPaths(localPaths);
  return localPaths;
};

export const createDemoLibrary = () => {
  const now = Date.now();
  const definitions = [
    { id: "demo-cinematic", name: "Cinematic Core", fileCount: 3, indexedAt: now },
    { id: "demo-field", name: "Field Recordings", fileCount: 2, indexedAt: now - 78000 },
    { id: "demo-ui", name: "UI & Tech", fileCount: 3, indexedAt: now - 152000 },
  ];
  const folders: LibraryFolder[] = definitions.map((definition) => ({
    ...definition,
    path: `Demo library/${definition.name}`,
    accent: ACCENT,
    tree: createTreeNode(definition.id, definition.name, definition.id),
    isDemo: true,
  }));
  const sounds = DEMO_TRACKS.map<SoundFile>((track, index) => {
    const folder = folders[track.folder];
    let directory = folder.tree.children.find((child) => child.name === track.directory);
    if (!directory) {
      directory = createTreeNode(folder.id, track.directory, `${folder.id}/${track.directory}`);
      folder.tree.children.push(directory);
    }
    directory.directFileCount += 1;
    return {
      id: `demo-${index}`,
      folderId: folder.id,
      directoryId: directory.id,
      name: track.name,
      path: "",
      extension: index % 3 === 0 ? "aiff" : "wav",
      size: 740000 + index * 281000,
      modifiedAt: now - index * 540000,
      duration: track.duration,
      tags: track.tags,
      waveform: makeWaveform(track.name),
      accent: folder.accent,
      favorite: index === 0 || index === 3,
      isDemo: true,
    };
  });
  for (let index = 0; index < folders.length; index += 1) finalizeTree(folders[index].tree);
  return { folders, sounds };
};

export const nextAccent = (_folderCount: number): AccentName => ACCENT;

export const folderNameFromPath = (folderPath: string) => {
  const normalized = folderPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || folderPath;
};

export const fileUrl = (filePath: string) => {
  if (!filePath) return "";
  let normalized = filePath.replace(/\\/g, "/");
  if (/^\/\//.test(normalized)) return encodeURI(`file:${normalized}`).replace(/#/g, "%23");
  if (/^[A-Za-z]:/.test(normalized)) normalized = `/${normalized}`;
  return encodeURI(`file://${normalized}`).replace(/#/g, "%23");
};
