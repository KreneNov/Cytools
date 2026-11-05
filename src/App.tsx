import React, { useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { ProProvider } from './context/ProContext';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { HomePage } from './pages/HomePage';
import { SocialDownloaderPage } from './pages/SocialDownloaderPage';
import { RemoveBgPage } from './pages/RemoveBgPage';
import { ConverterHubPage } from './pages/ConverterHubPage';
import { WatermarkRemoverPage } from './pages/WatermarkRemoverPage';
import { BlurEditorPage } from './pages/BlurEditorPage';
import { HallOfFamePage } from './pages/HallOfFamePage';
import { ExtensionPopupView } from './components/extension/ExtensionPopupView';

export const App: React.FC = () => {
  const isExtension = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('popup') === 'true') return true;
    if (window.location.protocol === 'chrome-extension:') return true;
    const chromeApi = (window as unknown as { chrome?: any }).chrome;
    return Boolean(chromeApi?.runtime?.id && window.innerWidth <= 800);
  }, []);

  if (isExtension) {
    return (
      <ThemeProvider>
        <ProProvider>
          <ExtensionPopupView />
        </ProProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <ProProvider>
        <BrowserRouter>
          <DashboardLayout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/social-downloader" element={<SocialDownloaderPage />} />
              <Route path="/downloader" element={<Navigate to="/social-downloader" replace />} />
              <Route path="/video-downloader" element={<Navigate to="/social-downloader" replace />} />
              <Route path="/remove-bg" element={<RemoveBgPage />} />
              <Route path="/watermark-remover" element={<WatermarkRemoverPage />} />
              <Route path="/xoa-watermark" element={<Navigate to="/watermark-remover" replace />} />
              <Route path="/remove-watermark" element={<Navigate to="/watermark-remover" replace />} />
              <Route path="/blur-brush" element={<BlurEditorPage />} />
              <Route path="/blur-editor" element={<Navigate to="/blur-brush" replace />} />
              <Route path="/lam-mo-anh" element={<Navigate to="/blur-brush" replace />} />
              <Route path="/converter" element={<ConverterHubPage />} />
              <Route path="/converter-hub" element={<Navigate to="/converter" replace />} />
              <Route path="/media-converter" element={<Navigate to="/converter" replace />} />
              <Route path="/convert-media" element={<Navigate to="/converter" replace />} />
              <Route path="/pdf-tools" element={<Navigate to="/converter?tab=pdf" replace />} />
              <Route path="/pdf-to-pptx" element={<Navigate to="/converter?tab=pdf" replace />} />
              <Route path="/hall-of-fame" element={<HallOfFamePage />} />
              <Route path="/vinh-danh" element={<Navigate to="/hall-of-fame" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </DashboardLayout>
        </BrowserRouter>
      </ProProvider>
    </ThemeProvider>
  );
};

export default App;
