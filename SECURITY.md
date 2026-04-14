# LexLens Security Policy

**Owner:** CTO  
**Effective:** 2026-04-14  
**Review cycle:** Each Phase

---

## 1. Secret and Credential Management

### Rule: Secrets never appear in Paperclip artifacts

API keys, passwords, tokens, and all credentials **must never** appear in:
- Paperclip issue comments or descriptions
- Git commits, PR descriptions, or branch names
- Log output stored in Paperclip
- Any document, ADR, or memo in the project

**Always use:**
- `.env` files for local development (`.env` is in `.gitignore`)
- A secret manager (e.g. GitHub Actions secrets, AWS Secrets Manager) for CI/CD
- Out-of-band channels (direct board communication) when an agent needs a new credential

### What agents must do when they need a credential

1. Post a comment on the relevant issue stating **which** credential is needed and **why**
2. Do **not** paste the value in the comment — ask the board to provide it via the adapter's environment variables
3. Reference the environment variable name (e.g. `ANTHROPIC_API_KEY`) not the value

### Environment variables for this project

| Variable | Used by | How to provide |
|---|---|---|
| `ANTHROPIC_API_KEY` | scoring-api (live mode) | Set in adapter env config or `.env` file |
| `REDIS_URL` | scoring-api | Set in `.env` or docker-compose |

---

## 2. Incident Response — Exposed Secret

If a secret is accidentally exposed in any Paperclip artifact, commit, or public channel:

1. **Rotate immediately** — treat the exposed key as compromised. Do not wait to confirm misuse.
2. **Revoke the old key** in the provider's console (Anthropic console, AWS IAM, etc.)
3. **Audit** — check provider logs for unexpected usage in the exposure window
4. **Report** to CTO (who reports to CEO) with: what was exposed, when, and in which artifact
5. **Redact** the artifact if the platform allows it

> The key posted in [GMA-25](/GMA/issues/GMA-25) on 2026-04-14 should be rotated if not already done.

---

## 3. Pre-commit Secret Detection

A secret detection script lives at `scripts/check-secrets.sh`. Install it as a pre-commit hook when setting up a local workspace:

```sh
cp scripts/check-secrets.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

**Patterns checked:**
- `sk-ant-` — Anthropic API key prefix

If a commit is blocked, the script prints the matching file. Remove the secret, use an env var reference instead, then commit again.

To run manually across all tracked files:
```sh
sh scripts/check-secrets.sh
```

To bypass in an emergency (not recommended): `git commit --no-verify` — but you must immediately rotate any key that was committed.

---

## 4. Dependency Security

- All third-party dependencies must be reviewed before adding
- Run `npm audit` before each release for both `extension/` and `scoring-api/`
- No dependencies with known critical CVEs may be shipped

---

## 5. Extension Privacy Constraints

Per ADR-001 and [PRIVACY_POLICY.md](/PRIVACY_POLICY.md):

- The Chrome extension must not transmit raw legislation text beyond the scoring API call
- No user browsing history may be stored server-side
- No IP addresses logged to persistent storage
- `content_hash`, `language`, `jurisdiction`, `requestId`, and latency are the only permitted log fields in scoring-api

---

## 6. Reporting Security Issues

Security concerns should be escalated immediately:
- Agents → CTO
- CTO → CEO (for any neutrality, compliance, or data exposure concern)
- Board → report externally if required by COMPLIANCE_MAP.md
