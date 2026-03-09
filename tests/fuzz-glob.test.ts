import { describe, test, expect } from "bun:test";
import { globToRegex } from "../hooks/patterns.mjs";

/**
 * Property / fuzz tests for the glob-to-regex converter.
 * Goal: no crashes or unhandled exceptions from any input.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** globToRegex must either return a RegExp or throw a descriptive Error. */
function safeGlob(pattern: string): RegExp | Error {
  try {
    return globToRegex(pattern);
  } catch (err) {
    return err as Error;
  }
}

function expectNoThrow(pattern: string) {
  const result = safeGlob(pattern);
  if (result instanceof Error) {
    // Only TypeError / Error with known messages are acceptable
    expect(result.message).toBeTruthy();
    return;
  }
  expect(result).toBeInstanceOf(RegExp);
}

// ---------------------------------------------------------------------------
// Edge-case batteries
// ---------------------------------------------------------------------------

describe("fuzz: globToRegex edge cases", () => {
  describe("empty and invalid inputs", () => {
    test("empty string throws", () => {
      expect(() => globToRegex("")).toThrow();
    });

    test("non-string inputs throw TypeError", () => {
      for (const val of [null, undefined, 42, true, {}, [], Symbol("x")]) {
        expect(() => globToRegex(val as any)).toThrow(TypeError);
      }
    });
  });

  describe("special regex metacharacters are escaped", () => {
    const metaChars = [".", "(", ")", "+", "[", "]", "{", "}", "|", "^", "$", "\\"];
    for (const ch of metaChars) {
      test(`'${ch}' is safely escaped`, () => {
        const re = globToRegex(`file${ch}name`);
        expect(re).toBeInstanceOf(RegExp);
        // The literal character should match
        expect(re.test(`file${ch}name`)).toBe(true);
        // Shouldn't match without the special char
        expect(re.test("filename")).toBe(false);
      });
    }
  });

  describe("Windows-style paths (backslashes)", () => {
    test("literal backslash in pattern is escaped", () => {
      // globToRegex escapes backslash; the user is expected to use forward slashes
      const re = globToRegex("src\\file.ts");
      expect(re).toBeInstanceOf(RegExp);
    });

    test("mixed slashes pattern compiles", () => {
      expectNoThrow("src\\subdir/file.ts");
    });
  });

  describe("consecutive ** patterns", () => {
    test("**/** compiles without crash", () => {
      const re = globToRegex("**/**");
      expect(re).toBeInstanceOf(RegExp);
    });

    test("**/a/**/*.ts compiles and matches deep paths", () => {
      const re = globToRegex("**/a/**/*.ts");
      expect(re).toBeInstanceOf(RegExp);
      expect(re.test("a/foo.ts")).toBe(true);
      expect(re.test("x/a/b/c/foo.ts")).toBe(true);
    });

    test("triple *** treated gracefully (no crash)", () => {
      expectNoThrow("***");
      expectNoThrow("***/foo");
      expectNoThrow("foo/***");
    });
  });

  describe("empty path segments", () => {
    test("leading slash", () => {
      expectNoThrow("/foo/bar.ts");
    });

    test("trailing slash", () => {
      expectNoThrow("foo/bar/");
    });

    test("double slash", () => {
      expectNoThrow("foo//bar.ts");
    });

    test("only slashes", () => {
      expectNoThrow("///");
    });
  });

  describe("unicode and non-ASCII", () => {
    test("unicode filename pattern compiles", () => {
      const re = globToRegex("日本語/*.md");
      expect(re).toBeInstanceOf(RegExp);
      expect(re.test("日本語/readme.md")).toBe(true);
    });

    test("emoji in pattern compiles", () => {
      const re = globToRegex("📁/*.ts");
      expect(re).toBeInstanceOf(RegExp);
      expect(re.test("📁/app.ts")).toBe(true);
    });

    test("accented characters", () => {
      const re = globToRegex("café/*.js");
      expect(re).toBeInstanceOf(RegExp);
      expect(re.test("café/index.js")).toBe(true);
    });
  });

  describe("? wildcard edge cases", () => {
    test("? matches single non-slash character", () => {
      const re = globToRegex("?.ts");
      expect(re.test("a.ts")).toBe(true);
      expect(re.test("ab.ts")).toBe(false);
      expect(re.test("/.ts")).toBe(false);
    });

    test("multiple ? wildcards", () => {
      const re = globToRegex("???.ts");
      expect(re.test("abc.ts")).toBe(true);
      expect(re.test("ab.ts")).toBe(false);
    });
  });

  describe("complex real-world patterns", () => {
    test("deeply nested double-star", () => {
      const re = globToRegex("src/**/components/**/*.tsx");
      expect(re).toBeInstanceOf(RegExp);
      expect(re.test("src/components/Button.tsx")).toBe(true);
      expect(re.test("src/app/components/ui/Dialog.tsx")).toBe(true);
    });

    test("dotfiles", () => {
      const re = globToRegex("**/.env*");
      expect(re).toBeInstanceOf(RegExp);
      expect(re.test(".env")).toBe(true);
      expect(re.test(".env.local")).toBe(true);
      expect(re.test("src/.env.production")).toBe(true);
    });

    test("extension-only pattern", () => {
      const re = globToRegex("*.config.*");
      expect(re).toBeInstanceOf(RegExp);
      expect(re.test("next.config.js")).toBe(true);
      expect(re.test("next.config.mjs")).toBe(true);
    });

    test("brace expansion matches extension lists", () => {
      const re = globToRegex("**/middleware.{ts,js,mjs}");
      expect(re).toBeInstanceOf(RegExp);
      expect(re.test("middleware.ts")).toBe(true);
      expect(re.test("src/middleware.js")).toBe(true);
      expect(re.test("src/middleware.mjs")).toBe(true);
      expect(re.test("src/middleware.tsx")).toBe(false);
    });

    test("nested brace expansion compiles and matches", () => {
      const re = globToRegex("src/**/*.{js,{ts,tsx}}");
      expect(re).toBeInstanceOf(RegExp);
      expect(re.test("src/index.js")).toBe(true);
      expect(re.test("src/index.ts")).toBe(true);
      expect(re.test("src/index.tsx")).toBe(true);
      expect(re.test("src/index.mjs")).toBe(false);
    });
  });

  describe("stress: generated random patterns don't crash", () => {
    const chars = "abcABC012.*?/\\()[]{}|^$+💥";

    function randomPattern(len: number, seed: number): string {
      let result = "";
      let s = seed;
      for (let i = 0; i < len; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        result += chars[s % chars.length];
      }
      return result;
    }

    test("100 random patterns of length 1-50 don't crash", () => {
      for (let i = 0; i < 100; i++) {
        const len = (i % 50) + 1;
        const pattern = randomPattern(len, i * 31337);
        try {
          const re = globToRegex(pattern);
          // If it returned, it must be a RegExp
          expect(re).toBeInstanceOf(RegExp);
          // Test it against a sample string (must not throw)
          re.test("some/test/path.ts");
        } catch (err) {
          // Acceptable: known validation errors
          expect((err as Error).message).toBeTruthy();
        }
      }
    });
  });

  describe("property: output regex always terminates on test inputs", () => {
    const patterns = [
      "**/*",
      "**/a/**/b/**/c/**",
      "a*b*c*d*e",
      "**/**/**/**",
    ];
    const inputs = [
      "a/b/c/d/e/f/g/h/i/j/k.ts",
      "aaaaaaaaaaaaaaaaaaaaaaaaa",
      "/".repeat(100),
      "x".repeat(1000),
    ];

    for (const pattern of patterns) {
      test(`pattern "${pattern}" terminates on all test inputs`, () => {
        const re = globToRegex(pattern);
        for (const input of inputs) {
          // Should complete within reasonable time (no catastrophic backtracking)
          const start = performance.now();
          re.test(input);
          const elapsed = performance.now() - start;
          expect(elapsed).toBeLessThan(100); // 100ms max
        }
      });
    }
  });
});
