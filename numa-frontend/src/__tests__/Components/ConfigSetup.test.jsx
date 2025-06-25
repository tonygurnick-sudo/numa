import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchConfigAddtoSession,
  hasConfigInSession,
  forceRefreshConfig,
  clearConfigCache,
} from '../../Components/ConfigSetup';

describe('ConfigSetup', () => {
  let mockSessionStorage = {};
  let mockFetch;
  let mockWindowReload;

  // Mock configs for testing
  const config1 = {
    Q_APPLICATION_ID: 'app-1',
    Q_INDEX_ID: 'index-1',
    REGION: 'us-east-1',
    API_ENDPOINT: 'https://api1.example.com',
    USER_POOL_ID: 'pool-1',
    CLIENT_ID: 'client-1',
    CLIENT_NAME: 'test-client-1',
    HONEYCOMB_KEY: 'honey-1',
    GROUPS: {
      admin: { roleArn: 'arn:aws:iam::123:role/admin', features: ['chat'] },
      standard: { roleArn: 'arn:aws:iam::123:role/standard', features: ['chat'] },
    },
  };

  const config2 = {
    ...config1,
    Q_APPLICATION_ID: 'app-2',
    API_ENDPOINT: 'https://api2.example.com',
    CLIENT_NAME: 'test-client-2',
    HONEYCOMB_KEY: 'honey-2',
  };

  const CACHE_DURATION_TIMER = 2 * 60 * 60 * 1000; // 2 hours

  beforeEach(() => {
    // Reset mock storage
    mockSessionStorage = {};

    // Mock sessionStorage
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: vi.fn((key) => mockSessionStorage[key] || null),
        setItem: vi.fn((key, value) => {
          mockSessionStorage[key] = value;
        }),
        removeItem: vi.fn((key) => {
          delete mockSessionStorage[key];
        }),
        clear: vi.fn(() => {
          mockSessionStorage = {};
        }),
      },
      writable: true,
    });

    // Mock window.location.reload
    mockWindowReload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: mockWindowReload },
      writable: true,
    });

    // Mock fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Use fake timers
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('fetchConfigAddtoSession', () => {
    it('should fetch and store config on first call', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(config1),
      });

      await fetchConfigAddtoSession();

      expect(mockFetch).toHaveBeenCalledWith('/config.json', {
        headers: { 'Content-Type': 'application/json' },
      });
      expect(mockSessionStorage.Q_APPLICATION_ID).toBe('app-1');
      expect(mockSessionStorage.API_ENDPOINT).toBe('https://api1.example.com');
      expect(mockSessionStorage.CONFIG_TIMESTAMP).toBeDefined();
    });

    it('should not fetch config again if cache is fresh', async () => {
      // First call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(config1),
      });

      await fetchConfigAddtoSession();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call within cache duration
      vi.advanceTimersByTime(1000); // 1 second < 1 hour cache duration
      await fetchConfigAddtoSession();
      expect(mockFetch).toHaveBeenCalledTimes(1); // Should not fetch again
    });

    it('should refetch config after cache expires', async () => {
      // First call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(config1),
      });

      await fetchConfigAddtoSession();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockSessionStorage.Q_APPLICATION_ID).toBe('app-1');

      // Advance time beyond cache duration (2 hours)
      vi.advanceTimersByTime(CACHE_DURATION_TIMER);

      // Second call with different config
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(config2),
      });

      await fetchConfigAddtoSession();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockSessionStorage.Q_APPLICATION_ID).toBe('app-2');
    });

    it('should detect config changes and trigger reload', async () => {
      // First call - will always trigger reload since sessionStorage starts empty
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(config1),
      });

      await fetchConfigAddtoSession();
      expect(mockWindowReload).toHaveBeenCalledTimes(1); // First fetch always triggers reload

      // Reset reload mock and advance time beyond cache duration
      mockWindowReload.mockClear();
      vi.advanceTimersByTime(CACHE_DURATION_TIMER); // Beyond cache duration

      // Fetch different config - should trigger reload due to changes
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(config2),
      });

      await fetchConfigAddtoSession();
      expect(mockWindowReload).toHaveBeenCalledTimes(1); // Config changes trigger reload
    });

    it('should handle fetch errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(fetchConfigAddtoSession()).rejects.toThrow('Network error');
    });

    it('should handle invalid JSON response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await expect(fetchConfigAddtoSession()).rejects.toThrow('Config file is empty');
    });
  });

  describe('time-based caching behavior', () => {
    it('should demonstrate full cache cycle with different configs', async () => {
      console.log = vi.fn(); // Mock console.log to capture logs

      // Step 1: Initial config fetch - will trigger reload since storage is empty
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(config1),
      });

      await fetchConfigAddtoSession();
      expect(mockSessionStorage.Q_APPLICATION_ID).toBe('app-1');
      expect(mockSessionStorage.CLIENT_NAME).toBe('test-client-1');
      expect(console.log).toHaveBeenCalledWith('No config timestamp found, needs refresh');
      expect(console.log).toHaveBeenCalledWith('Config changed, reloading page');
      expect(mockWindowReload).toHaveBeenCalledTimes(1); // First fetch triggers reload

      // Reset mocks for cleaner testing of subsequent steps
      console.log.mockClear();
      mockWindowReload.mockClear();

      // Step 2: Try to fetch again immediately (should use cache)
      await fetchConfigAddtoSession();
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still only 1 call
      expect(console.log).toHaveBeenCalledWith('Config is still fresh, skipping fetch');

      // Step 3: Advance time by 2 hours (way past 1 hour cache duration)
      vi.advanceTimersByTime(CACHE_DURATION_TIMER);

      // Step 4: Fetch different config after cache expires
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(config2),
      });

      await fetchConfigAddtoSession();
      expect(mockFetch).toHaveBeenCalledTimes(2); // Now 2 calls
      expect(mockSessionStorage.Q_APPLICATION_ID).toBe('app-2');
      expect(mockSessionStorage.CLIENT_NAME).toBe('test-client-2');
      expect(mockWindowReload).toHaveBeenCalledTimes(1); // Config changes trigger reload
    });
  });

  describe('hasConfigInSession', () => {
    it('should return false when no config is present', () => {
      expect(hasConfigInSession()).toBe(false);
    });

    it('should return false when only some config keys are present', () => {
      mockSessionStorage.Q_APPLICATION_ID = 'app-1';
      mockSessionStorage.REGION = 'us-east-1';
      // Missing other required keys
      expect(hasConfigInSession()).toBe(false);
    });

    it('should return true when all required config keys are present', () => {
      mockSessionStorage.Q_APPLICATION_ID = 'app-1';
      mockSessionStorage.REGION = 'us-east-1';
      mockSessionStorage.API_ENDPOINT = 'https://api.example.com';
      mockSessionStorage.USER_POOL_ID = 'pool-1';
      mockSessionStorage.CLIENT_ID = 'client-1';
      expect(hasConfigInSession()).toBe(true);
    });
  });

  describe('forceRefreshConfig', () => {
    it('should force config refresh regardless of cache', async () => {
      // Initial config
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(config1),
      });
      await fetchConfigAddtoSession();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Force refresh immediately (ignoring cache)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(config2),
      });
      await forceRefreshConfig();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockSessionStorage.Q_APPLICATION_ID).toBe('app-2');
    });
  });

  describe('clearConfigCache', () => {
    it('should clear the config timestamp', () => {
      mockSessionStorage.CONFIG_TIMESTAMP = '12345';
      clearConfigCache();
      expect(mockSessionStorage.CONFIG_TIMESTAMP).toBeUndefined();
    });
  });

  describe('config change detection', () => {
    it('should detect changes in GROUPS object', async () => {
      const initialConfig = { ...config1 };
      const updatedConfig = {
        ...config1,
        GROUPS: {
          admin: { roleArn: 'arn:aws:iam::123:role/admin-new', features: ['chat', 'admin'] },
          standard: { roleArn: 'arn:aws:iam::123:role/standard', features: ['chat'] },
        },
      };

      // Initial fetch - will trigger reload since storage is empty
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(initialConfig),
      });
      await fetchConfigAddtoSession();
      expect(mockWindowReload).toHaveBeenCalledTimes(1); // First fetch triggers reload

      // Reset mock and advance time beyond cache duration
      mockWindowReload.mockClear();
      vi.advanceTimersByTime(CACHE_DURATION_TIMER);

      // Fetch updated config
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(updatedConfig),
      });
      await fetchConfigAddtoSession();

      expect(mockWindowReload).toHaveBeenCalledTimes(1); // Config change triggers reload
      expect(JSON.parse(mockSessionStorage.GROUPS)).toEqual(updatedConfig.GROUPS);
    });

    it('should detect boolean value changes', async () => {
      const configWithBoolean1 = { ...config1, PROVISION_Q_RESOURCES: true };
      const configWithBoolean2 = { ...config1, PROVISION_Q_RESOURCES: false };

      // Initial fetch - will trigger reload since storage is empty
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(configWithBoolean1),
      });
      await fetchConfigAddtoSession();
      expect(mockSessionStorage.PROVISION_Q_RESOURCES).toBe('true');
      expect(mockWindowReload).toHaveBeenCalledTimes(1); // First fetch triggers reload

      // Reset mock and advance time beyond cache duration
      mockWindowReload.mockClear();
      vi.advanceTimersByTime(CACHE_DURATION_TIMER);

      // Fetch updated config
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(configWithBoolean2),
      });
      await fetchConfigAddtoSession();

      expect(mockWindowReload).toHaveBeenCalledTimes(1); // Config change triggers reload
      expect(mockSessionStorage.PROVISION_Q_RESOURCES).toBe('false');
    });
  });
});
