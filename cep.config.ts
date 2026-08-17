import type { CEP_Config } from "vite-cep-plugin";
import { version } from "./package.json";

const config: CEP_Config = {
  version,
  id: "com.rksound.designer",
  displayName: "SoundDesigner",
  symlink: "local",
  port: 3000,
  servePort: 5000,
  startingDebugPort: 8860,
  extensionManifestVersion: 6.0,
  requiredRuntimeVersion: 9.0,
  hosts: [
    { name: "AEFT", version: "[0.0,99.9]" },
    { name: "PPRO", version: "[0.0,99.9]" },
  ],

  type: "Panel",
  iconDarkNormal: "./src/assets/light-icon.png",
  iconNormal: "./src/assets/dark-icon.png",
  iconDarkNormalRollOver: "./src/assets/light-icon.png",
  iconNormalRollOver: "./src/assets/dark-icon.png",
  parameters: ["--v=0", "--enable-nodejs", "--mixed-context"],
  width: 500,
  height: 550,

  panels: [
    {
      mainPath: "./main/index.html",
      name: "main",
      panelDisplayName: "SoundDesigner",
      autoVisible: true,
      width: 600,
      height: 650,
    },
  ],
  build: {
    jsxBin: "off",
    sourceMap: true,
  },
  zxp: {
    country: "US",
    province: "CA",
    org: "Company",
    // Development-only self-signed packages. Public releases use scripts/package-release.mjs.
    password: process.env.SOUNDDESIGNER_DEV_ZXP_PASSWORD || "development-only",
    tsa: [
      "http://timestamp.digicert.com/", // Windows Only
      "http://timestamp.apple.com/ts01", // MacOS Only
    ],
    allowSkipTSA: false,
    sourceMap: false,
    jsxBin: "off",
  },
  installModules: [],
  copyAssets: [],
  copyZipAssets: [],
};
export default config;
