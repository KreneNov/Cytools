import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WatermarkHeader } from '../components/watermark-remover/WatermarkHeader';
import { WatermarkTabSelector } from '../components/watermark-remover/WatermarkTabSelector';
import { ImageWatermarkView } from '../components/watermark-remover/ImageWatermarkView';
import { PdfWatermarkView } from '../components/watermark-remover/PdfWatermarkView';
import { PptxWatermarkView } from '../components/watermark-remover/PptxWatermarkView';
import type { WatermarkTab } from '../types/watermarkRemover';

interface WatermarkRemoverPageProps {
  isCompact?: boolean;
}

export const WatermarkRemoverPage: React.FC<WatermarkRemoverPageProps> = ({
  isCompact = false,
}) => {
  const [activeTab, setActiveTab] = useState<WatermarkTab>('image');

  return (
    <div className={`max-w-6xl mx-auto space-y-6 ${isCompact ? 'p-2 pb-6' : 'pb-12'}`}>
      {/* Header */}
      <WatermarkHeader isCompact={isCompact} />

      {/* Tab Selector */}
      <WatermarkTabSelector activeTab={activeTab} onChangeTab={setActiveTab} />

      {/* Main Engine Workspace */}
      <div className="relative">
        <AnimatePresence mode="wait">
          {activeTab === 'image' && (
            <motion.div
              key="image-engine"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <ImageWatermarkView isCompact={isCompact} />
            </motion.div>
          )}

          {activeTab === 'pdf' && (
            <motion.div
              key="pdf-engine"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <PdfWatermarkView isCompact={isCompact} />
            </motion.div>
          )}

          {activeTab === 'pptx' && (
            <motion.div
              key="pptx-engine"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <PptxWatermarkView isCompact={isCompact} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default WatermarkRemoverPage;
