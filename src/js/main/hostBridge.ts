import { csi, evalTS } from "../lib/utils/bolt";
import type { HostApp, HostResult, InsertAudioRequest } from "./types";

export type AfterEffectsAudioDragState = {
  ok: boolean;
  host: string;
  compositionId?: number;
  layerCount: number;
  message: string;
};

export const detectHost = (): HostApp => {
  if (!window.cep) return "browser";
  const applicationId = String(csi.getApplicationID() || "").toUpperCase();
  if (applicationId.indexOf("PPRO") > -1) return "premiere";
  if (applicationId.indexOf("AEFT") > -1) return "aftereffects";
  return "unknown";
};

export const insertAudioInHost = async (request: InsertAudioRequest): Promise<HostResult> => {
  if (!request.path) {
    return { ok: false, message: "Demo sounds cannot be inserted. Add a real library folder first." };
  }
  if (!window.cep) {
    return { ok: true, host: "browser", message: "Insert simulated in browser preview." };
  }

  try {
    // evalTS JSON-stringifies every argument and JSON-parses the ExtendScript result.
    return await evalTS("insertAudioClip", request) as HostResult;
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error || "The host did not return a valid response.");
    return { ok: false, message };
  }
};

export const organizeAudioInHost = async (request: InsertAudioRequest): Promise<HostResult> => {
  if (!request.path || !window.cep) {
    return { ok: false, host: "browser", message: "Host media organization is unavailable." };
  }
  try {
    return await evalTS("organizeAudioMedia", request) as HostResult;
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error || "The host did not return a valid response.");
    return { ok: false, message };
  }
};

export const getAfterEffectsAudioDragState = async (request: InsertAudioRequest): Promise<AfterEffectsAudioDragState> => {
  if (!window.cep || detectHost() !== "aftereffects") {
    return { ok: false, host: "browser", layerCount: 0, message: "After Effects is not the active CEP host." };
  }
  try {
    return await evalTS("getAudioDragState", request) as AfterEffectsAudioDragState;
  } catch (error) {
    return {
      ok: false,
      host: "aftereffects",
      layerCount: 0,
      message: error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error || "The active composition could not be inspected."),
    };
  }
};
