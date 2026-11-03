# Feature Specification: Xóa Watermark Đa Nền Tảng (Image, PDF, PPTX)

**Feature Branch**: `001-watermark-remover`  
**Created**: 2026-11-03  
**Status**: Ready for Planning  
**Input**: User description: "Xóa Watermark Đa Nền Tảng (Image, PDF, PPTX)"  

---

## Executive Summary
The Multi-Platform Watermark Remover is a unified, 100% client-side privacy-first tool embedded inside Cytools (`web-utility-hub`). It empowers users to detect, mask, and eliminate watermarks, timestamps, logos, and background stamps from Images (PNG, JPG, WebP), PDF documents, and PowerPoint presentations (PPTX). In strict compliance with the Cytools Constitution, all file parsing, computer vision inpainting, and document reconstruction run entirely in-browser using Web Workers, HTML5 Canvas, `pdf-lib`, and `jszip` with zero serverless compute or egress.

---

## User Scenarios & Testing

### User Story 1 - Image Watermark Removal via Inpainting (Priority: P1)
As a content creator or designer, I want to upload an image with an unwanted watermark, logo, or timestamp, select the watermark area using an interactive brush or rectangular marquee, and have the watermark cleanly removed via client-side inpainting without uploading my private image to a remote server.

- **Why this priority**: Image watermark removal represents the highest user demand and provides an immediate standalone MVP.
- **Independent Test**: Upload an image with a corner timestamp, brush over the watermark, click "Xóa Watermark", verify that the area is reconstructed seamlessly using surrounding pixel textures, and download the resulting full-resolution image.

**Acceptance Scenarios**:
1. **Given** a user uploads a valid image (`image/jpeg`, `image/png`, or `image/webp`), **When** the file is loaded into the canvas viewer, **Then** an interactive preview renders with brush size and zoom controls.
2. **Given** a user highlights a watermark region with the brush tool, **When** they click "Xóa Watermark", **Then** an offscreen Web Worker executes Fast Marching Inpainting / Telea texture synthesis, generates the cleaned bitmap within 1.5 seconds, and updates the canvas without freezing the UI thread.
3. **Given** processing is complete, **When** the user inspects the output, **Then** a split before/after comparison slider allows inspecting quality before downloading the clean image.

---

### User Story 2 - PDF Watermark & Stamp Stripping (Priority: P1)
As a student or office professional, I want to upload a PDF document containing intrusive "DRAFT", "CONFIDENTIAL", or company background watermarks, detect and strip these watermark layers across all pages, and download a clean PDF retaining original text, vector typography, and formatting.

- **Why this priority**: PDF documents frequently suffer from heavy diagonal or background stamps that hinder readability and printing. It operates completely via client-side libraries (`pdf-lib` and `pdfjs-dist`).
- **Independent Test**: Upload a multi-page PDF with diagonal text watermarks, run watermark removal, and verify that the output PDF has all watermark text objects stripped while preserving page layout, embedded fonts, and body content.

**Acceptance Scenarios**:
1. **Given** a multi-page PDF is loaded, **When** the analysis engine parses the document content stream via `pdf-lib`, **Then** it identifies candidate watermark layers (annotated `/Artifact`, `/Watermark` tagged blocks, semi-transparent text shapes, and recurring stamp XObjects).
2. **Given** detected watermark artifacts, **When** the user selects "Xóa Watermark Toàn Bộ Trang" (or custom page range), **Then** `pdf-lib` filters the page content stream operands and deletes matching watermark operators, producing a byte-clean PDF.
3. **Given** an encrypted or password-protected PDF, **When** the file is uploaded, **Then** the interface displays a clear warning asking for the document password or gracefully declines without crashing.

---

### User Story 3 - PPTX Presentation Watermark & Master Slide Purge (Priority: P2)
As a presenter or educator, I want to remove persistent watermark shapes, background images, and template branding from a `.pptx` presentation file without altering slide contents, shapes, animations, or notes.

