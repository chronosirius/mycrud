// Global state
let schema = null;
let currentPage = 1;
let perPage = 50;
let searchFilters = {};
let currentRowId = null;
let columnWidths = {};
let config = {}; // For storing PRIMARY_KEYS config

// Load column widths from localStorage
function loadColumnWidths() {
    const tableName = window.location.pathname.split('/').pop();
    const saved = localStorage.getItem(`columnWidths_${tableName}`);
    if (saved) {
        columnWidths = JSON.parse(saved);
    }
}

function saveColumnWidths() {
    const tableName = window.location.pathname.split('/').pop();
    localStorage.setItem(`columnWidths_${tableName}`, JSON.stringify(columnWidths));
}

function resetColumnWidths() {
    columnWidths = {};
    const tableName = window.location.pathname.split('/').pop();
    localStorage.removeItem(`columnWidths_${tableName}`);
    
    const headers = document.querySelectorAll('#table-header th');
    headers.forEach(th => {
        th.style.width = '';
    });
    
    const rows = document.querySelectorAll('#table-body tr');
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        cells.forEach(cell => {
            cell.style.width = '';
            cell.style.maxWidth = '';
        });
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    loadColumnWidths();
    await loadSchema();
    setupSidebar();
    setupAddRowForm();
    setupSearchFields();
    await loadTableData();
});

// Sidebar toggle
function setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    const icon = document.getElementById('sidebar-icon');
    let isOpen = true;
    
    toggleBtn.addEventListener('click', () => {
        isOpen = !isOpen;
        
        if (isOpen) {
            sidebar.style.marginLeft = '0';
            sidebar.style.width = '16rem';
            toggleBtn.style.left = '16rem';
            icon.style.transform = 'rotate(0deg)';
        } else {
            sidebar.style.marginLeft = '-16rem';
            sidebar.style.width = '16rem';
            toggleBtn.style.left = '0';
            icon.style.transform = 'rotate(180deg)';
        }
    });
}

// Load schema
async function loadSchema() {
    const tableName = window.location.pathname.split('/').pop();
    const response = await fetch(`/api/table/${tableName}/schema`);
    schema = await response.json();
    
    // Store PRIMARY_KEYS config globally for M2M validation
    config.PRIMARY_KEYS = schema.primary_keys || {};
}

// Setup add row form
function setupAddRowForm() {
    const form = document.getElementById('addRowForm');
    form.innerHTML = '';
    
    const visibleColumns = schema.visible || schema.columns.map(col => col.Field);
    const hiddenColumns = schema.hidden || [];
    const readOnlyColumns = schema.read_only || [];
    const primaryKeys = Array.isArray(schema.primary_keys) ? schema.primary_keys : [schema.primary_keys];
    
    for (const col of schema.columns) {
        if (hiddenColumns.includes(col.Field)) continue;
        if (primaryKeys.includes(col.Field) && col.Extra === 'auto_increment') continue;
        
        const formGroup = createFormField(col, false, 'add');
        form.appendChild(formGroup);
    }
}

