// script.js

// --- Configuration ---
const API_BASE_URL = 'http://127.0.0.1:5000/api'; // Ensure this matches your Flask app's address
const UPLOADS_BASE_URL = 'http://127.0.0.1:5000/uploads'; // New: Base URL for serving uploaded images

// --- Utility Functions ---
function showPage(pageId) {
    document.querySelectorAll('.page-content').forEach(page => {
        page.classList.add('hidden');
    });
    document.getElementById(`page-${pageId}`).classList.remove('hidden');

    // Update active state in sidebar navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    const activeLink = document.querySelector(`.nav-link[data-page="${pageId}"]`);
    if (activeLink) {
        activeLink.classList.add('active');
    }

    // Specific actions for each page
    if (pageId === 'dashboard') {
        fetchDashboardSummary();
        fetchUserReports(localStorage.getItem('userContact') || ''); // Load recent reports if contact is known
    } else if (pageId === 'browse') {
        fetchFoundItems();
    } else if (pageId === 'my-reports') {
        const contactInput = document.getElementById('my-reports-contact-input');
        const storedContact = localStorage.getItem('userContact');
        if (storedContact) {
            contactInput.value = storedContact;
            fetchUserReports(storedContact);
        } else {
            // Clear table if no contact info is stored
            document.getElementById('my-reports-table-body').innerHTML = `
                <tr><td colspan="6" class="text-center py-4 text-gray-500">Please enter your contact info to view reports.</td></tr>
            `;
        }
    } else if (pageId === 'admin-items') {
        fetchAllItemsAdmin();
    } else if (pageId === 'report') {
        // Set current date/time for report-date input
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        document.getElementById('report-date').value = now.toISOString().slice(0,16);
    }
}

function formatDate(isoString) {
    if (!isoString) return 'N/A';
    const date = new Date(isoString);
    return date.toLocaleString(); // e.g., "10/25/2023, 10:30:00 AM"
}

function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `fixed bottom-4 right-4 p-4 rounded-md shadow-lg text-white ${isError ? 'bg-red-500' : 'bg-green-500'} transition-opacity duration-300`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
}

// --- API Calls ---

async function fetchDashboardSummary() {
    try {
        const response = await fetch(`${API_BASE_URL}/dashboard/summary`);
        const data = await response.json();
        document.getElementById('dashboard-open-lost').textContent = data.open_lost_items;
        document.getElementById('dashboard-open-found').textContent = data.open_found_items;
        document.getElementById('dashboard-total-resolved').textContent = data.total_resolved_items;
    } catch (error) {
        console.error('Error fetching dashboard summary:', error);
        showToast('Failed to load dashboard summary.', true);
    }
}

async function fetchFoundItems() {
    const search = document.getElementById('search-input').value;
    const category = document.getElementById('category-filter').value;
    const location = document.getElementById('location-filter').value;

    let url = `${API_BASE_URL}/found-items?`;
    if (search) url += `search=${encodeURIComponent(search)}&`;
    if (category !== 'all') url += `category=${encodeURIComponent(category)}&`;
    if (location !== 'all') url += `location=${encodeURIComponent(location)}&`;

    try {
        const response = await fetch(url);
        const items = await response.json();
        renderFoundItems(items);
    } catch (error) {
        console.error('Error fetching found items:', error);
        showToast('Failed to load found items.', true);
        document.getElementById('item-grid').innerHTML = `
            <p class="col-span-full text-center text-red-500 py-8">Error loading items. Please try again.</p>
        `;
    }
}

async function fetchItemDetail(itemId) {
    try {
        const response = await fetch(`${API_BASE_URL}/found-items/${itemId}`);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to fetch item details.');
        }
        const item = await response.json();
        renderItemDetail(item);
        showPage('detail');
    } catch (error) {
        console.error('Error fetching item detail:', error);
        showToast(error.message || 'Failed to load item details.', true);
        showPage('browse'); // Go back to browse on error
    }
}

