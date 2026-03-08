# Real-time Weather Augmentation for HTTP Requests: Keeping Latency Under 100ms
2025-08-28

\* *AI was used to help refine and polish this article based on factual information* \*

Modern web architecture often demands integrating internal systems with external data providers. At a glance, this seems like a standard task: a request comes in, you make a call to an external API, merge the data, and send it back. However, when you operate at scale, strict latency budgets make this simple flow surprisingly hard.

In this post, I will share a real-world problem we faced. Our HTTP servers receive traffic globally. For a specific subset of these incoming requests—specifically those originating from targeted regions like the US or the EU—we needed to augment the payload with local weather data (such as temperature, rain probability, and historical patterns). 

The requirements were strict:
1. **Input:** The incoming request contains geographic coordinates (latitude and longitude).
2. **External Dependency:** The weather data lives behind a third-party weather API. This API is painfully slow, often taking several seconds to respond.
3. **Latency Budget:** Our HTTP server must respond in under **100ms**
4. **Targeting:** We do not want to enrich every single request—only the ones falling inside our targeted geographic regions.

This presents two distinct engineering challenges on the hot path: determining if a request needs weather data based on its coordinates, and fetching that data without blowing up our latency budget. 

Let's break down how we approached and solved both problems.

---

## Challenge 1: Fast and Deterministic Geofencing

The first step in the pipeline is a gating decision: *Does this given pair of latitude and longitude fall inside our target regions?* 

This decision must happen for every single incoming HTTP request. Therefore, it needs to be insanely fast, CPU-efficient, and most importantly, deterministic in its execution time.

### The Naive Approach: Polygon Containment via Ray Casting

The intuition here is simple. You store the geographic boundaries of the US and EU as complex polygons. When a request comes in, you execute a "point-in-polygon" algorithm. The most common method is ray casting, where you draw an imaginary line from the point in a single direction and count how many times it intersects the polygon edges.

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

While easy to understand, this approach has fatal flaws when put on a high-throughput hot path:
- **Heavy CPU load**: Geographic boundaries are not simple squares. The polygon for a country like the US can have thousands of edges. Running ray casting against complex shapes consumes significant CPU cycles.
- **Non-deterministic latency**: The time it takes to compute the result depends heavily on the complexity of the polygon and where the point is located geometrically. A point inside a highly complex border might take 10x longer to compute than a point outside a simple border. This ruins our p99 latency guarantees.

### The Optimized Approach: Geo-Indexing with Uber's H3

