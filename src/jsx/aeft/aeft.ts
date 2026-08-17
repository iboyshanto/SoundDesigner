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
};

type HostResult = {
  ok: boolean;
  message: string;
  host: string;
  imported?: boolean;
};

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
    layer = composition.layers.add(footage);
    layer.startTime = composition.time;
    return {
      ok: true,
      host: "aftereffects",
      imported: imported,
      message: (request.name || sourceFile.displayName) + " added at composition time.",
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
