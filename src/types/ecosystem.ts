export interface EcosystemPartner {
  id: "cc2" | "calcinfinity" | "anantamarg";
  name: string;
  tagline: string;
  description: string;
  baseUrl: string;
  brandColor: string;
  badgeLabel: string;
}

export interface ContextualWidgetProps {
  partnerId: "cc2" | "calcinfinity" | "anantamarg";
  title: string;
  subtitle?: string;
  targetUrl: string;
  actionText: string;
  className?: string;
}
