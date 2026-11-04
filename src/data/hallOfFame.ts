export interface DonorEntry {
  id: string | number;
  name: string;
  role: 'PRO Member' | 'Donator' | 'Super Supporter';
  badgeType: 'pro' | 'coffee' | 'heart';
  badge?: 'PRO' | 'DONOR';
  type?: 'PRO' | 'DONOR';
  isPro?: boolean;
  amount?: string;
  message?: string;
  date: string;
  avatarColor: string;
}

export const HALL_OF_FAME_DATA: DonorEntry[] = [];
