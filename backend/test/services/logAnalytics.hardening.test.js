const { sanitizeLogTypePrefix, sanitizeSchemaVersion, getSettings, testConnection } = require('../../src/services/logAnalytics');

describe('Log Analytics Service - Hardening', () => {
  describe('sanitizeLogTypePrefix', () => {
    it('should allow only alphanumeric and underscore', () => {
      expect(sanitizeLogTypePrefix('TrustM365')).toBe('TrustM365');
      expect(sanitizeLogTypePrefix('Trust_M365')).toBe('Trust_M365');
      expect(sanitizeLogTypePrefix('Trust-M365!@#')).toBe('TrustM365');
      expect(sanitizeLogTypePrefix('')).toBe('TrustM365');
      expect(sanitizeLogTypePrefix(null)).toBe('TrustM365');
    });
  });

  describe('sanitizeSchemaVersion', () => {
    it('should trim and limit to 24 chars', () => {
      expect(sanitizeSchemaVersion('1.0')).toBe('1.0');
      expect(sanitizeSchemaVersion(' 2.0 ')).toBe('2.0');
      expect(sanitizeSchemaVersion('a'.repeat(30))).toBe('a'.repeat(24));
      expect(sanitizeSchemaVersion('')).toBe('1.0');
      expect(sanitizeSchemaVersion(null)).toBe('1.0');
    });
  });

  describe('getSettings', () => {
    it('should return default values if DB is empty', () => {
      // This test assumes a clean DB or mocks getDb
      const settings = getSettings();
      expect(typeof settings.enabled).toBe('boolean');
      expect(typeof settings.workspaceId).toBe('string');
      expect(typeof settings.sharedKeyEncrypted).toBe('string');
      expect(typeof settings.logTypePrefix).toBe('string');
      expect(typeof settings.schemaVersion).toBe('string');
      expect(typeof settings.categories).toBe('object');
    });
  });

  describe('testConnection', () => {
    it('should fail with invalid workspaceId', async () => {
      await expect(testConnection({ workspaceId: '', sharedKeyEncrypted: 'bad' })).rejects.toThrow();
    });
  });
});
