#!/usr/bin/env python3
"""Bootstrap yieldscope-supabase-secrets on Windows (no bash required)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NS = "supabase-yieldscope"
PUBLIC_URL = "https://supabase.yieldscope.d3bu7.com"
SITE_URL = "https://yieldscope.d3bu7.com"
ENV_FILE = Path(os.environ.get("YIELDSCOPE_SUPABASE_ENV_FILE", ROOT / "deploy" / "env" / "yieldscope-supabase.env"))
NODEPORT = "30595"


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, check=check, text=True, capture_output=True)


def b64url(obj: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj, separators=(",", ":")).encode()).decode().rstrip("=")


def sign_jwt(secret: str, role: str) -> str:
    header = b64url({"alg": "HS256", "typ": "JWT"})
    payload = b64url({"iss": "supabase-demo", "role": role, "exp": 1983812996})
    sig = (
        base64.urlsafe_b64encode(
            hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
        )
        .decode()
        .rstrip("=")
    )
    return f"{header}.{payload}.{sig}"


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def set_env(path: Path, data: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = load_env(path)
    existing.update({k: v for k, v in data.items() if v})
    path.write_text("".join(f"{k}={v}\n" for k, v in existing.items()), encoding="utf-8")


def load_smtp_from_majico() -> dict[str, str]:
    candidates = [
        Path(os.environ.get("MAJICO_ENV_FILE", "")),
        Path.home() / "Documents/Programming/majico/majico.xyz/.env.local",
        Path(r"C:\Users\Julian\Documents\Programming\majico\majico.xyz\.env.local"),
    ]
    for c in candidates:
        if not c or not c.is_file():
            continue
        env = load_env(c)
        host = env.get("SMTP_HOST") or env.get("EMAIL_HOST")
        user = env.get("SMTP_USER") or env.get("EMAIL_USER")
        password = env.get("SMTP_PASS") or env.get("EMAIL_PASS")
        port = env.get("SMTP_PORT") or env.get("EMAIL_PORT") or "465"
        if host and user and password:
            print(f"[smtp] loaded from {c}")
            return {
                "SMTP_HOST": host,
                "SMTP_PORT": port,
                "SMTP_USER": user,
                "SMTP_PASS": password,
                "SMTP_ADMIN_EMAIL": env.get("SMTP_ADMIN_EMAIL") or user,
            }
    return {}


def main() -> int:
    env = load_env(ENV_FILE)
    regen = os.environ.get("SUPABASE_REGENERATE_SECRETS", "0") == "1"
    if regen or not env.get("POSTGRES_PASSWORD") or not env.get("JWT_SECRET"):
        env["POSTGRES_PASSWORD"] = secrets.token_hex(16)
        env["JWT_SECRET"] = (
            "super-secret-jwt-token-with-at-least-32-characters-long-"
            + secrets.token_hex(8)
        )
        env["DASHBOARD_USERNAME"] = env.get("DASHBOARD_USERNAME") or "supabase"
        env["DASHBOARD_PASSWORD"] = secrets.token_hex(12)
        env["PG_META_CRYPTO_KEY"] = secrets.token_hex(16)
        print("generated new credentials")
    else:
        print("reused credentials from env file")

    jwt = env["JWT_SECRET"]
    pg = env["POSTGRES_PASSWORD"]
    anon = sign_jwt(jwt, "anon")
    service = sign_jwt(jwt, "service_role")
    env.update(
        {
            "SUPABASE_NAMESPACE": NS,
            "SUPABASE_PUBLIC_URL": PUBLIC_URL,
            "SITE_URL": SITE_URL,
            "ANON_KEY": anon,
            "SERVICE_ROLE_KEY": service,
            "GOTRUE_DB_DATABASE_URL": f"postgres://supabase_auth_admin:{pg}@db:5432/postgres",
            "PGRST_DB_URI": f"postgres://authenticator:{pg}@db:5432/postgres",
            "POSTGRES_BACKEND_URL": f"postgresql://supabase_admin:{pg}@db:5432/_supabase",
            "KONG_NODEPORT": NODEPORT,
            "DASHBOARD_USERNAME": env.get("DASHBOARD_USERNAME") or "supabase",
        }
    )

    smtp = load_smtp_from_majico()
    env.update(smtp)

    set_env(ENV_FILE, env)

    run(["kubectl", "create", "namespace", NS, "--dry-run=client", "-o", "yaml"])
    ns_yaml = run(["kubectl", "create", "namespace", NS, "--dry-run=client", "-o", "yaml"]).stdout
    subprocess.run(["kubectl", "apply", "-f", "-"], input=ns_yaml, text=True, check=True)

    literals = [
        f"POSTGRES_PASSWORD={env['POSTGRES_PASSWORD']}",
        f"JWT_SECRET={env['JWT_SECRET']}",
        f"ANON_KEY={anon}",
        f"SERVICE_ROLE_KEY={service}",
        f"DASHBOARD_USERNAME={env['DASHBOARD_USERNAME']}",
        f"DASHBOARD_PASSWORD={env['DASHBOARD_PASSWORD']}",
        f"PG_META_CRYPTO_KEY={env['PG_META_CRYPTO_KEY']}",
        f"GOTRUE_DB_DATABASE_URL={env['GOTRUE_DB_DATABASE_URL']}",
        f"PGRST_DB_URI={env['PGRST_DB_URI']}",
        f"POSTGRES_BACKEND_URL={env['POSTGRES_BACKEND_URL']}",
    ]
    for k in ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_ADMIN_EMAIL"):
        if env.get(k):
            literals.append(f"{k}={env[k]}")

    run(["kubectl", "-n", NS, "delete", "secret", "yieldscope-supabase-secrets", "--ignore-not-found"])
    cmd = ["kubectl", "-n", NS, "create", "secret", "generic", "yieldscope-supabase-secrets"]
    for lit in literals:
        cmd.extend(["--from-literal", lit])
    run(cmd)

    print(f"==> yieldscope-supabase-secrets updated (namespace {NS})")
    print(f"    env file: {ENV_FILE}")
    print(f"    Studio user: {env['DASHBOARD_USERNAME']}")
    print("    Studio pass: kubectl -n supabase-yieldscope get secret yieldscope-supabase-secrets -o jsonpath='{.data.DASHBOARD_PASSWORD}' | base64 -d")
    print(f"    SMTP present: {bool(env.get('SMTP_HOST') and env.get('SMTP_PASS'))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
