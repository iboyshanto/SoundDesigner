import { csi, evalTS } from "../lib/utils/bolt";
import type { HostApp, HostResult, InsertAudioRequest } from "./types";

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
