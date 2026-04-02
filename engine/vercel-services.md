---
name: vercel-services
priority: 7
docs: https://vercel.com/docs/services
sitemap: https://vercel.com/sitemap/docs.xml
pathPatterns:
  - "backend/**"
  - "backend/main.py"
  - "backend/main.go"
  - "backend/go.mod"
  - "backend/pyproject.toml"
  - "backend/requirements.txt"
  - "frontend/**"
  - "apps/*/backend/**"
  - "apps/*/frontend/**"
  - "services/*/vercel.json"
  - "*/pyproject.toml"
  - "*/go.mod"
bashPatterns:
  - "\\bvercel\\s+dev\\b.*-L"
  - "\\bpip\\s+install\\b.*fastapi"
  - "\\buv\\s+(sync|pip|run)\\b"
  - "\\bgo\\s+(run|build|mod)\\b"
  - "\\bpython\\s+-m\\s+uvicorn\\b"
  - "\\buvicorn\\b"
importPatterns:
  - "fastapi"
promptSignals:
  phrases:
    - "services api"
    - "vercel services"
    - "multi-service"
    - "python backend"
    - "go backend"
    - "fastapi"
    - "deploy backend"
    - "backend and frontend"
    - "multiple services"
  allOf:
    - ["backend", "frontend"]
    - ["python", "vercel"]
    - ["go", "vercel"]
    - ["backend", "deploy"]
    - ["service", "monorepo"]
    - ["fastapi", "deploy"]
  anyOf:
    - "backend"
    - "monorepo"
    - "service"
    - "python"
    - "golang"
  noneOf:
    - "turborepo cache"
    - "turbo.json"
    - "aws lambda"
    - "docker compose"
  minScore: 6
validate:
  - pattern: "@app\\.(get|post|put|delete|patch)\\s*\\(\\s*[''\"]\\/api\\/"
    message: "Do not include routePrefix in backend routes — Vercel strips the prefix before forwarding. Use @app.get(\"/health\") not @app.get(\"/api/health\")"
    severity: error
  - pattern: "http\\.HandleFunc\\s*\\(\\s*[''\"]\\/api\\/"
    message: "Do not include routePrefix in Go handlers — Vercel strips the prefix. Use \"/health\" not \"/api/health\""
    severity: error
retrieval:
  aliases: ["multi-service", "backend service", "services api", "monorepo deploy", "monorepo services"]
  intents: ["deploy backend and frontend together on vercel", "set up python backend alongside next.js frontend", "configure multi-service vercel project", "add go backend to vercel project"]
  entities: ["experimentalServices", "routePrefix", "entrypoint", "Services API", "vercel.json services"]
---

Deploy multiple services in one Vercel project — e.g. a Python backend alongside a JS frontend
