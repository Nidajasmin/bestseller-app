export interface AgingSettings {
  minAgeDays: number;
  maxSales: number;
  requireInventory: boolean;
}

export const DEFAULT_AGING_SETTINGS: AgingSettings = {
  minAgeDays: 30,
  maxSales: 10,
  requireInventory: false,
};

// Key for localStorage/sessionStorage
export const AGING_SETTINGS_KEY = 'aged-products-settings';

// Cache settings
export const AGING_CACHE_KEY = 'aged-products-cache';
export const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export interface CacheData {
  data: any;
  timestamp: number;
  settings: AgingSettings;
}

// Load settings from storage
export const loadSettings = (): AgingSettings => {
  if (typeof window === 'undefined') {
    return DEFAULT_AGING_SETTINGS;
  }

  try {
    const stored = localStorage.getItem(AGING_SETTINGS_KEY);
    if (stored) {
      const parsedSettings = JSON.parse(stored);
      // Ensure all required fields are present
      return {
        minAgeDays: parsedSettings.minAgeDays || DEFAULT_AGING_SETTINGS.minAgeDays,
        maxSales: parsedSettings.maxSales || DEFAULT_AGING_SETTINGS.maxSales,
        requireInventory: parsedSettings.requireInventory !== undefined 
          ? parsedSettings.requireInventory 
          : DEFAULT_AGING_SETTINGS.requireInventory
      };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }

  return DEFAULT_AGING_SETTINGS;
};

// Save settings to storage
export const saveSettings = (settings: AgingSettings): void => {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(AGING_SETTINGS_KEY, JSON.stringify(settings));
    console.log('✅ Settings saved:', settings);
  } catch (error) {
    console.error('Error saving settings:', error);
  }
};

// Reset to default settings
export const resetSettings = (): AgingSettings => {
  if (typeof window === 'undefined') return DEFAULT_AGING_SETTINGS;

  try {
    localStorage.removeItem(AGING_SETTINGS_KEY);
    console.log('✅ Settings reset to defaults');
  } catch (error) {
    console.error('Error resetting settings:', error);
  }

  return DEFAULT_AGING_SETTINGS;
};

// Cache functions
export const getCachedData = (): CacheData | null => {
  if (typeof window === 'undefined') return null;
  
  try {
    const cached = localStorage.getItem(AGING_CACHE_KEY);
    if (cached) {
      const cacheData: CacheData = JSON.parse(cached);
      // Check if cache is still valid (less than 5 minutes old and same settings)
      const currentSettings = loadSettings();
      if (Date.now() - cacheData.timestamp < CACHE_DURATION && 
          JSON.stringify(cacheData.settings) === JSON.stringify(currentSettings)) {
        return cacheData;
      }
    }
  } catch (error) {
    console.error('Error reading cache:', error);
  }
  return null;
};

export const setCachedData = (data: any, settings: AgingSettings): void => {
  if (typeof window === 'undefined') return;
  
  try {
    const cacheData: CacheData = {
      data,
      timestamp: Date.now(),
      settings
    };
    localStorage.setItem(AGING_CACHE_KEY, JSON.stringify(cacheData));
  } catch (error) {
    console.error('Error saving cache:', error);
  }
};