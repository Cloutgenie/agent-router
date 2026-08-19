import { Company } from "@/types";

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function normalizeDomain(website: string): string {
  return website.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

/**
 * Company canonicalization + deduplication (V4 #26-27). Live providers
 * commonly return the same company more than once (different discovery
 * queries, different providers); this merges duplicates by domain first
 * (most reliable), then normalized name, keeping every alias seen rather
 * than silently discarding the losing record's identity.
 */
export function canonicalizeCompanies<T extends { name: string; website: string }>(
  companies: T[]
): { canonical: Company; sources: T[] }[] {
  const byDomain = new Map<string, { canonical: Company; sources: T[] }>();
  const byName = new Map<string, { canonical: Company; sources: T[] }>();
  const result: { canonical: Company; sources: T[] }[] = [];

  for (const company of companies) {
    const domain = normalizeDomain(company.website);
    const normalizedName = normalizeName(company.name);
    const existing = (domain && byDomain.get(domain)) || byName.get(normalizedName);

    if (existing) {
      existing.sources.push(company);
      if (!existing.canonical.aliases.includes(company.name)) {
        existing.canonical.aliases.push(company.name);
      }
      continue;
    }

    const entry = {
      canonical: {
        id: `co-${normalizedName}`,
        name: company.name,
        normalizedName,
        domain: domain || undefined,
        website: company.website,
        aliases: [company.name],
      },
      sources: [company],
    };
    result.push(entry);
    if (domain) byDomain.set(domain, entry);
    byName.set(normalizedName, entry);
  }

  return result;
}
