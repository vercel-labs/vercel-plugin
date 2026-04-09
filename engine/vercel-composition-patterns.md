---
name: vercel-composition-patterns
priority: 5
description: "React composition patterns that scale"
registry: vercel-labs/agent-skills
summary: "React composition patterns — compound components, render props, context providers, component architecture"
pathPatterns:
  - "src/components/**"
  - "components/**"
  - "src/ui/**"
importPatterns:
  - "createContext"
  - "forwardRef"
  - "React.Children"
promptSignals:
  phrases:
    - "composition pattern"
    - "compound component"
    - "render prop"
    - "component architecture"
    - "boolean prop proliferation"
  anyOf:
    - "composition"
    - "compound"
    - "render props"
  minScore: 6
docs:
  - https://react.dev/learn/passing-data-deeply-with-context
---
