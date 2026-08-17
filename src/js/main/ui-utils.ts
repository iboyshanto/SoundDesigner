import type { HostApp, LibraryTreeNode } from "./types";

export const formatDuration = (seconds: number) => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${minutes}:${remainder.toFixed(safe < 10 ? 2 : 1).padStart(4, "0")}`;
};

export const formatSize = (bytes: number) => {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const relativeTime = (timestamp: number, now: number) => {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
};

export const hostLabel = (host: HostApp) => {
  if (host === "premiere") return "Premiere Pro";
  if (host === "aftereffects") return "After Effects";
  if (host === "browser") return "Browser preview";
  return "Adobe host";
};

export const collectTreeIds = (node: LibraryTreeNode, target: Set<string>) => {
  target.add(node.id);
  for (const child of node.children) collectTreeIds(child, target);
};

export const findTreeNode = (node: LibraryTreeNode, nodeId: string): LibraryTreeNode | null => {
  if (node.id === nodeId) return node;
  for (const child of node.children) {
    const match = findTreeNode(child, nodeId);
    if (match) return match;
  }
  return null;
};

export const countTreeNodes = (node: LibraryTreeNode): number =>
  1 + node.children.reduce((count, child) => count + countTreeNodes(child), 0);

export const treeMatchesQuery = (node: LibraryTreeNode, query: string): boolean =>
  !query || node.name.toLowerCase().includes(query) || node.children.some((child) => treeMatchesQuery(child, query));
