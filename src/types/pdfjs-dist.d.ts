declare module 'pdfjs-dist' {
  export interface PDFPageProxy {
    pageNumber: number;
    getViewport: (params: { scale: number; rotation?: number }) => {
      width: number;
      height: number;
    };
    render: (params: {
      canvasContext: CanvasRenderingContext2D | null;
      viewport: { width: number; height: number };
    }) => {
      promise: Promise<void>;
    };
  }

  export interface PDFDocumentProxy {
    numPages: number;
    getPage: (pageNumber: number) => Promise<PDFPageProxy>;
    destroy: () => Promise<void>;
  }

  export interface PDFDocumentLoadingTask {
    promise: Promise<PDFDocumentProxy>;
  }

  export function getDocument(src: string | Uint8Array | { data: Uint8Array }): PDFDocumentLoadingTask;

  export const GlobalWorkerOptions: {
    workerSrc: string;
    workerPort: unknown;
  };

  export const version: string;
}

declare module 'pdfjs-dist/build/pdf' {
  export * from 'pdfjs-dist';
}
