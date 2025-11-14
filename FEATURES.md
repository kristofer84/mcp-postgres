# MCP Database Server - Feature List

## Complete CRUD Operations

### query_data (Read)
- Execute SELECT queries safely
- Returns rows and row count
- Includes execution time

### insert_data (Create)
- Insert new rows into tables
- Returns inserted data
- Includes execution time

### update_data (Update)
- Update rows with WHERE conditions
- **dry_run**: Preview changes before executing
- **limit**: Safety limit on rows affected (default: 1000, max: 10000)
- Returns updated rows and execution time

### delete_data (Delete)
- Delete rows with WHERE conditions
- **dry_run**: Preview what would be deleted
- **limit**: Safety limit on rows affected (default: 1000, max: 10000)
- Returns deleted rows and execution time

## Power User Tools

### execute_raw_query
- Execute any SQL query (INSERT, UPDATE, DELETE, DDL)
- Supports parameterized queries
- Returns command type, rows, and execution time
- Use with caution!

## Schema Management

### create_table
- Create new tables with column definitions
- Supports: primary keys, unique constraints, nullable, defaults
- Returns the generated CREATE TABLE query

### alter_table
- Modify existing table structures
- Actions:
  - `add_column`: Add new column with type and constraints
  - `drop_column`: Remove a column
  - `rename_column`: Rename a column
  - `alter_column_type`: Change column data type
- Returns the generated ALTER TABLE query

### get_relationships
- View foreign key relationships
- Optional: filter by specific table
- Shows constraint names and related tables/columns

## Convenience Tools

### count_rows
- Quick row count with optional WHERE conditions
- Much faster than SELECT COUNT(*)
- Includes execution time

### table_exists
- Check if a table exists
- Returns boolean

### column_exists
- Check if a column exists in a table
- Returns boolean

## Existing Tools (Enhanced)

### get_schema
- Get database schema information
- Optional: filter by table name

### list_tables
- List all tables in the database
- Shows table types

### describe_table
- Detailed table information
- Includes columns, indexes, and constraints

### get_table_sample
- Get sample rows from a table
- Configurable limit (default: 10, max: 100)

## Monitoring & Performance

### get_connection_status
- Database connection status
- Connection details (host, port, database, user)
- SSL status
- Database size (bytes and MB)
- Active connections count
- PostgreSQL version

### check_certificate_cache
- AWS RDS certificate cache status
- Certificate age and expiration
- Cache location

## Safety Features

1. **Dry Run Mode**: Preview UPDATE and DELETE operations before executing
2. **Row Limits**: Configurable safety limits on bulk operations
3. **Execution Timing**: All operations report execution time
4. **Parameterized Queries**: Protection against SQL injection
5. **Table Name Sanitization**: Prevents SQL injection via table names
6. **Connection Monitoring**: Auto-reconnect on connection loss

## Total Tools: 17

1. get_schema
2. query_data
3. list_tables
4. describe_table
5. get_table_sample
6. check_certificate_cache
7. update_data
8. delete_data
9. insert_data
10. execute_raw_query
11. count_rows
12. table_exists
13. column_exists
14. get_relationships
15. create_table
16. alter_table
17. get_connection_status
