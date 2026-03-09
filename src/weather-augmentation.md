# Real-time Weather Augmentation
2025-08-28

Our HTTP server gets global traffic and must respond in under **100ms**. For requests from specific regions (like US or EU), we need to add local weather data (temperature, rain, etc.) before passing them to upstream processing. There is a lot of work upstream, so weather augmentation must finish in under **3ms**.

The requirements are strict:
1. **Input:** The request has geographic coordinates (latitude and longitude).
2. **External Dependency:** Weather data comes from a third-party API. This API is slow and takes seconds to respond.
3. **Latency Budget:** Weather augmentation must complete in under **3ms** so the full request path stays under 100ms.
4. **Targeting:** We only add weather data to requests from targeted regions.

We have two main challenges on the hot path: checking if a request needs weather data, and getting the data without blowing our latency budget.

---

## Challenge 1: Fast and Deterministic Geofencing

First, we need to decide: *Does this latitude and longitude fall inside our target regions?*

This check happens for every HTTP request, so it must be very fast and have predictable execution time.

### The Naive Approach: Ray Casting

We can save the borders of the US and EU as complex polygons. When a request comes in, we run a "point-in-polygon" algorithm like ray casting. We draw a ray from the point and count how many times it crosses polygon edges.

```text
+-------------+
| HTTP Request|
| (lat, lng)  |
+------+------+
       |
       v
+--------------+
| Ray Casting  |
+------+-------+
       |
       v
+--------------+
|   Yes / No   |
+--------------+
```

This approach has problems at high traffic:
- **Heavy CPU load**: Country borders are complex. The US polygon alone has thousands of edges. Ray casting is expensive per request.
- **Unpredictable latency**: Computation time depends on polygon shape and point location. A point inside a complex border takes much longer than a point outside. This breaks p99 latency limits.

### The Optimized Approach: Uber's H3

