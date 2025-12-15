import chalk from 'chalk';

export const logger = {
  info: (msg) => console.log(chalk.cyan(msg)),
  warn: (msg) => console.warn(chalk.yellow(msg)),
  error: (msg) => console.error(chalk.red(msg)),
  success: (msg) => console.log(chalk.green(msg)),
};
