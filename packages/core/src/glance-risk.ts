/**
 * The level a glance's risk line starts with ("Medium - touches the loop",
 * "low: docs", "High. Migrations"), lowercased; '' when it starts with none
 * of the three. The same reading as the detail pane's risk box.
 */
export function glanceRiskLevel(risk: string): 'low' | 'medium' | 'high' | '' {
  const match = /^\s*(low|medium|high)\b/i.exec(risk);
  return match ? (match[1]!.toLowerCase() as 'low' | 'medium' | 'high') : '';
}
