-- Synapse's persistent PostgreSQL sequence keeps transaction IDs unique across
-- restarts. SQLite derives them from unacknowledged rows and can reuse IDs.
SELECT 'CREATE ROLE synapse_runtime LOGIN PASSWORD ''synthetic-matrix'''
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'synapse_runtime')
\gexec

SELECT 'CREATE DATABASE synapse_runtime OWNER synapse_runtime ENCODING ''UTF8'' LC_COLLATE ''C'' LC_CTYPE ''C'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'synapse_runtime')
\gexec
