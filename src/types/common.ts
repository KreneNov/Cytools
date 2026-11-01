export type ToolStatus = 'active' | 'coming_soon' | 'pro_only';

export interface UtilityTool {
  id: string;
  name: string;
  tagline: string;
  description: string;
  path: string;
  icon: string;
  badge?: string;
  category: 'media' | 'document' | 'ai';
  status: ToolStatus;
  accentColor: string;
}

export interface ProState {
  isPro: boolean;
  proSince?: string;
  transactionId?: string;
}
