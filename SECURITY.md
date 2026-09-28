# Security policy

## Supported versions

PostPile is in alpha. Only the latest release gets security fixes, so update to it before you report.

## Reporting a vulnerability

Please report security vulnerabilities to security-reports@posthog.com, not in public issues.

PostHog runs a vulnerability disclosure program and rewards valid, high quality reports with merch.

## Scope notes

PostPile runs locally. Things worth a report include:

- the local API (bound to 127.0.0.1, token protected) accepting requests it should not
- GitHub text (PR titles, bodies, comments) getting an agent call to run tools or write to GitHub
- secrets from `~/.claude` leaving the machine despite the masking in the work context sweep
- the app writing to GitHub while writes are locked
