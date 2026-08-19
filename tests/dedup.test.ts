import { describe, expect, it } from "vitest";
import { canonicalizeCompanies } from "@/lib/dedup";

describe("canonicalizeCompanies", () => {
  it("merges duplicates by normalized domain", () => {
    const result = canonicalizeCompanies([
      { name: "VectorShield", website: "https://www.vectorshield.example/" },
      { name: "VectorShield Inc.", website: "vectorshield.example" },
      { name: "Cipherline", website: "cipherline.example" },
    ]);

    expect(result).toHaveLength(2);
    const vectorShield = result.find((r) => r.canonical.domain === "vectorshield.example")!;
    expect(vectorShield.sources).toHaveLength(2);
    expect(vectorShield.canonical.aliases).toContain("VectorShield");
    expect(vectorShield.canonical.aliases).toContain("VectorShield Inc.");
  });

  it("merges duplicates by normalized name when domains differ or are missing", () => {
    const result = canonicalizeCompanies([
      { name: "Cipherline", website: "" },
      { name: "Cipherline", website: "" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].sources).toHaveLength(2);
  });

  it("keeps distinct companies separate", () => {
    const result = canonicalizeCompanies([
      { name: "Alpha", website: "alpha.example" },
      { name: "Beta", website: "beta.example" },
    ]);
    expect(result).toHaveLength(2);
  });
});
