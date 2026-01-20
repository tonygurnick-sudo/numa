import { Badge } from 'react-bootstrap';

type SyncStatusBadgeProps = {
  connected: boolean;
};

export const SyncStatusBadge = ({ connected }: SyncStatusBadgeProps) => {
  return (
    <Badge bg={connected ? 'success' : 'secondary'} className="text-uppercase">
      {connected ? 'Connected' : 'Available'}
    </Badge>
  );
};
