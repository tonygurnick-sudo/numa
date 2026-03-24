import { HoneycombWebSDK } from '@honeycombio/opentelemetry-web';
import { getWebAutoInstrumentations } from '@opentelemetry/auto-instrumentations-web';
import { StackContextManager } from '@opentelemetry/sdk-trace-web';

const defaults = {
  ignoreNetworkEvents: true,
  propagateTraceHeaderCorsUrls: [/.*/g],
};

export default function installOpenTelemetry(apiKey) {
  try {
    const sdk = new HoneycombWebSDK({
      contextManager: new StackContextManager(),
      apiKey,
      serviceName: 'numa-frontend',
      instrumentations: [
        getWebAutoInstrumentations({
          '@opentelemetry/instrumentation-xml-http-request': defaults,
          '@opentelemetry/instrumentation-fetch': defaults,
          '@opentelemetry/instrumentation-document-load': defaults,
          '@opentelemetry/instrumentation-user-interaction': defaults,
        }),
      ],
    });

    sdk.start();
  } catch (e) {
    console.error(`An error occurred wiring up Honeycomb...`);
    console.error(e);
  }
}
