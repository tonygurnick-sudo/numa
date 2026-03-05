import { describe, it } from 'node:test';
import { UserConfigurableBaseNumaAppProps } from '../../constructs/apps/base-numa-app-construct';
import { appLibrary, getAppConfigsToDeploy } from '../../stacks/numa-client-stack';
import assert from 'node:assert';

describe('getAppConfigsToDeploy', () => {
  const reducedAppLibrary = Object.fromEntries(
    Object.entries(appLibrary).filter(([appId]) => {
      return ['document-summariser', 'financial-analysis', 'nzsba-policy-builder'].includes(appId);
    })
  );
  const appConfigs: Record<string, UserConfigurableBaseNumaAppProps> = {
    'document-summariser': {
      s3KeyPrefix: 'foobar',
    },
  };
  it('Returns all apps when allApps is set', (): void => {
    const appConfigsToDeploy = getAppConfigsToDeploy(reducedAppLibrary, appConfigs, true, false, false);
    assert.deepEqual(
      appConfigsToDeploy.map(([appId, _]) => appId),
      ['document-summariser', 'financial-analysis', 'nzsba-policy-builder']
    );
    assert.deepEqual(appConfigsToDeploy[0][1], { s3KeyPrefix: 'foobar' });
    assert.deepEqual(appConfigsToDeploy[1][1], {});
  });
  it('Returns all apps when allApps is set, even when allProdApps is set', (): void => {
    const appConfigsToDeploy = getAppConfigsToDeploy(reducedAppLibrary, appConfigs, true, true, false);
    assert.deepEqual(
      appConfigsToDeploy.map(([appId, _]) => appId),
      ['document-summariser', 'financial-analysis', 'nzsba-policy-builder']
    );
    assert.deepEqual(appConfigsToDeploy[0][1], { s3KeyPrefix: 'foobar' });
    assert.deepEqual(appConfigsToDeploy[1][1], {});
  });
  it('Returns only production apps', (): void => {
    const appConfigsToDeploy = getAppConfigsToDeploy(reducedAppLibrary, appConfigs, false, true, false);
    assert.deepEqual(
      appConfigsToDeploy.map(([appId, _]) => appId),
      ['document-summariser', 'financial-analysis']
    );
    assert.deepEqual(appConfigsToDeploy[0][1], { s3KeyPrefix: 'foobar' });
    assert.deepEqual(appConfigsToDeploy[1][1], {});
  });
  it('Returns configured apps', (): void => {
    const appConfigsToDeploy = getAppConfigsToDeploy(reducedAppLibrary, appConfigs, false, false, false);
    assert.deepEqual(
      appConfigsToDeploy.map(([appId, _]) => appId),
      ['document-summariser']
    );
    assert.deepEqual(appConfigsToDeploy[0][1], { s3KeyPrefix: 'foobar' });
  });
  it('Includes dev-only apps when isDevInstance is true', (): void => {
    const appConfigsToDeploy = getAppConfigsToDeploy(reducedAppLibrary, appConfigs, false, false, true);
    assert.deepEqual(
      appConfigsToDeploy.map(([appId, _]) => appId),
      ['document-summariser', 'e2e-test']
    );
    assert.deepEqual(appConfigsToDeploy[0][1], { s3KeyPrefix: 'foobar' });
    assert.deepEqual(appConfigsToDeploy[1][1], {});
  });
  it('Merges production apps and apps', (): void => {
    const specificAppConfigs: Record<string, UserConfigurableBaseNumaAppProps> = {
      'nzsba-policy-builder': {
        s3KeyPrefix: 'foobar',
      },
    };
    const appConfigsToDeploy = getAppConfigsToDeploy(reducedAppLibrary, specificAppConfigs, false, true, false);
    assert.deepEqual(
      appConfigsToDeploy.map(([appId, _]) => appId),
      ['document-summariser', 'financial-analysis', 'nzsba-policy-builder']
    );
    assert.deepEqual(appConfigsToDeploy[0][1], {});
    assert.deepEqual(appConfigsToDeploy[1][1], {});
    assert.deepEqual(appConfigsToDeploy[2][1], { s3KeyPrefix: 'foobar' });
  });
});
