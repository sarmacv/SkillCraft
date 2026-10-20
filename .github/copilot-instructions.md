# Copilot instructions for SkillCraft

Read `AGENTS.md` at the repository root for the full guide. The essentials:

- This is a VS Code extension (TypeScript). `src/core/` is a pure engine with no `vscode` import; `src/vscode/` integrates with VS Code; `webview/src/` is the React orchestrator UI.
- Files shared with the webview (`src/core/types.ts`, `catalog.ts`, `messages.ts`, `workflow.ts`) must not import Node modules.
- Tool-originated changes to a user's files are always `Proposal` objects applied only after the user accepts. Keep proposal keys stable.
- Per-tool facts (Claude Code, Codex, Copilot) live in `profiles/*.json`, not in code.
- Credentials are environment variables; never write secrets.
- Verify with `npm run typecheck && npm test && npm run build`.
