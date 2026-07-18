import { execFileSync } from "node:child_process";
import type { E2EEnv } from "./env";

/** Decode common MIME transfer encodings used by GoTrue HTML mail. */
export function decodeMailBody(raw: string): string {
  // Prefer text/html part when present; else whole message.
  let body = raw;
  const htmlMatch = raw.match(
    /Content-Type:\s*text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\n\.\r?\n|$)/i,
  );
  if (htmlMatch?.[1]) body = htmlMatch[1];

  if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(raw)) {
    body = body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
  }
  return body;
}

export function extractAuthLink(
  decoded: string,
  pathHint?: "/auth/reset-password" | "/auth/callback",
): string | null {
  const patterns = pathHint
    ? [
        new RegExp(
          `https://yieldscope\\.d3bu7\\.com${pathHint.replaceAll("/", "\\/")}[^\\s"'<>]+`,
          "i",
        ),
      ]
    : [
        /https:\/\/yieldscope\.d3bu7\.com\/auth\/reset-password[^\s"'<>]+/i,
        /https:\/\/yieldscope\.d3bu7\.com\/auth\/callback[^\s"'<>]+/i,
      ];

  for (const re of patterns) {
    const m = decoded.match(re);
    if (m?.[0]) {
      return m[0]
        .replace(/&amp;/g, "&")
        .replace(/=\r?\n/g, "")
        .replace(/=3D/gi, "=");
    }
  }
  return null;
}

function kubectlExec(env: E2EEnv, args: string[]): string {
  return execFileSync(
    "kubectl",
    [`--kubeconfig=${env.kubeconfig}`, "-n", env.mailNamespace, ...args],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
}

export function listNewMailPaths(env: E2EEnv): string[] {
  const out = kubectlExec(env, [
    "exec",
    "sts/mail",
    "-c",
    "mail",
    "--",
    "sh",
    "-c",
    `ls -1 /var/mail/yieldscope.d3bu7.com/${env.e2eMailboxLocal}/new/ 2>/dev/null || true`,
  ]);
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(
      (name) =>
        `/var/mail/yieldscope.d3bu7.com/${env.e2eMailboxLocal}/new/${name}`,
    );
}

export function readMailFile(env: E2EEnv, path: string): string {
  return kubectlExec(env, [
    "exec",
    "sts/mail",
    "-c",
    "mail",
    "--",
    "cat",
    path,
  ]);
}

export function assertYieldScopeOutboundHeaders(raw: string): void {
  if (!/From:\s*"?YieldScope"?\s*<noreply@yieldscope\.d3bu7\.com>/i.test(raw)) {
    throw new Error("Expected From: YieldScope <noreply@yieldscope.d3bu7.com>");
  }
  if (!/DKIM-Signature:[\s\S]*d=yieldscope\.d3bu7\.com/i.test(raw)) {
    throw new Error("Expected DKIM-Signature for yieldscope.d3bu7.com");
  }
}

export type WaitMailOpts = {
  toIncludes: string;
  subjectIncludes?: string;
  afterMs: number;
  timeoutMs?: number;
  pathHint?: "/auth/reset-password" | "/auth/callback";
};

export async function waitForAuthMail(
  env: E2EEnv,
  opts: WaitMailOpts,
): Promise<{ raw: string; link: string; path: string }> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const pathHint = opts.pathHint ?? "/auth/reset-password";
  const deadline = Date.now() + timeoutMs;
  const seen = new Set<string>();

  while (Date.now() < deadline) {
    const paths = listNewMailPaths(env);
    for (const path of paths) {
      if (seen.has(path)) continue;
      const raw = readMailFile(env, path);
      // Skip mail delivered before we started waiting (approx via mtime in name is hard;
      // use Delivered-To + body freshness via afterMs wall clock and path set growth).
      const delivered = /Delivered-To:\s*(.+)/i.exec(raw)?.[1]?.trim() ?? "";
      const to = /(?:^|\n)To:\s*(.+)/i.exec(raw)?.[1]?.trim() ?? "";
      const subject = /(?:^|\n)Subject:\s*(.+)/i.exec(raw)?.[1]?.trim() ?? "";
      const hay = `${delivered} ${to}`.toLowerCase();
      if (!hay.includes(opts.toIncludes.toLowerCase())) {
        seen.add(path);
        continue;
      }
      if (
        opts.subjectIncludes &&
        !subject.toLowerCase().includes(opts.subjectIncludes.toLowerCase())
      ) {
        seen.add(path);
        continue;
      }

      // Prefer files whose inode/name timestamp is recent when present.
      const nameTs = Number(/\/(\d+)\./.exec(path)?.[1] ?? 0);
      if (nameTs > 0 && nameTs * 1000 < opts.afterMs - 5_000) {
        seen.add(path);
        continue;
      }

      assertYieldScopeOutboundHeaders(raw);
      const decoded = decodeMailBody(raw);
      const link = extractAuthLink(decoded, pathHint);
      if (!link) {
        seen.add(path);
        continue;
      }
      return { raw, link, path };
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(
    `Timed out waiting for mail to ${opts.toIncludes} (subject~${opts.subjectIncludes ?? "*"})`,
  );
}

/** Grep recent mail pod logs for outbound evidence (From + DKIM + recipient). */
export function assertMailLogDelivery(
  env: E2EEnv,
  toIncludes: string,
  since = "5m",
): void {
  const logs = kubectlExec(env, [
    "logs",
    "sts/mail",
    "-c",
    "mail",
    `--since=${since}`,
  ]);
  if (!logs.includes("noreply@yieldscope.d3bu7.com")) {
    throw new Error("Mail logs missing noreply@yieldscope.d3bu7.com sender");
  }
  if (!logs.includes("DKIM-Signature field added")) {
    throw new Error("Mail logs missing DKIM-Signature field added");
  }
  if (!logs.toLowerCase().includes(toIncludes.toLowerCase())) {
    throw new Error(`Mail logs missing recipient ${toIncludes}`);
  }
}
