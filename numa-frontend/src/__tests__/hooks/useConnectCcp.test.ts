import { describe, it, expect, beforeEach } from 'vitest';
import { getCcpUrl, getConnectRegion } from '../../hooks/useConnectCcp';

describe('getCcpUrl', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('returns null when CONNECT_INSTANCE_URL is unset', () => {
    expect(getCcpUrl()).toBeNull();
  });

  it('treats empty / whitespace as not-configured (config.json emits "")', () => {
    window.sessionStorage.setItem('CONNECT_INSTANCE_URL', '');
    expect(getCcpUrl()).toBeNull();
    window.sessionStorage.setItem('CONNECT_INSTANCE_URL', '   ');
    expect(getCcpUrl()).toBeNull();
  });

  it('builds the ccp-v2 URL, tolerating a trailing slash', () => {
    window.sessionStorage.setItem('CONNECT_INSTANCE_URL', 'https://numa-x.my.connect.aws');
    expect(getCcpUrl()).toBe('https://numa-x.my.connect.aws/ccp-v2/');
    window.sessionStorage.setItem('CONNECT_INSTANCE_URL', 'https://numa-x.my.connect.aws///');
    expect(getCcpUrl()).toBe('https://numa-x.my.connect.aws/ccp-v2/');
  });
});

describe('getConnectRegion', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('defaults to ap-southeast-2', () => {
    expect(getConnectRegion()).toBe('ap-southeast-2');
  });

  it('honours an explicit CONNECT_REGION override', () => {
    window.sessionStorage.setItem('CONNECT_REGION', 'us-east-1');
    expect(getConnectRegion()).toBe('us-east-1');
  });
});
