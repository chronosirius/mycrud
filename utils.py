import pymysql
from pymysql.cursors import DictCursor
import config

def get_table_schema(username, password, table_name):
    """Get the schema for a table"""
    conn = pymysql.connect(
        host=config.DB_HOST,
        user=username,
        password=password,
        database=config.DB_NAME,
        port=config.DB_PORT,
        cursorclass=DictCursor
    )
    
    try:
        with conn.cursor() as cursor:
            # Get column information
            cursor.execute(f"DESCRIBE {table_name}")
            columns = cursor.fetchall()
            
            # Get ENUM values for ENUM columns
            for col in columns:
                if col['Type'].startswith('enum'):
                    # Parse enum values
                    enum_str = col['Type'][5:-1]  # Remove 'enum(' and ')'
                    col['enum_values'] = [v.strip("'") for v in enum_str.split(',')]
            
            return {
                'columns': columns,
                'table_name': table_name
            }
    finally:
        conn.close()

def format_value_for_display(value, column_type):
    """Format a value for display based on column type"""
    if value is None:
        return ''
    
    if column_type.startswith('enum'):
        return value
    
    return str(value)

def parse_form_value(value, column_type):
    """Parse a form value to the correct Python type"""
    if value == '' or value is None:
        return None
    
    if column_type.startswith('int'):
        return int(value)
    elif column_type.startswith('decimal') or column_type.startswith('float') or column_type.startswith('double'):
        return float(value)
    elif column_type.startswith('tinyint(1)'):  # Boolean
        return bool(int(value))
    else:
        return value

def parse_row_id(primary_keys, row_id):
    """Parse a row ID string into components for composite keys"""
    if isinstance(primary_keys, list):
        return row_id.split('/')
    else:
        return row_id

def build_where_clause(primary_keys, row_id):
    """Build a WHERE clause for primary key(s)"""
    if isinstance(primary_keys, list):
        row_id_values = parse_row_id(primary_keys, row_id)
        where_parts = [f"{pk} = %s" for pk in primary_keys]
        return ' AND '.join(where_parts), row_id_values
    else:
        return f"{primary_keys} = %s", [row_id]

def get_step_for_decimal(column_type):
    """Get the step value for a decimal input based on column definition"""
    if 'decimal' in column_type.lower():
        # Extract precision from decimal(10,2) format
        parts = column_type.split('(')[1].split(')')[0].split(',')
        if len(parts) > 1:
            decimal_places = int(parts[1])
            return 10 ** (-decimal_places)
    return 0.01