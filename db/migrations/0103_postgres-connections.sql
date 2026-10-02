ALTER TABLE "tool_connections" DROP CONSTRAINT "tool_connections_kind_check";--> statement-breakpoint
ALTER TABLE "tool_connections" ALTER COLUMN "endpoint" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_connections" ALTER COLUMN "operations" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_connections" ADD COLUMN "postgres_config" jsonb;--> statement-breakpoint
ALTER TABLE "tool_connections" ADD CONSTRAINT "tool_connections_configuration_check" CHECK (
      CASE WHEN "tool_connections"."kind" IN ('mcp', 'openapi') THEN
        "tool_connections"."postgres_config" IS NULL AND "tool_connections"."endpoint" IS NOT NULL
        AND length("tool_connections"."endpoint") BETWEEN 1 AND 1000
        AND CASE WHEN jsonb_typeof("tool_connections"."operations") = 'array'
          THEN jsonb_array_length("tool_connections"."operations") BETWEEN 1 AND 100 ELSE false END
      WHEN "tool_connections"."kind" = 'postgres' THEN
        "tool_connections"."endpoint" IS NULL AND "tool_connections"."operations" IS NULL AND "tool_connections"."postgres_config" IS NOT NULL
        AND jsonb_typeof("tool_connections"."postgres_config") = 'object'
        AND "tool_connections"."postgres_config" ?& ARRAY['host', 'port', 'database', 'tls']
        AND ("tool_connections"."postgres_config" - ARRAY['host', 'port', 'database', 'tls']) = '{}'::jsonb
        AND jsonb_typeof("tool_connections"."postgres_config"->'host') = 'string'
        AND length("tool_connections"."postgres_config"->>'host') BETWEEN 1 AND 253
        AND ("tool_connections"."postgres_config"->>'host') ~ '^[a-z0-9.:-]+$'
        AND jsonb_typeof("tool_connections"."postgres_config"->'database') = 'string'
        AND octet_length("tool_connections"."postgres_config"->>'database') BETWEEN 1 AND 63
        AND jsonb_typeof("tool_connections"."postgres_config"->'tls') = 'string'
        AND "tool_connections"."postgres_config"->>'tls' = 'verify-full'
        AND CASE WHEN jsonb_typeof("tool_connections"."postgres_config"->'port') = 'number'
          THEN ("tool_connections"."postgres_config"->>'port')::numeric BETWEEN 1 AND 65535
            AND trunc(("tool_connections"."postgres_config"->>'port')::numeric) = ("tool_connections"."postgres_config"->>'port')::numeric
          ELSE false END
      ELSE false END
    );--> statement-breakpoint
ALTER TABLE "tool_connections" ADD CONSTRAINT "tool_connections_kind_check" CHECK ("tool_connections"."kind" IN ('mcp', 'openapi', 'postgres'));