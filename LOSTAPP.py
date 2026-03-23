#!/usr/bin/env python3

"""
===================================================================
Campus Lost & Found - Flask Web Backend (Using CSV/Pandas for Data Storage)
===================================================================

This script provides a Flask web API backend for the Campus Lost & Found
application, using a CSV file for data storage managed by the Pandas library.

**WARNING: This approach is NOT recommended for production, multi-user,
or concurrent web applications due to significant performance, concurrency,
and data integrity issues inherent in file-based storage for web servers.
It is provided as per user request for learning/prototyping purposes.**

-------------------------------------------------------------------
FEATURES INCLUDED:
-------------------------------------------------------------------
- CRUD operations (Create, Read, Update, Delete) for Lost/Found Items.
- Filtering and Searching for Found Items.
- Retrieval of a user's reported items.
- Admin/Moderation endpoints to view all items.
- Dashboard summary statistics.
- Basic item claiming/closure mechanism.
- Enhanced data fields.
- **NEW: Photo Upload functionality for items (stores path in CSV).**

-------------------------------------------------------------------
HOW TO RUN:
-------------------------------------------------------------------
1. Save this code as a single file named: LOSTAPP.py
2. Install required libraries:
    pip install Flask Flask-Cors pandas
3. Run the script:
    python3 LOSTAPP.py
4. A file named 'campus_lost_and_found.csv' will be created/used in
    the same directory as your Python script.
5. **A folder named 'uploads' will be created** in the same directory
   to store uploaded images. Ensure this folder exists and is writable.
-------------------------------------------------------------------
"""

from flask import Flask, request, jsonify, send_from_directory # Added send_from_directory
from flask_cors import CORS
import pandas as pd
import os
from datetime import datetime
import threading
import time
from werkzeug.utils import secure_filename # For securing filenames on upload

# --- Flask App Initialization ---
app = Flask(__name__)
CORS(app)

# --- Constants & Configuration ---
CSV_FILE = "campus_lost_and_found.csv"
UPLOAD_FOLDER = 'uploads' # New: Folder to store uploaded images
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'} # New: Allowed image file types

# Ensure the upload folder exists
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# Define column names explicitly for robust CSV handling
# All columns will be stored as strings to avoid type inference issues with Pandas.
COLUMNS = [
    'id', 'item_type', 'category', 'description', 'location',
    'report_date', 'status', 'contact_info', 'photo_path', # CHANGED: 'image_url' -> 'photo_path'
    'claim_details', 'claimed_by_contact'
]

# --- Global DataFrame and Lock for CSV Access ---
df = pd.DataFrame(columns=COLUMNS)
file_lock = threading.Lock() # For protecting CSV read/write operations

# --- Helper for file uploads ---
def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# --- CSV Data Management Functions ---
def load_data_from_csv():
    """Loads data from CSV into a global Pandas DataFrame."""
    global df
    with file_lock: # Protect file access
        if os.path.exists(CSV_FILE) and os.path.getsize(CSV_FILE) > 0: # Check if file exists and is not empty
            try:
                df = pd.read_csv(CSV_FILE, keep_default_na=False) # Important: Keep empty strings, don't convert to NaN
                
                if 'id' in df.columns:
                    df['id'] = pd.to_numeric(df['id'], errors='coerce').fillna(0).astype(int)
                else:
                    df['id'] = pd.Series(dtype='int')

                for col in COLUMNS:
                    if col not in df.columns:
                        df[col] = ''
                    if col != 'id':
                        df[col] = df[col].astype(str)
            except pd.errors.EmptyDataError:
                df = pd.DataFrame(columns=COLUMNS)
                df['id'] = pd.Series(dtype='int')
                print(f"[{datetime.now()}] CSV file '{CSV_FILE}' was empty, initialized new DataFrame.")
            except Exception as e:
                print(f"[{datetime.now()}] Error reading CSV '{CSV_FILE}', initializing empty DataFrame: {e}")
                df = pd.DataFrame(columns=COLUMNS)
                df['id'] = pd.Series(dtype='int')
        else:
            df = pd.DataFrame(columns=COLUMNS)
            df['id'] = pd.Series(dtype='int')
            print(f"[{datetime.now()}] CSV file '{CSV_FILE}' not found or empty, created new DataFrame structure.")
        print(f"[{datetime.now()}] Data loaded from {CSV_FILE}. {len(df)} records. df.dtypes for 'id': {df['id'].dtype}")


