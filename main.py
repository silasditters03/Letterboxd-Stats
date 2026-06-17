import customtkinter as ctk
from tkinter import filedialog, messagebox
import zipfile

# Letterboxd Color Palette
BG_COLOR = "#14181c"
PANEL_COLOR = "#2c3440"
GREEN_ACCENT = "#00e054"
ORANGE_ACCENT = "#ff8000"

ctk.set_appearance_mode("dark")

def select_file():
    file_path = filedialog.askopenfilename(
        title="Select Letterboxd Zip File",
        filetypes=[("Zip files", "*.zip")]
    )
    
    if file_path:
        file_label.configure(text=f"Selected: {file_path.split('/')[-1]}")
        
        if zipfile.is_zipfile(file_path):
            try:
                with zipfile.ZipFile(file_path, 'r') as zip_ref:
                    file_list = zip_ref.namelist()
                    if "ratings.csv" in file_list or "watched.csv" in file_list:
                         status_label.configure(text="Data loaded! Ready to analyze...", text_color=GREEN_ACCENT)
                         process_button.configure(state="normal")
                    else:
                         status_label.configure(text="Valid zip, but missing CSVs.", text_color=ORANGE_ACCENT)
            except Exception as e:
                status_label.configure(text=f"Error reading zip.", text_color="red")
        else:
            status_label.configure(text="Not a valid zip file.", text_color="red")

# Set up the main window
app = ctk.CTk(fg_color=BG_COLOR)
app.title("Letterboxd Stats")

# Set initial size, but allow resizing/fullscreening
app.geometry("600x400")
app.resizable(True, True) # <-- Changed to True

# Optional: Uncomment the line below if you want the app to open maximized by default
# app.state("zoomed") 

# Main layout frame
frame = ctk.CTkFrame(master=app, fg_color=PANEL_COLOR, corner_radius=15)
frame.pack(pady=40, padx=40, fill="both", expand=True)

# UI Elements
title_label = ctk.CTkLabel(master=frame, text="Letterboxd Stats App", font=("Helvetica", 28, "bold"), text_color="#ffffff")
title_label.pack(pady=(30, 10))

instruction_label = ctk.CTkLabel(master=frame, text="Upload your data export to begin", font=("Helvetica", 16), text_color="#9ab")
instruction_label.pack(pady=(0, 30))

upload_button = ctk.CTkButton(
    master=frame, 
    text="Browse for .zip", 
    command=select_file, 
    fg_color=ORANGE_ACCENT, 
    hover_color="#cc6600",
    font=("Helvetica", 16, "bold"),
    corner_radius=8,
    height=40
)
upload_button.pack(pady=10)

file_label = ctk.CTkLabel(master=frame, text="No file selected", font=("Helvetica", 14), text_color="#9ab")
file_label.pack(pady=10)

status_label = ctk.CTkLabel(master=frame, text="", font=("Helvetica", 14, "bold"))
status_label.pack(pady=10)

process_button = ctk.CTkButton(
    master=frame, 
    text="Generate Stats", 
    state="disabled",
    fg_color=GREEN_ACCENT, 
    hover_color="#00b344",
    text_color="#14181c",
    font=("Helvetica", 16, "bold"),
    corner_radius=8,
    height=40
)
process_button.pack(pady=(10, 30))

app.mainloop()