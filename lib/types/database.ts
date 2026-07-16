export interface Page {
  id: string;
  title: string;
  slug: string;
  is_visible: boolean;
  menu_order: number | null;
  intro_text: Record<string, unknown> | null;
  banner_url: string | null;
  banner_position_x: number;
  banner_position_y: number;
  created_at: string;
  updated_at: string;
}

export interface ContentBlock {
  id: string;
  page_id: string;
  type: string;
  title: string | null;
  content: Record<string, unknown>;
  sort_order: number;
  timestamp: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageImage {
  id: string;
  page_id: string;
  image_url: string;
  position_x: number;
  position_y: number;
  aspect_ratio: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type LandingItemType = "slide" | "tile";

export interface LandingItem {
  id: string;
  type: LandingItemType;
  title: string | null;
  image_url: string;
  link_url: string | null;
  image_position_x: number;
  image_position_y: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SiteSetting {
  id: string;
  key: string;
  value: string;
  updated_at: string;
}
