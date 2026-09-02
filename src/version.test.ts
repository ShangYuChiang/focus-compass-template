import { describe, expect, it } from "vitest";
import packageManifest from "../package.json";
import packageLock from "../package-lock.json";
import tauriConfig from "../src-tauri/tauri.conf.json";
import cargoManifest from "../src-tauri/Cargo.toml?raw";
import cargoLock from "../src-tauri/Cargo.lock?raw";
import html from "../index.html?raw";
import { APP_VERSION_LABEL } from "./version";

describe("fixed public template version", () => {
  it("uses V0.1 as the public version label", () => {
    expect(APP_VERSION_LABEL).toBe("V0.1");
    expect(APP_VERSION_LABEL).toBe(`V${packageManifest.version.split(".").slice(0, 2).join(".")}`);
  });

  it("keeps the JavaScript and Tauri package versions at 0.1.0", () => {
    for (const version of [packageManifest.version, packageLock.version, packageLock.packages[""].version, tauriConfig.version]) {
      expect(version).toBe("0.1.0");
    }
  });

  it("keeps the Rust package and its lock entry at 0.1.0", () => {
    const packageSection = cargoManifest.split("[package]")[1]?.split(/\r?\n\[/)[0];
    const lockEntry = cargoLock.split("[[package]]").find((entry) => /^name = "focus-compass-template"\r?$/m.test(entry));
    expect(packageSection).toMatch(/^version = "0\.1\.0"\r?$/m);
    expect(lockEntry).toMatch(/^version = "0\.1\.0"\r?$/m);
  });

  it("shows the same public version in browser and desktop titles", () => {
    const title = `步步 Template ${APP_VERSION_LABEL}｜個人工作推進系統`;
    expect(tauriConfig.app.windows[0].title).toBe(title);
    expect(html).toContain(`<title>${title}</title>`);
  });
});
