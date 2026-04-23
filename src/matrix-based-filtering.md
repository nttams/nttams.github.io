# Matrix-Based Filtering

## The Matching Problem
In a Real-Time Bidding (RTB) system, a Demand-Side Platform (DSP) handles thousands of bid requests every second. For each request, we must quickly find which active campaigns want to bid on it.

Each bid request has multiple attributes, like country ("us", "jp", "sg"), language ("en", "fr", "vn"), device type, and website. At the same time, each campaign has strict targeting rules. One campaign might only target iOS users from the "us" who speak "en". Another might accept users from anywhere except the "eu".

We only have ~100ms to find all matching campaigns. A simple approach is to loop through every campaign and check its rules one by one. But this is too slow. Checking 50 rules for thousand of campaigns for every request takes too much time.

A better approach is to use a matrix-based filtering approach. Instead of checking a request against each campaign, we use an inverted index. This means we map request attributes directly to the campaigns looking for them.

## The Matrix-Based System
The matching logic uses bitsets. A bitset is an array of bits (0s and 1s). Every campaign gets a fixed ID. In a bitset, the bit at index `i` always stands for campaign `i`. And we do not store rules inside campaign objects. Instead, we use separate filters for each attribute, like a Language Filter or a Location Filter. Each filter manages its own include and exclude rules using maps. The map key is the attribute (like "en" or "us"), and the value is a bitset. We evaluate these rules based on simple logic:

- **No include, no exclude:** accept all values.
- **No include, has exclude:** accept all values except those in exclude list.
- **Has include, no exclude:** accept only values in include list.
- **Has include, has exclude:** accept only values in include list, that are not in exclude list

To do this fast, each filter keeps three things:
1. `include_map`: Maps a value to a bitset of campaigns that want it.
2. `exclude_map`: Maps a value to a bitset of campaigns that block it.
3. `empty_include_bitset`: A single bitset of campaigns that have no include rules (so they accept anything by default).

## Evaluating a Filter
When a bid request comes in with language="en", the Language Filter does a fast look-up.

First, it gets `include_map["en"]` and combines it with `empty_include_bitset` using a bitwise `OR`. This gives us a bitset of all campaigns that accept "en".

Second, it gets `exclude_map["en"]`.

Finally, it removes the excluded campaigns using a bitwise `AND NOT`. We can write this as one simple formula to find the valid campaigns:
`(include_map["en"] OR empty_include_bitset) AND NOT exclude_map["en"]`

This simple math lets us check the rules for all campaigns at the exact same time.

## Combining the Rules
When a bid request starts, we create a main bitset called `active_campaigns`. We set all bits to `1` because all campaigns start as valid choices. Then, we check each filter. After a filter gives us its result bitset, we use a bitwise `AND` on `active_campaigns` to update the state.

<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:24px 0;">
  <div style="font-size:12px;color:#888;margin-bottom:10px;">Request: loc="jp", lang="en"</div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;min-width:300px;">active_campaigns<span style="display:block;font-size:11px;color:#888;font-family:monospace;margin-top:2px;">1111… (all bits = 1)</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;min-width:300px;">Language Filter<span style="display:block;font-size:11px;color:#888;font-family:monospace;margin-top:2px;">(include["en"] | empty) &amp; ~exclude["en"]</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#e8e8e8;border:1.5px solid #aaa;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;min-width:300px;font-family:monospace;">active = active &amp; language_result</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;min-width:300px;">Location Filter<span style="display:block;font-size:11px;color:#888;font-family:monospace;margin-top:2px;">(include["jp"] | empty) &amp; ~exclude["jp"]</span></div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#e8e8e8;border:1.5px solid #aaa;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;min-width:300px;font-family:monospace;">active = active &amp; location_result</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;min-width:300px;">Final Match → Campaign Result</div>
</div>

## Performance Benefits
First, we skip the slow loop over all campaigns. The time it takes now depends only on how many attributes the bid request has, not how many campaigns we run. This keeps the system fast even when we add many more campaigns.

Second, looking up items in a map is very fast. Using bitwise math updates every campaign instantly in O(1) time.

Finally, bitsets use very little memory. We can track many campaigns with just a few bytes. Because it is so small, it fits perfectly inside the fast CPU cache.

## Reference:
- https://github.com/rtbkit/rtbkit/wiki/Filter
