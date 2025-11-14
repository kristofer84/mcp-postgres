# Testing the MCP Database Server

## Prerequisites

1. PostgreSQL running on localhost:5432
2. A database named `test` created
3. User `postgres` with password `postgres` (or update the test script)

## Create Test Database

```bash
# Using psql
psql -U postgres -c "CREATE DATABASE test;"

# Or using createdb
createdb -U postgres test
```

## Run Tests

```bash
node test-tools.mjs
```

## What Gets Tested

The test suite covers all 17 tools with 20 test cases:

1. ✅ get_connection_status - Verify database connection
2. ✅ create_table - Create test_users table
3. ✅ table_exists - Check if table exists
4. ✅ column_exists - Check if column exists
5. ✅ list_tables - List all tables
6. ✅ describe_table - Get table details
7. ✅ get_schema - Get schema information
8. ✅ insert_data - Insert test records
9. ✅ count_rows - Count all rows
10. ✅ count_rows (with WHERE) - Count filtered rows
11. ✅ query_data - Execute SELECT query
12. ✅ get_table_sample - Get sample rows
13. ✅ update_data (dry_run) - Preview update
14. ✅ update_data - Update records
15. ✅ alter_table - Add column
16. ✅ execute_raw_query - Execute raw SQL
17. ✅ get_relationships - Get foreign keys
18. ✅ delete_data (dry_run) - Preview delete
19. ✅ delete_data - Delete records
20. ✅ check_certificate_cache - Check cert status

## Test Data

The tests create:
- `test_users` table with sample data
- `test_orders` table with foreign key relationship

All test data is cleaned up automatically after tests complete.

## Customize Database Connection

Edit the `test-tools.mjs` file and modify the environment variables:

```javascript
env: {
  DB_HOST: "localhost",
  DB_PORT: "5432",
  DB_USER: "postgres",
  DB_PASSWORD: "postgres",
  DB_NAME: "test",
}
```