async function submitReportForm(formData) {
    try {
        const response = await fetch(`${API_BASE_URL}/report-item`, {
            method: 'POST',
            body: formData // FormData will set Content-Type: multipart/form-data automatically
        });
        const result = await response.json();
        if (response.ok) {
            showToast('Item reported successfully!');
            document.getElementById('report-item-form').reset();
            localStorage.setItem('userContact', formData.get('contact_info')); // Save contact info
            showPage('my-reports'); // Go to my reports to see the new item
        } else {
            showToast(`Error: ${result.error}`, true);
        }
    } catch (error) {
        console.error('Error reporting item:', error);
        showToast('Failed to report item. Network error or server unreachable.', true);
    }
}


async function claimItem(itemId, claimDetails, claimantContact) {
    try {
        const response = await fetch(`${API_BASE_URL}/items/${itemId}/claim`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ claim_detail: claimDetails, claimant_contact: claimantContact })
        });
        const result = await response.json();
        if (response.ok) {
            showToast('Item claimed successfully!');
            document.getElementById('claim-modal').classList.add('hidden');
            fetchItemDetail(itemId); // Refresh detail view
        } else {
            showToast(`Error claiming item: ${result.error}`, true);
        }
    } catch (error) {
        console.error('Error claiming item:', error);
        showToast('Failed to claim item. Network error.', true);
    }
}

async function fetchUserReports(contactInfo) {
    if (!contactInfo) {
        document.getElementById('my-reports-table-body').innerHTML = `
            <tr><td colspan="6" class="text-center py-4 text-gray-500">Please enter your contact info to view reports.</td></tr>
        `;
        document.getElementById('dashboard-recent-reports-list').innerHTML = `
            <li class="text-gray-500">No recent reports to display.</li>
        `;
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/my-reports/${encodeURIComponent(contactInfo)}`);
        const items = await response.json();
        renderUserReports(items);
        renderRecentDashboardReports(items); // Update dashboard too
    } catch (error) {
        console.error('Error fetching user reports:', error);
        showToast('Failed to load your reports.', true);
        document.getElementById('my-reports-table-body').innerHTML = `
            <tr><td colspan="6" class="text-center py-4 text-red-500">Error loading your reports.</td></tr>
        `;
    }
}

async function updateMyItem(itemId, reporterContact, formData) {
    try {
        formData.append('contact_info', reporterContact); // Ensure contact info is part of the form data
        const response = await fetch(`${API_BASE_URL}/my-items/${itemId}/update`, {
            method: 'PUT',
            body: formData
        });
        const result = await response.json();
        if (response.ok) {
            showToast('Item updated successfully!');
            document.getElementById('edit-item-modal').classList.add('hidden');
            fetchUserReports(reporterContact); // Refresh user reports list
        } else {
            showToast(`Error updating item: ${result.error}`, true);
        }
    } catch (error) {
        console.error('Error updating item:', error);
        showToast('Failed to update item. Network error.', true);
    }
}

async function closeMyItem(itemId, reporterContact) {
    if (!confirm('Are you sure you want to mark this item as closed? This action cannot be undone.')) {
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/my-items/${itemId}/close`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact_info: reporterContact })
        });
        const result = await response.json();
        if (response.ok) {
            showToast('Item successfully closed!');
            fetchUserReports(reporterContact); // Refresh user reports list
        } else {
            showToast(`Error closing item: ${result.error}`, true);
        }
    } catch (error) {
        console.error('Error closing item:', error);
        showToast('Failed to close item. Network error.', true);
    }
}

async function fetchAllItemsAdmin() {
    try {
        const response = await fetch(`${API_BASE_URL}/admin/all-items`);
        const items = await response.json();
        renderAdminItems(items);
    } catch (error) {
        console.error('Error fetching all items for admin:', error);
        showToast('Failed to load all items for admin.', true);
        document.getElementById('admin-items-table-body').innerHTML = `
            <tr><td colspan="7" class="text-center py-4 text-red-500">Error loading items for admin.</td></tr>
        `;
    }
}

