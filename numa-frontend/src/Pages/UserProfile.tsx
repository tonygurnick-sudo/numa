import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFlag } from '../utils/featureFlags';
import { Alert, Button, Form, InputGroup, Modal, Spinner, Tab } from 'react-bootstrap';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import axios from 'axios';
import { useAuth } from '../Providers/AuthProvider';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useConfirm } from '../Providers/ConfirmContext';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import {
  AdminChatSettingsService,
  DEFAULT_GLOBAL_CHAT_SETTINGS,
  type GlobalChatSettings,
} from '../Services/AdminChatSettingsService';
import { AdminMfaSettingsService, type RecoveryCodesStatus } from '../Services/AdminMfaSettingsService';
import { RecoveryCodesModal } from '../Components/RecoveryCodesModal';
import {
  ChatSettingsService,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_USER_PROFILE,
  type UserChatSettingsUpdate,
  type UserProfile,
} from '../Services/ChatSettingsService';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { ConnectorsService } from '../Services/ConnectorsService';
import { DataConnectorsService } from '../Services/DataConnectorsService';
import { AdminIntegrationsService } from '../Services/AdminIntegrationsService';
import { getConnectorById } from '../Components/DataConnectors/connectorRegistry';
import {
  connectorSlugForPipedream,
  pipedreamSlugForConnector,
} from '../Components/Integrations/integrationCatalogHelpers';
import {
  IntegrationAccountButton,
  type IntegrationAccount,
} from '../Components/Integrations/IntegrationAccountSelector';
import { withPRM } from '../utils/prmUtils';
import { MY_FILES_SENTINEL, expandMyFilesSentinel, sortKnowledgeBases } from '../constants/knowledgeBase';

// Personal folder is user-toggleable only — admins can't reach it through
// their UI, so company-level defaults never carry the sentinel. Re-inject it
// whenever we materialise user-facing defaults from company-side state so
// "Reset to company defaults" + "user defaults disabled" both surface Personal
// as on by default. Users can still toggle it off explicitly afterwards.
const withPersonalSentinel = (ids: string[]): string[] =>
  ids.includes(MY_FILES_SENTINEL) ? ids : [...ids, MY_FILES_SENTINEL];
import ExpandableOverflowBox from '../Components/ExpandableOverflowBox';
import { PageHeader } from '../Components/PageHeader';
import { StyledTabs } from '../Components/StyledTabs';
import { manifestService } from '../Services/manifestService';
import { CHAT_SUGGESTIONS_DISABLED } from '../hooks/useChatSuggestions';
import { applyLanguagePreference, LANGUAGE_BROWSER_DEFAULT } from '../utils/languagePreference';
import { getConnectionDisplayName, getConnectionIcon, getConnectionFallbackIcon } from '../config/integrationsConfig';
import ProfileAvatar from '../Components/ProfileAvatar';
import { invalidateProfileBlob } from '../utils/profileImageCache';
import { RichTextEditor } from '../Components/Ops/Shared/RichTextEditor';
import { CharCount } from '../Components/CharCount';
import { MemoriesPanel } from '../Components/Memories/MemoriesPanel';
import { listAgents, getCachedAgents } from '../Services/AgentsService';
import type { AgentSummary } from '../types/agents';

type Connection = {
  id: string;
  isConnected: boolean;
  mcpServerUrl?: string;
  // FEAT-019: admin multi-account opt-in + the user's connected accounts for
  // this integration. Drive the per-account submenu in the Chat Defaults
  // picker. Empty/undefined accounts = legacy single-account UX (no submenu).
  allowMultipleAccounts?: boolean;
  accounts?: Array<{ account_id: string; name?: string | null; healthy?: boolean | null; dead?: boolean | null }>;
};

const IMAGE_TARGET_SIZE = 256;
const IMAGE_MAX_BYTES = 4 * 1024 * 1024; // 4 MB

// Character limits (match backend validation)
const LIMIT_NAME = 100;
const LIMIT_TITLE = 100;
const LIMIT_URL = 200;
const LIMIT_LONG = 500;
const LIMIT_CUSTOM_INSTRUCTIONS = 1500;

interface UserProfilePageProps {
  embedded?: boolean;
  activeTabKey?: string;
  onActiveTabChange?: (tabKey: string) => void;
  /** When embedded in Settings, the current scope ('user' | 'admin'). Re-fetches data when switching back to 'user'. */
  settingsScope?: 'user' | 'admin';
}

