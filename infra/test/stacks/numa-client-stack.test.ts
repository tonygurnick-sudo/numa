import { describe, it } from 'node:test';
import { UserConfigurableBaseNumaAppProps } from '../../constructs/apps/base-numa-app-construct';
import { appLibrary, getAppConfigsToDeploy } from '../../stacks/numa-client-stack';
import assert from 'node:assert';

describe('getAppConfigsToDeploy', () => {
  const reducedAppLibrary = Object.fromEntries(
    Object.entries(appLibrary).filter(([appId]) => {
      return ['document-summariser', 'financial-analysis', 'nzsba-policy-builder'].includes(appId);
    }),
  );
  const appConfigs: Record<string, UserConfigurableBaseNumaAppProps> = {
    'document-summariser': {
      s3KeyPrefix: 'foobar',
    },
  };
  it('Returns all apps when allApps is set', (): void => {
    const appConfigsToDeploy = getAppConfigsToDeploy(reducedAppLibrary, appConfigs, true, false);
    assert.deepEqual(
      appConfigsToDeploy.map(([appId, _]) => appId),
      ['document-summariser', 'financial-analysis', 'nzsba-policy-builder'],
    );
    assert.deepEqual(appConfigsToDeploy[0][1], { s3KeyPrefix: 'foobar' });
    assert.deepEqual(appConfigsToDeploy[1][1], {});
  });
  it('Returns all apps when allApps is set, even when allProdApps is set', (): void => {
    const appConfigsToDeploy = getAppConfigsToDeploy(reducedAppLibrary, appConfigs, true, true);
    assert.deepEqual(
      appConfigsToDeploy.map(([appId, _]) => appId),
      ['document-summariser', 'financial-analysis', 'nzsba-policy-builder'],
    );
    assert.deepEqual(appConfigsToDeploy[0][1], { s3KeyPrefix: 'foobar' });
    assert.deepEqual(appConfigsToDeploy[1][1], {});
  });
  it('Returns only production apps', (): void => {
    const appConfigsToDeploy = getAppConfigsToDeploy(reducedAppLibrary, appConfigs, false, true);
    assert.deepEqual(
      appConfigsToDeploy.map(([appId, _]) => appId),
      ['document-summariser', 'financial-analysis'],
    );
    assert.deepEqual(appConfigsToDeploy[0][1], { s3KeyPrefix: 'foobar' });
    assert.deepEqual(appConfigsToDeploy[1][1], {});
  });
  it('Returns configured apps', (): void => {
    const appConfigsToDeploy = getAppConfigsToDeploy(reducedAppLibrary, appConfigs, false, false);
    assert.deepEqual(
      appConfigsToDeploy.map(([appId, _]) => appId),
      ['document-summariser'],
    );
    assert.deepEqual(appConfigsToDeploy[0][1], { s3KeyPrefix: 'foobar' });
  });
});
