# I-201: Sentry route-handler errors reach Sentry late

**Type:** bug
**Status:** backlog
**Priority:** soon
**Effort:** s
**Epic:** (none)
**Theme:** observability
**Source:** I-141 Layer 1 verification (2026-05-29)
**Evidence:** A deliberate uncaught `throw` returned HTTP 500 but produced **no event** in Sentry — repeated twice.

**Update (2026-05-30) — it DID deliver, just late.** The event appeared *after* the session wrapped; the failure mode is **delivery latency**, not a silent drop.
**mode_introduced:** kanban
**Created:** 2026-05-29
**Updated:** 2026-05-30

**Milestone:** MS-007 (MVP Launch Readiness)
**Severity:** **P2 → P3** (per 2026-05-30 update)

## Description

Flush Sentry on Vercel via `waitUntil`.
