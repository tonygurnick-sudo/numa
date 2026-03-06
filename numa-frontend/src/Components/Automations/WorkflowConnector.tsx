import { Check } from 'lucide-react';

type WorkflowConnectorProps = {
  stepNumber: number;
  label: string;
  isActive: boolean;
  isCompleted: boolean;
  isLast?: boolean;
};

export const WorkflowConnector = ({ stepNumber, label, isActive, isCompleted, isLast }: WorkflowConnectorProps) => {
  const circleClass = isCompleted
    ? 'workflow-connector__circle--completed'
    : isActive
      ? 'workflow-connector__circle--active'
      : 'workflow-connector__circle--pending';

  return (
    <div className="workflow-connector">
      <div className="d-flex flex-column align-items-center gap-1">
        <div className={`workflow-connector__circle ${circleClass}`}>
          {isCompleted ? <Check size={14} /> : stepNumber}
        </div>
        <span
          className={`workflow-connector__label ${isActive ? 'fw-semibold text-dark' : isCompleted ? 'text-success' : 'text-muted'}`}
        >
          {label}
        </span>
      </div>
      {!isLast && (
        <div className={`workflow-connector__line ${isCompleted ? 'workflow-connector__line--completed' : ''}`} />
      )}
    </div>
  );
};

export default WorkflowConnector;
