import { execFileSync } from "node:child_process";

export type E2EEnv = {
  baseUrl: string;
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  kubeconfig: string;
  mailNamespace: string;
  e2eMailboxLocal: string;
};

function kubectlSecret(
  kubeconfig: string,
  ns: string,
  secret: string,
  key: string,
): string {
  const b64 = execFileSync(
    "kubectl",
    [
      `--kubeconfig=${kubeconfig}`,
      "-n",
      ns,
      "get",
      "secret",
      secret,
      "-o",
      `jsonpath={.data.${key}}`,
    ],
    { encoding: "utf8" },
  ).trim();
  if (!b64) throw new Error(`Missing secret ${ns}/${secret}.${key}`);
  return Buffer.from(b64, "base64").toString("utf8");
}

/** Resolve E2E targets from env, falling back to cluster secrets. */
export function loadE2EEnv(): E2EEnv {
  const kubeconfig =
    process.env.KUBECONFIG?.trim() ||
    `${process.env.USERPROFILE || process.env.HOME || ""}/.kube/config-homelab`;

  const baseUrl =
    process.env.E2E_BASE_URL?.trim() || "https://yieldscope.d3bu7.com";
  const supabaseUrl =
    process.env.E2E_SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    "https://supabase.yieldscope.d3bu7.com";

  let anonKey =
    process.env.E2E_SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    "";
  let serviceRoleKey =
    process.env.E2E_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";

  if (!anonKey || !serviceRoleKey) {
    anonKey =
      anonKey ||
      kubectlSecret(
        kubeconfig,
        "supabase-yieldscope",
        "yieldscope-supabase-secrets",
        "ANON_KEY",
      );
    serviceRoleKey =
      serviceRoleKey ||
      kubectlSecret(
        kubeconfig,
        "supabase-yieldscope",
        "yieldscope-supabase-secrets",
        "SERVICE_ROLE_KEY",
      );
  }

  if (supabaseUrl.includes("majico")) {
    throw new Error(
      `E2E refuses majico Supabase URL (${supabaseUrl}). Set E2E_SUPABASE_URL to yieldscope.`,
    );
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    supabaseUrl: supabaseUrl.replace(/\/$/, ""),
    anonKey,
    serviceRoleKey,
    kubeconfig,
    mailNamespace: process.env.E2E_MAIL_NAMESPACE?.trim() || "yieldscope-mail",
    e2eMailboxLocal: process.env.E2E_MAIL_LOCAL?.trim() || "e2e",
  };
}
