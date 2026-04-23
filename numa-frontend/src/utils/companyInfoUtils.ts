import { uploadFileToS3, fetchFileFromS3 } from './s3Utils';

// Constants
const COMPANY_INFO_KEY = 'company-data.json';
const COMPANY_PROFILE_CACHE_KEY = 'COMPANY_PROFILE_DATA';

// Character limits
export const LIMIT_COMPANY_NAME = 200;
export const LIMIT_INDUSTRY = 200;
export const LIMIT_COUNTRY = 200;
export const LIMIT_COMPANY_INFO = 3000;
export const LIMIT_BEST_PRACTICES = 3000;

export interface CompanyProfileData {
  companyName: string;
  industry: string;
  country: string;
  companyInformation: string;
  bestPractices: string;
  lastUpdated: string | null;
}

const EMPTY_PROFILE: CompanyProfileData = {
  companyName: '',
  industry: '',
  country: '',
  companyInformation: '',
  bestPractices: '',
  lastUpdated: null,
};

/**
 * Migrates old format ({ profile, lastUpdated }) to the new structured format.
 * If already in new format (has companyInformation), returns as-is.
 */
export const migrateCompanyProfile = (raw: Record<string, unknown>): CompanyProfileData => {
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_PROFILE };
  }

  // New format -- has companyInformation field
  if ('companyInformation' in raw) {
    return {
      companyName: (raw.companyName as string) || '',
      industry: (raw.industry as string) || '',
      country: (raw.country as string) || '',
      companyInformation: (raw.companyInformation as string) || '',
      bestPractices: (raw.bestPractices as string) || '',
      lastUpdated: (raw.lastUpdated as string) || null,
    };
  }

  // Old format -- migrate profile -> companyInformation
  if ('profile' in raw) {
    return {
      companyName: '',
      industry: '',
      country: '',
      companyInformation: (raw.profile as string) || '',
      bestPractices: '',
      lastUpdated: (raw.lastUpdated as string) || null,
    };
  }

  return { ...EMPTY_PROFILE, lastUpdated: (raw.lastUpdated as string) || null };
};

/**
 * Returns the cached company profile from sessionStorage, or null if not cached.
 */
const getCachedCompanyProfile = (): CompanyProfileData | null => {
  try {
    const cached = window.sessionStorage.getItem(COMPANY_PROFILE_CACHE_KEY);
    if (cached) {
      return migrateCompanyProfile(JSON.parse(cached));
    }
  } catch {
    // Ignore parse errors
  }
  return null;
};

/**
 * Writes the company profile to the sessionStorage cache.
 */
const setCachedCompanyProfile = (companyInfo: CompanyProfileData) => {
  try {
    window.sessionStorage.setItem(COMPANY_PROFILE_CACHE_KEY, JSON.stringify(companyInfo));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
};

/**
 * Clears the cached company profile from sessionStorage.
 * Call this when you need to force a fresh fetch from S3.
 */
export const clearCompanyProfileCache = () => {
  try {
    window.sessionStorage.removeItem(COMPANY_PROFILE_CACHE_KEY);
  } catch {
    // Ignore storage errors
  }
};

/**
 * Saves the structured company profile to S3.
 */
export const saveCompanyInfo = async (
  profileData: CompanyProfileData,
  s3Bucket: string,
  region: string,
  getCredentials: () => Promise<unknown>
): Promise<string> => {
  if (!region) {
    throw new Error('Region is missing for saveCompanyInfo');
  }
  if (!s3Bucket) {
    throw new Error('S3 bucket name is missing for saveCompanyInfo');
  }

  // Write new structured format only (no legacy `profile` key)
  const companyInfo: CompanyProfileData = {
    companyName: profileData.companyName,
    industry: profileData.industry,
    country: profileData.country,
    companyInformation: profileData.companyInformation,
    bestPractices: profileData.bestPractices,
    lastUpdated: new Date().toISOString(),
  };

  const dataContent = JSON.stringify(companyInfo, null, 2);

  const processedFile = {
    content: dataContent,
    contentType: 'application/json',
    inferredType: 'json',
  };

  const result = await uploadFileToS3(
    processedFile.content,
    processedFile.contentType,
    s3Bucket,
    COMPANY_INFO_KEY,
    region,
    getCredentials
  );

  setCachedCompanyProfile(companyInfo);
  return result;
};

/**
 * Fetches the company profile from S3, auto-migrating old format if needed.
 */
export const fetchCompanyInfo = async (
  s3Bucket: string,
  region: string,
  getCredentials: () => Promise<unknown>
): Promise<CompanyProfileData> => {
  const cached = getCachedCompanyProfile();
  if (cached) {
    return cached;
  }

  try {
    if (!region) {
      console.error('Region is missing for fetchCompanyInfo');
      return { ...EMPTY_PROFILE };
    }
    if (!s3Bucket) {
      console.error('S3 bucket name is missing for fetchCompanyInfo');
      return { ...EMPTY_PROFILE };
    }

    try {
      const fileBlob = await fetchFileFromS3(COMPANY_INFO_KEY, s3Bucket, region, getCredentials);
      const text = await fileBlob.text();
      const raw = JSON.parse(text);
      const companyInfo = migrateCompanyProfile(raw);
      setCachedCompanyProfile(companyInfo);
      return companyInfo;
    } catch (fetchError: unknown) {
      const msg = fetchError instanceof Error ? fetchError.message : '';
      if (msg.includes('Not Found') || msg.includes('Forbidden')) {
        console.warn('Company information file does not exist yet. Will create on first save.');
        const empty = { ...EMPTY_PROFILE };
        setCachedCompanyProfile(empty);
        return empty;
      }
      throw fetchError;
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn('Company profile not available:', msg);
    const empty = { ...EMPTY_PROFILE };
    setCachedCompanyProfile(empty);
    return empty;
  }
};

/**
 * Extracts just the main company information text for backwards-compatible callers
 * (e.g. useCompanyProfile hook, V1 chat prompt enhancement).
 */
export const getProfileText = (companyInfo: CompanyProfileData | Record<string, unknown> | null): string => {
  if (!companyInfo) return '';
  return (
    (companyInfo as CompanyProfileData).companyInformation ||
    ((companyInfo as Record<string, unknown>).profile as string) ||
    ''
  );
};
