import React from 'react';
import { SocialDownloaderPage } from '../SocialDownloaderPage';
import { SeoLandingSection } from '../../components/seo/SeoLandingSection';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';

export const YouTubeSeoPage: React.FC = () => {
  useDocumentMeta({
    title: 'Tải Video YouTube 1080p Full HD & MP3 Tốc Độ Cao | Cytools',
    description:
      'Tải video YouTube 1080p Full HD kèm âm thanh gốc chuẩn Faststart và tách nhạc MP3 320kbps miễn phí không quảng cáo trên Cytools.',
    canonicalPath: '/tai-video-youtube-1080p',
  });

  return (
    <div className="space-y-6">
      {/* 1. Main Tool at the Top */}
      <SocialDownloaderPage />

      {/* 2. Comprehensive Dark-themed SEO Section */}
      <SeoLandingSection
        badge="YouTube 1080p & MP3 Studio"
        h1="Tải Video YouTube 1080p Full HD & MP3 Tốc Độ Cao"
        introParagraph="Tải video YouTube độ phân giải Full HD 1080p, 720p và trích xuất âm thanh MP3 320kbps nhanh nhất trực tiếp từ trình duyệt của bạn. Tự động ghép nối video và âm thanh chuẩn xác, không quảng cáo pop-up, bảo mật tuyệt đối 100%."
        steps={[
          {
            step: 'Bước 1',
            title: 'Sao chép liên kết video YouTube',
            description:
              'Mở YouTube trên máy tính hoặc ứng dụng điện thoại, chọn video hoặc YouTube Shorts bạn cần tải và sao chép đường dẫn (URL).',
          },
          {
            step: 'Bước 2',
            title: 'Dán liên kết vào Cytools',
            description:
              'Dán liên kết video vào ô tìm kiếm ở trên và bấm "Bắt đầu tải". Hệ thống sẽ bóc tách danh sách các chất lượng sẵn có.',
          },
          {
            step: 'Bước 3',
            title: 'Chọn độ phân giải và lưu video',
            description:
              'Nhấn "Tải 1080p" để tải video Full HD sắc nét nhất hoặc chọn "Tải MP3" để lưu file âm thanh độc lập về máy.',
          },
        ]}
        faqs={[
          {
            question: 'Tải video YouTube trên Cytools có mất phí không?',
            answer:
              'Hoàn toàn miễn phí. Bạn có thể thoải mái tải video YouTube 1080p, 720p và nhạc MP3 không giới hạn số lượng và không phải đăng ký tài khoản.',
          },
          {
            question: 'Video 1080p tải về có đầy đủ cả hình ảnh và âm thanh không?',
            answer:
              'Có. Khác với nhiều trang web tải khác chỉ tải được hình ảnh câm ở chuẩn 1080p, Cytools tự động đồng bộ hóa và ghép kênh luồng video 1080p cùng luồng âm thanh gốc chất lượng cao theo chuẩn MP4 Faststart để bạn mở xem mượt mà trên mọi thiết bị.',
          },
          {
            question: 'Công cụ có hỗ trợ tải YouTube Shorts không?',
            answer:
              'Có! Cytools hỗ trợ đầy đủ tất cả các định dạng video ngắn YouTube Shorts, video phát sóng dài, và danh sách phát với đường dẫn tiêu chuẩn.',
          },
          {
            question: 'File video có được lưu trên máy chủ của website không?',
            answer:
              'Không. Mọi dữ liệu phân giải trực tiếp thông qua luồng an toàn từ người dùng đến CDN, Cytools tuyệt đối không thu thập hoặc lưu trữ file video của bạn.',
          },
          {
            question: 'Chất lượng âm thanh khi tải định dạng MP3 là bao nhiêu?',
            answer:
              'Hệ thống trích xuất luồng âm thanh nguyên bản từ nguồn YouTube với bitrate lên đến 320kbps / 192kbps (tùy theo chất lượng bài nhạc gốc được người đăng tải tải lên).',
          },
        ]}
      />
    </div>
  );
};

export default YouTubeSeoPage;
