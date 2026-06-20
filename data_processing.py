import pandas as pd
import zipfile
import requests
import time
import os
import json
import sqlite3
from dotenv import load_dotenv

load_dotenv()
TMDB_TOKEN = os.getenv("TMDB_TOKEN")

HEADERS = {
    "accept": "application/json",
    "authorization": f"Bearer {TMDB_TOKEN}"
}

# --- SQLITE CACHING SYSTEM ---
DB_FILE = "tmdb_cache.db"

def init_db():
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, data TEXT)")

init_db()

def get_cache(key):
    with sqlite3.connect(DB_FILE) as conn:
        cursor = conn.execute("SELECT data FROM cache WHERE key = ?", (key,))
        row = cursor.fetchone()
        if row:
            return json.loads(row[0])
    return None

def set_cache(key, data):
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("INSERT OR REPLACE INTO cache (key, data) VALUES (?, ?)", (key, json.dumps(data)))
# -----------------------------

def fetch_person_details(name):
    """Looks up a person and fetches BOTH their image and biography."""
    cache_key = f"person_details_{name}"
    cached_data = get_cache(cache_key)
    if cached_data: return cached_data
        
    search_url = f"https://api.themoviedb.org/3/search/person?query={requests.utils.quote(str(name))}"
    try:
        response = requests.get(search_url, headers=HEADERS)
        if response.status_code == 200:
            results = response.json().get('results', [])
            if results:
                person_id = results[0]['id']
                profile_path = results[0].get('profile_path')
                url = f"https://image.tmdb.org/t/p/w185{profile_path}" if profile_path else None
                
                # Make a deep request to get the biography text
                detail_url = f"https://api.themoviedb.org/3/person/{person_id}"
                detail_response = requests.get(detail_url, headers=HEADERS)
                bio = ""
                if detail_response.status_code == 200:
                    bio = detail_response.json().get('biography', '')
                    
                data = {"image_url": url, "biography": bio}
                set_cache(cache_key, data)
                return data
    except Exception:
        pass
    
    return {"image_url": None, "biography": ""}

def get_tmdb_match(title, year):
    title_encoded = requests.utils.quote(str(title))
    years_to_try = [year, year - 1, year + 1] if year else [0]
    
    for y in years_to_try:
        if y == 0: continue
        res = requests.get(f"https://api.themoviedb.org/3/search/movie?query={title_encoded}&year={y}", headers=HEADERS)
        results = res.json().get('results', [])
        if results: return 'movie', results[0]['id'], results[0].get('poster_path')
        
        res = requests.get(f"https://api.themoviedb.org/3/search/tv?query={title_encoded}&first_air_date_year={y}", headers=HEADERS)
        results = res.json().get('results', [])
        if results: return 'tv', results[0]['id'], results[0].get('poster_path')
        
    res = requests.get(f"https://api.themoviedb.org/3/search/movie?query={title_encoded}", headers=HEADERS)
    results = res.json().get('results', [])
    for r in results:
        if r.get('title', '').lower() == str(title).lower():
            return 'movie', r['id'], r.get('poster_path')
            
    return None, None, None

def fetch_poster_and_director(title, year):
    cache_key = f"poster_{title}_{year}"
    cached_data = get_cache(cache_key)
    if cached_data: return cached_data['poster_url'], cached_data['director']
        
    try:
        media_type, media_id, poster_path = get_tmdb_match(title, year)
        if media_type:
            poster_url = f"https://image.tmdb.org/t/p/w200{poster_path}" if poster_path else None
            detail_url = f"https://api.themoviedb.org/3/{media_type}/{media_id}?append_to_response=credits"
            
            det_response = requests.get(detail_url, headers=HEADERS)
            director = "Unknown"
            
            if det_response.status_code == 200:
                data = det_response.json()
                crew = data.get('credits', {}).get('crew', [])
                if media_type == 'tv':
                    creators = [c['name'] for c in data.get('created_by', [])]
                    directors = creators if creators else [m['name'] for m in crew if m['job'] == 'Director']
                else:
                    directors = [m['name'] for m in crew if m['job'] == 'Director']
                if directors: director = directors[0]
                    
            set_cache(cache_key, {'poster_url': poster_url, 'director': director})
            return poster_url, director
    except Exception: pass
    return None, "Unknown"

