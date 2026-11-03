import JSZip from 'jszip';
import type { PptxDetectedItem, PptxCleanResult } from '../types/watermarkRemover';

const WATERMARK_PATTERNS = [
  'watermark',
  'draft',
  'confidential',
  'sample',
  'bản quyền',
  'dấu chìm',
  'do not copy',
  'internal use',
  'nội bộ',
  'wordart',
  'camscanner',
];

/**
 * Parses and scans a PowerPoint presentation (.pptx) in-browser
 * to locate watermark text shapes, background overlays, and corner logo pictures.
 */
export async function scanPptxWatermarks(
  file: File | ArrayBuffer
): Promise<{ zip: JSZip; detectedItems: PptxDetectedItem[] }> {
  const zip = await JSZip.loadAsync(file);
  const detectedItems: PptxDetectedItem[] = [];
  const parser = new DOMParser();

  // Find all master, layout, and slide XML files
  const xmlFiles: { path: string; type: 'slideMaster' | 'slideLayout' | 'slide'; slideNum?: number }[] = [];

  zip.forEach((relativePath) => {
    if (relativePath.startsWith('ppt/slideMasters/') && relativePath.endsWith('.xml') && !relativePath.includes('_rels')) {
      xmlFiles.push({ path: relativePath, type: 'slideMaster' });
    } else if (relativePath.startsWith('ppt/slideLayouts/') && relativePath.endsWith('.xml') && !relativePath.includes('_rels')) {
      xmlFiles.push({ path: relativePath, type: 'slideLayout' });
    } else if (relativePath.startsWith('ppt/slides/') && relativePath.endsWith('.xml') && !relativePath.includes('_rels')) {
      const match = relativePath.match(/slide(\d+)\.xml/);
      xmlFiles.push({
        path: relativePath,
        type: 'slide',
        slideNum: match ? parseInt(match[1], 10) : undefined,
      });
    }
  });

  for (const item of xmlFiles) {
    const xmlContent = await zip.file(item.path)?.async('text');
    if (!xmlContent) continue;

    // Load rels file to resolve image media relationships
    const relsPath = item.path.replace(/(slide[^/]*\.xml)/, '_rels/$1.rels');
    const relsContent = await zip.file(relsPath)?.async('text');
    const relsMap = new Map<string, string>();

    if (relsContent) {
      try {
        const relsDoc = parser.parseFromString(relsContent, 'application/xml');
        const relElements = relsDoc.getElementsByTagName('Relationship');
        for (let i = 0; i < relElements.length; i++) {
          const rId = relElements[i].getAttribute('Id');
          const target = relElements[i].getAttribute('Target');
          if (rId && target) {
            // Normalize path relative to ppt/
            const normTarget = target.startsWith('../')
              ? `ppt/${target.replace('../', '')}`
              : `ppt/slides/${target}`;
            relsMap.set(rId, normTarget);
          }
        }
      } catch {
        // Continue
      }
    }

    try {
      const doc = parser.parseFromString(xmlContent, 'application/xml');

      // 1. Scan Text Shapes (<p:sp>)
      const shapes = doc.getElementsByTagName('p:sp');
      for (let i = 0; i < shapes.length; i++) {
        const sp = shapes[i];
        const cNvPr = sp.getElementsByTagName('p:cNvPr')[0];
        const shapeId = cNvPr?.getAttribute('id') || `sp_${i}`;
        const shapeName = cNvPr?.getAttribute('name') || `Shape ${i}`;

        // Extract text inside <a:t>
        const textElements = sp.getElementsByTagName('a:t');
        let fullText = '';
        for (let t = 0; t < textElements.length; t++) {
          fullText += (textElements[t].textContent || '') + ' ';
        }
        fullText = fullText.trim();

        // Check rotation attribute (e.g. rot="18900000" = 315 deg diagonal watermark)
        const xfrm = sp.getElementsByTagName('a:xfrm')[0];
        const rot = xfrm?.getAttribute('rot');
        const hasDiagonalRotation = Boolean(rot && rot !== '0');

        const isWatermarkName = WATERMARK_PATTERNS.some((p) =>
          shapeName.toLowerCase().includes(p)
        );
        const isWatermarkText = WATERMARK_PATTERNS.some((p) =>
          fullText.toLowerCase().includes(p)
        );

        if (isWatermarkName || isWatermarkText || (hasDiagonalRotation && fullText.length > 0)) {
          detectedItems.push({
            id: `${item.path}#${shapeId}`,
            sourceFile: item.path,
            sourceType: item.type,
            slideNumber: item.slideNum,
            shapeType: 'text',
            name: shapeName,
            textSnippet: fullText.slice(0, 100) || '(Hình khối dạng chữ)',
            selected: true,
          });
        }
      }

      // 2. Scan Picture shapes (<p:pic>)
      const pictures = doc.getElementsByTagName('p:pic');
      for (let i = 0; i < pictures.length; i++) {
        const pic = pictures[i];
        const cNvPr = pic.getElementsByTagName('p:cNvPr')[0];
        const picId = cNvPr?.getAttribute('id') || `pic_${i}`;
        const picName = cNvPr?.getAttribute('name') || `Picture ${i}`;

        const blip = pic.getElementsByTagName('a:blip')[0];
        const rEmbed = blip?.getAttribute('r:embed');

        let previewUrl: string | undefined = undefined;
        let imageBytes: Uint8Array | undefined = undefined;

        if (rEmbed && relsMap.has(rEmbed)) {
          const mediaPath = relsMap.get(rEmbed)!;
          const mediaFile = zip.file(mediaPath);
          if (mediaFile) {
            imageBytes = await mediaFile.async('uint8array');
            const base64 = await mediaFile.async('base64');
            const ext = mediaPath.split('.').pop()?.toLowerCase() || 'png';
            const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
            previewUrl = `data:${mime};base64,${base64}`;
          }
        }

        const isWatermarkPicName = WATERMARK_PATTERNS.some((p) =>
          picName.toLowerCase().includes(p)
        );

        // Treat picture as candidate if explicitly named watermark, or located on SlideMaster/Layout
        if (isWatermarkPicName || item.type === 'slideMaster' || item.type === 'slideLayout') {
          detectedItems.push({
            id: `${item.path}#${picId}`,
            sourceFile: item.path,
            sourceType: item.type,
            slideNumber: item.slideNum,
            shapeType: 'image',
            name: picName,
            textSnippet: `Ảnh logo ${item.type === 'slideMaster' ? '(Slide Master)' : ''}`,
            imagePreviewUrl: previewUrl,
            imageBytes,
            selected: isWatermarkPicName, // Pre-select if name contains watermark keywords
          });
        }
      }
    } catch {
      // Continue parsing other slides
    }
  }

  return { zip, detectedItems };
}