To remove heavy math from the hot path, we do the work offline. We use [Uber's H3](https://h3geo.org/), a grid system that divides the globe into hexagons. Each hexagon covers a geographic area and has a unique 64-bit ID.

**Offline Preprocessing:**
We map our region polygons (US and EU) onto the H3 grid at a chosen resolution. We find which H3 hexagons are inside our polygons. The result is a set of `Target Cell IDs`. We load this set into memory as a Go `map[uint64]bool`.

```text
+------------------+
| Region Polygons  |
+---------+--------+
          |
          v
+------------------+
| Polygon -> H3    |
| Cell Conversion  |
+---------+--------+
          | (Offline)
          v
+------------------+
| Set of Cell IDs  |
+------------------+
```

**Hot Path Implementation:**
When a request arrives, we convert its coordinates to an H3 cell ID using the H3 library. Then we check if this ID exists in our in-memory set.

```text
+-------------+
| HTTP Request|
| (lat, lng)  |
+------+------+
       |
       v
+--------------+
| lat/lng ->   |
| H3 Cell ID   |
+------+-------+
       | O(1) Lookup
       v
+--------------+
| Cell ID in   |
| Target Set?  |
+------+-------+
       |
       v
+--------------+
|  Yes / No    |
+--------------+
```

Pseudocode:

```go
// Pre-loaded in memory at startup
var targetH3Cells map[uint64]bool // populated from offline preprocessing

func ShouldAugmentWeather(lat, lng float64) bool {
    // Convert lat/lng to an H3 index at resolution 5.
    // This is purely mathematical and takes nanoseconds.
    cellID := h3.LatLngToCell(h3.LatLng{Lat: lat, Lng: lng}, 5)

    // O(1) lookup
    return targetH3Cells[uint64(cellID)]
}
```

#### Building the Cell ID Set

We use [geodata](https://github.com/nttams/geodata), a small open-source tool that generates H3 cell IDs for every country in the world. It reads country boundary polygons from [Natural Earth](https://www.naturalearthdata.com/) GeoJSON data, fills each polygon with H3 cells at a given resolution, and writes the results to CSV files.

We run this tool once during our build pipeline. The output is one CSV file per country, for example `h3_res_5_usa.csv` and `h3_res_5_deu.csv`. At server startup, we read the CSV files for our target countries and load all cell IDs into the in-memory map.

#### Performance Tuning: H3 Resolution

Choosing H3 resolution is a space-time trade-off.
- **Higher resolution** (smaller hexagons): Better accuracy near country borders. But it uses more memory because the cell ID set is larger.
- **Lower resolution** (larger hexagons): Uses less memory but makes borders less accurate.

For us, resolution `5` (one hexagon is ~252 sq km) is a good balance. The accuracy is good enough for weather targeting, and the memory footprint is small.

---

## Challenge 2: Augmenting Requests Without Blocking

Now we know the request is in the targeted region. We must attach weather data and pass it to upstream processing—all within 3ms.

### The Naive Approach: Direct API Calls

The simple way is to call the third-party weather API in the request handler.

```text
+-------------+
| HTTP Request|
+------+------+
       |
       v
+--------------+
| Call Weather |
| API (slow)   |
+------+-------+
       |
       v
+--------------+
| Forward to   |
| Upstream     |
+--------------+
```

This immediately breaks our 3ms budget. Synchronous calls to slow external APIs also consume threads. During a traffic spike, requests back up waiting for the weather API. This causes thread starvation or out-of-memory crashes.

### The Optimized Approach: Hit-Miss Cache with Refresher

Weather does not change every millisecond. If two requests are in the same H3 hexagon within 15 minutes, the weather data is the same.

We decouple the hot path from the slow API. We use Redis as a cache, and a background worker to call the external API.

#### The Hot Path Flow

In the request handler, when a request needs weather, we get its H3 Cell ID and check Redis for cached data.

- **Cache Hit:** We get data from Redis (~1-2ms), attach it to the request, and forward it upstream.
- **Cache Miss:** We do **not** call the weather API. Instead, we add the missing cell ID to a Redis Set (our fetch queue) and forward the request upstream without weather data (graceful degradation).

```text
+------------------+
| HTTP Request     |
| (lat, lng)       |
+--------+---------+
         |
         v
+------------------+
| lat/lng -> H3 ID |
+--------+---------+
         |
         v
+------------------+
| Redis Lookup     |
+----+--------+----+
     |        |
   Hit      Miss
     |        |
     v        v
+--------+   +----------------------+
| Attach |   | Add cell ID to Redis |
| Weather|   | set: cells_to_fetch  |
+---+----+   +----------+-----------+
    |                   |
    +--------+----------+
             |
             v
    +------------------+
    | Forward to       |
    | Upstream         |
    +------------------+
```

Pseudocode for hot path:

```go
func HandleRequest(w http.ResponseWriter, r *http.Request) {
    lat, lng := parseCoordinates(r)

    if ShouldAugmentWeather(lat, lng) {
        cellID := h3.LatLngToCell(h3.LatLng{Lat: lat, Lng: lng}, 5)

        // Very fast network call to Redis (~1-2ms)
        weatherData, err := redisClient.Get(ctx, strconv.FormatUint(uint64(cellID), 10))

        if err == redis.ErrNil {
            // Cache MISS: queue the cell for background fetch
            // SADD prevents duplicates for the same cell
            redisClient.SAdd(ctx, "cells_to_fetch", uint64(cellID))

            // Forward without weather data to stay within latency budget
            attachWeather(r, defaultFallbackWeather())
        } else {
            // Cache HIT: attach the data
            attachWeather(r, weatherData)
        }
    }

    // Forward to upstream within < 3ms
    forwardUpstream(w, r)
}
```

#### The Background Refresher Flow

We run a background worker alongside our HTTP server. We call it the Weather Refresher.

Every few seconds, the refresher reads the `cells_to_fetch` Set in Redis. It pops the cell IDs, converts them to latitude/longitude points, and calls the slow API. When it gets the data, it saves it in Redis with a TTL of 30 to 60 minutes.

```text
(runs every 10s)

+----------------------+
| Weather Refresher    |
+----------+-----------+
           |
           v
+----------------------+
| Pop cells_to_fetch   |
+----------+-----------+
           |
           v
+----------------------+
| Cell -> lat/lng      |
+----------+-----------+
           |
           v
+----------------------+
| Call Weather API     |
| (slow, ~seconds)     |
+----------+-----------+
           |
           v
+----------------------+
| Update Redis Cache   |
| (Set key + TTL)      |
+----------------------+
```

Conceptual code for the refresher:

```go
func RunWeatherRefresher() {
    for {
        // Pop up to 50 missing cells from the Redis set
        cells, _ := redisClient.SPopN(ctx, "cells_to_fetch", 50)

        for _, cellStr := range cells {
            cellInt, _ := strconv.ParseUint(cellStr, 10, 64)
            cell := h3.Cell(cellInt)

            // Convert the grid ID back to a lat/lng point
            ll, _ := cell.LatLng()

            // Slow, blocking call to the external weather service
            weatherResponse := slowExternalWeatherAPI.Get(ll.Lat, ll.Lng)

            // Write to Redis with a 30-minute expiration
            redisClient.SetEx(ctx, cellStr, weatherResponse, 30*time.Minute)
        }

        time.Sleep(10 * time.Second)
    }
}
```

#### Performance Tuning: Cache Stampede

In our cache miss path, we use Redis `SADD` instead of list push (`RPUSH`).

Why? If a popular location's cache expires, we might get thousands of requests from that cell instantly. With a normal list, the queue gets thousands of duplicate items. The background worker would call the slow API once per item—a large waste and a risk of hitting API rate limits.

By using a Set (`SADD`), items are automatically deduplicated. The worker fetches data for each cell only once.

Also, we limit the worker concurrency. We do not want the background worker to make too many requests at once and get rate-limited. A worker pool with a fixed concurrency controls the request rate.

---

## Putting It All Together

```text
                   OFFLINE (build time)                            RUNTIME
          ┌──────────────────────────────┐
          │  Region Polygons (GeoJSON)   │
          └──────────────┬───────────────┘
                         │
                         v
          ┌──────────────────────────────┐
          │  geodata: Polygon -> H3      │
          │  Cell IDs (resolution 5)     │
          └──────────────┬───────────────┘
                         │
                         v
          ┌──────────────────────────────┐
          │  CSV files per country       │        ┌───────────────────────────────┐
          │  (e.g. h3_res_5_usa.csv)     │───────>│  Startup: load CSV into       │
          └──────────────────────────────┘        │  map[uint64]bool (Target Set) │
                                                  └──────────────┬────────────────┘
                                                                 │
            ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
                                                                 │
                            HOT PATH (per request, < 3ms)        │
                                                                 v
                                                  ┌───────────────────────────────┐
                                                  │  HTTP Request (lat, lng)      │
                                                  └──────────────┬────────────────┘
                                                                 │
                                                                 v
                                                  ┌───────────────────────────────┐
                                                  │  lat/lng -> H3 Cell ID        │
                                                  └──────────────┬────────────────┘
                                                                 │
                                                                 v
                                                  ┌────────────────────-──────────┐
                                                  │  Cell ID in Target Set?       │
                                                  └──────┬────────────────────────┘
                                                         │                  │
                                                        YES                 NO
                                                         │                  │
                                                         v                  │
                                                  ┌──────────────────┐      │
                                                  │  Redis Lookup    │      │
                                                  │  (cache key =    │      │
                                                  │   H3 Cell ID)    │      │
                                                  └──┬───────────┬───┘      │
                                                     │           │          │
                                                   HIT          MISS        │
                                                     │           │          │
                                                     v           v          │
                                              ┌──────────┐ ┌────────────┐   │
                                              │  Attach  │ │ SADD cell  │   │
                                              │  weather │ │ to Redis   │   │
                                              │  data    │ │ set:       │   │
                                              │          │ │ cells_to_  │   │
                                              │          │ │ fetch      │   │
                                              └────┬─────┘ └─────┬──────┘   │
                                                   │             │          │
                                                   │      ┌──────┘          │
                                                   │      │  Do nothing     │
                                                   │      │                 │
                                                   │      │                 │
                                                   │      │                 │
                                                   └──┬───┘                 │
                                                      │                     │
                                                      v                     │
                                                  ┌──────────────────┐      │
                                                  │  Forward to      │<────-┘
                                                  │  Upstream        │
                                                  └──────────────────┘

            ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─

                            BACKGROUND LOOP (every 10s)

                        ┌─────────────────────────────────────┐
                        │  Weather Refresher                  │
                        └──────────────────┬──────────────────┘
                                           │
                                           v
                        ┌─────────────────────────────────────┐
                        │  SPOP cells_to_fetch (up to 50)     │
                        └──────────────────┬──────────────────┘
                                           │
                                           v
                        ┌─────────────────────────────────────┐
                        │  Cell ID -> lat/lng                 │
                        └──────────────────┬──────────────────┘
                                           │
                                           v
                        ┌─────────────────────────────────────┐
                        │  Call Weather API (slow, ~seconds)  │
                        └──────────────────┬──────────────────┘
                                           │
                                           v
                        ┌─────────────────────────────────────┐
                        │  Update Redis Cache (key + TTL)     │
                        └─────────────────────────────────────┘
```

---

## Key takeaways
1. **Move heavy math offline.** H3 changes complex spatial math into a constant-time hash map lookup. Generating the cell set offline with a tool like [geodata](https://github.com/nttams/geodata) keeps the hot path clean.
2. **Remove uncontrollable latency from the hot path.** Third-party APIs are a weak link for latency. We never call them in-request.
3. **Decouple with background workers.** Asynchronous cache refresh lets real-time systems use slow APIs. We accept temporary cache misses to keep p99 latency stable.

> AI was used to help refine and polish this article based on factual information