def fetch_movie_details(title, year):
    cache_key = f"details_{title}_{year}"
    cached_data = get_cache(cache_key)
    if cached_data: return cached_data
        
    try:
        media_type, media_id, main_poster_path = get_tmdb_match(title, year)
        if not media_type: return None
        
        detail_url = f"https://api.themoviedb.org/3/{media_type}/{media_id}?append_to_response=credits"
        detail_response = requests.get(detail_url, headers=HEADERS)
        
        if detail_response.status_code == 200:
            data = detail_response.json()
            
            if media_type == 'tv':
                ep_times = data.get('episode_run_time', [])
                num_eps = data.get('number_of_episodes', 1)
                runtime = int((sum(ep_times)/len(ep_times) if ep_times else 0) * num_eps) 
                creators = [c['name'] for c in data.get('created_by', [])]
                crew = data.get('credits', {}).get('crew', [])
                directors = creators if creators else [m['name'] for m in crew if m['job'] in ['Director', 'Series Directed By']]
            else:
                runtime = data.get('runtime', 0) or 0
                crew = data.get('credits', {}).get('crew', [])
                directors = [m['name'] for m in crew if m['job'] in ['Director', 'Co-Director', 'Segment Director']]
                if not directors and data.get('created_by'): directors = [c['name'] for c in data.get('created_by', [])]
            
            # --- NEW: Grab the poster for the tooltip! ---
            poster_path = data.get('poster_path') or main_poster_path
            poster_url = f"https://image.tmdb.org/t/p/w92{poster_path}" if poster_path else None
            
            result = {
                "runtime": runtime, 
                "countries": [c['name'] for c in data.get('production_countries', [])], 
                "directors": list(set(directors)), 
                "actors": [m['name'] for m in data.get('credits', {}).get('cast', [])],
                "poster_url": poster_url
            }
            set_cache(cache_key, result)
            return result
    except Exception as e: print(f"Error fetching data for {title}: {e}")
    return None

