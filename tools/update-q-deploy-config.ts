import { getClientConfig, listClients, putClientConfig } from '@arcanumai/client-config';
import { ClientConfig, clientConfigSchema } from '../infra/stacks/numa-client-stack';
import { diff } from 'json-diff-ts';

interface UpdateSummary {
  clientName: string;
  hasQRequiredConnectors: boolean;
  currentProvisionQResources: boolean | undefined;
  newProvisionQResources: boolean;
  updated: boolean;
  qRequiredConnectors: string[];
}

/**
 * Checks if a client has connectors that require Q Business (SharePoint, Teams, or Box)
 */
function hasQRequiredConnectors(config: ClientConfig): { hasConnectors: boolean; connectors: string[] } {
  const connectors: string[] = [];

  if (config.sharePointConfigs && config.sharePointConfigs.length > 0) {
    connectors.push(`SharePoint (${config.sharePointConfigs.length} configs)`);
  }

  if (config.teamsConfigs && config.teamsConfigs.length > 0) {
    connectors.push(`Teams (${config.teamsConfigs.length} configs)`);
  }

  if (config.boxConfigs && config.boxConfigs.length > 0) {
    connectors.push(`Box (${config.boxConfigs.length} configs)`);
  }

  return {
    hasConnectors: connectors.length > 0,
    connectors,
  };
}

/**
 * Analyzes all clients and determines which ones need Q resources updated
 */
async function analyzeClients(): Promise<UpdateSummary[]> {
  console.log('📋 Retrieving client list...');
  const clients = await listClients();
  console.log(`Found ${clients.length} clients\n`);

  const summaries: UpdateSummary[] = [];

  for (const clientName of clients.sort()) {
    try {
      console.log(`🔍 Analyzing ${clientName}...`);
      const config = await getClientConfig<ClientConfig>(clientName, clientConfigSchema);

      const { hasConnectors, connectors } = hasQRequiredConnectors(config);
      const currentProvisionQResources = config.provisionQResources;

      let newProvisionQResources: boolean | undefined;
      if (hasConnectors) {
        newProvisionQResources = true;
      } else {
        if (currentProvisionQResources === false) {
          newProvisionQResources = false; // Keep explicit false
        } else {
          newProvisionQResources = undefined; // Use default
        }
      }

      const updated = currentProvisionQResources !== newProvisionQResources;

      summaries.push({
        clientName,
        hasQRequiredConnectors: hasConnectors,
        currentProvisionQResources,
        newProvisionQResources,
        updated,
        qRequiredConnectors: connectors,
      });

      const status = updated ? '🔄 NEEDS UPDATE' : '✅ NO CHANGE';
      const msConnectors = connectors.length > 0 ? connectors.join(', ') : 'None';
      console.log(`   Q-Required Connectors: ${msConnectors}`);
      console.log(
        `   Current Q Resources: ${currentProvisionQResources ?? 'undefined'} → New: ${newProvisionQResources}`,
      );
      console.log(`   Status: ${status}\n`);
    } catch (error) {
      console.error(`❌ Error analyzing ${clientName}:`, error);
      summaries.push({
        clientName,
        hasQRequiredConnectors: false,
        currentProvisionQResources: undefined,
        newProvisionQResources: false,
        updated: false,
        qRequiredConnectors: [],
      });
    }
  }

  return summaries;
}

/**
 * Updates a single client's configuration
 */
