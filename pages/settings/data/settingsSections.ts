import { Settings, Building2, Palette, Shield, Bell } from "lucide-react";
import type { SettingsNavigationItem } from "../../../lib/types/domain";

export const SETTINGS_SECTIONS = [
  {
    id: "general",
    label: "General",
    icon: Settings,
  },
  {
    id: "company",
    label: "Company",
    icon: Building2,
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: Palette,
  },
  {
    id: "security",
    label: "Security",
    icon: Shield,
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
  },
] satisfies SettingsNavigationItem[];
