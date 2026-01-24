// Load table data
async function loadTableData() {
    const tableName = window.location.pathname.split('/').pop();
    const loading = document.getElementById('loading');
    const emptyState = document.getElementById('empty-state');
    const tableBody = document.getElementById('table-body');
    
    loading.classList.remove('hidden');
    tableBody.innerHTML = '';
    
    const response = await fetch(`/api/table/${tableName}/rows`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            page: currentPage,
            per_page: perPage,
            search: searchFilters
        })
    });
    const data = await response.json();
    
    loading.classList.add('hidden');
    
    if (data.rows.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }
    
    emptyState.classList.add('hidden');
    
    buildTableHeader();
    
    const visibleColumns = schema.visible || schema.columns.map(col => col.Field);
    const hiddenColumns = schema.hidden || [];
    
    const rowElements = [];
    for (const row of data.rows) {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer';
        tr.addEventListener('click', () => openExpandedView(row));
        
        for (const col of schema.columns) {
            if (!visibleColumns.includes(col.Field)) continue;
            if (hiddenColumns.includes(col.Field)) continue;
            
            const td = document.createElement('td');
            td.className = 'px-4 py-3 table-cell';
            
            if (col.Type.includes('varchar') || col.Type.includes('text')) {
                td.classList.add('text-wrap');
            } else {
                td.classList.add('text-nowrap');
            }
            
            const width = columnWidths[col.Field];
            if (width) {
                td.style.width = `${width}px`;
                td.style.maxWidth = `${width}px`;
            }
            
            const foreignKey = schema.foreign_keys?.[col.Field];
            
            if (foreignKey && row[col.Field]) {
                const valueDiv = document.createElement('div');
                valueDiv.className = 'font-medium';
                valueDiv.textContent = row[col.Field];
                td.appendChild(valueDiv);
                
                const loadingDiv = document.createElement('div');
                loadingDiv.className = 'text-xs text-gray-400 dark:text-gray-500 mt-1';
                loadingDiv.textContent = 'Loading...';
                td.appendChild(loadingDiv);
                
                td.setAttribute('data-fk-column', col.Field);
                td.setAttribute('data-fk-value', row[col.Field]);
            } else if (col.Type.startsWith('enum')) {
                const span = document.createElement('span');
                span.className = 'chip bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200';
                span.textContent = row[col.Field] || '';
                td.appendChild(span);
            } else if (col.Type.includes('date') || col.Type.includes('timestamp')) {
                const dateValue = formatDate(row[col.Field]);
                td.textContent = dateValue;
            } else {
                td.textContent = formatValue(row[col.Field]);
            }
            
            if (row._m2m_data && schema.many_to_many) {
                for (const m2m of schema.many_to_many) {
                    const relationName = m2m.name || m2m.other_table;
                    if (m2m.fk_self === col.Field || (Array.isArray(m2m.fk_self) && m2m.fk_self.includes(col.Field))) {
                        const m2mData = row._m2m_data[relationName];
                        if (m2mData && m2mData.length > 0) {
                            const m2mDiv = document.createElement('div');
                            m2mDiv.className = 'text-xs text-gray-500 dark:text-gray-400 mt-1';
                            m2mDiv.textContent = `(${m2mData.length} ${relationName})`;
                            td.appendChild(m2mDiv);
                        }
                    }
                }
            }
            
            tr.appendChild(td);
        }
        
        tableBody.appendChild(tr);
        rowElements.push(tr);
    }
    
    loadFKDisplaysAsync(data.rows, rowElements);
    updatePagination(data);
}