async function deleteItemAdmin(itemId) {
    if (!confirm(`Are you sure you want to PERMANENTLY delete item ID ${itemId}? This action cannot be undone.`)) {
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/admin/items/${itemId}/delete`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (response.ok) {
            showToast(`Item ${itemId} deleted successfully (Admin).`);
            fetchAllItemsAdmin(); // Refresh admin list
        } else {
            showToast(`Error deleting item (Admin): ${result.error}`, true);
        }
    } catch (error) {
        console.error('Error deleting item (Admin):', error);
        showToast('Failed to delete item (Admin). Network error.', true);
    }
}


// --- Rendering Functions ---

function renderFoundItems(items) {
    const itemGrid = document.getElementById('item-grid');
    itemGrid.innerHTML = ''; // Clear previous items

    if (items.length === 0) {
        itemGrid.innerHTML = '<p class="col-span-full text-center text-gray-500 py-8">No found items matching your criteria.</p>';
        return;
    }

    items.forEach(item => {
        const imageUrl = item.image_filename ? `${UPLOADS_BASE_URL}/${item.image_filename}` : 'https://placehold.co/600x400/CCCCCC/000000?text=No+Image';
        const itemCard = `
            <div class="item-card bg-white rounded-lg shadow-md overflow-hidden transform hover:scale-105 transition-transform duration-200 cursor-pointer" data-id="${item.id}">
                <img src="${imageUrl}" alt="${item.description}" class="w-full h-48 object-cover">
                <div class="p-4">
                    <h3 class="text-xl font-semibold text-gray-800 mb-2">${item.category}</h3>
                    <p class="text-gray-600 text-sm mb-2">${item.description.substring(0, 70)}${item.description.length > 70 ? '...' : ''}</p>
                    <div class="flex justify-between items-center text-sm text-gray-500">
                        <span><i class="fas fa-map-marker-alt mr-1"></i> ${item.location || 'Unknown'}</span>
                        <span><i class="fas fa-calendar-alt mr-1"></i> ${formatDate(item.report_date)}</span>
                    </div>
                    <span class="inline-block mt-2 px-3 py-1 text-xs font-semibold rounded-full ${item.status === 'open' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}">
                        ${item.status}
                    </span>
                </div>
            </div>
        `;
        itemGrid.innerHTML += itemCard;
    });

    // Add event listeners to newly rendered cards
    itemGrid.querySelectorAll('.item-card').forEach(card => {
        card.addEventListener('click', (e) => {
            const itemId = e.currentTarget.dataset.id;
            fetchItemDetail(itemId);
        });
    });
}

function renderItemDetail(item) {
    const imageUrl = item.image_filename ? `${UPLOADS_BASE_URL}/${item.image_filename}` : 'https://placehold.co/600x400/CCCCCC/000000?text=No+Image';

    document.getElementById('detail-name').textContent = `${item.category} (${item.item_type === 'found' ? 'Found' : 'Lost'})`;
    document.getElementById('detail-image').src = imageUrl;
    document.getElementById('detail-category').textContent = item.category;
    document.getElementById('detail-location').textContent = item.location || 'Unknown';
    document.getElementById('detail-date').textContent = formatDate(item.report_date);
    document.getElementById('detail-description').textContent = item.description;

    const claimBtn = document.getElementById('claim-item-btn');
    claimBtn.dataset.id = item.id; // Store item ID on the button
    
    // Only show claim button for open found items
    if (item.item_type === 'found' && item.status === 'open') {
        claimBtn.classList.remove('hidden');
    } else {
        claimBtn.classList.add('hidden');
    }
}


function renderUserReports(items) {
    const tableBody = document.getElementById('my-reports-table-body');
    tableBody.innerHTML = '';

    if (items.length === 0) {
        tableBody.innerHTML = `
            <tr><td colspan="6" class="text-center py-4 text-gray-500">You have no reported items yet.</td></tr>
        `;
        return;
    }

    items.forEach(item => {
        const row = `
            <tr>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${item.category}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">${item.item_type}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${item.location || 'N/A'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(item.report_date)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                    ${item.status === 'open' ? 'bg-green-100 text-green-800' :
                       item.status === 'claimed' ? 'bg-blue-100 text-blue-800' :
                       'bg-gray-100 text-gray-800'}">
                        ${item.status}
                    </span>
                    ${item.status === 'claimed' && item.claim_details ? `<br><small class="text-gray-500 italic">Claim: ${item.claim_details.substring(0, 30)}...</small>` : ''}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    ${item.status === 'open' ? `
                        <button class="text-indigo-600 hover:text-indigo-900 mr-2 edit-my-item-btn" data-id="${item.id}" data-contact="${item.contact_info}" data-item='${JSON.stringify(item)}'>Edit</button>
                        <button class="text-red-600 hover:text-red-900 close-my-item-btn" data-id="${item.id}" data-contact="${item.contact_info}">Close</button>
                    ` : `<span class="text-gray-400">No actions</span>`}
                </td>
            </tr>
        `;
        tableBody.innerHTML += row;
    });

    // Add event listeners for edit and close buttons
    tableBody.querySelectorAll('.edit-my-item-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const itemId = e.currentTarget.dataset.id;
            const itemContact = e.currentTarget.dataset.contact;
            const itemData = JSON.parse(e.currentTarget.dataset.item); // Get full item data

            document.getElementById('edit-item-id').value = itemId;
            document.getElementById('edit-item-reporter-contact').value = itemContact;
            document.getElementById('edit-category').value = itemData.category;
            document.getElementById('edit-description').value = itemData.description;
            document.getElementById('edit-location').value = itemData.location;
            // No need to set value for file input, as it's read-only for security reasons.
            // document.getElementById('edit-item-photo').value will remain empty.
            
            document.getElementById('edit-item-modal').classList.remove('hidden');
        });
    });

    tableBody.querySelectorAll('.close-my-item-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const itemId = e.currentTarget.dataset.id;
            const itemContact = e.currentTarget.dataset.contact;
            closeMyItem(itemId, itemContact);
        });
    });
}

function renderRecentDashboardReports(items) {
    const recentReportsList = document.getElementById('dashboard-recent-reports-list');
    recentReportsList.innerHTML = '';

    if (items.length === 0) {
        recentReportsList.innerHTML = '<li class="text-gray-500">No recent reports to display.</li>';
        return;
    }

    // Show up to 5 most recent reports
    items.slice(0, 5).forEach(item => {
        const listItem = `
            <li class="flex items-center justify-between py-2 border-b border-gray-200 last:border-b-0">
                <div>
                    <span class="font-medium text-gray-800">${item.category} (${item.item_type})</span>
                    <span class="text-sm text-gray-500 ml-2">${item.location || 'N/A'}</span>
                </div>
                <span class="px-2 py-1 text-xs font-semibold rounded-full 
                    ${item.status === 'open' ? 'bg-green-100 text-green-800' :
                       item.status === 'claimed' ? 'bg-blue-100 text-blue-800' :
                       'bg-gray-100 text-gray-800'}">
                    ${item.status}
                </span>
            </li>
        `;
        recentReportsList.innerHTML += listItem;
    });
}


function renderAdminItems(items) {
    const tableBody = document.getElementById('admin-items-table-body');
    tableBody.innerHTML = '';

    if (items.length === 0) {
        tableBody.innerHTML = `
            <tr><td colspan="7" class="text-center py-4 text-gray-500">No items in the database.</td></tr>
        `;
        return;
    }

    items.forEach(item => {
        const row = `
            <tr>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${item.id}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">${item.item_type}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${item.category}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${item.location || 'N/A'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${item.contact_info}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                    ${item.status === 'open' ? 'bg-green-100 text-green-800' :
                       item.status === 'claimed' ? 'bg-blue-100 text-blue-800' :
                       'bg-gray-100 text-gray-800'}">
                        ${item.status}
                    </span>
                    ${item.status === 'claimed' && item.claimed_by_contact ? `<br><small class="text-gray-500 italic">Claimant: ${item.claimed_by_contact}</small>` : ''}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button class="text-red-600 hover:text-red-900 delete-item-admin-btn" data-id="${item.id}">Delete</button>
                </td>
            </tr>
        `;
        tableBody.innerHTML += row;
    });

    // Add event listeners for delete buttons
    tableBody.querySelectorAll('.delete-item-admin-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const itemId = e.currentTarget.dataset.id;
            deleteItemAdmin(itemId);
        });
    });
}


// --- Event Listeners ---

// Sidebar Navigation
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = e.currentTarget.dataset.page;
        const itemType = e.currentTarget.dataset.itemType; // For report links
        showPage(page);

        if (page === 'report' && itemType) {
            document.getElementById('report-page-title').textContent = `Report ${itemType === 'lost' ? 'Lost' : 'Found'} Item`;
            document.getElementById('report_item_type').value = itemType; // Set hidden input value
        }
    });
});

// Dashboard Quick Actions
document.querySelectorAll('.dashboard-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const page = e.currentTarget.dataset.page;
        const itemType = e.currentTarget.dataset.itemType;
        showPage(page);
        if (page === 'report' && itemType) {
            document.getElementById('report-page-title').textContent = `Report ${itemType === 'lost' ? 'Lost' : 'Found'} Item`;
            document.getElementById('report_item_type').value = itemType;
        }
    });
});


// Report Item Form Submission
document.getElementById('report-item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    // Add report_date explicitly, as datetime-local value might not be directly picked by FormData reliably
    // and we need it in ISO format.
    const reportDate = new Date(document.getElementById('report-date').value);
    formData.set('report_date', reportDate.toISOString());

    // The 'item_type' is already set in a hidden input on form load by showPage
    // formData.append('item_type', document.getElementById('report_item_type').value);

    await submitReportForm(formData);
});

// Browse Filters
document.getElementById('search-input').addEventListener('input', fetchFoundItems);
document.getElementById('category-filter').addEventListener('change', fetchFoundItems);
document.getElementById('location-filter').addEventListener('change', fetchFoundItems);
document.getElementById('clear-filters').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    document.getElementById('category-filter').value = 'all';
    document.getElementById('location-filter').value = 'all';
    fetchFoundItems();
});


// Claim Item Modal
document.getElementById('claim-item-btn').addEventListener('click', (e) => {
    const itemId = e.currentTarget.dataset.id;
    document.getElementById('submit-claim-btn').dataset.id = itemId; // Pass ID to submit button
    document.getElementById('claim-modal').classList.remove('hidden');
});

document.getElementById('cancel-claim-btn').addEventListener('click', () => {
    document.getElementById('claim-modal').classList.add('hidden');
    document.getElementById('claim-contact-input').value = '';
    document.getElementById('claim-detail-input').value = '';
});

document.getElementById('submit-claim-btn').addEventListener('click', async (e) => {
    const itemId = e.currentTarget.dataset.id;
    const claimantContact = document.getElementById('claim-contact-input').value;
    const claimDetails = document.getElementById('claim-detail-input').value;

    if (!claimantContact || !claimDetails) {
        showToast('Please provide both contact info and a unique detail to claim.', true);
        return;
    }
    await claimItem(itemId, claimDetails, claimantContact);
    localStorage.setItem('userContact', claimantContact); // Save contact info
});


// My Reports Page
document.getElementById('view-my-reports-btn').addEventListener('click', () => {
    const contactInput = document.getElementById('my-reports-contact-input');
    const contactInfo = contactInput.value.trim();
    if (contactInfo) {
        localStorage.setItem('userContact', contactInfo); // Store for future visits
        fetchUserReports(contactInfo);
    } else {
        showToast('Please enter your contact information.', true);
    }
});

// Edit Item Modal
document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    document.getElementById('edit-item-modal').classList.add('hidden');
});

document.getElementById('edit-item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const itemId = document.getElementById('edit-item-id').value;
    const reporterContact = document.getElementById('edit-item-reporter-contact').value;

    const formData = new FormData();
    formData.append('category', form['edit-category'].value);
    formData.append('description', form['edit-description'].value);
    formData.append('location', form['edit-location'].value);

    const itemPhotoInput = document.getElementById('edit-item-photo');
    if (itemPhotoInput.files.length > 0) {
        formData.append('item_photo', itemPhotoInput.files[0]);
    }
    // If no new photo is uploaded, the backend should retain the existing one.
    // No need to explicitly send `image_filename` or `image_url` if a new file isn't present.

    await updateMyItem(itemId, reporterContact, formData);
});

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    showPage('dashboard');
});