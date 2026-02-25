import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Dropdown, Form, Spinner, Tab } from 'react-bootstrap';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { fromWebToken } from '@aws-sdk/credential-providers';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import axios from 'axios';
import { useAuth } from '../Providers/AuthProvider';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useTranslation } from 'react-i18next';
import {
  AdminChatSettingsService,
  DEFAULT_GLOBAL_CHAT_SETTINGS,
  type GlobalChatSettings,
} from '../Services/AdminChatSettingsService';
import {
  ChatSettingsService,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_USER_PROFILE,
  type Memory,
  type UserChatSettingsUpdate,
  type UserProfile,
} from '../Services/ChatSettingsService';
import { PipedreamProxyService } from '../Services/PipedreamProxyService';
import { withPRM } from '../utils/prmUtils';
import ExpandableOverflowBox from '../Components/ExpandableOverflowBox';
import { PageHeader } from '../Components/PageHeader';
import { StyledTabs } from '../Components/StyledTabs';
import { manifestService } from '../Services/manifestService';
import { applyLanguagePreference, LANGUAGE_BROWSER_DEFAULT } from '../utils/languagePreference';
import { getConnectionDisplayName, getConnectionIcon, getConnectionFallbackIcon } from '../config/integrationsConfig';
import ProfileAvatar from '../Components/ProfileAvatar';
import { invalidateProfileBlob } from '../utils/profileImageCache';

type Connection = { id: string; isConnected: boolean; mcpServerUrl?: string };

const IMAGE_TARGET_SIZE = 256;
const IMAGE_MAX_BYTES = 4 * 1024 * 1024; // 4 MB

// Character limits (match backend validation)
const LIMIT_NAME = 100;
const LIMIT_TITLE = 100;
const LIMIT_URL = 200;
const LIMIT_LONG = 500;
const LIMIT_CUSTOM_INSTRUCTIONS = 1500;
const LIMIT_MEMORY = 300;

