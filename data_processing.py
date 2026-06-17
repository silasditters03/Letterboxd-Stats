import pandas as pd
import zipfile

def load_data(zip_path):
    """Opens the zip and loads the CSVs into pandas DataFrames."""
    with zipfile.ZipFile(zip_path, 'r') as z:
        # Load ratings (for the top 20 list)
        with z.open('ratings.csv') as f:
            ratings_df = pd.read_csv(f)
            
        # Load watched (for total count)
        with z.open('watched.csv') as f:
            watched_df = pd.read_csv(f)
            
    return ratings_df, watched_df

def get_homepage_stats(zip_path):
    """Calculates all the stats needed for the homepage."""
    ratings_df, watched_df = load_data(zip_path)
    
    # 1. Total Films Watched
    total_watched = len(watched_df)
    
    # 2. Top 20 Highest Rated Films
    # Sort by Rating (descending), then by Year (descending) as a tie-breaker
    top_20 = ratings_df.sort_values(by=['Rating', 'Year'], ascending=[False, False]).head(20)
    
    # Convert to a list of dictionaries so the UI can easily read it
    top_20_list = top_20[['Name', 'Year', 'Rating']].to_dict('records')
    
    # 3. Placeholders for the API data
    total_hours = "Requires TMDb"
    total_countries = "Requires TMDb"
    total_directors = "Requires TMDb"
    
    return {
        "total_watched": total_watched,
        "top_20": top_20_list,
        "total_hours": total_hours,
        "total_countries": total_countries,
        "total_directors": total_directors
    }

# Quick test to make sure it works before touching the UI
if __name__ == "__main__":
    # Replace with the path to your actual zip file to test
    # stats = get_homepage_stats("path_to_your_letterboxd_data.zip")
    # print(f"Total Watched: {stats['total_watched']}")
    # print(f"Number 1 Film: {stats['top_20'][0]['Name']} ({stats['top_20'][0]['Rating']} stars)")
    pass