- **Why this priority**: PowerPoint files frequently embed watermarks within Master Slides (`slideMaster*.xml`) or as locked background shape nodes across individual slide XML files.
- **Independent Test**: Upload a `.pptx` containing slide master watermark logos, trigger removal, and verify the generated `.pptx` opens in Microsoft PowerPoint or Google Slides with clean backgrounds and intact text elements.

**Acceptance Scenarios**:
1. **Given** a `.pptx` file is provided, **When** the tool receives the file, **Then** `jszip` decompresses the archive structure in browser memory.
2. **Given** the unzipped structure, **When** the XML parser traverses `ppt/slides/slide*.xml`, `ppt/slideMasters/slideMaster*.xml`, and `ppt/slideLayouts/slideLayout*.xml`, **Then** it scans for shape elements (`<p:sp>`) having watermark text, semi-transparent overlays (`<a:solidFill><a:srgbClr><a:alpha val="..."/>`), or background blip relationships marked as watermarks and purges them safely.
3. **Given** cleaning is finalized, **When** `jszip` recompresses the package, **Then** the user downloads the repaired presentation file immediately.

---

### User Story 4 - Batch Queue & Pro Integration (Priority: P2)
As a power user with multiple watermarked assets, I want to queue multiple images or documents for batch processing and download all cleaned files in a organized `.zip` archive.

- **Why this priority**: Leverages Cytools monetization and `usePro()` context while preserving free access for single-file workflows.
- **Independent Test**: As a free user, processing up to 3 files is permitted. For >3 files or batch mode, a Pro modal informs the user of the 5.000đ lifetime upgrade. For Pro users, all queued files process in parallel Web Workers and package into a single ZIP.

**Acceptance Scenarios**:
1. **Given** a free user adds 5 files to the batch queue, **When** they initiate batch processing, **Then** the `ProContext` modal opens inviting upgrade while offering to process the first 3 files for free.
2. **Given** a Pro user (`isPro: true`), **When** 10 files are queued, **Then** files are processed concurrently in chunks of 3 workers, showing real-time progress percentages, and bundled into a zip archive via `jszip`.

---

### User Story 5 - Slate Dark Mode UI Parity (Priority: P3)
As an active user of Cytools, I want the Watermark Remover to have the exact visual styling, dark mode color palette, animated pill tabs, and layout conventions of `SocialDownloaderPage.tsx`.

- **Why this priority**: Eliminates visual friction and upholds Constitution Principle III.
- **Independent Test**: Verify side-by-side that font sizes, border radii (`rounded-xl`), Slate background colors, Lucide icons, and Framer Motion pill transitions match `SocialDownloaderPage.tsx`.

**Acceptance Scenarios**:
1. **Given** the user navigates to `/watermark-remover`, **When** the page renders, **Then** it displays pill selector tabs: `Ảnh (Image)`, `Tài Liệu (PDF)`, `Trình Chiếu (PPTX)`, and `Xử Lý Hàng Loạt (Batch)` with Framer Motion spring indicator layout animations.
2. **Given** dark mode is active, **When** viewing the tool, **Then** background colors conform to `slate-950` and `slate-900`, card borders use `slate-800`, and all icons are from `lucide-react` without any emoji characters.

---

## Edge Cases & Error Handling

1. **Massive Files (>100MB PDF or 50MP Images)**: Web Worker monitors heap memory usage and applies chunked rendering or warns the user before browser memory exhaustion occurs.
2. **Complex Scanned PDFs with Flattened Watermarks**: When a PDF watermark is rasterized directly into a single scanned full-page background image, vector stream stripping cannot separate it without OCR/inpainting. The tool detects this condition and prompts the user to switch to Image Inpainting mode for extracted page images.
3. **Corrupted or Password-Protected PPTX/PDF Archives**: If `jszip` or `pdf-lib` throws an encryption or corruption error, display an inline non-blocking alert badge (`AlertCircle`) explaining the issue with an action button to upload a different file.
4. **Unsupported Formats**: Dropzone rejects non-target MIME types (`.doc`, `.exe`, `.mp4`) immediately with visual shake feedback and a toast alert.

---

## Functional Requirements