function CharCount({ value, max }: { value: string; max: number }) {
  const len = value.length;
  const isNear = len > max * 0.9;
  return (
    <div className={`profile-char-count ${isNear ? 'is-near' : ''}`}>
      {len}/{max}
    </div>
  );
}

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
  const { user, getCredentials } = useAuth();
  const { numaGet, numaPut } = useNumaRequest();
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

  const hasWorkspaceChat = window.sessionStorage.getItem('NUMA_WORKSPACE_CHAT') === 'true';
  const hasPipedreamFeature = window.sessionStorage.getItem('PIPEDREAM_INTEGRATIONS') === 'true';
  const relayLambdaArn = window.sessionStorage.getItem('PIPEDREAM_RELAY_LAMBDA_ARN');
  const previewMode = !hasPipedreamFeature || !relayLambdaArn;
  const REGION = window.sessionStorage.getItem('REGION') || 'us-east-1';

  // Profile image upload state
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Memory editing state
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryContent, setEditingMemoryContent] = useState('');
  const [editingMemoryScope, setEditingMemoryScope] = useState('general');
  const [addingMemory, setAddingMemory] = useState(false);
  const [newMemoryContent, setNewMemoryContent] = useState('');
  const [newMemoryScope, setNewMemoryScope] = useState('general');

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
    [t],
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
    [getCredentials, resizeToCanvas, t, user, userProfile.profileImage],
  );

  const handleRemoveImage = useCallback(() => {
    if (userProfile.profileImage) {
      invalidateProfileBlob(userProfile.profileImage.s3Bucket, userProfile.profileImage.s3Key);
    }
    setUserProfile((prev) => ({ ...prev, profileImage: null }));
    setImageError(null);
    setProfileDirty(true);
  }, [userProfile.profileImage]);

  const [lambdaClient, setLambdaClient] = useState<LambdaClient | null>(null);
  const [connectionsLoading, setConnectionsLoading] = useState<boolean>(false);
  const [availableConnections, setAvailableConnections] = useState<Connection[]>([]);
  const [dataAnalysisAvailable, setDataAnalysisAvailable] = useState(true);
  const [globalIntegrationSettings, setGlobalIntegrationSettings] = useState<
    Record<string, { status: 'enabled' | 'disabled'; denyTools: string[] }>
  >({});

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
    [availableKBs],
  );

  const canEditUserDefaults = globalLoaded && globalAllowUserDefaults;
  const canEditProfile = globalLoaded;

  useEffect(() => {
    const init = async () => {
      if (!user) return;
      if (previewMode) {
        setConnectionsLoading(false);
        setAvailableConnections([]);
        return;
      }

      try {
        const GROUPS = JSON.parse(window.sessionStorage.getItem('GROUPS') || '{}');
        const userGroup = user.decoded_tokens?.idToken?.['cognito:groups']?.[0] || 'standard';
        const roleArn = GROUPS[userGroup]?.roleArn;
        const cognitoUserId = user.decoded_tokens?.idToken?.sub;
        if (!roleArn) {
          setConnectionsLoading(false);
          setAvailableConnections([]);
          return;
        }
        const credentials = fromWebToken({
          webIdentityToken: user.tokens.idToken,
          roleArn,
          roleSessionName: cognitoUserId,
        });
        const client = withPRM(LambdaClient, { region: REGION, credentials });
        setLambdaClient(client);
      } catch {
        setConnectionsLoading(false);
        setAvailableConnections([]);
      }
    };
    init();
  }, [REGION, previewMode, user]);

  useEffect(() => {
    (async () => {
      try {
        if (!user) return;
        const items = (await numaGet('/api/settings/integrations')) as Array<{
          integration: string;
          status: 'enabled' | 'disabled';
          denyTools: string[];
        }>;
        const map: Record<string, { status: 'enabled' | 'disabled'; denyTools: string[] }> = {};
        for (const item of items || []) {
          map[item.integration] = { status: item.status, denyTools: item.denyTools || [] };
        }
        setGlobalIntegrationSettings(map);
      } catch {
        /* ignore */
      }
    })();
  }, [numaGet, user]);

  useEffect(() => {
    const loadConnectionStatus = async () => {
      if (!lambdaClient || !user) return;
      try {
        setConnectionsLoading(true);
        const externalUserId = PipedreamProxyService.deriveExternalUserId(user);
        const response = await PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId, {
          ttlMs: 30 * 60 * 1000,
        });

        const allConnections: Connection[] = (response.connections || []).map((conn) => ({
          id: conn.app_name,
          isConnected: conn.status === 'connected',
          mcpServerUrl: undefined,
        }));

        const connected = allConnections
          .filter((conn) => conn.isConnected)
          .filter((conn) => globalIntegrationSettings[conn.id]?.status !== 'disabled');

        setAvailableConnections(connected);
      } catch {
        setAvailableConnections([]);
      } finally {
        setConnectionsLoading(false);
      }
    };

    if (lambdaClient) {
      loadConnectionStatus();
    }
  }, [globalIntegrationSettings, lambdaClient, user]);

  // When user defaults are disabled, show company defaults in the form
  const displayedSettings = useMemo(() => {
    if (!userDefaultsEnabled) {
      return {
        defaultKBIds: companyDefaults.defaultKBIds,
        autoToolsEnabled: companyDefaults.autoToolsEnabled,
        webSearchEnabled: companyDefaults.webSearchEnabled,
        createAgentEnabled: companyDefaults.createAgentEnabled,
        memoriesEnabled: companyDefaults.memoriesEnabled,
        dataAnalysisEnabled: companyDefaults.dataAnalysisEnabled,
        defaultConnectionIds: companyDefaults.defaultConnectionIds,
      };
    }
    return userDefaults;
  }, [userDefaultsEnabled, userDefaults, companyDefaults]);

  const enabledKBSet = useMemo(() => new Set(displayedSettings.defaultKBIds), [displayedSettings.defaultKBIds]);
  const enabledConnectionSet = useMemo(
    () => new Set(displayedSettings.defaultConnectionIds),
    [displayedSettings.defaultConnectionIds],
  );
  const getKBLabel = (kbId: string, kbName?: string) => {
    if (kbId === 'company') {
      return t('chatDefaults.companyKnowledgeBase');
    }
    return kbName || kbId;
  };

  const disableDefaultsForm = saving || loading || !canEditUserDefaults || !userDefaultsEnabled;
  const disableProfileForm = saving || loading;
  const resetToCompanyDefaults = () => {
    setUserDefaultsEnabled(true);
    setUserDefaults({
      defaultKBIds: companyDefaults.defaultKBIds,
      autoToolsEnabled: companyDefaults.autoToolsEnabled,
      webSearchEnabled: companyDefaults.webSearchEnabled,
      createAgentEnabled: companyDefaults.createAgentEnabled,
      memoriesEnabled: companyDefaults.memoriesEnabled,
      dataAnalysisEnabled: companyDefaults.dataAnalysisEnabled,
      defaultConnectionIds: companyDefaults.defaultConnectionIds,
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
        },
        numaPut,
      );
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
        language: userDefaults.language,
        approvalMode: userDefaults.approvalMode,
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

              {/* ── Section 3: Memories ── */}
              <div className="profile-section">
                <div className="profile-section__title">{t('userProfile.profile.fields.memories.sectionTitle')}</div>
                <p className="profile-section__description">{t('userProfile.profile.fields.memories.description')}</p>

                {userProfile.memories.length === 0 && !addingMemory && (
                  <div className="profile-empty-state">{t('userProfile.profile.fields.memories.empty')}</div>
                )}

                {/* Existing memories list */}
                {userProfile.memories.map((memory) => (
                  <div key={memory.id} className="profile-memory-item">
                    {editingMemoryId === memory.id ? (
                      <div
                        className="profile-memory-form"
                        style={{ border: 'none', background: 'transparent', padding: 0, margin: 0 }}
                      >
                        <Form.Control
                          as="textarea"
                          rows={2}
                          maxLength={LIMIT_MEMORY}
                          value={editingMemoryContent}
                          onChange={(e) => setEditingMemoryContent(e.target.value)}
                          className="mb-2"
                          placeholder={t('userProfile.profile.fields.memories.content.placeholder')}
                        />
                        <div className="profile-memory-form__controls">
                          <Dropdown className="memory-scope-dropdown">
                            <Dropdown.Toggle
                              variant="outline-secondary"
                              size="sm"
                              className="memory-scope-dropdown__toggle"
                            >
                              {editingMemoryScope === 'general' ? (
                                <>
                                  <i className="bi bi-globe2 memory-scope-dropdown__general-icon" />
                                  {t('userProfile.profile.fields.memories.scope.general')}
                                </>
                              ) : (
                                <>
                                  <img
                                    src={getConnectionIcon(editingMemoryScope.replace('integration:', ''))}
                                    alt=""
                                    className="memory-scope-dropdown__icon"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                    }}
                                  />
                                  {getConnectionDisplayName(editingMemoryScope.replace('integration:', ''))}
                                </>
                              )}
                            </Dropdown.Toggle>
                            <Dropdown.Menu className="memory-scope-dropdown__menu">
                              <Dropdown.Item
                                active={editingMemoryScope === 'general'}
                                onClick={() => setEditingMemoryScope('general')}
                                className="memory-scope-dropdown__item"
                              >
                                <i className="bi bi-globe2 memory-scope-dropdown__general-icon" />
                                <div className="memory-scope-dropdown__item-text">
                                  <span className="memory-scope-dropdown__item-name">
                                    {t('userProfile.profile.fields.memories.scope.general')}
                                  </span>
                                  <span className="memory-scope-dropdown__item-desc">
                                    {t('userProfile.profile.fields.memories.scope.generalDescription')}
                                  </span>
                                </div>
                              </Dropdown.Item>
                              {availableConnections.length > 0 && (
                                <>
                                  <Dropdown.Divider />
                                  <div className="memory-scope-dropdown__group-header">
                                    <span className="memory-scope-dropdown__group-title">
                                      {t('userProfile.profile.fields.memories.scope.integrationsHeader')}
                                    </span>
                                    <span className="memory-scope-dropdown__group-desc">
                                      {t('userProfile.profile.fields.memories.scope.integrationsDescription')}
                                    </span>
                                  </div>
                                  {availableConnections
                                    .sort((a, b) =>
                                      getConnectionDisplayName(a.id).localeCompare(getConnectionDisplayName(b.id)),
                                    )
                                    .map((conn) => (
                                      <Dropdown.Item
                                        key={conn.id}
                                        active={editingMemoryScope === `integration:${conn.id}`}
                                        onClick={() => setEditingMemoryScope(`integration:${conn.id}`)}
                                        className="memory-scope-dropdown__item"
                                      >
                                        <img
                                          src={getConnectionIcon(conn.id)}
                                          alt=""
                                          className="memory-scope-dropdown__icon"
                                          onError={(e) => {
                                            e.currentTarget.style.display = 'none';
                                          }}
                                        />
                                        <span className="memory-scope-dropdown__item-name">
                                          {getConnectionDisplayName(conn.id)}
                                        </span>
                                      </Dropdown.Item>
                                    ))}
                                </>
                              )}
                            </Dropdown.Menu>
                          </Dropdown>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => {
                              if (!editingMemoryContent.trim()) return;
                              setUserProfile((prev) => ({
                                ...prev,
                                memories: prev.memories.map((m) =>
                                  m.id === memory.id
                                    ? { ...m, content: editingMemoryContent.trim(), scope: editingMemoryScope }
                                    : m,
                                ),
                              }));
                              setEditingMemoryId(null);
                              setProfileDirty(true);
                            }}
                          >
                            {t('userProfile.profile.fields.memories.saveMemory')}
                          </Button>
                          <Button variant="outline-secondary" size="sm" onClick={() => setEditingMemoryId(null)}>
                            {t('userProfile.profile.fields.memories.cancelMemory')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="d-flex justify-content-between align-items-start">
                        <div className="flex-grow-1">
                          <div className="profile-memory-item__content">{memory.content}</div>
                          <div className="profile-memory-item__meta">
                            <span className="profile-memory-badge">
                              {memory.scope === 'general' ? (
                                <>
                                  <i className="bi bi-globe2 memory-scope-badge__icon" />
                                  {t('userProfile.profile.fields.memories.scope.general')}
                                </>
                              ) : memory.scope.startsWith('integration:') ? (
                                <>
                                  <img
                                    src={getConnectionIcon(memory.scope.replace('integration:', ''))}
                                    alt=""
                                    className="memory-scope-badge__img"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                    }}
                                  />
                                  {getConnectionDisplayName(memory.scope.replace('integration:', ''))}
                                </>
                              ) : memory.scope.startsWith('agent:') ? (
                                `${t('userProfile.profile.fields.memories.scope.agentPrefix')}: ${memory.scope.replace('agent:', '').slice(0, 8)}`
                              ) : (
                                memory.scope
                              )}
                            </span>
                            <span className="profile-memory-source">
                              {memory.source === 'ai'
                                ? t('userProfile.profile.fields.memories.source.ai')
                                : t('userProfile.profile.fields.memories.source.user')}
                            </span>
                          </div>
                        </div>
                        <div className="profile-memory-item__actions">
                          <Button
                            className="profile-memory-action-btn"
                            variant="outline-secondary"
                            size="sm"
                            disabled={profileSaving}
                            onClick={() => {
                              setEditingMemoryId(memory.id);
                              setEditingMemoryContent(memory.content);
                              setEditingMemoryScope(memory.scope);
                            }}
                          >
                            {t('userProfile.profile.fields.memories.editMemory')}
                          </Button>
                          <Button
                            className="profile-memory-action-btn"
                            variant="outline-danger"
                            size="sm"
                            disabled={profileSaving}
                            onClick={() => {
                              setUserProfile((prev) => ({
                                ...prev,
                                memories: prev.memories.filter((m) => m.id !== memory.id),
                              }));
                              setProfileDirty(true);
                            }}
                          >
                            {t('userProfile.profile.fields.memories.deleteMemory')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add memory form */}
                {addingMemory ? (
                  <div className="profile-memory-form">
                    <Form.Control
                      as="textarea"
                      rows={2}
                      maxLength={LIMIT_MEMORY}
                      value={newMemoryContent}
                      onChange={(e) => setNewMemoryContent(e.target.value)}
                      className="mb-2"
                      placeholder={t('userProfile.profile.fields.memories.content.placeholder')}
                    />
                    <div className="profile-memory-form__controls">
                      <Dropdown className="memory-scope-dropdown">
                        <Dropdown.Toggle
                          variant="outline-secondary"
                          size="sm"
                          className="memory-scope-dropdown__toggle"
                        >
                          {newMemoryScope === 'general' ? (
                            <>
                              <i className="bi bi-globe2 memory-scope-dropdown__general-icon" />
                              {t('userProfile.profile.fields.memories.scope.general')}
                            </>
                          ) : (
                            <>
                              <img
                                src={getConnectionIcon(newMemoryScope.replace('integration:', ''))}
                                alt=""
                                className="memory-scope-dropdown__icon"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                              {getConnectionDisplayName(newMemoryScope.replace('integration:', ''))}
                            </>
                          )}
                        </Dropdown.Toggle>
                        <Dropdown.Menu className="memory-scope-dropdown__menu">
                          <Dropdown.Item
                            active={newMemoryScope === 'general'}
                            onClick={() => setNewMemoryScope('general')}
                            className="memory-scope-dropdown__item"
                          >
                            <i className="bi bi-globe2 memory-scope-dropdown__general-icon" />
                            <div className="memory-scope-dropdown__item-text">
                              <span className="memory-scope-dropdown__item-name">
                                {t('userProfile.profile.fields.memories.scope.general')}
                              </span>
                              <span className="memory-scope-dropdown__item-desc">
                                {t('userProfile.profile.fields.memories.scope.generalDescription')}
                              </span>
                            </div>
                          </Dropdown.Item>
                          {availableConnections.length > 0 && (
                            <>
                              <Dropdown.Divider />
                              <div className="memory-scope-dropdown__group-header">
                                <span className="memory-scope-dropdown__group-title">
                                  {t('userProfile.profile.fields.memories.scope.integrationsHeader')}
                                </span>
                                <span className="memory-scope-dropdown__group-desc">
                                  {t('userProfile.profile.fields.memories.scope.integrationsDescription')}
                                </span>
                              </div>
                              {availableConnections
                                .sort((a, b) =>
                                  getConnectionDisplayName(a.id).localeCompare(getConnectionDisplayName(b.id)),
                                )
                                .map((conn) => (
                                  <Dropdown.Item
                                    key={conn.id}
                                    active={newMemoryScope === `integration:${conn.id}`}
                                    onClick={() => setNewMemoryScope(`integration:${conn.id}`)}
                                    className="memory-scope-dropdown__item"
                                  >
                                    <img
                                      src={getConnectionIcon(conn.id)}
                                      alt=""
                                      className="memory-scope-dropdown__icon"
                                      onError={(e) => {
                                        e.currentTarget.style.display = 'none';
                                      }}
                                    />
                                    <span className="memory-scope-dropdown__item-name">
                                      {getConnectionDisplayName(conn.id)}
                                    </span>
                                  </Dropdown.Item>
                                ))}
                            </>
                          )}
                        </Dropdown.Menu>
                      </Dropdown>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          if (!newMemoryContent.trim()) return;
                          const newMemory: Memory = {
                            id: crypto.randomUUID(),
                            content: newMemoryContent.trim(),
                            scope: newMemoryScope,
                            createdAt: new Date().toISOString(),
                            source: 'user',
                          };
                          setUserProfile((prev) => ({
                            ...prev,
                            memories: [...prev.memories, newMemory],
                          }));
                          setNewMemoryContent('');
                          setNewMemoryScope('general');
                          setAddingMemory(false);
                          setProfileDirty(true);
                        }}
                      >
                        {t('userProfile.profile.fields.memories.saveMemory')}
                      </Button>
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        onClick={() => {
                          setAddingMemory(false);
                          setNewMemoryContent('');
                          setNewMemoryScope('general');
                        }}
                      >
                        {t('userProfile.profile.fields.memories.cancelMemory')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    className="profile-add-memory-btn"
                    disabled={profileSaving || userProfile.memories.length >= 50}
                    onClick={() => setAddingMemory(true)}
                  >
                    <i className="bi bi-plus-lg"></i>
                    {userProfile.memories.length >= 50
                      ? t('userProfile.profile.fields.memories.limitReached')
                      : t('userProfile.profile.fields.memories.addMemory')}
                  </Button>
                )}
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
                  <Form.Control
                    as="textarea"
                    rows={2}
                    value={userDefaults.emailSignatureText}
                    disabled={disableProfileForm}
                    placeholder={DEFAULT_CHAT_SETTINGS.emailSignatureText}
                    onChange={(e) => {
                      setUserDefaults((prev) => ({ ...prev, emailSignatureText: e.target.value }));
                      setDirty(true);
                    }}
                  />
                </>
              )}
            </div>

            {renderSaveActions(
              'userProfile.actions.resetBrowser',
              resetToBrowserDefaults,
              handleSaveProfileLanguage,
              canEditProfile,
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

                  <ExpandableOverflowBox className="profile-checkbox-list" maxHeight={240}>
                    {isLoadingKBs ? (
                      <div className="profile-empty-state">{t('userProfile.defaults.kbLoading')}</div>
                    ) : (
                      kbIdsSorted.map((kbId) => {
                        const kb = availableKBs.find((k) => k.kb_id === kbId);
                        const label = getKBLabel(kbId, kb?.kb_name);
                        const checked = enabledKBSet.has(kbId);
                        return (
                          <Form.Check
                            key={kbId}
                            type="checkbox"
                            id={`profile-defaults-kb-${kbId}`}
                            label={label}
                            checked={checked}
                            disabled={disableDefaultsForm}
                            onChange={(e) => {
                              const nextChecked = e.target.checked;
                              setUserDefaults((prev) => ({
                                ...prev,
                                defaultKBIds: nextChecked
                                  ? Array.from(new Set([...prev.defaultKBIds, kbId]))
                                  : prev.defaultKBIds.filter((id) => id !== kbId),
                              }));
                              setDirty(true);
                            }}
                          />
                        );
                      })
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
                        {availableConnections
                          .sort((a, b) => getConnectionDisplayName(a.id).localeCompare(getConnectionDisplayName(b.id)))
                          .map((conn) => {
                            const id = conn.id;
                            const checked = enabledConnectionSet.has(id);
                            const iconSrc = getConnectionIcon(id);
                            const fallbackIcon = getConnectionFallbackIcon(id);
                            return (
                              <Form.Check
                                key={id}
                                type="checkbox"
                                id={`profile-defaults-integration-${id}`}
                                label={
                                  <span className="d-flex align-items-center gap-2">
                                    {iconSrc ? (
                                      <img
                                        src={iconSrc}
                                        alt={getConnectionDisplayName(id)}
                                        className="profile-integration-icon"
                                        onError={(e) => {
                                          e.currentTarget.style.display = 'none';
                                        }}
                                      />
                                    ) : (
                                      <i className={fallbackIcon} />
                                    )}
                                    {getConnectionDisplayName(id)}
                                  </span>
                                }
                                checked={checked}
                                disabled={disableDefaultsForm}
                                onChange={(e) => {
                                  const nextChecked = e.target.checked;
                                  setUserDefaults((prev) => ({
                                    ...prev,
                                    defaultConnectionIds: nextChecked
                                      ? Array.from(new Set([...prev.defaultConnectionIds, id]))
                                      : prev.defaultConnectionIds.filter((x) => x !== id),
                                  }));
                                  setDirty(true);
                                }}
                              />
                            );
                          })}
                        {availableConnections.length === 0 && (
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
                  canEditUserDefaults,
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
                <div className="profile-section__title">{t('userProfile.approval.label')}</div>

                <div className="profile-radio-group">
                  {(['always', 'non_destructive', 'never'] as const).map((mode) => (
                    <div
                      key={mode}
                      className={`profile-radio-option ${userDefaults.approvalMode === mode ? 'is-selected' : ''}`}
                      onClick={() => {
                        if (disableDefaultsForm) return;
                        setUserDefaults((prev) => ({ ...prev, approvalMode: mode }));
                        setDirty(true);
                      }}
                    >
                      <div className="profile-radio-option__inner">
                        <Form.Check
                          type="radio"
                          id={`approval-mode-${mode}`}
                          name="approvalMode"
                          checked={userDefaults.approvalMode === mode}
                          disabled={disableDefaultsForm}
                          onChange={() => {
                            setUserDefaults((prev) => ({ ...prev, approvalMode: mode }));
                            setDirty(true);
                          }}
                        />
                        <div className="profile-radio-option__text">
                          <div className="profile-radio-option__label">
                            {t(`userProfile.approval.modes.${mode}.label`)}
                          </div>
                          <div className="profile-radio-option__help">
                            {t(`userProfile.approval.modes.${mode}.help`)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {renderSaveActions(
                'userProfile.actions.reset',
                resetToCompanyDefaults,
                handleSaveUserDefaults,
                canEditUserDefaults,
              )}
            </Form>
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
