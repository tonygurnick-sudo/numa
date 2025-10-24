import type { BrandingTheme } from '../Providers/BrandingContext';

export type BrandingVersionSummary = {
  versionId: string;
  label?: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type BrandingConfigResponse = {
  enabled?: boolean;
  branding?: BrandingTheme & {
    componentGroups?: Record<string, boolean>;
    assets?: {
      logoNav?: string | null;
      logoLoginRight?: string | null;
      favicon?: string | null;
    };
  };
  updatedAt?: string;
  updatedBy?: string;
  versionId?: string;
  history?: BrandingVersionSummary[];
};

export type BrandingHistoryResponse = {
  history?: BrandingVersionSummary[];
};

export type BrandingSavePayload = {
  enabled: boolean;
  branding: BrandingTheme & {
    componentGroups?: Record<string, boolean>;
    assets?: {
      logoNav?: string | null;
      logoLoginRight?: string | null;
      favicon?: string | null;
    };
  };
  createVersion?: boolean;
};

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

const getBaseUrl = () =>
  sessionStorage.getItem('BRANDING_API_BASE_URL') || sessionStorage.getItem('API_ENDPOINT') || '/api';
const getClientId = () => sessionStorage.getItem('CLIENT_NAME') || 'numa';

type PresignResponse = {
  uploadUrl: string;
  assetUrl: string;
  headers?: Record<string, string>;
};

export const BrandingAdminService = {
  async fetchConfig(numaGet: NumaGet): Promise<BrandingConfigResponse> {
    const clientId = getClientId();
    const result = (await numaGet(`${getBaseUrl()}/branding/${clientId}`)) as BrandingConfigResponse;
    return result || {};
  },
  async fetchHistory(numaGet: NumaGet): Promise<BrandingHistoryResponse> {
    const clientId = getClientId();
    const result = (await numaGet(`${getBaseUrl()}/branding/${clientId}/versions`)) as BrandingHistoryResponse;
    return result || {};
  },
  async saveConfig(numaPut: NumaPut, payload: BrandingSavePayload): Promise<void> {
    const clientId = getClientId();
    await numaPut(`${getBaseUrl()}/branding/${clientId}`, payload);
  },
  async requestAssetUpload(
    numaPost: NumaPost,
    assetType: string,
    file: File,
  ): Promise<PresignResponse & { fields?: Record<string, string> }> {
    const clientId = getClientId();
    const response = (await numaPost(`${getBaseUrl()}/branding/${clientId}/assets`, {
      assetType,
      contentType: file.type,
      fileName: file.name,
    })) as PresignResponse & { fields?: Record<string, string> };
    return response;
  },
  async revertVersion(numaPost: NumaPost, versionId: string): Promise<BrandingConfigResponse> {
    const clientId = getClientId();
    const result = (await numaPost(
      `${getBaseUrl()}/branding/${clientId}/versions/${versionId}/revert`,
    )) as BrandingConfigResponse;
    return result || {};
  },
};
