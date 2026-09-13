import { describe, expect, it } from "vitest";
import { isAuthCallbackHash } from "./authCallback";

describe("isAuthCallbackHash", () => {
  it("recognises an implicit-flow magic-link callback", () => {
    expect(
      isAuthCallbackHash(
        "#access_token=eyJhbGc.abc&refresh_token=xyz&expires_in=3600&token_type=bearer&type=magiclink",
      ),
    ).toBe(true);
  });

  it("recognises an auth error callback", () => {
    expect(
      isAuthCallbackHash("#error_code=otp_expired&error_description=Email+link+is+invalid"),
    ).toBe(true);
  });

  it("treats ordinary route hashes as safe to rewrite", () => {
    for (const view of ["#overview", "#dispatch", "#intelligence", "#kpi", "", "#"])
      expect(isAuthCallbackHash(view)).toBe(false);
  });

  it("does not match a route that merely contains the word token", () => {
    expect(isAuthCallbackHash("#tokens")).toBe(false);
    expect(isAuthCallbackHash("#my_access_tokens")).toBe(false);
  });
});
