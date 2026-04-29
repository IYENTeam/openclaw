import { describe, expect, it } from "vitest";
import { effectiveBudget, lookupProviderHardCap } from "./provider-cap-registry.js";

describe("lookupProviderHardCap", () => {
  it("returns the qualified cap when provider/model exact match exists", () => {
    expect(lookupProviderHardCap({ provider: "openai-codex", model: "gpt-5.5" })).toBe(200_000);
    expect(
      lookupProviderHardCap({
        provider: "closedrouter-openai",
        model: "gpt-4o-mini",
      }),
    ).toBe(128_000);
  });

  it("falls back to provider-level cap when qualified entry is missing", () => {
    expect(lookupProviderHardCap({ provider: "openai-codex", model: "gpt-5.7-future" })).toBe(
      200_000,
    );
    expect(
      lookupProviderHardCap({
        provider: "closedrouter-zai",
        model: "glm-9-future",
      }),
    ).toBe(200_000);
  });

  it("returns the larger 1M cap for closedrouter-gemini", () => {
    expect(
      lookupProviderHardCap({
        provider: "closedrouter-gemini",
        model: "gemini-2.5-pro",
      }),
    ).toBe(1_000_000);
    expect(
      lookupProviderHardCap({
        provider: "closedrouter-gemini",
        model: "gemini-3-future",
      }),
    ).toBe(1_000_000);
  });

  it("returns undefined for unregistered providers/models", () => {
    expect(lookupProviderHardCap({ provider: "unknown-vendor", model: "xyz-1" })).toBeUndefined();
    expect(lookupProviderHardCap({ provider: "", model: "" })).toBeUndefined();
  });

  it("returns 200k for Anthropic Opus/Sonnet-4 when context1m is NOT requested", () => {
    expect(
      lookupProviderHardCap({
        provider: "anthropic",
        model: "claude-opus-4-6",
      }),
    ).toBe(200_000);
    expect(
      lookupProviderHardCap({
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      }),
    ).toBe(200_000);
  });

  it("returns 1M for Anthropic Opus/Sonnet-4 when context1m is requested with api-key auth", () => {
    expect(
      lookupProviderHardCap({
        provider: "anthropic",
        model: "claude-opus-4-6",
        context1mRequested: true,
        credentialMode: "api-key",
      }),
    ).toBe(1_048_576);
  });

  it("clamps Anthropic 1M back to 200k when credential is OAuth/CLI/token/mixed/unknown", () => {
    for (const credentialMode of ["oauth", "token", "mixed", "unknown"] as const) {
      expect(
        lookupProviderHardCap({
          provider: "anthropic",
          model: "claude-opus-4-6",
          context1mRequested: true,
          credentialMode,
        }),
      ).toBe(200_000);
    }
  });

  it("returns 1M when credential mode is omitted and context1m is requested (caller is responsible for the conservative gate)", () => {
    expect(
      lookupProviderHardCap({
        provider: "anthropic",
        model: "claude-opus-4-6",
        context1mRequested: true,
      }),
    ).toBe(1_048_576);
  });

  it("does not apply 1M for non-Opus/Sonnet-4 Anthropic models even with context1m+api-key", () => {
    expect(
      lookupProviderHardCap({
        provider: "anthropic",
        model: "claude-haiku-4",
        context1mRequested: true,
        credentialMode: "api-key",
      }),
    ).toBeUndefined();
  });
});

describe("effectiveBudget", () => {
  it("returns the smaller of configured and hardCap", () => {
    expect(effectiveBudget({ configuredBudget: 800_000, hardCap: 200_000 })).toBe(200_000);
    expect(effectiveBudget({ configuredBudget: 100_000, hardCap: 200_000 })).toBe(100_000);
  });

  it("returns whichever is defined when only one is provided", () => {
    expect(effectiveBudget({ configuredBudget: 50_000 })).toBe(50_000);
    expect(effectiveBudget({ hardCap: 200_000 })).toBe(200_000);
  });

  it("returns undefined when neither is provided or both are invalid", () => {
    expect(effectiveBudget({})).toBeUndefined();
    expect(effectiveBudget({ configuredBudget: 0, hardCap: -1 })).toBeUndefined();
    expect(effectiveBudget({ configuredBudget: NaN, hardCap: NaN })).toBeUndefined();
  });

  it("ignores non-finite or non-positive inputs", () => {
    expect(effectiveBudget({ configuredBudget: -1, hardCap: 200_000 })).toBe(200_000);
    expect(effectiveBudget({ configuredBudget: 100_000, hardCap: 0 })).toBe(100_000);
  });
});
