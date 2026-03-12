# Real-time Weather Augmentation

Our HTTP server gets global traffic and must respond in under **100ms**. For requests from specific regions (like US or EU), we need to add local weather data (temperature, rain, etc.) before passing them to upstream processing. There is a lot of work upstream, so weather augmentation must finish in under **3ms**.

The requirements are strict:
- **Input:** The request has geographic coordinates (latitude and longitude).
- **External API:** Weather data comes from a third-party API, it can take seconds to respond.
- **Latency:** Must finish in under **3ms**.
- **Targeting:** We only add weather data to requests from targeted regions.

We have two main challenges on the hot path:
- Checking if a request needs weather data.
- Augmenting the request with weather data within the latency budget.

---

## Challenge 1: Check if a request needs weather data

This happens for every HTTP request, so it must be very fast and have predictable execution time.

### The Naive Approach: Ray Casting

We can save the borders of the US and EU as complex polygons. When a request comes in, we run a "point-in-polygon" algorithm like ray casting. This approach is simple, but:
- **Heavy CPU load**: Country borders are complex. The US polygon alone has thousands of edges. Ray casting is expensive per request.
- **Unpredictable latency**: Computation time depends on polygon shape and point location. A point inside a complex border takes much longer than a point outside. This breaks p99 latency limits.

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

### The Optimized Approach: Uber H3

To remove heavy computation from hot path, we do the work offline. We use [Uber H3](https://h3geo.org), a grid system that divides the globe into hexagons. Each hexagon covers a geographic area and has a unique 64-bit ID.

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

#### Performance Tuning: H3 Resolution

Choosing H3 resolution is a space-time trade-off.
- **Higher resolution** (smaller hexagons): Better accuracy, more memory
- **Lower resolution** (larger hexagons): Less accurate, less memory

For us, resolution `5` (one hexagon is ~252 sq km, each edge is ~8.5 km) is a good starting point. Weather targeting doesn't need high accuracy. We can easily adjust if the requirement change. Another optimization is to apply different resolutions at different regions, but that is not covered here

---

## Challenge 2: Augmenting Requests Without Blocking

Now we know the request is in the targeted region. We must fetch and attach weather data to request in 3ms.

### The Naive Approach: Direct API Calls

The simple way is to call the third-party weather API in the request handler. This immediately breaks the 3ms budget as external API takes second to responds

### The Optimized Approach: Hit-Miss Cache with Refresher

Weather does not change every minutes. If two requests are in the same H3 hexagon within 15 minutes, the weather data is probably the same. Even if weather changes, the weather data vendor may still not update very frequently (I know, I just can't prove it 😏)

We decouple the hot path from the slow API. We use Redis as a cache, and a background worker to call the external API.

#### The Hot Path Flow

In the request handler, when a request needs weather, we get its H3 Cell ID and check Redis for cached data.

- **Cache Hit:** Good
- **Cache Miss:** We add that missing cell ID to a Redis Set and forward the request upstream without weather data

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
#### The Background Refresher

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

In our cache miss path, we use Redis `SADD`. If a popular location's cache expires, we might get thousands of requests from that cell instantly. Using a Redis Set, items are automatically deduplicated. The worker fetches data for each cell only once.

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

## Takeaways
- Move heavy math offline
- Remove uncontrollable latency from the hot path
- Decouple with background workers

> AI was used to help refine and polish this article based on factual information
