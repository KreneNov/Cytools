import { useEffect } from 'react';

export interface DocumentMetaOptions {
  title: string;
  description: string;
  canonicalPath?: string;
}

/**
 * Dynamically updates document.title, meta[name="description"], OpenGraph tags,
 * and canonical link for client-side SEO landing pages, restoring previous tags upon unmount.
 */
export function useDocumentMeta({ title, description, canonicalPath }: DocumentMetaOptions): void {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;

    // 1. Meta Description
    let descTag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDesc = descTag?.getAttribute('content') || '';
    if (!descTag) {
      descTag = document.createElement('meta');
      descTag.name = 'description';
      document.head.appendChild(descTag);
    }
    descTag.setAttribute('content', description);

    // 2. OpenGraph Title
    let ogTitleTag = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
    const prevOgTitle = ogTitleTag?.getAttribute('content') || '';
    if (!ogTitleTag) {
      ogTitleTag = document.createElement('meta');
      ogTitleTag.setAttribute('property', 'og:title');
      document.head.appendChild(ogTitleTag);
    }
    ogTitleTag.setAttribute('content', title);

    // 3. OpenGraph Description
    let ogDescTag = document.querySelector<HTMLMetaElement>('meta[property="og:description"]');
    const prevOgDesc = ogDescTag?.getAttribute('content') || '';
    if (!ogDescTag) {
      ogDescTag = document.createElement('meta');
      ogDescTag.setAttribute('property', 'og:description');
      document.head.appendChild(ogDescTag);
    }
    ogDescTag.setAttribute('content', description);

    // 4. Canonical URL
    let canonicalTag = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const prevCanonical = canonicalTag?.getAttribute('href') || '';
    if (canonicalPath) {
      if (!canonicalTag) {
        canonicalTag = document.createElement('link');
        canonicalTag.rel = 'canonical';
        document.head.appendChild(canonicalTag);
      }
      canonicalTag.setAttribute('href', `https://cytools.io.vn${canonicalPath}`);
    }

    return () => {
      document.title = prevTitle;
      if (descTag && prevDesc) descTag.setAttribute('content', prevDesc);
      if (ogTitleTag && prevOgTitle) ogTitleTag.setAttribute('content', prevOgTitle);
      if (ogDescTag && prevOgDesc) ogDescTag.setAttribute('content', prevOgDesc);
      if (canonicalTag && prevCanonical) canonicalTag.setAttribute('href', prevCanonical);
    };
  }, [title, description, canonicalPath]);
}
