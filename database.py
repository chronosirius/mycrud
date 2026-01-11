import pymysql
from pymysql.cursors import DictCursor
import config
from utils import parse_row_id, build_where_clause
import json

class DatabaseManager:
    def get_connection(self, username, password):
        """Create a database connection with user credentials"""
        return pymysql.connect(
            host=config.DB_HOST,
            user=username,
            password=password,
            database=config.DB_NAME,
            port=config.DB_PORT,
            cursorclass=DictCursor
        )
    
    def get_rows(self, username, password, table_name, page=1, per_page=50, search=None):
        """Get paginated rows from a table"""
        conn = self.get_connection(username, password)
        try:
            with conn.cursor() as cursor:
                write_only_config = config.WRITE_ONLY_CONFIG.get(table_name)
                
                # Use user-specific view for write-only tables
                query_table = f"{table_name}_view_{username}" if write_only_config else table_name
                
                where_parts = []
                params = []
                
                if search:
                    for col, value in search.items():
                        if value:
                            # Check if this is an exact match search (for enums)
                            if value.startswith('===EXACT==='):
                                actual_value = value.replace('===EXACT===', '')
                                where_parts.append(f"{col} = %s")
                                params.append(actual_value)
                            else:
                                where_parts.append(f"{col} LIKE %s")
                                params.append(f"%{value}%")
                
                where_clause = "WHERE " + " AND ".join(where_parts) if where_parts else ""
                
                count_sql = f"SELECT COUNT(*) as total FROM {query_table} {where_clause}"
                cursor.execute(count_sql, params)
                total = cursor.fetchone()['total']
                
                if per_page:
                    offset = (page - 1) * per_page
                    limit_clause = f"LIMIT {per_page} OFFSET {offset}"
                else:
                    limit_clause = ""
                
                sql = f"SELECT * FROM {query_table} {where_clause} {limit_clause}"
                cursor.execute(sql, params)
                rows = cursor.fetchall()
                
                # Add metadata for each row
                for row in rows:
                    if write_only_config:
                        contributor_col = write_only_config['contributor_column']
                        owner_col = write_only_config['owner_column']
                        
                        contributors_json = row.get(contributor_col, '[]')
                        if isinstance(contributors_json, str):
                            contributors = json.loads(contributors_json)
                        else:
                            contributors = contributors_json if contributors_json else []
                        
                        owner = row.get(owner_col)
                        row['_is_owner'] = (owner == username)
                        row['_can_add_contributors'] = row['_is_owner']
                        row['_contributors'] = contributors
                
                # Get M2M relations
                m2m_config = config.MANY_TO_MANY_CONFIG.get(table_name, [])
                for row in rows:
                    row['_m2m_data'] = {}
                    for m2m in m2m_config:
                        relation_data = self._get_m2m_for_row(cursor, table_name, row, m2m)
                        relation_name = m2m.get('name', m2m['other_table'])
                        row['_m2m_data'][relation_name] = relation_data
                
                return {
                    'rows': rows,
                    'total': total,
                    'page': page,
                    'per_page': per_page,
                    'pages': (total + per_page - 1) // per_page if per_page else 1
                }
        finally:
            conn.close()
    
    def _get_m2m_for_row(self, cursor, table_name, row, m2m_config):
        """Get many-to-many relations for a single row"""
        primary_keys = config.PRIMARY_KEYS[table_name]
        if not isinstance(primary_keys, list):
            primary_keys = [primary_keys]
        
        # Build WHERE clause for the junction table
        where_parts = []
        params = []
        for pk in primary_keys:
            where_parts.append(f"j.{m2m_config['fk_self']} = %s")
            params.append(row[pk])
        
        # Build SELECT columns
        display_cols = m2m_config.get('display_columns', [m2m_config['other_display_column']])
        select_cols = [f"t.{col}" for col in display_cols]
        
        # Get the primary key of the other table
        other_table_pk = config.PRIMARY_KEYS.get(m2m_config['other_table'])
        if isinstance(other_table_pk, list):
            other_table_pk = other_table_pk[0]  # Use first key if composite
        
        select_cols.append(f"t.{other_table_pk} as related_id")
        
        # Add extra columns
        extra_cols = m2m_config.get('extra_columns', [])
        for col in extra_cols:
            select_cols.append(f"j.{col}")
        
        sql = f"""
            SELECT {', '.join(select_cols)}
            FROM {m2m_config['junction_table']} j
            JOIN {m2m_config['other_table']} t ON j.{m2m_config['fk_other']} = t.{other_table_pk}
            WHERE {' AND '.join(where_parts)}
        """
        
        cursor.execute(sql, params)
        return cursor.fetchall()
    
    def get_row(self, username, password, table_name, row_id):
        """Get a single row by ID"""
        conn = self.get_connection(username, password)
        try:
            with conn.cursor() as cursor:
                write_only_config = config.WRITE_ONLY_CONFIG.get(table_name)
                query_table = f"{table_name}_view_{username}" if write_only_config else table_name
                
                primary_keys = config.PRIMARY_KEYS[table_name]
                where_clause, params = build_where_clause(primary_keys, row_id)
                
                sql = f"SELECT * FROM {query_table} WHERE {where_clause}"
                cursor.execute(sql, params)
                row = cursor.fetchone()
                
                if write_only_config and row:
                    contributor_col = write_only_config['contributor_column']
                    owner_col = write_only_config['owner_column']
                    
                    contributors_json = row.get(contributor_col, '[]')
                    if isinstance(contributors_json, str):
                        contributors = json.loads(contributors_json)
                    else:
                        contributors = contributors_json if contributors_json else []
                    
                    owner = row.get(owner_col)
                    row['_is_owner'] = (owner == username)
                    row['_can_add_contributors'] = row['_is_owner']
                    row['_contributors'] = contributors
                
                return row
        finally:
            conn.close()
    
    def insert_row(self, username, password, table_name, data):
        conn = self.get_connection(username, password)
        try:
            with conn.cursor() as cursor:
                write_only_config = config.WRITE_ONLY_CONFIG.get(table_name)
                
                # NO duplicate check needed - each user has their own view!
                
                if write_only_config:
                    owner_col = write_only_config['owner_column']
                    contributor_col = write_only_config['contributor_column']
                    data[owner_col] = username
                    data[contributor_col] = json.dumps([username])
                
                data = self._apply_constraints(table_name, data)
                
                columns = list(data.keys())
                values = [data[col] for col in columns]
                placeholders = ', '.join(['%s'] * len(columns))
                
                # Insert directly into base table (view is read-only)
                sql = f"INSERT INTO {table_name} ({', '.join(columns)}) VALUES ({placeholders})"
                cursor.execute(sql, values)
                conn.commit()
                
                if cursor.lastrowid:
                    row_id = cursor.lastrowid
                else:
                    primary_keys = config.PRIMARY_KEYS[table_name]
                    if isinstance(primary_keys, list):
                        row_id = '/'.join([str(data[pk]) for pk in primary_keys])
                    else:
                        row_id = data[primary_keys]
                
                return {'success': True, 'id': row_id}
        except pymysql.IntegrityError as e:
            return {'success': False, 'error': f'Database error: {str(e)}'}
        finally:
            conn.close()
    
    def update_row(self, username, password, table_name, row_id, data):
        """Update an existing row"""
        conn = self.get_connection(username, password)
        try:
            with conn.cursor() as cursor:
                write_only_config = config.WRITE_ONLY_CONFIG.get(table_name)
                if write_only_config:
                    # Verify access via view
                    query_table = f"{table_name}_view_{username}"
                    primary_keys = config.PRIMARY_KEYS[table_name]
                    where_clause, where_params = build_where_clause(primary_keys, row_id)
                    
                    check_sql = f"SELECT * FROM {query_table} WHERE {where_clause}"
                    cursor.execute(check_sql, where_params)
                    current_row = cursor.fetchone()
                    
                    if not current_row:
                        return {'success': False, 'error': 'Record not found or access denied'}
                    
                    contributor_col = write_only_config['contributor_column']
                    owner_col = write_only_config['owner_column']
                    
                    contributors_json = current_row.get(contributor_col, '[]')
                    if isinstance(contributors_json, str):
                        contributors = json.loads(contributors_json)
                    else:
                        contributors = contributors_json if contributors_json else []
                    
                    if username not in contributors:
                        return {'success': False, 'error': 'Access denied'}
                    
                    owner = current_row.get(owner_col)
                    is_owner = (owner == username)
                    if contributor_col in data and not is_owner:
                        del data[contributor_col]
                    
                    if owner_col in data:
                        del data[owner_col]
                
                read_only = config.READ_ONLY_COLUMNS.get(table_name, [])
                primary_keys = config.PRIMARY_KEYS[table_name]
                if not isinstance(primary_keys, list):
                    primary_keys = [primary_keys]
                
                for col in list(data.keys()):
                    if col in read_only or col in primary_keys:
                        del data[col]
                
                data = self._apply_constraints(table_name, data)
                
                set_parts = [f"{col} = %s" for col in data.keys()]
                values = list(data.values())
                
                where_clause, where_params = build_where_clause(primary_keys, row_id)
                values.extend(where_params)
                
                # Update base table directly
                sql = f"UPDATE {table_name} SET {', '.join(set_parts)} WHERE {where_clause}"
                cursor.execute(sql, values)
                conn.commit()
                
                return {'success': True}
        finally:
            conn.close()

    def delete_row(self, username, password, table_name, row_id):
        """Delete a row"""
        conn = self.get_connection(username, password)
        try:
            with conn.cursor() as cursor:
                write_only_config = config.WRITE_ONLY_CONFIG.get(table_name)
                if write_only_config:
                    # Verify ownership via view
                    query_table = f"{table_name}_view_{username}"
                    primary_keys = config.PRIMARY_KEYS[table_name]
                    where_clause, where_params = build_where_clause(primary_keys, row_id)
                    
                    check_sql = f"SELECT * FROM {query_table} WHERE {where_clause}"
                    cursor.execute(check_sql, where_params)
                    current_row = cursor.fetchone()
                    
                    if not current_row:
                        return {'success': False, 'error': 'Record not found'}
                    
                    owner_col = write_only_config['owner_column']
                    owner = current_row.get(owner_col)
                    
                    if owner != username:
                        return {'success': False, 'error': 'Only owner can delete'}
                
                primary_keys = config.PRIMARY_KEYS[table_name]
                where_clause, params = build_where_clause(primary_keys, row_id)
                
                # Delete from base table
                sql = f"DELETE FROM {table_name} WHERE {where_clause}"
                cursor.execute(sql, params)
                conn.commit()
                
                return {'success': True}
        finally:
            conn.close()
    
    def search_table(self, username, password, table_name, query, columns):
        """Search a table"""
        conn = self.get_connection(username, password)
        try:
            with conn.cursor() as cursor:
                where_parts = []
                params = []
                
                for col in columns:
                    where_parts.append(f"{col} LIKE %s")
                    params.append(f"%{query}%")
                
                where_clause = ' OR '.join(where_parts)
                
                sql = f"SELECT * FROM {table_name} WHERE {where_clause} LIMIT 50"
                cursor.execute(sql, params)
                return cursor.fetchall()
        finally:
            conn.close()
    
    def get_m2m_relations(self, username, password, table_name, row_id, relation_name):
        """Get many-to-many relations for a row"""
        conn = self.get_connection(username, password)
        try:
            with conn.cursor() as cursor:
                # Find the m2m config
                m2m_configs = config.MANY_TO_MANY_CONFIG.get(table_name, [])
                m2m_config = None
                for m2m in m2m_configs:
                    if m2m.get('name', m2m['other_table']) == relation_name:
                        m2m_config = m2m
                        break
                
                if not m2m_config:
                    return []
                
                # Get the row to pass to helper
                row = self.get_row(username, password, table_name, row_id)
                return self._get_m2m_for_row(cursor, table_name, row, m2m_config)
        finally:
            conn.close()
    
    def add_m2m_relation(self, username, password, table_name, row_id, relation_name, data):
        """Add a many-to-many relation"""
        conn = self.get_connection(username, password)
        try:
            with conn.cursor() as cursor:
                # Find the m2m config
                m2m_configs = config.MANY_TO_MANY_CONFIG.get(table_name, [])
                m2m_config = None
                for m2m in m2m_configs:
                    if m2m.get('name', m2m['other_table']) == relation_name:
                        m2m_config = m2m
                        break
                
                if not m2m_config:
                    return {'success': False, 'error': 'Invalid relation'}
                
                # Parse row_id
                primary_keys = config.PRIMARY_KEYS[table_name]
                row_id_values = parse_row_id(primary_keys, row_id)
                
                # Build insert data
                insert_data = {}
                if isinstance(primary_keys, list):
                    for i, pk in enumerate(primary_keys):
                        insert_data[m2m_config['fk_self']] = row_id_values[i]
                else:
                    insert_data[m2m_config['fk_self']] = row_id
                
                insert_data[m2m_config['fk_other']] = data['id']
                
                # Add extra columns
                for col in m2m_config.get('extra_columns', []):
                    if col in data:
                        insert_data[col] = data[col]
                
                # Apply constraints if needed
                insert_data = self._apply_constraints(m2m_config['junction_table'], insert_data)
                
                # Insert
                columns = list(insert_data.keys())
                values = [insert_data[col] for col in columns]
                placeholders = ', '.join(['%s'] * len(columns))
                
                sql = f"INSERT INTO {m2m_config['junction_table']} ({', '.join(columns)}) VALUES ({placeholders})"
                cursor.execute(sql, values)
                conn.commit()
                
                return {'success': True}
        except pymysql.IntegrityError:
            return {'success': False, 'error': 'Relation already exists'}
        finally:
            conn.close()
    
    def delete_m2m_relation(self, username, password, table_name, row_id, relation_name, related_id):
        """Delete a many-to-many relation"""
        conn = self.get_connection(username, password)
        try:
            with conn.cursor() as cursor:
                # Find the m2m config
                m2m_configs = config.MANY_TO_MANY_CONFIG.get(table_name, [])
                m2m_config = None
                for m2m in m2m_configs:
                    if m2m.get('name', m2m['other_table']) == relation_name:
                        m2m_config = m2m
                        break
                
                if not m2m_config:
                    return {'success': False, 'error': 'Invalid relation'}
                
                # Parse row_id
                primary_keys = config.PRIMARY_KEYS[table_name]
                row_id_values = parse_row_id(primary_keys, row_id)
                
                # Build WHERE clause
                where_parts = []
                params = []
                
                if isinstance(primary_keys, list):
                    for i, pk in enumerate(primary_keys):
                        where_parts.append(f"{m2m_config['fk_self']} = %s")
                        params.append(row_id_values[i])
                else:
                    where_parts.append(f"{m2m_config['fk_self']} = %s")
                    params.append(row_id)
                
                where_parts.append(f"{m2m_config['fk_other']} = %s")
                params.append(related_id)
                
                sql = f"DELETE FROM {m2m_config['junction_table']} WHERE {' AND '.join(where_parts)}"
                cursor.execute(sql, params)
                conn.commit()
                
                return {'success': True}
        finally:
            conn.close()
    
    def validate_foreign_key(self, username, password, table_name, column_name, value):
        """Validate that a foreign key value exists"""
        fk_config = config.FOREIGN_KEY_CONFIG.get(table_name, {}).get(column_name)
        if not fk_config:
            return True  # Not a foreign key
        
        conn = self.get_connection(username, password)
        try:
            with conn.cursor() as cursor:
                sql = f"SELECT COUNT(*) as count FROM {fk_config['foreign_table']} WHERE {fk_config['foreign_key']} = %s"
                cursor.execute(sql, [value])
                return cursor.fetchone()['count'] > 0
        finally:
            conn.close()
    
    def _apply_constraints(self, table_name, data):
        """Apply database constraints (e.g., p1 < p2)"""
        # Check for rel table constraint
        if table_name == 'rel' or (table_name in config.MANY_TO_MANY_CONFIG and 
                                    any(m['junction_table'] == 'rel' for m in 
                                        [item for sublist in config.MANY_TO_MANY_CONFIG.values() for item in sublist])):
            if 'p1' in data and 'p2' in data:
                p1 = int(data['p1'])
                p2 = int(data['p2'])
                if p1 > p2:
                    data['p1'], data['p2'] = data['p2'], data['p1']
        
        # Similar logic for yanggui table
        if table_name == 'yanggui':
            if 'p1' in data and 'p2' in data:
                p1 = int(data['p1'])
                p2 = int(data['p2'])
                if p1 > p2:
                    data['p1'], data['p2'] = data['p2'], data['p1']
        
        return data
    
    def get_foreign_key_display(self, username, password, table_name, column_name, value):
        """Get display text for a foreign key value"""
        fk_config = config.FOREIGN_KEY_CONFIG.get(table_name, {}).get(column_name)
        if not fk_config:
            return {'display': '', 'data': None, 'error': 'No FK config found'}
        
        conn = self.get_connection(username, password)
        try:
            with conn.cursor() as cursor:
                display_cols = fk_config['display_columns']
                select_cols = ', '.join(display_cols)
                
                sql = f"SELECT {select_cols} FROM {fk_config['foreign_table']} WHERE {fk_config['foreign_key']} = %s"
                cursor.execute(sql, [value])
                result = cursor.fetchone()
                
                if result:
                    # Format as "col1: val1 | col2: val2 | ..."
                    parts = []
                    for col in display_cols:
                        if col in result and result[col] is not None:
                            parts.append(f"{col}: {result[col]}")
                    return {'display': ' | '.join(parts) if parts else '', 'data': result}
                return {'display': '', 'data': None}
        except Exception as e:
            return {'display': '', 'data': None, 'error': str(e)}
        finally:
            conn.close()

    def add_contributor(self, username, password, table_name, row_id, contributor_data):
        """Add a contributor to a specific row"""
        if (write_only_config := config.WRITE_ONLY_CONFIG.get(table_name)) is None:
            raise ValueError("Table does not support contributors")
        
        conn = self.get_connection(username, password)
        try:
            with conn.cursor() as cursor:
                primary_keys = config.PRIMARY_KEYS[table_name]
                where_clause, where_params = build_where_clause(primary_keys, row_id)
                
                check_sql = f"SELECT * FROM {table_name} WHERE {where_clause}"
                cursor.execute(check_sql, where_params)
                current_row = cursor.fetchone()
                
                if not current_row:
                    return {'success': False, 'error': 'Record not found'}
                
                contributor_col = write_only_config['contributor_column']
                owner_col = write_only_config['owner_column']
                
                contributors_json = current_row.get(contributor_col, '[]')
                if isinstance(contributors_json, str):
                    contributors = json.loads(contributors_json)
                else:
                    contributors = contributors_json if contributors_json else []
                
                owner = current_row.get(owner_col)
                is_owner = (owner == username)
                
                if not is_owner:
                    return {'success': False, 'error': 'Only owner can add contributors'}
                
                new_contributor = contributor_data.get('contributor')
                if new_contributor and new_contributor not in contributors:
                    contributors.append(new_contributor)
                    
                    update_sql = f"UPDATE {table_name} SET {contributor_col} = %s WHERE {where_clause}"
                    cursor.execute(update_sql, [json.dumps(contributors)] + where_params)
                    conn.commit()
                    
                    return {'success': True}
                else:
                    return {'success': False, 'error': 'Contributor already exists or invalid username'}
            return {'success': False, 'error': 'Invalid contributor data'}
        except Exception as e:
            raise e
            return {'success': False, 'error': str(e)}
        
        finally:
            conn.close()

    def remove_contributor(self, username, password, table_name, row_id, contributor_data):
        """Delete a contributor from a specific row"""
        if (write_only_config := config.WRITE_ONLY_CONFIG.get(table_name)) is None:
            raise ValueError("Table does not support contributors")
        conn = self.get_connection(username, password)
        try:
            with conn.cursor() as cursor:
                primary_keys = config.PRIMARY_KEYS[table_name]
                where_clause, where_params = build_where_clause(primary_keys, row_id)
                
                check_sql = f"SELECT * FROM {table_name} WHERE {where_clause}"
                cursor.execute(check_sql, where_params)
                current_row = cursor.fetchone()
                
                if not current_row:
                    return {'success': False, 'error': 'Record not found'}
                
                contributor_col = write_only_config['contributor_column']
                owner_col = write_only_config['owner_column']
                
                contributors_json = current_row.get(contributor_col, '[]')
                if isinstance(contributors_json, str):
                    contributors = json.loads(contributors_json)
                else:
                    contributors = contributors_json if contributors_json else []
                
                owner = current_row.get(owner_col)
                is_owner = (owner == username)
                
                if not is_owner:
                    return {'success': False, 'error': 'Only owner can delete contributors'}
                
                contributor_to_remove = contributor_data.get('contributor')
                if contributor_to_remove and contributor_to_remove in contributors:
                    contributors.remove(contributor_to_remove)
                    
                    update_sql = f"UPDATE {table_name} SET {contributor_col} = %s WHERE {where_clause}"
                    cursor.execute(update_sql, [json.dumps(contributors)] + where_params)
                    conn.commit()
                    
                    return {'success': True}
                else:
                    return {'success': False, 'error': 'Contributor not found or invalid username'}
            return {'success': False, 'error': 'Invalid contributor data'}
        except Exception as e:
            raise e
            return {'success': False, 'error': str(e)}
        finally:
            conn.close()
        
