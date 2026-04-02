---
name: agent-browser-verify
priority: 2
docs: https://docs.anthropic.com/en/docs/claude-code/sub-agents
bashPatterns:
  - "\\bnext\\s+dev\\b"
  - "\\bnpm\\s+run\\s+dev\\b"
  - "\\bpnpm\\s+dev\\b"
  - "\\bbun\\s+run\\s+dev\\b"
  - "\\byarn\\s+dev\\b"
  - "\\bvite\\s*(dev)?\\b"
  - "\\bnuxt\\s+dev\\b"
  - "\\bvercel\\s+dev\\b"
promptSignals:
  phrases:
    - "check the page"
    - "check the browser"
    - "check the site"
    - "is the page working"
    - "is it loading"
    - "blank page"
    - "white screen"
    - "nothing showing"
    - "page is broken"
    - "screenshot the page"
    - "take a screenshot"
    - "check for errors"
    - "console errors"
    - "browser errors"
    - "page is stuck"
    - "page is hanging"
    - "page not loading"
    - "page frozen"
    - "spinner not stopping"
    - "page not responding"
    - "page won't load"
    - "page will not load"
    - "nothing renders"
    - "nothing rendered"
    - "ui is broken"
    - "screen is blank"
    - "screen is white"
    - "app won't load"
  allOf:
    - ["check", "page"]
    - ["check", "browser"]
    - ["check", "site"]
    - ["blank", "page"]
    - ["white", "screen"]
    - ["console", "errors"]
    - ["page", "broken"]
    - ["page", "loading"]
    - ["not", "rendering"]
    - ["page", "stuck"]
    - ["page", "hanging"]
    - ["page", "frozen"]
    - ["page", "timeout"]
  anyOf:
    - "page"
    - "browser"
    - "screen"
    - "rendering"
    - "visual"
    - "spinner"
    - "loading"
  minScore: 6
chainTo:
  - pattern: "console\\.(error|warn)\\s*\\(|Error:|TypeError:|ReferenceError:"
    targetSkill: investigation-mode
    message: "Console errors detected during browser verification — loading investigation mode to debug root cause with structured error analysis."
  - pattern: "localhost:\\d+|127\\.0\\.0\\.1:\\d+|http://0\\.0\\.0\\.0:\\d+"
    targetSkill: agent-browser
    message: "Dev server URL detected — loading browser automation skill for deeper interactive testing beyond the initial gut-check."
retrieval:
  aliases: ["browser verify", "dev server check", "visual check", "page verification"]
  intents: ["verify dev server", "check page loads", "find console errors", "validate UI"]
  entities: ["dev server", "console errors", "visual check", "gut-check"]
---

Guidance for agent-browser-verify. Install from registry for full content.