async function loadFKDisplaysAsync(rows, rowElements) {
    const tableName = window.location.pathname.split('/').pop();
    const visibleColumns = schema.visible || schema.columns.map(col => col.Field);
    const hiddenColumns = schema.hidden || [];
    
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        const tr = rowElements[rowIdx];
        
        for (const col of schema.columns) {
            if (!visibleColumns.includes(col.Field)) continue;
            if (hiddenColumns.includes(col.Field)) continue;
            
            const foreignKey = schema.foreign_keys?.[col.Field];
            if (foreignKey && row[col.Field]) {
                try {
                    const url = `/api/fk-display/${tableName}/${col.Field}/${encodeURIComponent(row[col.Field])}`;
                    const fkResponse = await fetch(url);
                    
                    if (fkResponse.ok) {
                        const fkData = await fkResponse.json();
                        
                        const td = tr.querySelector(`[data-fk-column="${col.Field}"][data-fk-value="${row[col.Field]}"]`);
                        if (td && fkData.display) {
                            const loadingDiv = td.querySelector('.text-xs.text-gray-400');
                            if (loadingDiv && loadingDiv.textContent === 'Loading...') {
                                loadingDiv.remove();
                            }
                            
                            const displayDiv = document.createElement('div');
                            displayDiv.className = 'text-xs text-gray-500 dark:text-gray-400 mt-1';
                            displayDiv.textContent = fkData.display;
                            td.appendChild(displayDiv);
                        }
                    }
                } catch (e) {
                    console.error('Error loading FK display:', col.Field, e);
                }
            }
        }
    }
}

function formatDate(value) {
    if (!value) return '';
    
    try {
        const date = new Date(value);
        if (isNaN(date.getTime())) return value;
        
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = date.getFullYear();
        
        return `${month}-${day}-${year}`;
    } catch (e) {
        return value;
    }
}

function buildTableHeader() {
    const header = document.getElementById('table-header');
    header.innerHTML = '';
    
    const visibleColumns = schema.visible || schema.columns.map(col => col.Field);
    const hiddenColumns = schema.hidden || [];
    
    for (const col of schema.columns) {
        if (!visibleColumns.includes(col.Field)) continue;
        if (hiddenColumns.includes(col.Field)) continue;
        
        const th = document.createElement('th');
        th.className = 'px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider relative';
        
        const width = columnWidths[col.Field];
        if (width) {
            th.style.width = `${width}px`;
        }
        
        th.textContent = col.Field;
        
        const resizer = document.createElement('div');
        resizer.className = 'column-resizer';
        resizer.addEventListener('mousedown', (e) => initResize(e, col.Field, th));
        th.appendChild(resizer);
        
        header.appendChild(th);
    }
}

function initResize(e, columnName, th) {
    e.preventDefault();
    const startX = e.pageX;
    const startWidth = th.offsetWidth;
    
    const onMouseMove = (e) => {
        const newWidth = startWidth + (e.pageX - startX);
        if (newWidth > 50) {
            th.style.width = `${newWidth}px`;
            columnWidths[columnName] = newWidth;
            
            const index = Array.from(th.parentElement.children).indexOf(th);
            const rows = document.querySelectorAll('#table-body tr');
            rows.forEach(row => {
                const cell = row.children[index];
                if (cell) {
                    cell.style.width = `${newWidth}px`;
                    cell.style.maxWidth = `${newWidth}px`;
                }
            });
        }
    };
    
    const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        saveColumnWidths();
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

async function validateM2MForeignKey(tableName, value, inputElement) {
    inputElement.classList.remove('border-red-500', 'border-green-500', 'border-yellow-500');
    
    if (!value || value.trim() === '') {
        return false;
    }
    
    try {
        const otherTablePks = config.PRIMARY_KEYS || {};
        let pkField = otherTablePks[tableName];
        
        if (Array.isArray(pkField)) {
            pkField = pkField[0];
        }
        if (!pkField) {
            pkField = 'id';
        }
        
        const response = await fetch(`/api/search/${tableName}?q=${encodeURIComponent(value)}&columns=${pkField}`);
        if (!response.ok) {
            inputElement.classList.add('border-yellow-500');
            return false;
        }
        
        const results = await response.json();
        const found = results.some(r => String(r[pkField]) === String(value));
        
        if (found) {
            inputElement.classList.add('border-green-500');
            return true;
        } else {
            inputElement.classList.add('border-red-500');
            return false;
        }
    } catch (error) {
        console.error('M2M FK validation error:', error);
        inputElement.classList.add('border-yellow-500');
        return false;
    }
}

function formatValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
}

function formatDateForInput(value) {
    if (!value) return '';
    
    try {
        const date = new Date(value);
        if (isNaN(date.getTime())) return '';
        
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        
        return `${year}-${month}-${day}`;
    } catch (e) {
        return '';
    }
}

