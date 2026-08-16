import pandas as pd
import zipfile
import requests
import time
import os
import json
import sqlite3
import re
import difflib
from dotenv import load_dotenv
import gevent
from gevent.pool import Pool

load_dotenv()
TMDB_TOKEN = os.getenv("TMDB_TOKEN")

HEADERS = {
    "accept": "application/json",
    "authorization": f"Bearer {TMDB_TOKEN}"
}

# --- SQLITE CACHING SYSTEM (OPTIMIZED) ---
DB_FILE = "tmdb_cache.db"

# Persistent global connection to prevent I/O thrashing
db_conn = sqlite3.connect(DB_FILE, check_same_thread=False)

def init_db():
    db_conn.execute("CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, data TEXT)")
    db_conn.commit()

init_db()

def get_cache(key):
    cursor = db_conn.execute("SELECT data FROM cache WHERE key = ?", (key,))
    row = cursor.fetchone()
    if row:
        return json.loads(row[0])
    return None

def set_cache(key, data):
    db_conn.execute("INSERT OR REPLACE INTO cache (key, data) VALUES (?, ?)", (key, json.dumps(data)))
    db_conn.commit()

def fetch_user_profile(username):
    if not username or username.lower() == "user":
        return None
    try:
        res = requests.get(f"https://letterboxd.com/{username}/", timeout=5)
        if res.status_code == 200:
            match = re.search(r'<meta\s+property="og:image"\s+content="([^"]+)"', res.text)
            if match:
                url = match.group(1)
                if 'mac-icon' not in url and 'letterboxd-logo' not in url:
                    return url
    except:
        pass
    return None

def fetch_person_details(name):
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

# --- UPGRADED FUZZY MATCHING ENGINE ---
def get_tmdb_match(title, year):
    title_str = str(title)
    title_encoded = requests.utils.quote(title_str)
    
    def clean_string(s):
        # Keep spaces to respect word boundaries, strip punctuation
        return re.sub(r'[^a-z0-9\s]', '', str(s).lower()).strip() if s else ""
    
    target_clean = clean_string(title_str)
    target_no_spaces = target_clean.replace(" ", "")
    target_year = int(year) if year and pd.notna(year) else 0
    
    candidates = []
    seen_ids = set()
    
    try:
        # 1. Ask TMDB to natively filter by year first
        year_query = f"&primary_release_year={target_year}" if target_year > 0 else ""
        movie_res = requests.get(f"https://api.themoviedb.org/3/search/movie?query={title_encoded}{year_query}", headers=HEADERS)
        
        if movie_res.status_code == 200:
            for r in movie_res.json().get('results', []):
                r['media_type'] = 'movie'
                candidates.append(r)
                seen_ids.add(r['id'])
        
        # 2. ALWAYS perform a broad search to catch release year discrepancies (festival vs wide release)
        if target_year > 0:
            movie_res_broad = requests.get(f"https://api.themoviedb.org/3/search/movie?query={title_encoded}", headers=HEADERS)
            if movie_res_broad.status_code == 200:
                for r in movie_res_broad.json().get('results', []):
                    if r['id'] not in seen_ids:
                        r['media_type'] = 'movie'
                        candidates.append(r)
                        seen_ids.add(r['id'])
    except Exception:
        pass
        
    try:
        tv_res = requests.get(f"https://api.themoviedb.org/3/search/tv?query={title_encoded}", headers=HEADERS)
        if tv_res.status_code == 200:
            for r in tv_res.json().get('results', []):
                r['media_type'] = 'tv'
                candidates.append(r)
    except Exception:
        pass

    best_candidate = None
    best_score = -1
    
    for c in candidates:
        c_title = c.get('title') if c['media_type'] == 'movie' else c.get('name')
        c_orig_title = c.get('original_title') if c['media_type'] == 'movie' else c.get('original_name')
        c_date = c.get('release_date') if c['media_type'] == 'movie' else c.get('first_air_date')
        
        c_year = 0
        if c_date and len(c_date) >= 4:
            try: c_year = int(c_date[:4])
            except ValueError: pass
                
        c_title_clean = clean_string(c_title)
        c_orig_clean = clean_string(c_orig_title)
        
        # Compare strings with spaces removed for base fuzzy matching
        c_title_no_spaces = c_title_clean.replace(" ", "")
        c_orig_no_spaces = c_orig_clean.replace(" ", "")
        
        sim_title = difflib.SequenceMatcher(None, target_no_spaces, c_title_no_spaces).ratio()
        sim_orig = difflib.SequenceMatcher(None, target_no_spaces, c_orig_no_spaces).ratio()
        best_sim = max(sim_title, sim_orig)
        
        # Strict Exact Match Check
        if target_clean == c_title_clean or target_clean == c_orig_clean:
            best_sim = 1.0
            is_exact = True
        else:
            is_exact = False
            
        # Safe Subtitle/Sequel Prefix Bonus (e.g., Target: "Wake Up Dead Man", TMDB: "Wake Up Dead Man: A Knives Out Mystery")
        if c_title_clean.startswith(target_clean + " ") or c_orig_clean.startswith(target_clean + " "):
            best_sim = max(best_sim, 0.95)
            is_prefix = True
        else:
            is_prefix = False

        # --- THE BALANCED SCORING SYSTEM ---
        title_weight = best_sim * 10000
        
        # Give exact matches a solid boost, and prefix matches a minor boost.
        if is_exact:
            title_weight += 2000
        elif is_prefix:
            title_weight += 1000
        
        # Year penalty/bonus (Forgive a 1-year gap much more than before)
        year_delta = abs(c_year - target_year) if (target_year > 0 and c_year > 0) else 999
        if year_delta == 0: year_weight = 3000
        elif year_delta == 1: year_weight = 2000 
        elif year_delta == 2: year_weight = 500
        elif year_delta == 999: year_weight = 0
        else: year_weight = -2000 
        
        # Allow vote counts to bridge the gap between a Prefix match and an Exact match.
        # This allows a highly anticipated/voted Franchise film to beat a 0-vote obscure film with the same base name.
        popularity_weight = min(c.get('popularity', 0) * 5, 1000)
        vote_weight = min(c.get('vote_count', 0) * 10, 3000) 
        
        score = title_weight + year_weight + popularity_weight + vote_weight
        
        if score > best_score:
            best_score = score
            best_candidate = c

    if best_candidate:
        return best_candidate['media_type'], best_candidate['id'], best_candidate.get('poster_path')
    return None, None, None