def get_homepage_stats(zip_path, max_movies_to_fetch=50, progress_callback=None):
    import gevent
    from gevent.pool import Pool
    
    with zipfile.ZipFile(zip_path, 'r') as z:
        file_list = z.namelist()
        with z.open('watched.csv') as f: watched_df = pd.read_csv(f)
        with z.open('ratings.csv') as f: ratings_df = pd.read_csv(f)
            
        total_watched = len(watched_df)
        top_20_df = None
        
        # ... (Top 20 fetching logic remains identical) ...
        list_files = [f for f in file_list if f.startswith('lists/') and f.endswith('.csv')]
        for file_path in list_files:
            with z.open(file_path) as f:
                lines = f.read().decode('utf-8').splitlines()
                is_topstats = False
                header_row = 0
                for i, line in enumerate(lines[:10]):
                    if "topstats" in line.lower(): is_topstats = True
                    if line.startswith("Position,"):
                        header_row = i
                        break
                if is_topstats:
                    f.seek(0)
                    top_list_raw = pd.read_csv(f, skiprows=header_row)
                    top_20_df = top_list_raw.head(20).copy()
                    break

        if top_20_df is not None and not top_20_df.empty:
            top_20_df = pd.merge(top_20_df, ratings_df[['Name', 'Year', 'Rating']], on=['Name', 'Year'], how='left')
            top_20_df['Rating'] = top_20_df['Rating'].fillna('Unrated')
        else:
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
                            if pd.notna(fav_name): fav_movies.append({'Name': fav_name, 'Year': fav_year})
                    if fav_movies:
                        favorites_df = pd.DataFrame(fav_movies)
                        favorites_df = pd.merge(favorites_df, ratings_df[['Name', 'Year', 'Rating']], on=['Name', 'Year'], how='left')
                        favorites_df['Rating'] = favorites_df['Rating'].fillna('Unrated')

            with z.open('diary.csv') as f: diary_df = pd.read_csv(f)
            watch_counts = diary_df.groupby(['Name', 'Year']).size().reset_index(name='watch_count')
            liked_movies = []
            if 'likes/movies.csv' in file_list:
                with z.open('likes/movies.csv') as f:
                    likes_df = pd.read_csv(f)
                    liked_movies = list(zip(likes_df['Name'], likes_df['Year']))
            watch_counts['liked'] = watch_counts.set_index(['Name', 'Year']).index.isin(liked_movies)
            watch_counts = pd.merge(watch_counts, ratings_df[['Name', 'Year', 'Rating']], on=['Name', 'Year'], how='left')
            watch_counts['Rating'] = watch_counts['Rating'].fillna(0)
            if not favorites_df.empty:
                fav_list = list(zip(favorites_df['Name'], favorites_df['Year']))
                watch_counts = watch_counts[~watch_counts.set_index(['Name', 'Year']).index.isin(fav_list)]
            fallback_df = watch_counts.sort_values(by=['watch_count', 'liked', 'Rating'], ascending=[False, False, False])
            top_20_df = pd.concat([favorites_df, fallback_df]).head(20) if not favorites_df.empty else fallback_df.head(20)

        top_20_list = top_20_df[['Name', 'Year', 'Rating']].to_dict('records')
        for film in top_20_list:
            safe_year = int(film['Year']) if pd.notna(film['Year']) else 0
            url, director = fetch_poster_and_director(film['Name'], safe_year)
            film['poster_url'] = url
            film['director'] = director
            film['Year'] = safe_year 
            film['Rating'] = str(film['Rating'])
        
        if max_movies_to_fetch is not None: movies_to_process = watched_df.head(max_movies_to_fetch).copy()
        else: movies_to_process = watched_df.copy()
            
        if 'diary.csv' in file_list:
            with z.open('diary.csv') as f: full_diary = pd.read_csv(f)
            play_counts = full_diary.groupby(['Name', 'Year']).size().reset_index(name='play_count')
            movies_to_process = pd.merge(movies_to_process, play_counts, on=['Name', 'Year'], how='left')
            movies_to_process['play_count'] = movies_to_process['play_count'].fillna(1).astype(int)
        else:
            movies_to_process['play_count'] = 1
            
        movies_to_process = pd.merge(movies_to_process, ratings_df[['Name', 'Year', 'Rating']], on=['Name', 'Year'], how='left')
        movies_to_process['Rating'] = pd.to_numeric(movies_to_process['Rating'], errors='coerce')
        movies_to_process['safe_year'] = pd.to_numeric(movies_to_process['Year'], errors='coerce').fillna(0).astype(int)
        
        total_to_process = len(movies_to_process)
        movies_missing_from_cache = [row for row in movies_to_process.itertuples(index=False) if not get_cache(f"details_{row.Name}_{row.safe_year}")]
                
        if movies_missing_from_cache:
            pool = Pool(40)
            def fetch_worker(row): fetch_movie_details(row.Name, row.safe_year)
            total_missing = len(movies_missing_from_cache)
            for i in range(0, total_missing, 40):
                gevent.joinall([pool.spawn(fetch_worker, row) for row in movies_missing_from_cache[i:i+40]])
                if progress_callback: progress_callback((total_to_process - total_missing) + min(i + 40, total_missing), total_to_process)
                time.sleep(1.0) 

        total_minutes = 0
        unique_countries = set()
        
        # --- NEW: Bundle the actual movies with the cast & crew ---
        director_films = {}
        actor_films = {}
        
        for idx, row in enumerate(movies_to_process.itertuples(index=False)):
            details = fetch_movie_details(row.Name, row.safe_year)
            if details:
                total_minutes += details['runtime'] * row.play_count
                unique_countries.update(details['countries'])
                
                movie_obj = {
                    "title": row.Name,
                    "rating": row.Rating if pd.notna(row.Rating) else 0,
                    "play_count": row.play_count,
                    "poster_url": details.get('poster_url')
                }
                
                for d in details['directors']: director_films.setdefault(d, []).append(movie_obj)
                for a in details['actors']: actor_films.setdefault(a, []).append(movie_obj)
                
            if not movies_missing_from_cache and progress_callback: progress_callback(idx + 1, total_to_process)
            
        # --- BUILD LEADERBOARDS ---
        
        # 1. Top Watched
        top_directors = []
        for name, films in director_films.items():
            top_directors.append({"name": name, "count": sum(f['play_count'] for f in films), "films": sorted(films, key=lambda x: x['play_count'], reverse=True)})
        top_directors = sorted(top_directors, key=lambda x: x['count'], reverse=True)[:10]

        top_actors = []
        for name, films in actor_films.items():
            top_actors.append({"name": name, "count": sum(f['play_count'] for f in films), "films": sorted(films, key=lambda x: x['play_count'], reverse=True)})
        top_actors = sorted(top_actors, key=lambda x: x['count'], reverse=True)[:10]

        # 2. Top Rated (Minimum 3 rated films)
        MIN_RATED_FILMS = 3
        
        top_rated_directors = []
        for name, films in director_films.items():
            rated = [f for f in films if f['rating'] > 0]
            if len(rated) >= MIN_RATED_FILMS:
                top_rated_directors.append({"name": name, "avg_rating": sum(f['rating'] for f in rated) / len(rated), "count": len(rated), "films": sorted(rated, key=lambda x: x['rating'], reverse=True)})
        top_rated_directors = sorted(top_rated_directors, key=lambda x: (x['avg_rating'], x['count']), reverse=True)[:10]

        top_rated_actors = []
        for name, films in actor_films.items():
            rated = [f for f in films if f['rating'] > 0]
            if len(rated) >= MIN_RATED_FILMS:
                top_rated_actors.append({"name": name, "avg_rating": sum(f['rating'] for f in rated) / len(rated), "count": len(rated), "films": sorted(rated, key=lambda x: x['rating'], reverse=True)})
        top_rated_actors = sorted(top_rated_actors, key=lambda x: (x['avg_rating'], x['count']), reverse=True)[:10]

        # Fetch deep details and pack the UI payload
        for group in [top_directors, top_actors, top_rated_directors, top_rated_actors]:
            for p in group:
                details = fetch_person_details(p['name'])
                p['image_url'] = details['image_url']
                p['biography'] = details['biography']
                
                # Keep ALL films for the profile page, let Javascript handle the tooltip slicing!
                if 'avg_rating' in p: p['avg_rating'] = round(p['avg_rating'], 2)
        