def save_data_to_csv(retries=5, delay=0.1):
    """Saves the global Pandas DataFrame to CSV."""
    global df
    for i in range(retries):
        with file_lock: # Protect file access
            try:
                if 'id' in df.columns:
                    df['id'] = pd.to_numeric(df['id'], errors='coerce').fillna(0).astype(int)
                
                for col in COLUMNS:
                    if col not in df.columns:
                        df[col] = ''
                    if col != 'id':
                        df[col] = df[col].astype(str)

                df.to_csv(CSV_FILE, index=False)
                print(f"[{datetime.now()}] Data saved to {CSV_FILE}. {len(df)} records.")
                return
            except Exception as e:
                print(f"[{datetime.now()}] Error saving CSV (attempt {i+1}/{retries}): {e}")
                time.sleep(delay)
    print(f"[{datetime.now()}] Failed to save data to CSV after {retries} attempts.")


# --- Initialization ---
load_data_from_csv()

# --- HELPER FUNCTIONS (for internal use by API endpoints) ---

def _get_next_id():
    """Generates a unique ID for new items."""
    global df
    with file_lock:
        if df.empty or df['id'].isnull().all():
            return 1
        return int(df['id'].max()) + 1

def _get_item_by_id(item_id):
    """Internal helper to fetch a single item by ID."""
    global df
    with file_lock:
        item_id = int(item_id)
        item = df[df['id'] == item_id]
        if not item.empty:
            return item.iloc[0].to_dict()
    return None

# --- API Endpoints ---

@app.route('/')
def home():
    """Basic root route to confirm API is running."""
    return "Welcome to the Campus Lost & Found Backend API!"

# --- Photo Serving Endpoint ---
@app.route('/uploads/<filename>')
def uploaded_file(filename):
    """
    Serves uploaded photos from the UPLOAD_FOLDER.
    """
    return send_from_directory(UPLOAD_FOLDER, filename)


# --- Public Facing Endpoints ---

@app.route('/api/found-items', methods=['GET'])
def get_public_found_items():
    """
    Fetches and returns a list of all 'found' items with 'open' status.
    Supports filtering by search keyword, category, and location.
    """
    global df
    search_keyword = request.args.get('search', '').lower()
    category_filter = request.args.get('category', 'all').lower()
    location_filter = request.args.get('location', 'all').lower()

    with file_lock:
        filtered_df = df[(df['item_type'] == 'found') & (df['status'] == 'open')].copy()

        if search_keyword:
            filtered_df = filtered_df[
                filtered_df['description'].str.lower().str.contains(search_keyword, na=False) |
                filtered_df['category'].str.lower().str.contains(search_keyword, na=False) |
                filtered_df['location'].str.lower().str.contains(search_keyword, na=False)
            ]
        
        if category_filter != 'all':
            filtered_df = filtered_df[filtered_df['category'].str.lower() == category_filter]
        
        if location_filter != 'all':
            filtered_df = filtered_df[filtered_df['location'].str.lower() == location_filter]

    filtered_df = filtered_df.sort_values(by='report_date', ascending=False)

    # CHANGED: 'image_url' -> 'photo_path'
    public_columns = ['id', 'category', 'description', 'location', 'report_date', 'status', 'photo_path']
    return jsonify(filtered_df[public_columns].to_dict(orient='records'))


@app.route('/api/found-items/<int:item_id>', methods=['GET'])
def get_public_found_item_detail(item_id):
    """
    Fetches and returns details for a single 'found' item by its ID,
    only if it is 'open'.
    """
    global df
    item = _get_item_by_id(item_id) 

    if item and item['item_type'] == 'found' and item['status'] == 'open':
        # CHANGED: 'image_url' -> 'photo_path'
        public_columns = ['id', 'category', 'description', 'location', 'report_date', 'status', 'photo_path', 'contact_info']
        return jsonify({k: item[k] for k in public_columns})
    else:
        return jsonify({"error": "Item not found, not a 'found' item, or not currently 'open'."}), 404


