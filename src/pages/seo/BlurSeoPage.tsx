import React from 'react';
import { BlurEditor } from '../../components/tools/BlurEditor';
import { SeoLandingSection } from '../../components/seo/SeoLandingSection';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';

export const BlurSeoPage: React.FC = () => {
  useDocumentMeta({
    title: 'Làm Mờ Ảnh & Tạo Vệt Chuyển Động (Motion Blur) Online Miễn Phí | Cytools',
    description:
      'Làm mờ ảnh online miễn phí và tạo hiệu ứng vệt chuyển động (Motion Blur) nghệ thuật chuẩn Hypic. 100% xử lý bằng HTML5 Canvas trong trình duyệt, bảo mật ảnh tuyệt đối.',
    canonicalPath: '/lam-mo-anh-online',
  });

  return (
    <div className="space-y-6">
      {/* 1. Main Tool at the Top */}
      <BlurEditor />

      {/* 2. Comprehensive Dark-themed SEO Section */}
      <SeoLandingSection
        badge="Hypic Motion Blur Studio"
        h1="Làm Mờ Ảnh & Tạo Vệt Chuyển Động (Motion Blur) Online Miễn Phí"
        introParagraph="Dễ dàng bôi mờ các chi tiết nhạy cảm như biển số xe, khuôn mặt, thông tin cá nhân hoặc tạo vệt mờ chuyển động (Motion Blur) đậm chất điện ảnh chuẩn phong cách ứng dụng Hypic. Xử lý trực tiếp 100% bằng Canvas trong trình duyệt với tốc độ 60fps, ảnh của bạn không bao giờ rời khỏi thiết bị."
        steps={[
          {
            step: 'Bước 1',
            title: 'Tải ảnh cần chỉnh sửa',
            description:
              'Nhấn nút "Tải Ảnh Lên" hoặc kéo thả ảnh trực tiếp vào khung làm việc. Hỗ trợ đầy đủ PNG, JPG, JPEG, WebP độ phân giải cao.',
          },
          {
            step: 'Bước 2',
            title: 'Bôi cọ mờ lên vùng mong muốn',
            description:
              'Chọn chế độ "Cọ Mờ Thường" hoặc "Mờ Chuyển Động", tùy chỉnh kích thước đầu cọ và góc chuyển động (0°, 45°, 90°, 135°), sau đó bôi cọ trực tiếp lên ảnh.',
          },
          {
            step: 'Bước 3',
            title: 'Lưu ảnh đã làm mờ về máy',
            description:
              'Kiểm tra lại kết quả (có thể nhấn giữ nút "So sánh Ảnh Gốc" hoặc Hoàn tác nếu muốn), sau đó bấm "Tải Ảnh Xuống (.PNG)" để lưu ảnh chất lượng cao.',
          },
        ]}
        faqs={[
          {
            question: 'Ảnh của tôi có bị tải lên máy chủ của Cytools không?',
            answer:
              'Hoàn toàn không! Cytools sử dụng công nghệ HTML5 Canvas Layering xử lý hoàn toàn cục bộ trên CPU/GPU của máy tính hoặc điện thoại bạn (Client-Side). Ảnh không bao giờ được gửi qua mạng hay lưu lại trên bất kỳ máy chủ nào, đảm bảo an toàn riêng tư 100%.',
          },
          {
            question: 'Hiệu ứng Mờ Chuyển Động (Motion Blur) hoạt động như thế nào?',
            answer:
              'Thuật toán Directional Motion Blur tính toán dịch chuyển 40 bước lặp dọc theo véc-tơ góc chuyển động bạn chọn, kết hợp viền cọ lông vũ mềm mại (feathered mask) để tạo ra vệt chuyển động mượt mà tự nhiên tương tự hiệu ứng brush trên Hypic.',
          },
          {
            question: 'Nếu tôi vẽ nhầm thì có sửa lại được không?',
            answer:
              'Có. Hệ thống tích hợp sẵn nút "Hoàn tác (Undo)" để bạn quay lui từng nét cọ trước đó. Ngoài ra, bạn có thể chuyển sang chế độ "Tẩy Khôi Phục" để xóa bớt vùng mờ thừa mà không ảnh hưởng đến các vùng mờ khác.',
          },
          {
            question: 'Công cụ có giới hạn số lần làm mờ hay kích thước ảnh không?',
            answer:
              'Không giới hạn số lần sử dụng. Công cụ hỗ trợ xử lý ảnh sắc nét lên đến chuẩn 2K/4K mà vẫn duy trì tốc độ vẽ mượt mà 60 khung hình/giây.',
          },
        ]}
      />
    </div>
  );
};

export default BlurSeoPage;
