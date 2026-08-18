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

export const LIBRARY_STORAGE_KEY = "sounddesigner.library-folders.v1";
const SHARED_STORAGE_DIRECTORY = "SoundDesigner";
const SHARED_STORAGE_FILE = "library-folders.json";

export const normalizeDialogPath = (value: string) => {
  let normalized = String(value || "").trim().replace(/\0/g, "");
  if (
    normalized.length > 1
    && ((normalized.charAt(0) === '"'
      && normalized.charAt(normalized.length - 1) === '"')
      || (normalized.charAt(0) === "'"
        && normalized.charAt(normalized.length - 1) === "'"))
  ) normalized = normalized.slice(1, -1).trim();

  if (/^file:\/\//i.test(normalized)) {
    normalized = normalized.replace(/^file:\/\//i, "");
    if (/^localhost[\\/]/i.test(normalized)) normalized = normalized.slice(10);
    try {
      normalized = decodeURIComponent(normalized);
    } catch (_error) {
      // Keep the raw native path when a literal percent sign is present.
    }
    if (/^\/[A-Za-z][|:][\\/]/.test(normalized)) normalized = normalized.slice(1);
    else if (normalized.charAt(0) !== "/" && !/^[A-Za-z][|:][\\/]/.test(normalized)) normalized = `//${normalized}`;
  }

  // Older CEP dialogs can return the legacy C|/Folder URL form on Windows.
  normalized = normalized.replace(/^([A-Za-z])\|(?=[\\/])/, "$1:");
  if (path && path.sep === "\\") {
    normalized = normalized.replace(/\//g, "\\");
    try { normalized = path.win32.normalize(normalized); } catch (_error) {}
  }
  return normalized;
};

type ScanDiagnostics = {
  scanner: "node" | "cep";
  entriesSeen: number;
  filesSeen: number;
  extensionsSeen: string[];
  unreadableDirectories: number;
  unreadableEntries: number;
  skippedCycles: number;
  firstError: string;
};

const rememberExtension = (diagnostics: ScanDiagnostics, extension: string) => {
  if (extension && diagnostics.extensionsSeen.indexOf(extension) === -1 && diagnostics.extensionsSeen.length < 12) {
    diagnostics.extensionsSeen.push(extension);
  }
};

const addSound = (
  sounds: SoundFile[],
  filePath: string,
  size: number,
  modifiedAt: number,
  folder: LibraryFolder,
  directory: LibraryTreeNode,
) => {
  const sound = soundFromMetadata(filePath, size, modifiedAt, folder, directory);
  if (!sound) return false;
  sounds.push(sound);
  directory.directFileCount += 1;
  return true;
};

const errorText = (error: unknown) => {
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error || "Unknown filesystem error");
};

const windowsExtendedPath = (nativePath: string) => {
  if (!path || path.sep !== "\\") return nativePath;
  const windowsPath = nativePath.replace(/\//g, "\\");
  if (/^\\\\\?\\/.test(windowsPath)) return windowsPath;
  if (/^\\\\/.test(windowsPath)) return `\\\\?\\UNC\\${windowsPath.slice(2)}`;
  if (/^[A-Za-z]:\\/.test(windowsPath)) return `\\\\?\\${windowsPath}`;
  return windowsPath;
};

const filesystemCandidates = (nativePath: string) => {
  const extended = windowsExtendedPath(nativePath);
  return extended === nativePath ? [nativePath] : [nativePath, extended];
};

const withFilesystemPath = <T>(nativePath: string, operation: (candidate: string) => T): T => {
  const candidates = filesystemCandidates(nativePath);
  let lastError: unknown = new Error(`The path is unavailable: ${nativePath}`);
  for (let index = 0; index < candidates.length; index += 1) {
    try {
      return operation(candidates[index]);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

const readPathStats = (nativePath: string) => withFilesystemPath(nativePath, (candidate) => fs.statSync(candidate));
const readDirectoryEntries = (nativePath: string) => withFilesystemPath(nativePath, (candidate) => fs.readdirSync(candidate));
const realDirectoryKey = (nativePath: string) => {
  let resolved = nativePath;
  try {
    resolved = withFilesystemPath(nativePath, (candidate) => fs.realpathSync(candidate));
  } catch (_error) {
    try { resolved = path.resolve(nativePath); } catch (_pathError) {}
  }
  resolved = String(resolved).replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");
  return path && path.sep === "\\" ? resolved.toLowerCase() : resolved;
};

const directoryVisitKey = (nativePath: string, rootPath: string, canonicalRoot: string) => {
  try {
    const linkStat = withFilesystemPath(nativePath, (candidate) => fs.lstatSync(candidate));
    if (linkStat.isSymbolicLink()) return realDirectoryKey(nativePath);
  } catch (_error) {
    return realDirectoryKey(nativePath);
  }
  let resolved = nativePath;
  try {
    resolved = path.resolve(canonicalRoot, path.relative(rootPath, nativePath));
  } catch (_error) {}
  return path && path.sep === "\\" ? resolved.toLowerCase() : resolved;
};

const nativePathKey = (nativePath: string) => {
  const normalized = normalizeDialogPath(nativePath).replace(/[\\/]+$/, "");
  return path && path.sep === "\\" ? normalized.toLowerCase() : normalized;
};

export const sameNativePath = (first: string, second: string) =>
  nativePathKey(first) === nativePathKey(second);

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
  const waveform = new Float32Array(bars);
  for (let index = 0; index < bars; index += 1) {
    value = (value * 1664525 + 1013904223) >>> 0;
    const noise = (value % 1000) / 1000;
    const envelope = 0.44 + Math.sin((index / bars) * Math.PI) * 0.56;
    waveform[index] = Math.max(0.12, Math.min(1, (0.2 + noise * 0.8) * envelope));
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

const fileNameFromPath = (filePath: string) => {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
};

export const audioExtensionFromPath = (filePath: string) => {
  const fileName = fileNameFromPath(filePath);
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > -1 ? fileName.slice(dotIndex + 1).trim().toLowerCase() : "";
};

const soundFromMetadata = (
  filePath: string,
  size: number,
  modifiedAt: number,
  folder: LibraryFolder,
  directory: LibraryTreeNode,
): SoundFile | null => {
  const extension = audioExtensionFromPath(filePath);
  if (!AUDIO_EXTENSIONS[extension]) return null;

  const fileName = fileNameFromPath(filePath);
  const name = fileName.slice(0, Math.max(0, fileName.length - extension.length - 1));
  return {
    id: `file-${hashString(filePath)}`,
    folderId: folder.id,
    directoryId: directory.id,
    name,
    path: filePath,
    extension,
    size: Number(size) || 0,
    modifiedAt: Number(modifiedAt) || 0,
    duration: 0,
    tags: fileTags(name),
    waveform: makeWaveform(filePath),
    accent: folder.accent,
  };
};

const soundFromPath = (filePath: string, stat: import("fs").Stats, folder: LibraryFolder, directory: LibraryTreeNode) =>
  soundFromMetadata(filePath, stat.size, stat.mtimeMs || stat.mtime.getTime(), folder, directory);

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

const scanFolderWithNode = async (
  folderPath: string,
  accent: AccentName,
  onProgress?: (progress: ScanProgress) => void,
) => {
  folderPath = normalizeDialogPath(folderPath);
  if (!window.cep) throw new Error("The CEP filesystem bridge is unavailable.");
  if (!fs || typeof fs.statSync !== "function" || typeof fs.readdirSync !== "function") {
    throw new Error("Node filesystem access is unavailable. Check the panel manifest and restart the Adobe host.");
  }

  let rootStat: import("fs").Stats;
  try {
    rootStat = readPathStats(folderPath);
  } catch (error) {
    throw new Error(`The selected folder could not be opened: ${folderNameFromPath(folderPath) || folderPath}. ${errorText(error)}`);
  }
  if (!rootStat.isDirectory()) throw new Error("The selected path is not a folder.");

  const rootId = `folder-${hashString(folderPath)}`;
  const rootName = path.basename(folderPath) || folderNameFromPath(folderPath) || folderPath;
  const tree = createTreeNode(rootId, rootName, folderPath);
  tree.id = rootId;
  const folder: LibraryFolder = {
    id: rootId,
    name: rootName,
    path: folderPath,
    fileCount: 0,
    accent,
    indexedAt: Date.now(),
    tree,
  };
  const queue: Array<{ path: string; node: LibraryTreeNode }> = [{ path: folderPath, node: tree }];
  const canonicalRoot = realDirectoryKey(folderPath);
  const sounds: SoundFile[] = [];
  const visitedDirectories: { [directoryPath: string]: boolean } = {};
  const diagnostics: ScanDiagnostics = {
    scanner: "node",
    entriesSeen: 0,
    filesSeen: 0,
    extensionsSeen: [],
    unreadableDirectories: 0,
    unreadableEntries: 0,
    skippedCycles: 0,
    firstError: "",
  };
  let queueIndex = 0;
  let processedDirectories = 0;
  let processedEntries = 0;
  let lastProgressAt = 0;

  const rememberError = (error: unknown) => {
    if (!diagnostics.firstError) diagnostics.firstError = errorText(error);
  };
  const reportProgress = (currentPath: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 80) return;
    lastProgressAt = now;
    if (onProgress) onProgress({ files: sounds.length, folders: processedDirectories + queue.length - queueIndex, currentPath });
  };

  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex += 1;
    const directoryKey = directoryVisitKey(current.path, folderPath, canonicalRoot);
    if (visitedDirectories[directoryKey]) {
      diagnostics.skippedCycles += 1;
      continue;
    }
    visitedDirectories[directoryKey] = true;

    let entries: string[];
    try {
      entries = readDirectoryEntries(current.path);
    } catch (error) {
      diagnostics.unreadableDirectories += 1;
      rememberError(error);
      if (current.path === folderPath) {
        throw new Error(`The selected folder exists but the operating system would not allow it to be read. ${errorText(error)}`);
      }
      continue;
    }

    for (let index = 0; index < entries.length; index += 1) {
      const fullPath = path.join(current.path, entries[index]);
      const extension = audioExtensionFromPath(fullPath);
      const supportedAudioName = Boolean(AUDIO_EXTENSIONS[extension]);
      diagnostics.entriesSeen += 1;
      let stat: import("fs").Stats | null = null;
      try {
        stat = readPathStats(fullPath);
      } catch (error) {
        diagnostics.unreadableEntries += 1;
        rememberError(error);
        if (supportedAudioName) {
          diagnostics.filesSeen += 1;
          rememberExtension(diagnostics, extension);
          addSound(sounds, fullPath, 0, 0, folder, current.node);
        }
        continue;
      }

      if (stat.isDirectory()) {
        const childNode = createTreeNode(rootId, entries[index], fullPath);
        current.node.children.push(childNode);
        queue.push({ path: fullPath, node: childNode });
      } else if (stat.isFile() || supportedAudioName) {
        diagnostics.filesSeen += 1;
        rememberExtension(diagnostics, extension);
        addSound(
          sounds,
          fullPath,
          stat.isFile() ? stat.size : 0,
          stat.isFile() ? stat.mtimeMs || stat.mtime.getTime() : 0,
          folder,
          current.node,
        );
      }

      processedEntries += 1;
      if (processedEntries % 192 === 0) {
        reportProgress(current.path);
        await waitForPanelPaint();
      }
    }

    processedDirectories += 1;
    reportProgress(current.path);
    if (processedDirectories % 6 === 0) await waitForPanelPaint();
  }

  folder.fileCount = finalizeTree(tree);
  reportProgress(folderPath, true);
  return { folder, sounds, diagnostics };
};

const cepStatFlag = (data: unknown, name: "isFile" | "isDirectory") => {
  if (!data || typeof data !== "object") return false;
  const value = (data as { [key: string]: unknown })[name];
  try { return typeof value === "function" ? Boolean(value.call(data)) : value === true; } catch (_error) { return false; }
};

const cepErrorText = (operation: string, nativePath: string, code: unknown) =>
  `CEP ${operation} failed for ${folderNameFromPath(nativePath) || nativePath} (error ${String(code)})`;

const joinNativePath = (directoryPath: string, entryName: string) => {
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(entryName)) return entryName;
  const separator = path && path.sep === "\\" ? "\\" : directoryPath.indexOf("\\") > -1 ? "\\" : "/";
  return directoryPath.replace(/[\\/]+$/, "") + separator + entryName.replace(/^[\\/]+/, "");
};

const scanFolderWithCep = async (
  folderPath: string,
  accent: AccentName,
  onProgress?: (progress: ScanProgress) => void,
) => {
  const cepFs = window.cep && window.cep.fs;
  if (!cepFs || typeof cepFs.readdir !== "function" || typeof cepFs.stat !== "function") {
    throw new Error("The CEP filesystem fallback is unavailable.");
  }

  const rootId = `folder-${hashString(folderPath)}`;
  const rootName = folderNameFromPath(folderPath) || folderPath;
  const tree = createTreeNode(rootId, rootName, folderPath);
  tree.id = rootId;
  const folder: LibraryFolder = {
    id: rootId,
    name: rootName,
    path: folderPath,
    fileCount: 0,
    accent,
    indexedAt: Date.now(),
    tree,
  };
  const diagnostics: ScanDiagnostics = {
    scanner: "cep",
    entriesSeen: 0,
    filesSeen: 0,
    extensionsSeen: [],
    unreadableDirectories: 0,
    unreadableEntries: 0,
    skippedCycles: 0,
    firstError: "",
  };
  const queue: Array<{ path: string; node: LibraryTreeNode }> = [{ path: folderPath, node: tree }];
  const visited: { [directoryPath: string]: boolean } = {};
  const sounds: SoundFile[] = [];
  let queueIndex = 0;
  let processedDirectories = 0;
  let processedEntries = 0;
  const maximumDirectories = 100000;

  while (queueIndex < queue.length) {
    if (processedDirectories > maximumDirectories) throw new Error("The library contains too many linked directories to scan safely.");
    const current = queue[queueIndex];
    queueIndex += 1;
    const visitKey = nativePathKey(current.path);
    if (visited[visitKey]) {
      diagnostics.skippedCycles += 1;
      continue;
    }
    visited[visitKey] = true;

    const readResult = cepFs.readdir(current.path) as { err?: unknown; data?: unknown };
    if (!readResult || Number(readResult.err) !== 0 || !Array.isArray(readResult.data)) {
      diagnostics.unreadableDirectories += 1;
      const message = cepErrorText("readdir", current.path, readResult && readResult.err);
      if (!diagnostics.firstError) diagnostics.firstError = message;
      if (current.path === folderPath) throw new Error(message);
      continue;
    }

    const entries = readResult.data as unknown[];
    for (let index = 0; index < entries.length; index += 1) {
      const entryName = entries[index];
      if (typeof entryName !== "string" || !entryName) continue;
      const fullPath = joinNativePath(current.path, entryName);
      const extension = audioExtensionFromPath(fullPath);
      const supportedAudioName = Boolean(AUDIO_EXTENSIONS[extension]);
      diagnostics.entriesSeen += 1;
      const statResult = cepFs.stat(fullPath) as { err?: unknown; data?: unknown };
      if (!statResult || Number(statResult.err) !== 0 || !statResult.data) {
        diagnostics.unreadableEntries += 1;
        const message = cepErrorText("stat", fullPath, statResult && statResult.err);
        if (!diagnostics.firstError) diagnostics.firstError = message;
        if (supportedAudioName) {
          diagnostics.filesSeen += 1;
          rememberExtension(diagnostics, extension);
          addSound(sounds, fullPath, 0, 0, folder, current.node);
        }
        continue;
      }

      if (cepStatFlag(statResult.data, "isDirectory")) {
        const childName = fileNameFromPath(fullPath) || entryName;
        const childNode = createTreeNode(rootId, childName, fullPath);
        current.node.children.push(childNode);
        queue.push({ path: fullPath, node: childNode });
      } else if (cepStatFlag(statResult.data, "isFile") || supportedAudioName) {
        diagnostics.filesSeen += 1;
        rememberExtension(diagnostics, extension);
        const metadata = statResult.data as { size?: unknown; mtime?: unknown };
        let size = Number(metadata.size) || 0;
        let modifiedAt = Number(new Date(metadata.mtime as string | number | Date)) || 0;
        try {
          const nodeStat = readPathStats(fullPath);
          size = nodeStat.size;
          modifiedAt = nodeStat.mtimeMs || nodeStat.mtime.getTime();
        } catch (_error) {}
        addSound(sounds, fullPath, size, modifiedAt, folder, current.node);
      }

      processedEntries += 1;
      if (processedEntries % 192 === 0) {
        if (onProgress) onProgress({ files: sounds.length, folders: processedDirectories + queue.length - queueIndex, currentPath: current.path });
        await waitForPanelPaint();
      }
    }
    processedDirectories += 1;
    if (processedDirectories % 6 === 0) await waitForPanelPaint();
  }

  folder.fileCount = finalizeTree(tree);
  if (onProgress) onProgress({ files: sounds.length, folders: processedDirectories, currentPath: folderPath });
  return { folder, sounds, diagnostics };
};

export const scanFolder = async (
  folderPath: string,
  accent: AccentName,
  onProgress?: (progress: ScanProgress) => void,
) => {
  folderPath = normalizeDialogPath(folderPath);
  let nodeResult: Awaited<ReturnType<typeof scanFolderWithNode>> | null = null;
  let nodeError: unknown = null;
  try {
    nodeResult = await scanFolderWithNode(folderPath, accent, onProgress);
    const unreadable = nodeResult.diagnostics.unreadableDirectories + nodeResult.diagnostics.unreadableEntries;
    if (nodeResult.sounds.length && !unreadable) return nodeResult;
  } catch (error) {
    nodeError = error;
  }

  let cepResult: Awaited<ReturnType<typeof scanFolderWithCep>> | null = null;
  let cepError: unknown = null;
  try {
    cepResult = await scanFolderWithCep(folderPath, accent, onProgress);
  } catch (error) {
    cepError = error;
  }

  if (cepResult && (!nodeResult || cepResult.sounds.length > nodeResult.sounds.length)) return cepResult;
  if (nodeResult) return nodeResult;
  throw new Error(
    `The folder could not be indexed. Node: ${errorText(nodeError)}. CEP: ${errorText(cepError)}`,
  );
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
    const pathKey = nativePathKey(folderPath);
    if (!folderPath || seen[pathKey]) continue;
    seen[pathKey] = true;
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
  const paths = normalizePathList(folders.map((folder) => folder.path));
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

export const nextAccent = (_folderCount: number): AccentName => ACCENT;

export const folderNameFromPath = (folderPath: string) => {
  const normalized = folderPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || folderPath;
};

export const fileUrl = (filePath: string) => {
  if (!filePath) return "";
  let normalized = filePath.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "").replace(/\\/g, "/");
  const isUnc = /^\/\//.test(normalized);
  if (/^[A-Za-z]:/.test(normalized)) normalized = `/${normalized}`;
  let encoded = normalized.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  encoded = encoded.replace(/^\/([A-Za-z])%3A/i, "/$1:");
  return isUnc ? `file:${encoded}` : `file://${encoded}`;
};
