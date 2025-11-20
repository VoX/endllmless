# Endllmless AI Coding Instructions

## Project Overview
Endllmless is a monorepo web application that replicates "Infinite Craft" mechanics. It consists of a Preact frontend and a Node.js/Express backend that uses OpenAI to combine words and generate emojis.

## Architecture & Structure
- **Monorepo**:
  - `client/`: Preact application built with Vite.
  - `server/`: Node.js Express application.
  - `shared/`: Intended for shared code (currently empty/minimal).
- **Frontend (Client)**:
  - **Framework**: Preact (via `@preact/preset-vite`), but uses `react` imports for hooks (`useReducer`, etc.).
  - **State Management**: Centralized in `src/gameReducer.js` using `useReducer`. Persists `words` to `localStorage`.
  - **Styling**: CSS files imported directly into components (e.g., `import "./App.css"`).
- **Backend (Server)**:
  - **Framework**: Express.js.
  - **Core Logic**: `routes/wordCombine.js` handles word combination using OpenAI `gpt-4o`.
  - **Caching**: In-memory `Map` (`wordCache`) stores combined results to reduce API calls.
- **Deployment**:
  - **Docker**: Single container architecture running both Caddy and Node.js server.
    - **Entrypoint**: `start.sh` manages both processes and exits if either crashes (triggering restart).
    - **Build**: Multi-stage build. Stage 1 builds client assets; Stage 2 sets up runtime.
  - **Caddy**:
    - Serves static client files from `/app/client/dist`.
    - Proxies `/wordcombine` to local Node server (`localhost:8080`).
    - Proxies external services to `host.docker.internal` (requires `--add-host` flag).
    - Uses `JELLY_PATH` env var for secret path configuration.

## Critical Workflows
- **Development**:
  - Run `npm run dev` from the **root** directory. This uses `concurrently` to start both client (`vite`) and server (`node ./bin/www`).
  - Ensure `OPENAI_API_KEY` is set in the server environment.
- **Build**:
  - **Local**: `npm run build` (root) triggers `npm run build:client`. Output: `client/dist`.
  - **Docker**: `docker build -t endllmless .` builds the full production image.
- **Run (Docker)**:
  - Requires `OPENAI_API_KEY` and `JELLY_PATH` env vars.
  - Requires `--add-host=host.docker.internal:host-gateway` for host networking.

## Coding Conventions
- **Frontend**:
  - Use Functional Components.
  - **Imports**: Even though it's Preact, the codebase uses `import { ... } from "react"` for hooks. Maintain this pattern unless refactoring to pure Preact imports.
  - **State**: Complex state logic belongs in `gameReducer.js`.
  - **Components**: Located in `client/src/`.
- **Backend**:
  - Use ESM (`import`/`export`).
  - **Routes**: Define new routes in `server/routes/` and register them in `server/app.js`.
  - **AI Integration**: Keep prompt logic within the route handlers (like `wordCombine.js`) or extract to a dedicated service if complexity grows.
- **Data Flow**:
  - Client makes GET requests to Server (e.g., `/wordCombine?wordone=...&wordtwo=...`).
  - Server returns JSON: `{ word: "NewWord", emoji: "🆕" }` (inferred structure, verify actual response).

## Specific Patterns
- **Word Combination**:
  - Logic: `wordOne` + `wordTwo` -> OpenAI -> New Word -> OpenAI -> Emoji.
  - **Ordering**: Words are sorted alphabetically before caching/processing (`wordOne > wordTwo` swap) to ensure "Fire + Water" is the same as "Water + Fire".
- **Emoji**: The app relies on emojis as the primary visual representation of words.

## Common Tasks
- **Adding a new feature**:
  1. Update `gameReducer.js` for new state/actions.
  2. Create/Update UI component in `client/src/`.
  3. If backend logic is needed, add route in `server/routes/`.
- **Debugging**:
  - Check `server` console for OpenAI errors or cache hits.
  - Check `client` console for Reducer logs (`console.log("Game state updated:", ...)` is built-in).
