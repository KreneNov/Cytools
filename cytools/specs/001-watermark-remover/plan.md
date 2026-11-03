# Implementation Plan: Xóa Watermark Đa Nền Tảng (Image, PDF, PPTX)

**Branch**: `001-watermark-remover` | **Date**: 2026-11-03 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/001-watermark-remover/spec.md`  

---

## Summary
Build an in-browser, privacy-first multi-format watermark removal suite for Cytools (`web-utility-hub`). The tool enables users to remove watermarks, logos, timestamps, and background stamps from Images (PNG/JPG/WebP), PDF documents, and PPTX slide decks without any server-side egress or cloud compute costs. All operations run directly in the client browser utilizing Web Workers (Telea/PatchMatch inpainting), `pdf-lib` (content stream artifact stripping), and `jszip` (PowerPoint OpenXML DOM parsing and sanitation). The UI maintains strict parity with `SocialDownloaderPage.tsx`.

---

## Technical Context

- **Language/Version**: TypeScript 5.8 / ~7.0 (Vite 8, React 19)
- **Primary Dependencies**:
  - `react` 19.3.1, `react-dom` 19.3.1, `react-router-dom` 7.18.5
  - `framer-motion` 14.9.0 (pill indicator layout animations)
  - `lucide-react` 1.64.0 (vector UI icons exclusively)
  - `pdf-lib` 1.17.1 (client-side PDF parsing and generation)
  - `pdfjs-dist` 3.11.174 (page rendering and visual canvas thumbnails)
  - `jszip` 3.10.2 (PPTX archive unpacking, inspection, repackaging, batch ZIP export)
- **Storage**: In-memory `ArrayBuffer` & `Blob` lifecycles (with explicit `URL.revokeObjectURL` garbage collection). `localStorage` only for user preferences (brush size, active sub-tab).
- **Testing**: Oxlint (`npm run lint`), TypeScript compile check (`tsc -b`), browser unit verification.
- **Target Platform**: Modern Chromium, Firefox, WebKit browsers, and Chrome Extension Popup mode (`window.innerWidth <= 800`).
- **Project Type**: Client-Side Single Page Application (SPA) Web Utility.
- **Performance Goals**:
  - Image Inpainting: <2.5s for 1080p resolution.
  - PDF Vector Watermark Removal: <3s for 20 pages.
  - PPTX Watermark Removal: <2s for 30 slides.
  - UI Responsiveness: 60fps canvas paint operations with all algorithmic workloads offloaded to Web Workers.
- **Constraints**:
  - ZERO server-side network calls (`/api/*` untouched).
  - ZERO external GPU or ML model weight download (>0MB).
  - Memory footprint <150MB client heap peak.

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Requirement | Plan Verification | Status |
| :--- | :--- | :--- | :--- |
| **I. Zero Backend Disruption** | `/api/*`, `SocialDownloader`, `HallOfFame`, `SePay` sacred | Zero modifications to `/api/*` or existing routes. No new backend endpoints added. | **PASSED** |
| **II. 100% Client-Side** | In-browser processing only (Web Workers, `pdf-lib`, `jszip`) | Telea inpainter runs in dedicated Web Worker. PDF stream parsed via `pdf-lib`. PPTX unpacked via `jszip`. 0 egress. | **PASSED** |
| **III. UI Parity** | Slate dark mode, animated pill tabs, Lucide icons, 0 emojis | Uses `slate-950`/`slate-900`/`slate-800`, Framer Motion `layoutId="watermarkTabIndicator"`, Lucide icons exclusively. | **PASSED** |
| **IV. Pro Integration** | Non-breaking free tier, Pro modal for batch (>3 items) | Single file mode 100% free. Batch queue (>3 items) connects to `usePro()` from `src/context/ProContext.tsx`. | **PASSED** |

---

## Project Structure & Architecture

```text
web-utility-hub/
├── src/
│   ├── types/
│   │   └── watermarkRemover.ts           # Types for Image, PDF, PPTX items & processing states
│   ├── workers/
│   │   └── watermarkInpainter.worker.ts  # Fast Marching Method / Telea inpainting Web Worker
│   ├── utils/
│   │   ├── pdfWatermarkStripper.ts       # pdf-lib content stream parser & artifact stripper
│   │   ├── pptxWatermarkStripper.ts      # jszip OpenXML DOM traverser & shape purifier
│   │   └── canvasMaskUtils.ts            # Brush, lasso, and bounding box mask rasterizer
│   ├── hooks/
│   │   └── useWatermarkRemover.ts        # Unified state machine for file handling, worker dispatch, and export
│   ├── components/
│   │   └── watermark-remover/
│   │       ├── WatermarkHeader.tsx       # Title, subtitle, badge with Slate aesthetics
│   │       ├── WatermarkTabSelector.tsx  # Framer Motion animated pill tabs (Image, PDF, PPTX, Batch)
│   │       ├── ImageWatermarkView.tsx    # Interactive canvas brush selection & split comparison slider
│   │       ├── PdfWatermarkView.tsx      # Page selector, watermark detection preview, batch strip
│   │       ├── PptxWatermarkView.tsx     # Slide inspection, detected shape list, clean PPTX exporter
│   │       ├── BatchWatermarkView.tsx    # Multi-file queue with progress bars and ZIP bundling
│   │       └── InpaintComparisonModal.tsx# High-resolution comparison modal with zoom controls
│   ├── pages/
│   │   └── WatermarkRemoverPage.tsx      # Top-level page container with ProContext integration
│   ├── components/layout/
│   │   └── DashboardLayout.tsx           # Add Watermark Remover to navigation menu
│   └── App.tsx                           # Add Route path="/watermark-remover"
```

---

## Detailed Component Specifications

### 1. `watermarkInpainter.worker.ts` (Image Processing Engine)
- Receives: `ImageData` of original image, 1-bit binary mask (Uint8ClampedArray) representing user-brushed watermark areas.
- Algorithm: Telea Fast Marching Method:
  1. Computes distance transform from boundary pixels of the mask.
  2. Synthesizes pixels iteratively inwards from outer contour using weighted gradient and surrounding neighbor intensities:
     $$I(p) = \frac{\sum_{q \in B_\epsilon(p)} w(p, q) \cdot [I(q) + \nabla I(q) \cdot (p - q)]}{\sum_{q \in B_\epsilon(p)} w(p, q)}$$
  3. Returns processed `ImageData` to main thread via Transferable `ArrayBuffer` without memory copies.

### 2. `pdfWatermarkStripper.ts` (PDF Processing Engine)
- Utilizes `PDFDocument` from `pdf-lib`.
- Traverses each `PDFPage` in the document:
  - Retrieves content streams: `page.node.Contents()`.
  - Parses PDF operator byte streams searching for `/Artifact`, `/Watermark` structural dictionaries.
  - Identifies recurring diagonal transformation matrices (`cm` operators with rotation between $20^\circ$ and $70^\circ$).
  - Filters out identified watermark drawing commands while preserving text, vectors, images, and fonts.
- Re-serializes document via `pdfDoc.save()` and generates a clean `Blob`.

### 3. `pptxWatermarkStripper.ts` (PPTX Processing Engine)
- Loads binary `.pptx` buffer using `JSZip.loadAsync(file)`.
- Scans target XML descriptors:
  - `ppt/slides/slide{n}.xml`
  - `ppt/slideMasters/slideMaster{n}.xml`
  - `ppt/slideLayouts/slideLayout{n}.xml`
- Uses native DOMParser to locate `<p:sp>` (shapes) and `<p:pic>` (pictures).
- Strips elements matching:
  - Watermark shape names (e.g. `name="Watermark*"` or `name="Draft*"`).
  - Elements with alpha opacity `<a:alpha val="<40000"/>` spanning whole slide dimensions.
- Generates sanitized `.pptx` binary and returns `Blob`.

### 4. `WatermarkRemoverPage.tsx` (UI Container)
- Matches `SocialDownloaderPage.tsx` structure:
  - Header with icon, title, description in Slate typography.
  - Pill navigation: Image (`ImageIcon`), PDF (`FileText`), PPTX (`Presentation`), Batch (`Layers`).
  - Seamless responsive layout supporting both desktop web and Chrome extension popup views.
  - Pro perks: Free single-file processing; batch queuing (>3 items) triggers `openProModal()`.

---

## Verification & Quality Gates

1. **Static Analysis & Linting**:
   ```powershell
   cd d:\Aiotools\web-utility-hub
   npm run lint
   ```
2. **TypeScript Compilation**:
   ```powershell
   npm run build
   ```
3. **Behavioral Acceptance Tests**:
   - Image Test: Brush over a sample watermark, run inpainter, verify clean output without blocking UI.
   - PDF Test: Strip watermarks from multi-page document, verify text selectable and formatting preserved.
   - PPTX Test: Strip watermarks from sample `.pptx`, verify PowerPoint loads file without warning or corruption.
   - Pro Gate Test: Free users can process 1 file; adding >3 files prompts Pro modal with 5.000đ upgrade text.
