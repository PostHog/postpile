import { getHeapStatistics } from 'node:v8';

const MB = 1024 * 1024;

export interface HeapUse {
  heap_used_mb: number;
  heap_limit_mb: number;
}

/**
 * The V8 heap of this process in whole MB, for sync_completed: what it uses
 * now and where V8 stops it. In the desktop app the engine runs in Electron's
 * main process, so these are main's numbers, and a heap creeping up to the
 * limit shows before the out-of-memory crash (DESIGN.md "Memory on big
 * boards"). `used_heap_size` is the number `process.memoryUsage().heapUsed`
 * reports; one call gives both.
 */
export function heapUse(): HeapUse {
  const stats = getHeapStatistics();
  return {
    heap_used_mb: Math.round(stats.used_heap_size / MB),
    heap_limit_mb: Math.round(stats.heap_size_limit / MB),
  };
}
