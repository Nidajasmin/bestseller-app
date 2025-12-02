import { AppLogger } from './logging';

export function testLogging() {
  console.log('🧪 Testing logging system...');
  
  // Test different log levels
  AppLogger.info('Testing info level log');
  AppLogger.warn('Testing warning level log');
  AppLogger.error('Testing error level log', new Error('Test error message'));
  AppLogger.debug('Testing debug level log');
  
  // Test with metadata
  AppLogger.info('Test log with metadata', { 
    userId: '123', 
    action: 'test',
    collectionId: 'test-collection'
  });

  // Test custom loggers
  AppLogger.db('create', 'Product', { id: 'prod_123', name: 'Test Product' });
  AppLogger.shopifyAPI('query', 'products', { first: 50 });
  
  console.log('✅ Logging test completed!');
}

// Simple test execution
testLogging();