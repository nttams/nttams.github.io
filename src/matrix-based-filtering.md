# Matrix-Based Campaign Filtering in Real-Time Bidding

## The Matching Problem
In a Real-Time Bidding (RTB) Demand-Side Platform (DSP), each system instance typically processes thousand (say 1000) bid requests per second. For every incoming request, the system must determine which of the thousand (say 1000 too) active campaigns should bid on it. 

Every bid request contains multiple attributes, such as country location ("us", "jp", "sg"), device language ("en", "fr", "vn"), operating system, and the specific website. Concurrently, each campaign enforces strict targeting rules. One campaign might exclusively target iOS users from the "us" who speak "en". Another campaign might accept any global location except "eu".

The system faces a strict time constraint, usually under 100 milliseconds, to find all matching campaigns. The naive approach uses a procedural loop to iterate sequentially through all 1000 campaigns and evaluate every rule inside each campaign.  When this naive loop is used, performance degrades. Checking thousands of rules per request results in millions of evaluations per second. Loop branches, nested conditional statements, and memory jumps consume excess time. CPU branch prediction suffers, and auction latency increases.

To resolve this, the system implements a matrix-based filtering approach. Instead of checking a request against each campaign, the index is inverted. Request attributes map directly to the campaigns that target them.

## The Matrix-Based System
The matching logic relies on an inverted index constructed from bitsets. A bitset is a contiguous array of bits. Each campaign is assigned a fixed ID from 0 to 999. In every bitset, the bit at index `i` always represents the campaign with ID `i`. 

Configurations are not stored inside individual campaign objects. Instead, the system uses independent filter objects for each attribute category, such as a Language Filter or a Location Filter. 

Each filter object manages its own include and exclude rules using maps. The map key is the attribute string, and the value is a bitset. The system evaluates these rules based on a strict truth table:

- **Include empty, exclude empty:** all values are accepted.
- **Include empty, exclude not empty:** all values are accepted except those in exclude.
- **Include not empty, exclude empty:** only values in include are accepted.
- **Include not empty, exclude not empty:** only values in include and not in exclude are accepted.

To implement this logic efficiently, each filter object tracks three components:
1. `include_map`: maps a value to campaigns that explicitly include it.
2. `exclude_map`: maps a value to campaigns that explicitly exclude it.
3. `empty_include_bitset`: a single bitset of campaigns that have no include rules defined (accepting any value by default).

## Evaluating a Filter
When a bid request arrives with a specific attribute, for example, language "en", the Language Filter performs fast lookups against its maps.

First, it retrieves `include_map["en"]` and combines it with the `empty_include_bitset` using a bitwise OR. This creates a combined bitset of all campaigns that accept "en". 

Second, it retrieves `exclude_map["en"]`.

The filter then drops the excluded campaigns using a bitwise AND NOT operation. The final valid campaigns for this attribute are determined by a single formula:
`(include_map["en"] OR empty_include_bitset) AND NOT exclude_map["en"]`

This mathematical expression instantly satisfies the truth table for all 1000 campaigns simultaneously. 

## Combining the Rules
Upon receiving a bid request, the matching engine initializes a primary bitset named `active_campaigns`, with all bits set to `1` (all campaigns start as valid candidates).

The engine parses the request attributes and queries each filter object. As each filter calculates its result bitset, the system applies a bitwise AND to the `active_campaigns` state.

```text
Request: loc="jp", lang="en"

[active_campaigns]  1111... (All start as 1)
       |
       v
Language Filter -> (include_map["en"] | empty_include) & ~exclude_map["en"]
       |
       v
[active_campaigns]  active & language_result
       |
       v
Location Filter -> (include_map["jp"] | empty_include) & ~exclude_map["jp"]
       |
       v
[active_campaigns]  active & location_result
       |
       v
Final Match -> Campaign Result
```

## Performance Benefits
This matrix-based design yields significant architectural advantages.

First, it eliminates the per-request loop over 1000 campaigns. Routing time scales with the number of attributes inside the bid request, not the total number of campaigns. Matching latency stays flat and predictable as campaign volume grows.

Second, dictionary lookups execute extremely fast. Computing the bitwise formula broadcasts the exact state of all campaigns simultaneously in O(1) time.

Finally, bitsets maximize memory efficiency. A bitset tracking 1000 campaigns occupies less than 130 bytes. These compact structures fit cleanly inside fast L1 and L2 CPU caches.

## Reference:
- https://github.com/rtbkit/rtbkit/wiki/Filter