def fetch_poster_and_director(title, year):
    cache_key = f"poster_v10_{title}_{year}" # v10 cache bump
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
    cache_key = f"details_v10_{title}_{year}" # v10 cache bump
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
            
            poster_path = data.get('poster_path') or main_poster_path
            poster_url = f"https://image.tmdb.org/t/p/w200{poster_path}" if poster_path else None
            
            orig_lang_code = data.get('original_language')
            orig_lang_name = None
            for l in data.get('spoken_languages', []):
                if l.get('iso_639_1') == orig_lang_code:
                    orig_lang_name = l.get('english_name') or l.get('name')
                    break
            
            if not orig_lang_name and orig_lang_code:
                fallback_map = { 'en': 'English', 'fr': 'French', 'ja': 'Japanese', 'ko': 'Korean', 'es': 'Spanish', 'it': 'Italian', 'de': 'German', 'zh': 'Mandarin', 'cn': 'Cantonese', 'ru': 'Russian', 'pt': 'Portuguese', 'hi': 'Hindi', 'sv': 'Swedish', 'da': 'Danish', 'nl': 'Dutch', 'pl': 'Polish', 'tr': 'Turkish', 'fa': 'Persian', 'no': 'Norwegian', 'fi': 'Finnish', 'th': 'Thai', 'id': 'Indonesian', 'vi': 'Vietnamese', 'el': 'Greek', 'cs': 'Czech', 'hu': 'Hungarian', 'he': 'Hebrew', 'tl': 'Tagalog' }
                orig_lang_name = fallback_map.get(orig_lang_code, orig_lang_code.upper())
            
            genres = [g['name'] for g in data.get('genres', [])]

            result = {
                "runtime": runtime, 
                "countries": [c['name'] for c in data.get('production_countries', [])], 
                "languages": [orig_lang_name] if orig_lang_name else [], 
                "genres": genres,
                "directors": list(set(directors)), 
                "actors": [m['name'] for m in data.get('credits', {}).get('cast', [])],
                "poster_url": poster_url,
                "popularity": data.get('popularity', 0.0),
                "vote_average": data.get('vote_average', 0.0),
                "vote_count": data.get('vote_count', 0),
                "media_type": media_type,
                "release_date": data.get('release_date') if media_type == 'movie' else data.get('first_air_date')
            }
            set_cache(cache_key, result)
            return result
    except Exception as e: print(f"Error fetching data for {title}: {e}")
    return None

