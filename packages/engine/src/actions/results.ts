import type { ActionResult } from '@code-manager/core';

export function ok(message: string, undoToken: string | null = null): ActionResult {
  return { ok: true, message, undoToken };
}

export function failed(message: string): ActionResult {
  return { ok: false, message, undoToken: null };
}
