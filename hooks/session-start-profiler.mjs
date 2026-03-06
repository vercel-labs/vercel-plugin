/**
 * Session-start repo profiler hook.
 *
 * Scans the current working directory for common config files and package
 * dependencies, then writes likely skill slugs into VERCEL_PLUGIN_LIKELY_SKILLS
 * in CLAUDE_ENV_FILE. This pre-primes the skill matcher so the first tool call
 * can skip cold-scanning for obvious frameworks.
 *
 * Exits silently (code 0) if CLAUDE_ENV_FILE is not set or the project root
 * cannot be determined.
 */
import { existsSync, readFileSync, appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/**
 * Mapping from marker file / condition to skill slugs.
 */
const FILE_MARKERS = [
    { file: "next.config.js", skills: ["nextjs", "turbopack"] },
    { file: "next.config.mjs", skills: ["nextjs", "turbopack"] },
    { file: "next.config.ts", skills: ["nextjs", "turbopack"] },
    { file: "next.config.mts", skills: ["nextjs", "turbopack"] },
    { file: "turbo.json", skills: ["turborepo"] },
    { file: "vercel.json", skills: ["vercel-cli", "deployments-cicd", "vercel-functions"] },
    { file: ".mcp.json", skills: ["vercel-api"] },
    { file: "middleware.ts", skills: ["routing-middleware"] },
    { file: "middleware.js", skills: ["routing-middleware"] },
    { file: "components.json", skills: ["shadcn"] },
    { file: ".env.local", skills: ["env-vars"] },
];
/**
 * Dependency names in package.json -> skill slugs.
 */
const PACKAGE_MARKERS = {
    "next": ["nextjs"],
    "ai": ["ai-sdk"],
    "@ai-sdk/openai": ["ai-sdk"],
    "@ai-sdk/anthropic": ["ai-sdk"],
    "@ai-sdk/gateway": ["ai-sdk", "ai-gateway"],
    "@vercel/blob": ["vercel-storage"],
    "@vercel/kv": ["vercel-storage"],
    "@vercel/postgres": ["vercel-storage"],
    "@vercel/edge-config": ["vercel-storage"],
    "@vercel/analytics": ["observability"],
    "@vercel/speed-insights": ["observability"],
    "@vercel/flags": ["vercel-flags"],
    "@vercel/workflow": ["workflow"],
    "@vercel/queue": ["vercel-queues"],
    "@vercel/sandbox": ["vercel-sandbox"],
    "@vercel/sdk": ["vercel-api"],
    "turbo": ["turborepo"],
};
const SETUP_ENV_TEMPLATE_FILES = [
    ".env.example",
    ".env.sample",
    ".env.template",
];
const SETUP_DB_SCRIPT_MARKERS = [
    "db:push",
    "db:seed",
    "db:migrate",
    "db:generate",
];
const SETUP_AUTH_DEPENDENCIES = new Set([
    "next-auth",
    "@auth/core",
    "better-auth",
]);
const SETUP_RESOURCE_DEPENDENCIES = {
    "@neondatabase/serverless": "postgres",
    "drizzle-orm": "postgres",
    "@upstash/redis": "redis",
    "@vercel/blob": "blob",
    "@vercel/edge-config": "edge-config",
};
const SETUP_MODE_THRESHOLD = 3;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Safely parse package.json from project root.
 */
function readPackageJson(projectRoot) {
    const pkgPath = join(projectRoot, "package.json");
    if (!existsSync(pkgPath))
        return null;
    try {
        return JSON.parse(readFileSync(pkgPath, "utf-8"));
    }
    catch {
        return null;
    }
}
// ---------------------------------------------------------------------------
// Exported profilers
// ---------------------------------------------------------------------------
/**
 * Scan a project root and return a deduplicated, sorted list of likely skill slugs.
 */
export function profileProject(projectRoot) {
    const skills = new Set();
    // 1. Check marker files
    for (const marker of FILE_MARKERS) {
        if (existsSync(join(projectRoot, marker.file))) {
            for (const s of marker.skills)
                skills.add(s);
        }
    }
    // 2. Check package.json dependencies
    const pkg = readPackageJson(projectRoot);
    if (pkg) {
        const allDeps = {
            ...(pkg.dependencies || {}),
            ...(pkg.devDependencies || {}),
        };
        for (const [dep, skillSlugs] of Object.entries(PACKAGE_MARKERS)) {
            if (dep in allDeps) {
                for (const s of skillSlugs)
                    skills.add(s);
            }
        }
    }
    // 3. Check vercel.json keys for more specific skills
    const vercelJsonPath = join(projectRoot, "vercel.json");
    if (existsSync(vercelJsonPath)) {
        try {
            const vercelConfig = JSON.parse(readFileSync(vercelJsonPath, "utf-8"));
            if (vercelConfig.crons)
                skills.add("cron-jobs");
            if (vercelConfig.rewrites || vercelConfig.redirects || vercelConfig.headers) {
                skills.add("routing-middleware");
            }
            if (vercelConfig.functions)
                skills.add("vercel-functions");
        }
        catch {
            // Malformed vercel.json — skip silently
        }
    }
    return [...skills].sort();
}
/**
 * Detect bootstrap/setup signals and infer likely resource categories.
 */
export function profileBootstrapSignals(projectRoot) {
    const bootstrapHints = new Set();
    const resourceHints = new Set();
    // Env template signals
    if (SETUP_ENV_TEMPLATE_FILES.some((file) => existsSync(join(projectRoot, file)))) {
        bootstrapHints.add("env-example");
    }
    // README* signal
    try {
        const dirents = readdirSync(projectRoot, { withFileTypes: true });
        if (dirents.some((d) => d.isFile() && d.name.toLowerCase().startsWith("readme"))) {
            bootstrapHints.add("readme");
        }
        if (dirents.some((d) => d.isFile() && /^drizzle\.config\./i.test(d.name))) {
            bootstrapHints.add("drizzle-config");
            bootstrapHints.add("postgres");
            resourceHints.add("postgres");
        }
    }
    catch {
        // Ignore unreadable project roots
    }
    // Prisma schema signal
    if (existsSync(join(projectRoot, "prisma", "schema.prisma"))) {
        bootstrapHints.add("prisma-schema");
        bootstrapHints.add("postgres");
        resourceHints.add("postgres");
    }
    // package.json scripts + dependencies signals
    const pkg = readPackageJson(projectRoot);
    if (pkg) {
        const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
        const scriptEntries = Object.entries(scripts)
            .map(([name, cmd]) => `${name} ${typeof cmd === "string" ? cmd : ""}`)
            .join("\n");
        for (const marker of SETUP_DB_SCRIPT_MARKERS) {
            if (scriptEntries.includes(marker)) {
                bootstrapHints.add(marker.replace(":", "-"));
            }
        }
        const allDeps = {
            ...(pkg.dependencies || {}),
            ...(pkg.devDependencies || {}),
        };
        for (const dep of Object.keys(allDeps)) {
            const resource = SETUP_RESOURCE_DEPENDENCIES[dep];
            if (resource) {
                bootstrapHints.add(resource);
                resourceHints.add(resource);
            }
            if (SETUP_AUTH_DEPENDENCIES.has(dep)) {
                bootstrapHints.add("auth-secret");
            }
        }
    }
    const hints = [...bootstrapHints].sort();
    const resources = [...resourceHints].sort();
    return {
        bootstrapHints: hints,
        resourceHints: resources,
        setupMode: hints.length >= SETUP_MODE_THRESHOLD,
    };
}
/**
 * Check if a project root is "greenfield" — only dot-directories and no real
 * source files.  Returns the list of top-level entries if greenfield, or null.
 */
export function checkGreenfield(projectRoot) {
    let dirents;
    try {
        dirents = readdirSync(projectRoot, { withFileTypes: true });
    }
    catch {
        return null;
    }
    // Greenfield if every entry is a dot-directory (e.g. .git, .claude) and
    // there are no files at all (dot-files like .mcp.json or .env.local
    // indicate real project config).
    const hasNonDotDir = dirents.some((d) => !d.name.startsWith("."));
    const hasDotFile = dirents.some((d) => d.name.startsWith(".") && d.isFile());
    if (!hasNonDotDir && !hasDotFile) {
        return { entries: dirents.map((d) => d.name).sort() };
    }
    return null;
}
// ---------------------------------------------------------------------------
// Main entry point — profile the project and write env vars.
// ---------------------------------------------------------------------------
function main() {
    const envFile = process.env.CLAUDE_ENV_FILE;
    if (!envFile) {
        process.exit(0);
    }
    // Use CLAUDE_PROJECT_ROOT if available, otherwise cwd
    const projectRoot = process.env.CLAUDE_PROJECT_ROOT || process.cwd();
    // Greenfield check — if the project only has dot-directories, skip profiling
    // and inject a short context hint instead.
    const greenfield = checkGreenfield(projectRoot);
    if (greenfield) {
        try {
            appendFileSync(envFile, `export VERCEL_PLUGIN_GREENFIELD="true"\n`);
        }
        catch {
            // ignore
        }
        const dirs = greenfield.entries.map((e) => `  ${e}/`).join("\n");
        process.stdout.write(`This is a greenfield project with only these directories:\n${dirs}\nSkip codebase exploration — there is no existing code to discover.\n`);
        process.exit(0);
    }
    const likelySkills = profileProject(projectRoot);
    const setupSignals = profileBootstrapSignals(projectRoot);
    try {
        if (likelySkills.length > 0) {
            appendFileSync(envFile, `export VERCEL_PLUGIN_LIKELY_SKILLS="${likelySkills.join(",")}"\n`);
        }
        if (setupSignals.bootstrapHints.length > 0) {
            appendFileSync(envFile, `export VERCEL_PLUGIN_BOOTSTRAP_HINTS="${setupSignals.bootstrapHints.join(",")}"\n`);
        }
        if (setupSignals.resourceHints.length > 0) {
            appendFileSync(envFile, `export VERCEL_PLUGIN_RESOURCE_HINTS="${setupSignals.resourceHints.join(",")}"\n`);
        }
        if (setupSignals.setupMode) {
            appendFileSync(envFile, "export VERCEL_PLUGIN_SETUP_MODE=\"1\"\n");
        }
    }
    catch {
        // Cannot write env file — exit silently
    }
    process.exit(0);
}
main();
