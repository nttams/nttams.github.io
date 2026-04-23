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

## Challenge 1: Check if a request needs weather data

This happens for every HTTP request, so it must be very fast and have predictable execution time.

### The Naive Approach: Ray Casting

We can save the borders of the US and EU as complex polygons. When a request comes in, we run a "point-in-polygon" algorithm like ray casting. This approach is simple, but:
- **Heavy CPU load**: Country borders are complex. The US polygon alone has thousands of edges. Ray casting is expensive per request.
- **Unpredictable latency**: Computation time depends on polygon shape and point location. A point inside a complex border takes much longer than a point outside. This breaks p99 latency limits.

<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:24px 0;">
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">HTTP Request<span style="display:block;font-size:11px;color:#888;margin-top:2px;">(lat, lng)</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Ray Casting<span style="display:block;font-size:11px;color:#888;margin-top:2px;">point-in-polygon check</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#e8e8e8;border:1.5px solid #aaa;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Yes / No</div>
</div>

### The Optimized Approach: Uber H3

To remove heavy computation from hot path, we do the work offline. We use [Uber H3](https://h3geo.org), a grid system that divides the globe into hexagons. Each hexagon covers a geographic area and has a unique 64-bit ID.

**Offline Preprocessing:**
We map our region polygons (US and EU) onto the H3 grid at a chosen resolution. We find which H3 hexagons are inside our polygons. The result is a set of `Target Cell IDs`. We load this set into memory as a Go `map[uint64]bool`.

<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:24px 0;">
  <div style="font-size:11px;color:#888;border:1px solid #d8d8d8;border-radius:4px;padding:2px 10px;margin-bottom:8px;">Offline</div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Region Polygons</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Polygon → H3 Cell Conversion</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Set of Cell IDs</div>
</div>

**Hot Path Implementation:**
When a request arrives, we convert its coordinates to an H3 cell ID using the H3 library. Then we check if this ID exists in our in-memory set.

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

Choosing H3 resolution is a space-time trade-off.
- **Higher resolution** (smaller hexagons): Better accuracy, more memory
- **Lower resolution** (larger hexagons): Less accurate, less memory

For us, resolution `5` (one hexagon is ~252 sq km, each edge is ~8.5 km) is a good starting point. Weather targeting doesn't need high accuracy. We can easily adjust if the requirement change. Another optimization is to apply different resolutions at different regions, but that is not covered here

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

We run a background worker alongside our HTTP server. We call it the Weather Refresher.

Every few seconds, the refresher reads the `cells_to_fetch` Set in Redis. It pops the cell IDs, converts them to latitude/longitude points, and calls the slow API. When it gets the data, it saves it in Redis with a TTL of 30 to 60 minutes.

<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:24px 0;">
  <div style="font-size:11px;color:#888;border:1px solid #d8d8d8;border-radius:4px;padding:2px 10px;margin-bottom:8px;">runs every 10s</div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Weather Refresher</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Pop cells_to_fetch</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Cell → lat/lng</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Call Weather API<span style="display:block;font-size:11px;color:#888;margin-top:2px;">slow, ~seconds</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Update Redis Cache<span style="display:block;font-size:11px;color:#888;margin-top:2px;">Set key + TTL</span></div>
</div>

In our cache miss path, we use Redis `SADD`. If a popular location's cache expires, we might get thousands of requests from that cell instantly. Using a Redis Set, items are automatically deduplicated. The worker fetches data for each cell only once.

## Putting It All Together

<div style="font-family:system-ui,sans-serif;font-size:13px;color:#2d2d2d;margin:24px 0;display:flex;flex-direction:column;gap:16px;">

  <!-- OFFLINE section -->
  <div style="border:1px solid #d8d8d8;border-radius:8px;padding:16px 20px;display:flex;flex-direction:column;align-items:center;">
    <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Offline, Build Time</div>
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Region Polygons (GeoJSON)</div>
    <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">geodata: Polygon → H3 Cell IDs<span style="display:block;font-size:11px;color:#888;margin-top:2px;">resolution 5</span></div>
    <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">CSV files per country<span style="display:block;font-size:11px;color:#888;margin-top:2px;">e.g. h3_res_5_usa.csv</span></div>
    <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Startup: load CSV into<br><code style="font-size:11px;">map[uint64]bool</code> (Target Set)</div>
  </div>

  <!-- HOT PATH section -->
  <div style="border:1px solid #d8d8d8;border-radius:8px;padding:16px 20px;display:flex;flex-direction:column;align-items:center;">
    <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Hot Path, per request, &lt;3ms</div>
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">HTTP Request<span style="display:block;font-size:11px;color:#888;margin-top:2px;">(lat, lng)</span></div>
    <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">lat/lng → H3 Cell ID</div>
    <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
    <div style="background:#e8e8e8;border:1.5px solid #aaa;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Cell ID in Target Set?</div>
    <div style="display:flex;justify-content:center;"><svg width="14" height="8" viewBox="0 0 14 8"><line x1="7" y1="0" x2="7" y2="8" stroke="#c0c0c0" stroke-width="1.5"/></svg></div>
    <div style="display:flex;gap:48px;align-items:flex-start;border-top:1.5px solid #c0c0c0;padding-top:8px;">
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="font-size:11px;color:#888;margin-bottom:3px;">No</div>
        <div style="display:flex;justify-content:center;margin:2px 0;"><svg width="14" height="16" viewBox="0 0 14 16"><line x1="7" y1="0" x2="7" y2="9" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,16 2,8 12,8" fill="#c0c0c0"/></svg></div>
        <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#2d2d2d;">Skip augmentation</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="font-size:11px;color:#888;margin-bottom:3px;">Yes</div>
        <div style="display:flex;justify-content:center;margin:2px 0;"><svg width="14" height="16" viewBox="0 0 14 16"><line x1="7" y1="0" x2="7" y2="9" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,16 2,8 12,8" fill="#c0c0c0"/></svg></div>
        <div style="background:#e8e8e8;border:1.5px solid #aaa;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#2d2d2d;">Redis Lookup<span style="display:block;font-size:11px;color:#888;margin-top:2px;">cache key = H3 Cell ID</span></div>
        <div style="display:flex;justify-content:center;"><svg width="14" height="8" viewBox="0 0 14 8"><line x1="7" y1="0" x2="7" y2="8" stroke="#c0c0c0" stroke-width="1.5"/></svg></div>
        <div style="display:flex;gap:32px;align-items:flex-start;border-top:1.5px solid #c0c0c0;padding-top:8px;">
          <div style="display:flex;flex-direction:column;align-items:center;">
            <div style="font-size:11px;color:#888;margin-bottom:3px;">Hit</div>
            <div style="display:flex;justify-content:center;margin:2px 0;"><svg width="14" height="16" viewBox="0 0 14 16"><line x1="7" y1="0" x2="7" y2="9" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,16 2,8 12,8" fill="#c0c0c0"/></svg></div>
            <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#2d2d2d;">Attach weather data</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;">
            <div style="font-size:11px;color:#888;margin-bottom:3px;">Miss</div>
            <div style="display:flex;justify-content:center;margin:2px 0;"><svg width="14" height="16" viewBox="0 0 14 16"><line x1="7" y1="0" x2="7" y2="9" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,16 2,8 12,8" fill="#c0c0c0"/></svg></div>
            <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 14px;text-align:center;font-size:13px;color:#2d2d2d;">SADD cell to<br>cells_to_fetch</div>
          </div>
        </div>
      </div>
    </div>
    <div style="display:flex;justify-content:center;margin:10px 0 3px;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Forward to Upstream</div>
  </div>

  <!-- BACKGROUND LOOP section -->
  <div style="border:1px solid #d8d8d8;border-radius:8px;padding:16px 20px;display:flex;flex-direction:column;align-items:center;">
    <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Background Loop, every 10s</div>
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Weather Refresher</div>
    <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">SPOP cells_to_fetch<span style="display:block;font-size:11px;color:#888;margin-top:2px;">up to 50 at a time</span></div>
    <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Cell ID → lat/lng</div>
    <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Call Weather API<span style="display:block;font-size:11px;color:#888;margin-top:2px;">slow, ~seconds</span></div>
    <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Update Redis Cache<span style="display:block;font-size:11px;color:#888;margin-top:2px;">key + TTL</span></div>
  </div>

</div>

## Takeaways
- Move heavy math offline
- Remove uncontrollable latency from the hot path
- Decouple with background workers
