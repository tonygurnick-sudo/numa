import { Spinner } from 'react-bootstrap';
import { Globe } from 'react-bootstrap-icons';
import { StatsCard } from './StatsCard';
import type { PublicDemoStats as Stats } from '@/services/publicDemoService';

interface PublicDemoKpiProps {
  stats: Stats[];
  loading: boolean;
  error?: string;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function getCostVariant(ratio: number): 'success' | 'warning' | 'danger' {
  if (ratio >= 0.85) return 'danger';
  if (ratio >= 0.6) return 'warning';
  return 'success';
}

/**
 * Compact KPI variant of the Public Demo card — fits into the top-row of
 * StatsCards alongside Total Clients / Active Deployments / Global Coverage.
 *
 * Aggregates across multiple demo clients if more than one is configured.
 * The 99% case is exactly one demo client (`numa-public-demo`); the
 * aggregate keeps the headline numerically meaningful if that changes.
 */
export function PublicDemoKpi({ stats, loading, error }: PublicDemoKpiProps) {
  // Loading: borrow StatsCard chrome with a spinner where the value goes.
  if (loading) {
    return (
      <StatsCard
        title="Public Demo"
        value={(<Spinner animation="border" size="sm" />) as unknown as string}
        subtitle="Loading…"
        icon={<Globe />}
        badge={{ text: 'Demo', variant: 'primary' }}
      />
    );
  }

  if (error) {
    return (
      <StatsCard
        title="Public Demo"
        value="—"
        subtitle={error}
        icon={<Globe />}
        status="warning"
        badge={{ text: 'Error', variant: 'warning' }}
      />
    );
  }

  if (stats.length === 0) {
    return (
      <StatsCard
        title="Public Demo"
        value="—"
        subtitle="No demo client configured"
        icon={<Globe />}
        badge={{ text: 'Inactive', variant: 'secondary' }}
      />
    );
  }

  // Aggregate across all demo clients (typically just one).
  const todayCost = stats.reduce((s, x) => s + x.todayCostUsd, 0);
  const dailyLimit = stats.reduce((s, x) => s + x.dailyLimitUsd, 0);
  const convs = stats.reduce((s, x) => s + x.thirtyDayUniqueConversations, 0);
  const cost30d = stats.reduce((s, x) => s + x.thirtyDayCostUsd, 0);

  const ratio = dailyLimit > 0 ? todayCost / dailyLimit : 0;
  const variant = getCostVariant(ratio);
  // The primary demo client is whichever the user is most likely to click
  // through to. With 1+ demo configured, deep-link to the first one.
  const primaryClient = stats[0].clientName;

  return (
    <StatsCard
      title="Public Demo"
      value={formatUsd(todayCost)}
      subtitle={`of ${formatUsd(dailyLimit)} today · ${convs} convs · ${formatUsd(cost30d)} (30d)`}
      icon={<Globe />}
      progress={{ value: todayCost, max: dailyLimit, variant }}
      status={variant === 'success' ? 'success' : variant}
      badge={{ text: primaryClient, variant: 'primary' }}
      link={`/public-demo-conversations/${primaryClient}`}
    />
  );
}

// Back-compat re-export — old name still works.
export const PublicDemoStats = PublicDemoKpi;
