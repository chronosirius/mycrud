// Load M2M relation
async function loadM2MRelation(m2m, rowId) {
    const tableName = window.location.pathname.split('/').pop();
    const relationName = m2m.name || m2m.other_table;
    
    const container = document.getElementById('m2m-relations');
    let section = container.querySelector(`[data-relation="${relationName}"]`);
    
    if (!section) {
        section = document.createElement('div');
        section.className = 'border border-gray-300 dark:border-gray-700 rounded-lg p-4 mb-4';
        section.setAttribute('data-relation', relationName);
        
        const title = document.createElement('h4');
        title.className = 'text-lg font-semibold mb-4';
        title.textContent = relationName;
        section.appendChild(title);
        
        const addForm = createM2MAddForm(m2m, relationName);
        section.appendChild(addForm);
        
        const listContainer = document.createElement('div');
        listContainer.className = 'mt-4';
        listContainer.setAttribute('data-relation-list', relationName);
        section.appendChild(listContainer);
        
        container.appendChild(section);
    }
    
    const listContainer = section.querySelector(`[data-relation-list="${relationName}"]`);
    
    listContainer.innerHTML = `
        <div class="text-center py-4">
            <div class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
    `;
    
    try {
        const response = await fetch(`/api/m2m/${tableName}/${rowId}/${relationName}`);
        const relations = await response.json();
        
        listContainer.innerHTML = '';
        
        if (relations && relations.length > 0) {
            const list = document.createElement('div');
            list.className = 'space-y-2';
            
            for (const rel of relations) {
                const item = document.createElement('div');
                item.className = 'flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded-lg';
                
                const info = document.createElement('div');
                const displayCols = m2m.display_columns || [m2m.other_display_column];
                const displayText = displayCols.map(c => rel[c]).filter(v => v).join(' ');
                info.textContent = displayText;
                
                const extraText = [];
                for (const col of m2m.extra_columns || []) {
                    if (rel[col] !== null && rel[col] !== undefined) {
                        extraText.push(`${col}: ${rel[col]}`);
                    }
                }
                if (extraText.length > 0) {
                    const extra = document.createElement('span');
                    extra.className = 'text-sm text-gray-500 dark:text-gray-400 ml-2';
                    extra.textContent = `(${extraText.join(', ')})`;
                    info.appendChild(extra);
                }
                
                item.appendChild(info);
                
                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = 'Remove';
                deleteBtn.className = 'px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700';
                deleteBtn.onclick = async () => {
                    const relatedId = rel.related_id || rel[m2m.fk_other] || rel.id || rel[Object.keys(rel)[0]];
                    const response = await fetch(`/api/m2m/${tableName}/${currentRowId}/${relationName}/${relatedId}`, {
                        method: 'DELETE'
                    });
                    
                    const result = await response.json();
                    if (result.success) {
                        await loadM2MRelation(m2m, currentRowId);
                    } else {
                        alert(`Error: ${result.error}`);
                    }
                };
                item.appendChild(deleteBtn);
                
                list.appendChild(item);
            }
            
            listContainer.appendChild(list);
        } else {
            const empty = document.createElement('p');
            empty.className = 'text-gray-500 dark:text-gray-400 text-sm';
            empty.textContent = 'No relationships found.';
            listContainer.appendChild(empty);
        }
        
    } catch (error) {
        console.error('Error loading M2M relation:', error);
        listContainer.innerHTML = `
            <p class="text-red-600 dark:text-red-400">Error loading relationships: ${error.message}</p>
        `;
    }
    
    return section;
}

