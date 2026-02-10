import chalk from 'chalk';
import type { ScanReport, ScanFinding } from '../types.js';

export function formatReport(report: ScanReport): string {
  const lines: string[] = [];

  lines.push(chalk.bold.cyan('\n  HydraClaw Security Scan Report'));
  lines.push(chalk.dim(`  Generated: ${new Date(report.timestamp).toISOString()}\n`));

  const { summary } = report;
  lines.push(chalk.bold('  Summary:'));
  if (summary.critical > 0) lines.push(`    ${chalk.red.bold(`Critical: ${summary.critical}`)}`);
  if (summary.high > 0) lines.push(`    ${chalk.red(`High: ${summary.high}`)}`);
  if (summary.medium > 0) lines.push(`    ${chalk.yellow(`Medium: ${summary.medium}`)}`);
  if (summary.low > 0) lines.push(`    ${chalk.blue(`Low: ${summary.low}`)}`);
  if (summary.info > 0) lines.push(`    ${chalk.dim(`Info: ${summary.info}`)}`);
  lines.push('');

  const severityOrder: ScanFinding['severity'][] = ['critical', 'high', 'medium', 'low', 'info'];

  for (const severity of severityOrder) {
    const findings = report.findings.filter(f => f.severity === severity);
    if (findings.length === 0) continue;

    const colorFn = severity === 'critical' ? chalk.red.bold
      : severity === 'high' ? chalk.red
      : severity === 'medium' ? chalk.yellow
      : severity === 'low' ? chalk.blue
      : chalk.dim;

    lines.push(colorFn(`  ── ${severity.toUpperCase()} ──`));

    for (const finding of findings) {
      lines.push(`  ${colorFn('*')} ${chalk.bold(finding.title)} [${finding.category}]`);
      lines.push(`    ${finding.description}`);
      lines.push(`    ${chalk.green('Fix:')} ${finding.recommendation}`);
      lines.push('');
    }
  }

  const totalIssues = report.findings.length;
  if (totalIssues === 0) {
    lines.push(chalk.green.bold('  No security issues found.'));
  } else {
    lines.push(chalk.dim(`  Total findings: ${totalIssues}`));
  }

  lines.push('');
  return lines.join('\n');
}
