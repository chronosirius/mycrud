from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from functools import wraps
import os
from datetime import timedelta
from werkzeug.middleware.proxy_fix import ProxyFix

# Import our modules
from auth import AuthManager
from database import DatabaseManager

from utils import get_table_schema, format_value_for_display, parse_form_value
import config

app = Flask(__name__)
app.secret_key = "amongiddy"  # Change this to a fixed secret in production
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

# Initialize managers
db_manager = DatabaseManager()
auth_manager = AuthManager()

# Login required decorator
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'username' not in session:
            session['next_url'] = request.url
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

@app.context_processor
def inject_plugins():
    plugins = []
    plugins_dir = os.path.join(app.root_path, 'static', 'plugins')
    if os.path.exists(plugins_dir):
        for filename in os.listdir(plugins_dir):
            if filename.endswith('.js'):
                plugins.append(filename[:-3])  # Remove .js extension
    return dict(plugins=plugins)

# Routes
@app.route('/')
@login_required
def index():
    return redirect(url_for('table_view', table_name=config.DEFAULT_TABLE))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        data = request.get_json()
        username = data.get('username')
        password = data.get('password')
        remember = data.get('remember', False)
        
        if auth_manager.authenticate(username, password):
            session['username'] = username
            session['password'] = password
            session.permanent = True
            
            if remember:
                app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=45)
            else:
                app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)
            
            next_url = session.pop('next_url', url_for('index'))
            return jsonify({'success': True, 'redirect': next_url})
        else:
            return jsonify({'success': False, 'error': 'Invalid credentials'}), 401
    
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/table/<table_name>')
@login_required
def table_view(table_name):
    if table_name not in config.TABLES_TO_SHOW:
        return "Table not found", 404
    
    return render_template('table.html', 
                         table_name=table_name,
                         tables=config.TABLES_TO_SHOW,
                         default_table=config.DEFAULT_TABLE)

@app.route('/api/table/<table_name>/schema')
@login_required
def get_schema(table_name):
    try:
        schema = get_table_schema(
            session['username'], 
            session['password'], 
            table_name
        )
        
        # Add configuration info
        schema['primary_keys'] = config.PRIMARY_KEYS.get(table_name, [])
        schema['read_only'] = config.READ_ONLY_COLUMNS.get(table_name, [])
        schema['hidden'] = config.HIDDEN_COLUMNS.get(table_name, [])
        schema['visible'] = config.VISIBLE_COLUMNS.get(table_name, None)
        schema['foreign_keys'] = config.FOREIGN_KEY_CONFIG.get(table_name, {})
        schema['many_to_many'] = config.MANY_TO_MANY_CONFIG.get(table_name, [])
        schema['column_widths'] = config.COLUMN_WIDTHS.get(table_name, [])
        schema['write_only_config'] = config.WRITE_ONLY_CONFIG.get(table_name, None)
        
        return jsonify(schema)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/table/<table_name>/rows')
@login_required
def get_rows(table_name):
    try:
        page = int(request.args.get('page', 1))
        per_page = request.args.get('per_page', '50')
        per_page = None if per_page == 'all' else int(per_page)
        search = request.args.get('search', {})
        
        if isinstance(search, str) and search:
            import json
            search = json.loads(search)
        
        result = db_manager.get_rows(
            session['username'],
            session['password'],
            table_name,
            page,
            per_page,
            search
        )
        
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/table/<table_name>/row/<path:row_id>')
@login_required
def get_row(table_name, row_id):
    try:
        row = db_manager.get_row(
            session['username'],
            session['password'],
            table_name,
            row_id
        )
        
        if row:
            return jsonify(row)
        else:
            return jsonify({'error': 'Row not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/table/<table_name>/row', methods=['POST'])
@login_required
def add_row(table_name):
    try:
        data = request.get_json()
        
        result = db_manager.insert_row(
            session['username'],
            session['password'],
            table_name,
            data
        )
        
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/table/<table_name>/row/<path:row_id>', methods=['PUT'])
@login_required
def update_row(table_name, row_id):
    try:
        data = request.get_json()
        
        result = db_manager.update_row(
            session['username'],
            session['password'],
            table_name,
            row_id,
            data
        )
        
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/table/<table_name>/row/<path:row_id>', methods=['DELETE'])
@login_required
def delete_row(table_name, row_id):
    try:
        result = db_manager.delete_row(
            session['username'],
            session['password'],
            table_name,
            row_id
        )
        
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/search/<table_name>')
@login_required
def search_table(table_name):
    try:
        query = request.args.get('q', '')
        columns_str = request.args.get('columns', '')
        columns = [c.strip() for c in columns_str.split(',') if c.strip()]
        
        if not columns:
            return jsonify([])
        
        results = db_manager.search_table(
            session['username'],
            session['password'],
            table_name,
            query,
            columns
        )
        
        return jsonify(results)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/m2m/<table_name>/<path:row_id>/<relation_name>')
@login_required
def get_m2m_relations(table_name, row_id, relation_name):
    try:
        relations = db_manager.get_m2m_relations(
            session['username'],
            session['password'],
            table_name,
            row_id,
            relation_name
        )
        
        return jsonify(relations)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/m2m/<table_name>/<path:row_id>/<relation_name>', methods=['POST'])
@login_required
def add_m2m_relation(table_name, row_id, relation_name):
    try:
        data = request.get_json()
        
        result = db_manager.add_m2m_relation(
            session['username'],
            session['password'],
            table_name,
            row_id,
            relation_name,
            data
        )
        
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/m2m/<table_name>/<path:row_id>/<relation_name>/<path:related_id>', methods=['DELETE'])
@login_required
def delete_m2m_relation(table_name, row_id, relation_name, related_id):
    try:
        result = db_manager.delete_m2m_relation(
            session['username'],
            session['password'],
            table_name,
            row_id,
            relation_name,
            related_id
        )
        
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/validate-fk/<table_name>/<column_name>/<value>')
@login_required
def validate_foreign_key(table_name, column_name, value):
    try:
        is_valid = db_manager.validate_foreign_key(
            session['username'],
            session['password'],
            table_name,
            column_name,
            value
        )
        
        return jsonify({'valid': is_valid})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/fk-display/<table_name>/<column_name>/<value>')
@login_required
def get_fk_display(table_name, column_name, value):
    try:
        display = db_manager.get_foreign_key_display(
            session['username'],
            session['password'],
            table_name,
            column_name,
            value
        )
        
        return jsonify(display)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/contrib/<table_name>/row/<path:row_id>', methods=['POST'])
@login_required
def add_contributor(table_name, row_id):
    try:
        data = request.get_json()
        result = db_manager.add_contributor(
            session['username'],
            session['password'],
            table_name,
            row_id,
            data
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/contrib/<table_name>/row/<path:row_id>', methods=['DELETE'])
@login_required
def remove_contributor(table_name, row_id):
    try:
        data = request.get_json()
        result = db_manager.remove_contributor(
            session['username'],
            session['password'],
            table_name,
            row_id,
            data
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    
if __name__ == '__main__':
    from customs.customs import customs_bp
    app.register_blueprint(customs_bp, url_prefix='/')
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)
    app.run(debug=True, host='0.0.0.0', port=5000)