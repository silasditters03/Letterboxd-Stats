import pandas as pd
import zipfile
import requests
import time
import os
from collections import Counter
from dotenv import load_dotenv

# Load the secret variables from the .env file
load_dotenv()
TMDB_TOKEN = os.getenv("TMDB_TOKEN")

HEADERS = {
    "accept": "application/json",
    "authorization": f"Bearer {TMDB_TOKEN}"
}

def fetch_poster_and_director(title, year):
    """Fetches the poster image URL and the director for the Top 20 list."""
    search_url = f"https://api.themoviedb.org/3/search/movie?query={requests.utils.quote(str(title))}&year={year}"
    try:
        response = requests.get(search_url, headers=HEADERS)
        if response.status_code == 200:
            results = response.json().get('results', [])
            if results:
                movie_id = results[0]['id']
                poster_path = results[0].get('poster_path')
                poster_url = f"https://image.tmdb.org/t/p/w200{poster_path}" if poster_path else None
                
                # Make a second quick call to get the credits/director
                detail_url = f"https://api.themoviedb.org/3/movie/{movie_id}?append_to_response=credits"
                det_response = requests.get(detail_url, headers=HEADERS)
                director = "Unknown"
                
                if det_response.status_code == 200:
                    crew = det_response.json().get('credits', {}).get('crew', [])
                    directors = [member['name'] for member in crew if member['job'] == 'Director']
                    if directors:
                        director = directors[0]
                        
                return poster_url, director
    except Exception:
        pass
    return None, "Unknown"

def fetch_movie_details(title, year):
    """Searches TMDb for a movie and returns deep stats including cast & crew."""
    search_url = f"https://api.themoviedb.org/3/search/movie?query={requests.utils.quote(str(title))}&year={year}"
    
    try:
        response = requests.get(search_url, headers=HEADERS)
        if response.status_code != 200:
            return None
        
        results = response.json().get('results', [])
        if not results:
            return None
        
        movie_id = results[0]['id']
        detail_url = f"https://api.themoviedb.org/3/movie/{movie_id}?append_to_response=credits"
        detail_response = requests.get(detail_url, headers=HEADERS)
        
        if detail_response.status_code == 200:
            data = detail_response.json()
            runtime = data.get('runtime', 0) or 0
            countries = [c['name'] for c in data.get('production_countries', [])]
            
            credits = data.get('credits', {})
            crew = credits.get('crew', [])
            cast = credits.get('cast', [])
            
            directors = [member['name'] for member in crew if member['job'] == 'Director']
            # Grab only the top 5 billed actors
            actors = [member['name'] for member in cast[:5]]
            
            return {
                "runtime": runtime,
                "countries": countries,
                "directors": directors,
                "actors": actors
            }
    except Exception as e:
        print(f"Error fetching data for {title}: {e}")
        
    return None

