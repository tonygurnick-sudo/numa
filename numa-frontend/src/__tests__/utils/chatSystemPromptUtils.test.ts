/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  enhanceSystemPromptWithCompanyInfo,
  loadCompanyProfile,
  getEnabledTools,
  generateSystemPrompt,
} from '../../utils/chatSystemPromptUtils';
import { fetchCompanyInfo, getProfileText } from '../../utils/companyInfoUtils';

// Mock the companyInfoUtils functions
vi.mock('../../utils/companyInfoUtils', () => ({
  fetchCompanyInfo: vi.fn(),
  getProfileText: vi.fn(),
}));

describe('chatSystemPromptUtils', () => {
  const mockCompanyBucket = 'test-bucket';
  const mockRegion = 'us-east-1';
  const mockGetCredentials = vi.fn().mockResolvedValue({ accessKeyId: 'test', secretAccessKey: 'test' });
  const mockCompanyInfo = { profile: 'Test Company Profile', lastUpdated: '2025-03-26T22:48:00.000Z' };
  const mockProfileText = 'Test Company Profile';

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock console methods
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Enable Agents feature for tests that expect agent tool guidance by default
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem('AGENTS', 'true');
    }
  });

  afterEach(() => {
    // Restore console methods
    console.log.mockRestore();
    console.error.mockRestore();
  });

  describe('enhanceSystemPromptWithCompanyInfo', () => {
    const basePrompt =
      "This is a base system prompt.\n\nHere is some information about the user that you can use to personalise your response:\n\nUser Email: test@example.com\nToday's Date: 2025-03-26";

    it('should return the base prompt unchanged if company profile is empty', () => {
      // Test with empty string
      expect(enhanceSystemPromptWithCompanyInfo(basePrompt, '')).toBe(basePrompt);

      // Test with null
      expect(enhanceSystemPromptWithCompanyInfo(basePrompt, null)).toBe(basePrompt);

      // Test with undefined
      expect(enhanceSystemPromptWithCompanyInfo(basePrompt, undefined)).toBe(basePrompt);

      // Test with whitespace only
      expect(enhanceSystemPromptWithCompanyInfo(basePrompt, '   ')).toBe(basePrompt);
    });

    it('should insert company info before user information if split point is found', () => {
      const result = enhanceSystemPromptWithCompanyInfo(basePrompt, mockProfileText);

      // Check that the result contains the company profile
      expect(result).toContain('**Company Information:**');
      expect(result).toContain(mockProfileText);

      // Check that the company info is inserted before the user info
      const companyInfoIndex = result.indexOf('**Company Information:**');
      const userInfoIndex = result.indexOf('Here is some information about the user');
      expect(companyInfoIndex).toBeLessThan(userInfoIndex);

      // Check that the user info is still present
      expect(result).toContain('User Email: test@example.com');
      expect(result).toContain("Today's Date: 2025-03-26");
    });

    it('should append company info to the end if split point is not found', () => {
      const customPrompt = 'This is a custom prompt without the standard user info section.';
      const result = enhanceSystemPromptWithCompanyInfo(customPrompt, mockProfileText);

      // Check that the result contains the company profile
      expect(result).toContain('**Company Information:**');
      expect(result).toContain(mockProfileText);

      // Check that the company info is appended to the end
      expect(result).toBe(`${customPrompt}\n\n**Company Information:**\n${mockProfileText}`);
    });
  });

  describe('loadCompanyProfile', () => {
    it('should return empty string if required parameters are missing', async () => {
      // Test with missing region
      expect(await loadCompanyProfile(mockCompanyBucket, null, mockGetCredentials)).toBe('');

      // Test with missing bucket
      expect(await loadCompanyProfile(null, mockRegion, mockGetCredentials)).toBe('');

      // Test with missing credentials function
      expect(await loadCompanyProfile(mockCompanyBucket, mockRegion, null)).toBe('');

      // Verify console.log was called
      expect(console.log).toHaveBeenCalledWith('Missing required parameters for loading company profile');
    });

    it('should fetch company info and return profile text', async () => {
      // Setup mocks
      fetchCompanyInfo.mockResolvedValue(mockCompanyInfo);
      getProfileText.mockReturnValue(mockProfileText);

      // Call the function
      const result = await loadCompanyProfile(mockCompanyBucket, mockRegion, mockGetCredentials);

      // Check that fetchCompanyInfo was called with the correct parameters
      expect(fetchCompanyInfo).toHaveBeenCalledWith(mockCompanyBucket, mockRegion, mockGetCredentials);

      // Check that getProfileText was called with the company info
      expect(getProfileText).toHaveBeenCalledWith(mockCompanyInfo);

      // Check the result
      expect(result).toBe(mockProfileText);
    });

    it('should handle errors and return empty string', async () => {
      // Setup mock to throw an error
      fetchCompanyInfo.mockRejectedValue(new Error('Test error'));

      // Call the function
      const result = await loadCompanyProfile(mockCompanyBucket, mockRegion, mockGetCredentials);

      // Check that fetchCompanyInfo was called
      expect(fetchCompanyInfo).toHaveBeenCalled();

      // Check that console.error was called with the error
      expect(console.error).toHaveBeenCalledWith('Error loading company profile:', expect.any(Error));

      // Check the result is an empty string
      expect(result).toBe('');
    });
  });

  describe('getEnabledTools', () => {
    it('enables core tools in auto mode', () => {
      const tools = getEnabledTools(true, false, false, false, ['kb-test-123'], true);
      expect(tools).toEqual(['query_knowledge_base', 'web_search', 'data_analysis', 'create_agent_tool']);
    });

    it('includes create_agent_tool in auto mode when explicitly enabled', () => {
      const tools = getEnabledTools(true, false, false, true, ['kb-test-123'], true);
      expect(tools).toEqual(['query_knowledge_base', 'web_search', 'data_analysis', 'create_agent_tool']);
    });

    it('enables only query_knowledge_base when KBs are selected in manual mode', () => {
      const tools = getEnabledTools(false, false, false, false, ['kb-test-123'], true);
      expect(tools).toEqual(['query_knowledge_base']);
    });

    it('enables only web_search when selected in manual mode', () => {
      const tools = getEnabledTools(false, true, false, false, [], true);
      expect(tools).toEqual(['web_search']);
    });

    it('enables both when both selected in manual mode', () => {
      const tools = getEnabledTools(false, true, false, false, ['kb-test-123'], true);
      expect(tools).toEqual(['query_knowledge_base', 'web_search']);
    });

    it('enables none when none selected in manual mode', () => {
      const tools = getEnabledTools(false, false, false, false, [], true);
      expect(tools).toEqual([]);
    });

    it('enables only create_agent_tool when toggled in manual mode', () => {
      const tools = getEnabledTools(false, false, false, true, [], true);
      expect(tools).toEqual(['create_agent_tool']);
    });
  });

  describe('generateSystemPrompt', () => {
    it('includes rubric-based web_search guidance when web_search is enabled', () => {
      const email = 'test@example.com';
      const prompt = generateSystemPrompt(['web_search'], email, '');
      expect(prompt).toContain('Use web_search to find current information from the internet');
      expect(prompt).toContain(
        '**IMPORTANT Tool Priority**: ALWAYS prioritize query_knowledge_base results when available',
      );
    });

    it('omits rubric guidance when web_search is not enabled', () => {
      const email = 'test@example.com';
      const prompt = generateSystemPrompt(['query_knowledge_base'], email, '');
      expect(prompt).not.toContain('Use web_search to find current information from the internet');
      expect(prompt).not.toContain(
        '**IMPORTANT Tool Priority**: ALWAYS prioritize query_knowledge_base results when available',
      );
    });

    it('includes user email and date metadata', () => {
      const email = 'user@org.co.nz';
      const prompt = generateSystemPrompt(['query_knowledge_base', 'web_search'], email, '');
      expect(prompt).toContain(`User Email: ${email}`);
      expect(prompt).toContain("Today's Date:");
    });

    it('includes guidance for create_agent_tool when available', () => {
      const email = 'user@example.com';
      const prompt = generateSystemPrompt(['create_agent_tool'], email, '', [], true);
      expect(prompt).toContain('Use create_agent_tool');
    });
  });
});
