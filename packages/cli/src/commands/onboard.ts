import { Command } from 'commander';
import chalk from 'chalk';

/**
 * Create the `hydraclaw onboard` command.
 *
 * This command launches the interactive onboarding wizard from
 * `@hydraclaw/wizard` to walk the user through initial setup.
 *
 * Usage:
 *   hydraclaw onboard                   - Run full onboarding
 *   hydraclaw onboard --install-daemon  - Also install daemon
 *   hydraclaw onboard --work-dir <dir>  - Set custom working directory
 */
export function createOnboardCommand(): Command {
  const command = new Command('onboard');

  command
    .description('Run the interactive onboarding wizard to set up HydraClaw')
    .option('--install-daemon', 'Also install and configure the background daemon')
    .option('--work-dir <dir>', 'Working directory for config and data files')
    .action(async (opts: { installDaemon?: boolean; workDir?: string }) => {
      try {
        const { OnboardingWizard } = await import('@hydraclaw/wizard');
        const wizard = new OnboardingWizard(opts.workDir);

        await wizard.run();

        if (opts.installDaemon) {
          console.log(chalk.dim('\nInstalling daemon as requested via --install-daemon...'));
          await wizard.installDaemon();
        }
      } catch (err) {
        if (isModuleNotFoundError(err)) {
          console.error(chalk.red('Error: @hydraclaw/wizard package not found.'));
          console.error(chalk.dim('Make sure @hydraclaw/wizard is installed:'));
          console.error(chalk.dim('  npm install @hydraclaw/wizard'));
          process.exit(1);
        }

        console.error(chalk.red(`Onboarding failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  return command;
}

function isModuleNotFoundError(err: unknown): boolean {
  if (err instanceof Error && 'code' in err) {
    return (err as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND' ||
           (err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND';
  }
  return false;
}
