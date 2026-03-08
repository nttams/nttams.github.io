# Real-time Weather Augmentation
2025-08-28

Modern web systems often need to add external data to requests. A request comes in, we call an external API, merge data, and send it back. But at large scale, strict latency makes this simple flow hard.

In this post, we share a real problem we faced. Our HTTP servers get global traffic. For requests from specific regions (US or EU), we need to add local weather data (temperature, rain) to the response.

The requirements are strict:
1. **Input:** The request has geographic coordinates (latitude and longitude).
2. **External Dependency:** Weather data comes from a third-party API. This API is slow and takes seconds to respond.
3. **Latency Budget:** Our HTTP server must respond in under **100ms**.
4. **Targeting:** We only add weather data to requests from targeted regions.

We have two main challenges on the hot path: checking if a request needs weather data based on coordinates, and getting the data without passing our latency budget.

Let's break down how we solved both problems.

---

## Challenge 1: Fast and Deterministic Geofencing

First, we need to decide: *Does this latitude and longitude fall inside our target regions?*

This decision happens for every HTTP request. So, it must be very fast, use little CPU, and have a steady execution time.

### The Naive Approach: Ray Casting

We can save the borders of the US and EU as complex polygons. When a request comes, we run a "point-in-polygon" algorithm like ray casting. We draw a line from the point and count how many times it crosses polygon edges.

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

This approach has big problems for high traffic:
- **Heavy CPU load**: Country borders are complex. The US polygon has thousands of edges. Ray casting uses too much CPU.
- **Unpredictable latency**: Computation time depends on polygon shape and point location. A point inside a complex border takes much longer than a point outside. This breaks p99 latency limits.

### The Optimized Approach: Uber's H3

To remove heavy math from the hot path, we do the work offline. We use grid systems like [Uber's H3](https://h3geo.org/).

H3 divides the globe into hexagons. Each hexagon covers a geographic area and has a unique 64-bit ID. Instead of doing math at runtime, we precalculate the intersections.

**Offline Preprocessing:**
We map our region polygons (US and EU) on the H3 grid at a chosen resolution. We find which H3 hexagons are inside our polygons. The result is a set of `Target Cell IDs`. We load this set into memory (like a Go `map[string]bool`).

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
When a request arrives, we convert its latitude and longitude to an H3 hexagon ID using the H3 library. Then, we look up if this ID exists in our in-memory set.

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

Pseudocode example:

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

#### Performance Tuning: H3 Resolution
Choosing H3 resolution is a space-time trade-off.
- Higher resolution (small hexagons): Better accuracy near country borders. But it uses huge memory because the Cell ID set is large.
- Lower resolution (large hexagons): Uses very little memory but makes borders inaccurate.

For us, resolution `7` (one hexagon is ~5 sq km) is a good balance. Memory usage is low, and accuracy is good enough for weather.

---

## Challenge 2: Augmenting Requests Without Blocking

Now we know the request is in the targeted region. We must get the weather data. How do we do this within 100ms when the API takes seconds?

### The Naive Approach: Direct API Calls

The simple way is to call the API in the request handler.

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

This breaks the 100ms rule immediately. Also, synchronous calls to slow APIs use up threads or file descriptors. During a traffic spike, requests wait for the slow weather API. This quickly causes thread starvation or out-of-memory crashes.

### The Optimized Approach: Hit-Miss Cache with Refresher

Weather does not change every millisecond. If two users are in the same H3 hexagon within 15 minutes, the weather data is the same.

We decouple the hot path from the slow API. We use Redis as a cache, and a background worker to call the external API.

#### The Hot Path Flow

In the main HTTP server, when a request needs weather, we get its H3 Cell ID and check Redis for cached data.

- **Cache Hit:** We get data from Redis instantly (~1-2ms), add it to the request, and serve the user.
- **Cache Miss:** We do **not** call the weather API. Instead, we add the missing cell ID to a Redis Set (our fetch queue). The HTTP request continues without weather data (graceful degradation) to skip the slow API delay.

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

Pseudocode for hot path:

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
            // We have the data, use it
            augmentData = weatherData
        }
        
        injectWeather(r, augmentData)
    }
    
    // Serve the request within < 100ms
    executeBusinessLogic(w, r)
}
```

#### The Background Refresher Flow

We run a background worker parallel to our HTTP server. We call it the Weather Refresher.

Every few seconds, the refresher reads the `cells_to_fetch` Set in Redis. It pops the cell IDs, converts them to latitude/longitude points, and calls the slow API. When it gets the data, it saves it in Redis with a Time-to-Live (TTL) of 30 to 60 minutes.

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

Conceptual code for Refresher:

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

#### Performance Tuning: Cache Stampede
In our cache miss path, we use Redis `SADD` instead of list push (`RPUSH`).

Why? If a popular location's cache expires, you might get 5,000 requests from there instantly. With a normal list, your queue gets 5,000 duplicate items. The background worker will call the slow API 5,000 times for the same data. This is bad for costs and API limits.

By using a Set (`SADD`), items are automatically deduplicated. The worker only fetches data for a cell once.

Also, limit the worker concurrency. You do not want the background worker to make thousands of requests at once and get your IP banned. Use a worker pool to control the request rate.

---

## Conclusion

Building real-time systems needs strict separation. By separating fast parts from slow parts, we built a highly scalable service.

Key engineering takeaways:
1. **Move heavy math offline.** Systems like Uber H3 change complex spatial math into constant-time hash map lookups.
2. **Remove uncontrollable latency from the hot path.** Third-party APIs are often the weakest link for latency.
3. **Decouple with background workers.** Asynchronous cache refresh allows real-time systems to use slow APIs. We accept temporary cache misses to keep fast p99 response times.

By combining offline precomputation and asynchronous hit-miss caching, we easily handle high traffic and always respond in under 100 milliseconds.

*(I will try to rebuild a minimal working version when I have time)*

\* *AI was used to help refine and polish this article based on factual information* \*