// Create the add form for M2M
function createM2MAddForm(m2m, relationName) {
    const tableName = window.location.pathname.split('/').pop();
    
    const addForm = document.createElement('div');
    addForm.className = 'mb-4 flex gap-2 items-end flex-wrap';
    
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'flex-1 min-w-[300px]';
    
    const label = document.createElement('label');
    label.className = 'text-sm font-medium mb-1 block';
    label.textContent = `Add ${m2m.other_table}`;
    inputWrapper.appendChild(label);
    
    const wrapper = document.createElement('div');
    wrapper.className = 'relative';
    
    const idInput = document.createElement('input');
    idInput.type = 'number';
    idInput.placeholder = 'ID';
    idInput.className = 'px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 w-32';
    idInput.setAttribute('data-m2m-id-input', 'true');
    
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = `Search...`;
    searchInput.className = 'flex-1 px-3 py-2 ml-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500';
    searchInput.setAttribute('data-m2m-search-input', 'true');
    
    const chipDisplay = document.createElement('div');
    chipDisplay.className = 'hidden px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-lg cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30';
    chipDisplay.setAttribute('data-m2m-chip', 'true');
    chipDisplay.onclick = () => {
        idInput.value = '';
        searchInput.value = '';
        idInput.classList.remove('hidden');
        searchInput.classList.remove('hidden');
        chipDisplay.classList.add('hidden');
        idInput.classList.remove('border-red-500', 'border-green-500', 'border-yellow-500');
        searchInput.focus();
    };
    
    const chipText = document.createElement('div');
    chipText.className = 'text-sm';
    chipDisplay.appendChild(chipText);
    
    const showChipForM2M = async (fkValue) => {
        if (!fkValue) return false;
        
        try {
            const displayColumns = m2m.display_columns || [m2m.other_display_column];
            
            // Fetch the actual row data using the get endpoint
            const response = await fetch(`/api/table/${m2m.other_table}/row/${fkValue}`);
            
            if (!response.ok) {
                console.error('Failed to fetch row data');
                return false;
            }
            
            const rowData = await response.json();
            
            if (rowData && !rowData.error) {
                const displayParts = displayColumns.map(c => {
                    const val = rowData[c];
                    return val ? `${c}: ${val}` : '';
                }).filter(v => v);
                const displayText = displayParts.join(' | ');
                chipText.innerHTML = `<strong>Selected:</strong> ${displayText} <span class="text-gray-600 dark:text-gray-400">(ID: ${fkValue})</span>`;
                
                idInput.classList.add('hidden');
                searchInput.classList.add('hidden');
                chipDisplay.classList.remove('hidden');
                return true;
            }
        } catch (e) {
            console.error('Error loading M2M chip:', e);
        }
        return false;
    };
    
    idInput.addEventListener('blur', async (e) => {
        setTimeout(async () => {
            if (idInput.value) {
                const isValid = await validateM2MForeignKey(m2m.other_table, idInput.value, idInput);
                if (isValid) {
                    await showChipForM2M(idInput.value);
                }
            }
        }, 200);
    });
    
    idInput.addEventListener('input', () => {
        idInput.classList.remove('border-red-500', 'border-green-500', 'border-yellow-500');
    });
    
    const inputGroup = document.createElement('div');
    inputGroup.className = 'flex gap-2';
    inputGroup.appendChild(idInput);
    inputGroup.appendChild(searchInput);
    
    const searchResults = document.createElement('div');
    searchResults.className = 'absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto hidden';
    
    let searchTimeout;
    searchInput.addEventListener('input', async () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            const query = String(searchInput.value || '').trim();
            if (query.length < 2) {
                searchResults.classList.add('hidden');
                return;
            }
            
            const columns = m2m.search_columns ? m2m.search_columns.join(',') : 'id';
            const params = new URLSearchParams({
                q: query,
                columns: columns
            });
            
            const response = await fetch(`/api/search/${m2m.other_table}?${params}`);
            const results = await response.json();
            
            searchResults.innerHTML = '';
            if (results.length === 0) {
                searchResults.innerHTML = '<div class="px-3 py-2 text-gray-500">No results found</div>';
            } else {
                for (const result of results) {
                    const item = document.createElement('div');
                    item.className = 'px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer';
                    const displayCols = m2m.display_columns || [m2m.other_display_column];
                    const displayText = displayCols.map(c => result[c]).filter(v => v).join(' | ');
                    
                    const otherTablePks = config.PRIMARY_KEYS || {};
                    let pkField = otherTablePks[m2m.other_table];
                    if (Array.isArray(pkField)) {
                        pkField = pkField[0];
                    }
                    if (!pkField) {
                        pkField = 'id';
                    }
                    
                    const otherTablePk = result[pkField];
                    item.textContent = `${otherTablePk}: ${displayText}`;
                    item.addEventListener('click', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        idInput.value = otherTablePk;
                        searchInput.value = '';
                        searchResults.classList.add('hidden');
                        const isValid = await validateM2MForeignKey(m2m.other_table, otherTablePk.toString(), idInput);
                        if (isValid) {
                            await showChipForM2M(otherTablePk);
                        }
                    });
                    searchResults.appendChild(item);
                }
            }
            searchResults.classList.remove('hidden');
        }, 300);
    });
    
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            searchResults.classList.add('hidden');
        }
    });
    
    wrapper.appendChild(inputGroup);
    wrapper.appendChild(chipDisplay);
    wrapper.appendChild(searchResults);
    inputWrapper.appendChild(wrapper);
    addForm.appendChild(inputWrapper);
    
    const extraInputs = {};
    for (const extraCol of m2m.extra_columns || []) {
        const extraWrapper = document.createElement('div');
        extraWrapper.className = 'flex flex-col';
        
        const extraLabel = document.createElement('label');
        extraLabel.className = 'text-sm font-medium mb-1';
        extraLabel.textContent = extraCol;
        extraWrapper.appendChild(extraLabel);
        
        const extraInput = document.createElement('input');
        extraInput.type = 'number';
        extraInput.step = '0.01';
        extraInput.placeholder = extraCol;
        extraInput.className = 'px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500';
        extraWrapper.appendChild(extraInput);
        
        addForm.appendChild(extraWrapper);
        extraInputs[extraCol] = extraInput;
    }
    
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add';
    addBtn.className = 'px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 self-end';
    addBtn.onclick = async () => {
        const idValue = String(idInput.value || '').trim();
        
        if (!idValue) {
            alert('Please enter or select an ID');
            return;
        }
        
        const isValid = await validateM2MForeignKey(m2m.other_table, idValue, idInput);
        if (!isValid) {
            alert('Invalid ID. Please select a valid record.');
            return;
        }
        
        const relationData = {
            id: idValue
        };
        
        for (const [col, input] of Object.entries(extraInputs)) {
            if (input.value) {
                relationData[col] = input.value;
            }
        }
        
        const response = await fetch(`/api/m2m/${tableName}/${currentRowId}/${relationName}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(relationData)
        });
        
        const result = await response.json();
        if (result.success) {
            idInput.value = '';
            searchInput.value = '';
            for (const input of Object.values(extraInputs)) {
                input.value = '';
            }
            idInput.classList.remove('border-red-500', 'border-green-500', 'border-yellow-500', 'hidden');
            searchInput.classList.remove('hidden');
            chipDisplay.classList.add('hidden');
            
            await loadM2MRelation(m2m, currentRowId);
        } else {
            alert(`Error: ${result.error}`);
        }
    };
    addForm.appendChild(addBtn);
    
    return addForm;
}

async function openExpandedView(row) {
    const modal = document.getElementById('expanded-modal');
    const form = document.getElementById('editRowForm');
    const m2mContainer = document.getElementById('m2m-relations');
    
    form.innerHTML = '';
    m2mContainer.innerHTML = '';
    
    const primaryKeys = Array.isArray(schema.primary_keys) ? schema.primary_keys : [schema.primary_keys];
    currentRowId = primaryKeys.map(pk => row[pk]).join('/');
    currentRowData = row;
    
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
    
    renderPluginButtons();
    
    modal.classList.remove('hidden');
}

function createContributorManagement(row, writeOnlyConfig, isOwner, contributors) {
    const tableName = window.location.pathname.split('/').pop();
    
    const section = document.createElement('div');
    section.className = 'border border-gray-300 dark:border-gray-700 rounded-lg p-6 mb-6 bg-green-50 dark:bg-green-900/10';
    section.setAttribute('data-contributor-section', 'true');
    
    const title = document.createElement('h4');
    title.className = 'text-2xl font-bold mb-6 text-gray-700 dark:text-gray-300';
    title.textContent = 'Contributors & Sharing';
    section.appendChild(title);
    
    const currentSection = document.createElement('div');
    currentSection.className = 'bg-blue-100 dark:bg-blue-900/20 rounded-lg p-4 mb-6';
    
    const currentTitle = document.createElement('h5');
    currentTitle.className = 'text-lg font-semibold mb-3 text-gray-800 dark:text-gray-200';
    currentTitle.textContent = 'Current Contributors:';
    currentSection.appendChild(currentTitle);
    
    const chipsContainer = document.createElement('div');
    chipsContainer.className = 'flex flex-wrap gap-2 bg-white dark:bg-gray-800 rounded-lg p-4';
    
    if (contributors && contributors.length > 0) {
        for (let i = 0; i < contributors.length; i++) {
            const contributorName = contributors[i];
            
            const chip = document.createElement('div');
            chip.className = i === 0 
                ? 'inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg font-medium'
                : 'inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg font-medium';
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = i === 0 ? `${contributorName} (Owner)` : contributorName;
            chip.appendChild(nameSpan);
            
            if (i > 0 && isOwner) {
                const removeBtn = document.createElement('button');
                removeBtn.innerHTML = '×';
                removeBtn.className = 'text-white hover:text-red-200 font-bold text-xl leading-none';
                removeBtn.onclick = async (e) => {
                    e.stopPropagation();
                    
                    const response = await fetch(`/api/contrib/${tableName}/row/${currentRowId}`, {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            contributor: contributorName
                        })
                    });
                    
                    const result = await response.json();
                    if (result.success) {
                        const rowResponse = await fetch(`/api/table/${tableName}/row/${currentRowId}`);
                        const updatedRow = await rowResponse.json();
                        
                        const oldSection = document.querySelector('[data-contributor-section]');
                        const newSection = createContributorManagement(
                            updatedRow, 
                            writeOnlyConfig, 
                            updatedRow._is_owner, 
                            updatedRow._contributors
                        );
                        oldSection.replaceWith(newSection);
                    } else {
                        alert(`Error: ${result.error}`);
                    }
                };
                chip.appendChild(removeBtn);
            }
            
            chipsContainer.appendChild(chip);
        }
    } else {
        const empty = document.createElement('p');
        empty.className = 'text-gray-500 dark:text-gray-400 text-sm';
        empty.textContent = 'No contributors yet.';
        chipsContainer.appendChild(empty);
    }
    
    currentSection.appendChild(chipsContainer);
    section.appendChild(currentSection);
    
    if (isOwner) {
        const addSection = document.createElement('div');
        addSection.className = 'mt-6';
        
        const addTitle = document.createElement('h5');
        addTitle.className = 'text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200';
        addTitle.textContent = 'Add New Contributor';
        addSection.appendChild(addTitle);
        
        const note = document.createElement('p');
        note.className = 'text-sm italic text-gray-600 dark:text-gray-400 mb-4';
        note.textContent = 'Note: Only the owner can add or remove other contributors.';
        addSection.appendChild(note);
        
        const addForm = document.createElement('div');
        addForm.className = 'flex gap-2';
        
        const usernameInput = document.createElement('input');
        usernameInput.type = 'text';
        usernameInput.placeholder = 'Enter username to add';
        usernameInput.className = 'flex-1 px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-green-500 text-base';
        addForm.appendChild(usernameInput);
        
        const addBtn = document.createElement('button');
        addBtn.textContent = 'Add Contributor';
        addBtn.className = 'px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium text-base';
        addBtn.onclick = async () => {
            const newUsername = usernameInput.value.trim();
            if (!newUsername) {
                alert('Please enter a username');
                return;
            }
            
            if (contributors.includes(newUsername)) {
                alert('This user is already a contributor');
                return;
            }
            
            const response = await fetch(`/api/contrib/${tableName}/row/${currentRowId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contributor: newUsername
                })
            });
            
            const result = await response.json();
            if (result.success) {
                const rowResponse = await fetch(`/api/table/${tableName}/row/${currentRowId}`);
                const updatedRow = await rowResponse.json();
                
                const oldSection = document.querySelector('[data-contributor-section]');
                const newSection = createContributorManagement(
                    updatedRow, 
                    writeOnlyConfig, 
                    updatedRow._is_owner, 
                    updatedRow._contributors
                );
                oldSection.replaceWith(newSection);
                
                usernameInput.value = '';
            } else {
                alert(`Error: ${result.error}`);
            }
        };
        addForm.appendChild(addBtn);
        
        addSection.appendChild(addForm);
        section.appendChild(addSection);
    }
    
    return section;
}

