import { describe, test, expect } from "bun:test";
import { globToRegex } from "../hooks/patterns.mjs";

describe("globToRegex", () => {
  describe("* wildcard (single segment)", () => {
    test("*.ts matches .ts files", () => {
      const re = globToRegex("*.ts");
      expect(re.test("index.ts")).toBe(true);
      expect(re.test("foo.ts")).toBe(true);
      expect(re.test("foo.tsx")).toBe(false);
      expect(re.test("foo.js")).toBe(false);
    });

    test("*.tsx matches .tsx files", () => {
      const re = globToRegex("*.tsx");
      expect(re.test("App.tsx")).toBe(true);
      expect(re.test("index.tsx")).toBe(true);
      expect(re.test("App.ts")).toBe(false);
    });

    test("* does not match across slashes", () => {
      const re = globToRegex("*.ts");
      expect(re.test("src/foo.ts")).toBe(false);
    });
  });

  describe("** wildcard (multi-segment)", () => {
    test("**/*.ts matches nested .ts files", () => {
      const re = globToRegex("**/*.ts");
      expect(re.test("foo.ts")).toBe(true);
      expect(re.test("src/foo.ts")).toBe(true);
      expect(re.test("src/deep/foo.ts")).toBe(true);
      expect(re.test("src/foo.js")).toBe(false);
    });

    test("**/*.tsx matches nested .tsx files", () => {
      const re = globToRegex("**/*.tsx");
      expect(re.test("components/App.tsx")).toBe(true);
      expect(re.test("App.tsx")).toBe(true);
    });

    test("src/**/*.ts matches under src/", () => {
      const re = globToRegex("src/**/*.ts");
      expect(re.test("src/index.ts")).toBe(true);
      expect(re.test("src/lib/utils.ts")).toBe(true);
      expect(re.test("lib/utils.ts")).toBe(false);
    });

    test("trailing ** matches everything after prefix", () => {
      const re = globToRegex("src/**");
      expect(re.test("src/anything")).toBe(true);
      expect(re.test("src/deep/nested/file.ts")).toBe(true);
      expect(re.test("other/file.ts")).toBe(false);
    });
  });

  describe("? wildcard", () => {
    test("?.ts matches single-char filenames", () => {
      const re = globToRegex("?.ts");
      expect(re.test("a.ts")).toBe(true);
      expect(re.test("ab.ts")).toBe(false);
    });

    test("? does not match slash", () => {
      const re = globToRegex("?.ts");
      expect(re.test("/.ts")).toBe(false);
    });
  });

  describe("brace expansion", () => {
    test("**/middleware.{ts,js,mjs} matches extension alternatives", () => {
      const re = globToRegex("**/middleware.{ts,js,mjs}");
      expect(re.test("middleware.ts")).toBe(true);
      expect(re.test("src/middleware.js")).toBe(true);
      expect(re.test("src/lib/middleware.mjs")).toBe(true);
      expect(re.test("src/lib/middleware.tsx")).toBe(false);
      expect(re.test("middleware.{ts,js,mjs}")).toBe(false);
    });

    test("**/*.{ts,tsx} matches ts and tsx files", () => {
      const re = globToRegex("**/*.{ts,tsx}");
      expect(re.test("src/index.ts")).toBe(true);
      expect(re.test("src/app/page.tsx")).toBe(true);
      expect(re.test("src/app/page.jsx")).toBe(false);
    });

    test("nested brace alternatives expand recursively", () => {
      const re = globToRegex("**/*.{js,{ts,tsx}}");
      expect(re.test("src/index.js")).toBe(true);
      expect(re.test("src/index.ts")).toBe(true);
      expect(re.test("src/index.tsx")).toBe(true);
      expect(re.test("src/index.mjs")).toBe(false);
    });

    test("braces without alternatives stay literal", () => {
      const re = globToRegex("file{1}.txt");
      expect(re.test("file{1}.txt")).toBe(true);
      expect(re.test("file1.txt")).toBe(false);
    });
  });

  describe("exact filenames", () => {
    test("matches exact filename", () => {
      const re = globToRegex("vercel.json");
      expect(re.test("vercel.json")).toBe(true);
      expect(re.test("not-vercel.json")).toBe(false);
      expect(re.test("vercel.json.bak")).toBe(false);
    });

    test("matches exact path", () => {
      const re = globToRegex("src/index.ts");
      expect(re.test("src/index.ts")).toBe(true);
      expect(re.test("lib/index.ts")).toBe(false);
    });
  });

  describe("dot files", () => {
    test("*.env matches dotless env files", () => {
      const re = globToRegex("*.env");
      expect(re.test("production.env")).toBe(true);
    });

    test(".env exact match", () => {
      const re = globToRegex(".env");
      expect(re.test(".env")).toBe(true);
      expect(re.test("foo.env")).toBe(false);
    });

    test("**/.env* matches nested dot-env files", () => {
      const re = globToRegex("**/.env*");
      expect(re.test(".envrc")).toBe(true);
      expect(re.test(".env.local")).toBe(true);
      expect(re.test("config/.env.production")).toBe(true);
    });
  });

  describe("input validation", () => {
    test("throws TypeError on non-string input (number)", () => {
      expect(() => globToRegex(42 as any)).toThrow(TypeError);
    });

    test("throws TypeError on non-string input (null)", () => {
      expect(() => globToRegex(null as any)).toThrow(TypeError);
    });

    test("throws TypeError on non-string input (undefined)", () => {
      expect(() => globToRegex(undefined as any)).toThrow(TypeError);
    });

    test("throws on empty string", () => {
      expect(() => globToRegex("")).toThrow("must not be empty");
    });
  });

  describe("known-invalid inputs throw (consumed by hook try-catch)", () => {
    test("throws on non-string input (object)", () => {
      expect(() => globToRegex({} as any)).toThrow(TypeError);
    });

    test("throws on non-string input (array)", () => {
      expect(() => globToRegex([] as any)).toThrow(TypeError);
    });
  });

  describe("special regex characters are escaped", () => {
    test("parens and brackets are escaped", () => {
      const re = globToRegex("file(1).txt");
      expect(re.test("file(1).txt")).toBe(true);
      expect(re.test("file1.txt")).toBe(false);
    });

    test("plus sign is escaped", () => {
      const re = globToRegex("c++.cpp");
      expect(re.test("c++.cpp")).toBe(true);
    });
  });
});
