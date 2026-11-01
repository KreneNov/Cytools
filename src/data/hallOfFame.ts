export interface DonorEntry {
  id: string | number;
  name: string;
  role: 'PRO Member' | 'Donator' | 'Super Supporter';
  badgeType: 'pro' | 'coffee' | 'heart';
  amount?: string;
  message?: string;
  date: string;
  avatarColor: string;
}

export const HALL_OF_FAME_DATA: DonorEntry[] = [
  {
    id: 1,
    name: 'Phạm Cửu Long',
    role: 'PRO Member',
    badgeType: 'pro',
    amount: '5.000đ',
    message: 'Tool tải video Threads và TikTok mượt mà, tiện lợi lắm bạn!',
    date: '10/2026',
    avatarColor: 'from-pink-500 to-rose-600',
  },
  {
    id: 2,
    name: 'Nguyễn Lương Hải Nam',
    role: 'Super Supporter',
    badgeType: 'coffee',
    amount: '50.000đ',
    message: 'Mời Khánh cốc cà phê đá! Rất thích tính năng client-side không lưu file lên server.',
    date: '10/2026',
    avatarColor: 'from-amber-500 to-orange-600',
  },
  {
    id: 3,
    name: 'Nguyễn Minh Đức',
    role: 'PRO Member',
    badgeType: 'pro',
    amount: '5.000đ',
    message: 'Kích hoạt ủng hộ tác giả. Giao diện nhanh, mượt và rất thẩm mỹ.',
    date: '10/2026',
    avatarColor: 'from-blue-500 to-cyan-600',
  },
  {
    id: 4,
    name: 'Nguyễn Ngọc Bảo Minh',
    role: 'Donator',
    badgeType: 'coffee',
    amount: '20.000đ',
    message: 'Tính năng tách nền AI và nén PDF siêu tiện lợi cho dân thiết kế & văn phòng.',
    date: '10/2026',
    avatarColor: 'from-emerald-500 to-teal-600',
  },
  {
    id: 5,
    name: 'Lê Minh Vũ',
    role: 'PRO Member',
    badgeType: 'pro',
    amount: '5.000đ',
    message: 'Mới nâng cấp PRO, chúc dự án Cytools ngày càng phát triển hơn nữa!',
    date: '10/2026',
    avatarColor: 'from-purple-500 to-indigo-600',
  },
  {
    id: 6,
    name: 'Ngô Tiến Dũng',
    role: 'Donator',
    badgeType: 'heart',
    amount: '30.000đ',
    message: 'Ủng hộ bạn duy trì server và các tính năng mở rộng miễn phí.',
    date: '10/2026',
    avatarColor: 'from-rose-500 to-pink-600',
  },
];
