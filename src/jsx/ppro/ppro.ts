import {
  helloVoid,
  helloError,
  helloStr,
  helloNum,
  helloArrayStr,
  helloObj,
} from "../utils/samples";
export { helloError, helloStr, helloNum, helloArrayStr, helloObj, helloVoid };

type InsertAudioRequest = {
  path: string;
  name: string;
  targetAudioTrack: number;
  insertionTarget?: "playhead" | "selected-clip";
};

type HostResult = {
  ok: boolean;
  message: string;
  host: string;
  imported?: boolean;
  trackIndex?: number;
};

type ProjectContext = {
  ok: boolean;
  host: string;
  projectPath?: string;
  projectDirectory?: string;
  projectName?: string;
  message: string;
};

declare var qe: any;

/** Returns the saved project location used for project-scoped SoundDesigner media. */
export function getProjectContext(): ProjectContext {
  var projectPath: string;
  var projectFile: File;
  var projectName: string;
  try {
    if (!app.project) {
      return { ok: false, host: "premiere", message: "Open a Premiere Pro project before downloading audio." };
    }
    projectPath = String(app.project.path || "");
    if (!projectPath) {
      return { ok: false, host: "premiere", message: "Save the Premiere Pro project before downloading project audio." };
    }
    projectFile = new File(projectPath);
    projectName = String(projectFile.displayName || projectFile.name || "Premiere Project").replace(/\.[^.]+$/, "");
    return {
      ok: true,
      host: "premiere",
      projectPath: String(projectFile.fsName),
      projectDirectory: String(projectFile.parent.fsName),
      projectName: projectName,
      message: "Project storage is available.",
    };
  } catch (error) {
    return {
      ok: false,
      host: "premiere",
      message: error && error.toString ? error.toString() : "The Premiere Pro project location could not be read.",
    };
  }
}

function normalizePath(value: string): string {
  var normalized: string = String(value || "").replace(/\\/g, "/");
  if (String($.os || "").toLowerCase().indexOf("windows") >= 0) normalized = normalized.toLowerCase();
  return normalized;
}

