import { useEffect, useState } from 'react';
import { Row, Col } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { S3UploadModule } from '../../Modules/S3UploadModule';
import { useNumaApp } from '../../Providers/NumaAppContext';
import { MarkdownContent } from '../Renderers/MarkdownContent';
import { ResultActions } from '../ResultActions';
import { Preloader } from '../Preloader';

const replaceReferences = (prompt, dependencies = [], appsCards = []) => {
  let updatedPrompt = prompt || '';

  if (!dependencies || !appsCards) return updatedPrompt;

  dependencies.forEach((dep) => {
    let title = '';
    appsCards.forEach((card) => {
      const cardData = card[Object.keys(card)[0]];
      if (cardData && cardData.id === dep) {
        title = '<strong>(' + cardData.title + ')</strong>' || '';
      }
    });

    if (title) {
      const regex = new RegExp(`@${dep}`, 'g');
      updatedPrompt = updatedPrompt.replace(regex, title);
    }
  });

  return updatedPrompt;
};

const AppCard = ({ card, dependencies, appsCards, onInputChange, inputValue, sessionResults }) => {
  const { t } = useTranslation('apps');
  const { updateTaskCompletionStatus } = useNumaApp();
  const this_card = card[Object.keys(card)[0]];

  // console.log('AppCard Render:', {
  //   cardId: this_card.id,
  //   cardType: this_card.type,
  //   hasSessionResults: !!sessionResults,
  //   sessionStatus: sessionResults?.status,
  //   cardStatus: sessionResults?.cardStatus?.[this_card.id],
  // });

  // Initialize with inputValue if it exists, otherwise use defaultValue
  const [localInputValue, setLocalInputValue] = useState(inputValue || this_card.defaultValue || '');

  // Update local state when inputValue prop changes or when session results arrive
  useEffect(() => {
    if (inputValue !== undefined && inputValue !== localInputValue) {
      console.log('Updating input value:', {
        cardId: this_card.id,
        inputValue,
      });
      setLocalInputValue(inputValue);
    } else if (sessionResults?.cardStatus?.[this_card.id]?.currentValue !== undefined) {
      // console.log('Updating from session results:', {
      //   cardId: this_card.id,
      //   value: sessionResults.cardStatus[this_card.id].currentValue,
      // });
      setLocalInputValue(sessionResults.cardStatus[this_card.id].currentValue);
    }
  }, [inputValue, sessionResults]);

  // Set initial value and notify parent when component mounts
  useEffect(() => {
    if (!inputValue && this_card.defaultValue) {
      onInputChange(this_card.defaultValue);
    }
  }, []);

  const description = replaceReferences(this_card.placeholder, dependencies, appsCards);

  const handleChange = (e) => {
    const newValue = e.target.value;
    setLocalInputValue(newValue);
    onInputChange(newValue);
  };

  const handleTaskComplete = () => {
    updateTaskCompletionStatus(this_card.id, true);
  };

  const handleTaskNotComplete = () => {
    updateTaskCompletionStatus(this_card.id, false);
  };

  const renderCardByType = () => {
    const outputValue = sessionResults?.cardStatus?.[this_card.id]?.currentValue;
    const isCompleted = sessionResults?.cardStatus?.[this_card.id]?.currentState === 'COMPLETED';
    const isGenerating = sessionResults && !isCompleted;

    // console.log('Rendering card:', {
    //   cardId: this_card.id,
    //   type: this_card.type,
    //   outputValue,
    //   isCompleted,
    //   isGenerating,
    // });

    switch (this_card.type) {
      case 'text-input':
        return (
          <div className="card-body p-0">
            <textarea
              rows="10"
              value={localInputValue}
              placeholder={this_card.placeholder || ''}
              onChange={handleChange}
              className="form-control w-100"
              style={{
                minHeight: '120px',
                resize: 'vertical',
                maxWidth: '100%',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            />
          </div>
        );
      case 'file-input':
        return (
          <div className="card-body p-0">
            <S3UploadModule
              task={this_card}
              onComplete={handleTaskComplete}
              onNotComplete={handleTaskNotComplete}
              onChange={onInputChange}
            />
          </div>
        );
      case 'q-query':
      case 'text-output':
        return (
          <div className="output-text markdown-content">
            {outputValue ? (
              <>
                <MarkdownContent content={outputValue} />
                <ResultActions content={outputValue} title={this_card.title || t('appCard.resultTitle')} />
              </>
            ) : (
              <>
                <p>{isGenerating ? t('appCard.generating') : t('appCard.waiting')}</p>
                <Preloader smallscreen={true} />
              </>
            )}
          </div>
        );
      default:
        return <div className="card-body">{t('appCard.unsupported')}</div>;
    }
  };

  const renderCardContent = () => {
    return renderCardByType();
  };

  return (
    <div className="w-100">
      <div className="card-header py-3">
        <Row className="g-2 mx-0">
          <Col xs={12} md={8} className="px-0">
            {this_card.title && <h3 className="mb-2 mb-md-0 text-break">{this_card.title}</h3>}
          </Col>
          {this_card.description && (
            <Col xs={12} md={4} className="px-0 text-md-end">
              <small className="text-muted d-block text-break">{this_card.description}</small>
            </Col>
          )}
        </Row>
      </div>
      <div className="card-body">
        <Row className="g-3 mx-0">
          <Col xs={12} className="px-0">
            {description && (
              <div className="card-description mb-3">
                <div className="text-break" dangerouslySetInnerHTML={{ __html: description }} />
              </div>
            )}
            {renderCardContent()}
          </Col>
        </Row>
      </div>
    </div>
  );
};

export { AppCard };
