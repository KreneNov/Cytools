import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import {
  Film,
  Music,
  Video,
  FileVideo,
  Image as ImageIcon,
  Layers,
} from 'lucide-react';
import { AudioExtractorTab } from '../components/media-converter/AudioExtractorTab';
import { VideoTranscoderTab } from '../components/media-converter/VideoTranscoderTab';
import { GifCreatorTab } from '../components/media-converter/GifCreatorTab';
import { ImageConverterTab } from '../components/media-converter/ImageConverterTab';
import { PdfToolsTab } from '../components/media-converter/PdfToolsTab';

export type ConverterHubCategory = 'media' | 'image' | 'pdf';

export const ConverterHubPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawParam = searchParams.get('tab');
  const normalizedParam: ConverterHubCategory =
    rawParam === 'document' || rawParam === 'pdf'
      ? 'pdf'
      : rawParam === 'image'
      ? 'image'
      : 'media';

  const [activeMediaSubTab, setActiveMediaSubTab] = useState<'mp3' | 'mov-to-mp4' | 'gif'>('mp3');

  const handleSelectCategory = (cat: ConverterHubCategory) => {
    setSearchParams({ tab: cat }, { replace: true });
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          Trung Tâm Chuyển Đổi Đa Năng
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
          Chuyển đổi video, âm thanh, hình ảnh và tài liệu PDF 100% bảo mật trên trình duyệt mà không cần tải lên máy chủ.
        </p>
      </div>

      {/* Master Category Selector Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => handleSelectCategory('media')}
          className={`relative flex items-center gap-2 px-6 py-3.5 text-sm font-semibold transition-colors cursor-pointer ${
            normalizedParam === 'media'
              ? 'text-pink-600 dark:text-pink-400'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-900/50'
          }`}
        >
          {normalizedParam === 'media' && (
            <>
              <motion.div
                layoutId="converterMasterUnderline"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-pink-500 z-10"
                transition={{ type: 'spring', stiffness: 450, damping: 35 }}
              />
              <motion.div
                layoutId="converterMasterBg"
                className="absolute inset-0 bg-pink-500/5 z-0"
                transition={{ type: 'spring', stiffness: 450, damping: 35 }}
              />
            </>
          )}
          <span className="relative z-10 flex items-center gap-2">
            <Film className="w-4 h-4" />
            <span>Video & Âm thanh</span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleSelectCategory('image')}
          className={`relative flex items-center gap-2 px-6 py-3.5 text-sm font-semibold transition-colors cursor-pointer ${
            normalizedParam === 'image'
              ? 'text-pink-600 dark:text-pink-400'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-900/50'
          }`}
        >
          {normalizedParam === 'image' && (
            <>
              <motion.div
                layoutId="converterMasterUnderline"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-pink-500 z-10"
                transition={{ type: 'spring', stiffness: 450, damping: 35 }}
              />
              <motion.div
                layoutId="converterMasterBg"
                className="absolute inset-0 bg-pink-500/5 z-0"
                transition={{ type: 'spring', stiffness: 450, damping: 35 }}
              />
            </>
          )}
          <span className="relative z-10 flex items-center gap-2">
            <ImageIcon className="w-4 h-4" />
            <span>Hình ảnh</span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleSelectCategory('pdf')}
          className={`relative flex items-center gap-2 px-6 py-3.5 text-sm font-semibold transition-colors cursor-pointer ${
            normalizedParam === 'pdf'
              ? 'text-pink-600 dark:text-pink-400'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-900/50'
          }`}
        >
          {normalizedParam === 'pdf' && (
            <>
              <motion.div
                layoutId="converterMasterUnderline"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-pink-500 z-10"
                transition={{ type: 'spring', stiffness: 450, damping: 35 }}
              />
              <motion.div
                layoutId="converterMasterBg"
                className="absolute inset-0 bg-pink-500/5 z-0"
                transition={{ type: 'spring', stiffness: 450, damping: 35 }}
              />
            </>
          )}
          <span className="relative z-10 flex items-center gap-2">
            <Layers className="w-4 h-4" />
            <span>Công cụ PDF</span>
          </span>
        </button>
      </div>

      {/* Category Views with Smooth Tab Entrance */}
      <AnimatePresence mode="wait">
        {normalizedParam === 'media' && (
          <motion.div
            key="media"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="space-y-6"
          >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveMediaSubTab('mp3')}
              className={`relative inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                activeMediaSubTab === 'mp3'
                  ? 'text-white'
                  : 'border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {activeMediaSubTab === 'mp3' && (
                <motion.div
                  layoutId="mediaSubTabPill"
                  className="absolute inset-0 rounded-xl bg-pink-500 z-0"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                <Music className="w-3.5 h-3.5" />
                <span>Tách nhạc MP3</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveMediaSubTab('mov-to-mp4')}
              className={`relative inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                activeMediaSubTab === 'mov-to-mp4'
                  ? 'text-white'
                  : 'border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {activeMediaSubTab === 'mov-to-mp4' && (
                <motion.div
                  layoutId="mediaSubTabPill"
                  className="absolute inset-0 rounded-xl bg-pink-500 z-0"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                <FileVideo className="w-3.5 h-3.5" />
                <span>Đổi MOV sang MP4</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveMediaSubTab('gif')}
              className={`relative inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                activeMediaSubTab === 'gif'
                  ? 'text-white'
                  : 'border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {activeMediaSubTab === 'gif' && (
                <motion.div
                  layoutId="mediaSubTabPill"
                  className="absolute inset-0 rounded-xl bg-pink-500 z-0"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                <Video className="w-3.5 h-3.5" />
                <span>Tạo ảnh động GIF</span>
              </span>
            </button>
          </div>

            <AnimatePresence mode="wait">
              {activeMediaSubTab === 'mp3' && (
                <motion.div
                  key="sub-mp3"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                >
                  <AudioExtractorTab />
                </motion.div>
              )}
              {activeMediaSubTab === 'mov-to-mp4' && (
                <motion.div
                  key="sub-mov-to-mp4"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                >
                  <VideoTranscoderTab />
                </motion.div>
              )}
              {activeMediaSubTab === 'gif' && (
                <motion.div
                  key="sub-gif"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                >
                  <GifCreatorTab />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* Image Category View */}
        {normalizedParam === 'image' && (
          <motion.div
            key="image"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <ImageConverterTab />
          </motion.div>
        )}

        {/* PDF Tools Category View */}
        {normalizedParam === 'pdf' && (
          <motion.div
            key="pdf"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <PdfToolsTab />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ConverterHubPage;
