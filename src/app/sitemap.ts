import { MetadataRoute } from "next";
import { getAllVerifiedOpportunitiesWithCMS } from "@/lib/repository";
import { siteConfig } from "@/config/site";

// Built on every request, from the same public query as the job list. As a
// cached file it was refreshed on publish locally, but on Vercel it stayed as
// the deploy built it: a job published at 06:28 on 21 Oct 2026 was still
// missing two hours later, and a job taken off the site would have stayed
// listed. One query, fetched mostly by search engines.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = siteConfig.url;
  const opportunities = await getAllVerifiedOpportunitiesWithCMS();

  // Dynamic job pages
  const jobUrls: MetadataRoute.Sitemap = opportunities.map((job) => ({
    url: `${baseUrl}/jobs/${job.slug}`,
    lastModified: new Date(job.provenance.lastVerifiedAt || new Date()),
    changeFrequency: "daily",
    priority: 0.8,
  }));

  // Static directory and tool pages
  const staticUrls: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/jobs`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/exams`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/eligibility`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/results`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/admit-cards`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/answer-keys`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/companies`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  return [...staticUrls, ...jobUrls];
}
