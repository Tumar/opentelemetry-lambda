import { metrics } from '@opentelemetry/api';
import { NodeTracerConfig, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SDKRegistrationConfig,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { Instrumentation, registerInstrumentations } from '@opentelemetry/instrumentation';
import { awsLambdaDetector } from '@opentelemetry/resource-detector-aws';
import {
  detectResourcesSync,
  envDetector,
  processDetector,
} from '@opentelemetry/resources';
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk';
import { AwsLambdaInstrumentation } from '@opentelemetry/instrumentation-aws-lambda';
import {
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
} from "@opentelemetry/api";
import { getEnv } from '@opentelemetry/core';
import { AwsLambdaInstrumentationConfig } from '@opentelemetry/instrumentation-aws-lambda';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { ConsoleMetricExporter, MeterProvider, MeterProviderOptions, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';

function defaultConfigureInstrumentations() {
  // Use require statements for instrumentation to avoid having to have transitive dependencies on all the typescript
  // definitions.
  const { DnsInstrumentation } = require('@opentelemetry/instrumentation-dns');
  const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
  const { GraphQLInstrumentation } = require('@opentelemetry/instrumentation-graphql');
  const { GrpcInstrumentation } = require('@opentelemetry/instrumentation-grpc');
  const { HapiInstrumentation } = require('@opentelemetry/instrumentation-hapi');
  const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
  const { IORedisInstrumentation } = require('@opentelemetry/instrumentation-ioredis');
  const { KoaInstrumentation } = require('@opentelemetry/instrumentation-koa');
  const { MongoDBInstrumentation } = require('@opentelemetry/instrumentation-mongodb');
  const { MySQLInstrumentation } = require('@opentelemetry/instrumentation-mysql');
  const { NetInstrumentation } = require('@opentelemetry/instrumentation-net');
  const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');
  const { RedisInstrumentation } = require('@opentelemetry/instrumentation-redis');
  return [  new DnsInstrumentation(),
    new ExpressInstrumentation(),
    new GraphQLInstrumentation(),
    new GrpcInstrumentation(),
    new HapiInstrumentation(),
    new HttpInstrumentation(),
    new IORedisInstrumentation(),
    new KoaInstrumentation(),
    new MongoDBInstrumentation(),
    new MySQLInstrumentation(),
    new NetInstrumentation(),
    new PgInstrumentation(),
    new RedisInstrumentation(),
  ]
}

declare global {
  // in case of downstream configuring span processors etc
  function configureTracerProvider(tracerProvider: NodeTracerProvider): void
  function configureTracer(defaultConfig: NodeTracerConfig): NodeTracerConfig;
  function configureSdkRegistration(
    defaultSdkRegistration: SDKRegistrationConfig
  ): SDKRegistrationConfig;
  function configureMeter(defaultConfig: MeterProviderOptions): MeterProviderOptions;
  function configureMeterProvider(meterProvider: MeterProvider): void
  function configureLambdaInstrumentation(config: AwsLambdaInstrumentationConfig): AwsLambdaInstrumentationConfig
  function configureInstrumentations(): Instrumentation[]
}

console.log('Registering OpenTelemetry');

const instrumentations = [
  new AwsInstrumentation({
    suppressInternalInstrumentation: true,
  }),
  new AwsLambdaInstrumentation(typeof configureLambdaInstrumentation === 'function' ? configureLambdaInstrumentation({}) : {}),
  ...(typeof configureInstrumentations === 'function' ? configureInstrumentations: defaultConfigureInstrumentations)()
];

// configure lambda logging
const logLevel = getEnv().OTEL_LOG_LEVEL
diag.setLogger(new DiagConsoleLogger(), logLevel)

// Register instrumentations synchronously to ensure code is patched even before provider is ready.
registerInstrumentations({
  instrumentations,
});

async function initializeProvider() {
  const resource = detectResourcesSync({
    detectors: [awsLambdaDetector, envDetector, processDetector],
  });

  let config: NodeTracerConfig = {
    resource,
  };
  if (typeof configureTracer === 'function') {
    config = configureTracer(config);
  }

  const tracerProvider = new NodeTracerProvider(config);
  if (typeof configureTracerProvider === 'function') {
    configureTracerProvider(tracerProvider)
  } else {
    // defaults
    tracerProvider.addSpanProcessor(
      new BatchSpanProcessor(new OTLPTraceExporter())
    );
  }
  // logging for debug
  if (logLevel === DiagLogLevel.DEBUG) {
    tracerProvider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  let sdkRegistrationConfig: SDKRegistrationConfig = {};
  if (typeof configureSdkRegistration === 'function') {
    sdkRegistrationConfig = configureSdkRegistration(sdkRegistrationConfig);
  }
  tracerProvider.register(sdkRegistrationConfig);

  // Configure default meter provider (doesn't export metrics)
  let meterConfig: MeterProviderOptions = {
    resource,
  }
  if (typeof configureMeter === 'function') {
    meterConfig = configureMeter(meterConfig);
  }

  const consoleMetricReader = new PeriodicExportingMetricReader({
    exporter: new ConsoleMetricExporter(),

    // Default is 60000ms (60 seconds). Set to 3 seconds for demonstrative purposes only.
    exportIntervalMillis: 3000,
  });
  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: 'http://localhost:4317',
    }),

    // Default is 60000ms (60 seconds). Set to 3 seconds for demonstrative purposes only.
    exportIntervalMillis: 3000,
  });
  const meterProvider = new MeterProvider(meterConfig);
  if (typeof configureMeterProvider === 'function') {
    configureMeterProvider(meterProvider)
  }

  meterProvider.addMetricReader(consoleMetricReader);
  meterProvider.addMetricReader(metricReader);
  metrics.setGlobalMeterProvider(meterProvider);

  // Re-register instrumentation with initialized provider. Patched code will see the update.
  registerInstrumentations({
    instrumentations,
    tracerProvider,
    meterProvider
  });
}
initializeProvider();
