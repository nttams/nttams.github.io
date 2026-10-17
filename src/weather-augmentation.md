# Real-time Weather Augmentation

Our HTTP server handles global traffic and must respond in under **100ms** end-to-end. A new feature request comes in: augment requests with local weather data before passing them to upstream processing. Weather context lets the upstream system make better decisions. A campaign for rain gear should bid higher when it is actually raining. The catch is that not all requests need this. Only requests from configurable target regions do, for example the US and EU.

The requirements are:
- **Input:** Each request has geographic coordinates (latitude and longitude)
- **External API:** Weather data comes from a third-party provider. It can take seconds to respond.
- **Latency:** Augmentation must finish in under **3ms**
- **Targeting:** Only requests from targeted regions need weather data

We have two main challenges on the hot path:
- Checking whether a request needs weather data
- Fetching and attaching weather data within the latency budget

## Challenge 1: Check if a request needs weather data

This happens for every HTTP request, so it must be very fast and predictable

### The Naive Approach: Ray Casting

We can represent region boundaries as polygons and use a point-in-polygon algorithm like ray casting: cast a ray from the point to infinity and count how many edges it crosses. If the count is odd, the point is inside.

This is conceptually simple but breaks down in practice:
- **Heavy CPU load**: Country borders are complex. The US polygon alone can have thousands of edges. Checking each one on every incoming request is expensive at scale.
- **Unpredictable latency**: Computation time varies with polygon complexity and point location

### The Optimized Approach: Uber H3

The problem with ray casting is that the work happens at request time. We fix this by doing the geometry work offline, before any request arrives.

We use [Uber H3](https://h3geo.org), a grid system that divides the globe into uniform hexagonal cells. Each cell has a unique 64-bit integer ID. Converting a latitude/longitude pair to a cell ID is fast and predictable

**Offline Preprocessing:**
We map our target region polygons (e.g. US, EU) onto the H3 grid at a chosen resolution. This gives us a set of cell IDs that cover the regions. We call this the `Target Cell Set`. At server startup, we load this set into memory as a Go `map[uint64]bool`.

**Hot Path:**
When a request arrives, we convert its coordinates to an H3 cell ID. Then we check if that ID is in the Target Cell Set. The check is a single map lookup, O(1), no variance based on geographic complexity.

#### Building the Cell ID Set

We use [geodata](https://github.com/nttams/geodata), a small open-source tool that generates H3 cell IDs for every country in the world. It reads country boundary polygons from [Natural Earth](https://www.naturalearthdata.com/) GeoJSON data, fills each polygon with H3 cells at a given resolution, and writes the results to CSV files.

#### Performance Tuning: H3 Resolution

H3 resolution controls the size of each hexagonal cell. Higher resolution means smaller cells, better geographic precision, but more cells to store.

| Resolution | Avg Cell Area | Avg Edge Length | Approx. US cells |
|---|---|---|---|
| 3 | 12,393 km² | 68.98 km | ~2,000 |
| 4 | 1,770 km² | 26.07 km | ~14,000 |
| 5 | 253 km² | 9.85 km | ~97,000 |
| 6 | 36 km² | 3.73 km | ~680,000 |

We use resolution `5`. At that resolution, the US is covered by roughly 97,000 cells. Each cell ID is a `uint64` (8 bytes). A Go `map[uint64]bool` for the US at resolution 5 occupies roughly 10-15 MB including map overhead. That is cheap. We load the CSV at startup and keep it in memory for the lifetime of the process.

Weather targeting does not need street-level precision. An 10km edge length is accurate enough: weather is consistent within that radius, and the campaign targeting criteria are not that fine-grained. If requirements tighten, we can increase resolution without changing anything else in the system.

One further optimization is to use different resolutions for different regions. Dense urban areas might justify higher resolution for accuracy; sparse regions can afford lower resolution to save memory

## Challenge 2: Augmenting Requests Without Blocking

Now we know the request is in the targeted region. Now we need to attach weather data in under 3ms. But the weather API takes seconds

### Hit-Miss Cache with Background Refresher

The key insight is that weather data does not change per-request. Two requests from the same H3 cell within 15 minutes will see the same weather. We exploit this by caching weather data keyed by H3 cell ID, and refreshing it asynchronously in the background

The system has two parts: a fast hot path that reads from cache, and a background worker for the slow API calls.

#### The Hot Path Flow

When a request needs weather, we look up its H3 cell ID in Redis.

- **Cache Hit:** Attach the cached weather data. Done in a single Redis GET.
- **Cache Miss:** We cannot wait for the API. Instead, we record the missing cell ID using Redis `SADD` into a set called `cells_to_fetch`, then forward the request upstream without weather data. The next request from the same cell will hit the cache after the background worker has filled it.

Using `SADD` is deliberate. If a popular location's cache expires and thousands of requests arrive simultaneously, every one of them would write the same cell ID. Because `cells_to_fetch` is a Redis Set, duplicates are ignored automatically. The background worker will fetch that cell exactly once, not thousands of times.

#### The Background Refresher

The Refresher is a dedicated service that runs on a 10-second tick. On each tick it:

1. Pops up to 50 cell IDs from `cells_to_fetch` using Redis `SPOP`.
2. Converts each cell ID back to a representative latitude/longitude point (H3 supports this natively)
3. Calls the weather API, using batch request to reduce network roundtrip
4. Writes the results back to Redis with a TTL of 15min

After the refresher runs, subsequent requests from those cells will find their data in cache. The first request from a new location always misses. This is an acceptable trade-off

The batch size and tick interval are both configurable. Together they act as a soft rate limiter on external API calls.

## Putting It All Together

The simulator below runs every flow from this article in one place:

- **Offline build:** region polygons are filled with H3 cells to form the Target Cell Set. Toggle US, EU or JP to rebuild it.
- **Region check:** switch between H3 lookup and ray casting to compare cost per request.
- **Hit-miss cache:** targeted requests read Redis. Misses go into `cells_to_fetch` and are forwarded without weather.
- **Background refresher:** every tick it pops a batch, calls the slow weather API, and writes the cache with a TTL.

Click the map to send a request from any point. Use "Burst" to expire a popular cell and watch `SADD` absorb the duplicates.

<iframe src="./weather-augmentation-sim.html" title="Weather augmentation simulator" style="width:100%;height:1110px;border:1px solid #d8d8d8;border-radius:8px;" loading="lazy"></iframe>

[Open the simulator in full screen](./weather-augmentation-sim.html)

## Key Takeaways

1. **Move heavy computation offline.** Ray casting is correct but expensive and unpredictable. Precomputing the H3 cell set at build time reduces the hot path to a single integer lookup.
2. **Remove uncontrollable latency from the hot path.** Anything that calls an external system at request time will eventually blow your budget. The background refresher owns the slow work; the request handler only reads from cache.
3. **Use data structures that match the access pattern.** `SADD` into a Redis Set gives deduplication for free. `map[uint64]bool` gives O(1) lookup with no branching. Choose the right tool for each layer.
