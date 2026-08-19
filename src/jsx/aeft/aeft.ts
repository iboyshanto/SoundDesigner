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
};

type AudioDragState = {
  ok: boolean;
  host: string;
  compositionId?: number;
  layerCount: number;
  message: string;
};

type ProjectContext = {
  ok: boolean;
  host: string;
  projectPath?: string;
  projectDirectory?: string;
  projectName?: string;
  message: string;
};

/** Returns the saved project location used for project-scoped SoundDesigner media. */
export function getProjectContext(): ProjectContext {
  var projectFile: File;
  var projectName: string;
  try {
    if (!app.project) {
      return { ok: false, host: "aftereffects", message: "Open an After Effects project before downloading audio." };
    }
    if (!app.project.file) {
      return { ok: false, host: "aftereffects", message: "Save the After Effects project before downloading project audio." };
    }
    projectFile = app.project.file;
    projectName = String(projectFile.displayName || projectFile.name || "After Effects Project").replace(/\.[^.]+$/, "");
    return {
      ok: true,
      host: "aftereffects",
      projectPath: String(projectFile.fsName),
      projectDirectory: String(projectFile.parent.fsName),
      projectName: projectName,
      message: "Project storage is available.",
    };
  } catch (error) {
    return {
      ok: false,
      host: "aftereffects",
      message: error && error.toString ? error.toString() : "The After Effects project location could not be read.",
    };
  }
}

function normalizedFilePath(file: File): string {
  var normalized: string = String(file.fsName || "").replace(/\\/g, "/");
  if (String($.os || "").toLowerCase().indexOf("windows") >= 0) normalized = normalized.toLowerCase();
  return normalized;
}

function findFootageByPath(sourceFile: File): FootageItem | null {
  var targetPath: string = normalizedFilePath(sourceFile);
  var index: number;
  var item: Item;
  var footage: FootageItem;
  var footageFile: File | null;
  for (index = 1; index <= app.project.numItems; index += 1) {
    item = app.project.item(index);
    if (item instanceof FootageItem) {
      footage = item as FootageItem;
      try {
        footageFile = footage.mainSource.file;
        if (footageFile && normalizedFilePath(footageFile) === targetPath) return footage;
      } catch (_error) {
        // Solids and generated footage do not expose a source file.
      }
    }
  }
  return null;
}

function findOrCreateSoundDesignerFolder(): FolderItem {
  var index: number;
  var item: Item;
  for (index = 1; index <= app.project.numItems; index += 1) {
    item = app.project.item(index);
    if (
      item instanceof FolderItem
      && item.name === "SoundDesigner"
      && item.parentFolder.id === app.project.rootFolder.id
    ) {
      return item as FolderItem;
    }
  }
  return app.project.items.addFolder("SoundDesigner");
}

function isInsideFolder(item: Item, folder: FolderItem): boolean {
  var parent: FolderItem = item.parentFolder;
  while (parent) {
    if (parent.id === folder.id) return true;
    if (parent.id === app.project.rootFolder.id) return false;
    parent = parent.parentFolder;
  }
  return false;
}

function moveAllFootageToSoundDesigner(sourceFile: File): number {
  var targetPath: string = normalizedFilePath(sourceFile);
  var matches: FootageItem[] = [];
  var targetFolder: FolderItem;
  var index: number;
  var item: Item;
  var footageFile: File | null;
  var moved: number = 0;
  for (index = 1; index <= app.project.numItems; index += 1) {
    item = app.project.item(index);
    if (!(item instanceof FootageItem)) continue;
    try {
      footageFile = (item as FootageItem).mainSource.file;
      if (footageFile && normalizedFilePath(footageFile) === targetPath) matches.push(item as FootageItem);
    } catch (_error) {
      // Solids and generated footage do not expose a source file.
    }
  }
  if (!matches.length) return 0;
  targetFolder = findOrCreateSoundDesignerFolder();
  for (index = 0; index < matches.length; index += 1) {
    if (!isInsideFolder(matches[index], targetFolder)) {
      matches[index].parentFolder = targetFolder;
      moved += 1;
    }
  }
  return moved;
}

function countCompositionLayersByPath(composition: CompItem, sourceFile: File): number {
  var targetPath: string = normalizedFilePath(sourceFile);
  var count: number = 0;
  var index: number;
  var layer: Layer;
  var source: AVItem | null;
  var footageFile: File | null;
  for (index = 1; index <= composition.numLayers; index += 1) {
    layer = composition.layer(index);
    if (!(layer instanceof AVLayer)) continue;
    source = (layer as AVLayer).source;
    if (!(source instanceof FootageItem)) continue;
    try {
      footageFile = (source as FootageItem).mainSource.file;
      if (footageFile && normalizedFilePath(footageFile) === targetPath) count += 1;
    } catch (_error) {
      // Solids and generated footage do not expose a source file.
    }
  }
  return count;
}

