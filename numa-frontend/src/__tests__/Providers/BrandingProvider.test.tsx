/**
 * @vitest-environment jsdom
 */
import React, { useContext } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { BrandingProvider as BrandingProviderComponent } from '../../Providers/BrandingProvider';
import { BrandingContext } from '../../Providers/BrandingContext';
import { brandingService } from '../../Services/BrandingService';

const TestConsumer = () => {
  const context = useContext(BrandingContext);
  return (
    <div>
      <span data-testid="client-name">{context.clientName}</span>
      <span data-testid="branding-name">{context.branding.name}</span>
      <span data-testid="initialized">{String(context.initialized)}</span>
      <span data-testid="feature">{String(context.isFeatureEnabled('sample'))}</span>
    </div>
  );
};

describe('BrandingProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(brandingService, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(brandingService, 'getClientName').mockReturnValue('acme');
    vi.spyOn(brandingService, 'getBranding').mockReturnValue({
      name: 'Acme Inc.',
      logo: '/acme-logo.svg',
      colors: {
        primary: '#123456',
        secondary: '#654321',
        hover: '#abcdef',
      },
    });
    vi.spyOn(brandingService, 'isFeatureEnabled').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes branding service and provides context values', async () => {
    render(
      <BrandingProviderComponent>
        <TestConsumer />
      </BrandingProviderComponent>
    );

    await waitFor(() => {
      expect(screen.getByTestId('client-name')).toHaveTextContent('acme');
    });

    expect(screen.getByTestId('branding-name')).toHaveTextContent('Acme Inc.');
    expect(screen.getByTestId('initialized')).toHaveTextContent('true');
    expect(screen.getByTestId('feature')).toHaveTextContent('true');
    expect(brandingService.initialize).toHaveBeenCalledTimes(1);
  });
});
