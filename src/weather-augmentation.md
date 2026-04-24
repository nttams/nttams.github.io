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

<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:24px 0;">
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">HTTP Request<span style="display:block;font-size:11px;color:#888;margin-top:2px;">(lat, lng)</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Ray Casting<span style="display:block;font-size:11px;color:#888;margin-top:2px;">point-in-polygon check</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#e8e8e8;border:1.5px solid #aaa;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Yes / No</div>
</div>

### The Optimized Approach: Uber H3

The problem with ray casting is that the work happens at request time. We fix this by doing the geometry work offline, before any request arrives.

We use [Uber H3](https://h3geo.org), a grid system that divides the globe into uniform hexagonal cells. Each cell has a unique 64-bit integer ID. Converting a latitude/longitude pair to a cell ID is fast and predictable

**Offline Preprocessing:**
We map our target region polygons (e.g. US, EU) onto the H3 grid at a chosen resolution. This gives us a set of cell IDs that cover the regions. We call this the `Target Cell Set`. At server startup, we load this set into memory as a Go `map[uint64]bool`.


<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:24px 0;">
  <div style="font-size:11px;color:#888;border:1px solid #d8d8d8;border-radius:4px;padding:2px 10px;margin-bottom:8px;">Offline</div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Region Polygons</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Polygon → H3 Cell Conversion</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Set of Cell IDs</div>
</div>

**Hot Path:**
When a request arrives, we convert its coordinates to an H3 cell ID. Then we check if that ID is in the Target Cell Set. The check is a single map lookup, O(1), no variance based on geographic complexity.

<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:24px 0;">
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">HTTP Request<span style="display:block;font-size:11px;color:#888;margin-top:2px;">(lat, lng)</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">lat/lng → H3 Cell ID</div>
  <div style="font-size:11px;color:#888;margin:2px 0;">O(1) Lookup</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#e8e8e8;border:1.5px solid #aaa;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Cell ID in Target Set?</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#e8e8e8;border:1.5px solid #aaa;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Yes / No</div>
</div>

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

<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:24px 0;">
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">HTTP Request<span style="display:block;font-size:11px;color:#888;margin-top:2px;">(lat, lng)</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">lat/lng → H3 Cell ID</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#e8e8e8;border:1.5px solid #aaa;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Redis Lookup</div>
  <div style="display:flex;justify-content:center;"><svg width="14" height="8" viewBox="0 0 14 8"><line x1="7" y1="0" x2="7" y2="8" stroke="#c0c0c0" stroke-width="1.5"/></svg></div>
  <div style="display:flex;gap:40px;align-items:flex-start;border-top:1.5px solid #c0c0c0;padding-top:8px;">
    <div style="display:flex;flex-direction:column;align-items:center;">
      <div style="font-size:11px;color:#888;margin-bottom:3px;">Hit</div>
      <div style="display:flex;justify-content:center;margin:2px 0;"><svg width="14" height="16" viewBox="0 0 14 16"><line x1="7" y1="0" x2="7" y2="9" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,16 2,8 12,8" fill="#c0c0c0"/></svg></div>
      <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#2d2d2d;">Attach Weather Data</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;">
      <div style="font-size:11px;color:#888;margin-bottom:3px;">Miss</div>
      <div style="display:flex;justify-content:center;margin:2px 0;"><svg width="14" height="16" viewBox="0 0 14 16"><line x1="7" y1="0" x2="7" y2="9" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,16 2,8 12,8" fill="#c0c0c0"/></svg></div>
      <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#2d2d2d;">Add cell ID to<br>cells_to_fetch</div>
    </div>
  </div>
  <div style="display:flex;justify-content:center;margin:8px 0 3px;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Forward to Upstream</div>
</div>

#### The Background Refresher

The Refresher is a dedicated service that runs on a 10-second tick. On each tick it:

1. Pops up to 50 cell IDs from `cells_to_fetch` using Redis `SPOP`.
2. Converts each cell ID back to a representative latitude/longitude point (H3 supports this natively)
3. Calls the weather API, using batch request to reduce network roundtrip
4. Writes the results back to Redis with a TTL of 15min

After the refresher runs, subsequent requests from those cells will find their data in cache. The first request from a new location always misses. This is an acceptable trade-off

The batch size and tick interval are both configurable. Together they act as a soft rate limiter on external API calls.

<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:24px 0;">
  <div style="font-size:11px;color:#888;border:1px solid #d8d8d8;border-radius:4px;padding:2px 10px;margin-bottom:8px;">runs every 10s</div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Weather Refresher</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">SPOP cells_to_fetch<span style="display:block;font-size:11px;color:#888;margin-top:2px;">up to 50 at a time</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Cell ID → lat/lng</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Call Weather API<span style="display:block;font-size:11px;color:#888;margin-top:2px;">slow, ~seconds, batched</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Update Redis Cache<span style="display:block;font-size:11px;color:#888;margin-top:2px;">key=cell ID, TTL=15min</span></div>
</div>

## Putting It All Together

<div style="font-family:system-ui,sans-serif;font-size:13px;color:#2d2d2d;margin:24px 0;display:flex;flex-direction:column;gap:16px;">
  <div style="border:1px solid #d8d8d8;border-radius:8px;padding:16px 20px;display:flex;flex-direction:column;align-items:center;">
    <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Offline, Build Time</div>
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Region Polygons (GeoJSON)</div>
    <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">geodata: Polygon → H3 Cell IDs<span style="display:block;font-size:11px;color:#888;margin-top:2px;">resolution 5, ~252 km² per cell</span></div>
    <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">CSV files per country<span style="display:block;font-size:11px;color:#888;margin-top:2px;">e.g. h3_res_5_usa.csv</span></div>
    <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Server Startup: load CSV into <code style="font-size:11px;">map[uint64]bool</code> (Target Cell Set)</div>
  </div>
  <div style="display:flex;gap:16px;align-items:flex-start;">
    <div style="border:1px solid #d8d8d8;border-radius:8px;padding:16px 20px;flex:1;display:flex;flex-direction:column;align-items:center;">
      <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Hot Path, per request, &lt;3ms</div>
      <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;width:160px;">HTTP Request<span style="display:block;font-size:11px;color:#888;margin-top:2px;">(lat, lng)</span></div>
      <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
      <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;width:160px;">lat/lng → H3 Cell ID<span style="display:block;font-size:11px;color:#888;margin-top:2px;">O(1) arithmetic</span></div>
      <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
      <div style="background:#e8e8e8;border:1.5px solid #aaa;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;width:160px;">Cell ID in Target Cell Set?</div>
      <div style="display:flex;justify-content:center;"><svg width="14" height="8" viewBox="0 0 14 8"><line x1="7" y1="0" x2="7" y2="8" stroke="#c0c0c0" stroke-width="1.5"/></svg></div>
      <div style="display:flex;gap:24px;align-items:flex-start;border-top:1.5px solid #c0c0c0;padding-top:8px;">
        <div style="display:flex;flex-direction:column;align-items:center;">
          <div style="font-size:11px;color:#888;margin-bottom:3px;">No</div>
          <div style="display:flex;justify-content:center;margin:2px 0;"><svg width="14" height="16" viewBox="0 0 14 16"><line x1="7" y1="0" x2="7" y2="9" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,16 2,8 12,8" fill="#c0c0c0"/></svg></div>
          <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 10px;text-align:center;font-size:13px;color:#2d2d2d;">Skip augmentation</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;">
          <div style="font-size:11px;color:#888;margin-bottom:3px;">Yes</div>
          <div style="display:flex;justify-content:center;margin:2px 0;"><svg width="14" height="16" viewBox="0 0 14 16"><line x1="7" y1="0" x2="7" y2="9" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,16 2,8 12,8" fill="#c0c0c0"/></svg></div>
          <div style="background:#e8e8e8;border:1.5px solid #aaa;border-radius:6px;padding:9px 10px;text-align:center;font-size:13px;color:#2d2d2d;">Redis GET<span style="display:block;font-size:11px;color:#888;margin-top:2px;">key = cell ID</span></div>
          <div style="display:flex;justify-content:center;"><svg width="14" height="8" viewBox="0 0 14 8"><line x1="7" y1="0" x2="7" y2="8" stroke="#c0c0c0" stroke-width="1.5"/></svg></div>
          <div style="display:flex;gap:16px;align-items:flex-start;border-top:1.5px solid #c0c0c0;padding-top:8px;">
            <div style="display:flex;flex-direction:column;align-items:center;">
              <div style="font-size:11px;color:#888;margin-bottom:3px;">Hit</div>
              <div style="display:flex;justify-content:center;margin:2px 0;"><svg width="14" height="16" viewBox="0 0 14 16"><line x1="7" y1="0" x2="7" y2="9" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,16 2,8 12,8" fill="#c0c0c0"/></svg></div>
              <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 10px;text-align:center;font-size:13px;color:#2d2d2d;">Attach weather data</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;">
              <div style="font-size:11px;color:#888;margin-bottom:3px;">Miss</div>
              <div style="display:flex;justify-content:center;margin:2px 0;"><svg width="14" height="16" viewBox="0 0 14 16"><line x1="7" y1="0" x2="7" y2="9" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,16 2,8 12,8" fill="#c0c0c0"/></svg></div>
              <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 10px;text-align:center;font-size:13px;color:#2d2d2d;">SADD cell to cells_to_fetch</div>
            </div>
          </div>
        </div>
      </div>
      <div style="display:flex;justify-content:center;margin:10px 0 3px;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
      <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;width:160px;">Forward to Upstream</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding-top:40px;gap:8px;">
      <div style="display:flex;align-items:center;gap:4px;"><svg width="20" height="14" viewBox="0 0 20 14"><line x1="0" y1="7" x2="13" y2="7" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="20,7 12,2 12,12" fill="#c0c0c0"/></svg><div style="font-size:11px;color:#888;">GET / SADD</div></div>
      <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:12px 16px;text-align:center;font-size:13px;color:#2d2d2d;">Redis<span style="display:block;font-size:11px;color:#888;margin-top:4px;">weather cache</span><span style="display:block;font-size:11px;color:#888;">cells_to_fetch</span></div>
      <div style="display:flex;align-items:center;gap:4px;"><div style="font-size:11px;color:#888;">SPOP / SET</div><svg width="20" height="14" viewBox="0 0 20 14"><line x1="20" y1="7" x2="7" y2="7" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="0,7 8,2 8,12" fill="#c0c0c0"/></svg></div>
    </div>
    <div style="border:1px solid #d8d8d8;border-radius:8px;padding:16px 20px;flex:1;display:flex;flex-direction:column;align-items:center;">
      <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Background Loop, every 10s</div>
      <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;width:160px;">Weather Refresher<span style="display:block;font-size:11px;color:#888;margin-top:2px;">dedicated service</span></div>
      <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
      <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;width:160px;">SPOP cells_to_fetch<span style="display:block;font-size:11px;color:#888;margin-top:2px;">up to 50 at a time</span></div>
      <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
      <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;width:160px;">Cell ID → lat/lng<span style="display:block;font-size:11px;color:#888;margin-top:2px;">H3 center point</span></div>
      <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
      <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;width:160px;">Call Weather API<span style="display:block;font-size:11px;color:#888;margin-top:2px;">slow, ~seconds, batched</span></div>
      <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
      <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;width:160px;">SET weather cache<span style="display:block;font-size:11px;color:#888;margin-top:2px;">key=cell ID, TTL=15min</span></div>
    </div>
  </div>
</div>


## Key Takeaways

1. **Move heavy computation offline.** Ray casting is correct but expensive and unpredictable. Precomputing the H3 cell set at build time reduces the hot path to a single integer lookup.
2. **Remove uncontrollable latency from the hot path.** Anything that calls an external system at request time will eventually blow your budget. The background refresher owns the slow work; the request handler only reads from cache.
3. **Use data structures that match the access pattern.** `SADD` into a Redis Set gives deduplication for free. `map[uint64]bool` gives O(1) lookup with no branching. Choose the right tool for each layer.
