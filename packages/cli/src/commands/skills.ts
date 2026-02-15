import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createLogger } from '@hydraclaw/core';
import type { Logger } from '@hydraclaw/core';

const SKILLS_DIR = resolve(homedir(), '.hydraclaw', 'skills');
const SKILLS_STATE_FILE = resolve(homedir(), '.hydraclaw', 'skills-state.json');

interface SkillState {
  id: string;
  source: string;
  enabled: boolean;
  installedAt: number;
}

interface SkillsStateFile {
  skills: SkillState[];
}

/**
 * Create the `hydraclaw skills` command group.
 *
 * Subcommands:
 *   hydraclaw skills list              - List installed skills
 *   hydraclaw skills install <source>  - Install a skill
 *   hydraclaw skills remove <id>       - Remove a skill
 *   hydraclaw skills enable <id>       - Enable a skill
 *   hydraclaw skills disable <id>      - Disable a skill
 *   hydraclaw skills info <id>         - Show skill details
 */
export function createSkillsCommand(): Command {
  const command = new Command('skills');
  command.description('Manage HydraClaw skills');

  // ─── list ───────────────────────────────────────────────────────────
  command
    .command('list')
    .description('List all installed skills')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const logger = createLogger({ name: 'hydraclaw', level: 'warn' });
      const state = readSkillsState();
      const skills = state.skills;

      if (opts.json) {
        console.log(JSON.stringify(skills, null, 2));
        return;
      }

      console.log(chalk.bold.cyan('\nInstalled Skills\n'));

      if (skills.length === 0) {
        console.log(chalk.yellow('  No skills installed.'));
        console.log(chalk.dim('  Install one with: hydraclaw skills install <source>'));
        return;
      }

      for (const skill of skills) {
        const status = skill.enabled ? chalk.green('enabled') : chalk.red('disabled');
        const date = new Date(skill.installedAt).toLocaleDateString();

        // Try to load details from the skill
        const details = await loadSkillDetails(skill.source, logger);

        console.log(`  ${chalk.bold(skill.id)}`);
        if (details) {
          console.log(`    Name:      ${details.name}`);
          console.log(`    Version:   ${details.version}`);
          if (details.description) {
            console.log(`    About:     ${details.description}`);
          }
        }
        console.log(`    Status:    ${status}`);
        console.log(`    Source:    ${chalk.dim(skill.source)}`);
        console.log(`    Installed: ${chalk.dim(date)}`);
        console.log();
      }

      console.log(chalk.dim(`  Total: ${skills.length} skill(s)`));
    });

  // ─── install ────────────────────────────────────────────────────────
  command
    .command('install <source>')
    .description('Install a skill from a local path, npm package, or git URL')
    .action(async (source: string) => {
      const logger = createLogger({ name: 'hydraclaw', level: 'warn' });

      console.log(chalk.cyan(`Installing skill from: ${source}`));

      try {
        const { SkillLoader } = await import('@hydraclaw/skills');
        const { DefaultSkillRegistry } = await import('@hydraclaw/skills');

        const registry = new DefaultSkillRegistry();
        const loader = new SkillLoader(logger, registry);

        const skill = await loader.installSkill(source);

        // Store in state
        const state = readSkillsState();
        const existing = state.skills.find((s) => s.id === skill.id);
        if (existing) {
          existing.source = source;
          existing.installedAt = Date.now();
          existing.enabled = true;
        } else {
          state.skills.push({
            id: skill.id,
            source: resolve(source),
            enabled: true,
            installedAt: Date.now(),
          });
        }
        writeSkillsState(state);

        console.log(chalk.green(`\nSkill installed: ${skill.name} (${skill.id}) v${skill.version}`));
        if (skill.description) {
          console.log(chalk.dim(`  ${skill.description}`));
        }
        if (skill.triggers && skill.triggers.length > 0) {
          console.log(chalk.dim(`  Triggers: ${skill.triggers.map((t: any) => t.pattern).join(', ')}`));
        }
      } catch (err) {
        console.error(chalk.red(`Installation failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  // ─── remove ─────────────────────────────────────────────────────────
  command
    .command('remove <id>')
    .description('Remove an installed skill')
    .action(async (id: string) => {
      const state = readSkillsState();
      const index = state.skills.findIndex((s) => s.id === id);

      if (index === -1) {
        console.error(chalk.red(`Skill "${id}" is not installed.`));
        process.exit(1);
      }

      const skill = state.skills[index];
      state.skills.splice(index, 1);
      writeSkillsState(state);

      console.log(chalk.green(`Skill removed: ${id}`));
      console.log(chalk.dim(`  Source was: ${skill.source}`));
      console.log(chalk.dim('  Note: Source files are not deleted. Remove them manually if needed.'));
    });

  // ─── enable ─────────────────────────────────────────────────────────
  command
    .command('enable <id>')
    .description('Enable a disabled skill')
    .action((id: string) => {
      const state = readSkillsState();
      const skill = state.skills.find((s) => s.id === id);

      if (!skill) {
        console.error(chalk.red(`Skill "${id}" is not installed.`));
        process.exit(1);
      }

      if (skill.enabled) {
        console.log(chalk.yellow(`Skill "${id}" is already enabled.`));
        return;
      }

      skill.enabled = true;
      writeSkillsState(state);
      console.log(chalk.green(`Skill "${id}" enabled.`));
      console.log(chalk.dim('  Restart HydraClaw for changes to take effect.'));
    });

  // ─── disable ────────────────────────────────────────────────────────
  command
    .command('disable <id>')
    .description('Disable an active skill')
    .action((id: string) => {
      const state = readSkillsState();
      const skill = state.skills.find((s) => s.id === id);

      if (!skill) {
        console.error(chalk.red(`Skill "${id}" is not installed.`));
        process.exit(1);
      }

      if (!skill.enabled) {
        console.log(chalk.yellow(`Skill "${id}" is already disabled.`));
        return;
      }

      skill.enabled = false;
      writeSkillsState(state);
      console.log(chalk.green(`Skill "${id}" disabled.`));
      console.log(chalk.dim('  Restart HydraClaw for changes to take effect.'));
    });

  // ─── info ───────────────────────────────────────────────────────────
  command
    .command('info <id>')
    .description('Show detailed information about a skill')
    .action(async (id: string) => {
      const logger = createLogger({ name: 'hydraclaw', level: 'warn' });
      const state = readSkillsState();
      const skillState = state.skills.find((s) => s.id === id);

      if (!skillState) {
        console.error(chalk.red(`Skill "${id}" is not installed.`));
        process.exit(1);
      }

      const details = await loadSkillDetails(skillState.source, logger);

      console.log(chalk.bold.cyan(`\nSkill: ${id}\n`));
      console.log(`  Status:    ${skillState.enabled ? chalk.green('enabled') : chalk.red('disabled')}`);
      console.log(`  Source:    ${skillState.source}`);
      console.log(`  Installed: ${new Date(skillState.installedAt).toLocaleString()}`);

      if (details) {
        console.log(`  Name:      ${details.name}`);
        console.log(`  Version:   ${details.version}`);
        if (details.description) {
          console.log(`  About:     ${details.description}`);
        }
        if (details.author) {
          console.log(`  Author:    ${details.author}`);
        }
        if (details.triggers && details.triggers.length > 0) {
          console.log(chalk.bold('\n  Triggers:'));
          for (const trigger of details.triggers) {
            const desc = trigger.description ? ` - ${trigger.description}` : '';
            console.log(`    ${trigger.type}: ${chalk.cyan(trigger.pattern)}${chalk.dim(desc)}`);
          }
        }
        if (details.tools && details.tools.length > 0) {
          console.log(chalk.bold('\n  Tools:'));
          for (const tool of details.tools) {
            console.log(`    ${chalk.cyan(tool.name)}: ${chalk.dim(tool.description)}`);
          }
        }
      } else {
        console.log(chalk.yellow('\n  Could not load skill details from source.'));
      }
    });

  return command;
}

// ---------------------------------------------------------------------------
// State file helpers
// ---------------------------------------------------------------------------

function readSkillsState(): SkillsStateFile {
  try {
    if (!existsSync(SKILLS_STATE_FILE)) {
      return { skills: [] };
    }
    const raw = readFileSync(SKILLS_STATE_FILE, 'utf-8');
    return JSON.parse(raw) as SkillsStateFile;
  } catch {
    return { skills: [] };
  }
}

function writeSkillsState(state: SkillsStateFile): void {
  const dir = resolve(homedir(), '.hydraclaw');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(SKILLS_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

async function loadSkillDetails(
  source: string,
  logger: Logger,
): Promise<{
  name: string;
  version: string;
  description?: string;
  author?: string;
  triggers?: Array<{ type: string; pattern: string; description?: string }>;
  tools?: Array<{ name: string; description: string }>;
} | null> {
  try {
    const { SkillLoader } = await import('@hydraclaw/skills');
    const { DefaultSkillRegistry } = await import('@hydraclaw/skills');

    const registry = new DefaultSkillRegistry();
    const loader = new SkillLoader(logger, registry);

    const resolvedSource = resolve(source);
    if (!existsSync(resolvedSource)) return null;

    const skill = await loader.loadSkill(resolvedSource);
    return {
      name: skill.name,
      version: skill.version,
      description: skill.description,
      author: skill.author,
      triggers: skill.triggers?.map((t: any) => ({
        type: t.type,
        pattern: t.pattern,
        description: t.description,
      })),
      tools: skill.tools?.map((t: any) => ({
        name: t.name,
        description: t.description,
      })),
    };
  } catch {
    return null;
  }
}
