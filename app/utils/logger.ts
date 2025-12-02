class BrowserLogger {
  private isDevelopment = process.env.NODE_ENV === 'development';
  private logEndpoint: string;

  constructor() {
    if (typeof window !== 'undefined') {
      this.logEndpoint = `${window.location.origin}/api/logs`;
    } else {
      this.logEndpoint = process.env.NODE_ENV === 'production' 
        ? '/api/logs' 
        : 'http://localhost:3000/api/logs';
    }
  }

  private async sendToServer(level: string, message: string, meta?: any): Promise<void> {
    const logPayload = {
      level: level,
      message: message,
      meta: meta || {},
      timestamp: new Date().toISOString(),
      url: typeof window !== 'undefined' ? window.location.href : 'unknown',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    };

    try {
      const response = await fetch(this.logEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logPayload),
      });

      if (!response.ok) {
        console.warn('Logger: Server responded with error', response.status);
      }
    } catch (error) {
      // Only show errors in production
      if (!this.isDevelopment) {
        console.error('Logger: Failed to send log to server', error);
      }
    }
  }

  debug(message: string, meta?: any): void {
    // ✅ FIXED: Only log to server, not to console to avoid duplicates
    this.sendToServer('DEBUG', message, meta).catch(() => {});
  }

  info(message: string, meta?: any): void {
    // ✅ FIXED: Only log to server, not to console to avoid duplicates
    this.sendToServer('INFO', message, meta).catch(() => {});
  }

  warn(message: string, meta?: any): void {
    // ✅ FIXED: Only log to server, not to console to avoid duplicates
    this.sendToServer('WARN', message, meta).catch(() => {});
  }

  error(message: string, error?: any, meta?: any): void {
    let errorInfo = '';
    if (error instanceof Error) {
      errorInfo = `Error: ${error.message} | Stack: ${error.stack}`;
    } else if (error) {
      errorInfo = `Error: ${JSON.stringify(error)}`;
    }
    
    const finalMeta = { 
      ...meta, 
      errorInfo,
      originalError: error 
    };
    
    // ✅ FIXED: Only log to server, not to console to avoid duplicates
    this.sendToServer('ERROR', message, finalMeta).catch(() => {});
  }

  http(message: string, meta?: any): void {
    // ✅ FIXED: Only log to server, not to console to avoid duplicates
    this.sendToServer('HTTP', message, meta).catch(() => {});
  }
}

export const Logger = new BrowserLogger();