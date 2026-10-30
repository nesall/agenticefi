# AgenticEFI — Coding Agent Instructions

## Project

AgenticEFI is an AI-powered MegaSquirt (generally, any csv/tsv style data) EFI datalog investigation application. Read `CONTEXT.md` before implementing changes.

## Technology

- SvelteKit with TypeScript, frontend and backend in one project.
- Svelte 5, Skeleton UI v5, Tailwind CSS v4.
- Node.js runtime; npm package manager.
- Development environment: Windows, MSYS2 UCRT64.
- Meta Model API using Standard `muse-spark-1.3`.

## Architecture

- Keep SvelteKit API routes thin.
- Implement parsing, telemetry analysis, calculations, and agent orchestration in independent server-side modules.
- Use shared TypeScript types for data contracts.
- Keep API keys and secrets strictly server-side.
- Do not introduce databases, external services, or major dependencies without approval.
- Prefer simple, maintainable solutions over unnecessary abstractions.

## Engineering Rules

- Use strict TypeScript.
- Follow existing project formatting and linting conventions.
- Write tests for parsing, numerical calculations, and telemetry classification.
- Treat missing telemetry channels as unavailable, never as zero.
- Keep deterministic calculations separate from AI-generated reasoning.
- Do not invent measurements or unsupported engine conclusions.
- Never implement direct ECU writes or automatic application of tuning changes.
- Label predictions as predictions, not measured outcomes.

## Workflow

- Implement only the requested scope.
- Explain significant architectural choices before introducing them.
- Run relevant checks and tests after modifications.
- Summarize changed files, verification results, and outstanding limitations.
- Do not commit, push, or deploy unless explicitly instructed.
- Do not modify unrelated files.
- When requirements are ambiguous, ask rather than making consequential assumptions.
