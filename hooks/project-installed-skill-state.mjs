// hooks/src/project-installed-skill-state.mts
import {
  buildSkillCacheStatus
} from "./skill-cache-banner.mjs";
import {
  readProjectSkillState
} from "./project-skill-manifest.mjs";
import {
  createSkillStore
} from "./skill-store.mjs";
function uniqueSorted(values) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
function loadProjectInstalledSkillState(args) {
  const skillStore = createSkillStore({
    projectRoot: args.projectRoot,
    pluginRoot: args.pluginRoot,
    bundledFallback: args.bundledFallbackEnabled
  });
  const projectState = readProjectSkillState(args.projectRoot);
  const installedSkills = uniqueSorted([
    ...skillStore.listInstalledSkills(args.logger),
    ...projectState.installedSlugs
  ]);
  const cacheStatus = buildSkillCacheStatus({
    likelySkills: args.likelySkills,
    installedSkills,
    bundledFallbackEnabled: args.bundledFallbackEnabled
  });
  return { skillStore, installedSkills, projectState, cacheStatus };
}
export {
  loadProjectInstalledSkillState
};