/** Snapshot used to de-duplicate native CEP drops and the AE insertion fallback. */
export function getAudioDragState(request: InsertAudioRequest): AudioDragState {
  var sourceFile: File;
  var composition: CompItem;
  try {
    if (!request || typeof request.path !== "string" || request.path.length === 0) {
      return { ok: false, host: "aftereffects", layerCount: 0, message: "No audio file path was provided." };
    }
    sourceFile = new File(request.path);
    if (!sourceFile.exists) {
      return { ok: false, host: "aftereffects", layerCount: 0, message: "The selected audio file no longer exists." };
    }
    if (!app.project || !(app.project.activeItem instanceof CompItem)) {
      return { ok: false, host: "aftereffects", layerCount: 0, message: "Activate a composition before dragging audio." };
    }
    composition = app.project.activeItem as CompItem;
    return {
      ok: true,
      host: "aftereffects",
      compositionId: Number(composition.id),
      layerCount: countCompositionLayersByPath(composition, sourceFile),
      message: "After Effects composition is ready for audio drop.",
    };
  } catch (error) {
    return {
      ok: false,
      host: "aftereffects",
      layerCount: 0,
      message: error && error.toString ? error.toString() : "Could not inspect the active composition.",
    };
  }
}

/** Moves host-imported audio into the shared SoundDesigner Project-panel folder. */
export function organizeAudioMedia(request: InsertAudioRequest): HostResult {
  var sourceFile: File;
  var footage: FootageItem | null;
  var moved: boolean;
  var undoOpen: boolean = false;
  try {
    if (!request || typeof request.path !== "string" || request.path.length === 0) {
      return { ok: false, host: "aftereffects", message: "No audio file path was provided." };
    }
    sourceFile = new File(request.path);
    if (!app.project) {
      return { ok: false, host: "aftereffects", message: "Open an After Effects project before organizing audio." };
    }
    footage = findFootageByPath(sourceFile);
    if (!footage) {
      return { ok: false, host: "aftereffects", message: "The audio project item is not available yet." };
    }
    app.beginUndoGroup("SoundDesigner: Organize Audio");
    undoOpen = true;
    moved = moveAllFootageToSoundDesigner(sourceFile) > 0;
    return {
      ok: true,
      host: "aftereffects",
      imported: false,
      message: moved ? "Audio moved into the SoundDesigner folder." : "Audio is already in the SoundDesigner folder.",
    };
  } catch (error) {
    return {
      ok: false,
      host: "aftereffects",
      message: error && error.toString ? error.toString() : "Could not organize the After Effects project item.",
    };
  } finally {
    if (undoOpen) app.endUndoGroup();
  }
}

/**
 * After Effects host adapter. This TypeScript is compiled to ES3 before CEP loads it.
 * The public function accepts and returns plain JSON-compatible objects only.
 */
export function insertAudioClip(request: InsertAudioRequest): HostResult {
  var sourceFile: File;
  var composition: CompItem;
  var footage: FootageItem | null;
  var imported: boolean = false;
  var layer: AVLayer;
  var importOptions: ImportOptions;
  var undoOpen: boolean = false;
  var insertionTime: number;
  var selectedLayers: Layer[];
  var selectedIndex: number;

  try {
    if (!request || typeof request.path !== "string" || request.path.length === 0) {
      return { ok: false, host: "aftereffects", message: "No audio file path was provided." };
    }
    sourceFile = new File(request.path);
    if (!sourceFile.exists) {
      return { ok: false, host: "aftereffects", message: "The selected audio file no longer exists." };
    }
    if (!app.project) {
      return { ok: false, host: "aftereffects", message: "Open an After Effects project before inserting audio." };
    }
    if (!(app.project.activeItem instanceof CompItem)) {
      return { ok: false, host: "aftereffects", message: "Activate a composition before inserting audio." };
    }
    composition = app.project.activeItem as CompItem;
    insertionTime = composition.time;
    if (request.insertionTarget === "selected-clip") {
      selectedLayers = composition.selectedLayers;
      if (!selectedLayers || selectedLayers.length === 0) {
        return { ok: false, host: "aftereffects", message: "Select a composition layer before inserting at the selected layer." };
      }
      insertionTime = Number(selectedLayers[0].inPoint);
      for (selectedIndex = 1; selectedIndex < selectedLayers.length; selectedIndex += 1) {
        if (Number(selectedLayers[selectedIndex].inPoint) < insertionTime) {
          insertionTime = Number(selectedLayers[selectedIndex].inPoint);
        }
      }
    }

    app.beginUndoGroup("SoundDesigner: Insert Audio");
    undoOpen = true;
    footage = findFootageByPath(sourceFile);
    if (!footage) {
      importOptions = new ImportOptions(sourceFile);
      footage = app.project.importFile(importOptions) as FootageItem;
      imported = true;
    }
    if (!footage) {
      throw new Error("After Effects did not return imported footage.");
    }
    moveAllFootageToSoundDesigner(sourceFile);
    layer = composition.layers.add(footage);
    layer.startTime = insertionTime;
    return {
      ok: true,
      host: "aftereffects",
      imported: imported,
      message: (request.name || sourceFile.displayName) + (request.insertionTarget === "selected-clip" ? " added at the selected layer start." : " added at composition time."),
    };
  } catch (error) {
    return {
      ok: false,
      host: "aftereffects",
      message: error && error.toString ? error.toString() : "Unknown After Effects error.",
    };
  } finally {
    if (undoOpen) app.endUndoGroup();
  }
}
