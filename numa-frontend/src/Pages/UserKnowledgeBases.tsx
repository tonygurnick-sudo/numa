/**
 * User Knowledge Bases Landing Page
 * Displays a grid of user KBs for selection
 */

import React, { useState } from 'react';
import { Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { PageHeader } from '../Components/PageHeader';
import { CreateKBModal } from '../Components/CreateKBModal';
import { KBSelectorGrid } from '../Components/KnowledgeBase/KBSelectorGrid';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';

export function UserKnowledgeBases(): React.JSX.Element {
  const { t } = useTranslation('knowledgeBase');
  const [showCreateKBModal, setShowCreateKBModal] = useState(false);
  const { availableKBs, isLoadingKBs, refreshKBs } = useKnowledgeBase();

  // Filter out company KB
  const userKBs = availableKBs.filter((kb) => kb.kb_id !== 'company');

  return (
    <div className="user-knowledge-bases">
      <PageHeader
        title={t('userKnowledgeBases.title')}
        subtitle={t('userKnowledgeBases.subtitle')}
        actions={
          <Button variant="primary" onClick={() => setShowCreateKBModal(true)}>
            <i className="bi bi-plus-circle me-2"></i>
            {t('userKnowledgeBases.create')}
          </Button>
        }
      />

      <LayoutDashboard>
        <KBSelectorGrid kbs={userKBs} isLoading={isLoadingKBs} />
      </LayoutDashboard>

      {/* Create KB Modal */}
      <CreateKBModal
        show={showCreateKBModal}
        onHide={() => setShowCreateKBModal(false)}
        onSuccess={() => {
          refreshKBs();
          setShowCreateKBModal(false);
        }}
      />
    </div>
  );
}
