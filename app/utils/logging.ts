import { Logger } from './logger';

export class AppLogger {
  static info(message: string, meta?: any): void {
    Logger.info(message, meta);
  }

  static error(message: string, error?: any, meta?: any): void {
    Logger.error(message, error, meta);
  }

  static warn(message: string, meta?: any): void {
    Logger.warn(message, meta);
  }

  static http(message: string, meta?: any): void {
    Logger.http(message, meta);
  }

  static debug(message: string, meta?: any): void {
    Logger.debug(message, meta);
  }

  static db(operation: string, model: string, data?: any): void {
    Logger.info(`DB ${operation} on ${model}`, { model, operation, data });
  }

  static shopifyAPI(operation: string, resource: string, data?: any): void {
    Logger.info(`Shopify API ${operation} on ${resource}`, { 
      resource, 
      operation, 
      data 
    });
  }
}