# --- NEW: Yearly Histograms ---
        valid_years_df = movies_to_process[movies_to_process['safe_year'] > 0].copy()

        # 1. Count total films per year (respecting rewatches)
        year_counts = valid_years_df.groupby('safe_year')['play_count'].sum().reset_index()
        year_counts.columns = ['year', 'count']

        # 2. Average rating per year (only counting films you actually rated)
        rated_films_df = valid_years_df[valid_years_df['Rating'] > 0]
        year_ratings = rated_films_df.groupby('safe_year')['Rating'].mean().reset_index()
        year_ratings.columns = ['year', 'avg_rating']

        # Merge them together and sort chronologically
        yearly_stats_df = pd.merge(year_counts, year_ratings, on='year', how='left')
        yearly_stats_df['avg_rating'] = yearly_stats_df['avg_rating'].fillna(0).round(2)
        yearly_stats_df = yearly_stats_df.sort_values('year')
        
        yearly_stats_list = yearly_stats_df.to_dict('records')
        
    return {
        "total_watched": total_watched, "top_20": top_20_list, "total_hours": round(total_minutes / 60, 1),
        "total_countries": len(unique_countries), "total_directors": len(director_films), 
        "top_directors_list": top_directors, "top_actors_list": top_actors,
        "top_rated_directors_list": top_rated_directors, "top_rated_actors_list": top_rated_actors,
        "yearly_stats": yearly_stats_list # <--- MAKE SURE TO ADD THIS TO YOUR RETURN!
    }