- **FR-001**: System MUST provide a dedicated route `/watermark-remover` wrapped within `DashboardLayout`.
- **FR-002**: System MUST process 100% of image, PDF, and PPTX operations inside browser memory without sending file payloads to `/api/*` or remote cloud endpoints.
- **FR-003**: System MUST execute heavy image inpainting algorithms inside a dedicated Web Worker to maintain 60fps UI responsiveness.
- **FR-004**: System MUST allow users to paint custom mask regions over watermarked images with adjustable brush radius (5px to 100px) and zoom/pan capabilities.
- **FR-005**: System MUST parse PDF content streams via `pdf-lib` and remove vector watermarks, `/Artifact` tagged text, and repetitive stamp overlays across user-selected pages.
- **FR-006**: System MUST parse and decompress PPTX files via `jszip`, sanitize slide and master XML nodes containing watermark shapes, and reconstruct valid `.pptx` archives.
- **FR-007**: System MUST provide a before/after split slider for image results and interactive page preview for PDF results.
- **FR-008**: System MUST integrate with `usePro()` from `ProContext.tsx` to gate batch processing (>3 files) without locking free users out of single-file operations.
- **FR-009**: System MUST strictly adhere to Slate dark mode styling (`slate-950`/`slate-900`), Framer Motion tab pill transitions, and Lucide React icons.

---

## Non-Functional Requirements & Performance Targets

- **NFR-001 (Performance)**: Image inpainting for standard 1080p images must complete within 2.5 seconds on average client hardware.
- **NFR-002 (Throughput)**: PDF watermark stripping for a 20-page document must complete within 3 seconds.
- **NFR-003 (Zero Egress)**: Network egress for file processing operations must be 0 bytes.
- **NFR-004 (Memory Hygiene)**: All created `blob:` object URLs must be stored in a tracking ref and explicitly revoked upon unmount or file replacement via `URL.revokeObjectURL`.
- **NFR-005 (Responsiveness)**: The interface must remain fully usable on desktop viewports and in Chrome Extension popup dimensions (`window.innerWidth <= 800`).


---

## Clarifications & Architecture Decisions (Self-Audit)

### C-001: Image Inpainting Algorithm Selection
- **Decision**: To avoid heavy ML model weights (>50MB) and GPU requirements, the inpainting engine uses an optimized pure TypeScript/JavaScript implementation of the Fast Marching Method (Telea Inpainting) and PatchMatch texture cloning inside a dedicated Web Worker (`watermarkInpainter.worker.ts`).
- **Benefit**: Zero load time, instant startup, 100% offline compatibility, bundle size addition < 15KB.

### C-002: Scanned PDF vs Vector PDF Watermark Handling
- **Decision**: The PDF engine first inspects the page operator stream. If text/vector `/Artifact` or `/Watermark` operators exist, it strips them directly in `pdf-lib`. If the page consists entirely of a flat scanned image, the engine offers "Tách ảnh & Khử Watermark", rendering the page canvas, inpainting the watermark via the image worker, and re-inserting the cleaned image into the PDF.

### C-003: PPTX XML Sanitation Strategy
- **Decision**: Using `jszip`, the PPTX processor scans `ppt/slides/slide*.xml` and `ppt/slideMasters/slideMaster*.xml`. It isolates `<p:sp>` elements where:
  - Text matches known watermark phrases ("Draft", "Confidential", "Sample", "Bản nháp", or custom user text).
  - Rotations are diagonal (e.g. `rot="2700000"` to `rot="3600000"`) with alpha transparency `<a:alpha val="<40000"/>`.
  The matched nodes are removed cleanly without modifying slide layout geometry, shape IDs, or master slide relationships.

### C-004: Routing & Navigation Mount Points
- **Decision**: Registered at `/watermark-remover` in `App.tsx`. Navigation link with Lucide `Sparkles` icon added to `DashboardLayout.tsx` alongside `SocialDownloader`, `RemoveBg`, and `ConverterHub`.

### C-005: Resource Lifecycles & Memory Management
- **Decision**: All `Blob` and `File` object references are tracked in a lifecycle registry. `URL.revokeObjectURL()` is immediately triggered whenever a file is replaced, cleared, or when the view unmounts.