@app.route('/api/report-item', methods=['POST'])
def report_new_item():
    """
    API endpoint to handle reporting of a new 'lost' or 'found' item.
    EXPECTS FORMDATA (not JSON) due to file upload.
    """
    global df
    
    # CHANGED: Request now expects form data
    item_type = request.form.get('item_type')
    category = request.form.get('category')
    description = request.form.get('description')
    location = request.form.get('location')
    contact_info = request.form.get('contact_info')
    
    photo_path = '' # Initialize empty photo path

    # Handle file upload
    if 'item_photo' in request.files:
        file = request.files['item_photo']
        if file.filename != '' and allowed_file(file.filename):
            filename = secure_filename(file.filename)
            unique_filename = f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{filename}"
            file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
            file.save(file_path)
            photo_path = unique_filename # Store only the filename/path relative to UPLOAD_FOLDER
        else:
            return jsonify({"error": "Invalid file type for photo upload."}), 400

    # Basic server-side validation
    if not all([item_type, category, description, contact_info]):
        return jsonify({"error": "Missing required fields (item_type, category, description, contact_info)"}), 400
    
    if item_type not in ['lost', 'found']:
        return jsonify({"error": "Invalid item_type. Must be 'lost' or 'found'."}), 400

    new_id = _get_next_id()
    report_date = datetime.now().isoformat()
    status = "open" # Newly reported items are always 'open'

    new_item_data = {
        'id': new_id,
        'item_type': item_type,
        'category': category,
        'description': description,
        'location': location,
        'report_date': report_date,
        'status': status,
        'contact_info': contact_info,
        'photo_path': photo_path, # CHANGED: Uses the uploaded photo's path
        'claim_details': '',
        'claimed_by_contact': ''
    }
    
    row_to_add = {}
    for col in COLUMNS:
        if col == 'id':
            row_to_add[col] = new_item_data.get(col)
        else:
            row_to_add[col] = str(new_item_data.get(col, ''))

    df_new_row = pd.DataFrame([row_to_add])
    
    for col in COLUMNS:
        if col not in df_new_row.columns:
            df_new_row[col] = ''

    with file_lock:
        df = pd.concat([df, df_new_row], ignore_index=True)
        df['id'] = pd.to_numeric(df['id'], errors='coerce').fillna(0).astype(int)
    
    save_data_to_csv()
    return jsonify({"message": "Item reported successfully", "item": _get_item_by_id(new_id)}), 201


@app.route('/api/items/<int:item_id>/claim', methods=['PUT'])
def claim_item(item_id):
    """
    Allows a user to claim a 'found' item. This updates the status to 'claimed'
    and records claim details.
    """
    global df
    data = request.json
    claim_details = data.get('claim_detail')
    claimed_by_contact = data.get('claimant_contact')

    if not all([claim_details, claimed_by_contact]):
        return jsonify({"error": "Claim detail and claimant contact info are required."}), 400

    with file_lock:
        item_index = df[df['id'] == item_id].index
        if item_index.empty:
            return jsonify({"error": f"No item found with ID {item_id}."}), 404

        item = df.loc[item_index[0]]

        if item['item_type'] != 'found':
            return jsonify({"error": "Only 'found' items can be claimed."}), 400
        if item['status'] != 'open':
            return jsonify({"error": f"Item {item_id} is already '{item['status']}' and cannot be claimed."}), 400

        df.loc[item_index, 'status'] = 'claimed'
        df.loc[item_index, 'claim_details'] = str(claim_details)
        df.loc[item_index, 'claimed_by_contact'] = str(claimed_by_contact)
    
    save_data_to_csv()
    return jsonify({"message": f"Item {item_id} successfully marked as 'claimed'.", "item": _get_item_by_id(item_id)}), 200


# --- User-Specific Endpoints ---

@app.route('/api/my-reports/<string:contact_info>', methods=['GET'])
def get_user_reports(contact_info):
    """
    Fetches and returns all items (lost or found, open or closed)
    reported by a specific user contact.
    """
    global df
    with file_lock:
        user_reports = df[df['contact_info'].str.lower() == contact_info.lower()].copy()
    
    user_reports['report_date'] = pd.to_datetime(user_reports['report_date'], errors='coerce')
    user_reports = user_reports.sort_values(by='report_date', ascending=False).dropna(subset=['report_date'])

    # CHANGED: 'image_url' -> 'photo_path'
    report_columns = ['id', 'item_type', 'category', 'description', 'location', 'report_date', 'status', 'photo_path', 'claim_details']
    return jsonify(user_reports[report_columns].to_dict(orient='records'))