def get_homepage_stats(zip_path, max_movies_to_fetch=50, progress_callback=None):
    with zipfile.ZipFile(zip_path, 'r') as z:
        file_list = z.namelist()
        with z.open('watched.csv') as f: watched_df = pd.read_csv(f)
        with z.open('ratings.csv') as f: ratings_df = pd.read_csv(f)
            
        total_watched = len(watched_df)
        top_20_df = None
        extracted_username = "User"
        favorites_df = pd.DataFrame()
        
        if 'profile.csv' in file_list:
            with z.open('profile.csv') as f:
                profile_df = pd.read_csv(f)
                if 'Username' in profile_df.columns and not pd.isna(profile_df.iloc[0]['Username']):
                    extracted_username = str(profile_df.iloc[0]['Username'])
                    
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
            
        # Ensure type casting is done at the Pandas level
        movies_to_process = pd.merge(movies_to_process, ratings_df[['Name', 'Year', 'Rating']], on=['Name', 'Year'], how='left')
        movies_to_process['Rating'] = pd.to_numeric(movies_to_process['Rating'], errors='coerce')
        movies_to_process['safe_year'] = pd.to_numeric(movies_to_process['Year'], errors='coerce').fillna(0).astype(int)
        
        total_to_process = len(movies_to_process)
        movies_missing_from_cache = [row for row in movies_to_process.itertuples(index=False) if not get_cache(f"details_v10_{row.Name}_{row.safe_year}")]
                
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
        
        director_films = {}
        actor_films = {}
        year_films = {} 
        country_films = {} 
        language_films = {} 
        milestone_pool = []
        
        genre_counts = {}
        rating_dist = {0.5: 0, 1.0: 0, 1.5: 0, 2.0: 0, 2.5: 0, 3.0: 0, 3.5: 0, 4.0: 0, 4.5: 0, 5.0: 0}
        
        for idx, row in enumerate(movies_to_process.itertuples(index=False)):
            details = fetch_movie_details(row.Name, row.safe_year)
            if details:
                total_minutes += details['runtime'] * row.play_count
                unique_countries.update(details['countries'])
                
                movie_obj = {
                    "title": row.Name,
                    "rating": row.Rating if pd.notna(row.Rating) else 0.0,
                    "play_count": row.play_count,
                    "poster_url": details.get('poster_url'),
                    "year": row.safe_year,
                    "vote_average": details.get('vote_average', 0.0)
                }
                
                milestone_pool.append({
                    "title": row.Name,
                    "year": row.safe_year,
                    "runtime": details.get('runtime', 0),
                    "popularity": details.get('popularity', 0.0),
                    "vote_average": details.get('vote_average', 0.0),
                    "vote_count": details.get('vote_count', 0),
                    "media_type": details.get('media_type', 'movie'),
                    "release_date": details.get('release_date', ''),
                    "user_rating": row.Rating if pd.notna(row.Rating) else 0.0,
                    "poster_url": details.get('poster_url')
                })
                
                for g in details.get('genres', []):
                    genre_counts[g] = genre_counts.get(g, 0) + 1
                    
                if pd.notna(row.Rating) and row.Rating > 0:
                    val = round(float(row.Rating) * 2) / 2
                    if val in rating_dist:
                        rating_dist[val] += 1
                
                for country in details['countries']:
                    country_films.setdefault(country, []).append(movie_obj)
                for lang in details.get('languages', []):
                    language_films.setdefault(lang, []).append(movie_obj)
                for d in details['directors']: director_films.setdefault(d, []).append(movie_obj)
                for a in details['actors']: actor_films.setdefault(a, []).append(movie_obj)
                
                year_films.setdefault(row.safe_year, []).append(movie_obj)
                
            if not movies_missing_from_cache and progress_callback: progress_callback(idx + 1, total_to_process)
            
        newest_film = None; oldest_film = None; most_obscure = None; most_popular = None
        highest_rating = None; lowest_rating = None; longest_film = None
        recent_watch = None; most_rewatched = None
        
        if 'diary.csv' in file_list:
            with z.open('diary.csv') as f:
                diary_df = pd.read_csv(f)
                if not diary_df.empty:
                    diary_df['ParsedDate'] = pd.to_datetime(diary_df['Watched Date'], errors='coerce')
                    diary_df = diary_df.sort_values(by='ParsedDate', ascending=False)
                    first_row = diary_df.iloc[0]
                    recent_watch = {"title": first_row['Name'], "year": int(first_row['Year']), "text": f"{first_row['Name']} ({int(first_row['Year'])})"}
                    
                    play_counts = diary_df.groupby(['Name', 'Year']).size().reset_index(name='p_count')
                    if not play_counts.empty:
                        top_rw = play_counts.sort_values(by='p_count', ascending=False).iloc[0]
                        if top_rw['p_count'] > 1:
                            most_rewatched = {"title": top_rw['Name'], "year": int(top_rw['Year']), "text": f"{top_rw['Name']} ({top_rw['p_count']}x)"}

        if not most_rewatched and not movies_to_process.empty:
            rewatched_only = movies_to_process[movies_to_process['play_count'] > 1]
            if not rewatched_only.empty:
                top_rw = rewatched_only.sort_values(by='play_count', ascending=False).iloc[0]
                most_rewatched = {"title": top_rw['Name'], "year": top_rw['safe_year'], "text": f"{top_rw['Name']} ({top_rw['play_count']}x)"}

        if milestone_pool:
            valid_dates = [m for m in milestone_pool if m['release_date'] and re.match(r'^\d{4}-\d{2}-\d{2}$', str(m['release_date']))]
            if valid_dates:
                nw = max(valid_dates, key=lambda x: x['release_date'])
                od = min(valid_dates, key=lambda x: x['release_date'])
                newest_film = {"title": nw['title'], "year": nw['year'], "text": f"{nw['title']} ({nw['year']})"}
                oldest_film = {"title": od['title'], "year": od['year'], "text": f"{od['title']} ({od['year']})"}
            
            # --- 1. MOST POPULAR & MOST OBSCURE (Based on Total TMDB Vote Counts) ---
            if milestone_pool:
                hi_pop = max(milestone_pool, key=lambda x: x['vote_count'])
                lo_pop = min(milestone_pool, key=lambda x: x['vote_count'])
                most_popular = {"title": hi_pop['title'], "year": hi_pop['year'], "text": f"{hi_pop['title']} ({hi_pop['year']})"}
                most_obscure = {"title": lo_pop['title'], "year": lo_pop['year'], "text": f"{lo_pop['title']} ({lo_pop['year']})"}
                
            # --- 2. HIGHEST & LOWEST AVERAGE RATING (TMDB Community Score) ---
            # Use a threshold (e.g., >= 50 votes) so a single-vote 10/10 or 1/10 doesn't skew the results
            vetted_avg = [m for m in milestone_pool if m['vote_count'] >= 50 and m['vote_average'] > 0]
            if not vetted_avg:
                # Fallback to any rated film if library contains only niche/low-vote items
                vetted_avg = [m for m in milestone_pool if m['vote_average'] > 0]

            if vetted_avg:
                hi_avg = max(vetted_avg, key=lambda x: x['vote_average'])
                lo_avg = min(vetted_avg, key=lambda x: x['vote_average'])
                
                # TMDB vote_average is out of 10, so dividing by 2 gives the 5-star equivalent
                highest_rating = {"title": hi_avg['title'], "year": hi_avg['year'], "text": f"{hi_avg['title']} ({round(hi_avg['vote_average'] / 2.0, 1)}★)"}
                lowest_rating = {"title": lo_avg['title'], "year": lo_avg['year'], "text": f"{lo_avg['title']} ({round(lo_avg['vote_average'] / 2.0, 1)}★)"}
                
            feature_films = [m for m in milestone_pool if m['media_type'] == 'movie' and m['runtime'] > 0]
            if feature_films:
                long_f = max(feature_films, key=lambda x: x['runtime'])
                longest_film = {"title": long_f['title'], "year": long_f['year'], "text": f"{long_f['title']} ({long_f['runtime']} min)"}

        def process_milestone(m):
            if not m: return {"text": "N/A", "poster_url": "https://via.placeholder.com/150x225/2c3440/89a?text=?"}
            poster, _ = fetch_poster_and_director(m['title'], m['year'])
            return {"text": m['text'], "poster_url": poster if poster else "https://via.placeholder.com/150x225/2c3440/89a?text=?"}

        milestones_dict = {
            "recent_watch": process_milestone(recent_watch), "newest_film": process_milestone(newest_film),
            "oldest_film": process_milestone(oldest_film), "most_rewatched": process_milestone(most_rewatched),
            "most_obscure": process_milestone(most_obscure), "most_popular": process_milestone(most_popular),
            "highest_rating": process_milestone(highest_rating), "lowest_rating": process_milestone(lowest_rating),
            "longest_film": process_milestone(longest_film)
        }
        
        differences = []
        for m in milestone_pool:
            if m['user_rating'] > 0 and m['vote_count'] >= 50 and m['vote_average'] > 0:
                tmdb_5 = m['vote_average'] / 2.0
                diff = m['user_rating'] - tmdb_5
                differences.append({
                    "title": m['title'], "year": m['year'], "user_rating": m['user_rating'],
                    "tmdb_rating": round(tmdb_5, 1), "diff": diff, "poster_url": m['poster_url']
                })
        
        pos_diffs = sorted(differences, key=lambda x: x['diff'], reverse=True)[:10]
        neg_diffs = sorted(differences, key=lambda x: x['diff'])[:10]

        all_directors = []
        for name, films in director_films.items():
            all_directors.append({
                "name": name, "total_count": sum(f['play_count'] for f in films), 
                "unique_count": len(films), "films": sorted(films, key=lambda x: x['play_count'], reverse=True)
            })
        top_directors_total = sorted(all_directors, key=lambda x: x['total_count'], reverse=True)[:10]
        top_directors_unique = sorted(all_directors, key=lambda x: x['unique_count'], reverse=True)[:10]

        all_actors = []
        for name, films in actor_films.items():
            all_actors.append({
                "name": name, "total_count": sum(f['play_count'] for f in films), 
                "unique_count": len(films), "films": sorted(films, key=lambda x: x['play_count'], reverse=True)
            })
        top_actors_total = sorted(all_actors, key=lambda x: x['total_count'], reverse=True)[:10]
        top_actors_unique = sorted(all_actors, key=lambda x: x['unique_count'], reverse=True)[:10]

        MIN_RATED_FILMS = 3
        top_rated_directors = []
        for d in all_directors:
            rated = [f for f in d['films'] if f['rating'] > 0]
            if len(rated) >= MIN_RATED_FILMS:
                top_rated_directors.append({
                    "name": d['name'], "avg_rating": sum(f['rating'] for f in rated) / len(rated), 
                    "count": len(rated), "films": sorted(rated, key=lambda x: x['rating'], reverse=True)
                })
        top_rated_directors = sorted(top_rated_directors, key=lambda x: (x['avg_rating'], x['count']), reverse=True)[:10]

        top_rated_actors = []
        for a in all_actors:
            rated = [f for f in a['films'] if f['rating'] > 0]
            if len(rated) >= MIN_RATED_FILMS:
                top_rated_actors.append({
                    "name": a['name'], "avg_rating": sum(f['rating'] for f in rated) / len(rated), 
                    "count": len(rated), "films": sorted(rated, key=lambda x: x['rating'], reverse=True)
                })
        top_rated_actors = sorted(top_rated_actors, key=lambda x: (x['avg_rating'], x['count']), reverse=True)[:10]

        # Parallelize Cast & Crew Biography Fetches
        all_cast_groups = [top_directors_total, top_directors_unique, top_actors_total, top_actors_unique, top_rated_directors, top_rated_actors]
        missing_bios = set()
        
        for group in all_cast_groups:
            for p in group:
                if 'biography' not in p:
                    missing_bios.add(p['name'])
                    
        if missing_bios:
            bio_pool = Pool(20)
            def fetch_bio_worker(name): return name, fetch_person_details(name)
            bio_results = [bio_pool.spawn(fetch_bio_worker, name) for name in missing_bios]
            gevent.joinall(bio_results)
            bio_dict = {res.value[0]: res.value[1] for res in bio_results if res.value}
        else:
            bio_dict = {}

       # Map the fetched data back to the person objects
        for group in all_cast_groups:
            for p in group:
                if 'biography' not in p:
                    details = bio_dict.get(p['name'], {"image_url": None, "biography": ""})
                    p['image_url'] = details['image_url']
                    p['biography'] = details['biography']
                    # We removed the lines here that were creating 'top_films'
                if 'avg_rating' in p and isinstance(p['avg_rating'], float):
                    p['avg_rating'] = round(p['avg_rating'], 2)

        # We completely deleted the loop that was doing: `if 'films' in p: del p['films']`
        # Now the full list of films is sent to the frontend!

        valid_years_df = movies_to_process[movies_to_process['safe_year'] > 0].copy()
        if not valid_years_df.empty:
            min_year = int(valid_years_df['safe_year'].min())
            max_year = int(valid_years_df['safe_year'].max())
            all_years_df = pd.DataFrame({'year': range(min_year, max_year + 1)})
            year_counts = valid_years_df.groupby('safe_year')['play_count'].sum().reset_index()
            year_counts.columns = ['year', 'count']
            rated_films_df = valid_years_df[valid_years_df['Rating'] > 0]
            year_ratings = rated_films_df.groupby('safe_year')['Rating'].mean().reset_index()
            year_ratings.columns = ['year', 'avg_rating']
            yearly_stats_df = pd.merge(all_years_df, year_counts, on='year', how='left')
            yearly_stats_df = pd.merge(yearly_stats_df, year_ratings, on='year', how='left')
            yearly_stats_df['count'] = yearly_stats_df['count'].fillna(0).astype(int)
            yearly_stats_df['avg_rating'] = yearly_stats_df['avg_rating'].fillna(0).round(2)
            yearly_stats_list = yearly_stats_df.to_dict('records')
            
            for y_stat in yearly_stats_list:
                y_stat['films'] = sorted(year_films.get(y_stat['year'], []), key=lambda x: (x['rating'], x['play_count']), reverse=True)
        else:
            yearly_stats_list = []
        
    avatar_url = fetch_user_profile(extracted_username)
            
    return {
        "username": extracted_username, "avatar_url": avatar_url,
        "total_watched": total_watched, "top_20": top_20_list, "total_hours": round(total_minutes / 60, 1),
        "total_countries": len(unique_countries), "total_directors": len(director_films), 
        "top_directors_total": top_directors_total, "top_directors_unique": top_directors_unique,
        "top_actors_total": top_actors_total, "top_actors_unique": top_actors_unique,
        "top_rated_directors_list": top_rated_directors, "top_rated_actors_list": top_rated_actors,
        "yearly_stats": yearly_stats_list,
        "genre_stats": sorted([{"Genre": k, "Count": v} for k, v in genre_counts.items()], key=lambda x: x['Count'], reverse=True)[:15],
        "rating_dist": [{"rating": k, "count": v} for k, v in rating_dist.items()],
        "country_stats": [{"Country": k, "Count": len(v), "films": sorted(v, key=lambda x: (x['rating'], x['play_count']), reverse=True)} for k, v in country_films.items()],
        "language_stats": sorted([{"Language": k, "Count": len(v), "films": sorted(v, key=lambda x: (x['rating'], x['play_count']), reverse=True)} for k, v in language_films.items()], key=lambda x: x['Count'], reverse=True),
        "milestones": milestones_dict,
        "differences": { "positive": pos_diffs, "negative": neg_diffs }
    }