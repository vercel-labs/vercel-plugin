---
name: vercel-react-view-transitions
priority: 5
description: "React View Transition API for smooth page and component animations"
registry: vercel-labs/agent-skills
summary: "React View Transitions — ViewTransition component, transition types, route animations, shared element animations"
importPatterns:
  - "ViewTransition"
  - "startViewTransition"
  - "addTransitionType"
promptSignals:
  phrases:
    - "view transition"
    - "page transition"
    - "route animation"
    - "shared element animation"
    - "ViewTransition"
  anyOf:
    - "view transition"
    - "page animation"
    - "route transition"
  minScore: 6
docs:
  - https://react.dev/reference/react/ViewTransition
---
