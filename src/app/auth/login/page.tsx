import { safeNextPath } from "@/lib/goat-app";
import LoginClient from "./login-client";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const verify = params.verify;
  const verifyNotice = Array.isArray(verify) ? verify.includes("1") : verify === "1";
  const disabled = params.disabled;
  const disabledNotice = Array.isArray(disabled) ? disabled.includes("1") : disabled === "1";

  const nextRaw = Array.isArray(params.next) ? params.next[0] : params.next;
  // Only the G.O.A.T. app path is allowed (no open redirects).
  const next = safeNextPath(nextRaw) ?? undefined;

  return <LoginClient verifyNotice={verifyNotice} disabledNotice={disabledNotice} next={next} />;
}