/**
 * Removes selected watermark shapes, logos, and overlays from the presentation
 * and packages a fresh, clean .pptx file in memory.
 */
export async function removePptxWatermarks(
  zip: JSZip,
  itemsToRemove: PptxDetectedItem[]
): Promise<PptxCleanResult> {
  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  // Group items to remove by source file
  const fileMap = new Map<string, PptxDetectedItem[]>();
  for (const item of itemsToRemove) {
    if (!item.selected) continue;
    const list = fileMap.get(item.sourceFile) || [];
    list.push(item);
    fileMap.set(item.sourceFile, list);
  }

  let totalRemoved = 0;
  const removedItems: PptxDetectedItem[] = [];

  for (const [filePath, targetItems] of fileMap.entries()) {
    const xmlContent = await zip.file(filePath)?.async('text');
    if (!xmlContent) continue;

    try {
      const doc = parser.parseFromString(xmlContent, 'application/xml');
      let modified = false;

      // Extract ids to delete
      const idsToDelete = new Set(targetItems.map((item) => item.id.split('#')[1]));
      const namesToDelete = new Set(targetItems.map((item) => item.name.toLowerCase()));

      // 1. Remove matching <p:sp>
      const shapes = Array.from(doc.getElementsByTagName('p:sp'));
      for (const sp of shapes) {
        const cNvPr = sp.getElementsByTagName('p:cNvPr')[0];
        const shapeId = cNvPr?.getAttribute('id');
        const shapeName = cNvPr?.getAttribute('name')?.toLowerCase();

        if (
          (shapeId && idsToDelete.has(shapeId)) ||
          (shapeName && namesToDelete.has(shapeName))
        ) {
          sp.parentNode?.removeChild(sp);
          modified = true;
          totalRemoved++;
        }
      }

      // 2. Remove matching <p:pic>
      const pictures = Array.from(doc.getElementsByTagName('p:pic'));
      for (const pic of pictures) {
        const cNvPr = pic.getElementsByTagName('p:cNvPr')[0];
        const picId = cNvPr?.getAttribute('id');
        const picName = cNvPr?.getAttribute('name')?.toLowerCase();

        if (
          (picId && idsToDelete.has(picId)) ||
          (picName && namesToDelete.has(picName))
        ) {
          pic.parentNode?.removeChild(pic);
          modified = true;
          totalRemoved++;
        }
      }

      if (modified) {
        const updatedXml = serializer.serializeToString(doc);
        zip.file(filePath, updatedXml);
        removedItems.push(...targetItems);
      }
    } catch {
      // Continue
    }
  }

  const cleanedBlob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });

  return {
    cleanedBlob,
    totalRemoved,
    removedItems,
  };
}
