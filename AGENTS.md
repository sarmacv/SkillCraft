# SkillCraft — agent guide

SkillCraft is a VS Code extension for designing, orchestrating, testing and shipping Agent Skills (`SKILL.md` folders) for Claude Code, OpenAI Codex and GitHub Copilot. Everything runs inside VS Code: sidebar views, an orchestrator webview panel, the `@skillcraft` chat participant, and language model tools.

## Commands

```bash
npm install          # once
npm run build        # bundle extension (dist/extension.js) and webview (dist/webview/)
npm run watch        # rebuild on change
npm run typecheck    # tsc for the extension and the webview
npm test             # core engine tests (node:test)
npm run icons        # re-render media/icon.png from media/icon.svg
npm run package      # production build + .vsix
```

Run the extension with F5 ("Run SkillCraft (empty folder)" or "Run SkillCraft (existing skill)").

## Layout

| Path | What lives there |
| --- | --- |
| `src/core/` | Pure engine: no `vscode` import. Parsing, checks, inference, proposals, codegen, build, docs. Fully unit-tested. |
| `src/core/catalog.ts` | Component manifests (fields, compile kind, per-tool support). Shared with the webview. |
| `src/core/types.ts`, `messages.ts`, `workflow.ts` | Shared with the webview — must stay browser-safe (no Node imports). |
| `profiles/*.json` | Per-tool facts (install paths, frontmatter fields, MCP setup). Data, not code. |
| `src/vscode/` | VS Code integration: controller, tree views, review/diff, orchestrator panel, chat, coach, tests, tools, AI access. |
| `webview/src/` | React + React Flow orchestrator UI. Styled only with VS Code theme variables. |
| `schemas/` | JSON schemas for `skillcraft.json` and `workflow.json`. |
| `test/` | `node:test` suites for `src/core`. |
| `examples/` | Folders to launch the extension against (empty and a messy brownfield skill). |

## Rules that matter

1. **Nothing changes the user's files without approval.** Tool-originated changes (checks, coach, chat, sync, import) are `Proposal` objects. They are applied only by `Controller.accept()`, after the user accepts. User edits on the canvas or project settings are saved directly — those are the user's own actions.
2. **Proposal keys are stable.** The same suggestion must produce the same key so rejections (stored in `skillcraft.json` → `rejected`) stick.
3. **`src/core` never imports `vscode`.** Keep it testable with plain Node.
4. **Browser-safe shared files.** `types.ts`, `catalog.ts`, `messages.ts`, `workflow.ts` are bundled into the webview.
5. **Tool facts belong in `profiles/*.json`.** When Claude Code, Codex or Copilot change their skill format, update the profile (bump `profileVersion`, `verifiedAt`, `sources`), not the code.
6. **Generated output must be standard.** A built skill is a plain Agent Skills folder. Human docs (README, SETUP) live next to the skill in `dist/`, never inside it.
7. **Generated scripts** carry the `skillcraft:managed` marker in their first lines. Files without it belong to the user and are never regenerated. Generated code uses only each runtime's standard library unless a driver is unavoidable.
8. **Credentials** are always environment variables. Never write secrets anywhere.
9. **UI copy** is plain, sentence case, no jargon; every control explains itself on hover.

## Common tasks

- **Add a component type:** add a `ComponentDef` to `CATALOG` in `src/core/catalog.ts`. If it compiles to a script, add generators in `src/core/codegen/templates.ts` (Python, Node and Bash) and a render case in `renderWorkflowSection` (`src/core/codegen/generate.ts`). Add a test in `test/core.test.ts`.
- **Add a check:** add it in `runChecks` (`src/core/checks.ts`) with a rule id, area, severity and, when fixable, a `Proposal` with a stable key. Add a test.
- **Add a target tool:** add `profiles/<tool>.json`, extend `TargetId` and `ALL_TARGETS` in `types.ts`, register it in `src/core/profiles.ts`, add its CLI in `src/vscode/tests.ts`.

## Verification

Before finishing a change: `npm run typecheck && npm test && npm run build`. For UI changes, launch with F5 and check both a light and a dark theme.
