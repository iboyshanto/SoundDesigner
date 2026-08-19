import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { platform } from "node:os";
import { spawnSync } from "node:child_process";
import { promptHidden } from "./signing-utils.mjs";
const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));

const version = String(packageJson.version || "");
const expectedTag = `v${version}`;
if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== expectedTag) {
  throw new Error(`Git tag ${process.env.GITHUB_REF_NAME} does not match package version ${expectedTag}.`);
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`package.json version must be semantic x.y.z; received "${version}".`);
}

const extensionDir = resolve("dist/cep");
const manifestPath = join(extensionDir, "CSXS/manifest.xml");
if (!existsSync(manifestPath)) throw new Error("Build output is missing. Run bun run build first.");
const manifest = readFileSync(manifestPath, "utf8");
if (!manifest.includes(`ExtensionBundleVersion="${version}"`)) {
  throw new Error(`Manifest version does not match package.json ${version}.`);
}

const localCertificate = resolve(".signing/SoundDesigner-publisher.p12");
const certPath = process.env.SOUNDDESIGNER_ZXP_CERT || (existsSync(localCertificate) ? localCertificate : "");
let password = process.env.SOUNDDESIGNER_ZXP_PASSWORD || "";
if (!certPath) throw new Error("Publisher certificate is missing. Run bun run certificate:create once before packaging.");
const certificate = resolve(certPath);
if (!existsSync(certificate)) throw new Error(`Publisher certificate was not found: ${certificate}`);
if (!password) {
  if (process.env.CI) throw new Error("SOUNDDESIGNER_ZXP_PASSWORD is not configured for this CI release.");
  password = await promptHidden("Publisher certificate password: ");
}
if (!password) throw new Error("Publisher certificate password is required.");

const debugPath = join(extensionDir, ".debug");
if (existsSync(debugPath)) unlinkSync(debugPath);

const findSourceMaps = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return findSourceMaps(entryPath);
    return entry.name.endsWith(".map") ? [entryPath] : [];
  });
const sourceMaps = findSourceMaps(extensionDir);
if (sourceMaps.length > 0) {
  throw new Error(`Release payload contains source maps: ${sourceMaps.join(", ")}`);
}

const signer = resolve("node_modules/vite-cep-plugin/lib/bin", platform() === "win32" ? "ZXPSignCmd.exe" : "ZXPSignCmd");
if (!existsSync(signer)) throw new Error(`ZXPSignCmd was not found: ${signer}`);
if (platform() !== "win32") chmodSync(signer, 0o755);

const output = resolve(`release/SoundDesigner-v${version}.zxp`);
mkdirSync(dirname(output), { recursive: true });
const timestampServers = process.env.SOUNDDESIGNER_TSA_URL
  ? [process.env.SOUNDDESIGNER_TSA_URL]
  : ["http://timestamp.digicert.com/", "http://timestamp.apple.com/ts01"];
let signed = false;
let lastExitCode = -1;
for (const timestampServer of timestampServers) {
  if (existsSync(output)) unlinkSync(output);
  const result = spawnSync(
    signer,
    ["-sign", extensionDir, output, certificate, password, "-tsa", timestampServer],
    { stdio: "inherit", windowsHide: true },
  );
  if (result.error) throw result.error;
  lastExitCode = result.status ?? -1;
  if (lastExitCode === 0 && existsSync(output)) {
    signed = true;
    break;
  }
  console.warn(`Timestamp signing failed with ${timestampServer}; trying the next configured server.`);
}
if (!signed) {
  if (existsSync(output)) unlinkSync(output);
  throw new Error(`ZXPSignCmd failed with exit code ${lastExitCode}.`);
}

const digest = createHash("sha256").update(readFileSync(output)).digest("hex");
writeFileSync(`${output}.sha256`, `${digest}  SoundDesigner-v${version}.zxp\n`, "utf8");
console.log(`Release package: ${output}`);
console.log(`SHA-256: ${digest}`);
