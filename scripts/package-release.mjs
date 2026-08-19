import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { platform } from "node:os";
import { spawnSync } from "node:child_process";
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

const certPath = process.env.SOUNDDESIGNER_ZXP_CERT;
const password = process.env.SOUNDDESIGNER_ZXP_PASSWORD;
const tsa = process.env.SOUNDDESIGNER_TSA_URL || "http://timestamp.digicert.com";
if (!certPath || !password) {
  throw new Error("Set SOUNDDESIGNER_ZXP_CERT and SOUNDDESIGNER_ZXP_PASSWORD to the persistent publisher certificate before packaging.");
}
const certificate = resolve(certPath);
if (!existsSync(certificate)) throw new Error(`Publisher certificate was not found: ${certificate}`);

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
const result = spawnSync(signer, ["-sign", extensionDir, output, certificate, password, "-tsa", tsa], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0 || !existsSync(output)) throw new Error(`ZXPSignCmd failed with exit code ${result.status}.`);

const digest = createHash("sha256").update(readFileSync(output)).digest("hex");
writeFileSync(`${output}.sha256`, `${digest}  SoundDesigner-v${version}.zxp\n`, "utf8");
console.log(`Release package: ${output}`);
console.log(`SHA-256: ${digest}`);
