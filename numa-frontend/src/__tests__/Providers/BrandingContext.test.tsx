/**
 * @vitest-environment jsdom
 */
import React, { useContext } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BrandingContext } from '../../Providers/BrandingContext';

const TestConsumer = () => {
  const context = useContext(BrandingContext);
  return (
    <div>
      <span data-testid="client-name">{context.clientName}</span>
      <span data-testid="branding-name">{context.branding.name}</span>
      <span data-testid="initialized">{String(context.initialized)}</span>
      <span data-testid="feature-enabled">{String(context.isFeatureEnabled('anything'))}</span>
      <span data-testid="replace-name">{context.replaceClientName('Hello Numa')}</span>
    </div>
  );
};

describe('BrandingContext default values', () => {
  it('provides sensible defaults without a provider', () => {
    render(<TestConsumer />);

    expect(screen.getByTestId('client-name').textContent).toBe('numa');
    expect(screen.getByTestId('branding-name').textContent).toBe('Numa');
    expect(screen.getByTestId('initialized').textContent).toBe('false');
    expect(screen.getByTestId('feature-enabled').textContent).toBe('false');
    expect(screen.getByTestId('replace-name').textContent).toBe('Hello Numa');
  });
});
