/**
 * Bun test preload: creates a mock skill cache before any tests run
 * and sets VERCEL_PLUGIN_HOME_DIR so all subprocess hook invocations
 * resolve skills from the mock cache.
 *
 * Cleanup happens via process exit handler.
 */
import { createMockSkillCache } from "./mock-skill-cache.ts";

const cache = createMockSkillCache();
process.env.VERCEL_PLUGIN_HOME_DIR = cache.homeDir;

process.on("exit", () => {
  try { cache.cleanup(); } catch {}
});
