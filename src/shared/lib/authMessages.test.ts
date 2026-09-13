import { describe, expect, test } from "vitest";
import { passwordSignInMessage } from "./authMessages";

describe("password sign-in messages", () => {
  test("a successful sign-in has no message", () => {
    expect(passwordSignInMessage(null)).toBeNull();
    expect(passwordSignInMessage(undefined)).toBeNull();
  });

  test("wrong credentials do not reveal whether the account exists", () => {
    const byCode = passwordSignInMessage({ code: "invalid_credentials", message: "Invalid login credentials", status: 400 });
    const byMessageOnly = passwordSignInMessage({ message: "Invalid login credentials", status: 400 });
    expect(byCode).toBe("Email or password is incorrect.");
    expect(byMessageOnly).toBe(byCode);
    expect(byCode).not.toMatch(/not found|no account|does not exist|unknown/i);
  });

  test("an unconfirmed email points to the email link", () => {
    expect(passwordSignInMessage({ code: "email_not_confirmed", status: 400 })).toMatch(/Email link/);
  });

  test("rate limits ask the person to wait", () => {
    expect(passwordSignInMessage({ code: "over_request_rate_limit", status: 429 })).toMatch(/Wait a minute/);
    expect(passwordSignInMessage({ status: 429 })).toMatch(/Wait a minute/);
  });

  test("a disabled account is named as such", () => {
    expect(passwordSignInMessage({ code: "user_banned", status: 400 })).toMatch(/disabled/);
  });

  test("network failures are distinguished from wrong credentials", () => {
    expect(passwordSignInMessage({ message: "Failed to fetch", status: 0 })).toMatch(/could not reach/);
  });

  test("anything else falls back to a generic message without provider text", () => {
    const message = passwordSignInMessage({ code: "unexpected_failure", message: "database error querying schema", status: 500 });
    expect(message).toBe("Sign-in failed. Try again, or use Email link.");
  });
});
