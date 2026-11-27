#!/usr/bin/env bash
# Aplica as migrations num Postgres limpo e roda os testes de comportamento.
# Uso: PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
DB="${TEST_DB:-jslh_test}"
psql -q -X -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
P="psql -q -X -v ON_ERROR_STOP=1 -d $DB"
$P -f "$DIR/00_supabase_stub.sql"
for f in "$DIR"/../migrations/*.sql; do $P -f "$f"; done
$P -f "$DIR/01_behaviour.sql"
$P -f "$DIR/02_my_operation.sql"
$P -f "$DIR/03_business_digital_twin.sql"
echo "OK: todos os testes SQL passaram"