@app.route('/api/my-items/<int:item_id>/update', methods=['PUT'])
def update_my_item(item_id):
    """
    Allows a user to update details of an item they reported.
    Does NOT allow changing item_type or status directly.
    """
    global df
    
    # CHANGED: Request now expects form data for potential photo update, or JSON for text updates
    # This endpoint needs careful consideration. If it only accepts JSON, photo updates are tricky.
    # For simplicity, if a photo update is desired, the frontend would need to submit FormData.
    # Here, we'll allow both JSON for non-photo fields or FormData if a file is present.

    # Try to get data from JSON first, then from form for compatibility
    data = request.json if request.is_json else request.form

    contact_info_of_updater = data.get('contact_info')

    if not contact_info_of_updater:
        return jsonify({"error": "Contact information is required to update an item."}), 401

    with file_lock:
        item_index = df[df['id'] == item_id].index
        if item_index.empty:
            return jsonify({"error": f"Item with ID {item_id} not found."}), 404

        item = df.loc[item_index[0]]
        if item['contact_info'].lower() != contact_info_of_updater.lower():
            return jsonify({"error": "Unauthorized: You can only update items you reported."}), 403

        # Update allowed fields
        for field in ['category', 'description', 'location']: # CHANGED: Removed 'image_url'
            if field in data:
                df.loc[item_index, field] = str(data[field])

        # Handle photo update if present in FormData
        if 'item_photo' in request.files:
            file = request.files['item_photo']
            if file.filename != '' and allowed_file(file.filename):
                # Optionally delete old photo if exists
                old_photo_path = df.loc[item_index, 'photo_path'].iloc[0]
                if old_photo_path and os.path.exists(os.path.join(UPLOAD_FOLDER, old_photo_path)):
                    try:
                        os.remove(os.path.join(UPLOAD_FOLDER, old_photo_path))
                        print(f"[{datetime.now()}] Deleted old photo: {old_photo_path}")
                    except OSError as e:
                        print(f"[{datetime.now()}] Error deleting old photo {old_photo_path}: {e}")

                filename = secure_filename(file.filename)
                unique_filename = f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{filename}"
                file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
                file.save(file_path)
                df.loc[item_index, 'photo_path'] = unique_filename # Update photo path
            else:
                return jsonify({"error": "Invalid file type for photo upload."}), 400 # Return error for invalid photo
        
    save_data_to_csv()
    return jsonify({"message": f"Item {item_id} updated successfully.", "item": _get_item_by_id(item_id)}), 200


@app.route('/api/my-items/<int:item_id>/close', methods=['PUT'])
def close_my_item(item_id):
    """
    Allows the original reporter to mark their own 'open' item as 'closed'.
    """
    global df
    data = request.json
    contact_info_of_closer = data.get('contact_info')

    if not contact_info_of_closer:
        return jsonify({"error": "Contact information is required to close an item."}), 401

    with file_lock:
        item_index = df[df['id'] == item_id].index
        if item_index.empty:
            return jsonify({"error": f"Item with ID {item_id} not found."}), 404

        item = df.loc[item_index[0]]

        if item['contact_info'].lower() != contact_info_of_closer.lower():
            return jsonify({"error": "Unauthorized: You can only close items you reported."}), 403
        if item['status'] == 'closed':
            return jsonify({"message": f"Item {item_id} is already closed."}), 200
        
        df.loc[item_index, 'status'] = 'closed'
    
    save_data_to_csv()
    return jsonify({"message": f"Item {item_id} successfully closed.", "item": _get_item_by_id(item_id)}), 200


# --- Admin/Moderation Endpoints (Requires some form of authentication in real app) ---

@app.route('/api/admin/all-items', methods=['GET'])
def get_all_items_admin():
    """
    Retrieves all items (lost/found, open/closed/claimed) for administrative view.
    NOTE: In a real app, this would be protected by admin authentication.
    """
    global df
    with file_lock:
        sorted_df = df.copy()
        sorted_df['report_date'] = pd.to_datetime(sorted_df['report_date'], errors='coerce')
        sorted_df = sorted_df.sort_values(by='report_date', ascending=False).dropna(subset=['report_date'])
        return jsonify(sorted_df.to_dict(orient='records'))

@app.route('/api/admin/items/<int:item_id>/delete', methods=['DELETE'])
def delete_item_admin(item_id):
    """
    Deletes an item from the database.
    NOTE: In a real app, this would be protected by admin authentication.
    """
    global df
    with file_lock:
        item_to_delete = df[df['id'] == item_id]
        if item_to_delete.empty:
            return jsonify({"error": f"Item with ID {item_id} not found."}), 404
        
        # Optionally delete associated photo file
        photo_to_delete = item_to_delete['photo_path'].iloc[0]
        if photo_to_delete:
            file_path = os.path.join(UPLOAD_FOLDER, photo_to_delete)
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                    print(f"[{datetime.now()}] Deleted associated photo: {photo_to_delete}")
                except OSError as e:
                    print(f"[{datetime.now()}] Error deleting photo {photo_to_delete}: {e}")

        df = df[df['id'] != item_id]
    
    save_data_to_csv()
    return jsonify({"message": f"Item {item_id} deleted successfully."}), 200

# --- Dashboard/Summary Endpoints ---

@app.route('/api/dashboard/summary', methods=['GET'])
def get_dashboard_summary():
    """
    Provides counts of open lost, open found, and total closed/claimed items.
    """
    global df
    with file_lock:
        open_lost = len(df[(df['item_type'] == 'lost') & (df['status'] == 'open')])
        open_found = len(df[(df['item_type'] == 'found') & (df['status'] == 'open')])
        total_resolved = len(df[df['status'].isin(['closed', 'claimed'])])

    return jsonify({
        "open_lost_items": open_lost,
        "open_found_items": open_found,
        "total_resolved_items": total_resolved
    })

# --- Main Flask Runner ---
if __name__ == '__main__':
    app.run(debug=True, port=5000)