import eel
import tkinter as tk
from tkinter import filedialog
import data_processing

# Tell Eel to look for the HTML/CSS in the "web" folder
eel.init('web')

@eel.expose
def get_file_path():
    """Opens a native OS file dialog so the user can select their zip."""
    # We use a tiny, hidden Tkinter window just to trigger the file dialog safely
    root = tk.Tk()
    root.attributes('-topmost', True) # Keep dialog in front
    root.withdraw() # Hide the main window
    
    file_path = filedialog.askopenfilename(
        title="Select Letterboxd Zip File", 
        filetypes=[("Zip files", "*.zip")]
    )
    
    root.destroy()
    return file_path

@eel.expose
def process_data(file_path):
    """Passes the file path to the engine and returns the stats to Javascript."""
    
    # A callback function that triggers our Javascript progress bar
    def python_progress_callback(current, total):
        # Call the JS function named "updateProgress"
        eel.updateProgress(current, total)()

    try:
        # Run the heavy data engine!
        stats = data_processing.get_homepage_stats(
            file_path, 
            max_movies_to_fetch=20, 
            progress_callback=python_progress_callback
        )
        return {"status": "success", "data": stats}
        
    except Exception as e:
        return {"status": "error", "message": str(e)}

# Launch the app in a standalone desktop window!
eel.start('index.html', size=(1100, 850))