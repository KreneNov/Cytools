# Cytools Project Constitution

## Core Principles

### I. Zero Backend Disruption (Sacred Codebase Principle)
All existing backend services, Vercel serverless endpoints, and monetization infrastructure are strictly frozen and sacred:
- **Serverless API Protection**: Existing routes in `/api/*`—specifically `api/download.ts`, `api/hall-of-fame.ts`, `api/webhook.ts`, `api/_db.ts`, `api/_social_extractor.ts`, and `api/_webhook_core.ts`—must NEVER be altered, refactored, or broken when adding new tools or features.
- **Critical Flow Isolation**: The `SocialDownloader` extraction engine, `HallOfFame` donor leaderboard, and `SePay` payment/webhook flow are mission-critical. No changes may introduce regressions, shared mutable runtime state, or dependency conflicts that affect these systems.
- **Zero Server Egress for New Features**: Never provision new serverless API routes or server-side compute for file conversion, media manipulation, or document processing.

### II. 100% Client-Side Processing for New Tools
All new processing utilities (starting with the Multi-Platform Watermark Remover) must execute entirely in the user's browser:
- **Client-Side Technologies**: File parsing, manipulation, and rendering must utilize client-side Web Workers, the HTML5 Canvas API, `pdf-lib` (v1.17.1), `pdfjs-dist` (v3.11.174), and `jszip` (v3.10.2).
- **Zero Cloud Compute & Egress**: User files must never be uploaded to Vercel functions, external storage buckets, or remote servers for processing. Processing must run locally on the client's device, eliminating cloud compute overhead, egress bandwidth costs, and server timeouts.
- **Privacy & Security by Design**: File content, documents, images, and slide decks remain strictly in client memory. All object URLs generated (`URL.createObjectURL`) must be revoked cleanly after download or cancellation.

### III. Strict UI Parity & Design Standards
All new tools and modules must achieve pixel-level aesthetic parity with the established design system of `SocialDownloaderPage.tsx`:
- **Slate Dark Mode Palette**: Use Tailwind CSS Slate palette tokens exclusively:
  - Backgrounds: `bg-slate-950` (page canvas), `bg-white dark:bg-slate-900` (cards and tool containers), `bg-slate-50 dark:bg-slate-950` (inputs, preview dropzones, and textareas).
  - Borders: `border-slate-200 dark:border-slate-800`.
  - Typography: `text-slate-900 dark:text-white` (headings), `text-slate-600 dark:text-slate-400` (subheadings and body), `text-slate-500 dark:text-slate-400` (secondary labels).
- **Animated Pill Navigation**: Sub-tabs and mode selectors must utilize Framer Motion animated pill tabs with `layoutId` indicator transitions, identical to the Single Link / Batch Multi-Link tabs in `SocialDownloaderPage.tsx`.
- **Zero AI-Slop Icons**: Strictly forbid emoji icons in UI elements, buttons, and badges. Use professional vector icons exclusively from `lucide-react`.
- **Responsive Layout & Extension Compatibility**: Every tool interface must support responsive viewport scaling and remain fully operational in compact/extension popup mode (`isCompact` flag).

### IV. Pro Tier Integration Consistency
- **Monetization Alignment**: New tools must consume the existing `usePro()` hook from `src/context/ProContext.tsx` to handle premium limitations (e.g. batch file queues, ultra-high resolution export).
- **Non-Breaking Free Access**: Basic/single-file processing operations must always remain accessible to free-tier users without forced modal lockouts. Pro modals should only trigger for batch limits or advanced options.

---

## Architecture & Technology Constraints

1. **Frontend Stack**: React 19, TypeScript, Vite, Tailwind CSS v4, Framer Motion, and Lucide React.
2. **Standard File Libraries**:
   - PDF Processing: `pdf-lib` and `pdfjs-dist`
   - Archive/Office Processing: `jszip`
   - Image/Canvas: HTML5 2D Canvas & Web Workers
3. **Build & Quality Gates**: Every code contribution must pass `oxlint` (`npm run lint`) and TypeScript verification (`tsc -b`).

---

## Governance & Enforcement

- **Supremacy**: This Constitution supersedes all implementation proposals and code generation requests. Any pull request, patch, or feature specification that introduces server-side processing dependencies or alters sacred backend routes is automatically rejected.
- **Auditing**: Every task execution and feature plan must verify compliance with the 3 Core Principles prior to merging.

**Version**: 1.0.0 | **Ratified**: 2026-11-03 | **Last Amended**: 2026-11-03
