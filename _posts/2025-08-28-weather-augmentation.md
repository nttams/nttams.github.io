---
layout: post
title: "Weather augmentation"
date: 2025-08-28
---

# Real-time weather augmentation for HTTP requests

## 1. Problem

An HTTP server receives traffic from all over the world. For some reason, you want to augment weather data to incoming HTTP request, but only requests originating from some certain places (e.g. USA).
- In HTTP request, there is geo data (latitude/longitude)
- Weather data is fetched from an external vendor API, and it usually takes seconds to respond
- Our HTTP server must process and respond in <100ms

---

## 2. How to know if the request is coming from certain places?

When a HTTP request arrives, it contain geo data (latitude/longitude), to know if the request comes from USA, we can use data from Natural Earth (https://www.naturalearthdata.com/), they provide country and region polygons, then we can apply a ray casting algorithm to determine whether the latitude/longitude lies within polygon(s)

This will work, but has some drawbacks:
- Ray casting requires extra work
- When number of polygons increases, computation time increases too

### 2.1. Geo indexing and move heavy computation into preprocessing
- We use geo indexing system (Uber H3), to divide the Earth's surface into cells. Each cell has a unique ID. 
- Preprocessing: convert polygons to cell sets: instead of storing polygons, we preprocess polygons into sets of cell IDs
- Fast runtime lookup:
	- When request comes, convert the incoming latitude/longitude to corresponding cell ID, this is O(1)
	- Simply check if the cell ID is in the set of cells. This is O(1) too

### 2.2. Choosing the right resolution (cell size)
Uber H3 divides the Earth into hexagonal cells at multiple resolutions
- High resolution → smaller cells, higher accuracy
- Low resolution → larger cells, less accuracy

https://h3geo.org/docs/core-library/restable/

## 3. Caching & weather refresher

Vendor weather API usually takes seconds to respond, that is not suitable for our real-time HTTP server, so we use a two-layered approach:

Step 1: HTTP Server
- Receives a request
- Extracts the latitude/longitude, converts into an cell ID
- Looks up weather data in Redis for that cell ID
	- If data is found: augment the request with weather data
	- If data is not found: add the cell ID to a Redis set(`cells_need_to_fetch`)

Step 2: Weather refresher
- A separate service runs periodically (e.g., every 10s)
- Reads pending cell IDs from the Redis set `cells_need_to_fetch`
- Converts cell IDs back to latitude/longitude
- Fetches weather data from the external vendor API
- Updates Redis with the new weather data for those cells

## 4. Flow charts

### 4.1 HTTP Server

                 +-------------------+
                 |   HTTP request    |
                 |  (with lat/lng)   |
                 +---------+---------+
                           |
                           v
                 +-------------------+
                 | Convert to cellID |
                 +---------+---------+
                           |
                           v
                 +-------------------+
                 |   Redis lookup    |
                 +----+---------+----+
                   |              |
                 Found         Not Found
                   |              |
                   v              v
     +-------------------+   +--------------------------+
     | Augment request   |   | Add cellID to Redis set: |
     | with weather data |   | cells_need_to_fetch      |
     +-------------------+   +--------------------------+

### 4.2 Weather refresher

                 (runs every 10s)
            +-----------------------+
            |   Weather refresher   |
            +-----------+-----------+
                        |
                        v
            +-----------------------+
            | Get cellIDs from Redis|
            |  cells_need_to_fetch  |
            +-----------+-----------+
                        |
                        v
            +-----------------------+
            |   CellID -> lat/lng   |
            +-----------+-----------+
                        |
                        v
            +-----------+-----------+
            |    Call Vendor API    |
            +-----------+-----------+
                        |
                        v
            +-----------------------+
            |     Update Redis     |
            |    with fresh data    |
            +-----------------------+
