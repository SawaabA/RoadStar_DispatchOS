// Supabase Auth reports failures with codes and messages written for
// developers. Sign-in shows people what to do next, and never says whether an
// account exists for the email that was entered.

export type AuthFailure = { code?: string; message?: string; status?: number } | null | undefined;

export function passwordSignInMessage(error: AuthFailure): string | null {
  if (!error) return null;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();

  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "Email or password is incorrect.";
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "This email address has not been confirmed yet. Use Email link to confirm it and sign in.";
  }
  if (code.startsWith("over_") || error.status === 429) {
    return "Too many sign-in attempts. Wait a minute and try again.";
  }
  if (code === "user_banned") {
    return "This account is disabled. Contact your RoadStar administrator.";
  }
  // supabase-js reports a network failure with status 0.
  if (error.status === 0 || message.includes("failed to fetch") || message.includes("network")) {
    return "RoadStar could not reach the sign-in service. Check your connection and try again.";
  }
  return "Sign-in failed. Try again, or use Email link.";
}
