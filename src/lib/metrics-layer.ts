/**
 * OpenTelemetry Metrics Layer for Effect.
 *
 * Provides a Layer that exports Effect's Metric module data to
 * Prometheus via the OpenTelemetry SDK.
 *
 * Usage:
 *   import { MetricsLive } from "./lib/metrics-layer";
 *
 *   const program = myEffect.pipe(
 *     Effect.provide(MetricsLive)
 *   );
 */

import { Layer } from "effect";
import * as Metrics from "@effect/opentelemetry/Metrics";
import * as Resource from "@effect/opentelemetry/Resource";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";

// ============================================================================
// Constants
// ============================================================================

const METRICS_PORT = parseInt(process.env.METRICS_PORT ?? "9464", 10);

// ============================================================================
// Prometheus Exporter
// ============================================================================

/**
 * Create a Prometheus exporter that serves metrics at /metrics.
 */
const createPrometheusExporter = () =>
  new PrometheusExporter({
    port: METRICS_PORT,
    host: "0.0.0.0", // Bind to all interfaces for Docker
  });

// ============================================================================
// Metrics Layer
// ============================================================================

/**
 * Resource layer with service name.
 */
const ResourceLive = Resource.layer({
  serviceName: "coredrain",
  serviceVersion: "1.0.0",
});

/**
 * Metrics layer that exports to Prometheus.
 * This layer:
 * 1. Creates a Prometheus exporter on the configured port
 * 2. Registers Effect's MetricProducer with the exporter
 * 3. Serves metrics at http://localhost:METRICS_PORT/metrics
 */
export const MetricsLive = Metrics.layer(() => {
  console.log(`Prometheus metrics: http://localhost:${METRICS_PORT}/metrics`);
  return createPrometheusExporter();
}).pipe(Layer.provide(ResourceLive));
