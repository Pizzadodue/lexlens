// test/analyse.test.ts
import { describe, it, expect } from "@jest/globals";
import { buildCacheKey } from "../src/services/cache.js";
import { AnalyseRequestSchema, validateAllowlists, SUPPORTED_LANGUAGES, SUPPORTED_JURISDICTIONS } from "../src/schemas/analyse.js";
import { Errors } from "../src/errors.js";

describe("buildCacheKey", () => {
  it("produces the canonical key format", () => {
    const key = buildCacheKey({
      content_hash: "a".repeat(64),
      language: "en",
      jurisdiction: "US",
    });
    expect(key).toBe(`cache:${"a".repeat(64)}:en:US`);
  });

  it("differentiates by language", () => {
    const base = { content_hash: "b".repeat(64), jurisdiction: "GB" };
    const en = buildCacheKey({ ...base, language: "en" });
    const nl = buildCacheKey({ ...base, language: "nl" });
    expect(en).not.toBe(nl);
  });

  it("differentiates by jurisdiction", () => {
    const base = { content_hash: "c".repeat(64), language: "en" };
    const us = buildCacheKey({ ...base, jurisdiction: "US" });
    const gb = buildCacheKey({ ...base, jurisdiction: "GB" });
    expect(us).not.toBe(gb);
  });
});

describe("AnalyseRequestSchema", () => {
  const validRequest = {
    text: "x".repeat(800),
    content_hash: "a".repeat(64),
    language: "en",
    jurisdiction: "US",
    source_url: "https://www.congress.gov/bill/119th-congress/house-bill/1",
  };

  it("accepts a valid request", () => {
    const result = AnalyseRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it("rejects text below minimum length", () => {
    const result = AnalyseRequestSchema.safeParse({ ...validRequest, text: "short" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("TEXT_TOO_SHORT");
  });

  it("rejects invalid content_hash format", () => {
    const result = AnalyseRequestSchema.safeParse({ ...validRequest, content_hash: "notahash" });
    expect(result.success).toBe(false);
  });

  it("rejects missing language", () => {
    const { language: _language, ...rest } = validRequest;
    const result = AnalyseRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing jurisdiction", () => {
    const { jurisdiction: _jurisdiction, ...rest } = validRequest;
    const result = AnalyseRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("validateAllowlists", () => {
  it("returns null for supported language + jurisdiction", () => {
    expect(validateAllowlists("en", "US")).toBeNull();
    expect(validateAllowlists("en", "GB")).toBeNull();
  });

  it("returns UNSUPPORTED_LANGUAGE error for unknown language", () => {
    const err = validateAllowlists("zz", "US");
    expect(err?.code).toBe("UNSUPPORTED_LANGUAGE");
    expect(err?.extra?.supportedLanguages).toEqual([...SUPPORTED_LANGUAGES]);
  });

  it("returns UNSUPPORTED_JURISDICTION error for unknown jurisdiction", () => {
    const err = validateAllowlists("en", "XX");
    expect(err?.code).toBe("UNSUPPORTED_JURISDICTION");
    expect(err?.extra?.supportedJurisdictions).toEqual([...SUPPORTED_JURISDICTIONS]);
  });
});

describe("Errors", () => {
  it("toResponse() includes supportedJurisdictions", () => {
    const err = Errors.unsupportedJurisdiction("XX", ["US", "GB"]);
    const resp = err.toResponse();
    expect(resp.supportedJurisdictions).toEqual(["US", "GB"]);
  });

  it("toResponse() includes supportedLanguages", () => {
    const err = Errors.unsupportedLanguage("zz", ["en"]);
    const resp = err.toResponse();
    expect(resp.supportedLanguages).toEqual(["en"]);
  });
});
