# Upstream workflow reference

These workflow files are copied from `openclaw/openclaw` for comparison only.
They are intentionally stored outside `.github/workflows`, so GitHub does not run
them in the IYENTeam fork.

Why:

- upstream automation assumes upstream-only GitHub App credentials and secrets;
- the fork should not mirror those operational credentials;
- fork CI should validate IYEN-owned changes with small, explicit checks.

If a future upstream workflow contains a useful validation step, copy the needed
command into `.github/workflows/iyen-ci.yml` instead of re-enabling the upstream
workflow wholesale.
