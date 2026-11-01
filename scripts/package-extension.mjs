import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');
const PUBLIC_DIR = path.resolve(ROOT_DIR, 'public');
const OUTPUT_ZIP = path.resolve(PUBLIC_DIR, 'cytools-extension.zip');

async function addDirectoryToZip(zip, folderPath, rootPath = folderPath) {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(folderPath, entry.name);
    const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, '/');

    // Skip the zip file itself if present
    if (entry.name === 'cytools-extension.zip') {
      continue;
    }

    if (entry.isDirectory()) {
      const folderZip = zip.folder(relativePath);
      await addDirectoryToZip(folderZip, fullPath, rootPath);
    } else {
      const fileData = fs.readFileSync(fullPath);
      zip.file(relativePath, fileData);
    }
  }
}

async function packageExtension() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error('Dist directory does not exist! Please run npm run build first.');
    process.exit(1);
  }

  console.log('Packaging extension from dist into cytools-extension.zip...');
  const zip = new JSZip();

  await addDirectoryToZip(zip, DIST_DIR);

  const zipContent = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_ZIP, zipContent);
  console.log(`Successfully generated: ${OUTPUT_ZIP} (${(zipContent.length / (1024 * 1024)).toFixed(2)} MB)`);

  const distZip = path.resolve(DIST_DIR, 'cytools-extension.zip');
  try {
    fs.copyFileSync(OUTPUT_ZIP, distZip);
    console.log(`Synced to: ${distZip}`);
  } catch {
    // Dist sync optional if dist is being created
  }
}

packageExtension().catch((err) => {
  console.error('Failed to package extension:', err);
  process.exit(1);
});
