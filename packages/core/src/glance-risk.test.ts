import { describe, expect, it } from 'vitest';
import { glanceRiskLevel } from './glance-risk.ts';

describe('glanceRiskLevel', () => {
  it('reads the level whatever follows it', () => {
    expect(glanceRiskLevel('medium - touches the worker loop')).toBe('medium');
    expect(glanceRiskLevel('Low. Only docs.')).toBe('low');
    expect(glanceRiskLevel('High—migrations')).toBe('high');
    expect(glanceRiskLevel('  low: labels')).toBe('low');
  });

  it('is empty without a level up front', () => {
    expect(glanceRiskLevel('')).toBe('');
    expect(glanceRiskLevel('lowish risk')).toBe('');
    expect(glanceRiskLevel('unclear')).toBe('');
  });
});