function findProjectItem(parent: ProjectItem, mediaPath: string): ProjectItem | null {
  var children: ProjectItemCollection;
  var index: number;
  var child: ProjectItem;
  var childPath: string;
  var nested: ProjectItem | null;
  try {
    children = parent.children;
    if (!children) return null;
    for (index = 0; index < children.numItems; index += 1) {
      child = children[index];
      try {
        childPath = child.getMediaPath();
        if (childPath && normalizePath(childPath) === mediaPath) return child;
      } catch (_mediaError) {
        // Bins and offline items may not expose a media path.
      }
      try {
        if (child.children && child.children.numItems > 0) {
          nested = findProjectItem(child, mediaPath);
          if (nested) return nested;
        }
      } catch (_childrenError) {
        // Leaf project items do not have traversable children in every version.
      }
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function findOrCreateSoundDesignerBin(root: ProjectItem): ProjectItem {
  var children: ProjectItemCollection = root.children;
  var index: number;
  var item: ProjectItem;
  for (index = 0; index < children.numItems; index += 1) {
    item = children[index];
    if (item && item.name === "SoundDesigner") {
      try {
        if (item.children) return item;
      } catch (_error) {
        // Continue and create a real bin if a clip has the reserved name.
      }
    }
  }
  return root.createBin("SoundDesigner");
}

function collectProjectItemsOutsideBin(parent: ProjectItem, excludedBin: ProjectItem, mediaPath: string, matches: ProjectItem[]): void {
  var children: ProjectItemCollection;
  var index: number;
  var child: ProjectItem;
  var childPath: string;
  try {
    if (parent.nodeId === excludedBin.nodeId) return;
    children = parent.children;
    if (!children) return;
    for (index = 0; index < children.numItems; index += 1) {
      child = children[index];
      try {
        childPath = child.getMediaPath();
        if (childPath && normalizePath(childPath) === mediaPath) matches.push(child);
      } catch (_mediaError) {
        // Bins and offline items may not expose a media path.
      }
      try {
        if (child.children && child.children.numItems > 0) {
          collectProjectItemsOutsideBin(child, excludedBin, mediaPath, matches);
        }
      } catch (_childrenError) {
        // Leaf project items do not have traversable children in every version.
      }
    }
  } catch (_error) {
    // Ignore project branches that Premiere cannot currently traverse.
  }
}

function moveProjectItemsToSoundDesigner(root: ProjectItem, normalizedPath: string, targetBin: ProjectItem): number {
  var matches: ProjectItem[] = [];
  var index: number;
  collectProjectItemsOutsideBin(root, targetBin, normalizedPath, matches);
  for (index = 0; index < matches.length; index += 1) matches[index].moveBin(targetBin);
  return matches.length;
}

function getAudioDurationSeconds(projectItem: ProjectItem): number {
  var inPoint: Time;
  var outPoint: Time;
  var duration: number;
  try {
    inPoint = projectItem.getInPoint();
    outPoint = projectItem.getOutPoint(2);
    duration = Number(outPoint.seconds) - Number(inPoint.seconds);
    if (duration > 0) return duration;
  } catch (_audioDurationError) {
    // Fall back to point occupancy when a Premiere importer exposes no duration.
  }
  return 0.001;
}

function trackAcceptsRange(track: Track, startSeconds: number, endSeconds: number): boolean {
  var clips: TrackItemCollection;
  var index: number;
  var clip: TrackItem;
  var clipStart: number;
  var clipEnd: number;
  try {
    if (track.isLocked()) return false;
    clips = track.clips;
    for (index = 0; index < clips.numItems; index += 1) {
      clip = clips[index];
      clipStart = Number(clip.start.seconds);
      clipEnd = Number(clip.end.seconds);
      if (startSeconds < clipEnd && endSeconds > clipStart) return false;
    }
    return true;
  } catch (_trackReadError) {
    return false;
  }
}

function findAvailableAudioTrack(sequence: Sequence, requestedIndex: number, startSeconds: number, endSeconds: number): number {
  var index: number;
  if (requestedIndex >= 0 && requestedIndex < sequence.audioTracks.numTracks) {
    if (trackAcceptsRange(sequence.audioTracks[requestedIndex], startSeconds, endSeconds)) return requestedIndex;
  }
  for (index = 0; index < sequence.audioTracks.numTracks; index += 1) {
    if (index !== requestedIndex && trackAcceptsRange(sequence.audioTracks[index], startSeconds, endSeconds)) return index;
  }
  return -1;
}

function findSelectedClipStartSeconds(sequence: Sequence): number {
  var earliest: number = -1;
  var trackIndex: number;
  var clipIndex: number;
  var clips: TrackItemCollection;
  var clip: TrackItem;
  var startSeconds: number;
  var inspectTracks = function (tracks: TrackCollection): void {
    for (trackIndex = 0; trackIndex < tracks.numTracks; trackIndex += 1) {
      clips = tracks[trackIndex].clips;
      for (clipIndex = 0; clipIndex < clips.numItems; clipIndex += 1) {
        clip = clips[clipIndex];
        if (!clip.isSelected()) continue;
        startSeconds = Number(clip.start.seconds);
        if (earliest < 0 || startSeconds < earliest) earliest = startSeconds;
      }
    }
  };
  inspectTracks(sequence.videoTracks);
  inspectTracks(sequence.audioTracks);
  return earliest;
}

function createAudioTrack(sequence: Sequence): number {
  var previousCount: number = sequence.audioTracks.numTracks;
  var qeSequence: any;
  try {
    app.enableQE();
    if (typeof qe === "undefined" || !qe.project) return -1;
    qeSequence = qe.project.getActiveSequence();
    if (!qeSequence || typeof qeSequence.addTracks !== "function") return -1;
    // QE addTracks(0) adds one standard audio track and no video tracks.
    qeSequence.addTracks(0);
    if (sequence.audioTracks.numTracks > previousCount) return sequence.audioTracks.numTracks - 1;
    // The public DOM collection can stay stale until activeSequence is fetched again.
    // The caller re-reads the sequence and validates this prospective index.
    return previousCount;
  } catch (_qeTrackError) {
    return -1;
  }
}

/** Moves host-imported audio into the shared SoundDesigner Project-panel bin. */
export function organizeAudioMedia(request: InsertAudioRequest): HostResult {
  var project: Project;
  var sourceFile: File;
  var normalizedPath: string;
  var projectItem: ProjectItem | null;
  var targetBin: ProjectItem;
  var moved: boolean;
  try {
    if (!request || typeof request.path !== "string" || request.path.length === 0) {
      return { ok: false, host: "premiere", message: "No audio file path was provided." };
    }
    sourceFile = new File(request.path);
    if (!app.project) {
      return { ok: false, host: "premiere", message: "Open a Premiere Pro project before organizing audio." };
    }
    project = app.project;
    normalizedPath = normalizePath(sourceFile.fsName);
    projectItem = findProjectItem(project.rootItem, normalizedPath);
    if (!projectItem) {
      return { ok: false, host: "premiere", message: "The audio project item is not available yet." };
    }
    targetBin = findOrCreateSoundDesignerBin(project.rootItem);
    moved = moveProjectItemsToSoundDesigner(project.rootItem, normalizedPath, targetBin) > 0;
    return {
      ok: true,
      host: "premiere",
      imported: false,
      message: moved ? "Audio moved into the SoundDesigner bin." : "Audio is already in the SoundDesigner bin.",
    };
  } catch (error) {
    return {
      ok: false,
      host: "premiere",
      message: error && error.toString ? error.toString() : "Could not organize the Premiere Pro project item.",
    };
  }
}

/**
 * Premiere Pro host adapter. This TypeScript is compiled to ES3 before CEP loads it.
 * The public function accepts and returns plain JSON-compatible objects only.
 */
export function insertAudioClip(request: InsertAudioRequest): HostResult {
  var project: Project;
  var sequence: Sequence;
  var sourceFile: File;
  var normalizedPath: string;
  var projectItem: ProjectItem | null;
  var targetBin: ProjectItem;
  var imported: boolean = false;
  var trackIndex: number;
  var playhead: Time;
  var playheadSeconds: number;
  var insertionSeconds: number;
  var clipEndSeconds: number;
  var createdTrack: boolean = false;
  var insertResult: boolean | void;

  try {
    if (!request || typeof request.path !== "string" || request.path.length === 0) {
      return { ok: false, host: "premiere", message: "No audio file path was provided." };
    }
    sourceFile = new File(request.path);
    if (!sourceFile.exists) {
      return { ok: false, host: "premiere", message: "The selected audio file no longer exists." };
    }
    if (!app.project) {
      return { ok: false, host: "premiere", message: "Open a Premiere Pro project before inserting audio." };
    }
    project = app.project;
    sequence = project.activeSequence;
    if (!sequence) {
      return { ok: false, host: "premiere", message: "Open or activate a sequence before inserting audio." };
    }

    normalizedPath = normalizePath(sourceFile.fsName);
    targetBin = findOrCreateSoundDesignerBin(project.rootItem);
    projectItem = findProjectItem(project.rootItem, normalizedPath);
    if (!projectItem) {
      if (!project.importFiles([sourceFile.fsName], true, targetBin, false)) {
        return { ok: false, host: "premiere", message: "Premiere Pro could not import this audio file." };
      }
      imported = true;
      projectItem = findProjectItem(project.rootItem, normalizedPath);
    }
    if (!projectItem) {
      return { ok: false, host: "premiere", message: "The file imported, but its project item could not be resolved." };
    }
    moveProjectItemsToSoundDesigner(project.rootItem, normalizedPath, targetBin);
    projectItem = findProjectItem(targetBin, normalizedPath) || projectItem;

    playhead = sequence.getPlayerPosition();
    playheadSeconds = Number(playhead.seconds);
    insertionSeconds = playheadSeconds;
    if (request.insertionTarget === "selected-clip") {
      insertionSeconds = findSelectedClipStartSeconds(sequence);
      if (insertionSeconds < 0) {
        return { ok: false, host: "premiere", message: "Select a timeline clip before inserting at the selected clip." };
      }
    }
    clipEndSeconds = insertionSeconds + getAudioDurationSeconds(projectItem);
    trackIndex = findAvailableAudioTrack(sequence, Number(request.targetAudioTrack), insertionSeconds, clipEndSeconds);
    if (trackIndex < 0) {
      trackIndex = createAudioTrack(sequence);
      if (trackIndex >= 0) {
        sequence = project.activeSequence;
        if (!sequence || trackIndex >= sequence.audioTracks.numTracks) {
          trackIndex = -1;
        } else {
          createdTrack = true;
        }
      }
    }
    if (trackIndex < 0) {
      return { ok: false, host: "premiere", message: "Every available audio track overlaps this sound, and Premiere could not create a new audio track." };
    }
    insertResult = sequence.audioTracks[trackIndex].overwriteClip(projectItem, insertionSeconds);
    if (insertResult === false) {
      return { ok: false, host: "premiere", message: "Premiere Pro rejected the timeline insertion." };
    }
    return {
      ok: true,
      host: "premiere",
      imported: imported,
      trackIndex: trackIndex,
      message: (request.name || sourceFile.displayName) + " inserted on A" + String(trackIndex + 1) + (request.insertionTarget === "selected-clip" ? " at the selected clip" : " at the playhead") + (createdTrack ? " (new track)." : "."),
    };
  } catch (error) {
    return {
      ok: false,
      host: "premiere",
      message: error && error.toString ? error.toString() : "Unknown Premiere Pro error.",
    };
  }
}
