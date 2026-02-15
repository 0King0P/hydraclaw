import { input, select, checkbox, confirm, password } from '@inquirer/prompts';

const HYDRACLAW_BANNER = `
 ██╗  ██╗██╗   ██╗██████╗ ██████╗  █████╗  ██████╗██╗      █████╗ ██╗    ██╗
 ██║  ██║╚██╗ ██╔╝██╔══██╗██╔══██╗██╔══██╗██╔════╝██║     ██╔══██╗██║    ██║
 ███████║ ╚████╔╝ ██║  ██║██████╔╝███████║██║     ██║     ███████║██║ █╗ ██║
 ██╔══██║  ╚██╔╝  ██║  ██║██╔══██╗██╔══██║██║     ██║     ██╔══██║██║███╗██║
 ██║  ██║   ██║   ██████╔╝██║  ██║██║  ██║╚██████╗███████╗██║  ██║╚███╔███╔╝
 ╚═╝  ╚═╝   ╚═╝   ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
`;

/**
 * Display the HydraClaw ASCII art banner along with a welcome message.
 */
export function showBanner(): void {
  console.log(HYDRACLAW_BANNER);
  console.log('  Welcome to the HydraClaw Onboarding Wizard');
  console.log('  -------------------------------------------');
  console.log('  This wizard will walk you through setting up your');
  console.log('  HydraClaw AI gateway step by step.\n');
}

/**
 * Securely prompt for an API key with masked input.
 */
export async function askApiKey(message: string): Promise<string> {
  const value = await password({
    message,
    mask: '*',
    validate(val: string) {
      if (val.length === 0) {
        return 'API key cannot be empty. Press Enter to skip if you want to configure later.';
      }
      return true;
    },
  });
  return value;
}

/**
 * Prompt for an optional API key. Returns an empty string if the user skips.
 */
export async function askOptionalApiKey(providerName: string): Promise<string> {
  const shouldConfigure = await askConfirm(`Do you want to configure an API key for ${providerName}?`);
  if (!shouldConfigure) {
    return '';
  }
  const value = await password({
    message: `Enter your ${providerName} API key:`,
    mask: '*',
  });
  return value;
}

/**
 * Prompt the user to select a single option from a list.
 */
export async function askSelect<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T; description?: string }>,
): Promise<T> {
  const answer = await select<T>({
    message,
    choices,
  });
  return answer;
}

/**
 * Prompt the user to select multiple options from a list.
 */
export async function askMultiSelect<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T; checked?: boolean; description?: string }>,
): Promise<T[]> {
  const answers = await checkbox<T>({
    message,
    choices,
  });
  return answers;
}

/**
 * Prompt the user with a yes/no confirmation.
 */
export async function askConfirm(message: string, defaultValue: boolean = false): Promise<boolean> {
  const answer = await confirm({
    message,
    default: defaultValue,
  });
  return answer;
}

/**
 * Prompt the user for free text input.
 */
export async function askText(
  message: string,
  opts?: { defaultValue?: string; validate?: (input: string) => string | true },
): Promise<string> {
  const answer = await input({
    message,
    default: opts?.defaultValue,
    validate: opts?.validate,
  });
  return answer;
}