async function updateClientConfig(clientName: string, dryRun: boolean = false): Promise<boolean> {
  try {
    const config = await getClientConfig<ClientConfig>(clientName, clientConfigSchema);
    const { hasConnectors } = hasQRequiredConnectors(config);

    let newProvisionQResources: boolean | undefined;

    if (hasConnectors) {
      // Has Q-required connectors → set to true
      newProvisionQResources = true;
    } else {
      // No Q-required connectors → leave undefined unless already explicitly false
      if (config.provisionQResources === false) {
        newProvisionQResources = false; // Keep explicit false
      } else {
        newProvisionQResources = undefined; // Use default (don't set false)
      }
    }

    const updatedConfig = {
      ...config,
    };

    // Only set the property if it should be true or explicitly false
    if (newProvisionQResources !== undefined) {
      updatedConfig.provisionQResources = newProvisionQResources;
    } else {
      // Remove the property to make it undefined
      delete updatedConfig.provisionQResources;
    }

    const differences = diff(config, updatedConfig);
    if (differences.length === 0) {
      console.log(`   ✅ ${clientName}: No changes needed`);
      return false;
    }

    console.log(`   📝 ${clientName}: Changes to apply:`);
    console.log(
      `      provisionQResources: ${config.provisionQResources ?? 'undefined'} → ${newProvisionQResources ?? 'undefined'}`,
    );

    if (!dryRun) {
      await putClientConfig(clientName, updatedConfig, clientConfigSchema);
      console.log(`   ✅ ${clientName}: Successfully updated`);
    } else {
      console.log(`   🏃 ${clientName}: Dry run - no changes applied`);
    }

    return true;
  } catch (error) {
    console.error(`   ❌ ${clientName}: Error updating config:`, error);
    return false;
  }
}

/**
 * Main function to update Q resources based on Microsoft connectors
 */
async function main(options: { apply?: boolean; clients?: string[] } = {}): Promise<void> {
  const { apply = false, clients } = options;

  console.log('🚀 Updating Q Deploy Config');
  console.log('==========================\n');

  if (!apply) {
    console.log('🏃 DRY RUN MODE - No changes will be applied');
    console.log('   Use --apply to actually make changes\n');
  }

  // Analyze all clients first
  const summaries = await analyzeClients();

  // Filter to specific clients if provided
  const clientsToUpdate = clients ? summaries.filter((s) => clients.includes(s.clientName)) : summaries;

  const updatesNeeded = clientsToUpdate.filter((s) => s.updated);

  if (updatesNeeded.length === 0) {
    console.log('✅ No clients need Q deploy config updates');
    return;
  }

  // Print summary
  console.log('\n📊 UPDATE SUMMARY');
  console.log('=================');
  console.log(`Total clients analyzed: ${clientsToUpdate.length}`);
  console.log(`Clients needing updates: ${updatesNeeded.length}`);

  // Show detailed breakdown
  console.log('📋 CLIENTS TO UPDATE:');
  updatesNeeded.forEach((summary) => {
    const connectors = summary.qRequiredConnectors.join(', ') || 'None';
    console.log(`   • ${summary.clientName}`);
    console.log(`     Q-Required Connectors: ${connectors}`);
    console.log(
      `     Q Resources: ${summary.currentProvisionQResources ?? 'undefined'} → ${summary.newProvisionQResources}`,
    );
  });

  // Apply updates
  console.log('\n🔄 APPLYING UPDATES');
  console.log('===================');

  let successCount = 0;
  let errorCount = 0;

  for (const summary of updatesNeeded) {
    const success = await updateClientConfig(summary.clientName, !apply);
    if (success) {
      successCount++;
    } else {
      errorCount++;
    }
  }

  console.log('\n📈 FINAL RESULTS');
  console.log('================');
  console.log(`✅ Successfully updated: ${successCount}`);
  console.log(`❌ Errors: ${errorCount}`);

  if (!apply) {
    console.log('\n🏃 This was a dry run. Use --apply to actually make changes.');
  }
}

// CLI handling
if (import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  // Extract client names (arguments that don't start with --)
  const clients = args.filter((arg) => !arg.startsWith('--'));

  main({
    apply,
    clients: clients.length > 0 ? clients : undefined,
  })
    .then(() => {
      console.log('✅ Update process completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Update process failed:', error);
      process.exit(1);
    });
}

export { main as updateQResourcesForMicrosoftConnectors };