// Create form field
function createFormField(col, readOnly, mode = 'add') {
    const div = document.createElement('div');
    div.className = 'flex flex-col';
    
    const label = document.createElement('label');
    label.className = 'text-sm font-medium mb-1';
    label.textContent = col.Field;
    if (col.Null === 'NO' && mode === 'add') {
        label.innerHTML += ' <span class="text-red-500">*</span>';
    }
    div.appendChild(label);
    
    let input;
    const isReadOnly = readOnly || (schema.read_only || []).includes(col.Field);
    const primaryKeys = Array.isArray(schema.primary_keys) ? schema.primary_keys : [schema.primary_keys];
    const isPrimaryKey = primaryKeys.includes(col.Field);
    
    const foreignKey = schema.foreign_keys?.[col.Field];
    
    if (foreignKey) {
        const wrapper = document.createElement('div');
        wrapper.className = 'relative';
        
        input = document.createElement('input');
        input.type = 'number';
        input.id = `${mode}-${col.Field}`;
        input.name = col.Field;
        input.className = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500';
        input.disabled = isPrimaryKey && mode === 'edit';
        
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = `Search ${foreignKey.foreign_table}...`;
        searchInput.className = 'w-full px-3 py-2 mt-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500';
        
        const searchResults = document.createElement('div');
        searchResults.className = 'absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto hidden';
        
        const chipDisplay = document.createElement('div');
        chipDisplay.className = 'hidden px-3 py-2 mt-2 bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-lg cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30';
        chipDisplay.onclick = () => {
            input.classList.remove('hidden');
            searchInput.classList.remove('hidden');
            chipDisplay.classList.add('hidden');
            input.value = '';
            searchInput.value = '';
            searchInput.focus();
        };
        
        const chipText = document.createElement('div');
        chipText.className = 'text-sm';
        chipDisplay.appendChild(chipText);
        
        const showChipForFK = async (fkValue) => {
            if (!fkValue) return;
            
            try {
                const tableName = window.location.pathname.split('/').pop();
                const response = await fetch(`/api/fk-display/${tableName}/${col.Field}/${encodeURIComponent(fkValue)}`);
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.display) {
                        chipText.innerHTML = `<strong>Selected:</strong> ${data.display} <span class="text-gray-600 dark:text-gray-400">(ID: ${fkValue})</span>`;
                        
                        input.classList.add('hidden');
                        searchInput.classList.add('hidden');
                        chipDisplay.classList.remove('hidden');
                    }
                }
            } catch (e) {
                console.error('Error loading FK display for chip:', e);
            }
        };
        
        let searchTimeout;
        searchInput.addEventListener('input', async () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(async () => {
                const query = searchInput.value.trim();
                if (query.length < 2) {
                    searchResults.classList.add('hidden');
                    return;
                }
                
                const columns = foreignKey.search_columns.join(',');
                const params = new URLSearchParams({
                    q: query,
                    columns: columns
                });
                
                const response = await fetch(`/api/search/${foreignKey.foreign_table}?${params}`);
                const results = await response.json();
                
                searchResults.innerHTML = '';
                if (results.length === 0) {
                    searchResults.innerHTML = '<div class="px-3 py-2 text-gray-500">No results found</div>';
                } else {
                    for (const result of results) {
                        const item = document.createElement('div');
                        item.className = 'px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer';
                        const displayText = foreignKey.display_columns.map(c => result[c]).filter(v => v).join(' | ');
                        item.textContent = `${result[foreignKey.foreign_key]}: ${displayText}`;
                        item.addEventListener('click', async () => {
                            input.value = result[foreignKey.foreign_key];
                            searchInput.value = '';
                            searchResults.classList.add('hidden');
                            await validateForeignKey(col.Field, result[foreignKey.foreign_key], input);
                            await showChipForFK(result[foreignKey.foreign_key]);
                        });
                        searchResults.appendChild(item);
                    }
                }
                searchResults.classList.remove('hidden');
            }, 300);
        });
        
        input.addEventListener('blur', async () => {
            setTimeout(async () => {
                if (input.value) {
                    const isValid = await validateForeignKey(col.Field, input.value, input);
                    if (isValid) {
                        await showChipForFK(input.value);
                    }
                }
            }, 150);
        });
        
        input.addEventListener('input', () => {
            input.classList.remove('border-red-500', 'border-green-500', 'border-yellow-500');
        });
        
        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target)) {
                searchResults.classList.add('hidden');
            }
        });
        
        wrapper.appendChild(input);
        wrapper.appendChild(searchInput);
        wrapper.appendChild(chipDisplay);
        wrapper.appendChild(searchResults);
        div.appendChild(wrapper);
    } else if (col.Type.startsWith('enum')) {
        input = document.createElement('select');
        input.id = `${mode}-${col.Field}`;
        input.name = col.Field;
        input.className = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500';
        input.disabled = isReadOnly || (isPrimaryKey && mode === 'edit');
        
        if (col.Null === 'YES') {
            const nullOption = document.createElement('option');
            nullOption.value = '';
            nullOption.textContent = '(null)';
            input.appendChild(nullOption);
        }
        
        for (const value of col.enum_values) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            input.appendChild(option);
        }
        div.appendChild(input);
    } else if (col.Type.startsWith('int') || col.Type.startsWith('bigint') || col.Type.startsWith('tinyint')) {
        input = document.createElement('input');
        input.type = 'number';
        input.step = '1';
        input.id = `${mode}-${col.Field}`;
        input.name = col.Field;
        input.className = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500';
        input.disabled = isReadOnly || (isPrimaryKey && mode === 'edit');
        div.appendChild(input);
    } else if (col.Type.startsWith('decimal') || col.Type.startsWith('float') || col.Type.startsWith('double')) {
        input = document.createElement('input');
        input.type = 'number';
        input.step = getStepForDecimal(col.Type);
        input.id = `${mode}-${col.Field}`;
        input.name = col.Field;
        input.className = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500';
        input.disabled = isReadOnly || (isPrimaryKey && mode === 'edit');
        div.appendChild(input);
    } else if (col.Type.includes('date') || col.Type.includes('timestamp')) {
        input = document.createElement('input');
        input.type = 'date';
        input.id = `${mode}-${col.Field}`;
        input.name = col.Field;
        input.className = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500';
        input.disabled = isReadOnly || (isPrimaryKey && mode === 'edit');
        div.appendChild(input);
    } else if (col.Type.startsWith('text') || col.Type.startsWith('longtext')) {
        input = document.createElement('textarea');
        input.id = `${mode}-${col.Field}`;
        input.name = col.Field;
        input.rows = 3;
        input.className = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500';
        input.disabled = isReadOnly || (isPrimaryKey && mode === 'edit');
        div.appendChild(input);
    } else {
        input = document.createElement('input');
        input.type = 'text';
        input.id = `${mode}-${col.Field}`;
        input.name = col.Field;
        input.className = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500';
        input.disabled = isReadOnly || (isPrimaryKey && mode === 'edit');
        div.appendChild(input);
    }
    
    return div;
}