function updatePagination(data) {
    const info = document.getElementById('pagination-info');
    const buttons = document.getElementById('pagination-buttons');
    
    const start = (data.page - 1) * data.per_page + 1;
    const end = Math.min(data.page * data.per_page, data.total);
    info.textContent = `Showing ${start} to ${end} of ${data.total} entries`;
    
    buttons.innerHTML = '';
    
    const prevBtn = createPaginationButton('Previous', () => {
        if (currentPage > 1) {
            currentPage--;
            loadTableData();
        }
    }, currentPage === 1);
    buttons.appendChild(prevBtn);
    
    const totalPages = data.pages;
    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }
    
    for (let i = startPage; i <= endPage; i++) {
        const btn = createPaginationButton(i, () => {
            currentPage = i;
            loadTableData();
        }, false, i === currentPage);
        buttons.appendChild(btn);
    }
    
    const nextBtn = createPaginationButton('Next', () => {
        if (currentPage < totalPages) {
            currentPage++;
            loadTableData();
        }
    }, currentPage === totalPages);
    buttons.appendChild(nextBtn);
}

function createPaginationButton(text, onClick, disabled, active) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.onclick = onClick;
    btn.disabled = disabled;
    
    let classes = 'px-3 py-1 rounded-lg text-sm font-medium ';
    if (active) {
        classes += 'bg-blue-600 text-white';
    } else if (disabled) {
        classes += 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed';
    } else {
        classes += 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700';
    }
    
    btn.className = classes;
    return btn;
}

function changePerPage() {
    const select = document.getElementById('per-page');
    perPage = select.value === 'all' ? 'all' : parseInt(select.value);
    currentPage = 1;
    loadTableData();
}

async function submitAddRow() {
    const form = document.getElementById('addRowForm');
    const formData = new FormData(form);
    const data = {};
    
    for (const [key, value] of formData.entries()) {
        if (value !== '') {
            data[key] = value;
        }
    }
    
    const tableName = window.location.pathname.split('/').pop();
    const response = await fetch(`/api/table/${tableName}/row`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });
    
    const result = await response.json();
    const messageDiv = document.getElementById('add-row-message');
    
    if (result.success) {
        messageDiv.className = 'mt-4 p-4 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200 rounded-lg';
        messageDiv.textContent = 'Row added successfully!';
        form.reset();
        loadTableData();
    } else {
        messageDiv.className = 'mt-4 p-4 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 rounded-lg';
        messageDiv.textContent = `Error: ${result.error}`;
    }
    
    messageDiv.classList.remove('hidden');
    setTimeout(() => messageDiv.classList.add('hidden'), 5000);
}

async function openExpandedView(row) {
    const modal = document.getElementById('expanded-modal');
    const form = document.getElementById('editRowForm');
    const m2mContainer = document.getElementById('m2m-relations');
    
    form.innerHTML = '';
    m2mContainer.innerHTML = '';
    
    const primaryKeys = Array.isArray(schema.primary_keys) ? schema.primary_keys : [schema.primary_keys];
    currentRowId = primaryKeys.map(pk => row[pk]).join('/');
    
    for (const col of schema.columns) {
        if ((schema.hidden || []).includes(col.Field)) continue;
        
        const formGroup = createFormField(col, false, 'edit');
        const input = formGroup.querySelector('input, select, textarea');
        if (input) {
            if (input.type === 'date') {
                input.value = formatDateForInput(row[col.Field]);
            } else {
                input.value = row[col.Field] || '';
            }
            
            if (schema.foreign_keys?.[col.Field] && row[col.Field]) {
                setTimeout(async () => {
                    const event = new Event('blur');
                    input.dispatchEvent(event);
                }, 150);
            }
        }
        form.appendChild(formGroup);
    }
    
    if (schema.many_to_many && schema.many_to_many.length > 0) {
        for (const m2m of schema.many_to_many) {
            await loadM2MRelation(m2m, currentRowId);
        }
    }
    
    const tableName = window.location.pathname.split('/').pop();
    const writeOnlyConfig = schema.write_only_config;
    
    if (writeOnlyConfig) {
        const isOwner = row._is_owner || false;
        const contributors = row._contributors || [];
        const contributorSection = createContributorManagement(row, writeOnlyConfig, isOwner, contributors);
        m2mContainer.appendChild(contributorSection);
    }
    
    modal.classList.remove('hidden');
}