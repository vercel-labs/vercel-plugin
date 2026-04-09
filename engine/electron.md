---
name: electron
priority: 5
description: "Automate Electron desktop apps via Chrome DevTools Protocol"
registry: vercel-labs/agent-browser
summary: "Automate Electron desktop apps (VS Code, Slack, Discord, Figma, Notion) using agent-browser via CDP"
pathPatterns:
  - "electron/**"
  - "src/electron/**"
  - "electron.config.*"
  - "electron-builder.*"
bashPatterns:
  - "\\belectron\\b"
  - "\\belectron-builder\\b"
importPatterns:
  - "electron"
promptSignals:
  phrases:
    - "automate electron"
    - "electron app"
    - "automate desktop app"
    - "control VS Code"
    - "automate Slack"
    - "automate Discord"
  anyOf:
    - "electron"
    - "desktop app"
  noneOf:
    - "electron microscope"
  minScore: 6
docs:
  - https://www.electronjs.org/docs
---
