import React from 'react';
import { SocialDownloaderPage } from '../SocialDownloaderPage';
import { SeoLandingSection } from '../../components/seo/SeoLandingSection';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';

export const TikTokSeoPage: React.FC = () => {
  useDocumentMeta({
    title: 'Tải Video TikTok Không Logo, Không Watermark Miễn Phí 100% | Cytools',
    description:
      'Công cụ tải video TikTok không logo, không watermark miễn phí 100%. Tải trọn bộ album ảnh TikTok slideshow dạng file ZIP và tách nhạc nền MP3 chất lượng cao trên Cytools.',
    canonicalPath: '/tai-video-tiktok-khong-logo',
  });

  return (
    <div className="space-y-6">
      {/* 1. Main Tool at the Top */}
      <SocialDownloaderPage />

      {/* 2. Comprehensive Dark-themed SEO Section */}
      <SeoLandingSection
        badge="TikTok Downloader HD"
        h1="Tải Video TikTok Không Logo, Không Watermark Miễn Phí 100%"
        introParagraph="Cytools là công cụ trực tuyến hàng đầu giúp bạn tải video TikTok không dính logo (watermark), bóc tách ảnh TikTok Slideshow và trích xuất file âm thanh MP3 gốc với tốc độ tức thì, hoạt động 100% trong trình duyệt không cần cài đặt phần mềm."
        steps={[
          {
            step: 'Bước 1',
            title: 'Sao chép liên kết TikTok',
            description:
              'Mở ứng dụng hoặc trang web TikTok, tìm video hoặc album ảnh bạn muốn tải và nhấn nút Chia sẻ > Sao chép liên kết.',
          },
          {
            step: 'Bước 2',
            title: 'Dán liên kết vào Cytools',
            description:
              'Dán liên kết vừa sao chép vào khung nhập liệu phía trên và nhấn nút "Bắt đầu tải" để hệ thống phân tích dữ liệu.',
          },
          {
            step: 'Bước 3',
            title: 'Lưu video không logo về máy',
            description:
              'Chọn định dạng MP4 HD không logo hoặc tách bài nhạc MP3. Tệp sẽ được tải trực tiếp về thiết bị của bạn ngay lập tức.',
          },
        ]}
        faqs={[
          {
            question: 'Công cụ tải video TikTok trên Cytools có mất phí không?',
            answer:
              'Hoàn toàn miễn phí 100%! Bạn có thể tải không giới hạn số lượng video, ảnh slideshow và bài nhạc MP3 mỗi ngày mà không phải trả bất kỳ khoản phí nào.',
          },
          {
            question: 'Video TikTok tải về có dính logo hay ID tài khoản (watermark) không?',
            answer:
              'Không. Cytools kết nối trực tiếp đến luồng nội dung nguyên bản từ máy chủ CDN của TikTok để trích xuất file video gốc sắc nét nhất, loại bỏ hoàn toàn logo mờ và ID của tài khoản tác giả.',
          },
          {
            question: 'Cytools có lưu trữ video hay thông tin của tôi trên máy chủ không?',
            answer:
              'Không. Mọi tác vụ tải và chuyển đổi được điều hướng trực tiếp giữa thiết bị của bạn và nguồn CDN an toàn. Cytools cam kết bảo mật quyền riêng tư tuyệt đối và không lưu bất kỳ video hay lịch sử tải nào của bạn.',
          },
          {
            question: 'Tôi có thể tải trọn bộ album ảnh lướt (Slideshow) của TikTok không?',
            answer:
              'Có. Hệ thống hỗ trợ bóc tách toàn bộ các bức ảnh trong album Slideshow TikTok với độ phân giải tối đa. Bạn có thể chọn tải từng tấm ảnh hoặc tải trọn bộ gói gọn trong một file nén .ZIP kèm file âm thanh MP3 gốc.',
          },
          {
            question: 'Tôi có thể tải video TikTok trên iPhone hoặc Android không?',
            answer:
              'Hoàn toàn được. Cytools được tối ưu tương thích hoàn hảo với mọi trình duyệt di động như Safari trên iOS, Chrome trên Android và tất cả trình duyệt máy tính mà không cần cài đặt ứng dụng bổ sung.',
          },
        ]}
      />
    </div>
  );
};

export default TikTokSeoPage;