function closeExpandedView() {
    const modal = document.getElementById('expanded-modal');
    modal.classList.add('hidden');
    currentRowId = null;
    currentRowData = null;
}

async function submitEditRow() {
    const form = document.getElementById('editRowForm');
    const formData = new FormData(form);
    const data = {};
    
    for (const [key, value] of formData.entries()) {
        data[key] = value || null;
    }
    
    const tableName = window.location.pathname.split('/').pop();
    const response = await fetch(`/api/table/${tableName}/row/${currentRowId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });
    
    const result = await response.json();
    const messageDiv = document.getElementById('edit-row-message');
    
    if (result.success) {
        messageDiv.className = 'mt-4 p-4 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200 rounded-lg';
        messageDiv.textContent = 'Row updated successfully!';
        loadTableData();
    } else {
        messageDiv.className = 'mt-4 p-4 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 rounded-lg';
        messageDiv.textContent = `Error: ${result.error}`;
    }
    
    messageDiv.classList.remove('hidden');
    setTimeout(() => messageDiv.classList.add('hidden'), 5000);
}

async function deleteRow() {
    if (!confirm('Are you sure you want to delete this row?')) {
        return;
    }
    
    const tableName = window.location.pathname.split('/').pop();
    const response = await fetch(`/api/table/${tableName}/row/${currentRowId}`, {
        method: 'DELETE'
    });
    
    const result = await response.json();
    
    if (result.success) {
        closeExpandedView();
        loadTableData();
    } else {
        const messageDiv = document.getElementById('edit-row-message');
        messageDiv.className = 'mt-4 p-4 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 rounded-lg';
        messageDiv.textContent = `Error: ${result.error}`;
        messageDiv.classList.remove('hidden');
        setTimeout(() => messageDiv.classList.add('hidden'), 5000);
    }
}

// Plugin system
const registeredPlugins = {};
let currentRowData = null;

function registerPlugin(pluginName, buttons) {
    if (!Array.isArray(buttons)) {
        console.error('registerPlugin: buttons must be an array');
        return;
    }
    
    registeredPlugins[pluginName] = buttons.map(btn => ({
        text: btn.text || 'Unnamed',
        onclick: typeof btn.onclick === 'function' ? btn.onclick : () => console.warn('No onclick handler')
    }));
}

function renderPluginButtons() {
    const container = document.getElementById('plugin-buttons-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    for (const [pluginName, buttons] of Object.entries(registeredPlugins)) {
        for (const btn of buttons) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = `${pluginName}: ${btn.text}`;
            button.className = 'px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700';
            button.onclick = (e) => {
                e.crudData = {
                    row: currentRowData,
                    rowId: currentRowId,
                    tableName: window.location.pathname.split('/').pop(),
                    schema: schema
                };
                btn.onclick(e);
            };
            container.appendChild(button);
        }
    }
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('expanded-modal');
        if (modal && !modal.classList.contains('hidden')) {
            closeExpandedView();
        }
    }
});