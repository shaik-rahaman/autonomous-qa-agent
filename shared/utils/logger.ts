/**
 * Shared Utilities Logger
 * Centralized logging for all agents
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  SUCCESS = 'SUCCESS',
}

export class Logger {
  private prefix: string;

  constructor(prefix: string = 'App') {
    this.prefix = prefix;
  }

  debug(message: string, data?: any) {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: any) {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: any) {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, data?: any) {
    this.log(LogLevel.ERROR, message, data);
  }

  success(message: string, data?: any) {
    this.log(LogLevel.SUCCESS, message, data);
  }

  private log(level: LogLevel, message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${this.prefix}] [${level}]`;
    
    if (data) {
      console.log(`${prefix} ${message}`, data);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }

  section(title: string) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${title}`);
    console.log(`${'='.repeat(60)}\n`);
  }
}
