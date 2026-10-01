/**
 * The level a glance's risk line starts with ("Medium - touches the loop",
 * "low: docs", "High. Migrations"), lowercased; '' when it starts with none
 * of the three. The same reading as the detail pane's risk box.
 * `riskLevelOf` (agent-actions.ts) reads the same line for approve offers
 * but counts anything unreadable as high, as an approval must; the set
 * triggers need '' there, so a PR without a glance does not read as risky.
 */
export function glanceRiskLevel(risk: string): 'low' | 'medium' | 'high' | '' {
  const match = /^\s*(low|medium|high)\b/i.exec(risk);
  return match ? (match[1]!.toLowerCase() as 'low' | 'medium' | 'high') : '';
}
