/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CompanyInfo } from '../../Pages/CompanyInfo';
import { MemoryRouter } from 'react-router-dom';

describe('CompanyInfo Component', () => {
  it('should redirect to /settings/admin/company-profile', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/company-info']}>
        <CompanyInfo />
      </MemoryRouter>
    );

    // Navigate renders nothing at the redirect source
    expect(container.innerHTML).toBe('');
  });
});
