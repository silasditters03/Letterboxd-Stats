# --- MUST BE AT THE ABSOLUTE TOP ---
import gevent.monkey
gevent.monkey.patch_all()
# -----------------------------------

import eel
import bottle # NEW: We tap into Eel's hidden web server!
import data_processing
import json
import os

eel.init('web')

# --- PHASE 3: NATIVE HTTP UPLOADING ---
@bottle.post('/upload')
def upload_file():
    """Receives the raw zip file via HTTP POST instead of WebSockets."""
    upload = bottle.request.files.get('file')
    upload.save('temp_letterboxd_data.zip', overwrite=True)
    return "success"

@eel.expose
def process_data():
    """Runs the engine on the uploaded file and cleans up. No Base64 needed!"""
    def python_progress_callback(current, total):
        eel.updateProgress(current, total)()

    temp_zip_path = "temp_letterboxd_data.zip"

    try:
        print("\n--- STARTING DATA ENGINE ---")
        stats = data_processing.get_homepage_stats(
            temp_zip_path, 
            max_movies_to_fetch=None, 
            progress_callback=python_progress_callback
        )
        
        raw_json = json.dumps(stats, default=str)
        clean_json = raw_json.replace('NaN', 'null')
        clean_stats = json.loads(clean_json)
        
        return {"status": "success", "data": clean_stats}
        
    except Exception as e:
        print(f"PYTHON ERROR: {str(e)}")
        return {"status": "error", "message": str(e)}
        
    finally:
        if os.path.exists(temp_zip_path):
            os.remove(temp_zip_path)

if __name__ == '__main__':
    eel.start('index.html', size=(1100, 850))