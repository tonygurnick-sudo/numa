import { useState, useEffect, useCallback } from 'react';
import { Modal } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { useAuth } from '../Providers/AuthProvider';
import { ChatSettingsService } from '../Services/ChatSettingsService';
import { getCachedUserProfile } from '../utils/userProfileCache';
import { User, Briefcase, Target, MessageSquareText, Brain } from 'lucide-react';

const SESSION_KEY = 'numa-welcome-dismissed';

export function WelcomeProfileSetupModal() {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const { numaGet } = useNumaRequest();
  const navigate = useNavigate();

  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (sessionStorage.getItem(SESSION_KEY) === 'true') return;

    const cached = getCachedUserProfile();
    if (cached && cached.name.trim()) return;

    let cancelled = false;

    (async () => {
      try {
        const profile = await ChatSettingsService.getUserProfile(numaGet);
        if (cancelled) return;
        if (!profile.name.trim()) {
          setShowModal(true);
        }
      } catch {
        // Silently skip
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, numaGet]);

  const handleSetUpProfile = useCallback(() => {
    sessionStorage.setItem(SESSION_KEY, 'true');
    setShowModal(false);
    navigate('/profile');
  }, [navigate]);

  const handleSkip = useCallback(() => {
    sessionStorage.setItem(SESSION_KEY, 'true');
    setShowModal(false);
  }, []);

  if (!showModal) return null;

  const highlights = [
    { icon: <User size={18} />, text: t('userProfile.welcomeSetup.highlights.identity') },
    { icon: <Briefcase size={18} />, text: t('userProfile.welcomeSetup.highlights.role') },
    { icon: <Target size={18} />, text: t('userProfile.welcomeSetup.highlights.goals') },
    { icon: <MessageSquareText size={18} />, text: t('userProfile.welcomeSetup.highlights.instructions') },
    { icon: <Brain size={18} />, text: t('userProfile.welcomeSetup.highlights.memories') },
  ];

  return (
    <Modal show centered backdrop="static" className="welcome-profile-setup-modal">
      <div className="welcome-profile-setup-modal__header">
        <div className="welcome-profile-setup-modal__icon">
          <User size={28} />
        </div>
        <h2 className="welcome-profile-setup-modal__title">{t('userProfile.welcomeSetup.title')}</h2>
        <p className="welcome-profile-setup-modal__subtitle">{t('userProfile.welcomeSetup.subtitle')}</p>
      </div>

      <div className="welcome-profile-setup-modal__body">
        <ul className="welcome-profile-setup-modal__highlights">
          {highlights.map((item, i) => (
            <li key={i} className="welcome-profile-setup-modal__highlight-item">
              <span className="welcome-profile-setup-modal__highlight-icon">{item.icon}</span>
              <span className="welcome-profile-setup-modal__highlight-text">{item.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="welcome-profile-setup-modal__footer">
        <button className="welcome-profile-setup-modal__save-btn" onClick={handleSetUpProfile}>
          {t('userProfile.welcomeSetup.actions.setUpProfile')}
        </button>
        <button className="welcome-profile-setup-modal__link-btn" onClick={handleSkip}>
          {t('userProfile.welcomeSetup.actions.skip')}
        </button>
      </div>
    </Modal>
  );
}