export default function UserProfilePage({
  embedded = false,
  activeTabKey,
  onActiveTabChange,
  settingsScope = 'user',
}: UserProfilePageProps) {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const confirm = useConfirm();
  const {
    user,
    getCredentials,
    listDevices,
    forgetDevice,
    lambdaClient,
    initiateReEnrollMfa,
    completeReEnrollMfa,
    verifyPassword,
  } = useAuth();
  const { numaGet, numaPut, numaPost } = useNumaRequest();
  const { availableKBs, isLoadingKBs, kbError } = useKnowledgeBase();

  const [localActiveKey, setLocalActiveKey] = useState<string>('my-profile');
  const selectedTabKey = activeTabKey ?? localActiveKey;
  const setSelectedTabKey = onActiveTabChange ?? setLocalActiveKey;

  // User profile (AI memory) state — independent from chat settings
  const [userProfile, setUserProfile] = useState<UserProfile>({ ...DEFAULT_USER_PROFILE });
  const [profileLoading, setProfileLoading] = useState<boolean>(true);
  const [profileSaving, setProfileSaving] = useState<boolean>(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileDirty, setProfileDirty] = useState<boolean>(false);

  const [globalAllowUserDefaults, setGlobalAllowUserDefaults] = useState<boolean>(false);
  const [globalLoaded, setGlobalLoaded] = useState<boolean>(false);
  const [companyDefaults, setCompanyDefaults] = useState<GlobalChatSettings>(DEFAULT_GLOBAL_CHAT_SETTINGS);

  const [userDefaultsEnabled, setUserDefaultsEnabled] = useState<boolean>(false);
  const [userDefaults, setUserDefaults] = useState(() => ({ ...DEFAULT_CHAT_SETTINGS }));
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState<boolean>(false);

  // Snapshots of last-saved state — auto-clear dirty when user undoes changes
  const savedDefaultsRef = useRef('');
  const savedDefaultsEnabledRef = useRef(false);
  const savedProfileRef = useRef('');
  const hasWorkspaceChat = getFlag('NUMA_WORKSPACE_CHAT');
  const hasPipedreamFeature = getFlag('PIPEDREAM_INTEGRATIONS');
  const hasOps = getFlag('NUMA_OPS');
  const hasMfa = window.sessionStorage.getItem('MFA_ENABLED') === 'true';

  type DeviceInfo = {
    deviceKey: string;
    deviceName: string;
    lastAuthDate: Date | null;
    remembered: boolean;
    isCurrent: boolean;
  };
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [deviceRevoking, setDeviceRevoking] = useState<string | null>(null);

  // MFA re-enrollment modal state
  const [reEnrollModalOpen, setReEnrollModalOpen] = useState(false);
  const [reEnrollStep, setReEnrollStep] = useState<'password' | 'setup' | 'done'>('password');
  const [reEnrollPassword, setReEnrollPassword] = useState('');
  const [reEnrollShowPassword, setReEnrollShowPassword] = useState(false);
  const [reEnrollMfaSetup, setReEnrollMfaSetup] = useState<{
    otpauthUrl: string;
    secretCode: string;
  } | null>(null);
  const [reEnrollCode, setReEnrollCode] = useState('');
  const [reEnrollLoading, setReEnrollLoading] = useState(false);
  const [reEnrollError, setReEnrollError] = useState<string | null>(null);
  const [reEnrollSuccess, setReEnrollSuccess] = useState(false);
  const [reEnrollSecretCopied, setReEnrollSecretCopied] = useState(false);

  // Recovery codes state
  const [recoveryCodesStatus, setRecoveryCodesStatus] = useState<RecoveryCodesStatus | null>(null);
  const [recoveryCodesGenerating, setRecoveryCodesGenerating] = useState(false);
  const [recoveryCodesError, setRecoveryCodesError] = useState<string | null>(null);
  const [showRecoveryCodesModal, setShowRecoveryCodesModal] = useState(false);
  const [generatedRecoveryCodes, setGeneratedRecoveryCodes] = useState<string[]>([]);

  const loadDevices = useCallback(async () => {
    if (!hasMfa || !listDevices) return;
    setDevicesLoading(true);
    try {
      const result = await listDevices();
      setDevices(result);
    } catch (err) {
      console.error('loadDevices failed:', err);
    } finally {
      setDevicesLoading(false);
    }
  }, [hasMfa, listDevices]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  const handleForgetDevice = useCallback(
    async (deviceKey: string) => {
      if (!forgetDevice) return;
      setDeviceRevoking(deviceKey);
      try {
        await forgetDevice(deviceKey);
        setDevices((prev) => prev.filter((d) => d.deviceKey !== deviceKey));
      } catch {
        // silently fail
      } finally {
        setDeviceRevoking(null);
      }
    },
    [forgetDevice]
  );

  const handleOpenReEnrollModal = useCallback(() => {
    setReEnrollModalOpen(true);
    setReEnrollStep('password');
    setReEnrollPassword('');
    setReEnrollShowPassword(false);
    setReEnrollMfaSetup(null);
    setReEnrollCode('');
    setReEnrollError(null);
    setReEnrollSecretCopied(false);
  }, []);

  const handleCloseReEnrollModal = useCallback(() => {
    setReEnrollModalOpen(false);
    setReEnrollPassword('');
    setReEnrollMfaSetup(null);
    setReEnrollCode('');
    setReEnrollError(null);
  }, []);

  const handleReEnrollPasswordSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!reEnrollPassword) return;
      setReEnrollError(null);
      setReEnrollLoading(true);
      try {
        await verifyPassword(reEnrollPassword);
        // Password verified — now initiate MFA re-enrollment
        const setupData = await initiateReEnrollMfa();
        setReEnrollMfaSetup({ otpauthUrl: setupData.otpauthUrl, secretCode: setupData.secretCode });
        setReEnrollCode('');
        setReEnrollStep('setup');
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('Incorrect') || msg.includes('NotAuthorizedException')) {
          setReEnrollError(t('userProfile.mfaSecurity.incorrectPassword'));
        } else {
          setReEnrollError(msg || t('userProfile.mfaSecurity.reenrolError'));
        }
      } finally {
        setReEnrollLoading(false);
      }
    },
    [reEnrollPassword, verifyPassword, initiateReEnrollMfa, t]
  );

  const handleCompleteReEnroll = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!reEnrollCode || reEnrollCode.length !== 6) {
        setReEnrollError(t('userProfile.mfaSecurity.invalidCode'));
        return;
      }
      setReEnrollError(null);
      setReEnrollLoading(true);
      try {
        await completeReEnrollMfa(reEnrollCode);
        setReEnrollStep('done');
        setReEnrollMfaSetup(null);
        setReEnrollCode('');
        setReEnrollSuccess(true);
        // Close modal after brief delay so user sees success
        setTimeout(() => {
          setReEnrollModalOpen(false);
        }, 1500);
      } catch (err) {
        setReEnrollError(err instanceof Error ? err.message : t('userProfile.mfaSecurity.verifyError'));
      } finally {
        setReEnrollLoading(false);
      }
    },
    [completeReEnrollMfa, reEnrollCode, t]
  );

  const handleCopyReEnrollSecret = useCallback(() => {
    if (reEnrollMfaSetup?.secretCode) {
      navigator.clipboard.writeText(reEnrollMfaSetup.secretCode);
      setReEnrollSecretCopied(true);
      setTimeout(() => setReEnrollSecretCopied(false), 2000);
    }
  }, [reEnrollMfaSetup]);

  // Load recovery codes status on mount
  const loadRecoveryCodesStatus = useCallback(async () => {
    if (!hasMfa) return;
    try {
      const status = await AdminMfaSettingsService.getRecoveryCodesStatus(numaGet);
      setRecoveryCodesStatus(status);
    } catch {
      // Non-critical — silently fail
    }
  }, [hasMfa, numaGet]);

  useEffect(() => {
    loadRecoveryCodesStatus();
  }, [loadRecoveryCodesStatus]);

  const handleGenerateRecoveryCodes = useCallback(async () => {
    // Confirm before regenerating — existing codes will be invalidated
    if (recoveryCodesStatus?.hasRecoveryCodes) {
      const ok = await confirm({
        message: t('userProfile.recoveryCodes.regenerateConfirm'),
        confirmLabel: tCommon('common.ok'),
        variant: 'warning',
      });
      if (!ok) return;
    }
    setRecoveryCodesGenerating(true);
    setRecoveryCodesError(null);
    try {
      const codes = await AdminMfaSettingsService.generateRecoveryCodes(numaPost);
      setGeneratedRecoveryCodes(codes);
      setShowRecoveryCodesModal(true);
      // Refresh status after generation
      const status = await AdminMfaSettingsService.getRecoveryCodesStatus(numaGet);
      setRecoveryCodesStatus(status);
    } catch {
      setRecoveryCodesError(t('userProfile.recoveryCodes.generateError'));
    } finally {
      setRecoveryCodesGenerating(false);
    }
  }, [numaPost, numaGet, t, tCommon, confirm, recoveryCodesStatus?.hasRecoveryCodes]);

  const relayLambdaArn = window.sessionStorage.getItem('PIPEDREAM_RELAY_LAMBDA_ARN');
  const previewMode = !hasPipedreamFeature || !relayLambdaArn;
  // Profile image upload state
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const resizeToCanvas = useCallback(
    async (file: File): Promise<Blob> => {
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error(t('userProfile.profile.fields.profileImage.errors.uploadFailed')));
          image.src = url;
        });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error(t('userProfile.profile.fields.profileImage.errors.uploadFailed'));
        canvas.width = IMAGE_TARGET_SIZE;
        canvas.height = IMAGE_TARGET_SIZE;

        const scale = Math.max(IMAGE_TARGET_SIZE / img.width, IMAGE_TARGET_SIZE / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const dx = (IMAGE_TARGET_SIZE - w) / 2;
        const dy = (IMAGE_TARGET_SIZE - h) / 2;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, IMAGE_TARGET_SIZE, IMAGE_TARGET_SIZE);
        ctx.drawImage(img, dx, dy, w, h);
        return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b || new Blob()), 'image/png'));
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [t]
  );

  const handleImageUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setImageError(null);

      if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
        setImageError(t('userProfile.profile.fields.profileImage.errors.invalidType'));
        return;
      }
      if (file.size > IMAGE_MAX_BYTES) {
        setImageError(t('userProfile.profile.fields.profileImage.errors.tooLarge'));
        return;
      }

      setImageUploading(true);
      try {
        const blob = await resizeToCanvas(file);
        const userId =
          (user?.decoded_tokens?.idToken?.sub as string | undefined) ||
          window.sessionStorage.getItem('USER_ID') ||
          'anonymous';
        const randomId = Math.random().toString(36).slice(2, 10);
        const s3Key = `numa-chat/profile-images/${userId}/${Date.now()}_${randomId}.png`;
        const clientName = window.sessionStorage.getItem('CLIENT_NAME');
        const bucketName = `numa-${clientName}-outputs`;
        const uploadRegion = window.sessionStorage.getItem('REGION') || 'us-east-1';

        const credentials = await getCredentials();
        if (!credentials) throw new Error(t('userProfile.profile.fields.profileImage.errors.credentials'));
        const s3 = withPRM(S3Client, { region: uploadRegion, credentials });
        const put = new PutObjectCommand({
          Bucket: bucketName,
          Key: s3Key,
          ContentType: 'image/png',
          CacheControl: 'public, max-age=31536000, immutable',
        });
        const url = await getSignedUrl(s3, put, { expiresIn: 60 * 10 });
        await axios.put(url, blob, { headers: { 'Content-Type': 'image/png' } });

        // Invalidate old blob cache entry if replacing an existing image
        if (userProfile.profileImage) {
          invalidateProfileBlob(userProfile.profileImage.s3Bucket, userProfile.profileImage.s3Key);
        }

        setUserProfile((prev) => ({ ...prev, profileImage: { s3Bucket: bucketName, s3Key } }));
        setProfileDirty(true);
      } catch (e) {
        setImageError((e as Error)?.message || t('userProfile.profile.fields.profileImage.errors.uploadFailed'));
      } finally {
        setImageUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [getCredentials, resizeToCanvas, t, user, userProfile.profileImage]
  );

  const handleSignatureImageUpload = useCallback(
    async (file: File): Promise<string> => {
      if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.type)) {
        throw new Error(t('userProfile.profile.fields.profileImage.errors.invalidType'));
      }
      if (file.size > IMAGE_MAX_BYTES) {
        throw new Error(t('userProfile.profile.fields.profileImage.errors.tooLarge'));
      }

      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error('Failed to load image for signature'));
          image.src = url;
        });

        // Signatures usually need smaller logos/headshots (max width ~400px)
        const MAX_WIDTH = 400;
        let w = img.width;
        let h = img.height;
        if (w > MAX_WIDTH) {
          const scale = MAX_WIDTH / w;
          w = MAX_WIDTH;
          h = img.height * scale;
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get canvas context');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b || new Blob()), 'image/png'));

        const userId =
          (user?.decoded_tokens?.idToken?.sub as string | undefined) ||
          window.sessionStorage.getItem('USER_ID') ||
          'anonymous';
        const randomId = Math.random().toString(36).slice(2, 10);
        const s3Key = `numa-chat/signature-images/${userId}/${Date.now()}_${randomId}.png`;
        const clientName = window.sessionStorage.getItem('CLIENT_NAME');
        const bucketName = `numa-${clientName}-outputs`;
        const uploadRegion = window.sessionStorage.getItem('REGION') || 'us-east-1';

        const credentials = await getCredentials();
        if (!credentials) throw new Error(t('userProfile.profile.fields.profileImage.errors.credentials'));
        const s3 = withPRM(S3Client, { region: uploadRegion, credentials });
        const put = new PutObjectCommand({
          Bucket: bucketName,
          Key: s3Key,
          ContentType: 'image/png',
          CacheControl: 'public, max-age=31536000, immutable',
        });
        const signedUrl = await getSignedUrl(s3, put, { expiresIn: 60 * 10 });
        await axios.put(signedUrl, blob, { headers: { 'Content-Type': 'image/png' } });

        return `https://${bucketName}.s3.${uploadRegion}.amazonaws.com/${s3Key}`;
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [getCredentials, t, user]
  );

  const handleRemoveImage = useCallback(() => {
    if (userProfile.profileImage) {
      invalidateProfileBlob(userProfile.profileImage.s3Bucket, userProfile.profileImage.s3Key);
    }
    setUserProfile((prev) => ({ ...prev, profileImage: null }));
    setImageError(null);
    setProfileDirty(true);
  }, [userProfile.profileImage]);

  const [connectionsLoading, setConnectionsLoading] = useState<boolean>(false);
  const [availableConnections, setAvailableConnections] = useState<Connection[]>([]);
  const [dataAnalysisAvailable, setDataAnalysisAvailable] = useState(true);
  const [globalIntegrationSettings, setGlobalIntegrationSettings] = useState<
    Record<string, { status: 'enabled' | 'disabled'; denyTools: string[] }>
  >({});
  // Native connectors the user can pick as chat defaults — admin-configured
  // for the workspace AND the user has actually authed. Mirror of
  // `availableConnections` (Pipedream) so the UI can list both kinds.
  const [availableNativeConnectors, setAvailableNativeConnectors] = useState<Array<{ id: string; name: string }>>([]);

  // Agents — used by the Memories tab to resolve agent-scoped memory names
  // (memory.scope `agent:{id}`) and to populate the agent picker when adding
  // an agent-scoped memory.
  const [agents, setAgents] = useState<AgentSummary[]>(() => getCachedAgents('all') ?? []);
  const [agentsLoading, setAgentsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (previewMode) return;
    let cancelled = false;
    setAgentsLoading(true);
    (async () => {
      try {
        const list = await listAgents(numaGet, { scope: 'all' });
        if (!cancelled) setAgents(list);
      } catch {
        // Non-fatal — agent-scoped memories fall back to their raw id / "unknown agent".
      } finally {
        if (!cancelled) setAgentsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewMode, numaGet]);

  useEffect(() => {
    // Skip fetching while the admin view is active — re-fetch when switching back to 'user'.
    if (settingsScope !== 'user') return;
    let cancelled = false;
    (async () => {
      try {
        const global = await AdminChatSettingsService.getGlobal(numaGet);
        if (cancelled) return;
        setCompanyDefaults(global);
        setGlobalAllowUserDefaults(Boolean(global.allowUserDefaults));
        if (!global.allowUserDefaults) {
          setUserDefaultsEnabled(false);
        }
      } catch {
        if (cancelled) return;
        setCompanyDefaults(DEFAULT_GLOBAL_CHAT_SETTINGS);
        setGlobalAllowUserDefaults(Boolean(DEFAULT_GLOBAL_CHAT_SETTINGS.allowUserDefaults));
        if (!DEFAULT_GLOBAL_CHAT_SETTINGS.allowUserDefaults) {
          setUserDefaultsEnabled(false);
        }
      } finally {
        if (!cancelled) setGlobalLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numaGet, settingsScope]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const apps = await manifestService.fetchAppsFromManifest();
        const dataAnalysisApp = apps?.find((app: { id?: string }) => app?.id === 'data-analysis');
        const status = String(dataAnalysisApp?.status || '').toLowerCase();
        if (!cancelled) setDataAnalysisAvailable(status === 'active');
      } catch (error) {
        console.warn('[UserProfile] Unable to determine data analysis availability', error);
        if (!cancelled) setDataAnalysisAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!dataAnalysisAvailable) {
      setUserDefaults((prev) => ({ ...prev, dataAnalysisEnabled: false }));
      setDirty(true);
    }
  }, [dataAnalysisAvailable]);

  useEffect(() => {
    if (settingsScope !== 'user') return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await ChatSettingsService.getForProfile(numaGet);
        if (cancelled) return;
        setUserDefaults(res.settings);
        setUserDefaultsEnabled(res.userDefaultsEnabled);
        savedDefaultsRef.current = JSON.stringify(res.settings);
        savedDefaultsEnabledRef.current = res.userDefaultsEnabled;
        setError(null);
        setDirty(false);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message || t('userProfile.errors.loadDefaults'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numaGet, settingsScope]);

  // Load user profile
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setProfileLoading(true);
        const profile = await ChatSettingsService.getUserProfile(numaGet);
        if (cancelled) return;
        setUserProfile(profile);
        savedProfileRef.current = JSON.stringify(profile);
        setProfileError(null);
        setProfileDirty(false);
      } catch (e) {
        if (cancelled) return;
        setProfileError((e as Error).message || t('userProfile.profile.errors.loadProfile'));
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numaGet]);

  // Auto-clear dirty flags when current state matches the last-saved snapshot
  useEffect(() => {
    if (!dirty) return;
    const matches =
      JSON.stringify(userDefaults) === savedDefaultsRef.current &&
      userDefaultsEnabled === savedDefaultsEnabledRef.current;
    if (matches) setDirty(false);
  }, [userDefaults, userDefaultsEnabled, dirty]);

  useEffect(() => {
    if (!profileDirty) return;
    if (JSON.stringify(userProfile) === savedProfileRef.current) setProfileDirty(false);
  }, [userProfile, profileDirty]);

  const kbIdsSorted = useMemo(
    () => availableKBs.map((kb) => kb.kb_id).filter((id) => typeof id === 'string'),
    [availableKBs]
  );

  // Grouping for the Default folders picker: system KBs (Company / Support /
  // SharePoint) and shared KBs render flat; private user-owned KBs (including
  // the root "Personal" folder) collapse under a "My Files" group with a
  // tri-state parent checkbox.
  const PROFILE_SYSTEM_KB_IDS = useMemo(() => new Set(['company', 'numa-support', 'sharepoint']), []);
  const profileSortedKBs = useMemo(() => sortKnowledgeBases(availableKBs), [availableKBs]);
  const { profileSystemKBs, profileMyFilesKBs, profileSharedKBs } = useMemo(() => {
    const system: typeof profileSortedKBs = [];
    const myFiles: typeof profileSortedKBs = [];
    const shared: typeof profileSortedKBs = [];
    for (const kb of profileSortedKBs) {
      if (PROFILE_SYSTEM_KB_IDS.has(kb.kb_id)) system.push(kb);
      else if (kb.is_shared) shared.push(kb);
      else myFiles.push(kb);
    }
    return { profileSystemKBs: system, profileMyFilesKBs: myFiles, profileSharedKBs: shared };
  }, [profileSortedKBs, PROFILE_SYSTEM_KB_IDS]);
  const [profileMyFilesExpanded, setProfileMyFilesExpanded] = useState(true);

  const canEditUserDefaults = globalLoaded && globalAllowUserDefaults;
  const canEditProfile = globalLoaded;

  // Atomic loader for everything the chat-defaults "integrations" picker
  // needs. Previously this was three independent useEffects:
  //   1. /api/settings/integrations → globalIntegrationSettings
  //   2. Pipedream proxy → availableConnections
  //   3. catalog + DDB + OAuth status → availableNativeConnectors
  // Each finished at its own time so the picker rendered piecewise (4
  // entries, then 5, then 6...). Now we Promise.all all of them and flip
  // ONE ready flag at the end so the user sees the complete, true list in
  // one paint. Single source of truth on every load.
  useEffect(() => {
    if (previewMode) {
      setConnectionsLoading(false);
      setAvailableConnections([]);
      setAvailableNativeConnectors([]);
      setGlobalIntegrationSettings({});
      return;
    }
    if (!user) return;
    let cancelled = false;
    setConnectionsLoading(true);
    (async () => {
      try {
        const [integrationSettingsItems, pipedreamStatus, catalog, nativeRows, configured] = await Promise.all([
          (numaGet('/api/settings/integrations') as Promise<unknown>).catch(() => []),
          lambdaClient
            ? PipedreamProxyService.getIntegrationStatus(
                lambdaClient,
                PipedreamProxyService.deriveExternalUserId(user),
                { ttlMs: 30 * 60 * 1000 }
              ).catch(() => null)
            : Promise.resolve(null),
          AdminIntegrationsService.catalogWithNuma(numaGet).catch(() => []),
          DataConnectorsService.listStatus(numaGet).catch(() => [] as Array<{ connector_id: string; status?: string }>),
          ConnectorsService.listConfigured().catch(
            () =>
              ({ oauth: [] as Array<{ id: string }>, pat: [] as Array<{ id: string }> }) as {
                oauth: Array<{ id: string }>;
                pat: Array<{ id: string }>;
              }
          ),
        ]);
        if (cancelled) return;

        // 1. admin integration-settings (admin-side enable + denyTools map +
        //    FEAT-019 multi-account opt-in). `allowMultipleAccounts` is on the
        //    same /api/settings/integrations item; capturing it here lets the
        //    Chat Defaults picker show the per-account submenu.
        const settingsMap: Record<
          string,
          { status: 'enabled' | 'disabled'; denyTools: string[]; allowMultipleAccounts: boolean }
        > = {};
        const items = Array.isArray(integrationSettingsItems)
          ? (integrationSettingsItems as Array<{
              integration: string;
              status: 'enabled' | 'disabled';
              denyTools?: string[];
              allowMultipleAccounts?: boolean;
            }>)
          : [];
        for (const item of items) {
          settingsMap[item.integration] = {
            status: item.status,
            denyTools: item.denyTools || [],
            allowMultipleAccounts: item.allowMultipleAccounts === true,
          };
        }

        // 2. Pipedream connections (filter to admin-enabled + user-connected).
        //    Carry the connected-account list + admin multi-account flag so the
        //    picker can render per-account checkboxes (FEAT-019).
        const pipedreamConnections: Connection[] = pipedreamStatus
          ? (pipedreamStatus.connections || [])
              .map((conn) => ({
                id: conn.app_name,
                isConnected: conn.status === 'connected',
                mcpServerUrl: undefined as string | undefined,
                allowMultipleAccounts: settingsMap[conn.app_name]?.allowMultipleAccounts === true,
                accounts: conn.accounts ?? [],
              }))
              .filter((c) => c.isConnected)
              .filter((c) => settingsMap[c.id]?.status !== 'disabled')
          : [];

        // 3. Native connectors — same union the integrations page uses.
        //    OAuth: /oauth/{slug}/status (vault)
        //    PAT:   /pat/{slug}/status   (vault)
        //    DDB:   legacy data-connectors row (kept as a backstop only;
        //           the vault paths are authoritative for the post-FEAT-143
        //           unified model). Without the PAT-vault check a user who
        //           had just connected a PAT connector wouldn't see it
        //           listed in their Chat Defaults until something else
        //           wrote the legacy DDB row.
        const oauthSlugs = configured.oauth.map((c) => c.id);
        const patSlugs = configured.pat.map((c) => c.id);
        // Both OAuth and PAT status go through ConnectorsService.getStatus,
        // which routes each id to the correct vault endpoint via the
        // registry. Calling OAuthProvidersService directly here previously
        // sent PAT connectors through the OAuth endpoint, which 400-rejected.
        const [oauthStatuses, patStatuses] = await Promise.all([
          Promise.all(
            oauthSlugs.map(async (slug) => {
              try {
                const s = await ConnectorsService.getStatus(slug);
                return [slug, s.status === 'connected'] as const;
              } catch {
                return [slug, false] as const;
              }
            })
          ),
          Promise.all(
            patSlugs.map(async (slug) => {
              try {
                const s = await ConnectorsService.getStatus(slug);
                return [slug, s.status === 'connected'] as const;
              } catch {
                return [slug, false] as const;
              }
            })
          ),
        ]);
        if (cancelled) return;
        const oauthConnected = new Set(oauthStatuses.filter(([, ok]) => ok).map(([slug]) => slug));
        const patConnected = new Set(patStatuses.filter(([, ok]) => ok).map(([slug]) => slug));
        const ddbConnected = new Set(nativeRows.filter((r) => r.status === 'connected').map((r) => r.connector_id));

        // Native connectors surfaced for the Chat Defaults picker. Must be
        // BOTH admin-enabled (catalog entry with `connectorEnabled === true`)
        // AND user-connected on at least one of the three sources above.
        //
        // The previous code had a fallback loop that included any slug the
        // user had ever OAuth-connected, regardless of admin enable state.
        // That left stale entries hanging around after an admin disabled a
        // service (Synergy 12d showed up here in tom@'s account because the
        // OAuth token persisted past the admin disabling the connector).
        // Catalog is the only source of truth; legacy vault state alone is
        // not enough to surface a row.
        const nativeOut: Array<{ id: string; name: string }> = [];
        const seen = new Set<string>();
        for (const entry of catalog) {
          const slug = entry.connectorSlug;
          if (!slug) continue;
          if (entry.connectorEnabled !== true) continue;
          if (!oauthConnected.has(slug) && !patConnected.has(slug) && !ddbConnected.has(slug)) continue;
          if (seen.has(slug)) continue;
          seen.add(slug);
          const tmpl = getConnectorById(slug);
          nativeOut.push({ id: slug, name: tmpl?.displayName ?? slug });
        }
        nativeOut.sort((a, b) => a.name.localeCompare(b.name));

        // Single atomic state update — all three lists land together, so
        // the picker re-renders once with the complete, true state.
        setGlobalIntegrationSettings(settingsMap);
        setAvailableConnections(pipedreamConnections);
        setAvailableNativeConnectors(nativeOut);
      } catch (e) {
        console.warn('[UserProfile] Failed to load chat-defaults integrations', e);
        if (!cancelled) {
          setGlobalIntegrationSettings({});
          setAvailableConnections([]);
          setAvailableNativeConnectors([]);
        }
      } finally {
        if (!cancelled) setConnectionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numaGet, user, lambdaClient, previewMode]);

  // When user defaults are disabled, show company defaults in the form
  const displayedSettings = useMemo(() => {
    if (!userDefaultsEnabled) {
      return {
        defaultKBIds: withPersonalSentinel(companyDefaults.defaultKBIds),
        autoToolsEnabled: companyDefaults.autoToolsEnabled,
        webSearchEnabled: companyDefaults.webSearchEnabled,
        createAgentEnabled: companyDefaults.createAgentEnabled,
        memoriesEnabled: companyDefaults.memoriesEnabled,
        dataAnalysisEnabled: companyDefaults.dataAnalysisEnabled,
        defaultConnectionIds: companyDefaults.defaultConnectionIds,
        defaultNativeConnectorIds: companyDefaults.defaultNativeConnectorIds,
        // Account scope is user-only — company defaults never carry it, so an
        // empty map (= "all accounts") is the correct preview when user
        // defaults are disabled.
        defaultAccountsByApp: {} as Record<string, string[]>,
      };
    }
    return userDefaults;
  }, [userDefaultsEnabled, userDefaults, companyDefaults]);

  // Expand MY_FILES_SENTINEL to the user's actual sub when building the set
  // the UI checks against — rows iterate real kb_ids (sub for the root KB),
  // so the literal sentinel would never match without expansion.
  const userSub = user?.decoded_tokens?.idToken?.sub as string | undefined;
  const enabledKBSet = useMemo(
    () => new Set(expandMyFilesSentinel(displayedSettings.defaultKBIds, userSub)),
    [displayedSettings.defaultKBIds, userSub]
  );
  const enabledConnectionSet = useMemo(
    () => new Set(displayedSettings.defaultConnectionIds),
    [displayedSettings.defaultConnectionIds]
  );
  const enabledNativeConnectorSet = useMemo(
    () => new Set(displayedSettings.defaultNativeConnectorIds ?? []),
    [displayedSettings.defaultNativeConnectorIds]
  );
  const getKBLabel = (kbId: string, kbName?: string) => {
    if (kbId === 'company') {
      return t('chatDefaults.companyKnowledgeBase');
    }
    if (kbId === 'numa-support') {
      return t('chatDefaults.supportKnowledgeBase');
    }
    return kbName || kbId;
  };

  const disableDefaultsForm = saving || loading || !canEditUserDefaults || !userDefaultsEnabled;
  const disableProfileForm = saving || loading;
  const resetToCompanyDefaults = () => {
    setUserDefaultsEnabled(true);
    setUserDefaults({
      ...companyDefaults,
      defaultKBIds: withPersonalSentinel(companyDefaults.defaultKBIds),
      language: LANGUAGE_BROWSER_DEFAULT,
    });
    setDirty(true);
  };

  const resetToBrowserDefaults = () => {
    setUserDefaults((prev) => ({
      ...prev,
      language: LANGUAGE_BROWSER_DEFAULT,
      emailSignatureEnabled: DEFAULT_CHAT_SETTINGS.emailSignatureEnabled,
      emailSignatureText: DEFAULT_CHAT_SETTINGS.emailSignatureText,
      chatScrollMode: DEFAULT_CHAT_SETTINGS.chatScrollMode,
      chatSuggestionsEnabled: DEFAULT_CHAT_SETTINGS.chatSuggestionsEnabled,
    }));
    setDirty(true);
  };

  const renderSaveActions = (resetLabelKey: string, onReset: () => void, onSave: () => void, canSave: boolean) => (
    <div className="profile-actions">
      <Button variant="primary" disabled={!dirty || saving || !canSave} onClick={onSave}>
        {saving ? (
          <>
            <Spinner as="span" animation="border" size="sm" className="me-2" />
            {t('userProfile.actions.saving')}
          </>
        ) : (
          t('userProfile.actions.save')
        )}
      </Button>
      <Button variant="outline-secondary" disabled={saving || !canSave} onClick={onReset}>
        {t(resetLabelKey)}
      </Button>
    </div>
  );

  const handleSaveProfileLanguage = async () => {
    try {
      setSaving(true);
      setError(null);
      await ChatSettingsService.updateForProfile(
        {
          language: userDefaults.language,
          emailSignatureEnabled: userDefaults.emailSignatureEnabled,
          emailSignatureText: userDefaults.emailSignatureText,
          chatScrollMode: userDefaults.chatScrollMode,
          chatSuggestionsEnabled: userDefaults.chatSuggestionsEnabled,
        },
        numaPut
      );
      // Persist scroll mode to localStorage as a reliable local fallback
      if (userDefaults.chatScrollMode) {
        localStorage.setItem('numa-chat-scroll-mode', userDefaults.chatScrollMode);
      }
      const refreshed = await ChatSettingsService.getForProfile(numaGet);
      setUserDefaults(refreshed.settings);
      setUserDefaultsEnabled(refreshed.userDefaultsEnabled);
      savedDefaultsRef.current = JSON.stringify(refreshed.settings);
      savedDefaultsEnabledRef.current = refreshed.userDefaultsEnabled;
      await applyLanguagePreference(refreshed.settings.language);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message || t('userProfile.errors.saveDefaults'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveUserDefaults = async () => {
    try {
      setSaving(true);
      setError(null);

      const payload: UserChatSettingsUpdate = {
        userDefaultsEnabled,
        defaultKBIds: userDefaults.defaultKBIds,
        autoToolsEnabled: userDefaults.autoToolsEnabled,
        webSearchEnabled: userDefaults.webSearchEnabled,
        createAgentEnabled: userDefaults.createAgentEnabled,
        memoriesEnabled: userDefaults.memoriesEnabled,
        dataAnalysisEnabled: userDefaults.dataAnalysisEnabled,
        defaultConnectionIds: userDefaults.defaultConnectionIds,
        defaultNativeConnectorIds: userDefaults.defaultNativeConnectorIds,
        defaultAccountsByApp: userDefaults.defaultAccountsByApp,
        language: userDefaults.language,
        approvalMode: userDefaults.approvalMode,
        numaToolApprovalMode: userDefaults.numaToolApprovalMode,
      };

      await ChatSettingsService.updateForProfile(payload, numaPut);
      const refreshed = await ChatSettingsService.getForProfile(numaGet);
      setUserDefaults(refreshed.settings);
      setUserDefaultsEnabled(refreshed.userDefaultsEnabled);
      savedDefaultsRef.current = JSON.stringify(refreshed.settings);
      savedDefaultsEnabledRef.current = refreshed.userDefaultsEnabled;
      await applyLanguagePreference(refreshed.settings.language);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message || t('userProfile.errors.saveDefaults'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProfile = async () => {
    try {
      setProfileSaving(true);
      setProfileError(null);
      await ChatSettingsService.updateUserProfile(userProfile, numaPut);
      const refreshed = await ChatSettingsService.getUserProfile(numaGet);
      setUserProfile(refreshed);
      savedProfileRef.current = JSON.stringify(refreshed);
      setProfileDirty(false);
    } catch (e) {
      setProfileError((e as Error).message || t('userProfile.profile.errors.saveProfile'));
    } finally {
      setProfileSaving(false);
    }
  };

  const handleClearProfile = () => {
    setUserProfile({ ...DEFAULT_USER_PROFILE });
    setProfileDirty(true);
  };

  const hasUnsavedChanges = dirty || profileDirty;

  const profileContent = (
    <div className="user-profile-content">
      {hasUnsavedChanges && (
        <div className="settings-unsaved-banner">
          <i className="bi bi-exclamation-circle" />
          {t('unsavedBanner')}
        </div>
      )}
      {error && (
        <Alert variant="danger" className="mb-3">
          {error}
        </Alert>
      )}

      <StyledTabs
        activeKey={selectedTabKey}
        onSelect={(k) => k && setSelectedTabKey(k)}
        className={embedded ? 'mb-3 settings-subtabs--panels-only' : 'mb-3'}
      >
        <Tab
          eventKey="my-profile"
          title={
            <span>
              <i className="bi bi-person-circle me-2"></i>
              {t('userProfile.tabs.myProfile')}
            </span>
          }
        >
          {profileError && (
            <Alert variant="danger" className="mb-3">
              {profileError}
            </Alert>
          )}

          {profileLoading ? (
            <div className="text-center py-4">
              <Spinner animation="border" />
            </div>
          ) : (
            <Form>
              <p className="profile-page-intro">{t('userProfile.profile.description')}</p>

              {/* Use Profile toggle */}
              <div className="profile-toggle-card">
                <div className="profile-toggle-card__text">
                  <div className="profile-toggle-card__label">{t('userProfile.profile.fields.useProfile.label')}</div>
                  <div className="profile-toggle-card__help">{t('userProfile.profile.fields.useProfile.help')}</div>
                </div>
                <Form.Check
                  type="switch"
                  id="profile-use-profile"
                  label=""
                  checked={userProfile.useProfile}
                  disabled={profileSaving}
                  onChange={(e) => {
                    setUserProfile((prev) => ({ ...prev, useProfile: e.target.checked }));
                    setProfileDirty(true);
                  }}
                />
              </div>

              {/* ── Section 1: About You ── */}
              <div className="profile-section">
                <div className="profile-section__title">{t('userProfile.profile.fields.aboutYou.sectionTitle')}</div>
                <p className="profile-section__description">{t('userProfile.profile.fields.aboutYou.description')}</p>

                {/* Avatar + core fields */}
                <div className="profile-avatar-row">
                  <div className="profile-avatar-col">
                    <ProfileAvatar
                      profileImage={userProfile.profileImage}
                      name={userProfile.name}
                      email={user?.decoded_tokens?.idToken?.email as string | undefined}
                      size={72}
                    />
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/png,image/jpeg"
                      style={{ display: 'none' }}
                      onChange={handleImageUpload}
                      disabled={profileSaving || imageUploading}
                    />
                    <div className="profile-avatar-actions">
                      <Button
                        className="profile-avatar-btn"
                        variant="outline-secondary"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={profileSaving || imageUploading}
                      >
                        {imageUploading ? (
                          <>
                            <Spinner animation="border" size="sm" style={{ width: '0.7rem', height: '0.7rem' }} />
                            {t('userProfile.profile.fields.profileImage.uploading')}
                          </>
                        ) : (
                          <>
                            <i className="bi bi-camera"></i>
                            {t('userProfile.profile.fields.profileImage.upload')}
                          </>
                        )}
                      </Button>
                      {userProfile.profileImage && (
                        <Button
                          className="profile-avatar-btn"
                          variant="outline-danger"
                          size="sm"
                          onClick={handleRemoveImage}
                          disabled={profileSaving || imageUploading}
                        >
                          <i className="bi bi-trash"></i>
                          {t('userProfile.profile.fields.profileImage.remove')}
                        </Button>
                      )}
                    </div>
                    {imageError && <div className="profile-avatar-error">{imageError}</div>}
                  </div>
                  <div className="profile-avatar-fields">
                    <Form.Group className="mb-2">
                      <Form.Label className="profile-field-label">
                        {t('userProfile.profile.fields.name.label')}
                      </Form.Label>
                      <Form.Control
                        type="text"
                        maxLength={LIMIT_NAME}
                        value={userProfile.name}
                        disabled={profileSaving}
                        placeholder={t('userProfile.profile.fields.name.placeholder')}
                        onChange={(e) => {
                          setUserProfile((prev) => ({ ...prev, name: e.target.value }));
                          setProfileDirty(true);
                        }}
                      />
                    </Form.Group>
                    <Form.Group className="mb-2">
                      <Form.Label className="profile-field-label">
                        {t('userProfile.profile.fields.jobTitle.label')}
                      </Form.Label>
                      <Form.Control
                        type="text"
                        maxLength={LIMIT_TITLE}
                        value={userProfile.jobTitle}
                        disabled={profileSaving}
                        placeholder={t('userProfile.profile.fields.jobTitle.placeholder')}
                        onChange={(e) => {
                          setUserProfile((prev) => ({ ...prev, jobTitle: e.target.value }));
                          setProfileDirty(true);
                        }}
                      />
                    </Form.Group>
                    <Form.Group>
                      <Form.Label className="profile-field-label">
                        {t('userProfile.profile.fields.jobDescription.label')}
                      </Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={3}
                        maxLength={LIMIT_LONG}
                        value={userProfile.jobDescription}
                        disabled={profileSaving}
                        placeholder={t('userProfile.profile.fields.jobDescription.placeholder')}
                        onChange={(e) => {
                          setUserProfile((prev) => ({ ...prev, jobDescription: e.target.value }));
                          setProfileDirty(true);
                        }}
                      />
                      <CharCount value={userProfile.jobDescription} max={LIMIT_LONG} />
                    </Form.Group>
                  </div>
                </div>

                <Form.Group className="mb-3">
                  <Form.Label className="profile-field-label">
                    {t('userProfile.profile.fields.linkedInUrl.label')}
                  </Form.Label>
                  <Form.Control
                    type="url"
                    maxLength={LIMIT_URL}
                    value={userProfile.linkedInUrl}
                    disabled={profileSaving}
                    placeholder={t('userProfile.profile.fields.linkedInUrl.placeholder')}
                    onChange={(e) => {
                      setUserProfile((prev) => ({ ...prev, linkedInUrl: e.target.value }));
                      setProfileDirty(true);
                    }}
                  />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label className="profile-field-label">
                    {t('userProfile.profile.fields.goalsAndObjectives.label')}
                  </Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    maxLength={LIMIT_LONG}
                    value={userProfile.goalsAndObjectives}
                    disabled={profileSaving}
                    placeholder={t('userProfile.profile.fields.goalsAndObjectives.placeholder')}
                    onChange={(e) => {
                      setUserProfile((prev) => ({ ...prev, goalsAndObjectives: e.target.value }));
                      setProfileDirty(true);
                    }}
                  />
                  <CharCount value={userProfile.goalsAndObjectives} max={LIMIT_LONG} />
                </Form.Group>
                <Form.Group>
                  <Form.Label className="profile-field-label">
                    {t('userProfile.profile.fields.otherInformation.label')}
                  </Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    maxLength={LIMIT_LONG}
                    value={userProfile.otherInformation}
                    disabled={profileSaving}
                    placeholder={t('userProfile.profile.fields.otherInformation.placeholder')}
                    onChange={(e) => {
                      setUserProfile((prev) => ({ ...prev, otherInformation: e.target.value }));
                      setProfileDirty(true);
                    }}
                  />
                  <CharCount value={userProfile.otherInformation} max={LIMIT_LONG} />
                </Form.Group>
              </div>

              {/* ── Section 2: Custom Instructions ── */}
              <div className="profile-section">
                <div className="profile-section__title">
                  {t('userProfile.profile.fields.customInstructions.sectionTitle')}
                </div>
                <p className="profile-section__description">
                  {t('userProfile.profile.fields.customInstructions.help')}
                </p>
                <Form.Control
                  as="textarea"
                  rows={5}
                  maxLength={LIMIT_CUSTOM_INSTRUCTIONS}
                  value={userProfile.customInstructions}
                  disabled={profileSaving}
                  placeholder={t('userProfile.profile.fields.customInstructions.placeholder')}
                  onChange={(e) => {
                    setUserProfile((prev) => ({ ...prev, customInstructions: e.target.value }));
                    setProfileDirty(true);
                  }}
                />
                <CharCount value={userProfile.customInstructions} max={LIMIT_CUSTOM_INSTRUCTIONS} />
              </div>

              <div className="profile-actions">
                <Button variant="primary" disabled={!profileDirty || profileSaving} onClick={handleSaveProfile}>
                  {profileSaving ? (
                    <>
                      <Spinner as="span" animation="border" size="sm" className="me-2" />
                      {t('userProfile.profile.actions.saving')}
                    </>
                  ) : (
                    t('userProfile.profile.actions.save')
                  )}
                </Button>
                <Button variant="outline-secondary" disabled={profileSaving} onClick={handleClearProfile}>
                  {t('userProfile.profile.actions.reset')}
                </Button>
              </div>
            </Form>
          )}
        </Tab>
        <Tab
          eventKey="memories"
          title={
            <span>
              <i className="bi bi-stars me-2"></i>
              {t('userProfile.tabs.memories')}
            </span>
          }
        >
          {profileError && (
            <Alert variant="danger" className="mb-3">
              {profileError}
            </Alert>
          )}
          {profileLoading ? (
            <div className="text-center py-4">
              <Spinner animation="border" />
            </div>
          ) : (
            <MemoriesPanel
              memories={userProfile.memories}
              onChange={(next) => {
                setUserProfile((prev) => ({ ...prev, memories: next }));
                setProfileDirty(true);
              }}
              availableConnections={availableConnections}
              agents={agents}
              agentsLoading={agentsLoading}
              saving={profileSaving}
              dirty={profileDirty}
              onSave={handleSaveProfile}
            />
          )}
        </Tab>
        <Tab
          eventKey="user-settings"
          title={
            <span>
              <i className="bi bi-person-gear me-2"></i>
              {t('userProfile.tabs.userSettings')}
            </span>
          }
        >
          <Form>
            <div className="profile-section">
              <div className="profile-section__title">{t('userProfile.defaults.language.label')}</div>
              <p className="profile-section__description">{t('userProfile.defaults.language.help')}</p>
              <Form.Select
                value={userDefaults.language ?? LANGUAGE_BROWSER_DEFAULT}
                disabled={disableProfileForm}
                onChange={(e) => {
                  setUserDefaults((prev) => ({ ...prev, language: e.target.value }));
                  setDirty(true);
                }}
              >
                <option value={LANGUAGE_BROWSER_DEFAULT}>{t('userProfile.defaults.language.browser')}</option>
                <option value="en">{t('userProfile.defaults.language.english')}</option>
              </Form.Select>
            </div>

            <div className="profile-section">
              <div className="profile-section__title">{t('userProfile.defaults.emailSignature.label')}</div>
              <p className="profile-section__description">{t('userProfile.defaults.emailSignature.help')}</p>
              <div className="profile-signature-toggle">
                <Form.Check
                  type="switch"
                  id="profile-email-signature-enabled"
                  label=""
                  checked={userDefaults.emailSignatureEnabled}
                  disabled={disableProfileForm}
                  onChange={(e) => {
                    setUserDefaults((prev) => ({ ...prev, emailSignatureEnabled: e.target.checked }));
                    setDirty(true);
                  }}
                />
                <span className="profile-signature-toggle__label">
                  {t('userProfile.defaults.emailSignature.enableTitle')}
                </span>
              </div>
              {userDefaults.emailSignatureEnabled && (
                <>
                  <Form.Label className="profile-field-label">
                    {t('userProfile.defaults.emailSignature.textLabel')}
                  </Form.Label>
                  <RichTextEditor
                    value={userDefaults.emailSignatureText}
                    disabled={disableProfileForm}
                    placeholder={DEFAULT_CHAT_SETTINGS.emailSignatureText}
                    onSave={() => {}}
                    onImageUpload={handleSignatureImageUpload}
                    onChange={(val) => {
                      setUserDefaults((prev) => ({ ...prev, emailSignatureText: val }));
                      setDirty(true);
                    }}
                  />
                </>
              )}
            </div>

            <div className="profile-section">
              <div className="profile-section__title">{t('userProfile.defaults.chatScrollMode.label')}</div>
              <p className="profile-section__description">{t('userProfile.defaults.chatScrollMode.help')}</p>
              <div className="profile-radio-group">
                {(['auto', 'manual'] as const).map((mode) => (
                  <div
                    key={mode}
                    className={`profile-radio-option ${userDefaults.chatScrollMode === mode ? 'is-selected' : ''}`}
                    onClick={() => {
                      if (disableProfileForm) return;
                      setUserDefaults((prev) => ({ ...prev, chatScrollMode: mode }));
                      setDirty(true);
                    }}
                  >
                    <div className="profile-radio-option__inner">
                      <Form.Check
                        type="radio"
                        id={`chat-scroll-mode-${mode}`}
                        name="chatScrollMode"
                        checked={userDefaults.chatScrollMode === mode}
                        disabled={disableProfileForm}
                        onChange={() => {
                          setUserDefaults((prev) => ({ ...prev, chatScrollMode: mode }));
                          setDirty(true);
                        }}
                      />
                      <div className="profile-radio-option__text">
                        <div className="profile-radio-option__label">
                          {t(`userProfile.defaults.chatScrollMode.${mode}`)}
                        </div>
                        <div className="profile-radio-option__help">
                          {t(`userProfile.defaults.chatScrollMode.${mode}Help`)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {!CHAT_SUGGESTIONS_DISABLED && getFlag('CHAT_SUGGESTIONS') && (
              <div className="profile-section">
                <div className="profile-section__title">{t('userProfile.defaults.chatSuggestions.label')}</div>
                <p className="profile-section__description">{t('userProfile.defaults.chatSuggestions.help')}</p>
                <div className="profile-radio-group">
                  {([true, false] as const).map((enabled) => (
                    <div
                      key={String(enabled)}
                      className={`profile-radio-option ${userDefaults.chatSuggestionsEnabled === enabled ? 'is-selected' : ''}`}
                      onClick={() => {
                        if (disableProfileForm) return;
                        setUserDefaults((prev) => ({ ...prev, chatSuggestionsEnabled: enabled }));
                        setDirty(true);
                      }}
                    >
                      <div className="profile-radio-option__inner">
                        <Form.Check
                          type="radio"
                          id={`chat-suggestions-${enabled}`}
                          name="chatSuggestionsEnabled"
                          checked={userDefaults.chatSuggestionsEnabled === enabled}
                          disabled={disableProfileForm}
                          onChange={() => {
                            setUserDefaults((prev) => ({ ...prev, chatSuggestionsEnabled: enabled }));
                            setDirty(true);
                          }}
                        />
                        <div className="profile-radio-option__text">
                          <div className="profile-radio-option__label">
                            {t(`userProfile.defaults.chatSuggestions.${enabled ? 'enabled' : 'disabled'}`)}
                          </div>
                          <div className="profile-radio-option__help">
                            {t(`userProfile.defaults.chatSuggestions.${enabled ? 'enabledHelp' : 'disabledHelp'}`)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {renderSaveActions(
              'userProfile.actions.resetBrowser',
              resetToBrowserDefaults,
              handleSaveProfileLanguage,
              canEditProfile
            )}
          </Form>
        </Tab>
        <Tab
          eventKey="user-defaults"
          title={
            <span>
              <i className="bi bi-sliders me-2"></i>
              {t('userProfile.tabs.chatDefaults')}
            </span>
          }
        >
          {globalLoaded && !globalAllowUserDefaults && (
            <div className="profile-info-banner">{t('userProfile.adminDisabled')}</div>
          )}
          <div className="profile-info-banner">{t('userProfile.defaults.description')}</div>

          <Form>
            <div className="profile-toggle-card">
              <div className="profile-toggle-card__text">
                <div className="profile-toggle-card__label">{t('userProfile.defaults.enableTitle')}</div>
                <div className="profile-toggle-card__help">{t('userProfile.defaults.enableHelp')}</div>
              </div>
              <Form.Check
                type="switch"
                id="profile-defaults-enabled"
                label=""
                checked={userDefaultsEnabled}
                disabled={!canEditUserDefaults || saving || loading}
                onChange={(e) => {
                  setUserDefaultsEnabled(e.target.checked);
                  setDirty(true);
                }}
              />
            </div>

            {loading ? (
              <div className="text-center py-4">
                <Spinner animation="border" />
              </div>
            ) : (
              <>
                <div className="profile-section">
                  <div className="profile-section__title">{t('userProfile.defaults.kbLabel')}</div>
                  {kbError && <div className="text-danger small mb-2">{kbError}</div>}

                  {!isLoadingKBs && kbIdsSorted.length > 1 && (
                    <div className="workspace-settings-kb-actions">
                      <button
                        type="button"
                        className="workspace-settings-kb-action-link"
                        onClick={() => {
                          setUserDefaults((prev) => ({
                            ...prev,
                            defaultKBIds: [...kbIdsSorted],
                          }));
                          setDirty(true);
                        }}
                        disabled={disableDefaultsForm || kbIdsSorted.every((id) => enabledKBSet.has(id))}
                      >
                        {t('userProfile.defaults.selectAll')}
                      </button>
                      {enabledKBSet.size > 0 && (
                        <button
                          type="button"
                          className="workspace-settings-kb-action-link"
                          onClick={() => {
                            setUserDefaults((prev) => ({
                              ...prev,
                              defaultKBIds: [],
                            }));
                            setDirty(true);
                          }}
                          disabled={disableDefaultsForm}
                        >
                          {t('userProfile.defaults.clear')}
                        </button>
                      )}
                    </div>
                  )}
                  <ExpandableOverflowBox className="profile-checkbox-list" maxHeight={240}>
                    {isLoadingKBs ? (
                      <div className="profile-empty-state">{t('userProfile.defaults.kbLoading')}</div>
                    ) : (
                      (() => {
                        const renderRow = (kbId: string, kbName: string | undefined) => (
                          <Form.Check
                            key={kbId}
                            type="checkbox"
                            id={`profile-defaults-kb-${kbId}`}
                            label={getKBLabel(kbId, kbName)}
                            checked={enabledKBSet.has(kbId)}
                            disabled={disableDefaultsForm}
                            onChange={(e) => {
                              const nextChecked = e.target.checked;
                              // Toggling the Personal row needs to manage the
                              // sentinel too — otherwise unchecking strips
                              // only the user's sub and the sentinel re-
                              // expands it on next load.
                              const isPersonalRow = !!userSub && kbId === userSub;
                              setUserDefaults((prev) => {
                                const without = prev.defaultKBIds.filter(
                                  (id) => id !== kbId && (!isPersonalRow || id !== MY_FILES_SENTINEL)
                                );
                                return {
                                  ...prev,
                                  defaultKBIds: nextChecked ? Array.from(new Set([...without, kbId])) : without,
                                };
                              });
                              setDirty(true);
                            }}
                          />
                        );

                        const myFilesIds = profileMyFilesKBs.map((kb) => kb.kb_id);
                        const myFilesSelected = myFilesIds.filter((id) => enabledKBSet.has(id)).length;
                        const myFilesAll = myFilesIds.length > 0 && myFilesSelected === myFilesIds.length;
                        const myFilesIndeterminate = myFilesSelected > 0 && !myFilesAll;

                        return (
                          <>
                            {profileSystemKBs.map((kb) => renderRow(kb.kb_id, kb.kb_name))}
                            {profileMyFilesKBs.length > 0 && (
                              <div className="profile-kb-group">
                                <div className="profile-kb-group__header">
                                  <Form.Check
                                    type="checkbox"
                                    id="profile-defaults-kb-group-my-files"
                                    label={t('userProfile.defaults.myFilesGroup')}
                                    checked={myFilesAll}
                                    ref={(el: HTMLInputElement | null) => {
                                      if (el) el.indeterminate = myFilesIndeterminate;
                                    }}
                                    disabled={disableDefaultsForm}
                                    onChange={() => {
                                      // Group toggle also manages the
                                      // sentinel — Personal lives in this
                                      // group so unchecking the group must
                                      // strip both forms.
                                      setUserDefaults((prev) => ({
                                        ...prev,
                                        defaultKBIds: myFilesAll
                                          ? prev.defaultKBIds.filter(
                                              (id) => !myFilesIds.includes(id) && id !== MY_FILES_SENTINEL
                                            )
                                          : Array.from(new Set([...prev.defaultKBIds, ...myFilesIds])),
                                      }));
                                      setDirty(true);
                                    }}
                                  />
                                  <button
                                    type="button"
                                    className="profile-kb-group__chevron"
                                    onClick={() => setProfileMyFilesExpanded((v) => !v)}
                                    aria-label={
                                      profileMyFilesExpanded
                                        ? t('userProfile.defaults.collapseGroup')
                                        : t('userProfile.defaults.expandGroup')
                                    }
                                  >
                                    <i className={`bi bi-chevron-${profileMyFilesExpanded ? 'down' : 'right'}`} />
                                  </button>
                                </div>
                                {profileMyFilesExpanded && (
                                  <div className="profile-kb-group__children">
                                    {profileMyFilesKBs.map((kb) => renderRow(kb.kb_id, kb.kb_name))}
                                  </div>
                                )}
                              </div>
                            )}
                            {profileSharedKBs.map((kb) => renderRow(kb.kb_id, kb.kb_name))}
                          </>
                        );
                      })()
                    )}
                    {!isLoadingKBs && kbIdsSorted.length === 0 && (
                      <div className="profile-empty-state">{t('userProfile.defaults.kbEmpty')}</div>
                    )}
                  </ExpandableOverflowBox>
                  <div className="profile-field-help">{t('userProfile.defaults.kbHelp')}</div>
                </div>

                <div className="profile-section">
                  <div className="profile-section__title">{t('userProfile.defaults.toolsSectionTitle')}</div>

                  <div className="profile-tool-row">
                    <Form.Check
                      type="switch"
                      id="profile-defaults-all-tools"
                      label=""
                      checked={displayedSettings.autoToolsEnabled}
                      disabled={disableDefaultsForm}
                      onChange={(e) => {
                        const nextEnabled = e.target.checked;
                        setUserDefaults((prev) => ({
                          ...prev,
                          autoToolsEnabled: nextEnabled,
                          ...(nextEnabled
                            ? {
                                webSearchEnabled: true,
                                dataAnalysisEnabled: true,
                                createAgentEnabled: true,
                                memoriesEnabled: true,
                              }
                            : {
                                webSearchEnabled: false,
                                dataAnalysisEnabled: false,
                                createAgentEnabled: false,
                                memoriesEnabled: false,
                              }),
                        }));
                        setDirty(true);
                      }}
                    />
                    <div className="profile-tool-row__text">
                      <div className="profile-tool-row__label">{t('userProfile.defaults.allTools.title')}</div>
                      <div className="profile-tool-row__help">{t('userProfile.defaults.allTools.help')}</div>
                    </div>
                  </div>

                  <div className="profile-tool-sub-rows">
                    <div className="profile-tool-row">
                      <Form.Check
                        type="switch"
                        id="profile-defaults-web-search"
                        label=""
                        checked={displayedSettings.autoToolsEnabled || displayedSettings.webSearchEnabled}
                        disabled={disableDefaultsForm || displayedSettings.autoToolsEnabled}
                        onChange={(e) => {
                          setUserDefaults((prev) => ({ ...prev, webSearchEnabled: e.target.checked }));
                          setDirty(true);
                        }}
                      />
                      <div className="profile-tool-row__text">
                        <div className="profile-tool-row__label">{t('userProfile.defaults.webSearch.title')}</div>
                        <div className="profile-tool-row__help">{t('userProfile.defaults.webSearch.help')}</div>
                      </div>
                    </div>

                    {dataAnalysisAvailable && (
                      <div className="profile-tool-row">
                        <Form.Check
                          type="switch"
                          id="profile-defaults-data-analysis"
                          label=""
                          checked={displayedSettings.autoToolsEnabled || displayedSettings.dataAnalysisEnabled}
                          disabled={disableDefaultsForm || displayedSettings.autoToolsEnabled}
                          onChange={(e) => {
                            setUserDefaults((prev) => ({ ...prev, dataAnalysisEnabled: e.target.checked }));
                            setDirty(true);
                          }}
                        />
                        <div className="profile-tool-row__text">
                          <div className="profile-tool-row__label">{t('userProfile.defaults.dataAnalysis.title')}</div>
                          <div className="profile-tool-row__help">{t('userProfile.defaults.dataAnalysis.help')}</div>
                        </div>
                      </div>
                    )}

                    <div className="profile-tool-row">
                      <Form.Check
                        type="switch"
                        id="profile-defaults-create-agent"
                        label=""
                        checked={displayedSettings.autoToolsEnabled || displayedSettings.createAgentEnabled}
                        disabled={disableDefaultsForm || displayedSettings.autoToolsEnabled}
                        onChange={(e) => {
                          setUserDefaults((prev) => ({ ...prev, createAgentEnabled: e.target.checked }));
                          setDirty(true);
                        }}
                      />
                      <div className="profile-tool-row__text">
                        <div className="profile-tool-row__label">{t('userProfile.defaults.agentCreation.title')}</div>
                        <div className="profile-tool-row__help">{t('userProfile.defaults.agentCreation.help')}</div>
                      </div>
                    </div>

                    <div className="profile-tool-row">
                      <Form.Check
                        type="switch"
                        id="profile-defaults-memories"
                        label=""
                        checked={displayedSettings.autoToolsEnabled || displayedSettings.memoriesEnabled}
                        disabled={disableDefaultsForm || displayedSettings.autoToolsEnabled}
                        onChange={(e) => {
                          setUserDefaults((prev) => ({ ...prev, memoriesEnabled: e.target.checked }));
                          setDirty(true);
                        }}
                      />
                      <div className="profile-tool-row__text">
                        <div className="profile-tool-row__label">
                          {t('userProfile.defaults.memoryManagement.title')}
                        </div>
                        <div className="profile-tool-row__help">{t('userProfile.defaults.memoryManagement.help')}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="profile-section">
                  <div className="profile-section__title">{t('userProfile.defaults.integrations.label')}</div>
                  {previewMode ? (
                    <div className="profile-empty-state">{t('userProfile.defaults.integrations.disabled')}</div>
                  ) : connectionsLoading ? (
                    <div className="profile-empty-state">{t('userProfile.defaults.integrations.loading')}</div>
                  ) : (
                    <>
                      <ExpandableOverflowBox className="profile-checkbox-list" maxHeight={240}>
                        {/* One row per unique service. For dual-method services
                            (Gmail, Drive, etc.) we collapse the Pipedream and
                            native rows into a single entry, always using the
                            Pipedream art + display name — the native row is
                            dropped so users see one "Gmail" not two. Toggling
                            adds the slug to BOTH default lists so whichever
                            method the user has actually connected gets
                            enabled on the next chat. */}
                        {(() => {
                          type Row = {
                            key: string;
                            label: string;
                            iconSrc?: string;
                            iconClass?: string;
                            pipedreamSlug?: string;
                            nativeSlug?: string;
                            // FEAT-019: populated for Pipedream rows only —
                            // drives the per-account submenu.
                            allowMultipleAccounts?: boolean;
                            accounts?: IntegrationAccount[];
                          };
                          const rows: Row[] = [];

                          // Pipedream entries first — these take priority for
                          // dual-method services. Carry forward the matching
                          // native slug so the toggle handler can flip both.
                          for (const conn of availableConnections) {
                            const pdSlug = conn.id;
                            const nativeSlug = connectorSlugForPipedream(pdSlug);
                            rows.push({
                              key: `pd-${pdSlug}`,
                              label: getConnectionDisplayName(pdSlug),
                              iconSrc: getConnectionIcon(pdSlug),
                              iconClass: getConnectionFallbackIcon(pdSlug),
                              pipedreamSlug: pdSlug,
                              nativeSlug: nativeSlug ?? undefined,
                              allowMultipleAccounts: conn.allowMultipleAccounts,
                              accounts: conn.accounts,
                            });
                          }

                          // Then native-only entries — anything with a Pipedream
                          // counterpart is intentionally dropped here so we don't
                          // emit "Gmail (native)" alongside "Gmail (Pipedream)".
                          // For native entries that DO have a Pipedream slug, we
                          // still want the Pipedream art even though Pipedream
                          // isn't installed for this user.
                          for (const conn of availableNativeConnectors) {
                            const nativeSlug = conn.id;
                            const pdSlug = pipedreamSlugForConnector(nativeSlug);
                            // Skip if a Pipedream row already covered this
                            // service.
                            if (pdSlug && rows.some((r) => r.pipedreamSlug === pdSlug)) {
                              continue;
                            }
                            const tmpl = getConnectorById(nativeSlug);
                            rows.push({
                              key: `nv-${nativeSlug}`,
                              label: pdSlug ? getConnectionDisplayName(pdSlug) : conn.name,
                              iconSrc: pdSlug ? getConnectionIcon(pdSlug) : undefined,
                              iconClass: pdSlug ? getConnectionFallbackIcon(pdSlug) : (tmpl?.icon ?? 'bi bi-plug'),
                              pipedreamSlug: undefined,
                              nativeSlug,
                            });
                          }

                          rows.sort((a, b) => a.label.localeCompare(b.label));

                          return rows.map((row) => {
                            const isPdEnabled = row.pipedreamSlug ? enabledConnectionSet.has(row.pipedreamSlug) : false;
                            const isNativeEnabled = row.nativeSlug
                              ? enabledNativeConnectorSet.has(row.nativeSlug)
                              : false;
                            const checked = isPdEnabled || isNativeEnabled;
                            return (
                              <div key={row.key}>
                                <Form.Check
                                  type="checkbox"
                                  id={`profile-defaults-${row.key}`}
                                  label={
                                    <span className="d-flex align-items-center gap-2">
                                      {row.iconSrc ? (
                                        <img
                                          src={row.iconSrc}
                                          alt={row.label}
                                          className="profile-integration-icon"
                                          onError={(e) => {
                                            e.currentTarget.style.display = 'none';
                                          }}
                                        />
                                      ) : (
                                        <i className={row.iconClass} />
                                      )}
                                      {row.label}
                                      {/* FEAT-019: per-account scope for multi-account
                                          Pipedream integrations. The control self-hides
                                          unless the admin opted in AND the user has >1
                                          account connected. */}
                                      {row.pipedreamSlug && (
                                        <IntegrationAccountButton
                                          connectionId={row.pipedreamSlug}
                                          displayName={row.label}
                                          accounts={row.accounts ?? []}
                                          allowMultipleAccounts={row.allowMultipleAccounts ?? false}
                                          isEnabled={checked}
                                          selectedAccountIds={
                                            (displayedSettings.defaultAccountsByApp ?? {})[row.pipedreamSlug]
                                          }
                                          disabled={disableDefaultsForm}
                                          onChange={(nextAccountIds) => {
                                            const slug = row.pipedreamSlug!;
                                            setUserDefaults((prev) => {
                                              const all = row.accounts?.map((a) => a.account_id) ?? [];
                                              const nextMap = { ...(prev.defaultAccountsByApp ?? {}) };
                                              // Persist a narrowed subset only; "all
                                              // selected" reverts to the empty/absent
                                              // default the proxy treats as legacy.
                                              if (
                                                nextAccountIds.length === 0 ||
                                                (all.length > 0 && nextAccountIds.length === all.length)
                                              ) {
                                                delete nextMap[slug];
                                              } else {
                                                nextMap[slug] = nextAccountIds;
                                              }
                                              return { ...prev, defaultAccountsByApp: nextMap };
                                            });
                                            setDirty(true);
                                          }}
                                        />
                                      )}
                                    </span>
                                  }
                                  checked={checked}
                                  disabled={disableDefaultsForm}
                                  onChange={(e) => {
                                    const nextChecked = e.target.checked;
                                    setUserDefaults((prev) => {
                                      const pd = prev.defaultConnectionIds;
                                      const nv = prev.defaultNativeConnectorIds ?? [];
                                      let nextPd = pd;
                                      let nextNv = nv;
                                      if (row.pipedreamSlug) {
                                        nextPd = nextChecked
                                          ? Array.from(new Set([...pd, row.pipedreamSlug]))
                                          : pd.filter((x) => x !== row.pipedreamSlug);
                                      }
                                      if (row.nativeSlug) {
                                        nextNv = nextChecked
                                          ? Array.from(new Set([...nv, row.nativeSlug]))
                                          : nv.filter((x) => x !== row.nativeSlug);
                                      }
                                      // FEAT-019: drop any saved account scope for
                                      // a Pipedream integration that's been turned
                                      // off — a stale allow-list shouldn't linger.
                                      let nextAccounts = prev.defaultAccountsByApp ?? {};
                                      if (row.pipedreamSlug && !nextChecked && nextAccounts[row.pipedreamSlug]) {
                                        nextAccounts = { ...nextAccounts };
                                        delete nextAccounts[row.pipedreamSlug];
                                      }
                                      return {
                                        ...prev,
                                        defaultConnectionIds: nextPd,
                                        defaultNativeConnectorIds: nextNv,
                                        defaultAccountsByApp: nextAccounts,
                                      };
                                    });
                                    setDirty(true);
                                  }}
                                />
                              </div>
                            );
                          });
                        })()}
                        {availableConnections.length === 0 && availableNativeConnectors.length === 0 && (
                          <div className="profile-empty-state">{t('userProfile.defaults.integrations.empty')}</div>
                        )}
                      </ExpandableOverflowBox>
                      <div className="profile-field-help">{t('userProfile.defaults.integrations.help')}</div>
                    </>
                  )}
                </div>

                {renderSaveActions(
                  'userProfile.actions.reset',
                  resetToCompanyDefaults,
                  handleSaveUserDefaults,
                  canEditUserDefaults
                )}
              </>
            )}
          </Form>
        </Tab>

        {hasWorkspaceChat && (
          <Tab
            eventKey="approval-settings"
            title={
              <span>
                <i className="bi bi-shield-check me-2"></i>
                {t('userProfile.tabs.approvalSettings')}
              </span>
            }
          >
            <Form>
              <p className="profile-page-intro">{t('userProfile.approval.description')}</p>

              <div className="profile-section">
                <table className="table table-borderless approval-grid mb-0">
                  <thead>
                    <tr>
                      <th style={{ width: '28%' }}>{t('userProfile.approval.grid.toolType')}</th>
                      <th className="text-center">{t('userProfile.approval.modes.always.label')}</th>
                      <th className="text-center">{t('userProfile.approval.modes.non_destructive.label')}</th>
                      <th className="text-center">{t('userProfile.approval.modes.never.label')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Integrations row */}
                    <tr>
                      <td>
                        <div className="fw-semibold">{t('userProfile.approval.grid.integrations')}</div>
                        <div className="text-muted small">
                          {t('userProfile.approval.grid.integrationsHelp')}{' '}
                          {/* TASK-127: per-integration overrides live on the
                              Integrations page. Surface that here so users
                              know this row is the default — they can pick a
                              different mode per integration if they want. */}
                          {t('userProfile.approval.grid.integrationsOverrideNote', {
                            defaultValue: 'Override this default per integration on the Integrations page.',
                          })}
                        </div>
                      </td>
                      {(['always', 'non_destructive', 'never'] as const).map((mode) => (
                        <td key={mode} className="text-center align-middle">
                          <Form.Check
                            type="radio"
                            id={`approval-integrations-${mode}`}
                            name="approvalMode"
                            checked={userDefaults.approvalMode === mode}
                            disabled={disableDefaultsForm}
                            onChange={() => {
                              setUserDefaults((prev) => ({ ...prev, approvalMode: mode }));
                              setDirty(true);
                            }}
                            className="d-inline-block"
                          />
                        </td>
                      ))}
                    </tr>
                    {/* Agents row */}
                    <tr>
                      <td>
                        <div className="fw-semibold">{t('userProfile.approval.grid.agents')}</div>
                        <div className="text-muted small">{t('userProfile.approval.grid.agentsHelp')}</div>
                      </td>
                      {(['always', 'non_destructive', 'never'] as const).map((mode) => (
                        <td key={mode} className="text-center align-middle">
                          <Form.Check
                            type="radio"
                            id={`approval-agents-${mode}`}
                            name="numaToolApprovalMode.agents"
                            checked={(userDefaults.numaToolApprovalMode?.agents ?? 'never') === mode}
                            disabled={disableDefaultsForm}
                            onChange={() => {
                              setUserDefaults((prev) => ({
                                ...prev,
                                numaToolApprovalMode: {
                                  ...(prev.numaToolApprovalMode ?? {
                                    agents: 'never',
                                    memories: 'never',
                                    knowledgeBases: 'never',
                                    ops: 'never',
                                  }),
                                  agents: mode,
                                },
                              }));
                              setDirty(true);
                            }}
                            className="d-inline-block"
                          />
                        </td>
                      ))}
                    </tr>
                    {/* Memories row */}
                    <tr>
                      <td>
                        <div className="fw-semibold">{t('userProfile.approval.grid.memories')}</div>
                        <div className="text-muted small">{t('userProfile.approval.grid.memoriesHelp')}</div>
                      </td>
                      {(['always', 'non_destructive', 'never'] as const).map((mode) => (
                        <td key={mode} className="text-center align-middle">
                          <Form.Check
                            type="radio"
                            id={`approval-memories-${mode}`}
                            name="numaToolApprovalMode.memories"
                            checked={(userDefaults.numaToolApprovalMode?.memories ?? 'never') === mode}
                            disabled={disableDefaultsForm}
                            onChange={() => {
                              setUserDefaults((prev) => ({
                                ...prev,
                                numaToolApprovalMode: {
                                  ...(prev.numaToolApprovalMode ?? {
                                    agents: 'never',
                                    memories: 'never',
                                    knowledgeBases: 'never',
                                    ops: 'never',
                                  }),
                                  memories: mode,
                                },
                              }));
                              setDirty(true);
                            }}
                            className="d-inline-block"
                          />
                        </td>
                      ))}
                    </tr>
                    {/* Knowledge Bases row */}
                    <tr>
                      <td>
                        <div className="fw-semibold">{t('userProfile.approval.grid.knowledgeBases')}</div>
                        <div className="text-muted small">{t('userProfile.approval.grid.knowledgeBasesHelp')}</div>
                      </td>
                      {(['always', 'non_destructive', 'never'] as const).map((mode) => (
                        <td key={mode} className="text-center align-middle">
                          <Form.Check
                            type="radio"
                            id={`approval-kb-${mode}`}
                            name="numaToolApprovalMode.knowledgeBases"
                            checked={(userDefaults.numaToolApprovalMode?.knowledgeBases ?? 'never') === mode}
                            disabled={disableDefaultsForm}
                            onChange={() => {
                              setUserDefaults((prev) => ({
                                ...prev,
                                numaToolApprovalMode: {
                                  ...(prev.numaToolApprovalMode ?? {
                                    agents: 'never',
                                    memories: 'never',
                                    knowledgeBases: 'never',
                                    ops: 'never',
                                  }),
                                  knowledgeBases: mode,
                                },
                              }));
                              setDirty(true);
                            }}
                            className="d-inline-block"
                          />
                        </td>
                      ))}
                    </tr>
                    {/* Ops row — conditional on feature flag */}
                    {hasOps && (
                      <tr>
                        <td>
                          <div className="fw-semibold">{t('userProfile.approval.grid.ops')}</div>
                          <div className="text-muted small">{t('userProfile.approval.grid.opsHelp')}</div>
                        </td>
                        {(['always', 'non_destructive', 'never'] as const).map((mode) => (
                          <td key={mode} className="text-center align-middle">
                            <Form.Check
                              type="radio"
                              id={`approval-ops-${mode}`}
                              name="numaToolApprovalMode.ops"
                              checked={(userDefaults.numaToolApprovalMode?.ops ?? 'never') === mode}
                              disabled={disableDefaultsForm}
                              onChange={() => {
                                setUserDefaults((prev) => ({
                                  ...prev,
                                  numaToolApprovalMode: {
                                    ...(prev.numaToolApprovalMode ?? DEFAULT_CHAT_SETTINGS.numaToolApprovalMode),
                                    ops: mode,
                                  },
                                }));
                                setDirty(true);
                              }}
                              className="d-inline-block"
                            />
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="text-muted small mt-3 mb-3">
                <strong>{t('userProfile.approval.modes.always.label')}:</strong>{' '}
                {t('userProfile.approval.grid.alwaysHelp')}
                <br />
                <strong>{t('userProfile.approval.modes.non_destructive.label')}:</strong>{' '}
                {t('userProfile.approval.grid.safeHelp')}
                <br />
                <strong>{t('userProfile.approval.modes.never.label')}:</strong>{' '}
                {t('userProfile.approval.grid.neverHelp')}
              </div>

              {renderSaveActions(
                'userProfile.actions.reset',
                resetToCompanyDefaults,
                handleSaveUserDefaults,
                canEditUserDefaults
              )}
            </Form>
          </Tab>
        )}

        {hasMfa && (
          <Tab
            eventKey="trusted-devices"
            title={
              <span>
                <i className="bi bi-phone me-2"></i>
                {t('userProfile.trustedDevices.title')}
              </span>
            }
          >
            {/* MFA Re-enrolment Section */}
            <div className="mb-4 p-3 border rounded-3 bg-light">
              <h6 className="mb-2">{t('userProfile.mfaSecurity.title')}</h6>
              <p className="text-muted small mb-2">{t('userProfile.mfaSecurity.currentMethod')}</p>

              {reEnrollSuccess && (
                <Alert variant="success" dismissible onClose={() => setReEnrollSuccess(false)} className="mb-2">
                  {t('userProfile.mfaSecurity.reenrolSuccess')}
                </Alert>
              )}

              <Button variant="outline-warning" size="sm" onClick={handleOpenReEnrollModal}>
                {t('userProfile.mfaSecurity.reenrolButton')}
              </Button>
            </div>

            {/* Recovery Codes Section */}
            {recoveryCodesStatus?.enabled && (
              <div className="mb-4 p-3 border rounded-3 bg-light">
                <h6 className="mb-2">
                  <i className="bi bi-key me-2" />
                  {t('userProfile.recoveryCodes.title')}
                </h6>
                <p className="text-muted small mb-2">{t('userProfile.recoveryCodes.description')}</p>

                {recoveryCodesError && (
                  <Alert variant="danger" dismissible onClose={() => setRecoveryCodesError(null)} className="mb-2">
                    {recoveryCodesError}
                  </Alert>
                )}

                {recoveryCodesStatus.hasRecoveryCodes ? (
                  <>
                    <p className="small mb-2">
                      <i className="bi bi-shield-check text-success me-1" />
                      {t('userProfile.recoveryCodes.remaining', {
                        count: recoveryCodesStatus.remainingCodes,
                      })}
                    </p>
                    {recoveryCodesStatus.remainingCodes <= 2 && recoveryCodesStatus.remainingCodes > 0 && (
                      <Alert variant="warning" className="py-2 px-3 mb-2">
                        <i className="bi bi-exclamation-triangle me-1" />
                        {t('userProfile.recoveryCodes.lowCodesWarning')}
                      </Alert>
                    )}
                    <Button
                      variant="outline-primary"
                      size="sm"
                      onClick={handleGenerateRecoveryCodes}
                      disabled={recoveryCodesGenerating}
                    >
                      {recoveryCodesGenerating ? (
                        <>
                          <Spinner as="span" animation="border" size="sm" className="me-1" />
                          {t('userProfile.recoveryCodes.generating')}
                        </>
                      ) : (
                        t('userProfile.recoveryCodes.regenerateButton')
                      )}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="small text-muted mb-2">{t('userProfile.recoveryCodes.noCodes')}</p>
                    <Button
                      variant="outline-primary"
                      size="sm"
                      onClick={handleGenerateRecoveryCodes}
                      disabled={recoveryCodesGenerating}
                    >
                      {recoveryCodesGenerating ? (
                        <>
                          <Spinner as="span" animation="border" size="sm" className="me-1" />
                          {t('userProfile.recoveryCodes.generating')}
                        </>
                      ) : (
                        t('userProfile.recoveryCodes.generateButton')
                      )}
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* Recovery Codes Modal */}
            <RecoveryCodesModal
              show={showRecoveryCodesModal}
              codes={generatedRecoveryCodes}
              onClose={() => {
                setShowRecoveryCodesModal(false);
                setGeneratedRecoveryCodes([]);
              }}
              isRegeneration={recoveryCodesStatus?.hasRecoveryCodes}
            />

            {/* MFA Re-enrolment Modal */}
            <Modal show={reEnrollModalOpen} onHide={handleCloseReEnrollModal} centered backdrop="static">
              <Modal.Header closeButton>
                <Modal.Title className="h5">
                  {reEnrollStep === 'done'
                    ? t('userProfile.mfaSecurity.reenrolSuccess')
                    : t('userProfile.mfaSecurity.reenrolModalTitle')}
                </Modal.Title>
              </Modal.Header>
              <Modal.Body>
                {reEnrollError && (
                  <Alert variant="danger" dismissible onClose={() => setReEnrollError(null)} className="mb-3">
                    {reEnrollError}
                  </Alert>
                )}

                {/* Step 1: Password verification */}
                {reEnrollStep === 'password' && (
                  <Form onSubmit={handleReEnrollPasswordSubmit}>
                    <p className="text-muted small mb-3">{t('userProfile.mfaSecurity.passwordPrompt')}</p>
                    <Form.Group className="mb-3">
                      <Form.Label>{t('userProfile.mfaSecurity.passwordLabel')}</Form.Label>
                      <InputGroup>
                        <Form.Control
                          type={reEnrollShowPassword ? 'text' : 'password'}
                          value={reEnrollPassword}
                          onChange={(e) => setReEnrollPassword(e.target.value)}
                          placeholder={t('userProfile.mfaSecurity.passwordPlaceholder')}
                          autoFocus
                          autoComplete="current-password"
                        />
                        <Button
                          variant="outline-secondary"
                          onClick={() => setReEnrollShowPassword(!reEnrollShowPassword)}
                          tabIndex={-1}
                        >
                          <i className={`bi bi-eye${reEnrollShowPassword ? '-slash' : ''}`} />
                        </Button>
                      </InputGroup>
                    </Form.Group>
                    <Button
                      variant="primary"
                      type="submit"
                      className="w-100"
                      disabled={reEnrollLoading || !reEnrollPassword}
                    >
                      {reEnrollLoading ? (
                        <>
                          <Spinner as="span" animation="border" size="sm" className="me-2" />
                          {t('userProfile.mfaSecurity.verifying')}
                        </>
                      ) : (
                        t('userProfile.mfaSecurity.continueButton')
                      )}
                    </Button>
                  </Form>
                )}

                {/* Step 2: QR code + TOTP verification (matches login MFA setup UI) */}
                {reEnrollStep === 'setup' && reEnrollMfaSetup && (
                  <Form onSubmit={handleCompleteReEnroll}>
                    <Alert variant="warning" className="mb-3">
                      <p className="mb-0 small">{t('userProfile.mfaSecurity.reenrolWarning')}</p>
                    </Alert>

                    {/* QR Code */}
                    <div className="text-center mb-3">
                      <div className="d-inline-block p-3 bg-white rounded border" style={{ lineHeight: 0 }}>
                        <QRCodeSVG value={reEnrollMfaSetup.otpauthUrl} size={180} level="M" />
                      </div>
                      <Form.Text className="d-block mt-2 text-muted">
                        {t('userProfile.mfaSecurity.scanQrCode')}
                      </Form.Text>
                    </div>

                    {/* Manual entry fallback */}
                    <details className="mb-3">
                      <summary className="text-muted small" style={{ cursor: 'pointer' }}>
                        {t('userProfile.mfaSecurity.cantScanQr')}
                      </summary>
                      <div className="mt-2">
                        <Form.Label className="small">{t('userProfile.mfaSecurity.secretKeyLabel')}</Form.Label>
                        <InputGroup size="sm">
                          <Form.Control
                            type="text"
                            value={reEnrollMfaSetup.secretCode}
                            readOnly
                            className="font-monospace"
                          />
                          <Button variant="outline-secondary" onClick={handleCopyReEnrollSecret}>
                            {reEnrollSecretCopied ? t('common:copied') : t('common:copy')}
                          </Button>
                        </InputGroup>
                        <Form.Text className="text-muted small">{t('userProfile.mfaSecurity.secretKeyHint')}</Form.Text>
                      </div>
                    </details>

                    <Form.Group className="mb-3">
                      <Form.Label>{t('userProfile.mfaSecurity.codeLabel')}</Form.Label>
                      <Form.Control
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        value={reEnrollCode}
                        onChange={(e) => setReEnrollCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="000000"
                        autoFocus
                        autoComplete="one-time-code"
                      />
                    </Form.Group>

                    <Button
                      variant="primary"
                      type="submit"
                      className="w-100"
                      disabled={reEnrollLoading || reEnrollCode.length !== 6}
                    >
                      {reEnrollLoading ? (
                        <>
                          <Spinner as="span" animation="border" size="sm" className="me-2" />
                          {t('userProfile.mfaSecurity.verifying')}
                        </>
                      ) : (
                        t('userProfile.mfaSecurity.verifyButton')
                      )}
                    </Button>
                  </Form>
                )}

                {/* Step 3: Success */}
                {reEnrollStep === 'done' && (
                  <Alert variant="success" className="mb-0">
                    <i className="bi bi-check-circle me-2" />
                    {t('userProfile.mfaSecurity.reenrolSuccess')}
                  </Alert>
                )}
              </Modal.Body>
            </Modal>

            <h6 className="mb-2">{t('userProfile.trustedDevices.title')}</h6>
            <p className="text-muted mb-3">{t('userProfile.trustedDevices.description')}</p>
            {devicesLoading ? (
              <div className="text-center py-4">
                <Spinner animation="border" />
              </div>
            ) : devices.length === 0 ? (
              <Alert variant="secondary">
                <i className="bi bi-info-circle me-2"></i>
                {t('userProfile.trustedDevices.noDevices')}
              </Alert>
            ) : (
              <div className="d-flex flex-column gap-2">
                {devices.map((device) => (
                  <div
                    key={device.deviceKey}
                    className="p-3 border rounded-3 bg-white d-flex align-items-center justify-content-between"
                  >
                    <div>
                      <div className="fw-semibold">
                        {device.deviceName || t('userProfile.trustedDevices.unknownDevice')}
                        {device.isCurrent && (
                          <span className="badge bg-primary ms-2">{t('userProfile.trustedDevices.currentDevice')}</span>
                        )}
                      </div>
                      {device.lastAuthDate && (
                        <div className="text-muted small">
                          {t('userProfile.trustedDevices.lastUsed', {
                            date: device.lastAuthDate.toLocaleDateString(),
                          })}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      disabled={deviceRevoking === device.deviceKey}
                      onClick={() => handleForgetDevice(device.deviceKey)}
                    >
                      {deviceRevoking === device.deviceKey ? (
                        <Spinner as="span" animation="border" size="sm" />
                      ) : (
                        t('userProfile.trustedDevices.forget')
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Tab>
        )}
      </StyledTabs>
    </div>
  );

  if (embedded) {
    return <div className="settings-embedded-user">{profileContent}</div>;
  }

  return (
    <div className="dashboard">
      <PageHeader title={t('userProfile.title')} />

      <div className="app-content">
        <div className="content-panel">
          <div className="content-panel__body">{profileContent}</div>
        </div>
      </div>
    </div>
  );
}
