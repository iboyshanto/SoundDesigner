import { chmodSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { platform } from "node:os";
import { spawnSync } from "node:child_process";
import { promptHidden } from "./signing-utils.mjs";

const certificate = resolve(".signing/SoundDesigner-publisher.p12");
if (existsSync(certificate)) {
  console.log(`Publisher certificate already exists: ${certificate}`);
  console.log("No certificate was replaced. Run bun run release:package to build a release.");
  process.exit(0);
}

const signer = resolve("node_modules/vite-cep-plugin/lib/bin", platform() === "win32" ? "ZXPSignCmd.exe" : "ZXPSignCmd");
if (!existsSync(signer)) throw new Error("ZXPSignCmd is missing. Run bun install before creating the certificate.");
if (platform() !== "win32") chmodSync(signer, 0o755);

let password = "";
while (!password) {
  const first = await promptHidden("Create publisher password (minimum 12 characters): ");
  if (first.length < 12) {
    console.error("The password must contain at least 12 characters.");
    continue;
  }
  const second = await promptHidden("Confirm publisher password: ");
  if (first !== second) {
    console.error("The passwords did not match. Try again.");
    continue;
  }
  password = first;
}

mkdirSync(dirname(certificate), { recursive: true });
const temporaryCertificate = resolve(`.signing/SoundDesigner-publisher.tmp-${process.pid}.p12`);
try {
  const result = spawnSync(signer, [
    "-selfSignedCert",
    "BD",
    "Dhaka",
    "SoundDesigner",
    "SoundDesigner Publisher",
    password,
    temporaryCertificate,
  ], { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0 || !existsSync(temporaryCertificate) || statSync(temporaryCertificate).size === 0) {
    throw new Error(`Certificate creation failed with exit code ${result.status}.`);
  }
  renameSync(temporaryCertificate, certificate);
  if (platform() !== "win32") chmodSync(certificate, 0o600);
} catch (error) {
  if (existsSync(temporaryCertificate)) unlinkSync(temporaryCertificate);
  throw error;
}

console.log(`Publisher certificate created: ${certificate}`);
console.log("Back up this file and remember its password. Neither is stored in Git.");
console.log("Create a release with: bun run release:package");