function getStepForDecimal(type) {
    if (type.includes('(')) {
        const parts = type.split('(')[1].split(')')[0].split(',');
        if (parts.length > 1) {
            const decimals = parseInt(parts[1]);
            return Math.pow(10, -decimals);
        }
    }
    return 0.01;
}

async function validateForeignKey(columnName, value, inputElement) {
    const tableName = window.location.pathname.split('/').pop();
    
    inputElement.classList.remove('border-red-500', 'border-green-500', 'border-yellow-500');
    
    const valueStr = String(value || '').trim();
    
    if (!valueStr) {
        return true;
    }
    
    try {
        const response = await fetch(`/api/validate-fk/${tableName}/${columnName}/${encodeURIComponent(valueStr)}`);
        if (!response.ok) {
            inputElement.classList.add('border-yellow-500');
            return false;
        }
        
        const data = await response.json();
        
        if (data.valid) {
            inputElement.classList.add('border-green-500');
            return true;
        } else {
            inputElement.classList.add('border-red-500');
            return false;
        }
    } catch (error) {
        console.error('FK validation error:', error);
        inputElement.classList.add('border-yellow-500');
        return false;
    }
}

// Setup search fields
function setupSearchFields() {
    const container = document.getElementById('search-fields');
    container.innerHTML = '';
    
    const visibleColumns = schema.visible || schema.columns.map(col => col.Field);
    const hiddenColumns = schema.hidden || [];
    
    for (const col of schema.columns) {
        if (!visibleColumns.includes(col.Field)) continue;
        if (hiddenColumns.includes(col.Field)) continue;
        
        const div = document.createElement('div');
        div.className = 'flex flex-col';
        
        const label = document.createElement('label');
        label.className = 'text-sm font-medium mb-1';
        label.textContent = `Search ${col.Field}`;
        div.appendChild(label);
        
        const foreignKey = schema.foreign_keys?.[col.Field];
        
        // Check if column is enum type
        if (col.Type.startsWith('enum')) {
            const select = document.createElement('select');
            select.className = 'px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 text-sm';
            
            // Add "None" option for no filter
            const noneOption = document.createElement('option');
            noneOption.value = '';
            noneOption.textContent = 'None (No filter)';
            select.appendChild(noneOption);
            
            // Add enum values
            for (const value of col.enum_values) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = value;
                select.appendChild(option);
            }
            
            select.addEventListener('change', () => {
                if (select.value === '') {
                    delete searchFilters[col.Field];
                } else {
                    // Use special prefix to indicate exact match for enum
                    searchFilters[col.Field] = '===EXACT===' + select.value;
                }
                currentPage = 1;
                loadTableData();
            });
            div.appendChild(select);
        } else if (foreignKey) {
            // For foreign key columns, provide both ID search and name search
            
            // Track which input is active to prevent interference
            let activeSearchInput = null;
            
            // ID search input
            const idInput = document.createElement('input');
            idInput.type = 'number';
            idInput.placeholder = `Filter by ID...`;
            idInput.className = 'px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 text-sm';
            
            // Exact checkbox for ID
            const idExactWrapper = document.createElement('div');
            idExactWrapper.className = 'flex items-center gap-2 mt-1';
            const idExactCheckbox = document.createElement('input');
            idExactCheckbox.type = 'checkbox';
            idExactCheckbox.id = `exact-${col.Field}-id`;
            idExactCheckbox.className = 'rounded';
            const idExactLabel = document.createElement('label');
            idExactLabel.htmlFor = `exact-${col.Field}-id`;
            idExactLabel.className = 'text-xs text-gray-600 dark:text-gray-400';
            idExactLabel.textContent = 'Exact ID match';
            idExactWrapper.appendChild(idExactCheckbox);
            idExactWrapper.appendChild(idExactLabel);
            
            idInput.addEventListener('input', debounce(() => {
                if (idInput.value) {
                    activeSearchInput = 'id';
                    // Clear FK search programmatically
                    const oldFkValue = fkInput.value;
                    fkInput.value = '';
                    // Only update if FK was actually cleared
                    const prefix = idExactCheckbox.checked ? '===EXACT===' : '';
                    searchFilters[col.Field] = prefix + idInput.value;
                    currentPage = 1;
                    loadTableData();
                } else if (activeSearchInput === 'id') {
                    // Only delete if this input was the active one
                    delete searchFilters[col.Field];
                    activeSearchInput = null;
                    currentPage = 1;
                    loadTableData();
                }
            }, 500));
            
            idExactCheckbox.addEventListener('change', () => {
                if (idInput.value) {
                    const prefix = idExactCheckbox.checked ? '===EXACT===' : '';
                    searchFilters[col.Field] = prefix + idInput.value;
                    currentPage = 1;
                    loadTableData();
                }
            });
            
            div.appendChild(idInput);
            div.appendChild(idExactWrapper);
            
            // Foreign table search input
            const fkLabel = document.createElement('label');
            fkLabel.className = 'text-sm font-medium mt-2 mb-1';
            fkLabel.textContent = `Or search by ${foreignKey.foreign_table}`;
            div.appendChild(fkLabel);
            
            const fkInput = document.createElement('input');
            fkInput.type = 'text';
            fkInput.placeholder = `Filter by ${foreignKey.search_columns.join(', ')}...`;
            fkInput.className = 'px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 text-sm';
            
            // Exact checkbox for FK search
            const fkExactWrapper = document.createElement('div');
            fkExactWrapper.className = 'flex items-center gap-2 mt-1';
            const fkExactCheckbox = document.createElement('input');
            fkExactCheckbox.type = 'checkbox';
            fkExactCheckbox.id = `exact-${col.Field}-fk`;
            fkExactCheckbox.className = 'rounded';
            const fkExactLabel = document.createElement('label');
            fkExactLabel.htmlFor = `exact-${col.Field}-fk`;
            fkExactLabel.className = 'text-xs text-gray-600 dark:text-gray-400';
            fkExactLabel.textContent = 'Exact match';
            fkExactWrapper.appendChild(fkExactCheckbox);
            fkExactWrapper.appendChild(fkExactLabel);
            
            fkInput.addEventListener('input', debounce(() => {
                if (fkInput.value) {
                    activeSearchInput = 'fk';
                    // Clear ID search programmatically
                    const oldIdValue = idInput.value;
                    idInput.value = '';
                    // Format: ===FK===tableName===searchValue or ===FK_EXACT===tableName===searchValue
                    const prefix = fkExactCheckbox.checked ? '===FK_EXACT===' : '===FK===';
                    searchFilters[col.Field] = `${prefix}${foreignKey.foreign_table}===${fkInput.value}`;
                    currentPage = 1;
                    loadTableData();
                } else if (activeSearchInput === 'fk') {
                    // Only delete if this input was the active one
                    delete searchFilters[col.Field];
                    activeSearchInput = null;
                    currentPage = 1;
                    loadTableData();
                }
            }, 500));
            
            fkExactCheckbox.addEventListener('change', () => {
                if (fkInput.value) {
                    const prefix = fkExactCheckbox.checked ? '===FK_EXACT===' : '===FK===';
                    searchFilters[col.Field] = `${prefix}${foreignKey.foreign_table}===${fkInput.value}`;
                    currentPage = 1;
                    loadTableData();
                }
            });
            
            div.appendChild(fkInput);
            div.appendChild(fkExactWrapper);
        } else {
            // Regular text/number fields
            const inputWrapper = document.createElement('div');
            inputWrapper.className = 'flex flex-col';
            
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = `Filter ${col.Field}...`;
            input.className = 'px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 text-sm';
            
            // Add exact checkbox for text types
            const isTextType = col.Type.includes('char') || col.Type.includes('text');
            
            if (isTextType) {
                const exactWrapper = document.createElement('div');
                exactWrapper.className = 'flex items-center gap-2 mt-1';
                const exactCheckbox = document.createElement('input');
                exactCheckbox.type = 'checkbox';
                exactCheckbox.id = `exact-${col.Field}`;
                exactCheckbox.className = 'rounded';
                const exactLabel = document.createElement('label');
                exactLabel.htmlFor = `exact-${col.Field}`;
                exactLabel.className = 'text-xs text-gray-600 dark:text-gray-400';
                exactLabel.textContent = 'Exact match';
                exactWrapper.appendChild(exactCheckbox);
                exactWrapper.appendChild(exactLabel);
                
                input.addEventListener('input', debounce(() => {
                    if (input.value) {
                        const prefix = exactCheckbox.checked ? '===EXACT===' : '';
                        searchFilters[col.Field] = prefix + input.value;
                    } else {
                        delete searchFilters[col.Field];
                    }
                    currentPage = 1;
                    loadTableData();
                }, 500));
                
                exactCheckbox.addEventListener('change', () => {
                    if (input.value) {
                        const prefix = exactCheckbox.checked ? '===EXACT===' : '';
                        searchFilters[col.Field] = prefix + input.value;
                        currentPage = 1;
                        loadTableData();
                    }
                });
                
                inputWrapper.appendChild(input);
                inputWrapper.appendChild(exactWrapper);
                div.appendChild(inputWrapper);
            } else {
                input.addEventListener('input', debounce(() => {
                    searchFilters[col.Field] = input.value;
                    currentPage = 1;
                    loadTableData();
                }, 500));
                div.appendChild(input);
            }
        }
        
        container.appendChild(div);
    }
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Add row
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