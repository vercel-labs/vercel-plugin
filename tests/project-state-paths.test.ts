import { describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ensureProjectStateRoot,
  hashProjectRoot,
  resolveProjectStatePaths,
  resolveVercelPluginHome,
} from "../hooks/src/project-state-paths.mts";

describe("project-state-paths", () => {
  test("maps a project root into the hashed state root", () => {
    const homeDir = join(tmpdir(), "vp-home");
    const projectRoot = join(tmpdir(), "vp-project", "repo");
    const paths = resolveProjectStatePaths(projectRoot, homeDir);

    expect(resolveVercelPluginHome(homeDir)).toBe(
      join(homeDir, ".vercel-plugin"),
    );
    expect(paths.normalizedProjectRoot).toBe(projectRoot);
    expect(paths.projectHash).toBe(hashProjectRoot(projectRoot));
    expect(paths.projectHash).toHaveLength(16);
    expect(paths.stateRoot).toBe(
      join(homeDir, ".vercel-plugin", "projects", paths.projectHash),
    );
    expect(paths.skillsDir).toBe(join(paths.stateRoot, ".skills"));
    expect(paths.manifestPath).toBe(join(paths.skillsDir, "manifest.json"));
    expect(paths.lockfilePath).toBe(join(paths.stateRoot, "skills-lock.json"));
    expect(paths.installPlanPath).toBe(
      join(paths.skillsDir, "install-plan.json"),
    );
    expect(paths.legacyProjectSkillsDir).toBe(join(projectRoot, ".skills"));
    expect(paths.legacyProjectInstallPlanPath).toBe(
      join(projectRoot, ".skills", "install-plan.json"),
    );
  });

  test("ensureProjectStateRoot creates the hashed cache directories", () => {
    const homeDir = join(
      tmpdir(),
      `vp-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const projectRoot = join(tmpdir(), "vp-project-state-root", "repo");
    const paths = resolveProjectStatePaths(projectRoot, homeDir);

    try {
      expect(existsSync(paths.skillsDir)).toBe(false);
      const ensured = ensureProjectStateRoot(paths);
      expect(ensured).toBe(paths);
      expect(existsSync(paths.skillsDir)).toBe(true);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