To remove the heavy computation from the hot path, we needed a way to shift the workload to an offline process. This is where grid systems like [Uber's H3](https://h3geo.org/) shine.

H3 is a geospatial indexing system that divides the globe into a grid of hexagons. Every hexagon represents a specific geographic area and is identified by a unique 64-bit integer (represented as a short string).

Instead of computing intersections at runtime, we can precompute them. 

**Offline Preprocessing Phase:**
We take our complex region polygons (the US and EU) and map them onto the H3 grid at a chosen resolution. We figure out exactly which H3 hexagons are inside our polygons. The result is simply a large set of `Target Cell IDs`. We load this set into memory (like a standard Hash Set or Go `map[string]struct{}`).

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
When the HTTP request arrives, we take the latitude and longitude, use the lightweight H3 library to find out which hexagon it belongs to, and simply check if that hexagon ID exists in our in-memory set.

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

Here is a quick pseudocode snippet showing how this looks in practice:

```go
// Pre-loaded in memory at startup
var targetH3Cells map[string]bool // populated from offline preprocessing

func ShouldAugmentWeather(lat, lng float64) bool {
    // 1. Convert lat/lng to an H3 index at resolution 7 
    // This is incredibly fast and purely mathematical.
    cellID := h3.GeoToH3(lat, lng, 7)
    
    // 2. Perform an O(1) lookup
    return targetH3Cells[h3.ToString(cellID)]
}
```

#### Performance Tuning Insights: H3 Resolution
Choosing the correct H3 resolution is a classic space-time trade-off. 
- Higher resolutions (smaller hexagons) provide very accurate boundaries, preventing false positives near country borders. But this requires huge memory because the set of Cell IDs will be massive. 
- Lower resolutions (larger hexagons) consume very little memory but make the borders jagged and inaccurate.

In our case, a resolution of `7` (where each hexagon represents about 5 square kilometers) provided a perfect balance. The memory footprint easily fit into our service's RAM limit, and the accuracy was completely acceptable for a weather application.

---

## Challenge 2: Augmenting Requests Without Blocking

Now that we know the request falls in the targeted region, we need to fetch the weather for that location. How do we do this when our latency budget is 100ms, and the API takes seconds to answer?

### The Naive Approach: Direct API Calls

The most straightforward way is to just call the API over HTTP inside the request handler.

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
| HTTP Response|
+--------------+
```

Obviously, this violates the 100ms rule immediately. Furthermore, synchronous calls to slow external dependencies consume threads or file descriptors. If there is a traffic spike, the incoming requests will queue up waiting for the slow weather API, quickly causing thread pool exhaustion or out-of-memory crashes.

### The Optimized Approach: The Hit-Miss Cache with Sidecar Refresher

The fundamental realization here is that **weather does not change every millisecond**. If two users open the app from the exact same H3 hexagon within a 15-minute window, the weather data will be functionally identical. 

We can completely decouple the hot path from the slow external API. To do this, we use Redis as an intermediate cache layer, and introduce an asynchronous worker process whose only job is to interact with the external API.

#### The Hot Path Flow

In the main HTTP server process, when a request is flagged for augmentation, we extract its H3 Cell ID and ask Redis for the cached weather data associated with that cell.

- **Cache Hit:** We get the data from Redis instantly (usually ~1-2ms), inject it into the request, and serve the user.
- **Cache Miss:** We do **not** call the weather API. Instead, we insert the missing cell ID into a Redis Set (representing a queue of locations that need data). The HTTP request immediately continues without weather data (which degrades gracefully on the client side), skipping the slow API.

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
| Augment|   | Add cell ID to Redis |
| Request|   | set: cells_to_fetch  |
+--------+   +----------------------+
```

Here is a pseudocode example of the hot path logic:

```go
func HandleRequest(w http.ResponseWriter, r *http.Request) {
    lat, lng := parseCoordinates(r)
    
    if ShouldAugmentWeather(lat, lng) {
        cellID := h3.GeoToH3(lat, lng, 7)
        strCellID := h3.ToString(cellID)
        
        // Very fast network call to Redis
        weatherData, err := redisClient.Get(ctx, strCellID)
        
        if err == redis.ErrNil {
            // Cache MISS case:
            // Add to our processing queue using SADD (Set Add)
            // SADD prevents duplicate queue items for the same cell
            redisClient.SAdd(ctx, "cells_to_fetch", strCellID)
            
            // Proceed without weather data to keep it under 100ms
            augmentData = defaultFallbackWeather() 
        } else {
            // Cache HIT case:
            augmentData = weatherData
        }
        
        injectWeather(r, augmentData)
    }
    
    // Serve the request within < 100ms
    executeBusinessLogic(w, r)
}
```

#### The Background Refresher Flow

Running parallel to our HTTP server is a background worker or chron job. We call this the Weather Refresher. 

Every few seconds, the refresher looks at the `cells_to_fetch` Set in Redis. It pops the cell IDs, converts them back to a generic central point (lat/lng), and then makes the slow API calls. Once the data is retrieved, it writes the result back into the Redis cache with a generous Time-to-Live (TTL), usually around 30 to 60 minutes.

```text
(runs every 10s)

+----------------------+
| Weather Refresher    |
+----------+-----------+
           |
           v
+----------------------+
| Read cells_to_fetch  |
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
| (slow execution)     |
+----------+-----------+
           |
           v
+----------------------+
| Update Redis Cache   |
| (Set key and TTL)    |
+----------------------+
```

Here is how the Refresher works conceptually:

```go
func RunWeatherRefresher() {
    for {
        // Pop up to 50 missing cells from the Redis set
        cells, _ := redisClient.SPopN(ctx, "cells_to_fetch", 50)
        
        for _, cellID := range cells {
            // Convert the grid ID back to a latitude/longitude point
            lat, lng := h3.ToGeo(h3.FromString(cellID))
            
            // Slow, blocking call to the external weather service
            weatherResponse := slowExternalWeatherAPI.Get(lat, lng)
            
            // Write it to Redis with a 30-minute expiration
            redisClient.SetEx(ctx, cellID, weatherResponse, 30 * time.Minute)
        }
        
        time.Sleep(10 * time.Second)
    }
}
```

#### Performance Tuning Insights: Handling the Cache Stampede
Notice that in our missing cache path, we use Redis `SADD` to append to `cells_to_fetch` rather than a standard list queue push (`RPUSH`). 

Why? Because if a popular location's cache key expires, you might instantly receive 5,000 requests from that location. If you append to a standard list queue, your queue will suddenly contain 5,000 identical items. Your background refresher will pull the same data from the slow API 5,000 times, wasting API quota limits and increasing costs. 

By using a Set (`SADD`), the items are deduplicated implicitly. The refresher will only ever see one task to fetch that specific cell.

Another important insight is limiting the fetcher concurrency. You do not want the background worker to spawn thousands of identical goroutines to bombard the weather API, as it could get your IP address quickly banned. Using a predefined worker pool allows you to strictly control the exact rate of outbound HTTP requests.

---

## Conclusion

Building real-time systems often requires ruthless isolation. By aggressively separating the fast components from the slow components, we were able to deliver a highly scalable augmentation service.

To summarize the key engineering takeaways:
1. **Move heavy computation offline.** Geo-indexing systems like Uber H3 allow you to transform complex spatial queries into constant-time hash map lookups.
2. **Never put uncontrollable latency in the hot path.** Third-party APIs are often the weakest link in latency SLAs. 
3. **Decouple via asynchronous workers.** The asynchronous cache refresh pattern allows a real-time system to heavily utilize slow external APIs by accepting temporary cache misses (graceful degradation) in exchange for rock-solid p99 response times.

By mixing offline geographical precomputation with an asynchronous hit-miss caching architecture, we easily handle massive throughput bursts while consistently responding in under 100 milliseconds.

*(Will try to rebuild a minimal working version when I have time)*