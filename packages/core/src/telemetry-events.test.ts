import { describe, expect, it } from 'vitest';
import { isTelemetryEventName, RENDERER_TELEMETRY_EVENTS, TELEMETRY_EVENT_NAMES, TELEMETRY_EVENTS } from './telemetry-events.ts';

describe('TELEMETRY_EVENTS', () => {
  it('knows real event names and rejects made-up ones', () => {
    expect(isTelemetryEventName('sync_completed')).toBe(true);
    expect(isTelemetryEventName('made_up_event')).toBe(false);
  });

  it('validates the right shape and rejects extra or missing props (strict schemas)', () => {
    const valid = { tile_kind: 'single', for_whom: 'you', has_glance: true, verdict: 'looks_safe' };
    expect(TELEMETRY_EVENTS.tile_opened.safeParse(valid).success).toBe(true);
    expect(TELEMETRY_EVENTS.tile_opened.safeParse({ ...valid, verdict: null }).success).toBe(true);
    const { verdict: _verdict, ...missingVerdict } = valid;
    expect(TELEMETRY_EVENTS.tile_opened.safeParse(missingVerdict).success).toBe(false);
    expect(TELEMETRY_EVENTS.tile_opened.safeParse({ ...valid, extra: 'nope' }).success).toBe(false);
    expect(TELEMETRY_EVENTS.tile_opened.safeParse({ ...valid, tile_kind: 'repo_name' }).success).toBe(false);
  });

  it('has an empty-object schema for events with no props', () => {
    expect(TELEMETRY_EVENTS.app_active.safeParse({}).success).toBe(true);
    expect(TELEMETRY_EVENTS.app_active.safeParse({ anything: 1 }).success).toBe(false);
  });

  it('takes the GitHub quota numbers on sync_completed, with the percentages optional', () => {
    const sync = {
      duration_ms: 1200,
      prs_fetched: 3,
      new_events: 2,
      agent_calls: 1,
      agent_failures: 0,
      cost_usd: 0.02,
      stopped_at_cap: false,
      trigger: 'auto',
      gh_requests: 14,
    };
    expect(TELEMETRY_EVENTS.sync_completed.safeParse(sync).success).toBe(true);
    expect(TELEMETRY_EVENTS.sync_completed.safeParse({ ...sync, gh_core_remaining_pct: 97, gh_graphql_remaining_pct: 0 }).success).toBe(true);
    expect(TELEMETRY_EVENTS.sync_completed.safeParse({ ...sync, gh_core_remaining_pct: 101 }).success).toBe(false);
    expect(TELEMETRY_EVENTS.sync_completed.safeParse({ ...sync, gh_graphql_remaining_pct: 12.5 }).success).toBe(false);
  });

  it('takes the heap in whole MB on sync_completed, optional so older events still validate', () => {
    const sync = {
      duration_ms: 1200,
      prs_fetched: 3,
      new_events: 2,
      agent_calls: 1,
      agent_failures: 0,
      cost_usd: 0.02,
      stopped_at_cap: false,
      trigger: 'auto',
      gh_requests: 14,
    };
    expect(TELEMETRY_EVENTS.sync_completed.safeParse({ ...sync, heap_used_mb: 1830, heap_limit_mb: 4144 }).success).toBe(true);
    expect(TELEMETRY_EVENTS.sync_completed.safeParse({ ...sync, heap_used_mb: 1830.4 }).success).toBe(false);
  });

  it('knows a crash in the last run, with only whether the version changed', () => {
    expect(TELEMETRY_EVENTS.app_crashed_last_run.safeParse({ version_changed: false }).success).toBe(true);
    expect(TELEMETRY_EVENTS.app_crashed_last_run.safeParse({ version_changed: true, version: '0.17.0' }).success).toBe(false);
    expect(RENDERER_TELEMETRY_EVENTS).not.toContain('app_crashed_last_run');
  });

  it('knows github_quota_low and where a rate limit hit', () => {
    expect(TELEMETRY_EVENTS.github_quota_low.safeParse({ resource: 'graphql', level: 'critical' }).success).toBe(true);
    expect(TELEMETRY_EVENTS.github_quota_low.safeParse({ resource: 'search', level: 'low' }).success).toBe(false);
    expect(TELEMETRY_EVENTS.github_quota_low.safeParse({ resource: 'core', level: 'ok' }).success).toBe(false);
    expect(TELEMETRY_EVENTS.rate_limited.safeParse({ source: 'rest', where: 'poll' }).success).toBe(true);
    expect(TELEMETRY_EVENTS.rate_limited.safeParse({ source: 'rest' }).success).toBe(false);
  });

  it('takes the hourly ping summary as counts only', () => {
    const summary = { pinged: 3, withheld_rules: 12, withheld_agent: 1, pinged_glance: 0, handled_quietly: 4 };
    expect(TELEMETRY_EVENTS.pings_summarized.safeParse(summary).success).toBe(true);
    expect(TELEMETRY_EVENTS.pings_summarized.safeParse({ ...summary, pinged: -1 }).success).toBe(false);
    expect(TELEMETRY_EVENTS.pings_summarized.safeParse({ ...summary, repo: 'acme/app' }).success).toBe(false);
    expect(RENDERER_TELEMETRY_EVENTS).not.toContain('pings_summarized');
  });

  it('takes a finished storage job by its known name, with counts and whole milliseconds only', () => {
    const done = { name: 'bot_body_trim', units: 11326, work_ms: 8500, longest_slice_ms: 41, wall_ms: 24000 };
    expect(TELEMETRY_EVENTS.storage_job_done.safeParse(done).success).toBe(true);
    expect(TELEMETRY_EVENTS.storage_job_done.safeParse({ ...done, name: 'checks_strip' }).success).toBe(true);
    expect(TELEMETRY_EVENTS.storage_job_done.safeParse({ ...done, name: 'acme/app#1' }).success).toBe(false);
    expect(TELEMETRY_EVENTS.storage_job_done.safeParse({ ...done, work_ms: 8.5 }).success).toBe(false);
    expect(TELEMETRY_EVENTS.storage_job_done.safeParse({ ...done, wrote: 3 }).success).toBe(false);
    expect(RENDERER_TELEMETRY_EVENTS).not.toContain('storage_job_done');
  });

  it('takes a blocked storage job by its known name and a count, never a key', () => {
    expect(TELEMETRY_EVENTS.storage_job_blocked.safeParse({ name: 'discussion_rows', blocked_units: 2 }).success).toBe(true);
    expect(TELEMETRY_EVENTS.storage_job_blocked.safeParse({ name: 'discussion_rows', blocked_units: 2, keys: ['acme/app#1'] }).success).toBe(false);
    expect(TELEMETRY_EVENTS.storage_job_blocked.safeParse({ name: 'acme/app#1', blocked_units: 2 }).success).toBe(false);
    expect(TELEMETRY_EVENTS.storage_job_blocked.safeParse({ name: 'discussion_rows', blocked_units: -1 }).success).toBe(false);
    expect(RENDERER_TELEMETRY_EVENTS).not.toContain('storage_job_blocked');
  });

  it('takes the self-updater events with a version and a short error code only', () => {
    expect(TELEMETRY_EVENTS.update_check_finished.safeParse({ trigger: 'wake', result: 'available', available_version: '0.20.0' }).success).toBe(true);
    expect(TELEMETRY_EVENTS.update_check_finished.safeParse({ trigger: 'launch', result: 'none' }).success).toBe(true);
    expect(TELEMETRY_EVENTS.update_check_finished.safeParse({ trigger: 'startup', result: 'none' }).success).toBe(false);
    expect(TELEMETRY_EVENTS.update_downloaded.safeParse({ version: 'v0.20.0' }).success).toBe(false);
    expect(TELEMETRY_EVENTS.update_failed.safeParse({ stage: 'download', error_code: 'ERR_CHECKSUM_MISMATCH' }).success).toBe(true);
    expect(TELEMETRY_EVENTS.update_failed.safeParse({ stage: 'check', error_code: 'failed at /Users/alice' }).success).toBe(false);
    expect(RENDERER_TELEMETRY_EVENTS).not.toContain('update_check_finished');
  });

  it('counts scouted tiles apart on tile_opened, absent on older events', () => {
    const valid = { tile_kind: 'single', for_whom: 'none', has_glance: true, verdict: null };
    expect(TELEMETRY_EVENTS.tile_opened.safeParse({ ...valid, scouted: true }).success).toBe(true);
    expect(TELEMETRY_EVENTS.tile_opened.safeParse(valid).success).toBe(true);
    expect(TELEMETRY_EVENTS.tile_opened.safeParse({ ...valid, scouted: 'lookout' }).success).toBe(false);
  });

  it('takes the scout events as counts, booleans and enums only', () => {
    const run = {
      scouts: 2,
      listed: 120,
      candidates: 30,
      judged: 12,
      pulled: 2,
      pending: 4,
      expired: 1,
      judge_calls: 1,
      capped: false,
      listing_capped: false,
      rate_limited: false,
      quota_low: false,
      duration_ms: 5400,
    };
    expect(TELEMETRY_EVENTS.scout_run_completed.safeParse(run).success).toBe(true);
    expect(TELEMETRY_EVENTS.scout_run_completed.safeParse({ ...run, scout: 'lookout' }).success).toBe(false);
    expect(TELEMETRY_EVENTS.scout_pr_closed.safeParse({ outcome: 'reached_inbox', was_seen: false, was_opened: true, hours_in_section: 5 }).success).toBe(true);
    expect(TELEMETRY_EVENTS.scout_pr_closed.safeParse({ outcome: 'expired', was_seen: false, was_opened: true, hours_in_section: 5 }).success).toBe(false);
    expect(TELEMETRY_EVENTS.scout_pr_closed.safeParse({ outcome: 'followed', was_seen: false, was_opened: true, hours_in_section: 1.5 }).success).toBe(false);
    expect(TELEMETRY_EVENTS.scout_checked.safeParse({ fit: 'fits', cant_see: false, dry_run_pulls: 3, dry_run_complete: true }).success).toBe(true);
    expect(TELEMETRY_EVENTS.scout_checked.safeParse({ fit: 'partly', cant_see: true, dry_run_skipped_reason: 'no_calls_left' }).success).toBe(true);
    expect(TELEMETRY_EVENTS.scout_checked.safeParse({ fit: 'partly', cant_see: true, prompt: 'billing' }).success).toBe(false);
    expect(TELEMETRY_EVENTS.scout_follow_failed.safeParse({ stage: 'timeout' }).success).toBe(true);
    expect(TELEMETRY_EVENTS.scout_follow_failed.safeParse({ stage: 'acme/app#1' }).success).toBe(false);
    expect(TELEMETRY_EVENTS.scout_follow_late_success.safeParse({}).success).toBe(true);
    expect(TELEMETRY_EVENTS.scout_seen.safeParse({ via: 'mcp' }).success).toBe(true);
    const tightened = { round: 1, wants: 3, noise: 2, pulls_before: 14, pulls_after: 5, lost_wants: 0 };
    expect(TELEMETRY_EVENTS.scout_tightened.safeParse(tightened).success).toBe(true);
    expect(TELEMETRY_EVENTS.scout_tightened.safeParse({ ...tightened, prompt: 'Skip fixes' }).success).toBe(false);
    expect(TELEMETRY_EVENTS.scout_tightened.safeParse({ ...tightened, paths: ['+*/'] }).success).toBe(false);
    expect(TELEMETRY_EVENTS.scout_tighten_undone.safeParse({}).success).toBe(true);
  });

  it('lets the renderer send the intro card funnel, validated by the catalogue', () => {
    expect(RENDERER_TELEMETRY_EVENTS).toContain('scout_intro_shown');
    expect(RENDERER_TELEMETRY_EVENTS).toContain('scout_intro_closed');
    expect(RENDERER_TELEMETRY_EVENTS).toContain('scout_tighten_undone');
    expect(TELEMETRY_EVENTS.scout_intro_shown.safeParse({ trigger: 'manual' }).success).toBe(true);
    expect(TELEMETRY_EVENTS.scout_intro_shown.safeParse({ trigger: 'sidebar' }).success).toBe(false);
    expect(TELEMETRY_EVENTS.scout_intro_closed.safeParse({ stage: 'check', action: 'escape' }).success).toBe(true);
    expect(TELEMETRY_EVENTS.scout_intro_closed.safeParse({ stage: 'check', action: 'turn_on' }).success).toBe(false);
    // The engine has the facts for the rest: the check's verdict, the run, follows and closures.
    expect(RENDERER_TELEMETRY_EVENTS).not.toContain('scout_checked');
    expect(RENDERER_TELEMETRY_EVENTS).not.toContain('scout_tightened');
    expect(RENDERER_TELEMETRY_EVENTS).not.toContain('scout_pr_closed');
  });

  it('lists every catalogue key in TELEMETRY_EVENT_NAMES', () => {
    expect(TELEMETRY_EVENT_NAMES).toEqual(Object.keys(TELEMETRY_EVENTS));
  });

  it('only allows a known, deliberate subset of events from the renderer', () => {
    for (const name of RENDERER_TELEMETRY_EVENTS) {
      expect(isTelemetryEventName(name)).toBe(true);
    }
    // The renderer never reports its own sync or agent-trust events: those are the engine's job.
    expect(RENDERER_TELEMETRY_EVENTS).not.toContain('sync_completed');
    expect(RENDERER_TELEMETRY_EVENTS).not.toContain('memory_corrected');
  });
});
