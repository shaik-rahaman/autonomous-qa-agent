/**
 * Logging utility with chalk for colored output
 */

import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

class Logger {
  private prefix = '[QA-Agent]';

  debug(message: string, data?: unknown) {
    console.log(chalk.gray(`${this.prefix} [DEBUG] ${message}`), data ?? '');
  }

  info(message: string, data?: unknown) {
    console.log(chalk.blue(`${this.prefix} [INFO] ${message}`), data ?? '');
  }

  warn(message: string, data?: unknown) {
    console.warn(chalk.yellow(`${this.prefix} [WARN] ${message}`), data ?? '');
  }

  error(message: string, data?: unknown) {
    console.error(chalk.red(`${this.prefix} [ERROR] ${message}`), data ?? '');
  }

  success(message: string, data?: unknown) {
    console.log(chalk.green(`${this.prefix} [SUCCESS] ${message}`), data ?? '');
  }

  section(title: string) {
    console.log(chalk.cyan(`\n${'='.repeat(50)}`));
    console.log(chalk.cyan(`${this.prefix} ${title}`));
    console.log(chalk.cyan(`${'='.repeat(50)}\n`));
  }
}

export const logger = new Logger();
