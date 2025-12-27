# Real-time weather augmentation for HTTP requests
2025-08-28, Ho Chi Minh city

## 1. Problem
A HTTP server receives requests globally, for a subset of requests originating from some regions (e.g. US, EU), we must augment the request with weather data (historical, current, or even forecast data)
- Incoming requests contain coordinates (latitude, longitude)
- Weather data is retrieved from a third-party weather API, and it's slow (typically seconds)
- The HTTP server must respond < **100ms**
- Weather augmentation is required only for requests originating from certain regions, not all requests

### 1.1 Determine if a request needs weather data
Given a latitude and longitude:
- Decide if the request originates from target regions (e.g. US, EU)
- The decision must be fast and deterministic

### 1.2 Augment the request with weather data in real time
- Weather data comes from a slow external API
- The HTTP request path must remain low latency
- Data freshness should be acceptable (near real-time)

## 2. Solutions
### 2.1 Determine if a request needs weather data
#### 2.1.1 Naive approach: polygon containment

Store country or region boundaries as polygons. For each request, check whether the point (lat/lng) lies inside any polygon by using ray casting. This is simple and straightforward, but it has some major drawbacks: heavy computation at hot path, and latency is non-deterministic as it grows with number of polygons

```
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
|.  Yes / No   |
+--------------+
```

#### 2.1.2 Optimized Approach: Geo Indexing with Uber H3

Use a geospatial indexing system (Uber H3), preprocess region polygons into sets of H3 cell IDs, and at runtime, convert lat/lng directly to a cell ID and perform constant-time lookups. This has the following benefits:
- O(1) runtime check
- Heavy computation moved to preprocessing
- Predictable latency

But it also introduces a drawback: it requires preprocessing to convert from polygon or other location configurations to H3 cell IDs

**Preprocessing (Offline)**

```
+------------------+
| Region Polygons  |
+---------+--------+
          |
          v
+------------------+
| Polygon -> H3    |
| Cell Conversion  |
+---------+--------+
          |
          v
+------------------+
| Set of Cell IDs  |
+------------------+
```

**Runtime Flow**

```
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
       |
       v
+--------------+
| Cell ID in   |
| Target Set? |
+------+-------+
       |
       v
+--------------+
| Yes / No     |
+--------------+
```


### 2.2 Augmenting Requests with Weather Data in Real Time

#### 2.2.1 Naive approach: direct API call in hot path

Fetch weather data directly during request handling, this surely violates the 100ms latency requirement as external API calls are slow, and it blocks everything

**Flow**

```
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

#### 2.2.2 Optimized approach: hit-miss cache with separated refresher

Decouple request handling from weather fetching, use Redis as a fast cache, and fetch missing weather data asynchronously. This makes the HTTP path fast and deterministic, and external API latency is decoupled from the HTTP path

**HTTP Server Flow**

```
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

##### Weather Refresher Flow

```
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
+----------+-----------+
           |
           v
+----------------------+
| Update Redis Cache   |
+----------------------+
```

## Summary
- Geo indexing (Uber H3) transforms complex spatial queries into constant-time lookups
- Asynchronous cache refresh patterns allow real-time systems to depend on slow external APIs
- Combined geo indexing and asynchronous cache refresh patterns makes sub-100ms request handling possible

## Full source code

```go
Will try to rebuild a minimal working version when I have time
```