def get_homepage_stats(zip_path, max_movies_to_fetch=50, progress_callback=None):
    """Calculates all stats, handling custom list tags, favorites, and fallback priorities."""
    
    with zipfile.ZipFile(zip_path, 'r') as z:
        file_list = z.namelist()
        
        # 1. Load the essential base data
        with z.open('watched.csv') as f: watched_df = pd.read_csv(f)
        with z.open('ratings.csv') as f: ratings_df = pd.read_csv(f)
            
        total_watched = len(watched_df)
        top_20_df = None
        
        # 2. SEARCH FOR "TOPSTATS" LIST
        list_files = [f for f in file_list if f.startswith('lists/') and f.endswith('.csv')]
        
        for file_path in list_files:
            with z.open(file_path) as f:
                lines = f.read().decode('utf-8').splitlines()
                is_topstats = False
                header_row = 0
                
                for i, line in enumerate(lines[:10]):
                    if "topstats" in line.lower():
                        is_topstats = True
                    if line.startswith("Position,"):
                        header_row = i
                        break
                        
                if is_topstats:
                    f.seek(0)
                    top_list_raw = pd.read_csv(f, skiprows=header_row)
                    top_20_df = top_list_raw.head(20).copy()
                    break

        # 3. APPLY LOGIC FOR TOP 20
        if top_20_df is not None and not top_20_df.empty:
            top_20_df = pd.merge(top_20_df, ratings_df[['Name', 'Year', 'Rating']], on=['Name', 'Year'], how='left')
            top_20_df['Rating'] = top_20_df['Rating'].fillna('Unrated')
        else:
            # FALLBACK LOGIC: Favorites + Most Rewatched / Liked
            favorites_df = pd.DataFrame()
            
            if 'profile.csv' in file_list:
                with z.open('profile.csv') as f:
                    profile_df = pd.read_csv(f)
                    fav_movies = []
                    
                    for i in range(1, 5):
                        name_col = f'Favorite Film {i} Name'
                        year_col = f'Favorite Film {i} Year'
                        if name_col in profile_df.columns and year_col in profile_df.columns:
                            fav_name = profile_df.iloc[0][name_col]
                            fav_year = profile_df.iloc[0][year_col]
                            if pd.notna(fav_name):
                                fav_movies.append({'Name': fav_name, 'Year': fav_year})
                    
                    if fav_movies:
                        favorites_df = pd.DataFrame(fav_movies)
                        favorites_df = pd.merge(favorites_df, ratings_df[['Name', 'Year', 'Rating']], on=['Name', 'Year'], how='left')
                        favorites_df['Rating'] = favorites_df['Rating'].fillna('Unrated')

            with z.open('diary.csv') as f:
                diary_df = pd.read_csv(f)
            
            watch_counts = diary_df.groupby(['Name', 'Year']).size().reset_index(name='watch_count')
            
            liked_movies = set()
            if 'likes/movies.csv' in file_list:
                with z.open('likes/movies.csv') as f:
                    likes_df = pd.read_csv(f)
                    liked_movies = set(zip(likes_df['Name'], likes_df['Year']))
            
            watch_counts['liked'] = watch_counts.apply(lambda row: (row['Name'], row['Year']) in liked_movies, axis=1)
            watch_counts = pd.merge(watch_counts, ratings_df[['Name', 'Year', 'Rating']], on=['Name', 'Year'], how='left')
            watch_counts['Rating'] = watch_counts['Rating'].fillna(0)
            
            if not favorites_df.empty:
                fav_set = set(zip(favorites_df['Name'], favorites_df['Year']))
                watch_counts = watch_counts[~watch_counts.apply(lambda row: (row['Name'], row['Year']) in fav_set, axis=1)]
                
            fallback_df = watch_counts.sort_values(
                by=['watch_count', 'liked', 'Rating'], 
                ascending=[False, False, False]
            )
            
            if not favorites_df.empty:
                top_20_df = pd.concat([favorites_df, fallback_df]).head(20)
            else:
                top_20_df = fallback_df.head(20)

        top_20_list = top_20_df[['Name', 'Year', 'Rating']].to_dict('records')
        
        # Assign URL and Director to Top 20 
        for film in top_20_list:
            url, director = fetch_poster_and_director(film['Name'], film['Year'])
            film['poster_url'] = url
            film['director'] = director
            
            # --- THE FIX: Convert Pandas/Numpy types into standard Python types! ---
            film['Year'] = int(film['Year']) 
            film['Rating'] = str(film['Rating'])
        
        # 4. FETCH TMDB DATA FOR STATS
        movies_to_process = watched_df.head(max_movies_to_fetch)
        total_to_process = len(movies_to_process)
        
        total_minutes = 0
        unique_countries = set()
        director_counter = Counter()
        actor_counter = Counter()
        
        for idx, (index, row) in enumerate(movies_to_process.iterrows()):
            details = fetch_movie_details(row['Name'], row['Year'])
            if details:
                total_minutes += details['runtime']
                unique_countries.update(details['countries'])
                director_counter.update(details['directors'])
                actor_counter.update(details['actors'])
            
            if progress_callback:
                progress_callback(idx + 1, total_to_process)
                
            time.sleep(0.1)
            
        total_hours = round(total_minutes / 60, 1)
        
        # Format the top 10 lists into neat dictionaries for Javascript
        top_directors = [{"name": name, "count": count} for name, count in director_counter.most_common(10)]
        top_actors = [{"name": name, "count": count} for name, count in actor_counter.most_common(10)]
        
    return {
        "total_watched": total_watched,
        "top_20": top_20_list,
        "total_hours": total_hours,
        "total_countries": len(unique_countries),
        "total_directors": len(director_counter), 
        "top_directors_list": top_directors,      
        "top_actors_list": top_actors             
    }