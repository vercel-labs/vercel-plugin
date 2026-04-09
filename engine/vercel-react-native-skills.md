---
name: vercel-react-native-skills
priority: 5
description: "React Native and Expo best practices for mobile apps"
registry: vercel-labs/agent-skills
summary: "React Native and Expo best practices — performance, animations, native modules, mobile patterns"
pathPatterns:
  - "app.json"
  - "app.config.*"
  - "expo-*.config.*"
  - "src/screens/**"
  - "screens/**"
  - "ios/**"
  - "android/**"
bashPatterns:
  - "\\bexpo\\b"
  - "\\breact-native\\b"
  - "\\bnpx expo\\b"
importPatterns:
  - "react-native"
  - "expo"
  - "expo-"
  - "@react-native"
promptSignals:
  phrases:
    - "react native"
    - "expo app"
    - "mobile app"
    - "native module"
  anyOf:
    - "react native"
    - "expo"
    - "mobile"
  noneOf:
    - "react native web"
  minScore: 6
docs:
  - https://reactnative.dev/docs
  - https://docs.expo.dev
---
